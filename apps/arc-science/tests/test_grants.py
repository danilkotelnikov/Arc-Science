"""Grant ledger: approved grants, transactional reservation, derived state, receipts; append-only
and free of secrets."""
import hashlib
import inspect
import re
import sqlite3
import threading
import time

import pytest

from arc_science import anchored, grants


@pytest.fixture
def ledger(tmp_path):
    return grants.GrantLedger(tmp_path / 'grants.db')


def mission_grant(ledger, mid='m1', destination='https://api.openai.com', **extra):
    fields = dict(subject_kind='mission', subject_id=mid, destination=destination, destination_kind='seat',
                  data_category='mission goal, dataset points, prior observations and assessments',
                  purpose='planning, review and refutation', scope='mission', route_digest='a' * 64,
                  settings_revision='r7', source='operator-ui')
    fields.update(extra)
    return ledger.create(**fields)


def test_create_list_and_state_derivation(ledger):
    active = mission_grant(ledger)
    assert re.fullmatch(r'[0-9a-f]{32}', active['id']) and active['state'] == 'active'
    assert active['uses'] == 0 and active['last_used_at'] is None and active['revoked_at'] is None
    assert active['route_digest'] == 'a' * 64 and active['settings_revision'] == 'r7' and active['max_uses'] is None
    expired = mission_grant(ledger, destination='https://expired.example', expires_at=int(time.time()) - 1)
    assert expired['state'] == 'expired'
    once = ledger.create(subject_kind='request', subject_id='req-1', destination='https://api.anthropic.com', destination_kind='prose',
                         data_category='the selected text', purpose='prose', scope='once')
    assert once['max_uses'] == 1 and once['state'] == 'active'
    assert ledger.reserve(once['id']) is True
    assert ledger.get(once['id'])['state'] == 'exhausted' and ledger.get(once['id'])['uses'] == 1
    persistent = ledger.create(subject_kind='persistent', destination='cmd:fetcher', destination_kind='mcp',
                               data_category='tool arguments the planner chooses', purpose='tool call', scope='persistent')
    ledger.revoke(persistent['id'], 'no longer wanted')
    listed = {g['id']: g for g in ledger.list()}
    assert listed[persistent['id']]['state'] == 'revoked' and listed[persistent['id']]['revoked_at'] is not None
    assert {g['id'] for g in ledger.list(subject_kind='mission', subject_id='m1')} == {active['id'], expired['id']}
    assert [g['id'] for g in ledger.list(subject_kind='persistent')] == [persistent['id']]
    assert ledger.get('0' * 32) is None


def test_create_validates_vocabulary(ledger):
    with pytest.raises(ValueError):
        mission_grant(ledger, scope='forever')
    with pytest.raises(ValueError):
        mission_grant(ledger, destination_kind='email')
    with pytest.raises(ValueError):
        ledger.create(subject_kind='persistent', subject_id='m1', destination='x', destination_kind='mcp',
                      data_category='c', purpose='p', scope='persistent')
    with pytest.raises(ValueError):
        mission_grant(ledger, destination='')
    with pytest.raises(ValueError):
        ledger.receipt(destination='x', destination_kind='seat', data_category='c', outcome='maybe')


def test_revoke_is_idempotent_and_unknown_raises(ledger):
    grant = mission_grant(ledger)
    first = ledger.revoke(grant['id'], 'operator changed their mind')
    assert first['kind'] == 'revoked' and first['detail'] == 'operator changed their mind' and first['grant_id'] == grant['id']
    second = ledger.revoke(grant['id'], 'again')
    assert second == first
    with sqlite3.connect(ledger.path) as db:
        assert db.execute("SELECT COUNT(*) FROM grant_events WHERE grant_id=? AND kind='revoked'", (grant['id'],)).fetchone()[0] == 1
    with pytest.raises(KeyError):
        ledger.revoke('f' * 32, 'nothing there')


def test_reserve_refuses_revoked_expired_exhausted_and_unknown(ledger):
    revoked = mission_grant(ledger)
    ledger.revoke(revoked['id'], 'stop')
    assert ledger.reserve(revoked['id']) is False
    expired = mission_grant(ledger, expires_at=int(time.time()) - 5)
    assert ledger.reserve(expired['id']) is False
    limited = mission_grant(ledger, max_uses=2)
    assert ledger.reserve(limited['id']) and ledger.reserve(limited['id'])
    assert ledger.reserve(limited['id']) is False and ledger.get(limited['id'])['state'] == 'exhausted'
    assert ledger.reserve('0' * 32) is False
    assert ledger.get(limited['id'])['last_used_at'] is not None


def test_once_grant_is_consumed_exactly_once_under_concurrency(ledger):
    grant = ledger.create(subject_kind='request', subject_id='req-9', destination='https://api.anthropic.com',
                          destination_kind='prose', data_category='the selected text', purpose='prose', scope='once')
    results, gate = [], threading.Barrier(16)

    def attempt():
        gate.wait()
        results.append(ledger.reserve(grant['id']))

    threads = [threading.Thread(target=attempt) for _ in range(16)]
    for t in threads: t.start()
    for t in threads: t.join()
    assert len(results) == 16 and sum(results) == 1
    assert ledger.get(grant['id'])['uses'] == 1


