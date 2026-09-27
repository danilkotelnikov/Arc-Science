"""The validation ladder (contract C5, decisions D010 and D019): how far each claim's
evidence has been checked, derived from persisted evidence only.

    L0 asserted     model text only
    L1 traced       reference traceability: evidence exists and is recorded; every number token
                    {{<observation id>.<field>}} in the supported scope is traced to a recorded
                    value of an observation of the mission, and no numeral is typed outside a
                    token; every cited source {{<observation id>}} is a literature retrieval the
                    mission recorded; the run passes a fidelity audit; and every work each
                    retrieval in the evidence returned was checked by OpenAlex and none is
                    retracted. A name token {{name:<text>}} is the author's label for an
                    identifier with digits (p53, SARS-CoV-2) and is not checked.
    L2 recomputed   the replay verification receipt passed for the current subject, and every
                    observation a number token references is replayable
    L3 prespecified the branch's measurable falsifier sits in a planner record committed before
                    any successful numerical observation of the dataset, on any branch, and
                    before any observation of a request the claim uses; no earlier work or
                    operator note was in any planner input up to that record
    L4 severe       permutation controls reject the null at ALPHA for fits of their degree,
                    no control on the branch or in the evidence is beaten, and no measurement
                    of the falsifier on the branch or in the evidence refutes it
    L5 replicated   an external result; attaching one is not built yet, so always a need

Nothing in the prose is parsed for meaning (D019). L1 does not validate the words around a
reference: a unit or an adjective next to it is the author's. Numbers written as words are
outside the numeral check by definition, and a work named only in prose is not a source.
L3 cannot guarantee that the operator, who writes the goal before the mission starts, had not
seen the data elsewhere.

A reference resolves against the whole mission: the claim's branch evidence and every other
successful, claim-eligible observation with an ok timeline row (and, for an external read, its
receipt in the grant ledger). The claim's effective evidence is its branch evidence plus every
successful, claim-eligible observation its supported scope names, resolved or not, so a missing
row or receipt is reported as such and a retraction is still seen; tracing, fidelity, retraction,
prespecification, replayability and the falsifier and null checks read that one set. Only the
supported scope bears the rungs.

A rung counts only when every rung below it holds. No condition reads a seat's position:
agreement between the reviewer and the falsifier never raises a rung. Pure: no I/O, and
the inputs are never mutated. None of this is scientific validation.
"""
from __future__ import annotations

import math
import re
import unicodedata

from ..biorender import BIORENDER_ENDPOINT
from ..contracts import digest
from .catalog import BIORENDER_CATALOG, BUILTIN_CATALOG, NUMERICAL_CATALOG, PUBLIC_CATALOG, PUBLIC_READ_ORIGINS
from .models import Action, ContextItem, MissionState, ScopedBranch, VerificationReceipt

NAMES = ('asserted', 'traced', 'recomputed', 'prespecified', 'severe', 'replicated')
# The conditions of each rung; each is met or answered by exactly one need code.
RUNGS = {1: ('evidence_present', 'observations_traced', 'numbers_bound', 'fidelity_audit', 'no_retracted_source'),
         2: ('recomputed', 'references_replayable'),
         3: ('falsifier_prespecified',),
         4: ('null_rejected', 'falsifier_survived'),
         5: ('external_replication',)}
# Needs that record a defect in the evidence rather than a step not yet taken.
DEFECTS = frozenset({'observation_unrecorded', 'timeline_not_ok', 'receipt_missing', 'unresolved_reference',
                     'malformed_reference', 'literal_numeral', 'retracted_source', 'action_mismatch',
                     'oracle_substitution', 'unregistered_tool', 'data_shrinkage', 'budget_shrinkage',
                     'recomputation_failed'})
# The reference-grammar needs, the only ones a legacy mission's export waives (its claims predate references).
GRAMMAR = frozenset({'malformed_reference', 'unresolved_reference', 'literal_numeral'})
GUARANTEE = ('every number token in the supported scope is traced to a recorded value; '
             'name tokens are author-labelled identifiers and are not checked')
NOTE = ('L1 traced means reference traceability: ' + GUARANTEE + '. Each number is shown with its field name and '
        'observation id, and every cited source is a retrieval the mission recorded. The words around a reference, such '
        'as a unit or an adjective, are the author\'s and are not checked; a name token is the author\'s label, not a '
        'traced value; numbers written as words are outside the check; a work named only in prose is not a source.')
