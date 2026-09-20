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
    base = {'branch_id': 'linear', 'evidence_ids': ['obs-1'], 'finding': 'f', 'next_test': 'independent data', 'round': 0}
    # Two distinct reviewer identities unless a case says otherwise.
    return request, MissionState.model_validate({**state.model_dump(), 'status': status, 'branches': [branch],
                                                 'observations': [observation],
                                                 'assessments': [{**base, 'model': 'model-' + a['role'], **a} for a in assessments]})


def test_the_demo_mission_stops_with_a_scope_per_hypothesis_that_the_reconciliation_supports():
    request, state = demo()
    assert state.status == 'completed' and state.claim_scope is not None
    scope = state.claim_scope
    assert scope.derivation_version == 'arc-claim-scope-3' and scope.basis_round == state.round
    assert {b.branch_id for b in scope.branches} == {b.id for b in state.branches}
    # The linear baseline was challenged by both roles: contradicted, with the findings kept as uncertainty.
    linear = scoped(state, 'linear')
    assert linear.status == 'contradicted' and linear.supported_scope == ()
    assert {u.reason for u in linear.uncertainties} == {'challenged'} and {u.role for u in linear.uncertainties} == {'analyst', 'falsifier'}
    assert all(u.evidence_ids == ('fit-linear',) for u in linear.uncertainties)
    assert {t.role for t in linear.next_tests} == {'analyst', 'falsifier'}
    # The quadratic fit is supported by both roles, but the scripted fixture runs both roles as one
    # identity: the scope is recorded and qualified, the status stays unresolved and says why.
    quadratic = scoped(state, 'quadratic')
    assert quadratic.status == 'unresolved' and len(quadratic.supported_scope) == 2
    assert 'exploratory validation split' in quadratic.scope_qualifier
    assert [u.reason for u in quadratic.uncertainties] == ['shared_identity'] and 'scripted-fixture-v1' in quadratic.uncertainties[0].detail
    assert any('independently acquired data' in t.test for t in quadratic.next_tests)
    assert scope.counts == {'provisionally_supported': 0, 'contradicted': 2, 'unresolved': 1, 'unassessed': 0, 'without_next_test': 0}
    assert 'nothing above is scientific validation' in scope.rule.lower()
    assert any(e.kind == 'claim_scope_derived' for e in state.events)
    # It is derived, so the evidence graph and the capsule check it, and the ledger reads it.
    validate_evidence(state)
    report = verify_capsule(export_capsule(request, state))
    decision = release.evaluate_release(request, state, release.receipt_from_report(report, state), event_chain_ok=True)
    check = next(c for c in decision.checks if c.name == 'claim_scope')
    assert check.state == 'satisfied' and 'unresolved 1' in check.reason and 'proposed for 3 of 3' in check.reason


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


def test_one_role_recording_two_positions_in_a_round_stands_by_the_most_cautious_one():
    forward = [{'role': 'analyst', 'position': 'challenge', 'finding': 'residual structure'},
               {'role': 'analyst', 'position': 'support', 'finding': 'low error'},
               {'role': 'falsifier', 'position': 'support'}]
    for order in (forward, [forward[1], forward[0], forward[2]]):
        request, state = hand_built(order)
        branch = claim_scope.derive_claim_scope(state).branches[0]
        assert branch.status == 'unresolved'
        assert [(u.reason, u.detail) for u in branch.uncertainties] == [('challenged', 'residual structure')]
        assert branch.supported_scope == ('falsifier: f',)


def test_two_roles_on_one_model_identity_never_reach_provisional_support():
    request, state = hand_built([{'role': 'analyst', 'position': 'support', 'model': 'same'},
                                 {'role': 'falsifier', 'position': 'support', 'model': 'same'}])
    branch = claim_scope.derive_claim_scope(state).branches[0]
    assert branch.status == 'unresolved' and [u.reason for u in branch.uncertainties] == ['shared_identity']
    assert 'same' in branch.uncertainties[0].detail and len(branch.supported_scope) == 2
    without_tests = hand_built([{'role': 'analyst', 'position': 'support', 'next_test': ''},
                                {'role': 'falsifier', 'position': 'support', 'next_test': ''}])[1]
    scope = claim_scope.derive_claim_scope(without_tests)
    assert scope.branches[0].status == 'provisionally_supported' and scope.counts['without_next_test'] == 1
    ledger = release.evaluate_release(request, without_tests.model_copy(update={'claim_scope': scope}), None, event_chain_ok=True)
    assert 'proposed for 0 of 1' in next(c.reason for c in ledger.checks if c.name == 'claim_scope')


