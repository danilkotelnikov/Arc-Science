"""Workflow (journey) tests of the agentic research session, run offline on the demo agents
through the service: each journey drives the API the session UI calls, in the order an
operator would, across the merged tracks (core, evidence, memory, outbound).

J0 gate auto; J1 accept then park; J2 drop; J3 budgets; J4 context and fork; J5 crew;
J6 refusal shape; J7 legacy mission; J8 remembered consent; J9 validation ladder."""
import shutil
import time

import pytest
from fastapi.testclient import TestClient

from arc_science import service
from arc_science.error_codes import ERROR_CODES
from arc_science.exploration import release
from arc_science.exploration.agents import DemoAgent
from arc_science.exploration.capsule import verify_capsule
from arc_science.exploration.models import MissionState
from test_mission_budgets import Priced, Unmeasured
from test_mission_context import fake_memory
from test_mission_crew import seats  # noqa: F401  (a fixture)

TOKEN = 'j' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}
DAY = 86400


def app(data):
    return service.create_app(data_dir=data, token=TOKEN)


def settled(c, mid):
    for _ in range(3000):
        row = c.get(f'/api/missions/{mid}', headers=AUTH).json()
        if row['state']['status'] not in ('ready', 'running') and mid not in c.app.state.running:
            return row
        time.sleep(.01)
    raise AssertionError('mission did not settle')


def run(c, **body):
    mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Journey', **body}).json()['id']
    assert c.post(f'/api/missions/{mid}/start', headers=AUTH).status_code == 202
    return mid, settled(c, mid)


def decide(c, mid, row, *items):
    facts = row['state']['stop_facts']
    answer = c.post(f'/api/missions/{mid}/decisions', headers=AUTH, json={
        'expected_revision': row['revision'], 'resume': True,
        'decisions': [{'target': t, 'target_id': i, 'directive': d, 'note': '', 'round': facts['round'],
                       'plan_digest': facts['plan_digest']} for t, i, d in items]})
    assert answer.status_code == 202 and answer.json()['status'] == 'scheduled', answer.text
    return settled(c, mid)


def awaiting(row, round):
    state = row['state']
    return (state['status'], state['stop_code'], state['stop_facts']['round']) == ('paused', 'awaiting_decision', round)


def tree(c, mid):
    return {n['id']: n for n in c.get(f'/api/missions/{mid}/tree', headers=AUTH).json()['nodes']}


def verified(c, mid):
    answer = c.post(f'/api/missions/{mid}/verify', headers=AUTH)
    assert answer.status_code == 200, answer.text
    assert answer.json()['integrity'] is True and answer.json()['failures'] == []
    return answer.json()['release']


def coded(response, status, code):
    """C1: every refusal is exactly {code, detail, facts} with a registered code."""
    assert response.status_code == status, response.text
    problem = response.json()['detail']
    assert set(problem) == {'code', 'detail', 'facts'} and problem['code'] == code, problem
    assert code in ERROR_CODES and isinstance(problem['detail'], str) and problem['detail'] and isinstance(problem['facts'], dict)
    return problem['facts']


def test_j0_gate_auto_runs_to_completion_without_asking(tmp_path):
    with TestClient(app(tmp_path / 'data')) as c:
        mid, row = run(c)
        state = row['state']
        assert (state['status'], state['stop_code']) == ('completed', 'plan_stop')
        assert [o['id'] for o in state['observations']] == ['fit-linear', 'fit-quadratic', 'shuffle-control']
        assert not [e for e in state['events'] if e['kind'] in ('action_withheld', 'round_closed')] and state['changes'] == []
        nodes = tree(c, mid)
        assert not [n for n in nodes.values() if n['kind'] == 'decision'] and nodes['stop']['code'] == 'plan_stop'
        assert verified(c, mid)['status'] == 'eligible_for_human_review'
        assert c.get(f'/api/missions/{mid}/capsule', headers=AUTH).status_code == 200