# The significance level a permutation control must reach. The control records only its
# best shuffle, so the bound (b+1)/(N+1) is known only for b = 0: 1/(N+1).
ALPHA = .05
# permutation_control refits this degree on every shuffle (tools.py); only fits of the same
# degree share its statistic.
CONTROL_DEGREE = 2
# The reference grammar: {{id.field}} a recorded number, {{id}} a recorded retrieval,
# {{name:text}} an identifier the author labels. No whitespace, no nesting; field is a
# top-level key of Observation.data. A name's characters are checked by _name.
TOKEN = re.compile(r'\{\{(?:name:([^\W_][\w-]*)|([A-Za-z0-9_-]+)(?:\.([A-Za-z0-9_-]+))?)\}\}')
FIELD = re.compile('[A-Za-z0-9_-]+')
LITERATURE = 'literature_search'


def _name(text):
    """A name: letters of any script, ASCII digits and hyphens, with at least one letter, so
    16S, 5-HT2A and TGF-β1 are names and a bare quantity such as 0-5 is not."""
    return any(ch.isalpha() for ch in text) and all(ch.isalpha() or ch in '0123456789-' for ch in text)


def _pairs(text, pair):
    return [i for i in range(len(text) - 1) if text[i:i + 2] == pair]


def parse(text: str) -> tuple[list[dict], bool]:
    """(segments, well formed): the one parser of the reference grammar. The text as typed
    segments in order, one per occurrence, that rebuild it exactly: {kind: text, text},
    {kind: number, text, observation_id, field}, {kind: source, text, observation_id} or
    {kind: name, text, value}. The text is malformed when any '{{' does not open a token or any
    '}}' does not close one: unmatched, nested, empty, spaced or other characters."""
    out, at = [], 0
    found = [m for m in TOKEN.finditer(text) if m.group(1) is None or _name(m.group(1))]
    for m in found:
        if m.start() > at:
            out.append({'kind': 'text', 'text': text[at:m.start()]})
        name, oid, field = m.groups()
        out.append({'kind': 'name', 'text': m.group(), 'value': name} if name is not None else
                   {'kind': 'number' if field else 'source', 'text': m.group(), 'observation_id': oid, 'field': field})
        at = m.end()
    if at < len(text):
        out.append({'kind': 'text', 'text': text[at:]})
    starts, ends = {m.start() for m in found}, {m.end() - 2 for m in found}
    well = all(i in starts for i in _pairs(text, '{{')) and all(i in ends for i in _pairs(text, '}}'))
    return out, well


def _numeral(ch):
    return ch.isdigit() or unicodedata.numeric(ch, None) is not None


def _typed(text):
    return any(_numeral(ch) for ch in text)


def literal_numerals(text: str) -> bool:
    """A numeral of any script (ASCII, fullwidth, superscript, fractions, Roman, CJK) outside
    the tokens; a name token's digits are the author's label. A number written as a word is
    not a numeral."""
    return any(_typed(segment['text']) for segment in parse(text)[0] if segment['kind'] == 'text')


def is_number(value) -> bool:
    """A recorded number a reference can show: an int or a finite float, never a bool."""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and (isinstance(value, int) or math.isfinite(value))


def members(state: MissionState, scoped: ScopedBranch) -> dict:
    """The claim's branch evidence as claim_scope derives it: successful, claim-eligible observations."""
    used = set(scoped.evidence_ids)
    return {o.id: o for o in state.observations if o.id in used and o.status == 'ok' and o.claim_eligible}


def lookup(state: MissionState, scoped: ScopedBranch, timeline_rows=None, receipts=None) -> dict:
    """What a reference can name, mission-wide: the claim's branch evidence and every other
    successful, claim-eligible observation with an ok timeline row and, for an external read,
    its receipt in the grant ledger. Without the timeline (None) only the branch evidence."""
    found = members(state, scoped)
    ledger = None if receipts is None else {r.get('id'): r for r in receipts}
    for o in state.observations:
        if o.id in found or o.status != 'ok' or not o.claim_eligible:
            continue
        row = _row(timeline_rows or (), o.id)
        if row is None or row.get('outcome') != 'ok':
            continue
        if o.tool not in NUMERICAL_CATALOG and (ledger is None or not _ledgered(ledger.get(row.get('receipt_id')), o)):
            continue
        found[o.id] = o
    return found


