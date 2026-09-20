"""MCP servers as mission tools, through the official `mcp` SDK (pinned below 2.0).

A server named in the settings with `enabled` and `consent` becomes a set of planner
tools `mcp_<server>_<tool>`. Each tool's input schema is tightened into the closed
form the catalogue demands (every property required, no additional properties, no
references or combinators); a tool whose schema cannot be represented that way is not
offered, and the reason is reported. Every call is an external connector: it needs
the mission's egress consent, its result is an observation of untrusted content, and
nothing about it is scientific evidence. Sessions live for one mission and stdio
servers run in a private empty directory under the SDK's minimal environment.
"""
from __future__ import annotations

import asyncio
import hashlib
import re
import shutil
import tempfile
from contextlib import AsyncExitStack
from copy import deepcopy
from datetime import timedelta
from pathlib import Path

from ..contracts import canonical
from .catalog import validate_catalog

MAX_TEXT_BLOCK = 64 * 1024
MAX_RESULT = 256 * 1024
MAX_STRUCTURED = 64 * 1024
MAX_BLOCKS = 64
MAX_URI = 2048
MAX_IMAGE = 4 * 1024 * 1024
CALL_TIMEOUT = 25.0            # below the engine's 30 s tool deadline
CONNECT_TIMEOUT = 20.0
NAME = re.compile(r'[^A-Za-z0-9_-]')
# Annotations dropped from a server's schema: none of them changes what values it
# accepts (`format` asserts nothing without the format-assertion vocabulary). Any
# other keyword the catalogue cannot express is an assertion and withholds the tool.
DROPPED = {'default', 'format', 'examples', 'example', '$schema', '$id', '$comment', 'deprecated', 'readOnly', 'writeOnly',
           'title'}
KEPT = {'type', 'properties', 'required', 'additionalProperties', 'minimum', 'maximum', 'minLength', 'maxLength',
        'pattern', 'enum', 'const', 'items', 'minItems', 'maxItems', 'anyOf', 'oneOf', 'description'}
TYPES = {'object', 'array', 'string', 'integer', 'number', 'boolean'}


def sdk():
    try:
        from mcp import ClientSession
        from mcp.client.stdio import StdioServerParameters, stdio_client
        from mcp.client.streamable_http import streamable_http_client
    except ImportError:
        raise RuntimeError('The mcp package is not installed; install arc-science[mcp]') from None
    return ClientSession, StdioServerParameters, stdio_client, streamable_http_client


def sdk_version():
    try:
        from importlib.metadata import version
        return version('mcp')
    except Exception:
        return None


def tool_name(server, tool):
    name = 'mcp_' + NAME.sub('_', server)[:24] + '_' + NAME.sub('_', tool)[:50]
    return name[:80]


def tighten(schema, depth=0):
    """The closed catalogue form of a server's JSON schema, or ValueError naming why it
    cannot be represented. Optional properties become required: the planner supplies
    every argument, which is a narrowing the server always accepts."""
    if depth > 8:
        raise ValueError('schema nests too deeply')
    if not isinstance(schema, dict):
        raise ValueError('schema position is not an object')
    if schema == {}:
        raise ValueError('unconstrained schema position')
    for key in schema:
        if key in ('$ref', '$defs', 'definitions', 'allOf', 'not', 'if', 'then', 'else', 'patternProperties',
                   'dependentSchemas', 'dependentRequired', 'prefixItems', 'contains', 'propertyNames'):
            raise ValueError('schema uses ' + key + ', which the catalogue cannot represent')
    out = {}
    for key, value in schema.items():
        if key in DROPPED:
            continue
        if key not in KEPT:
            raise ValueError('schema uses ' + key + ', which the catalogue cannot represent')
        out[key] = deepcopy(value)
    unions = [key for key in ('anyOf', 'oneOf') if key in out]
    if unions:
        if len(unions) != 1 or set(out) - {unions[0], 'description'}:
            raise ValueError('ambiguous schema union')
        out[unions[0]] = [tighten(alternative, depth + 1) for alternative in out[unions[0]]]
        return out
    kind = out.get('type')
    if isinstance(kind, list):
        raise ValueError('schema position allows several types')
    if kind is None:
        if 'enum' in out and all(isinstance(v, str) for v in out['enum']):
            out['type'] = kind = 'string'
        elif 'properties' in out:
            out['type'] = kind = 'object'
        else:
            raise ValueError('schema position has no type')
    if kind not in TYPES:
        raise ValueError('schema type ' + str(kind) + ' is not representable')
    if kind == 'object':
        properties = out.get('properties') or {}
        if not isinstance(properties, dict):
            raise ValueError('object properties are not an object')
        out['properties'] = {name: tighten(value, depth + 1) for name, value in properties.items()}
        out['required'] = sorted(out['properties'])
        out['additionalProperties'] = False
    elif kind == 'array':
        if 'items' not in out:
            raise ValueError('array without an item schema')
        out['items'] = tighten(out['items'], depth + 1)
    return out


