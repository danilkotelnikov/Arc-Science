"""Build every Arc Science logo file from geometry and the MuseoModerno font.

The mark is the "as" monogram, drawn by GPT-Image (ChatGPT, 25 September 2026) and rebuilt here
from measured geometry: one stroke width, straight lines and circular arcs. All mark numbers are
in the units of the 1254 px original.

  a  top bar (y = Y_TOP) turning into the stem at radius R_TOP; the bowl is one circle with a flat
     top bar to the stem, minus a counter whose left side is a semicircle and whose bottom-right
     corner has radius R_COUNTER. Below the counter the stem turns right at radius R_FORK into the
     baseline of the s, which leaves a notch between the bowl and the baseline.
  s  top bar, upper-left semicircle down to the middle bar, a corner at radius R_SR into the right
     side, then straight down to one stroke above the baseline, which leaves the step at its
     bottom-right corner.

The wordmark is "ARC SCIENCE" in MuseoModerno Black (OFL 1.1, design/fonts/Museo Moderno), with
the font's GPOS pair kerning and no tracking. The lockup follows the operator's production files
(design/logo/as/as-logo-production-*.svg): the tile is 2.1 cap heights tall, the gap to the A is
0.45 cap heights, the capitals are centred on the tile, and the letters span 0.716 of the tile.

    PYTHONUTF8=1 python scripts/build-logo.py

Writes design/logo/as/ (mark, tiles, lockups), the workbench's src/brand/logo.js and favicon, and
the desktop window icon native/arc-desktop/assets/arc-icon.svg; then run scripts/make-icon.py for
the .ico. Needs fontTools and skia-pathops (pip install --user skia-pathops; BSD-3, a developer
tool, not shipped). Strokes are expanded and unioned, so every file is plain fills.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pathops
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from squircle import TILE_INSET, squircle_path  # noqa: E402

W = 92.0                       # stroke width
Y_TOP, Y_MID, Y_BASE = 442.0, 618.0, 813.0
R_TOP = 89.0                   # a: top bar into the stem (centreline)
R_S = (Y_MID - Y_TOP) / 2      # s: upper-left semicircle (centreline)
R_SR = 90.0                    # s: middle bar into the right side (centreline)
R_FORK = 120.0                 # stem into the baseline of the s (centreline)
R_COUNTER = 75.0               # a: bottom-right corner of the counter
X_A_LEFT, X_STEM = 389.0, 567.0
X_S_TOP_END, X_S_RIGHT, X_S_ARC = 962.0, 964.0, 777.0
BOWL_TOP = Y_BASE - 2 * 124.5  # centreline of the bowl's top bar
CX, CY = 414.0, (BOWL_TOP + Y_BASE) / 2
R_OUT = (Y_BASE - BOWL_TOP) / 2 + W / 2
R_IN = R_OUT - W

INK, PAPER, WHITE = '#111111', '#F7F5EF', '#FFFFFF'
FONT = ROOT / 'design' / 'fonts' / 'Museo Moderno' / 'MuseoModerno.ttf'
WORD, WEIGHT = 'ARC SCIENCE', 900
TILE_CAPS, GAP_CAPS, LETTERS_SPAN = 2.1, 0.45, 0.716  # measured from the production files

_x_in = X_STEM - W / 2
STROKES = [
    f'M {X_A_LEFT} {Y_TOP} H {X_STEM - R_TOP} A {R_TOP} {R_TOP} 0 0 1 {X_STEM} {Y_TOP + R_TOP} V {Y_BASE - R_FORK}',
    f'M {X_STEM} {Y_BASE - R_FORK} A {R_FORK} {R_FORK} 0 0 0 {X_STEM + R_FORK} {Y_BASE} H {X_S_RIGHT - W / 2}',
    f'M {X_S_TOP_END} {Y_TOP} H {X_S_ARC} A {R_S} {R_S} 0 0 0 {X_S_ARC} {Y_MID} '
    f'H {X_S_RIGHT - R_SR} A {R_SR} {R_SR} 0 0 1 {X_S_RIGHT} {Y_MID + R_SR} V {Y_BASE - W / 2}',
]
BOWL = f'M {CX} {CY - R_OUT} H {X_STEM} V {CY} H {CX + R_OUT} A {R_OUT} {R_OUT} 0 1 1 {CX} {CY - R_OUT} Z'
COUNTER = (f'M {CX} {CY - R_IN} H {_x_in} V {Y_BASE - W / 2 - R_COUNTER} '
           f'A {R_COUNTER} {R_COUNTER} 0 0 1 {_x_in - R_COUNTER} {Y_BASE - W / 2} H {CX} '
           f'A {R_IN} {R_IN} 0 0 1 {CX} {CY - R_IN} Z')


def _num(value: float) -> str:
    text = f'{value:.1f}'.rstrip('0').rstrip('.')
    return '0' if text in ('-0', '') else text


def _path(d: str) -> pathops.Path:
    shape = pathops.Path()
    parse_path(d, shape.getPen())
    return shape


def letters() -> pathops.Path:
    """The "as" as one filled outline, in source units."""
    ink = pathops.op(_path(BOWL), _path(COUNTER), pathops.PathOp.DIFFERENCE)
    for d in STROKES:
        line = _path(d)
        line.stroke(W, pathops.LineCap.BUTT_CAP, pathops.LineJoin.MITER_JOIN, 4)
        ink = pathops.op(ink, line, pathops.PathOp.UNION)
    ink = pathops.op(ink, _path(COUNTER), pathops.PathOp.DIFFERENCE)  # the stem stroke crosses the counter's edge
    ink.simplify()
    return ink


def _d(path: pathops.Path, scale: float, dx: float, dy: float) -> str:
    pen = SVGPathPen(None, ntos=_num)
    path.draw(TransformPen(pen, (scale, 0, 0, scale, dx, dy)))
    return pen.getCommands()


def _kerning(font: TTFont):
    """(left glyph, right glyph) -> x advance from the GPOS 'kern' pair lookups (formats 1 and 2)."""
    gpos = font['GPOS'].table if 'GPOS' in font else None
    if not gpos or not gpos.FeatureList:
        return lambda left, right: 0
    lookups = []
    for index in sorted({i for r in gpos.FeatureList.FeatureRecord if r.FeatureTag == 'kern' for i in r.Feature.LookupListIndex}):
        lookup = gpos.LookupList.Lookup[index]
        tables = [t.ExtSubTable if lookup.LookupType == 9 else t for t in lookup.SubTable]
        lookups.append([t for t in tables if getattr(t, 'LookupType', lookup.LookupType) == 2])

    def pair(left: str, right: str) -> int:
        total = 0
        for tables in lookups:  # each lookup applies once; its first matching subtable decides
            for table in tables:
                if left not in table.Coverage.glyphs:
                    continue
                if table.Format == 1:
                    pairs = table.PairSet[table.Coverage.glyphs.index(left)].PairValueRecord
                    record = next((r for r in pairs if r.SecondGlyph == right), None)
                    if record is None:
                        continue
                    value = record.Value1
                else:
                    first, second = table.ClassDef1.classDefs.get(left, 0), table.ClassDef2.classDefs.get(right, 0)
                    value = table.Class1Record[first].Class2Record[second].Value1
                total += int(getattr(value, 'XAdvance', 0) or 0) if value is not None else 0
                break
        return total

    return pair


def wordmark() -> tuple[str, tuple[float, float, float, float], float]:
    """The word as one path (baseline at y = 0, y down), its bounds and the cap height."""
    font = instancer.instantiateVariableFont(TTFont(FONT), {'wght': WEIGHT})
    cmap, glyphs, kern = font.getBestCmap(), font.getGlyphSet(), _kerning(font)
    names = [cmap[ord(ch)] for ch in WORD]
    pen, bounds, x = SVGPathPen(glyphs, ntos=_num), BoundsPen(glyphs), 0.0
    for i, name in enumerate(names):
        for target in (pen, bounds):
            glyphs[name].draw(TransformPen(target, (1, 0, 0, -1, x, 0)))
        x += glyphs[name].width + (kern(name, names[i + 1]) if i + 1 < len(names) else 0)
    return pen.getCommands(), bounds.bounds, float(font['OS/2'].sCapHeight)


def build() -> tuple[dict[str, str], dict]:
    """File name -> text for design/logo/as/, and the lockup geometry for the workbench."""
    ink = letters()
    x0, y0, x1, y1 = ink.bounds
    art_w, art_h = x1 - x0, y1 - y0

    def placed(tile_size: float, left: float, top: float) -> str:
        """The letters centred on a tile, at LETTERS_SPAN of its width."""
        k = LETTERS_SPAN * tile_size / art_w
        return _d(ink, k, left + (tile_size - art_w * k) / 2 - x0 * k, top + (tile_size - art_h * k) / 2 - y0 * k)

    def svg(view: str, body: str, title: str) -> str:
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}">\n  <title>{title}</title>\n{body}</svg>\n'

    files = {}
    s = 0.84 * 1024 / art_w
    files['as-mark.svg'] = svg('0 0 1024 1024', f'  <path id="letters" fill="currentColor" d="{_d(ink, s, (1024 - art_w * s) / 2 - x0 * s, (1024 - art_h * s) / 2 - y0 * s)}"/>\n', 'Arc Science')
    side = 1024 - 2 * TILE_INSET
    icon_tile, icon_letters = squircle_path(side, x=TILE_INSET, y=TILE_INSET), placed(side, TILE_INSET, TILE_INSET)
    for name, tile_fill, letter_fill in (('as-tile.svg', INK, PAPER), ('as-tile-light.svg', WHITE, INK)):
        files[name] = svg('0 0 1024 1024', f'  <path id="tile" fill="{tile_fill}" d="{icon_tile}"/>\n'
                                           f'  <path id="letters" fill="{letter_fill}" d="{icon_letters}"/>\n', 'Arc Science')

    word, (wx0, wy0, wx1, wy1), cap = wordmark()
    size = TILE_CAPS * cap
    top = -cap / 2 - size / 2  # capitals centred on the tile
    dx = size + GAP_CAPS * cap - wx0  # the word's left edge one gap after the tile
    word_d = _d(_path(word), 1, dx, 0)
    lockup = {'viewBox': f'0 {_num(top)} {_num(dx + wx1)} {_num(size)}',
              'tile': squircle_path(size, y=top), 'letters': placed(size, 0, top), 'word': word_d}
    for name, tile_fill, letter_fill, word_fill in (('as-lockup-dark.svg', INK, PAPER, WHITE),
                                                    ('as-lockup-light.svg', WHITE, INK, INK)):
        files[name] = svg(lockup['viewBox'], f'  <path id="tile" fill="{tile_fill}" d="{lockup["tile"]}"/>\n'
                                             f'  <path id="letters" fill="{letter_fill}" d="{lockup["letters"]}"/>\n'
                                             f'  <path id="wordmark" fill="{word_fill}" d="{word_d}"/>\n', 'Arc Science')
    info = {'cap': cap, 'tile': (0.0, top, size), 'word_bounds': (wx0 + dx, wy0, wx1 + dx, wy1), 'lockup': lockup}
    return files, info


def main(argv: list[str] | None = None) -> int:
    files, info = build()
    out = ROOT / 'design' / 'logo' / 'as'
    out.mkdir(parents=True, exist_ok=True)
    for name, text in files.items():
        (out / name).write_text(text, encoding='utf-8', newline='\n')
    web = ROOT / 'apps' / 'arc-science' / 'web'
    lockup = info['lockup']
    module = ('// Generated by scripts/build-logo.py from the "as" geometry and MuseoModerno Black; do not edit.\n'
              + ''.join(f"export const LOCKUP_{key.upper()} = '{value}';\n"
                        for key, value in (('viewbox', lockup['viewBox']), ('tile', lockup['tile']),
                                           ('letters', lockup['letters']), ('word', lockup['word']))))
    (web / 'src' / 'brand').mkdir(exist_ok=True)
    (web / 'src' / 'brand' / 'logo.js').write_text(module, encoding='utf-8', newline='\n')
    (web / 'public' / 'favicon.svg').write_text(files['as-tile.svg'], encoding='utf-8', newline='\n')
    (ROOT / 'native' / 'arc-desktop' / 'assets' / 'arc-icon.svg').write_text(files['as-tile.svg'], encoding='utf-8', newline='\n')
    print(f"wrote {len(files)} files to {out}, src/brand/logo.js, public/favicon.svg and the desktop icon SVG")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