def referenced(texts, found: dict) -> dict:
    """The observations the texts' number and source tokens name, among those found."""
    return {s['observation_id']: found[s['observation_id']] for text in texts for s in parse(text)[0]
            if s['kind'] in ('number', 'source') and s['observation_id'] in found}


def named(state: MissionState, scoped: ScopedBranch) -> dict:
    """Every successful, claim-eligible observation of the mission the supported scope's number
    and source tokens name, whether or not the reference resolves: a missing timeline row or
    ledger receipt is then reported by tracing, and a retraction or a snapshot is still seen."""
    return referenced(scoped.supported_scope, {o.id: o for o in state.observations if o.status == 'ok' and o.claim_eligible})


def effective(state: MissionState, scoped: ScopedBranch) -> dict:
    """The claim's effective evidence: its branch evidence plus every observation its supported
    scope names."""
    return {**members(state, scoped), **named(state, scoped)}


def _works(observation):
    """Every work a literature retrieval returned (up to five), as the card names it."""
    works = []
    for record in observation.data.get('records') or ():
        record = record if isinstance(record, dict) else {}
        text = lambda key: str(record.get(key) or '').strip()[:300] or None
        works.append({'title': text('title'), 'doi': text('doi'), 'pmid': text('pmid'), 'id': text('id')})
    return works


def resolve(token: dict, found: dict) -> dict:
    """One token segment against what references can name: a number resolves to a recorded int
    or finite float field, a source to a literature retrieval and every work it returned, a name
    to itself (it is the author's label and is never checked)."""
    if token['kind'] == 'name':
        return {'token': token['text'], 'kind': 'name', 'observation_id': None, 'field': None, 'value': token['value'], 'resolved': True}
    oid, field = token['observation_id'], token['field']
    o = found.get(oid)
    if field is None:
        works = _works(o) if o is not None and o.tool == LITERATURE else None
        return {'token': token['text'], 'kind': 'source', 'observation_id': oid, 'field': None, 'value': works, 'resolved': works is not None}
    value = o.data.get(field) if o is not None else None
    ok = is_number(value)
    return {'token': token['text'], 'kind': 'number', 'observation_id': oid, 'field': field, 'value': value if ok else None, 'resolved': ok}


def _cite(work):
    ident = ('doi:' + work['doi']) if work['doi'] else ('PMID ' + work['pmid']) if work['pmid'] else work['id']
    return ' '.join(part for part in (work['title'], '(' + ident + ')' if ident else None) if part)


def _shown(r):
    if r['kind'] == 'name':
        return r['value']
    if r['kind'] == 'number':
        return repr(r['value']) + ' [' + r['field'] + ', ' + r['observation_id'] + ']'
    return '[' + ('; '.join(_cite(w) for w in r['value']) or r['observation_id'] + ': no works returned') + ']'


def segments(text: str, found: dict) -> list[dict]:
    """The text as the card shows it, one typed segment per occurrence, each {kind, text,
    observation_id, field, value, resolved, diagnostic, rendered}: a number as repr(value)
    [field, observation id], a source as the works of its retrieval, a name as itself. An
    unresolved token stays verbatim (unresolved_reference); a text segment with a numeral says
    literal_numeral; in a malformed text nothing resolves and every segment says
    malformed_reference. The rendered parts join to the rendered string."""
    parts, well = parse(text)
    out = []
    for part in parts:
        if part['kind'] == 'text':
            diagnostic = None if not well else 'literal_numeral' if _typed(part['text']) else None
            out.append({'kind': 'text', 'text': part['text'], 'observation_id': None, 'field': None, 'value': None,
                        'resolved': None, 'diagnostic': 'malformed_reference' if not well else diagnostic, 'rendered': part['text']})
            continue
        r = resolve(part, found if well else {})
        ok = well and r['resolved']
        out.append({'kind': r['kind'], 'text': part['text'], 'observation_id': r['observation_id'], 'field': r['field'],
                    'value': r['value'] if ok else None, 'resolved': ok,
                    'diagnostic': None if ok else 'malformed_reference' if not well else 'unresolved_reference',
                    'rendered': _shown(r) if ok else part['text']})
    return out


