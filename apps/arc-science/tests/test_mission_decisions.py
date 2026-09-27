"""Operator decisions (contract C6, research B8, plan D003): with gate each_round the mission
pauses after each plan; Pursue, Park, Drop and Request test are recorded as a declared change
of kind 'decision', bound to the revision and the plan digest; parked and dropped work is
withheld, request_test reaches the next planner prompt inside the operator-directive fence,
and a decision never changes a claim's status. A finished mission can be continued by a
new one (fork), and the timeline answers deltas after a sequence."""
import asyncio
import json
import time

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from arc_science import service
from arc_science.contracts import digest
from arc_science.error_codes import ERROR_CODES, STOP_CODES
from arc_science.exploration import changes
from arc_science.exploration.agents import DemoAgent
from arc_science.exploration.claims import build_claims
from arc_science.exploration.engine import explore, operator_decisions, plan_digest
from arc_science.exploration.evidence import evidence_graph, validate_evidence
from arc_science.exploration.models import Change, MissionRequest, MissionState, OperatorDecision
from arc_science.exploration.providers import DIRECTIVE_FENCE_LABEL, PLAN_PROMPT, ModelEndpoint, render_prompt
from test_claude_code_service import configured  # noqa: F401  (a fixture)
from test_mission_context import fake_memory

TOKEN = 'd' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}


class Capture(DemoAgent):
    """The scripted fixture, keeping every planner context it was shown."""
    def __init__(self):
        self.plans = []

    async def propose(self, context):
        self.plans.append(context)
        return await super().propose(context)


class Repropose(DemoAgent):
    """The fixture, re-proposing the identical fit-linear action in round 1."""
    def _plan(self, context):
        plan = super()._plan(context)
        if context['round'] == 1:
            plan['actions'] = [{'id': 'fit-linear', 'branch_id': 'linear', 'tool': 'polynomial_fit', 'arguments': {'degree': 1}}] + plan['actions']
        return plan


class Unavailable(DemoAgent):
    """The fixture, adding a round-0 action whose tool the mission does not offer."""
    def _plan(self, context):
        plan = super()._plan(context)
        if context['round'] == 0:
            plan['actions'] = plan['actions'] + [{'id': 'ghost', 'branch_id': 'linear', 'tool': 'no_such_tool', 'arguments': {}}]
        return plan


def run(request, agent=None, initial=None):
    return asyncio.run(explore(request, agent or DemoAgent(), initial=initial))


def decide(state, *items):
    """Record operator decisions on the state the way the route does."""
    plan = next(r for r in state.model_records if r.role == 'planner' and r.round == state.round)
    decisions = tuple(OperatorDecision(target=target, target_id=target_id, directive=directive, note=note,
                                       round=state.round, plan_digest=plan_digest(plan))
                      for target, target_id, directive, note in items)
    return changes.declare(state, 'decision', ('analysis', 'claim'), 'Operator decisions', decisions=decisions)[0]


def gated(**fields):
    return MissionRequest(goal='Steer the fixture', gate='each_round', **fields)


# --- contract ---

def test_gate_continues_and_decisions_are_later_fields_that_keep_old_digests():
    plain = MissionRequest(goal='Old shape')
    assert plain.gate == 'auto' and plain.continues is None
    assert {'gate', 'continues'} <= set(MissionRequest.LATER_FIELDS)
    assert 'gate' not in plain.model_dump(mode='json') and 'continues' not in plain.model_dump(mode='json')
    assert gated().model_dump(mode='json')['gate'] == 'each_round'
    assert 'decisions' in Change.LATER_FIELDS
    resume = Change(id='c', kind='resume', declared_effects=('analysis', 'claim'), derived_effects=('analysis', 'claim'),
                    required_checks=('re_execution',), base_digest='a' * 64, round=0, at=1)
    assert 'decisions' not in resume.model_dump(mode='json')
    with pytest.raises(ValidationError):
        OperatorDecision(target='branch', target_id='b', directive='accept', round=0, plan_digest='a' * 64)
    with pytest.raises(ValidationError):
        OperatorDecision(target='branch', target_id='b', directive='park', note='x' * 401, round=0, plan_digest='a' * 64)
    with pytest.raises(ValidationError):
        Change.model_validate({**resume.model_dump(), 'decisions': [
            {'target': 'branch', 'target_id': 'b', 'directive': 'park', 'round': 0, 'plan_digest': 'a' * 64}]})
    assert changes.MISSION_CHANGES['decision']['derived'] == ('analysis', 'claim')
    assert 'awaiting_decision' in STOP_CODES


