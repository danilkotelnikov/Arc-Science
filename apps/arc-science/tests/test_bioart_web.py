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
    records = json.loads(ENTRY_FIXTURE.read_bytes())['records']
    flight = '11:' + json.dumps(records) + '\n'
    cut = len(flight) // 2
    return ''.join('<script>self.__next_f.push(' + json.dumps([1, chunk]) + ')</script>'
                   for chunk in (flight[:cut], flight[cut:]))


def _seed(tmp_path, monkeypatch, query='antibody', *, svg=SVG, mime='image/svg+xml'):
    from arc_science.bioart import BioArtClient
    from test_bioart_search import nih

    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', 'bioart-cache')
    transport, calls = nih(files={'/bioart/18': (_entry_page().encode(), 'text/html'),
                                  '/api/bioarts/18/files/626860': (svg, mime)})
    client = BioArtClient(tmp_path / 'bioart-cache', allow_egress=True,
                          client=httpx.Client(transport=transport))
    assert client.search(query)[0].entry_id == 18
    receipt = client.fetch(18)
    assert len(calls) == 5
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


def test_cached_search_inspect_fetch_preview_and_import_are_path_safe(tmp_path, monkeypatch, svg_rasterizer):
    seeded = _seed(tmp_path, monkeypatch)
    with TestClient(_app(tmp_path)) as client:
        search = client.post('/api/bioart/search', headers=_auth(),
                             json={'query': 'antibody', 'allow_egress': False})
        assert search.status_code == 200, search.text
        hits = search.json()['hits']
        assert len(hits) == 7
        assert hits[0] == {'entry_id': 18, 'title': 'Antibody', 'thumbnail_file_id': 650176,
                           'thumbnail_url': '/api/bioart/thumbnails/18/650176'}
        assert all(hit['thumbnail_url'].startswith('/api/bioart/thumbnails/') for hit in hits)

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
    problem = response.json()['detail']
    assert problem['code'] == 'bioart.cache_miss' and problem['facts'] == {}
    assert 'explicit' in problem['detail'].lower()
    assert 'egress' in problem['detail'].lower()


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
    assert response.json()['hits'][0]['entry_id'] == 18
    # Search is three requests (page, chunk, action), each with its own deadline.
    assert calls == [(tmp_path.absolute(),
                      ('search', '--allow-egress', '--', 'antibody'), 95)]


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


def test_owned_cli_finalizes_its_group_after_failure(tmp_path, monkeypatch):
    import arc_science.bioart.web as web

    original = web._stop_cli_uninterruptibly
    finalized = []

    async def record(process):
        finalized.append(process.pid)
        await original(process)

    monkeypatch.setattr(web, '_stop_cli_uninterruptibly', record)
    with pytest.raises(ValueError, match='Invalid BioArt identity'):
        asyncio.run(web._run_bioart_cli(
            tmp_path.absolute(), ('inspect', '--allow-egress', '0'), 5))
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


def test_unrelated_cache_miss_does_not_queue_behind_active_population(tmp_path, monkeypatch):
    import arc_science.bioart.web as web

    seed_root = tmp_path / 'seed'
    _seed(seed_root, monkeypatch)
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', 'bioart-cache')

    async def run():
        started = asyncio.Event()
        release = asyncio.Event()
        calls = []

        async def populate(_project, arguments, _timeout):
            calls.append(arguments)
            started.set()
            await release.wait()
            shutil.copytree(seed_root / 'bioart-cache', tmp_path / 'bioart-cache',
                            dirs_exist_ok=True)

        monkeypatch.setattr(web, '_run_bioart_cli', populate)
        transport = httpx.ASGITransport(app=_app(tmp_path))
        async with httpx.AsyncClient(transport=transport, base_url='http://arc.test') as client:
            first = asyncio.create_task(client.post('/api/bioart/search', headers=_auth(),
                json={'query': 'antibody', 'allow_egress': True}))
            await asyncio.wait_for(started.wait(), .5)
            second = None
            try:
                second = await asyncio.wait_for(client.post(
                    '/api/bioart/search', headers=_auth(),
                    json={'query': 'syringe', 'allow_egress': True}), .25)
            except asyncio.TimeoutError:
                pass
            finally:
                release.set()
            first_response = await first
        return first_response, second, calls

    first, second, calls = asyncio.run(run())
    assert first.status_code == 200
    assert second is not None, 'unrelated live population waited instead of failing closed'
    assert second.status_code == 409
    assert second.json()['detail']['code'] == 'bioart.busy'
    assert 'active' in second.json()['detail']['detail'].lower()
    assert calls == [('search', '--allow-egress', '--', 'antibody')]


