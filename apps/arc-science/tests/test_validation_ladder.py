"""The validation ladder (C5, D010, D019): each claim's rung is derived from persisted evidence
only. L1 traced, L2 recomputed, L3 pre-specified, L4 severe, L5 replicated (not built,
so always a need). Agreement between the reviewer and falsifier seats never raises a
rung, and release holds numeric claims to L2 and every other assessed claim to L1.

L1 is reference traceability (D019): a reviewer writes every number as {{<observation id>.<field>}}
and cites a retrieval as {{<observation id>}}; nothing in the prose is parsed for meaning. Its
scope limits, which these tests state as they stand: numbers written as words are outside the
check, and the words around a reference (a unit, an adjective) are the author's, never checked.

OpenAlex responses come from tests/fixtures/openalex: works_is_retracted.json was
recorded from api.openalex.org on 2026-09-27 (Wakefield 1998 is retracted, LeCun 2015
is not); europepmc_search.json is a hand-written minimal Europe PMC result carrying
those two DOIs and one record without a DOI. No test here uses the network."""
import asyncio
import json
import os
from pathlib import Path

import httpx
import pytest

from arc_science.contracts import digest
from arc_science.exploration import release
from arc_science.exploration.agents import DemoAgent
from arc_science.exploration.catalog import NUMERICAL_CATALOG
from arc_science.exploration.claims import build_claims
from arc_science.exploration.engine import explore
from arc_science.exploration.evidence import evidence_graph
from arc_science.exploration.models import MissionRequest, MissionState, VerificationReceipt
from arc_science.exploration.public_reads import public_tools
from arc_science.exploration.validation import RUNGS, claim_ladder, parse, resolve
from test_settings import stub  # noqa: F401  (fixture reuse)

FIXTURES = Path(__file__).parent / 'fixtures'
OPENALEX = json.loads((FIXTURES / 'openalex' / 'works_is_retracted.json').read_text(encoding='utf-8'))
EUROPEPMC = json.loads((FIXTURES / 'openalex' / 'europepmc_search.json').read_text(encoding='utf-8'))
FIT_ERROR = {'tool': 'polynomial_fit', 'metric': 'validation_mse', 'threshold': .02, 'direction': 'above'}
ASYNC_CLIENT = httpx.AsyncClient  # captured before a journey test replaces the service's client
MODELS = {'planner': 'planner-model', 'analyst': 'reviewer-model', 'falsifier': 'falsifier-model'}
WAKEFIELD, LECUN = '10.1016/S0140-6736(97)11096-0', '10.1038/nature14539'
RECORDS = EUROPEPMC['resultList']['result']
SOUND = [r for r in RECORDS if r.get('doi') == LECUN]


class Scripted(DemoAgent):
    """Round 0 opens one branch with the given actions, round 1 stops. Both seats support
    every successful observation with the finding `say(observation)`; `models` gives the
    seats distinct identities so agreement yields provisional support."""

    def __init__(self, actions, *, falsifier_test=FIT_ERROR, say=None, models=MODELS):
        self.actions, self.falsifier_test, self.models = actions, falsifier_test, models
        self.say = say or (lambda observation: 'Consistent with the recorded analysis.')

    def model_for(self, role):
        return (self.models or {}).get(role, self.model)

    async def propose(self, context):
        if context['round'] > 0:
            return {'stop': True, 'reason': 'Scripted stop.'}
        branch = {'id': 'curve', 'title': 'Curved response', 'hypothesis': 'The response needs a quadratic term.',
                  'falsifier': 'Validation error above the stated threshold.', 'parents': []}
        if self.falsifier_test:
            branch['falsifier_test'] = self.falsifier_test
        return {'branches': [branch], 'actions': [{'branch_id': 'curve', **a} for a in self.actions],
                'stop': False, 'reason': 'Test the curve against its falsifier and a null model.'}

    async def assess(self, role, context):
        ok = [o for o in context['observations'] if o['status'] == 'ok']
        return {'assessments': [{'branch_id': 'curve', 'position': 'support', 'evidence_ids': [o['id'] for o in ok],
                                 'finding': self.say(ok[0]) if ok else 'Nothing ran.'}]}


FIT = {'id': 'fit', 'tool': 'polynomial_fit', 'arguments': {'degree': 2}}
NULL = {'id': 'null', 'tool': 'permutation_control', 'arguments': {'permutations': 32}}
DESCRIBE = {'id': 'describe', 'tool': 'describe_data', 'arguments': {}}
READ = {'id': 'read', 'tool': 'literature_search', 'arguments': {'query': 'retraction fixture'}}
# The grant ledger's receipt of READ, as the service's guard writes it.
RECEIPT = {'id': 'receipt-1', 'destination': 'https://www.ebi.ac.uk', 'destination_kind': 'public_read',
           'outcome': 'ok', 'request_digest': digest(READ['arguments'])}
BOUND = 'Validation error {{fit.validation_mse}} at degree {{fit.degree}}.'


def run(agent, *, extra_tools=None, egress=False, policy='references', **request):
    request = MissionRequest(goal='Ladder fixture', max_rounds=3, allow_egress=egress, ladder_policy=policy, **request)
    state = asyncio.run(explore(request, agent, extra_tools=extra_tools))
    assert state.status == 'completed', state.stop_reason
    return request, state


def traced(state, receipt_id='receipt-1'):
    """The timeline the service writes: one recorded ok row per tool call, the ledger receipt on external ones."""
    return [{'operation': 'tool', 'action_id': o.id, 'round': o.round, 'outcome_source': 'recorded', 'outcome': 'ok',
             'receipt_id': None if o.tool in NUMERICAL_CATALOG else receipt_id} for o in state.observations]


def passing(state):
    replayable = [o for o in state.observations if o.status == 'ok' and o.tool in ('polynomial_fit', 'permutation_control', 'describe_data')]
    return VerificationReceipt(subject_digest=release.subject_digest(state), report_digest='a' * 64, integrity=True,
                               reproduction_passed=True, evidence_graph_valid=True, reproduced=len(replayable),
                               artifacts_reproduced=len(state.artifacts), verified_at=1)


def ladder_of(state, rows=None, verification=None, receipts=(RECEIPT,), scoped=None):
    [scoped] = [scoped] if scoped else [b for b in state.claim_scope.branches if b.branch_id == 'curve']
    subject = release.subject_digest(state) if verification else None
    return claim_ladder(state, scoped, timeline_rows=traced(state) if rows is None else list(rows),
                        receipts=None if receipts is None else list(receipts), verification=verification, subject=subject)


def rungs_met(ladder):
    """Every rung whose own conditions all hold, independent of the rungs below it."""
    return [n for n in range(1, 6) if all(code in ladder['met'] for code in RUNGS[n])]


def rung_check(decision):
    return next(c for c in decision.checks if c.name == 'claim_rungs')


def decide(request, state, verification=None, rows=None, receipts=(RECEIPT,)):
    return release.evaluate_release(request, state, verification, event_chain_ok=True,
                                     timeline_rows=traced(state) if rows is None else rows,
                                     receipts=None if receipts is None else list(receipts))


# The reference grammar and its resolution.

