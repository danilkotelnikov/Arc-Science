"""The validation ladder (C5, D010): each claim's rung is derived from persisted evidence
only. L1 traced, L2 recomputed, L3 pre-specified, L4 severe, L5 replicated (not built,
so always a need). Agreement between the reviewer and falsifier seats never raises a
rung, and release holds numeric claims to L2 and every other assessed claim to L1.

OpenAlex responses come from tests/fixtures/openalex: works_is_retracted.json was
recorded from api.openalex.org on 2026-09-27 (Wakefield 1998 is retracted, LeCun 2015
is not); europepmc_search.json is a hand-written minimal Europe PMC result carrying
those two DOIs and one record without a DOI. No test here uses the network."""
import asyncio
import json
import os
from pathlib import Path

import httpx
import pytest

from arc_science.exploration import release
from arc_science.exploration.agents import DemoAgent
from arc_science.exploration.claims import build_claims
from arc_science.exploration.engine import explore
from arc_science.exploration.evidence import evidence_graph
from arc_science.exploration.models import Event, MissionRequest, MissionState, VerificationReceipt
from arc_science.exploration.public_reads import public_tools
from arc_science.exploration.validation import RUNGS, _binds, _tokens, claim_ladder, numbers
from test_settings import stub  # noqa: F401  (fixture reuse)

FIXTURES = Path(__file__).parent / 'fixtures'
OPENALEX = json.loads((FIXTURES / 'openalex' / 'works_is_retracted.json').read_text(encoding='utf-8'))
EUROPEPMC = json.loads((FIXTURES / 'openalex' / 'europepmc_search.json').read_text(encoding='utf-8'))
FIT_ERROR = {'tool': 'polynomial_fit', 'metric': 'validation_mse', 'threshold': .02, 'direction': 'above'}
ASYNC_CLIENT = httpx.AsyncClient  # captured before a journey test replaces the service's client
MODELS = {'planner': 'planner-model', 'analyst': 'reviewer-model', 'falsifier': 'falsifier-model'}


class Scripted(DemoAgent):
    """Round 0 opens one branch with the given actions, round 1 stops. Both seats support
    every successful observation with the finding `say(observation)`; `models` gives the
    seats distinct identities so agreement yields provisional support."""

    def __init__(self, actions, *, falsifier_test=FIT_ERROR, say=None, models=MODELS):
        self.actions, self.falsifier_test, self.models = actions, falsifier_test, models
        self.say = say or (lambda observation: 'Consistent with the recorded analysis.')

    def model_for(self, role):
        return (self.models or {}).get(role, self.model)

    async def propose(self, context):
        if context['round'] > 0:
            return {'stop': True, 'reason': 'Scripted stop.'}
        branch = {'id': 'curve', 'title': 'Curved response', 'hypothesis': 'The response needs a quadratic term.',
                  'falsifier': 'Validation error above the stated threshold.', 'parents': []}
        if self.falsifier_test:
            branch['falsifier_test'] = self.falsifier_test
        return {'branches': [branch], 'actions': [{'branch_id': 'curve', **a} for a in self.actions],
                'stop': False, 'reason': 'Test the curve against its falsifier and a null model.'}

    async def assess(self, role, context):
        ok = [o for o in context['observations'] if o['status'] == 'ok']
        return {'assessments': [{'branch_id': 'curve', 'position': 'support', 'evidence_ids': [o['id'] for o in ok],
                                 'finding': self.say(ok[0]) if ok else 'Nothing ran.'}]}


FIT = {'id': 'fit', 'tool': 'polynomial_fit', 'arguments': {'degree': 2}}
NULL = {'id': 'null', 'tool': 'permutation_control', 'arguments': {'permutations': 32}}
DESCRIBE = {'id': 'describe', 'tool': 'describe_data', 'arguments': {}}
READ = {'id': 'read', 'tool': 'literature_search', 'arguments': {'query': 'retraction fixture'}}


def run(agent, *, extra_tools=None, egress=False):
    request = MissionRequest(goal='Ladder fixture', max_rounds=3, allow_egress=egress)
    state = asyncio.run(explore(request, agent, extra_tools=extra_tools))
    assert state.status == 'completed', state.stop_reason
    return request, state


def passing(state):
    replayable = [o for o in state.observations if o.status == 'ok' and o.tool in ('polynomial_fit', 'permutation_control', 'describe_data')]
    return VerificationReceipt(subject_digest=release.subject_digest(state), report_digest='a' * 64, integrity=True,
                               reproduction_passed=True, evidence_graph_valid=True, reproduced=len(replayable),
                               artifacts_reproduced=len(state.artifacts), verified_at=1)


def ladder_of(state, rows=(), verification=None):
    [scoped] = [b for b in state.claim_scope.branches if b.branch_id == 'curve']
    subject = release.subject_digest(state) if verification else None
    return claim_ladder(state, scoped, timeline_rows=list(rows), verification=verification, subject=subject)


def rungs_met(ladder):
    """Every rung whose own conditions all hold, independent of the rungs below it."""
    return [n for n in range(1, 6) if all(code in ladder['met'] for code in RUNGS[n])]


def test_agreement_only_claims_stay_at_or_below_l1_and_agreement_never_raises_a_rung():
    _, agreed = run(Scripted([FIT]))
    _, shared = run(Scripted([FIT], models=None))
    assert agreed.claim_scope.branches[0].status == 'provisionally_supported'
    assert shared.claim_scope.branches[0].status != 'provisionally_supported'
    for state in (agreed, shared):
        ladder = ladder_of(state)
        assert ladder['rung'] <= 1 and ladder['name'] in ('asserted', 'traced')
    # The same evidence under one identity and under two gives the same rung, verified or not.
    assert ladder_of(agreed)['rung'] == ladder_of(shared)['rung'] == 1
    assert ladder_of(agreed, verification=passing(agreed))['rung'] == ladder_of(shared, verification=passing(shared))['rung']
    assert not any('agree' in code or 'consensus' in code for code in ladder_of(agreed)['met'])
    # A claim with no successful observation is asserted, whatever the seats said.
    _, broken = run(Scripted([{'id': 'fit', 'tool': 'polynomial_fit', 'arguments': {'degree': 9}}]))
    ladder = ladder_of(broken)
    assert ladder['rung'] == 0 and ladder['name'] == 'asserted' and 'no_evidence' in ladder['next']['needs']
    assert ladder['density'] == 1 and ladder['verdict'] == 'deferred'


def test_an_unbound_number_fails_l1_and_a_bound_one_passes():
    _, invented = run(Scripted([FIT], say=lambda o: 'Validation error 0.4242 on the split.'))
    ladder = ladder_of(invented, verification=passing(invented))
    assert ladder['rung'] == 0 and ladder['next'] == {'rung': 1, 'needs': ['unbound_number']}
    assert ladder['verdict'] == 'blocked' and ladder['density'] == 1
    _, bound = run(Scripted([FIT], say=lambda o: f"Validation error {o['data']['validation_mse']:.3g} with degree {o['data']['degree']}."))
    ladder = ladder_of(bound)
    assert ladder['rung'] == 1 and 'numbers_bound' in ladder['met'] and ladder['verdict'] == 'qualified'
    assert ladder['next']['rung'] == 2 and ladder['next']['needs'] == ['recomputation_missing']
    # Identifiers are not quantities; a year written as text is still a number to bind.
    assert numbers(['cites 10.1038/nature14539 via https://doi.org/x1.5, PMID 26017442, and IL-6 in 2015']) == ['2015']
    # A timeline row that recorded a failure contradicts the chain: not traced.
    row = {'operation': 'tool', 'action_id': 'fit', 'outcome_source': 'recorded', 'outcome': 'error', 'receipt_id': None}
    assert 'timeline_not_ok' in ladder_of(bound, rows=[row])['next']['needs']


def test_a_number_binds_only_to_the_quantity_it_names_at_close_relative_precision():
    """The recorded fit: validation_mse 0.00404, training_mse 0.00195, degree 2, coefficients
    near 2.0, 0.51 and 1.2. Each sentence below misreports the validation error."""
    misreported = [lambda o: f"Validation error {o['data']['training_mse']:.2g}, far below the threshold.",
                   lambda o: 'Validation error is 2 on the split.', lambda o: 'Validation error 0 on the split.',
                   lambda o: 'Validation error 1 on the split.', lambda o: 'Validation error 0.5 on the split.',
                   lambda o: 'The quadratic cuts error 40x on the split.', lambda o: 'Validation error .4242 on the split.']
    for say in misreported:
        _, state = run(Scripted([FIT], say=say))
        ladder = ladder_of(state, verification=passing(state))
        assert ladder['rung'] == 0 and ladder['next']['needs'] == ['unbound_number'], state.claim_scope.branches[0].supported_scope
    # The named quantity binds at the precision written; a second named value in the sentence binds too.
    _, fine = run(Scripted([FIT], say=lambda o: f"Validation error {o['data']['validation_mse']:.2g}; training error {o['data']['training_mse']:.3g}."))
    assert ladder_of(fine)['rung'] == 1
    # Every digit run is a number to bind: unit suffixes, multipliers and a leading dot included.
    assert numbers(['dose 5mg/kg', 'IC50 of 12nM', 'p=.03', 'a 0.5x cut', 'took 4242ms', 'a 3D fit', 'v1.2.3']) == ['5', '12', '.03', '0.5', '4242']


def epmc_client(records, openalex=OPENALEX, seen=None):
    def handle(request):
        (seen if seen is not None else []).append(str(request.url))
        if request.url.host == 'www.ebi.ac.uk':
            return httpx.Response(200, json={**EUROPEPMC, 'resultList': {'result': records}})
        if request.url.host == 'api.openalex.org' and openalex is not None:
            return httpx.Response(200, json=openalex)
        return httpx.Response(503)
    return ASYNC_CLIENT(transport=httpx.MockTransport(handle))


