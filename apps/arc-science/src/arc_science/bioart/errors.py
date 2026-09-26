"""Coded BioArt errors ({code, detail, facts}) that survive the worker and CLI boundaries.

Network work runs in child processes that report errors as text, so a BioArtError
renders as "[code {facts}] detail" and from_text() rebuilds it on the other side.
"""
import json
import re

from ..net import ProxyUnsupported

BIOART_ERROR_CODES = {
    'bioart.unreachable': 'Cannot reach bioart.niaid.nih.gov (name resolution or connection failed); '
                          'check the system proxy or VPN',
    'bioart.proxy_unsupported': 'The system proxy is not an http:// or https:// proxy',
    'bioart.drift': 'NIH changed its BioArt page; the BioArt provider needs an update',
    'bioart.action_stale': 'NIH replaced its BioArt search action',
    'bioart.timeout': 'The BioArt request did not finish within its deadline',
    'bioart.http_status': 'NIH BioArt answered with an unexpected HTTP status',
    'bioart.cache_miss': 'Nothing is cached for this request; a live NIH request needs explicit egress',
    'bioart.busy': 'Another live BioArt request is running; retry when it finishes',
    'bioart.invalid_query': 'A BioArt search can contain letters, digits, spaces, hyphens and apostrophes only',
    'bioart.file_rejected': 'The NIH file does not match the requested format or limits',
    'bioart.not_eligible': 'This BioArt source cannot be previewed or imported',
    'bioart.failed': 'The BioArt request failed',
}
# Upstream problems are gateway errors; everything else is a conflict with the request.
BIOART_ERROR_STATUS = {'bioart.unreachable': 502, 'bioart.proxy_unsupported': 502, 'bioart.drift': 502,
                       'bioart.action_stale': 502, 'bioart.http_status': 502, 'bioart.timeout': 504}
_TAG = re.compile(r'\[(bioart\.[a-z_]+)(?: (\{[^\[\]]{0,500}\}))?\] ')


class BioArtError(ValueError):
    def __init__(self, code: str, detail: str | None = None, **facts):
        if code not in BIOART_ERROR_CODES:
            raise KeyError(code)
        self.code, self.detail, self.facts = code, detail or BIOART_ERROR_CODES[code], facts
        tag = code + (' ' + json.dumps(facts, sort_keys=True, separators=(',', ':')) if facts else '')
        super().__init__(f'[{tag}] {self.detail}')


def from_text(text: str) -> ValueError:
    """Rebuild a BioArtError from its rendered text; other text stays a plain ValueError."""
    match = _TAG.search(text)
    if match and match[1] in BIOART_ERROR_CODES:
        try:
            facts = json.loads(match[2]) if match[2] else {}
        except json.JSONDecodeError:
            facts = None
        if isinstance(facts, dict):
            return BioArtError(match[1], text[match.end():], **facts)
    return ValueError(text)


def describe(error: Exception) -> dict:
    """The C1 problem body for any provider error."""
    from .client import BioArtCacheMiss
    if not isinstance(error, BioArtError) and isinstance(error, ValueError):
        rebuilt = from_text(str(error))
        error = rebuilt if isinstance(rebuilt, BioArtError) else error
    if isinstance(error, BioArtError):
        return {'code': error.code, 'detail': error.detail, 'facts': error.facts}
    text = str(error)
    lowered = text.lower()
    if isinstance(error, BioArtCacheMiss):
        code = 'bioart.cache_miss'
    elif isinstance(error, ProxyUnsupported):
        code = 'bioart.proxy_unsupported'
    elif 'timeout' in lowered:
        code = 'bioart.timeout'
    elif 'schema drift' in lowered:
        code = 'bioart.drift'
    elif 'live cache population is' in lowered:
        code = 'bioart.busy'
    elif 'not eligible' in lowered:
        code = 'bioart.not_eligible'
    else:
        code = 'bioart.failed'
    return {'code': code, 'detail': text, 'facts': {}}
