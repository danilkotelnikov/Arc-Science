"""On-demand, explicit-egress NIH website client with verifiable immutable receipts."""
from dataclasses import asdict
from email.utils import parsedate_to_datetime
from io import BytesIO
import json
import math
from pathlib import Path
import re
import time
from urllib.parse import urlencode, urlsplit

import httpx
from PIL import Image

from ..net import ProxyUnsupported, outbound_client, system_proxy
from .cache import Cache, digest, encoded
from .deadline import request_deadline
from .errors import BioArtError
from .isolation import request_in_child
from .models import BioArtLimits, BioArtReceipt, ORIGIN, _is_neutral_caption, positive_id
from .parsing import action_id, discover_chunk, parse_entry, parse_search, parse_search_action
from ..vector_assets import (_read_regular, _validate_svg, _SOURCE_LIMIT, _SVG_NS,
    _local_name, _LOCAL_URL, _MAX_SVG_NODES, _MAX_SVG_DEPTH, _render_pdf, import_vector)

_HASH = re.compile(r'[0-9a-f]{64}')
_MIME = {'SVG':{'image/svg+xml'}, 'PNG':{'image/png'},
         'AI':{'application/postscript','application/pdf','application/illustrator','application/octet-stream'},
         'EPS':{'application/postscript','application/eps','application/octet-stream'}}
_THUMBNAIL_MIME = {'image/jpeg', 'image/png'}
_CHUNK_MIME = {'application/javascript', 'text/javascript'}
_SEARCH_MIME = {'text/x-component'}
_FILE_PATH = re.compile(r'/api/bioarts/[1-9][0-9]*/files/[1-9][0-9]*')
_ACTION_ID = re.compile(r'[0-9a-f]{40,64}')
_PNG = b'\x89PNG\r\n\x1a\n'
SCHEMA = 'arc-bioart-asset/2'
THUMBNAIL_LIMIT = 512 * 1024


def clean_query(query):
    """Plain words only: CloudSearch syntax (: ? & " ( ) [ ] { } * \\) never reaches NIH."""
    if (not isinstance(query, str) or not query.strip() or len(query) > 200 or
            not all(character.isalnum() or character in " -'" for character in query)):
        raise BioArtError('bioart.invalid_query')
    return query.strip()


def _format_of(mimes):
    for name, allowed in (*_MIME.items(), ('THUMBNAIL', _THUMBNAIL_MIME)):
        if set(mimes) == allowed: return name
    return None


# A DOS EPS header is 30 bytes; NIH leaves a 23-byte remainder of one. Allow up to 32.
_DOS_HEADER = 32
# Bytes that end a run of text: C0 controls except TAB, and DEL.
_CONTROL = re.compile(rb'[\x00-\x08\x0a-\x1f\x7f]')


def _comment_lines(block):
    return block == b'' or (block.endswith(b'\n') and all(line.startswith(b'%') for line in block[:-1].split(b'\n')))


def _holds_text(tail):
    """Three or more characters in a row, ASCII or any UTF-8 script: the shortest word or tag.
    A DOS header's offset, length and checksum fields often put two printable bytes side by
    side (a PS length of 0x24144 is 'DA'), so two cannot be refused.
    ponytail: a field whose three low bytes are all printable (a PS section of 2 MiB or more,
    about 5% of those) is refused too; parse the header fields if such a file turns up."""
    return any(len(piece) >= 3 for run in _CONTROL.split(tail)
               for piece in run.decode('utf-8', 'replace').split('\ufffd'))


def _eps_signature(data):
    """Only '%' comment lines may precede %!PS-Adobe- within 4 KiB, then optionally a binary
    DOS EPS header (at most 32 bytes, with a NUL, and no text in it). Its field bytes may be
    0x0A, so every line start in that window is tried as the start of the header."""
    head = data[:4096]
    at = head.find(b'%!PS-Adobe-')
    if at < 0: return False
    prefix = head[:at]
    if _comment_lines(prefix): return True
    return any((start == 0 or prefix[start - 1] == 0x0A) and _comment_lines(prefix[:start])
               and b'\x00' in prefix[start:] and not _holds_text(prefix[start:])
               for start in range(max(0, at - _DOS_HEADER), at))


