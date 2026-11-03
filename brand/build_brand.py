"""Build the Arc Harness brand files from the Arc Science AS cube.

Reads (never writes) the brand cube folder and the C2 UI preview:
  <ARC_BRAND_SRC>/Brand cube AS 2026-10-19     cube-as-left-black.svg, cube-mark-black.svg (the AS cube, one colour)
  <ARC_BRAND_SRC>/Cammut + Arc Science UI preview 2026-10-23/UI-preview-C2.html   Geist and Geist Mono (OFL), licence text

    PYTHONUTF8=1 python brand/build_brand.py

Writes brand/dist/: brand.json (paths for the patcher), cube-as.svg, cube-mark.svg, favicon.svg, favicon-dark.svg,
geist.css (Geist and Geist Mono as embedded fonts), GEIST-OFL.txt, icon.png (1024) and tray.ico.
Colours: the cube is one colour, #0A0A0A on light pages and white on dark pages.
The AS cube (letters on the left face) is the logo at every size, favicons included. Only the moving running indicator in the
chat keeps the plain cube (cube-mark.svg, leftPlain), because it is an animation and not the logo. The product name is live text in Geist 600.
"""
from __future__ import annotations

import importlib.util
import json
import re
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image

# The brand sources and the rasteriser live outside this repository; set ARC_BRAND_SRC and ARC_SVG2PNG to rebuild brand/dist.
DESK = Path(os.environ.get('ARC_BRAND_SRC', 'brand-src'))
CUBE_DIR = DESK / 'Brand cube AS 2026-10-19'
C2 = DESK / 'Cammut + Arc Science UI preview 2026-10-23' / 'UI-preview-C2.html'
RASTERISER = Path(os.environ.get('ARC_SVG2PNG', 'arc-svg2png.exe'))
HERE = Path(__file__).resolve().parent
OUT = HERE / 'dist'
INK, WHITE, PAPER = '#0A0A0A', '#FFFFFF', '#FAF9F6'
VIEW = '0 0 256 256'


def paths(svg_file: Path) -> list[str]:
    return re.findall(r'<path d="([^"]+)"', svg_file.read_text(encoding='utf-8'))


