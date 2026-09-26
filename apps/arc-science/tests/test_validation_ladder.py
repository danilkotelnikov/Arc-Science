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
from arc_science.exploration.validation import RUNGS, claim_ladder, numbers

FIXTURES = Path(__file__).parent / 'fixtures'
OPENALEX = json.loads((FIXTURES / 'openalex' / 'works_is_retracted.json').read_text(encoding='utf-8'))
EUROPEPMC = json.loads((FIXTURES / 'openalex' / 'europepmc_search.json').read_text(encoding='utf-8'))
FIT_ERROR = {'tool': 'polynomial_fit', 'metric': 'validation_mse', 'threshold': .02, 'direction': 'above'}
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
    # Identifiers are not quantities; a year written as text in a record still binds.
    assert numbers(['cites 10.1038/nature14539 via https://doi.org/x1.5 and IL-6 in 2015']) == ['2015']
    # A timeline row that recorded a failure contradicts the chain: not traced.
    row = {'operation': 'tool', 'action_id': 'fit', 'outcome_source': 'recorded', 'outcome': 'error', 'receipt_id': None}
    assert 'timeline_not_ok' in ladder_of(bound, rows=[row])['next']['needs']


def epmc_client(records, openalex=OPENALEX, seen=None):
    def handle(request):
        (seen if seen is not None else []).append(str(request.url))
        if request.url.host == 'www.ebi.ac.uk':
            return httpx.Response(200, json={**EUROPEPMC, 'resultList': {'result': records}})
        if request.url.host == 'api.openalex.org' and openalex is not None:
            return httpx.Response(200, json=openalex)
        return httpx.Response(503)
    return httpx.AsyncClient(transport=httpx.MockTransport(handle))


def read_row(receipt_id='receipt-1'):
    return {'operation': 'tool', 'action_id': 'read', 'outcome_source': 'recorded', 'outcome': 'ok', 'receipt_id': receipt_id}


def test_public_reads_record_openalex_retraction_status():
    seen = []
    tools = public_tools(epmc_client(EUROPEPMC['resultList']['result'], seen=seen))
    data = asyncio.run(tools['literature_search'][1]({'query': 'retraction fixture'}))
    check = data['retraction_check']
    assert check['source'] == 'OpenAlex' and check['status'] == 'ok' and len(check['response_sha256']) == 64
    assert check['checked'] == ['10.1016/s0140-6736(97)11096-0', '10.1038/nature14539']
    assert check['retracted'] == ['10.1016/s0140-6736(97)11096-0'] and check['unchecked'] == ['PPR000001']
    openalex = [url for url in seen if 'api.openalex.org' in url]
    assert len(openalex) == 1 and 'is_retracted' in openalex[0] and 'nature14539' in openalex[0]
    # An unreachable OpenAlex never fails the search; the check is recorded as not done.
    down = asyncio.run(public_tools(epmc_client(EUROPEPMC['resultList']['result'], openalex=None))['literature_search'][1]({'query': 'x'}))
    assert down['retraction_check']['status'] == 'error' and down['retraction_check']['retracted'] == []


def test_a_retracted_citation_blocks_l1():
    records = EUROPEPMC['resultList']['result']
    _, cited = run(Scripted([FIT, READ]), extra_tools=public_tools(epmc_client(records)), egress=True)
    assert [o.status for o in cited.observations] == ['ok', 'ok']
    ladder = ladder_of(cited, rows=[read_row()], verification=passing(cited))
    assert ladder['rung'] == 0 and 'retracted_source' in ladder['next']['needs'] and ladder['verdict'] == 'blocked'
    # The same search without the retracted work, every record checked: traced.
    clean = [r for r in records if r.get('doi') == '10.1038/nature14539']
    _, fine = run(Scripted([FIT, READ]), extra_tools=public_tools(epmc_client(clean)), egress=True)
    ladder = ladder_of(fine, rows=[read_row()])
    assert ladder['rung'] == 1 and {'no_retracted_source', 'ledger_receipt'} <= set(ladder['met'])
    # No ledger receipt on the external read, or no retraction check: not traced.
    assert 'receipt_missing' in ladder_of(fine, rows=[read_row(None)])['next']['needs']
    assert 'receipt_unchecked' in ladder_of(fine, rows=[])['next']['needs']
    _, unchecked = run(Scripted([FIT, READ]), extra_tools=public_tools(epmc_client(clean, openalex=None)), egress=True)
    assert 'retraction_unchecked' in ladder_of(unchecked, rows=[read_row()])['next']['needs']


def test_a_severe_test_reaches_l4_and_l5_stays_a_need():
    request, state = run(Scripted([FIT, NULL]))
    ladder = ladder_of(state, verification=passing(state))
    assert ladder['rung'] == 4 and ladder['name'] == 'severe' and ladder['density'] == 5
    assert ladder['next'] == {'rung': 5, 'needs': ['external_replication']} and ladder['verdict'] == 'accepted'
    assert {'numbers_bound', 'recomputed', 'falsifier_prespecified', 'null_rejected', 'falsifier_survived'} <= set(ladder['met'])
    facts = ladder['facts']
    assert facts['null_model']['p_value'] == pytest.approx(1 / 33) and facts['null_model']['alpha'] == .05
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
    request, state = run(Scripted([READ], falsifier_test=None), extra_tools=public_tools(epmc_client(records)), egress=True)
    rows = [read_row()]
    decision = release.evaluate_release(request, state, None, event_chain_ok=True, timeline_rows=rows)
    assert rung_check(decision).state == 'satisfied', rung_check(decision).reason
    # Without the timeline the external read's receipt cannot be checked: unknown, never satisfied.
    assert rung_check(release.evaluate_release(request, state, None, event_chain_ok=True)).state == 'unknown'


def needs_rasterizer():
    from arc_science.svg_raster import cairo_available
    if not os.environ.get('ARC_SVG2PNG') and not cairo_available():
        pytest.skip('No SVG rasterizer: set ARC_SVG2PNG or install cairosvg to re-render the legacy plots')


def test_legacy_missions_still_load_verify_and_pass_the_rung_check():
    from arc_science.exploration.capsule import export_capsule, verify_capsule
    legacy = FIXTURES / 'legacy'
    request = MissionRequest.model_validate_json((legacy / 'completed.request.json').read_text(encoding='utf-8'))
    state = MissionState.model_validate_json((legacy / 'completed.state.json').read_text(encoding='utf-8'))
    # The persisted ledger predates claim_rungs and still loads; the current decision adds the check.
    assert 'claim_rungs' not in [c.name for c in state.release.checks]
    decision = release.current_decision(request, state, event_chain_ok=True)
    assert rung_check(decision).state == 'satisfied' and decision.eligible_for_human_review, decision.blocking_reasons
    cards = build_claims(state, [], evidence_graph(state), decision.model_dump(mode='json'))['claims']
    assert [c['ladder']['rung'] for c in cards] == [2, 2, 2]
    assert [c['ladder']['verdict'] for c in cards] == ['rejected', 'revised', 'rejected']
    needs_rasterizer()
    report = verify_capsule(export_capsule(request, state))
    assert report['integrity'] and report['reproduction_passed'], report['failures']
    fresh = release.evaluate_release(request, state, release.receipt_from_report(report, state), event_chain_ok=True)
    assert rung_check(fresh).state == 'satisfied' and fresh.eligible_for_human_review
