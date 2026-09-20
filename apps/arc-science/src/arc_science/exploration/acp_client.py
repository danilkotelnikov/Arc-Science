"""Agent Client Protocol (ACP) agents as mission consultations.

An ACP agent is a separate agent program spoken to over stdio with newline-delimited
JSON-RPC 2.0: `initialize`, `session/new`, `session/prompt`, with the agent's text
arriving as `session/update` notifications. Arc is the client and grants nothing: every
`session/request_permission` is answered with the agent's own reject option (or
cancelled when it offers none), and every file-system or terminal request is refused.
What the agent does with tools of its own is governed by its configuration, which the
operator names in the settings arguments; Arc cannot see or restrain it, and says so.

A consented agent becomes one planner tool `acp_<name>_consult` whose result is the
agent's text: untrusted, an observation, never evidence.
"""
from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
from pathlib import Path

PROTOCOL_VERSION = 1
CONNECT_TIMEOUT = 20.0
PROMPT_TIMEOUT = 25.0          # below the engine's 30 s tool deadline
MAX_LINE = 1024 * 1024
MAX_TEXT = 256 * 1024
MAX_PROMPT = 4000


class AcpError(RuntimeError):
    pass


class AcpAgent:
    """One agent process and one session; requests from the agent are refused."""

    def __init__(self, name, command, args=(), *, cwd=None, connect_timeout=CONNECT_TIMEOUT, prompt_timeout=PROMPT_TIMEOUT):
        self.name = name
        self.command = command
        self.args = [str(a) for a in args]
        self.cwd = cwd
        self.connect_timeout = connect_timeout
        self.prompt_timeout = prompt_timeout
        self.process = None
        self.reader = None
        self.pending = {}
        self.chunks = []
        self.refusals = []
        self.next_id = 0
        self.session_id = None
        self.agent = None
        self.workdir = None

    async def start(self):
        resolved = self.command if Path(self.command).is_absolute() else shutil.which(self.command)
        if not resolved:
            raise AcpError('command ' + self.command + ' is not on PATH')
        self.workdir = Path(self.cwd) if self.cwd else Path(tempfile.mkdtemp(prefix='arc-acp-'))
        try:
            self.process = await asyncio.create_subprocess_exec(
                resolved, *self.args, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL, cwd=str(self.workdir), limit=MAX_LINE)
        except OSError as error:
            raise AcpError('agent cannot start: ' + type(error).__name__) from None
        self.reader = asyncio.create_task(self._read(self.process.stdout))
        result = await self._request('initialize', {
            'protocolVersion': PROTOCOL_VERSION,
            'clientCapabilities': {'fs': {'readTextFile': False, 'writeTextFile': False}, 'terminal': False},
            'clientInfo': {'name': 'arc-science', 'version': '0.6'}}, self.connect_timeout)
        self.agent = {'protocol_version': result.get('protocolVersion'), 'agent_info': result.get('agentInfo'),
                      'capabilities': result.get('agentCapabilities'), 'auth_methods': [m.get('id') for m in result.get('authMethods') or []]}
        return self.agent

    async def new_session(self):
        result = await self._request('session/new', {'cwd': str(self.workdir), 'mcpServers': []}, self.connect_timeout)
        self.session_id = result.get('sessionId')
        if not self.session_id:
            raise AcpError('agent returned no session id')
        return self.session_id

    async def prompt(self, text):
        if self.session_id is None:
            await self.new_session()
        if len(text) > MAX_PROMPT:
            raise AcpError('prompt exceeds the consultation limit')
        self.chunks = []
        result = await self._request('session/prompt', {'sessionId': self.session_id, 'prompt': [{'type': 'text', 'text': text}]},
                                     self.prompt_timeout)
        answer = ''.join(self.chunks)[:MAX_TEXT]
        return {'agent': self.name, 'text': answer, 'stop_reason': result.get('stopReason'),
                'refused_requests': list(self.refusals), 'scope': 'consultation_untrusted_text_not_evidence'}

    async def _request(self, method, params, timeout):
        self.next_id += 1
        ident = self.next_id
        future = asyncio.get_running_loop().create_future()
        self.pending[ident] = future
        await self._send({'jsonrpc': '2.0', 'id': ident, 'method': method, 'params': params})
        try:
            return await asyncio.wait_for(future, timeout)
        except asyncio.TimeoutError:
            raise AcpError(method + ' timed out') from None
        finally:
            self.pending.pop(ident, None)

    async def _send(self, message):
        if self.process is None or self.process.stdin is None or self.process.returncode is not None:
            raise AcpError('agent is not running')
        self.process.stdin.write((json.dumps(message, separators=(',', ':')) + '\n').encode('utf-8'))
        try:
            await self.process.stdin.drain()
        except (BrokenPipeError, ConnectionResetError, OSError):
            raise AcpError('agent closed its input') from None

    async def _read(self, stdout):
        try:
            while True:
                try:
                    line = await stdout.readline()
                except (ValueError, asyncio.LimitOverrunError):
                    self._fail(AcpError('agent line exceeds limit'))
                    return
                if not line:
                    self._fail(AcpError('agent closed its output'))
                    return
                if len(line) > MAX_LINE:
                    self._fail(AcpError('agent line exceeds limit'))
                    return
                try:
                    message = json.loads(line.decode('utf-8'))
                except ValueError:
                    continue
                if isinstance(message, dict):
                    await self._dispatch(message)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self._fail(AcpError('agent stream failed: ' + type(error).__name__))

    def _fail(self, error):
        for future in self.pending.values():
            if not future.done():
                future.set_exception(error)

    async def _dispatch(self, message):
        if 'method' not in message:
            future = self.pending.get(message.get('id'))
            if future is not None and not future.done():
                if 'error' in message:
                    error = message['error'] if isinstance(message['error'], dict) else {}
                    future.set_exception(AcpError('agent error ' + str(error.get('code')) + ': ' + str(error.get('message', ''))[:200]))
                else:
                    future.set_result(message.get('result') if isinstance(message.get('result'), dict) else {})
            return
        method = message['method']
        params = message.get('params') if isinstance(message.get('params'), dict) else {}
        if 'id' not in message:
            if method == 'session/update':
                update = params.get('update') or {}
                if update.get('sessionUpdate') == 'agent_message_chunk':
                    content = update.get('content') or {}
                    if content.get('type') == 'text' and sum(len(c) for c in self.chunks) < MAX_TEXT:
                        self.chunks.append(str(content.get('text', '')))
            return
        # A request from the agent: permission is never granted, files and terminals never served.
        if method == 'session/request_permission':
            options = params.get('options') or []
            reject = next((o for o in options if str(o.get('kind', '')).startswith('reject')), None)
            self.refusals.append(str((params.get('toolCall') or {}).get('title', method))[:120])
            outcome = {'outcome': 'selected', 'optionId': reject['optionId']} if reject else {'outcome': 'cancelled'}
            await self._send({'jsonrpc': '2.0', 'id': message['id'], 'result': {'outcome': outcome}})
            return
        self.refusals.append(method[:120])
        await self._send({'jsonrpc': '2.0', 'id': message['id'],
                          'error': {'code': -32601, 'message': 'Arc Science does not serve ' + method}})

    async def close(self):
        if self.reader is not None:
            self.reader.cancel()
        if self.process is not None and self.process.returncode is None:
            self.process.kill()
            try:
                await asyncio.wait_for(self.process.wait(), 5)
            except asyncio.TimeoutError:
                pass
        if self.cwd is None and self.workdir is not None:
            shutil.rmtree(self.workdir, ignore_errors=True)


