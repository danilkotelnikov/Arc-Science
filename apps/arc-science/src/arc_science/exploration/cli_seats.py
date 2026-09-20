"""Model seats through a provider's locally installed CLI, using the operator's own
login: Claude Code (Anthropic), Codex (OpenAI) and Gemini CLI (Google).

The rule that model execution launches no CLI existed to keep execution authority
away from the model. It is kept in substance: each CLI runs non-interactively with
every tool, MCP server, hook, plugin, skill, extension and session persistence
disabled (except what an admin-managed policy may force back on), in an empty private
directory, under an allowlisted environment, a hard deadline, bounded output and (on
Windows) a kill-on-close job object. Arc never sees the credential; the CLI owns it and
attempts its own refresh. What the flags do not provide is an OS network sandbox: the
CLI's own transport reaches its provider, which is what mission egress consent
authorizes, and `network_sandboxed` is reported as false rather than implied.

Identity: Claude Code reports the model that answered (`modelUsage`) and Gemini CLI
reports it in `stats.models`; Codex reports none, so a Codex seat's identity is
recorded as requested-only and the claim scope treats it as unverified.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from ..contracts import canonical
from ..transport import ProviderError, strict_schema
from .catalog import BUILTIN_CATALOG, proposal_schema
from .effort import applied_effort
from .models import Proposal, Reconciliation
from .providers import PLAN_PROMPT, REVIEW_PROMPT

CALL_TIMEOUT = 75.0            # below the engine's 90 s deadline
MAX_STDOUT = 1024 * 1024       # one JSON envelope or event list, never a stream
MAX_STDERR = 64 * 1024
STDERR_TAIL = 4096
MAX_PROMPT = 350_000
# Only what a CLI needs to find its own login, temp space and runtime.
ENV_ALLOWLIST = ('PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'TEMP', 'TMP',
                 'TMPDIR', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'APPDATA', 'LOCALAPPDATA',
                 'USERNAME', 'USER', 'LANG', 'LC_ALL', 'TERM', 'ProgramFiles', 'ProgramData',
                 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME')
# Recognised CLI failure texts; anything else stays 'provider_rejected'.
FAILURE_CATEGORIES = (
    ('auth_expired', 'oauth session expired'),
    ('not_logged_in', 'not logged in'),
    ('account_ineligible', 'ineligibletiererror'),
    ('credit_exhausted', 'credit balance is too low'),
    ('rate_limited', 'rate limit'),
    ('usage_limit', 'usage limit'),
    ('model_unsupported', 'model is not supported'),
)
DATED_SUFFIX = re.compile(r'-\d{8}$')
# The one Codex event that is expected under this contract: the skills catalogue is
# budgeted to nothing so no operator skill text reaches the seat.
CODEX_SKILLS_EXCLUDED = 'skills context budget'
CODEX_FEATURES_OFF = ('shell_tool', 'unified_exec', 'apps', 'browser_use', 'computer_use', 'multi_agent',
                      'view_image', 'image_generation', 'plugins', 'hooks', 'skill_search', 'memories')
GEMINI_DENY_ALL = '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n'
GEMINI_SYSTEM_SETTINGS = {'hooksConfig': {'enabled': False}, 'skills': {'enabled': False},
                          'admin': {'extensions': {'enabled': False}, 'mcp': {'enabled': False}},
                          'mcp': {'allowed': []}, 'general': {'defaultApprovalMode': 'plan'}}


def failure_category(text):
    lowered = (text or '').lower()
    for category, needle in FAILURE_CATEGORIES:
        if needle in lowered:
            return category
    return 'provider_rejected'


SECRET_PAIR = re.compile(r'(?i)\b(authorization|token|api[_-]?key|secret|password|credential)(\s*[:=]\s*)(?:bearer\s+)?\S+')
BEARER = re.compile(r'(?i)\bbearer\s+\S+')
OPAQUE = re.compile(r'\b[A-Za-z0-9_\-]{32,}\b')


def redact(text):
    """Provider or CLI text that may be shown or stored: bearer values, secret pairs and
    long opaque tokens replaced before it leaves the transport."""
    text = SECRET_PAIR.sub(lambda m: m.group(1) + m.group(2) + '[redacted]', str(text or ''))
    text = BEARER.sub('Bearer [redacted]', text)
    return OPAQUE.sub('[redacted]', text)


def failure_reason(text):
    """The category, with a short redacted excerpt of the provider's own words when no
    category fits."""
    category = failure_category(text)
    excerpt = redact(' '.join(str(text or '').split()))[:200]
    return category + (' (' + excerpt + ')' if category == 'provider_rejected' and excerpt else '')


def scrubbed_environment(source=None):
    # Windows reports variable names in upper case; match them case-insensitively.
    source = os.environ if source is None else source
    allowed = {name.upper() for name in ENV_ALLOWLIST}
    return {key: value for key, value in source.items() if key.upper() in allowed}


def identity_matches(observed, requested):
    """The configured selector exactly, or that selector with a dated release suffix.
    Aliases such as `opus` are deliberately not accepted: configure the full id."""
    if observed == requested:
        return True
    return bool(DATED_SUFFIX.search(observed)) and DATED_SUFFIX.sub('', observed) == requested


def one_observed_model(models, requested, label):
    """Exactly one CLI-reported model, and it must be the configured one (or its dated release)."""
    if not isinstance(models, dict) or len(models) != 1:
        raise ProviderError(label + ' did not report exactly one model identity')
    (observed,) = models.keys()
    if not identity_matches(str(observed), requested):
        raise ProviderError('Observed model identity does not match configuration')
    return str(observed)


@dataclass(frozen=True)
class Answer:
    text: str
    observed_model: str | None
    identity_source: str
    usage: dict | None = None
    cost_usd: float | None = None
    notes: tuple[str, ...] = ()


class Claude:
    """`claude -p`: JSON envelope, system prompt flag, tools off, customizations off."""
    label = 'Claude Code'
    transport = 'claude-code'
    contract = 'arc-claude-code-2'

    @staticmethod
    def prepare(workdir):
        (workdir / 'no-mcp.json').write_text('{"mcpServers": {}}\n', encoding='utf-8')

    @staticmethod
    def files(workdir, call, instructions, response_schema):
        return {}

    @staticmethod
    def arguments(command, model, instructions, effort, workdir, files):
        return command + [
            '-p', '--input-format', 'text', '--output-format', 'json', '--model', model,
            '--tools', '', '--no-session-persistence', '--safe-mode', '--strict-mcp-config',
            '--mcp-config', str(workdir / 'no-mcp.json'), '--disable-slash-commands', '--no-chrome',
            '--permission-mode', 'dontAsk', '--prompt-suggestions', 'false',
            '--system-prompt', instructions,
        ] + (['--effort', effort] if effort else [])

    @staticmethod
    def environment(base, files):
        return base

    @staticmethod
    def stdin(instructions, prompt):
        return prompt

    @classmethod
    def parse(cls, stdout, stderr, returncode, files, model):
        try:
            envelope = json.loads(stdout.decode('utf-8'))
        except ValueError:
            envelope = None
        if returncode != 0:
            # The CLI exits 1 on an API error but still prints its envelope, whose
            # `result` carries the recognisable reason; stderr is the fallback.
            text = envelope.get('result', '') if isinstance(envelope, dict) else ''
            if not text:
                text = stderr[-STDERR_TAIL:].decode('utf-8', errors='replace')
            raise ProviderError(cls.label + ' exited with status ' + str(returncode) + ': ' + failure_category(str(text)))
        if not isinstance(envelope, dict):
            raise ProviderError(cls.label + ' returned no JSON envelope')
        if envelope.get('type') != 'result' or envelope.get('is_error'):
            raise ProviderError(cls.label + ' reported a failed call: ' + failure_category(str(envelope.get('result', ''))))
        observed = one_observed_model(envelope.get('modelUsage'), model, cls.label)
        if envelope.get('permission_denials'):
            raise ProviderError(cls.label + ' attempted a tool action; the call is refused')
        text = envelope.get('result')
        if not isinstance(text, str) or not text.strip():
            raise ProviderError('Missing or ambiguous provider response')
        return Answer(text, observed, 'claude_code_modelUsage', envelope.get('usage'), envelope.get('total_cost_usd'))


class Codex:
    """`codex exec`: JSONL events, output schema, read-only sandbox, every feature that
    could act switched off, user config ignored. The event stream never names the
    model that answered, so identity stays requested-only."""
    label = 'Codex'
    transport = 'codex'
    contract = 'arc-codex-1'

    @staticmethod
    def prepare(workdir):
        pass

    @staticmethod
    def files(workdir, call, instructions, response_schema):
        # The same strict form the OpenAI HTTP adapter sends: every property required,
        # no additional properties, no defaults.
        schema = workdir / (call + '.schema.json')
        schema.write_text(json.dumps(strict_schema(response_schema), separators=(',', ':')), encoding='utf-8')
        return {'schema': schema, 'last': workdir / (call + '.last.txt')}

    @staticmethod
    def arguments(command, model, instructions, effort, workdir, files):
        config = ['web_search="disabled"', 'approval_policy="never"', 'skills.max_context_tokens=1',
                  'project_doc_max_bytes=0'] + ['features.' + name + '=false' for name in CODEX_FEATURES_OFF]
        if effort:
            config.append('model_reasoning_effort="' + effort + '"')
        arguments = command + ['exec', '--json', '-o', str(files['last']), '--output-schema', str(files['schema']),
                               '--sandbox', 'read-only', '--ephemeral', '--ignore-user-config',
                               '--skip-git-repo-check', '--strict-config', '-m', model, '-C', str(workdir)]
        for entry in config:
            arguments += ['-c', entry]
        return arguments + ['-']

    @staticmethod
    def environment(base, files):
        return base

    @staticmethod
    def stdin(instructions, prompt):
        # Codex has no system-prompt flag: the seat instructions lead the prompt.
        return instructions + '\n\n' + prompt

    @classmethod
    def parse(cls, stdout, stderr, returncode, files, model):
        events = []
        for line in stdout.decode('utf-8', errors='replace').splitlines():
            if line.strip():
                try:
                    events.append(json.loads(line))
                except ValueError:
                    raise ProviderError(cls.label + ' returned no JSON envelope') from None
        messages, errors, notes, usage = [], [], [], None
        for event in events:
            if not isinstance(event, dict):
                raise ProviderError(cls.label + ' returned no JSON envelope')
            kind = event.get('type')
            if kind in ('item.started', 'item.completed'):
                item = event.get('item') or {}
                item_type = item.get('type')
                if item_type == 'agent_message':
                    if kind == 'item.completed':
                        messages.append(str(item.get('text', '')))
                elif item_type == 'error':
                    message = str(item.get('message', ''))
                    if CODEX_SKILLS_EXCLUDED in message.lower():
                        notes.append('skills_excluded')
                    else:
                        errors.append(message)
                elif item_type == 'reasoning':
                    pass
                else:
                    raise ProviderError(cls.label + ' attempted a tool action (' + str(item_type) + '); the call is refused')
            elif kind in ('error', 'turn.failed'):
                error = event.get('error') if isinstance(event.get('error'), dict) else event
                errors.append(str(error.get('message', '')))
            elif kind == 'turn.completed':
                usage = event.get('usage')
        if returncode != 0 or errors:
            text = ' '.join(errors) or stderr[-STDERR_TAIL:].decode('utf-8', errors='replace')
            raise ProviderError(cls.label + ' exited with status ' + str(returncode) + ': ' + failure_reason(text))
        if not events:
            raise ProviderError(cls.label + ' returned no JSON envelope')
        if len(messages) != 1 or not messages[0].strip():
            raise ProviderError('Missing or ambiguous provider response')
        try:
            last = files['last'].read_text(encoding='utf-8')
        except OSError:
            raise ProviderError(cls.label + ' wrote no final message') from None
        if last.strip() != messages[0].strip():
            raise ProviderError(cls.label + ' final message and event stream disagree')
        return Answer(messages[0], None, 'requested_only', usage, None, tuple(dict.fromkeys(notes)))


class Gemini:
    """`gemini -p`: JSON output, plan mode behind a deny-all policy, extensions off, a
    system settings file that switches hooks, skills, extensions and MCP off, and the
    seat instructions as the whole system prompt."""
    label = 'Gemini CLI'
    transport = 'gemini-cli'
    contract = 'arc-gemini-cli-1'

    @staticmethod
    def prepare(workdir):
        (workdir / 'deny-all.toml').write_text(GEMINI_DENY_ALL, encoding='utf-8')
        (workdir / 'system-settings.json').write_text(json.dumps(GEMINI_SYSTEM_SETTINGS), encoding='utf-8')

    @staticmethod
    def files(workdir, call, instructions, response_schema):
        system = workdir / (call + '.system.md')
        system.write_text(instructions + '\n', encoding='utf-8')
        return {'system': system}

    @staticmethod
    def arguments(command, model, instructions, effort, workdir, files):
        return command + ['-p', '', '-o', 'json', '--approval-mode', 'plan', '--policy', str(workdir / 'deny-all.toml'),
                          '-e', 'none', '-m', model]

    @staticmethod
    def environment(base, files):
        return {**base, 'GEMINI_CLI_SYSTEM_SETTINGS_PATH': str(files['system'].parent / 'system-settings.json'),
                'GEMINI_SYSTEM_MD': str(files['system'])}

    @staticmethod
    def stdin(instructions, prompt):
        return prompt

    @classmethod
    def parse(cls, stdout, stderr, returncode, files, model):
        try:
            data = json.loads(stdout.decode('utf-8'))
        except ValueError:
            data = None
        if returncode != 0 or (isinstance(data, dict) and data.get('error')):
            error = data.get('error') if isinstance(data, dict) else None
            text = str(error.get('message', '')) if isinstance(error, dict) else ''
            if not text:
                text = stderr[-STDERR_TAIL:].decode('utf-8', errors='replace')
            raise ProviderError(cls.label + ' exited with status ' + str(returncode) + ': ' + failure_reason(text))
        if not isinstance(data, dict):
            raise ProviderError(cls.label + ' returned no JSON envelope')
        stats = data.get('stats') or {}
        if (stats.get('tools') or {}).get('totalCalls'):
            raise ProviderError(cls.label + ' attempted a tool action; the call is refused')
        observed = one_observed_model(stats.get('models'), model, cls.label)
        text = data.get('response')
        if not isinstance(text, str) or not text.strip():
            raise ProviderError('Missing or ambiguous provider response')
        usage = (stats.get('models') or {}).get(observed, {}).get('tokens')
        return Answer(text, observed, 'gemini_cli_stats_models', usage if isinstance(usage, dict) else None)


FLAVOURS = {'anthropic': Claude, 'openai': Codex, 'gemini': Gemini}


class CliAgent:
    """Planner and reconciliation seats over one provider's CLI; the visual seat is
    delegated to a native image endpoint when one is configured, otherwise refused."""
    requires_egress = True
    network_sandboxed = False

    def __init__(self, command, planner_model, reviewer_model=None, *, provider='anthropic', timeout=CALL_TIMEOUT,
                 environment=None, vision=None, falsifier_model=None, efforts=None):
        if provider not in FLAVOURS:
            raise ValueError('No CLI transport for provider ' + str(provider))
        self.provider = provider
        self.flavour = FLAVOURS[provider]
        self.command = [str(part) for part in command]
        if not self.command:
            raise ValueError('The ' + self.flavour.label + ' transport needs an executable')
        self.model = planner_model
        self.reviewer_model = reviewer_model or planner_model
        self.falsifier_model = falsifier_model or self.reviewer_model
        # role -> (requested level, level sent, source); a role without an entry keeps
        # the CLI's own default and records that.
        self.efforts = {role: (level,) + applied_effort(provider, 'cli', level) for role, level in (efforts or {}).items()}
        self.timeout = timeout
        self.environment = scrubbed_environment(environment)
        self.vision = vision
        # An empty private working directory: the CLI reads no project files from it.
        self.workdir = Path(tempfile.mkdtemp(prefix='arc-' + provider + '-'))
        self.flavour.prepare(self.workdir)
        self.calls = []

    def close(self):
        shutil.rmtree(self.workdir, ignore_errors=True)

    def model_for(self, role):
        return {'planner': self.model, 'falsifier': self.falsifier_model}.get(role, self.reviewer_model)

    def effort_for(self, role):
        return self.efforts.get(role, self.efforts.get('reviewer', (None, None, 'provider_default')))

    def take_provenance(self, role):
        """The most recent call record for a role, removed from the pending list so the
        engine can bind it to exactly one ModelRecord."""
        for index in range(len(self.calls) - 1, -1, -1):
            if self.calls[index]['role'] == role:
                return self.calls.pop(index)
        return None

    async def propose(self, context):
        return await self._call(self.model, PLAN_PROMPT, context, Proposal, role='planner')

    async def assess(self, role, context):
        return await self._call(self.model_for(role), REVIEW_PROMPT + '\nRole: ' + role, context, Reconciliation, role=role)

    async def review_visual(self, context, artifacts):
        if self.vision is None:
            raise ProviderError('Visual review is not available through the ' + self.flavour.label + ' transport; '
                                + 'configure a native image endpoint for the vision seat')
        return await self.vision.review_visual(context, artifacts)

    def arguments(self, model, instructions, effort=None, files=None):
        """The exact invocation: print mode, JSON output, no tools, no customizations."""
        return self.flavour.arguments(self.command, model, instructions, effort, self.workdir, files or {})

    async def _call(self, model, instructions, context, schema, *, role):
        if len(canonical(context)) > MAX_PROMPT:
            raise ProviderError('Context exceeds service budget')
        if schema is Proposal:
            try:
                response_schema = proposal_schema(context['tools'] if 'tools' in context else BUILTIN_CATALOG)
            except Exception:
                raise ProviderError('Runtime tool catalog cannot be represented safely') from None
        else:
            response_schema = schema.model_json_schema()
        prompt = json.dumps({'context': context, 'response_schema': response_schema}, separators=(',', ':'))
        requested_effort, effort, effort_source = self.effort_for(role)
        record = {'transport': self.flavour.transport, 'contract': self.flavour.contract, 'provider': self.provider,
                  'role': role, 'requested_model': model, 'requested_effort': requested_effort,
                  'applied_effort': effort, 'effort_source': effort_source,
                  'prompt_sha256': hashlib.sha256(prompt.encode('utf-8')).hexdigest(),
                  'network_sandboxed': self.network_sandboxed, 'tools': 'disabled', 'mcp': 'disabled',
                  'started_at': int(time.time() * 1000)}
        started = time.monotonic()
        call = uuid.uuid4().hex[:12]
        files = self.flavour.files(self.workdir, call, instructions, response_schema)
        try:
            stdout, stderr, returncode = await run_process(
                self.flavour.arguments(self.command, model, instructions, effort, self.workdir, files),
                self.flavour.stdin(instructions, prompt), self.workdir,
                self.flavour.environment(self.environment, files), self.timeout, self.flavour.label)
            answer = self.flavour.parse(stdout, stderr, returncode, files, model)
            payload = schema.model_validate_json(answer.text.strip()).model_dump(mode='json')
        except ProviderError as error:
            record.update(outcome='failed', reason=str(error), duration_ms=int((time.monotonic() - started) * 1000))
            self.calls.append(record)
            raise
        except Exception:
            record.update(outcome='failed', reason='Provider request or schema validation failed',
                          duration_ms=int((time.monotonic() - started) * 1000))
            self.calls.append(record)
            raise ProviderError('Provider request or schema validation failed') from None
        finally:
            for path in files.values():
                with_suppress_unlink(path)
        record.update(outcome='ok', observed_model=answer.observed_model, identity_source=answer.identity_source,
                      identity_verified=answer.observed_model is not None,
                      duration_ms=int((time.monotonic() - started) * 1000),
                      usage=answer.usage, cost_usd=answer.cost_usd,
                      payload_sha256=hashlib.sha256(canonical(payload)).hexdigest())
        if answer.notes:
            record['notes'] = list(answer.notes)
        self.calls.append(record)
        return payload


def with_suppress_unlink(path):
    try:
        Path(path).unlink()
    except OSError:
        pass


async def _drain(stream, cap, process):
    """Read a pipe into memory up to `cap`; past it the process is killed at once."""
    chunks, total = [], 0
    while True:
        chunk = await stream.read(65536)
        if not chunk:
            return b''.join(chunks), False
        total += len(chunk)
        if total > cap:
            process.kill()
            return b''.join(chunks), True
        chunks.append(chunk)


async def run_process(arguments, stdin_text, workdir, environment, timeout, label):
    """Run one non-interactive call: (stdout, stderr, returncode), bounded and contained."""
    from ..figure_render import _assign_process_to_job, _close_job, _kill_on_close_job
    job = _kill_on_close_job() if os.name == 'nt' else None
    process = None
    try:
        try:
            process = await asyncio.create_subprocess_exec(
                *arguments, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE, cwd=str(workdir), env=environment)
        except OSError as error:
            raise ProviderError(label + ' executable cannot start: ' + type(error).__name__) from None
        if job is not None:
            try:
                _assign_process_to_job(job, process)
            except OSError:
                process.kill()
                raise ProviderError(label + ' process could not be contained') from None

        async def feed():
            try:
                process.stdin.write(stdin_text.encode('utf-8'))
                await process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                process.stdin.close()

        try:
            _, (stdout, out_over), (stderr, err_over) = await asyncio.wait_for(
                asyncio.gather(feed(), _drain(process.stdout, MAX_STDOUT, process),
                               _drain(process.stderr, MAX_STDERR, process)), timeout)
            await asyncio.wait_for(process.wait(), 10)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise ProviderError(label + ' call exceeded its time limit') from None
        if out_over or err_over:
            raise ProviderError(label + ' output exceeds limit')
        return stdout, stderr, process.returncode
    finally:
        if process is not None and process.returncode is None:
            process.kill()
        if job is not None:
            _close_job(job)


async def _helper(command, arguments, environment, timeout):
    """A cost-free CLI query; a hung helper is killed, never left behind."""
    process = await asyncio.create_subprocess_exec(
        *[str(part) for part in command], *arguments, stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=scrubbed_environment(environment))
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise
    return stdout, stderr, process.returncode


UNKNOWN_LOGIN = {'logged_in': False, 'auth_method': 'unknown', 'api_provider': 'unknown'}


async def auth_status(command, environment=None, timeout=20.0, provider='anthropic'):
    """Cost-free readiness: the CLI's own login state, never an inference. It says
    whether a login exists, not that it is valid, funded or entitled to a model."""
    try:
        if provider == 'anthropic':
            stdout, _, _ = await _helper(command, ['auth', 'status', '--json'], environment, timeout)
            data = json.loads(stdout.decode('utf-8'))
            return {'logged_in': bool(data.get('loggedIn')), 'auth_method': str(data.get('authMethod', 'unknown')),
                    'api_provider': str(data.get('apiProvider', 'unknown'))}
        if provider == 'openai':
            stdout, stderr, returncode = await _helper(command, ['login', 'status'], environment, timeout)
            text = (stdout + stderr).decode('utf-8', errors='replace').strip()
            logged = returncode == 0 and 'logged in' in text.lower() and 'not logged in' not in text.lower()
            method = 'chatgpt' if 'chatgpt' in text.lower() else ('api_key' if 'api key' in text.lower() else 'unknown')
            return {'logged_in': logged, 'auth_method': method if logged else 'none', 'api_provider': 'openai'}
        # Gemini CLI has no status command; a login file is evidence of a login, not of eligibility.
        home = Path((environment or os.environ).get('USERPROFILE') or (environment or os.environ).get('HOME') or '')
        found = home != Path('') and (home / '.gemini' / 'oauth_creds.json').is_file()
        return {'logged_in': found, 'auth_method': 'google_oauth_file' if found else 'none', 'api_provider': 'google'}
    except Exception:
        return dict(UNKNOWN_LOGIN)


async def version(command, environment=None, timeout=20.0):
    try:
        stdout, _, _ = await _helper(command, ['--version'], environment, timeout)
        return stdout.decode('utf-8', errors='replace').strip()[:80]
    except Exception:
        return 'unknown'


_digests = {}


async def executable_digest(path):
    """SHA-256 of the executable, hashed once per (path, size, mtime) off the event loop."""
    try:
        stat = Path(path).stat()
    except OSError:
        return None
    key = (str(path), stat.st_size, stat.st_mtime_ns)
    if key not in _digests:
        def hash_file():
            digest = hashlib.sha256()
            with open(path, 'rb') as handle:
                for block in iter(lambda: handle.read(1024 * 1024), b''):
                    digest.update(block)
            return digest.hexdigest()
        _digests[key] = await asyncio.to_thread(hash_file)
    return _digests[key]
