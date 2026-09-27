"""Decode bounded Next Flight JSON as data; never evaluate JavaScript."""
from html.parser import HTMLParser
import json
import re

from .errors import BioArtError
from .models import BioArtEntry, BioArtRepresentation, BioArtSearchHit, positive_id


def _drift(detail='BioArt schema drift: required metadata missing or inconsistent; use inspect with an entry ID or search --search-html with an operator-supplied browser DOM snapshot'):
    return BioArtError('bioart.drift', detail)


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise _drift()
        result[key] = value
    return result


class _HTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.scripts = []; self.script = None; self.anchor = None; self.links = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script': self.script = []
        if tag == 'a': self.anchor = [attrs.get('href',''), [], '']
        if tag == 'img' and self.anchor is not None: self.anchor[2] = attrs.get('alt','')

    def handle_data(self, data):
        if self.script is not None: self.script.append(data)
        if self.anchor is not None: self.anchor[1].append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self.script is not None:
            self.scripts.append(''.join(self.script)); self.script = None
        if tag == 'a' and self.anchor is not None:
            self.links.append((self.anchor[0], self.anchor[2] or ''.join(self.anchor[1])))
            self.anchor = None


def _html(html):
    if not isinstance(html,str) or len(html.encode('utf-8')) > 64*1024**2:
        raise _drift()
    parser = _HTML(); parser.feed(html)
    return parser


def _walk(root):
    stack = [(root,0)]; count = 0
    while stack:
        value, depth = stack.pop(); count += 1
        if count > 250000 or depth > 128: raise _drift()
        yield value
        if isinstance(value,dict): stack.extend((v,depth+1) for v in reversed(list(value.values())))
        elif isinstance(value,list): stack.extend((v,depth+1) for v in reversed(value))


def _flight(parser):
    decoder = json.JSONDecoder(object_pairs_hook=_pairs)
    chunks = []
    try:
        for script in parser.scripts:
            for match in re.finditer(r'self\.__next_f\.push\(', script):
                payload, end = decoder.raw_decode(script, match.end())
                if script[end:end+1] != ')' or not isinstance(payload,list): raise _drift()
                if len(payload) == 2 and payload[0] == 1 and isinstance(payload[1],str):
                    chunks.append(payload[1])
        roots = []
        for row in ''.join(chunks).splitlines():
            match = re.match(r'^[0-9a-f]+:(.*)$',row)
            if not match: continue
            data = match[1]
            if data.startswith(('[','{')): roots.append(decoder.decode(data))
        return list(_walk(roots))
    except (json.JSONDecodeError, RecursionError, TypeError):
        raise _drift() from None


def _text(value):
    if isinstance(value,str): return value
    if type(value) is int: return str(value)
    if isinstance(value,dict): return _text(value.get('children',''))
    if isinstance(value,list):
        if len(value)==4 and value[0]=='$': return _text(value[3])
        return ''.join(_text(v) for v in value)
    return ''


def _required(value):
    if not isinstance(value,str) or not value.strip() or len(value)>4000 or any(ord(c)<32 for c in value): raise _drift()
    return value.strip()


def parse_entry(html: str, entry_id: int) -> BioArtEntry:
    positive_id(entry_id)
    nodes = _flight(_html(html)); objects = [n for n in nodes if isinstance(n,dict)]
    identities = {int(n.removeprefix('BIOART-')) for n in nodes if isinstance(n,str) and re.fullmatch(r'BIOART-[0-9]+',n)}
    if identities != {entry_id}: raise _drift()
    def unique(values):
        values = list(values)
        if not values or any(v!=values[0] for v in values): raise _drift()
        return values[0]
    title = unique(o['children'] for o in objects if o.get('variant')=='h4' and isinstance(o.get('children'),str))
    def labelled(label, optional=False):
        found = []
        for obj in objects:
            children = obj.get('children')
            if isinstance(children,list) and len(children)==2 and _text(children[0]).strip()==label:
                found.append(_text(children[1]))
        if optional and not found: return None
        return _required(unique(found))
    license_text = labelled('Licensing:')
    mapping = unique(o['filemapping'] for o in objects if 'filemapping' in o)
    carousel = unique(o['carouselItems'] for o in objects if isinstance(o.get('carouselItems'),list))
    if not isinstance(mapping,dict) or not 0<len(mapping)<=1000 or not carousel: raise _drift()
    representations = []; used_files = set(); used_groups = set()
    try:
        for item in carousel:
            group = positive_id(item['bioartFileGroupId']); file_id = positive_id(item['fileId'])
            if group in used_groups: raise _drift()
            used_groups.add(group)
            files = mapping[str(group)]
            if not isinstance(files,dict) or not files or set(files)-{'AI','EPS','PNG','SVG'}: raise _drift()
            for fid in files.values():
                positive_id(fid)
                if fid in used_files: raise _drift()
                used_files.add(fid)
            if item['srcImg'] != f'/api/bioarts/{entry_id}/files/{file_id}': raise _drift()
            preview = None
            if item['fileFormat'] in files:
                if files[item['fileFormat']] != file_id: raise _drift()
            elif item['fileFormat'] == 'JPG' and file_id not in used_files:
                # NIH shows a JPG it does not offer for download (entry 300): preview only.
                preview = file_id; used_files.add(file_id)
            else: raise _drift()
            representations.append(BioArtRepresentation(group,_required(item['caption']),dict(files),preview))
        if set(mapping) != {str(g) for g in used_groups}: raise _drift()
    except (KeyError,TypeError,ValueError): raise _drift() from None
    # Newer entries (700, June 2026) carry no Credit line.
    return BioArtEntry(entry_id,_required(title),license_text,labelled('Credit',optional=True),labelled('Creator'),
        labelled('Collection'),labelled('Cite This Entry'),tuple(representations))


