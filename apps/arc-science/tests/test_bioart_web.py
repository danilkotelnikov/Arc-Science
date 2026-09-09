"""Authenticated BioArt web workflow over the real cache and validators."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import sys

import httpx
from fastapi.testclient import TestClient
import pytest

TOKEN = 't' * 40
ENTRY_FIXTURE = Path(__file__).parent / 'fixtures/bioart/entry-18-reduced.json'
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#ffffff"/></svg>'


def _entry_page():
    records = json.loads(ENTRY_FIXTURE.read_text())['records']
    flight = '11:' + json.dumps(records) + '\n'
    cut = len(flight) // 2
    return ''.join('<script>self.__next_f.push(' + json.dumps([1, chunk]) + ')</script>'
                   for chunk in (flight[:cut], flight[cut:]))


def _seed(tmp_path, monkeypatch, query='antibody'):
    from arc_science.bioart import BioArtClient

    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', 'bioart-cache')
    calls = []

    def respond(request):
        calls.append(str(request.url))
        if request.url.path == '/discover':
            return httpx.Response(200, text='<a href="/bioart/18"><img alt="Antibody"></a>',
                                  headers={'content-type': 'text/html'})
        if request.url.path == '/bioart/18':
            return httpx.Response(200, text=_entry_page(), headers={'content-type': 'text/html'})
        assert request.url.path == '/api/bioarts/18/files/626860'
        return httpx.Response(200, content=SVG, headers={'content-type': 'image/svg+xml'})

    client = BioArtClient(tmp_path / 'bioart-cache', allow_egress=True,
                          client=httpx.Client(transport=httpx.MockTransport(respond)))
    assert client.search(query)[0].entry_id == 18
    receipt = client.fetch(18)
    assert len(calls) == 3
    return receipt


def _app(tmp_path):
    from arc_science.service import create_app
    return create_app(data_dir=tmp_path, token=TOKEN)


def _auth():
    return {'Authorization': 'Bearer ' + TOKEN}


def test_bioart_routes_require_the_operator_token(tmp_path):
    with TestClient(_app(tmp_path)) as client:
        requests = [
            client.post('/api/bioart/search', json={'query': 'antibody'}),
            client.post('/api/bioart/inspect', json={'entry_id': 18}),
            client.post('/api/bioart/fetch', json={'entry_id': 18}),
            client.post('/api/bioart/import', json={'receipt_id': 'a' * 64}),
            client.get('/api/bioart/receipts/' + 'a' * 64 + '/preview'),
            client.get('/api/bioart/receipts/' + 'a' * 64 + '/source'),
        ]
    assert [response.status_code for response in requests] == [401, 401, 401, 401, 401, 401]


def test_cached_search_inspect_fetch_preview_and_import_are_path_safe(tmp_path, monkeypatch):
    seeded = _seed(tmp_path, monkeypatch)
    with TestClient(_app(tmp_path)) as client:
        search = client.post('/api/bioart/search', headers=_auth(),
                             json={'query': 'antibody', 'allow_egress': False})
        assert search.status_code == 200, search.text
        assert search.json() == {'hits': [{'entry_id': 18, 'title': 'Antibody'}]}

        inspected = client.post('/api/bioart/inspect', headers=_auth(),
                                json={'entry_id': 18, 'allow_egress': False})
        assert inspected.status_code == 200, inspected.text
        entry = inspected.json()
        assert entry['source_url'] == 'https://bioart.niaid.nih.gov/bioart/18'
        assert entry['license'] == 'Public Domain'
        assert entry['preferred_representation_id'] == 64
        assert entry['representations'][0]['files']['SVG'] == 626860

        fetched = client.post('/api/bioart/fetch', headers=_auth(),
                              json={'entry_id': 18, 'format': 'SVG', 'allow_egress': False})
        assert fetched.status_code == 200, fetched.text
        result = fetched.json()
        assert result['receipt_id'] == seeded.receipt_path.name[:64]
        assert result['sha256'] == hashlib.sha256(SVG).hexdigest()
        assert result['representation_id'] == 64
        assert result['preview_eligible'] is True
        assert result['import_eligible'] is True
        assert result['rights_verified'] is False
        assert result['scientific_validity_established'] is False
        assert result['preview_url'] == f"/api/bioart/receipts/{result['receipt_id']}/preview"
        assert result['download_url'] == f"/api/bioart/receipts/{result['receipt_id']}/source"
        assert 'receipt' not in result and 'source' not in result

        preview = client.get(result['preview_url'], headers=_auth())
        assert preview.status_code == 200
        assert preview.headers['content-type'].startswith('image/svg+xml')
        assert preview.content == SVG

        source = client.get(result['download_url'], headers=_auth())
        assert source.status_code == 200
        assert source.headers['content-disposition'] == 'attachment; filename="bioart-18.svg"'
        assert source.content == SVG

        imported = client.post('/api/bioart/import', headers=_auth(),
                               json={'receipt_id': result['receipt_id']})
        assert imported.status_code == 200, imported.text
        imported_value = imported.json()
        assert imported_value['asset_id']
        assert imported_value['asset_manifest'] == f"assets/{imported_value['asset_id']}/asset.json"
        assert not Path(imported_value['asset_manifest']).is_absolute()
        assert (tmp_path / imported_value['asset_manifest']).is_file()


def test_cache_miss_does_not_make_hidden_network_request(tmp_path, monkeypatch):
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', 'empty-cache')
    with TestClient(_app(tmp_path)) as client:
        response = client.post('/api/bioart/search', headers=_auth(),
                               json={'query': 'antibody', 'allow_egress': False})
    assert response.status_code == 409
    assert 'explicit' in response.json()['detail'].lower()
    assert 'egress' in response.json()['detail'].lower()


def test_explicit_egress_populates_through_the_owned_cli_boundary(tmp_path, monkeypatch):
    import arc_science.bioart.web as web

    seed_root = tmp_path / 'seed'
    _seed(seed_root, monkeypatch)
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', 'bioart-cache')
    calls = []

    async def populate(project, arguments, timeout):
        calls.append((project, arguments, timeout))
        shutil.copytree(seed_root / 'bioart-cache', tmp_path / 'bioart-cache', dirs_exist_ok=True)

    monkeypatch.setattr(web, '_run_bioart_cli', populate, raising=False)
    with TestClient(_app(tmp_path)) as client:
        response = client.post('/api/bioart/search', headers=_auth(),
                               json={'query': 'antibody', 'allow_egress': True})

    assert response.status_code == 200, response.text
    assert response.json() == {'hits': [{'entry_id': 18, 'title': 'Antibody'}]}
    assert calls == [(tmp_path.absolute(),
                      ('search', '--allow-egress', '--', 'antibody'), 35)]


def test_untyped_provider_error_never_triggers_the_network_helper(tmp_path, monkeypatch):
    import arc_science.bioart.web as web

    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', 'bioart-cache')
    calls = []

    def fail(*_):
        raise ValueError('Missing or stale cache; explicit --allow-egress required')

    async def populate(*arguments):
        calls.append(arguments)

    monkeypatch.setattr(web.BioArtClient, 'search', fail)
    monkeypatch.setattr(web, '_run_bioart_cli', populate)
    with TestClient(_app(tmp_path)) as client:
        response = client.post('/api/bioart/search', headers=_auth(),
                               json={'query': 'antibody', 'allow_egress': True})

    assert response.status_code == 409
    assert calls == []


def test_owned_cli_bridge_accepts_all_live_commands_and_literal_query(tmp_path, monkeypatch):
    from arc_science.bioart.web import _run_bioart_cli

    _seed(tmp_path, monkeypatch, query='-antibody')

    async def run():
        commands = (
            ('search', '--allow-egress', '--', '-antibody'),
            ('inspect', '--allow-egress', '18'),
            ('fetch', '--allow-egress', '--format', 'SVG',
             '--representation', '64', '18'),
        )
        for command in commands:
            await _run_bioart_cli(tmp_path.absolute(), command, 5)

    asyncio.run(run())


def test_owned_cli_ignores_project_module_shadowing(tmp_path, monkeypatch):
    from arc_science.bioart.web import _run_bioart_cli

    _seed(tmp_path, monkeypatch)
    marker = tmp_path / 'project-code-executed'
    (tmp_path / 'arc_science.py').write_text(
        f"from pathlib import Path\nPath({str(marker)!r}).write_text('unsafe')\n")

    asyncio.run(_run_bioart_cli(
        tmp_path.absolute(), ('search', '--allow-egress', '--', 'antibody'), 5))
    assert not marker.exists()


def test_owned_cli_environment_excludes_unrelated_secrets(monkeypatch):
    from arc_science.bioart.web import _cli_environment

    monkeypatch.setenv('ARC_BIOART_TIMEOUT_SECONDS', '17')
    monkeypatch.setenv('LANG', 'C.UTF-8')
    monkeypatch.setenv('PYTHONPATH', '/unsafe/import/path')
    monkeypatch.setenv('ARC_MODEL_TOKEN_FILE', '/secret/model-token')
    monkeypatch.setenv('TOP_SECRET', 'do-not-forward')

    environment = _cli_environment()

    assert environment['ARC_BIOART_TIMEOUT_SECONDS'] == '17'
    assert environment['LANG'] == 'C.UTF-8'
    assert 'PYTHONPATH' not in environment
    assert 'ARC_MODEL_TOKEN_FILE' not in environment
    assert 'TOP_SECRET' not in environment


def test_owned_cli_finalizes_its_group_after_success(tmp_path, monkeypatch):
    import arc_science.bioart.web as web

    _seed(tmp_path, monkeypatch)
    original = web._stop_cli_uninterruptibly
    finalized = []

    async def record(process):
        finalized.append(process.pid)
        await original(process)

    monkeypatch.setattr(web, '_stop_cli_uninterruptibly', record)
    asyncio.run(web._run_bioart_cli(
        tmp_path.absolute(), ('search', '--allow-egress', '--', 'antibody'), 5))
    assert len(finalized) == 1


def test_concurrent_cache_misses_share_one_cli_population(tmp_path, monkeypatch):
    import arc_science.bioart.web as web

    seed_root = tmp_path / 'seed'
    _seed(seed_root, monkeypatch)
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', 'bioart-cache')
    calls = []

    async def populate(*_):
        calls.append('population')
        await asyncio.sleep(.05)
        shutil.copytree(seed_root / 'bioart-cache', tmp_path / 'bioart-cache',
                        dirs_exist_ok=True)

    monkeypatch.setattr(web, '_run_bioart_cli', populate)

    async def run():
        transport = httpx.ASGITransport(app=_app(tmp_path))
        async with httpx.AsyncClient(transport=transport, base_url='http://arc.test') as client:
            request = lambda: client.post('/api/bioart/search', headers=_auth(),
                json={'query': 'antibody', 'allow_egress': True})
            return await asyncio.gather(request(), request())

    responses = asyncio.run(run())
    assert [response.status_code for response in responses] == [200, 200]
    assert calls == ['population']


@pytest.mark.skipif(os.name != 'posix' or not hasattr(os, 'mkfifo'),
                    reason='BioArt web egress is a POSIX-only boundary')
def test_web_cli_cleanup_closes_a_descendant_owned_fifo(tmp_path):
    from arc_science.bioart.web import _stop_cli_uninterruptibly

    endpoint = tmp_path / 'lifetime.fifo'
    record = tmp_path / 'descendant-live'
    os.mkfifo(endpoint)
    reader = os.open(endpoint, os.O_RDONLY | os.O_NONBLOCK)
    descendant = """import os,signal,sys,time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