def test_the_reference_grammar_accepts_only_whole_tokens():
    tokens, well = parse('Error {{fit.validation_mse}} twice {{fit.validation_mse}}; source {{read}} and {{fit-2_b.n_train}}.')
    assert well and tokens == [('{{fit.validation_mse}}', 'fit', 'validation_mse'), ('{{fit.validation_mse}}', 'fit', 'validation_mse'),
                               ('{{read}}', 'read', None), ('{{fit-2_b.n_train}}', 'fit-2_b', 'n_train')]
    assert parse('Adjacent {{a.x}}{{b}} tokens and {single} braces or a set {x, y}.') == ([('{{a.x}}', 'a', 'x'), ('{{b}}', 'b', None)], True)
    assert parse('No references at all.') == ([], True)
    malformed = ('{{fit.validation_mse}', '{fit.validation_mse}}', 'open {{ only', 'close }} only', '{{}}', '{{fit.}}', '{{.x}}',
                 # nested
                 '{{{{fit.degree}}}}', '{{fit.{{fit.degree}}}}', '{{{fit.degree}}}', '{{fit.degree}}}',
                 # whitespace
                 '{{ fit.degree }}', '{{fit. degree}}', '{{fit .degree}}', '{{fit.deg ree}}', '{{fit.degree\n}}',
                 # other characters, and nesting deeper than one field
                 '{{fit.data.n}}', '{{fit/degree}}', '{{fit.válidation}}', '{{fit:degree}}', '{{fit.degree|x}}')
    for text in malformed:
        assert not parse(text)[1], text


def test_a_reference_resolves_only_to_a_finite_top_level_number_of_a_member_observation():
    _, state = run(Scripted([FIT, NULL]))
    fit = next(o for o in state.observations if o.id == 'fit')
    odd = fit.model_copy(update={'id': 'odd', 'data': {'int': 3, 'float': 0.5, 'negative': -2.5e-9, 'nan': float('nan'),
                                                       'inf': float('inf'), 'bool': True, 'text': '0.5', 'list': [1],
                                                       'dict': {'n': 1}, 'none': None}})
    member = {'fit': fit, 'odd': odd}
    resolved = lambda token: resolve(parse(token)[0][0], member)
    for token, value in (('{{fit.validation_mse}}', fit.data['validation_mse']), ('{{odd.int}}', 3), ('{{odd.float}}', .5),
                         ('{{odd.negative}}', -2.5e-9)):
        assert resolved(token) == {'token': token, 'kind': 'number', 'observation_id': token[2:].split('.')[0],
                                   'field': token[:-2].split('.')[1], 'value': value, 'resolved': True}, token
    for token in ('{{odd.nan}}', '{{odd.inf}}', '{{odd.bool}}', '{{odd.text}}', '{{odd.list}}', '{{odd.dict}}', '{{odd.none}}',
                  '{{odd.missing}}', '{{fit.coefficients}}', '{{fit.scope}}', '{{ghost.degree}}'):
        assert resolved(token)['resolved'] is False and resolved(token)['value'] is None, token
    # A number is never a source, and only a literature retrieval is one.
    assert resolved('{{fit}}') == {'token': '{{fit}}', 'kind': 'source', 'observation_id': 'fit', 'field': None,
                                   'value': None, 'resolved': False}
    # Membership is the claim's evidence: an observation of the branch the claim leaves out never resolves.
    _, state = run(Scripted([FIT, NULL], say=lambda o: BOUND[:-1] + ' against {{null.minimum_shuffled_validation_mse}}.'))
    assert ladder_of(state)['rung'] == 1
    [scoped] = state.claim_scope.branches
    ladder = ladder_of(state, scoped=scoped.model_copy(update={'evidence_ids': ('fit',)}))
    assert ladder['rung'] == 0 and ladder['next']['needs'] == ['unresolved_reference'] and ladder['verdict'] == 'blocked'


class OtherBranch(DemoAgent):
    """Round 0 fits on branch 'peek'; round 1 opens 'curve', whose finding references the peek fit."""
    def model_for(self, role):
        return MODELS[role]

    async def propose(self, context):
        if context['round'] == 0:
            return {'branches': [{'id': 'peek', 'title': 'Peek', 'hypothesis': 'Look.', 'falsifier': 'None.', 'parents': []}],
                    'actions': [{**FIT, 'branch_id': 'peek'}], 'stop': False, 'reason': 'Look.'}
        if context['round'] == 1:
            return {'branches': [{'id': 'curve', 'title': 'Curve', 'hypothesis': 'Quadratic.', 'falsifier': 'None.', 'parents': []}],
                    'actions': [{**DESCRIBE, 'branch_id': 'curve'}], 'stop': False, 'reason': 'Describe.'}
        return {'stop': True, 'reason': 'Done.'}

    async def assess(self, role, context):
        ok = [o['id'] for o in context['observations'] if o['status'] == 'ok' and o['branch_id'] == 'curve']
        return {'assessments': [{'branch_id': 'curve', 'position': 'support', 'evidence_ids': ok,
                                 'finding': 'Error {{fit.validation_mse}} over {{describe.n}} points.'}] if ok else []}


def test_a_reference_to_another_branch_never_resolves():
    _, state = run(OtherBranch())
    ladder = ladder_of(state)
    assert ladder['rung'] == 0 and ladder['next']['needs'] == ['unresolved_reference']


def test_references_to_recorded_values_reach_l1_within_the_stated_scope_limits():
    _, state = run(Scripted([FIT], say=lambda o: BOUND))
    ladder = ladder_of(state)
    assert ladder['rung'] == 1 and 'numbers_bound' in ladder['met'] and ladder['verdict'] == 'qualified'
    assert ladder['next'] == {'rung': 2, 'needs': ['recomputation_missing']}
    assert 'reference traceability' in ladder['note'] and 'written as words' in ladder['note'] and 'unit' in ladder['note']
    # Scope limits of the rung, by definition: a number written as a word is not a numeral, and
    # the words around a reference (a unit, an adjective) are the author's and not checked.
    for said in ('Validation error {{fit.validation_mse}} on two splits, about a third of the baseline.',
                 'Validation error {{fit.validation_mse}} percent, a remarkably tiny value.',
                 'Validation error {{fit.degree}}.'):
        _, state = run(Scripted([FIT], say=lambda o, s=said: s))
        assert ladder_of(state)['rung'] == 1, said


@pytest.mark.parametrize('said', [
    'Validation error {{fit.validation_mse}} over 2 splits.',          # ASCII
    'Validation error {{fit.validation_mse}} at degree ２.',             # fullwidth
    'R² beside {{fit.validation_mse}}.',                                 # superscript
    'Ошибка {{fit.validation_mse}} на ٣ точках.',                        # Arabic-Indic
    'Error {{fit.validation_mse}} at ५ points.',                         # Devanagari
    'Error {{fit.validation_mse}}, half: ½.',                            # vulgar fraction
    'Error {{fit.validation_mse}} after Ⅻ rounds.',                      # Roman numeral
    'Error {{fit.validation_mse}} across 五 folds.',                      # CJK numeral
    'Error {{fit.validation_mse}}0 appended.',                           # glued to a reference
    'Validation error 0.00404 as recorded.'])                            # no reference at all
def test_a_numeral_of_any_script_outside_the_references_keeps_the_claim_below_l1(said):
    _, state = run(Scripted([FIT], say=lambda o: said))
    ladder = ladder_of(state, verification=passing(state))
    assert ladder['rung'] == 0 and ladder['next'] == {'rung': 1, 'needs': ['literal_numeral']} and ladder['verdict'] == 'blocked'


def test_an_unresolved_or_malformed_reference_is_a_defect():
    for said, need in (('Accuracy {{fit.accuracy}}.', 'unresolved_reference'), ('Error {{fit.validation_mse}.', 'malformed_reference'),
                       ('Error {{ fit.validation_mse }}.', 'malformed_reference'), ('Error {{fit.data.n}}.', 'malformed_reference'),
                       # A malformed text is reported as such before any numeral it holds.
                       ('Error {{fit.validation_mse} and 3.', 'malformed_reference')):
        _, state = run(Scripted([FIT], say=lambda o, s=said: s))
        ladder = ladder_of(state, verification=passing(state))
        assert ladder['rung'] == 0 and ladder['next']['needs'] == [need] and ladder['verdict'] == 'blocked', said