# --- engine ---

def test_each_round_pauses_after_the_committed_plan_with_its_round_and_digest():
    state = run(gated())
    plan = next(r for r in state.model_records if r.role == 'planner')
    assert (state.status, state.stop_code) == ('paused', 'awaiting_decision')
    assert state.stop_facts == {'round': 0, 'plan_digest': plan_digest(plan)} and plan_digest(plan) == digest(plan)
    # The plan was committed with its branches before the pause; nothing ran and no review was called.
    assert [b.id for b in state.branches] == ['linear'] and state.observations == () and state.model_calls_used == 1
    assert [e.kind for e in state.events][-2:] == ['plan_committed', 'mission_stopped']
    # A plain resume without a decision pauses again on the same plan, with no new call.
    again = run(gated(), initial=state)
    assert again.stop_code == 'awaiting_decision' and again.model_calls_used == 1
    # The auto gate never pauses.
    assert run(MissionRequest(goal='Steer the fixture')).status == 'completed'


def test_park_withholds_the_branch_actions_and_pursue_proceeds():
    state = decide(run(gated()), ('proposal', 'plan-0', 'pursue', ''))
    state = run(gated(), initial=state)
    assert state.stop_facts['round'] == 1 and [o.id for o in state.observations] == ['fit-linear']
    state = decide(state, ('branch', 'null-control', 'park', 'Not now.'), ('branch', 'quadratic', 'pursue', ''))
    change_id = state.changes[-1].id
    state = run(gated(), initial=state)
    # The round-2 plan stops, and that too waits for the operator.
    assert (state.status, state.stop_facts['round']) == ('paused', 2)
    assert [o.id for o in state.observations] == ['fit-linear', 'fit-quadratic']
    withheld = [e for e in state.events if e.kind == 'action_withheld']
    assert len(withheld) == 1 and withheld[0].round == 1
    assert withheld[0].detail.startswith('shuffle-control: branch null-control; park by decision ' + change_id)
    # Only the dispatched action was charged.
    assert state.actions_used == 2
    validate_evidence(state)
    state = run(gated(), initial=decide(state, ('proposal', 'plan-2', 'pursue', '')))
    assert (state.status, state.stop_code) == ('completed', 'plan_stop')


def test_a_stop_plan_waits_for_the_operator_and_a_request_for_more_work_overrides_it():
    state = run(gated(), initial=decide(run(gated()), ('proposal', 'plan-0', 'pursue', '')))
    state = run(gated(), initial=decide(state, ('branch', 'null-control', 'park', '')))
    plan = next(r for r in state.model_records if r.role == 'planner' and r.round == 2)
    assert plan.payload['stop'] and (state.status, state.stop_code) == ('paused', 'awaiting_decision')
    assert state.stop_facts == {'round': 2, 'plan_digest': plan_digest(plan)}
    # Pursuing the parked branch refuses the stop: the round closes and the planner is asked again.
    calls = state.model_calls_used
    state = run(gated(), initial=decide(state, ('branch', 'null-control', 'pursue', '')))
    assert any(e.kind == 'round_closed' and e.round == 2 for e in state.events)
    assert not [r for r in state.model_records if r.round == 2 and r.role != 'planner']
    assert state.stop_facts['round'] == 3 and state.model_calls_used == calls + 1
    validate_evidence(state)
    # Accepting the stop plan ends the mission.
    state = run(gated(), initial=decide(state, ('proposal', 'plan-3', 'pursue', '')))
    assert (state.status, state.stop_code) == ('completed', 'plan_stop')


