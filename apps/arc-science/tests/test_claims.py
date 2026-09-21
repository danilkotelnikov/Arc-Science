"""Claim cards: derived on read from the persisted claim scope, the reconciliation, the
evidence graph and the operational timeline; never validation, never upgraded."""
import asyncio
import json

import pytest

from arc_science.contracts import digest
from arc_science.exploration import claim_scope, release
from arc_science.exploration.agents import DemoAgent
from arc_science.exploration.claims import (INDEPENDENCE_REASONS, NUMERIC_FIELDS, UNCERTAINTY_NOTE, UNITS_NOTE,
                                            build_claims, source_kind)
from arc_science.exploration.engine import explore, initialize
from arc_science.exploration.evidence import evidence_graph
from arc_science.exploration.models import MissionRequest, MissionState


@pytest.fixture(scope='module')
def demo():
    request = MissionRequest(goal='Explore the fixture')
    return request, asyncio.run(explore(request, DemoAgent()))


def claim(result, branch_id):
    return next(c for c in result['claims'] if c['claim_id'] == branch_id)


def tool_row(action_id, outcome_source, started_at, receipt_id=None, sequence=1):
    return {'id': 'op-' + str(sequence), 'sequence': sequence, 'started_at': started_at,
            'finished_at': started_at + 5 if outcome_source == 'recorded' else None,
            'operation': 'tool', 'role': 'tool', 'source': 'worker', 'round': 1, 'transport': None,
            'model_requested': None, 'model_observed': None, 'identity_verified': None,
            'tool': 'polynomial_fit', 'action_id': action_id, 'branch_id': 'quadratic', 'actor': None,
            'receipt_id': receipt_id, 'outcome': 'ok' if outcome_source == 'recorded' else 'outcome_unknown',
            'outcome_source': outcome_source, 'detail': ''}


def test_c1_demo_claims_follow_the_persisted_scope_in_order(demo):
    request, state = demo
    result = build_claims(state, [], evidence_graph(state), None)
    assert result['source'] == 'derived' and result['evidence_graph'] == 'valid'
    assert result['derivation_version'] == result['current_derivation_version'] == claim_scope.DERIVATION_VERSION
    assert result['basis_round'] == state.claim_scope.basis_round and result['rule'] == state.claim_scope.rule
    assert result['uncertainty_note'] == UNCERTAINTY_NOTE and 'nothing here is validation' in result['note']
    assert [c['claim_id'] for c in result['claims']] == [b.branch_id for b in state.claim_scope.branches]
    assert [c['status'] for c in result['claims']] == [b.status for b in state.claim_scope.branches]
    for scoped, card in zip(state.claim_scope.branches, result['claims']):
        assert card['branch_id'] == scoped.branch_id and card['requested'] == scoped.requested
        assert card['supported_scope'] == list(scoped.supported_scope) and card['scope_qualifier'] == scoped.scope_qualifier
        assert card['uncertainties'] == [u.model_dump(mode='json') for u in scoped.uncertainties]
        assert card['next_tests'] == [t.model_dump(mode='json') for t in scoped.next_tests]
        assert card['units'] is None and card['units_note'] == UNITS_NOTE
        assert card['stale_derivation'] is False and card['stale_reason'] == '' and card['claim_scope_check'] == 'unknown'
        assert card['title'] == next(b.title for b in state.branches if b.id == scoped.branch_id)
    quadratic = claim(result, 'quadratic')
    [evidence] = quadratic['evidence']
    observation = next(o for o in state.observations if o.id == 'fit-quadratic')
    assert evidence['method'] == 'polynomial_fit@arc-numeric-2' and evidence['digest'] == observation.digest
    assert evidence['status'] == 'ok' and evidence['claim_eligible'] and evidence['replayable'] and evidence['counts_for_scope']
    assert evidence['source_kind'] == 'builtin' and evidence['round'] == 1
    assert set(evidence['numeric_summary']) == set(NUMERIC_FIELDS['polynomial_fit']) and evidence['numeric_summary']['degree'] == 2
    assert evidence['time_source'] == 'none' and evidence['started_at'] is None and evidence['finished_at'] is None
    assert evidence['receipt_id'] is None and evidence['endpoint'] is None and evidence['response_sha256'] is None
    control = claim(result, 'null-control')['evidence'][0]
    assert set(control['numeric_summary']) == set(NUMERIC_FIELDS['permutation_control'])
    independence = quadratic['independence']
    assert independence['roles_present'] == ['analyst', 'falsifier'] and independence['independent'] is False
    assert independence['reasons'] == ['shared_identity']
    assert all(independence['roles'][role] == {'model': 'scripted-fixture-v1', 'round': 1, 'identity_verified': None,
                                               'identity_source': None} for role in ('analyst', 'falsifier'))
    assert [(f['role'], f['position'], f['evidence_ids']) for f in quadratic['findings']] == \
        [('analyst', 'support', ['fit-quadratic']), ('falsifier', 'support', ['fit-quadratic'])]
    assert all(f['model'] == 'scripted-fixture-v1' and f['round'] == 1 and f['finding'] and f['next_test'] for f in quadratic['findings'])
    assert claim(result, 'linear')['alternatives'] == {'parents': [], 'children': ['null-control', 'quadratic'],
                                                        'siblings': [], 'conflicts': [], 'conflicts_source': 'evidence_graph'}
    assert quadratic['alternatives']['parents'] == ['linear'] and quadratic['alternatives']['siblings'] == ['null-control']
    assert quadratic['alternatives']['children'] == [] and quadratic['alternatives']['conflicts'] == evidence_graph(state)['conflicts']
    assert any('independently acquired data' in t['test'] for t in quadratic['next_tests'])
    # A challenged claim keeps its findings as uncertainty and never gains a scope.
    linear = claim(result, 'linear')
    assert linear['status'] == 'contradicted' and linear['supported_scope'] == []
    assert [u['reason'] for u in linear['uncertainties']] == ['challenged', 'challenged']
    # The persisted scope records shared_identity only when both roles support; the card
    # still reads one identity behind both roles and never calls that independent.
    assert linear['independence']['independent'] is False and linear['independence']['reasons'] == ['shared_identity']
    assert {seat['model'] for seat in linear['independence']['roles'].values()} == {'scripted-fixture-v1'}