def render(text: str, found: dict) -> str:
    return ''.join(part['rendered'] for part in segments(text, found))


def references(texts, found: dict) -> list[dict]:
    """Each distinct reference of the texts, in order, with its diagnostic: a token that
    resolves in one text and not in another is listed both ways."""
    out = []
    for text in texts:
        for part in segments(text, found):
            if part['kind'] != 'text':
                entry = {'token': part['text'], 'kind': part['kind'], 'observation_id': part['observation_id'], 'field': part['field'],
                         'value': part['value'], 'resolved': part['resolved'], 'diagnostic': part['diagnostic']}
                if entry not in out:
                    out.append(entry)
    return out


def _bound(texts, found):
    parsed = [parse(text) for text in texts]
    if not all(well for _, well in parsed):
        return 'malformed_reference'
    if not all(resolve(part, found)['resolved'] for parts, _ in parsed for part in parts if part['kind'] != 'text'):
        return 'unresolved_reference'
    if any(literal_numerals(text) for text in texts):
        return 'literal_numeral'
    return None


def _replayable(texts, found):
    """Every observation a number token references is one a trusted numerical tool made and the
    capsule replays; a snapshot such as a search's hit_count is traced but never recomputed."""
    for text in texts:
        for part in parse(text)[0]:
            o = found.get(part.get('observation_id')) if part['kind'] == 'number' else None
            if o is not None and not (o.replayable and o.tool in NUMERICAL_CATALOG):
                return 'reference_not_replayable'
    return None


def _row(timeline_rows, action_id):
    row = None
    for candidate in timeline_rows:
        if candidate.get('operation') == 'tool' and candidate.get('action_id') == action_id \
                and candidate.get('outcome_source') == 'recorded':
            row = candidate
    return row


def _destination(tool):
    """(destination kind, destination or None when only the kind is known) of an external tool."""
    if tool in PUBLIC_CATALOG:
        return 'public_read', PUBLIC_READ_ORIGINS.get(tool)
    if tool in BIORENDER_CATALOG:
        return 'biorender', BIORENDER_ENDPOINT
    return (tool.split('_', 1)[0], None) if tool.startswith(('mcp_', 'acp_')) else (None, None)


def _ledgered(receipt, observation):
    """The grant ledger's receipt of this call: ok, to the tool's destination, for these arguments."""
    kind, destination = _destination(observation.tool)
    return receipt is not None and receipt.get('outcome') == 'ok' and receipt.get('destination_kind') == kind \
        and (destination is None or receipt.get('destination') == destination) \
        and receipt.get('request_digest') == digest(observation.action.arguments)


def _traced(state, evidence, referenced, timeline_rows, receipts):
    """The hash-chained event log records each observation as ok. A timeline row, when one
    exists, must agree; a referenced observation needs one. An external read needs the grant
    ledger's receipt for its destination and arguments, named on its row. Without the timeline
    or the ledger (None) that receipt cannot be checked; older missions are not excused."""
    recorded = {e.detail for e in state.events if e.kind == 'observation'}
    ledger = None if receipts is None else {r.get('id'): r for r in receipts}
    extra = []
    for o in evidence:
        if o.id + ': ok' not in recorded:
            return 'observation_unrecorded', extra
        row = _row(timeline_rows, o.id) if timeline_rows is not None else None
        if row is not None and row.get('outcome') != 'ok':
            return 'timeline_not_ok', extra
        external = o.tool not in NUMERICAL_CATALOG
        if external:
            if row is None or ledger is None:
                return 'receipt_unchecked', extra
            if not row.get('receipt_id') or not _ledgered(ledger.get(row['receipt_id']), o):
                return 'receipt_missing', extra
            extra.append('ledger_receipt')
        elif o.id in referenced and row is None:
            return 'timeline_missing', extra
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
    """TRACES style, from recorded data only: every work each literature retrieval in the
    claim's evidence returned is checked-negative, meaning the retrieval's OpenAlex record has
    status ok and lists the work's DOI as checked and not as retracted. A work without a DOI or
    outside 'checked' is unchecked; any recorded retraction blocks. PDB and other reads that are
    not literature are outside this gate, and a work named only in prose is not a source."""
    unchecked = False
    for o in evidence:
        if o.tool != LITERATURE:
            continue
        check = o.data.get('retraction_check')
        check = check if isinstance(check, dict) else {}
        if check.get('retracted'):
            return 'retracted_source'
        checked = {str(d).strip().lower() for d in check.get('checked') or ()} if check.get('status') == 'ok' else set()
        for record in o.data.get('records') or ():
            doi = record.get('doi') if isinstance(record, dict) else None
            unchecked = unchecked or not (isinstance(doi, str) and doi.strip().lower() in checked)
    return 'retraction_unchecked' if unchecked else None


