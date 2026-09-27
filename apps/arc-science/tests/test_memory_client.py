"""Behavior tests for the Python memory client that drives arc-memory-worker."""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from arc_science.memory import MemoryClient


# Read once at import: service tests unset ARC_MEMORY_WORKER to test an unconfigured app.
CONFIGURED_WORKER = os.environ.get("ARC_MEMORY_WORKER")
WORKER_CRATE = Path(__file__).resolve().parents[3] / "native" / "arc-memory"


def worker_binary() -> Path:
    """The service's own locator (ARC_MEMORY_WORKER) first, then the newest cargo build.

    Setting ARC_MEMORY_WORKER declares that the worker-backed tests must run, so a
    path that is not a file fails the test instead of skipping or falling back. Under
    CI the variable is required, so a gate that forgot the worker goes red, not green.
    A cargo build older than the crate sources fails too: a stale worker answers with
    old behaviour, and its results would be read as evidence about the current code.
    """
    if CONFIGURED_WORKER:
        if not Path(CONFIGURED_WORKER).is_file():
            pytest.fail(f"ARC_MEMORY_WORKER is set but is not a file: {CONFIGURED_WORKER}")
        return Path(CONFIGURED_WORKER)
    if os.environ.get("CI"):
        pytest.fail("CI must build arc-memory-worker and set ARC_MEMORY_WORKER; these tests cannot skip")
    targets = [Path(os.environ["CARGO_TARGET_DIR"])] if os.environ.get("CARGO_TARGET_DIR") else []
    targets.append(WORKER_CRATE / "target")
    name = "arc-memory-worker.exe" if os.name == "nt" else "arc-memory-worker"
    built = [t / p / name for t in targets for p in ("release", "debug") if (t / p / name).is_file()]
    if built:
        newest = max(built, key=lambda b: b.stat().st_mtime)
        sources = [WORKER_CRATE / "Cargo.toml", WORKER_CRATE / "Cargo.lock", *(WORKER_CRATE / "src").rglob("*.rs")]
        edited = max((s.stat().st_mtime for s in sources if s.is_file()), default=0.0)
        if newest.stat().st_mtime < edited:
            pytest.fail(f"{newest} is older than the arc-memory sources; rebuild it or set ARC_MEMORY_WORKER")
        return newest
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


def test_client_round_trips_append_inspect_search(tmp_path):
    with MemoryClient(worker_binary(), tmp_path / "memory.db") as mem:
        assert mem.health()["protocol"] == "arc-memory/1"

        record_id = mem.append(sample("hydrogen bond note"))
        got = mem.inspect(record_id)
        assert got["text"] == "hydrogen bond note"
        assert got["role"] == "planner"

        hits = mem.search(
            {"project": "p", "session": None, "agent": None}, "hydrogen", 10
        )
        assert len(hits) == 1
        assert hits[0]["record"]["text"] == "hydrogen bond note"


def test_memory_worker_launch_gets_scrubbed_environment(tmp_path, monkeypatch):
    import io
    import arc_science.memory.client as client

    monkeypatch.setenv("ARC_NATIVE_SESSION_SECRET", "native-session-secret-must-not-leak")
    monkeypatch.setenv("OPENAI_API_KEY", "operator-api-key-must-not-leak")
    monkeypatch.setenv("PYTHONPATH", "/unsafe/import/path")
    launched = {}

    class FakeProc:
        stdin = io.BytesIO()
        stdout = io.BytesIO()

        def poll(self):
            return None

        def kill(self):
            pass

        def wait(self, timeout=None):
            return 0

    def popen(_argv, **kwargs):
        launched["env"] = kwargs["env"]
        return FakeProc()

    monkeypatch.setattr(client.subprocess, "Popen", popen)
    mem = MemoryClient(tmp_path / "arc-memory-worker", tmp_path / "memory.db")

    environment = launched["env"]
    assert "PATH" in {key.upper(): value for key, value in environment.items()}
    assert "ARC_NATIVE_SESSION_SECRET" not in environment
    assert "OPENAI_API_KEY" not in environment
    assert "PYTHONPATH" not in environment
    assert mem.is_alive()


def test_client_stats_report_storage_from_the_worker(tmp_path):
    with MemoryClient(worker_binary(), tmp_path / "memory.db") as mem:
        mem.append(sample("hydrogen bond note"))
        hidden = mem.append(sample("salt bridge"))
        mem.disable(hidden)
        stats = mem.stats()
    assert stats["counts"] == {"sessions": 1, "records": 2, "visible": 1, "hidden": 1, "blobs": 2, "embeddings": 0}
    assert stats["bytes"]["blobs_raw"] == len("hydrogen bond note") + len("salt bridge")
    assert stats["bytes"]["logical"] == stats["bytes"]["blobs_raw"]
    assert stats["index"]["in_step"] is True
    assert stats["retrieval_modes"] == ["lexical"]


def test_client_surfaces_worker_errors(tmp_path):
    from arc_science.memory import MemoryError as MemErr

    with MemoryClient(worker_binary(), tmp_path / "memory.db") as mem:
        with pytest.raises(MemErr):
            mem.inspect("does-not-exist")