def parse_search(html: str) -> tuple[BioArtSearchHit, ...]:
    parser = _html(html); links = list(parser.links)
    for node in _flight(parser):
        if isinstance(node,dict) and isinstance(node.get('href'),str):
            links.append((node['href'],_text(node)))
    found = {}
    for href,title in links:
        match = re.fullmatch(r'/bioart/([1-9][0-9]*)',href)
        if match:
            entry_id=positive_id(int(match[1])); title=_required(title)
            if entry_id in found and found[entry_id].title != title: raise _drift()
            found[entry_id]=BioArtSearchHit(entry_id,title)
    if not found: raise _drift()
    return tuple(found.values())


# NIH's /discover renders results client-side through a Next.js Server Action named
# discoverSearch. Its id changes with every NIH deploy, so it is read from the page chunk.
_CHUNK = re.compile(r'/_next/static/chunks/app/(?:\([a-z0-9-]{1,40}\)/)?discover/page-[0-9a-f]{8,32}\.js')
_ACTION = re.compile(r'createServerReference\)\("([0-9a-f]{40,64})"(?:(?!createServerReference)[^;]){0,200}?"discoverSearch"\)')


def discover_chunk(html: str) -> str:
    found = set(_CHUNK.findall(html))
    if len(found) != 1: raise _drift('BioArt schema drift: the discover page no longer names one discover page chunk')
    return found.pop()


def action_id(javascript: str) -> str:
    found = set(_ACTION.findall(javascript))
    if len(found) != 1: raise _drift('BioArt schema drift: the discoverSearch server action is missing from the page chunk')
    return found.pop()


def _rsc_rows(body: bytes):
    """Split a React Server Components payload: 'id:json\\n' rows and 'id:T<hex length>,text' rows."""
    rows = {}; at = 0
    while at < len(body):
        colon = body.find(b':', at, at + 17)
        key = body[at:colon].decode('ascii') if colon > at else ''
        if not re.fullmatch(r'[0-9a-f]{1,16}', key) or key in rows or len(rows) >= 10000: raise _drift()
        at = colon + 1
        if body[at:at+1] == b'T':
            comma = body.find(b',', at, at + 18)
            if comma < 0: raise _drift()
            end = comma + 1 + int(body[at+1:comma], 16)
            if end > len(body): raise _drift()
            rows[key] = body[comma+1:end]; at = end
        else:
            end = body.find(b'\n', at); end = len(body) if end < 0 else end
            rows[key] = body[at:end]; at = end + 1
    return rows


def parse_search_action(body: bytes) -> tuple[BioArtSearchHit, ...]:
    decoder = json.JSONDecoder(object_pairs_hook=_pairs)
    one = lambda value: value[0] if isinstance(value, list) and len(value) == 1 and isinstance(value[0], str) else None
    try:
        rows = _rsc_rows(body)
        reference = re.fullmatch(r'\$@([0-9a-f]{1,16})', decoder.decode(rows['0'].decode('utf-8'))['a'])
        hits = decoder.decode(rows[reference[1]].decode('utf-8'))['hits']['hit']
        if not isinstance(hits, list) or len(hits) > 1000: raise _drift()
        found = {}
        for hit in hits:
            fields = hit['fields']
            if one(fields.get('type')) != 'bioart': continue
            identity = re.fullmatch(r'[1-9][0-9]{0,15}', one(fields['id']) or '')
            entry_id = positive_id(int(identity[0])); title = _required(one(fields['title']))
            thumbnail = re.fullmatch(rf'/bioarts/{entry_id}/files/([1-9][0-9]{{0,15}})', one(fields.get('thumbnail')) or '')
            hit = BioArtSearchHit(entry_id, title, positive_id(int(thumbnail[1])) if thumbnail else None)
            if found.setdefault(entry_id, hit) != hit: raise _drift()
        return tuple(found.values())
    except (KeyError, TypeError, ValueError, IndexError, UnicodeError, RecursionError):
        raise _drift('BioArt schema drift: the discoverSearch result no longer has the expected shape') from None
