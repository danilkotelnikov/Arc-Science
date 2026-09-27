"""Error and stop codes (contract C1, research B1): every HTTP refusal of the service is
{code, detail, facts} with a registered code; every engine stop records a stop code and
its facts; readiness, settings effects and grant decisions carry codes beside their English."""
import ast
import asyncio
import re
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException

from arc_science import error_codes, grants, readiness, service
from arc_science.contracts import canonical
from arc_science.error_codes import ERROR_CODES, STOP_CODES, prose_code
from arc_science.exploration.agents import DemoAgent
from arc_science.exploration.engine import explore
from arc_science.exploration.models import MissionRequest, MissionState
from arc_science.exploration.repository import MissionRepository
from test_readiness import build, seats
from test_settings import stub  # noqa: F401  (a fixture)

SRC = Path(error_codes.__file__).parent
TOKEN = 'c' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}


def name_of(node):
    return node.id if isinstance(node, ast.Name) else node.attr if isinstance(node, ast.Attribute) else None


def source_tree(relative):
    return ast.parse((SRC / relative).read_text(encoding='utf-8'))


# --- the registry and the service routes ---

def test_codes_are_area_dot_reason_with_an_english_fallback():
    assert len(ERROR_CODES) >= 40
    for code, english in ERROR_CODES.items():
        assert re.fullmatch(r'[a-z]+\.[a-z0-9_]+', code), code
        assert english and english[0].isupper(), code
    for code, english in STOP_CODES.items():
        assert re.fullmatch(r'[a-z_]+', code) and english and english[0].isupper(), code


def test_every_http_error_in_the_service_passes_a_registered_code():
    tree = source_tree('service.py')
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)]
    # A bare HTTPException is allowed only with a dict detail that names a code.
    compliant = set()
    for call in calls:
        if name_of(call.func) != 'HTTPException':
            continue
        detail = call.args[1] if len(call.args) > 1 else next((k.value for k in call.keywords if k.arg == 'detail'), None)
        keys = [k.value for k in getattr(detail, 'keys', []) if isinstance(k, ast.Constant)]
        assert isinstance(detail, ast.Dict) and 'code' in keys, f'service.py:{call.lineno} raises HTTPException without a code'
        compliant.add(id(call.func))
    stray = [n.lineno for n in ast.walk(tree) if isinstance(n, ast.Name) and n.id == 'HTTPException' and id(n) not in compliant]
    assert not stray, f'HTTPException used outside a coded call at lines {stray}'
    helper = [c for c in calls if name_of(c.func) == 'api_error']
    assert len(helper) >= 50
    for call in helper:
        code = call.args[1]
        if isinstance(code, ast.Constant):
            assert code.value in ERROR_CODES, f'service.py:{call.lineno}: {code.value} is not registered'
        else:
            assert isinstance(code, ast.Call) and name_of(code.func) == 'prose_code', f'service.py:{call.lineno}: code is not a literal'


def test_every_prose_refusal_maps_to_a_registered_prose_code():
    literal = set()
    for module in ('prose.py', 'prose_humane.py', 'service.py'):
        literal |= set(re.findall(r"ProseRefused\('([a-z_]+)'", (SRC / module).read_text(encoding='utf-8')))
    assert {'busy', 'consent_required', 'preservation_failed', 'seat_unavailable'} <= literal
    for reason in literal:
        assert prose_code(reason) == 'prose.' + reason
    assert prose_code('http_503') == 'prose.provider_failed' and 'prose.provider_failed' in ERROR_CODES


def test_the_helper_refuses_an_unregistered_code():
    with pytest.raises(KeyError):
        error_codes.api_error(409, 'mission.nonsense')
    made = error_codes.api_error(404, 'mission.not_found', facts={'mission_id': 'x'})
    assert made.status_code == 404 and made.detail == {'code': 'mission.not_found', 'detail': ERROR_CODES['mission.not_found'],
                                                        'facts': {'mission_id': 'x'}}


def finished(c, mid):
    for _ in range(3000):
        row = c.get(f'/api/missions/{mid}', headers=AUTH).json()
        if row['state']['status'] not in ('ready', 'running'):
            return row
        time.sleep(.01)
    raise AssertionError('mission did not finish')


