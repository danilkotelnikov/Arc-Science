"""The decision tree read model (contract C6, research B7): nodes by round (depth) and
branch lane, multi-parent edges, operator decisions with their outcome, derived on read
and deterministic, never evidence."""
import asyncio
import copy
import time

from fastapi.testclient import TestClient

from arc_science import service
from arc_science.exploration import changes
from arc_science.exploration.agents import DemoAgent, DemoVisionAgent
from arc_science.exploration.claims import build_claims
from arc_science.exploration.engine import explore, operator_decisions, plan_digest
from arc_science.exploration.evidence import evidence_graph
from arc_science.exploration.models import MissionRequest, OperatorDecision
from arc_science.exploration.tree import build_tree

TOKEN = 't' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}
KINDS = {'goal', 'plan', 'branch', 'action', 'observation', 'review', 'visual_review', 'repair', 'decision', 'stop'}
RELATIONS = {'proposes', 'targets', 'produced', 'assessed', 'decided', 'led_to', 'parent'}


def run(request, agent=None, initial=None):
    return asyncio.run(explore(request, agent or DemoAgent(), initial=initial))


def gated():
    return MissionRequest(goal='Tree of the fixture', gate='each_round')


def decide(state, target, target_id, directive):
    plan = next(r for r in state.model_records if r.role == 'planner' and r.round == state.round)
    decision = OperatorDecision(target=target, target_id=target_id, directive=directive, note='n',
                                round=state.round, plan_digest=plan_digest(plan))
    return changes.declare(state, 'decision', ('analysis', 'claim'), '', decisions=(decision,))[0]


def tree(state, rows=()):
    return build_tree(state, list(rows), operator_decisions(state), mission_id='m', revision=3, continues=None, goal='Tree of the fixture')


def nodes(t):
    return {n['id']: n for n in t['nodes']}


def well_formed(t):
    ids = [n['id'] for n in t['nodes']]
    assert len(ids) == len(set(ids))
    assert {n['kind'] for n in t['nodes']} <= KINDS and {e['relation'] for e in t['edges']} <= RELATIONS
    assert all(e['source'] in ids and e['target'] in ids for e in t['edges'])
    for n in t['nodes']:
        assert n['depth'] == n['round'] and all(p in ids for p in n['parents'])
        assert set(n) == {'id', 'kind', 'round', 'depth', 'lane', 'state', 'code', 'facts', 'parents'}


def test_the_layout_is_deterministic_by_round_and_first_appearance_of_the_branch():
    state = run(MissionRequest(goal='Tree of the fixture'))
    t = tree(state)
    well_formed(t)
    assert t == tree(state) and t['source'] == 'derived'
    assert (t['mission_id'], t['revision'], t['continues']) == ('m', 3, None)
    n = nodes(t)
    assert [(n[f'branch-{b}']['lane'], n[f'branch-{b}']['depth']) for b in ('linear', 'quadratic', 'null-control')] == [(1, 0), (2, 1), (3, 1)]
    # Actions and their observations sit in their branch's lane at the plan's round.
    assert (n['action-shuffle-control']['lane'], n['action-shuffle-control']['depth'], n['action-shuffle-control']['state']) == (3, 1, 'dispatched')
    assert n['observation-shuffle-control']['parents'] == ['action-shuffle-control']
    # Multi-parent: a branch hangs from the plan that proposed it and from its parent branch.
    assert n['branch-quadratic']['parents'] == ['plan-1', 'branch-linear']
    edges = {(e['source'], e['target'], e['relation']) for e in t['edges']}
    assert {('plan-1', 'branch-quadratic', 'proposes'), ('branch-linear', 'branch-quadratic', 'parent'),
            ('action-fit-quadratic', 'branch-quadratic', 'targets'), ('action-fit-quadratic', 'observation-fit-quadratic', 'produced'),
            ('review-analyst-1', 'branch-quadratic', 'assessed')} <= edges
    assert n['plan-0']['parents'] == ['goal'] and n['plan-1']['parents'] == ['review-analyst-0', 'review-falsifier-0']
    assert n['plan-1']['state'] == 'auto' and n['plan-1']['facts']['actions'] == ['fit-quadratic', 'shuffle-control']
    assert n['stop']['state'] == 'completed' and n['stop']['code'] == 'plan_stop' and n['stop']['parents'] == ['plan-2']
    assert n['goal']['facts']['goal'] == 'Tree of the fixture'


