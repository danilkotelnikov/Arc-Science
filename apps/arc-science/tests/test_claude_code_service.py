"""The service runs live seats through the Claude Code transport when configured."""
from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from arc_science import service
from arc_science.service import create_app

FAKE = Path(__file__).parent / 'fixtures' / 'fake_claude.py'
AUTH = {'Authorization': 'Bearer ' + 't' * 40}


@pytest.fixture
def configured(monkeypatch, tmp_path):
    monkeypatch.setenv('ARC_PROVIDER', 'claude-code')
    monkeypatch.setenv('ARC_MODEL', 'claude-opus-5')
    monkeypatch.setenv('ARC_REVIEWER_MODEL', 'claude-sonnet-5')
    monkeypatch.delenv('ARC_REVIEWER_PROVIDER', raising=False)
    monkeypatch.delenv('ARC_VISION_PROVIDER', raising=False)
    monkeypatch.delenv('ARC_MODEL_TOKEN_FILE', raising=False)
    executable = tmp_path / 'claude.exe'
    executable.write_bytes(b'not really')
    monkeypatch.setenv('ARC_CLAUDE_CODE_EXE', str(executable))
    # The real transport takes one executable; the fake needs an interpreter and a mode.
    monkeypatch.setattr(service, 'claude_code_command', lambda: [sys.executable, str(FAKE), 'success'])
    return executable


def wait_final(client, mid):
    for _ in range(400):
        row = client.get(f'/api/missions/{mid}', headers=AUTH).json()
        if row['state']['status'] not in ('ready', 'running'):
            return row
        time.sleep(0.05)
    raise AssertionError('mission did not finish')


def test_capabilities_report_the_transport_truthfully_without_spending_tokens(configured, tmp_path):
    with TestClient(create_app(data_dir=tmp_path / 'data', token='t' * 40)) as client:
        live = client.get('/api/capabilities', headers=AUTH).json()['live']
        assert live['configured'] is True and live['provider'] == 'anthropic' and live['auth'] == 'cli'
        assert live['seats']['falsifier'] == {'provider': 'anthropic', 'transport': 'cli', 'model': 'claude-sonnet-5', 'effort': None}
        assert live['planner'] == 'claude-opus-5' and live['reviewer'] == 'claude-sonnet-5'
        transport = live['transport']
        assert transport['logged_in'] is True and transport['auth_method'] == 'claude.ai'
        assert transport['version'].startswith('9.9.9') and transport['tools'] == 'disabled'
        assert transport['network_sandboxed'] is False and transport['last_probe'] is None
        # The fake is launched through the interpreter, so the command's first element is reported.
        assert transport['executable'] == Path(sys.executable).name and len(transport['executable_sha256']) == 64


def test_explicit_probe_spends_one_call_per_model_and_is_reported_afterwards(configured, tmp_path):
    with TestClient(create_app(data_dir=tmp_path / 'data', token='t' * 40)) as client:
        assert client.post('/api/providers/claude-code/probe', headers=AUTH, json={}).status_code == 422
        probe = client.post('/api/providers/claude-code/probe', headers=AUTH, json={'spend_tokens': True}).json()
        assert [r['model'] for r in probe['results']] == ['claude-opus-5', 'claude-sonnet-5']
        assert all(r['ok'] and r['observed_model'] == r['model'] and r['identity_verified'] for r in probe['results'])
        assert probe['results'][1]['roles'] == ['reviewer', 'falsifier']
        assert client.get('/api/capabilities', headers=AUTH).json()['live']['transport']['last_probe'] == probe
        # Durable audit line, cooldown, and no unauthenticated access.
        audit = (tmp_path / 'data' / 'providers' / 'claude-code-probes.jsonl').read_text(encoding='utf-8').splitlines()
        assert len(audit) == 1 and '"ok": true' in audit[0]
        assert client.post('/api/providers/claude-code/probe', headers=AUTH, json={'spend_tokens': True}).status_code == 429
        assert client.post('/api/providers/claude-code/probe', json={'spend_tokens': True}).status_code == 401