def test_routes_answer_code_detail_and_facts(tmp_path):
    with TestClient(service.create_app(data_dir=tmp_path, token=TOKEN)) as c:
        unauthorized = c.get('/api/missions')
        assert unauthorized.status_code == 401 and unauthorized.headers['WWW-Authenticate'] == 'Bearer'
        assert unauthorized.json()['detail'] == {'code': 'auth.required', 'detail': 'Authentication required', 'facts': {}}
        missing = c.get('/api/missions/nope', headers=AUTH)
        assert missing.status_code == 404
        assert missing.json()['detail'] == {'code': 'mission.not_found', 'detail': 'Unknown mission', 'facts': {'mission_id': 'nope'}}
        grant = c.post('/api/grants/g0/revoke', headers=AUTH, json={})
        assert grant.status_code == 404 and grant.json()['detail']['code'] == 'grant.not_found' and grant.json()['detail']['facts'] == {'grant_id': 'g0'}
        mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Codes on refusals', 'max_rounds': 1}).json()['id']
        paused = c.post(f'/api/missions/{mid}/pause', headers=AUTH)
        assert paused.status_code == 409 and paused.json()['detail']['code'] == 'mission.not_pausable'
        assert paused.json()['detail']['facts'] == {'status': 'ready'} and 'running' in paused.json()['detail']['detail']
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH).status_code == 202
        # The demo mission hits its one-round limit and records why it stopped.
        row = finished(c, mid)
        assert row['state']['status'] == 'budget_exhausted'
        assert row['state']['stop_code'] == 'round_limit' and row['state']['stop_facts'] == {'max_rounds': 1}
        again = c.post(f'/api/missions/{mid}/start', headers=AUTH)
        assert again.status_code == 409 and again.json()['detail']['code'] == 'mission.not_startable'
        assert again.json()['detail']['facts'] == {'status': 'budget_exhausted'}
        probe = c.post('/api/providers/nobody/probe', headers=AUTH, json={'spend_tokens': True})
        assert probe.json()['detail'] == {'code': 'provider.unknown', 'detail': 'Unknown provider', 'facts': {'provider': 'nobody'}}


# --- engine stop codes ---

def stop_calls():
    tree = source_tree('exploration/engine.py')
    return [n for n in ast.walk(tree) if isinstance(n, ast.Call) and name_of(n.func) == 'stop']


def test_every_engine_stop_names_a_registered_stop_code():
    calls = stop_calls()
    assert len(calls) >= 17
    used = set()
    for call in calls:
        code = call.args[1]
        assert isinstance(code, ast.Constant) and code.value in STOP_CODES, f'engine.py:{call.lineno}'
        used.add(code.value)
    assert used == {'plan_stop', 'no_observations', 'vision_required', 'no_actions', 'action_reused', 'planning_failed',
                    'render_failed', 'call_limit', 'action_limit', 'round_limit',
                    'token_limit', 'cost_limit', 'time_limit', 'budget_unmeasurable', 'awaiting_decision'}


def run(request, agent=None):
    return asyncio.run(explore(request, agent or DemoAgent()))


def test_stops_record_their_code_and_facts():
    rounds = run(MissionRequest(goal='Round limit', max_rounds=1))
    assert (rounds.status, rounds.stop_code, rounds.stop_facts) == ('budget_exhausted', 'round_limit', {'max_rounds': 1})
    assert rounds.stop_reason == 'Round limit reached; remaining alternatives are unresolved.'
    actions = run(MissionRequest(goal='Action limit', max_actions=1))
    assert (actions.stop_code, actions.stop_facts) == ('action_limit', {'max_actions': 1, 'actions_used': 1})
    calls = run(MissionRequest(goal='Call limit', max_model_calls=1))
    assert (calls.stop_code, calls.stop_facts) == ('call_limit', {'phase': 'reconcile', 'needed': 2, 'max_model_calls': 1, 'model_calls_used': 1})
    done = run(MissionRequest(goal='Planner stops'))
    assert (done.status, done.stop_code, done.stop_facts) == ('completed', 'plan_stop', {})


