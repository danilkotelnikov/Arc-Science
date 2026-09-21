"""Claim cards: a read model derived from the persisted claim scope, the recorded
reconciliation, the evidence graph and the operational timeline.

Pure and deterministic: no I/O, no service import, inputs are never mutated. A claim's
status comes only from the persisted claim scope; a time comes only from a recorded
timeline row; nothing here is validation and nothing here upgrades a claim.
"""
from __future__ import annotations

from copy import deepcopy

from .catalog import BIORENDER_CATALOG, NUMERICAL_CATALOG, PUBLIC_CATALOG
from .claim_scope import DERIVATION_VERSION, latest_assessments
from .models import MissionState

# Fields of Observation.data per trusted tool (tools.py).
NUMERIC_FIELDS = {'polynomial_fit': ('degree', 'training_mse', 'validation_mse', 'n_train', 'n_validation', 'split'),
                  'permutation_control': ('permutations', 'mean_shuffled_validation_mse', 'minimum_shuffled_validation_mse'),
                  'describe_data': ('n', 'x_min', 'x_max', 'y_mean')}
UNITS_NOTE = 'No units are recorded: mission points are bare x/y numbers (models.Point) and no tool in this build reports a unit.'
UNCERTAINTY_NOTE = ('MSE values are errors on the exploratory validation split of the frozen dataset; '
                    'no confidence interval or standard error is computed in this build.')
INDEPENDENCE_REASONS = ('shared_identity', 'unverified_identity', 'missing_independent_role')
NOTE = ('Claim cards are derived on read from the persisted claim scope, the recorded reconciliation, '
        'the evidence graph and the operational timeline; nothing here is validation.')
EMPTY_NOTE = 'Claim scope is derived when the mission stops; nothing yet.'


def source_kind(tool: str) -> str:
    if tool in NUMERICAL_CATALOG:
        return 'builtin'
    if tool in PUBLIC_CATALOG:
        return 'public_read'
    if tool in BIORENDER_CATALOG:
        return 'biorender'
    if tool.startswith('mcp_'):
        return 'mcp'
    if tool.startswith('acp_'):
        return 'acp'
    return 'external'


def _timing(timeline_rows, action_id):
    """The last recorded tool row for the action, or nothing: no time is ever inferred."""
    row = None
    for candidate in timeline_rows:
        if candidate.get('operation') == 'tool' and candidate.get('action_id') == action_id \
                and candidate.get('outcome_source') == 'recorded':
            row = candidate
    if row is None:
        return {'started_at': None, 'finished_at': None, 'time_source': 'none', 'receipt_id': None}
    return {'started_at': row.get('started_at'), 'finished_at': row.get('finished_at'),
            'time_source': 'timeline', 'receipt_id': row.get('receipt_id')}


def _evidence(observation, scoped, timeline_rows):
    data = observation.data
    text = lambda key: data.get(key) if isinstance(data.get(key), str) else None
    return {'id': observation.id, 'tool': observation.tool, 'tool_version': observation.tool_version,
            'method': observation.tool + '@' + observation.tool_version, 'digest': observation.digest,
            'status': observation.status, 'claim_eligible': observation.claim_eligible,
            'replayable': observation.replayable, 'counts_for_scope': observation.id in scoped.evidence_ids,
            'source_kind': source_kind(observation.tool), 'round': observation.round,
            **_timing(timeline_rows, observation.id),
            'numeric_summary': {key: data[key] for key in NUMERIC_FIELDS.get(observation.tool, ()) if key in data},
            'endpoint': text('endpoint'), 'response_sha256': text('response_sha256')}


def _identity(state, role, round):
    for record in state.model_records:
        if record.role == role and record.round == round:
            transport = record.transport or {}
            return transport.get('identity_verified'), transport.get('identity_source')
    return None, None


