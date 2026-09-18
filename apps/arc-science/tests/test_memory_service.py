"""The app mounts /api/memory and degrades gracefully when no worker is configured."""
from __future__ import annotations

from fastapi.testclient import TestClient

from arc_science.service import create_app


def test_app_mounts_memory_routes(tmp_path, monkeypatch):
    monkeypatch.delenv("ARC_MEMORY_WORKER", raising=False)
    token = "x" * 40
    app = create_app(data_dir=tmp_path, token=token)
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        # mounted + auth enforced
        assert client.get("/api/memory/sessions", params={"project": "p"}).status_code == 401
        # configured-but-no-worker -> graceful 503, not a crash
        gated = client.get(
            "/api/memory/health", headers={"Authorization": "Bearer " + token}
        )
        assert gated.status_code == 503


def test_cancel_snapshot_drains_and_restart_replay_is_idempotent(tmp_path, monkeypatch):
    import json
    from test_memory_client import worker_binary
    from arc_science.memory import MemoryClient
    from arc_science.memory.capture import PROJECT

    binary = worker_binary()
    monkeypatch.setenv('ARC_MEMORY_WORKER', str(binary))
    headers = {'Authorization': 'Bearer ' + 'x' * 40}
    app = create_app(data_dir=tmp_path, token='x' * 40)
    with TestClient(app) as client:
        response = client.post('/api/missions', json={'goal':'Check cancellation memory.'}, headers=headers)
        assert response.status_code == 201
        mid = response.json()['id']
        assert client.post(f'/api/missions/{mid}/cancel', headers=headers).status_code == 200
    with MemoryClient(binary, tmp_path/'memory.db') as mem:
        records = mem.session_fetch(PROJECT, mid)
        snapshots = [json.loads(r['text']) for r in records if r['source_uri'].endswith('/snapshot')]
        assert snapshots[-1]['status'] == 'cancelled'
        count = len(records)
    with TestClient(create_app(data_dir=tmp_path, token='x' * 40)):
        pass
    with MemoryClient(binary, tmp_path/'memory.db') as mem:
        assert len(mem.session_fetch(PROJECT, mid)) == count


def test_startup_reconciles_missions_created_without_memory(tmp_path, monkeypatch):
    from test_memory_client import worker_binary
    from arc_science.memory import MemoryClient
    from arc_science.memory.capture import PROJECT

    monkeypatch.delenv('ARC_MEMORY_WORKER', raising=False)
    headers = {'Authorization':'Bearer ' + 'x'*40}
    with TestClient(create_app(data_dir=tmp_path, token='x'*40)) as client:
        mid = client.post('/api/missions', json={'goal':'Recover retained mission.'}, headers=headers).json()['id']
        client.post(f'/api/missions/{mid}/cancel', headers=headers)
    binary = worker_binary()
    monkeypatch.setenv('ARC_MEMORY_WORKER', str(binary))
    with TestClient(create_app(data_dir=tmp_path, token='x'*40)):
        pass
    with MemoryClient(binary, tmp_path/'memory.db') as mem:
        assert any('cancelled' in r['text'] for r in mem.session_fetch(PROJECT, mid))


def test_execution_error_snapshot_is_captured_without_an_engine_emit(tmp_path, monkeypatch):
    import json
    import time
    import arc_science.service as service
    from test_memory_client import worker_binary
    from arc_science.memory import MemoryClient
    from arc_science.memory.capture import PROJECT
    async def fail(*args, **kwargs): raise RuntimeError('fixture execution failure')
    monkeypatch.setattr(service, 'explore', fail)
    binary = worker_binary()
    monkeypatch.setenv('ARC_MEMORY_WORKER', str(binary))
    headers = {'Authorization':'Bearer ' + 'x'*40}
    with TestClient(create_app(data_dir=tmp_path, token='x'*40)) as client:
        mid = client.post('/api/missions', json={'goal':'Record service execution error.'}, headers=headers).json()['id']
        client.post(f'/api/missions/{mid}/start', headers=headers)
        for _ in range(100):
            if client.get(f'/api/missions/{mid}', headers=headers).json()['state']['status'] == 'error': break
            time.sleep(.01)
        else: raise AssertionError('mission never reached error state')
    with MemoryClient(binary, tmp_path/'memory.db') as mem:
        snapshots = [json.loads(r['text']) for r in mem.session_fetch(PROJECT, mid) if r['source_uri'].endswith('/snapshot')]
        assert snapshots[-1]['status'] == 'error'