writer=os.open(sys.argv[1],os.O_WRONLY)
open(sys.argv[2],'x').write(str(os.getpid()))
os.write(writer,b'live\\n')
while True:time.sleep(1)
"""
    leader = """import subprocess,sys,time
subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2],sys.argv[3]],close_fds=True)
while True:time.sleep(1)
"""

    async def run():
        process = await asyncio.create_subprocess_exec(
            sys.executable, '-c', leader, descendant, str(endpoint), str(record),
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, close_fds=True, start_new_session=True)
        try:
            for _ in range(200):
                if record.exists():
                    break
                await asyncio.sleep(.01)
            assert record.exists(), 'descendant never opened its lifetime witness'
            assert select.select([reader], [], [], 2)[0]
            assert os.read(reader, 16) == b'live\n'
            await _stop_cli_uninterruptibly(process)
            assert select.select([reader], [], [], 2)[0]
            assert os.read(reader, 1) == b'', 'network-helper descendant retained its writer'
        finally:
            if process.returncode is None:
                await _stop_cli_uninterruptibly(process)

    try:
        asyncio.run(run())
    finally:
        os.close(reader)


def test_preview_reverifies_bytes_and_rejects_tampering(tmp_path, monkeypatch):
    receipt = _seed(tmp_path, monkeypatch)
    receipt_id = receipt.receipt_path.name[:64]
    receipt.source_path.write_bytes(SVG.replace(b'#ffffff', b'#000000'))
    with TestClient(_app(tmp_path)) as client:
        response = client.get(f'/api/bioart/receipts/{receipt_id}/preview', headers=_auth())
    assert response.status_code == 409
    assert 'mismatch' in response.json()['detail'].lower()


def test_import_maps_invalid_provider_configuration_without_server_error(tmp_path, monkeypatch):
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', '../outside')
    with TestClient(_app(tmp_path), raise_server_exceptions=False) as client:
        response = client.post('/api/bioart/import', headers=_auth(),
                               json={'receipt_id': 'a' * 64})
    assert response.status_code == 409
    assert 'cache path' in response.json()['detail'].lower()
