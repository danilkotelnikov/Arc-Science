"""Grants are approved, not derived: the previewed route is bound at the first start with
one grant per destination, every seat call and tool call passes the ledger, and a
revocation refuses the next call of a running mission. Receipts are operational records."""
import json
import shlex
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from arc_science import service, settings
from test_settings import AUTH, TOKEN, app, approve, stub, wait_final  # noqa: F401  (fixture reuse)

FIXTURES = Path(__file__).parent / 'fixtures'

# A CLI seat for all three roles: round one proposes one echo call per MCP server (holding
# while `hold-planner` exists), the reviews answer at once, round two stops.
PLANNER = r'''
import json, pathlib, sys, time
here = pathlib.Path(__file__).parent
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
    text = json.dumps({'branches': [], 'actions': [], 'stop': True, 'reason': 'done'})
else:
    with (here / 'planner-calls.log').open('a') as log:
        log.write('planning\n')
    while (here / 'hold-planner').exists():
        time.sleep(0.05)
    echoes = sorted(t for t in ctx['tools'] if t.startswith('mcp_') and t.endswith('_echo'))
    text = json.dumps({'branches': [{'id': 'b', 'title': 'Connector', 'hypothesis': 'It answers', 'falsifier': 'It does not', 'parents': []}],
                       'actions': [{'id': t, 'branch_id': 'b', 'tool': t, 'arguments': {'text': 'ping', 'times': 1}} for t in echoes],
                       'stop': False, 'reason': 'ask'})
print(json.dumps({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': text, 'modelUsage': {model: {}},
                  'usage': {'input_tokens': 1, 'output_tokens': 1}, 'permission_denials': []}))
'''

# An MCP server whose echo counts its calls (in `<argv[1] or mcp>-calls.log`) and holds
# while `hold-tool` exists.
MCP_SERVER = r'''
import pathlib, sys, time
from mcp.server.fastmcp import FastMCP
here = pathlib.Path(__file__).parent
server = FastMCP('arc-fake')


@server.tool()
def echo(text: str, times: int = 1) -> str:
    """Repeat the text."""
    with (here / ((sys.argv[1] if len(sys.argv) > 1 else 'mcp') + '-calls.log')).open('a') as log:
        log.write('echo\n')
    while (here / 'hold-tool').exists():
        time.sleep(0.05)
    return (text + ' ') * times


server.run('stdio')
'''


def lines(path):
    return path.read_text().splitlines() if path.exists() else []


def stdio(*args):
    """How the service names a stdio connector: the launcher and its arguments, not the launcher alone."""
    return sys.executable + ' ' + shlex.join(args)


def wait_for(condition, what):
    for _ in range(600):
        if condition():
            return
        time.sleep(0.05)
    raise AssertionError('timed out waiting for ' + what)


@pytest.fixture
def connected(tmp_path, stub, monkeypatch):
    pytest.importorskip('mcp')
    for key in ('ARC_PROVIDER', 'ARC_MODEL', 'ARC_REVIEWER_MODEL', 'ARC_CLAUDE_CODE_EXE', 'ARC_VISION_PROVIDER', 'ARC_MODEL_TOKEN_FILE',
                'ARC_PUBLIC_READS', 'ARC_BIORENDER_READS'):
        monkeypatch.delenv(key, raising=False)
    (tmp_path / 'planner.py').write_text(PLANNER, encoding='utf-8')
    (tmp_path / 'mcp_server.py').write_text(MCP_SERVER, encoding='utf-8')
    monkeypatch.setattr(service, 'claude_code_command', lambda: [sys.executable, str(tmp_path / 'planner.py')])
    snap = settings.snapshot()
    doc = snap['settings']
    for role in ('planner', 'reviewer', 'falsifier'):
        doc['seats'][role].update(provider='anthropic', model='claude-opus-5', auth='cli')
    doc['providers']['anthropic']['cli'] = 'claude'
    doc['mcp_servers'] = [{'name': 'fake', 'transport': 'stdio', 'command': sys.executable, 'args': [str(tmp_path / 'mcp_server.py')],
                           'url': '', 'consent': True, 'enabled': True}]
    settings.replace(doc, snap['revision'])
    return tmp_path


