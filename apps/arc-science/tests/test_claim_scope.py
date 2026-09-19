"""Claim-strength adjustment: requested claim -> evidence-supported scope -> remaining
uncertainty -> next discriminating test, derived and never upgraded."""
import asyncio

import pytest
from pydantic import ValidationError

from arc_science.exploration import claim_scope, release
from arc_science.exploration.agents import DemoAgent
from arc_science.exploration.capsule import export_capsule, verify_capsule
from arc_science.exploration.engine import explore, initialize
from arc_science.exploration.evidence import validate_evidence
from arc_science.exploration.models import MissionRequest, MissionState, ScopedBranch


def demo(**updates):
    request = MissionRequest(goal='Explore the fixture', **updates)
    return request, asyncio.run(explore(request, DemoAgent()))


def scoped(state, branch_id):
    return next(b for b in state.claim_scope.branches if b.branch_id == branch_id)


def hand_built(assessments, status='completed'):
    request = MissionRequest(goal='Explore the fixture')
    state = initialize(request)
    branch = {'id': 'linear', 'title': 'Linear', 'hypothesis': 'A linear curve describes the fixture.',
              'falsifier': 'Residual structure.', 'parents': [], 'created_round': 0}
    observation = {'id': 'obs-1', 'branch_id': 'linear', 'tool': 'polynomial_fit', 'tool_version': 'v', 'round': 0,
                   'status': 'ok', 'data': {'validation_mse': 0.01}, 'dataset_digest': state.dataset_digest,
                   'request_digest': state.request_digest,
                   'action': {'id': 'fit-linear', 'branch_id': 'linear', 'tool': 'polynomial_fit', 'arguments': {'degree': 1}}}
    base = {'branch_id': 'linear', 'evidence_ids': ['obs-1'], 'finding': 'f', 'next_test': 'independent data', 'round': 0, 'model': 'm'}
    return request, MissionState.model_validate({**state.model_dump(), 'status': status, 'branches': [branch],
                                                 'observations': [observation],
                                                 'assessments': [{**base, **a} for a in assessments]})


def test_the_demo_mission_stops_with_a_scope_per_hypothesis_that_the_reconciliation_supports():
    request, state = demo()
    assert state.status == 'completed' and state.claim_scope is not None
    scope = state.claim_scope
    assert scope.derivation_version == 'arc-claim-scope-1' and scope.basis_round == state.round
    assert {b.branch_id for b in scope.branches} == {b.id for b in state.branches}
    # The linear baseline was challenged by both roles: contradicted, with the findings kept as uncertainty.
    linear = scoped(state, 'linear')
    assert linear.status == 'contradicted' and linear.supported_scope == ()
    assert {u.reason for u in linear.uncertainties} == {'challenged'} and {u.role for u in linear.uncertainties} == {'analyst', 'falsifier'}
    assert all(u.evidence_ids == ('fit-linear',) for u in linear.uncertainties)
    assert {t.role for t in linear.next_tests} == {'analyst', 'falsifier'}
    # The quadratic fit is supported by both roles: provisional, qualified, with a next test.
    quadratic = scoped(state, 'quadratic')
    assert quadratic.status == 'provisionally_supported' and len(quadratic.supported_scope) == 2
    assert 'exploratory validation split' in quadratic.scope_qualifier and quadratic.uncertainties == ()
    assert any('independently acquired data' in t.test for t in quadratic.next_tests)
    assert scope.counts == {'provisionally_supported': 1, 'contradicted': 2, 'unresolved': 0, 'unassessed': 0}
    assert 'nothing above is scientific validation' in scope.rule.lower()
    assert any(e.kind == 'claim_scope_derived' for e in state.events)
    # It is derived, so the evidence graph and the capsule check it, and the ledger reads it.
    validate_evidence(state)
    report = verify_capsule(export_capsule(request, state))
    decision = release.evaluate_release(request, state, release.receipt_from_report(report, state), event_chain_ok=True)
    check = next(c for c in decision.checks if c.name == 'claim_scope')
    assert check.state == 'satisfied' and 'provisionally_supported 1' in check.reason