def test_the_claim_card_renders_number_references_with_their_field_and_observation():
    said = 'Validation error {{fit.validation_mse}} at degree {{fit.degree}}; {{fit.accuracy}} stays as written.'
    _, state = run(Scripted([FIT], say=lambda o: said))
    [card] = build_claims(state, traced(state), evidence_graph(state), None)['claims']
    fit = state.observations[0].data
    assert card['supported_scope'] == list(state.claim_scope.branches[0].supported_scope) == ['analyst: ' + said, 'falsifier: ' + said]
    rendered = f"Validation error {fit['validation_mse']!r} [validation_mse, fit] at degree 2 [degree, fit]; {{{{fit.accuracy}}}} stays as written."
    assert card['supported_scope_rendered'] == ['analyst: ' + rendered, 'falsifier: ' + rendered]
    assert card['references'] == [
        {'token': '{{fit.validation_mse}}', 'kind': 'number', 'observation_id': 'fit', 'field': 'validation_mse',
         'value': fit['validation_mse'], 'resolved': True},
        {'token': '{{fit.degree}}', 'kind': 'number', 'observation_id': 'fit', 'field': 'degree', 'value': 2, 'resolved': True},
        {'token': '{{fit.accuracy}}', 'kind': 'number', 'observation_id': 'fit', 'field': 'accuracy', 'value': None, 'resolved': False}]
    assert card['ladder']['rung'] == 0 and 'reference traceability' in card['ladder']['note']
    # A malformed text is shown verbatim and none of its tokens resolve.
    _, state = run(Scripted([FIT], say=lambda o: 'Error {{fit.validation_mse}} and {{fit.degree}.'))
    [card] = build_claims(state, traced(state), None, None)['claims']
    assert card['supported_scope_rendered'] == card['supported_scope']
    assert [r['resolved'] for r in card['references']] == [False]


# Literature retrievals: sources, retractions and ledger receipts.

def epmc_client(records, openalex=OPENALEX, seen=None):
    def handle(request):
        (seen if seen is not None else []).append(str(request.url))
        if request.url.host == 'www.ebi.ac.uk':
            return httpx.Response(200, json={**EUROPEPMC, 'resultList': {'result': records}})
        if request.url.host == 'api.openalex.org' and openalex is not None:
            return httpx.Response(200, json=openalex)
        return httpx.Response(503)
    return ASYNC_CLIENT(transport=httpx.MockTransport(handle))


def granted(call):
    """A retraction guard that lets the OpenAlex call through, as a granted destination does."""
    return call


def reads(records, openalex=OPENALEX, guard=granted):
    return public_tools(epmc_client(records, openalex=openalex), openalex=guard)


SECOND = {'id': '31000001', 'source': 'MED', 'pmid': '31000001', 'doi': '10.1000/second-work', 'title': 'A second sound work.', 'pubYear': '2026'}
BOTH_SOUND = {'results': [{'doi': 'https://doi.org/' + LECUN, 'is_retracted': False},
                          {'doi': 'https://doi.org/10.1000/second-work', 'is_retracted': False}]}


def test_a_source_reference_renders_and_checks_every_work_of_its_retrieval():
    said = 'Deep learning is reviewed in {{read}}.'
    _, state = run(Scripted([READ], falsifier_test=None, say=lambda o: said), extra_tools=reads(SOUND + [SECOND], BOTH_SOUND), egress=True)
    ladder = ladder_of(state)
    assert ladder['rung'] == 1 and {'numbers_bound', 'no_retracted_source', 'ledger_receipt'} <= set(ladder['met'])
    [card] = build_claims(state, traced(state), None, None)['claims']
    shown = 'Deep learning is reviewed in [Deep learning. (doi:10.1038/nature14539); A second sound work. (doi:10.1000/second-work)].'
    assert card['supported_scope_rendered'] == ['analyst: ' + shown, 'falsifier: ' + shown]
    [reference] = card['references']
    assert reference['kind'] == 'source' and reference['resolved'] and [w['doi'] for w in reference['value']] == [LECUN, '10.1000/second-work']
    # The source stands for every work it returned: one retracted work blocks, one unchecked work leaves L1 unmet.
    for records, need in ((RECORDS, 'retracted_source'), (SOUND + [RECORDS[2]], 'retraction_unchecked')):
        _, state = run(Scripted([READ], falsifier_test=None, say=lambda o: said), extra_tools=reads(records), egress=True)
        assert ladder_of(state)['next']['needs'] == [need], records
    # A source reference to a numerical observation or a missing one never resolves.
    for cite in ('{{fit}}', '{{elsewhere}}'):
        _, state = run(Scripted([FIT, READ], say=lambda o, c=cite: 'Consistent with ' + c + '.'), extra_tools=reads(SOUND), egress=True)
        assert ladder_of(state)['next']['needs'] == ['unresolved_reference'], cite


def test_retraction_is_read_from_the_recorded_check_of_every_retrieval_in_the_evidence():
    # Checked-negative: every returned work has a DOI that OpenAlex checked and did not flag.
    _, sound = run(Scripted([FIT, READ]), extra_tools=reads(SOUND), egress=True)
    assert ladder_of(sound)['rung'] == 1 and 'no_retracted_source' in ladder_of(sound)['met']
    # Retracted: a recorded retraction blocks, whether or not the claim names the work; prose never matters.
    for said in ('Consistent with the recorded analysis.', 'Consistent with ' + LECUN + ' only.'):
        _, hits = run(Scripted([FIT, READ], say=lambda o, s=said: s), extra_tools=reads(RECORDS), egress=True)
        ladder = ladder_of(hits, verification=passing(hits))
        assert ladder['rung'] == 0 and 'retracted_source' in ladder['next']['needs'] and ladder['verdict'] == 'blocked', said
    # Unchecked: a work without a DOI, a lookup that failed, one never granted, or a DOI outside 'checked'.
    partial = {'results': [{'doi': 'https://doi.org/' + LECUN, 'is_retracted': False}]}
    for tools in (reads(SOUND + [RECORDS[2]]), reads(SOUND, openalex=None), public_tools(epmc_client(SOUND)),
                  reads(SOUND + [SECOND], partial)):
        _, state = run(Scripted([FIT, READ]), extra_tools=tools, egress=True)
        ladder = ladder_of(state)
        assert ladder['rung'] == 0 and ladder['next']['needs'] == ['retraction_unchecked'] and 'no_retracted_source' not in ladder['met']
    # A DOI named only in prose is not a source: without a retrieval in the evidence there is nothing to check.
    _, prose = run(Scripted([FIT], say=lambda o: 'Consistent with the retracted work by Wakefield and colleagues.'))
    assert 'no_retracted_source' in ladder_of(prose)['met']


def test_a_pre_retraction_check_read_leaves_its_works_unchecked():
    """A literature read stored before B9 carries no retraction_check: every work it returned
    is unchecked, whatever its claim says."""
    def legacy(state):
        observations = tuple(o.model_copy(update={'data': {k: v for k, v in o.data.items() if k != 'retraction_check'}})
                             for o in state.observations)
        return state.model_copy(update={'observations': observations})
    request, plain = run(Scripted([READ], falsifier_test=None), extra_tools=reads(SOUND), egress=True)
    assert rung_check(decide(request, plain)).state == 'satisfied'
    check = rung_check(decide(request, legacy(plain)))
    assert check.state == 'unknown' and 'retraction_unchecked' in check.reason