def test_call_times_out_and_kills_a_hung_worker():
    import io
    import threading
    import time as _t

    from arc_science.memory.client import MemoryClient
    from arc_science.memory.client import MemoryError as MemErr

    mem = object.__new__(MemoryClient)
    killed = threading.Event()

    class Out:
        def read(self, _n):
            killed.wait(5)  # unblocks when the worker is killed, else after 5s
            return b""       # EOF

    class FakeProc:
        def __init__(self):
            self.stdin = io.BytesIO()
            self.stdout = Out()

        def poll(self):
            return 1 if killed.is_set() else None

        def kill(self):
            killed.set()

        def wait(self, timeout=None):
            return 1

    mem._proc = FakeProc()
    mem._lock = threading.Lock()
    mem._timeout = 0.2

    start = _t.time()
    with pytest.raises(MemErr):
        mem.health()
    assert _t.time() - start < 3, "a hung worker must be bounded by the call timeout"
    assert killed.is_set()


def test_rejects_oversized_response_before_reading_payload():
    import io
    import struct
    import threading
    from arc_science.memory.client import MemoryError as MemErr

    class FakeProc:
        stdin = io.BytesIO()
        stdout = io.BytesIO(struct.pack('<I', 16 * 1024 * 1024 + 1))
        killed = False
        def poll(self): return 1 if self.killed else None
        def kill(self): self.killed = True

    mem = object.__new__(MemoryClient)
    mem._proc = FakeProc()
    mem._lock = threading.Lock()
    mem._timeout = 1
    with pytest.raises(MemErr, match='frame'):
        mem.health()
    assert mem._proc.killed, 'invalid framing must retire a desynchronized worker'


def test_configured_worker_that_is_missing_fails_instead_of_skipping(tmp_path, monkeypatch):
    # ARC_MEMORY_WORKER declares that the worker-backed tests must run; a wrong path is
    # a broken run, not a quiet skip or a silent fall-back to another build.
    import test_memory_client as module

    monkeypatch.setattr(module, "CONFIGURED_WORKER", str(tmp_path / "missing-worker.exe"))
    with pytest.raises(pytest.fail.Exception, match="ARC_MEMORY_WORKER"):
        module.worker_binary()


def test_ci_without_a_configured_worker_fails_instead_of_skipping(monkeypatch):
    # CI builds the worker before pytest and exports ARC_MEMORY_WORKER; if it does
    # not, the gate must go red rather than pass with the worker-backed tests skipped.
    import test_memory_client as module

    monkeypatch.setattr(module, "CONFIGURED_WORKER", None)
    monkeypatch.setenv("CI", "true")
    with pytest.raises(pytest.fail.Exception, match="ARC_MEMORY_WORKER"):
        module.worker_binary()


def _fake_crate(tmp_path, binaries):
    crate = tmp_path / "arc-memory"
    (crate / "src").mkdir(parents=True)
    (crate / "src" / "engine.rs").write_text("// source")
    os.utime(crate / "src" / "engine.rs", (2_000, 2_000))
    name = "arc-memory-worker.exe" if os.name == "nt" else "arc-memory-worker"
    for profile, mtime in binaries.items():
        binary = crate / "target" / profile / name
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b"")
        os.utime(binary, (mtime, mtime))
    return crate, name


def test_worker_binary_refuses_a_build_older_than_its_sources(tmp_path, monkeypatch):
    # A stale worker answers with old behaviour, so its results are not evidence.
    import sys
    module = sys.modules[__name__]
    crate, _ = _fake_crate(tmp_path, {"release": 1_000})
    monkeypatch.setattr(module, "CONFIGURED_WORKER", None)
    monkeypatch.setattr(module, "WORKER_CRATE", crate)
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.delenv("CARGO_TARGET_DIR", raising=False)
    with pytest.raises(pytest.fail.Exception, match="older than the arc-memory sources"):
        module.worker_binary()


def test_worker_binary_takes_the_newest_build(tmp_path, monkeypatch):
    import sys
    module = sys.modules[__name__]
    crate, name = _fake_crate(tmp_path, {"release": 1_000, "debug": 3_000})
    monkeypatch.setattr(module, "CONFIGURED_WORKER", None)
    monkeypatch.setattr(module, "WORKER_CRATE", crate)
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.delenv("CARGO_TARGET_DIR", raising=False)
    assert module.worker_binary() == crate / "target" / "debug" / name


def test_client_errors_carry_the_worker_kind(tmp_path):
    import sqlite3
    from arc_science.memory.client import MemoryError as MemErr

    with MemoryClient(worker_binary(), tmp_path / "memory.db") as mem:
        with pytest.raises(MemErr) as missing:
            mem.inspect("does-not-exist")
        assert missing.value.kind == "not_found"

        mem.append(sample("hydrogen bond note"))
        with sqlite3.connect(tmp_path / "memory.db") as conn:
            conn.execute("UPDATE blobs SET original_size = original_size - 1")
        with pytest.raises(MemErr) as corrupt:
            mem.session_fetch("p", "s")
        assert corrupt.value.kind == "corrupt"
        with sqlite3.connect(tmp_path / "memory.db") as conn:
            conn.execute("UPDATE blobs SET data = X'00010203'")
        with pytest.raises(MemErr) as undecodable:
            mem.session_fetch("p", "s")
        assert undecodable.value.kind == "corrupt"
    assert MemErr("legacy worker message").kind is None
