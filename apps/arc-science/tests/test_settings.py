"""Operator settings: read through the native supervisor, replaced only through it,
with the revision the operator saw; seats configured there drive the model seats."""
import json
import os
import sys
import time
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
    if doc.get('seats', {}).get('planner', {}).get('effort') not in ('minimal', 'low', 'medium', 'high', 'xhigh', 'max'):
        print('arc-science-native: seats.planner.effort must be one of minimal, low, medium, high, xhigh, max', file=sys.stderr); sys.exit(1)
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
        assert 'seats.effort' in snap['applied_live'] and 'viewer' in snap['applied_live'] and snap['stored_pending'] == ['blender']
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
    # A CLI seat needs its CLI configured; a Gemini API seat is a native endpoint.
    doc = settings.snapshot()['settings']
    doc['seats']['planner']['auth'] = 'cli'
    settings.replace(doc, None)
    with pytest.raises(ValueError, match='openai CLI is not configured'):
        service.configured_endpoints()
    doc['seats']['planner'].update(auth='api_key', provider='gemini', model='gemini-3-pro', effort='high')
    settings.replace(doc, None)
    first, _ = service.configured_endpoints()
    assert (first.provider, first.transport, first.endpoint, first.effort) == ('gemini', 'api', 'https://generativelanguage.googleapis.com/v1beta', 'high')
    # Each transport refuses an effort it cannot express instead of coercing it.
    doc['seats']['planner']['effort'] = 'max'
    settings.replace(doc, None)
    with pytest.raises(ValueError, match='gemini api seat does not express effort max'):
        service.configured_endpoints()
    doc['seats']['planner'].update(provider='openclaw', model='agent', effort='high')
    doc['providers']['openclaw'].update(endpoint='https://openclaw.example/v1/responses', agent_id='iso')
    settings.replace(doc, None)
    with pytest.raises(ValueError, match='openclaw api seat has no effort control'):
        service.configured_endpoints()
    # Mixed transports: a CLI planner beside API seats, each its own transport.
    fake = tmp_path / ('codex.cmd' if os.name == 'nt' else 'codex')
    fake.write_text('')
    doc['seats']['planner'].update(provider='openai', model='gpt-5.5', effort='xhigh', auth='cli')
    doc['providers']['openai']['cli'] = str(fake)
    settings.replace(doc, None)
    first, second = service.configured_endpoints()
    assert (first.provider, first.transport, first.endpoint, first.effort) == ('openai', 'cli', str(fake), 'xhigh')
    assert (second.provider, second.transport) == ('anthropic', 'api')
    route_digest, detail = service.seat_plan(service.live_route())
    assert detail == 'sha256:' + route_digest + ' ' + json.dumps({'falsifier': 'openai:api:gpt-5.6-mini:medium:falsifier-key',
        'planner': 'openai:cli:gpt-5.5:xhigh:planner', 'reviewer': 'anthropic:api:claude-sonnet-5:low:reviewer'}, separators=(',', ':'))
    # The digest covers the whole route, not only the summary: an endpoint change is a different plan.
    doc['providers']['anthropic']['endpoint'] = 'https://proxy.example/v1/messages'
    settings.replace(doc, None)
    assert service.seat_plan(service.live_route())[0] != route_digest


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


def launcher(tmp_path, name, fake, mode):
    """A CLI stand-in on disk: the settings name it, the seat runs it."""
    if os.name == 'nt':
        path = tmp_path / (name + '.cmd')
        path.write_text(f'@"{sys.executable}" "{fake}" {mode} %*\n', encoding='utf-8')
    else:
        path = tmp_path / name
        path.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{fake}" {mode} "$@"\n', encoding='utf-8')
        path.chmod(0o755)
    return path


def wait_final(client, mid):
    for _ in range(600):
        row = client.get(f'/api/missions/{mid}', headers=AUTH).json()
        if row['state']['status'] not in ('ready', 'running'):
            return row
        time.sleep(0.05)
    raise AssertionError('mission did not finish')