def test_an_external_read_needs_its_receipt_in_the_grant_ledger():
    request, state = run(Scripted([READ], falsifier_test=None), extra_tools=reads(SOUND), egress=True)
    assert 'ledger_receipt' in ladder_of(state)['met'] and rung_check(decide(request, state)).state == 'satisfied'
    # A receipt id on the row alone is not enough: the ledger must hold that receipt, ok, for the
    # read's destination and its arguments.
    for receipts in ((), ({**RECEIPT, 'id': 'another'},), ({**RECEIPT, 'outcome': 'failed'},), ({**RECEIPT, 'outcome': 'denied'},),
                     ({**RECEIPT, 'destination': 'https://api.openalex.org'},), ({**RECEIPT, 'destination_kind': 'mcp'},),
                     ({**RECEIPT, 'request_digest': digest({'query': 'another'})},)):
        assert ladder_of(state, receipts=receipts)['next']['needs'] == ['receipt_missing'], receipts
        check = rung_check(decide(request, state, receipts=receipts))
        assert check.state == 'failed' and 'receipt_missing' in check.reason
    assert ladder_of(state, rows=traced(state, receipt_id=None))['next']['needs'] == ['receipt_missing']
    # Without the ledger or the timeline the receipt cannot be checked.
    assert ladder_of(state, receipts=None)['next']['needs'] == ['receipt_unchecked']
    assert ladder_of(state, rows=[])['next']['needs'] == ['receipt_unchecked']
    assert rung_check(release.evaluate_release(request, state, None, event_chain_ok=True)).state == 'unknown'


def test_a_referenced_observation_needs_an_ok_timeline_row():
    _, state = run(Scripted([FIT], say=lambda o: BOUND))
    assert 'timeline_ok' in ladder_of(state)['met']
    ladder = ladder_of(state, rows=[])
    assert ladder['rung'] == 0 and ladder['next']['needs'] == ['timeline_missing']
    # A row that recorded a failure contradicts the chain: a defect.
    failed = [{**row, 'outcome': 'error'} for row in traced(state)]
    ladder = ladder_of(state, rows=failed)
    assert ladder['next']['needs'] == ['timeline_not_ok'] and ladder['verdict'] == 'blocked'
    # An observation the claim does not reference is still traced by the event chain alone.
    _, plain = run(Scripted([FIT]))
    assert ladder_of(plain, rows=[])['rung'] == 1


def test_a_read_without_provenance_is_never_grandfathered():
    """Reads from before the grant ledger wrote receipts, or whose timeline was lost, have no
    receipt to check: they stay below L1, whatever the mission's own record says about its age."""
    from arc_science.exploration.changes import declare_resume
    request, state = run(Scripted([READ], falsifier_test=None), extra_tools=reads(SOUND), egress=True)
    resumed = [{'operation': 'resume', 'round': 1, 'outcome_source': 'recorded', 'outcome': 'resumed'},
               {'operation': 'plan', 'round': 1, 'outcome_source': 'recorded', 'outcome': 'ok'}]
    old, _ = declare_resume(state, ('analysis', 'claim'), 'Resumed before receipts.', at=1790006614)
    interrupt = {'operation': 'interrupt', 'round': None, 'outcome_source': 'recorded', 'outcome': 'interrupted'}
    for mission in (old, state):
        for rows in ([], [interrupt], [interrupt, resumed[0]], resumed):
            ladder = ladder_of(mission, rows=rows)
            assert ladder['rung'] == 0 and ladder['next']['needs'] == ['receipt_unchecked'], rows
            assert 'receipt_predates_timeline' not in ladder['met']
            assert rung_check(decide(request, mission, rows=rows)).state != 'satisfied'


def test_public_reads_check_retractions_only_under_their_own_openalex_guard():
    seen, guarded = [], []

    def guard(call):
        async def run_(dois):
            guarded.append(dois)
            return await call(dois)
        return run_
    tools = public_tools(epmc_client(RECORDS, seen=seen), openalex=guard)
    data = asyncio.run(tools['literature_search'][1]({'query': 'retraction fixture'}))
    check = data['retraction_check']
    assert check['source'] == 'OpenAlex' and check['status'] == 'ok' and len(check['response_sha256']) == 64
    assert check['checked'] == ['10.1016/s0140-6736(97)11096-0', '10.1038/nature14539']
    assert check['retracted'] == ['10.1016/s0140-6736(97)11096-0'] and check['unchecked'] == ['PPR000001']
    # The guard saw exactly the DOIs that went to OpenAlex, in one request.
    assert guarded == [['10.1016/s0140-6736(97)11096-0', '10.1038/nature14539']]
    openalex = [url for url in seen if 'api.openalex.org' in url]
    assert len(openalex) == 1 and 'is_retracted' in openalex[0] and 'nature14539' in openalex[0]
    # Without a guard for OpenAlex nothing is sent there and every work stays unchecked.
    seen.clear()
    bare = asyncio.run(public_tools(epmc_client(RECORDS, seen=seen))['literature_search'][1]({'query': 'x'}))
    assert not [url for url in seen if 'api.openalex.org' in url]
    assert bare['retraction_check']['status'] == 'not_granted' and len(bare['retraction_check']['unchecked']) == 3

    # A refused grant and an unreachable OpenAlex never fail the search; the check is recorded as not done.
    def refuse(call):
        async def run_(dois):
            raise ValueError('Refused by the grant ledger: no grant')
        return run_
    denied = asyncio.run(reads(RECORDS, guard=refuse)['literature_search'][1]({'query': 'x'}))
    assert denied['retraction_check']['status'] == 'error' and 'Refused' in denied['retraction_check']['reason']
    down = asyncio.run(reads(RECORDS, openalex=None)['literature_search'][1]({'query': 'x'}))
    assert down['retraction_check']['status'] == 'error' and down['retraction_check']['retracted'] == []


def test_the_preview_asks_for_openalex_as_its_own_public_read_destination(monkeypatch):
    from arc_science import service
    from arc_science.exploration.providers import ModelEndpoint
    monkeypatch.setenv('ARC_PUBLIC_READS', '1')
    seat = ModelEndpoint(provider='openai', endpoint='https://api.openai.com/v1/responses', model='a', credential_ref='planner')
    preview = service.route_preview({'seats': {'planner': seat, 'reviewer': seat, 'falsifier': seat}, 'mcp_servers': [], 'acp_agents': []})
    [openalex] = [g for g in preview['required_grants'] if g['destination'] == 'https://api.openalex.org']
    assert openalex['destination_kind'] == 'public_read' and 'DOI' in openalex['data_category']


def slow_openalex_client(records):
    async def handle(request):
        if request.url.host == 'www.ebi.ac.uk':
            return httpx.Response(200, json={**EUROPEPMC, 'resultList': {'result': records}})
        await asyncio.sleep(3600)
    return ASYNC_CLIENT(transport=httpx.MockTransport(handle))


def test_a_slow_openalex_lookup_keeps_the_search_inside_the_tool_deadline_and_leaves_a_receipt(monkeypatch):
    from arc_science.exploration import public_reads
    monkeypatch.setattr(public_reads, 'OPENALEX_SECONDS', .2, raising=False)
    receipts = []

    def guard(call):
        """The service guard: a call that raises leaves a failed receipt, one that returns an ok one."""
        async def run_(dois):
            try:
                result = await call(dois)
            except Exception:
                receipts.append('failed')
                raise
            receipts.append('ok')
            return result
        return run_
    search = public_tools(slow_openalex_client(RECORDS), openalex=guard)['literature_search'][1]
    data = asyncio.run(asyncio.wait_for(search({'query': 'x'}), 2))
    assert len(data['records']) == len(RECORDS) and receipts == ['failed']
    assert data['retraction_check']['status'] == 'error' and data['retraction_check']['retracted'] == []
    # engine.py gives an external tool 30 s in all; both reads together stay inside it.
    monkeypatch.undo()
    assert public_reads.EUROPE_PMC_SECONDS + public_reads.OPENALEX_SECONDS < 30


