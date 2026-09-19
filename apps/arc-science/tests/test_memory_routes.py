"""Behavior tests for the /api/memory/* FastAPI routes."""
from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from arc_science.memory import MemoryClient
from arc_science.memory.web import MemoryRoutes


def worker_binary() -> Path:
    root = Path(__file__).resolve().parents[3]
    name = "arc-memory-worker.exe" if os.name == "nt" else "arc-memory-worker"
    for profile in ("release", "debug"):
        candidate = root / "native" / "arc-memory" / "target" / profile / name
        if candidate.exists():
            return candidate
    pytest.skip("arc-memory-worker binary not built")


def sample(text: str) -> dict:
    return {
        "project_id": "p",
        "session_id": "s",
        "agent_id": "planner",
        "role": "planner",
        "text": text,
        "source_uri": None,
        "trust": "model_output",
        "compaction_epoch": 0,
        "wall_time_ms": 1,
        "idempotency_key": None,
    }


async def _authorized() -> None:
    return None


def test_routes_search_inspect_sessions(tmp_path):
    binary = worker_binary()
    # Pre-populate through a client, then let the API's own worker read it.
    with MemoryClient(binary, tmp_path / "memory.db") as mem:
        record_id = mem.append(sample("hydrogen bond note"))

    routes = MemoryRoutes(tmp_path, binary, _authorized)
    app = FastAPI()
    app.include_router(routes.router)
    try:
        with TestClient(app) as client:
            health = client.get("/api/memory/health")
            assert health.json()["protocol"] == "arc-memory/1"
            assert health.json()["retrieval_modes"] == ["lexical"]
            assert health.json()["capture"] == {"status": "ready", "pending": 0, "last_error": None}

            found = client.post(
                "/api/memory/search",
                json={"project": "p", "query": "hydrogen", "mode": "lexical"},
            )
            assert found.status_code == 200
            assert len(found.json()) == 1

            record = client.get(f"/api/memory/records/{record_id}")
            assert record.json()["text"] == "hydrogen bond note"

            sessions = client.get("/api/memory/sessions", params={"project": "p"})
            assert sessions.json()[0]["session_id"] == "s"

            missing = client.get("/api/memory/records/nope")
            assert missing.status_code == 404

            # Disabling a record is a declared change with no effect: a wider declaration
            # is allowed and echoed, an unknown effect is refused, the record leaves retrieval.
            refused = client.post(f"/api/memory/records/{record_id}/disable", json={"declared_effects": ["magic"]})
            assert refused.status_code == 409
            disabled = client.post(f"/api/memory/records/{record_id}/disable", json={"declared_effects": ["analysis"]})
            assert disabled.status_code == 200
            assert disabled.json()["change"] == {"kind": "memory_disable", "declared_effects": ["analysis"],
                                                 "derived_effects": [], "required_checks": [],
                                                 "reason": "Disabling a memory record excludes it from retrieval; it is not deleted and no mission evidence changes."}
            assert client.post("/api/memory/search", json={"project": "p", "query": "hydrogen", "mode": "lexical"}).json() == []
    finally:
        routes.close()


def test_routes_report_unconfigured_worker(tmp_path):
    routes = MemoryRoutes(tmp_path, None, _authorized)
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as client:
        assert client.get("/api/memory/health").status_code == 503
        assert client.get("/api/memory/health").json()["capture"]["status"] == "unconfigured"


def test_search_and_session_bounds_rejected_before_worker_access(tmp_path):
    routes = MemoryRoutes(tmp_path, None, _authorized)
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as client:
        for limit in [0, -1, 101, 1000000000]:
            assert client.post('/api/memory/search', json={"project":"p", "query":"q", "limit":limit}).status_code == 422
        for params in [{"from_seq":-1}, {"from_seq":10, "to_seq":1}]:
            assert client.get('/api/memory/sessions/s', params={"project":"p", **params}).status_code == 422