def test_a_live_mission_runs_each_seat_through_its_own_cli_and_binds_the_seat_plan(tmp_path, stub, monkeypatch):
    for key in ('ARC_PROVIDER', 'ARC_MODEL', 'ARC_REVIEWER_MODEL', 'ARC_CLAUDE_CODE_EXE', 'ARC_VISION_PROVIDER', 'ARC_MODEL_TOKEN_FILE'):
        monkeypatch.delenv(key, raising=False)
    fixtures = Path(__file__).parent / 'fixtures'
    codex = launcher(tmp_path, 'codex', fixtures / 'fake_codex.py', 'success')
    gemini = launcher(tmp_path, 'gemini', fixtures / 'fake_gemini.py', 'success')
    monkeypatch.setattr(service, 'claude_code_command', lambda: [sys.executable, str(fixtures / 'fake_claude.py'), 'success'])
    snap = settings.snapshot()
    doc = snap['settings']
    doc['seats']['planner'].update(provider='openai', model='gpt-5.5', effort='xhigh', auth='cli')
    doc['seats']['reviewer'].update(provider='anthropic', model='claude-sonnet-5', effort='high', auth='cli')
    doc['seats']['falsifier'].update(provider='gemini', model='gemini-3-pro', effort='medium', auth='cli')
    doc['providers']['openai']['cli'] = str(codex)
    doc['providers']['gemini']['cli'] = str(gemini)
    doc['providers']['anthropic']['cli'] = 'claude'
    settings.replace(doc, snap['revision'])
    with TestClient(app(tmp_path)) as c:
        live = c.get('/api/capabilities', headers=AUTH).json()['live']
        assert live['configured'] and live['auth'] == 'cli' and set(live['transports']) == {'openai', 'anthropic', 'gemini'}
        assert live['transports']['openai']['logged_in'] is True and live['transports']['openai']['identity_reported'] is False
        assert live['seats']['planner'] == {'provider': 'openai', 'transport': 'cli', 'model': 'gpt-5.5', 'effort': 'xhigh'}
        row = c.post('/api/missions', headers=AUTH, json={'goal': 'Mixed seats', 'mode': 'live', 'max_rounds': 1, 'allow_egress': True}).json()
        assert c.post(f"/api/missions/{row['id']}/start", headers=AUTH).status_code == 202
        final = wait_final(c, row['id'])
        state = final['state']
        assert state['status'] == 'budget_exhausted', state['stop_reason']
        by_role = {r['role']: r['transport'] for r in state['model_records']}
        assert by_role['planner']['transport'] == 'codex' and by_role['planner']['identity_verified'] is False
        assert by_role['planner']['applied_effort'] == 'xhigh' and by_role['planner']['observed_model'] is None
        assert by_role['analyst']['transport'] == 'claude-code' and by_role['analyst']['observed_model'] == 'claude-sonnet-5'
        assert by_role['analyst']['applied_effort'] == 'high'
        assert by_role['falsifier']['transport'] == 'gemini-cli' and by_role['falsifier']['observed_model'] == 'gemini-3-pro'
        assert by_role['falsifier']['effort_source'] == 'provider_default'
        bound = [e for e in state['events'] if e['kind'] == 'seats_bound']
        assert len(bound) == 1 and bound[0]['detail'].startswith('sha256:') and json.loads(bound[0]['detail'].split(' ', 1)[1]) == {
            'planner': 'openai:cli:gpt-5.5:xhigh:planner', 'reviewer': 'anthropic:cli:claude-sonnet-5:high:reviewer',
            'falsifier': 'gemini:cli:gemini-3-pro:medium:falsifier'}
        # The probe runs the provider's CLI seats once per distinct (model, effort) and says what it verified.
        probe = c.post('/api/providers/openai/probe', headers=AUTH, json={'spend_tokens': True}).json()
        assert probe['transport'] == 'codex' and probe['results'] == [{**probe['results'][0], 'model': 'gpt-5.5', 'effort': 'xhigh',
                                                                        'roles': ['planner'], 'ok': True, 'observed_model': None,
                                                                        'identity_verified': False, 'applied_effort': 'xhigh'}]
        assert c.post('/api/providers/openclaw/probe', headers=AUTH, json={'spend_tokens': True}).status_code == 404
        # A resume after the seats changed is refused; the routing is part of the consent.
        repo = c.app.state.repository
        current = repo.get(row['id'])
        from arc_science.exploration.models import MissionState
        repo.save(row['id'], MissionState.model_validate({**current['state'], 'status': 'paused'}), expected_revision=current['revision'])
        doc = settings.snapshot()['settings']
        doc['seats']['planner']['model'] = 'gpt-5.6-sol'
        settings.replace(doc, None)
        before = repo.get(row['id'])
        refused = c.post(f"/api/missions/{row['id']}/start", headers=AUTH)
        assert refused.status_code == 409 and 'connectors changed' in refused.json()['detail']
        # A declared change is the other resume path; it is refused the same way, and neither
        # path wrote anything: no resume recorded, revision unchanged.
        declared = c.post(f"/api/missions/{row['id']}/changes", headers=AUTH, json={'kind': 'resume', 'declared_effects': ['analysis', 'claim']})
        assert declared.status_code == 409 and 'connectors changed' in declared.json()['detail']
        after = repo.get(row['id'])
        assert after['revision'] == before['revision'] and after['state']['status'] == 'paused'
        assert len(after['state']['changes']) == len(before['state']['changes'])
        # Restoring the route lets the declared resume through; the worker runs with the snapshot.
        doc['seats']['planner']['model'] = 'gpt-5.5'
        settings.replace(doc, None)
        declared = c.post(f"/api/missions/{row['id']}/changes", headers=AUTH, json={'kind': 'resume', 'declared_effects': ['analysis', 'claim']})
        assert declared.status_code == 202
        resumed = wait_final(c, row['id'])['state']
        assert resumed['status'] in ('budget_exhausted', 'completed') and len([e for e in resumed['events'] if e['kind'] == 'seats_bound']) == 1