def test_j1_each_round_pauses_then_accept_and_park_withhold_the_parked_branch(tmp_path):
    with TestClient(app(tmp_path / 'data')) as c:
        mid, row = run(c, gate='each_round')
        assert awaiting(row, 0) and row['state']['observations'] == []
        row = decide(c, mid, row, ('proposal', 'plan-0', 'pursue'))
        assert awaiting(row, 1) and [o['id'] for o in row['state']['observations']] == ['fit-linear']
        row = decide(c, mid, row, ('branch', 'null-control', 'park'))
        assert awaiting(row, 2)
        change = row['state']['changes'][-1]['id']
        # The parked branch's action was withheld, never observed; the pursued one ran.
        assert [o['id'] for o in row['state']['observations']] == ['fit-linear', 'fit-quadratic']
        [withheld] = [e for e in row['state']['events'] if e['kind'] == 'action_withheld']
        assert withheld['round'] == 1 and withheld['detail'].startswith('shuffle-control: branch null-control; park by decision ' + change)
        nodes = tree(c, mid)
        assert nodes['branch-null-control']['state'] == 'operator_parked'
        assert nodes['action-shuffle-control']['state'] == 'withheld' and nodes['action-fit-quadratic']['state'] == 'dispatched'
        decision = nodes[f'decision-{change}-0']
        assert (decision['kind'], decision['state']) == ('decision', 'park')
        assert decision['facts']['outcome']['withheld_actions'] == ['shuffle-control']
        row = decide(c, mid, row, ('proposal', 'plan-2', 'pursue'))
        assert (row['state']['status'], row['state']['stop_code']) == ('completed', 'plan_stop')
        assert verified(c, mid)['status'] == 'eligible_for_human_review'


def test_j2_dropping_a_branch_closes_it(tmp_path):
    with TestClient(app(tmp_path / 'data')) as c:
        mid, row = run(c, gate='each_round')
        row = decide(c, mid, row, ('branch', 'linear', 'drop'))
        # linear's only action was withheld, so round 0 closed with no tool run and no review.
        assert awaiting(row, 1) and row['state']['observations'] == []
        assert any(e['kind'] == 'round_closed' and e['round'] == 0 for e in row['state']['events'])
        assert not [r for r in row['state']['model_records'] if r['round'] == 0 and r['role'] != 'planner']
        while row['state']['stop_code'] == 'awaiting_decision':
            row = decide(c, mid, row, ('proposal', f"plan-{row['state']['stop_facts']['round']}", 'pursue'))
        assert row['state']['status'] == 'completed'
        assert 'linear' not in {o['branch_id'] for o in row['state']['observations']}
        nodes = tree(c, mid)
        assert nodes['branch-linear']['state'] == 'operator_dropped' and nodes['action-fit-linear']['state'] == 'withheld'
        verified(c, mid)


def test_j3_token_time_unmeasurable_and_cost_budgets_stop_with_their_codes(tmp_path, monkeypatch):
    with TestClient(app(tmp_path / 'data')) as c:
        _, row = run(c, max_tokens=1000)
        state = row['state']
        assert (state['status'], state['stop_code']) == ('budget_exhausted', 'token_limit')
        assert state['stop_facts']['kind'] == 'tokens' and state['stop_facts']['limit'] == 1000 and state['stop_facts']['spent'] >= 1000
        assert row['spent']['measured'] is True
        with monkeypatch.context() as m:
            m.setattr(service, 'running_minutes', lambda rows: 2.0)
            _, row = run(c, max_minutes=1)
        assert (row['state']['stop_code'], row['state']['stop_facts']) == ('time_limit', {'kind': 'minutes', 'spent': 2.0, 'limit': 1})
        with monkeypatch.context() as m:
            m.setattr(service, 'DemoAgent', Unmeasured)
            _, row = run(c, max_tokens=1_000_000)
        assert (row['state']['status'], row['state']['stop_code']) == ('needs_input', 'budget_unmeasurable')
        assert row['state']['stop_facts'] == {'kind': 'tokens', 'limit': 1_000_000, 'calls': 1, 'measured_calls': 0}
        with monkeypatch.context() as m:
            m.setattr(service, 'DemoAgent', Priced)
            _, row = run(c, max_cost_usd=0.05)
        state = row['state']
        assert (state['status'], state['stop_code']) == ('budget_exhausted', 'cost_limit')
        assert state['stop_facts']['kind'] == 'cost_usd' and state['stop_facts']['spent'] >= 0.05