def test_authorize_prefers_mission_grant_then_persistent(ledger):
    other = mission_grant(ledger, mid='m2')
    persistent = ledger.create(subject_kind='persistent', destination='https://api.openai.com', destination_kind='seat',
                               data_category='mission goal', purpose='planning', scope='persistent')
    mission = mission_grant(ledger)
    decision = ledger.authorize('mission', 'm1', 'https://api.openai.com', 'seat')
    assert decision['allowed'] and decision['grant_id'] == mission['id']
    assert ledger.get(mission['id'])['uses'] == 1 and ledger.get(persistent['id'])['uses'] == 0
    ledger.revoke(mission['id'], 'revoked mid-mission')
    decision = ledger.authorize('mission', 'm1', 'https://api.openai.com', 'seat')
    assert decision['allowed'] and decision['grant_id'] == persistent['id']
    ledger.revoke(persistent['id'], 'and this one')
    decision = ledger.authorize('mission', 'm1', 'https://api.openai.com', 'seat')
    assert decision == {'allowed': False, 'grant_id': mission['id'], 'reason': decision['reason']}
    assert 'revoked' in decision['reason']
    assert ledger.get(other['id'])['uses'] == 0  # another mission's grant never applies
    decision = ledger.authorize('mission', 'm1', 'cmd:unknown-tool', 'mcp')
    assert decision == {'allowed': False, 'grant_id': None, 'reason': 'No grant for cmd:unknown-tool (mcp)'}
    # The kind is part of the destination identity: a seat grant does not cover an MCP server at the same address.
    assert ledger.authorize('mission', 'm2', 'https://api.openai.com', 'mcp')['allowed'] is False
    assert ledger.authorize('mission', 'm2', 'https://api.openai.com', 'seat')['grant_id'] == other['id']


def test_receipts_filtered_by_mission_and_grant(ledger):
    grant = mission_grant(ledger)
    digest = hashlib.sha256(b'{"role":"planner"}').hexdigest()
    ok = ledger.receipt(grant_id=grant['id'], mission_id='m1', destination='https://api.openai.com', destination_kind='seat',
                        data_category='mission goal', outcome='ok', request_digest=digest, observation_id='obs-1', role='planner')
    denied = ledger.receipt(grant_id=None, mission_id='m1', destination='cmd:fetcher', destination_kind='mcp',
                            data_category='tool arguments', outcome='denied', reason='No grant for cmd:fetcher (mcp)')
    elsewhere = ledger.receipt(grant_id=grant['id'], mission_id='m2', destination='https://api.openai.com', destination_kind='seat',
                               data_category='mission goal', outcome='failed', reason='timeout', role='reviewer')
    assert re.fullmatch(r'[0-9a-f]{32}', ok['id']) and ok['request_digest'] == digest and ok['at'] > 0
    assert {r['id'] for r in ledger.receipts(mission_id='m1')} == {ok['id'], denied['id']}
    assert {r['id'] for r in ledger.receipts(grant_id=grant['id'])} == {ok['id'], elsewhere['id']}
    assert [r['id'] for r in ledger.receipts(mission_id='m1', grant_id=grant['id'])] == [ok['id']]
    assert len(ledger.receipts(limit=2)) == 2 and len(ledger.receipts()) == 3
    assert ledger.receipts(mission_id='m1')[0]['outcome'] in ('ok', 'denied')


def test_module_has_no_update_or_delete_statements_and_the_file_refuses_them(ledger):
    source = inspect.getsource(grants)
    assert not re.search(r'\b(UPDATE|DELETE)\b', source)
    grant = mission_grant(ledger)
    ledger.receipt(mission_id='m1', destination='x', destination_kind='seat', data_category='c', outcome='ok')
    with sqlite3.connect(ledger.path) as db:
        for statement in ("UPDATE grants SET scope='persistent'", 'DELETE FROM grants', 'DELETE FROM grant_events',
                          'DELETE FROM receipts', "UPDATE receipts SET outcome='ok'"):
            with pytest.raises(sqlite3.IntegrityError):
                db.execute(statement)
    assert ledger.get(grant['id'])['scope'] == 'mission' and len(ledger.receipts()) == 1


def test_ledger_holds_digests_not_arguments_and_is_owner_only(ledger):
    secret = 'sk-live-do-not-store-9f8e7d'
    with pytest.raises(ValueError):
        ledger.receipt(destination='https://api.openai.com', destination_kind='seat', data_category='c', outcome='ok',
                       request_digest=secret)
    ledger.receipt(destination='https://api.openai.com', destination_kind='seat', data_category='c', outcome='ok',
                   request_digest=hashlib.sha256(secret.encode()).hexdigest())
    with sqlite3.connect(ledger.path) as db:
        db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    assert secret.encode() not in ledger.path.read_bytes()
    assert anchored.owner_only_holds(ledger.path)
    assert grants.GrantLedger(ledger.path).receipts()[0]['request_digest'] == hashlib.sha256(secret.encode()).hexdigest()