def test_a_withheld_action_proposed_again_runs_in_its_later_round_and_verifies():
    state = run(gated(), agent=Repropose(), initial=decide(run(gated(), agent=Repropose()), ('branch', 'linear', 'park', '')))
    assert state.observations == () and state.stop_facts['round'] == 1
    state = run(gated(), agent=Repropose(), initial=decide(state, ('branch', 'linear', 'pursue', '')))
    assert [(o.id, o.round) for o in state.observations] == [('fit-linear', 1), ('fit-quadratic', 1), ('shuffle-control', 1)]
    validate_evidence(state)
    evidence_graph(state)
    state = run(gated(), agent=Repropose(), initial=decide(state, ('proposal', 'plan-2', 'pursue', '')))
    assert state.status == 'completed'
    validate_evidence(state)


@pytest.mark.parametrize('directive', ['pursue', 'drop'])
def test_a_gated_plan_naming_an_unavailable_tool_resumes_under_any_decision(directive):
    state = run(gated(), agent=Unavailable())
    assert state.stop_code == 'awaiting_decision'
    state = run(gated(), agent=Unavailable(), initial=decide(state, ('proposal', 'plan-0', directive, '')))
    ghost = [o for o in state.observations if o.id == 'ghost']
    # Pursued, the engine refuses the request as the auto gate does; dropped, it never ran.
    assert [o.status for o in ghost] == (['error'] if directive == 'pursue' else [])
    validate_evidence(state)
    evidence_graph(state)


def test_dropping_the_proposal_closes_the_round_without_tools_or_reviews():
    state = run(gated(), initial=decide(run(gated()), ('proposal', 'plan-0', 'pursue', '')))
    calls = state.model_calls_used
    state = run(gated(), initial=decide(state, ('proposal', 'plan-1', 'drop', 'Wrong direction.')))
    assert {e.detail.split(':')[0] for e in state.events if e.kind == 'action_withheld'} == {'fit-quadratic', 'shuffle-control'}
    assert any(e.kind == 'round_closed' and e.round == 1 for e in state.events)
    assert not [r for r in state.model_records if r.round == 1 and r.role != 'planner']
    # Round 2 was planned: one planner call after the closed round, no reviewer pair.
    assert [r.round for r in state.model_records if r.role == 'planner'] == [0, 1, 2]
    assert state.model_calls_used == calls + 1
    # The dropped plan's branches remain recorded.
    assert [b.id for b in state.branches] == ['linear', 'quadratic', 'null-control']
    validate_evidence(state)


def test_dropping_a_branch_withholds_its_actions_in_later_rounds_too():
    state = run(gated(), initial=decide(run(gated()), ('branch', 'linear', 'drop', '')))
    # linear was dropped before its only action ran: the round closes.
    assert [o.id for o in state.observations] == [] and state.stop_facts['round'] == 1
    state = run(gated(), initial=decide(state, ('proposal', 'plan-1', 'pursue', '')))
    assert [o.id for o in state.observations] == ['fit-quadratic', 'shuffle-control']


def test_request_test_and_every_directive_reach_the_next_planner_prompt_inside_the_fence():
    agent = Capture()
    state = run(gated(), agent=agent)
    assert 'operator_directives' not in agent.plans[0]
    state = decide(state, ('branch', 'linear', 'request_test', 'Try a held-out split.'))
    run(gated(), agent=agent, initial=state)
    directives = agent.plans[1]['operator_directives']
    assert directives == [{'target': 'branch', 'target_id': 'linear', 'directive': 'request_test',
                           'note': 'Try a held-out split.', 'round': 0,
                           'ask': 'Propose an action that tests this branch.'}]
    prompt = render_prompt(agent.plans[1], {})
    head, fenced = prompt.split(DIRECTIVE_FENCE_LABEL, 1)
    assert 'operator_directives' not in json.loads(head)['context'] and 'held-out' not in head
    lines = fenced.strip('\n').split('\n')
    assert lines[0] == '<<<OPERATOR_DIRECTIVES' and lines[2] == 'OPERATOR_DIRECTIVES>>>'
    assert json.loads(lines[1]) == directives
    assert 'operator_directives' in PLAN_PROMPT
    # A prompt without directives is rendered exactly as before.
    assert DIRECTIVE_FENCE_LABEL not in render_prompt(agent.plans[0], {})