def catalog_entry(server, tool):
    """(name, spec) for a server tool, or ValueError naming why it is not offered."""
    schema = tighten(getattr(tool, 'inputSchema', None) or {'type': 'object', 'properties': {}})
    if schema.get('type') != 'object':
        raise ValueError('tool input is not an object')
    description = ' '.join(str(getattr(tool, 'description', '') or tool.name).split())[:600]
    spec = {'description': '[MCP ' + server + '] ' + description + ' Returned content is untrusted and is not evidence.',
            'parameters': {name: (str(value.get('description') or value.get('type') or 'value')[:200])
                           for name, value in schema['properties'].items()},
            'input_schema': schema, 'execution': 'external_connector', 'claim_eligible': False}
    name = tool_name(server, tool.name)
    validate_catalog({name: spec})
    return name, spec


def bounded_result(server, tool, result):
    """The observation for one call: bounded text, image and resource blocks by digest,
    the structured content when the server gave one, and the server's own error flag."""
    blocks, total, notes = [], 0, []
    content = getattr(result, 'content', None) or []
    if len(content) > MAX_BLOCKS:
        raise ValueError('MCP result exceeds the block limit')
    for block in content:
        kind = getattr(block, 'type', None)
        if kind == 'text':
            text = str(getattr(block, 'text', ''))
            if len(text) > MAX_TEXT_BLOCK:
                text = text[:MAX_TEXT_BLOCK]
                notes.append('text_truncated')
            total += len(text)
            blocks.append({'type': 'text', 'text': text})
        elif kind == 'image':
            data = getattr(block, 'data', '')
            size = len(data) if isinstance(data, (str, bytes)) else 0
            if size > MAX_IMAGE:
                raise ValueError('MCP image exceeds the size limit')
            raw = data.encode('ascii', 'ignore') if isinstance(data, str) else bytes(data)
            blocks.append({'type': 'image', 'mime_type': str(getattr(block, 'mimeType', '') or '')[:100], 'size': size,
                           'sha256': hashlib.sha256(raw).hexdigest()})
        elif kind == 'resource':
            resource = getattr(block, 'resource', None)
            text = str(getattr(resource, 'text', '') or '')
            if len(text) > MAX_TEXT_BLOCK:
                text = text[:MAX_TEXT_BLOCK]
                notes.append('text_truncated')
            total += len(text)
            uri = str(getattr(resource, 'uri', ''))
            if len(uri) > MAX_URI:
                raise ValueError('MCP resource uri exceeds the length limit')
            blocks.append({'type': 'resource', 'uri': uri, 'text': text})
        else:
            blocks.append({'type': str(kind)[:40]})
        if total > MAX_RESULT:
            raise ValueError('MCP result exceeds the size limit')
    structured = getattr(result, 'structuredContent', None)
    if isinstance(structured, dict):
        if len(canonical(structured)) > MAX_STRUCTURED:
            structured = None
            notes.append('structured_dropped_over_limit')
    else:
        structured = None
    observation = {'server': server, 'tool': tool, 'content': blocks, 'structured': structured,
                   'is_error': bool(getattr(result, 'isError', False)),
                   'scope': 'untrusted_connector_content_not_evidence'}
    if notes:
        observation['notes'] = sorted(set(notes))
    return observation