def test_client_created_once_under_concurrent_access(tmp_path, monkeypatch):
    import threading
    import time as _t

    import arc_science.memory.web as web

    count = {"n": 0}

    class StubClient:
        def __init__(self, worker_path, data_path):
            count["n"] += 1
            _t.sleep(0.03)  # widen the window between the None check and the assignment

        def close(self):
            pass

        def is_alive(self):
            return True

    monkeypatch.setattr(web, "MemoryClient", StubClient)
    routes = web.MemoryRoutes(tmp_path, worker_binary(), _authorized)

    n = 16
    barrier = threading.Barrier(n)
    seen = []

    def hit():
        barrier.wait()
        seen.append(routes._client_or_503())

    threads = [threading.Thread(target=hit) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert count["n"] == 1, f"one worker per DB, but created {count['n']}"
    assert len({id(s) for s in seen}) == 1


def test_capture_failure_visible_then_recovery_replays_idempotently(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from arc_science.memory.client import MemoryError
    from arc_science.memory.capture import PROJECT

    routes = MemoryRoutes(tmp_path, worker_binary(), _authorized)
    state = SimpleNamespace(events=[SimpleNamespace(kind='note', round=0, detail='hydrogen')], model_records=[])
    try:
        mem = routes._client_or_503()
        append = mem.append
        monkeypatch.setattr(mem, 'append', lambda _: (_ for _ in ()).throw(MemoryError('secret path C:/private/token')))
        routes.capture('mission', state)
        status = routes.capture_status()
        assert status['status'] == 'degraded'
        assert status['last_error'] and 'private' not in status['last_error']
        monkeypatch.setattr(mem, 'append', append)
        routes.capture('mission', state)
        routes.capture('mission', state)
        assert routes.capture_status()['status'] == 'ready'
        assert len(mem.session_fetch(PROJECT, 'mission')) == 1
    finally:
        routes.close()


def test_scheduled_captures_coalesce_and_close_drains_before_worker_exit(tmp_path, monkeypatch):
    import threading
    from types import SimpleNamespace
    from arc_science.memory.capture import PROJECT, SessionCapture

    entered, release = threading.Event(), threading.Event()
    original = SessionCapture.observe
    def slow(self, *args):
        entered.set()
        assert release.wait(5)
        return original(self, *args)
    monkeypatch.setattr(SessionCapture, 'observe', slow)
    routes = MemoryRoutes(tmp_path, worker_binary(), _authorized)
    state = SimpleNamespace(events=[SimpleNamespace(kind='note', round=0, detail='hydrogen')], model_records=[])
    routes.schedule_capture('mission', state)
    assert entered.wait(5)
    for _ in range(100):
        routes.schedule_capture('mission', state)
    assert 1 <= routes.capture_status()['pending'] <= 2
    release.set()
    routes.close()
    with MemoryClient(worker_binary(), tmp_path/'memory.db') as mem:
        assert len(mem.session_fetch(PROJECT, 'mission')) == 1


def test_dead_worker_is_replaced_without_losing_persisted_records(tmp_path):
    routes = MemoryRoutes(tmp_path, worker_binary(), _authorized)
    try:
        old = routes._client_or_503()
        record_id = old.append(sample('persistent hydrogen'))
        old._proc.kill()
        old._proc.wait(timeout=5)
        new = routes._client_or_503()
        assert new is not old
        assert new.inspect(record_id)['text'] == 'persistent hydrogen'
    finally:
        routes.close()


def test_partial_capture_retries_without_duplicates_or_false_ready(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from arc_science.memory.client import MemoryError
    from arc_science.memory.capture import PROJECT
    routes = MemoryRoutes(tmp_path, worker_binary(), _authorized)
    state = SimpleNamespace(events=[SimpleNamespace(kind='note', round=0, detail=t) for t in ['first','second']], model_records=[])
    try:
        mem = routes._client_or_503()
        append = mem.append
        calls = 0
        def partial(record):
            nonlocal calls
            calls += 1
            if calls == 2: raise MemoryError('fixture interrupted')
            return append(record)
        monkeypatch.setattr(mem, 'append', partial)
        assert routes.capture('failed-mission', state) is False
        assert routes.capture('other-mission', state) is True
        assert routes.capture_status()['status'] == 'degraded'
        monkeypatch.setattr(mem, 'append', append)
        assert routes.capture('failed-mission', state) is True
        assert routes.capture_status()['status'] == 'ready'
        assert len(mem.session_fetch(PROJECT, 'failed-mission')) == 2
    finally:
        routes.close()


def test_health_recovery_replays_retained_snapshot(tmp_path):
    from types import SimpleNamespace
    from arc_science.memory.capture import PROJECT
    routes = MemoryRoutes(tmp_path, worker_binary(), _authorized)
    state = SimpleNamespace(events=[SimpleNamespace(kind='retained', round=0, detail='recovered')], model_records=[])
    routes.set_snapshot_source(lambda: iter([('mission', state)]))
    old = routes._client_or_503()
    old._proc.kill()
    old._proc.wait(timeout=5)
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as client:
        assert client.get('/api/memory/health').status_code == 200
    routes.close()  # waits for the recovery replay before retiring the worker
    with MemoryClient(worker_binary(), tmp_path/'memory.db') as mem:
        assert len(mem.session_fetch(PROJECT, 'mission')) == 1


def test_worker_launch_failure_is_sanitized_and_does_not_fail_capture(tmp_path, monkeypatch):
    import arc_science.memory.web as web
    def fail(*args): raise OSError('C:/private/secret-token')
    monkeypatch.setattr(web, 'MemoryClient', fail)
    routes = MemoryRoutes(tmp_path, worker_binary(), _authorized)
    try:
        assert routes.capture('mission', object()) is False
        app = FastAPI()
        app.include_router(routes.router)
        with TestClient(app) as client:
            health = client.get('/api/memory/health')
            assert health.status_code == 503
            assert health.json()['capture']['status'] == 'degraded'
            assert 'private' not in health.text
            assert client.get('/api/memory/sessions', params={'project':'p'}).status_code == 503
    finally:
        routes.close()


def test_shutdown_reconciliation_keeps_one_followup_for_final_snapshot(tmp_path):
    import json
    import threading
    from types import SimpleNamespace
    from arc_science.memory.capture import PROJECT
    entered, release = threading.Event(), threading.Event()
    current = [SimpleNamespace(events=[], model_records=[], status='running', round=0, stop_reason='running')]
    calls = []
    def source():
        calls.append(1)
        yield 'mission', current[0]
        entered.set()
        assert release.wait(5)
    routes = MemoryRoutes(tmp_path, worker_binary(), _authorized)
    routes.set_snapshot_source(source)
    routes.schedule_reconcile()
    assert entered.wait(5)
    current[0] = SimpleNamespace(events=[], model_records=[], status='paused', round=0, stop_reason='shutdown')
    for _ in range(10):
        routes.schedule_reconcile()
    release.set()
    routes.close()
    assert len(calls) == 2, 'requests during replay coalesce into one final repair pass'
    with MemoryClient(worker_binary(), tmp_path/'memory.db') as mem:
        records = mem.session_fetch(PROJECT, 'mission')
        assert json.loads(records[-1]['text'])['status'] == 'paused'
