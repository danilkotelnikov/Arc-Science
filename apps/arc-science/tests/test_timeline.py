"""The operational timeline (started/finished rows per operation), pause, cancel actor and
time, retry from error, and the legacy mission without a timeline."""
from __future__ import annotations

import asyncio
import re
import sqlite3
import sys
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from arc_science import service
from arc_science.service import create_app

TOKEN = 't' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}
FAKE = Path(__file__).parent / 'fixtures' / 'fake_claude.py'
PAUSED = re.compile(r'^Paused by operator:token at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z; resume explicitly\.$')
CANCELLED = re.compile(r'^Cancelled by operator:token at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z; late results fenced\.$')


def app(path):
    return create_app(data_dir=path, token=TOKEN)


def mission(c, **body):
    return c.post('/api/missions', headers=AUTH, json={'goal': 'Explore the response', **body}).json()['id']


def row_of(c, mid):
    return c.get(f'/api/missions/{mid}', headers=AUTH).json()


def timeline(c, mid):
    return c.get(f'/api/missions/{mid}/timeline', headers=AUTH).json()


def wait_until(condition, what, seconds=30):
    for _ in range(int(seconds / 0.02)):
        value = condition()
        if value:
            return value
        time.sleep(0.02)
    raise AssertionError('timed out waiting for ' + what)


def wait_final(c, mid):
    def stopped():
        row = row_of(c, mid)
        return row if row['state']['status'] not in ('ready', 'running') else None
    return wait_until(stopped, 'the mission to stop')


def check_rows(rows):
    assert [r['sequence'] for r in rows] == sorted({r['sequence'] for r in rows})
    for r in rows:
        assert r['outcome_source'] == 'recorded' and r['outcome'] != 'outcome_unknown', r
        assert r['started_at'] <= r['finished_at']
        if r['role'] in ('planner', 'analyst', 'falsifier'):
            assert (r['transport'], r['model_requested']) == ('fixture', 'scripted-fixture-v1')
        else:
            assert r['transport'] is None and r['model_requested'] is None


# T1
def test_a_demo_mission_records_every_operation_in_order_with_recorded_outcomes(tmp_path):
    with TestClient(app(tmp_path)) as c:
        short = mission(c, max_rounds=2)
        assert c.post(f'/api/missions/{short}/start', headers=AUTH).status_code == 202
        assert wait_final(c, short)['state']['status'] == 'budget_exhausted'
        answer = timeline(c, short)
        assert answer['kind'] == 'operational' and answer['recorded'] is True and answer['count'] == len(answer['rows'])
        assert 'not scientific evidence' in answer['note']
        rows = answer['rows']
        assert [r['operation'] for r in rows] == ['start', 'plan', 'tool', 'reconcile', 'reconcile', 'plan', 'tool', 'tool', 'reconcile', 'reconcile', 'stop']
        check_rows(rows)
        assert rows[0]['actor'] == 'operator:token' and rows[0]['source'] == 'operator' and rows[0]['outcome'] == 'scheduled'
        assert rows[-1]['outcome'] == 'budget_exhausted' and rows[-1]['role'] == 'engine' and rows[-1]['round'] == 2
        assert [r['role'] for r in rows if r['operation'] == 'reconcile'][:2] == ['analyst', 'falsifier']
        assert [(r['tool'], r['action_id'], r['branch_id']) for r in rows if r['operation'] == 'tool'][0] == ('polynomial_fit', 'fit-linear', 'linear')
        assert all(r['source'] == 'worker' for r in rows[1:])

        full = mission(c, max_rounds=5)
        assert c.post(f'/api/missions/{full}/start', headers=AUTH).status_code == 202
        assert wait_final(c, full)['state']['status'] == 'completed'
        rows = timeline(c, full)['rows']
        check_rows(rows)
        assert [r['operation'] for r in rows][-2:] == ['plan', 'stop'] and rows[-1]['outcome'] == 'completed'
        assert rows[-1]['detail'].startswith('Exploratory fixture comparison completed')
        assert c.get(f'/api/missions/{full}/evidence', headers=AUTH).status_code == 200
        assert c.get('/api/missions/missing/timeline', headers=AUTH).status_code == 404
        assert c.get(f'/api/missions/{full}/timeline').status_code == 401


