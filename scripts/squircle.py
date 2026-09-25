"""Continuous-corner ("squircle") tile paths, stdlib only.

A port of the corner math in figma-squircle (MIT, https://github.com/phamfoo/figma-squircle),
which follows Figma's "Desperately seeking squircles" article and MartinRGB's approximation.
Only the uniform-radius case of getSvgPath is ported; per-corner radii are not needed here.

Figma describes 60% corner smoothing as the iOS-like setting. The default tile radius ratio
0.2237 (radius / icon size) is a commonly used approximation of the iOS app-icon corner;
Apple does not publish the exact geometry.
"""
from __future__ import annotations

import math
import re

IOS_RADIUS_RATIO = 0.2237  # approximation, see the module docstring
IOS_SMOOTHING = 0.6
TILE_INSET = 32  # 1024-unit frame shared by the design/logo tiles (the Snöggo tile's own margin)


def _num(value: float) -> str:
    text = f'{value:.4f}'.rstrip('0').rstrip('.')
    return '0' if text in ('-0', '') else text


def corner_params(corner_radius: float, corner_smoothing: float, preserve_smoothing: bool,
                  budget: float) -> dict:
    """getPathParamsForCorner: the a, b, c, d, p lengths of one smoothed 90-degree corner."""
    p = (1 + corner_smoothing) * corner_radius
    if not preserve_smoothing:
        max_smoothing = budget / corner_radius - 1 if corner_radius else 0
        corner_smoothing = min(corner_smoothing, max_smoothing)
        p = min(p, budget)
    arc_measure = 90 * (1 - corner_smoothing)
    arc_len = math.sin(math.radians(arc_measure / 2)) * corner_radius * math.sqrt(2)
    angle_alpha = (90 - arc_measure) / 2
    p3_to_p4 = corner_radius * math.tan(math.radians(angle_alpha / 2))
    angle_beta = 45 * corner_smoothing
    c = p3_to_p4 * math.cos(math.radians(angle_beta))
    d = c * math.tan(math.radians(angle_beta))
    b = (p - arc_len - c - d) / 3
    a = 2 * b
    if preserve_smoothing and p > budget:
        p1_to_p3_max = budget - d - arc_len - c
        min_a = p1_to_p3_max / 6
        b = min(b, p1_to_p3_max - min_a)
        a = p1_to_p3_max - b
        p = min(p, budget)
    return {'a': a, 'b': b, 'c': c, 'd': d, 'p': p, 'arc': arc_len, 'r': corner_radius}


def get_svg_path(width: float, height: float, corner_radius: float, corner_smoothing: float = IOS_SMOOTHING,
                 preserve_smoothing: bool = False, x: float = 0.0, y: float = 0.0) -> str:
    """getSvgPath for one radius on all four corners; x, y offset the tile's top-left corner."""
    budget = min(width, height) / 2
    k = corner_params(min(corner_radius, budget), corner_smoothing, preserve_smoothing, budget)
    a, b, c, d, p, s, r = (k[key] for key in ('a', 'b', 'c', 'd', 'p', 'arc', 'r'))
    n = _num
    if r:
        top_right = f'c {n(a)} 0 {n(a + b)} 0 {n(a + b + c)} {n(d)} a {n(r)} {n(r)} 0 0 1 {n(s)} {n(s)} ' \
                    f'c {n(d)} {n(c)} {n(d)} {n(b + c)} {n(d)} {n(a + b + c)}'
        bottom_right = f'c 0 {n(a)} 0 {n(a + b)} {n(-d)} {n(a + b + c)} a {n(r)} {n(r)} 0 0 1 {n(-s)} {n(s)} ' \
                       f'c {n(-c)} {n(d)} {n(-(b + c))} {n(d)} {n(-(a + b + c))} {n(d)}'
        bottom_left = f'c {n(-a)} 0 {n(-(a + b))} 0 {n(-(a + b + c))} {n(-d)} a {n(r)} {n(r)} 0 0 1 {n(-s)} {n(-s)} ' \
                      f'c {n(-d)} {n(-c)} {n(-d)} {n(-(b + c))} {n(-d)} {n(-(a + b + c))}'
        top_left = f'c 0 {n(-a)} 0 {n(-(a + b))} {n(d)} {n(-(a + b + c))} a {n(r)} {n(r)} 0 0 1 {n(s)} {n(-s)} ' \
                   f'c {n(c)} {n(-d)} {n(b + c)} {n(-d)} {n(a + b + c)} {n(-d)}'
    else:
        top_right, bottom_right, bottom_left, top_left = f'l {n(p)} 0', f'l 0 {n(p)}', f'l {n(-p)} 0', f'l 0 {n(-p)}'
    return (f'M {n(x + width - p)} {n(y)} {top_right} L {n(x + width)} {n(y + height - p)} {bottom_right} '
            f'L {n(x + p)} {n(y + height)} {bottom_left} L {n(x)} {n(y + p)} {top_left} Z')


def squircle_path(size: float, radius_ratio: float = IOS_RADIUS_RATIO, smoothing: float = IOS_SMOOTHING,
                  x: float = 0.0, y: float = 0.0) -> str:
    """A square continuous-corner tile of side `size` with corner radius radius_ratio * size."""
    return get_svg_path(size, size, radius_ratio * size, smoothing, x=x, y=y)


_ROOT = re.compile(r'<svg\b[^>]*>', re.S)


def tile_svg(mark_svg: str, fill: str = '#2F5B7A', mark_color: str = '#FFFFFF', mark_scale: float = 0.8125,
             size: int = 1024, inset: float = TILE_INSET) -> str:
    """Nest a mark SVG document, centred at mark_scale of the canvas, on a squircle tile.

    The corners outside the tile stay transparent. mark_color is the CSS color the mark's
    currentColor resolves to; marks with explicit fills keep them.
    """
    root = _ROOT.search(mark_svg)
    if not root:
        raise ValueError('no <svg> root element in the mark')
    tag = root.group(0)
    view_box = re.search(r'viewBox="([^"]+)"', tag)
    if view_box:
        box = view_box.group(1)
    else:
        w, h = (re.search(rf'\s{attr}="([\d.]+)', tag) for attr in ('width', 'height'))
        if not (w and h):
            raise ValueError('the mark needs a viewBox or width and height')
        box = f'0 0 {w.group(1)} {h.group(1)}'
    inner = size * mark_scale
    offset = (size - inner) / 2
    tag = re.sub(r'\s(?:x|y|width|height|color|viewBox)="[^"]*"', '', tag)
    tag = tag[:-1].rstrip('/') + (f' viewBox="{box}" x="{_num(offset)}" y="{_num(offset)}" width="{_num(inner)}" '
                                  f'height="{_num(inner)}" color="{mark_color}">')
    nested = tag + mark_svg[root.end():mark_svg.rindex('</svg>') + len('</svg>')]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">\n'
            f'  <path id="tile" d="{squircle_path(size - 2 * inset, x=inset, y=inset)}" fill="{fill}"/>\n  {nested}\n</svg>\n')
