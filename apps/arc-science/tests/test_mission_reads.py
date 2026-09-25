"""Poll-path reads: the mission GET carries artifact manifests only, a head endpoint and
repository reads that never parse the state in Python, and derived route states."""
import asyncio
import hashlib
import io
import json
import os
import time
import zipfile

import pytest
from fastapi.testclient import TestClient

from arc_science.exploration.agents import DemoAgent
from arc_science.exploration.claims import route_states
from arc_science.exploration.engine import explore, initialize
from arc_science.exploration.models import MissionRequest, MissionState, ModelRecord

TOKEN = 't' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}


def app(tmp_path):
    from arc_science.service import create_app
    return create_app(data_dir=tmp_path, token=TOKEN)


def finished(c, mid):
    for _ in range(300):
        row = c.get(f'/api/missions/{mid}', headers=AUTH).json()
        if row['state']['status'] not in ('ready', 'running'):
            return row
        time.sleep(.01)
    raise AssertionError('mission did not finish')


def needs_rasterizer():
    from arc_science.svg_raster import cairo_available
    if not os.environ.get('ARC_SVG2PNG') and not cairo_available():
        pytest.skip('No SVG rasterizer: set ARC_SVG2PNG or install cairosvg so the demo mission has artifacts')


@pytest.fixture(scope='module')
def demo():
    return asyncio.run(explore(MissionRequest(goal='Explore the fixture'), DemoAgent()))


def at_round(state, round, **updates):
    return MissionState.model_validate({**state.model_dump(mode='json'), 'round': round, **updates})


# --- GET /api/missions/{id} carries manifests, bytes come from the artifact route ---

def test_mission_get_has_no_image_bytes_and_artifacts_stay_downloadable(tmp_path):
    needs_rasterizer()
    with TestClient(app(tmp_path)) as c:
        mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Manifest only'}).json()['id']
        c.post(f'/api/missions/{mid}/start', headers=AUTH)
        finished(c, mid)
        response = c.get(f'/api/missions/{mid}', headers=AUTH)
        assert b'data_base64' not in response.content
        body = response.json()
        stored = MissionState.model_validate(c.app.state.repository.get(mid)['state'])
        assert stored.artifacts
        # Every manifest field is kept; only the bytes are left to the artifact route.
        assert body['state']['artifacts'] == [a.manifest() for a in stored.artifacts]
        assert {k: v for k, v in body['state'].items() if k != 'artifacts'} == \
            {k: v for k, v in c.app.state.repository.get(mid)['state'].items() if k != 'artifacts'}
        assert {'release', 'change_obligations', 'revision', 'request'} <= set(body)
        for artifact in body['state']['artifacts']:
            image = c.get(f"/api/missions/{mid}/artifacts/{artifact['digest']}", headers=AUTH)
            assert image.status_code == 200 and image.headers['content-type'] == 'image/png'
            assert hashlib.sha256(image.content).hexdigest() == artifact['digest'] and len(image.content) == artifact['size']
        # Export paths read full artifacts from the repository, not from the API body.
        assert c.post(f'/api/missions/{mid}/verify', headers=AUTH).json()['artifacts_reproduced'] == len(stored.artifacts)
        exported = c.get(f'/api/missions/{mid}/capsule', headers=AUTH)
        assert exported.status_code == 200
        with zipfile.ZipFile(io.BytesIO(exported.content)) as z:
            assert json.loads(z.read('runtime.json'))['format'] == 'arc-research-capsule/3'
            assert all(a['data_base64'] for a in json.loads(z.read('state.json'))['artifacts'])
        from arc_science.exploration.capsule import verify_capsule
        report = verify_capsule(exported.content)
        assert report['integrity'] is True and report['artifacts_reproduced'] == len(stored.artifacts)


# --- GET /api/missions/{id}/head ---

