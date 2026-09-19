"""Claim-strength adjustment (loop C of the 2026-09-19 program).

For every hypothesis the mission opened, derive — deterministically, from the recorded
reconciliation — the operation the design review asked for:

    requested claim -> evidence-supported scope -> remaining uncertainty
                    -> next discriminating test

The scope is never wider than what the latest independent assessments say, and a
narrower conclusion is a valid research output. Nothing here upgrades a claim: the
strongest status is "provisionally supported on the exploratory split", which both
roles must have recorded; one challenge, one uncertainty, one missing role or one
untested hypothesis keeps the claim unresolved and says why.
"""
from __future__ import annotations

from .models import ClaimScope, ClaimUncertainty, MissionState, ProposedNextTest, ScopedBranch

DERIVATION_VERSION = 'arc-claim-scope-1'
ROLES = ('analyst', 'falsifier')
SCOPE_QUALIFIER = 'on the exploratory validation split of the frozen dataset; not independent data'


def latest_assessments(state: MissionState) -> dict[tuple[str, str], object]:
    """The last recorded assessment per (role, branch); later rounds replace earlier ones."""
    latest = {}
    for assessment in state.assessments:
        key = (assessment.role, assessment.branch_id)
        if key not in latest or assessment.round >= latest[key].round:
            latest[key] = assessment
    return latest


def scope_branch(branch, state: MissionState, latest) -> ScopedBranch:
    observations = [o for o in state.observations if o.branch_id == branch.id]
    successful = [o for o in observations if o.status == 'ok']
    positions = {role: latest.get((role, branch.id)) for role in ROLES}
    present = [role for role in ROLES if positions[role] is not None]
    uncertainties = []
    supported = []
    next_tests = []
    if not successful:
        uncertainties.append(ClaimUncertainty(reason='untested', role=None,
                                              detail='No successful observation exists for this hypothesis.'))
    for role in ROLES:
        assessment = positions[role]
        if assessment is None:
            if successful:
                uncertainties.append(ClaimUncertainty(reason='missing_independent_role', role=role,
                                                      detail='The ' + role + ' has not assessed this hypothesis.'))
            continue
        if assessment.next_test:
            next_tests.append(ProposedNextTest(role=role, round=assessment.round, test=assessment.next_test,
                                               evidence_ids=assessment.evidence_ids))
        if assessment.position == 'support':
            supported.append(role + ': ' + assessment.finding)
        elif assessment.position == 'challenge':
            uncertainties.append(ClaimUncertainty(reason='challenged', role=role, detail=assessment.finding,
                                                  evidence_ids=assessment.evidence_ids))
        else:
            uncertainties.append(ClaimUncertainty(reason='uncertain', role=role, detail=assessment.finding,
                                                  evidence_ids=assessment.evidence_ids))
    stances = {positions[role].position for role in present}
    if not successful or not present:
        status = 'unassessed'
    elif len(present) == 2 and stances == {'support'}:
        status = 'provisionally_supported'
    elif len(present) == 2 and stances == {'challenge'}:
        status = 'contradicted'
    else:
        status = 'unresolved'
    scope = tuple(finding[:900] for finding in supported)
    return ScopedBranch(branch_id=branch.id, requested=branch.hypothesis, status=status,
                        supported_scope=scope, scope_qualifier=SCOPE_QUALIFIER if scope else '',
                        uncertainties=tuple(uncertainties), next_tests=tuple(next_tests),
                        evidence_ids=tuple(o.id for o in successful))


def derive_claim_scope(state: MissionState) -> ClaimScope:
    """Pure derivation from the state; the same state always yields the same scope."""
    latest = latest_assessments(state)
    branches = tuple(scope_branch(branch, state, latest) for branch in state.branches)
    counts = {status: sum(1 for b in branches if b.status == status)
              for status in ('provisionally_supported', 'contradicted', 'unresolved', 'unassessed')}
    return ClaimScope(derivation_version=DERIVATION_VERSION, branches=branches, counts=counts,
                      basis_round=state.round,
                      rule='A narrower conclusion is a valid research output. Nothing above is scientific validation; '
                           'provisional support is bounded to the exploratory split and needs independent data.')
