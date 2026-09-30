"""Digest compatibility (B0) and the measurable falsifier (D010).

The legacy vectors under fixtures/legacy were captured from the release before B0 through
the service test client: a completed demo mission with required vision review (verified,
then exported) and a demo mission interrupted mid-run by a service stop. dispatch_cut was
captured later from that release's engine and repository (c06a4c6): a demo mission whose
round-0 action was reserved and committed when the service stopped, before any dispatch fact
existed; its row was paused by that release's restart handling. Their stored
request and state JSON, event chain and capsule must keep their digests, resume, export and
verify under the current code (journey J7)."""
import asyncio
import json
import os
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from arc_science.contracts import canonical, digest
from arc_science.exploration.capsule import export_capsule, verify_capsule
from arc_science.exploration.engine import explore
from arc_science.exploration.models import (BranchIdea, Change, MissionRequest, MissionState,
                                            VisionRecord)
from arc_science.exploration.release import subject_digest
from arc_science.exploration.repository import MissionRepository

LEGACY = Path(__file__).parent / 'fixtures' / 'legacy'
VECTORS = json.loads((LEGACY / 'vectors.json').read_text(encoding='utf-8'))
TOKEN = 't' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}


def raw(name, part):
    return (LEGACY / f'{name}.{part}.json').read_text(encoding='utf-8')


def needs_rasterizer():
    # The completed vector carries rendered plots; replay re-renders them. A missing rasterizer
    # fails: these checks are the legacy gate. ARC_ALLOW_NO_RASTERIZER=1 is the explicit opt-out.
    from arc_science.svg_raster import cairo_available
    if not os.environ.get('ARC_SVG2PNG') and not cairo_available():
        message = 'No SVG rasterizer: set ARC_SVG2PNG or install cairosvg to re-render the legacy plots'
        if os.environ.get('ARC_ALLOW_NO_RASTERIZER') == '1':
            pytest.skip(message)
        pytest.fail(message)


# The store schema of the release the vectors come from, before the updated_at column.
LEGACY_SCHEMA = '''CREATE TABLE missions (
    id TEXT PRIMARY KEY, request TEXT NOT NULL, request_digest TEXT NOT NULL,
    state TEXT NOT NULL, revision INTEGER NOT NULL, creation_key TEXT UNIQUE NOT NULL);
CREATE TABLE mission_events (
    mission TEXT NOT NULL, revision INTEGER NOT NULL, state_digest TEXT NOT NULL,
    previous TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(mission,revision));'''


def legacy_store(root: Path):
    """A missions.db holding the legacy rows and event chains exactly as they were stored,
    in the schema they were stored in; the current code migrates it when it opens the store."""
    root.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(root / 'missions.db') as db:
        db.executescript(LEGACY_SCHEMA)
        for name, vector in VECTORS.items():
            db.execute('INSERT INTO missions(id,request,request_digest,state,revision,creation_key) VALUES(?,?,?,?,?,?)',
                       (vector['id'], raw(name, 'request'), vector['request_digest'], raw(name, 'state'),
                        vector['revision'], 'legacy-' + name))
            db.executemany('INSERT INTO mission_events VALUES(?,?,?,?,?)',
                           [(vector['id'], e['revision'], e['state_digest'], e['previous'], e['hash']) for e in vector['chain']])
    return root


def finished(c, mid):
    for _ in range(3000):
        row = c.get(f'/api/missions/{mid}', headers=AUTH).json()
        if row['state']['status'] not in ('ready', 'running'):
            return row
        time.sleep(.01)
    raise AssertionError('mission did not finish')


# --- the guard itself ---

@pytest.mark.parametrize('model', [MissionRequest, MissionState, Change, VisionRecord, BranchIdea])
def test_guarded_models_declare_later_fields_with_defaults(model):
    assert isinstance(model.LATER_FIELDS, tuple)
    for name in model.LATER_FIELDS:
        assert not model.model_fields[name].is_required(), name


def test_a_later_field_at_its_default_is_absent_from_the_canonical_form():
    plain = dict(id='b', title='T', hypothesis='H', falsifier='F')
    absent, explicit = BranchIdea(**plain), BranchIdea(**plain, falsifier_test=None)
    assert 'falsifier_test' in BranchIdea.LATER_FIELDS
    assert 'falsifier_test' not in absent.model_dump(mode='json')
    assert canonical(absent) == canonical(explicit) == canonical({**plain, 'parents': []})
    set_ = BranchIdea(**plain, falsifier_test={'tool': 'polynomial_fit', 'metric': 'validation_mse',
                                               'threshold': .02, 'direction': 'above'})
    assert set_.model_dump(mode='json')['falsifier_test']['direction'] == 'above'
    assert digest(set_) != digest(absent)
    # Round trip: the dump validates back to an equal record.
    assert BranchIdea.model_validate(set_.model_dump(mode='json')) == set_