def read_row(receipt_id='receipt-1'):
    return {'operation': 'tool', 'action_id': 'read', 'outcome_source': 'recorded', 'outcome': 'ok', 'receipt_id': receipt_id}


def granted(call):
    """A retraction guard that lets the OpenAlex call through, as a granted destination does."""
    return call


def reads(records, openalex=OPENALEX, guard=granted):
    return public_tools(epmc_client(records, openalex=openalex), openalex=guard)


WAKEFIELD, LECUN = '10.1016/S0140-6736(97)11096-0', '10.1038/nature14539'


def test_public_reads_check_retractions_only_under_their_own_openalex_guard():
    seen, guarded = [], []

    def guard(call):
        async def run_(dois):
            guarded.append(dois)
            return await call(dois)
        return run_
    tools = public_tools(epmc_client(EUROPEPMC['resultList']['result'], seen=seen), openalex=guard)
    data = asyncio.run(tools['literature_search'][1]({'query': 'retraction fixture'}))
    check = data['retraction_check']
    assert check['source'] == 'OpenAlex' and check['status'] == 'ok' and len(check['response_sha256']) == 64
    assert check['checked'] == ['10.1016/s0140-6736(97)11096-0', '10.1038/nature14539']
    assert check['retracted'] == ['10.1016/s0140-6736(97)11096-0'] and check['unchecked'] == ['PPR000001']
    # The guard saw exactly the DOIs that went to OpenAlex, in one request.
    assert guarded == [['10.1016/s0140-6736(97)11096-0', '10.1038/nature14539']]
    openalex = [url for url in seen if 'api.openalex.org' in url]
    assert len(openalex) == 1 and 'is_retracted' in openalex[0] and 'nature14539' in openalex[0]
    # Without a guard for OpenAlex nothing is sent there and every work stays unchecked.
    seen.clear()
    bare = asyncio.run(public_tools(epmc_client(EUROPEPMC['resultList']['result'], seen=seen))['literature_search'][1]({'query': 'x'}))
    assert not [url for url in seen if 'api.openalex.org' in url]
    assert bare['retraction_check']['status'] == 'not_granted' and len(bare['retraction_check']['unchecked']) == 3
    # A refused grant and an unreachable OpenAlex never fail the search; the check is recorded as not done.
    def refuse(call):
        async def run_(dois):
            raise ValueError('Refused by the grant ledger: no grant')
        return run_
    denied = asyncio.run(reads(EUROPEPMC['resultList']['result'], guard=refuse)['literature_search'][1]({'query': 'x'}))
    assert denied['retraction_check']['status'] == 'error' and 'Refused' in denied['retraction_check']['reason']
    down = asyncio.run(reads(EUROPEPMC['resultList']['result'], openalex=None)['literature_search'][1]({'query': 'x'}))
    assert down['retraction_check']['status'] == 'error' and down['retraction_check']['retracted'] == []


def test_the_preview_asks_for_openalex_as_its_own_public_read_destination(monkeypatch):
    from arc_science import service
    from arc_science.exploration.providers import ModelEndpoint
    monkeypatch.setenv('ARC_PUBLIC_READS', '1')
    seat = ModelEndpoint(provider='openai', endpoint='https://api.openai.com/v1/responses', model='a', credential_ref='planner')
    preview = service.route_preview({'seats': {'planner': seat, 'reviewer': seat, 'falsifier': seat}, 'mcp_servers': [], 'acp_agents': []})
    [openalex] = [g for g in preview['required_grants'] if g['destination'] == 'https://api.openalex.org']
    assert openalex['destination_kind'] == 'public_read' and 'DOI' in openalex['data_category']


def test_a_retracted_citation_blocks_l1():
    records = EUROPEPMC['resultList']['result']
    # A retracted work among the hits is not a citation: a claim citing nothing is traced.
    _, hits = run(Scripted([FIT, READ]), extra_tools=reads(records), egress=True)
    assert [o.status for o in hits.observations] == ['ok', 'ok']
    ladder = ladder_of(hits, rows=[read_row()])
    assert ladder['rung'] == 1 and {'no_retracted_source', 'ledger_receipt'} <= set(ladder['met'])
    # Citing the retracted work, by DOI or by PMID, blocks L1; citing a checked sound work does not.
    for cite in (WAKEFIELD, 'https://doi.org/' + WAKEFIELD.lower(), 'PMID 9500042'):
        _, cited = run(Scripted([FIT, READ], say=lambda o, c=cite: f'Consistent with the cited work {c}.'), extra_tools=reads(records), egress=True)
        ladder = ladder_of(cited, rows=[read_row()], verification=passing(cited))
        assert ladder['rung'] == 0 and 'retracted_source' in ladder['next']['needs'] and ladder['verdict'] == 'blocked', cite
    _, sound = run(Scripted([FIT, READ], say=lambda o: f'Consistent with the cited work ({LECUN}).'), extra_tools=reads(records), egress=True)
    assert ladder_of(sound, rows=[read_row()])['rung'] == 1
    # A cited DOI no read checked is unchecked, even when no literature read ran at all.
    _, uncited = run(Scripted([FIT, NULL], say=lambda o: f'Consistent with the cited work {WAKEFIELD} on the split.'))
    ladder = ladder_of(uncited, verification=passing(uncited))
    assert ladder['rung'] == 0 and ladder['next']['needs'] == ['retraction_unchecked'] and 'no_retracted_source' not in ladder['met']
    _, down = run(Scripted([FIT, READ], say=lambda o: f'Consistent with {LECUN}.'), extra_tools=reads(records, openalex=None), egress=True)
    assert 'retraction_unchecked' in ladder_of(down, rows=[read_row()])['next']['needs']
    # No ledger receipt on the external read: not traced.
    assert 'receipt_missing' in ladder_of(hits, rows=[read_row(None)])['next']['needs']
    # A timeline that records the fit but not the read cannot vouch for the read.
    fit_row = {'operation': 'tool', 'action_id': 'fit', 'round': 0, 'outcome_source': 'recorded', 'outcome': 'ok', 'receipt_id': None}
    assert 'receipt_unchecked' in ladder_of(hits, rows=[fit_row])['next']['needs']


def test_a_pre_retraction_check_read_is_graded_by_the_works_its_claim_cites():
    """A literature read stored before B9 carries no retraction_check. Its claim is traced when
    it cites no work; a cited work was never checked, so that claim stays below L1."""
    records = [r for r in EUROPEPMC['resultList']['result'] if r.get('doi') == LECUN]

    def legacy(state):
        observations = tuple(o.model_copy(update={'data': {k: v for k, v in o.data.items() if k != 'retraction_check'}})
                             for o in state.observations)
        return state.model_copy(update={'observations': observations})
    request, plain = run(Scripted([READ], falsifier_test=None), extra_tools=reads(records), egress=True)
    plain = legacy(plain)
    assert rung_check(release.evaluate_release(request, plain, None, event_chain_ok=True, timeline_rows=[read_row()])).state == 'satisfied'
    request, citing = run(Scripted([READ], falsifier_test=None, say=lambda o: f'Consistent with {LECUN}.'), extra_tools=reads(records), egress=True)
    check = rung_check(release.evaluate_release(request, legacy(citing), None, event_chain_ok=True, timeline_rows=[read_row()]))
    assert check.state == 'unknown' and 'retraction_unchecked' in check.reason


def test_a_severe_test_reaches_l4_and_l5_stays_a_need():
    request, state = run(Scripted([FIT, NULL]))
    ladder = ladder_of(state, verification=passing(state))
    assert ladder['rung'] == 4 and ladder['name'] == 'severe' and ladder['density'] == 5
    assert ladder['next'] == {'rung': 5, 'needs': ['external_replication']} and ladder['verdict'] == 'accepted'
    assert {'numbers_bound', 'recomputed', 'falsifier_prespecified', 'null_rejected', 'falsifier_survived'} <= set(ladder['met'])
    facts = ladder['facts']
    assert facts['null_model']['permutation_bound'] == pytest.approx(1 / 33) and facts['null_model']['alpha'] == .05
    assert facts['null_model']['degree'] == 2 and 'p_value' not in facts['null_model']
    assert facts['falsifier']['refuted'] is False and facts['falsifier']['metric'] == 'validation_mse'
    # Without a replay receipt for the current subject the ladder stops at L1.
    assert ladder_of(state)['rung'] == 1
    stale = passing(state).model_copy(update={'subject_digest': 'b' * 64})
    [scoped] = state.claim_scope.branches
    assert claim_ladder(state, scoped, verification=stale, subject=release.subject_digest(state))['next']['needs'] == ['recomputation_stale']
    # A falsifier the measurement refutes rejects the claim, whatever the seats agreed.
    _, refuted = run(Scripted([FIT, NULL], falsifier_test={**FIT_ERROR, 'threshold': 1e-6}))
    ladder = ladder_of(refuted, verification=passing(refuted))
    assert ladder['rung'] == 3 and 'falsifier_refuted' in ladder['next']['needs'] and ladder['verdict'] == 'rejected'
    # Too few permutations to reach the stated alpha: the null is not rejected.
    _, weak = run(Scripted([FIT, {**NULL, 'arguments': {'permutations': 8}}]))
    assert 'null_not_rejected' in ladder_of(weak, verification=passing(weak))['next']['needs']


def test_the_null_model_compares_only_fits_of_the_degree_the_control_shuffled():
    # permutation_control always refits degree 2 (tools.py); a cubic fit has no matching null.
    _, cubic = run(Scripted([{**FIT, 'arguments': {'degree': 3}}, NULL]))
    ladder = ladder_of(cubic, verification=passing(cubic))
    assert ladder['rung'] == 3 and ladder['next']['needs'] == ['null_model_mismatch'] and ladder['facts']['null_model'] is None
    # A cubic fit beside the quadratic is ignored by the null; the quadratic alone meets it.
    _, both = run(Scripted([FIT, {'id': 'cubic', 'tool': 'polynomial_fit', 'arguments': {'degree': 3}}, NULL]))
    ladder = ladder_of(both, verification=passing(both))
    assert ladder['rung'] == 4 and ladder['facts']['null_model']['worst_fit_validation_mse'] == both.observations[0].data['validation_mse']