def test_c2_the_last_recorded_tool_row_gives_the_time_and_receipt(demo):
    request, state = demo
    rows = [tool_row('fit-quadratic', 'derived', 100, sequence=1),
            tool_row('fit-quadratic', 'recorded', 200, receipt_id='receipt-2', sequence=2),
            tool_row('fit-quadratic', 'derived', 300, sequence=3)]
    frozen = json.dumps(rows, sort_keys=True)
    evidence = claim(build_claims(state, rows, None, None), 'quadratic')['evidence'][0]
    assert evidence == {**evidence, 'started_at': 200, 'finished_at': 205, 'time_source': 'timeline', 'receipt_id': 'receipt-2'}
    assert json.dumps(rows, sort_keys=True) == frozen
    # An abandoned row alone gives no time: nothing is inferred from a missing outcome.
    evidence = claim(build_claims(state, rows[:1], None, None), 'quadratic')['evidence'][0]
    assert evidence['time_source'] == 'none' and evidence['started_at'] is None and evidence['receipt_id'] is None
    # Rows for other actions or operations never bleed over.
    other = [tool_row('fit-linear', 'recorded', 50, receipt_id='r', sequence=4), {**tool_row('fit-quadratic', 'recorded', 60, sequence=5), 'operation': 'plan'}]
    assert claim(build_claims(state, other, None, None), 'quadratic')['evidence'][0]['time_source'] == 'none'


def test_c3_a_scope_derived_under_an_earlier_rule_is_stale_and_export_stays_blocked(demo):
    request, state = demo
    older = state.model_copy(update={'claim_scope': state.claim_scope.model_copy(update={'derivation_version': 'arc-claim-scope-2'})})
    decision = release.current_decision(request, older, event_chain_ok=True).model_dump(mode='json')
    result = build_claims(older, [], evidence_graph(older), decision)
    assert result['derivation_version'] == 'arc-claim-scope-2' and result['current_derivation_version'] == 'arc-claim-scope-3'
    for card in result['claims']:
        assert card['stale_derivation'] is True and card['claim_scope_check'] == 'stale'
        assert 'earlier rule' in card['stale_reason'] and 'arc-claim-scope-2' in card['stale_reason']
    with pytest.raises(release.ReleaseBlocked, match='claim_scope:stale'):
        release.assert_exportable(request, older, event_chain_ok=True)
    # The current scope with a release dict reads the persisted check state, not a model's word.
    current = release.current_decision(request, state, event_chain_ok=True).model_dump(mode='json')
    card = build_claims(state, [], None, current)['claims'][0]
    assert card['stale_derivation'] is False and card['stale_reason'] == ''
    assert card['claim_scope_check'] == next(c['state'] for c in current['checks'] if c['name'] == 'claim_scope')


def test_c4_without_an_evidence_graph_conflicts_are_unavailable_not_empty_by_assertion(demo):
    request, state = demo
    result = build_claims(state, [], None, None)
    assert result['evidence_graph'] == 'unavailable'
    assert all(c['alternatives']['conflicts'] == [] and c['alternatives']['conflicts_source'] == 'unavailable' for c in result['claims'])
    graph = {'nodes': [], 'edges': [], 'conflicts': [{'branch_id': 'quadratic', 'positions': ['challenge', 'support'],
                                                       'assessment_ids': ['assessment:0003'], 'evidence_ids': ['fit-quadratic']}]}
    frozen = json.dumps(graph, sort_keys=True)
    result = build_claims(state, [], graph, None)
    assert claim(result, 'quadratic')['alternatives']['conflicts'] == graph['conflicts']
    assert claim(result, 'linear')['alternatives']['conflicts'] == [] and claim(result, 'linear')['alternatives']['conflicts_source'] == 'evidence_graph'
    claim(result, 'quadratic')['alternatives']['conflicts'][0]['evidence_ids'].append('tampered')
    assert json.dumps(graph, sort_keys=True) == frozen


