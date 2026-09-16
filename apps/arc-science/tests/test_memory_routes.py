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
    finally:
        routes.close()


def test_routes_report_unconfigured_worker(tmp_path):
    routes = MemoryRoutes(tmp_path, None, _authorized)
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as client:
        assert client.get("/api/memory/health").status_code == 503
