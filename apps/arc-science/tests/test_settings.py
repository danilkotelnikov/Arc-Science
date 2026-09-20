"""Operator settings: read through the native supervisor, replaced only through it,
with the revision the operator saw; seats configured there drive the model seats."""
import json
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from arc_science import service, settings

TOKEN = 's' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}
REPO = Path(__file__).resolve().parents[3]
SUPERVISOR = REPO / 'native' / 'arc-science' / 'target' / 'release' / ('arc-science-native.exe' if os.name == 'nt' else 'arc-science-native')

# A stand-in supervisor with the same contract: show creates the default and prints a
# snapshot; replace validates a little, checks the revision (status 3) and rewrites.
STUB = r'''
import hashlib, json, sys, pathlib
args = sys.argv[1:]
project = pathlib.Path(args[args.index('--project') + 1])
path = project / 'settings.toml'
default = {"schema_version": 1, "seats": {r: {"provider": "", "model": "", "effort": "medium", "auth": "api_key", "credential": ""}
           for r in ("planner", "reviewer", "falsifier", "vision", "prose")},
           "providers": {p: {"endpoint": "", "cli": "", "agent_id": "", "isolated": p == "openclaw"} for p in ("anthropic", "openai", "gemini", "openclaw")},
           "mcp_servers": [], "acp_agents": [], "prose": {"detection": True}, "blender": {"default_preset": "publication_white"},
           "viewer": {"representation": "cartoon", "colouring": "chain", "assembly": "asymmetric_unit", "background": "white"}}
def snapshot():
    raw = path.read_bytes()
    return {"settings": json.loads(raw), "revision": hashlib.sha256(raw).hexdigest(), "path": str(path)}
if not path.exists():
    path.write_text(json.dumps(default))
cmd = args[args.index('settings') + 1]
if cmd == 'show':
    print(json.dumps(snapshot())); sys.exit(0)
if cmd == 'replace':
    doc = json.loads(sys.stdin.read())
    if '--if-revision' in args and args[args.index('--if-revision') + 1] != hashlib.sha256(path.read_bytes()).hexdigest():
        print('arc-science-native: settings changed since they were read', file=sys.stderr); sys.exit(3)
    if doc.get('seats', {}).get('planner', {}).get('effort') not in ('minimal', 'low', 'medium', 'high', 'max'):
        print('arc-science-native: seats.planner.effort must be one of minimal, low, medium, high, max', file=sys.stderr); sys.exit(1)
    path.write_text(json.dumps(doc)); print(json.dumps(snapshot())); sys.exit(0)
sys.exit(2)
'''


@pytest.fixture
def stub(tmp_path, monkeypatch):
    script = tmp_path / 'stub-supervisor.py'
    script.write_text(STUB, encoding='utf-8')
    if os.name == 'nt':
        launcher = tmp_path / 'stub-supervisor.cmd'
        launcher.write_text(f'@"{sys.executable}" "{script}" %*\n', encoding='utf-8')
    else:
        launcher = tmp_path / 'stub-supervisor'
        launcher.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n', encoding='utf-8')
        launcher.chmod(0o755)
    project = tmp_path / 'project'
    project.mkdir()
    monkeypatch.setenv('ARC_SUPERVISOR', str(launcher))
    monkeypatch.setenv('ARC_PROJECT', str(project))
    monkeypatch.delenv('ARC_SETTINGS_FILE', raising=False)
    return project


def app(tmp_path):
    return service.create_app(data_dir=tmp_path / 'data', token=TOKEN)