def test_a_planning_failure_says_whether_the_engine_refused_the_plan():
    from test_contract_compat import UnknownToolPlanner
    refused = run(MissionRequest(goal='Refused plan'), UnknownToolPlanner())
    assert (refused.status, refused.stop_code, refused.stop_facts) == ('error', 'planning_failed', {'rejected': True})

    class Broken:
        model = 'broken'

        async def propose(self, context):
            raise RuntimeError('provider text that must not be quoted')
    broken = run(MissionRequest(goal='Broken planner'), Broken())
    assert (broken.stop_code, broken.stop_facts) == ('planning_failed', {'rejected': False})
    assert 'provider text' not in broken.stop_reason


def test_stop_code_and_facts_are_later_fields():
    assert {'stop_code', 'stop_facts'} <= set(MissionState.LATER_FIELDS)
    state = run(MissionRequest(goal='Absent at default', max_rounds=1))
    plain = state.model_copy(update={'stop_code': '', 'stop_facts': {}})
    dumped = plain.model_dump(mode='json')
    assert 'stop_code' not in dumped and 'stop_facts' not in dumped
    assert canonical(MissionState.model_validate(dumped)) == canonical(plain)


def test_operator_transitions_record_their_codes(tmp_path):
    from arc_science.exploration.engine import initialize
    repository = MissionRepository(tmp_path / 'missions.db')
    request = MissionRequest(goal='Operator codes')
    running = lambda: repository.save(mid, MissionState.model_validate({**repository.get(mid)['state'], 'status': 'running'}),
                                      expected_revision=repository.get(mid)['revision'])
    mid = repository.create(request, initialize(request), key='k1')['id']
    running()
    paused = repository.pause(mid, actor='operator:token')['state']
    assert (paused['stop_code'], paused['stop_facts']) == ('paused_by_operator', {'actor': 'operator:token'})
    cancelled = repository.cancel(mid, actor='operator:token')['state']
    assert (cancelled['stop_code'], cancelled['stop_facts']) == ('cancelled', {'actor': 'operator:token'})
    other = repository.create(request, initialize(request), key='k2')['id']
    mid = other
    running()
    assert repository.pause_interrupted() == [other]
    assert repository.get(other)['state']['stop_code'] == 'interrupted'


# --- readiness facts ---

def test_readiness_carries_the_variable_parts_as_facts():
    def unreadable(ref):
        raise OSError('store locked')
    api = {'provider': 'openai', 'model': 'gpt-5.6-sol'}
    store = build(seats(planner=api), stored=unreadable)['seats']['planner']
    assert store['code'] == 'seat.credential_store_unavailable' and store['facts']['credential_store_error'] == 'store locked'
    assert store['meaning'] == 'The credential store could not be read for planner: store locked'
    effort = build(seats(planner={'provider': 'gemini', 'model': 'gemini-2.5-pro', 'effort': 'max'}))
    planner = effort['seats']['planner']
    assert planner['facts']['allowed_efforts'] == ['low', 'medium', 'high'] and planner['next_action'] == 'Choose one of low, medium, high'
    assert effort['live_mission']['code'] == 'live.blocked'
    assert effort['live_mission']['facts'] == {'blocking': [{'role': 'planner', 'state': 'blocked'}]}
    assert effort['live_mission']['meaning'] == 'A live mission cannot start: planner is blocked'
    cli = lambda p: {'executable': 'codex.cmd', 'executable_sha256': 'e' * 64, 'logged_in': True, 'auth_method': 'chatgpt'}
    doc = seats(planner={'provider': 'openai', 'model': 'gpt-5.6-sol', 'effort': 'high', 'auth': 'cli'})
    current = readiness.subject_digest(readiness.subject('openai', 'cli', 'gpt-5.6-sol', 'high', executable_sha256='e' * 64))
    record = {'at': 1, 'results': [{'model': 'gpt-5.6-sol', 'ok': False, 'error': 'quota', 'subject_digest': current}]}
    failed = build(doc, cli=cli, probes=lambda p: record)
    assert failed['seats']['planner']['facts']['probe_error'] == 'quota'
    assert failed['live_mission']['code'] == 'live.failed' and failed['live_mission']['facts'] == {'blocking': [{'role': 'planner', 'state': 'failed'}]}
    snap = seats()
    snap['settings']['mcp_servers'] = [{'name': 'a', 'transport': 'stdio', 'enabled': True, 'consent': True},
                                       {'name': 'b', 'transport': 'stdio', 'enabled': True, 'consent': False}]
    connectors = build(snap)['connectors']
    assert connectors['code'] == 'connectors.eligible' and connectors['facts'] == {'eligible': 1, 'total': 2}
    memory = readiness._memory({'configured': True, 'capture': {}, 'error': 'pipe closed'})
    assert memory['code'] == 'memory.not_checked' and memory['facts']['memory_error'] == 'pipe closed'
    assert memory['meaning'] == 'The memory worker did not answer: pipe closed'


