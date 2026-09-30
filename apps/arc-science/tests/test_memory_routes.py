"""Behavior tests for the /api/memory/* FastAPI routes."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from arc_science.memory import MemoryClient
from arc_science.memory.web import MemoryRoutes
from test_memory_client import worker_binary


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
            assert health.json()["capture"] == {"status": "ready", "pending": 0, "last_error": None, "code": None}

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


C6_KEYS = {"path", "engine", "sqlite_version", "codec", "bytes", "counts", "index", "retrieval_modes", "last_capture_ms"}


def test_stats_route_reports_storage_facts(tmp_path):
    binary = worker_binary()
    shared = "hydrogen bond between Asp32 and the ligand. " * 20
    with MemoryClient(binary, tmp_path / "memory.db") as mem:
        mem.append({**sample(shared), "wall_time_ms": 40})
        mem.append({**sample(shared), "session_id": "s2", "wall_time_ms": 50})
        mem.disable(mem.append({**sample("salt bridge"), "wall_time_ms": 60}))

    routes = MemoryRoutes(tmp_path, binary, _authorized)
    app = FastAPI()
    app.include_router(routes.router)
    try:
        with TestClient(app) as client:
            response = client.get("/api/memory/stats")
            assert response.status_code == 200
            stats = response.json()
            assert set(stats) == C6_KEYS
            assert stats["path"] == str(tmp_path / "memory.db")
            assert stats["engine"] == "sqlite-wal"
            assert stats["codec"] == {"name": "zstd", "level": 19, "dictionary": False}
            assert stats["counts"] == {"sessions": 2, "records": 3, "visible": 2, "hidden": 1,
                                       "blobs": 2, "embeddings": 0}
            assert stats["bytes"]["blobs_raw"] == len(shared) + len("salt bridge")
            assert stats["bytes"]["logical"] == 2 * len(shared) + len("salt bridge")
            assert 0 < stats["bytes"]["blobs_stored"] < stats["bytes"]["blobs_raw"]
            assert stats["bytes"]["db"] > 0 and stats["bytes"]["wal"] >= 0
            assert {k: stats["index"][k] for k in ("kind", "tokenizer", "in_step")} == {
                "kind": "fts5-bm25", "tokenizer": "unicode61", "in_step": True}
            assert stats["retrieval_modes"] == ["lexical"]
            assert stats["last_capture_ms"] == 60
            assert stats["sqlite_version"] == client.get("/api/memory/health").json()["sqlite"]
    finally:
        routes.close()


def test_session_rows_carry_mission_title_and_last_capture(tmp_path):
    import json
    import sqlite3
    from contextlib import closing
    from arc_science.exploration.repository import MissionRepository

    binary = worker_binary()
    MissionRepository(tmp_path / "missions.db")  # the service's schema, created empty
    goal = "Map the  hydrogen-bond network\nof the Asp32 pocket " + "x" * 100
    with closing(sqlite3.connect(tmp_path / "missions.db")) as db, db:
        db.execute("INSERT INTO missions(id,request,request_digest,state,revision,creation_key) VALUES(?,?,?,?,?,?)",
                   ("m1", json.dumps({"goal": goal}), "d", "{}", 0, "k"))
    with MemoryClient(binary, tmp_path / "memory.db") as mem:
        mem.append({**sample("first"), "session_id": "m1", "wall_time_ms": 7})
        mem.append({**sample("second"), "session_id": "m1", "wall_time_ms": 9})
        mem.append({**sample("orphan"), "session_id": "gone", "wall_time_ms": 3})

    routes = MemoryRoutes(tmp_path, binary, _authorized)
    app = FastAPI()
    app.include_router(routes.router)
    try:
        with TestClient(app) as client:
            rows = {row["session_id"]: row for row in client.get("/api/memory/sessions", params={"project": "p"}).json()}
            title = rows["m1"]["title"]
            assert len(title) == 80
            assert title.startswith("Map the hydrogen-bond network of the Asp32 pocket x")
            assert rows["m1"]["last_capture_ms"] == 9
            assert rows["m1"]["record_count"] == 2
            assert rows["gone"]["title"] is None and rows["gone"]["last_capture_ms"] == 3
    finally:
        routes.close()


def test_session_rows_without_missions_db_have_no_title(tmp_path):
    binary = worker_binary()
    with MemoryClient(binary, tmp_path / "memory.db") as mem:
        mem.append(sample("note"))
    routes = MemoryRoutes(tmp_path, binary, _authorized)
    app = FastAPI()
    app.include_router(routes.router)
    try:
        with TestClient(app) as client:
            [row] = client.get("/api/memory/sessions", params={"project": "p"}).json()
            assert row["title"] is None and row["last_capture_ms"] == 1
    finally:
        routes.close()


def _error(response, status, code):
    from arc_science.memory.codes import MEMORY_ERROR_CODES
    assert response.status_code == status, response.text
    detail = response.json()["detail"]
    assert set(detail) == {"code", "detail", "facts"}
    assert detail["code"] == code and code in MEMORY_ERROR_CODES
    # The visible copy is always the registry sentence, so the registry check covers it;
    # anything variable travels in facts.
    assert detail["detail"] == MEMORY_ERROR_CODES[code]
    assert isinstance(detail["facts"], dict)
    return detail


def test_memory_error_codes_are_registered_english_sentences():
    from arc_science.memory.codes import MEMORY_ERROR_CODES
    for reason in ("worker_unconfigured", "worker_unavailable", "worker_disconnected",
                   "record_not_found", "read_budget", "operation_failed", "record_corrupt"):
        assert f"memory.{reason}" in MEMORY_ERROR_CODES
    for code, english in MEMORY_ERROR_CODES.items():
        assert code.startswith("memory.") and english and english[0].isupper()
        assert len(english) <= 90, code  # R005: visible error text stays short


def test_corrupt_copy_claims_no_check_the_worker_did_not_run():
    # Most corrupt causes (undecodable blob, negative size, bad UTF-8) fail before any
    # digest is computed, so the one shared sentence may only say the record is damaged.
    from arc_science.memory.codes import MEMORY_ERROR_CODES
    english = MEMORY_ERROR_CODES["memory.record_corrupt"].lower()
    assert "damaged" in english
    for claim in ("digest", "integrity", "no longer matches"):
        assert claim not in english


def test_unconfigured_worker_errors_carry_code_and_facts(tmp_path):
    routes = MemoryRoutes(tmp_path, None, _authorized)
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as client:
        for response in (client.get("/api/memory/stats"),
                         client.get("/api/memory/sessions", params={"project": "p"})):
            detail = _error(response, 503, "memory.worker_unconfigured")
            assert detail["facts"] == {"variable": "ARC_MEMORY_WORKER"}
        health = client.get("/api/memory/health").json()
        assert health["detail"]["code"] == "memory.worker_unconfigured"
        assert health["capture"]["code"] == "memory.worker_unconfigured"
        assert routes.capture_status()["code"] == "memory.worker_unconfigured"
        detail = _error(client.get("/api/memory/sessions/s", params={"project": "p", "from_seq": 5, "to_seq": 1}),
                        422, "memory.invalid_range")
        assert detail["facts"] == {"from_seq": 5, "to_seq": 1}


def test_worker_errors_map_to_codes(tmp_path, monkeypatch):
    from arc_science.memory.client import MemoryError, MemoryUnavailable
    binary = worker_binary()
    routes = MemoryRoutes(tmp_path, binary, _authorized)
    app = FastAPI()
    app.include_router(routes.router)
    try:
        with TestClient(app) as client:
            detail = _error(client.get("/api/memory/records/nope"), 404, "memory.record_not_found")
            assert detail["facts"] == {"record_id": "nope"}
            detail = _error(client.post("/api/memory/records/nope/disable", json={"declared_effects": ["magic"]}),
                            409, "memory.declaration_refused")
            assert "magic" in detail["facts"]["reason"]
            # An over-long unknown effect stays out of the visible copy (R005: at most 90 characters).
            detail = _error(client.post("/api/memory/records/nope/disable", json={"declared_effects": ["a" * 100]}),
                            409, "memory.declaration_refused")
            assert len(detail["detail"]) <= 90 and "a" * 50 in detail["facts"]["reason"]

            mem = routes._client_or_503()
            def raising(exc):
                def call(*_args):
                    raise exc
                return call
            monkeypatch.setattr(mem, "search", raising(MemoryError("retrieval exceeds the bounded read budget")))
            detail = _error(client.post("/api/memory/search", json={"project": "p", "query": "q"}), 409, "memory.read_budget")
            assert detail["facts"] == {"operation": "search"}
            monkeypatch.setattr(mem, "search", raising(MemoryError("sqlite: C:/private/secret")))
            response = client.post("/api/memory/search", json={"project": "p", "query": "q"})
            detail = _error(response, 409, "memory.operation_failed")
            assert detail["facts"] == {"operation": "search"} and "private" not in response.text
            # A session read names its real cause: only a budget refusal is a budget error.
            monkeypatch.setattr(mem, "session_fetch", raising(MemoryError("anything")))
            detail = _error(client.get("/api/memory/sessions/s", params={"project": "p"}), 409, "memory.operation_failed")
            assert detail["facts"] == {"operation": "session_fetch"}
            monkeypatch.setattr(mem, "session_fetch", raising(MemoryError("over", kind="read_budget")))
            _error(client.get("/api/memory/sessions/s", params={"project": "p"}), 409, "memory.read_budget")
            monkeypatch.setattr(mem, "stats", raising(MemoryUnavailable("memory worker closed the connection")))
            _error(client.get("/api/memory/stats"), 503, "memory.worker_disconnected")
    finally:
        routes.close()


def test_worker_launch_failure_has_unavailable_code(tmp_path, monkeypatch):
    import arc_science.memory.web as web
    def fail(*args): raise OSError('C:/private/secret-token')
    monkeypatch.setattr(web, 'MemoryClient', fail)
    routes = MemoryRoutes(tmp_path, worker_binary(), _authorized)
    try:
        assert routes.capture('mission', object()) is False
        assert routes.capture_status()['code'] == 'memory.capture_incomplete'
        app = FastAPI()
        app.include_router(routes.router)
        with TestClient(app) as client:
            response = client.get('/api/memory/stats')
            _error(response, 503, 'memory.worker_unavailable')
            assert 'private' not in response.text
            health = client.get('/api/memory/health').json()
            assert health['capture']['code'] == 'memory.worker_unavailable'
            assert health['capture']['last_error'] == health['detail']['detail']
    finally:
        routes.close()


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


def test_corrupt_session_record_reports_integrity_not_read_budget(tmp_path):
    import sqlite3
    routes = MemoryRoutes(tmp_path, worker_binary(), _authorized)
    app = FastAPI()
    app.include_router(routes.router)
    try:
        with TestClient(app) as client:
            routes._client_or_503().append(sample("hydrogen bond note"))
            with sqlite3.connect(tmp_path / "memory.db") as conn:
                conn.execute("UPDATE blobs SET original_size = original_size - 1")
            detail = _error(client.get("/api/memory/sessions/s", params={"project": "p"}), 500, "memory.record_corrupt")
            assert detail["facts"] == {"operation": "session_fetch"}
            with sqlite3.connect(tmp_path / "memory.db") as conn:
                conn.execute("UPDATE blobs SET original_size = -1")
            _error(client.get("/api/memory/sessions/s", params={"project": "p"}), 500, "memory.record_corrupt")
            with sqlite3.connect(tmp_path / "memory.db") as conn:
                conn.execute("UPDATE blobs SET original_size = 9000000")
            _error(client.get("/api/memory/sessions/s", params={"project": "p"}), 409, "memory.read_budget")
    finally:
        routes.close()


def test_tampered_blob_bytes_report_record_corrupt(tmp_path):
    """Bytes zstd cannot decode are a corrupt record, not a failed operation."""
    import sqlite3
    routes = MemoryRoutes(tmp_path, worker_binary(), _authorized)
    app = FastAPI()
    app.include_router(routes.router)
    try:
        with TestClient(app) as client:
            record_id = routes._client_or_503().append(sample("hydrogen bond note"))
            with sqlite3.connect(tmp_path / "memory.db") as conn:
                conn.execute("UPDATE blobs SET data = X'00010203'")
            detail = _error(client.get("/api/memory/sessions/s", params={"project": "p"}), 500, "memory.record_corrupt")
            assert detail["facts"] == {"operation": "session_fetch"}
            detail = _error(client.get(f"/api/memory/records/{record_id}"), 500, "memory.record_corrupt")
            assert detail["facts"] == {"operation": "inspect"}
    finally:
        routes.close()