def test_a_decision_never_changes_a_claim_status_or_its_derivation():
    auto = run(MissionRequest(goal='Steer the fixture'))
    state = run(gated())
    for round_number in range(3):
        state = run(gated(), initial=decide(state, ('proposal', f'plan-{round_number}', 'pursue', '')))
    assert state.status == 'completed'
    # Recording a decision leaves the claim scope and the claims untouched.
    paused = run(gated())
    assert decide(paused, ('branch', 'linear', 'park', '')).claim_scope == paused.claim_scope
    # Pursuing everything is the auto mission: the same claims, statuses, scopes and (when
    # the ladder is derived) rungs. This holds while no spend budget binds: the directives are
    # planner input, so a gated mission spends more tokens and can reach a budget sooner.
    claims = lambda s: build_claims(s, [], evidence_graph(s), None)['claims']
    assert claims(state) == claims(auto) and state.claim_scope == auto.claim_scope
    assert [d['directive'] for d in operator_decisions(state)] == ['pursue', 'pursue', 'pursue']


# --- service ---

def app(tmp_path):
    return service.create_app(data_dir=tmp_path / 'data', token=TOKEN)


def settled(c, mid):
    for _ in range(3000):
        row = c.get(f'/api/missions/{mid}', headers=AUTH).json()
        if row['state']['status'] not in ('ready', 'running') and mid not in c.app.state.running:
            return row
        time.sleep(.01)
    raise AssertionError('mission did not settle')


def refused(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()['detail']['code'] == code and response.json()['detail']['detail'] == ERROR_CODES[code]
    return response.json()['detail']['facts']


def body(row, *items, resume=True):
    facts = row['state']['stop_facts']
    return {'expected_revision': row['revision'], 'resume': resume,
            'decisions': [{'target': t, 'target_id': i, 'directive': d, 'note': n, 'round': facts['round'],
                           'plan_digest': facts['plan_digest']} for t, i, d, n in items]}


def test_the_decision_route_records_a_declared_change_and_resumes(tmp_path):
    with TestClient(app(tmp_path)) as c:
        mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Steer through the API', 'gate': 'each_round'}).json()['id']
        refused(c.post(f'/api/missions/{mid}/decisions', headers=AUTH, json={'expected_revision': 0, 'decisions': []}),
                409, 'decision.not_awaiting')
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH).status_code == 202
        row = settled(c, mid)
        assert row['state']['stop_code'] == 'awaiting_decision'
        # A plain start or resume needs a decision first; the /changes route does not take decisions.
        refused(c.post(f'/api/missions/{mid}/start', headers=AUTH), 409, 'decision.required')
        refused(c.post(f'/api/missions/{mid}/changes', headers=AUTH, json={'kind': 'resume', 'declared_effects': ['analysis', 'claim']}),
                409, 'decision.required')
        other_route = c.post(f'/api/missions/{mid}/changes', headers=AUTH, json={'kind': 'decision', 'declared_effects': ['analysis', 'claim']})
        assert other_route.status_code == 409 and other_route.json()['detail']['code'] == 'mission.change_refused'
        assert 'decisions route' in other_route.json()['detail']['detail']
        # Recorded without resuming: the mission stays paused, its release goes stale on read.
        recorded = c.post(f'/api/missions/{mid}/decisions', headers=AUTH, json=body(row, ('proposal', 'plan-0', 'pursue', 'Go.'), resume=False))
        assert recorded.status_code == 202, recorded.text
        change = recorded.json()['change']
        assert recorded.json()['status'] == 'recorded' and change['kind'] == 'decision'
        assert change['derived_effects'] == ['analysis', 'claim'] and change['decisions'][0]['directive'] == 'pursue'
        row = c.get(f'/api/missions/{mid}', headers=AUTH).json()
        assert row['state']['status'] == 'paused' and change['id'] in row['change_obligations']
        # Decided: a plain start now resumes, to the next plan.
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH).status_code == 202
        row = settled(c, mid)
        assert row['state']['stop_facts']['round'] == 1
        parked = c.post(f'/api/missions/{mid}/decisions', headers=AUTH, json=body(row, ('branch', 'null-control', 'park', '')))
        assert parked.status_code == 202 and parked.json()['status'] == 'scheduled'
        row = settled(c, mid)
        assert row['state']['stop_facts']['round'] == 2
        c.post(f'/api/missions/{mid}/decisions', headers=AUTH, json=body(row, ('proposal', 'plan-2', 'pursue', '')))
        row = settled(c, mid)
        assert row['state']['status'] == 'completed'
        assert [o['id'] for o in row['state']['observations']] == ['fit-linear', 'fit-quadratic']
        verified = c.post(f'/api/missions/{mid}/verify', headers=AUTH).json()
        assert verified['integrity'] is True and verified['failures'] == []
        assert c.get(f'/api/missions/{mid}/capsule', headers=AUTH).status_code == 200


