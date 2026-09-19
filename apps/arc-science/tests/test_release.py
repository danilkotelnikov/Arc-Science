"""The release ledger: six explicit states, per-check staleness, fail-closed decisions."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from arc_science.contracts import digest
from arc_science.exploration import release
from arc_science.exploration.claim_scope import derive_claim_scope
from arc_science.exploration.engine import initialize
from arc_science.exploration.models import (MissionRequest, MissionState, ReleaseCheck, ReleaseDecision,
                                            VerificationReceipt)


def mission(**updates):
    request = MissionRequest(goal='Explore the fixture', mode='demo', max_rounds=2)
    state = MissionState.model_validate({**initialize(request).model_dump(), **updates})
    if state.status in ('completed', 'budget_exhausted', 'needs_input') and state.claim_scope is None:
        state = state.model_copy(update={'claim_scope': derive_claim_scope(state)})  # what the engine does at a stop
    return request, state


def receipt(state, **updates):
    base = {'subject_digest': release.subject_digest(state), 'report_digest': 'a' * 64, 'integrity': True,
            'reproduction_passed': True, 'evidence_graph_valid': True, 'reproduced': 0,
            'artifacts_reproduced': 0, 'failures': (), 'verified_at': 1}
    return VerificationReceipt.model_validate({**base, **updates})


def states(decision):
    return {c.name: c.state for c in decision.checks}


def test_a_fresh_mission_is_blocked_by_unknowns_and_says_why():
    request, state = mission()
    decision = release.evaluate_release(request, state, None, event_chain_ok=None)
    assert decision.status == 'blocked' and decision.eligible_for_human_review is False
    assert states(decision)['operational_status'] == 'unknown'
    assert states(decision)['event_chain_integrity'] == 'unknown'
    assert states(decision)['replay_integrity'] == 'unknown'
    assert states(decision)['reconciliation'] == 'not_applicable'
    assert states(decision)['visual_review'] == 'not_applicable'
    assert 'replay_integrity:unknown' in decision.blocking_reasons
    assert decision.policy_digest == release.POLICY_DIGEST
    assert all(c.reason for c in decision.checks)


def test_completed_verified_mission_is_eligible_for_human_review_only():
    request, state = mission(status='completed')
    decision = release.evaluate_release(request, state, receipt(state), event_chain_ok=True)
    assert decision.status == 'eligible_for_human_review'
    assert states(decision)['numerical_reproduction'] == 'not_applicable'
    assert states(decision)['artifact_reproduction'] == 'not_applicable'
    assert state.publication_eligible is False
    assert 'validated' not in ' '.join(c.reason for c in decision.checks).lower()


def test_operational_states_distinguish_error_from_failure():
    for status, expected in (('cancelled', 'failed'), ('error', 'error'), ('running', 'unknown'),
                             ('needs_input', 'unknown'), ('budget_exhausted', 'satisfied')):
        request, state = mission(status=status)
        assert states(release.evaluate_release(request, state, None, event_chain_ok=True))['operational_status'] == expected


def test_verification_becomes_stale_when_the_mission_changes_and_never_satisfied_by_itself():
    request, state = mission(status='completed')
    old = receipt(state)
    changed = MissionState.model_validate({**state.model_dump(), 'actions_used': 1})
    decision = release.evaluate_release(request, changed, old, event_chain_ok=True)
    assert states(decision)['replay_integrity'] == 'stale'
    assert 'replay_integrity:stale' in decision.blocking_reasons
    # Re-evaluating with the same stale receipt cannot heal it.
    again = release.evaluate_release(request, changed, old, event_chain_ok=True)
    assert states(again)['replay_integrity'] == 'stale'


def test_failed_replay_and_broken_event_chain_block_with_reasons():
    request, state = mission(status='completed')
    bad = receipt(state, integrity=False, reproduction_passed=False, failures=('manifest mismatch',))
    decision = release.evaluate_release(request, state, bad, event_chain_ok=False)
    assert states(decision)['replay_integrity'] == 'failed'
    assert states(decision)['event_chain_integrity'] == 'failed'
    assert any('manifest mismatch' in c.reason for c in decision.checks)


def test_not_applicable_requires_a_reason_and_decisions_must_follow_their_checks():
    with pytest.raises(ValidationError):
        ReleaseCheck(name='visual_review', state='not_applicable', checked_basis_digest='b' * 64, reason='n/a')
    check = ReleaseCheck(name='visual_review', state='unknown', checked_basis_digest='b' * 64, reason='not reviewed')
    with pytest.raises(ValidationError):
        ReleaseDecision(policy_digest='c' * 64, subject_digest='d' * 64, status='eligible_for_human_review',
                        eligible_for_human_review=True, checks=(check,), blocking_reasons=(), decided_at=1)


def test_invalidation_marks_only_the_named_checks_stale():
    request, state = mission(status='completed')
    decision = release.evaluate_release(request, state, receipt(state), event_chain_ok=True)
    assert decision.eligible_for_human_review
    after = release.invalidate_release(decision, ['replay_integrity', 'visual_review'], 'Declared change: analysis')
    assert states(after)['replay_integrity'] == 'stale' and states(after)['operational_status'] == 'satisfied'
    assert states(after)['visual_review'] == 'not_applicable'  # applicability is not a check result to stale
    assert after.status == 'blocked'
    with pytest.raises(release.ReleaseBlocked):
        release.assert_exportable(request, MissionState.model_validate({**state.model_dump(), 'release': after.model_dump()}),
                                  event_chain_ok=True)


def test_reconciliation_needs_both_roles_on_every_evidence_bearing_branch():
    request, state = mission(status='completed')
    branch = {'id': 'linear', 'title': 'Linear', 'hypothesis': 'h', 'falsifier': 'f', 'parents': [], 'created_round': 0}
    observation = {'id': 'obs-1', 'branch_id': 'linear', 'tool': 'polynomial_fit', 'tool_version': 'v', 'round': 0,
                   'status': 'ok', 'data': {'validation_mse': 0.01}, 'dataset_digest': state.dataset_digest,
                   'request_digest': state.request_digest,
                   'action': {'id': 'fit-linear', 'branch_id': 'linear', 'tool': 'polynomial_fit', 'arguments': {'degree': 1}}}
    with_obs = MissionState.model_validate({**state.model_dump(), 'branches': [branch], 'observations': [observation]})
    decision = release.evaluate_release(request, with_obs, None, event_chain_ok=True)
    assert states(decision)['reconciliation'] == 'unknown'
    assert 'analyst:linear' in next(c.reason for c in decision.checks if c.name == 'reconciliation')
    assessment = {'branch_id': 'linear', 'position': 'challenge', 'evidence_ids': ['obs-1'], 'finding': 'residual',
                  'next_test': 'quadratic', 'role': 'analyst', 'round': 0, 'model': 'm'}
    both = MissionState.model_validate({**with_obs.model_dump(), 'assessments': [assessment, {**assessment, 'role': 'falsifier'}], 'claim_scope': None})
    assert states(release.evaluate_release(request, both, None, event_chain_ok=True))['reconciliation'] == 'satisfied'
    assert release.check_basis('reconciliation', request, both) != release.check_basis('reconciliation', request, with_obs)


def test_requested_visual_review_without_artifacts_is_unknown_not_waived():
    request = MissionRequest(goal='Explore the fixture', mode='demo', max_rounds=2, vision_review=True)
    state = MissionState.model_validate({**initialize(request).model_dump(), 'status': 'completed'})
    decision = release.evaluate_release(request, state, receipt(state), event_chain_ok=True)
    assert states(decision)['visual_review'] == 'unknown'
    assert 'visual_review:unknown' in decision.blocking_reasons


def test_reproduction_checks_count_every_replayable_item():
    request, state = mission(status='completed')
    branch = {'id': 'linear', 'title': 'Linear', 'hypothesis': 'h', 'falsifier': 'f', 'parents': [], 'created_round': 0}
    observation = {'id': 'obs-1', 'branch_id': 'linear', 'tool': 'polynomial_fit', 'tool_version': 'v', 'round': 0,
                   'status': 'ok', 'data': {'validation_mse': 0.01}, 'dataset_digest': state.dataset_digest,
                   'request_digest': state.request_digest,
                   'action': {'id': 'fit-linear', 'branch_id': 'linear', 'tool': 'polynomial_fit', 'arguments': {'degree': 1}}}
    with_obs = MissionState.model_validate({**state.model_dump(), 'branches': [branch], 'observations': [observation]})
    partial = receipt(with_obs, reproduced=0, reproduction_passed=True)
    decision = release.evaluate_release(request, with_obs, partial, event_chain_ok=True)
    assert states(decision)['numerical_reproduction'] == 'failed'
    assert '0 of 1' in next(c.reason for c in decision.checks if c.name == 'numerical_reproduction')
    assert states(release.evaluate_release(request, with_obs, receipt(with_obs, reproduced=1), event_chain_ok=True))['numerical_reproduction'] == 'satisfied'