def test_any_retracted_record_of_a_doi_wins_over_a_duplicate_that_is_not():
    duplicated = {'results': [{'doi': 'https://doi.org/' + WAKEFIELD.lower(), 'is_retracted': True},
                              {'doi': 'https://doi.org/' + WAKEFIELD.lower(), 'is_retracted': False},
                              {'doi': 'https://doi.org/' + LECUN, 'is_retracted': False}]}
    data = asyncio.run(reads(RECORDS, openalex=duplicated)['literature_search'][1]({'query': 'x'}))
    assert data['retraction_check']['retracted'] == [WAKEFIELD.lower()]
    _, state = run(Scripted([FIT, READ]), extra_tools=reads(RECORDS, openalex=duplicated), egress=True)
    assert 'retracted_source' in ladder_of(state)['next']['needs']


# Rungs, agreement, monotonicity and the upper rungs.

def test_agreement_only_claims_stay_at_or_below_l1_and_agreement_never_raises_a_rung():
    _, agreed = run(Scripted([FIT]))
    _, shared = run(Scripted([FIT], models=None))
    assert agreed.claim_scope.branches[0].status == 'provisionally_supported'
    assert shared.claim_scope.branches[0].status != 'provisionally_supported'
    for state in (agreed, shared):
        ladder = ladder_of(state)
        assert ladder['rung'] <= 1 and ladder['name'] in ('asserted', 'traced')
    # The same evidence under one identity and under two gives the same rung, verified or not.
    assert ladder_of(agreed)['rung'] == ladder_of(shared)['rung'] == 1
    assert ladder_of(agreed, verification=passing(agreed))['rung'] == ladder_of(shared, verification=passing(shared))['rung']
    assert not any('agree' in code or 'consensus' in code for code in ladder_of(agreed)['met'])
    # A claim with no successful observation is asserted, whatever the seats said.
    _, broken = run(Scripted([{'id': 'fit', 'tool': 'polynomial_fit', 'arguments': {'degree': 9}}]))
    ladder = ladder_of(broken)
    assert ladder['rung'] == 0 and ladder['name'] == 'asserted' and 'no_evidence' in ladder['next']['needs']
    assert ladder['density'] == 1 and ladder['verdict'] == 'deferred'


def test_a_severe_test_reaches_l4_and_l5_stays_a_need():
    request, state = run(Scripted([FIT, NULL], say=lambda o: BOUND))
    ladder = ladder_of(state, verification=passing(state))
    assert ladder['rung'] == 4 and ladder['name'] == 'severe' and ladder['density'] == 5
    assert ladder['next'] == {'rung': 5, 'needs': ['external_replication']} and ladder['verdict'] == 'accepted'
    assert {'numbers_bound', 'recomputed', 'falsifier_prespecified', 'null_rejected', 'falsifier_survived'} <= set(ladder['met'])
    facts = ladder['facts']
    assert facts['null_model']['permutation_bound'] == pytest.approx(1 / 33) and facts['null_model']['alpha'] == .05
    assert facts['null_model']['degree'] == 2 and 'p_value' not in facts['null_model']
    assert facts['falsifier']['refuted'] is False and facts['falsifier']['metric'] == 'validation_mse'
    # Without a replay receipt for the current subject the ladder stops at L1.
    assert ladder_of(state)['rung'] == 1
    stale = passing(state).model_copy(update={'subject_digest': 'b' * 64})
    [scoped] = state.claim_scope.branches
    assert claim_ladder(state, scoped, timeline_rows=traced(state), verification=stale,
                        subject=release.subject_digest(state))['next']['needs'] == ['recomputation_stale']
    # A falsifier the measurement refutes rejects the claim, whatever the seats agreed.
    _, refuted = run(Scripted([FIT, NULL], falsifier_test={**FIT_ERROR, 'threshold': 1e-6}))
    ladder = ladder_of(refuted, verification=passing(refuted))
    assert ladder['rung'] == 3 and 'falsifier_refuted' in ladder['next']['needs'] and ladder['verdict'] == 'rejected'
    # Too few permutations to reach the stated alpha: the null is not rejected.
    _, weak = run(Scripted([FIT, {**NULL, 'arguments': {'permutations': 8}}]))
    assert 'null_not_rejected' in ladder_of(weak, verification=passing(weak))['next']['needs']


def test_the_null_model_compares_only_fits_of_the_degree_the_control_shuffled():
    # permutation_control always refits degree 2 (tools.py); a cubic fit has no matching null.
    _, cubic = run(Scripted([{**FIT, 'arguments': {'degree': 3}}, NULL]))
    ladder = ladder_of(cubic, verification=passing(cubic))
    assert ladder['rung'] == 3 and ladder['next']['needs'] == ['null_model_mismatch'] and ladder['facts']['null_model'] is None
    # A cubic fit beside the quadratic is ignored by the null; the quadratic alone meets it.
    _, both = run(Scripted([FIT, {'id': 'cubic', 'tool': 'polynomial_fit', 'arguments': {'degree': 3}}, NULL]))
    ladder = ladder_of(both, verification=passing(both))
    assert ladder['rung'] == 4 and ladder['facts']['null_model']['worst_fit_validation_mse'] == both.observations[0].data['validation_mse']


def test_a_refuting_observation_stands_when_a_later_one_on_the_branch_survives():
    line = {'id': 'line', 'tool': 'polynomial_fit', 'arguments': {'degree': 1}}
    _, state = run(Scripted([line, FIT, NULL]))
    linear = state.observations[0].data['validation_mse']
    assert linear > FIT_ERROR['threshold'] > state.observations[1].data['validation_mse']
    ladder = ladder_of(state, verification=passing(state))
    assert ladder['verdict'] == 'rejected' and ladder['facts']['falsifier']['refuted'] is True
    assert ladder['facts']['falsifier']['value'] == linear and ladder['rung'] == 3 and 'falsifier_refuted' in ladder['next']['needs']


def test_the_null_is_rejected_only_when_no_control_on_the_branch_beats_the_fit():
    big, small = {**NULL, 'id': 'big', 'arguments': {'permutations': 128}}, {**NULL, 'id': 'small', 'arguments': {'permutations': 19}}
    _, state = run(Scripted([FIT, big, small]))
    fit = state.observations[0].data['validation_mse']
    beaten = tuple(o.model_copy(update={'data': {**o.data, 'minimum_shuffled_validation_mse': fit / 2}}) if o.id == 'big' else o
                   for o in state.observations)
    adverse = state.model_copy(update={'observations': beaten})
    ladder = ladder_of(adverse, verification=passing(adverse))
    assert 'null_not_rejected' in ladder['next']['needs'] and ladder['verdict'] != 'accepted'
    assert ladder['facts']['null_model']['minimum_shuffled_validation_mse'] == fit / 2
    # A control too small to reach alpha does not undo one that rejected the null.
    _, pair = run(Scripted([FIT, NULL, {**NULL, 'id': 'few', 'arguments': {'permutations': 8}}]))
    ladder = ladder_of(pair, verification=passing(pair))
    assert ladder['rung'] == 4 and ladder['facts']['null_model']['permutation_bound'] == pytest.approx(1 / 33)
    # A control on the branch that the claim leaves out of its evidence still counts.
    [scoped] = adverse.claim_scope.branches
    hidden = scoped.model_copy(update={'evidence_ids': tuple(i for i in scoped.evidence_ids if i != 'big')})
    ladder = ladder_of(adverse, verification=passing(adverse), scoped=hidden)
    assert 'null_not_rejected' in ladder['next']['needs']


