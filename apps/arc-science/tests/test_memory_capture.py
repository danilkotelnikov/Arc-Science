"""Capture of the exploration decision-tree / HoH reconciliation into memory."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from arc_science.memory import MemoryClient
from arc_science.memory.capture import PROJECT, SessionCapture


def worker_binary() -> Path:
    root = Path(__file__).resolve().parents[3]
    name = "arc-memory-worker.exe" if os.name == "nt" else "arc-memory-worker"
    for profile in ("release", "debug"):
        candidate = root / "native" / "arc-memory" / "target" / profile / name
        if candidate.exists():
            return candidate
    pytest.skip("arc-memory-worker binary not built")


def _event(kind, rnd, detail):
    return SimpleNamespace(kind=kind, round=rnd, detail=detail)


def _model(role, rnd, payload):
    return SimpleNamespace(role=role, round=rnd, payload=payload)


def test_capture_is_idempotent_and_maps_roles(tmp_path):
    with MemoryClient(worker_binary(), tmp_path / "memory.db") as mem:
        cap = SessionCapture(mem, "s1")
        state1 = SimpleNamespace(
            events=[_event("plan_committed", 0, "start")],
            model_records=[_model("analyst", 0, {"summary": "ok"})],
        )
        seen = cap.observe(state1, 0, 0)
        assert seen == (1, 1)

        state2 = SimpleNamespace(
            events=state1.events + [_event("observation", 0, "fit-linear: ok")],
            model_records=state1.model_records + [_model("falsifier", 0, {"summary": "challenge"})],
        )
        seen = cap.observe(state2, seen[0], seen[1])
        assert seen == (2, 2)

        records = mem.session_fetch(PROJECT, "s1")
        assert len(records) == 4, "high-water tracking must not duplicate captured records"
        roles = {r["role"] for r in records}
        assert {"analyst", "falsifier", "system"} <= roles


def test_capture_records_the_decision_tree_of_a_demo_mission(tmp_path):
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.engine import explore
    from arc_science.exploration.models import MissionRequest

    request = MissionRequest(goal="Explore the fixture with a bounded comparison.")
    with MemoryClient(worker_binary(), tmp_path / "memory.db") as mem:
        cap = SessionCapture(mem, "mission-1")
        water = [0, 0]

        def emit(state):
            water[0], water[1] = cap.observe(state, water[0], water[1])

        asyncio.run(explore(request, DemoAgent(), emit=emit))

        records = mem.session_fetch(PROJECT, "mission-1")
        roles = {r["role"] for r in records}
        # the independent reconciliation roles and the planner are all captured
        assert {"planner", "analyst", "falsifier"} <= roles
        assert any(r["role"] == "system" and "plan_committed" in r["text"] for r in records)
        # later-round reasoning is reachable by meaning of the branch it proposed
        hits = mem.search(
            {"project": PROJECT, "session": "mission-1", "agent": None}, "quadratic", 10
        )
        assert len(hits) >= 1
        # the round is preserved as the compaction epoch
        assert mem.session_list(PROJECT)[0]["max_epoch"] >= 1
