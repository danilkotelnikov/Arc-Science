"""Deterministic trusted rendering for numerical exploration artifacts."""
from __future__ import annotations

import base64
import hashlib
from io import BytesIO
import math

from PIL import Image, ImageDraw, ImageFont

from .models import Artifact, Observation, Point

MAX_ARTIFACT_BYTES = 1024 * 1024
RENDERER_VERSION = 'arc-plot-1'


def plot_series(points: tuple[Point, ...], fit: dict) -> tuple[tuple[float, ...], tuple[float, ...]]:
    """Evaluate the trusted normalized receipt across the complete frozen dataset."""
    center = fit['normalized_center']
    scale = fit['normalized_scale']
    coefficients = fit['normalized_coefficients']
    if not scale or len(coefficients) != fit['degree'] + 1:
        raise ValueError('Polynomial receipt lacks a stable coordinate representation')
    predicted = tuple(math.fsum(coefficient * ((point.x - center) / scale) ** degree
                                for degree, coefficient in enumerate(coefficients)) for point in points)
    if not all(math.isfinite(value) for value in predicted):
        raise ValueError('Polynomial receipt produced non-finite plot values')
    residuals = tuple(point.y - value for point, value in zip(points, predicted))
    return predicted, residuals


def _bounds(values, *, include_zero=False):
    low, high = min(values), max(values)
    if include_zero:
        low, high = min(low, 0.0), max(high, 0.0)
    if low == high:
        padding = max(1.0, abs(low) * 0.05)
    else:
        padding = (high - low) * 0.06
    return low - padding, high + padding


def _project(value, bounds, start, end):
    low, high = bounds
    return round(start + (value - low) * (end - start) / (high - low))


def _ticks(bounds, count=5):
    low, high = bounds
    return tuple(low + (high - low) * index / (count - 1) for index in range(count))


def _number(value):
    return format(value, '.7g')


def render_polynomial_plot(points: tuple[Point, ...], fit: dict) -> bytes:
    """Render measurements, fitted values and residuals as a deterministic PNG."""
    if not points:
        raise ValueError('A plot requires frozen measurements')
    predicted, residuals = plot_series(points, fit)
    width, height = 960, 720
    image = Image.new('RGB', (width, height), '#ffffff')
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    dark, muted, measured, fitted, residual = '#17212d', '#5b6875', '#16697a', '#bb3e03', '#6a4c93'
    x_bounds = _bounds(tuple(point.x for point in points))
    y_bounds = _bounds(tuple(point.y for point in points) + predicted)
    residual_bounds = _bounds(residuals, include_zero=True)
    left, right = 82, width - 34
    top, main_bottom = 78, 434
    residual_top, residual_bottom = 515, 650

    draw.text((left, 20), f"Exploratory polynomial fit (degree {fit['degree']})", fill=dark, font=font)
    draw.text((left, 39), 'Measurements, fitted response and residuals; exploratory scope only', fill=muted, font=font)
    for y in (top, main_bottom, residual_top, residual_bottom):
        draw.line((left, y, right, y), fill='#d8dee4', width=1)
    draw.line((left, top, left, main_bottom), fill=dark, width=1)
    draw.line((left, residual_top, left, residual_bottom), fill=dark, width=1)
    draw.text((left, top - 17), 'Response (y)', fill=dark, font=font)
    draw.text((left, residual_top - 17), 'Residual (observed - fitted)', fill=dark, font=font)
    draw.text((right - 4, residual_bottom + 24), 'x', fill=dark, font=font)
    x_offset = math.floor(x_bounds[0]) if abs(x_bounds[0]) >= 10000 and (x_bounds[1] - x_bounds[0]) < 1 else 0
    if x_offset:
        draw.text((left, residual_bottom + 42), f'x offset {x_offset:+d}', fill=muted, font=font)
    for value in _ticks(x_bounds):
        x = _project(value, x_bounds, left, right)
        draw.line((x, residual_bottom, x, residual_bottom + 4), fill=dark, width=1)
        label = _number(value - x_offset) if x_offset else _number(value)
        draw.text((x - 20, residual_bottom + 7), label, fill=muted, font=font)
    for value in _ticks(y_bounds):
        y = _project(value, y_bounds, main_bottom, top)
        draw.line((left - 4, y, left, y), fill=dark, width=1)
        draw.text((8, y - 5), _number(value), fill=muted, font=font)
    for value in _ticks(residual_bounds, 3):
        y = _project(value, residual_bounds, residual_bottom, residual_top)
        draw.line((left - 4, y, left, y), fill=dark, width=1)
        draw.text((8, y - 5), _number(value), fill=muted, font=font)

    ordered = sorted(zip(points, predicted), key=lambda item: (item[0].x, item[0].y))
    fit_line = [(_project(point.x, x_bounds, left, right),
                 _project(value, y_bounds, main_bottom, top)) for point, value in ordered]
    if len(fit_line) > 1:
        draw.line(fit_line, fill=fitted, width=3)
    for point, value in zip(points, residuals):
        x = _project(point.x, x_bounds, left, right)
        y = _project(point.y, y_bounds, main_bottom, top)
        draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=measured)
        ry = _project(value, residual_bounds, residual_bottom, residual_top)
        draw.ellipse((x - 2, ry - 2, x + 2, ry + 2), fill=residual)
    zero = _project(0.0, residual_bounds, residual_bottom, residual_top)
    draw.line((left, zero, right, zero), fill=muted, width=1)
    draw.text((right - 185, top + 8), 'observed points', fill=measured, font=font)
    draw.text((right - 185, top + 25), 'fitted response', fill=fitted, font=font)

    out = BytesIO()
    image.save(out, format='PNG', optimize=False, compress_level=9)
    content = out.getvalue()
    if len(content) > MAX_ARTIFACT_BYTES:
        raise ValueError('Rendered artifact exceeds the 1 MiB image limit')
    return content


def artifact_for_observation(points: tuple[Point, ...], observation: Observation) -> Artifact:
    if observation.status != 'ok' or observation.tool != 'polynomial_fit':
        raise ValueError('Only successful polynomial fits can produce plot artifacts')
    content = render_polynomial_plot(points, observation.data)
    return Artifact(digest=hashlib.sha256(content).hexdigest(), size=len(content),
                    data_base64=base64.b64encode(content).decode('ascii'),
                    source_observation_id=observation.id, source_observation_digest=observation.digest,
                    renderer_version=RENDERER_VERSION, round=observation.round)