def test_head_tracks_the_revision_and_requires_auth(tmp_path):
    with TestClient(app(tmp_path)) as c:
        mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Head reads'}).json()['id']
        assert c.get(f'/api/missions/{mid}/head').status_code == 401
        assert c.get(f'/api/missions/{mid}/head', headers={'Authorization': 'Bearer ' + 'x' * 40}).status_code == 401
        assert c.get(f'/api/missions/{"0" * 32}/head', headers=AUTH).status_code == 404
        before = c.get(f'/api/missions/{mid}/head', headers=AUTH)
        assert before.status_code == 200
        assert before.json() == {'id': mid, 'revision': 0, 'status': 'ready', 'round': 0}
        assert c.post(f'/api/missions/{mid}/cancel', headers=AUTH).status_code == 200
        after = c.get(f'/api/missions/{mid}/head', headers=AUTH).json()
        full = c.app.state.repository.get(mid)
        assert after == {'id': mid, 'revision': full['revision'], 'status': 'cancelled', 'round': full['state']['round']}
        assert after['revision'] > before.json()['revision']


# --- repository reads through json_extract equal the full parse ---

def test_repository_list_status_and_head_equal_the_full_parse(tmp_path, demo):
    from arc_science.exploration.repository import MissionRepository
    repo = MissionRepository(tmp_path / 'missions.db')
    requests = [MissionRequest(goal='Explore the fixture'),
                MissionRequest(goal='Quote " backslash \\ and non-ASCII é中 — goal', seed=3),
                MissionRequest(goal='A live mission', mode='live', allow_egress=True)]
    ids = []
    for index, request in enumerate(requests):
        row = repo.create(request, initialize(request), key='k' + str(index))
        ids.append(row['id'])
    repo.save(ids[0], demo, expected_revision=0)
    repo.cancel(ids[1])
    with pytest.raises(KeyError):
        repo.head('missing')
    with pytest.raises(KeyError):
        repo.status('missing')
    expected = []
    for mid in reversed(ids):
        full = repo.get(mid)
        expected.append({'id': mid, 'goal': full['request']['goal'], 'mode': full['request'].get('mode', 'demo'),
                         'status': full['state']['status'], 'revision': full['revision']})
        assert repo.head(mid) == {'revision': full['revision'], 'status': full['state']['status'], 'round': full['state']['round']}
        assert repo.status(mid) == full['state']['status']
    assert repo.list() == expected
    assert [item['status'] for item in expected] == ['ready', 'cancelled', 'completed']
    assert repo.head(ids[0])['round'] == demo.round > 0
    assert repo.list(limit=1) == expected[:1]


# --- route states ---

def by_branch(routes):
    return {route['branch_id']: route for route in routes}


def test_route_states_on_the_demo_mission(demo):
    routes = route_states(demo)
    assert [r['branch_id'] for r in routes] == [b.id for b in demo.branches]
    states = by_branch(routes)
    # Round 2 is the stop plan; quadratic is the recorded focus, the control acted in
    # round 1 (the last completed round), linear last acted in round 0.
    assert demo.round == 2 and demo.focus == 'quadratic'
    assert {k: v['state'] for k, v in states.items()} == {'linear': 'parked', 'quadratic': 'focused', 'null-control': 'warm'}
    assert states['linear']['basis'] == {'rounds': [0], 'evidence_ids': ['fit-linear']}
    assert states['null-control']['basis'] == {'rounds': [1], 'evidence_ids': ['shuffle-control']}
    assert states['quadratic']['next_test'] == 'Use independently acquired data before a scientific conclusion.'
    assert states['null-control']['next_test'] == 'Independent replication.'
    assert states['linear']['plan_reason'] == 'Establish a simple baseline before testing a nonlinear alternative.'
    assert states['quadratic']['plan_reason'].startswith('Reconcile the linear residual challenge')
    branch = next(b for b in demo.branches if b.id == 'linear')
    assert {k: states['linear'][k] for k in ('title', 'hypothesis', 'falsifier', 'source')} == \
        {'title': branch.title, 'hypothesis': branch.hypothesis, 'falsifier': branch.falsifier, 'source': 'derived'}