def test_the_preview_is_bound_at_the_first_start_and_nothing_starts_without_its_approval(connected):
    with TestClient(app(connected)) as c:
        assert c.get('/api/missions/preview').status_code == 401
        preview = c.get('/api/missions/preview', headers=AUTH).json()
        assert len(preview['route_digest']) == 64 and len(preview['settings_revision']) == 64
        assert [(s['role'], s['destination'], s['destination_kind']) for s in preview['seats']] == [(r, sys.executable, 'seat') for r in ('planner', 'reviewer', 'falsifier')]
        fake = stdio(str(connected / 'mcp_server.py'))
        assert preview['connectors'] == [{'name': 'fake', 'kind': 'mcp', 'destination': fake, 'destination_kind': 'mcp',
                                          'data_category': 'tool arguments the planner chooses', 'purpose': 'tool call'}]
        assert preview['public_reads'] == [] and preview['biorender'] is None
        # One grant per distinct destination: the three seats share one executable here.
        assert [(g['destination_kind'], g['scope']) for g in preview['required_grants']] == [('seat', 'mission'), ('mcp', 'mission')]
        row = c.post('/api/missions', headers=AUTH, json={'goal': 'Grants', 'mode': 'live', 'max_rounds': 2, 'allow_egress': True}).json()
        mid = row['id']
        # No body, a stale digest, and an approval missing a destination are each refused before anything is written.
        refused = c.post(f'/api/missions/{mid}/start', headers=AUTH)
        assert refused.status_code == 409 and 'approve' in refused.json()['detail']
        stale = c.post(f'/api/missions/{mid}/start', headers=AUTH, json={'approved_route_digest': 'f' * 64, 'grants': preview['required_grants']})
        assert stale.status_code == 409 and stale.json()['detail'].startswith('The route changed since it was previewed; review it again')
        assert preview['settings_revision'][:12] in stale.json()['detail']
        partial = c.post(f'/api/missions/{mid}/start', headers=AUTH, json={'approved_route_digest': preview['route_digest'], 'grants': preview['required_grants'][:1]})
        assert partial.status_code == 409 and partial.json()['detail'] == 'No grant approved for the mcp destination ' + fake
        assert c.get(f'/api/missions/{mid}/grants', headers=AUTH).json() == {'grants': [], 'receipts': [], 'receipts_truncated': False}
        assert c.get(f'/api/missions/{mid}', headers=AUTH).json()['state']['status'] == 'ready'
        # A settings save that changes the route makes the approval stale; the message names the revision.
        doc = settings.snapshot()['settings']
        doc['seats']['planner']['model'] = 'claude-sonnet-5'
        changed = settings.replace(doc, None)
        moved = c.post(f'/api/missions/{mid}/start', headers=AUTH, json=approve_with(preview))
        assert moved.status_code == 409 and changed['revision'][:12] in moved.json()['detail']
        doc['seats']['planner']['model'] = 'claude-opus-5'
        settings.replace(doc, None)
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH, json=approve_with(preview)).status_code == 202
        state = wait_final(c, mid)['state']
        assert state['status'] == 'completed', state['stop_reason']
        bound = next(e for e in state['events'] if e['kind'] == 'seats_bound')
        assert bound['detail'].startswith('sha256:' + preview['route_digest'] + ' ')
        ledger = c.get(f'/api/missions/{mid}/grants', headers=AUTH).json()
        grants = {g['destination_kind']: g for g in ledger['grants']}
        assert set(grants) == {'seat', 'mcp'} and all(g['subject_id'] == mid and g['scope'] == 'mission' and g['source'] == 'operator-ui' for g in grants.values())
        assert all(g['route_digest'] == preview['route_digest'] and len(g['settings_revision']) == 64 and g['state'] == 'active' for g in grants.values())
        # Newest first from the ledger; in order: planner, echo, analyst and falsifier, then the planner stops. All ok.
        receipts = [(r['destination_kind'], r['role'], r['outcome']) for r in reversed(ledger['receipts'])]
        assert receipts[:2] == [('seat', 'planner', 'ok'), ('mcp', None, 'ok')]
        assert sorted(receipts[2:4]) == [('seat', 'analyst', 'ok'), ('seat', 'falsifier', 'ok')] and receipts[4:] == [('seat', 'planner', 'ok')]
        assert grants['seat']['uses'] == 4 and grants['mcp']['uses'] == 1 and grants['mcp']['last_used_at'] >= grants['mcp']['granted_at']
        echo = next(r for r in ledger['receipts'] if r['destination_kind'] == 'mcp')
        assert echo['grant_id'] == grants['mcp']['id'] and echo['mission_id'] == mid and len(echo['request_digest']) == 64
        assert echo['data_category'] == 'tool arguments the planner chooses' and 'ping' not in json.dumps(ledger)
        assert lines(connected / 'mcp-calls.log') == ['echo']
        # Settings consent is eligibility only: the whole ledger holds these two grants and nothing from the settings.
        assert [g['id'] for g in c.get('/api/grants', headers=AUTH, params={'subject_kind': 'mission', 'subject_id': mid}).json()] == [g['id'] for g in ledger['grants']]
        assert len(c.get('/api/grants', headers=AUTH).json()) == 2
        assert c.get('/api/grants').status_code == 401