def _sniff(data, format):
    """The requested format by magic bytes; SVG goes through the passive intake check."""
    if format == 'SVG': return _validate_untyped_svg(data)
    matches = {'PNG': data.startswith(_PNG), 'AI': data.startswith(b'%PDF-'), 'EPS': _eps_signature(data),
               'THUMBNAIL': data.startswith((_PNG, b'\xff\xd8\xff'))}.get(format, False)
    if not matches:
        raise BioArtError('bioart.file_rejected', f'BioArt file does not match the magic bytes (signature) of {format}',
                          format=format)


class BioArtCacheMiss(ValueError):
    """Fresh verified metadata or source bytes are absent with egress disabled."""


def _utf8(data):
    try: return data.decode('utf-8')
    except UnicodeError: raise ValueError('BioArt metadata must be UTF-8') from None


def _load(raw):
    try:
        def pairs(items):
            result={}
            for key,value in items:
                if key in result: raise ValueError('Duplicate cache JSON field')
                result[key]=value
            return result
        return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite cache JSON')))
    except (json.JSONDecodeError,RecursionError,UnicodeError):
        raise ValueError('Corrupt BioArt cache JSON') from None


def _svg_root(data, *, reject_stylesheet=False):
    """Recognize SVG identity without confusing a namespace prefix with its name."""
    try:
        from defusedxml import ElementTree
        if reject_stylesheet:
            parsed = ElementTree.iterparse(BytesIO(data), events=('pi',),
                forbid_dtd=True, forbid_entities=True, forbid_external=True)
            for _, instruction in parsed:
                target = (instruction.text or '').split(None, 1)
                if target and target[0].casefold() == 'xml-stylesheet':
                    raise ValueError('SVG cannot reference a stylesheet')
            root = parsed.root
        else:
            root = ElementTree.fromstring(data, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except Exception:
        raise ValueError('Invalid or unsafe SVG XML') from None
    name, namespace = _local_name(root.tag)
    if name != 'svg' or namespace not in {None, _SVG_NS}:
        raise ValueError('File is not an SVG')
    return root


def _validate_untyped_svg(data):
    """Bounded passive-source intake only; this never grants rendering eligibility."""
    root = _svg_root(data, reject_stylesheet=True)
    stack = [(root, 1)]
    count = 0
    while stack:
        element, depth = stack.pop()
        count += 1
        if count > _MAX_SVG_NODES or depth > _MAX_SVG_DEPTH:
            raise ValueError('SVG complexity exceeds limits')
        name, _ = _local_name(element.tag)
        if name.lower() in {'script', 'foreignobject', 'set', 'animate',
                            'animatemotion', 'animatetransform', 'animatecolor', 'discard'}:
            raise ValueError('Untyped SVG contains active content')
        css = [element.text or ''] if name == 'style' else []
        for raw_name, value in element.attrib.items():
            attribute, _ = _local_name(raw_name)
            if attribute.lower().startswith('on'):
                raise ValueError('Untyped SVG contains an event handler')
            if attribute in {'href', 'src', 'base'} and not value.startswith('#'):
                raise ValueError('Untyped SVG contains an external reference')
            css.append(value)
        for value in css:
            if '@' in value or '\\' in value or re.search(r'url\s*\(', _LOCAL_URL.sub('', value), re.IGNORECASE):
                raise ValueError('Untyped SVG contains unsupported CSS or an external reference')
        stack.extend((child, depth + 1) for child in element)


def _eligibility(data, format):
    """arc-bioart-asset/2: SVG preview needs only the passive intake check; AI imports as PDF."""
    if format=='SVG':
        _svg_root(data)
        try:
            width,height=_validate_svg(data)
            if max(width,height)>1_000_000:
                raise ValueError('SVG source dimensions exceed provider safety limit')
            if len(data)>_SOURCE_LIMIT: raise ValueError('SVG exceeds existing vector import size limit')
        except ValueError as exc:
            try: _validate_untyped_svg(data); preview=True
            except ValueError: preview=False
            return preview,False,str(exc)
        return True,True,None
    _sniff(data,format)
    if format=='PNG': return _eligibility_v1(data,format)
    if format=='AI':
        # The receipt claims only what import_vector(kind='pdf') will accept.
        if len(data)>_SOURCE_LIMIT: return False,False,'AI exceeds existing vector import size limit'
        # Without the PDF runtime the answer depends on this install, not on the bytes: record nothing.
        try: import pypdfium2  # noqa: F401
        except ImportError: raise BioArtError('bioart.runtime_missing') from None
        try: _render_pdf(data,inspect_only=True)
        except ValueError as exc: return False,False,str(exc)
        return False,True,'AI is imported through its PDF-compatible representation'
    return False,False,'EPS originals are download-only; never executed'


def _thumbnail(data):
    try:
        with Image.open(BytesIO(data)) as image:
            kind = image.format
            if kind not in {'JPEG','PNG'} or not 0<image.width<=2048 or not 0<image.height<=2048:
                raise ValueError('unsupported')
            image.verify()
    except (OSError,ValueError,Image.DecompressionBombError):
        raise BioArtError('bioart.file_rejected','BioArt thumbnail is not a bounded JPEG or PNG image') from None
    return data,'image/jpeg' if kind=='JPEG' else 'image/png'


def _eligibility_v1(data, format):
    """arc-bioart-asset/1 rules, kept so v1 receipts (also written by the native client) verify."""
    if format=='SVG':
        # Source identity and rendering eligibility are separate. Retain unsupported
        # originals as downloads; the existing vector validator still controls import.
        _svg_root(data)
        try:
            width,height=_validate_svg(data)
            if max(width,height)>1_000_000:
                raise ValueError('SVG source dimensions exceed provider safety limit')
        except ValueError as exc: return False,False,str(exc)
        if len(data)>_SOURCE_LIMIT: return False,False,'SVG exceeds existing vector import size limit'
        return True,True,None
    if format=='PNG':
        try:
            with Image.open(BytesIO(data)) as image:
                if image.format!='PNG' or not 0<image.width<=2048 or not 0<image.height<=2048:
                    raise ValueError('PNG exceeds preview dimensions')
                image.verify()
            with Image.open(BytesIO(data)) as image: image.load()
        except (OSError,ValueError,Image.DecompressionBombError):
            raise ValueError('Invalid or oversized PNG') from None
        return True,False,'PNG is preview-only; immutable vector importer accepts SVG/PDF'
    if not data.startswith((b'%!PS',b'%PDF-')): raise ValueError('Invalid AI/EPS file signature')
    return False,False,'AI/EPS originals are download-only; never executed'


def _timestamp(value):
    if type(value) not in (int,float) or not math.isfinite(value) or not 0<value<=time.time()+300:
        raise ValueError('Invalid cache retrieval timestamp')
    return value


class BioArtClient:
    def __init__(self, cache_dir: Path, *, allow_egress: bool=False,
                 client: httpx.Client | None=None, limits: BioArtLimits | None=None):
        if type(allow_egress) is not bool: raise ValueError('Explicit boolean egress required')
        self.allow_egress=allow_egress; self.limits=limits or BioArtLimits()
        self.cache=Cache(cache_dir,self.limits.max_cache_bytes); self.client=client
        self._last_content_type = None

    def _request(self,path,limit,mimes,*,action=None,body=None):
        if not self.allow_egress: raise BioArtCacheMiss('Missing or stale cache; explicit --allow-egress required')
        # Only local code constructs endpoint paths; redirects are never followed.
        if not path.startswith('/') or path.startswith('//') or '\\' in path:
            raise ValueError('Invalid BioArt endpoint')
        post = {'action':action,'body':body} if action is not None else {}
        if self.client is None:
            if _FILE_PATH.fullmatch(path):
                metadata = {}
                data = request_in_child(path,limit,mimes,self.limits,metadata=metadata)
                self._last_content_type = metadata['content_type']
                return data
            return request_in_child(path,limit,mimes,self.limits,**post)
        # Injected transports are trusted test/integration code, not an arbitrary
        # native-code sandbox. Owned production HTTPX always uses process isolation.
        with request_deadline(self.limits.timeout_seconds) as remaining:
            return self._request_bounded(path,limit,mimes,remaining,**post)

    def _request_bounded(self,path,limit,mimes,remaining,action=None,body=None):
        # The only POST is the read-only discoverSearch Server Action on /discover.
        if action is not None and (path!='/discover' or not isinstance(action,str) or not _ACTION_ID.fullmatch(action)
                                   or not isinstance(body,str) or len(body.encode('utf-8'))>1024):
            raise ValueError('Invalid BioArt search action request')
        headers={'Accept':', '.join(sorted(mimes)), 'Accept-Encoding':'identity'}
        if action is not None:
            headers.update({'Next-Action':action,'Content-Type':'text/plain;charset=UTF-8'})
        owned = self.client is None
        try:
            client = self.client or outbound_client(ORIGIN)
        except ProxyUnsupported as error:
            raise BioArtError('bioart.proxy_unsupported',str(error)) from None
        try:
            for attempt in range(self.limits.max_retries+1):
                try:
                    with client.stream('GET' if action is None else 'POST',ORIGIN+path,timeout=remaining(),
                                       content=None if action is None else body.encode('utf-8'),
                                       follow_redirects=False,headers=headers) as response:
                        remaining()
                        status=response.status_code
                        if action is not None and status==404:
                            head=b''
                            for chunk in response.iter_bytes():
                                head+=chunk
                                if len(head)>1024: break
                            if b'Server action not found' in head: raise BioArtError('bioart.action_stale')
                        if status in (429,500,502,503,504) and attempt<self.limits.max_retries:
                            delay=0.25*(2**attempt)
                            retry=response.headers.get('retry-after')
                            if retry is not None:
                                try: delay=float(retry)
                                except ValueError:
                                    try: delay=parsedate_to_datetime(retry).timestamp()-time.time()
                                    except (ValueError,TypeError,OverflowError): raise ValueError('Invalid Retry-After') from None
                                if not math.isfinite(delay) or delay>5: raise ValueError('Retry-After exceeds bounded wait; retry explicitly later')
                                delay=max(0,delay)
                            if delay>=remaining(): raise ValueError('BioArt request total timeout during retry wait')
                            time.sleep(delay); continue
                        if status!=200:
                            raise BioArtError('bioart.http_status',f'BioArt HTTP {status}; no redirect or access fallback',status=status)
                        if response.headers.get('content-encoding','identity').lower()!='identity':
                            raise ValueError('Unsupported BioArt content encoding; bounded identity transfer required')
                        content_type=response.headers.get('content-type')
                        mime=(content_type or '').split(';')[0].strip().lower()
                        # NIH's file endpoint sends no Content-Type for any format: accept a
                        # missing type only for a known file request, then check magic bytes.
                        untyped=(content_type is None and _FILE_PATH.fullmatch(path) is not None
                                 and _format_of(mimes) is not None)
                        if (content_type is not None and len(content_type)>1024) or (mime not in mimes and not untyped):
                            raise ValueError('Unexpected BioArt MIME type')
                        length=response.headers.get('content-length')
                        if length is not None:
                            if not length.isdigit() or int(length)>limit: raise ValueError('BioArt response size exceeds limit')
                        data=bytearray(); size=0
                        # Identity encoding plus the default unbuffered iterator: do
                        # not wait for a 64-KiB accumulation before checking progress.
                        for chunk in response.iter_bytes():
                            remaining()
                            size+=len(chunk)
                            if size>limit: raise ValueError('BioArt response size exceeds limit')
                            data.extend(chunk)
                        if not size: raise ValueError('Empty BioArt response')
                        if length is not None and size!=int(length): raise ValueError('BioArt response content length mismatch or truncated body')
                        if untyped: _sniff(bytes(data),_format_of(mimes))
                        remaining()
                        self._last_content_type = content_type
                        return bytes(data)
                except httpx.TransportError as error:
                    if attempt<self.limits.max_retries: continue
                    if isinstance(error,httpx.TimeoutException):
                        raise ValueError('BioArt transport timeout') from None
                    # A refused or unresolvable connection is not a timeout (web maps those to 504).
                    try: proxy=urlsplit(system_proxy(ORIGIN) or '')
                    except ProxyUnsupported: proxy=urlsplit('')
                    raise BioArtError('bioart.unreachable',
                                      proxy=f'{proxy.hostname}:{proxy.port}' if proxy.hostname else None) from None
            raise ValueError('BioArt retry limit exhausted')
        finally:
            if owned: client.close()

    def _metadata(self,path,parser,*,fetch=None,suffix='.html',limit=None,source=None):
        """Cache-first bytes for path; parser takes bytes; fetch overrides the plain HTML GET.
        source names a non-HTML body in the index key, so older caches of path are never parsed as it."""
        limit=limit or self.limits.max_metadata_bytes
        index='metadata-'+digest((path if source is None else f'{path}#{source}').encode())+'.json'
        raw=self.cache.read(index,4096)
        if raw is not None:
            value=_load(raw)
            if not isinstance(value,dict) or set(value)!={'url','retrieved_at','sha256'} or value['url']!=ORIGIN+path or not isinstance(value['sha256'],str) or not _HASH.fullmatch(value['sha256']):
                raise ValueError('Invalid metadata cache index')
            timestamp=_timestamp(value['retrieved_at'])
            html=self.cache.read(value['sha256']+suffix,limit)
            if html is None or digest(html)!=value['sha256']: raise ValueError('Metadata cache hash mismatch')
            # A stale body is refetched unparsed: an older parser's cache must not read as drift.
            if time.time()-timestamp<=self.limits.metadata_ttl_seconds: return parser(html),html,value['sha256']
        data=fetch() if fetch else self._request(path,limit,{'text/html'})
        result=parser(data)
        sha=digest(data)
        self.cache.write({sha+suffix:data,index:encoded({'url':ORIGIN+path,'retrieved_at':time.time(),'sha256':sha})},replace=(index,))
        return result,data,sha

    def inspect(self,entry_id):
        positive_id(entry_id)
        return self._metadata(f'/bioart/{entry_id}',lambda data:parse_entry(_utf8(data),entry_id))[0]

    def thumbnail(self,entry_id,file_id):
        """A search-result thumbnail (JPEG or PNG, at most 512 KiB), cached like metadata."""
        positive_id(entry_id); positive_id(file_id)
        path=f'/api/bioarts/{entry_id}/files/{file_id}'
        return self._metadata(path,_thumbnail,suffix='.thumbnail',limit=THUMBNAIL_LIMIT,
                              fetch=lambda:self._request(path,THUMBNAIL_LIMIT,_THUMBNAIL_MIME))[0]

    def _search_action(self,query):
        body=json.dumps([f'type:bioart AND {query}?start=0&size=24'],ensure_ascii=False)
        for _ in range(2):  # a stale action id (NIH redeployed) is re-resolved once
            page=self._request('/discover',self.limits.max_metadata_bytes,{'text/html'})
            chunk=self._request(discover_chunk(_utf8(page)),1024**2,_CHUNK_MIME)
            try:
                return self._request('/discover',self.limits.max_metadata_bytes,_SEARCH_MIME,
                                     action=action_id(_utf8(chunk)),body=body)
            except BioArtError as error:
                if error.code!='bioart.action_stale': raise
        raise BioArtError('bioart.drift','BioArt schema drift: NIH still reports the discoverSearch action as not found after re-resolving it')

    def search(self,query):
        query=clean_query(query)
        return self._metadata('/discover?'+urlencode({'q':query,'sort':'relevance'}),parse_search_action,
                              fetch=lambda:self._search_action(query),suffix='.rsc',source='discoverSearch')[0]

    def search_snapshot(self,query,source: Path):
        """Operator-supplied rendered DOM, never represented as an authenticated fetch."""
        if not isinstance(query,str) or not query.strip() or len(query)>200 or any(ord(c)<32 for c in query):
            raise ValueError('Invalid BioArt search query')
        data=_read_regular(source,self.limits.max_metadata_bytes,'BioArt search snapshot')
        hits=parse_search(data.decode('utf-8'))
        sha=digest(data)
        value={'source_kind':'operator_supplied_browser_snapshot','query':query,
            'source_url':ORIGIN+'/discover?'+urlencode({'q':query,'sort':'relevance'}),
            'source_sha256':sha,'recorded_at':time.time(),'hits':[asdict(hit) for hit in hits]}
        raw=encoded(value); name=digest(raw)+'.snapshot.json'
        self.cache.write({sha+'.html':data,name:raw})
        return {**value,'snapshot_record':str(self.cache.root/name)}

    def fetch(self,entry_id,representation_id=None,format='SVG'):
        positive_id(entry_id)
        if representation_id is not None: positive_id(representation_id)
        if not isinstance(format,str) or format.upper() not in _MIME: raise ValueError('Unsupported BioArt format')
        format=format.upper()
        entry,_,page_hash=self._metadata(f'/bioart/{entry_id}',lambda data:parse_entry(_utf8(data),entry_id))
        if representation_id is None:
            compatible=tuple(r for r in entry.representations if format in r.files)
            if not compatible:
                raise ValueError(f'No BioArt representation contains requested format {format}')
            representation=next((r for r in compatible if _is_neutral_caption(r.caption)),compatible[0])
            representation_id=representation.group_id
        else:
            representation=next((r for r in entry.representations if r.group_id==representation_id),None)
            if representation is None: raise ValueError('Unknown entry representation')
            if format not in representation.files: raise ValueError('Format absent from representation')
        if entry.license!='Public Domain': raise ValueError('Unknown or restricted license requires operator review; fetch/import blocked')
        # Keyed by schema too: a v1 receipt stays verifiable but is not reused as a v2 fetch.
        index='fetch-'+digest(encoded([entry_id,representation_id,format,page_hash,SCHEMA]))+'.json'
        existing=self.cache.read(index,4096)
        if existing is not None:
            value=_load(existing)
            if (not isinstance(value,dict) or set(value)!={'receipt'} or not isinstance(value['receipt'],str) or
                    not re.fullmatch(r'[0-9a-f]{64}\.receipt\.json',value['receipt'])):
                raise ValueError('Invalid fetch cache index')
            receipt=self.cache.root/value['receipt']
            verified=self.verify(receipt)
            if (verified['entry_id'],verified['representation_id'],verified['format'],verified['source_page_sha256'])!=(entry_id,representation_id,format,page_hash):
                raise ValueError('Fetch cache binding mismatch')
            return BioArtReceipt(receipt,self.cache.root/verified['source_file'])
        file_id=representation.files[format]
        data=self._request(f'/api/bioarts/{entry_id}/files/{file_id}',self.limits.max_file_bytes,_MIME[format])
        preview,eligible,limitation=_eligibility(data,format)
        sha=digest(data); source=sha+'.'+format.lower()
        value={'schema':SCHEMA,'entry_id':entry_id,'entry_url':ORIGIN+f'/bioart/{entry_id}',
            'title':entry.title,'license':entry.license,'credit':entry.credit,'creator':entry.creator,
            'collection':entry.collection,'citation':entry.citation,'representation_id':representation_id,
            'caption':representation.caption,'format':format,'file_id':file_id,'retrieved_at':time.time(),
            'source_page_sha256':page_hash,'sha256':sha,'size':len(data),'source_file':source,
            'source_content_type':self._last_content_type,'sniffed_format':format,
            'preview_eligible':preview,'import_eligible':eligible,'limitation':limitation,
            'rights_verified':False,'scientific_validity_established':False}
        receipt_data=encoded(value); name=digest(receipt_data)+'.receipt.json'
        self.cache.write({source:data,name:receipt_data,index:encoded({'receipt':name})})
        receipt=self.cache.root/name
        self.verify(receipt)
        return BioArtReceipt(receipt,self.cache.root/source)

    def verify(self,receipt: Path):
        receipt=Path(receipt)
        if '..' in receipt.parts or receipt.absolute().parent!=self.cache.root or not re.fullmatch(r'[0-9a-f]{64}\.receipt\.json',receipt.name):
            raise ValueError('Unsafe BioArt receipt path')
        raw=self.cache.read(receipt.name,65536)
        if raw is None or digest(raw)!=receipt.name[:64]: raise ValueError('Receipt digest mismatch')
        value=_load(raw)
        required={'schema','entry_id','entry_url','title','license','credit','creator','collection','citation',
            'representation_id','caption','format','file_id','retrieved_at','source_page_sha256','sha256','size',
            'source_file','preview_eligible','import_eligible','limitation','rights_verified','scientific_validity_established'}
        schema=value.get('schema') if isinstance(value,dict) else None
        shapes={'arc-bioart-asset/1':(required,required|{'source_content_type'}),
                SCHEMA:(required|{'source_content_type','sniffed_format'},)}
        if schema not in shapes or set(value) not in shapes[schema]: raise ValueError('Invalid receipt schema')
        v1=schema=='arc-bioart-asset/1'
        for field in ('sha256','source_page_sha256'):
            if not isinstance(value[field],str) or not _HASH.fullmatch(value[field]): raise ValueError('Invalid receipt hash')
        positive_id(value['entry_id']); positive_id(value['representation_id']); positive_id(value['file_id'])
        _timestamp(value['retrieved_at'])
        format=value['format']
        if not isinstance(format,str) or format not in _MIME or value['source_file']!=value['sha256']+'.'+format.lower(): raise ValueError('Unsafe source file binding')
        page=self.cache.read(value['source_page_sha256']+'.html',self.limits.max_metadata_bytes)
        if page is None or digest(page)!=value['source_page_sha256']: raise ValueError('Source page hash mismatch')
        entry=parse_entry(page.decode('utf-8'),value['entry_id'])
        for field in ('title','license','credit','creator','collection','citation'):
            if value[field]!=getattr(entry,field): raise ValueError('Receipt metadata binding mismatch')
        representation=next((r for r in entry.representations if r.group_id==value['representation_id']),None)
        if (representation is None or representation.files.get(format)!=value['file_id'] or representation.caption!=value['caption'] or
                value['entry_url']!=ORIGIN+f'/bioart/{entry.entry_id}' or entry.license!='Public Domain'):
            raise ValueError('Receipt entry/file/license binding mismatch')
        data=self.cache.read(value['source_file'],self.limits.max_file_bytes)
        if data is None or type(value['size']) is not int or len(data)!=value['size'] or digest(data)!=value['sha256']: raise ValueError('Source size/hash mismatch')
        if 'source_content_type' in value:
            content_type=value['source_content_type']
            if content_type is None:
                if v1 and format!='SVG': raise ValueError('Missing source MIME is only supported for validated SVG')
                if format=='SVG': _validate_untyped_svg(data)  # v2 sniffs the other formats in _eligibility
            elif (not isinstance(content_type,str) or len(content_type)>1024 or
                    content_type.split(';')[0].strip().lower() not in _MIME[format]):
                raise ValueError('Invalid receipt source MIME')
        if not v1 and value['sniffed_format']!=format: raise ValueError('Receipt sniffed format mismatch')
        preview,eligible,limitation=(_eligibility_v1 if v1 else _eligibility)(data,format)
        if (value['preview_eligible'] is not preview or value['import_eligible'] is not eligible or value['limitation']!=limitation or
                value['rights_verified'] is not False or value['scientific_validity_established'] is not False):
            raise ValueError('Receipt eligibility/assertion mismatch')
        return value

    def import_asset(self,receipt: Path,project: Path):
        value=self.verify(receipt)
        if not value['import_eligible']:
            raise BioArtError('bioart.not_eligible','BioArt source is not import eligible: '+str(value['limitation']))
        # AI files from NIH are PDF-compatible: they go through the PDF importer by explicit kind.
        kind='pdf' if value['format']=='AI' else None
        note=[value['license'],value['credit'],value['citation'],
              'source format AI (PDF-compatible)' if kind else None,f'receipt SHA256 {Path(receipt).name[:64]}']
        provenance={'origin':'nih_bioart','title':value['title'],'source_url':value['entry_url'],
            'permission_note':'; '.join(part for part in note if part is not None),
            'external_rendering_authorized':True}
        return import_vector(self.cache.root/value['source_file'],project,provenance,expected_sha256=value['sha256'],kind=kind)
