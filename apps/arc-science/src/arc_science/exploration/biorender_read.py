"""Trusted public-template BioRender adapter for exploratory missions."""
from __future__ import annotations

import json
import os
from pathlib import Path
import time
from typing import Mapping
from urllib.parse import urlsplit
import uuid

import httpx
from jsonschema import Draft202012Validator

from ..biorender import (BIORENDER_ENDPOINT, BioRenderClient, LEGACY_PROTOCOL,
                         SELECTABLE_PROTOCOLS)
from ..contracts import canonical
from ..transport import AccessGrant
from .catalog import BIORENDER_CATALOG, TrustedPublicTools, validate_arguments


CATALOG = BIORENDER_CATALOG
SEARCH_TOOL = "search-biorender"
MISSION_TOOL = "biorender_search"
MAX_RESULTS = 8
MAX_PROVIDER_RESULTS = 100
MAX_RESULT_BYTES = 512 * 1024


def _valid_digest(value: object) -> bool:
    return (isinstance(value, str) and len(value) == 64 and
            all(character in "0123456789abcdef" for character in value))


def _provider_payload(result: Mapping[str, object]) -> dict:
    content = result.get("untrusted_content")
    if not isinstance(content, Mapping):
        raise ValueError("Invalid BioRender provider result")
    structured = content.get("structuredContent")
    if structured is None:
        blocks = content.get("content")
        if not isinstance(blocks, list) or len(blocks) > 16:
            raise ValueError("Invalid BioRender provider content")
        candidates = []
        for block in blocks:
            if not isinstance(block, Mapping) or block.get("type") != "text":
                continue
            text = block.get("text")
            if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_RESULT_BYTES:
                raise ValueError("Invalid BioRender provider text")
            try:
                decoded = json.loads(text)
            except (TypeError, ValueError):
                continue
            if isinstance(decoded, dict):
                candidates.append(decoded)
        if len(candidates) != 1:
            raise ValueError("Invalid BioRender provider JSON")
        structured = candidates[0]
    if not isinstance(structured, dict) or len(canonical(structured)) > MAX_RESULT_BYTES:
        raise ValueError("Invalid or oversized BioRender provider result")
    return structured


def _template_snapshot(result: Mapping[str, object], *, query: str,
                       schema_digest: str, protocol: str) -> dict:
    payload = _provider_payload(result)
    if payload.get("query") != query:
        raise ValueError("BioRender response query mismatch")
    files = payload.get("files", [])
    templates = payload.get("templates")
    if files not in (None, []) or not isinstance(templates, list) or len(templates) > MAX_PROVIDER_RESULTS:
        raise ValueError("Invalid BioRender public-template response")
    snapshots = []
    seen = set()
    for item in templates:
        if not isinstance(item, Mapping) or item.get("kind") != "template":
            raise ValueError("Invalid BioRender template result")
        template_id = item.get("templateId")
        title = item.get("title")
        detail_url = item.get("detailUrl")
        if (not isinstance(template_id, str) or not 1 <= len(template_id) <= 160 or
                not isinstance(title, str) or not 1 <= len(title) <= 500 or
                not isinstance(detail_url, str) or not 1 <= len(detail_url) <= 2000 or
                any(ord(character) < 32 for character in template_id + title + detail_url)):
            raise ValueError("Invalid BioRender template fields")
        parsed = urlsplit(detail_url)
        hostname = (parsed.hostname or "").lower()
        try:port=parsed.port
        except ValueError:port=-1
        if ("\\" in detail_url or any(character.isspace() for character in detail_url) or
                parsed.scheme != "https" or parsed.username is not None or parsed.password is not None or
                port is not None or not hostname.isascii() or parsed.netloc.casefold() != hostname or
                not (hostname == "biorender.com" or hostname.endswith(".biorender.com"))):
            raise ValueError("Invalid BioRender template link")
        if template_id in seen:
            raise ValueError("Duplicate BioRender template ID")
        seen.add(template_id)
        if len(snapshots) < MAX_RESULTS:
            snapshots.append({"template_id": template_id, "title": title, "detail_url": detail_url})
    return {
        "query": query,
        "templates": snapshots,
        "schema_digest": schema_digest,
        "protocol": protocol,
        "licence_status": "requires_asset_specific_verification",
        "scope": "public_template_metadata_snapshot_untrusted",
    }