def _recomputed(verification, subject):
    if verification is None or subject is None:
        return 'recomputation_missing'
    if verification.subject_digest != subject:
        return 'recomputation_stale'
    if not (verification.integrity and verification.reproduction_passed and verification.evidence_graph_valid):
        return 'recomputation_failed'
    return None


def _pool(state, branch, evidence, tool):
    """Every observation of `tool` in the claim's evidence or ok on its branch: leaving one
    out of the evidence does not hide it from the rungs that read it."""
    pool = {o.id: o for o in evidence if o.tool == tool}
    pool.update({o.id: o for o in state.observations if o.tool == tool and o.branch_id == branch.id
                 and o.status == 'ok' and o.claim_eligible})
    return list(pool.values())


def _context_before(planners, introduced):
    """What the persisted planner inputs up to the committing record held besides the goal:
    'falsifier_after_context' for earlier model agreement (planner_only), 'context_before_commit'
    for any other attached item or an operator directive with a note; None when neither."""
    inputs = [r.input_context for r in planners if r.round <= introduced.round]
    items = [item for context in inputs for item in context.get('mission_context') or ()]

    def planner_only(item):
        try:
            return ContextItem.model_validate(item).planner_only
        except ValueError:
            return False
    if any(planner_only(item) for item in items):
        return 'falsifier_after_context'
    notes = [d for context in inputs for d in context.get('operator_directives') or ()
             if isinstance(d, dict) and str(d.get('note') or '').strip()]
    return 'context_before_commit' if items or notes else None


def request_identity(o) -> tuple:
    """What makes two observations one request: the same tool and arguments on the same dataset.
    permutation_control draws every shuffle in sequence from one fixed seed, so all controls on
    a dataset are one request, whatever the count."""
    return o.tool, None if o.tool == 'permutation_control' else digest(o.action.arguments), o.dataset_digest


def _prespecified(state, branch, evidence):
    """The planner record that introduced the branch carries the same falsifier_test, no
    planner input up to it held earlier work or an operator note, and its commit event
    precedes every successful numerical observation of the dataset, on any branch, and the
    first observation of any request the claim uses, or that the falsifier and null checks
    read from the branch: the same tool and arguments on the same dataset, on any branch.
    permutation_control draws every shuffle in sequence from one fixed seed, so all controls
    on a dataset are one request, whatever the count."""
    if branch.falsifier_test is None:
        return 'falsifier_test_missing'
    planners = sorted((r for r in state.model_records if r.role == 'planner'), key=lambda r: r.round)
    introduced = next((r for r in planners if any(b.get('id') == branch.id for b in r.payload.get('branches') or ())), None)
    idea = next((b for b in introduced.payload['branches'] if b.get('id') == branch.id), {}) if introduced else {}
    if idea.get('falsifier_test') != branch.falsifier_test.model_dump(mode='json'):
        return 'falsifier_after_observation'
    context = _context_before(planners, introduced)
    if context:
        return context
    events = list(state.events)
    committed = next((i for i, e in enumerate(events) if e.kind == 'plan_committed' and e.round == introduced.round), None)
    request = request_identity
    requests = {request(o) for o in (*evidence, *_pool(state, branch, evidence, branch.falsifier_test.tool),
                                     *_pool(state, branch, evidence, 'permutation_control'))}
    used = {o.id + ': ok' for o in state.observations if request(o) in requests}
    datasets = {state.dataset_digest} | {o.dataset_digest for o in evidence}
    numerical = {o.id + ': ok' for o in state.observations
                 if o.tool in NUMERICAL_CATALOG and o.status == 'ok' and o.dataset_digest in datasets}
    first = next((i for i, e in enumerate(events) if e.kind == 'observation' and e.detail in used), None)
    seen = next((i for i, e in enumerate(events) if e.kind == 'observation' and e.detail in numerical), None)
    if committed is None or first is None or committed > first or (seen is not None and committed > seen):
        return 'falsifier_after_observation'
    return None


