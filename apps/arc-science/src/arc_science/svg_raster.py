"""SVG -> PNG rasterization with a Cairo-free fallback for Windows.

cairosvg needs the native Cairo library, which a stock Windows install lacks (the
package imports but ``svg2png`` raises at call time). When Cairo is unavailable we
shell out to a resvg-based ``arc-svg2png`` tool named by the ``ARC_SVG2PNG``
environment variable (built from ``native/arc-svg``). resvg scales proportionally by
width; callers that need an exact box resize the result (e.g. via Pillow).

The converter engine is reported truthfully so a bundle's provenance records which
rasterizer actually produced its preview.
"""
from __future__ import annotations

import functools
from importlib.metadata import version
import os
import subprocess
import tempfile


@functools.lru_cache(maxsize=1)
def cairo_available() -> bool:
    """True only if cairosvg can actually rasterize (its native Cairo lib is present)."""
    try:
        import cairosvg
        cairosvg.svg2png(bytestring=b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>')
        return True
    except Exception:
        return False


def engine() -> dict:
    """The converter record for the rasterizer that will actually be used."""
    if cairo_available():
        return {'engine': 'CairoSVG', 'engine_version': version('CairoSVG'),
                'pillow_version': version('Pillow')}
    return {'engine': 'resvg', 'engine_version': 'arc-svg2png',
            'pillow_version': version('Pillow')}


def render_png_bytes(svg_bytes: bytes, width: int | None = None, height: int | None = None) -> bytes:
    """Rasterize SVG to PNG bytes. Prefer cairosvg (exact width x height); otherwise
    the resvg tool named by ARC_SVG2PNG (proportional to width)."""
    if cairo_available():
        import cairosvg
        options = {}
        if width:
            options['output_width'] = int(width)
        if height:
            options['output_height'] = int(height)
        return cairosvg.svg2png(bytestring=svg_bytes, **options)
    tool = os.environ.get('ARC_SVG2PNG')
    if not tool:
        raise RuntimeError('No SVG rasterizer available: install cairosvg (needs the Cairo '
                           'library) or set ARC_SVG2PNG to a resvg-based tool '
                           '(build native/arc-svg -> arc-svg2png)')
    with tempfile.TemporaryDirectory(prefix='arc-svg-') as work:
        source = os.path.join(work, 'in.svg')
        target = os.path.join(work, 'out.png')
        with open(source, 'wb') as handle:
            handle.write(svg_bytes)
        argv = [tool, source, target] + ([str(int(width))] if width else [])
        subprocess.run(argv, check=True)
        with open(target, 'rb') as handle:
            return handle.read()


def render_png_file(svg_bytes: bytes, out_path, width: int | None = None) -> None:
    with open(out_path, 'wb') as handle:
        handle.write(render_png_bytes(svg_bytes, width))