def test_a_live_mission_runs_both_seats_through_the_cli_and_records_their_identity(configured, tmp_path):
    with TestClient(create_app(data_dir=tmp_path / 'data', token='t' * 40)) as client:
        row = client.post('/api/missions', headers=AUTH, json={'goal': 'Explore live', 'mode': 'live',
                                                                'max_rounds': 1, 'allow_egress': True}).json()
        # A live first start binds the previewed route and its grants.
        preview = client.get('/api/missions/preview', headers=AUTH).json()
        assert client.post(f"/api/missions/{row['id']}/start", headers=AUTH,
                           json={'approved_route_digest': preview['route_digest'], 'grants': preview['required_grants']}).status_code == 202
        final = wait_final(client, row['id'])
        state = final['state']
        assert state['status'] == 'budget_exhausted', state['stop_reason']
        models = {(r['role'], r['model']) for r in state['model_records']}
        assert ('planner', 'claude-opus-5') in models
        assert ('analyst', 'claude-sonnet-5') in models and ('falsifier', 'claude-sonnet-5') in models
        assert state['data_origin'] != 'synthetic_fixture'
        # Transport provenance is bound to each persisted record, not left on the agent.
        for record in state['model_records']:
            transport = record['transport']
            assert transport['transport'] == 'claude-code' and transport['outcome'] == 'ok'
            assert transport['observed_model'] == record['model'] and transport['role'] == record['role']
            assert transport['identity_source'] == 'claude_code_modelUsage' and transport['network_sandboxed'] is False
            assert 'prompt' not in transport and transport['usage'] == {'input_tokens': 10, 'output_tokens': 20}
            assert transport['effort_source'] == 'provider_default' and transport['applied_effort'] is None
        # The seat plan the mission ran with is bound to it at the first start.
        bound = [e for e in state['events'] if e['kind'] == 'seats_bound']
        assert len(bound) == 1 and '"planner":"anthropic:cli:claude-opus-5:default:planner"' in bound[0]['detail']


def test_egress_consent_and_vision_are_enforced_for_the_cli_transport(configured, tmp_path):
    with TestClient(create_app(data_dir=tmp_path / 'data', token='t' * 40)) as client:
        denied = client.post('/api/missions', headers=AUTH, json={'goal': 'Vision', 'mode': 'live', 'max_rounds': 1,
                                                                   'allow_egress': True, 'vision_review': True})
        assert denied.status_code == 409 and 'vision' in denied.json()['detail'].lower()
        # Live mode without egress consent is refused before any mission exists (contract validation).
        refused = client.post('/api/missions', headers=AUTH, json={'goal': 'No consent', 'mode': 'live',
                                                                    'max_rounds': 1, 'allow_egress': False})
        assert refused.status_code == 422


def test_the_executable_must_be_an_absolute_existing_file(monkeypatch, tmp_path):
    monkeypatch.setenv('ARC_PROVIDER', 'claude-code')
    monkeypatch.setenv('ARC_MODEL', 'claude-opus-5')
    monkeypatch.setenv('ARC_CLAUDE_CODE_EXE', 'claude')
    with pytest.raises(ValueError):
        service.configured_endpoints()
    monkeypatch.setenv('ARC_CLAUDE_CODE_EXE', str(tmp_path / 'missing.exe'))
    with pytest.raises(ValueError):
        service.configured_endpoints()
    monkeypatch.setenv('ARC_REVIEWER_PROVIDER', 'anthropic')
    (tmp_path / 'claude.exe').write_bytes(b'x')
    monkeypatch.setenv('ARC_CLAUDE_CODE_EXE', str(tmp_path / 'claude.exe'))
    with pytest.raises(ValueError, match='Mixed transports'):
        service.configured_endpoints()
    with TestClient(create_app(data_dir=tmp_path / 'data', token='t' * 40)) as client:
        assert client.get('/api/capabilities', headers=AUTH).json()['live'] == {'configured': False}