def test_stale_and_unknown_decisions_are_refused(tmp_path):
    with TestClient(app(tmp_path)) as c:
        mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Stale decisions', 'gate': 'each_round'}).json()['id']
        c.post(f'/api/missions/{mid}/start', headers=AUTH)
        row = settled(c, mid)
        good = body(row, ('branch', 'linear', 'park', ''))
        facts = refused(c.post(f'/api/missions/{mid}/decisions', headers=AUTH, json={**good, 'expected_revision': row['revision'] - 1}),
                        409, 'decision.stale')
        assert facts == {'revision': row['revision'], 'round': 0, 'plan_digest': row['state']['stop_facts']['plan_digest']}
        other = [{**good['decisions'][0], 'plan_digest': 'e' * 64}]
        refused(c.post(f'/api/missions/{mid}/decisions', headers=AUTH, json={**good, 'decisions': other}), 409, 'decision.stale')
        late = [{**good['decisions'][0], 'round': 1}]
        refused(c.post(f'/api/missions/{mid}/decisions', headers=AUTH, json={**good, 'decisions': late}), 409, 'decision.stale')
        for target, target_id in (('branch', 'nobody'), ('proposal', 'plan-1')):
            unknown = [{**good['decisions'][0], 'target': target, 'target_id': target_id}]
            assert refused(c.post(f'/api/missions/{mid}/decisions', headers=AUTH, json={**good, 'decisions': unknown}),
                           409, 'decision.unknown_target') == {'target': target, 'target_id': target_id}
        invalid = c.post(f'/api/missions/{mid}/decisions', headers=AUTH,
                         json={**good, 'decisions': [{**good['decisions'][0], 'directive': 'accept'}]})
        assert invalid.status_code == 422
        # Nothing was recorded by any refusal.
        assert c.get(f'/api/missions/{mid}', headers=AUTH).json()['state']['changes'] == []


def test_a_finished_mission_is_continued_by_a_fork(tmp_path):
    with TestClient(app(tmp_path)) as c:
        first = c.post('/api/missions', headers=AUTH, json={'goal': 'Parent mission', 'max_rounds': 1}).json()['id']
        refused(c.post('/api/missions', headers=AUTH, json={'goal': 'Too early', 'continues': first}), 409, 'fork.not_finished')
        c.post(f'/api/missions/{first}/start', headers=AUTH)
        parent = settled(c, first)
        assert parent['state']['status'] == 'budget_exhausted'
        refused(c.post('/api/missions', headers=AUTH, json={'goal': 'Orphan', 'continues': 'f' * 32}), 404, 'context.unknown_record')
        fork = c.post('/api/missions', headers=AUTH, json={'goal': 'Continue the parent', 'continues': first})
        assert fork.status_code == 201, fork.text
        request = fork.json()['request']
        assert request['continues'] == first
        item = request['context_items'][0]
        assert (item['kind'], item['ref']) == ('mission', first)
        assert 'supported_scope' in json.loads(item['text'])['claims'][0]
        # With memory attached too, the parent is still the first context item.
        c.app.state.memory_routes._operation = fake_memory
        both = c.post('/api/missions', headers=AUTH, json={'goal': 'Continue with memory', 'continues': first,
                                                          'context': {'memory_record_ids': ['rec-2']}})
        assert both.status_code == 201, both.text
        assert [(i['kind'], i['ref']) for i in both.json()['request']['context_items']] == [('mission', first), ('memory', 'rec-2')]
        rows = {r['id']: r for r in c.get('/api/missions', headers=AUTH).json()}
        assert rows[fork.json()['id']]['continues'] == first and rows[first]['continues'] is None
        assert c.get(f"/api/missions/{fork.json()['id']}/tree", headers=AUTH).json()['continues'] == first