# T2
def test_the_timeline_file_is_append_only_and_refuses_unknown_or_repeated_outcomes(tmp_path):
    from arc_science.exploration.timeline import MissionTimeline, OUTCOME_UNKNOWN
    line = MissionTimeline(tmp_path / 'timeline.db')
    op = line.start('m1', operation='plan', role='planner', round=0, transport='fixture', model_requested='scripted-fixture-v1')
    assert line.rows('m1')[0]['outcome'] == OUTCOME_UNKNOWN and line.rows('m1')[0]['outcome_source'] == 'derived'
    with pytest.raises(ValueError):
        line.finish('m1', op, outcome=OUTCOME_UNKNOWN)
    with pytest.raises(ValueError):
        line.finish('m1', op, outcome='succeeded')
    with pytest.raises(KeyError):
        line.finish('m1', 'no-such-op', outcome='ok')
    line.finish('m1', op, outcome='ok', identity_verified=True, detail='done')
    with pytest.raises(ValueError, match='already finished'):
        line.finish('m1', op, outcome='ok')
    merged, = line.rows('m1')
    assert merged['outcome_source'] == 'recorded' and merged['identity_verified'] is True and merged['detail'] == 'done'
    with pytest.raises(ValueError):
        line.start('m1', operation='dance', role='planner')
    with pytest.raises(ValueError):
        line.start('m1', operation='plan', role='planner', transport='carrier-pigeon')
    db = sqlite3.connect(tmp_path / 'timeline.db')
    with pytest.raises(sqlite3.DatabaseError, match='append-only'):
        db.execute("UPDATE timeline SET outcome='error'")
    with pytest.raises(sqlite3.DatabaseError, match='append-only'):
        db.execute('DELETE FROM timeline')
    db.close()
    assert line.rows('m1')[0]['outcome'] == 'ok' and line.rows('other') == []


# T3
def test_a_hard_kill_leaves_the_in_flight_row_unknown_and_the_restart_records_the_interruption(tmp_path):
    from arc_science.exploration.engine import initialize
    from arc_science.exploration.models import MissionRequest
    from arc_science.exploration.repository import MissionRepository
    from arc_science.exploration.timeline import MissionTimeline
    request = MissionRequest(goal='Explore the response')
    repo = MissionRepository(tmp_path / 'missions.db')
    row = repo.create(request, initialize(request).model_copy(update={'status': 'running'}), key='killed')
    mid = row['id']
    MissionTimeline(tmp_path / 'timeline.db').start(mid, operation='plan', role='planner', round=0, transport='fixture',
                                                     model_requested='scripted-fixture-v1')
    with TestClient(app(tmp_path)) as c:
        state = row_of(c, mid)['state']
        assert state['status'] == 'paused' and state['events'][-1]['kind'] == 'mission_interrupted'
        rows = timeline(c, mid)['rows']
        assert [(r['operation'], r['outcome'], r['outcome_source'], r['finished_at']) for r in rows] == [
            ('plan', 'outcome_unknown', 'derived', None), ('interrupt', 'interrupted', 'recorded', rows[1]['finished_at'])]
        assert rows[1]['source'] == 'service' and rows[1]['role'] == 'service' and 'Service exit noticed' in rows[1]['detail']
        assert c.app.state.repository.verify(mid) is True
        assert c.get(f'/api/missions/{mid}/evidence', headers=AUTH).status_code == 200


class Holding(service.DemoAgent):
    """The fixture planner, held at round 1 until the test releases it."""
    release = threading.Event()

    async def propose(self, context):
        if context['round'] == 1:
            while not self.release.is_set():
                await asyncio.sleep(0.02)
        return await super().propose(context)