# --- settings effects ---

def test_settings_effects_carry_an_applies_code(tmp_path, stub):
    with TestClient(service.create_app(data_dir=tmp_path / 'data', token=TOKEN)) as c:
        snap = c.get('/api/settings', headers=AUTH).json()
        edited = snap['settings']
        edited['seats']['planner'].update(provider='openai', model='gpt-5.6', effort='high')
        edited['prose']['detection'] = False
        edited['blender']['default_preset'] = 'other'
        edited['viewer']['background'] = 'black'
        saved = c.put('/api/settings', headers=AUTH, json={'settings': edited, 'if_revision': snap['revision']}).json()
        assert [(e['section'], e['applies_code']) for e in saved['effects']] == [
            ('seats.planner', 'mission_start'), ('prose', 'prose_request'), ('blender', 'render_submit'), ('viewer', 'molecules_session')]
        stale = c.put('/api/settings', headers=AUTH, json={'settings': edited, 'if_revision': 'f' * 64})
        assert stale.status_code == 409 and stale.json()['detail']['code'] == 'settings.revision_conflict'


# --- grant decisions and receipts ---

def test_grant_decisions_and_receipts_carry_reason_codes(tmp_path):
    ledger = grants.GrantLedger(tmp_path / 'grants.db')
    assert ledger.authorize('mission', 'm1', 'https://api.openai.com', 'seat')['reason_code'] == 'grant.none'
    grant = ledger.create(subject_kind='mission', subject_id='m1', destination='https://api.openai.com', destination_kind='seat',
                          data_category='goal', purpose='planning', scope='mission')
    allowed = ledger.authorize('mission', 'm1', 'https://api.openai.com', 'seat')
    assert allowed['allowed'] and allowed['reason_code'] == 'grant.active'
    ledger.revoke(grant['id'])
    denied = ledger.authorize('mission', 'm1', 'https://api.openai.com', 'seat')
    assert (denied['allowed'], denied['reason_code']) == (False, 'grant.revoked')
    row = ledger.receipt(destination='https://api.openai.com', destination_kind='seat', data_category='goal', outcome='denied',
                         reason=denied['reason'], reason_code=denied['reason_code'], grant_id=grant['id'], mission_id='m1')
    assert row['reason_code'] == 'grant.revoked'
    ok = ledger.receipt(destination='https://api.openai.com', destination_kind='seat', data_category='goal', outcome='ok', mission_id='m1')
    failed = ledger.receipt(destination='https://api.openai.com', destination_kind='seat', data_category='goal', outcome='failed', mission_id='m1')
    assert (ok['reason_code'], failed['reason_code']) == ('call.ok', 'call.failed')
    assert sorted(r['reason_code'] for r in ledger.receipts(mission_id='m1')) == ['call.failed', 'call.ok', 'grant.revoked']


