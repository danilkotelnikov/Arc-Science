"""Model seats through the locally installed Claude Code CLI, using the operator's own
first-party login: the subscription route for Opus/Sonnet.

The rule that model execution launches no CLI existed to keep execution authority
away from the model. It is kept in substance: the CLI runs non-interactively with
every tool, MCP server, hook, plugin, skill and session persistence disabled (except
what an admin-managed policy may force back on), in an empty private directory, under
an allowlisted environment, a hard deadline, bounded output and (on Windows) a
kill-on-close job object. Arc never sees the credential; the CLI owns it and attempts
its own refresh. What the flags do not provide is an OS network sandbox: the CLI's
own transport reaches Anthropic, which is what mission egress consent authorizes,
and `network_sandboxed` is reported as false rather than implied.
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
from pathlib import Path

from ..contracts import canonical
from ..transport import ProviderError
from .catalog import BUILTIN_CATALOG, proposal_schema
from .models import Proposal, Reconciliation
from .providers import PLAN_PROMPT, REVIEW_PROMPT

TRANSPORT = 'claude-code'
CONTRACT_VERSION = 'arc-claude-code-2'
CALL_TIMEOUT = 75.0            # below the engine's 90 s deadline
MAX_STDOUT = 1024 * 1024       # one JSON envelope, never a stream
MAX_STDERR = 64 * 1024
STDERR_TAIL = 4096
MAX_PROMPT = 350_000
# Only what the CLI needs to find its own login, temp space and runtime.
ENV_ALLOWLIST = ('PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'TEMP', 'TMP',
                 'TMPDIR', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'APPDATA', 'LOCALAPPDATA',
                 'USERNAME', 'USER', 'LANG', 'LC_ALL', 'TERM', 'ProgramFiles', 'ProgramData',
                 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'CLAUDE_CONFIG_DIR')
# Recognised CLI failure texts; anything else stays 'provider_rejected'.
FAILURE_CATEGORIES = (
    ('auth_expired', 'oauth session expired'),
    ('not_logged_in', 'not logged in'),
    ('credit_exhausted', 'credit balance is too low'),
    ('rate_limited', 'rate limit'),
)
DATED_SUFFIX = re.compile(r'-\d{8}$')


def failure_category(text):
    lowered = (text or '').lower()
    for category, needle in FAILURE_CATEGORIES:
        if needle in lowered:
            return category
    return 'provider_rejected'


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


class ClaudeCodeAgent:
    """Planner and reconciliation seats over `claude -p`; the visual seat is delegated
    to a native image endpoint when one is configured, otherwise refused."""
    requires_egress = True
    network_sandboxed = False

    def __init__(self, command, planner_model, reviewer_model=None, *, timeout=CALL_TIMEOUT,
                 environment=None, vision=None):
        self.command = [str(part) for part in command]
        if not self.command:
            raise ValueError('The Claude Code transport needs an executable')
        self.model = planner_model
        self.reviewer_model = reviewer_model or planner_model
        self.timeout = timeout
        self.environment = scrubbed_environment(environment)
        self.vision = vision
        # An empty private working directory: the CLI reads no project files from it.
        self.workdir = Path(tempfile.mkdtemp(prefix='arc-claude-'))
        self.mcp_config = self.workdir / 'no-mcp.json'
        self.mcp_config.write_text('{"mcpServers": {}}\n', encoding='utf-8')
        self.calls = []

    def close(self):
        shutil.rmtree(self.workdir, ignore_errors=True)

    def model_for(self, role):
        return self.model if role == 'planner' else self.reviewer_model

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
        return await self._call(self.reviewer_model, REVIEW_PROMPT + '\nRole: ' + role, context, Reconciliation, role=role)

    async def review_visual(self, context, artifacts):
        if self.vision is None:
            raise ProviderError('Visual review is not available through the Claude Code transport; '
                                'configure a native image endpoint for the vision seat')
        return await self.vision.review_visual(context, artifacts)

    def arguments(self, model, instructions):
        """The exact invocation: print mode, JSON envelope, no tools, no customizations."""
        return self.command + [
            '-p', '--input-format', 'text', '--output-format', 'json', '--model', model,
            '--tools', '', '--no-session-persistence', '--safe-mode', '--strict-mcp-config',
            '--mcp-config', str(self.mcp_config), '--disable-slash-commands', '--no-chrome',
            '--permission-mode', 'dontAsk', '--prompt-suggestions', 'false',
            '--system-prompt', instructions,
        ]

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
        record = {'transport': TRANSPORT, 'contract': CONTRACT_VERSION, 'role': role, 'requested_model': model,
                  'prompt_sha256': hashlib.sha256(prompt.encode('utf-8')).hexdigest(),
                  'network_sandboxed': self.network_sandboxed, 'tools': 'disabled', 'mcp': 'disabled',
                  'started_at': int(time.time() * 1000)}
        started = time.monotonic()
        try:
            envelope = await run_envelope(self.arguments(model, instructions), prompt, self.workdir,
                                          self.environment, self.timeout)
            if envelope.get('type') != 'result' or envelope.get('is_error'):
                raise ProviderError('Claude Code reported a failed call: ' + failure_category(str(envelope.get('result', ''))))
            observed = observed_model(envelope, model)
            if envelope.get('permission_denials'):
                raise ProviderError('Claude Code attempted a tool action; the call is refused')
            text = envelope.get('result')
            if not isinstance(text, str) or not text.strip():
                raise ProviderError('Missing or ambiguous provider response')
            payload = schema.model_validate_json(text.strip()).model_dump(mode='json')
        except ProviderError as error:
            record.update(outcome='failed', reason=str(error), duration_ms=int((time.monotonic() - started) * 1000))
            self.calls.append(record)
            raise
        except Exception:
            record.update(outcome='failed', reason='Provider request or schema validation failed',
                          duration_ms=int((time.monotonic() - started) * 1000))
            self.calls.append(record)
            raise ProviderError('Provider request or schema validation failed') from None
        record.update(outcome='ok', observed_model=observed, identity_source='claude_code_modelUsage',
                      duration_ms=int((time.monotonic() - started) * 1000),
                      usage=envelope.get('usage'), cost_usd=envelope.get('total_cost_usd'),
                      payload_sha256=hashlib.sha256(canonical(payload)).hexdigest())
        self.calls.append(record)
        return payload


def observed_model(envelope, requested):
    """Exactly one CLI-reported model, and it must be the configured one (or its dated release)."""
    usage = envelope.get('modelUsage')
    if not isinstance(usage, dict) or len(usage) != 1:
        raise ProviderError('Claude Code did not report exactly one model identity')
    (observed,) = usage.keys()
    if not identity_matches(str(observed), requested):
        raise ProviderError('Observed model identity does not match configuration')
    return str(observed)


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


async def run_envelope(arguments, prompt, workdir, environment, timeout):
    """Run one non-interactive call and return its single JSON envelope, or raise."""
    from ..figure_render import _assign_process_to_job, _close_job, _kill_on_close_job
    job = _kill_on_close_job() if os.name == 'nt' else None
    process = None
    try:
        try:
            process = await asyncio.create_subprocess_exec(
                *arguments, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE, cwd=str(workdir), env=environment)
        except OSError as error:
            raise ProviderError('Claude Code executable cannot start: ' + type(error).__name__) from None
        if job is not None:
            try:
                _assign_process_to_job(job, process)
            except OSError:
                process.kill()
                raise ProviderError('Claude Code process could not be contained') from None

        async def feed():
            try:
                process.stdin.write(prompt.encode('utf-8'))
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
            raise ProviderError('Claude Code call exceeded its time limit') from None
        if out_over or err_over:
            raise ProviderError('Claude Code output exceeds limit')
        try:
            envelope = json.loads(stdout.decode('utf-8'))
        except ValueError:
            envelope = None
        if process.returncode != 0:
            # The CLI exits 1 on an API error but still prints its envelope, whose
            # `result` carries the recognisable reason; stderr is the fallback.
            text = envelope.get('result', '') if isinstance(envelope, dict) else ''
            if not text:
                text = stderr[-STDERR_TAIL:].decode('utf-8', errors='replace')
            raise ProviderError('Claude Code exited with status ' + str(process.returncode) + ': '
                                + failure_category(str(text)))
        if not isinstance(envelope, dict):
            raise ProviderError('Claude Code returned no JSON envelope')
        return envelope
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
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise
    return stdout


async def auth_status(command, environment=None, timeout=20.0):
    """Cost-free readiness: the CLI's own login state, never an inference. It says
    whether a login exists, not that it is valid, funded or entitled to a model."""
    try:
        data = json.loads((await _helper(command, ['auth', 'status', '--json'], environment, timeout)).decode('utf-8'))
        return {'logged_in': bool(data.get('loggedIn')), 'auth_method': str(data.get('authMethod', 'unknown')),
                'api_provider': str(data.get('apiProvider', 'unknown'))}
    except Exception:
        return {'logged_in': False, 'auth_method': 'unknown', 'api_provider': 'unknown'}


async def version(command, environment=None, timeout=20.0):
    try:
        return (await _helper(command, ['--version'], environment, timeout)).decode('utf-8', errors='replace').strip()[:80]
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