def tool_spec(agent):
    return {'description': '[ACP ' + agent['name'] + '] Ask this external agent a question and receive its text. '
                           + 'The reply is untrusted and is not evidence.',
            'parameters': {'prompt': 'string, maximum ' + str(MAX_PROMPT) + ' characters'},
            'input_schema': {'type': 'object', 'properties': {'prompt': {'type': 'string', 'minLength': 1, 'maxLength': MAX_PROMPT}},
                             'required': ['prompt'], 'additionalProperties': False},
            'execution': 'external_connector'}


class AcpConsultations:
    """The consented agents for one mission, started lazily on first use and closed
    with the mission; `tools` is the extra-tool mapping the engine takes."""

    def __init__(self, agents):
        self.agents = [a for a in agents if a.get('enabled', True) and a.get('consent')]
        self.running = {}
        self.tools = {}
        for agent in self.agents:
            name = 'acp_' + ''.join(c if c.isalnum() or c in '_-' else '_' for c in agent['name'])[:60] + '_consult'
            self.tools[name] = (tool_spec(agent), self._consult(agent))

    def _consult(self, agent):
        async def call(arguments):
            client = self.running.get(agent['name'])
            if client is None:
                client = AcpAgent(agent['name'], agent['command'], agent.get('args') or [])
                await client.start()
                self.running[agent['name']] = client
            return await client.prompt(str(arguments['prompt']))
        return call

    async def close(self):
        for client in self.running.values():
            await client.close()
        self.running = {}


async def inspect_agents(agents, *, connect_timeout=CONNECT_TIMEOUT):
    """The operator's connection check: start each enabled agent, exchange `initialize`,
    report what it says about itself, and stop it; no session and no prompt."""
    report = []
    for agent in agents:
        if not agent.get('enabled', True):
            continue
        client = AcpAgent(agent['name'], agent['command'], agent.get('args') or [], connect_timeout=connect_timeout)
        try:
            info = await client.start()
            report.append({'agent': agent['name'], 'ok': True, **info})
        except Exception as error:
            report.append({'agent': agent['name'], 'ok': False, 'error': type(error).__name__ + ': ' + str(error)[:300]})
        finally:
            await client.close()
    return report