def test_j4_context_from_memory_and_a_prior_mission_and_a_fork_that_continues(tmp_path):
    with TestClient(app(tmp_path / 'data')) as c:
        c.app.state.memory_routes._operation = fake_memory
        parent, _ = run(c, max_rounds=1)
        parent_state = MissionState.model_validate(c.app.state.repository.get(parent)['state'])
        made = c.post('/api/missions', headers=AUTH, json={'goal': 'Continue with memory', 'continues': parent,
                                                          'context': {'memory_record_ids': ['rec-2']}})
        assert made.status_code == 201, made.text
        fork = made.json()['id']
        items = made.json()['request']['context_items']
        assert [(i['kind'], i['ref']) for i in items] == [('mission', parent), ('memory', 'rec-2')]
        assert items[0]['digest'] == release.subject_digest(parent_state)
        assert c.post(f'/api/missions/{fork}/start', headers=AUTH).status_code == 202
        assert settled(c, fork)['state']['status'] == 'completed'
        # Every model call carried the frozen context; the parent's verdicts reach the planner only.
        state = MissionState.model_validate(c.app.state.repository.get(fork)['state'])
        planner = [r for r in state.model_records if r.role == 'planner']
        reviewers = [r for r in state.model_records if r.role != 'planner']
        assert planner and reviewers
        assert all(r.input_context['mission_context'] == items for r in planner)
        assert all(r.input_context['mission_context'] == items[1:] for r in reviewers)
        rows = {r['id']: r for r in c.get('/api/missions', headers=AUTH).json()}
        assert rows[fork]['continues'] == parent and rows[parent]['continues'] is None
        assert c.get(f'/api/missions/{fork}/tree', headers=AUTH).json()['continues'] == parent
        verified(c, fork)


def test_j5_a_crew_override_lands_in_the_bound_route_digest(tmp_path, seats, monkeypatch):  # noqa: F811
    monkeypatch.setattr(service, '_secret', lambda ref: 'secret')
    crew = {'planner': {'model': 'claude-sonnet-5', 'effort': 'low'}}
    with TestClient(app(tmp_path / 'data')) as c:
        plain = c.get('/api/missions/preview', headers=AUTH).json()
        preview = c.post('/api/missions/preview', headers=AUTH, json={'crew': crew}).json()
        assert preview['route_digest'] != plain['route_digest']
        planner = next(s for s in preview['seats'] if s['role'] == 'planner')
        assert (planner['model'], planner['effort'], planner['source']) == ('claude-sonnet-5', 'low', 'mission')
        made = c.post('/api/missions', headers=AUTH, json={'goal': 'Crewed', 'mode': 'live', 'allow_egress': True, 'crew': crew})
        assert made.status_code == 201 and made.json()['request']['crew'] == crew
        mid = made.json()['id']
        # The Settings route is not this mission's route; the crewed one is.
        coded(c.post(f'/api/missions/{mid}/start', headers=AUTH, json={'approved_route_digest': plain['route_digest'],
                                                                       'grants': plain['required_grants']}), 409, 'mission.route_changed')
        started = c.post(f'/api/missions/{mid}/start', headers=AUTH, json={'approved_route_digest': preview['route_digest'],
                                                                           'grants': preview['required_grants']})
        assert started.status_code == 202, started.text
        bound = next(e for e in settled(c, mid)['state']['events'] if e['kind'] == 'seats_bound')['detail']
        assert bound.startswith('sha256:' + preview['route_digest'] + ' ') and 'anthropic:cli:claude-sonnet-5:low:planner' in bound