def test_a_refuting_observation_stands_when_a_later_one_on_the_branch_survives():
    line = {'id': 'line', 'tool': 'polynomial_fit', 'arguments': {'degree': 1}}
    _, state = run(Scripted([line, FIT, NULL]))
    linear = state.observations[0].data['validation_mse']
    assert linear > FIT_ERROR['threshold'] > state.observations[1].data['validation_mse']
    ladder = ladder_of(state, verification=passing(state))
    assert ladder['verdict'] == 'rejected' and ladder['facts']['falsifier']['refuted'] is True
    assert ladder['facts']['falsifier']['value'] == linear and ladder['rung'] == 3 and 'falsifier_refuted' in ladder['next']['needs']


class Replay(DemoAgent):
    """Round 0 fits on branch 'peek'; round 1 opens 'curve' with a falsifier threshold tuned
    just above the value it saw, and reruns the identical fit under a new id; round 2 stops."""
    models = MODELS

    def model_for(self, role):
        return self.models[role]

    async def propose(self, context):
        if context['round'] == 0:
            return {'branches': [{'id': 'peek', 'title': 'Peek', 'hypothesis': 'Look first.', 'falsifier': 'None.', 'parents': []}],
                    'actions': [{**FIT, 'branch_id': 'peek'}], 'stop': False, 'reason': 'Look.'}
        if context['round'] == 1:
            seen = next(o['data']['validation_mse'] for o in context['observations'] if o['id'] == 'fit')
            branch = {'id': 'curve', 'title': 'Curved response', 'hypothesis': 'The response needs a quadratic term.',
                      'falsifier': 'Validation error above the threshold.', 'parents': [],
                      'falsifier_test': {**FIT_ERROR, 'threshold': seen * 1.01}}
            return {'branches': [branch], 'actions': [{**FIT, 'id': 'fit2', 'branch_id': 'curve'}, {**NULL, 'branch_id': 'curve'}],
                    'stop': False, 'reason': 'Commit after looking.'}
        return {'stop': True, 'reason': 'Done.'}

    async def assess(self, role, context):
        ok = [o['id'] for o in context['observations'] if o['status'] == 'ok' and o['branch_id'] == 'curve']
        return {'assessments': [{'branch_id': 'curve', 'position': 'support', 'evidence_ids': ok, 'finding': 'Consistent.'}] if ok else []}


def test_a_falsifier_committed_after_an_identical_request_was_observed_does_not_reach_l3():
    _, state = run(Replay())
    assert [o.id for o in state.observations] == ['fit', 'fit2', 'null']
    assert state.observations[0].data['validation_mse'] == state.observations[1].data['validation_mse']
    ladder = ladder_of(state, verification=passing(state))
    assert ladder['rung'] == 2 and ladder['next'] == {'rung': 3, 'needs': ['falsifier_after_observation']}


def test_a_falsifier_committed_after_the_observation_does_not_reach_l3():
    _, state = run(Scripted([FIT, NULL]))
    events = list(state.events)
    plan = next(i for i, e in enumerate(events) if e.kind == 'plan_committed')
    moved = events.pop(plan)
    last = max(i for i, e in enumerate(events) if e.kind == 'observation')
    events.insert(last + 1, moved)
    late = state.model_copy(update={'events': tuple(events)})
    ladder = ladder_of(late, verification=passing(late))
    assert ladder['rung'] == 2 and ladder['next'] == {'rung': 3, 'needs': ['falsifier_after_observation']}
    # L4's own conditions still hold: a higher rung never counts past a missing lower one.
    assert 4 in rungs_met(ladder) and ladder['rung'] == 2
    _, missing = run(Scripted([FIT, NULL], falsifier_test=None))
    assert ladder_of(missing, verification=passing(missing))['next'] == {'rung': 3, 'needs': ['falsifier_test_missing']}


def test_rungs_are_monotonic():
    cases = [run(Scripted([FIT]))[1], run(Scripted([FIT, NULL]))[1],
             run(Scripted([FIT], say=lambda o: 'Error 0.4242.'))[1],
             run(Scripted([FIT, NULL], falsifier_test={**FIT_ERROR, 'threshold': 1e-6}))[1]]
    for state in cases:
        for verification in (None, passing(state)):
            ladder = ladder_of(state, verification=verification)
            n = ladder['rung']
            assert ladder['name'] == ('asserted', 'traced', 'recomputed', 'prespecified', 'severe', 'replicated')[n]
            assert set(range(1, n + 1)) <= set(rungs_met(ladder)), ladder
            assert n + 1 not in rungs_met(ladder) or n == 5
            assert ladder['density'] == max(1, min(5, n + 1))


def test_claim_cards_carry_the_ladder_from_the_release_receipt():
    request, state = run(Scripted([FIT, NULL]))
    decision = release.evaluate_release(request, state, passing(state), event_chain_ok=True).model_dump(mode='json')
    [card] = build_claims(state, [], evidence_graph(state), decision)['claims']
    assert card['ladder']['rung'] == 4 and card['ladder'] == ladder_of(state, verification=passing(state))
    [card] = build_claims(state, [], None, None)['claims']
    assert card['ladder']['rung'] == 1


def rung_check(decision):
    return next(c for c in decision.checks if c.name == 'claim_rungs')


def test_release_holds_numeric_claims_to_l2_and_blocks_below_the_minimum():
    request, state = run(Scripted([FIT, NULL]))
    verified = release.evaluate_release(request, state, passing(state), event_chain_ok=True)
    assert rung_check(verified).state == 'satisfied' and verified.eligible_for_human_review
    assert 'claim_rungs' in release.POLICY['checks']
    # Before verification the numeric claim sits at L1: not yet known, and blocking.
    unverified = release.evaluate_release(request, state, None, event_chain_ok=True)
    assert rung_check(unverified).state == 'unknown' and 'claim_rungs:unknown' in unverified.blocking_reasons
    # An unbound number keeps the claim at L0 even after a passing verification.
    request, invented = run(Scripted([FIT], say=lambda o: 'Validation error 0.4242 on the split.'))
    blocked = release.evaluate_release(request, invented, passing(invented), event_chain_ok=True)
    check = rung_check(blocked)
    assert check.state == 'failed' and 'curve' in check.reason and 'unbound_number' in check.reason
    assert blocked.status == 'blocked' and 'claim_rungs:failed' in blocked.blocking_reasons
    with pytest.raises(release.ReleaseBlocked, match='claim_rungs:failed'):
        release.assert_exportable(request, invented.model_copy(update={'release': blocked}), event_chain_ok=True)


def test_release_holds_a_non_numeric_claim_to_l1():
    records = [r for r in EUROPEPMC['resultList']['result'] if r.get('doi') == '10.1038/nature14539']
    request, state = run(Scripted([READ], falsifier_test=None), extra_tools=reads(records), egress=True)
    decision = release.evaluate_release(request, state, None, event_chain_ok=True, timeline_rows=[read_row()])
    assert rung_check(decision).state == 'satisfied', rung_check(decision).reason
    # A read the grant ledger has no receipt for is a defect: the check fails, not merely unknown.
    missing = release.evaluate_release(request, state, None, event_chain_ok=True, timeline_rows=[read_row(None)])
    assert rung_check(missing).state == 'failed' and 'receipt_missing' in rung_check(missing).reason
    # The pure function without a timeline cannot check the receipt; the service always passes one
    # (test_a_granted_literature_read_verifies_and_exports_through_the_service).
    assert rung_check(release.evaluate_release(request, state, None, event_chain_ok=True)).state == 'unknown'


def needs_rasterizer():
    from arc_science.svg_raster import cairo_available
    if not os.environ.get('ARC_SVG2PNG') and not cairo_available():
        pytest.skip('No SVG rasterizer: set ARC_SVG2PNG or install cairosvg to re-render the legacy plots')


def legacy_mission():
    legacy = FIXTURES / 'legacy'
    return (MissionRequest.model_validate_json((legacy / 'completed.request.json').read_text(encoding='utf-8')),
            MissionState.model_validate_json((legacy / 'completed.state.json').read_text(encoding='utf-8')))


def test_legacy_missions_still_load_and_pass_the_rung_check():
    request, state = legacy_mission()
    # The persisted ledger predates claim_rungs and still loads; the current decision adds the check.
    assert 'claim_rungs' not in [c.name for c in state.release.checks]
    decision = release.current_decision(request, state, event_chain_ok=True, timeline_rows=[])
    assert rung_check(decision).state == 'satisfied' and decision.eligible_for_human_review, decision.blocking_reasons
    cards = build_claims(state, [], evidence_graph(state), decision.model_dump(mode='json'))['claims']
    assert [c['ladder']['rung'] for c in cards] == [2, 2, 2]
    assert [c['ladder']['verdict'] for c in cards] == ['rejected', 'revised', 'rejected']


def test_legacy_missions_still_verify_and_pass_the_rung_check():
    from arc_science.exploration.capsule import export_capsule, verify_capsule
    needs_rasterizer()
    request, state = legacy_mission()
    report = verify_capsule(export_capsule(request, state))
    assert report['integrity'] and report['reproduction_passed'], report['failures']
    fresh = release.evaluate_release(request, state, release.receipt_from_report(report, state), event_chain_ok=True, timeline_rows=[])
    assert rung_check(fresh).state == 'satisfied' and fresh.eligible_for_human_review