def approve_with(preview):
    return {'approved_route_digest': preview['route_digest'], 'grants': preview['required_grants']}


def test_revoking_the_connector_grant_refuses_the_next_call_before_it_reaches_the_server(connected):
    (connected / 'hold-planner').touch()
    with TestClient(app(connected)) as c:
        row = c.post('/api/missions', headers=AUTH, json={'goal': 'Revoke the connector', 'mode': 'live', 'max_rounds': 2, 'allow_egress': True}).json()
        mid = row['id']
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH, json=approve(c)).status_code == 202
        wait_for(lambda: lines(connected / 'planner-calls.log') == ['planning'], 'the first planner call')
        mcp_grant = next(g for g in c.get(f'/api/missions/{mid}/grants', headers=AUTH).json()['grants'] if g['destination_kind'] == 'mcp')
        event = c.post(f"/api/grants/{mcp_grant['id']}/revoke", headers=AUTH, json={'reason': 'not this server'}).json()
        assert event['kind'] == 'revoked' and event['grant_id'] == mcp_grant['id']
        # Idempotent: the second revoke returns the first event.
        assert c.post(f"/api/grants/{mcp_grant['id']}/revoke", headers=AUTH, json={'reason': 'again'}).json() == event
        assert c.post('/api/grants/' + 'a' * 32 + '/revoke', headers=AUTH, json={'reason': 'x'}).status_code == 404
        (connected / 'hold-planner').unlink()
        state = wait_final(c, mid)['state']
        # The tool observation is the engine's usual error; the seats keep answering; the mission stops honestly.
        assert state['status'] == 'completed', state['stop_reason']
        echo = next(o for o in state['observations'] if o['tool'] == 'mcp_fake_echo')
        assert echo['status'] == 'error' and 'no scientific conclusion' in echo['data']['error']
        assert lines(connected / 'mcp-calls.log') == []
        ledger = c.get(f'/api/missions/{mid}/grants', headers=AUTH).json()
        denied = [r for r in ledger['receipts'] if r['outcome'] == 'denied']
        assert [(r['destination_kind'], r['grant_id']) for r in denied] == [('mcp', mcp_grant['id'])] and 'revoked' in denied[0]['reason']
        revoked = next(g for g in ledger['grants'] if g['id'] == mcp_grant['id'])
        assert revoked['state'] == 'revoked' and revoked['uses'] == 0 and revoked['revoked_at'] == event['at']
        assert [r['outcome'] for r in ledger['receipts'] if r['destination_kind'] == 'seat'] == ['ok'] * 4


