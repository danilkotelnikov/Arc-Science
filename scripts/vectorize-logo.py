"""Trace a raster logo candidate (GPT-Image, BioRender export, a render) into a one-colour SVG mark.

The PNG is flattened onto white, traced by vtracer in binary spline mode, then cleaned:
coordinates are moved into a 1024 x 1024 viewBox and rounded to one decimal, paths smaller
than --min-size are dropped, and the rest are wrapped in <g id="mark" fill="currentColor">.
--tile sets the mark in white on the continuous-corner tile instead. The result is a
starting point for hand-cleaning, not a finished logo.

    PYTHONUTF8=1 python scripts/vectorize-logo.py candidate.png design/logo/gpt-1-mark.svg [--tile]

vtracer: %LOCALAPPDATA%\\arc-devtools\\bin\\vtracer.exe, or the path in ARC_VTRACER.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

from squircle import tile_svg

SIZE = 1024
_TOKEN = re.compile(r'[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?')


def vtracer_path() -> Path:
    default = Path(os.environ.get('LOCALAPPDATA', '')) / 'arc-devtools' / 'bin' / 'vtracer.exe'
    return Path(os.environ.get('ARC_VTRACER') or default)


def _fmt(value: float) -> str:
    text = f'{value:.1f}'.rstrip('0').rstrip('.')
    return '0' if text in ('-0', '') else text


def clean(raw_svg: str, width: int, height: int, min_size: float) -> tuple[str, dict]:
    """vtracer output -> (mark SVG, stats). Only absolute M, L, C, Q, Z occur in vtracer paths."""
    k = SIZE / max(width, height)
    ox, oy = (SIZE - width * k) / 2, (SIZE - height * k) / 2
    kept, dropped, nodes = [], 0, 0
    for attrs in re.findall(r'<path\b([^>]*)/?>', raw_svg):
        d = re.search(r'\sd="([^"]*)"', attrs).group(1)
        shift = re.search(r'translate\(\s*([-\d.eE]+)[\s,]+([-\d.eE]+)\s*\)', attrs)
        tx, ty = (float(shift.group(1)), float(shift.group(2))) if shift else (0.0, 0.0)
        out, xs, ys, parity, count = [], [], [], 0, 0
        for token in _TOKEN.findall(d):
            if token.isalpha():
                if token not in 'MLCQZ':
                    raise ValueError(f'unexpected path command {token!r} in vtracer output')
                count += token != 'Z'
                out.append(token)
                continue
            value = (float(token) + (ty if parity else tx)) * k + (oy if parity else ox)
            (ys if parity else xs).append(value)
            out.append(_fmt(value))
            parity ^= 1
        if not xs or max(max(xs) - min(xs), max(ys) - min(ys)) < min_size:
            dropped += 1
            continue
        nodes += count
        kept.append(' '.join(out))
    body = ''.join(f'    <path d="{d}"/>\n' for d in kept)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">\n'
           f'  <g id="mark" fill="currentColor">\n{body}  </g>\n</svg>\n')
    return svg, {'paths': len(kept), 'dropped': dropped, 'nodes': nodes}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description='Trace a PNG logo into a clean one-colour SVG mark.')
    parser.add_argument('png', type=Path)
    parser.add_argument('out', type=Path)
    parser.add_argument('--tile', nargs='?', const='#2F5B7A', metavar='COLOR',
                        help='set the mark in white on a squircle tile of COLOR (default #2F5B7A)')
    parser.add_argument('--speckle', type=int, default=8, help='vtracer filter_speckle in source pixels')
    parser.add_argument('--min-size', type=float, default=16.0, help='drop paths smaller than this (1024 units)')
    args = parser.parse_args(argv[1:])
    tool = vtracer_path()
    if not tool.is_file():
        print(f'vtracer not found: {tool} (set ARC_VTRACER)', file=sys.stderr)
        return 2
    with Image.open(args.png) as image:
        rgba = image.convert('RGBA')
    flat = Image.new('RGBA', rgba.size, (255, 255, 255, 255))
    flat.alpha_composite(rgba)  # transparent pixels would otherwise trace as black
    with tempfile.TemporaryDirectory() as scratch:
        png, raw = Path(scratch) / 'flat.png', Path(scratch) / 'raw.svg'
        flat.convert('RGB').save(png)
        subprocess.run([str(tool), '--colormode', 'bw', '--mode', 'spline', '--filter_speckle', str(args.speckle),
                        '-i', str(png), '-o', str(raw)], check=True, capture_output=True)
        svg, stats = clean(raw.read_text(encoding='utf-8'), *rgba.size, args.min_size)
    if args.tile:
        svg = tile_svg(svg, fill=args.tile)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(svg, encoding='utf-8', newline='\n')
    print(f'wrote {args.out}: {stats["paths"]} paths, {stats["nodes"]} nodes, {stats["dropped"]} dropped')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
