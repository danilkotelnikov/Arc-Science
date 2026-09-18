"""On-demand, explicit-egress NIH website client with verifiable immutable receipts."""
from dataclasses import asdict
from email.utils import parsedate_to_datetime
from io import BytesIO
import json
import math
from pathlib import Path
import re
import time
from urllib.parse import urlencode

import httpx
from PIL import Image

from .cache import Cache, digest, encoded
from .deadline import request_deadline
from .isolation import request_in_child
from .models import BioArtLimits, BioArtReceipt, ORIGIN, _is_neutral_caption, positive_id
from .parsing import parse_entry, parse_search
from ..vector_assets import (_read_regular, _validate_svg, _SOURCE_LIMIT, _SVG_NS,
    _local_name, _LOCAL_URL, _MAX_SVG_NODES, _MAX_SVG_DEPTH, import_vector)

_HASH = re.compile(r'[0-9a-f]{64}')
_MIME = {'SVG':{'image/svg+xml'}, 'PNG':{'image/png'},
         'AI':{'application/postscript','application/pdf','application/illustrator','application/octet-stream'},
         'EPS':{'application/postscript','application/eps','application/octet-stream'}}
_FILE_PATH = re.compile(r'/api/bioarts/[1-9][0-9]*/files/[1-9][0-9]*')