def test_cancelling_first_request_does_not_cancel_identical_waiter(tmp_path, monkeypatch):
    import arc_science.bioart.web as web

    seed_root = tmp_path / 'seed'
    _seed(seed_root, monkeypatch)
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', 'bioart-cache')

    async def run():
        started = asyncio.Event()
        release = asyncio.Event()
        calls = []

        async def populate(*_):
            calls.append('population')
            started.set()
            await release.wait()
            shutil.copytree(seed_root / 'bioart-cache', tmp_path / 'bioart-cache',
                            dirs_exist_ok=True)

        monkeypatch.setattr(web, '_run_bioart_cli', populate)
        transport = httpx.ASGITransport(app=_app(tmp_path))
        async with httpx.AsyncClient(transport=transport, base_url='http://arc.test') as client:
            request = lambda: client.post('/api/bioart/search', headers=_auth(),
                json={'query': 'antibody', 'allow_egress': True})
            first = asyncio.create_task(request())
            await asyncio.wait_for(started.wait(), .5)
            second = asyncio.create_task(request())
            await asyncio.sleep(.05)
            first.cancel()
            with pytest.raises(asyncio.CancelledError):
                await first
            release.set()
            response = await asyncio.wait_for(second, 1)
        return response, calls

    response, calls = asyncio.run(run())
    assert response.status_code == 200
    assert calls == ['population']


def test_cancelling_last_request_stops_shared_population(tmp_path, monkeypatch):
    import arc_science.bioart.web as web

    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', 'bioart-cache')

    async def run():
        started = asyncio.Event()
        stopped = asyncio.Event()

        async def populate(*_):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()

        monkeypatch.setattr(web, '_run_bioart_cli', populate)
        transport = httpx.ASGITransport(app=_app(tmp_path))
        async with httpx.AsyncClient(transport=transport, base_url='http://arc.test') as client:
            request = asyncio.create_task(client.post('/api/bioart/search', headers=_auth(),
                json={'query': 'antibody', 'allow_egress': True}))
            await asyncio.wait_for(started.wait(), .5)
            request.cancel()
            with pytest.raises(asyncio.CancelledError):
                await request
            await asyncio.wait_for(stopped.wait(), .5)

    asyncio.run(run())


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


@pytest.mark.skipif(os.name != 'posix' or not hasattr(os, 'mkfifo'),
                    reason='BioArt web egress is a POSIX-only boundary')
def test_web_cli_cleanup_closes_descendant_after_nonzero_leader_exit(tmp_path):
    from arc_science.bioart.web import _stop_cli_uninterruptibly

    endpoint = tmp_path / 'failed-lifetime.fifo'
    record = tmp_path / 'failed-descendant-live'
    os.mkfifo(endpoint)
    reader = os.open(endpoint, os.O_RDONLY | os.O_NONBLOCK)
    descendant = """import os,signal,sys,time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
writer=os.open(sys.argv[1],os.O_WRONLY)
open(sys.argv[2],'x').write(str(os.getpid()))
os.write(writer,b'live\\n')
while True:time.sleep(1)
"""
    leader = """import subprocess,sys
subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2],sys.argv[3]],close_fds=True)
raise SystemExit(7)
"""

    async def run():
        process = await asyncio.create_subprocess_exec(
            sys.executable, '-c', leader, descendant, str(endpoint), str(record),
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, close_fds=True, start_new_session=True)
        try:
            await asyncio.wait_for(process.wait(), 2)
            assert process.returncode == 7
            for _ in range(200):
                if record.exists():
                    break
                await asyncio.sleep(.01)
            assert record.exists(), 'failed leader descendant never opened its witness'
            assert select.select([reader], [], [], 2)[0]
            assert os.read(reader, 16) == b'live\n'
            await _stop_cli_uninterruptibly(process)
            assert select.select([reader], [], [], 2)[0]
            assert os.read(reader, 1) == b'', 'failed helper descendant survived finalization'
        finally:
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
    assert 'mismatch' in response.json()['detail']['detail'].lower()


def test_import_maps_invalid_provider_configuration_without_server_error(tmp_path, monkeypatch):
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', '../outside')
    with TestClient(_app(tmp_path), raise_server_exceptions=False) as client:
        response = client.post('/api/bioart/import', headers=_auth(),
                               json={'receipt_id': 'a' * 64})
    assert response.status_code == 409
    assert 'cache path' in response.json()['detail']['detail'].lower()


@pytest.mark.parametrize('message,status,code,facts', [
    ('BioArt CLI failed: [bioart.unreachable {"proxy":"127.0.0.1:10809"}] Cannot reach bioart.niaid.nih.gov',
     502, 'bioart.unreachable', {'proxy': '127.0.0.1:10809'}),
    ('BioArt CLI failed: [bioart.drift] BioArt search action discoverSearch is missing', 502, 'bioart.drift', {}),
    ('BioArt web helper total timeout', 504, 'bioart.timeout', {}),
    ('BioArt CLI failed without a safe provider error', 409, 'bioart.failed', {}),
])
def test_errors_carry_a_code_detail_and_facts(tmp_path, monkeypatch, message, status, code, facts):
    import arc_science.bioart.web as web
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', 'bioart-cache')

    async def populate(*_):
        raise ValueError(message)

    monkeypatch.setattr(web, '_run_bioart_cli', populate)
    with TestClient(_app(tmp_path)) as client:
        response = client.post('/api/bioart/search', headers=_auth(),
                               json={'query': 'antibody', 'allow_egress': True})
    assert response.status_code == status
    problem = response.json()['detail']
    assert (problem['code'], problem['facts']) == (code, facts)
    assert problem['detail'] and '[' not in problem['detail']
    from arc_science.bioart.errors import BIOART_ERROR_CODES
    assert code in BIOART_ERROR_CODES