class McpToolset:
    """Sessions to the consented servers for one mission; `tools` is the extra-tool
    mapping the engine takes."""

    def __init__(self, servers, *, connect_timeout=CONNECT_TIMEOUT, call_timeout=CALL_TIMEOUT):
        self.servers = [s for s in servers if s.get('enabled', True) and s.get('consent')]
        self.connect_timeout = connect_timeout
        self.call_timeout = call_timeout
        self.stack = AsyncExitStack()
        self.workdir = None
        self.sessions = {}
        self.tools = {}
        self.report = []

    async def __aenter__(self):
        ClientSession, StdioServerParameters, stdio_client, streamable_http_client = sdk()
        await self.stack.__aenter__()
        self.workdir = Path(tempfile.mkdtemp(prefix='arc-mcp-'))
        for server in self.servers:
            name = server['name']
            try:
                # asyncio.timeout, not wait_for: the SDK's cancel scopes must be entered and
                # left by the same task.
                async with asyncio.timeout(self.connect_timeout):
                    session = await self._connect(server, ClientSession, StdioServerParameters, stdio_client, streamable_http_client)
                    listed = await session.list_tools()
            except Exception as error:
                self.report.append({'server': name, 'ok': False, 'error': type(error).__name__ + ': ' + str(error)[:300], 'tools': []})
                continue
            self.sessions[name] = session
            offered = []
            for tool in listed.tools:
                try:
                    tool_id, spec = catalog_entry(name, tool)
                except ValueError as why:
                    offered.append({'name': tool.name, 'offered': False, 'reason': str(why)[:200]})
                    continue
                if tool_id in self.tools:
                    offered.append({'name': tool.name, 'offered': False, 'reason': 'name collides with another offered tool'})
                    continue
                self.tools[tool_id] = (spec, self._caller(name, tool.name))
                offered.append({'name': tool.name, 'offered': True, 'as': tool_id})
            self.report.append({'server': name, 'ok': True, 'tools': offered})
        return self

    async def _connect(self, server, ClientSession, StdioServerParameters, stdio_client, streamable_http_client):
        if server.get('transport') == 'http':
            import httpx
            # No proxies from the environment, no redirects; the SDK's own timeouts (30 s
            # requests, 300 s idle event stream); the settings owner already required https
            # or an exact loopback.
            client = await self.stack.enter_async_context(httpx.AsyncClient(trust_env=False, follow_redirects=False,
                                                                            timeout=httpx.Timeout(30, read=300)))
            read, write, _ = await self.stack.enter_async_context(streamable_http_client(server['url'], http_client=client))
        else:
            command = server['command']
            resolved = command if Path(command).is_absolute() else shutil.which(command)
            if not resolved:
                raise ValueError('command ' + command + ' is not on PATH')
            params = StdioServerParameters(command=resolved, args=list(server.get('args') or []), cwd=str(self.workdir))
            read, write = await self.stack.enter_async_context(stdio_client(params))
        session = await self.stack.enter_async_context(ClientSession(read, write, read_timeout_seconds=timedelta(seconds=self.call_timeout)))
        await session.initialize()
        return session

    def _caller(self, server, tool):
        async def call(arguments):
            session = self.sessions[server]
            async with asyncio.timeout(self.call_timeout):
                result = await session.call_tool(tool, dict(arguments))
            observation = bounded_result(server, tool, result)
            if observation['is_error']:
                raise ValueError('The MCP server reported an error')
            return observation
        return call

    async def __aexit__(self, *exc):
        try:
            await self.stack.__aexit__(*exc)
        finally:
            if self.workdir is not None:
                shutil.rmtree(self.workdir, ignore_errors=True)
        return False


async def inspect_servers(servers, *, connect_timeout=CONNECT_TIMEOUT):
    """The operator's connection check: connect to every enabled server, list its tools
    and say which would be offered; nothing is called and no mission data is sent."""
    async with McpToolset([{**s, 'consent': True} for s in servers if s.get('enabled', True)],
                          connect_timeout=connect_timeout) as toolset:
        return toolset.report