def _independence(state, scoped, latest):
    roles = sorted(role for role, branch_id in latest if branch_id == scoped.branch_id)
    detail = {}
    for role in roles:
        assessed = latest[(role, scoped.branch_id)]
        verified, source = _identity(state, role, assessed.round)
        detail[role] = {'model': assessed.model, 'round': assessed.round,
                        'identity_verified': verified, 'identity_source': source}
    reasons = []
    for uncertainty in scoped.uncertainties:
        if uncertainty.reason in INDEPENDENCE_REASONS and uncertainty.reason not in reasons:
            reasons.append(uncertainty.reason)
    # Independent means two roles, two distinct model identities and no recorded reason
    # against it; one identity behind both roles is never independent, whatever it said.
    distinct = len({seat['model'] for seat in detail.values()}) == 2
    if len(roles) == 2 and not distinct and 'shared_identity' not in reasons:
        reasons.append('shared_identity')
    return {'roles_present': roles, 'roles': detail, 'independent': len(roles) == 2 and distinct and not reasons, 'reasons': reasons}


def _alternatives(state, branch, graph):
    parents = sorted(branch.parents)
    children = sorted(other.id for other in state.branches if branch.id in other.parents)
    if parents:
        siblings = sorted(other.id for other in state.branches
                          if other.id != branch.id and set(other.parents) & set(parents))
    else:
        siblings = sorted(other.id for other in state.branches if other.id != branch.id and not other.parents)
    conflicts = [deepcopy(entry) for entry in (graph or {}).get('conflicts', ()) if entry.get('branch_id') == branch.id]
    return {'parents': parents, 'children': children, 'siblings': siblings, 'conflicts': conflicts,
            'conflicts_source': 'evidence_graph' if graph is not None else 'unavailable'}


def build_claims(state: MissionState, timeline_rows: list[dict], graph: dict | None, release: dict | None) -> dict:
    scope = state.claim_scope
    check = next((c for c in (release or {}).get('checks', ()) if c.get('name') == 'claim_scope'), None)
    check_state = check['state'] if check else 'unknown'
    stale = check_state == 'stale'
    stale_reason = check.get('reason', '') if stale else ''
    latest = latest_assessments(state)
    branches = {branch.id: branch for branch in state.branches}
    claims = []
    for scoped in (scope.branches if scope else ()):
        branch = branches[scoped.branch_id]
        findings = [{'role': role, 'round': assessed.round, 'model': assessed.model, 'position': assessed.position,
                     'finding': assessed.finding, 'next_test': assessed.next_test, 'evidence_ids': list(assessed.evidence_ids)}
                    for role, assessed in sorted(((role, latest[(role, bid)]) for role, bid in latest if bid == branch.id),
                                                 key=lambda item: item[0])]
        claims.append({
            'claim_id': branch.id, 'branch_id': branch.id, 'title': branch.title,
            'requested': scoped.requested, 'status': scoped.status,
            'supported_scope': list(scoped.supported_scope), 'scope_qualifier': scoped.scope_qualifier,
            'uncertainties': [u.model_dump(mode='json') for u in scoped.uncertainties],
            'evidence': [_evidence(o, scoped, timeline_rows) for o in state.observations if o.branch_id == branch.id],
            'independence': _independence(state, scoped, latest),
            'findings': findings,
            'alternatives': _alternatives(state, branch, graph),
            'next_tests': [t.model_dump(mode='json') for t in scoped.next_tests],
            'units': None, 'units_note': UNITS_NOTE,
            'stale_derivation': stale, 'stale_reason': stale_reason, 'claim_scope_check': check_state})
    return {'source': 'derived',
            'derivation_version': scope.derivation_version if scope else None,
            'current_derivation_version': DERIVATION_VERSION,
            'basis_round': scope.basis_round if scope else None,
            'rule': scope.rule if scope else None,
            'evidence_graph': 'valid' if graph is not None else 'unavailable',
            'uncertainty_note': UNCERTAINTY_NOTE,
            'note': NOTE if scope else EMPTY_NOTE,
            'claims': claims}