def squircle_path(side: float, x: float, y: float) -> str:
    sys.path.insert(0, str(REPO / 'scripts'))
    spec = importlib.util.spec_from_file_location('arc_squircle', REPO / 'scripts' / 'squircle.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.squircle_path(side, x=x, y=y)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    as_top, as_left, as_right = paths(CUBE_DIR / 'cube-as-left-black.svg')
    mk_top, mk_left, mk_right = paths(CUBE_DIR / 'cube-mark-black.svg')
    assert as_top == mk_top and as_right == mk_right, 'the AS cube and the mark must share top and right faces'

    r_top, r_left, r_right = paths(CUBE_DIR / 'cube-as-right-black.svg')   # letters on the right face
    assert r_top == as_top, 'the right-face cube must share the top face'
    brand = {
        'view': VIEW, 'ink': INK, 'white': WHITE,
        'top': as_top, 'right': as_right, 'leftAS': as_left, 'leftPlain': mk_left,
        'rightFaceLeft': r_left, 'rightFaceRight': r_right,
    }
    (OUT / 'brand.json').write_text(json.dumps(brand), encoding='utf-8')

    def svg(fill: str, left: str) -> str:
        body = ''.join(f'<path d="{d}" fill="{fill}" fill-rule="evenodd"/>' for d in (as_top, left, as_right))
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{VIEW}"><title>Arc Harness</title>{body}</svg>\n'

    (OUT / 'cube-as.svg').write_text(svg(INK, as_left), encoding='utf-8')
    (OUT / 'cube-mark.svg').write_text(svg(INK, mk_left), encoding='utf-8')
    (OUT / 'favicon.svg').write_text(svg(INK, as_left), encoding='utf-8')          # light tab strips
    (OUT / 'favicon-dark.svg').write_text(svg(WHITE, as_left), encoding='utf-8')   # dark tab strips

    # app icon: cream tile with the AS cube, readable on light and dark task bars
    side, inset = 960.0, 32.0
    k = 2.45
    off = (1024 - 256 * k) / 2
    cube = ''.join(f'<path d="{d}" fill="{INK}" fill-rule="evenodd"/>' for d in (as_top, as_left, as_right))
    icon_svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="{squircle_path(side, inset, inset)}" fill="{PAPER}"/>'
                f'<g transform="translate({off:.1f} {off:.1f}) scale({k})">{cube}</g></svg>')
    tmp = OUT / '_icon.svg'
    tmp.write_text(icon_svg, encoding='utf-8')
    subprocess.run([str(RASTERISER), str(tmp), str(OUT / 'icon.png'), '1024'], check=True)
    tmp.unlink()
    Image.open(OUT / 'icon.png').convert('RGBA').save(OUT / 'tray.ico', format='ICO', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])

    # Geist and Geist Mono, unmodified, with the licence text from the preview file
    html = C2.read_text(encoding='utf-8')
    faces = re.findall(r'@font-face\s*\{[^}]*\}', html)
    assert len(faces) == 2, 'expected Geist and Geist Mono'
    (OUT / 'geist.css').write_text('\n'.join(faces) + '\n', encoding='utf-8')
    lic = re.search(r'<!--\s*(Fonts embedded in this file.*?)-->', html, re.S)
    (OUT / 'GEIST-OFL.txt').write_text(lic.group(1).strip() + '\n' if lic else 'Geist: SIL Open Font License 1.1\n', encoding='utf-8')
    # pictures that take the place of the old vendor's mark where an app or plugin file holds it as a PNG (lib/whaleimg.mjs picks by size)
    tiles = OUT / 'tiles'
    tiles.mkdir(exist_ok=True)
    icon = Image.open(OUT / 'icon.png').convert('RGBA')
    for px in (512, 64, 32):
        icon.resize((px, px), Image.Resampling.LANCZOS).save(tiles / f'tile-{px}.png', optimize=True)
    # a 28 px glyph: the cube alone in ink on a clear background (the old picture was a one-colour mark)
    subprocess.run([str(RASTERISER), str(OUT / 'cube-as.svg'), str(tiles / 'glyph-28.png'), '28'], check=True)   # transparent background
    # the 726x120 badge: cube and the product name on paper
    from PIL import ImageDraw, ImageFont
    badge = Image.new('RGBA', (726, 120), PAPER)
    badge.alpha_composite(icon.resize((92, 92), Image.Resampling.LANCZOS), (24, 14))
    font = next((ImageFont.truetype(f, 46) for f in (r'C:/Windows/Fonts/segoeuib.ttf', r'C:/Windows/Fonts/arialbd.ttf') if Path(f).exists()), ImageFont.load_default())
    ImageDraw.Draw(badge).text((132, 60), 'Arc Harness', font=font, fill=INK, anchor='lm')
    badge.save(tiles / 'badge-726x120.png', optimize=True)
    # the plugin manager shows one preview picture per bundled plugin; the originals carry the old vendor's mark and blue, so two
    # replacements are drawn here (640x300, live text, ink and warm grey). The Chinese copies of the originals map to the same files.
    previews = OUT / 'previews'
    previews.mkdir(exist_ok=True)

    def cube_at(x: float, y: float, size: float, fill: str) -> str:
        paths = ''.join(f'<path d="{d}" fill="{fill}" fill-rule="evenodd"/>' for d in (as_top, as_left, as_right))
        return f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="{VIEW}">{paths}</svg>'

    def pill(x: float, y: float, k: float) -> str:
        w, h = 168 * k, 26 * k
        return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{4 * k}" fill="#54453c"/>'
                f'<rect x="{x + 3 * k}" y="{y + 3 * k}" width="{20 * k}" height="{20 * k}" rx="{4 * k}" fill="{PAPER}"/>'
                + cube_at(x + 4.5 * k, y + 4.5 * k, 17 * k, INK)
                + f'<text x="{x + 30 * k}" y="{y + 17 * k}" font-family="system-ui,Segoe UI,sans-serif" font-size="{11 * k}" fill="#ffffff">powered by <tspan font-weight="700">Arc Harness</tspan></text>')

    sans, serif = 'system-ui,Segoe UI,sans-serif', 'Georgia,Times New Roman,serif'

    def card(x: float, y: float, w: float, h: float) -> str:
        return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="#ffffff" stroke="#e4e0d6"/>'

    badge = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 300"><title>Arc Harness badge</title>'
             f'<rect width="640" height="300" fill="#f4f2ed"/>'
             f'<text x="24" y="84" font-family="{serif}" font-size="20" fill="#26231f">A signature for your work</text>'
             f'<text x="24" y="104" font-family="{sans}" font-size="10" fill="#75736c">Docs, projects, pull requests</text>'
             + card(24, 138, 262, 64) + pill(52, 157, 1.0)
             + card(340, 26, 272, 248)
             + f'<text x="364" y="62" font-family="{sans}" font-size="9" fill="#75736c">README.md</text>'
             f'<text x="364" y="96" font-family="{serif}" font-size="20" fill="#26231f">Project notes</text>'
             f'<text x="364" y="122" font-family="{sans}" font-size="10" fill="#54453c">Plan, build, and document</text>'
             f'<text x="364" y="137" font-family="{sans}" font-size="10" fill="#54453c">with Arc Harness.</text>'
             f'<line x1="364" y1="154" x2="588" y2="154" stroke="#e4e0d6"/>'
             + pill(364, 172, 0.9) + '</svg>\n')
    (previews / 'badge.svg').write_text(badge, encoding='utf-8')

    bars = [10, 18, 28, 14, 36, 24, 44, 30, 50, 34, 56, 40, 52, 36, 46, 28, 40, 22, 32, 16, 24, 12, 18, 10]
    wave = ''.join(f'<rect x="{48 + i * 9}" y="{175 - h / 2}" width="4" height="{h}" rx="2" fill="#54453c"/>' for i, h in enumerate(bars))
    voice = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 300"><title>Voice input</title>'
             f'<rect width="640" height="300" fill="#f4f2ed"/>'
             f'<text x="24" y="60" font-family="{serif}" font-size="22" fill="#26231f">Speak your thoughts.</text>'
             f'<text x="24" y="80" font-family="{sans}" font-size="10" fill="#75736c">Local voice transcription</text>'
             + card(24, 118, 268, 120).replace('#ffffff', '#ece9e2')
             + f'<text x="40" y="140" font-family="{sans}" font-size="9" fill="#75736c">Speech</text>' + wave
             + f'<path d="M304 178h22m-7-6 7 6-7 6" fill="none" stroke="#a89f94" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
             + card(344, 104, 268, 150)
             + f'<text x="362" y="128" font-family="{sans}" font-size="9" fill="#75736c">Transcript</text>'
             f'<text x="362" y="160" font-family="{serif}" font-size="18" fill="#26231f">Project notes</text>'
             f'<text x="362" y="184" font-family="{sans}" font-size="10" fill="#54453c">Capture the week’s progress</text>'
             f'<text x="362" y="199" font-family="{sans}" font-size="10" fill="#54453c">and keep the next steps.</text>'
             f'<line x1="362" y1="214" x2="594" y2="214" stroke="#e4e0d6"/></svg>\n')
    (previews / 'voice.svg').write_text(voice, encoding='utf-8')

    # hash list of the logo files: test/build-check.mjs compares against it, so a replaced icon is noticed
    import hashlib
    names = ('icon.png', 'tray.ico', 'cube-as.svg', 'cube-mark.svg', 'favicon.svg', 'favicon-dark.svg', 'brand.json',
             'tiles/tile-512.png', 'tiles/tile-64.png', 'tiles/tile-32.png', 'tiles/glyph-28.png', 'tiles/badge-726x120.png',
             'previews/badge.svg', 'previews/voice.svg')
    (OUT / 'SHA256SUMS.txt').write_text(''.join(f'{hashlib.sha256((OUT / n).read_bytes()).hexdigest()}  {n}\n' for n in names), encoding='utf-8')
    print(f'wrote {len(list(OUT.iterdir()))} files to {OUT}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