def test_j6_every_refusal_is_code_detail_and_facts(tmp_path, monkeypatch):
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', 'empty-cache')
    with TestClient(app(tmp_path / 'data')) as c:
        coded(c.get('/api/missions'), 401, 'auth.required')
        coded(c.get('/api/missions/nope', headers=AUTH), 404, 'mission.not_found')
        coded(c.post('/api/missions', headers=AUTH, json={}), 422, 'request.invalid')
        coded(c.post('/api/grants/g0/revoke', headers=AUTH, json={}), 404, 'grant.not_found')
        ready = c.post('/api/missions', headers=AUTH, json={'goal': 'Not yet', 'gate': 'each_round'}).json()['id']
        coded(c.post(f'/api/missions/{ready}/pause', headers=AUTH), 409, 'mission.not_pausable')
        coded(c.post(f'/api/missions/{ready}/decisions', headers=AUTH, json={'expected_revision': 0, 'decisions': []}),
              409, 'decision.not_awaiting')
        coded(c.post('/api/missions', headers=AUTH, json={'goal': 'Too early', 'continues': ready}), 409, 'fork.not_finished')
        coded(c.post('/api/missions', headers=AUTH, json={'goal': 'Orphan', 'context': {'prior_mission_ids': ['f' * 32]}}),
              404, 'context.unknown_record')
        assert c.post(f'/api/missions/{ready}/start', headers=AUTH).status_code == 202
        row = settled(c, ready)
        coded(c.post(f'/api/missions/{ready}/start', headers=AUTH), 409, 'decision.required')
        facts = row['state']['stop_facts']
        good = {'target': 'branch', 'target_id': 'linear', 'directive': 'park', 'note': '', 'round': facts['round'],
                'plan_digest': facts['plan_digest']}
        coded(c.post(f'/api/missions/{ready}/decisions', headers=AUTH,
                     json={'expected_revision': row['revision'] - 1, 'decisions': [good]}), 409, 'decision.stale')
        coded(c.post(f'/api/missions/{ready}/decisions', headers=AUTH,
                     json={'expected_revision': row['revision'], 'decisions': [{**good, 'target_id': 'nobody'}]}),
              409, 'decision.unknown_target')
        # The memory, BioArt and consent refusals share the one registry and shape.
        coded(c.get('/api/memory/sessions/s', headers=AUTH, params={'project': 'p', 'from_seq': 5, 'to_seq': 1}),
              422, 'memory.invalid_range')
        coded(c.post('/api/bioart/search', headers=AUTH, json={'query': 'antibody'}), 409, 'bioart.cache_miss')
        coded(c.post('/api/bioart/search', headers=AUTH, json={'query': 'antibody', 'remember_days': 30}),
              422, 'consent.remember_needs_consent')
        coded(c.post('/api/prose/detect', headers=AUTH, json={'text': 'x' * 400, 'remember_days': 30}),
              422, 'consent.remember_needs_consent')


def test_j7_the_legacy_mission_resumes_exports_and_verifies(tmp_path):
    from test_contract_compat import VECTORS, legacy_store, needs_rasterizer
    needs_rasterizer()
    root = legacy_store(tmp_path / 'data')
    done, interrupted = VECTORS['completed']['id'], VECTORS['interrupted']['id']
    with TestClient(app(root)) as c:
        verified(c, done)
        assert verify_capsule(c.get(f'/api/missions/{done}/capsule', headers=AUTH).content)['reproduction_passed']
        assert c.post(f'/api/missions/{interrupted}/start', headers=AUTH).status_code == 202
        row = settled(c, interrupted)
        assert row['state']['status'] == 'completed' and row['state']['request_digest'] == VECTORS['interrupted']['request_digest']
        verified(c, interrupted)
        capsule = c.get(f'/api/missions/{interrupted}/capsule', headers=AUTH)
        assert capsule.status_code == 200 and verify_capsule(capsule.content)['integrity']
        # Cut mid-dispatch by the legacy engine: a reservation, no dispatch fact, no observation.
        cut = VECTORS['dispatch_cut']['id']
        state = c.get(f'/api/missions/{cut}', headers=AUTH).json()['state']
        assert state['status'] == 'paused' and state['actions_used'] > len(state['observations']) == 0
        verified(c, cut)
        assert c.post(f'/api/missions/{cut}/start', headers=AUTH).status_code == 202
        row = settled(c, cut)
        assert row['state']['status'] == 'completed', row['state']['stop_reason']
        verified(c, cut)