# T4
def test_pause_fences_the_worker_and_resume_is_a_declared_change(tmp_path, monkeypatch):
    Holding.release.clear()
    monkeypatch.setattr(service, 'DemoAgent', Holding)
    with TestClient(app(tmp_path)) as c:
        mid = mission(c, max_rounds=5)
        assert c.post(f'/api/missions/{mid}/pause', headers=AUTH).status_code == 409
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH).status_code == 202
        wait_until(lambda: any(r['operation'] == 'plan' and r['round'] == 1 for r in timeline(c, mid)['rows']), 'the round-1 plan row')
        paused = c.post(f'/api/missions/{mid}/pause', headers=AUTH)
        assert paused.status_code == 200, paused.text
        state = paused.json()['state']
        assert state['status'] == 'paused' and state['events'][-1]['kind'] == 'mission_paused'
        assert PAUSED.match(state['events'][-1]['detail']) and state['stop_reason'] == state['events'][-1]['detail']
        revision = paused.json()['revision']
        Holding.release.set()
        wait_until(lambda: mid not in c.app.state.running, 'the worker to exit')
        assert c.get(f'/api/missions/{mid}/evidence', headers=AUTH).status_code == 200
        after = row_of(c, mid)
        assert after['revision'] == revision and after['state']['status'] == 'paused'
        rows = timeline(c, mid)['rows']
        plan = next(r for r in rows if r['operation'] == 'plan' and r['round'] == 1)
        assert plan['outcome'] == 'outcome_unknown' and plan['outcome_source'] == 'derived' and plan['finished_at'] is None
        pause_row = next(r for r in rows if r['operation'] == 'pause')
        assert pause_row['actor'] == 'operator:token' and pause_row['outcome'] == 'paused' and pause_row['detail'] == state['stop_reason']
        again = c.post(f'/api/missions/{mid}/pause', headers=AUTH)
        assert again.status_code == 409 and 'Only a running mission can be paused' in again.json()['detail']
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH).status_code == 202
        final = wait_final(c, mid)['state']
        assert final['status'] == 'completed'
        kinds = [e['kind'] for e in final['events']]
        assert kinds.index('change_declared') == kinds.index('mission_paused') + 1
        rows = timeline(c, mid)['rows']
        resume = next(r for r in rows if r['operation'] == 'resume')
        assert resume['actor'] == 'operator:token' and resume['outcome'] == 'resumed' and resume['detail'] == 'Resumed from the workspace.'
        assert rows.index(resume) > rows.index(pause_row)
        assert c.get(f'/api/missions/{mid}/evidence', headers=AUTH).status_code == 200


# T5
def test_cancel_records_its_actor_and_time_and_is_a_terminal_successor_of_a_pause(tmp_path):
    from arc_science.exploration.models import Event, MissionState
    with TestClient(app(tmp_path)) as c:
        mid = mission(c)
        cancelled = c.post(f'/api/missions/{mid}/cancel', headers=AUTH).json()['state']
        assert cancelled['status'] == 'cancelled' and cancelled['stop_reason'] == 'Cancelled by operator; late results fenced.'
        assert cancelled['events'][-1]['kind'] == 'mission_cancelled' and CANCELLED.match(cancelled['events'][-1]['detail'])
        row, = timeline(c, mid)['rows']
        assert (row['operation'], row['actor'], row['outcome'], row['detail']) == ('cancel', 'operator:token', 'cancelled', cancelled['events'][-1]['detail'])
        assert c.get(f'/api/missions/{mid}/evidence', headers=AUTH).status_code == 200
        # A repeated cancel changes nothing and records nothing.
        assert c.post(f'/api/missions/{mid}/cancel', headers=AUTH).status_code == 200 and len(timeline(c, mid)['rows']) == 1
        # A mission cancelled before this slice has no event: cancelling it again is harmless.
        legacy = mission(c)
        repo = c.app.state.repository
        current = repo.get(legacy)
        repo.save(legacy, MissionState.model_validate({**current['state'], 'status': 'cancelled', 'stop_reason': 'Cancelled by operator; late results fenced.'}),
                  expected_revision=current['revision'])
        assert c.post(f'/api/missions/{legacy}/cancel', headers=AUTH).status_code == 200 and timeline(c, legacy)['rows'] == []
        # A mission the service exit paused, cancelled afterwards: a terminal operator action.
        other = mission(c)
        repo = c.app.state.repository
        current = repo.get(other)
        interrupted = Event(kind='mission_interrupted', round=0, detail='Service restarted; evidence retained. Resume explicitly.')
        repo.save(other, MissionState.model_validate({**current['state'], 'status': 'paused', 'stop_reason': interrupted.detail,
                                                      'events': [interrupted.model_dump(mode='json')]}), expected_revision=current['revision'])
        assert c.post(f'/api/missions/{other}/cancel', headers=AUTH).status_code == 200
        assert [e['kind'] for e in row_of(c, other)['state']['events']] == ['mission_interrupted', 'mission_cancelled']
        assert c.get(f'/api/missions/{other}/evidence', headers=AUTH).status_code == 200