def test_a_ledger_from_before_reason_codes_gains_the_column(tmp_path):
    path = tmp_path / 'grants.db'
    ledger = grants.GrantLedger(path)
    ledger.receipt(destination='d', destination_kind='seat', data_category='c', outcome='ok', mission_id='m')
    # Rebuild the receipts table as it was before the column existed, keeping the old row.
    with sqlite3.connect(path) as db:
        db.executescript('''DROP TRIGGER receipts_no_update; DROP TRIGGER receipts_no_delete;
            CREATE TABLE old AS SELECT id,grant_id,mission_id,destination,destination_kind,data_category,at,outcome,reason,
              request_digest,observation_id,role FROM receipts;
            DROP TABLE receipts; ALTER TABLE old RENAME TO receipts;''')
    reopened = grants.GrantLedger(path)
    assert [r['reason_code'] for r in reopened.receipts(mission_id='m')] == ['']
    reopened.receipt(destination='d', destination_kind='seat', data_category='c', outcome='failed', mission_id='m')
    assert sorted(r['reason_code'] for r in reopened.receipts(mission_id='m')) == ['', 'call.failed']
    with sqlite3.connect(path) as db, pytest.raises(sqlite3.DatabaseError, match='append-only'):
        db.execute("UPDATE receipts SET reason='x'")


# --- every stop path records a current code; malformed requests are coded too ---

def test_the_worker_failure_records_its_own_code_over_a_stale_one(tmp_path, monkeypatch):
    async def failing(request, agent, *, initial, emit, **_):
        # A code an earlier pause left behind, then a failure outside the engine's stops.
        emit(initial.model_copy(update={'status': 'running', 'stop_code': 'paused_by_operator', 'stop_facts': {'actor': 'operator:x'}}))
        raise ValueError('Connector tool name collides: x')
    monkeypatch.setattr(service, 'explore', failing)
    with TestClient(service.create_app(data_dir=tmp_path, token=TOKEN)) as c:
        mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Worker failure', 'max_rounds': 1}).json()['id']
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH).status_code == 202
        state = finished(c, mid)['state']
    assert state['status'] == 'error' and state['stop_reason'].startswith('Service execution failed')
    # Empty facts are a later field at its default, so the stored state omits them.
    assert (state['stop_code'], state.get('stop_facts', {})) == ('service_failed', {})
    assert 'service_failed' in STOP_CODES


def test_starting_or_resuming_clears_the_previous_stop_code():
    from arc_science.exploration.engine import initialize
    request = MissionRequest(goal='Resume clears the code', max_rounds=1)
    stale = initialize(request).model_copy(update={'stop_code': 'paused_by_operator', 'stop_facts': {'actor': 'operator:x'}})
    seen = []
    asyncio.run(explore(request, DemoAgent(), initial=stale, emit=seen.append))
    assert (seen[0].status, seen[0].stop_code, seen[0].stop_facts) == ('running', '', {})


def test_every_visual_gate_reason_has_its_own_cause():
    from arc_science.exploration import engine, vision
    tree = ast.parse(Path(vision.__file__).read_text(encoding='utf-8'))
    gate = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'required_visual_reason')
    reasons = {n.value.value for n in ast.walk(gate) if isinstance(n, ast.Return) and isinstance(n.value, ast.Constant) and n.value.value}
    assert len(reasons) == 5 and set(engine.VISUAL_CAUSES) == reasons
    assert set(engine.VISUAL_CAUSES.values()) == {'no_artifacts', 'blocking_findings', 'not_adequate', 'coverage', 'record_not_accepted'}
    assert 'found problems' in STOP_CODES['vision_required']


def test_a_blocking_visual_finding_is_not_recorded_as_a_coverage_gap():
    from arc_science.contracts import digest
    from arc_science.exploration.agents import DemoVisionAgent
    from arc_science.exploration.models import VisualFinding, VisualReport
    from arc_science.exploration.vision import VISUAL_PROMPT_VERSION

    class Blocking(DemoVisionAgent):
        async def review_visual(self, context, artifacts):
            return VisualReport(candidate_digest=context['candidate_digest'], reviewed_digests=tuple(a.digest for a in artifacts),
                                verdict='issues', model=self.vision_model, round=context['round'], prompt_version=VISUAL_PROMPT_VERSION,
                                findings=tuple(VisualFinding(artifact_digest=a.digest, severity='blocking', category='axes',
                                                             detail='Axes are illegible.') for a in artifacts),
                                context_digest=digest(context), input_context=context)
    state = run(MissionRequest(goal='Blocking review', vision_review=True), Blocking())
    assert state.stop_code == 'vision_required', (state.stop_code, state.stop_reason)
    assert state.stop_facts == {'cause': 'blocking_findings'}, state.stop_reason


