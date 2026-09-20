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

DERIVATION_VERSION = 'arc-claim-scope-2'
ROLES = ('analyst', 'falsifier')
SCOPE_QUALIFIER = 'on the exploratory validation split of the frozen dataset; not independent data'


CAUTION = ('challenge', 'uncertain', 'support')


def latest_assessments(state: MissionState) -> dict[tuple[str, str], object]:
    """The assessment that stands per (role, branch): the latest round wins, and when
    one role recorded several positions in that round the most cautious one stands,
    so provider-controlled ordering can never hide a challenge."""
    rounds = {}
    for assessment in state.assessments:
        key = (assessment.role, assessment.branch_id)
        if key not in rounds or assessment.round > rounds[key][0].round:
            rounds[key] = [assessment]
        elif assessment.round == rounds[key][0].round:
            rounds[key].append(assessment)
    return {key: min(group, key=lambda a: CAUTION.index(a.position)) for key, group in rounds.items()}


def identity_verified(state: MissionState, role: str, round: int) -> bool:
    """False only when the role's record for that round carries transport provenance
    that says the identity was not observed; records without provenance are the
    scripted or HTTP seats, whose identity is checked inline."""
    for record in state.model_records:
        if record.role == role and record.round == round and record.transport:
            return record.transport.get('identity_verified', True) is not False
    return True


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
    identities = {positions[role].model for role in present}
    if len(present) == 2 and len(identities) == 1 and stances == {'support'}:
        # Two invocations of one model are not two independent reviewers.
        uncertainties.append(ClaimUncertainty(reason='shared_identity', role=None,
                                              detail='Both roles ran as the same model identity (' + next(iter(identities))[:120]
                                                     + '); separate invocations are not independent reviewers.'))
    # A transport that cannot report which model answered (Codex) leaves the identity
    # requested-only; such a role cannot count as an independent identity.
    unverified = [role for role in present if not identity_verified(state, role, positions[role].round)]
    for role in unverified:
        uncertainties.append(ClaimUncertainty(reason='unverified_identity', role=role,
                                              detail='The ' + role + ' ran through a transport that does not report the model '
                                                     'that answered; its identity is requested-only, not observed.'))
    if not successful or not present:
        status = 'unassessed'
    elif len(present) == 2 and stances == {'support'} and len(identities) == 2 and not unverified:
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
    counts['without_next_test'] = sum(1 for b in branches if not b.next_tests)
    return ClaimScope(derivation_version=DERIVATION_VERSION, branches=branches, counts=counts,
                      basis_round=state.round,
                      rule='A narrower conclusion is a valid research output. Nothing above is scientific validation; '
                           'provisional support is bounded to the exploratory split, needs two independent '
                           'reviewer identities and still needs independent data.')
