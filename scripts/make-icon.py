"""Build the Windows icon for the desktop from the "as" tile.

Each size is rasterized from the SVG with the repository's own resvg tool (so the
result matches the window icon the shell renders at run time), then assembled into
one multi-size .ico with Pillow. Run after scripts/build-logo.py rewrites native/arc-desktop/assets/arc-icon.svg:

    PYTHONUTF8=1 python scripts/make-icon.py [path/to/arc-svg2png.exe]

Optional flags (the defaults reproduce the command above exactly):

    --source path/to/mark.svg             rasterise another SVG (design/logo/as/as-tile-light.svg)
    --tile [COLOR]                        set the source mark in white on a continuous-corner
                                          tile (default #2F5B7A), transparent outside the tile
    --out path/to/icon.ico                write somewhere other than the desktop asset
    --sizes 16,24,32,48,256               frame sizes; this list is the Windows minimum set
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

from squircle import tile_svg

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'native' / 'arc-desktop' / 'assets' / 'arc-icon.svg'
TARGET = ROOT / 'native' / 'arc-desktop' / 'assets' / 'arc-science.ico'
SIZES = (16, 24, 32, 48, 64, 128, 256)


def _sizes(text: str) -> tuple[int, ...]:
    sizes = tuple(sorted({int(part) for part in text.split(',') if part.strip()}))
    if not sizes or not all(1 <= size <= 256 for size in sizes):
        raise argparse.ArgumentTypeError('sizes must be comma-separated integers from 1 to 256')
    return sizes


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description='Rasterise an SVG into a multi-size Windows .ico.')
    parser.add_argument('tool', nargs='?', type=Path,
                        default=ROOT / 'native' / 'arc-svg' / 'target' / 'release' / 'arc-svg2png.exe')
    parser.add_argument('--source', type=Path, default=SOURCE, help='SVG to rasterise (default: the desktop tile)')
    parser.add_argument('--tile', nargs='?', const='#2F5B7A', metavar='COLOR',
                        help='wrap the source mark in a squircle tile of COLOR (default #2F5B7A)')
    parser.add_argument('--out', type=Path, default=TARGET, help='icon to write (default: the desktop asset)')
    parser.add_argument('--sizes', type=_sizes, default=SIZES, help='comma-separated frame sizes')
    args = parser.parse_args(argv[1:])
    tool, sizes, target = args.tool, args.sizes, args.out
    if not tool.is_file():
        print(f'arc-svg2png not found: {tool} (build native/arc-svg first)', file=sys.stderr)
        return 2
    if not args.source.is_file():
        print(f'source SVG not found: {args.source}', file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory() as scratch:
        source = args.source
        if args.tile:
            source = Path(scratch) / 'tile.svg'
            source.write_text(tile_svg(args.source.read_text(encoding='utf-8'), fill=args.tile), encoding='utf-8')
        frames = []
        for size in sizes:
            png = Path(scratch) / f'{size}.png'
            subprocess.run([str(tool), str(source), str(png), str(size)], check=True)
            frames.append(Image.open(png).convert('RGBA'))
        largest, rest = frames[-1], frames[:-1]
        largest.save(target, format='ICO', sizes=[(s, s) for s in sizes], append_images=rest)
    print(f'wrote {target} ({target.stat().st_size} bytes, sizes {sizes})')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