def test_the_timeline_answers_only_rows_after_a_sequence(tmp_path):
    with TestClient(app(tmp_path)) as c:
        mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Timeline deltas', 'max_rounds': 1}).json()['id']
        c.post(f'/api/missions/{mid}/start', headers=AUTH)
        settled(c, mid)
        full = c.get(f'/api/missions/{mid}/timeline', headers=AUTH).json()
        assert full['count'] >= 4 and full['cursor'] == full['rows'][-1]['sequence']
        after = full['rows'][1]['sequence']
        delta = c.get(f'/api/missions/{mid}/timeline?after={after}', headers=AUTH).json()
        assert delta['rows'] == [r for r in full['rows'] if r['sequence'] > after] and delta['count'] == len(delta['rows'])
        assert c.get(f"/api/missions/{mid}/timeline?after={full['cursor']}", headers=AUTH).json()['rows'] == []
        assert c.get(f'/api/missions/{mid}/timeline?after=-1', headers=AUTH).status_code == 422


def test_a_gated_route_names_the_operator_directives_the_planner_receives(tmp_path, monkeypatch):
    seat = ModelEndpoint(provider='anthropic', transport='cli', endpoint='claude', model='claude-opus-5', credential_ref='planner')
    monkeypatch.setattr(service, 'live_route', lambda vision_review=False: {'seats': {'planner': seat, 'reviewer': seat, 'falsifier': seat},
                                                                             'mcp_servers': [], 'acp_agents': []})
    assert service.OPERATOR_DIRECTIVES_CATEGORY not in service.seat_category(True)
    with TestClient(app(tmp_path)) as c:
        plain = c.post('/api/missions/preview', headers=AUTH, json={}).json()
        steered = c.post('/api/missions/preview', headers=AUTH, json={'gate': 'each_round'}).json()
    assert steered['route_digest'] == plain['route_digest']
    assert all(service.OPERATOR_DIRECTIVES_CATEGORY in s['data_category'] for s in steered['seats'])
    assert not any('operator_directives' in s['data_category'] for s in plain['seats'])


def test_a_gated_live_mission_needs_the_approval_of_the_directive_category(configured, tmp_path):
    with TestClient(app(tmp_path)) as c:
        made = c.post('/api/missions', headers=AUTH, json={'goal': 'Live and steered', 'mode': 'live', 'allow_egress': True,
                                                           'max_rounds': 1, 'gate': 'each_round'})
        assert made.status_code == 201, made.text
        mid = made.json()['id']
        plain = c.post('/api/missions/preview', headers=AUTH, json={}).json()
        refused_start = c.post(f'/api/missions/{mid}/start', headers=AUTH,
                               json={'approved_route_digest': plain['route_digest'], 'grants': plain['required_grants']})
        assert refused_start.status_code == 409 and refused_start.json()['detail']['code'] == 'mission.grant_missing', refused_start.text
        preview = c.post('/api/missions/preview', headers=AUTH, json={'gate': 'each_round'}).json()
        started = c.post(f'/api/missions/{mid}/start', headers=AUTH,
                         json={'approved_route_digest': preview['route_digest'], 'grants': preview['required_grants']})
        assert started.status_code == 202, started.text
        assert settled(c, mid)['state']['stop_code'] == 'awaiting_decision'
        seat_grants = [g for g in c.get(f'/api/missions/{mid}/grants', headers=AUTH).json()['grants'] if g['destination_kind'] == 'seat']
        assert seat_grants and all('operator_directives' in g['data_category'] for g in seat_grants)
