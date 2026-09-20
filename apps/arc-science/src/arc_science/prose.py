"""Prose control (loop 9 of the 2026-09-19 program): third-party AI-detection under
explicit egress consent, and a rule-based local rewrite that never touches
scientific content.

Detection reproduces the request of the reference client
(text2go/ai-humanizer-mcp-server, tool `detect`): one POST to
https://api.edgeshop.ai/rewrite/text-detection with the Copyleaks and Hemingway
detectors. The text leaves this machine, so every request needs its own consent,
the service can be switched off entirely, one request runs at a time, the response
is capped, and the audit keeps a keyed hash of the text — never the text. A
detector score is a third-party estimate; it establishes neither AI nor human
authorship, and nothing here says otherwise.

The rewrite is deterministic: a fixed, visible rule table applied only to ranges
that do not overlap protected spans (code, math, quotations, links, citations,
numbers, statistics, units, identifiers, residues, sequences, chemistry, dates,
versions, paths). The ordered protected spans of the output must equal those of the
input byte for byte, or the rewrite is refused. It is a local prose cleanup, not a
human-authorship claim, and it establishes neither semantic equivalence nor
scientific validity.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import time
from pathlib import Path

import httpx

RULES_VERSION = 'arc-prose-rules-1'
PROTECTION_VERSION = 'arc-prose-protect-2'
DETECTION_ENDPOINT = 'https://api.edgeshop.ai/rewrite/text-detection'
DETECTION_HOST = 'api.edgeshop.ai'
REFERENCE_CLIENT = 'text2go/ai-humanizer-mcp-server'
USER_AGENT = 'ai-humanizer-mcp-server/1.0'
DETECTION_TYPES = ('COPYLEAKS', 'HEMINGWAY')
MIN_CHARS, MAX_CHARS = 20, 20000
RESPONSE_CAP = 256 * 1024
TIMEOUT = 30.0
AUTHORSHIP = {'authorship_claim': 'none', 'semantic_equivalence_established': False,
              'scientific_validity_established': False}
DETECTION_NOTE = ('Third-party classifier estimate from api.edgeshop.ai; it establishes neither AI nor '
                  'human authorship and has no bearing on any release decision.')
REWRITE_NOTE = ('Rule-based local edit; not a human-authorship claim. Protected spans were preserved byte '
                'for byte; semantic equivalence and scientific validity were not established.')

# Mechanical substitutions only: nothing that changes strength, extent or domain meaning.
RULES = (
    ('opener', r'(?im)(?:^[ \t]*|(?<=[.!?] ))(?:It is (?:important|worth) (?:to note|noting) that|It should be noted that|'
               r'Needless to say,|As we all know,|In today\'s fast-changing world,|In today\'s world,|'
               r'Moreover,|Furthermore,|Additionally,|In conclusion,|To summarize,)\s+', ''),
    ('in-order-to', r'\bin order to\b', 'to'),
    ('due-to-the-fact', r'\bdue to the fact that\b', 'because'),
    ('in-the-event', r'\bin the event that\b', 'if'),
    ('at-this-point', r'\bat this point in time\b', 'now'),
    ('prior-to', r'\bprior to\b', 'before'),
    ('subsequent-to', r'\bsubsequent to\b', 'after'),
    ('utilize', r'\b(?:utilize|utilise)(s|d)?\b', r'use\1'),
    ('utilization', r'\butili[sz]ation\b', 'use'),
)
RULE_TABLE = tuple({'rule': name, 'pattern': pattern, 'replacement': replacement} for name, pattern, replacement in RULES)

UNITS = (r'%|‰|°C|°F|Å|µg/mL|mg/mL|ng/mL|mg/kg|µg/kg|µM|nM|pM|mM|M|mol|mmol|µmol|nmol|kDa|Da|bp|kb|Mb|rpm|'
         r'×g|min|hours?|h|ms|s|mL|µL|nL|L|kg|mg|µg|ng|g|nm|µm|mm|cm|km|m|s⁻¹|Hz|kHz|MHz|V|mV|eV|keV|K|Pa|kPa|'
         r'mmHg|IU|U|Gy|Sv|ppm|ppb|pH')
# Priority order: earlier classes claim their spans first.
PROTECTED = (
    ('fenced_code', r'```[\s\S]*?```'),
    ('code', r'`[^`\n]+`'),
    ('math', r'\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\([^)]*\\\)|\\\[[\s\S]*?\\\]'),
    ('table_row', r'(?m)^\|.*\|\s*$'),
    ('image', r'!\[[^\]]*\]\([^)]*\)'),
    ('link', r'\[[^\]]+\]\([^)]*\)'),
    ('url', r'(?:https?://|www\.)[^\s<>"\')\]]*[^\s<>"\')\].,;:!?]'),
    ('doi', r'\b(?:doi:\s*)?10\.\d{4,9}/[^\s"\'<>]+'),
    ('inchi', r'\bInChI=\S+'),
    ('path', r'(?<![\w/.])(?:[A-Za-z]:\\|~?/)[^\s"\'<>|]*[^\s"\'<>|.,;:!?]'),
    ('env_or_flag', r'--[a-z][a-z0-9-]*|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b'),
    ('quotation', r'"[^"\n]{1,400}"|“[^”\n]{1,400}”|«[^»\n]{1,400}»'),
    ('citation', r'\[(?:\d+(?:[-–]\d+)?(?:,\s*)?)+\]|\^\d+|\(@?[A-Z][\w-]+(?: (?:et al\.|and|&) ?[A-Z]?[\w-]*)*,? \d{4}[a-z]?(?:; ?[^()]*\d{4}[a-z]?)*\)|'
                 r'\b[A-Z][\w-]+ et al\.(?: \(?\d{4}[a-z]?\)?)?|@[A-Za-z][\w:-]+'),
    ('date', r'\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b|\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b|'
             r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4}\b'),
    ('statistic', r'\b(?:p|q|n|N|df|R²|R2|r|OR|HR|RR|CI|FDR|AUC|IC50|EC50|Kd|Ki|Km|SD|SEM|z|t|F|χ²)\s*[=<>≤≥≈]\s*[-+]?\d+(?:[.,]\d+)*(?:\s*[×x]\s*10\^?[-−]?\d+|e[-+]?\d+)?'
                  r'|\b\d{1,3}%\s*CI\b'),
    ('version', r'\bv?\d+\.\d+(?:\.\d+)+\b'),
    ('accession', r'\b(?:PMID:?\s?\d+|PMC\d+|NCT\d{8}|GSE\d+|GSM\d+|rs\d+|ENS[A-Z]*[GTP]\d{11}|N[MPRC]_\d+(?:\.\d+)?|'
                  r'[OPQ][0-9][A-Z0-9]{3}[0-9](?:-\d+)?|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2}(?:-\d+)?|'
                  r'CHEMBL\d+|CID\s?\d+|[1-9][A-Za-z0-9]{3})\b'),
    ('sequence', r'\b[ACDEFGHIKLMNPQRSTVWY]{8,}\b|\b[ACGTUN]{12,}\b'),
    ('mixed_case', r'\b[a-z]+[A-Z][A-Za-z0-9]*(?:[-/][A-Za-z0-9]+)*\b|\b[a-z]{1,3}-[A-Z][A-Za-z0-9]*(?:[-/][A-Za-z0-9]+)*\b'),
    ('symbol', r'\b[A-Za-z]+(?:\d[A-Za-z0-9]*|[α-ωΑ-Ω][A-Za-z0-9]*)[A-Za-z0-9]*(?:[-/][A-Za-z0-9α-ωΑ-Ω]+)*\+?\b|'
               r'\b[A-Z][A-Z0-9]+(?:[-/][A-Za-z0-9α-ωΑ-Ω]+)*\+?\b|\b[A-Za-z]+[α-ωΑ-Ω][A-Za-z0-9-]*\b'),
    ('chemistry', r'\b(?:[A-Z][a-z]?\d*){2,}(?:[+-]{1,2}|\d[+-])?\b|\b\d+[A-Z][a-z]?\b|→|⇌|↔'),
    ('residue', r'\b(?:[A-Z]:)?(?:Ala|Arg|Asn|Asp|Cys|Gln|Glu|Gly|His|Ile|Leu|Lys|Met|Phe|Pro|Ser|Thr|Trp|Tyr|Val|Sec|Pyl|[ACDEFGHIKLMNPQRSTVWY])-?\d+[A-Z]?(?:[-–]\d+[A-Z]?)?\b'),
    ('number', r'[-+±−]?\d+(?:,\d{3})*(?:\.\d+)?(?:\s*[×x]\s*10\^?[-−]?\d+|[eE][-+]?\d+)?(?:\s?(?:' + UNITS + r'))?(?:\s*(?:±|[-–]|to)\s*\d+(?:,\d{3})*(?:\.\d+)?)?'
               r'(?:\s?(?:' + UNITS + r'))?(?!\w)'),
)
PROTECTED_PATTERNS = tuple((name, re.compile(pattern)) for name, pattern in PROTECTED)


class ProseRefused(ValueError):
    def __init__(self, code, detail, spans=()):
        super().__init__(detail)
        self.code, self.spans = code, tuple(spans)


def protected_spans(text: str):
    """Ordered, non-overlapping (start, end, class, literal) spans; earlier classes win.
    A later match that runs into an earlier span only at its tail (a number whose unit
    an earlier class already holds, `4.2 nM`) keeps its head (`4.2`) when the head is
    still an instance of its own class, so a value is never left unprotected because
    its unit was claimed first."""
    taken = []
    spans = []
    for name, pattern in PROTECTED_PATTERNS:
        for match in pattern.finditer(text):
            start, end = match.span()
            if start == end:
                continue
            overlapping = [(s, e) for s, e in taken if start < e and s < end]
            if overlapping:
                first = min(s for s, _ in overlapping)
                if first <= start:
                    continue
                head = text[start:first].rstrip()
                if not head or not pattern.fullmatch(head):
                    continue
                end = start + len(head)
            taken.append((start, end))
            spans.append((start, end, name, text[start:end]))
    return sorted(spans)


def rewrite(text: str) -> dict:
    """Apply the rule table outside protected spans; refuse unless every protected span
    survives, in order, byte for byte."""
    if not text.strip():
        raise ProseRefused('empty', 'Nothing to rewrite')
    if len(text) > MAX_CHARS:
        raise ProseRefused('too_long', f'Text exceeds {MAX_CHARS} characters')
    before = protected_spans(text)
    protected = [(s, e) for s, e, _, _ in before]
    edits = []
    replacements = []
    for name, pattern, replacement in RULES:
        count = 0
        for match in re.finditer(pattern, text):
            start, end = match.span()
            if any(start < e and s < end for s, e in protected):
                continue
            new = match.expand(replacement)
            if new == match.group(0):
                continue
            if name == 'opener' and re.match(r'[a-z]+(?![\w/-])', text[end:]) \
                    and not any(s <= end < e for s, e in protected):
                end, new = end + 1, text[end].upper()
            replacements.append((start, end, new))
            count += 1
            if count == 1:
                edits.append({'rule': name, 'before': match.group(0).strip(), 'after': new.strip(), 'count': 0})
        if count:
            edits[-1]['count'] = count
    if not replacements:
        reason = 'all_text_protected' if before and sum(e - s for s, e in protected) >= len(text.strip()) else 'no_applicable_safe_rule'
        return {'status': 'no_change', 'reason': reason, 'text': text, 'edits': [], **_rewrite_meta(text, text, before)}
    out = text
    for start, end, new in sorted(replacements, reverse=True):
        out = out[:start] + new + out[end:]
    after = protected_spans(out)
    if [(n, lit) for _, _, n, lit in before] != [(n, lit) for _, _, n, lit in after]:
        was, now = [(n, lit) for _, _, n, lit in before], [(n, lit) for _, _, n, lit in after]
        changed = [{'change': 'missing', 'class': n, 'literal': lit} for n, lit in was if (n, lit) not in now] + \
                  [{'change': 'added', 'class': n, 'literal': lit} for n, lit in now if (n, lit) not in was]
        raise ProseRefused('preservation_failed', 'A protected span did not survive the rewrite unchanged; no output was produced',
                           changed[:20] or [{'change': 'reordered', 'class': '', 'literal': ''}])
    return {'status': 'edited', 'reason': None, 'text': out, 'edits': edits, **_rewrite_meta(text, out, before)}


def _rewrite_meta(original, out, spans):
    return {'original_sha256': hashlib.sha256(original.encode('utf-8')).hexdigest(),
            'rewritten_sha256': hashlib.sha256(out.encode('utf-8')).hexdigest(),
            'rules_version': RULES_VERSION, 'protection_version': PROTECTION_VERSION,
            'protected_count': len(spans), 'protected_classes': sorted({n for _, _, n, _ in spans}),
            'statement': REWRITE_NOTE, **AUTHORSHIP}


class Detector:
    """One bounded, consented request at a time to the reference client's endpoint."""

    def __init__(self, root: Path, *, enabled: bool | None = None, transport=None):
        self.root = Path(root) / 'prose'
        self.enabled = (os.environ.get('ARC_PROSE_DETECTION', 'on').lower() != 'off') if enabled is None else enabled
        self.transport = transport
        self.busy = False

    def capabilities(self) -> dict:
        return {'detection': {'enabled': self.enabled, 'recipient': DETECTION_HOST, 'endpoint': DETECTION_ENDPOINT,
                              'reference_client': REFERENCE_CLIENT, 'detectors': list(DETECTION_TYPES),
                              'consent': 'allow_egress: true on every request; the text leaves this machine',
                              'bounds': {'min_chars': MIN_CHARS, 'max_chars': MAX_CHARS, 'response_cap_bytes': RESPONSE_CAP},
                              'live_contract': 'unverified: the response shape is normalised from the reference client types',
                              'note': DETECTION_NOTE},
                'rewrite': {'rules_version': RULES_VERSION, 'protection_version': PROTECTION_VERSION,
                            'rules': len(RULES), 'egress': False, 'note': REWRITE_NOTE}}

    def _key(self) -> bytes:
        """The audit key: created exclusively (never through a link) with mode 0600 and read
        without following links; a key that is not exactly 32 bytes is refused. Like the
        service token file, no Windows owner-only ACL is applied beyond the mode."""
        from . import anchored
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        handle = anchored.open_directory(self.root)
        try:
            try:
                fd = anchored.open_write_new_fd(handle, 'audit.key', 0o600)
            except FileExistsError:
                pass
            else:
                with os.fdopen(fd, 'wb') as out:
                    out.write(secrets.token_bytes(32))
            with os.fdopen(anchored.open_read_fd(handle, 'audit.key'), 'rb') as source:
                key = source.read(64)
        finally:
            anchored.close_directory(handle)
        if len(key) != 32:
            raise ProseRefused('audit_key', 'The prose audit key is not a 32-byte file; detection refused')
        return key

    def _audit(self, record: dict) -> None:
        with (self.root / 'detections.jsonl').open('a', encoding='utf-8') as handle:
            handle.write(json.dumps(record, sort_keys=True) + '\n')

    async def detect(self, text: str, *, allow_egress: bool) -> dict:
        if not self.enabled:
            raise ProseRefused('disabled', 'Detection is switched off on this service (ARC_PROSE_DETECTION=off)')
        if not allow_egress:
            raise ProseRefused('consent_required', 'The text would leave this machine for ' + DETECTION_HOST +
                               '; send allow_egress: true to consent to this one request')
        if not MIN_CHARS <= len(text) <= MAX_CHARS:
            raise ProseRefused('bounds', f'Text must be {MIN_CHARS} to {MAX_CHARS} characters')
        if self.busy:
            raise ProseRefused('busy', 'A detection request is already in flight')
        self.busy = True
        try:
            return await self._detect(text)
        finally:
            self.busy = False

    async def _detect(self, text: str) -> dict:
        digest = hashlib.sha256(text.encode('utf-8')).hexdigest()
        keyed = hmac.new(self._key(), text.encode('utf-8'), 'sha256').hexdigest()
        at = int(time.time())
        # The attempt is on record before any byte leaves, so a crash cannot erase it.
        self._audit({'at': at, 'text_hmac': keyed, 'chars': len(text), 'recipient': DETECTION_HOST, 'status': 'attempted'})
        body = {'type': 'original_text', 'text': text, 'detectionTypeList': list(DETECTION_TYPES)}
        headers = {'User-Agent': USER_AGENT, 'Accept': 'application/json', 'Content-Type': 'application/json'}
        receipt = {'service': DETECTION_HOST, 'endpoint': DETECTION_ENDPOINT, 'reference_client': REFERENCE_CLIENT,
                   'requested_types': list(DETECTION_TYPES), 'text_sha256': digest, 'at': at,
                   'note': DETECTION_NOTE, **AUTHORSHIP}
        try:
            async with httpx.AsyncClient(trust_env=False, follow_redirects=False, timeout=TIMEOUT, transport=self.transport) as client:
                async with client.stream('POST', DETECTION_ENDPOINT, json=body, headers=headers) as response:
                    status = response.status_code
                    raw = bytearray()
                    async for chunk in response.aiter_bytes():
                        raw.extend(chunk)
                        if len(raw) > RESPONSE_CAP:
                            raise ProseRefused('provider_rejected', 'Detection response exceeded the size cap')
        except ProseRefused as refused:
            self._audit({'at': int(time.time()), 'text_hmac': keyed, 'status': refused.code})
            raise
        except httpx.TimeoutException:
            self._audit({'at': int(time.time()), 'text_hmac': keyed, 'status': 'timeout'})
            raise ProseRefused('timeout', 'The detection service did not answer within the deadline') from None
        except httpx.HTTPError:
            self._audit({'at': int(time.time()), 'text_hmac': keyed, 'status': 'network'})
            raise ProseRefused('network', 'The detection service could not be reached') from None
        if status != 200:
            self._audit({'at': int(time.time()), 'text_hmac': keyed, 'status': f'http_{status}'})
            raise ProseRefused(f'http_{status}', f'The detection service answered HTTP {status}')
        try:
            results = normalise(json.loads(bytes(raw).decode('utf-8')))
        except (ValueError, TypeError):
            self._audit({'at': int(time.time()), 'text_hmac': keyed, 'status': 'provider_rejected'})
            raise ProseRefused('provider_rejected', 'The detection service answered in an unrecognised shape') from None
        returned = [item['detectionType'] for item in results]
        receipt.update({'results': {item['detectionType']: item['detectionResult'] for item in results},
                        'returned_types': returned, 'missing_types': [t for t in DETECTION_TYPES if t not in returned],
                        'complete': all(t in returned for t in DETECTION_TYPES),
                        'response_sha256': hashlib.sha256(bytes(raw)).hexdigest(), 'status': 'ok'})
        self._audit({'at': int(time.time()), 'text_hmac': keyed, 'status': 'ok', 'returned_types': returned,
                     'response_sha256': receipt['response_sha256']})
        return receipt


def normalise(payload) -> list[dict]:
    """Accept the reference client's object, an array of them, or an object wrapping such
    an array; anything else is a rejected shape."""
    if isinstance(payload, dict) and 'detectionType' not in payload:
        for key in ('results', 'data', 'items', 'detections'):
            if isinstance(payload.get(key), (list, dict)):
                payload = payload[key]
                break
    items = payload if isinstance(payload, list) else [payload]
    out = []
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get('detectionType'), str) \
                or not isinstance(item.get('detectionResult'), dict):
            raise ValueError('unrecognised detection item')
        result = {str(k)[:64]: (str(v)[:2000] if not isinstance(v, (int, float, bool)) else v)
                  for k, v in item['detectionResult'].items() if k != 'text'}
        out.append({'detectionType': item['detectionType'][:32], 'detectionResult': result})
    if not out:
        raise ValueError('no detection items')
    return out
