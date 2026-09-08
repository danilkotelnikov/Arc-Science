"""Constrained BioRender Streamable HTTP client.

The client implements the legacy 2025-11-25 initialization flow and an explicitly
selected 2026-07-28 request/response subset. It is not a general MCP SDK and does
not implement elicitation or Tasks.
"""
from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
import inspect
import json
import re
from typing import Mapping

import httpx
import jsonschema

from . import __version__
from .contracts import canonical, digest


BIORENDER_ENDPOINT = "https://mcp.services.biorender.com/mcp"
LEGACY_PROTOCOL = "2025-11-25"
MODERN_PROTOCOL = "2026-07-28"
SELECTABLE_PROTOCOLS = frozenset({LEGACY_PROTOCOL, MODERN_PROTOCOL})
NEGOTIABLE_LEGACY_PROTOCOLS = frozenset({LEGACY_PROTOCOL, "2025-06-18"})
READ_TOOLS = frozenset({"search-biorender", "search-icons", "search-templates",
                        "custom-figure-get-preview-job"})
# Fetching a completed session can finalize the provider's credit handshake.
METERED_TOOLS = frozenset({"custom-figure-create-session", "custom-figure-get-session"})
_TCHAR = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
_BASE64_SENTINEL = re.compile(r"^=\?base64\?.*\?=$")
_MAX_SAFE_INTEGER = 2**53 - 1


class MCPError(RuntimeError):
    pass


@dataclass(frozen=True)
class ActionApproval:
    """Issued by the trusted approval service, never deserialized from model output."""

    principal: str
    project_id: str
    tool: str
    arguments_digest: str
    expires_at: int
    approval_id: str


def _external_refs(value) -> None:
    if isinstance(value, dict):
        if "$ref" in value and not str(value["$ref"]).startswith("#"):
            raise MCPError("External schema ref forbidden")
        for child in value.values():
            _external_refs(child)
    elif isinstance(value, list):
        for child in value:
            _external_refs(child)


def _contains_header_annotation(value) -> bool:
    if isinstance(value, dict):
        return "x-mcp-header" in value or any(_contains_header_annotation(child) for child in value.values())
    if isinstance(value, list):
        return any(_contains_header_annotation(child) for child in value)
    return False


def _header_annotations(schema: dict) -> tuple[tuple[tuple[str, ...], str, str], ...]:
    """Validate and return statically reachable modern header annotations."""
    found: list[tuple[tuple[str, ...], str, str]] = []

    def walk(node, path=(), property_path=True):
        if not isinstance(node, dict):
            if isinstance(node, list):
                for child in node:
                    walk(child, path, False)
            return
        annotation = node.get("x-mcp-header")
        if annotation is not None:
            kind = node.get("type")
            if (not property_path or not path or not isinstance(annotation, str) or not _TCHAR.fullmatch(annotation)
                    or kind not in {"string", "integer", "boolean"}):
                raise MCPError("Invalid x-mcp-header annotation")
            found.append((path, annotation, kind))
        properties = node.get("properties", {})
        if properties is not None and not isinstance(properties, dict):
            raise MCPError("Invalid tool schema properties")
        for name, child in properties.items():
            if not isinstance(name, str):
                raise MCPError("Invalid tool schema property")
            walk(child, path + (name,), property_path)
        # Inspect every other schema branch, but none can establish a static argument path.
        for key, child in node.items():
            if key not in {"properties", "x-mcp-header"}:
                walk(child, path, False)

    walk(schema)
    names = [name.casefold() for _, name, _ in found]
    if len(names) != len(set(names)):
        raise MCPError("Duplicate x-mcp-header annotation")
    return tuple(found)