def _falsifier(state, branch, evidence):
    """Every measurement of the falsifier's metric on the branch or in the claim's evidence
    counts: a refutation stands however many later observations survive it, and leaving it
    out of the claim's evidence does not hide it. The fact reports the most adverse value."""
    test = branch.falsifier_test
    if test is None:
        return 'falsifier_not_evaluated', None
    values = [o.data[test.metric] for o in _pool(state, branch, evidence, test.tool)
              if isinstance(o.data.get(test.metric), (int, float)) and not isinstance(o.data.get(test.metric), bool)]
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
    pool = _pool(state, branch, evidence, 'permutation_control')
    fits = [o for o in evidence if o.tool == 'polynomial_fit']
    if not pool or not fits:
        return 'null_model_missing', None
    matched = [o.data['validation_mse'] for o in fits if o.data.get('degree') == CONTROL_DEGREE]
    if not matched:
        return 'null_model_mismatch', None
    controls = [o.data for o in pool if (o.data.get('permutations') or 0) > 0
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
    """Numerical-tool evidence, a number reference or a literal numeral makes a claim numeric;
    a name token never does."""
    used = set(scoped.evidence_ids)
    return any(o.id in used and o.tool in NUMERICAL_CATALOG for o in state.observations) or any(
        part['kind'] == 'number' for text in scoped.supported_scope for part in parse(text)[0]) or any(
        literal_numerals(text) for text in scoped.supported_scope)


def _evaluate(state, scoped, timeline_rows, receipts, verification, subject):
    """Every condition's need (None when met), the extra met codes and the facts."""
    if isinstance(verification, dict):
        verification = VerificationReceipt.model_validate(verification)
    branch = next(b for b in state.branches if b.id == scoped.branch_id)
    found = lookup(state, scoped, timeline_rows, receipts)
    cited = named(state, scoped)
    evidence = list(effective(state, scoped).values())
    traced, extra = _traced(state, evidence, set(cited), timeline_rows, receipts)
    survived, falsifier = _falsifier(state, branch, evidence)
    rejected, null = _null(state, branch, evidence)
    outcomes = {'evidence_present': None if evidence else 'no_evidence',
                'observations_traced': traced,
                'numbers_bound': _bound(scoped.supported_scope, found),
                'fidelity_audit': _fidelity(state, evidence),
                'no_retracted_source': _retraction(evidence),
                'recomputed': _recomputed(verification, subject),
                'references_replayable': _replayable(scoped.supported_scope, cited),
                'falsifier_prespecified': _prespecified(state, branch, evidence),
                'null_rejected': rejected,
                'falsifier_survived': survived,
                'external_replication': 'external_replication'}
    return outcomes, extra, {'falsifier': falsifier, 'null_model': null}, survived


def unmet(state: MissionState, scoped: ScopedBranch, rung: int, *, timeline_rows=None, receipts=None,
          verification: VerificationReceipt | dict | None = None, subject: str | None = None) -> list[str]:
    """The need of every unmet condition of rungs 1..rung, whichever rung fails first."""
    outcomes = _evaluate(state, scoped, timeline_rows, receipts, verification, subject)[0]
    return [outcomes[code] for n in range(1, rung + 1) for code in RUNGS[n] if outcomes[code]]


def claim_ladder(state: MissionState, scoped: ScopedBranch, *, timeline_rows=None, receipts=None,
                 verification: VerificationReceipt | dict | None = None, subject: str | None = None) -> dict:
    """The ladder of one scoped claim. `timeline_rows` None means the timeline was not
    consulted, `receipts` None that the grant ledger was not; `subject` is the current
    release subject digest the receipt must match."""
    outcomes, extra, facts, survived = _evaluate(state, scoped, timeline_rows, receipts, verification, subject)
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
            'facts': facts, 'note': NOTE}
