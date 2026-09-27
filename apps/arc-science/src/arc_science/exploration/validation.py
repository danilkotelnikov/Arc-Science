"""The validation ladder (contract C5, decision D010): how far each claim's evidence has
been checked, derived from persisted evidence only.

    L0 asserted     model text only
    L1 traced       evidence exists and is recorded, every number in the supported scope
                    binds to the recorded field its quantity word names, the run passes a
                    fidelity audit, and no work the claim cites is retracted (OpenAlex
                    is_retracted, recorded by the public read under its own grant)
    L2 recomputed   the replay verification receipt passed for the current subject
    L3 prespecified the branch's measurable falsifier was committed before the first
                    observation of any request the claim uses, on any branch
    L4 severe       permutation controls reject the null at ALPHA for fits of their degree,
                    no control on the branch is beaten, and no measurement of the falsifier
                    on the branch refutes it
    L5 replicated   an external result; attaching one is not built yet, so always a need

A rung counts only when every rung below it holds. No condition reads a seat's position:
agreement between the reviewer and the falsifier never raises a rung. Pure: no I/O, and
the inputs are never mutated. None of this is scientific validation.
"""
from __future__ import annotations

from decimal import Decimal
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
# The significance level a permutation control must reach. The control records only its
# best shuffle, so the bound (b+1)/(N+1) is known only for b = 0: 1/(N+1).
ALPHA = .05
# permutation_control refits this degree on every shuffle (tools.py); only fits of the same
# degree share its statistic.
CONTROL_DEGREE = 2
# Every digit run, with any unit or multiplier suffix (12nM, 40x, 4242ms) and a leading dot
# (.03). A run glued to a letter or dot, or to a hyphen after a letter, is part of a name
# (IL-6, p53, v1.2); after a digit and a hyphen it is the upper end of a range (0.01-0.5).
NUMBER = re.compile(r'(?<![\w.])(?<![A-Za-z_]-)(-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?)([A-Za-z%]*)(?!\d|\.\d)')
SCALAR = re.compile(r'-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?')
# Suffixes that make a digit run a name, not a quantity: 2D, 3D.
NAME_SUFFIXES = frozenset({'d'})
# A written number binds only within this relative distance of the recorded value, on top of
# matching it at the precision written: '1' never binds 1.199 and '0' never binds 0.004.
RELATIVE = Decimal('.05')
# DOIs, links and PubMed ids are identifiers, not stated quantities.
IDENTIFIER = re.compile(r'https?://\S+|\b10\.\d{4,9}/\S+|\bPMID:?\s*\d+|\bPMC\d+', re.I)
DOI = re.compile(r'\b10\.\d{4,9}/\S+')
# Closing delimiters a citation may wrap a DOI in, and the opener each one balances.
CLOSERS = {')': '(', ']': '[', '}': '{', '>': '<'}
TRAILING = '.,;:"\'\u201d\u2019\u00bb'
PMID = re.compile(r'\bPMID:?\s*(\d+)', re.I)
MSE = ('training_mse', 'validation_mse', 'minimum_shuffled_validation_mse', 'mean_shuffled_validation_mse')
# The recorded fields a quantity word names. The name nearest a number, within its sentence and
# between its neighbouring numbers, decides what it must bind to (the one before it on a tie,
# the longest at the same place); a p-value is never recorded, so it never binds. A number no quantity
# word names binds nothing: R-squared or accuracy must not borrow an unrelated recorded field.
QUANTITIES = ((re.compile(r'shuffled (?:validation )?(?:error|mse|loss)|null (?:error|mse)', re.I), MSE[2:]),
              (re.compile(r'(?:validation|held[- ]out|test) (?:error|mse|loss)', re.I), ('validation_mse',)),
              (re.compile(r'train(?:ing)? (?:error|mse|loss)', re.I), ('training_mse',)),
              (re.compile(r'\b(?:mse|error|loss)\b', re.I), MSE),
              (re.compile(r'\bdegrees?\b', re.I), ('degree',)),
              (re.compile(r'\b(?:permutations?|shuffles)\b', re.I), ('permutations',)),
              (re.compile(r'\bp(?:[- ]?value)?\s*[=<>≤]', re.I), ()))


SENTENCE = re.compile(r'[.;!?](?:\s|$)')
RANGE = ('-', '–', '—')


def _quantity(window, after=False):
    """(distance to the number, fields) of the quantity word nearest the number: the last
    one in a window before it, the first one in a window after it; None when there is none."""
    best = None
    for pattern, fields in QUANTITIES:
        for m in pattern.finditer(window):
            key = (m.start(), -m.end()) if after else (len(window) - m.end(), m.start())
            if best is None or key < best[0]:
                best = key, fields
    return (best[0][0], best[1]) if best else None