def test_two_servers_behind_one_launcher_are_two_destinations_with_independent_grants(connected):
    doc = settings.snapshot()['settings']
    doc['mcp_servers'].append({**doc['mcp_servers'][0], 'name': 'twin', 'args': [str(connected / 'mcp_server.py'), 'twin']})
    settings.replace(doc, None)
    with TestClient(app(connected)) as c:
        preview = c.get('/api/missions/preview', headers=AUTH).json()
        fake, twin = stdio(str(connected / 'mcp_server.py')), stdio(str(connected / 'mcp_server.py'), 'twin')
        assert [(x['name'], x['destination']) for x in preview['connectors']] == [('fake', fake), ('twin', twin)]
        assert [(g['destination_kind'], g['destination']) for g in preview['required_grants']] == [('seat', sys.executable), ('mcp', fake), ('mcp', twin)]
        row = c.post('/api/missions', headers=AUTH, json={'goal': 'Twins', 'mode': 'live', 'max_rounds': 2, 'allow_egress': True}).json()
        mid = row['id']
        short = c.post(f'/api/missions/{mid}/start', headers=AUTH, json={'approved_route_digest': preview['route_digest'], 'grants': preview['required_grants'][:2]})
        assert short.status_code == 409 and short.json()['detail'] == 'No grant approved for the mcp destination ' + twin
        (connected / 'hold-planner').touch()
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH, json=approve_with(preview)).status_code == 202
        wait_for(lambda: lines(connected / 'planner-calls.log') == ['planning'], 'the first planner call')
        grants = {g['destination']: g for g in c.get(f'/api/missions/{mid}/grants', headers=AUTH).json()['grants']}
        assert set(grants) == {sys.executable, fake, twin}
        # Revoking the twin's grant leaves the other server's grant, and its calls, untouched.
        assert c.post(f"/api/grants/{grants[twin]['id']}/revoke", headers=AUTH, json={'reason': 'not the twin'}).status_code == 200
        (connected / 'hold-planner').unlink()
        state = wait_final(c, mid)['state']
        assert state['status'] == 'completed', state['stop_reason']
        by_tool = {o['tool']: o['status'] for o in state['observations']}
        assert by_tool == {'mcp_fake_echo': 'ok', 'mcp_twin_echo': 'error'}
        assert lines(connected / 'mcp-calls.log') == ['echo'] and lines(connected / 'twin-calls.log') == []
        ledger = c.get(f'/api/missions/{mid}/grants', headers=AUTH).json()
        assert {(r['destination'], r['outcome']) for r in ledger['receipts'] if r['destination_kind'] == 'mcp'} == {(fake, 'ok'), (twin, 'denied')}
        states = {g['destination']: (g['state'], g['uses']) for g in ledger['grants']}
        assert states[fake] == ('active', 1) and states[twin] == ('revoked', 0)


def test_a_mission_bound_before_the_ledger_asks_for_approval_before_it_runs(connected):
    """A live mission whose plan was bound without grants (bound before the ledger, or
    a failed write) is not started on the old binding: approval is owed once, then the
    grants exist and the worker runs."""
    from arc_science.exploration.models import Event, MissionState
    with TestClient(app(connected)) as c:
        row = c.post('/api/missions', headers=AUTH, json={'goal': 'Bound before grants', 'mode': 'live', 'max_rounds': 1, 'allow_egress': True}).json()
        mid = row['id']
        preview = c.get('/api/missions/preview', headers=AUTH).json()
        repo = c.app.state.repository
        current = repo.get(mid)
        state = MissionState.model_validate(current['state'])
        # The binding the first start would have written, without its grants.
        bound = state.model_copy(update={'events': state.events + (Event(kind='seats_bound', round=0, detail='sha256:' + preview['route_digest'] + ' {}'),)})
        repo.save(mid, bound, expected_revision=current['revision'])
        refused = c.post(f'/api/missions/{mid}/start', headers=AUTH)
        assert refused.status_code == 409 and 'bound before its grants were recorded' in refused.json()['detail']
        assert c.get(f'/api/missions/{mid}/grants', headers=AUTH).json()['grants'] == []
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH, json=approve_with(preview)).status_code == 202
        granted = c.get(f'/api/missions/{mid}/grants', headers=AUTH).json()['grants']
        assert sorted(g['destination_kind'] for g in granted) == ['mcp', 'seat']
        state = wait_final(c, mid)['state']
        assert len([e for e in state['events'] if e['kind'] == 'seats_bound']) == 1