@pytest.mark.parametrize('kinds,accepted', [
    (('mission_paused', 'mission_cancelled'), True),
    (('mission_interrupted', 'mission_cancelled'), True),
    (('mission_stopped', 'mission_cancelled'), True),
    (('mission_paused', 'change_declared'), None),
    (('mission_paused', 'plan_committed'), False),
    (('mission_stopped', 'observation'), False),
    (('mission_interrupted', 'mission_paused'), False),
])
def test_after_a_stop_pause_or_interruption_only_a_declared_change_or_a_cancellation_may_follow(kinds, accepted):
    from arc_science.exploration.engine import initialize
    from arc_science.exploration.evidence import validate_evidence
    from arc_science.exploration.models import Event, MissionRequest
    request = MissionRequest(goal='Explore the response')
    state = initialize(request).model_copy(update={'events': tuple(Event(kind=k, round=0, detail='x') for k in kinds)})
    if accepted is None:
        return  # change_declared needs its Change record; covered by test_changes.py
    if accepted:
        validate_evidence(state)
    else:
        with pytest.raises(ValueError, match='without a declared change'):
            validate_evidence(state)


class Failing(service.DemoAgent):
    fail = True

    async def propose(self, context):
        if context['round'] == 0 and Failing.fail:
            raise RuntimeError('provider unavailable')
        return await super().propose(context)


# T6
def test_a_retry_from_an_error_is_a_declared_change_with_a_stated_reason(tmp_path, monkeypatch):
    Failing.fail = True
    monkeypatch.setattr(service, 'DemoAgent', Failing)
    with TestClient(app(tmp_path)) as c:
        mid = mission(c, max_rounds=5)
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH).status_code == 202
        errored = wait_final(c, mid)['state']
        assert errored['status'] == 'error' and errored['stop_reason'].startswith('Planning failed')
        rows = timeline(c, mid)['rows']
        assert [(r['operation'], r['outcome']) for r in rows] == [('start', 'scheduled'), ('plan', 'error'), ('stop', 'error')]
        assert rows[1]['detail'] == 'Planning failed validation or provider execution.'
        body = {'kind': 'resume', 'declared_effects': ['analysis', 'claim']}
        refused = c.post(f'/api/missions/{mid}/changes', headers=AUTH, json=body)
        assert refused.status_code == 409 and 'states its reason' in refused.json()['detail']
        blank = c.post(f'/api/missions/{mid}/changes', headers=AUTH, json={**body, 'note': '   '})
        assert blank.status_code == 409 and 'states its reason' in blank.json()['detail']
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH).status_code == 409
        Failing.fail = False
        retried = c.post(f'/api/missions/{mid}/changes', headers=AUTH, json={**body, 'note': 'Retry after error: provider fixed'})
        assert retried.status_code == 202, retried.text
        assert retried.json()['change']['note'] == 'Retry after error: provider fixed'
        final = wait_final(c, mid)['state']
        assert final['status'] == 'completed'
        assert final['changes'][0]['note'] == 'Retry after error: provider fixed'
        kinds = [e['kind'] for e in final['events']]
        assert kinds.index('change_declared') == kinds.index('mission_stopped') + 1
        rows = timeline(c, mid)['rows']
        resume = next(r for r in rows if r['operation'] == 'resume')
        assert resume['detail'] == 'Retry after error: provider fixed' and resume['actor'] == 'operator:token' and resume['outcome'] == 'resumed'
        assert rows[-1]['outcome'] == 'completed'
        # A retry on a finished mission is still refused.
        assert c.post(f'/api/missions/{mid}/changes', headers=AUTH, json={**body, 'note': 'again'}).status_code == 409
        assert c.get(f'/api/missions/{mid}/evidence', headers=AUTH).status_code == 200


# T7
def test_a_legacy_mission_without_a_timeline_says_so_and_records_from_its_resume_on(tmp_path):
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.engine import explore, initialize
    from arc_science.exploration.models import MissionRequest, MissionState
    from arc_science.exploration.repository import MissionRepository
    request = MissionRequest(goal='Explore the response')
    repo = MissionRepository(tmp_path / 'missions.db')
    row = repo.create(request, initialize(request), key='legacy')
    mid = row['id']
    repo.save(mid, asyncio.run(explore(request, DemoAgent())), expected_revision=row['revision'])
    assert not (tmp_path / 'timeline.db').exists()
    with TestClient(app(tmp_path)) as c:
        assert row_of(c, mid)['state']['status'] == 'completed'
        answer = timeline(c, mid)
        assert answer['recorded'] is False and answer['rows'] == [] and answer['count'] == 0
        assert c.app.state.repository.verify(mid) is True
        try:
            import arc_science.exploration.claims  # noqa: F401
        except ImportError:
            pass  # written by another editor; the route imports it lazily
        else:
            claims = c.get(f'/api/missions/{mid}/claims', headers=AUTH)
            assert claims.status_code == 200, claims.text
            assert claims.json()['claims'] and all(
                e['time_source'] == 'none' and e['started_at'] is None and e['receipt_id'] is None
                for claim in claims.json()['claims'] for e in claim['evidence'])
        repo = c.app.state.repository
        current = repo.get(mid)
        repo.save(mid, MissionState.model_validate({**current['state'], 'status': 'paused'}), expected_revision=current['revision'])
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH).status_code == 202
        assert wait_final(c, mid)['state']['status'] == 'completed'
        rows = timeline(c, mid)['rows']
        assert [(r['operation'], r['outcome']) for r in rows] == [('resume', 'resumed'), ('plan', 'reused'), ('stop', 'completed')]
        assert rows[1]['detail'] == 'Planner record for this round reused; no call was made.'
        assert c.app.state.repository.verify(mid) is True