# --- legacy vectors ---

@pytest.mark.parametrize('name', sorted(VECTORS))
def test_legacy_request_and_state_keep_their_digests(name):
    vector = VECTORS[name]
    request = MissionRequest.model_validate_json(raw(name, 'request'))
    state = MissionState.model_validate_json(raw(name, 'state'))
    assert digest(request) == vector['request_digest'] == state.request_digest
    assert digest(request) == digest(json.loads(raw(name, 'request')))
    assert digest(state) == vector['state_digest'] == vector['chain'][-1]['state_digest']
    assert state.scientific_digest == vector['scientific_digest']
    assert subject_digest(state) == vector['subject_digest']
    if vector['release_subject_digest']:
        assert state.release.subject_digest == vector['release_subject_digest']


def test_legacy_event_chains_verify(tmp_path):
    repository = MissionRepository(legacy_store(tmp_path) / 'missions.db')
    for vector in VECTORS.values():
        assert repository.verify(vector['id'])


def test_a_legacy_dispatch_cut_verifies_under_its_own_and_the_current_interruption_label():
    """Captured from the release before dispatch facts: round 0's action reserved and committed,
    then the service stopped (its row paused with no stop code; the current code labels a running
    row 'interrupted'). More reserved than the plan has left to run is no cut."""
    from arc_science.exploration.evidence import validate_evidence
    state = MissionState.model_validate_json(raw('dispatch_cut', 'state'))
    assert state.actions_used > len(state.observations) == 0 and state.stop_code == ''
    assert not any(e.kind == 'actions_dispatched' for e in state.events)
    for code in ('', 'interrupted'):
        validate_evidence(state.model_copy(update={'stop_code': code}))
    with pytest.raises(ValueError, match='unbound tool request'):
        validate_evidence(state.model_copy(update={'actions_used': state.actions_used + 20}))


def test_legacy_capsule_verifies_under_the_current_code():
    needs_rasterizer()
    report = verify_capsule((LEGACY / 'completed.capsule.zip').read_bytes())
    assert report['integrity'] and report['reproduction_passed'], report['failures'] + report['manifest_failures']
    assert report['scientific_digest'] == VECTORS['completed']['scientific_digest']
    assert report['artifacts_reproduced'] >= 1


def test_legacy_state_reexports_to_an_equal_capsule_core():
    needs_rasterizer()
    request = MissionRequest.model_validate_json(raw('completed', 'request'))
    state = MissionState.model_validate_json(raw('completed', 'state'))
    report = verify_capsule(export_capsule(request, state))
    assert report['integrity'] and report['reproduction_passed'], report['failures']


def test_j7_legacy_missions_resume_export_and_verify(tmp_path):
    needs_rasterizer()
    root = legacy_store(tmp_path / 'data')
    done, interrupted = VECTORS['completed']['id'], VECTORS['interrupted']['id']
    with TestClient(create_app(root)) as c:
        # The completed mission exports and verifies without being touched.
        assert c.get(f'/api/missions/{done}', headers=AUTH).json()['state']['status'] == 'completed'
        capsule = c.get(f'/api/missions/{done}/capsule', headers=AUTH)
        assert capsule.status_code == 200, capsule.text
        report = verify_capsule(capsule.content)
        assert report['integrity'] and report['reproduction_passed']
        checked = c.post(f'/api/missions/{done}/verify', headers=AUTH)
        assert checked.status_code == 200, checked.text
        # The interrupted mission resumes under the current code and finishes.
        assert c.get(f'/api/missions/{interrupted}', headers=AUTH).json()['state']['status'] == 'paused'
        resumed = c.post(f'/api/missions/{interrupted}/start', headers=AUTH)
        assert resumed.status_code == 202, resumed.text
        row = finished(c, interrupted)
        assert row['state']['status'] == 'completed', row['state']['stop_reason']
        assert row['state']['request_digest'] == VECTORS['interrupted']['request_digest']
        assert c.post(f'/api/missions/{interrupted}/verify', headers=AUTH).status_code == 200
        capsule = c.get(f'/api/missions/{interrupted}/capsule', headers=AUTH)
        assert capsule.status_code == 200, capsule.text
        report = verify_capsule(capsule.content)
        assert report['integrity'] and report['reproduction_passed']
        assert c.app.state.repository.verify(done) and c.app.state.repository.verify(interrupted)
        # The store gained updated_at when it was opened; both rows were written since.
        listed = {r['id']: r for r in c.get('/api/missions', headers=AUTH).json()}
        assert listed[done]['updated_at'] > 0 and listed[interrupted]['updated_at'] > 0
        assert row['spent']['calls'] == row['state']['model_calls_used']