def test_settings_are_read_from_the_supervisor_and_replaced_with_the_revision_seen(tmp_path, stub):
    with TestClient(app(tmp_path)) as c:
        assert c.get('/api/settings').status_code == 401
        snap = c.get('/api/settings', headers=AUTH).json()
        assert snap['settings']['seats']['planner']['provider'] == '' and len(snap['revision']) == 64
        assert 'seats' in snap['applied_live'] and 'seats.effort' in snap['stored_pending'] and snap['restart_required'] == []
        # Without the revision that was read, a replacement is not accepted at all.
        assert c.put('/api/settings', headers=AUTH, json={'settings': snap['settings']}).status_code == 422
        edited = snap['settings']
        edited['seats']['planner'].update(provider='openai', model='gpt-5.6', effort='high')
        # A stale revision is refused and changes nothing.
        stale = c.put('/api/settings', headers=AUTH, json={'settings': edited, 'if_revision': 'f' * 64})
        assert stale.status_code == 409 and 'reload' in stale.json()['detail']
        assert c.get('/api/settings', headers=AUTH).json()['settings']['seats']['planner']['provider'] == ''
        # The current revision lets the whole document through; the new snapshot comes back.
        written = c.put('/api/settings', headers=AUTH, json={'settings': edited, 'if_revision': snap['revision']})
        assert written.status_code == 200, written.text
        assert written.json()['settings']['seats']['planner']['model'] == 'gpt-5.6'
        assert written.json()['revision'] != snap['revision']
        assert json.loads((stub / 'settings.toml').read_text())['seats']['planner']['effort'] == 'high'
        # The owner's validation error is the operator's error message.
        edited['seats']['planner']['effort'] = 'turbo'
        rejected = c.put('/api/settings', headers=AUTH, json={'settings': edited, 'if_revision': written.json()['revision']})
        assert rejected.status_code == 422 and 'effort must be one of' in rejected.json()['detail']


def test_without_a_supervisor_settings_are_unavailable_or_read_only(tmp_path, monkeypatch):
    monkeypatch.delenv('ARC_SUPERVISOR', raising=False)
    monkeypatch.delenv('ARC_PROJECT', raising=False)
    monkeypatch.delenv('ARC_SETTINGS_FILE', raising=False)
    with TestClient(app(tmp_path)) as c:
        assert c.get('/api/settings', headers=AUTH).status_code == 503
        assert c.put('/api/settings', headers=AUTH, json={'settings': {}, 'if_revision': 'a' * 64}).status_code == 503
    file = tmp_path / 'settings.toml'
    file.write_text('schema_version = 1\n[seats.planner]\nprovider = "openai"\nmodel = "gpt-5.6"\n', encoding='utf-8')
    monkeypatch.setenv('ARC_SETTINGS_FILE', str(file))
    with TestClient(app(tmp_path)) as c:
        snap = c.get('/api/settings', headers=AUTH).json()
        assert snap['read_only'] is True and snap['settings']['seats']['planner']['model'] == 'gpt-5.6'
        assert c.put('/api/settings', headers=AUTH, json={'settings': snap['settings'], 'if_revision': snap['revision']}).status_code == 503


def test_seats_configured_in_settings_drive_the_endpoints_and_the_falsifier_gets_its_own(tmp_path, stub, monkeypatch):
    for key in ('ARC_PROVIDER', 'ARC_MODEL', 'ARC_REVIEWER_MODEL', 'ARC_CLAUDE_CODE_EXE'):
        monkeypatch.delenv(key, raising=False)
    snap = settings.snapshot()
    doc = snap['settings']
    doc['seats']['planner'].update(provider='openai', model='gpt-5.6', effort='high')
    doc['seats']['reviewer'].update(provider='anthropic', model='claude-sonnet-5', effort='low')
    doc['seats']['falsifier'].update(provider='openai', model='gpt-5.6-mini', effort='medium', credential='falsifier-key')
    doc['providers']['openai']['endpoint'] = 'https://api.openai.com/v1/responses'
    doc['providers']['anthropic']['endpoint'] = 'https://api.anthropic.com/v1/messages'
    settings.replace(doc, snap['revision'])
    first, second = service.configured_endpoints()
    third = service.configured_falsifier_endpoint(first, second)
    assert (first.provider, first.model, first.effort) == ('openai', 'gpt-5.6', 'high')
    assert (second.provider, second.model, second.effort) == ('anthropic', 'claude-sonnet-5', 'low')
    assert (third.provider, third.model, third.credential_ref) == ('openai', 'gpt-5.6-mini', 'falsifier-key')
    # A CLI seat mixed with API seats is refused; a Gemini API seat says it is not here yet.
    doc = settings.snapshot()['settings']
    doc['seats']['planner']['auth'] = 'cli'
    settings.replace(doc, None)
    with pytest.raises(ValueError, match='Mixed transports|not configured|not available yet'):
        service.configured_endpoints()
    doc['seats']['planner'].update(auth='api_key', provider='gemini', model='gemini-3-pro')
    settings.replace(doc, None)
    with pytest.raises(ValueError, match='Gemini API seat is not available yet'):
        service.configured_endpoints()


