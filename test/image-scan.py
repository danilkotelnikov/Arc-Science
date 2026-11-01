"""Find the old vendor's whale, and its blue, in pictures. The text scans cannot see pictures; this scan reads them by content.

    python test/image-scan.py --asar build/app.asar --dir C:/Users/danil/.dsh/profiles/web [--dir ...] [--floor-raster N] [--floor-text N]
    python test/image-scan.py --survey --asar pristine/app.asar --dir <folder>      (lists every distinct raster picture; no verdict)
    python test/image-scan.py --self-check

What it reads
  raster files (png, webp, ico, gif, jpg, bmp) and base64 data URIs of those formats inside text files and in the archive;
  svg files, inline svg and svg data URIs: path fingerprints of the whale, the vendor blue, and the known preview pictures.
How it decides (brand/pictures.json)
  whale      sha256 of a whale picture of the original app or its plugins: always a failure.
  reviewed   sha256 of every distinct raster picture of the original app and its ten plugins, looked at one by one.
             A picture that is neither reviewed nor one of ours (brand/dist/tiles and the icon) is a failure ("unreviewed"):
             somebody has to look at it before it ships.
  fixtures   pictures inside third-party test, fixture, font, demo and example folders are counted, not judged.
Pictures that carry the old product name only as text inside the picture (screenshots and banners in plugin asset folders) are
reviewed and allowed; README.md lists them as a known limit.
Exit code: 0 clean, 1 a finding, 2 the scan is not trustworthy (nothing read, self-check failed).
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import struct
import sys
from pathlib import Path
from typing import Any, Iterator

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
CATALOG = KIT / 'brand' / 'pictures.json'
DIST = KIT / 'brand' / 'dist'
RASTER_EXT = {'.png', '.webp', '.ico', '.gif', '.jpg', '.jpeg', '.bmp'}
TEXT_EXT = {'.js', '.mjs', '.cjs', '.css', '.html', '.htm', '.json', '.svg', '.md', '.yml', '.yaml', '.txt', '.ts'}
MAX_IMAGE, MAX_TEXT = 24 * 2**20, 14 * 2**20
DATA_URI = re.compile(rb'data:image\\?/(png|webp|gif|jpe?g|x-icon|vnd\.microsoft\.icon|svg\+xml)(?:;charset=[\w-]+)?;base64,([A-Za-z0-9+/=]+)')
# skipped on purpose: the translation tool of this kit keeps old copies of plugin files; no profile loads it and it leaves with the rename slices
SKIP = re.compile(r'[\\/]local-plugins[\\/]dsh-english[\\/]')
FIXTURE_DIR = re.compile(r'[\\/](test|tests|__tests__|fixtures|fonts|demo|examples?)[\\/]', re.I)
# path fragments of the whale drawn as vector art (the mark as used in the original app and in its plugins)
FINGERPRINTS = ('c-.254-.124-.364.113', 'M22.9168 1.43018', '11.365 11.365 0 00-.689-.471')
BLUE = {'#4d6bfe', '#4a5699', '#6277ba', '#324de2', '#69b9ff'}   # the vendor blue, two plugin blues and the blue of the subagent icons


def asar_files(path: Path) -> Iterator[tuple[str, bytes]]:
    data = path.read_bytes()
    hsize = struct.unpack('<I', data[4:8])[0]
    jlen = struct.unpack('<I', data[12:16])[0]
    header = json.loads(data[16:16 + jlen])
    base = 8 + hsize

    def walk(node: dict[str, Any], prefix: str) -> Iterator[tuple[str, bytes]]:
        for name, ent in (node.get('files') or {}).items():
            p = f'{prefix}/{name}'
            if 'files' in ent:
                yield from walk(ent, p)
            elif 'offset' in ent and not ent.get('unpacked'):
                off = base + int(ent['offset'])
                yield p, data[off:off + ent['size']]
    yield from walk(header, 'app.asar')


def dir_files(root: Path) -> Iterator[tuple[str, Path]]:
    for dp, _dn, fn in os.walk(root, followlinks=False):
        for f in fn:
            p = Path(dp) / f
            try:
                if not p.is_symlink():
                    yield str(p), p
            except OSError:
                continue


def sha(buf: bytes) -> str:
    return hashlib.sha256(buf).hexdigest()


class Catalog:
    def __init__(self) -> None:
        j: dict[str, Any] = json.loads(CATALOG.read_text(encoding='utf-8')) if CATALOG.exists() else {}
        self.whale: set[str] = set(j.get('whale', {}))
        self.svg_swap: set[str] = set(j.get('svgSwap', {}))
        self.reviewed: set[str] = set(j.get('reviewed', []))
        self.ours: set[str] = set()
        for f in list(DIST.glob('tiles/*')) + [DIST / 'icon.png']:
            if f.exists():
                self.ours.add(sha(f.read_bytes()))


def classify_svg(text: str, digest: str, cat: Catalog) -> dict[str, str] | None:
    if digest in cat.svg_swap:
        return {'kind': 'preview', 'why': 'a known preview picture with the old mark'}
    for fp in FINGERPRINTS:
        if fp in text:
            return {'kind': 'whale', 'why': f'svg path {fp!r}'}
    for m in re.finditer(r'#[0-9a-fA-F]{6}\b', text):
        if m.group(0).lower() in BLUE:
            return {'kind': 'blue', 'why': f'svg colour {m.group(0)}'}
    return None


def classify_raster(digest: str, name: str, cat: Catalog) -> dict[str, str] | None:
    if digest in cat.whale:
        return {'kind': 'whale', 'why': 'sha256 is in the whale list'}
    if digest in cat.ours or digest in cat.reviewed:
        return None
    if FIXTURE_DIR.search(name):
        return {'kind': 'fixture', 'why': 'third-party test, fixture, font or demo picture'}
    return {'kind': 'unreviewed', 'why': 'a picture nobody has looked at; review it and add its sha256 to brand/pictures.json'}


def scan(sources: Iterator[tuple[str, bytes]], cat: Catalog, survey: bool = False) -> tuple[dict[str, int], list[dict[str, Any]]]:
    stats = {'skipped files': 0, 'files': 0, 'raster files': 0, 'svg files': 0, 'raster data uris': 0, 'svg data uris': 0, 'text files read': 0, 'fixture pictures': 0}
    found: list[dict[str, Any]] = []
    seen: dict[str, str | None] = {}

    def raster(name: str, buf: bytes, how: str) -> None:
        d = sha(buf)
        if survey:
            if d not in seen:
                seen[d] = name
                found.append({'kind': 'seen', 'sha256': d, 'bytes': len(buf), 'where': name, 'how': how})
            return
        res = classify_raster(d, name, cat)
        if res and res['kind'] == 'fixture':
            stats['fixture pictures'] += 1
        elif res:
            found.append({'where': name, 'how': how, 'sha256': d, **res})

    for name, buf in sources:
        if SKIP.search(name):
            stats['skipped files'] += 1
            continue
        stats['files'] += 1
        ext = Path(name).suffix.lower()
        if ext in RASTER_EXT and len(buf) <= MAX_IMAGE:
            stats['raster files'] += 1
            raster(name, buf, 'file')
            continue
        if ext == '.svg':
            stats['svg files'] += 1
            res = classify_svg(buf.decode('utf-8', 'replace'), sha(buf), cat)
            if res:
                found.append({'where': name, 'how': 'svg file', **res})
        if ext in TEXT_EXT and len(buf) <= MAX_TEXT:
            stats['text files read'] += 1
            if not survey and ext != '.svg':
                for fp in FINGERPRINTS:
                    if fp.encode() in buf:
                        found.append({'where': name, 'how': 'inline svg', 'kind': 'whale', 'why': f'svg path {fp!r}'})
                        break
            if b'data:image' not in buf:
                continue
            for m in DATA_URI.finditer(buf):
                kind = m.group(1).decode()
                try:
                    raw = base64.b64decode(m.group(2) + b'=' * (-len(m.group(2)) % 4))
                except ValueError:
                    continue
                if kind == 'svg+xml':
                    stats['svg data uris'] += 1
                    if survey:
                        found.append({'kind': 'svg', 'sha256': sha(raw), 'bytes': len(raw), 'where': name, 'how': 'svg data uri'})
                        continue
                    res = classify_svg(raw.decode('utf-8', 'replace'), sha(raw), cat)
                    if res:
                        found.append({'where': name, 'how': 'svg data uri', 'sha256': sha(raw), **res})
                else:
                    stats['raster data uris'] += 1
                    raster(name, raw, 'data uri')
    return stats, found


def self_check(cat: Catalog) -> list[str]:
    errs: list[str] = []
    if not cat.whale or len(cat.reviewed) < 100 or not cat.svg_swap:
        errs.append('brand/pictures.json is empty or short')
    if not cat.ours:
        errs.append('brand/dist/tiles and icon.png are missing')
    probe = Catalog()
    probe.whale, probe.reviewed, probe.ours = {sha(b'whale')}, {sha(b'fine')}, {sha(b'mine')}
    probe.svg_swap = {sha(b'preview')}
    for blob, kind in ((b'whale', 'whale'), (b'unknown', 'unreviewed'), (b'fine', None), (b'mine', None)):
        res = classify_raster(sha(blob), 'x.png', probe)
        if (res or {}).get('kind') != kind:
            errs.append(f'raster sample {blob!r}: expected {kind}, got {res}')
    if (classify_raster(sha(b'unknown'), r'C:\a\node_modules\b\test\x.png', probe) or {}).get('kind') != 'fixture':
        errs.append('fixture sample not recognised')
    for text, kind in (('<path d="M1 1c-.254-.124-.364.113"/>', 'whale'), ('<rect fill="#4D6BFE"/>', 'blue'), ('<rect fill="#0A0A0A"/>', None)):
        res = classify_svg(text, sha(text.encode()), probe)
        if (res or {}).get('kind') != kind:
            errs.append(f'svg sample {text!r}: expected {kind}, got {res}')
    if (classify_svg('<svg/>', sha(b'preview'), probe) or {}).get('kind') != 'preview':
        errs.append('known preview not recognised')
    return errs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--asar', action='append', default=[])
    ap.add_argument('--dir', action='append', default=[])
    ap.add_argument('--survey', action='store_true')
    ap.add_argument('--self-check', action='store_true')
    ap.add_argument('--json')
    ap.add_argument('--floor-raster', type=int, default=0, help='fail (2) when fewer raster pictures were read')
    ap.add_argument('--floor-text', type=int, default=0, help='fail (2) when fewer text files were read')
    ap.add_argument('--expect-findings', type=int, default=0, help='positive control: fail (2) unless at least this many findings')
    a = ap.parse_args()
    cat = Catalog()
    errs = [] if a.survey else self_check(cat)
    if a.self_check or errs:
        print('self-check:', 'FAILED' if errs else 'ok')
        for e in errs:
            print('  ', e)
        if errs or a.self_check:
            return 2 if errs else 0

    def sources() -> Iterator[tuple[str, bytes]]:
        for p in a.asar:
            yield from asar_files(Path(p))
        for d in a.dir:
            for name, p in dir_files(Path(d)):
                if p.suffix.lower() in RASTER_EXT | TEXT_EXT:
                    try:
                        yield name, p.read_bytes()
                    except OSError:
                        pass

    stats, found = scan(sources(), cat, survey=a.survey)
    if a.json:
        Path(a.json).write_text(json.dumps({'stats': stats, 'found': found}, indent=1), encoding='utf-8')
    print('read:', ', '.join(f'{v} {k}' for k, v in stats.items()))
    if a.survey:
        for f in found:
            print(f'  {f["kind"]:<5} {f["bytes"]:>8}B {f["sha256"]} {f["where"]}')
        return 0
    pics = stats['raster files'] + stats['raster data uris']
    if pics < a.floor_raster or stats['text files read'] < a.floor_text:
        print(f'  scan read too little ({pics} pictures, {stats["text files read"]} text files; floors {a.floor_raster}, {a.floor_text}): the result cannot be trusted')
        return 2
    if a.expect_findings:
        print(f'positive control: {len(found)} findings (at least {a.expect_findings} expected)')
        return 0 if len(found) >= a.expect_findings else 2
    for f in found:
        print(f'  FAIL {f["kind"]}: {f["why"]} [{f["how"]}] {f["where"]}')
    print('image scan:', 'FAIL' if found else 'pass', f'({len(found)} findings)')
    return 1 if found else 0


if __name__ == '__main__':
    sys.exit(main())