def _tokens(text):
    """(number, the recorded fields its nearest quantity word names, or None) per number."""
    text = IDENTIFIER.sub(' ', text)
    found = [m for m in NUMBER.finditer(text) if m.group(2).lower() not in NAME_SUFFIXES]
    names = None
    for i, m in enumerate(found):
        before = SENTENCE.split(text[found[i - 1].end() if i else 0:m.start()])[-1]
        after = SENTENCE.split(text[m.end():found[i + 1].start() if i + 1 < len(found) else len(text)])[0]
        # The upper end of a range (0.01-0.5) is the same quantity as its lower end. Otherwise
        # the nearer name wins; at equal distance the one before the number.
        if not (i and before in RANGE):
            named = min((q for q in (_quantity(before), _quantity(after, after=True)) if q), key=lambda q: q[0], default=None)
            names = named[1] if named else None
        yield m.group(1), names


def numbers(texts) -> list[str]:
    return [token for text in texts for token, _ in _tokens(text)]


def _fields(evidence, names):
    """The named top-level recorded scalars of the evidence; an unnamed number (None) binds
    nothing. Arrays and nested records (coefficients, predictions, literature records) never bind."""
    for o in evidence:
        for key, value in o.data.items():
            if key not in (names or ()) or isinstance(value, bool):
                continue
            if isinstance(value, (int, float)):
                yield value
            elif isinstance(value, str) and SCALAR.fullmatch(value.strip()):
                yield float(value)


def _binds(token, values) -> bool:
    """The token equals a recorded value at the precision it was written with, and within
    RELATIVE of it. A token too large or too small for decimal arithmetic (1e1000000) never
    binds: claim text is model output and must not be able to raise here."""
    try:
        written = Decimal(token)
        tolerance = Decimal(5).scaleb(written.as_tuple().exponent - 1)
        for v in values:
            recorded = Decimal(repr(float(v)))
            gap = abs(recorded - written)
            if gap <= tolerance and gap <= RELATIVE * abs(recorded):
                return True
    except ArithmeticError:
        return False
    return False


def _row(timeline_rows, action_id):
    row = None
    for candidate in timeline_rows:
        if candidate.get('operation') == 'tool' and candidate.get('action_id') == action_id \
                and candidate.get('outcome_source') == 'recorded':
            row = candidate
    return row


def _predates_timeline(timeline_rows, observation):
    """No tool row at or before the observation's round: the read ran before the timeline and
    the grant ledger existed (public reads from 2026-09-08, receipts from 2026-09-21), or the
    timeline is gone, which never invalidates a mission (timeline.py)."""
    return not any(r.get('operation') == 'tool' and isinstance(r.get('round'), int) and r['round'] <= observation.round
                   for r in timeline_rows)


def _traced(state, evidence, timeline_rows):
    """The hash-chained event log records each observation as ok. A timeline row, when one
    exists, must agree, and an external read needs its grant-ledger receipt on that row.
    Without the timeline (None) an external receipt cannot be checked; a read older than the
    timeline has none to check and is reported as such."""
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
            if row is None and timeline_rows is not None and _predates_timeline(timeline_rows, o):
                extra.append('receipt_predates_timeline')
                continue
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


def _doi(text):
    """A cited DOI without the punctuation, quotes or unbalanced brackets around it."""
    doi = text.lower()
    while doi and (doi[-1] in TRAILING or doi[-1] in CLOSERS and doi.count(doi[-1]) > doi.count(CLOSERS[doi[-1]])):
        doi = doi[:-1]
    return doi