def test_an_awaiting_plan_and_a_parked_branch_show_what_the_operator_chose_and_what_followed():
    state = run(gated())
    t = tree(state)
    well_formed(t)
    assert nodes(t)['plan-0']['state'] == 'awaiting' and nodes(t)['action-fit-linear']['state'] == 'pending'
    assert nodes(t)['stop']['code'] == 'awaiting_decision'
    state = run(gated(), initial=decide(state, 'proposal', 'plan-0', 'pursue'))
    state = decide(state, 'branch', 'null-control', 'park')
    change_id = state.changes[-1].id
    state = run(gated(), initial=state)
    t = tree(state)
    well_formed(t)
    n = nodes(t)
    assert n['branch-null-control']['state'] == 'operator_parked'
    assert n['action-shuffle-control']['state'] == 'withheld' and n['action-fit-quadratic']['state'] == 'dispatched'
    decision = n[f'decision-{change_id}-0']
    assert (decision['kind'], decision['state'], decision['lane'], decision['depth']) == ('decision', 'park', 3, 1)
    assert decision['facts']['outcome'] == {'withheld_actions': ['shuffle-control'], 'next_plan': 'plan-2', 'observations_after': []}
    assert decision['facts']['target_id'] == 'null-control' and decision['facts']['note'] == 'n'
    edges = {(e['source'], e['target'], e['relation']) for e in t['edges']}
    assert (decision['id'], 'branch-null-control', 'decided') in edges and (decision['id'], 'plan-2', 'led_to') in edges
    assert decision['id'] in n['plan-2']['parents']
    assert n['plan-1']['facts']['withheld'] == ['shuffle-control'] and n['plan-0']['state'] == 'accepted'


def test_a_withheld_action_proposed_again_is_drawn_in_each_round_with_its_own_outcome():
    from test_mission_decisions import Repropose
    state = run(gated(), agent=Repropose(), initial=decide(run(gated(), agent=Repropose()), 'branch', 'linear', 'park'))
    state = run(gated(), agent=Repropose(), initial=decide(state, 'branch', 'linear', 'pursue'))
    t = tree(state)
    well_formed(t)
    n = nodes(t)
    first, later = n['action-fit-linear'], n['action-fit-linear@1']
    assert (first['depth'], first['state'], first['parents']) == (0, 'withheld', ['plan-0'])
    assert (later['depth'], later['state'], later['parents']) == (1, 'dispatched', ['plan-1'])
    assert n['observation-fit-linear']['parents'] == ['action-fit-linear@1'] and n['observation-fit-linear']['depth'] == 1
    assert n['plan-0']['facts']['withheld'] == ['fit-linear'] and n['plan-1']['facts']['withheld'] == []


def test_visual_reviews_and_repairs_hang_from_what_they_reviewed():
    state = run(MissionRequest(goal='Tree of the fixture', vision_review=True), agent=DemoVisionAgent())
    t = tree(state)
    well_formed(t)
    visual = [n for n in t['nodes'] if n['kind'] == 'visual_review']
    repairs = [n for n in t['nodes'] if n['kind'] == 'repair']
    assert visual and repairs
    assert visual[0]['parents'] == ['observation-fit-linear'] and repairs[0]['parents'] == [visual[0]['id']]


def test_the_tree_reads_the_timeline_and_changes_nothing_it_reads():
    state = run(MissionRequest(goal='Tree of the fixture'))
    rows = [{'operation': 'tool', 'action_id': 'fit-linear', 'outcome_source': 'recorded', 'started_at': 5, 'finished_at': 9, 'receipt_id': None}]
    kept = copy.deepcopy(rows)
    claims = build_claims(state, rows, evidence_graph(state), None)
    t = tree(state, rows)
    assert nodes(t)['action-fit-linear']['facts']['timing']['started_at'] == 5
    assert rows == kept and build_claims(state, rows, evidence_graph(state), None) == claims


def test_the_tree_route(tmp_path):
    with TestClient(service.create_app(data_dir=tmp_path / 'data', token=TOKEN)) as c:
        mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Tree route', 'max_rounds': 1}).json()['id']
        c.post(f'/api/missions/{mid}/start', headers=AUTH)
        for _ in range(3000):
            row = c.get(f'/api/missions/{mid}', headers=AUTH).json()
            if row['state']['status'] not in ('ready', 'running'):
                break
            time.sleep(.01)
        t = c.get(f'/api/missions/{mid}/tree', headers=AUTH).json()
        assert (t['mission_id'], t['revision'], t['source'], t['continues']) == (mid, row['revision'], 'derived', None)
        well_formed(t)
        assert c.get('/api/missions/nobody/tree', headers=AUTH).status_code == 404