def create_app(root):
    from arc_science.service import create_app as make
    return make(data_dir=root, token=TOKEN)


# --- the measurable falsifier ---

def test_falsifier_test_is_bounded():
    good = {'tool': 'polynomial_fit', 'metric': 'validation_mse', 'threshold': .02, 'direction': 'above'}
    base = dict(id='b', title='T', hypothesis='H', falsifier='F')
    assert BranchIdea(**base, falsifier_test=good).falsifier_test.threshold == .02
    for bad in ({**good, 'direction': 'sideways'}, {**good, 'threshold': float('nan')},
                {**good, 'metric': ''}, {**good, 'tool': ''}, {k: v for k, v in good.items() if k != 'metric'}):
        with pytest.raises(ValidationError):
            BranchIdea(**base, falsifier_test=bad)


class UnknownToolPlanner:
    model = 'scripted-unknown-falsifier'

    async def propose(self, context):
        return {'branches': [{'id': 'linear', 'title': 'Linear', 'hypothesis': 'A line fits.', 'falsifier': 'Large error.',
                              'falsifier_test': {'tool': 'oracle_lookup', 'metric': 'validation_mse',
                                                 'threshold': .02, 'direction': 'above'}}],
                'actions': [{'id': 'fit', 'branch_id': 'linear', 'tool': 'polynomial_fit', 'arguments': {'degree': 1}}],
                'stop': False, 'reason': 'Try a line.'}

    async def assess(self, role, context):  # never reached
        raise AssertionError('a rejected plan must not reach review')


def test_a_proposal_with_an_unknown_falsifier_tool_is_rejected_with_its_reason():
    state = asyncio.run(explore(MissionRequest(goal='Reject unknown falsifier tools'), UnknownToolPlanner()))
    assert state.status == 'error'
    assert 'linear' in state.stop_reason and 'falsifier' in state.stop_reason
    assert 'catalogue' in state.stop_reason and 'polynomial_fit' in state.stop_reason
    # Nothing from the rejected plan was recorded or executed.
    assert not state.branches and not state.observations
    assert not [r for r in state.model_records if r.role == 'planner']


def test_the_demo_mission_records_a_falsifier_test_for_every_branch():
    from arc_science.exploration.agents import DemoAgent
    from arc_science.exploration.tools import CATALOG
    state = asyncio.run(explore(MissionRequest(goal='Measurable falsifiers'), DemoAgent()))
    assert state.status == 'completed'
    proposed = [b for r in state.model_records if r.role == 'planner' for b in r.payload['branches']]
    assert {b['id'] for b in proposed} == {b.id for b in state.branches} == {'linear', 'quadratic', 'null-control'}
    for branch in proposed:
        test = branch['falsifier_test']
        assert test['tool'] in CATALOG and test['direction'] in ('above', 'below') and test['metric']
    for branch in state.branches:
        assert branch.falsifier_test is not None
        # The named metric is one the named tool actually reports for this branch.
        reported = [o.data for o in state.observations if o.branch_id == branch.id and o.tool == branch.falsifier_test.tool]
        assert reported and all(branch.falsifier_test.metric in data for data in reported)
    report = verify_capsule(export_capsule(MissionRequest(goal='Measurable falsifiers'), state))
    assert report['integrity']


def test_the_planner_asks_for_an_optional_falsifier_test():
    from arc_science.exploration.catalog import proposal_schema
    from arc_science.exploration.providers import PLAN_PROMPT
    from arc_science.exploration.tools import CATALOG
    from arc_science.transport import strict_schema
    assert 'falsifier_test' in PLAN_PROMPT
    schema = proposal_schema(CATALOG)
    branch = schema['$defs']['BranchIdea']
    assert 'falsifier_test' in branch['properties'] and 'falsifier_test' not in branch.get('required', [])
    assert set(schema['$defs']['FalsifierTest']['required']) == {'tool', 'metric', 'threshold', 'direction'}
    # Strict providers get every key required, with null still allowed.
    strict = strict_schema(schema)['$defs']['BranchIdea']
    assert 'falsifier_test' in strict['required']
    assert {'type': 'null'} in strict['properties']['falsifier_test']['anyOf']
