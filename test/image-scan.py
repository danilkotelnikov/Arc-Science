"""Find the old vendor's whale, and its blue, in pictures. The text scans cannot see pictures; this scan reads them by content.

    python test/image-scan.py --asar build/app.asar --dir ~/.arc/profiles/web [--dir ...] [--floor-raster N] [--floor-text N]
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
import math
import os
import re
import struct
import sys
import urllib.parse
from pathlib import Path
from typing import Any, Iterator

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
CATALOG = KIT / 'brand' / 'pictures.json'
DIST = KIT / 'brand' / 'dist'
RASTER_EXT = {'.png', '.webp', '.ico', '.gif', '.jpg', '.jpeg', '.bmp', '.avif'}
TEXT_EXT = {'.js', '.mjs', '.cjs', '.css', '.html', '.htm', '.json', '.svg', '.md', '.yml', '.yaml', '.txt', '.ts'}
MAX_IMAGE, MAX_TEXT = 24 * 2**20, 14 * 2**20
DATA_URI = re.compile(rb'data:image\\?/(png|webp|gif|jpe?g|x-icon|vnd\.microsoft\.icon|svg\+xml)(?:;charset=[\w-]+)?;base64,([A-Za-z0-9+/=]+)')
# skipped on purpose: the translation tool of this kit keeps old copies of plugin files; no profile loads it and it leaves with the rename slices
SKIP = re.compile(r'[\\/]local-plugins[\\/](?:dsh|arc)-english[\\/]')
# (the DevTools icon folder of the inspector package is third-party artwork: generic icons, never the whale; the whale list is still checked first)
FIXTURE_DIR = re.compile(r'[\\/](test|tests|__tests__|fixtures|fonts|demo|examples?)[\\/]|[\\/]lib[\\/]devtools[\\/]', re.I)
# path fragments of the whale drawn as vector art (the mark as used in the original app and in its plugins)
FINGERPRINTS = ('c-.254-.124-.364.113', 'M22.9168 1.43018', '11.365 11.365 0 00-.689-.471')
BLUE = {'#4d6bfe', '#4a5699', '#6277ba', '#324de2', '#69b9ff', '#658eff', '#a23ae7'}   # the vendor blue, two plugin blues, the blues and the purple of the plugin artwork
BLUE_TEXT = re.compile('|'.join(sorted(re.escape(c) for c in BLUE)) + r'|rgb\(\s*101\s*,\s*142\s*,\s*255\s*\)', re.I)   # in scripts, styles and pages as well
BLUE_TEXT_B = re.compile(BLUE_TEXT.pattern.encode(), re.I)
# Any blue or violet colour by hue (190 to 300 degrees, saturation above 0.25): hex, #rrggbbaa, rgb() and rgba() in scripts, styles,
# pages and SVG files. The same test lib/iconcolor.mjs recolorBlueHues applies. Third-party code and palettes that must keep their
# colours are listed here, each with its reason; a hit anywhere else fails.
HUE_EXT = {'.js', '.mjs', '.cjs', '.css', '.html', '.htm', '.svg', '.json'}
HUE_HEX = re.compile(rb'(?<![\w&])(?<!url\()#([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?(?![0-9a-zA-Z])')
HUE_RGB = re.compile(rb'\brgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})', re.I)   # commas or spaces
HUE_HSL = re.compile(rb'\bhsla?\(\s*(-?[\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%', re.I)
HUE_HWB = re.compile(rb'\bhwb\(\s*(-?[\d.]+)(?:deg)?\s', re.I)
HUE_LCH = re.compile(rb'\b(ok)?lch\(\s*[\d.]+%?\s+([\d.]+%?)\s+([\d.]+)', re.I)   # oklch and lch: lightness chroma hue
# named CSS colours in blue and violet: only where a colour is written (a colour property in a style, an SVG colour attribute)
NAMED_BLUE = (b'blue|mediumblue|darkblue|navy|midnightblue|royalblue|dodgerblue|deepskyblue|cornflowerblue|steelblue|slateblue|'
              b'darkslateblue|mediumslateblue|indigo|blueviolet|darkviolet|darkorchid|mediumorchid|violet|purple|mediumpurple|rebeccapurple|'
              b'lightskyblue|skyblue|lightsteelblue|lightblue|aliceblue|cadetblue')
NAMED_RE = re.compile(rb'(?:\b(?:color|bgcolor|background(?:-color)?|border(?:-[a-z]+)?-color|outline(?:-color)?|fill|stroke|stop-color)\s*[:=]\s*["\']?(?:' + NAMED_BLUE + rb')\b)', re.I)
# the same as an attribute of markup in a page (color="blue", bgcolor="navy"); prose such as "color: blue" does not count
NAMED_ATTR = re.compile(rb'\b(?:color|bgcolor|fill|stroke|stop-color)\s*=\s*["\']?(?:' + NAMED_BLUE + rb')\b', re.I)
# a named colour as a value inside any CSS declaration (borders, shadows, gradients), not as a class or id name
NAMED_CSS_RE = re.compile(rb':\s*[^;{}]*?(?<![.#\w-])(?:' + NAMED_BLUE + rb')(?![\w-])', re.I)
# a named colour as a colour property or canvas style in script
NAMED_JS_RE = re.compile(rb'(?:fillStyle|strokeStyle|shadowColor|backgroundColor|borderColor|\.color|\bfill|\bstroke|\bcolor)["\']?\s*[:=]\s*["\'`](?:' + NAMED_BLUE + rb')["\'`]', re.I)
# the three- and four-digit shorthand, where it is a colour: inside a CSS declaration, or an SVG colour attribute
SHORT_DECL = re.compile(rb':([^;{}]*)(?=[;}]|$)')   # the value of a declaration: it ends at ; or } (a { means it was a selector)
SHORT_CSS_RE = re.compile(rb'(?<![\w&#-])(?<!url\()#([0-9a-fA-F]{3,4})(?![0-9a-zA-Z-])')
SHORT_SVG_RE = re.compile(rb'(?:fill|stroke|stop-color|color|bgcolor)=["\']#([0-9a-fA-F]{3,4})["\']', re.I)
# a style file without its comments; strings and url(...) are kept whole, so a comment mark inside one does not start a comment
# (a string that is not closed before the line ends is kept to the end of the line, so its text stays visible)
CSS_TOKEN = re.compile(rb'("(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\'|url\([^)]*\)|"[^"\n]*|\'[^\'\n]*)|/\*.*?\*/', re.S)
# style blocks and style attributes of a page: the only places where a page holds style declarations
HTML_STYLE = re.compile(rb'<style\b[^>]*>(.*?)</style>|\bstyle\s*=\s*"([^"]*)"|\bstyle\s*=\s*\'([^\']*)\'', re.S | re.I)
HUE_LAB = re.compile(rb'\b(ok)?lab\(\s*[\d.]+%?\s+(-?[\d.]+)\s+(-?[\d.]+)', re.I)   # oklab and lab: lightness a b
HUE_ALLOW = [
    (re.compile(r'[\\/]lib[\\/]devtools[\\/]|[\\/]debug[\\/]src[\\/]'), 'DevTools frontend and the debug library (third party)'),
    (re.compile(r'(?:dsh|arc)-client-ui-sidebar-terminal'), 'terminal palette: ANSI blue is a terminal colour'),
    (re.compile(r'(?:dsh|arc)-client-ui-sidebar-documentpreview[\\/]lib[\\/]client\.(?:excel|pdf)\.js$'),
     'spreadsheet and PDF viewers: chart palettes and colour pickers of the user\'s own data, the hyperlink cell colour (rgb(0, 0, 255)), example colours named in its help text, the near-white toolbar background (#fafafc) and PDF highlight colour choices; the spreadsheet interface colours are replaced by build patch 8d, and test/build-check.mjs pins every blue colour the spreadsheet file may keep (hex, rgb() and hsl() forms, with counts)'),
    (re.compile(r'[\\/]vendor-[^\\/]*\.js$'), 'vendor bundle of libraries'),
    (re.compile(r'[\\/](?:mermaid|khroma|cytoscape[\w-]*|tinycolor2|@upsetjs|react-icons|katex|@codemirror|@xterm|jimp|qrcode|(?:ds|arc)-harness-remote)[\\/]'),
     'third-party libraries (diagrams, colour maths, graphs, icons, math, editor, terminal, images) and the switched-off remote plugin'),
    (re.compile(r'[\\/]node_modules[\\/]es-toolkit[\\/]'),
     'es-toolkit, a utility library whose code examples name colours (color: \'purple\'); only the installed package folder'),
    (re.compile(r'[\\/](?:dsh|arc)-better-sidebar[\\/]lib[\\/]client-(?:terminal|editor|mermaid)\.'),
     'bundled terminal, code editor and diagram libraries (ANSI colours, syntax categories and diagram themes keep their colours)'),
    (re.compile(r'[\\/]@nagi-ovo[\\/](?:dsh|arc)-visualize[\\/]'),
     'Visualize chart series palettes (charts keep their colours); its interface colours are replaced by apply-profiles and checked by the apply-profiles tool'),
    (re.compile(r'[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+[\\/]node_modules[\\/]'), 'nested third-party packages'),
]


def _hsl(r: int, g: int, b: int) -> tuple[float, float, float]:
    rf, gf, bf = r / 255, g / 255, b / 255
    mx, mn = max(rf, gf, bf), min(rf, gf, bf)
    l = (mx + mn) / 2
    if mx == mn:
        return 0.0, 0.0, l
    d = mx - mn
    s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
    h = ((gf - bf) / d + (6 if gf < bf else 0)) if mx == rf else ((bf - rf) / d + 2) if mx == gf else ((rf - gf) / d + 4)
    return h * 60, s, l


def blue_hue_hit(buf: bytes, ext: str = '.js') -> str | None:
    """First blue or violet colour in the text, or None. Forms: #rrggbb(aa), rgb()/rgba() with commas or spaces, hsl(), hwb(),
    oklch(), lch(), oklab() and lab(); by file type also named colours (styles: any declaration value; SVG: colour attributes;
    script: colour properties and canvas styles) and the three-digit shorthand (styles and SVG). Comments of a style file are not read."""
    if ext == '.css':
        buf = CSS_TOKEN.sub(lambda m: m.group(1) or b'', buf)
    for m in HUE_HEX.finditer(buf):
        h = m.group(1)
        hh, s, _ = _hsl(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
        if s > 0.2 and 190 <= hh <= 300:
            return m.group(0).decode()
    for m in HUE_RGB.finditer(buf):
        r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if max(r, g, b) > 255:
            continue
        hh, s, _ = _hsl(r, g, b)
        if s > 0.2 and 190 <= hh <= 300:
            return m.group(0).decode()
    for m in HUE_HSL.finditer(buf):
        if float(m.group(2)) > 20 and 190 <= float(m.group(1)) % 360 <= 300:
            return m.group(0).decode()
    for m in HUE_HWB.finditer(buf):
        if 190 <= float(m.group(1)) % 360 <= 300:
            return m.group(0).decode()
    for m in HUE_LCH.finditer(buf):
        chroma = float(m.group(2).rstrip(b'%')) / (100 if m.group(2).endswith(b'%') else 1) * (1 if m.group(1) else 1 / 150)
        if chroma >= 0.035 and (215 <= float(m.group(3)) <= 335):
            return m.group(0).decode()
    for m in HUE_LAB.finditer(buf):
        a, b = float(m.group(2)), float(m.group(3))
        chroma = math.hypot(a, b) * (1 if m.group(1) else 1 / 150)
        if chroma >= 0.035 and 215 <= math.degrees(math.atan2(b, a)) % 360 <= 335:
            return m.group(0).decode()
    if ext in {'.css', '.html', '.htm'}:
        # a style file is all declarations; a page holds them in style blocks and style attributes only (prose is not a declaration)
        css = buf if ext == '.css' else CSS_TOKEN.sub(lambda m: m.group(1) or b'', b';'.join(m.group(1) or m.group(2) or m.group(3) or b'' for m in HTML_STYLE.finditer(buf)))
        for rx in (NAMED_RE, NAMED_CSS_RE):
            n = rx.search(css)
            if n:
                return n.group(0).decode()
        for d in SHORT_DECL.finditer(css):
            for n in SHORT_CSS_RE.finditer(d.group(1)):
                if _short_blue(n.group(1)):
                    return n.group(0).decode()
    if ext in {'.svg', '.html', '.htm'}:   # colour attributes of SVG and of old-style markup (fill, stroke, color, bgcolor)
        n = (NAMED_RE if ext == '.svg' else NAMED_ATTR).search(buf)
        if n:
            return n.group(0).decode()
        for n in SHORT_SVG_RE.finditer(buf):
            if _short_blue(n.group(1)):
                return n.group(0).decode()
    if ext in {'.js', '.mjs', '.cjs', '.html', '.htm', '.json'}:
        n = NAMED_JS_RE.search(buf)
        if n:
            return n.group(0).decode()
    return None


def _short_blue(h: bytes) -> bool:
    r, g, b = (int(c * 2, 16) for c in h.decode()[:3])   # #rgba: the alpha digit is ignored
    hh, s, _ = _hsl(r, g, b)
    return s > 0.2 and 190 <= hh <= 300
# an svg data URI that is not base64, as written in CSS or script: it ends at a closing quote and bracket (quotes may sit inside it)
DATA_SVG_PLAIN = re.compile(rb"""data:image\\?/svg\+xml(?:;charset=[\w-]+|;utf8)?,(.{20,4000}?)(?=\"\)|'\)|\"[;}\s,]|`)""", re.S)


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
    for m in re.finditer(r'#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b', text):   # also #rrggbbaa
        if m.group(0).lower()[:7] in BLUE:
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
    stats = {'skipped files': 0, 'files': 0, 'raster files': 0, 'svg files': 0, 'raster data uris': 0, 'svg data uris': 0, 'text files read': 0, 'fixture pictures': 0, 'blue-hue files judged': 0, 'blue-hue files not judged': 0}
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
                bm = BLUE_TEXT_B.search(buf)   # the artwork colours of the vendor in script, style and page text (gradient stops, rgb() in gradients)
                if bm:
                    found.append({'where': name, 'how': 'text', 'kind': 'blue', 'why': f'colour {bm.group(0).decode()}'})
            if not survey and ext in HUE_EXT:
                allowed = next((why for rx, why in HUE_ALLOW if rx.search(name)), None) or ('third-party test, fixture or demo file' if FIXTURE_DIR.search(name) else None)
                if allowed:
                    stats['blue-hue files not judged'] += 1
                else:
                    stats['blue-hue files judged'] += 1
                    hit = blue_hue_hit(buf, ext=ext)
                    if hit:
                        found.append({'where': name, 'how': 'hue', 'kind': 'blue', 'why': f'blue or violet colour {hit}'})
            if b'data:image' not in buf:
                continue
            for m in DATA_SVG_PLAIN.finditer(buf):
                stats['svg data uris'] += 1
                if survey:
                    continue
                decoded = urllib.parse.unquote(m.group(1).decode('utf-8', 'replace'))
                res = classify_svg(decoded, sha(m.group(1)), cat)
                if not res and not FIXTURE_DIR.search(name) and not any(rx.search(name) for rx, _why in HUE_ALLOW):
                    hue = blue_hue_hit(decoded.encode('utf-8', 'replace'), ext='.svg')   # also rgb(), the shorthand and hues that are not on the vendor list
                    res = {'kind': 'blue', 'why': f'svg colour {hue}'} if hue else None
                if res:
                    found.append({'where': name, 'how': 'svg data uri (not base64)', 'sha256': sha(m.group(1)), **res})
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
    if not BLUE_TEXT_B.search(b'd.jsx("stop",{stopColor:"#69B9FF"})') or not BLUE_TEXT_B.search(b'conic-gradient(from 90deg, rgb(101, 142, 255) 62deg)'):
        errs.append('vendor blue in script text not detected')
    if BLUE_TEXT_B.search(b'stopColor:"#E2E2E2"'):
        errs.append('plain grey flagged as blue')
    for good in (b'linear-gradient(100deg,#03040a 0%,#101d4c 45%,#5d35a0 100%)', b'box-shadow:0 0 7px rgba(82,130,255,.12)', b'color:#1c00cf',
                 b'--c:oklch(62.3% .214 259.8)', b'--c:oklch(60.6% .25 292.7 / 40%)', b'color:hsl(220,70%,50%)', b'color:hsl(220deg 70% 50% / .4)',
                 b'color:rgb(60 80 250)', b'color:rgb(60 80 250 / 40%)', b'COLOR:RGB(10,20,250)', b'x:lch(50% 80 290)', b'x:hwb(230 10% 10%)'):
        if not blue_hue_hit(good):
            errs.append(f'blue by hue not detected: {good!r}')
    for text, ext in ((b'a{color: royalblue}', '.css'), (b'a{border:1px solid blue}', '.css'), (b'a{background:linear-gradient(to right, blue, red)}', '.css'),
                      (b'a{box-shadow:0 0 4px 1px Navy}', '.css'), (b'a{color:#36f}', '.css'), (b'<rect fill="blue"/>', '.svg'), (b'<rect fill="#36f"/>', '.svg'),
                      (b'ctx.fillStyle="royalblue"', '.js'), (b'el.style.color = \'blue\'', '.js'), (b'x:lab(50 20 -80)', '.css'), (b'x:oklab(62% -0.03 -0.2)', '.css'),
                      (b'{"accent":"oklch(62% .2 260)"}', '.json'), (b'{"accent":"#4d6bfe"}', '.json'),
                      # a blue shorthand after an earlier white one, minified and with a gradient, four digits, SVG with two attributes
                      (b'a{color:#fff}b{color:#36f}', '.css'), (b'a{color:#fff;background:#36f}', '.css'), (b'a{background:linear-gradient(#fff,#36f)}', '.css'),
                      (b'a{color:#36fa}', '.css'), (b'<rect fill="#fff"/><rect fill="#36f"/>', '.svg'),
                      # a comment mark inside a string or url() does not start a comment that would hide the colour after it
                      (b'a{background:url(data:image/svg+xml;utf8,<svg>/*</svg>)} b{color:royalblue} /* end */', '.css'),
                      (b'a{content:"/*"} b{color:#4040ff} c{content:"*/"}', '.css'), (b'a{content:"/*";color:#3366ff} /* x */', '.css'),
                      # style blocks and attributes in a page, a quoted key in JSON
                      (b'<div style="color:blue">', '.html'), (b'<div style="color:#36f">', '.html'), (b'<style>a{color:navy}</style>', '.html'),
                      (b'{"color":"blue"}', '.json'),
                      # a string that is never closed must not swallow the colour after it; old-style markup colours; a selector then a declaration
                      (b"a{x:'oops /* c\n} b{color:#4040ff}\n/* d */", '.css'), (b'<font color="#36f">x</font>', '.html'), (b'<td bgcolor="navy">', '.html'),
                      (b'<svg><rect fill="#36f"/></svg>', '.html'), (b'a:hover #bad{margin:0}b{color:#36f}', '.css'), (b'<p style="margin:0;color:#36f">x</p>', '.html')):
        if not blue_hue_hit(text, ext=ext):
            errs.append(f'blue not detected in {ext}: {text!r}')
    for text, ext in ((b'/* the shell\'s :is(button, a) rule keeps a navy tone */ a{margin:0}', '.css'), (b'.blue{margin:0} a:hover .indigo{margin:0} #violet{x:1}', '.css'), (b'a{color:#fab;border:1px solid #f60}', '.css'), (b'<rect fill="#fa0"/>', '.svg'),
                      (b'x:oklab(70% 0.1 0.05)', '.css'), (b'var blue = 3; var purple = "name"', '.js'),
                      (b'/* a navy note */ a{color:#fff} /* #36f is gone */', '.css'), (b'<a href="#add">x</a>', '.html'), (b'a{content:"&#123;"}', '.css'),
                      (b'a:hover #bad{margin:0}', '.css'), (b'a:not(.x) #abd{margin:0}', '.css'), (b'<p>Note: item #bad</p>', '.html'), (b'<p>issue: #123 and #abc, color: blue is a name</p>', '.html')):
        if blue_hue_hit(text, ext=ext):
            errs.append(f'class name, warm shorthand or non-colour flagged in {ext}: {text!r}')
    for fine in (b'color:#22c55e;background:#f59e0b;border:1px solid rgb(239,68,68)', b'fill:#54ECE7', b'color:#26231f;background:#faf9f6',
                 b'x:oklch(65.6% .241 354.3)', b'x:oklch(70% .15 145)', b'x:hsl(30,60%,50%)', b'&#128199; url(#3366ff) a#3366ff', b'.blue{margin:0} --color-blue-500:var(--x)'):
        if blue_hue_hit(fine, ext='.css'):
            errs.append(f'status, neutral or non-colour text flagged as blue: {fine!r}')
    if (classify_svg('<rect fill="#4D6BFEcc"/>', sha(b'x'), probe) or {}).get('kind') != 'blue':
        errs.append('blue with alpha (#rrggbbaa) not detected')
    if '.avif' not in RASTER_EXT or not DATA_SVG_PLAIN.search(b'x=url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%22%3E%3C%2Fsvg%3E")'):
        errs.append('avif files or plain svg data URIs not read')
    quoted = DATA_SVG_PLAIN.search(b'''a{background:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><rect fill='%234d6bfe'/></svg>")}''')
    if not quoted or '%234d6bfe' not in quoted.group(1).decode():
        errs.append('plain svg data URI with quotes inside not read to its end')
    return errs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--asar', action='append', default=[])
    ap.add_argument('--dir', action='append', default=[])
    ap.add_argument('--survey', action='store_true')
    ap.add_argument('--self-check', action='store_true')
    ap.add_argument('--json')
    ap.add_argument('--floor-raster', type=int, default=1, help='fail (2) when fewer raster pictures were read (default 1: a scan that read nothing never passes)')
    ap.add_argument('--floor-text', type=int, default=1, help='fail (2) when fewer text files were read (default 1)')
    ap.add_argument('--floor-hue', type=int, default=0, help='fail (2) when fewer script, style, page and SVG files went through the blue-hue check')
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
    if pics < a.floor_raster or stats['text files read'] < a.floor_text or stats['blue-hue files judged'] < a.floor_hue:
        print(f'  scan read too little ({pics} pictures, {stats["text files read"]} text files, {stats["blue-hue files judged"]} hue-checked files; floors {a.floor_raster}, {a.floor_text}, {a.floor_hue}): the result cannot be trusted')
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