def _header_value(value, kind: str) -> str:
    if kind == "boolean":
        if not isinstance(value, bool):
            raise MCPError("Annotated boolean argument has wrong type")
        return "true" if value else "false"
    if kind == "integer":
        if isinstance(value, bool) or not isinstance(value, int) or abs(value) > _MAX_SAFE_INTEGER:
            raise MCPError("Annotated integer argument is outside the safe range")
        return str(value)
    if not isinstance(value, str):
        raise MCPError("Annotated string argument has wrong type")
    plain = (bool(value) and value == value.strip(" \t") and
             all(character == "\t" or 0x20 <= ord(character) <= 0x7e for character in value) and
             not _BASE64_SENTINEL.fullmatch(value))
    if plain:
        return value
    encoded = base64.b64encode(value.encode("utf-8")).decode("ascii")
    return f"=?base64?{encoded}?="


def _argument_headers(schema: dict, arguments: Mapping[str, object]) -> dict[str, str]:
    headers = {}
    for path, name, kind in _header_annotations(schema):
        value: object = arguments
        present = True
        for part in path:
            if not isinstance(value, Mapping) or part not in value:
                present = False
                break
            value = value[part]
        if present and value is not None:
            headers["Mcp-Param-" + name] = _header_value(value, kind)
    return headers