# A CLI seat for every role: round 0 plans one literature read, the reviews support it with
# the read as evidence, round 1 stops.
READER = r'''
import json, sys
args = sys.argv[1:]
if args[:2] == ['auth', 'status']:
    print(json.dumps({'loggedIn': True, 'authMethod': 'claude.ai'})); sys.exit(0)
if args == ['--version']:
    print('9.9.9'); sys.exit(0)
model = args[args.index('--model') + 1]
request = json.loads(sys.stdin.read())
ctx = request['context']
if request['response_schema'].get('title') == 'Proposal':
    if ctx['observations']:
        text = {'branches': [], 'actions': [], 'stop': True, 'reason': 'done'}
    else:
        text = {'branches': [{'id': 'lit', 'title': 'Literature', 'hypothesis': 'Deep learning is reviewed.', 'falsifier': 'No review.', 'parents': []}],
                'actions': [{'id': 'read', 'branch_id': 'lit', 'tool': 'literature_search', 'arguments': {'query': 'deep learning review'}}],
                'stop': False, 'reason': 'read'}
else:
    ok = [o['id'] for o in ctx['observations'] if o['status'] == 'ok']
    text = {'assessments': [{'branch_id': 'lit', 'position': 'support', 'evidence_ids': ok, 'finding': 'A review of deep learning is on record.'}] if ok else [],
            'summary': 'read'}
print(json.dumps({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': json.dumps(text), 'modelUsage': {model: {}},
                  'usage': {'input_tokens': 1, 'output_tokens': 1}, 'permission_denials': []}))
'''


def test_a_granted_literature_read_verifies_and_exports_through_the_service(tmp_path, stub, monkeypatch):
    """Journey: the operator grants Europe PMC and OpenAlex, the read and its retraction check
    each pass the ledger under their own destination, and verify, the release read, the claim
    card and the capsule export all evaluate the same timeline."""
    import sys
    from fastapi.testclient import TestClient
    from arc_science import service, settings
    from test_settings import AUTH, app, wait_final
    for key in ('ARC_PROVIDER', 'ARC_MODEL', 'ARC_REVIEWER_MODEL', 'ARC_CLAUDE_CODE_EXE', 'ARC_VISION_PROVIDER',
                'ARC_MODEL_TOKEN_FILE', 'ARC_BIORENDER_READS'):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv('ARC_PUBLIC_READS', '1')
    (tmp_path / 'reader.py').write_text(READER, encoding='utf-8')
    monkeypatch.setattr(service, 'claude_code_command', lambda: [sys.executable, str(tmp_path / 'reader.py')])
    records = [r for r in EUROPEPMC['resultList']['result'] if r.get('doi') == LECUN]
    seen = []
    monkeypatch.setattr('arc_science.net.httpx.AsyncClient', lambda **kwargs: epmc_client(records, seen=seen))
    snap = settings.snapshot()
    doc = snap['settings']
    for role in ('planner', 'reviewer', 'falsifier'):
        doc['seats'][role].update(provider='anthropic', model='claude-opus-5', auth='cli')
    doc['providers']['anthropic']['cli'] = 'claude'
    settings.replace(doc, snap['revision'])
    with TestClient(app(tmp_path)) as c:
        preview = c.get('/api/missions/preview', headers=AUTH).json()
        assert ('public_read', 'https://api.openalex.org') in [(g['destination_kind'], g['destination']) for g in preview['required_grants']]
        mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Read', 'mode': 'live', 'max_rounds': 2, 'allow_egress': True}).json()['id']
        started = c.post(f'/api/missions/{mid}/start', headers=AUTH,
                         json={'approved_route_digest': preview['route_digest'], 'grants': preview['required_grants']})
        assert started.status_code == 202, started.text
        state = wait_final(c, mid)['state']
        assert state['status'] == 'completed', state['stop_reason']
        [read] = state['observations']
        assert read['status'] == 'ok' and read['data']['retraction_check']['checked'] == [LECUN]
        receipts = c.get(f'/api/missions/{mid}/grants', headers=AUTH).json()['receipts']
        assert {(r['destination'], r['outcome']) for r in receipts if r['destination_kind'] == 'public_read'} == {
            ('https://www.ebi.ac.uk', 'ok'), ('https://api.openalex.org', 'ok')}
        assert [u for u in seen if 'api.openalex.org' in u]
        verified = c.post(f'/api/missions/{mid}/verify', headers=AUTH)
        assert verified.status_code == 200, verified.text
        decision = verified.json()['release']
        rungs = next(ch for ch in decision['checks'] if ch['name'] == 'claim_rungs')
        assert rungs['state'] == 'satisfied' and decision['status'] == 'eligible_for_human_review', decision['blocking_reasons']
        assert c.get(f'/api/missions/{mid}/release', headers=AUTH).json()['status'] == 'eligible_for_human_review'
        [card] = c.get(f'/api/missions/{mid}/claims', headers=AUTH).json()['claims']
        assert card['ladder']['rung'] >= 1 and 'ledger_receipt' in card['ladder']['met']
        assert c.get(f'/api/missions/{mid}/capsule', headers=AUTH).status_code == 200


# Carried-forward QA findings of B9 (EVIDENCE-MAJ).

def test_a_number_too_large_for_decimal_arithmetic_is_unbound_and_never_raises():
    for said in ('Validation error 1e1000000.', 'Validation error 1e-1000000.'):
        request, state = run(Scripted([FIT], say=lambda o, s=said: s))
        ladder = ladder_of(state, verification=passing(state))
        assert ladder['rung'] == 0 and ladder['next']['needs'] == ['unbound_number'], said
        check = rung_check(release.evaluate_release(request, state, passing(state), event_chain_ok=True))
        assert check.state == 'failed' and 'unbound_number' in check.reason


def test_both_ends_of_a_hyphenated_range_must_bind():
    assert numbers(['validation error 0.01-0.5 across degrees 2-9']) == ['0.01', '0.5', '2', '9']
    # A digit run after a hyphen glued to a letter is still part of a name.
    assert numbers(['IL-6 and COVID-19 in a β-2 fit']) == []
    # After a quantity word the hyphen joins the word to its value: it is checked.
    assert list(_tokens('a degree-2 fit')) == [('2', ('degree',))]
    _, state = run(Scripted([FIT], say=lambda o: f"Validation error {o['data']['validation_mse']:.2g}-0.9 on the split."))
    assert ladder_of(state)['next']['needs'] == ['unbound_number']
    # The upper end names the same quantity as the lower end, so a true range binds.
    _, state = run(Scripted([FIT], say=lambda o: f"Validation error {o['data']['validation_mse']:.2g}-{o['data']['validation_mse']:.3g} at degree 2."))
    assert ladder_of(state)['rung'] == 1
    # A lower end with an ordinal or multiplier suffix still has its upper end checked.
    assert numbers(['The 2nd-9th degree fits', 'degrees 2x-9x', 'a 0.004x-0.9x error']) == ['2', '9', '2', '9', '0.004', '0.9']
    _, state = run(Scripted([FIT], say=lambda o: 'The 2nd-9th degree fits were tried.'))
    assert ladder_of(state)['next']['needs'] == ['unbound_number']


def test_a_quantity_named_after_the_number_or_not_recorded_never_binds_elsewhere():
    """The recorded fit: validation_mse 0.00404, training_mse 0.00195, degree 2, n_validation 16."""
    misreported = [lambda o: 'The fit reached 2 in validation error.',
                   lambda o: f"The quadratic reached {o['data']['training_mse']:.3g} validation error.",
                   lambda o: f"R-squared of {o['data']['validation_mse']:.3g} on the split.",
                   lambda o: f"Accuracy {o['data']['n_validation']} on the split.",
                   lambda o: '2 is the validation error.']
    for say in misreported:
        _, state = run(Scripted([FIT], say=say))
        ladder = ladder_of(state, verification=passing(state))
        assert ladder['rung'] == 0 and ladder['next']['needs'] == ['unbound_number'], state.claim_scope.branches[0].supported_scope
    # A name after the number binds it, and a plural names the same field.
    _, fine = run(Scripted([FIT], say=lambda o: f"It reached {o['data']['validation_mse']:.2g} validation error at 2 degrees."))
    assert ladder_of(fine)['rung'] == 1


def slow_openalex_client(records):
    async def handle(request):
        if request.url.host == 'www.ebi.ac.uk':
            return httpx.Response(200, json={**EUROPEPMC, 'resultList': {'result': records}})
        await asyncio.sleep(3600)
    return ASYNC_CLIENT(transport=httpx.MockTransport(handle))


def test_a_slow_openalex_lookup_keeps_the_search_inside_the_tool_deadline_and_leaves_a_receipt(monkeypatch):
    from arc_science.exploration import public_reads
    monkeypatch.setattr(public_reads, 'OPENALEX_SECONDS', .2, raising=False)
    receipts = []

    def guard(call):
        """The service guard: a call that raises leaves a failed receipt, one that returns an ok one."""
        async def run_(dois):
            try:
                result = await call(dois)
            except Exception:
                receipts.append('failed')
                raise
            receipts.append('ok')
            return result
        return run_
    records = EUROPEPMC['resultList']['result']
    search = public_tools(slow_openalex_client(records), openalex=guard)['literature_search'][1]
    data = asyncio.run(asyncio.wait_for(search({'query': 'x'}), 2))
    assert len(data['records']) == len(records) and receipts == ['failed']
    assert data['retraction_check']['status'] == 'error' and data['retraction_check']['retracted'] == []
    # engine.py gives an external tool 30 s in all; both reads together stay inside it.
    monkeypatch.undo()
    assert public_reads.EUROPE_PMC_SECONDS + public_reads.OPENALEX_SECONDS < 30


