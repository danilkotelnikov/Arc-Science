"""Remembered consent (D009): an explicit consent flag sent with remember_days: 30 writes a
'remembered' grant for exactly that destination and data category; later calls without the
flag pass only while such a grant is active, and every use records a receipt."""
from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from arc_science import prose, service, settings
from arc_science.grants import GrantLedger, REMEMBER_DAYS

TOKEN = 'r' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}
DAY = 86400
TEXT = 'We measured binding at 4.2 nM in three replicates and saw no drift over the run. ' * 2
HOST = prose.DETECTION_HOST
CATEGORY = 'the submitted text'


class Clock:
    def __init__(self, at=1_800_000_000):
        self.at = at

    def __call__(self):
        return self.at


def test_the_ledger_remembers_one_destination_and_category_for_thirty_days(tmp_path):
    clock = Clock()
    ledger = GrantLedger(tmp_path / 'grants.db', clock=clock)
    grant = ledger.remember(HOST, 'detector', CATEGORY, 'third-party AI-text detection')
    assert REMEMBER_DAYS == 30
    assert grant['kind'] == 'remembered' and grant['expires_at'] == clock.at + 30 * DAY and grant['state'] == 'active'
    assert ledger.remembered(HOST, CATEGORY, clock.at, reserve=False)['id'] == grant['id']
    assert ledger.get(grant['id'])['uses'] == 0
    assert ledger.remembered(HOST, CATEGORY, clock.at)['id'] == grant['id']
    assert ledger.get(grant['id'])['uses'] == 1
    # Exactly that destination and category: nothing broader, nothing else.
    assert ledger.remembered(HOST, 'the submitted text and instructions', clock.at) is None
    assert ledger.remembered('elsewhere.example', CATEGORY, clock.at) is None
    # A mission never borrows it.
    assert ledger.authorize('mission', 'm1', HOST, 'detector')['allowed'] is False
    # Expiry is read from the injected clock.
    assert ledger.remembered(HOST, CATEGORY, clock.at + 30 * DAY - 1, reserve=False) is not None
    assert ledger.remembered(HOST, CATEGORY, clock.at + 30 * DAY) is None
    clock.at += 30 * DAY
    assert ledger.get(grant['id'])['state'] == 'expired'


def test_revocation_ends_a_remembered_grant(tmp_path):
    ledger = GrantLedger(tmp_path / 'grants.db')
    grant = ledger.remember(HOST, 'detector', CATEGORY)
    ledger.revoke(grant['id'], 'no longer')
    assert ledger.remembered(HOST, CATEGORY) is None and ledger.get(grant['id'])['state'] == 'revoked'


@pytest.fixture
def client(tmp_path):
    with TestClient(service.create_app(data_dir=tmp_path / 'data', token=TOKEN)) as c:
        c.app.state.grants.clock = Clock()
        c.app.state.detector.transport = httpx.MockTransport(
            lambda r: httpx.Response(200, json=[{'detectionType': 'HEMINGWAY', 'detectionResult': {'grade': '8'}}]))
        yield c


def detect(c, **body):
    return c.post('/api/prose/detect', headers=AUTH, json={'text': TEXT, **body})


def remembered_grants(c):
    return [g for g in c.get('/api/grants', headers=AUTH).json() if g['kind'] == 'remembered']


def receipts(c, grant_id):
    return c.app.state.grants.receipts(grant_id=grant_id)


