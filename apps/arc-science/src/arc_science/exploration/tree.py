"""The decision tree read model (contract C6, research B7).

The mission as nodes on a grid: depth is the round, lane is the order in which a branch
first appeared (lane 0 holds the mission-wide nodes), so a client lays it out without a
layout library. Derived on read from the recorded state, the operator decisions and the
operational timeline. Pure: no I/O, inputs are never mutated, nothing here is evidence and
no claim status is read from it."""
from __future__ import annotations

from .claims import _timing, route_states

DIRECTIVE_STATES = {'pursue': 'operator_pursued', 'park': 'operator_parked', 'drop': 'operator_dropped',
                    'request_test': 'test_requested'}
# The relation of a parent edge by the kinds it joins; any other parent edge is led_to.
PARENT_RELATIONS = {('plan', 'branch'): 'proposes', ('plan', 'action'): 'proposes', ('branch', 'branch'): 'parent',
                    ('action', 'observation'): 'produced'}


def build_tree(state, timeline_rows, decisions, *, mission_id='', revision=0, continues=None, goal=''):
    nodes, edges, kinds = [], [], {}
    lanes = {branch.id: index + 1 for index, branch in enumerate(state.branches)}

    def node(id, kind, round, lane, node_state, parents=(), code='', **facts):
        kinds[id] = kind
        nodes.append({'id': id, 'kind': kind, 'round': round, 'depth': round, 'lane': lane, 'state': node_state,
                      'code': code, 'facts': facts, 'parents': list(parents)})
        edges.extend({'source': p, 'target': id, 'relation': PARENT_RELATIONS.get((kinds[p], kind), 'led_to')} for p in parents)

    def edge(source, target, relation):
        edges.append({'source': source, 'target': target, 'relation': relation})

    plans = sorted((r for r in state.model_records if r.role == 'planner'), key=lambda r: r.round)
    reviews = [r for r in state.model_records if r.role != 'planner']
    withheld = {}   # (round, action id) -> (branch id, decision change id), from the engine's events
    for event in state.events:
        if event.kind == 'action_withheld':
            action_id, _, rest = event.detail.partition(': branch ')
            withheld[(event.round, action_id)] = (rest.split(';', 1)[0], rest.rsplit(' ', 1)[-1])
    observed = {o.id: o for o in state.observations}
    awaiting = state.status == 'paused' and state.stop_code == 'awaiting_decision'
    routes = {r['branch_id']: r['state'] for r in route_states(state)}
    standing = {d['target_id']: d['directive'] for d in decisions if d['target'] == 'branch'}
    decision_ids = [f"decision-{d['change_id']}-{[x['change_id'] for x in decisions[:i]].count(d['change_id'])}"
                    for i, d in enumerate(decisions)]

    node('goal', 'goal', 0, 0, 'set', goal=goal)
    actions_seen, previous = set(), None
    for plan in plans:
        r, payload = plan.round, plan.payload
        round_decisions = [d for d in decisions if d['round'] == r]
        proposal = next((d['directive'] for d in reversed(round_decisions) if d['target'] == 'proposal'), None)
        if awaiting and state.stop_facts.get('round') == r:
            plan_state = 'awaiting'
        elif proposal in ('pursue', 'park', 'drop'):
            plan_state = 'accepted' if proposal == 'pursue' else 'rejected'
        else:
            plan_state = 'decided' if any(c.kind == 'decision' and c.round == r for c in state.changes) else 'auto'
        if previous is None:
            parents = ['goal']
        else:
            parents = [f'review-{x.role}-{previous}' for x in reviews if x.round == previous] or [f'plan-{previous}']
            parents += [decision_ids[i] for i, d in enumerate(decisions) if d['round'] == previous]
        actions = payload.get('actions') or []
        node(f'plan-{r}', 'plan', r, 0, plan_state, parents, reason=payload.get('reason', ''), model=plan.model,
             stop=bool(payload.get('stop')), branches=[b['id'] for b in payload.get('branches') or []],
             actions=[a['id'] for a in actions], withheld=[a['id'] for a in actions if (r, a['id']) in withheld])
        for branch in state.branches:
            if branch.created_round == r:
                node(f'branch-{branch.id}', 'branch', r, lanes[branch.id],
                     DIRECTIVE_STATES.get(standing.get(branch.id)) or routes.get(branch.id, 'proposed_untested'),
                     [f'plan-{r}'] + [f'branch-{p}' for p in branch.parents], title=branch.title, hypothesis=branch.hypothesis,
                     falsifier=branch.falsifier, route=routes.get(branch.id))
        for action in actions if not payload.get('stop') else []:
            ran = observed.get(action['id'])
            if ran and ran.round < r:
                continue   # listed again after it ran; drawn where it ran
            # One node per plan that proposes the action: withheld in one round, it can run in a later one.
            action_id = f"action-{action['id']}" + (f'@{r}' if action['id'] in actions_seen else '')
            actions_seen.add(action['id'])
            ran = ran if ran and ran.round == r else None
            held = (r, action['id']) in withheld
            action_state = 'dispatched' if ran else 'withheld' if held else 'pending'
            node(action_id, 'action', r, lanes.get(action['branch_id'], 0), action_state, [f'plan-{r}'],
                 tool=action['tool'], branch_id=action['branch_id'],
                 timing=_timing([] if held else timeline_rows, action['id']))
            edge(action_id, f"branch-{action['branch_id']}", 'targets')
            if ran:
                node(f'observation-{ran.id}', 'observation', ran.round, lanes.get(ran.branch_id, 0), ran.status,
                     [action_id], tool=ran.tool, claim_eligible=ran.claim_eligible)
        visual_of = {}
        for index, record in enumerate(state.vision_records):
            if record.round != r:
                continue
            sources = [a.source_observation_id for a in state.artifacts if a.digest in record.reviewed_digests]
            node(f'visual-{index}', 'visual_review', r, 0, record.status,
                 [f'observation-{s}' for s in dict.fromkeys(sources)] or [f'plan-{r}'], model=record.model)
            visual_of[record.report_digest] = f'visual-{index}'
        for cycle in state.repairs:
            if cycle.round == r:
                node(f'repair-{r}-{cycle.cycle}', 'repair', r, 0, cycle.outcome,
                     [visual_of.get(cycle.trigger_report_digest, f'plan-{r}')], preset=cycle.preset, reason=cycle.reason)
        for record in reviews:
            if record.round != r:
                continue
            positions = {a['branch_id']: a['position'] for a in record.payload.get('assessments') or []}
            node(f'review-{record.role}-{r}', 'review', r, 0, 'recorded',
                 [f'observation-{o.id}' for o in state.observations if o.round == r] or [f'plan-{r}'],
                 role=record.role, model=record.model, positions=positions)
            for branch_id in positions:
                edge(f'review-{record.role}-{r}', f'branch-{branch_id}', 'assessed')
        for i, d in enumerate(decisions):
            if d['round'] != r:
                continue
            target = f"branch-{d['target_id']}" if d['target'] == 'branch' else f'plan-{r}'
            later = next((p for p in plans if p.round > r), None)
            outcome = {'withheld_actions': [a for (_, a), (bid, cid) in withheld.items() if cid == d['change_id']
                                            and (d['target'] == 'proposal' or bid == d['target_id'])],
                       'next_plan': f'plan-{later.round}' if later else None,
                       'observations_after': [o.id for o in state.observations if o.round >= r
                                              and (d['target'] == 'proposal' or o.branch_id == d['target_id'])]}
            node(decision_ids[i], 'decision', r, lanes.get(d['target_id'], 0) if d['target'] == 'branch' else 0,
                 d['directive'], [f'plan-{r}'], directive=d['directive'], target=d['target'], target_id=d['target_id'],
                 note=d['note'], at=d['at'], change_id=d['change_id'], outcome=outcome)
            edge(decision_ids[i], target, 'decided')
        previous = r
    if state.status not in ('ready', 'running'):
        node('stop', 'stop', state.round, 0, state.status, [f'plan-{previous}'] if previous is not None else ['goal'],
             code=state.stop_code, reason=state.stop_reason, stop_facts=state.stop_facts)
    return {'mission_id': mission_id, 'revision': revision, 'source': 'derived', 'continues': continues,
            'nodes': nodes, 'edges': edges}
