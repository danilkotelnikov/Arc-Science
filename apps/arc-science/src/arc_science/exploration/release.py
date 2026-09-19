"""The mission release ledger: named checks with explicit states and a fail-closed
decision that every export path consults.

A check answers one question about the mission and remembers the digest of what it
looked at. `satisfied` and a justified `not_applicable` are the only states that do
not block; `unknown` (never checked) and `error` (the checker could not run) are never
converted into satisfaction; `failed` is a scientific or contract negative; `stale`
means the mission changed after the check. Eligibility means "eligible for human
review", never validated and never publication.
"""
from __future__ import annotations

import time

from ..contracts import digest
from .models import (CheckState, MissionCheck, MissionRequest, MissionState, ReleaseCheck,
                     ReleaseDecision, VerificationReceipt)

POLICY = {'version': 'arc-mission-release-1',
          'checks': ['operational_status', 'event_chain_integrity', 'replay_integrity',
                     'numerical_reproduction', 'artifact_reproduction', 'evidence_graph',
                     'reconciliation', 'visual_review'],
          'verifier': 'arc-mission-verifier-1'}
POLICY_DIGEST = digest(POLICY)
BLOCKING = ('failed', 'unknown', 'error', 'stale')


class ReleaseBlocked(PermissionError):
    def __init__(self, reasons):
        super().__init__('Release blocked: ' + '; '.join(reasons))
        self.reasons = tuple(reasons)


def subject_digest(state: MissionState) -> str:
    """Everything a replay verification reads: the state minus its own ledger and log."""
    return digest(state.model_dump(mode='json', exclude={'release', 'events'}))


def check_basis(name: MissionCheck, request: MissionRequest, state: MissionState) -> str:
    """The exact dependencies of one check, so staleness is per check, not per mission."""
    if name == 'operational_status':
        return digest({'status': state.status})
    if name == 'reconciliation':
        return digest({'branches': [b.id for b in state.branches],
                       'observations': [o.model_dump(mode='json') for o in state.observations],
                       'assessments': [a.model_dump(mode='json') for a in state.assessments]})
    if name == 'visual_review':
        return digest({'requested': request.vision_review,
                       'artifacts': [a.digest for a in state.artifacts],
                       'reports': [r.model_dump(mode='json') for r in state.visual_reports],
                       'records': [r.model_dump(mode='json') for r in state.vision_records]})
    return subject_digest(state)


def _check(name, state: CheckState, basis, reason, evidence=()):
    return ReleaseCheck(name=name, state=state, checked_basis_digest=basis, reason=reason,
                        evidence_digests=tuple(evidence))


def _operational(state):
    status = state.status
    if status in ('completed', 'budget_exhausted'):
        return 'satisfied', 'Mission finished as ' + status + '.'
    if status == 'cancelled':
        return 'failed', 'Mission was cancelled; late results were fenced.'
    if status == 'error':
        return 'error', 'Mission ended in an operational error; nothing was inferred.'
    return 'unknown', 'Mission is ' + status + '; it has not finished.'


def _reconciliation(state):
    evidenced = {o.branch_id for o in state.observations}
    if not evidenced:
        return 'not_applicable', 'No branch has an observation yet, so there is nothing to reconcile.', ()
    latest = {}
    for a in state.assessments:
        key = (a.role, a.branch_id)
        if key not in latest or a.round >= latest[key].round:
            latest[key] = a
    missing = sorted(f'{role}:{branch}' for branch in evidenced for role in ('analyst', 'falsifier')
                     if (role, branch) not in latest)
    if missing:
        return 'unknown', 'Independent roles have not assessed every evidence-bearing branch: ' + ', '.join(missing)[:600], ()
    return 'satisfied', 'Analyst and falsifier assessed every evidence-bearing branch; positions are recorded, not scored.', ()


def _visual(request, state):
    if not request.vision_review:
        return 'not_applicable', 'Visual review was not requested for this mission.', ()
    if not state.artifacts:
        return 'not_applicable', 'Visual review was requested but the mission produced no artifacts.', ()
    if any(r.status == 'rejected' for r in state.vision_records):
        return 'error', 'A visual review call was rejected or malformed; no verdict can be inferred from it.', ()
    reviewed = {}
    for report in state.visual_reports:
        for d in report.reviewed_digests:
            reviewed[d] = report.verdict
    verdicts = [reviewed.get(a.digest) for a in state.artifacts]
    if any(v is None for v in verdicts):
        return 'unknown', 'Not every artifact has a bound visual review.', ()
    if any(v in ('issues', 'uncertain') for v in verdicts):
        return 'failed', 'A visual review returned issues or could not assess the artifact.', tuple(a.digest for a in state.artifacts)
    return 'satisfied', 'Every artifact has a bound review that found it adequate.', tuple(a.digest for a in state.artifacts)