def test_revoking_the_seat_grant_stops_the_mission_at_the_next_planner_call(connected):
    (connected / 'hold-tool').touch()
    with TestClient(app(connected)) as c:
        row = c.post('/api/missions', headers=AUTH, json={'goal': 'Revoke the seat', 'mode': 'live', 'max_rounds': 3, 'allow_egress': True}).json()
        mid = row['id']
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH, json=approve(c)).status_code == 202
        # The planner answered and the echo call is in flight when the seat grant is revoked.
        wait_for(lambda: lines(connected / 'mcp-calls.log') == ['echo'], 'the echo call')
        seat_grant = next(g for g in c.get(f'/api/missions/{mid}/grants', headers=AUTH).json()['grants'] if g['destination_kind'] == 'seat')
        assert c.post(f"/api/grants/{seat_grant['id']}/revoke", headers=AUTH, json={'reason': 'stop paying'}).status_code == 200
        (connected / 'hold-tool').unlink()
        state = wait_final(c, mid)['state']
        assert state['status'] == 'error' and state['stop_reason'].startswith('Planning failed'), state['stop_reason']
        assert next(o for o in state['observations'] if o['tool'] == 'mcp_fake_echo')['status'] == 'ok'
        assert [e['detail'].split(':')[0] for e in state['events'] if e['kind'] == 'review_rejected'] == ['analyst', 'falsifier']
        ledger = c.get(f'/api/missions/{mid}/grants', headers=AUTH).json()
        outcomes = [(r['destination_kind'], r['role'], r['outcome']) for r in reversed(ledger['receipts'])]
        assert outcomes[:2] == [('seat', 'planner', 'ok'), ('mcp', None, 'ok')]
        assert sorted(outcomes[2:4]) == [('seat', 'analyst', 'denied'), ('seat', 'falsifier', 'denied')] and outcomes[4:] == [('seat', 'planner', 'denied')]
        assert next(g for g in ledger['grants'] if g['id'] == seat_grant['id'])['state'] == 'revoked'
        assert len(state['model_records']) == 1


def test_a_consented_prose_rewrite_writes_a_once_grant_and_its_receipt(tmp_path, stub, monkeypatch):
    from test_prose_humane import SAMPLE
    monkeypatch.delenv('ARC_CLAUDE_CODE_EXE', raising=False)
    monkeypatch.setattr(service, 'claude_code_command', lambda: [sys.executable, str(FIXTURES / 'fake_claude.py'), 'success'])
    snap = settings.snapshot()
    doc = snap['settings']
    doc['seats']['prose'].update(provider='anthropic', model='claude-sonnet-5', auth='cli', effort='low')
    doc['providers']['anthropic']['cli'] = 'claude'
    settings.replace(doc, snap['revision'])
    with TestClient(app(tmp_path)) as c:
        assert c.post('/api/prose/humanise', headers=AUTH, json={'text': SAMPLE}).status_code == 422
        assert c.get('/api/grants', headers=AUTH).json() == []
        done = c.post('/api/prose/humanise', headers=AUTH, json={'text': SAMPLE, 'allow_egress': True})
        assert done.status_code == 200, done.text
        grants = c.get('/api/grants', headers=AUTH, params={'subject_kind': 'request'}).json()
        assert len(grants) == 1 and grants[0]['destination'] == sys.executable and grants[0]['destination_kind'] == 'prose'
        assert grants[0]['scope'] == 'once' and grants[0]['max_uses'] == 1 and grants[0]['state'] == 'exhausted' and grants[0]['uses'] == 1
        receipts = c.app.state.grants.receipts(grant_id=grants[0]['id'])
        assert [(r['outcome'], r['mission_id'], r['destination_kind']) for r in receipts] == [('ok', None, 'prose')]
        assert len(receipts[0]['request_digest']) == 64 and 'In today' not in json.dumps(grants + receipts)


