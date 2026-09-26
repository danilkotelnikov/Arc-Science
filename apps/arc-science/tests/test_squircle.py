import math
import re
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[3] / 'scripts'
sys.path.insert(0, str(SCRIPTS))

import squircle  # noqa: E402

SIZE = 1024.0


def sample(d, steps=48):
    """Polyline through the path, handling the subset squircle emits: M L l c a Z."""
    tokens = re.findall(r'[MLlcaZ]|-?\d*\.?\d+(?:e-?\d+)?', d)
    pts, i, cur, start, closed = [], 0, (0.0, 0.0), None, False
    while i < len(tokens):
        cmd = tokens[i]
        i += 1
        count = {'M': 2, 'L': 2, 'l': 2, 'c': 6, 'a': 7, 'Z': 0}[cmd]
        v = [float(t) for t in tokens[i:i + count]]
        i += count
        if cmd == 'M':
            cur = start = (v[0], v[1])
            pts.append(cur)
        elif cmd in 'Ll':
            end = (v[0], v[1]) if cmd == 'L' else (cur[0] + v[0], cur[1] + v[1])
            pts += [(cur[0] + (end[0] - cur[0]) * t / steps, cur[1] + (end[1] - cur[1]) * t / steps)
                    for t in range(1, steps + 1)]
            cur = end
        elif cmd == 'c':
            p0, p1, p2, p3 = cur, *[(cur[0] + v[k], cur[1] + v[k + 1]) for k in (0, 2, 4)]
            for s in range(1, steps + 1):
                t = s / steps
                w = ((1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3)
                pts.append(tuple(sum(wk * q[j] for wk, q in zip(w, (p0, p1, p2, p3))) for j in (0, 1)))
            cur = p3
        elif cmd == 'a':
            r, sweep, end = v[0], v[4], (cur[0] + v[5], cur[1] + v[6])
            assert v[3] == 0 and sweep == 1
            mx, my = (cur[0] + end[0]) / 2, (cur[1] + end[1]) / 2
            dx, dy = end[0] - cur[0], end[1] - cur[1]
            chord = math.hypot(dx, dy)
            h = math.sqrt(max(r * r - (chord / 2) ** 2, 0.0))
            cx, cy = mx - dy / chord * h, my + dx / chord * h  # small clockwise arc: centre on the right
            a0, a1 = math.atan2(cur[1] - cy, cur[0] - cx), math.atan2(end[1] - cy, end[0] - cx)
            if a1 < a0:
                a1 += 2 * math.pi
            pts += [(cx + r * math.cos(a0 + (a1 - a0) * s / steps), cy + r * math.sin(a0 + (a1 - a0) * s / steps))
                    for s in range(1, steps + 1)]
            cur = end
        else:
            closed = True
            pts += [(cur[0] + (start[0] - cur[0]) * t / steps, cur[1] + (start[1] - cur[1]) * t / steps)
                    for t in range(1, steps + 1)]
            cur = start
    return pts, closed


def distance_to_polyline(p, pts):
    best = math.inf
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        vx, vy = x1 - x0, y1 - y0
        t = max(0.0, min(1.0, ((p[0] - x0) * vx + (p[1] - y0) * vy) / (vx * vx + vy * vy or 1.0)))
        best = min(best, math.hypot(p[0] - x0 - t * vx, p[1] - y0 - t * vy))
    return best


def test_path_is_closed_and_continuous():
    d = squircle.squircle_path(SIZE)
    assert d.endswith('Z')
    pts, closed = sample(d)
    assert closed and pts[0] == pts[-1]
    assert max(math.dist(a, b) for a, b in zip(pts, pts[1:])) < SIZE / 20  # no jumps between segments


def test_symmetric_under_quarter_turn_and_inside_the_square():
    pts, _ = sample(squircle.squircle_path(SIZE))
    assert all(-1e-6 <= x <= SIZE + 1e-6 and -1e-6 <= y <= SIZE + 1e-6 for x, y in pts)
    c = SIZE / 2
    rotated = [(c - (y - c), c + (x - c)) for x, y in pts[::7]]
    assert max(distance_to_polyline(p, pts) for p in rotated) < 1e-3 * SIZE


def test_zero_smoothing_is_a_plain_rounded_rectangle():
    ratio = squircle.IOS_RADIUS_RATIO
    r, half = ratio * SIZE, SIZE / 2
    pts, _ = sample(squircle.squircle_path(SIZE, ratio, smoothing=0))
    for x, y in pts:
        qx, qy = abs(x - half) - (half - r), abs(y - half) - (half - r)
        signed = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r
        assert abs(signed) < 1e-3


def test_smoothing_lengthens_the_corner_and_offsets_translate():
    plain, smooth = squircle.squircle_path(100, smoothing=0), squircle.squircle_path(100)
    assert plain.startswith('M 77.63 0') and smooth.startswith('M 64.208 0')  # p = (1 + 0.6) * R
    moved, _ = sample(squircle.squircle_path(100, x=10, y=20))
    assert min(x for x, _ in moved) >= 10 - 1e-6 and min(y for _, y in moved) >= 20 - 1e-6


def test_tile_wraps_a_mark_with_transparent_corners():
    tiled = squircle.tile_svg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"><g/></svg>')
    assert 'viewBox="0 0 10 20" x="96" y="96" width="832" height="832" color="#FFFFFF"' in tiled
    assert '<path id="tile" d="M ' in tiled and 'fill="#2F5B7A"' in tiled and '<rect' not in tiled