def test_a_read_older_than_the_mission_timeline_is_legacy_and_a_lost_timeline_is_unchecked():
    """Public reads ran from 2026-09-08; grant-ledger receipts came on 2026-09-21. Only the
    mission's own hash-chained record can show that a read is that old: a resume it declared
    before receipts existed, after the read. The timeline alone cannot: a lost timeline comes
    back empty, then gains the round-less interrupt row of a restart and a later resume row."""
    from arc_science.exploration.changes import declare_resume
    from arc_science.exploration.validation import RECEIPTS_FROM
    records = [r for r in EUROPEPMC['resultList']['result'] if r.get('doi') == LECUN]
    request, state = run(Scripted([READ], falsifier_test=None), extra_tools=reads(records), egress=True)
    resumed = [{'operation': 'resume', 'round': 1, 'outcome_source': 'recorded', 'outcome': 'resumed'},
               {'operation': 'plan', 'round': 1, 'outcome_source': 'recorded', 'outcome': 'ok'}]
    legacy, _ = declare_resume(state, ('analysis', 'claim'), 'Resumed before receipts.', at=RECEIPTS_FROM - 1)
    ladder = ladder_of(legacy, rows=resumed)
    assert ladder['rung'] == 1 and 'receipt_predates_timeline' in ladder['met'] and 'ledger_receipt' not in ladder['met']
    assert rung_check(release.evaluate_release(request, legacy, None, event_chain_ok=True, timeline_rows=resumed)).state == 'satisfied'
    # A deleted or recreated timeline is no evidence that the read is old: empty, holding only the
    # round-less interrupt row the service writes at startup, or that row and a later resume.
    interrupt = {'operation': 'interrupt', 'round': None, 'outcome_source': 'recorded', 'outcome': 'interrupted'}
    for rows in ([], [interrupt], [interrupt, resumed[0]], resumed):
        assert ladder_of(state, rows=rows)['next']['needs'] == ['receipt_unchecked'], rows
        assert rung_check(release.evaluate_release(request, state, None, event_chain_ok=True, timeline_rows=rows)).state != 'satisfied'
    # A resume declared once receipts existed, or declared before the read ran, proves no such age.
    late, _ = declare_resume(state, ('analysis', 'claim'), 'Resumed after receipts.', at=RECEIPTS_FROM)
    assert ladder_of(late, rows=resumed)['next']['needs'] == ['receipt_unchecked']
    events = list(legacy.events)
    events.insert(0, events.pop())
    early = legacy.model_copy(update={'events': tuple(events)})
    assert ladder_of(early, rows=resumed)['next']['needs'] == ['receipt_unchecked']
    # A timeline row at or before the read's round shows the timeline was recording then.
    plan = {'operation': 'plan', 'round': 0, 'outcome_source': 'recorded', 'outcome': 'ok'}
    other = {'operation': 'tool', 'action_id': 'other', 'round': 1, 'outcome_source': 'recorded', 'outcome': 'ok', 'receipt_id': None}
    for rows in ([plan, other], [{**other, 'round': 0}]):
        assert ladder_of(state, rows=rows)['next']['needs'] == ['receipt_unchecked']
        assert ladder_of(legacy, rows=rows)['next']['needs'] == ['receipt_unchecked']


def test_a_range_is_one_quantity_named_before_or_after_it_spaced_or_not():
    for text in ('0.03-0.05 validation error', 'validation error 0.03 - 0.05', '0.03 – 0.05 validation error.'):
        assert [names for _, names in _tokens(text)] == [('validation_mse',)] * 2, text
    for form in ('{v}-{v} validation error across folds.', 'Validation error {v} - {v} on the split.'):
        _, state = run(Scripted([FIT], say=lambda o, f=form: f.format(v=f"{o['data']['validation_mse']:.3g}")))
        assert ladder_of(state)['rung'] == 1, form
    _, state = run(Scripted([FIT], say=lambda o: f"{o['data']['validation_mse']:.3g}-0.9 validation error."))
    assert ladder_of(state)['next']['needs'] == ['unbound_number']


def test_a_name_with_a_greek_or_cyrillic_letter_before_a_hyphen_is_not_a_number():
    assert numbers(['ИЛ-6 was high', 'β-2 adrenergic receptor', 'α-1 antitrypsin']) == []
    _, state = run(Scripted([FIT], say=lambda o: 'Consistent with β-2 adrenergic signalling.'))
    assert ladder_of(state)['rung'] == 1


def test_an_abbreviation_does_not_end_the_sentence_that_names_a_number():
    for text, number in (('validation MSE approx. 0.03', '0.03'), ('validation MSE of ca. 0.004 on the split', '0.004'),
                         ('validation MSE vs. 0.03', '0.03'), ('validation error, e.g. 0.03', '0.03')):
        assert list(_tokens(text)) == [(number, ('validation_mse',))], text
    # A sentence that ends still takes its name with it.
    assert [names for _, names in _tokens('Validation error was low. The fit took 3 rounds.')] == [None]
    _, state = run(Scripted([FIT], say=lambda o: f"Validation MSE approx. {o['data']['validation_mse']:.3g} on the split."))
    assert ladder_of(state)['rung'] == 1


def test_a_nearer_unrecorded_quantity_keeps_a_farther_recorded_name_from_binding():
    for text in ('Validation error improved with accuracy 0.00404.', 'Validation error fell as R-squared reached 0.00404.',
                 'Validation error, AUC 0.00404.', 'Validation error and RMSE of 0.00404.',
                 'Validation error fell as R² reached 0.00404.', 'Validation error fell as R^2 reached 0.00404.',
                 'Validation error fell; the coefficient of determination was 0.00404',
                 'Root mean squared error 0.00404 on the split.', 'Root-mean-square error 0.00404 on the split.',
                 'Mean absolute error of 0.00404.', 'Standard error of 0.00404.', 'Relative error 0.00404 on the split.',
                 'Mean absolute percentage error 0.00404.', 'Pearson r of 0.00404 with the validation error',
                 "Spearman's rho 0.00404 against the validation error", 'Validation error tracked r = 0.00404.',
                 'Validation error improved with 0.00404 accuracy.'):
        assert [names for _, names in _tokens(text)] == [()], text
    for say in (lambda o: f"Validation error improved with accuracy {o['data']['validation_mse']:.3g}.",
                lambda o: f"Validation error fell as R² reached {o['data']['validation_mse']:.3g}.",
                lambda o: f"Root mean squared error {o['data']['validation_mse']:.3g} on the split."):
        _, state = run(Scripted([FIT], say=say))
        assert ladder_of(state)['next']['needs'] == ['unbound_number']
    # Plain MSE is recorded, spelled out or not, and keeps its validation qualifier.
    assert [names for _, names in _tokens('Validation mean squared error 0.00404.')] == [('validation_mse',)]


def test_a_quantity_word_names_one_number_and_never_crosses_to_its_neighbour():
    """A name after a number binds it only when nothing before it names it, and a name taken
    by one number is not the name of the next."""
    for text in ('Validation error approximately 0.00195, training error approximately 0.00195.',
                 'Validation error approximately 0.00195 and training error approximately 0.00195.'):
        assert [names for _, names in _tokens(text)] == [('validation_mse',), ('training_mse',)], text
    assert [names for _, names in _tokens('It reached 0.004 validation error at 2 degrees.')] == [('validation_mse',), ('degree',)]
    assert [names for _, names in _tokens('0.004 validation error and 0.9 accuracy.')] == [('validation_mse',), ()]
    # An unrecorded name nearer the next number names that one and leaves this one its own.
    assert [names for _, names in _tokens('Validation error approximately 0.004 with R2 0.9.')] == [('validation_mse',), ()]
    _, state = run(Scripted([FIT], say=lambda o: f"Validation error approximately {o['data']['training_mse']:.3g}, "
                                                  f"training error approximately {o['data']['training_mse']:.3g}."))
    assert ladder_of(state)['next']['needs'] == ['unbound_number']
    _, state = run(Scripted([FIT], say=lambda o: f"Validation error approximately {o['data']['validation_mse']:.3g}, "
                                                  f"training error approximately {o['data']['training_mse']:.3g}."))
    assert ladder_of(state)['rung'] == 1


def test_a_number_too_small_or_large_for_decimal_arithmetic_never_binds():
    assert not _binds('1e-1000027', [0.0]) and not _binds('1e-1000027', [0]) and not _binds('1e1000000', [1.0])
    assert _binds('0.004', [0.00404]) and not _binds('1e-5', [0.0])


def test_any_retracted_record_of_a_doi_wins_over_a_duplicate_that_is_not():
    records = EUROPEPMC['resultList']['result']
    duplicated = {'results': [{'doi': 'https://doi.org/' + WAKEFIELD.lower(), 'is_retracted': True},
                              {'doi': 'https://doi.org/' + WAKEFIELD.lower(), 'is_retracted': False},
                              {'doi': 'https://doi.org/' + LECUN, 'is_retracted': False}]}
    data = asyncio.run(reads(records, openalex=duplicated)['literature_search'][1]({'query': 'x'}))
    assert data['retraction_check']['retracted'] == [WAKEFIELD.lower()]
    _, cited = run(Scripted([FIT, READ], say=lambda o: f'Consistent with {WAKEFIELD}.'), extra_tools=reads(records, openalex=duplicated), egress=True)
    assert 'retracted_source' in ladder_of(cited, rows=[read_row()])['next']['needs']


def test_a_doi_cited_in_brackets_or_quotes_matches_the_checked_doi():
    records = EUROPEPMC['resultList']['result']
    for cite in (f'[{WAKEFIELD}]', f'"{WAKEFIELD}"', f'({WAKEFIELD})', f'“{WAKEFIELD}”'):
        _, cited = run(Scripted([FIT, READ], say=lambda o, c=cite: f'Consistent with the cited work {c}.'), extra_tools=reads(records), egress=True)
        ladder = ladder_of(cited, rows=[read_row()], verification=passing(cited))
        assert 'retracted_source' in ladder['next']['needs'] and ladder['verdict'] == 'blocked', cite
    _, sound = run(Scripted([FIT, READ], say=lambda o: f'Consistent with [{LECUN}].'), extra_tools=reads(records), egress=True)
    assert ladder_of(sound, rows=[read_row()])['rung'] == 1


