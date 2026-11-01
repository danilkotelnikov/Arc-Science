"""Build the Arc Harness brand files from the Arc Science AS cube.

Reads (never writes) the brand cube folder and the C2 UI preview:
  Omniverso/Brand cube AS 2026-10-19      cube-as-left-black.svg, cube-mark-black.svg (the AS cube, one colour)
  Omniverso/Cammut + Arc Science UI preview 2026-10-23/UI-preview-C2.html   Geist and Geist Mono (OFL), licence text

    PYTHONUTF8=1 python brand/build_brand.py

Writes brand/dist/: brand.json (paths for the patcher), cube-as.svg, cube-mark.svg, favicon.svg, favicon-dark.svg,
geist.css (Geist and Geist Mono as embedded fonts), GEIST-OFL.txt, icon.png (1024) and tray.ico.
Colours: the cube is one colour, #0A0A0A on light pages and white on dark pages.
At 32 px and below the plain cube mark (no letters) is used; the product name is live text in Geist 600.
"""
from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image

DESK = Path(r'C:/Users/danil/OneDrive/Рабочий стол/Omniverso')
CUBE_DIR = DESK / 'Brand cube AS 2026-10-19'
C2 = DESK / 'Cammut + Arc Science UI preview 2026-10-23' / 'UI-preview-C2.html'
REPO = Path(r'C:/Users/danil/OneDrive/Рабочий стол/Arc Science/Arc-Science')
RASTERISER = REPO / 'native' / 'arc-svg' / 'target' / 'release' / 'arc-svg2png.exe'
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
    (OUT / 'favicon.svg').write_text(svg(INK, mk_left), encoding='utf-8')          # light tab strips
    (OUT / 'favicon-dark.svg').write_text(svg(WHITE, mk_left), encoding='utf-8')   # dark tab strips

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
    print(f'wrote {len(list(OUT.iterdir()))} files to {OUT}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