def test_route_states_park_after_two_rounds_without_action(demo):
    # Round 1 in progress: its committed plan targets quadratic and the control; linear
    # acted in round 0, the last completed round.
    early = by_branch(route_states(at_round(demo, 1, focus=None)))
    assert {k: v['state'] for k, v in early.items()} == {'linear': 'warm', 'quadratic': 'warm', 'null-control': 'warm'}
    # One idle round keeps a branch warm through the last completed round; two park it.
    late = by_branch(route_states(at_round(demo, 3)))
    assert {k: v['state'] for k, v in late.items()} == {'linear': 'parked', 'quadratic': 'focused', 'null-control': 'parked'}


def test_route_states_follow_the_current_plan_and_never_invent_a_state(demo):
    cubic = {'id': 'cubic', 'title': 'Cubic response', 'hypothesis': 'A cubic term is needed.',
             'falsifier': 'No gain over the quadratic.', 'parents': ['quadratic'], 'created_round': 2}
    untouched = MissionState.model_validate({**demo.model_dump(mode='json'), 'branches': [b.model_dump(mode='json') for b in demo.branches] + [cubic]})
    assert 'cubic' not in by_branch(route_states(untouched))
    plan = ModelRecord(role='planner', round=2, model='scripted-fixture-v1', context_digest='0' * 64, input_context={},
                       payload={'branches': [], 'actions': [{'id': 'fit-cubic', 'branch_id': 'cubic', 'tool': 'polynomial_fit',
                                                             'arguments': {'degree': 3}}], 'stop': False, 'reason': 'Test the cubic term.'})
    records = tuple(r for r in untouched.model_records if not (r.role == 'planner' and r.round == 2)) + (plan,)
    targeted = by_branch(route_states(untouched.model_copy(update={'model_records': records})))
    assert targeted['cubic']['state'] == 'warm' and targeted['cubic']['basis'] == {'rounds': [2], 'evidence_ids': []}
    assert targeted['cubic']['plan_reason'] == 'Test the cubic term.' and targeted['cubic']['next_test'] is None


def test_route_states_are_deterministic_and_leave_the_input_unchanged(demo):
    before = demo.model_dump(mode='json')
    first = route_states(demo)
    assert route_states(demo) == first
    assert route_states(MissionState.model_validate(before)) == first
    assert demo.model_dump(mode='json') == before
    assert route_states(initialize(MissionRequest(goal='Nothing yet'))) == []


def test_claims_route_carries_the_derived_routes(tmp_path):
    with TestClient(app(tmp_path)) as c:
        mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Routes on claims'}).json()['id']
        c.post(f'/api/missions/{mid}/start', headers=AUTH)
        finished(c, mid)
        claims = c.get(f'/api/missions/{mid}/claims', headers=AUTH)
        assert claims.status_code == 200, claims.text
        body = claims.json()
        state = MissionState.model_validate(c.app.state.repository.get(mid)['state'])
        assert body['routes'] == route_states(state) and body['routes']
        assert body['claims'] and body['source'] == 'derived'


def test_a_stop_plan_targets_nothing_even_when_it_lists_actions(demo):
    plan = ModelRecord(role='planner', round=4, model='scripted-fixture-v1', context_digest='0' * 64, input_context={},
                       payload={'branches': [], 'actions': [{'id': 'fit-again', 'branch_id': 'linear', 'tool': 'polynomial_fit',
                                                             'arguments': {'degree': 1}}], 'stop': True, 'reason': 'Enough.'})
    state = at_round(demo, 4).model_copy(update={'model_records': demo.model_records + (plan,)})
    assert by_branch(route_states(state))['linear']['state'] == 'parked'


def test_route_evidence_ids_exclude_failed_and_connector_observations(demo):
    ok = next(o for o in demo.observations if o.id == 'fit-linear')
    failed = ok.model_copy(update={'id': 'fit-linear-failed', 'status': 'error'})
    connector = ok.model_copy(update={'id': 'mcp-read', 'claim_eligible': False})
    state = demo.model_copy(update={'observations': demo.observations + (failed, connector)})
    linear = by_branch(route_states(state))['linear']
    assert linear['basis'] == {'rounds': [0], 'evidence_ids': ['fit-linear']}
