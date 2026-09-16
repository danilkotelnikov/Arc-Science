"""Behavior tests for the Python memory client that drives arc-memory-worker."""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from arc_science.memory import MemoryClient


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


def test_client_surfaces_worker_errors(tmp_path):
    from arc_science.memory import MemoryError as MemErr

    with MemoryClient(worker_binary(), tmp_path / "memory.db") as mem:
        with pytest.raises(MemErr):
            mem.inspect("does-not-exist")
