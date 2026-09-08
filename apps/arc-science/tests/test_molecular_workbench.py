"""Public artifacts must be original bytes, bounded, annotated and self-contained."""
import hashlib
from io import BytesIO
import xml.etree.ElementTree as ET

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from arc_science.service import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(data_dir=tmp_path, token='t' * 40)) as client:
        yield client


def test_public_example_downloads_original_bytes_and_metadata(client):
    response = client.get('/api/examples/1dqj')
    assert response.status_code == 200
    example = response.json()
    assert example['partners'] == {'antibody': ['A', 'B'], 'antigen': ['C']}
    assert example['contact_pairs'] == 49
    assert example['cutoff_angstrom'] == 4.0
    assert example['source']['assembly'] == '1'
    assert example['review']['live_provider_qualified'] is False
    png = client.get(example['assets']['collage.png']['url'])
    assert hashlib.sha256(png.content).hexdigest() == '7394f162dca9bba20ca985a2cd43473da2c9df7d88be5e39acaec81f30f598d9'
    assert len(png.content) == 342770
    assert Image.open(BytesIO(png.content)).getpixel((0, 0)) == (255, 255, 255)
    for name, asset in example['assets'].items():
        data = client.get(asset['url'])
        assert data.status_code == 200, name
        assert len(data.content) == asset['bytes']
        assert hashlib.sha256(data.content).hexdigest() == asset['sha256']
    assert 'overview.blend' not in example['assets']


@pytest.mark.parametrize('filename', ['missing.png', 'overview.blend', '%2e%2e%2fservice.py', '%2Fetc%2Fpasswd'])
def test_example_rejects_unknown_and_traversal(client, filename):
    assert client.get('/api/examples/1dqj/assets/' + filename).status_code == 404


def test_focused_svg_preserves_original_annotations_and_native_png_alpha(client):
    base = '/api/examples/1dqj/assets/'
    response = client.get(base + 'collage.svg')
    assert response.status_code == 200
    original = ET.fromstring(response.content)
    assert hashlib.sha256(client.get(base + 'collage.svg').content).hexdigest() == '71cfeb7a84177e18a6cc00cff54c6449e985dd30718e209136513553562682c6'
    for name, viewport in [('overview', '0 48 700 480'), ('interface', '700 48 700 480'), ('rotated', '0 528 700 510')]:
        focused = ET.fromstring(client.get(base + name + '.svg').content)
        assert focused.attrib['viewBox'] == viewport
        assert [ET.tostring(child) for child in focused] == [ET.tostring(child) for child in original]
        native = Image.open(BytesIO(client.get(base + name + '.png').content))
        assert native.mode == 'RGBA'
        assert native.getextrema()[3][0] == 0


def test_example_does_not_remove_mission_authentication(client):
    assert client.get('/api/missions').status_code == 401
    assert client.get('/api/missions', headers={'Authorization': 'Bearer ' + 't' * 40}).json() == []


def test_hybrid_svg_policy_allows_embedded_rasters_but_not_scripts(client):
    response = client.get('/api/examples/1dqj/assets/collage.svg')
    assert "img-src data:" in response.headers['content-security-policy']
    assert "default-src 'none'" in response.headers['content-security-policy']
    assert "script-src 'self'" in client.get('/diagnostics').headers['content-security-policy']


def test_home_serves_compiled_ui_and_real_bundle(client):
    import re
    page = client.get('/')
    assert page.status_code == 200
    script = re.search(r'<script[^>]+src="([^"]+)"', page.text)
    assert script is not None
    response = client.get(script.group(1))
    assert response.status_code == 200
    assert 'Molecules' in response.text
    assert 'vision_review' in response.text
    assert 'Export SVG' in response.text