class BioRenderClient:
    def __init__(self, *, client: httpx.AsyncClient, grant_resolver, principal: str,
                 project_id: str, credential_ref: str, protocol: str = LEGACY_PROTOCOL,
                 timeout: float = 30, max_response_bytes: int = 8 * 1024 * 1024):
        if protocol not in SELECTABLE_PROTOCOLS:
            raise ValueError("Unsupported configured MCP protocol")
        if timeout <= 0 or not 1 <= max_response_bytes <= 16 * 1024 * 1024:
            raise ValueError("Invalid MCP limits")
        self.client = client
        self.resolve = grant_resolver
        self.principal = principal
        self.project = project_id
        self.ref = credential_ref
        self.timeout = timeout
        self.limit = max_response_bytes
        self.endpoint = BIORENDER_ENDPOINT
        self.selected_protocol = protocol
        self.protocol = protocol if protocol == MODERN_PROTOCOL else None
        self.session = None
        self.counter = 0
        self.schemas: dict[str, dict] = {}
        self.schema_digest = None
        self.dirty = False
        self.used_approvals = set()
        self.lock = asyncio.Lock()

    def _modern_meta(self) -> dict:
        return {
            "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL,
            "io.modelcontextprotocol/clientInfo": {"name": "ArcScience", "version": __version__},
            "io.modelcontextprotocol/clientCapabilities": {},
        }

    async def _rpc(self, method: str, params: dict, *, now: int, notification: bool = False):
        grant = self.resolve(self.ref, self.principal, self.project)
        if inspect.isawaitable(grant):
            grant = await grant
        headers = grant.require(principal=self.principal, project_id=self.project,
                                resource=self.endpoint, credential_ref=self.ref, now=now)
        headers.update({"Content-Type": "application/json",
                        "Accept": "application/json, text/event-stream"})
        wire_params = dict(params)
        if self.selected_protocol == MODERN_PROTOCOL:
            if notification:
                raise MCPError("Modern notifications are outside this client subset")
            wire_params["_meta"] = self._modern_meta()
            headers.update({"MCP-Protocol-Version": MODERN_PROTOCOL, "Mcp-Method": method})
            if method == "tools/call":
                name = wire_params.get("name")
                arguments = wire_params.get("arguments")
                if not isinstance(name, str) or not isinstance(arguments, Mapping) or name not in self.schemas:
                    raise MCPError("Invalid modern tool call metadata")
                headers["Mcp-Name"] = name
                headers.update(_argument_headers(self.schemas[name], arguments))
        else:
            if self.session:
                headers["Mcp-Session-Id"] = self.session
            if self.protocol:
                headers["MCP-Protocol-Version"] = self.protocol
        self.counter += 1
        call_id = self.counter
        body = {"jsonrpc": "2.0", "method": method, "params": wire_params}
        if not notification:
            body["id"] = call_id
        try:
            async with asyncio.timeout(self.timeout):
                async with self.client.stream("POST", self.endpoint, json=body, headers=headers,
                                              timeout=self.timeout, follow_redirects=False) as response:
                    if response.status_code not in ({200, 202, 204} if notification else {200}):
                        raise MCPError("MCP HTTP status " + str(response.status_code))
                    token = response.headers.get("Mcp-Session-Id")
                    if token and self.selected_protocol != MODERN_PROTOCOL:
                        if len(token) > 512 or any(ord(character) < 32 for character in token):
                            raise MCPError("Invalid session ID")
                        if self.session and token != self.session:
                            raise MCPError("Unexpected session change")
                        self.session = token
                    chunks = []
                    total = 0
                    async for chunk in response.aiter_bytes():
                        total += len(chunk)
                        if total > self.limit:
                            raise MCPError("MCP response size exceeded")
                        chunks.append(chunk)
                    mime = response.headers.get("Content-Type", "").split(";")[0]
            if notification:
                return None
            text = b"".join(chunks).decode("utf-8")
            if mime == "text/event-stream":
                messages = []
                for frame in text.replace("\r\n", "\n").split("\n\n"):
                    data = "\n".join(line[5:].lstrip() for line in frame.splitlines()
                                     if line.startswith("data:"))
                    if data:
                        messages.append(json.loads(data))
            elif mime == "application/json":
                messages = [json.loads(text)]
            else:
                raise MCPError("Unsupported MCP response media type")
            matching = []
            for message in messages:
                if not isinstance(message, dict):
                    raise MCPError("Invalid JSON-RPC message")
                if message.get("method") == "notifications/tools/list_changed":
                    self.dirty = True
                if message.get("id") == call_id:
                    matching.append(message)
            if len(matching) != 1 or matching[0].get("jsonrpc") != "2.0":
                raise MCPError("Invalid JSON-RPC correlation")
            reply = matching[0]
            if "error" in reply or not isinstance(reply.get("result"), dict):
                raise MCPError("MCP server error")
            return reply["result"]
        except MCPError:
            raise
        except Exception:
            raise MCPError("MCP transport or response validation failed") from None

    @staticmethod
    def _validate_modern_cache_result(result: dict, *, tools: bool = False) -> None:
        if (result.get("resultType") != "complete" or
                not isinstance(result.get("ttlMs"), (int, float)) or
                isinstance(result.get("ttlMs"), bool) or result["ttlMs"] < 0 or
                result.get("cacheScope") not in {"public", "private"}):
            raise MCPError("Invalid modern MCP cache result")
        if tools and not isinstance(result.get("tools"), list):
            raise MCPError("Invalid modern tools/list result")

    def _validate_tool_result(self, result: dict) -> None:
        result_type = result.get("resultType")
        if result_type in {"input_required", "task"}:
            raise MCPError("MCP result extension is unsupported")
        if result_type not in {None, "complete"}:
            raise MCPError("Unknown MCP tool result type")
        if "isError" in result and type(result["isError"]) is not bool:
            raise MCPError("Invalid MCP tool result error flag")
        content = result.get("content")
        if not isinstance(content, list) or len(content) > 64:
            raise MCPError("Invalid MCP tool result content")
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "text":
                raise MCPError("Unsupported MCP tool result content block")
            text = block.get("text")
            if not isinstance(text, str) or len(text.encode("utf-8")) > self.limit:
                raise MCPError("Invalid MCP tool result text block")
            if "annotations" in block and not isinstance(block["annotations"], dict):
                raise MCPError("Invalid MCP tool result annotations")
            if "_meta" in block and not isinstance(block["_meta"], dict):
                raise MCPError("Invalid MCP tool result metadata")
        if "structuredContent" in result:
            try:
                structured = canonical(result["structuredContent"])
            except Exception:
                raise MCPError("Invalid MCP structured tool result") from None
            if len(structured) > self.limit:
                raise MCPError("MCP structured tool result exceeds size limit")

    async def discover(self, *, now: int) -> str:
        async with self.lock:
            if self.selected_protocol == MODERN_PROTOCOL:
                result = await self._rpc("server/discover", {}, now=now)
                self._validate_modern_cache_result(result)
                versions = result.get("supportedVersions")
                if (not isinstance(versions, list) or not 1 <= len(versions) <= 64 or
                        any(not isinstance(version, str) or not 1 <= len(version) <= 64
                            for version in versions) or MODERN_PROTOCOL not in versions or
                        not isinstance(result.get("capabilities"), dict)):
                    raise MCPError("Invalid modern discovery result")
            elif self.protocol is None:
                result = await self._rpc("initialize", {
                    "protocolVersion": LEGACY_PROTOCOL,
                    "capabilities": {},
                    "clientInfo": {"name": "ArcScience", "version": __version__},
                }, now=now)
                if result.get("protocolVersion") not in NEGOTIABLE_LEGACY_PROTOCOLS:
                    raise MCPError("Unsupported negotiated protocol")
                self.protocol = result["protocolVersion"]
                await self._rpc("notifications/initialized", {}, now=now, notification=True)
            schemas = {}
            cursor = None
            seen = set()
            for _ in range(16):
                result = await self._rpc("tools/list", {"cursor": cursor} if cursor else {}, now=now)
                if self.selected_protocol == MODERN_PROTOCOL:
                    self._validate_modern_cache_result(result, tools=True)
                listed = result.get("tools")
                if not isinstance(listed, list) or len(listed) > 256:
                    raise MCPError("Invalid tools/list result")
                for tool in listed:
                    if not isinstance(tool, dict):
                        raise MCPError("Invalid tool definition")
                    name = tool.get("name")
                    schema = tool.get("inputSchema")
                    if (not isinstance(name, str) or not 1 <= len(name) <= 128 or name in schemas or
                            not isinstance(schema, dict) or schema.get("type") != "object"):
                        raise MCPError("Invalid or duplicate tool definition")
                    try:
                        jsonschema.Draft202012Validator.check_schema(schema)
                        _external_refs(schema)
                        _header_annotations(schema)
                    except MCPError:
                        if _contains_header_annotation(schema):
                            continue
                        raise
                    except Exception:
                        raise MCPError("Invalid tool schema") from None
                    schemas[name] = schema
                cursor = result.get("nextCursor")
                if not cursor:
                    break
                if not isinstance(cursor, str) or len(cursor) > 2048 or cursor in seen:
                    raise MCPError("Invalid or cyclic discovery cursor")
                seen.add(cursor)
            else:
                raise MCPError("Tool discovery pagination limit exceeded")
            if not schemas:
                raise MCPError("No usable tools discovered")
            self.schemas = schemas
            self.schema_digest = digest(schemas)
            self.dirty = False
            return self.schema_digest

    async def call(self, tool: str, arguments: dict, *, schema_digest: str, now: int,
                   approval: ActionApproval | None = None) -> dict:
        async with self.lock:
            if self.dirty or not self.schema_digest or schema_digest != self.schema_digest:
                raise MCPError("Tool schemas need explicit review and pinning")
            if tool not in self.schemas or tool not in READ_TOOLS | METERED_TOOLS:
                raise MCPError("Tool is not permitted")
            try:
                jsonschema.Draft202012Validator(self.schemas[tool]).validate(arguments)
            except Exception:
                raise MCPError("Arguments do not match the pinned schema") from None
            if tool in METERED_TOOLS:
                expected = (self.principal, self.project, tool, digest(arguments))
                actual = None if approval is None else (
                    approval.principal, approval.project_id, approval.tool, approval.arguments_digest)
                if (actual != expected or approval.expires_at <= now or
                        approval.approval_id in self.used_approvals):
                    raise MCPError("An unused, action-specific approval is required")
                self.used_approvals.add(approval.approval_id)
            result = await self._rpc("tools/call", {"name": tool, "arguments": arguments}, now=now)
            self._validate_tool_result(result)
            if result.get("isError"):
                raise MCPError("BioRender tool reported failure")
            return {
                "untrusted_content": result,
                "provenance": {
                    "endpoint": self.endpoint,
                    "tool": tool,
                    "schema_digest": schema_digest,
                    "protocol": self.protocol,
                    "arguments_digest": digest(arguments),
                    "principal": self.principal,
                    "project_id": self.project,
                    "retrieved_at": now,
                    "licence_status": "requires_asset_specific_verification",
                },
            }