def test_invalid_query_is_a_coded_refusal(tmp_path, monkeypatch):
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', 'bioart-cache')
    with TestClient(_app(tmp_path)) as client:
        response = client.post('/api/bioart/search', headers=_auth(),
                               json={'query': 'x AND license:*', 'allow_egress': True})
    assert response.status_code == 409
    assert response.json()['detail']['code'] == 'bioart.invalid_query'


def _seed_thumbnail(tmp_path):
    from arc_science.bioart import BioArtClient, BioArtSettings
    from test_bioart_search import nih, recorded
    settings = BioArtSettings.from_environment(tmp_path.absolute())
    transport, _ = nih(files={'/api/bioarts/250/files/650431': (recorded('thumbnail-650431.jpg'), None)})
    BioArtClient(settings.thumbnail_dir, allow_egress=True,
                 client=httpx.Client(transport=transport)).thumbnail(250, 650431)
    return recorded('thumbnail-650431.jpg')


def test_thumbnail_route_serves_cached_bytes_locally_and_never_an_external_url(tmp_path, monkeypatch):
    import arc_science.bioart.web as web
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', 'bioart-cache')
    thumbnail = _seed_thumbnail(tmp_path)
    calls = []

    async def populate(*arguments):
        calls.append(arguments)

    monkeypatch.setattr(web, '_run_bioart_cli', populate)
    with TestClient(_app(tmp_path)) as client:
        served = client.get('/api/bioart/thumbnails/250/650431', headers=_auth())
        missing = client.get('/api/bioart/thumbnails/18/650176', headers=_auth())
        unauthorised = client.get('/api/bioart/thumbnails/250/650431')
    assert served.status_code == 200 and served.content == thumbnail
    assert served.headers['content-type'] == 'image/jpeg'
    assert served.headers['content-security-policy'] == "default-src 'none'; sandbox"
    assert missing.status_code == 409 and missing.json()['detail']['code'] == 'bioart.cache_miss'
    assert unauthorised.status_code == 401
    assert calls == []


def test_thumbnail_route_fetches_through_the_owned_cli_only_with_egress(tmp_path, monkeypatch):
    import arc_science.bioart.web as web
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', 'bioart-cache')
    _seed_thumbnail(tmp_path / 'seed')
    calls = []

    async def populate(project, arguments, timeout):
        calls.append(arguments)
        shutil.copytree(tmp_path / 'seed' / 'bioart-cache-thumbnails', tmp_path / 'bioart-cache-thumbnails',
                        dirs_exist_ok=True)

    monkeypatch.setattr(web, '_run_bioart_cli', populate)
    with TestClient(_app(tmp_path)) as client:
        served = client.get('/api/bioart/thumbnails/250/650431?allow_egress=true', headers=_auth())
    assert served.status_code == 200, served.text
    assert calls == [('thumbnail', '--allow-egress', '250', '650431')]


def test_observed_untyped_svg_previews_in_the_sandbox_but_does_not_import(tmp_path, monkeypatch):
    from test_bioart_search import recorded
    observed = recorded('file-626835.svg')
    receipt = _seed(tmp_path, monkeypatch, svg=observed, mime=None)
    receipt_id = receipt.receipt_path.name[:64]
    with TestClient(_app(tmp_path)) as client:
        preview = client.get(f'/api/bioart/receipts/{receipt_id}/preview', headers=_auth())
        imported = client.post('/api/bioart/import', headers=_auth(), json={'receipt_id': receipt_id})
    assert preview.status_code == 200 and preview.content == observed
    assert preview.headers['content-type'].startswith('image/svg+xml')
    assert preview.headers['content-security-policy'] == "default-src 'none'; sandbox"
    assert imported.status_code == 409 and imported.json()['detail']['code'] == 'bioart.not_eligible'


def test_native_supervisor_layout_keeps_the_cache_under_the_project_not_the_data_dir(tmp_path, monkeypatch):
    """The supervisor passes ARC_PROJECT (the workspace) and an absolute cache path under
    it, while the data directory is workspace/data: the cache is inside the project."""
    from arc_science.service import create_app
    workspace = tmp_path / 'workspace'
    (workspace / 'data').mkdir(parents=True)
    monkeypatch.setenv('ARC_PROJECT', str(workspace))
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', str(workspace / '.arc-science' / 'bioart'))
    with TestClient(create_app(data_dir=workspace / 'data', token=TOKEN)) as client:
        response = client.post('/api/bioart/search', json={'query': 'antibody'}, headers=_auth())
    assert response.status_code != 409 or 'inside the project' not in response.text, response.text
    assert (workspace / '.arc-science' / 'bioart').exists() or response.status_code in (200, 409)