@pytest.fixture
def configured(monkeypatch, tmp_path):
    monkeypatch.setenv('ARC_PROVIDER', 'claude-code')
    monkeypatch.setenv('ARC_MODEL', 'claude-opus-5')
    monkeypatch.setenv('ARC_REVIEWER_MODEL', 'claude-sonnet-5')
    for name in ('ARC_REVIEWER_PROVIDER', 'ARC_VISION_PROVIDER', 'ARC_MODEL_TOKEN_FILE', 'ARC_PUBLIC_READS', 'ARC_BIORENDER_READS'):
        monkeypatch.delenv(name, raising=False)
    executable = tmp_path / 'claude.exe'
    executable.write_bytes(b'not really')
    monkeypatch.setenv('ARC_CLAUDE_CODE_EXE', str(executable))
    monkeypatch.setattr(service, 'claude_code_command', lambda: [sys.executable, str(FAKE), 'success'])
    return tmp_path / 'data'


# T8
def test_a_live_seat_row_carries_its_receipt_and_observed_identity_and_a_revoked_grant_reads_denied(configured):
    with TestClient(app(configured)) as c:
        mid = mission(c, mode='live', max_rounds=2, allow_egress=True)
        preview = c.get('/api/missions/preview', headers=AUTH).json()
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH,
                      json={'approved_route_digest': preview['route_digest'], 'grants': preview['required_grants']}).status_code == 202
        first = wait_until(lambda: next((r for r in timeline(c, mid)['rows'] if r['operation'] == 'plan' and r['outcome_source'] == 'recorded'), None),
                           'the first plan row')
        seat = next(g for g in c.get(f'/api/missions/{mid}/grants', headers=AUTH).json()['grants'] if g['destination_kind'] == 'seat')
        assert c.post(f"/api/grants/{seat['id']}/revoke", headers=AUTH, json={'reason': 'stop paying'}).status_code == 200
        final = wait_final(c, mid)['state']
        assert final['status'] == 'error' and final['stop_reason'].startswith('Planning failed'), final['stop_reason']
        receipts = {r['id']: r for r in c.get(f'/api/missions/{mid}/grants', headers=AUTH).json()['receipts']}
        assert (first['transport'], first['model_requested'], first['model_observed'], first['identity_verified']) == ('cli', 'claude-opus-5', 'claude-opus-5', True)
        assert first['outcome'] == 'ok' and receipts[first['receipt_id']]['outcome'] == 'ok' and receipts[first['receipt_id']]['role'] == 'planner'
        rows = timeline(c, mid)['rows']
        last = [r for r in rows if r['operation'] == 'plan'][-1]
        assert last['round'] == 1 and last['outcome'] == 'denied' and last['outcome_source'] == 'recorded'
        assert receipts[last['receipt_id']]['outcome'] == 'denied' and receipts[last['receipt_id']]['role'] == 'planner'
        assert last['model_observed'] is None and last['identity_verified'] is None
        assert all(r['receipt_id'] in receipts for r in rows if r['role'] in ('planner', 'analyst', 'falsifier'))
        assert all(r['transport'] is None for r in rows if r['operation'] in ('start', 'tool', 'stop'))
        assert rows[-1]['operation'] == 'stop' and rows[-1]['outcome'] == 'error'
        # Nothing secret or textual from the mission in the file: only identifiers, names and outcomes.
        raw = (configured / 'timeline.db').read_bytes()
        assert TOKEN.encode() not in raw and b'Explore the response' not in raw