def test_j8_a_remembered_bioart_grant_skips_the_flag_then_expires_and_is_refused(tmp_path, monkeypatch):
    import arc_science.bioart.web as web
    from test_bioart_web import _seed
    from test_mission_consent import Clock
    _seed(tmp_path / 'seed', monkeypatch)
    monkeypatch.setenv('ARC_BIOART_CACHE_DIR', 'bioart-cache')
    data, cache = tmp_path / 'data', tmp_path / 'data' / 'bioart-cache'
    calls = []

    async def populate(project, arguments, timeout):
        calls.append(arguments)
        shutil.copytree(tmp_path / 'seed' / 'bioart-cache', project / 'bioart-cache', dirs_exist_ok=True)

    monkeypatch.setattr(web, '_run_bioart_cli', populate)
    monkeypatch.setenv('ARC_PROJECT', str(data))
    data.mkdir()
    search = {'query': 'antibody'}
    with TestClient(app(data)) as c:
        c.app.state.grants.clock = clock = Clock()
        first = c.post('/api/bioart/search', headers=AUTH, json={**search, 'allow_egress': True, 'remember_days': 30})
        assert first.status_code == 200 and first.json()['hits'][0]['entry_id'] == 18, first.text
        [grant] = [g for g in c.get('/api/grants', headers=AUTH).json() if g['kind'] == 'remembered']
        assert (grant['destination'], grant['destination_kind'], grant['data_category']) == ('https://bioart.niaid.nih.gov', 'bioart', 'the search query')
        assert grant['expires_at'] == clock.at + 30 * DAY
        # The cache is gone; the next live read needs no flag while the remembered grant is active.
        shutil.rmtree(cache)
        again = c.post('/api/bioart/search', headers=AUTH, json=search)
        assert again.status_code == 200, again.text
        assert [r['outcome'] for r in c.app.state.grants.receipts(grant_id=grant['id'])] == ['ok', 'ok']
        assert c.app.state.grants.get(grant['id'])['uses'] == 2 and len(calls) == 2
        # Thirty days on it has expired: the read is refused and nothing leaves the machine.
        shutil.rmtree(cache)
        clock.at += 30 * DAY
        coded(c.post('/api/bioart/search', headers=AUTH, json=search), 409, 'bioart.cache_miss')
        assert len(calls) == 2 and c.app.state.grants.get(grant['id'])['state'] == 'expired'
        assert len(c.app.state.grants.receipts(grant_id=grant['id'])) == 2


class NoFalsifier(DemoAgent):
    """The fixture, proposing its branches without a measurable falsifier."""
    def _plan(self, context):
        plan = super()._plan(context)
        for branch in plan['branches']:
            branch.pop('falsifier_test', None)
        return plan


def ladders(c, mid):
    return {card['branch_id']: card['ladder'] for card in c.get(f'/api/missions/{mid}/claims', headers=AUTH).json()['claims']}


def test_j9_the_ladder_reaches_l2_only_after_verify_and_l3_only_with_a_prelocked_falsifier(tmp_path, monkeypatch):
    """A new mission writes its numbers as references (D019): L1 before Verify, L2 after it, and
    L3 only for the branch whose falsifier was committed before any observation of the dataset."""
    with TestClient(app(tmp_path / 'data')) as c:
        mid, row = run(c)
        assert row['request']['ladder_policy'] == 'references'
        before = ladders(c, mid)
        assert before and all(l['rung'] == 1 and l['next'] == {'rung': 2, 'needs': ['recomputation_missing']} for l in before.values())
        cards = {card['branch_id']: card for card in c.get(f'/api/missions/{mid}/claims', headers=AUTH).json()['claims']}
        assert '{{fit-quadratic.validation_mse}}' in cards['quadratic']['supported_scope'][0]
        assert ' [validation_mse, fit-quadratic].' in cards['quadratic']['supported_scope_rendered'][0]
        assert all(r['resolved'] for card in cards.values() for r in card['references'])
        decision = verified(c, mid)
        assert next(ch for ch in decision['checks'] if ch['name'] == 'claim_rungs')['state'] == 'satisfied'
        after = ladders(c, mid)
        # The linear branch's falsifier was committed in round 0, before any observation.
        assert after['linear']['rung'] >= 3 and {'recomputed', 'falsifier_prespecified'} <= set(after['linear']['met'])
        # The round-1 branches were committed after the linear fit had been observed on the same dataset.
        for branch in ('quadratic', 'null-control'):
            assert after[branch]['rung'] == 2 and after[branch]['next'] == {'rung': 3, 'needs': ['falsifier_after_observation']}
        monkeypatch.setattr(service, 'DemoAgent', NoFalsifier)
        mid, _ = run(c)
        verified(c, mid)
        after = ladders(c, mid)
        assert all(l['rung'] == 2 and l['next'] == {'rung': 3, 'needs': ['falsifier_test_missing']} for l in after.values())