class Replay(DemoAgent):
    """Round 0 fits on branch 'peek'; round 1 opens 'curve' with a falsifier threshold tuned
    just above the value it saw, and reruns the identical fit under a new id; round 2 stops."""
    models = MODELS

    def model_for(self, role):
        return self.models[role]

    async def propose(self, context):
        if context['round'] == 0:
            return {'branches': [{'id': 'peek', 'title': 'Peek', 'hypothesis': 'Look first.', 'falsifier': 'None.', 'parents': []}],
                    'actions': [{**FIT, 'branch_id': 'peek'}], 'stop': False, 'reason': 'Look.'}
        if context['round'] == 1:
            seen = next(o['data']['validation_mse'] for o in context['observations'] if o['id'] == 'fit')
            branch = {'id': 'curve', 'title': 'Curved response', 'hypothesis': 'The response needs a quadratic term.',
                      'falsifier': 'Validation error above the threshold.', 'parents': [],
                      'falsifier_test': {**FIT_ERROR, 'threshold': seen * 1.01}}
            return {'branches': [branch], 'actions': [{**FIT, 'id': 'fit2', 'branch_id': 'curve'}, {**NULL, 'branch_id': 'curve'}],
                    'stop': False, 'reason': 'Commit after looking.'}
        return {'stop': True, 'reason': 'Done.'}

    async def assess(self, role, context):
        ok = [o['id'] for o in context['observations'] if o['status'] == 'ok' and o['branch_id'] == 'curve']
        return {'assessments': [{'branch_id': 'curve', 'position': 'support', 'evidence_ids': ok, 'finding': 'Consistent.'}] if ok else []}


def test_a_falsifier_committed_after_an_identical_request_was_observed_does_not_reach_l3():
    _, state = run(Replay())
    assert [o.id for o in state.observations] == ['fit', 'fit2', 'null']
    assert state.observations[0].data['validation_mse'] == state.observations[1].data['validation_mse']
    ladder = ladder_of(state, verification=passing(state))
    assert ladder['rung'] == 2 and ladder['next'] == {'rung': 3, 'needs': ['falsifier_after_observation']}


class DescribeFirst(Replay):
    """Round 0 describes the data on branch 'peek', a request the later claim never uses;
    round 1 opens 'curve' with a fixed falsifier, a fresh fit and a control."""

    async def propose(self, context):
        if context['round'] == 0:
            return {'branches': [{'id': 'peek', 'title': 'Peek', 'hypothesis': 'Look first.', 'falsifier': 'None.', 'parents': []}],
                    'actions': [{**DESCRIBE, 'branch_id': 'peek'}], 'stop': False, 'reason': 'Look.'}
        if context['round'] == 1:
            branch = {'id': 'curve', 'title': 'Curved response', 'hypothesis': 'The response needs a quadratic term.',
                      'falsifier': 'Validation error above the threshold.', 'parents': [], 'falsifier_test': FIT_ERROR}
            return {'branches': [branch], 'actions': [{**FIT, 'branch_id': 'curve'}, {**NULL, 'branch_id': 'curve'}],
                    'stop': False, 'reason': 'Commit after describing.'}
        return {'stop': True, 'reason': 'Done.'}


def test_a_falsifier_committed_after_any_numerical_observation_of_the_dataset_does_not_reach_l3():
    _, state = run(DescribeFirst())
    [scoped] = [b for b in state.claim_scope.branches if b.branch_id == 'curve']
    assert set(scoped.evidence_ids) == {'fit', 'null'}
    ladder = ladder_of(state, verification=passing(state))
    assert 'null_rejected' in ladder['met'] and ladder['rung'] == 2
    assert ladder['next'] == {'rung': 3, 'needs': ['falsifier_after_observation']}


def test_a_falsifier_committed_after_the_observation_does_not_reach_l3():
    _, state = run(Scripted([FIT, NULL]))
    events = list(state.events)
    plan = next(i for i, e in enumerate(events) if e.kind == 'plan_committed')
    moved = events.pop(plan)
    last = max(i for i, e in enumerate(events) if e.kind == 'observation')
    events.insert(last + 1, moved)
    late = state.model_copy(update={'events': tuple(events)})
    ladder = ladder_of(late, verification=passing(late))
    assert ladder['rung'] == 2 and ladder['next'] == {'rung': 3, 'needs': ['falsifier_after_observation']}
    # L4's own conditions still hold: a higher rung never counts past a missing lower one.
    assert 4 in rungs_met(ladder) and ladder['rung'] == 2
    _, missing = run(Scripted([FIT, NULL], falsifier_test=None))
    assert ladder_of(missing, verification=passing(missing))['next'] == {'rung': 3, 'needs': ['falsifier_test_missing']}


class ControlFirst(Replay):
    """Round 0 runs the permutation control on branch 'peek'; round 1 opens 'curve' with its
    falsifier and runs a fresh fit beside a rerun of the control, with `rerun` shuffles."""

    def __init__(self, peek=32, rerun=32):
        self.peek, self.rerun = peek, rerun

    async def propose(self, context):
        if context['round'] == 0:
            return {'branches': [{'id': 'peek', 'title': 'Peek', 'hypothesis': 'Look first.', 'falsifier': 'None.', 'parents': []}],
                    'actions': [{**NULL, 'branch_id': 'peek', 'arguments': {'permutations': self.peek}}], 'stop': False, 'reason': 'Look.'}
        if context['round'] == 1:
            branch = {'id': 'curve', 'title': 'Curved response', 'hypothesis': 'The response needs a quadratic term.',
                      'falsifier': 'Validation error above the threshold.', 'parents': [], 'falsifier_test': FIT_ERROR}
            return {'branches': [branch], 'actions': [{**FIT, 'branch_id': 'curve'},
                                                      {**NULL, 'id': 'null2', 'branch_id': 'curve', 'arguments': {'permutations': self.rerun}}],
                    'stop': False, 'reason': 'Commit after looking at the null.'}
        return {'stop': True, 'reason': 'Done.'}


@pytest.mark.parametrize('peek,rerun', [(32, 32), (32, 33), (127, 128), (128, 127)])
def test_the_controls_the_null_uses_must_be_prespecified_whether_the_claim_cites_them_or_not(peek, rerun):
    """permutation_control draws its shuffles in sequence from one fixed seed, so a control
    with fewer shuffles is the first part of a larger one: a peek at any size shows the
    planner the statistic a later control of another size reports."""
    _, state = run(ControlFirst(peek, rerun))
    [scoped] = [b for b in state.claim_scope.branches if b.branch_id == 'curve']
    assert set(scoped.evidence_ids) == {'fit', 'null2'}
    for evidence_ids in (('fit', 'null2'), ('fit',)):
        cited = scoped.model_copy(update={'evidence_ids': evidence_ids})
        ladder = ladder_of(state, verification=passing(state), scoped=cited)
        assert 'null_rejected' in ladder['met'], evidence_ids
        assert ladder['rung'] == 2 and ladder['next'] == {'rung': 3, 'needs': ['falsifier_after_observation']}, evidence_ids


