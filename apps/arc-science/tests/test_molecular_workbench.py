"""The workbench ships without a packaged example; public routes stay bounded."""
import re

import pytest
from fastapi.testclient import TestClient

from arc_science.service import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(data_dir=tmp_path, token='t' * 40)) as client:
        yield client


@pytest.mark.parametrize('path', ['/api/examples/1dqj', '/api/examples/1dqj/assets/collage.svg',
                                  '/api/examples/1dqj/assets/%2e%2e%2fservice.py'])
def test_no_packaged_example_is_served(client, path):
    assert client.get(path).status_code == 404


def test_mission_routes_keep_their_authentication(client):
    assert client.get('/api/missions').status_code == 401
    assert client.get('/api/missions', headers={'Authorization': 'Bearer ' + 't' * 40}).json() == []


def test_diagnostics_policy_is_unchanged(client):
    assert "script-src 'self'" in client.get('/diagnostics').headers['content-security-policy']


def test_home_serves_compiled_ui_with_the_empty_workbench(client):
    page = client.get('/')
    assert page.status_code == 200
    assert 'href="/favicon.svg"' in page.text
    assert client.get('/favicon.svg').status_code == 200
    script = re.search(r'<script[^>]+src="([^"]+)"', page.text)
    assert script is not None
    response = client.get(script.group(1))
    assert response.status_code == 200
    assert 'Molecules' in response.text
    assert 'vision_review' in response.text
    assert 'Render locally' in response.text and 'Settings' in response.text
    assert 'Choose a coordinate file or a saved render to view it.' in response.text
    assert 'MolecularViewer-' in response.text  # the Mol* viewer is a lazy chunk, not part of the bundle
    assert '/api/examples/' not in response.text
    assert 'Export SVG' not in response.text