def test_a_requested_only_identity_never_counts_as_an_independent_reviewer():
    request, state = hand_built([{'role': 'analyst', 'position': 'support'}, {'role': 'falsifier', 'position': 'support'}])
    record = {'context_digest': 'a' * 64, 'input_context': {}, 'role': 'falsifier', 'round': 0, 'model': 'model-falsifier',
              'payload': {}, 'transport': {'transport': 'codex', 'identity_source': 'requested_only', 'identity_verified': False}}
    unverified = MissionState.model_validate({**state.model_dump(), 'model_records': [record]})
    branch = claim_scope.derive_claim_scope(unverified).branches[0]
    assert branch.status == 'unresolved' and [u.reason for u in branch.uncertainties] == ['unverified_identity']
    assert branch.uncertainties[0].role == 'falsifier' and 'requested-only' in branch.uncertainties[0].detail
    # The same record with an observed identity keeps the provisional support.
    verified = {**record, 'transport': {**record['transport'], 'identity_verified': True, 'observed_model': 'model-falsifier'}}
    state = MissionState.model_validate({**state.model_dump(), 'model_records': [verified]})
    assert claim_scope.derive_claim_scope(state).branches[0].status == 'provisionally_supported'


def test_a_scope_derived_under_an_earlier_rule_is_stale_not_contradictory():
    request, state = demo()
    older = state.model_copy(update={'claim_scope': state.claim_scope.model_copy(update={'derivation_version': 'arc-claim-scope-2'})})
    # The record is still valid evidence, the ledger says the scope is stale, and a
    # verification derives it again under the current rule.
    validate_evidence(older)
    ledger = release.evaluate_release(request, older, None, event_chain_ok=True)
    check = next(c for c in ledger.checks if c.name == 'claim_scope')
    assert check.state == 'stale' and 'arc-claim-scope-2' in check.reason and 'arc-claim-scope-3' in check.reason
    assert claim_scope.derive_claim_scope(older).derivation_version == 'arc-claim-scope-3'
    # Under the current version a scope that does not follow from the record is refused.
    with pytest.raises(ValueError, match='does not follow'):
        validate_evidence(state.model_copy(update={'claim_scope': state.claim_scope.model_copy(update={'basis_round': 99})}))


def test_connector_observations_recorded_before_the_field_existed_are_read_back_as_ineligible():
    from arc_science.exploration.models import Observation
    base = {'id': 'a', 'action': {'id': 'a', 'branch_id': 'b', 'tool': 'mcp_srv_echo', 'arguments': {}}, 'tool': 'mcp_srv_echo',
            'tool_version': 'arc-external-snapshot-1', 'branch_id': 'b', 'round': 0, 'status': 'ok', 'data': {},
            'dataset_digest': 'a' * 64, 'request_digest': 'b' * 64, 'replayable': False}
    assert Observation.model_validate(base).claim_eligible is False
    assert Observation.model_validate({**base, 'tool': 'acp_x_consult', 'action': {**base['action'], 'tool': 'acp_x_consult'}}).claim_eligible is False
    assert Observation.model_validate({**base, 'tool': 'literature_search', 'action': {**base['action'], 'tool': 'literature_search'}}).claim_eligible is True
    assert Observation.model_validate({**base, 'claim_eligible': True}).claim_eligible is True  # an explicit record is kept as written


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
    from arc_science.exploration.changes import declare_resume
    paused = declare_resume(state.model_copy(update={'status': 'paused'}), ['analysis', 'claim'], 'again')[0]
    captured = []
    resumed = asyncio.run(explore(resumed_request, DemoAgent(), initial=paused, emit=captured.append))
    validate_evidence(resumed)
    assert captured[0].claim_scope is None or captured[0].status != 'paused'
    assert resumed.claim_scope is not None and resumed.claim_scope.basis_round == resumed.round
    ledger = release.evaluate_release(resumed_request, paused, None, event_chain_ok=True)
    assert next(c.state for c in ledger.checks if c.name == 'claim_scope') == 'not_applicable'