def _replay(name, receipt: VerificationReceipt | None, current_subject, state):
    if receipt is None:
        return 'unknown', 'Replay verification has not been run for this mission.', ()
    if receipt.subject_digest != current_subject:
        return 'stale', 'The mission changed after the last replay verification; verify again.', ()
    evidence = (receipt.report_digest,)
    if name == 'replay_integrity':
        return ('satisfied', 'Capsule members, manifest and runtime contract verified.', evidence) if receipt.integrity \
            else ('failed', 'Capsule integrity failed: ' + '; '.join(receipt.failures)[:500], evidence)
    if name == 'evidence_graph':
        return ('satisfied', 'The evidence graph is well formed.', evidence) if receipt.evidence_graph_valid \
            else ('failed', 'The evidence graph is invalid.', evidence)
    if name == 'numerical_reproduction':
        replayable = [o for o in state.observations if o.status == 'ok' and o.tool in ('polynomial_fit', 'permutation_control', 'describe_data')]
        if not replayable:
            return 'not_applicable', 'No replayable numerical observation exists in this mission.', evidence
        return ('satisfied', f'{receipt.reproduced} numerical analyses recomputed within tolerance.', evidence) if receipt.reproduction_passed \
            else ('failed', 'Recomputation disagreed: ' + '; '.join(receipt.failures)[:500], evidence)
    if name == 'artifact_reproduction':
        if not state.artifacts:
            return 'not_applicable', 'The mission produced no artifacts to reproduce.', evidence
        return ('satisfied', f'{receipt.artifacts_reproduced} artifacts reproduced byte for byte.', evidence) \
            if receipt.artifacts_reproduced == len(state.artifacts) and receipt.reproduction_passed \
            else ('failed', 'Not every artifact was reproduced from recorded inputs.', evidence)
    raise ValueError(name)


def evaluate_release(request: MissionRequest, state: MissionState, verification: VerificationReceipt | None,
                     *, event_chain_ok: bool | None) -> ReleaseDecision:
    """Compute the current decision. Pure: it never turns an old unknown into satisfied."""
    subject = subject_digest(state)
    checks = []

    def add(name, outcome):
        st, reason, evidence = (outcome + ((),))[:3] if len(outcome) == 2 else outcome
        checks.append(_check(name, st, check_basis(name, request, state), reason, evidence))

    add('operational_status', _operational(state))
    if event_chain_ok is None:
        add('event_chain_integrity', ('unknown', 'The repository event chain was not checked.'))
    elif event_chain_ok:
        add('event_chain_integrity', ('satisfied', 'The mission event chain hashes verified.'))
    else:
        add('event_chain_integrity', ('failed', 'The mission event chain is broken.'))
    for name in ('replay_integrity', 'numerical_reproduction', 'artifact_reproduction', 'evidence_graph'):
        add(name, _replay(name, verification, subject, state))
    add('reconciliation', _reconciliation(state))
    add('visual_review', _visual(request, state))
    blocking = tuple(f'{c.name}:{c.state}' for c in checks if c.state in BLOCKING)
    return ReleaseDecision(policy_digest=POLICY_DIGEST, subject_digest=subject,
                           status='blocked' if blocking else 'eligible_for_human_review',
                           eligible_for_human_review=not blocking, checks=tuple(checks),
                           blocking_reasons=blocking, verification=verification, decided_at=int(time.time()))


def receipt_from_report(report: dict, state: MissionState) -> VerificationReceipt:
    return VerificationReceipt(subject_digest=subject_digest(state), report_digest=digest(report),
                               integrity=bool(report.get('integrity')),
                               reproduction_passed=bool(report.get('reproduction_passed')),
                               evidence_graph_valid=bool(report.get('evidence_graph_valid')),
                               reproduced=int(report.get('reproduced') or 0),
                               artifacts_reproduced=int(report.get('artifacts_reproduced') or 0),
                               failures=tuple(str(f)[:200] for f in (report.get('failures') or ())[:20]),
                               verified_at=int(time.time()))


def current_decision(request: MissionRequest, state: MissionState, *, event_chain_ok: bool | None) -> ReleaseDecision:
    """Re-evaluate against the persisted verification receipt, keeping a declared
    invalidation (a stale mark whose basis has not changed) until a fresh verification
    replaces the ledger."""
    persisted = state.release
    receipt = persisted.verification if persisted else None
    fresh = evaluate_release(request, state, receipt, event_chain_ok=event_chain_ok)
    if persisted is None:
        return fresh
    stale = {c.name: c for c in persisted.checks if c.state == 'stale'}
    checks = tuple(stale[c.name] if c.name in stale and stale[c.name].checked_basis_digest == c.checked_basis_digest else c
                   for c in fresh.checks)
    blocking = tuple(f'{c.name}:{c.state}' for c in checks if c.state in BLOCKING)
    return fresh.model_copy(update={'checks': checks, 'blocking_reasons': blocking,
                                    'status': 'blocked' if blocking else 'eligible_for_human_review',
                                    'eligible_for_human_review': not blocking})


def invalidate_release(decision: ReleaseDecision, affected, reason: str) -> ReleaseDecision:
    """Mark named checks stale (never satisfied) after a declared change."""
    affected = set(affected)
    checks = tuple(c.model_copy(update={'state': 'stale', 'reason': reason}) if c.name in affected and c.state != 'not_applicable' else c
                   for c in decision.checks)
    blocking = tuple(f'{c.name}:{c.state}' for c in checks if c.state in BLOCKING)
    return decision.model_copy(update={'checks': checks, 'blocking_reasons': blocking,
                                       'status': 'blocked' if blocking else 'eligible_for_human_review',
                                       'eligible_for_human_review': not blocking, 'decided_at': int(time.time())})


def assert_exportable(request: MissionRequest, state: MissionState, *, event_chain_ok: bool | None) -> ReleaseDecision:
    decision = current_decision(request, state, event_chain_ok=event_chain_ok)
    if not decision.eligible_for_human_review:
        raise ReleaseBlocked(decision.blocking_reasons)
    return decision