def test_a_named_credential_is_read_from_the_store_and_a_missing_name_is_refused(tmp_path, monkeypatch):
    monkeypatch.setenv('ARC_DATA_DIR', str(tmp_path))
    monkeypatch.setenv('ARC_MODEL_TOKEN_FILE', str(tmp_path / 'legacy.token'))
    (tmp_path / 'legacy.token').write_text('legacy-planner-secret\n')
    path = service.credential_path('falsifier-key')
    assert path == tmp_path / 'credentials' / 'falsifier-key.credential'
    with pytest.raises(ValueError, match='No credential named falsifier-key'):
        service._secret('falsifier-key')  # never the planner's legacy token
    path.parent.mkdir()
    path.write_text('the-falsifier-secret\n')
    assert service._secret('falsifier-key') == 'the-falsifier-secret'
    assert service._secret('planner') == 'legacy-planner-secret'  # legacy names keep their files
    (tmp_path / 'credentials' / 'planner.credential').write_text('stored-planner-secret\n')
    assert service._secret('planner') == 'stored-planner-secret'  # the store wins when present
    for bad in ('../x', 'a b', ''):
        with pytest.raises(ValueError):
            service.credential_path(bad)


def test_the_falsifier_seat_reaches_the_agents():
    from arc_science.exploration.claude_code import ClaudeCodeAgent
    from arc_science.exploration.providers import HTTPAgent, ModelEndpoint
    planner = ModelEndpoint(provider='openai', endpoint='https://api.openai.com/v1/responses', model='a', credential_ref='planner')
    reviewer = planner.model_copy(update={'model': 'b', 'credential_ref': 'reviewer'})
    falsifier = planner.model_copy(update={'model': 'c', 'credential_ref': 'falsifier'})
    agent = HTTPAgent(planner, reviewer_config=reviewer, falsifier_config=falsifier, client=None, resolver=None, project='p', principal='x')
    assert [agent.model_for(r) for r in ('planner', 'analyst', 'falsifier')] == ['a', 'b', 'c']
    cli = ClaudeCodeAgent([sys.executable], 'a', 'b', falsifier_model='c')
    try:
        assert [cli.model_for(r) for r in ('planner', 'analyst', 'falsifier')] == ['a', 'b', 'c']
    finally:
        cli.close()


@pytest.mark.skipif(not SUPERVISOR.is_file(), reason='native supervisor not built')
def test_the_real_supervisor_honours_the_same_contract(tmp_path, monkeypatch):
    project = tmp_path / 'project'
    project.mkdir()
    monkeypatch.setenv('ARC_SUPERVISOR', str(SUPERVISOR))
    monkeypatch.setenv('ARC_PROJECT', str(project))
    snap = settings.snapshot()
    assert snap['settings']['providers']['openai']['cli'] == 'codex' and (project / 'settings.toml').is_file()
    doc = snap['settings']
    doc['seats']['planner'].update(provider='anthropic', model='claude-opus-5', auth='cli', effort='max')
    doc['mcp_servers'].append({'name': 'local-tools', 'transport': 'stdio', 'command': 'python', 'args': ['-m', 'tools'], 'url': '', 'consent': False, 'enabled': True})
    with pytest.raises(settings.SettingsStale):
        settings.replace(doc, 'a' * 64)
    written = settings.replace(doc, snap['revision'])
    assert written['settings']['seats']['planner']['effort'] == 'max' and written['settings']['mcp_servers'][0]['name'] == 'local-tools'
    doc['mcp_servers'][0]['transport'] = 'http'
    with pytest.raises(settings.SettingsRejected, match='http has no command|url'):
        settings.replace(doc, written['revision'])