def test_c5_the_derivation_is_deterministic_and_leaves_the_state_untouched(demo):
    request, state = demo
    before = state.model_dump(mode='json')
    graph = evidence_graph(state)
    rows = [tool_row('fit-linear', 'recorded', 10, receipt_id='r1')]
    first = json.dumps(build_claims(state, rows, graph, None), sort_keys=True)
    second = json.dumps(build_claims(state, rows, graph, None), sort_keys=True)
    assert first == second
    assert state.model_dump(mode='json') == before


def test_c6_no_claim_scope_means_no_cards_and_says_so(demo):
    request, state = demo
    result = build_claims(state.model_copy(update={'claim_scope': None, 'status': 'paused'}), [], None, None)
    assert result['claims'] == [] and result['note'] == 'Claim scope is derived when the mission stops; nothing yet.'
    assert result['derivation_version'] is None and result['basis_round'] is None and result['rule'] is None
    assert result['current_derivation_version'] == claim_scope.DERIVATION_VERSION and result['source'] == 'derived'


def test_c7_a_requested_only_identity_reads_as_unverified_from_the_record():
    request = MissionRequest(goal='Explore the fixture')
    state = initialize(request)
    branch = {'id': 'linear', 'title': 'Linear', 'hypothesis': 'A linear curve describes the fixture.',
              'falsifier': 'Residual structure.', 'parents': [], 'created_round': 0}
    action = {'id': 'obs-1', 'branch_id': 'linear', 'tool': 'literature_search', 'arguments': {'query': 'x'}}
    observation = {'id': 'obs-1', 'branch_id': 'linear', 'tool': 'literature_search', 'tool_version': 'v', 'round': 0,
                   'status': 'ok', 'data': {'endpoint': 'https://www.ebi.ac.uk/europepmc/webservices/rest/search',
                                            'response_sha256': 'c' * 64, 'query': 'x'},
                   'dataset_digest': state.dataset_digest, 'request_digest': digest([action, state.dataset_digest]),
                   'action': action}
    base = {'branch_id': 'linear', 'evidence_ids': ['obs-1'], 'finding': 'f', 'next_test': 'independent data', 'round': 0}
    record = {'context_digest': 'a' * 64, 'input_context': {}, 'payload': {}, 'round': 0}
    state = MissionState.model_validate({
        **state.model_dump(), 'status': 'completed', 'branches': [branch], 'observations': [observation],
        'assessments': [{**base, 'role': 'analyst', 'model': 'model-a', 'position': 'support'},
                        {**base, 'role': 'falsifier', 'model': 'model-b', 'position': 'support'}],
        'model_records': [{**record, 'role': 'analyst', 'model': 'model-a',
                           'transport': {'transport': 'api', 'identity_source': 'observed', 'identity_verified': True, 'observed_model': 'model-a'}},
                          {**record, 'role': 'falsifier', 'model': 'model-b',
                           'transport': {'transport': 'codex', 'identity_source': 'requested_only', 'identity_verified': False}}]})
    state = state.model_copy(update={'claim_scope': claim_scope.derive_claim_scope(state)})
    # A hand-built record has no replayable planner payload, so no evidence graph is available.
    [card] = build_claims(state, [], None, None)['claims']
    assert card['status'] == 'unresolved'
    assert card['independence']['roles']['analyst'] == {'model': 'model-a', 'round': 0, 'identity_verified': True, 'identity_source': 'observed'}
    assert card['independence']['roles']['falsifier'] == {'model': 'model-b', 'round': 0, 'identity_verified': False, 'identity_source': 'requested_only'}
    assert card['independence']['independent'] is False and card['independence']['reasons'] == ['unverified_identity']
    assert 'unverified_identity' in INDEPENDENCE_REASONS
    [evidence] = card['evidence']
    assert evidence['source_kind'] == 'public_read' and evidence['numeric_summary'] == {}
    assert evidence['endpoint'] == 'https://www.ebi.ac.uk/europepmc/webservices/rest/search' and evidence['response_sha256'] == 'c' * 64
    assert card['alternatives'] == {'parents': [], 'children': [], 'siblings': [], 'conflicts': [], 'conflicts_source': 'unavailable'}


def test_source_kind_names_the_catalog_or_prefix_a_tool_came_from():
    assert source_kind('polynomial_fit') == 'builtin' and source_kind('describe_data') == 'builtin'
    assert source_kind('literature_search') == 'public_read' and source_kind('pdb_metadata') == 'public_read'
    assert source_kind('biorender_search') == 'biorender'
    assert source_kind('mcp_srv_echo') == 'mcp' and source_kind('acp_x_consult') == 'acp'
    assert source_kind('something_else') == 'external'