def test_a_malformed_or_oversized_request_is_refused_with_a_code(tmp_path):
    with TestClient(service.create_app(data_dir=tmp_path, token=TOKEN)) as c:
        bad = c.post('/api/missions', headers=AUTH, json={'goal': 'x'})
        assert bad.status_code == 422
        detail = bad.json()['detail']
        assert detail['code'] == 'request.invalid' and detail['detail'] == ERROR_CODES['request.invalid']
        assert detail['facts']['errors'][0]['loc'] == ['body', 'goal'] and detail['facts']['errors'][0]['type'] == 'string_too_short'
        big = c.post('/api/missions', headers={**AUTH, 'Content-Type': 'application/json'}, content=b'{"goal":"' + b'a' * (1024 * 1024) + b'"}')
        assert big.status_code == 413 and big.json()['detail']['code'] == 'request.too_large'


def test_a_chunked_oversized_body_is_refused_on_the_bytes_received(tmp_path):
    def chunks(*parts):
        yield from parts
    with TestClient(service.create_app(data_dir=tmp_path, token=TOKEN)) as c:
        json_type = {'Content-Type': 'application/json'}
        # No Content-Length: the limit counts what arrives, before validation and before auth.
        big = c.post('/api/missions', headers={**AUTH, **json_type}, content=chunks(b'{"goal":"', b'a' * (3 * 1024 * 1024), b'"}'))
        assert big.status_code == 413 and big.json()['detail']['code'] == 'request.too_large'
        padded = c.post('/api/missions', headers={**AUTH, **json_type}, content=chunks(b' ' * (1024 * 1024 + 1), b'{"goal":"Valid mission"}'))
        assert padded.status_code == 413 and padded.json()['detail']['facts'] == {'limit_bytes': 1024 * 1024}
        anonymous = c.post('/api/missions', headers=json_type, content=chunks(b' ' * (2 * 1024 * 1024)))
        assert anonymous.status_code == 413
        assert c.get('/api/missions', headers=AUTH).json() == []
        # Under the limit, a chunked body is read as usual.
        small = c.post('/api/missions', headers={**AUTH, **json_type}, content=chunks(b'{"goal":', b'"Valid mission"}'))
        assert small.status_code == 201, small.text


def test_the_body_limit_sums_the_messages_of_a_streamed_body():
    # The test client hands the app one message; a server streams a chunked body in pieces,
    # each under the limit, so the limit must count their sum.
    piece = 400 * 1024
    messages = [{'type': 'http.request', 'body': b' ' * piece, 'more_body': True} for _ in range(4)]
    messages.append({'type': 'http.request', 'body': b'', 'more_body': False})
    delivered = []

    async def receive():
        delivered.append(messages[len(delivered)])
        return delivered[-1]

    async def reader(scope, receive, send):
        while (await receive()).get('more_body'):
            pass

    async def ignore(message):
        pass

    with pytest.raises(HTTPException) as refused:
        asyncio.run(service.BodyLimit(reader)({'type': 'http'}, receive, ignore))
    assert refused.value.status_code == 413 and refused.value.detail['code'] == 'request.too_large'
    # Refused on the third piece (1.2 MiB), before the app reads any further.
    assert len(delivered) == 3
    # Two pieces (800 KiB) and the end of the body pass through whole.
    delivered.clear()
    messages[2:] = [{'type': 'http.request', 'body': b'', 'more_body': False}]
    asyncio.run(service.BodyLimit(reader)({'type': 'http'}, receive, ignore))
    assert len(delivered) == 3


def test_a_body_that_cannot_be_decoded_is_refused_with_a_code(tmp_path):
    with TestClient(service.create_app(data_dir=tmp_path, token=TOKEN)) as c:
        bad = c.post('/api/missions', headers={**AUTH, 'Content-Type': 'application/json'}, content=bytes([0xff]))
        assert bad.status_code == 400
        detail = bad.json()['detail']
        assert detail['code'] == 'request.invalid' and detail['detail'] == ERROR_CODES['request.invalid']
        assert detail['facts']['errors'][0]['loc'] == ['body']