def test_derivation_is_deterministic_and_a_tampered_scope_is_rejected_everywhere():
    request, state = demo()
    again = claim_scope.derive_claim_scope(state)
    assert again == state.claim_scope
    upgraded = state.model_copy(update={'claim_scope': state.claim_scope.model_copy(update={
        'branches': tuple(b.model_copy(update={'status': 'provisionally_supported', 'uncertainties': (),
                                               'supported_scope': ('analyst: x', 'falsifier: y'), 'scope_qualifier': 'q'})
                          if b.branch_id == 'linear' else b for b in state.claim_scope.branches)})})
    with pytest.raises(ValueError, match='does not follow from the recorded reconciliation'):
        validate_evidence(upgraded)
    with pytest.raises(ValueError):
        verify_capsule(export_capsule(request, upgraded))
    decision = release.evaluate_release(request, upgraded, None, event_chain_ok=True)
    assert next(c.state for c in decision.checks if c.name == 'claim_scope') == 'failed'


@pytest.mark.parametrize('assessments,status,reasons', [
    ([{'role': 'analyst', 'position': 'support'}, {'role': 'falsifier', 'position': 'support'}], 'provisionally_supported', set()),
    ([{'role': 'analyst', 'position': 'support'}, {'role': 'falsifier', 'position': 'challenge'}], 'unresolved', {'challenged'}),
    ([{'role': 'analyst', 'position': 'support'}, {'role': 'falsifier', 'position': 'uncertain'}], 'unresolved', {'uncertain'}),
    ([{'role': 'analyst', 'position': 'support'}], 'unresolved', {'missing_independent_role'}),
    ([{'role': 'analyst', 'position': 'challenge'}, {'role': 'falsifier', 'position': 'challenge'}], 'contradicted', {'challenged'}),
    ([], 'unassessed', {'missing_independent_role'}),
])
def test_one_dissent_or_one_missing_role_keeps_a_claim_from_provisional_support(assessments, status, reasons):
    request, state = hand_built(assessments)
    branch = claim_scope.derive_claim_scope(state).branches[0]
    assert branch.status == status
    assert {u.reason for u in branch.uncertainties} == reasons
    assert bool(branch.supported_scope) == any(a['position'] == 'support' for a in assessments)


def test_later_rounds_replace_earlier_assessments_and_an_untested_hypothesis_says_so():
    request, state = hand_built([{'role': 'analyst', 'position': 'challenge', 'round': 0},
                                 {'role': 'falsifier', 'position': 'challenge', 'round': 0},
                                 {'role': 'analyst', 'position': 'support', 'round': 1},
                                 {'role': 'falsifier', 'position': 'support', 'round': 1}])
    assert claim_scope.derive_claim_scope(state).branches[0].status == 'provisionally_supported'
    untested = state.model_copy(update={'observations': (), 'assessments': ()})
    branch = claim_scope.derive_claim_scope(untested).branches[0]
    assert branch.status == 'unassessed' and [u.reason for u in branch.uncertainties] == ['untested']


def test_the_scope_record_cannot_claim_support_without_both_roles_or_hide_uncertainty():
    with pytest.raises(ValidationError):
        ScopedBranch(branch_id='b', requested='h', status='provisionally_supported', supported_scope=('analyst: x',),
                     scope_qualifier='q')
    with pytest.raises(ValidationError):
        ScopedBranch(branch_id='b', requested='h', status='unresolved')
    with pytest.raises(ValidationError):
        ScopedBranch(branch_id='b', requested='h', status='contradicted', supported_scope=('analyst: x',),
                     uncertainties=({'reason': 'challenged', 'role': 'falsifier', 'detail': 'd'},))


def test_the_scope_is_cleared_on_resume_and_derived_again_at_the_next_stop():
    request, state = demo(max_rounds=1)
    assert state.status == 'budget_exhausted' and state.claim_scope is not None
    assert scoped(state, 'linear').status == 'contradicted'
    resumed_request = MissionRequest(goal='Explore the fixture', max_rounds=1)
    paused = state.model_copy(update={'status': 'paused'})
    captured = []
    resumed = asyncio.run(explore(resumed_request, DemoAgent(), initial=paused, emit=captured.append))
    assert captured[0].claim_scope is None or captured[0].status != 'paused'
    assert resumed.claim_scope is not None and resumed.claim_scope.basis_round == resumed.round
    ledger = release.evaluate_release(resumed_request, paused, None, event_chain_ok=True)
    assert next(c.state for c in ledger.checks if c.name == 'claim_scope') == 'not_applicable'
