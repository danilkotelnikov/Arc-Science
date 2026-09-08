"""Dependency-free, closed contracts shared by host and isolated Blender worker.

Linux is the qualified platform. Filesystem operations fail closed without the
no-follow and descriptor-relative primitives used to pin artifact directories.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys
import zlib
from urllib.parse import urlsplit

SOURCE_LIMIT = 16 * 1024 * 1024
JSON_LIMIT = 64 * 1024
IMAGE_LIMIT = 32 * 1024 * 1024
SCENE_LIMIT = 128 * 1024 * 1024
LOG_LIMIT = 1024 * 1024
_HASH = re.compile(r'^[0-9a-f]{64}$')
_RUN = re.compile(r'^[0-9a-f]{24}$')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=False, allow_nan=False).encode('utf-8')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require_filesystem():
    if (sys.platform != 'linux' or not getattr(os, 'O_NOFOLLOW', 0) or
            not getattr(os, 'O_DIRECTORY', 0) or
            not {os.open, os.mkdir, os.stat, os.unlink, os.rename} <= os.supports_dir_fd):
        raise ValueError('Render artifacts require Linux no-follow filesystem primitives')


def absolute(path):
    return Path(os.path.abspath(os.fspath(path)))


def open_directory(path, *, create=False):
    require_filesystem()
    path = absolute(path)
    fd = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parts[1:]:
            if create:
                try:
                    os.mkdir(part, 0o700, dir_fd=fd)
                except FileExistsError:
                    pass
            next_fd = child_directory(fd, part)
            os.close(fd)
            fd = next_fd
        return fd
    except (OSError, ValueError):
        os.close(fd)
        raise ValueError('Unsafe, missing, or symlink directory') from None


def basename(name):
    if not isinstance(name, str) or not name or name in {'.', '..'} or '/' in name or '\\' in name or '\x00' in name:
        raise ValueError('Unsafe artifact filename')
    return name


def child_directory(fd, name, *, create=False):
    basename(name)
    if create:
        os.mkdir(name, 0o700, dir_fd=fd)
    try:
        return os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
    except OSError:
        raise ValueError('Unsafe artifact directory') from None


def read_regular(fd, name, limit, *, empty=False):
    basename(name)
    try:
        opened = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            before = os.fstat(opened)
            if not stat.S_ISREG(before.st_mode) or not (0 if empty else 1) <= before.st_size <= limit:
                raise ValueError('Artifact is not a bounded regular file')
            parts = []
            remaining = limit + 1
            while remaining:
                data = os.read(opened, min(remaining, 1024 * 1024))
                if not data:
                    break
                parts.append(data)
                remaining -= len(data)
            after = os.fstat(opened)
            if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise ValueError('Artifact changed while reading')
        finally:
            os.close(opened)
    except OSError:
        raise ValueError('Artifact cannot be read without following links') from None
    data = b''.join(parts)
    if len(data) != before.st_size or len(data) > limit:
        raise ValueError('Artifact size changed')
    return data


def write_new(fd, name, data):
    basename(name)
    out = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                  0o600, dir_fd=fd)
    try:
        view = memoryview(data)
        while view:
            view = view[os.write(out, view):]
        os.fsync(out)
    finally:
        os.close(out)


def _pairs(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError('Duplicate JSON field')
        obj[key] = value
    return obj


def read_json(fd, name):
    try:
        return json.loads(read_regular(fd, name, JSON_LIMIT), object_pairs_hook=_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
    except (UnicodeError, RecursionError, TypeError):
        raise ValueError('Invalid artifact JSON') from None


def exact(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys.split()):
        raise ValueError('Invalid ' + label + ' fields')
    return value


def hash_value(value):
    if not isinstance(value, str) or not _HASH.fullmatch(value):
        raise ValueError('Invalid digest')
    return value


def integer(value, low, high, label):
    if type(value) is not int or not low <= value <= high:
        raise ValueError('Invalid ' + label)
    return value


def text(value, maximum):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise ValueError('Invalid text field')
    return value


def settings(value):
    exact(value, 'style width height samples seed timeout threads engine device', 'render settings')
    if value['style'] not in ('publication', 'studio', 'flat'):
        raise ValueError('Invalid style')
    for name, low, high in [('width',256,2048),('height',256,2048),('samples',1,512),
                            ('seed',0,2**31-1),('timeout',1,900),('threads',4,4)]:
        integer(value[name], low, high, name)
    if value['engine'] != 'CYCLES' or value['device'] != 'CPU':
        raise ValueError('Only CPU Cycles is permitted')
    return value


def png_pixels(data, *, proof=False):
    """Check bounded 8-bit noninterlaced PNG, CRC, deflate and scanline filters.

    Imported proofs are canonical RGBA. Blender outputs RGB or RGBA. Decompression
    is capped by dimensions before any pixel buffer or Blender image is allocated.
    """
    if not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Invalid PNG signature')
    offset, compressed, header, ended = 8, bytearray(), None, False
    idat_ended = False
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError('Truncated PNG')
        length = struct.unpack('>I', data[offset:offset+4])[0]
        kind = data[offset+4:offset+8]
        end = offset + 12 + length
        if end > len(data):
            raise ValueError('Truncated PNG chunk')
        payload = data[offset+8:offset+8+length]
        crc = struct.unpack('>I', data[offset+8+length:end])[0]
        if zlib.crc32(kind + payload) & 0xffffffff != crc:
            raise ValueError('PNG checksum mismatch')
        if header is None:
            if kind != b'IHDR' or length != 13:
                raise ValueError('Invalid PNG header')
            w,h,depth,color,compression,filtering,interlace = struct.unpack('>IIBBBBB',payload)
            if not (1 <= w <= 2048 and 1 <= h <= 2048 and w*h <= 4_194_304):
                raise ValueError('PNG dimensions exceed limits')
            if depth != 8 or color not in ((6,) if proof else (2,6)) or compression or filtering or interlace:
                raise ValueError('Unsupported PNG encoding')
            header = (w,h,color)
        elif kind == b'IHDR':
            raise ValueError('Duplicate PNG header')
        elif kind == b'IDAT':
            if idat_ended:
                raise ValueError('Noncontiguous PNG image data')
            compressed.extend(payload)
        elif kind == b'IEND':
            if payload or not compressed or end != len(data):
                raise ValueError('Invalid PNG ending')
            ended = True
            break
        else:
            if compressed:
                idat_ended = True
            if kind[0] & 32 == 0 and kind != b'PLTE':
                raise ValueError('Unknown critical PNG chunk')
        offset = end
    if not ended or header is None:
        raise ValueError('Incomplete PNG')
    w,h,color = header
    channels = 4 if color == 6 else 3
    stride = w*channels
    limit = (stride+1)*h
    try:
        decompressor = zlib.decompressobj()
        raw = decompressor.decompress(bytes(compressed), limit+1)
        if len(raw) != limit or not decompressor.eof or decompressor.unused_data or decompressor.unconsumed_tail:
            raise ValueError('Invalid or oversized PNG pixel data')
    except zlib.error:
        raise ValueError('Invalid PNG compression') from None
    # Output integrity needs validated scanlines, but only proofs need pixel hashes.
    previous = bytearray(stride)
    pixel_hash = hashlib.sha256()
    for y in range(h):
        base = y*(stride+1)
        filtering = raw[base]
        if filtering > 4:
            raise ValueError('Invalid PNG scanline filter')
        row = bytearray(raw[base+1:base+1+stride])
        if proof:
            for x in range(stride):
                a = row[x-channels] if x >= channels else 0
                b = previous[x]
                c = previous[x-channels] if x >= channels else 0
                if filtering == 1: predictor = a
                elif filtering == 2: predictor = b
                elif filtering == 3: predictor = (a+b)//2
                elif filtering == 4:
                    p = a+b-c
                    pa,pb,pc = abs(p-a),abs(p-b),abs(p-c)
                    predictor = a if pa <= pb and pa <= pc else b if pb <= pc else c
                else: predictor = 0
                row[x] = (row[x]+predictor)&255
            pixel_hash.update(row)
            previous = row
    return w,h,pixel_hash.hexdigest() if proof else None


def validate_asset(fd, asset_id):
    manifest = read_json(fd, 'asset.json')
    exact(manifest, 'format asset_id provenance source preview converter rights_verified scientific_validity_established', 'asset')
    if manifest['format'] != 'arc-vector-asset/1' or manifest['asset_id'] != asset_id:
        raise ValueError('Asset identity mismatch')
    hash_value(asset_id)
    unsigned = dict(manifest); unsigned.pop('asset_id')
    if digest(canonical(unsigned)) != asset_id:
        raise ValueError('Asset identity digest mismatch')
    if manifest['rights_verified'] is not False or manifest['scientific_validity_established'] is not False:
        raise ValueError('Invalid asset validation assertions')
    provenance = manifest['provenance']
    if not isinstance(provenance, dict) or set(provenance) - {'origin','title','permission_note','external_rendering_authorized','source_url','template_id'}:
        raise ValueError('Invalid provenance')
    for key,maximum in [('title',500),('permission_note',4000)]: text(provenance.get(key), maximum)
    if provenance.get('origin') not in ('biorender','nih_bioart','user','synthetic_fixture') or provenance.get('external_rendering_authorized') is not True:
        raise ValueError('External rendering authorization is required')
    if 'source_url' in provenance:
        url = text(provenance['source_url'],2000)
        parsed = urlsplit(url)
        hostname = (parsed.hostname or '').lower()
        if ('\\' in url or any(c.isspace() for c in url) or parsed.scheme != 'https' or
                parsed.username is not None or parsed.password is not None or parsed.port is not None or
                not hostname or not hostname.isascii() or parsed.netloc.casefold() != hostname):
            raise ValueError('Invalid provenance URL')
    if provenance['origin'] == 'biorender':
        template = provenance.get('template_id')
        if not isinstance(template,str) or not re.fullmatch(r'[A-Za-z0-9._-]{1,160}',template) or 'source_url' not in provenance:
            raise ValueError('Invalid BioRender template identity')
        # Match the host's two literal public-detail forms; no URL normalization.
        expected = 'https://app.biorender.com/biorender-templates/details/t-' + template
        if provenance['source_url'] not in {expected, expected + '?source=mcp'}:
            raise ValueError('Invalid public BioRender template URL')
    elif 'template_id' in provenance:
        raise ValueError('Unexpected template ID')
    if provenance['origin'] == 'nih_bioart' and not re.fullmatch(r'https://bioart\.niaid\.nih\.gov/bioart/[1-9][0-9]*', provenance.get('source_url', '')):
        raise ValueError('NIH BioArt provenance requires a canonical entry URL')
    source = exact(manifest['source'], 'file sha256 size media_type content_kind', 'source')
    preview = exact(manifest['preview'], 'file sha256 pixel_sha256 width height', 'proof')
    converter = exact(manifest['converter'], 'engine engine_version pillow_version', 'converter')
    expected = {'source.svg':('image/svg+xml','CairoSVG'), 'source.pdf':('application/pdf','pypdfium2')}
    if not isinstance(source['file'],str) or source['file'] not in expected:
        raise ValueError('Invalid vector filename')
    media,engine = expected[source['file']]
    if source['media_type'] != media or source['content_kind'] not in ('vector','mixed_vector_image') or converter['engine'] != engine:
        raise ValueError('Invalid source metadata')
    text(converter['engine_version'],100); text(converter['pillow_version'],100)
    integer(source['size'],1,SOURCE_LIMIT,'source size')
    hash_value(source['sha256']); hash_value(preview['sha256']); hash_value(preview['pixel_sha256'])
    if preview['file'] != 'source.png': raise ValueError('Invalid proof filename')
    integer(preview['width'],1,2048,'proof width'); integer(preview['height'],1,2048,'proof height')
    source_data = read_regular(fd,source['file'],SOURCE_LIMIT)
    proof_data = read_regular(fd,'source.png',SOURCE_LIMIT)
    if len(source_data) != source['size'] or digest(source_data) != source['sha256'] or digest(proof_data) != preview['sha256']:
        raise ValueError('Source or proof digest mismatch')
    w,h,pixels = png_pixels(proof_data,proof=True)
    if (w,h,pixels) != (preview['width'],preview['height'],preview['pixel_sha256']):
        raise ValueError('Proof pixels or dimensions mismatch')
    return manifest,proof_data


def asset_directory(run_fd, asset_id):
    hash_value(asset_id)
    inputs = child_directory(run_fd,'inputs')
    try: return child_directory(inputs,asset_id)
    finally: os.close(inputs)


def validate_job(job, run_fd):
    exact(job, 'format run_id asset asset_id asset_manifest_sha256 source_sha256 proof_sha256 representation settings', 'job')
    if job['format'] != 'arc-figure-job/1' or not isinstance(job['run_id'],str) or not _RUN.fullmatch(job['run_id']):
        raise ValueError('Invalid job identity')
    if job['representation'] != 'rasterized_vector_panel': raise ValueError('Invalid representation')
    settings(job['settings'])
    for key in ['asset_id','asset_manifest_sha256','source_sha256','proof_sha256']: hash_value(job[key])
    if job['asset'] != 'inputs/'+job['asset_id']+'/asset.json': raise ValueError('Invalid captured asset path')
    fd = asset_directory(run_fd,job['asset_id'])
    try:
        manifest,proof = validate_asset(fd,job['asset_id'])
        if (digest(read_regular(fd,'asset.json',JSON_LIMIT)) != job['asset_manifest_sha256'] or
                manifest['source']['sha256'] != job['source_sha256'] or manifest['preview']['sha256'] != job['proof_sha256']):
            raise ValueError('Job source binding mismatch')
        return manifest,proof
    finally: os.close(fd)


def validate_reservation(value, job, status):
    exact(value, 'format run_id job_sha256 status failure', 'reservation')
    if (value['format'] != 'arc-figure-reservation/1' or value['run_id'] != job['run_id'] or
            value['job_sha256'] != digest(canonical(job)) or value['status'] != status or value['failure'] is not None):
        raise ValueError('Reservation does not bind this '+status+' job')


def validate_receipt(receipt, job, run_fd):
    exact(receipt, 'format run_id job_sha256 asset_id source_sha256 proof_sha256 representation settings runtime outputs rights_verified scientific_validity_established renderer_reexecuted', 'receipt')
    if receipt['format'] != 'arc-figure-receipt/1' or receipt['job_sha256'] != digest(canonical(job)):
        raise ValueError('Receipt job digest mismatch')
    for key in ['run_id','asset_id','source_sha256','proof_sha256','representation','settings']:
        if receipt[key] != job[key]: raise ValueError('Receipt '+key+' mismatch')
    settings(receipt['settings'])
    for key in ['rights_verified','scientific_validity_established','renderer_reexecuted']:
        if receipt[key] is not False: raise ValueError('Invalid receipt assertion')
    runtime = exact(receipt['runtime'],'kind version version_string','runtime')
    version = runtime['version']
    if runtime['kind'] != 'blender' or not isinstance(version,list) or len(version) != 3:
        raise ValueError('Invalid Blender runtime')
    for part in version: integer(part,0,999,'runtime version')
    if tuple(version) < (4,5,0): raise ValueError('Blender 4.5 or later is required')
    text(runtime['version_string'],200)
    exact(receipt['outputs'],'scene image','outputs')
    for name,filename,limit in [('scene','scene.blend',SCENE_LIMIT),('image','render.png',IMAGE_LIMIT)]:
        output = receipt['outputs'][name]
        exact(output,'file sha256 size'+(' width height' if name=='image' else ''),'output')
        hash_value(output['sha256']); integer(output['size'],1,limit,'output size')
        if output['file'] != filename: raise ValueError('Invalid output path')
        data = read_regular(run_fd,filename,limit)
        if len(data) != output['size'] or digest(data) != output['sha256']: raise ValueError('Output integrity mismatch')
        if name == 'image':
            integer(output['width'],256,2048,'output width'); integer(output['height'],256,2048,'output height')
            w,h,_ = png_pixels(data)
            if (w,h) != (output['width'],output['height']) or (w,h) != (job['settings']['width'],job['settings']['height']):
                raise ValueError('Output dimensions mismatch')
        elif not data.startswith(b'BLENDER'):
            raise ValueError('Output is not an uncompressed Blender scene')
    return receipt