def test_a_consented_detection_writes_a_once_grant_per_request_with_its_outcome(tmp_path, stub):
    import httpx
    from test_prose_humane import SAMPLE
    with TestClient(app(tmp_path)) as c:
        c.app.state.detector.transport = httpx.MockTransport(
            lambda r: httpx.Response(200, json=[{'detectionType': 'HEMINGWAY', 'detectionResult': {'grade': '8'}}]))
        assert c.post('/api/prose/detect', headers=AUTH, json={'text': SAMPLE, 'allow_egress': True}).status_code == 200
        c.app.state.detector.transport = httpx.MockTransport(lambda r: httpx.Response(503))
        assert c.post('/api/prose/detect', headers=AUTH, json={'text': SAMPLE, 'allow_egress': True}).status_code == 502
        assert c.post('/api/prose/detect', headers=AUTH, json={'text': SAMPLE}).status_code == 422
        grants = c.get('/api/grants', headers=AUTH, params={'subject_kind': 'request'}).json()
        assert [(g['destination'], g['destination_kind'], g['scope'], g['state']) for g in grants] == [('api.edgeshop.ai', 'detector', 'once', 'exhausted')] * 2
        outcomes = sorted((r['outcome'], r['reason']) for g in grants for r in c.app.state.grants.receipts(grant_id=g['id']))
        assert outcomes == [('failed', 'http_503'), ('ok', '')]


def test_the_preview_lists_public_reads_and_biorender_when_enabled_with_one_grant_per_destination(monkeypatch):
    from arc_science.exploration.providers import ModelEndpoint
    monkeypatch.setenv('ARC_PUBLIC_READS', '1')
    monkeypatch.setenv('ARC_BIORENDER_READS', '1')
    planner = ModelEndpoint(provider='openai', endpoint='https://api.openai.com/v1/responses', model='a', credential_ref='planner')
    route = {'seats': {'planner': planner, 'reviewer': planner.model_copy(update={'model': 'b'}), 'falsifier': planner},
             'mcp_servers': [{'name': 'h', 'transport': 'http', 'command': '', 'args': [], 'url': 'https://tools.example/mcp'}],
             'acp_agents': [{'name': 'a', 'command': 'agent', 'args': []}]}
    preview = service.route_preview(route, 'r' * 64)
    assert preview['route_digest'] == service.seat_plan(route)[0] and preview['settings_revision'] == 'r' * 64
    assert [(s['destination'], s['model']) for s in preview['seats']] == [('https://api.openai.com', 'a'), ('https://api.openai.com', 'b'), ('https://api.openai.com', 'a')]
    assert [(c['kind'], c['destination']) for c in preview['connectors']] == [('mcp', 'https://tools.example/mcp'), ('acp', 'agent')]
    assert [p['destination'] for p in preview['public_reads']] == ['https://www.ebi.ac.uk', 'https://data.rcsb.org']
    assert preview['biorender']['destination'] == 'https://mcp.services.biorender.com/mcp'
    assert [(g['destination_kind'], g['destination']) for g in preview['required_grants']] == [
        ('seat', 'https://api.openai.com'), ('mcp', 'https://tools.example/mcp'), ('acp', 'agent'),
        ('public_read', 'https://www.ebi.ac.uk'), ('public_read', 'https://data.rcsb.org'), ('biorender', 'https://mcp.services.biorender.com/mcp')]
    assert all(g['scope'] == 'mission' and g['data_category'] and g['purpose'] for g in preview['required_grants'])
