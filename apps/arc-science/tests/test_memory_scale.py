"""Opt-in scale measurement for memory capture and restart reconciliation.

Runs the real release worker against 100 retained missions shaped like actual
captures (event lines plus JSON model payloads), then the documented regime beyond
100 missions through the live routes. Set ARC_MEMORY_SCALE=1 to run; numbers are
printed with -s and the budgets come from docs/hoh/2026-09-19-plan.md.
"""
from __future__ import annotations

import ctypes
import hashlib
import json
import os
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from arc_science.memory import MemoryClient
from arc_science.memory.capture import PROJECT
from arc_science.memory.web import MemoryRoutes
from test_memory_routes import _authorized

pytestmark = pytest.mark.skipif(not os.environ.get('ARC_MEMORY_SCALE'), reason='Set ARC_MEMORY_SCALE=1 for the scale measurement')

MISSIONS = 100
EVENTS = 40
MODELS = 20
RECORDS = EVENTS + MODELS + 1  # plus the typed status snapshot
TERMS = ['hydrogen', 'bond', 'ligand', 'pocket', 'residue', 'epitope', 'paratope', 'salt', 'bridge', 'solvent']


def release_worker() -> Path:
    """The candidate under measurement: ARC_MEMORY_WORKER, else the release build only."""
    configured = os.environ.get('ARC_MEMORY_WORKER')
    root = Path(__file__).resolve().parents[3]
    name = 'arc-memory-worker.exe' if os.name == 'nt' else 'arc-memory-worker'
    binary = Path(configured) if configured else root / 'native' / 'arc-memory' / 'target' / 'release' / name
    if not binary.is_file():
        pytest.skip(f'release worker not built: {binary}')
    return binary


def describe(binary: Path) -> str:
    digest = hashlib.sha256(binary.read_bytes()).hexdigest()
    return f'{binary.name} sha256={digest[:16]}… mtime={time.strftime("%Y-%m-%d %H:%M", time.localtime(binary.stat().st_mtime))}'


def mission_state(index: int) -> SimpleNamespace:
    def term(k: int) -> str:
        return TERMS[(index * 7 + k) % len(TERMS)]
    events = [SimpleNamespace(kind='observation', round=i // 5,
                              detail=f'{term(i)} {term(i + 1)} between Asp{(index * 13 + i) % 97} and chain {"ABCD"[(index + i) % 4]}')
              for i in range(EVENTS)]
    models = [SimpleNamespace(role=('planner', 'analyst', 'falsifier')[i % 3], round=i // 3,
                              payload={'assessments': [{'position': 'support' if k % 3 == 0 else 'challenge',
                                                        'evidence': f'{term(k)} {term(k + 1)} near residue {(index + i + k) % 300}',
                                                        'weight': k / 10} for k in range(20 + (index + i) % 40)]})
              for i in range(MODELS)]
    return SimpleNamespace(events=events, model_records=models, status='paused', round=EVENTS // 5, stop_reason='Review needed')


def worker_rss_mib(client: MemoryClient) -> float | None:
    if os.name != 'nt':
        return None

    class Counters(ctypes.Structure):
        _fields_ = [('cb', ctypes.c_uint32), ('PageFaultCount', ctypes.c_uint32)] + [
            (name, ctypes.c_size_t) for name in ('PeakWorkingSetSize', 'WorkingSetSize', 'QuotaPeakPagedPoolUsage',
                                                 'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage', 'QuotaNonPagedPoolUsage',
                                                 'PagefileUsage', 'PeakPagefileUsage')]
    counters = Counters(cb=ctypes.sizeof(Counters))
    if not ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.c_void_p(client._proc._handle), ctypes.byref(counters), counters.cb):
        return None
    return counters.WorkingSetSize / 1048576


def reconcile(routes: MemoryRoutes, source) -> float:
    routes.set_snapshot_source(source)
    started = time.perf_counter()
    routes.schedule_reconcile()
    routes.close()  # drains the single capture thread, then retires the worker
    return time.perf_counter() - started