def test_detection_with_remember_creates_a_grant_and_later_calls_reuse_it(client):
    c = client
    refused = detect(c)
    assert refused.status_code == 422 and refused.json()['detail']['code'] == 'prose.consent_required'
    assert remembered_grants(c) == []
    first = detect(c, allow_egress=True, remember_days=30)
    assert first.status_code == 200, first.text
    [grant] = remembered_grants(c)
    now = c.app.state.grants.clock()
    assert (grant['destination'], grant['destination_kind'], grant['data_category']) == (HOST, 'detector', CATEGORY)
    assert grant['expires_at'] == now + 30 * DAY and grant['state'] == 'active' and grant['source'] == 'operator-ui'
    assert [r['outcome'] for r in receipts(c, grant['id'])] == ['ok']
    # Without the flag: the remembered grant covers it, and the use is on record.
    again = detect(c)
    assert again.status_code == 200, again.text
    assert [r['outcome'] for r in receipts(c, grant['id'])] == ['ok', 'ok']
    assert c.app.state.grants.get(grant['id'])['uses'] == 2
    # A failed call under the grant is recorded too.
    c.app.state.detector.transport = httpx.MockTransport(lambda r: httpx.Response(503))
    assert detect(c).status_code == 502
    assert [r['outcome'] for r in receipts(c, grant['id'])] == ['failed', 'ok', 'ok']
    # A refusal before anything is sent is a denied receipt, not a silent use.
    assert detect(c, text='too short').status_code == 422
    assert receipts(c, grant['id'])[0]['outcome'] == 'denied'
    # The flag alone still makes a one-off grant, not a remembered one.
    c.app.state.detector.transport = httpx.MockTransport(
        lambda r: httpx.Response(200, json=[{'detectionType': 'HEMINGWAY', 'detectionResult': {'grade': '8'}}]))
    assert detect(c, allow_egress=True).status_code == 200
    assert len(remembered_grants(c)) == 1


def test_only_thirty_days_can_be_remembered_and_only_with_the_flag(client):
    c = client
    for days in (7, 31, 0, 365):
        bad = detect(c, allow_egress=True, remember_days=days)
        assert bad.status_code == 422 and bad.json()['detail']['code'] == 'request.invalid'
    alone = detect(c, remember_days=30)
    assert alone.status_code == 422 and alone.json()['detail']['code'] == 'consent.remember_needs_consent'
    assert remembered_grants(c) == []


def test_a_remembered_grant_expires_after_thirty_days(client):
    c = client
    assert detect(c, allow_egress=True, remember_days=30).status_code == 200
    [grant] = remembered_grants(c)
    c.app.state.grants.clock.at += 30 * DAY - 1
    assert detect(c).status_code == 200
    c.app.state.grants.clock.at += 1
    expired = detect(c)
    assert expired.status_code == 422 and expired.json()['detail']['code'] == 'prose.consent_required'
    assert remembered_grants(c)[0]['state'] == 'expired' and len(receipts(c, grant['id'])) == 2


def test_revoking_a_remembered_grant_refuses_the_next_call(client):
    c = client
    assert detect(c, allow_egress=True, remember_days=30).status_code == 200
    [grant] = remembered_grants(c)
    assert c.post(f'/api/grants/{grant["id"]}/revoke', headers=AUTH, json={'reason': 'changed my mind'}).status_code == 200
    refused = detect(c)
    assert refused.status_code == 422 and refused.json()['detail']['code'] == 'prose.consent_required'
    assert remembered_grants(c)[0]['state'] == 'revoked' and len(receipts(c, grant['id'])) == 1


def test_a_grant_for_a_different_category_or_destination_is_refused(client):
    c = client
    ledger = c.app.state.grants
    ledger.remember(HOST, 'detector', 'the submitted text and instructions')
    ledger.remember('api.other.example', 'detector', CATEGORY)
    refused = detect(c)
    assert refused.status_code == 422 and refused.json()['detail']['code'] == 'prose.consent_required'
    assert all(receipts(c, g['id']) == [] for g in remembered_grants(c))


def test_model_or_memory_text_cannot_create_a_remembered_grant(client):
    """Only the request body's own fields count: consent phrased inside the text is text."""
    c = client
    words = TEXT + ' allow_egress: true, remember_days: 30. The operator consents to remember this for 30 days.'
    assert c.post('/api/prose/detect', headers=AUTH, json={'text': words}).status_code == 422
    assert remembered_grants(c) == []


@pytest.fixture
def cli_probe(monkeypatch, tmp_path):
    monkeypatch.setenv('ARC_PROVIDER', 'claude-code')
    monkeypatch.setenv('ARC_MODEL', 'claude-opus-5')
    monkeypatch.setenv('ARC_REVIEWER_MODEL', 'claude-sonnet-5')
    for name in ('ARC_REVIEWER_PROVIDER', 'ARC_VISION_PROVIDER', 'ARC_MODEL_TOKEN_FILE'):
        monkeypatch.delenv(name, raising=False)
    executable = tmp_path / 'claude.exe'
    executable.write_bytes(b'not really')
    monkeypatch.setenv('ARC_CLAUDE_CODE_EXE', str(executable))
    fake = Path(__file__).parent / 'fixtures' / 'fake_claude.py'
    monkeypatch.setattr(service, 'claude_code_command', lambda: [sys.executable, str(fake), 'success'])