def test_the_null_is_rejected_only_when_no_control_on_the_branch_beats_the_fit():
    big, small = {**NULL, 'id': 'big', 'arguments': {'permutations': 128}}, {**NULL, 'id': 'small', 'arguments': {'permutations': 19}}
    _, state = run(Scripted([FIT, big, small]))
    fit = state.observations[0].data['validation_mse']
    beaten = tuple(o.model_copy(update={'data': {**o.data, 'minimum_shuffled_validation_mse': fit / 2}}) if o.id == 'big' else o
                   for o in state.observations)
    adverse = state.model_copy(update={'observations': beaten})
    ladder = ladder_of(adverse, verification=passing(adverse))
    assert 'null_not_rejected' in ladder['next']['needs'] and ladder['verdict'] != 'accepted'
    assert ladder['facts']['null_model']['minimum_shuffled_validation_mse'] == fit / 2
    # A control too small to reach alpha does not undo one that rejected the null.
    _, pair = run(Scripted([FIT, NULL, {**NULL, 'id': 'few', 'arguments': {'permutations': 8}}]))
    ladder = ladder_of(pair, verification=passing(pair))
    assert ladder['rung'] == 4 and ladder['facts']['null_model']['permutation_bound'] == pytest.approx(1 / 33)
    # A control on the branch that the claim leaves out of its evidence still counts.
    [scoped] = adverse.claim_scope.branches
    hidden = scoped.model_copy(update={'evidence_ids': tuple(i for i in scoped.evidence_ids if i != 'big')})
    ladder = claim_ladder(adverse, hidden, timeline_rows=[], verification=passing(adverse), subject=release.subject_digest(adverse))
    assert 'null_not_rejected' in ladder['next']['needs']


class ControlFirst(Replay):
    """Round 0 runs the permutation control on branch 'peek'; round 1 opens 'curve' with its
    falsifier and runs a fresh fit beside a rerun of the control, with `rerun` shuffles."""

    def __init__(self, peek=32, rerun=32):
        self.peek, self.rerun = peek, rerun

    async def propose(self, context):
        if context['round'] == 0:
            return {'branches': [{'id': 'peek', 'title': 'Peek', 'hypothesis': 'Look first.', 'falsifier': 'None.', 'parents': []}],
                    'actions': [{**NULL, 'branch_id': 'peek', 'arguments': {'permutations': self.peek}}], 'stop': False, 'reason': 'Look.'}
        if context['round'] == 1:
            branch = {'id': 'curve', 'title': 'Curved response', 'hypothesis': 'The response needs a quadratic term.',
                      'falsifier': 'Validation error above the threshold.', 'parents': [], 'falsifier_test': FIT_ERROR}
            return {'branches': [branch], 'actions': [{**FIT, 'branch_id': 'curve'},
                                                      {**NULL, 'id': 'null2', 'branch_id': 'curve', 'arguments': {'permutations': self.rerun}}],
                    'stop': False, 'reason': 'Commit after looking at the null.'}
        return {'stop': True, 'reason': 'Done.'}


@pytest.mark.parametrize('peek,rerun', [(32, 32), (32, 33), (127, 128), (128, 127)])
def test_the_controls_the_null_uses_must_be_prespecified_whether_the_claim_cites_them_or_not(peek, rerun):
    """permutation_control draws its shuffles in sequence from one fixed seed, so a control
    with fewer shuffles is the first part of a larger one: a peek at any size shows the
    planner the statistic a later control of another size reports."""
    _, state = run(ControlFirst(peek, rerun))
    [scoped] = [b for b in state.claim_scope.branches if b.branch_id == 'curve']
    assert set(scoped.evidence_ids) == {'fit', 'null2'}
    for evidence_ids in (('fit', 'null2'), ('fit',)):
        cited = scoped.model_copy(update={'evidence_ids': evidence_ids})
        ladder = claim_ladder(state, cited, timeline_rows=[], verification=passing(state), subject=release.subject_digest(state))
        assert 'null_rejected' in ladder['met'], evidence_ids
        assert ladder['rung'] == 2 and ladder['next'] == {'rung': 3, 'needs': ['falsifier_after_observation']}, evidence_ids


# Carried-forward QA findings of EVIDENCE-MAJ.

def test_every_form_of_an_unrecorded_statistic_keeps_a_recorded_name_off():
    for text in ('Validation error, r \u2265 0.9', 'Validation error tracked r ~ 0.004.', 'Validation error tracked r of 0.004.',
                 'Validation error tracked r: 0.004.', 'Validation error correlated with x at r 0.00404.',
                 'Validation error, p \u2265 0.004.', 'Validation error, p \u2248 0.004.',
                 'Validation RMS error 0.00404 on the split.', 'Relative validation error 0.00404 on the split.',
                 'Percentage validation error 0.00404 on the split.', 'Normalized validation error 0.00404.',
                 'Validation error, SD 0.00404.', 'Validation error, SEM 0.00404.', 'Validation error, SE 0.00404.',
                 'Validation error and RMSD 0.00404.', 'Validation error and NRMSE 0.00404.'):
        assert [names for _, names in _tokens(text)] == [()], text
    _, state = run(Scripted([FIT], say=lambda o: f"Validation RMS error {o['data']['validation_mse']:.3g} on the split."))
    assert ladder_of(state)['next']['needs'] == ['unbound_number']


def test_a_spelled_out_or_set_qualified_validation_error_binds_only_the_validation_field():
    for text in ('Validation mean squared error 0.00195 on the split.', 'Held-out mean squared error 0.00195 on the split.',
                 'Validation-set error 0.00195.', 'Validation set MSE 0.00195.', 'Error on the validation split was 0.00195.'):
        assert [names for _, names in _tokens(text)] == [('validation_mse',)], text
    assert [names for _, names in _tokens('Training mean squared error 0.00195.')] == [('training_mse',)]
    _, state = run(Scripted([FIT], say=lambda o: f"Validation mean squared error {o['data']['training_mse']:.3g} on the split."))
    assert ladder_of(state)['next']['needs'] == ['unbound_number']
    _, state = run(Scripted([FIT], say=lambda o: f"Held-out mean squared error {o['data']['validation_mse']:.3g} on the split."))
    assert ladder_of(state)['rung'] == 1


def test_a_value_hyphenated_to_its_quantity_word_is_checked():
    for say in (lambda o: f"The degree-3 fit reached validation error {o['data']['validation_mse']:.3g}.",
                lambda o: 'Validation MSE-0.9 on the split.'):
        _, state = run(Scripted([FIT], say=say))
        assert ladder_of(state)['next']['needs'] == ['unbound_number']
    _, state = run(Scripted([FIT], say=lambda o: f"The degree-2 fit reached validation error {o['data']['validation_mse']:.3g}."))
    assert ladder_of(state)['rung'] == 1


def test_only_the_r_squared_exponent_is_exempt_from_binding():
    assert numbers(['R^2 and r^2 of the fit']) == [] and numbers(['Degree 2^9.']) == ['2', '9']
    assert numbers(['The fit scales as r^9.']) == ['9']
    # A superscript exponent is the same power as a caret one; only R\u00b2 is exempt.
    assert numbers(['R\u00b2 and r\u00b2 of the fit']) == [] and numbers(['The response grows as x\u2079.']) == ['9']
    assert numbers(['A x\u00b9\u2070 term']) == ['10'] and numbers(['A x\u207b\u00b9 term']) == ['-1']
    for say in (lambda o: 'Degree 2^9.', lambda o: 'The fit scales as r^9.', lambda o: 'The fit scales as x^9.',
                lambda o: 'The response grows as x\u2079.', lambda o: 'The response grows as x\u00b3.'):
        _, state = run(Scripted([FIT], say=say))
        assert ladder_of(state)['next']['needs'] == ['unbound_number']
    _, state = run(Scripted([FIT], say=lambda o: f"Adding x\u00b2 lowered the validation error to {o['data']['validation_mse']:.3g}."))
    assert ladder_of(state)['rung'] == 1


def test_the_power_of_a_variable_names_a_term_of_the_fit_and_takes_no_other_name():
    """x^2 is a term of every fit of degree 2 or more; its 2 never takes the name of the value next to it."""
    assert ('0.004', ('validation_mse',)) in list(_tokens('Adding x^2 lowered the validation error to 0.004.'))
    for text in ('Adding x^2 lowered the validation error to {v}.', 'Adding an x^2 term gave validation error {v}.',
                 'Validation error {v} with the x^2 term.'):
        _, state = run(Scripted([FIT], say=lambda o: text.format(v=f"{o['data']['validation_mse']:.3g}")))
        assert ladder_of(state)['rung'] == 1, text


# Fix round 1 of TRACKS-MAJ: every statistic binds only to what it names.

def test_every_written_form_of_an_unrecorded_statistic_keeps_the_recorded_name_off():
    for written in ('p-value: ', 'p value ', 'p of ', 'p ', 'std ', 'IQR ', 'q-value ', 'FDR ', 'adjusted p ', 'padj ',
                    't = ', 'z-score ', 'effect size ', 'standard error of the validation error ',
                    't ', 't of ', 'z ', 'z of ', 'Z ', 't-value ', 'z-value ', 'q: ', 'q ', 'q of '):
        text = f'Validation error, {written}0.004.'
        assert [names for _, names in _tokens(text)] == [()], text
    for text in ('Validation median error 0.002.', 'Validation log loss 0.002.', 'Validation cross-entropy loss 0.002.'):
        assert [names for _, names in _tokens(text)] == [()], text
    for say in (lambda o: f"Validation error, p-value: {o['data']['validation_mse']:.3g}.",
                lambda o: f"Validation error, std {o['data']['validation_mse']:.3g}.",
                lambda o: f"Validation median error {o['data']['training_mse']:.3g}.",
                lambda o: f"Validation error, t {o['data']['validation_mse']:.3g}.",
                lambda o: f"Validation error, z of {o['data']['validation_mse']:.3g}."):
        _, state = run(Scripted([FIT], say=say))
        assert ladder_of(state)['next']['needs'] == ['unbound_number']


