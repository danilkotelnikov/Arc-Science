"""The validation ladder (contract C5, decision D010): how far each claim's evidence has
been checked, derived from persisted evidence only.

    L0 asserted     model text only
    L1 traced       evidence exists and is recorded, every number in the supported scope
                    binds to it, the run passes a fidelity audit, and no cited work is
                    retracted (OpenAlex is_retracted, recorded by the public read)
    L2 recomputed   the replay verification receipt passed for the current subject
    L3 prespecified the branch's measurable falsifier was committed before the first
                    observation the claim uses
    L4 severe       a permutation control on the branch rejects the null at ALPHA, and the
                    falsifier was evaluated against its threshold and survived
    L5 replicated   an external result; attaching one is not built yet, so always a need

A rung counts only when every rung below it holds. No condition reads a seat's position:
agreement between the reviewer and the falsifier never raises a rung. Pure: no I/O, and
the inputs are never mutated. None of this is scientific validation.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
import re

from ..contracts import digest
from .catalog import BIORENDER_CATALOG, BUILTIN_CATALOG, NUMERICAL_CATALOG
from .models import Action, MissionState, ScopedBranch, VerificationReceipt

NAMES = ('asserted', 'traced', 'recomputed', 'prespecified', 'severe', 'replicated')
# The conditions of each rung; each is met or answered by exactly one need code.
RUNGS = {1: ('evidence_present', 'observations_traced', 'numbers_bound', 'fidelity_audit', 'no_retracted_source'),
         2: ('recomputed',),
         3: ('falsifier_prespecified',),
         4: ('null_rejected', 'falsifier_survived'),
         5: ('external_replication',)}
# Needs that record a defect in the evidence rather than a step not yet taken.
DEFECTS = frozenset({'observation_unrecorded', 'timeline_not_ok', 'receipt_missing', 'unbound_number',
                     'retracted_source', 'action_mismatch', 'oracle_substitution', 'unregistered_tool',
                     'data_shrinkage', 'budget_shrinkage', 'recomputation_failed'})
# The significance level a permutation control must reach. With the fixed seed and no
# tie data the attainable p-value is 1/(N+1), reached only when every shuffle fits worse.
ALPHA = .05
NUMBER = re.compile(r'(?<![\w.\-])-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?(?![A-Za-z_\d]|\.\d)')
# Rendered prediction rows are too dense to bind a stated number to anything by chance.
UNBINDABLE = frozenset({'predictions'})


# DOIs and links are identifiers, not stated quantities.
IDENTIFIER = re.compile(r'https?://[^ ]+|10[.][0-9]{4,9}/[^ ]+')


def numbers(texts) -> list[str]:
    return [token for text in texts for token in NUMBER.findall(IDENTIFIER.sub(' ', text))]


def _values(value, key=None):
    if key in UNBINDABLE:
        return
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        yield value
    elif isinstance(value, str) and NUMBER.fullmatch(value.strip()):
        yield float(value)
    elif isinstance(value, dict):
        for k, v in value.items():
            yield from _values(v, k)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from _values(v)


def _binds(token, values) -> bool:
    """The token equals a recorded value at the precision it was written with."""
    try:
        written = Decimal(token)
    except InvalidOperation:
        return False
    tolerance = Decimal(5).scaleb(written.as_tuple().exponent - 1)
    return any(abs(Decimal(repr(float(v))) - written) <= tolerance for v in values)


def _row(timeline_rows, action_id):
    row = None
    for candidate in timeline_rows:
        if candidate.get('operation') == 'tool' and candidate.get('action_id') == action_id \
                and candidate.get('outcome_source') == 'recorded':
            row = candidate
    return row


def _traced(state, evidence, timeline_rows):
    """The hash-chained event log records each observation as ok. A timeline row, when one
    exists, must agree, and an external read needs its grant-ledger receipt on that row.
    Without the timeline (None) an external receipt cannot be checked."""
    recorded = {e.detail for e in state.events if e.kind == 'observation'}
    extra = []
    for o in evidence:
        if o.id + ': ok' not in recorded:
            return 'observation_unrecorded', extra
        external = o.tool not in NUMERICAL_CATALOG
        row = _row(timeline_rows, o.id) if timeline_rows is not None else None
        if row is not None and row.get('outcome') != 'ok':
            return 'timeline_not_ok', extra
        if external:
            if row is None:
                return 'receipt_unchecked', extra
            if not row.get('receipt_id'):
                return 'receipt_missing', extra
            extra.append('ledger_receipt')
        if row is not None:
            extra.append('timeline_ok')
    return None, sorted(set(extra))


def _fidelity(state, evidence):
    """ABE-Ralph style audit: each observation ran the action the committed plan requested,
    on the frozen dataset, through a tool the mission offered, at the requested size."""
    plans = {}
    for record in state.model_records:
        if record.role == 'planner':
            plans.setdefault(record.round, record)
    n = len(state.points)
    for o in evidence:
        plan = plans.get(o.round)
        requested = [a for a in (plan.payload.get('actions') or ()) if a.get('id') == o.id] if plan else []
        try:
            asked = Action.model_validate(requested[0]) if requested else None
        except ValueError:
            asked = None
        if asked is None or asked != o.action or o.action.tool != o.tool or o.action.branch_id != o.branch_id:
            return 'action_mismatch'
        if o.dataset_digest != state.dataset_digest or \
                o.request_digest != digest([o.action.model_dump(mode='json'), o.dataset_digest]):
            return 'oracle_substitution'
        offered = plan.input_context.get('tools')
        if o.tool not in (offered if isinstance(offered, dict) else {**BUILTIN_CATALOG, **BIORENDER_CATALOG}):
            return 'unregistered_tool'
        data = o.data
        if o.tool == 'polynomial_fit' and data.get('n_train', 0) + data.get('n_validation', 0) != n:
            return 'data_shrinkage'
        if o.tool == 'describe_data' and data.get('n') != n:
            return 'data_shrinkage'
        if o.tool == 'permutation_control' and data.get('permutations') != o.action.arguments.get('permutations'):
            return 'budget_shrinkage'
    return None


def _retraction(evidence):
    """TRACES style: every literature read the claim uses carries a completed OpenAlex
    check, and no work it returned is retracted."""
    unchecked = False
    for o in evidence:
        if o.tool != 'literature_search':
            continue
        check = o.data.get('retraction_check')
        if not isinstance(check, dict) or check.get('status') != 'ok':
            unchecked = True
            continue
        if check.get('retracted'):
            return 'retracted_source'
        if check.get('unchecked'):
            unchecked = True
    return 'retraction_unchecked' if unchecked else None


def _recomputed(verification, subject):
    if verification is None or subject is None:
        return 'recomputation_missing'
    if verification.subject_digest != subject:
        return 'recomputation_stale'
    if not (verification.integrity and verification.reproduction_passed and verification.evidence_graph_valid):
        return 'recomputation_failed'
    return None


def _prespecified(state, branch, evidence):
    """The planner record that introduced the branch carries the same falsifier_test, and
    its commit event precedes the event of the first observation the claim uses."""
    if branch.falsifier_test is None:
        return 'falsifier_test_missing'
    introduced = next((r for r in sorted((r for r in state.model_records if r.role == 'planner'), key=lambda r: r.round)
                       if any(b.get('id') == branch.id for b in r.payload.get('branches') or ())), None)
    idea = next((b for b in introduced.payload['branches'] if b.get('id') == branch.id), {}) if introduced else {}
    if idea.get('falsifier_test') != branch.falsifier_test.model_dump(mode='json'):
        return 'falsifier_after_observation'
    events = list(state.events)
    committed = next((i for i, e in enumerate(events) if e.kind == 'plan_committed' and e.round == introduced.round), None)
    used = {o.id + ': ok' for o in evidence}
    first = next((i for i, e in enumerate(events) if e.kind == 'observation' and e.detail in used), None)
    if committed is None or first is None or committed > first:
        return 'falsifier_after_observation'
    return None


def _falsifier(branch, evidence):
    test = branch.falsifier_test
    if test is None:
        return 'falsifier_not_evaluated', None
    value = next((o.data[test.metric] for o in reversed(evidence) if o.tool == test.tool
                  and isinstance(o.data.get(test.metric), (int, float)) and not isinstance(o.data.get(test.metric), bool)), None)
    if value is None:
        return 'falsifier_not_evaluated', None
    refuted = value > test.threshold if test.direction == 'above' else value < test.threshold
    fact = {**test.model_dump(mode='json'), 'value': value, 'refuted': refuted}
    return ('falsifier_refuted' if refuted else None), fact


def _null(evidence):
    """NxN style null model: every fit on the branch beats every shuffled-response fit, and
    enough shuffles ran for that to reach ALPHA."""
    controls = [o for o in evidence if o.tool == 'permutation_control']
    fits = [o.data['validation_mse'] for o in evidence if o.tool == 'polynomial_fit']
    if not controls or not fits:
        return 'null_model_missing', None
    control = controls[-1].data
    permutations = control.get('permutations') or 0
    shuffled = control.get('minimum_shuffled_validation_mse')
    if not permutations or not isinstance(shuffled, (int, float)):
        return 'null_model_missing', None
    p_value = 1 / (permutations + 1) if max(fits) < shuffled else None
    fact = {'permutations': permutations, 'alpha': ALPHA, 'p_value': p_value,
            'worst_fit_validation_mse': max(fits), 'minimum_shuffled_validation_mse': shuffled}
    return (None if p_value is not None and p_value <= ALPHA else 'null_not_rejected'), fact


def is_numeric(state: MissionState, scoped: ScopedBranch) -> bool:
    used = set(scoped.evidence_ids)
    return bool(numbers(scoped.supported_scope)) or any(o.id in used and o.tool in NUMERICAL_CATALOG for o in state.observations)


def claim_ladder(state: MissionState, scoped: ScopedBranch, *, timeline_rows=None,
                 verification: VerificationReceipt | dict | None = None, subject: str | None = None) -> dict:
    """The ladder of one scoped claim. `timeline_rows` None means the timeline was not
    consulted; `subject` is the current release subject digest the receipt must match."""
    if isinstance(verification, dict):
        verification = VerificationReceipt.model_validate(verification)
    branch = next(b for b in state.branches if b.id == scoped.branch_id)
    used = set(scoped.evidence_ids)
    evidence = [o for o in state.observations if o.id in used and o.status == 'ok' and o.claim_eligible]
    traced, extra = _traced(state, evidence, timeline_rows)
    values = [v for o in evidence for v in _values(o.data)]
    unbound = any(not _binds(token, values) for token in numbers(scoped.supported_scope))
    survived, falsifier = _falsifier(branch, evidence)
    rejected, null = _null(evidence)
    outcomes = {'evidence_present': None if evidence else 'no_evidence',
                'observations_traced': traced,
                'numbers_bound': 'unbound_number' if unbound else None,
                'fidelity_audit': _fidelity(state, evidence),
                'no_retracted_source': _retraction(evidence),
                'recomputed': _recomputed(verification, subject),
                'falsifier_prespecified': _prespecified(state, branch, evidence),
                'null_rejected': rejected,
                'falsifier_survived': survived,
                'external_replication': 'external_replication'}
    rung = 0
    while rung < 5 and all(outcomes[code] is None for code in RUNGS[rung + 1]):
        rung += 1
    needs = [outcomes[code] for code in RUNGS[rung + 1] if outcomes[code]] if rung < 5 else []
    met = [code for code, need in outcomes.items() if need is None] + extra
    L1 = [outcomes[code] for code in RUNGS[1] if outcomes[code]]
    if any(need in DEFECTS for need in L1):
        verdict = 'blocked'
    elif scoped.status == 'unassessed':
        verdict = 'deferred'
    elif scoped.status == 'contradicted' or survived == 'falsifier_refuted':
        verdict = 'rejected'
    elif scoped.status == 'provisionally_supported':
        verdict = 'accepted' if rung >= 4 else 'qualified'
    else:
        verdict = 'revised'
    return {'rung': rung, 'name': NAMES[rung], 'met': met,
            'next': {'rung': rung + 1, 'needs': needs} if rung < 5 else None,
            'verdict': verdict, 'density': max(1, min(5, rung + 1)),
            'facts': {'falsifier': falsifier, 'null_model': null}}