def test_connectors_are_checked_by_the_operator_and_reach_a_live_mission_only_with_consent(tmp_path, stub, monkeypatch):
    pytest.importorskip('mcp')
    for key in ('ARC_PROVIDER', 'ARC_MODEL', 'ARC_REVIEWER_MODEL', 'ARC_CLAUDE_CODE_EXE', 'ARC_VISION_PROVIDER', 'ARC_MODEL_TOKEN_FILE'):
        monkeypatch.delenv(key, raising=False)
    fixtures = Path(__file__).parent / 'fixtures'
    # The planner asks the MCP echo tool and the ACP agent once each, then stops.
    planner = tmp_path / 'planner.py'
    planner.write_text(r'''
import json, sys
args = sys.argv[1:]
if args[:2] == ['auth', 'status']:
    print(json.dumps({'loggedIn': True, 'authMethod': 'claude.ai'})); sys.exit(0)
if args == ['--version']:
    print('9.9.9'); sys.exit(0)
model = args[args.index('--model') + 1]
request = json.loads(sys.stdin.read())
ctx = request['context']
if request['response_schema'].get('title') == 'Reconciliation':
    text = json.dumps({'assessments': [], 'summary': 'nothing'})
elif ctx['observations']:
    text = json.dumps({'branches': [], 'actions': [], 'stop': True, 'reason': 'consulted'})
else:
    assert 'mcp_fake_echo' in ctx['tools'] and 'acp_fake_consult' in ctx['tools'], sorted(ctx['tools'])
    text = json.dumps({'branches': [{'id': 'b', 'title': 'Connectors', 'hypothesis': 'They answer', 'falsifier': 'They do not', 'parents': []}],
                       'actions': [{'id': 'm', 'branch_id': 'b', 'tool': 'mcp_fake_echo', 'arguments': {'text': 'ping', 'times': 1}},
                                   {'id': 'a', 'branch_id': 'b', 'tool': 'acp_fake_consult', 'arguments': {'prompt': 'hello'}}],
                       'stop': False, 'reason': 'ask'})
print(json.dumps({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': text, 'modelUsage': {model: {}},
                  'usage': {'input_tokens': 1, 'output_tokens': 1}, 'permission_denials': []}))
''', encoding='utf-8')
    monkeypatch.setattr(service, 'claude_code_command', lambda: [sys.executable, str(planner)])
    snap = settings.snapshot()
    doc = snap['settings']
    for role in ('planner', 'reviewer', 'falsifier'):
        doc['seats'][role].update(provider='anthropic', model='claude-opus-5', auth='cli')
    doc['providers']['anthropic']['cli'] = 'claude'
    doc['mcp_servers'] = [{'name': 'fake', 'transport': 'stdio', 'command': sys.executable, 'args': [str(fixtures / 'fake_mcp_server.py')],
                           'url': '', 'consent': True, 'enabled': True},
                          {'name': 'quiet', 'transport': 'stdio', 'command': sys.executable, 'args': [str(fixtures / 'fake_mcp_server.py')],
                           'url': '', 'consent': False, 'enabled': True}]
    doc['acp_agents'] = [{'name': 'fake', 'command': sys.executable, 'args': [str(fixtures / 'fake_acp_agent.py'), 'permission'],
                          'consent': True, 'enabled': True}]
    settings.replace(doc, snap['revision'])
    with TestClient(app(tmp_path)) as c:
        caps = c.get('/api/capabilities', headers=AUTH).json()
        assert caps['connectors'] == {'mcp': {'configured': 2, 'consented': 1, 'sdk': caps['connectors']['mcp']['sdk']}, 'acp': {'configured': 1, 'consented': 1}}
        assert caps['connectors']['mcp']['sdk']
        # Operator checks: every enabled server is listed (consent or not), nothing is called.
        listed = c.post('/api/mcp/servers/check', headers=AUTH).json()
        assert listed['consented'] == ['fake'] and [srv['server'] for srv in listed['servers']] == ['fake', 'quiet']
        assert {t['name']: t['offered'] for t in listed['servers'][0]['tools']} == {'echo': True, 'where': True, 'fail': True}
        agents = c.post('/api/acp/agents/check', headers=AUTH).json()
        assert agents['agents'][0]['ok'] and agents['agents'][0]['agent_info']['name'] == 'fake-acp' and agents['consented'] == ['fake']
        assert c.post('/api/mcp/servers/check').status_code == 401 and c.get('/api/mcp/servers/check', headers=AUTH).status_code in (404, 405)
        row = c.post('/api/missions', headers=AUTH, json={'goal': 'Ask the connectors', 'mode': 'live', 'max_rounds': 2, 'allow_egress': True}).json()
        assert c.post(f"/api/missions/{row['id']}/start", headers=AUTH).status_code == 202
        state = wait_final(c, row['id'])['state']
        assert state['status'] == 'completed', state['stop_reason']
        by_tool = {o['tool']: o for o in state['observations']}
        assert by_tool['mcp_fake_echo']['status'] == 'ok' and by_tool['mcp_fake_echo']['data']['content'][0]['text'] == 'ping '
        assert by_tool['acp_fake_consult']['status'] == 'ok' and by_tool['acp_fake_consult']['data']['text'].startswith('Echo: hello')
        assert by_tool['acp_fake_consult']['data']['refused_requests'] == ['Run rm -rf', 'fs/read_text_file']
        assert 'mcp_quiet_echo' not in json.dumps(state['model_records'][0]['input_context']['tools'])
        # The consented connectors are part of the bound route: withdrawing consent after the
        # first start is a different route, refused on resume like a changed seat.
        bound = next(e for e in state['events'] if e['kind'] == 'seats_bound')
        assert json.loads(bound['detail'].split(' ', 1)[1])['mcp_servers'] == ['fake'] and json.loads(bound['detail'].split(' ', 1)[1])['acp_agents'] == ['fake']
        repo = c.app.state.repository
        current = repo.get(row['id'])
        from arc_science.exploration.models import MissionState
        repo.save(row['id'], MissionState.model_validate({**current['state'], 'status': 'paused'}), expected_revision=current['revision'])
        doc = settings.snapshot()['settings']
        doc['mcp_servers'][0]['consent'] = False
        settings.replace(doc, None)
        refused = c.post(f"/api/missions/{row['id']}/start", headers=AUTH)
        assert refused.status_code == 409 and 'connectors changed' in refused.json()['detail']


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
