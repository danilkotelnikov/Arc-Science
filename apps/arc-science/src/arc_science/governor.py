"""Acceptance rules are outside the model. Mechanical receipts are trusted-runtime inputs."""
from __future__ import annotations
from collections import Counter
from .contracts import Candidate, Check, Decision, Review, Seat

MECHANICAL = frozenset({'numerical', 'geometry', 'provenance'})
VISUAL = frozenset({'visual_clarity', 'caption_alignment'})

def assess(candidate: Candidate, seats: tuple[Seat,...] | list[Seat],
           reviews: tuple[Review,...] | list[Review], mechanical: tuple[Check,...] | list[Check],
           *, now: int) -> Decision:
    reasons: list[str] = []
    known = {s.seat_id:s for s in seats}
    if len(known)!=len(seats):
        reasons.append('duplicate_registry_seat')
    if not candidate.render_digests:
        reasons.append('no_rendered_views')
    if any(a.role=='render' and a.media_type not in {'image/png','image/jpeg'} for a in candidate.artifacts):
        reasons.append('unrasterized_visual_artifact')
    evidence = {a.digest for a in candidate.artifacts} | set(candidate.evidence_digests) | {candidate.digest}

    def check_set(checks, required, prefix, allowed):
        names=[c.criterion for c in checks]
        if set(names)!=required or len(names)!=len(required):
            reasons.append(prefix+':criterion_coverage')
        for check in checks:
            if check.status!='pass': reasons.append(prefix+':'+check.criterion+':'+check.status)
            if not check.evidence_digests or not set(check.evidence_digests)<=allowed:
                reasons.append(prefix+':'+check.criterion+':unbound_evidence')

    check_set(mechanical, MECHANICAL, 'runtime', evidence)
    # Runtime receipts must bind the full immutable candidate (including policy and
    # source dependencies), not just a still-existing image or dataset.
    for check in mechanical:
        if candidate.digest not in check.evidence_digests:
            reasons.append('runtime:'+check.criterion+':candidate_binding_missing')
    if len(reviews)<2:
        reasons.append('insufficient_reviews')
    counts=Counter(r.seat_id for r in reviews)
    if any(n!=1 for n in counts.values()): reasons.append('duplicate_reviewer')
    groups=set()
    for review in reviews:
        prefix=review.seat_id
        seat=known.get(review.seat_id)
        if seat is None:
            reasons.append(prefix+':unregistered');continue
        if seat.seat_id==candidate.producer_id: reasons.append(prefix+':self_review')
        if not seat.vision or seat.qualification_expires_at<=now:
            reasons.append(prefix+':unqualified_or_expired')
        if review.observed_model!=seat.model: reasons.append(prefix+':model_mismatch')
        if review.candidate_digest!=candidate.digest: reasons.append(prefix+':stale_candidate')
        if review.policy_digest!=candidate.policy_digest: reasons.append(prefix+':policy_mismatch')
        if set(review.reviewed_digests)!=candidate.render_digests:
            reasons.append(prefix+':view_coverage')
        if len(review.reviewed_digests)!=len(set(review.reviewed_digests)):
            reasons.append(prefix+':duplicate_view')
        check_set(review.checks, VISUAL, prefix, candidate.render_digests)
        if any(f.severity in {'blocking','major'} for f in review.findings):
            reasons.append(prefix+':unresolved_finding')
        groups.add(seat.group)
    if len(groups)<2: reasons.append('insufficient_independent_groups')
    return Decision(eligible=not reasons,
                    status='blocked' if reasons else 'eligible_for_human_review',
                    reasons=tuple(sorted(set(reasons))))