def test_context_or_a_noted_directive_before_the_commit_keeps_l3_unmet():
    """Judged from the persisted planner inputs up to the record that committed the falsifier:
    earlier model agreement keeps its own code; any other attached item, whatever it says, and
    any operator directive with a note fail closed. The goal is not context: the operator
    writes it before the mission starts, and no rung can show they had not seen the data."""
    from arc_science.exploration.models import ContextItem

    def ladder_under(item):
        _, state = run(Scripted([FIT, NULL]), context_items=[item])
        return ladder_of(state, verification=passing(state))
    prior = dict(ref='mission-a', title='Earlier mission', digest='a' * 64, text='Earlier results.')
    for item in (ContextItem(kind='mission', **prior), ContextItem(kind='memory', trust='model_output', **prior),
                 ContextItem(kind='memory', source_uri='mission://mission-a/round/1', **prior)):
        ladder = ladder_under(item)
        assert ladder['rung'] == 2 and ladder['next'] == {'rung': 3, 'needs': ['falsifier_after_context']}, item
    note = dict(kind='memory', trust='user', ref='note-1', digest='a' * 64)
    for title, text in (('Operator note', 'Prefer a quadratic basis; the curve bends near the middle.'),
                        ('A title that says nothing about results', ''), ('Numbers', 'last run validation error 0.00404')):
        ladder = ladder_under(ContextItem(title=title, text=text, **note))
        assert ladder['rung'] == 2 and ladder['next'] == {'rung': 3, 'needs': ['context_before_commit']}, title
    # An operator directive in a planner input at or before the commit: a note fails closed, a bare one does not.
    _, state = run(Scripted([FIT, NULL]))
    assert ladder_of(state, verification=passing(state))['rung'] == 4

    def directed(note, round=0):
        directive = {'target': 'branch', 'target_id': 'curve', 'directive': 'pursue', 'note': note, 'round': round, 'ask': 'x'}
        records = tuple(r.model_copy(update={'input_context': {**r.input_context, 'operator_directives': [directive]}})
                        if r.role == 'planner' and r.round == round else r for r in state.model_records)
        return state.model_copy(update={'model_records': records})
    for note, rung in (('The last fit was close to the threshold.', 2), ('   ', 4), ('', 4)):
        noted = directed(note)
        ladder = ladder_of(noted, verification=passing(noted))
        assert ladder['rung'] == rung, note
        if rung == 2:
            assert ladder['next'] == {'rung': 3, 'needs': ['context_before_commit']}
    # Later operator state is not read: a directive in a planner input after the commit changes nothing.
    later = directed('Seen it.', round=1)
    assert ladder_of(later, verification=passing(later))['rung'] == 4


def test_rungs_are_monotonic():
    cases = [run(Scripted([FIT]))[1], run(Scripted([FIT, NULL], say=lambda o: BOUND))[1],
             run(Scripted([FIT], say=lambda o: 'Error 0.4242.'))[1], run(Scripted([FIT], say=lambda o: 'Error {{fit.nothing}}.'))[1],
             run(Scripted([FIT, NULL], falsifier_test={**FIT_ERROR, 'threshold': 1e-6}))[1]]
    for state in cases:
        for verification in (None, passing(state)):
            ladder = ladder_of(state, verification=verification)
            n = ladder['rung']
            assert ladder['name'] == ('asserted', 'traced', 'recomputed', 'prespecified', 'severe', 'replicated')[n]
            assert set(range(1, n + 1)) <= set(rungs_met(ladder)), ladder
            assert n + 1 not in rungs_met(ladder) or n == 5
            assert ladder['density'] == max(1, min(5, n + 1))


def test_claim_cards_carry_the_ladder_from_the_release_receipt():
    request, state = run(Scripted([FIT, NULL], say=lambda o: BOUND))
    decision = decide(request, state, passing(state)).model_dump(mode='json')
    [card] = build_claims(state, traced(state), evidence_graph(state), decision, receipts=[RECEIPT])['claims']
    assert card['ladder']['rung'] == 4 and card['ladder'] == ladder_of(state, verification=passing(state))
    [card] = build_claims(state, traced(state), None, None)['claims']
    assert card['ladder']['rung'] == 1


# Release: the minimum rung under the reference policy; legacy missions keep their eligibility.

def test_release_holds_numeric_claims_to_l2_and_blocks_below_the_minimum():
    request, state = run(Scripted([FIT, NULL], say=lambda o: BOUND))
    verified = decide(request, state, passing(state))
    assert rung_check(verified).state == 'satisfied' and verified.eligible_for_human_review
    assert 'claim_rungs' in release.POLICY['checks']
    # Before verification the numeric claim sits at L1: not yet known, and blocking.
    unverified = decide(request, state)
    assert rung_check(unverified).state == 'unknown' and 'claim_rungs:unknown' in unverified.blocking_reasons
    # A typed numeral, an unresolved or a malformed reference keeps the claim at L0 after a passing verification.
    for said, need in (('Validation error 0.4242 on the split.', 'literal_numeral'), ('Error {{fit.accuracy}}.', 'unresolved_reference'),
                       ('Error {{fit.validation_mse}.', 'malformed_reference')):
        request, invented = run(Scripted([FIT], say=lambda o, s=said: s))
        blocked = decide(request, invented, passing(invented))
        check = rung_check(blocked)
        assert check.state == 'failed' and 'curve' in check.reason and need in check.reason, said
        assert blocked.status == 'blocked' and 'claim_rungs:failed' in blocked.blocking_reasons
        with pytest.raises(release.ReleaseBlocked, match='claim_rungs:failed'):
            release.assert_exportable(request, invented.model_copy(update={'release': blocked}), event_chain_ok=True,
                                      timeline_rows=traced(invented), receipts=[RECEIPT])


def test_release_holds_a_non_numeric_claim_to_l1_and_a_number_reference_makes_a_claim_numeric():
    request, state = run(Scripted([READ], falsifier_test=None), extra_tools=reads(SOUND), egress=True)
    decision = decide(request, state)
    assert rung_check(decision).state == 'satisfied', rung_check(decision).reason
    # A claim with a number reference is numeric without any numerical tool: it needs L2.
    request, counted = run(Scripted([READ], falsifier_test=None, say=lambda o: 'The search found {{read.hit_count}} works.'),
                           extra_tools=reads(SOUND), egress=True)
    assert ladder_of(counted)['rung'] == 1
    check = rung_check(decide(request, counted))
    assert check.state == 'unknown' and 'needs L2' in check.reason and 'recomputation_missing' in check.reason
    assert rung_check(decide(request, counted, passing(counted))).state == 'satisfied'


def needs_rasterizer():
    from arc_science.svg_raster import cairo_available
    if not os.environ.get('ARC_SVG2PNG') and not cairo_available():
        pytest.skip('No SVG rasterizer: set ARC_SVG2PNG or install cairosvg to re-render the legacy plots')


def legacy_mission():
    legacy = FIXTURES / 'legacy'
    return (MissionRequest.model_validate_json((legacy / 'completed.request.json').read_text(encoding='utf-8')),
            MissionState.model_validate_json((legacy / 'completed.state.json').read_text(encoding='utf-8')))


def test_legacy_missions_show_the_ladder_but_keep_their_export_eligibility():
    request, state = legacy_mission()
    assert request.ladder_policy == 'legacy' and 'ladder_policy' not in request.model_dump(mode='json')
    # The persisted ledger predates claim_rungs and still loads. The rung check does not apply to a
    # legacy mission, and its version-3 scope is what the current rule derives: it stays eligible untouched.
    assert 'claim_rungs' not in [c.name for c in state.release.checks] and state.claim_scope.derivation_version == 'arc-claim-scope-3'
    decision = release.current_decision(request, state, event_chain_ok=True, timeline_rows=[], receipts=[])
    assert rung_check(decision).state == 'not_applicable' and 'legacy' in rung_check(decision).reason
    assert decision.eligible_for_human_review, decision.blocking_reasons
    # The ladder is still shown.
    cards = build_claims(state, [], evidence_graph(state), decision.model_dump(mode='json'))['claims']
    assert [c['ladder']['rung'] for c in cards] == [2, 2, 2]
    assert [c['ladder']['verdict'] for c in cards] == ['rejected', 'revised', 'rejected']
    # Under the reference policy the same claims would be held to their minimum rung (numeric: L2).
    held = release.current_decision(request.model_copy(update={'ladder_policy': 'references'}), state, event_chain_ok=True,
                                    timeline_rows=[], receipts=[])
    assert rung_check(held).state == 'satisfied' and 'numeric L2' in rung_check(held).reason