class BioArtCacheMiss(ValueError):
    """Fresh verified metadata or source bytes are absent with egress disabled."""


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

    def _request(self,path,limit,mimes):
        if not self.allow_egress: raise BioArtCacheMiss('Missing or stale cache; explicit --allow-egress required')
        # Only local code constructs endpoint paths; redirects are never followed.
        if not path.startswith('/') or path.startswith('//') or '\\' in path:
            raise ValueError('Invalid BioArt endpoint')
        if self.client is None:
            if _FILE_PATH.fullmatch(path):
                metadata = {}
                data = request_in_child(path,limit,mimes,self.limits,metadata=metadata)
                self._last_content_type = metadata['content_type']
                return data
            return request_in_child(path,limit,mimes,self.limits)
        # Injected transports are trusted test/integration code, not an arbitrary
        # native-code sandbox. Owned production HTTPX always uses process isolation.
        with request_deadline(self.limits.timeout_seconds) as remaining:
            return self._request_bounded(path,limit,mimes,remaining)

    def _request_bounded(self,path,limit,mimes,remaining):
        owned = self.client is None
        client = self.client or httpx.Client(trust_env=False,follow_redirects=False)
        try:
            for attempt in range(self.limits.max_retries+1):
                try:
                    with client.stream('GET',ORIGIN+path,timeout=remaining(),
                                       follow_redirects=False,headers={'Accept':', '.join(sorted(mimes)), 'Accept-Encoding':'identity'}) as response:
                        remaining()
                        status=response.status_code
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
                        if status!=200: raise ValueError(f'BioArt HTTP {status}; no redirect or access fallback')
                        if response.headers.get('content-encoding','identity').lower()!='identity':
                            raise ValueError('Unsupported BioArt content encoding; bounded identity transfer required')
                        content_type=response.headers.get('content-type')
                        mime=(content_type or '').split(';')[0].strip().lower()
                        untyped_svg=(content_type is None and mimes==_MIME['SVG']
                                     and _FILE_PATH.fullmatch(path) is not None)
                        if (content_type is not None and len(content_type)>1024) or (mime not in mimes and not untyped_svg):
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
                        if untyped_svg: _validate_untyped_svg(bytes(data))
                        remaining()
                        self._last_content_type = content_type
                        return bytes(data)
                except httpx.TransportError:
                    if attempt>=self.limits.max_retries: raise ValueError('BioArt transport timeout or connection failure') from None
            raise ValueError('BioArt retry limit exhausted')
        finally:
            if owned: client.close()

    def _metadata(self,path,parser):
        index='metadata-'+digest(path.encode())+'.json'
        raw=self.cache.read(index,4096)
        if raw is not None:
            value=_load(raw)
            if not isinstance(value,dict) or set(value)!={'url','retrieved_at','sha256'} or value['url']!=ORIGIN+path or not isinstance(value['sha256'],str) or not _HASH.fullmatch(value['sha256']):
                raise ValueError('Invalid metadata cache index')
            timestamp=_timestamp(value['retrieved_at'])
            html=self.cache.read(value['sha256']+'.html',self.limits.max_metadata_bytes)
            if html is None or digest(html)!=value['sha256']: raise ValueError('Metadata cache hash mismatch')
            result=parser(html.decode('utf-8'))
            if time.time()-timestamp<=self.limits.metadata_ttl_seconds: return result,html,value['sha256']
        data=self._request(path,self.limits.max_metadata_bytes,{'text/html'})
        try: result=parser(data.decode('utf-8'))
        except UnicodeError: raise ValueError('BioArt metadata must be UTF-8') from None
        sha=digest(data)
        self.cache.write({sha+'.html':data,index:encoded({'url':ORIGIN+path,'retrieved_at':time.time(),'sha256':sha})},replace=(index,))
        return result,data,sha

    def inspect(self,entry_id):
        positive_id(entry_id)
        return self._metadata(f'/bioart/{entry_id}',lambda html:parse_entry(html,entry_id))[0]

    def search(self,query):
        if not isinstance(query,str) or not query.strip() or len(query)>200 or any(ord(c)<32 for c in query):
            raise ValueError('Invalid BioArt search query')
        return self._metadata('/discover?'+urlencode({'q':query,'sort':'relevance'}),parse_search)[0]

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
        entry,_,page_hash=self._metadata(f'/bioart/{entry_id}',lambda html:parse_entry(html,entry_id))
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
        index='fetch-'+digest(encoded([entry_id,representation_id,format,page_hash]))+'.json'
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
        value={'schema':'arc-bioart-asset/1','entry_id':entry_id,'entry_url':ORIGIN+f'/bioart/{entry_id}',
            'title':entry.title,'license':entry.license,'credit':entry.credit,'creator':entry.creator,
            'collection':entry.collection,'citation':entry.citation,'representation_id':representation_id,
            'caption':representation.caption,'format':format,'file_id':file_id,'retrieved_at':time.time(),
            'source_page_sha256':page_hash,'sha256':sha,'size':len(data),'source_file':source,
            'source_content_type':self._last_content_type,
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
        if not isinstance(value,dict) or set(value) not in (required,required|{'source_content_type'}) or value['schema']!='arc-bioart-asset/1': raise ValueError('Invalid receipt schema')
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
                if format!='SVG': raise ValueError('Missing source MIME is only supported for validated SVG')
                _validate_untyped_svg(data)
            elif (not isinstance(content_type,str) or len(content_type)>1024 or
                    content_type.split(';')[0].strip().lower() not in _MIME[format]):
                raise ValueError('Invalid receipt source MIME')
        preview,eligible,limitation=_eligibility(data,format)
        if (value['preview_eligible'] is not preview or value['import_eligible'] is not eligible or value['limitation']!=limitation or
                value['rights_verified'] is not False or value['scientific_validity_established'] is not False):
            raise ValueError('Receipt eligibility/assertion mismatch')
        return value

    def import_asset(self,receipt: Path,project: Path):
        value=self.verify(receipt)
        if not value['import_eligible']: raise ValueError('BioArt source is not import eligible: '+str(value['limitation']))
        provenance={'origin':'nih_bioart','title':value['title'],'source_url':value['entry_url'],
            'permission_note':f"{value['license']}; {value['credit']}; {value['citation']}; receipt SHA256 {Path(receipt).name[:64]}",
            'external_rendering_authorized':True}
        return import_vector(self.cache.root/value['source_file'],project,provenance,expected_sha256=value['sha256'])