def _retraction(scoped, evidence):
    """TRACES style: every work the claim cites (a DOI or PMID in its supported scope) was
    checked by a completed OpenAlex lookup of a literature read the claim uses, and none is
    retracted. A search hit the claim does not cite is not a citation."""
    cited = {_doi(m.group()) for text in scoped.supported_scope for m in DOI.finditer(text)}
    pmids = {m.group(1) for text in scoped.supported_scope for m in PMID.finditer(text)}
    if not cited and not pmids:
        return None
    checked, retracted, resolved = set(), set(), set()
    for o in evidence:
        if o.tool != 'literature_search':
            continue
        for record in o.data.get('records') or ():
            pmid = str(record.get('pmid') or '') if isinstance(record, dict) else ''
            if pmid in pmids and isinstance(record.get('doi'), str) and record['doi'].strip():
                cited.add(record['doi'].strip().lower())
                resolved.add(pmid)
        check = o.data.get('retraction_check')
        if isinstance(check, dict) and check.get('status') == 'ok':
            checked.update(check.get('checked') or ())
            retracted.update(check.get('retracted') or ())
    if cited & retracted:
        return 'retracted_source'
    return 'retraction_unchecked' if pmids - resolved or not cited <= checked else None


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
    its commit event precedes the first observation of any request the claim uses: the same
    tool and arguments on the same dataset, on any branch. The tools are deterministic, so a
    rerun under a new id or branch shows nothing the planner had not already seen."""
    if branch.falsifier_test is None:
        return 'falsifier_test_missing'
    introduced = next((r for r in sorted((r for r in state.model_records if r.role == 'planner'), key=lambda r: r.round)
                       if any(b.get('id') == branch.id for b in r.payload.get('branches') or ())), None)
    idea = next((b for b in introduced.payload['branches'] if b.get('id') == branch.id), {}) if introduced else {}
    if idea.get('falsifier_test') != branch.falsifier_test.model_dump(mode='json'):
        return 'falsifier_after_observation'
    events = list(state.events)
    committed = next((i for i, e in enumerate(events) if e.kind == 'plan_committed' and e.round == introduced.round), None)
    request = lambda o: (o.tool, digest(o.action.arguments), o.dataset_digest)
    requests = {request(o) for o in evidence}
    used = {o.id + ': ok' for o in state.observations if request(o) in requests}
    first = next((i for i, e in enumerate(events) if e.kind == 'observation' and e.detail in used), None)
    if committed is None or first is None or committed > first:
        return 'falsifier_after_observation'
    return None


def _falsifier(state, branch, evidence):
    """Every measurement of the falsifier's metric on the branch or in the claim's evidence
    counts: a refutation stands however many later observations survive it, and leaving it
    out of the claim's evidence does not hide it. The fact reports the most adverse value."""
    test = branch.falsifier_test
    if test is None:
        return 'falsifier_not_evaluated', None
    pool = {o.id: o for o in evidence}
    pool.update({o.id: o for o in state.observations if o.branch_id == branch.id and o.status == 'ok' and o.claim_eligible})
    values = [o.data[test.metric] for o in pool.values() if o.tool == test.tool
              and isinstance(o.data.get(test.metric), (int, float)) and not isinstance(o.data.get(test.metric), bool)]
    if not values:
        return 'falsifier_not_evaluated', None
    value = max(values) if test.direction == 'above' else min(values)
    refuted = value > test.threshold if test.direction == 'above' else value < test.threshold
    fact = {**test.model_dump(mode='json'), 'value': value, 'refuted': refuted, 'measurements': len(values)}
    return ('falsifier_refuted' if refuted else None), fact


def _null(state, branch, evidence):
    """NxN style null model: every fit of the control's degree in the claim's evidence beats
    every shuffled-response fit of every control on the branch or in the evidence, and the
    largest control ran enough shuffles for that to reach ALPHA. As with the falsifier, an
    adverse control stands however many later ones pass, and leaving it out of the evidence
    does not hide it; a control too small to reach ALPHA is uninformative, not adverse. A fit
    of another degree has no null here: its statistic was never computed on shuffled data."""
    pool = {o.id: o for o in evidence if o.tool == 'permutation_control'}
    pool.update({o.id: o for o in state.observations if o.tool == 'permutation_control' and o.branch_id == branch.id
                 and o.status == 'ok' and o.claim_eligible})
    fits = [o for o in evidence if o.tool == 'polynomial_fit']
    if not pool or not fits:
        return 'null_model_missing', None
    matched = [o.data['validation_mse'] for o in fits if o.data.get('degree') == CONTROL_DEGREE]
    if not matched:
        return 'null_model_mismatch', None
    controls = [o.data for o in pool.values() if (o.data.get('permutations') or 0) > 0
                and isinstance(o.data.get('minimum_shuffled_validation_mse'), (int, float))]
    if not controls:
        return 'null_model_missing', None
    shuffled = min(c['minimum_shuffled_validation_mse'] for c in controls)
    permutations = max(c['permutations'] for c in controls)
    bound = 1 / (permutations + 1) if max(matched) < shuffled else None
    fact = {'permutations': permutations, 'alpha': ALPHA, 'degree': CONTROL_DEGREE, 'statistic': 'validation_mse',
            'permutation_bound': bound, 'worst_fit_validation_mse': max(matched), 'minimum_shuffled_validation_mse': shuffled,
            'controls': len(controls)}
    return (None if bound is not None and bound <= ALPHA else 'null_not_rejected'), fact


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
    unbound = any(not _binds(token, list(_fields(evidence, names)))
                  for text in scoped.supported_scope for token, names in _tokens(text))
    survived, falsifier = _falsifier(state, branch, evidence)
    rejected, null = _null(state, branch, evidence)
    outcomes = {'evidence_present': None if evidence else 'no_evidence',
                'observations_traced': traced,
                'numbers_bound': 'unbound_number' if unbound else None,
                'fidelity_audit': _fidelity(state, evidence),
                'no_retracted_source': _retraction(scoped, evidence),
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