def test_a_statistic_of_an_error_keeps_the_recorded_name_off_whatever_stands_between():
    assert list(_tokens('Standard error of the degree-2 validation error: 0.00404.')) == [('2', ('degree',)), ('0.00404', ())]
    for text in ("The standard deviation of the quadratic fit's validation error is 0.00404.",
                 'Standard error (validation error) 0.00404.', 'Standard error of the validation-set mean squared error 0.00404.',
                 'The SD of the validation error across folds, 0.00404.'):
        assert [names for _, names in _tokens(text)] == [()], text
    v = lambda o: f"{o['data']['validation_mse']:.3g}"
    for say in (lambda o: f'Standard error of the degree-2 validation error: {v(o)}.',
                lambda o: f"The standard deviation of the quadratic fit's validation error is {v(o)}."):
        _, state = run(Scripted([FIT], say=say))
        assert ladder_of(state)['next']['needs'] == ['unbound_number']
    # A statistic in another clause does not name the error.
    _, state = run(Scripted([FIT], say=lambda o: f'The standard error of x was small, and the validation error was {v(o)}.'))
    assert ladder_of(state)['rung'] == 1


def test_a_value_hyphenated_to_an_unrecorded_statistic_is_checked_and_binds_nothing():
    for text in ('Validation error, RMSE-0.3.', 'Validation error, accuracy-0.99.', 'Validation error, AUC-0.9.',
                 'Validation error, r-squared-0.9.', 'Validation error with p-0.001.', 'Validation error, q-0.01.',
                 'Validation error, t-2.1.', 'Validation error, z-2.1.'):
        assert [names for _, names in _tokens(text)] == [()], text
    assert numbers(['IL-6 and COVID-19 in a β-2 fit']) == []
    v = lambda o: f"{o['data']['validation_mse']:.3g}"
    for say in (lambda o: f'Validation error {v(o)} with RMSE-0.3 on the split.', lambda o: f'Validation error {v(o)}, accuracy-0.99.',
                lambda o: f'Validation error {v(o)} with p-0.001.', lambda o: f'Validation error {v(o)} on n-500 samples.',
                lambda o: f'Validation error {v(o)}, q-0.01.', lambda o: f'Validation error {v(o)}, t-2.1.',
                lambda o: f'Validation error {v(o)}, z-2.1.'):
        _, state = run(Scripted([FIT], say=say))
        assert ladder_of(state)['next']['needs'] == ['unbound_number']


def test_a_recorded_count_binds_through_its_own_name():
    for say in (lambda o: f"The validation set has {o['data']['n_validation']} samples.",
                lambda o: f"Validation samples: {o['data']['n_validation']}.",
                lambda o: f"Training used {o['data']['n_train']} samples.",
                lambda o: f"The fit used {o['data']['n_train']} training samples and {o['data']['n_validation']} validation samples."):
        _, state = run(Scripted([FIT], say=say))
        assert ladder_of(state)['rung'] == 1
    # A count of the other split, or one no split names, binds nothing.
    for say in (lambda o: 'The validation set has 17 samples.',
                lambda o: f"The validation set has {o['data']['n_train']} samples.",
                lambda o: f"The training set has {o['data']['n_validation']} samples.",
                lambda o: f"Training used {o['data']['n_validation']} samples.",
                lambda o: f"The fit used {o['data']['n_validation']} samples."):
        _, state = run(Scripted([FIT], say=say))
        assert ladder_of(state)['next']['needs'] == ['unbound_number']
    # The split may be named after the count word, or between the number and a later count word.
    assert list(_tokens('Training error 0.1 and 500 samples in validation')) == [('0.1', ('training_mse',)), ('500', ('n_validation',))]
    total = lambda o: o['data']['n_train'] + o['data']['n_validation']
    for say in (lambda o: f"{total(o)} samples were in the validation set.",
                lambda o: f"n = {total(o)} validation samples were used.",
                lambda o: f"{total(o)} samples of the training data were used."):
        _, state = run(Scripted([FIT, DESCRIBE], say=say))
        assert ladder_of(state)['next']['needs'] == ['unbound_number']
    for say in (lambda o: f"{o['data']['n_validation']} samples were in the validation set.",
                lambda o: f"n = {o['data']['n_validation']} validation samples were used.",
                lambda o: f"{total(o)} samples and the validation error {o['data']['validation_mse']:.3g}."):
        _, state = run(Scripted([FIT, DESCRIBE], say=say))
        assert ladder_of(state)['rung'] == 1


# Residual TRACKS-MAJ findings: statistics of errors, R squared, bare letters and sample counts.

def test_a_statistic_of_an_error_is_found_across_words_commas_plurals_and_its_abbreviation():
    for text in ('The SD across folds of the validation error was 0.00404.',
                 'The standard error, over five folds, of the validation error was 0.00404.',
                 'Standard error of the validation errors 0.00404.', 'Standard error across folds of the validation error: 0.00404.',
                 'S.E. of validation error 0.00404.', 'The standard error estimated by bootstrap for the validation error is 0.00404.',
                 'The variance of, specifically, validation error is 0.00404.'):
        assert [names for _, names in _tokens(text)] == [()], text
    v = lambda o: f"{o['data']['validation_mse']:.3g}"
    for say in (lambda o: f'The SD across folds of the validation error was {v(o)}.',
                lambda o: f'The standard error, over five folds, of the validation error was {v(o)}.'):
        _, state = run(Scripted([FIT], say=say))
        assert ladder_of(state)['next']['needs'] == ['unbound_number']


LINEAR = {'id': 'fit', 'tool': 'polynomial_fit', 'arguments': {'degree': 1}}


def test_only_a_standalone_r_squared_is_exempt_from_the_power_check():
    for text in ('The response grows as diameter².', 'The response grows as power^2.', 'Order² terms.'):
        assert numbers([text]) == ['2'], text
    assert numbers(['R² and r^2 of the fit, (R²)']) == []
    v = lambda o: f"{o['data']['validation_mse']:.3g}"
    _, state = run(Scripted([LINEAR], say=lambda o: f'The response grows as diameter²; validation error {v(o)}.'))
    assert ladder_of(state)['next']['needs'] == ['unbound_number']


def test_a_lone_letter_before_a_verb_test_or_parenthesis_names_an_unrecorded_statistic():
    for written in ('t was ', 't is ', 't equals ', 'p was ', 'z is ', 't test ', 'z test ', 't (', 't statistic '):
        text = f'Validation error, {written}0.004.'
        assert [names for _, names in _tokens(text)] == [()], text
    _, state = run(Scripted([FIT], say=lambda o: f"Validation error, t was {o['data']['validation_mse']:.3g}."))
    assert ladder_of(state)['next']['needs'] == ['unbound_number']


def test_a_count_takes_the_split_its_sentence_names_and_never_falls_back_to_the_total():
    total = lambda o: o['data']['n_train'] + o['data']['n_validation']
    v = lambda o: f"{o['data']['validation_mse']:.3g}"
    for later in ('were later reserved for validation', 'went to the validation set', 'were put into the validation set',
                  'were actually used in the validation set', 'were assigned to the validation set', 'were used for testing',
                  'were held out'):
        _, state = run(Scripted([FIT, DESCRIBE], say=lambda o: f'{total(o)} samples {later}.'))
        assert ladder_of(state)['next']['needs'] == ['unbound_number'], later
        _, state = run(Scripted([FIT, DESCRIBE], say=lambda o: f"{o['data']['n_validation']} samples {later}."))
        assert ladder_of(state)['rung'] == 1, later
    for say in (lambda o: f'Validation error {v(o)} on {total(o)} samples.', lambda o: f'n = {total(o)} (validation).',
                lambda o: f'{total(o)} samples, drawn from the validation set.'):
        _, state = run(Scripted([FIT, DESCRIBE], say=say))
        assert ladder_of(state)['next']['needs'] == ['unbound_number']
    # A count named before it keeps its own split; an explicit count word wins over an earlier metric.
    assert [names for _, names in _tokens('The validation samples were 48 and training samples 48.')] == [
        ('n_validation',), ('n_train',)]
    assert list(_tokens('The fit reduced validation error using 48 training samples.')) == [('48', ('n_train',))]
    _, state = run(Scripted([FIT], say=lambda o: f"The fit reduced validation error using {o['data']['n_train']} training samples."))
    assert ladder_of(state)['rung'] == 1


# Integration fix round 1: counts, statistics of errors, units, mean and minimum, PubMed links, prior results.

def test_a_count_keeps_the_split_named_before_it_over_one_later_in_its_sentence():
    for text in ('The model was trained on 48 samples and then scored on the held-out test set.',
                 'Training used 48 samples, which is small relative to the test set.',
                 'The training set had 48 samples and we then moved on to the validation checks.'):
        assert list(_tokens(text)) == [('48', ('n_train',))], text
    assert list(_tokens('The model was trained on 16 samples and then scored on the held-out test set.')) == [('16', ('n_train',))]
    # A split named after a later number belongs to that number, not to the total before it.
    assert list(_tokens('Of 64 samples, 48 went to training.'))[0] == ('64', ('n',))
    for field, rung in (('n_train', 1), ('n_validation', 0)):
        _, state = run(Scripted([FIT], say=lambda o, f=field: f"The model was trained on {o['data'][f]} samples and then scored "
                                                              'on the held-out test set.'))
        assert ladder_of(state)['rung'] == rung, field