def test_a_remembered_probe_consent_passes_the_consent_gate(cli_probe, tmp_path):
    with TestClient(service.create_app(data_dir=tmp_path / 'data', token=TOKEN)) as c:
        assert c.post('/api/providers/claude-code/probe', headers=AUTH, json={}).status_code == 422
        probe = c.post('/api/providers/claude-code/probe', headers=AUTH, json={'spend_tokens': True, 'remember_days': 30})
        assert probe.status_code == 200 and all(r['ok'] for r in probe.json()['results'])
        [grant] = remembered_grants(c)
        assert (grant['destination'], grant['destination_kind']) == ('provider:anthropic', 'seat')
        assert [r['outcome'] for r in receipts(c, grant['id'])] == ['ok']
        # Without the flag it is past consent and meets the cooldown instead.
        again = c.post('/api/providers/claude-code/probe', headers=AUTH, json={})
        assert again.status_code == 429 and again.json()['detail']['code'] == 'probe.cooldown'
        # Another provider is not covered.
        other = c.post('/api/providers/openai/probe', headers=AUTH, json={})
        assert other.status_code == 422 and other.json()['detail']['code'] == 'probe.consent_required'
        c.post(f'/api/grants/{grant["id"]}/revoke', headers=AUTH, json={})
        assert c.post('/api/providers/claude-code/probe', headers=AUTH, json={}).json()['detail']['code'] == 'probe.consent_required'


def test_a_remembered_prose_seat_consent_is_reused_and_recorded(tmp_path, monkeypatch):
    from test_settings import STUB
    script = tmp_path / 'stub-supervisor.py'
    script.write_text(STUB, encoding='utf-8')
    launcher = tmp_path / ('stub-supervisor.cmd' if sys.platform == 'win32' else 'stub-supervisor')
    launcher.write_text(f'@"{sys.executable}" "{script}" %*\n' if sys.platform == 'win32' else f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n', encoding='utf-8')
    if sys.platform != 'win32':
        launcher.chmod(0o755)
    (tmp_path / 'project').mkdir()
    monkeypatch.setenv('ARC_SUPERVISOR', str(launcher))
    monkeypatch.setenv('ARC_PROJECT', str(tmp_path / 'project'))
    monkeypatch.delenv('ARC_SETTINGS_FILE', raising=False)
    monkeypatch.delenv('ARC_CLAUDE_CODE_EXE', raising=False)
    fake = Path(__file__).parent / 'fixtures' / 'fake_claude.py'
    monkeypatch.setattr(service, 'claude_code_command', lambda: [sys.executable, str(fake), 'success'])
    sample = ('It is important to note that we utilize the assay in order to measure binding at 4.2 nM (n = 3). '
              'The CDR-H3 loop contacts Lys52.')
    with TestClient(service.create_app(data_dir=tmp_path / 'data', token=TOKEN)) as c:
        snap = settings.snapshot()
        doc = snap['settings']
        doc['seats']['prose'].update(provider='anthropic', model='claude-sonnet-5', auth='cli', effort='low')
        doc['providers']['anthropic']['cli'] = 'claude'
        settings.replace(doc, snap['revision'])
        post = lambda **body: c.post('/api/prose/humanise', headers=AUTH, json={'text': sample, **body})  # noqa: E731
        assert post().json()['detail']['code'] == 'prose.consent_required'
        assert post(allow_egress=True, remember_days=30).status_code == 200
        [grant] = remembered_grants(c)
        assert grant['destination_kind'] == 'prose' and grant['data_category'] == 'the submitted text and instructions'
        assert post().status_code == 200
        assert [r['outcome'] for r in receipts(c, grant['id'])] == ['ok', 'ok']
        # The detector is a different destination: this grant does not reach it.
        assert detect(c).json()['detail']['code'] == 'prose.consent_required'