def test_legacy_missions_still_verify_and_stay_eligible():
    from arc_science.exploration.capsule import export_capsule, verify_capsule
    needs_rasterizer()
    request, state = legacy_mission()
    report = verify_capsule(export_capsule(request, state))
    assert report['integrity'] and report['reproduction_passed'], report['failures']
    fresh = release.evaluate_release(request, state, release.receipt_from_report(report, state), event_chain_ok=True,
                                     timeline_rows=[], receipts=[])
    assert rung_check(fresh).state == 'not_applicable' and fresh.eligible_for_human_review


# Prompts: the review seats are told the syntax and the fields they may reference.

def test_the_review_prompts_carry_the_reference_syntax_and_the_recorded_fields():
    import sys
    from arc_science.exploration.cli_seats import CliAgent
    from arc_science.exploration.providers import HTTPAgent, ModelEndpoint, review_prompt
    _, state = run(Scripted([FIT, NULL, READ]), extra_tools=reads(SOUND), egress=True)
    context = {'observations': [o.model_dump(mode='json') for o in state.observations]}
    prompt = review_prompt('falsifier', context)
    for field in ('degree', 'training_mse', 'validation_mse', 'n_train', 'n_validation'):
        assert '{{fit.' + field + '}}' in prompt, field
    assert '{{null.minimum_shuffled_validation_mse}}' in prompt and '{{null.permutations}}' in prompt
    assert '{{read}}' in prompt and '{{read.hit_count}}' in prompt and 'curve' in prompt
    assert '{{fit.coefficients}}' not in prompt and '{{fit.split}}' not in prompt
    assert '{{<observation id>.<field>}}' in prompt and '{{<observation id>}}' in prompt and 'numeral' in prompt
    assert prompt.endswith('Role: falsifier')
    # Both seat transports send exactly this prompt.
    seen = []

    async def capture(model, instructions, context, schema, *, role):
        seen.append(instructions)
    seat = ModelEndpoint(provider='openai', endpoint='https://api.openai.com/v1/responses', model='a', credential_ref='reviewer')
    http = HTTPAgent(seat, client=None, resolver=None, project='p', principal='x')
    cli = CliAgent([sys.executable], 'm', 'm', provider='anthropic')
    try:
        for agent in (http, cli):
            agent._call = capture
            asyncio.run(agent.assess('falsifier', context))
    finally:
        cli.close()
    assert seen == [prompt, prompt]


# A service journey: grants, the read, its receipt in the ledger, verification and export.

# A CLI seat for every role: round 0 plans one literature read, the reviews support it with
# the read cited as a source, round 1 stops.
READER = r'''
import json, sys
args = sys.argv[1:]
if args[:2] == ['auth', 'status']:
    print(json.dumps({'loggedIn': True, 'authMethod': 'claude.ai'})); sys.exit(0)
if args == ['--version']:
    print('9.9.9'); sys.exit(0)
model = args[args.index('--model') + 1]
request = json.loads(sys.stdin.read())
ctx = request['context']
if request['response_schema'].get('title') == 'Proposal':
    if ctx['observations']:
        text = {'branches': [], 'actions': [], 'stop': True, 'reason': 'done'}
    else:
        text = {'branches': [{'id': 'lit', 'title': 'Literature', 'hypothesis': 'Deep learning is reviewed.', 'falsifier': 'No review.', 'parents': []}],
                'actions': [{'id': 'read', 'branch_id': 'lit', 'tool': 'literature_search', 'arguments': {'query': 'deep learning review'}}],
                'stop': False, 'reason': 'read'}
else:
    ok = [o['id'] for o in ctx['observations'] if o['status'] == 'ok']
    text = {'assessments': [{'branch_id': 'lit', 'position': 'support', 'evidence_ids': ok, 'finding': 'A review of deep learning is on record: {{read}}.'}] if ok else [],
            'summary': 'read'}
print(json.dumps({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': json.dumps(text), 'modelUsage': {model: {}},
                  'usage': {'input_tokens': 1, 'output_tokens': 1}, 'permission_denials': []}))
'''


def test_a_granted_literature_read_verifies_and_exports_through_the_service(tmp_path, stub, monkeypatch):
    """Journey: the operator grants Europe PMC and OpenAlex, the read and its retraction check
    each pass the ledger under their own destination, and verify, the release read, the claim
    card and the capsule export all evaluate the same timeline and ledger."""
    import sys
    from fastapi.testclient import TestClient
    from arc_science import service, settings
    from test_settings import AUTH, app, wait_final
    for key in ('ARC_PROVIDER', 'ARC_MODEL', 'ARC_REVIEWER_MODEL', 'ARC_CLAUDE_CODE_EXE', 'ARC_VISION_PROVIDER',
                'ARC_MODEL_TOKEN_FILE', 'ARC_BIORENDER_READS'):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv('ARC_PUBLIC_READS', '1')
    (tmp_path / 'reader.py').write_text(READER, encoding='utf-8')
    monkeypatch.setattr(service, 'claude_code_command', lambda: [sys.executable, str(tmp_path / 'reader.py')])
    seen = []
    monkeypatch.setattr('arc_science.net.httpx.AsyncClient', lambda **kwargs: epmc_client(SOUND, seen=seen))
    snap = settings.snapshot()
    doc = snap['settings']
    for role in ('planner', 'reviewer', 'falsifier'):
        doc['seats'][role].update(provider='anthropic', model='claude-opus-5', auth='cli')
    doc['providers']['anthropic']['cli'] = 'claude'
    settings.replace(doc, snap['revision'])
    with TestClient(app(tmp_path)) as c:
        preview = c.get('/api/missions/preview', headers=AUTH).json()
        assert ('public_read', 'https://api.openalex.org') in [(g['destination_kind'], g['destination']) for g in preview['required_grants']]
        created = c.post('/api/missions', headers=AUTH, json={'goal': 'Read', 'mode': 'live', 'max_rounds': 2, 'allow_egress': True}).json()
        mid = created['id']
        assert c.get(f'/api/missions/{mid}', headers=AUTH).json()['request']['ladder_policy'] == 'references'
        started = c.post(f'/api/missions/{mid}/start', headers=AUTH,
                         json={'approved_route_digest': preview['route_digest'], 'grants': preview['required_grants']})
        assert started.status_code == 202, started.text
        state = wait_final(c, mid)['state']
        assert state['status'] == 'completed', state['stop_reason']
        [read] = state['observations']
        assert read['status'] == 'ok' and read['data']['retraction_check']['checked'] == [LECUN]
        receipts = c.get(f'/api/missions/{mid}/grants', headers=AUTH).json()['receipts']
        assert {(r['destination'], r['outcome']) for r in receipts if r['destination_kind'] == 'public_read'} == {
            ('https://www.ebi.ac.uk', 'ok'), ('https://api.openalex.org', 'ok')}
        assert [u for u in seen if 'api.openalex.org' in u]
        verified = c.post(f'/api/missions/{mid}/verify', headers=AUTH)
        assert verified.status_code == 200, verified.text
        decision = verified.json()['release']
        rungs = next(ch for ch in decision['checks'] if ch['name'] == 'claim_rungs')
        assert rungs['state'] == 'satisfied' and decision['status'] == 'eligible_for_human_review', decision['blocking_reasons']
        assert c.get(f'/api/missions/{mid}/release', headers=AUTH).json()['status'] == 'eligible_for_human_review'
        [card] = c.get(f'/api/missions/{mid}/claims', headers=AUTH).json()['claims']
        assert card['ladder']['rung'] >= 1 and 'ledger_receipt' in card['ladder']['met']
        assert card['supported_scope_rendered'][0] == 'analyst: A review of deep learning is on record: [Deep learning. (doi:10.1038/nature14539)].'
        assert c.get(f'/api/missions/{mid}/capsule', headers=AUTH).status_code == 200