def test_a_statistic_in_an_earlier_clause_does_not_claim_a_later_error():
    for text in ('The CI for degree 2 excluded zero, validation error 0.12.',
                 'With SE reported for each fold in the appendix, the validation error fell to 0.12.'):
        assert [names for _, names in _tokens(text)][-1] == ('validation_mse',), text
    v = lambda o: f"{o['data']['validation_mse']:.3g}"
    _, state = run(Scripted([FIT], say=lambda o: f'With SE reported for each fold in the appendix, the validation error fell to {v(o)}.'))
    assert ladder_of(state)['rung'] == 1


def test_a_number_with_a_unit_or_multiplier_never_binds_a_unitless_record():
    assert list(_tokens('The validation MSE was 0.0017%.')) == [('0.0017', None)]
    assert list(_tokens('The model used 48k training samples.')) == [('48', None)]
    # An ordinal is not a unit: a 2nd-degree fit still names its degree.
    assert list(_tokens('A 2nd-degree fit.')) == [('2', ('degree',))]
    v = lambda o: f"{o['data']['validation_mse']:.3g}"
    for say in (lambda o: f'The validation MSE was {v(o)}%.', lambda o: f"The model used {o['data']['n_train']}k training samples."):
        _, state = run(Scripted([FIT], say=say))
        assert ladder_of(state)['next']['needs'] == ['unbound_number']


def test_a_mean_or_minimum_shuffled_error_binds_only_its_own_statistic():
    assert list(_tokens('Mean shuffled validation error was 1.21814')) == [('1.21814', ('mean_shuffled_validation_mse',))]
    assert list(_tokens('Minimum shuffled validation error was 2.4434')) == [('2.4434', ('minimum_shuffled_validation_mse',))]
    assert list(_tokens('Shuffled validation error was 2.4434')) == [
        ('2.4434', ('minimum_shuffled_validation_mse', 'mean_shuffled_validation_mse'))]
    for field, rung in (('minimum_shuffled_validation_mse', 0), ('mean_shuffled_validation_mse', 1)):
        _, state = run(Scripted([NULL], falsifier_test=None,
                                say=lambda o, f=field: f"Mean shuffled validation error was {o['data'][f]:.6g}."))
        assert ladder_of(state)['rung'] == rung, field


def test_a_retracted_work_cited_by_its_pubmed_link_blocks_l1():
    records = EUROPEPMC['resultList']['result']
    _, cited = run(Scripted([FIT, READ], say=lambda o: 'Consistent with https://pubmed.ncbi.nlm.nih.gov/9500042/ on the split.'),
                   extra_tools=reads(records), egress=True)
    ladder = ladder_of(cited, rows=[read_row()], verification=passing(cited))
    assert ladder['rung'] == 0 and 'retracted_source' in ladder['next']['needs']


def test_a_falsifier_set_after_the_planner_read_earlier_results_is_not_prespecified():
    from arc_science.exploration.models import ContextItem

    def ladder_under(item):
        request = MissionRequest(goal='Ladder fixture', max_rounds=3, context_items=[item])
        state = asyncio.run(explore(request, Scripted([FIT, NULL])))
        assert state.status == 'completed', state.stop_reason
        return ladder_of(state, verification=passing(state))
    prior = dict(ref='mission-a', title='Earlier mission', digest='a' * 64, text='validation error 0.00404')
    for item in (ContextItem(kind='mission', **prior), ContextItem(kind='memory', trust='model_output', **prior),
                 ContextItem(kind='memory', source_uri='mission://mission-a/round/1', **prior)):
        ladder = ladder_under(item)
        assert ladder['rung'] == 2 and ladder['next'] == {'rung': 3, 'needs': ['falsifier_after_context']}, item
    # An operator note that states a recorded result is an earlier result too (fix round 2); one
    # that states none leaves the falsifier prespecified.
    note = dict(kind='memory', trust='user', ref='note-1', title='Operator note', digest='a' * 64)
    for text in ('last run validation error 0.00404', 'The shuffled validation error was 1.2 last week.'):
        ladder = ladder_under(ContextItem(text=text, **note))
        assert ladder['rung'] == 2 and ladder['next'] == {'rung': 3, 'needs': ['falsifier_after_context']}, text
    assert ladder_under(ContextItem(text='Prefer a quadratic basis; the curve bends near x=4.', **note))['rung'] == 4


# Integration fix round 2: counts after a count, commas inside an error's phrase, spaced and
# spelled-out units, statistics anywhere in a shuffled-error phrase, legacy PubMed links.

def test_a_later_count_takes_its_own_split_not_the_one_of_the_count_before_it():
    for text in ('The fit used 48 training samples and 12 samples for validation.',
                 'We used 48 training samples, and 12 samples were held out.',
                 'We used 48 samples for training and 12 samples for validation.'):
        assert list(_tokens(text)) == [('48', ('n_train',)), ('12', ('n_validation',))], text
    # A split word before a count still wins over a later one.
    assert list(_tokens('The model was trained on 48 samples and then scored on the held-out test set.')) == [('48', ('n_train',))]
    for second, rung in (('n_validation', 1), ('n_train', 0)):
        _, state = run(Scripted([FIT], say=lambda o, f=second: f"The fit used {o['data']['n_train']} training samples and "
                                                               f"{o['data'][f]} samples for validation."))
        assert ladder_of(state)['rung'] == rung, second


def test_a_comma_inside_the_phrase_of_a_statistic_of_an_error_keeps_the_statistic():
    for text in ('The standard error of the fold-wise, held-out validation error was 0.004.',
                 'The SD across the five folds, of the validation error, was 0.004.'):
        assert list(_tokens(text)) == [('0.004', ())], text
    for text in ('The CI for degree 2 excluded zero, validation error 0.12.',
                 'With SE reported for each fold in the appendix, the validation error fell to 0.12.'):
        assert [names for _, names in _tokens(text)][-1] == ('validation_mse',), text


def test_a_spaced_spelled_out_or_non_ascii_unit_never_binds_a_unitless_record():
    for text, token in (('The validation MSE was 0.0017 %.', '0.0017'), ('The validation MSE was 0.0017 percent.', '0.0017'),
                        ('The validation MSE was 0.17 per cent.', '0.17'), ('The validation MSE was 0.0017‰.', '0.0017'),
                        ('The validation MSE was 0.0017 ‰.', '0.0017'), ('Validation MSE was 0.00404µM.', '0.00404'),
                        ('Validation MSE was 0.00404μM.', '0.00404'), ('Validation MSE was 0.00404°C.', '0.00404'),
                        ('Validation MSE was 0.00404мл.', '0.00404'), ('Validation MSE was 0.00404 µM.', '0.00404'),
                        ('The model used 48 k training samples.', '48'), ('The model used 48 thousand training samples.', '48'),
                        ('We used 48 thousand samples.', '48'), ('We used 48 тыс. samples.', '48')):
        assert list(_tokens(text)) == [(token, None)], text
    # A range with a unit is one quantity with that unit.
    assert list(_tokens('The validation error ranged 0.01-0.5 %.')) == [('0.01', None), ('0.5', None)]
    # A following word is not a unit: the count and its split still bind.
    assert list(_tokens('We used 48 training samples.')) == [('48', ('n_train',))]
    v = lambda o: f"{o['data']['validation_mse']:.3g}"
    for say in (lambda o: f'The validation MSE was {v(o)} %.', lambda o: f'The validation MSE was {v(o)} percent.',
                lambda o: f"The model used {o['data']['n_train']} k training samples.", lambda o: f'The validation MSE was {v(o)}µM.'):
        _, state = run(Scripted([FIT], say=say))
        assert ladder_of(state)['next']['needs'] == ['unbound_number']


MSE_SHUFFLED = ('minimum_shuffled_validation_mse', 'mean_shuffled_validation_mse')


def test_a_statistic_anywhere_in_a_shuffled_error_phrase_decides_its_field():
    mean, minimum = ('mean_shuffled_validation_mse',), ('minimum_shuffled_validation_mse',)
    for text, names in (('The mean of the shuffled validation errors was 1.2', mean),
                        ('The average of the shuffled errors was 1.2', mean),
                        ('The shuffled validation error averaged 1.2', mean),
                        ('The shuffled validation error had a mean of 1.2', mean),
                        ('The minimum of the shuffled validation errors was 1.2', minimum),
                        ('The shuffled validation error had a minimum of 1.2', minimum),
                        ('The median shuffled validation error was 1.2', ()),
                        ('The maximum shuffled validation error was 1.2', ()),
                        ('The worst shuffled error was 1.2', ()),
                        ('The shuffled validation error peaked at a maximum of 1.2', ()),
                        ('Shuffled-response validation MSE was 1.2', MSE_SHUFFLED),
                        ('Shuffled validation error was 1.2', MSE_SHUFFLED)):
        assert list(_tokens(text)) == [('1.2', names)], text
    for field, rung in (('minimum_shuffled_validation_mse', 0), ('mean_shuffled_validation_mse', 1)):
        _, state = run(Scripted([NULL], falsifier_test=None,
                                say=lambda o, f=field: f"The mean of the shuffled validation errors was {o['data'][f]:.6g}."))
        assert ladder_of(state)['rung'] == rung, field


@pytest.mark.parametrize('link', ['https://pubmed.ncbi.nlm.nih.gov/9500042/', 'https://www.ncbi.nlm.nih.gov/pubmed/9500042',
                                  'http://ncbi.nlm.nih.gov/pubmed/9500042/', 'https://europepmc.org/article/MED/9500042',
                                  'https://europepmc.org/abstract/MED/9500042'])
def test_a_retracted_work_cited_by_any_pubmed_link_form_blocks_l1(link):
    records = EUROPEPMC['resultList']['result']
    _, cited = run(Scripted([FIT, READ], say=lambda o: f'Consistent with {link} on the split.'),
                   extra_tools=reads(records), egress=True)
    ladder = ladder_of(cited, rows=[read_row()], verification=passing(cited))
    assert ladder['rung'] == 0 and 'retracted_source' in ladder['next']['needs']
