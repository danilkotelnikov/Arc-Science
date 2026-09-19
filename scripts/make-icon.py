"""Build the Windows icon for the desktop from the Snöggo mark.

Each size is rasterized from the SVG with the repository's own resvg tool (so the
result matches the window icon the shell renders at run time), then assembled into
one multi-size .ico with Pillow. Run after changing native/arc-desktop/assets/snoggo-icon.svg:

    PYTHONUTF8=1 python scripts/make-icon.py [path/to/arc-svg2png.exe]
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'native' / 'arc-desktop' / 'assets' / 'snoggo-icon.svg'
TARGET = ROOT / 'native' / 'arc-desktop' / 'assets' / 'arc-science.ico'
SIZES = (16, 24, 32, 48, 64, 128, 256)


def main(argv: list[str]) -> int:
    tool = Path(argv[1]) if len(argv) > 1 else ROOT / 'native' / 'arc-svg' / 'target' / 'release' / 'arc-svg2png.exe'
    if not tool.is_file():
        print(f'arc-svg2png not found: {tool} (build native/arc-svg first)', file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory() as scratch:
        frames = []
        for size in SIZES:
            png = Path(scratch) / f'{size}.png'
            subprocess.run([str(tool), str(SOURCE), str(png), str(size)], check=True)
            frames.append(Image.open(png).convert('RGBA'))
        largest, rest = frames[-1], frames[:-1]
        largest.save(TARGET, format='ICO', sizes=[(s, s) for s in SIZES], append_images=rest)
    print(f'wrote {TARGET} ({TARGET.stat().st_size} bytes, sizes {SIZES})')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