async def biorender_tools(provider: BioRenderClient, *, schema_digest: str,
                           now: int | None = None, search_session_factory=None) -> TrustedPublicTools:
    """Discover and pin the provider before publishing one query-only mission tool."""
    if not _valid_digest(schema_digest):
        raise ValueError("A valid BioRender schema digest pin is required")
    discovered = await provider.discover(now=int(time.time()) if now is None else now)
    if discovered != schema_digest:
        raise ValueError("BioRender schema digest does not match the configured pin")
    provider_schema = provider.schemas.get(SEARCH_TOOL)
    if not isinstance(provider_schema, dict):
        raise ValueError("Pinned BioRender catalog does not contain the search tool")
    sample = {"analytics": {"searchSessionId": "schema-check"}, "query": "x",
              "includeThumbnails": False, "perPage": MAX_RESULTS, "sources": ["templates"]}
    try:
        Draft202012Validator(provider_schema).validate(sample)
    except Exception:
        raise ValueError("Pinned BioRender search schema cannot enforce the public-template request") from None
    make_session = search_session_factory or (lambda: uuid.uuid4().hex)

    async def search(arguments):
        validate_arguments(MISSION_TOOL, arguments, BIORENDER_CATALOG)
        session_id = make_session()
        if (not isinstance(session_id, str) or not 1 <= len(session_id) <= 160 or
                any(ord(character) < 33 or ord(character) > 126 for character in session_id)):
            raise ValueError("Invalid server-generated BioRender search session")
        call_now = int(time.time()) if now is None else now
        provider_arguments = {
            "analytics": {"searchSessionId": session_id},
            "query": arguments["query"],
            "includeThumbnails": False,
            "perPage": MAX_RESULTS,
            "sources": ["templates"],
        }
        result = await provider.call(SEARCH_TOOL, provider_arguments,
                                     schema_digest=schema_digest, now=call_now)
        provenance = result.get("provenance") if isinstance(result, Mapping) else None
        protocol = getattr(provider, "protocol", None)
        if (not isinstance(provenance, Mapping) or provenance.get("schema_digest") != schema_digest or
                provenance.get("protocol") != protocol or not isinstance(protocol, str)):
            raise ValueError("BioRender provenance does not match the pinned connection")
        return _template_snapshot(result, query=arguments["query"],
                                  schema_digest=schema_digest, protocol=protocol)

    return TrustedPublicTools({MISSION_TOOL: (BIORENDER_CATALOG[MISSION_TOOL], search)})


async def discover_biorender() -> dict:
    """Return a credential-free JSON-safe view of the validated provider contract."""
    token_path = os.environ.get("ARC_BIORENDER_TOKEN_FILE")
    protocol = os.environ.get("ARC_BIORENDER_PROTOCOL") or LEGACY_PROTOCOL
    if protocol not in SELECTABLE_PROTOCOLS:
        raise ValueError("Unsupported ARC_BIORENDER_PROTOCOL")
    if not token_path:
        raise ValueError("ARC_BIORENDER_TOKEN_FILE is required for discovery")
    token = Path(token_path).read_text(encoding="utf-8").strip()
    if not token or len(token) > 8192:
        raise ValueError("BioRender token file is empty or exceeds limit")
    now = int(time.time())
    grant = AccessGrant(token=token, principal="local-operator", project_id="biorender-discovery",
                        resource=BIORENDER_ENDPOINT, credential_ref="biorender",
                        expires_at=now + 60)
    async with httpx.AsyncClient(trust_env=False) as client:
        provider = BioRenderClient(client=client, grant_resolver=lambda *_: grant,
                                   principal="local-operator", project_id="biorender-discovery",
                                   credential_ref="biorender", protocol=protocol)
        schema_digest = await provider.discover(now=now)
    return {
        "schema_digest": schema_digest,
        "protocol": provider.protocol,
        "catalog": {name: {"input_schema": schema} for name, schema in sorted(provider.schemas.items())},
        "schema_source": "provider_supplied_untrusted_review_required",
        "live_qualified": False,
    }