def wait_idle(routes: MemoryRoutes, timeout: float = 60.0) -> float:
    started = time.perf_counter()
    while routes.capture_status()['pending']:
        assert time.perf_counter() - started < timeout, 'capture thread did not drain'
        time.sleep(0.05)
    return time.perf_counter() - started


def test_capture_and_restart_reconciliation_at_one_hundred_missions(tmp_path, capsys):
    binary = release_worker()
    states = [(f'mission-{i:04d}', mission_state(i)) for i in range(MISSIONS)]

    first = reconcile(MemoryRoutes(tmp_path, binary, _authorized), lambda: iter(states))
    replay = reconcile(MemoryRoutes(tmp_path, binary, _authorized), lambda: iter(states))

    with MemoryClient(binary, tmp_path / 'memory.db') as mem:
        sessions = mem.session_list(PROJECT)
        assert len(sessions) == MISSIONS
        assert all(s['record_count'] == RECORDS for s in sessions)
        started = time.perf_counter()
        hits = mem.search({'project': PROJECT, 'session': None, 'agent': None}, 'hydrogen', 10)
        search_ms = (time.perf_counter() - started) * 1000
        assert len(hits) == 10
        rss = worker_rss_mib(mem)
    size = sum(p.stat().st_size for p in tmp_path.glob('memory.db*')) / 1048576
    with capsys.disabled():
        print(f'\nworker: {describe(binary)}')
        print(f'first capture of {MISSIONS} missions x {RECORDS} records: {first:.1f} s ({first * 1000 / (MISSIONS * RECORDS):.1f} ms/record)')
        print(f'restart reconciliation (idempotent replay of {MISSIONS * RECORDS} records): {replay:.2f} s; '
              f'common-term search {search_ms:.1f} ms; database {size:.1f} MiB; worker RSS {rss if rss is None else round(rss, 1)} MiB')
    assert replay <= 30, f'restart reconciliation took {replay:.1f} s'
    if rss is not None:
        assert rss <= 200, f'worker working set {rss:.0f} MiB'


def test_beyond_one_hundred_missions_stays_degraded_and_bounded(tmp_path, capsys):
    binary = release_worker()
    states = [(f'mission-{i:04d}', mission_state(i)) for i in range(MISSIONS)]
    replays = 0

    def overflowing():
        # Mirrors service.memory_snapshots: 100 retained missions, then the limit.
        nonlocal replays
        replays += 1
        yield from states
        raise RuntimeError('Retained mission replay exceeds bounded repair limit')

    first = reconcile(MemoryRoutes(tmp_path, binary, _authorized), overflowing)
    assert replays == 1

    # A restart in the overflow regime, exercised through the live routes: the
    # service schedules one replay at startup, then each health read retries once.
    routes = MemoryRoutes(tmp_path, binary, _authorized)
    routes.set_snapshot_source(overflowing)
    routes.schedule_reconcile()
    startup_replay = wait_idle(routes)
    assert replays == 2 and routes.capture_status()['status'] == 'degraded'
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as client:
        started = time.perf_counter()
        health = client.get('/api/memory/health')
        assert health.status_code == 200
        capture = health.json()['capture']
        drained = wait_idle(routes)
        health_replay = time.perf_counter() - started
        assert replays == 3, f'one health read must cost at most one replay, saw {replays - 2}'
        assert capture['status'] == 'degraded' and capture['last_error']
        sessions = client.get('/api/memory/sessions', params={'project': PROJECT})
        assert sessions.status_code == 200 and len(sessions.json()) == MISSIONS
        found = client.post('/api/memory/search', json={'project': PROJECT, 'query': 'hydrogen', 'limit': 5})
        assert found.status_code == 200 and len(found.json()) == 5
    routes.close()
    with capsys.disabled():
        print(f'\nworker: {describe(binary)}')
        print(f'overflow regime: first capture {first:.1f} s; startup replay {startup_replay:.2f} s; one health read '
              f'triggered one replay of {MISSIONS} missions taking {health_replay:.2f} s (drain wait {drained:.2f} s); '
              f'status {json.dumps(capture)}; sessions and search served while degraded')
