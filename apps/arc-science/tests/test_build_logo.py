import importlib.util
import re
import sys
from pathlib import Path

import pytest

pytest.importorskip('pathops')  # skia-pathops, a developer tool: pip install --user skia-pathops

SCRIPTS = Path(__file__).resolve().parents[3] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
_spec = importlib.util.spec_from_file_location('build_logo', SCRIPTS / 'build-logo.py')
logo = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(logo)


def test_every_file_is_plain_fills_of_the_letters_without_the_old_square():
    files, _ = logo.build()
    assert set(files) == {'as-mark.svg', 'as-tile.svg', 'as-tile-light.svg', 'as-lockup-dark.svg', 'as-lockup-light.svg'}
    for text in files.values():
        assert 'stroke' not in text and 'transform' not in text and 'var(' not in text
        assert 'accent' not in text and text.count('id="letters"') == 1
    assert 'fill="currentColor"' in files['as-mark.svg']
    # The s ends one stroke above the baseline at its right side: the step where the square was.
    x0, y0, x1, y1 = logo.letters().bounds
    right = logo.pathops.Path()
    logo.parse_path(f'M {x1 - logo.W / 2} {y1 - logo.W / 2} h {logo.W / 2} v {logo.W / 2} h {-logo.W / 2} Z', right.getPen())
    assert logo.pathops.op(logo.letters(), right, logo.pathops.PathOp.INTERSECTION).area == 0


def test_the_lockup_keeps_the_production_proportions():
    files, info = logo.build()
    cap, (tx, ty, size) = info['cap'], info['tile']
    wx0, _, _, _ = info['word_bounds']
    assert size == pytest.approx(2.1 * cap)
    assert ty + size / 2 == pytest.approx(-cap / 2)          # capitals centred on the tile
    assert wx0 - (tx + size) == pytest.approx(0.45 * cap)    # the gap before the A
    assert 'MuseoModerno' in logo.__doc__ and logo.WEIGHT == 900 and logo.WORD == 'ARC SCIENCE'
    view = re.search(r'viewBox="([^"]+)"', files['as-lockup-dark.svg']).group(1)
    assert view == info['lockup']['viewBox']
