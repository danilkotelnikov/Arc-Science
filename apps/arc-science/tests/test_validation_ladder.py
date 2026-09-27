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
from arc_science.exploration.validation import DEFECTS, GUARANTEE, RUNGS, claim_ladder, parse, request_identity, resolve
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

    def __init__(self, actions, *, falsifier_test=FIT_ERROR, say=None, models=MODELS, next_test='', doubt=None):
        self.actions, self.falsifier_test, self.models = actions, falsifier_test, models
        self.say = say or (lambda observation: 'Consistent with the recorded analysis.')
        # `doubt(observation)`, when given, is the falsifier's challenge; `next_test` both seats' proposal.
        self.next_test, self.doubt = next_test, doubt

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
        doubt = self.doubt if role == 'falsifier' else None
        return {'assessments': [{'branch_id': 'curve', 'position': 'challenge' if doubt else 'support',
                                 'evidence_ids': [o['id'] for o in ok], 'next_test': self.next_test,
                                 'finding': (doubt or self.say)(ok[0]) if ok else 'Nothing ran.'}]}


FIT = {'id': 'fit', 'tool': 'polynomial_fit', 'arguments': {'degree': 2}}
NULL = {'id': 'null', 'tool': 'permutation_control', 'arguments': {'permutations': 32}}
DESCRIBE = {'id': 'describe', 'tool': 'describe_data', 'arguments': {}}
READ = {'id': 'read', 'tool': 'literature_search', 'arguments': {'query': 'retraction fixture'}}
# The grant ledger's receipt of READ, as the service's guard writes it.
RECEIPT = {'id': 'receipt-1', 'destination': 'https://www.ebi.ac.uk', 'destination_kind': 'public_read',
           'outcome': 'ok', 'request_digest': digest(READ['arguments'])}
BOUND = 'Validation error {{fit.validation_mse}} at degree {{fit.degree}}.'


def run(agent, *, extra_tools=None, egress=False, policy='references', **request):
    request = MissionRequest(**{'goal': 'Ladder fixture', 'max_rounds': 3, 'allow_egress': egress, 'ladder_policy': policy, **request})
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


def ladder_of(state, rows=None, verification=None, receipts=(RECEIPT,), scoped=None, request=None):
    [scoped] = [scoped] if scoped else [b for b in state.claim_scope.branches if b.branch_id == 'curve']
    subject = release.subject_digest(state) if verification else None
    return claim_ladder(state, scoped, timeline_rows=traced(state) if rows is None else list(rows),
                        receipts=None if receipts is None else list(receipts), verification=verification, subject=subject,
                        request=request)


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

def tokens(text):
    """(well formed, each token as (its text, kind, observation id or name, field)), duplicates kept."""
    found, well = parse(text)
    return well, [(t['text'], t['kind'], t.get('observation_id') or t.get('value'), t.get('field')) for t in found if t['kind'] != 'text']


def test_the_reference_grammar_accepts_only_whole_tokens():
    assert tokens('Error {{fit.validation_mse}} twice {{fit.validation_mse}}; source {{read}} and {{fit-2_b.n_train}}.') == (True, [
        ('{{fit.validation_mse}}', 'number', 'fit', 'validation_mse'), ('{{fit.validation_mse}}', 'number', 'fit', 'validation_mse'),
        ('{{read}}', 'source', 'read', None), ('{{fit-2_b.n_train}}', 'number', 'fit-2_b', 'n_train')])
    assert tokens('Adjacent {{a.x}}{{b}} tokens and {single} braces or a set {x, y}.') == (
        True, [('{{a.x}}', 'number', 'a', 'x'), ('{{b}}', 'source', 'b', None)])
    assert tokens('No references at all.') == (True, [])
    # The parser splits a text into typed segments, one per occurrence, that rebuild it exactly.
    text = 'Error {{fit.validation_mse}} in {{name:p53}}, {{name:p53}} and {{read}}.'
    found, well = parse(text)
    assert well and ''.join(t['text'] for t in found) == text
    assert [t['kind'] for t in found] == ['text', 'number', 'text', 'name', 'text', 'name', 'text', 'source', 'text']
    malformed = ('{{fit.validation_mse}', '{fit.validation_mse}}', 'open {{ only', 'close }} only', '{{}}', '{{fit.}}', '{{.x}}',
                 # nested
                 '{{{{fit.degree}}}}', '{{fit.{{fit.degree}}}}', '{{{fit.degree}}}', '{{fit.degree}}}',
                 # whitespace
                 '{{ fit.degree }}', '{{fit. degree}}', '{{fit .degree}}', '{{fit.deg ree}}', '{{fit.degree\n}}',
                 # other characters, and nesting deeper than one field
                 '{{fit.data.n}}', '{{fit/degree}}', '{{fit.válidation}}', '{{fit:degree}}', '{{fit.degree|x}}')
    for text in malformed:
        assert not parse(text)[1], text


def test_a_name_token_labels_an_identifier_with_digits():
    """{{name:<text>}}: letters of any script that are not numerals, ASCII digits and hyphens, at
    least one letter, no leading hyphen, so a name may start with a digit (16S, 5-HT2A) and a pure
    quantity (0-5) or a run of CJK numerals (三百) is not a name. It is exempt from the numeral
    check and never a number; it resolves only against the study's own vocabulary (D020)."""
    for name in ('p53', 'BRCA1', 'IL-6', 'SARS-CoV-2', 'H3K27ac', 'GPT-5', 'x', '16S', '5-HT2A', 'TGF-β1', 'β2', '5p', 'Ω'):
        assert tokens('The {{name:' + name + '}} line.') == (True, [('{{name:' + name + '}}', 'name', name, None)]), name
    for text in ('{{name:}}', '{{name:0-5}}', '{{name:500}}', '{{name:-}}', '{{name:x²}}', '{{name:½x}}', '{{name:٣x}}', '{{name:x_}}',
                 '{{name:-p53}}', '{{name:GPT-5.5}}', '{{name:p 53}}', '{{name: p53}}', '{{name:p_53}}',
                 '{{name:p53}', '{{name:p53.x}}', '{{name:IL-6/IL-8}}', '{{Name:p53}}', '{{name:p53:x}}',
                 # numeral letters: CJK and other characters that are numerals are not letters
                 '{{name:三百}}', '{{name:五}}', '{{name:零}}', '{{name:壹}}', '{{name:p五}}', '{{name:Ⅻ}}',
                 # nested
                 '{{name:{{name:p53}}}}', '{{name:{{fit.degree}}}}', '{{{{name:p53}}}}', '{{name:p53}}}'):
        assert not parse(text)[1], text
    for said in ('The {{name:三百}} line.', 'The {{name:五}} arm.'):
        request, state = run(Scripted([FIT], say=lambda o, s=said: s), goal='Ladder fixture on 三百 and 五.')
        assert ladder_of(state, request=request)['next']['needs'] == ['malformed_reference'], said
    said = 'Error {{fit.validation_mse}} for {{name:p53}}, {{name:SARS-CoV-2}} and {{name:H3K27ac}}.'
    request, state = run(Scripted([FIT], say=lambda o: said), goal='Does the curve differ for p53, SARS-CoV-2 and H3K27ac?')
    ladder = ladder_of(state, request=request)
    assert ladder['rung'] == 1 and 'numbers_bound' in ladder['met']
    assert 'vocabulary' in ladder['note'] and 'not for meaning' in ladder['note'] and 'name token' in ladder['note']
    [card] = build_claims(state, traced(state), None, None, request=request)['claims']
    fit = state.observations[0].data
    assert card['supported_scope_rendered'][0] == f"analyst: Error {fit['validation_mse']!r} [validation_mse, fit] for p53, SARS-CoV-2 and H3K27ac."
    assert [(r['kind'], r['value'], r.get('origin')) for r in card['references']] == [
        ('number', fit['validation_mse'], None), ('name', 'p53', {'origin': 'goal'}), ('name', 'SARS-CoV-2', {'origin': 'goal'}),
        ('name', 'H3K27ac', {'origin': 'goal'})]
    # A name that starts with a digit or has a non-ASCII letter keeps its claim traced.
    for said in ('Abundance of {{name:16S}} rRNA tracks {{fit.validation_mse}}.', 'The {{name:TGF-β1}} and {{name:5-HT2A}} arms.'):
        request, state = run(Scripted([FIT], say=lambda o, s=said: s), goal='Compare the 16S, TGF-β1 and 5-HT2A arms.')
        assert ladder_of(state, request=request)['rung'] == 1, said
    # A name is never a number: a claim whose only digits sit in names is not numeric and is held to L1.
    request, named = run(Scripted([READ], falsifier_test=None, say=lambda o: 'The {{name:BRCA1}} review is {{read}}.'),
                         extra_tools=reads(SOUND), egress=True, goal='Is BRCA1 reviewed?')
    assert ladder_of(named, request=request)['rung'] == 1 and rung_check(decide(request, named)).state == 'satisfied'
    # The same digits typed bare are numerals; a malformed name token is malformed.
    for said, need in (('The p53 line.', 'literal_numeral'), ('The {{name:GPT-5.5}} run.', 'malformed_reference'),
                       ('The {{name:p53} line.', 'malformed_reference'), ('The {{name:{{name:p53}}}} line.', 'malformed_reference')):
        request, state = run(Scripted([FIT], say=lambda o, s=said: s), goal='The p53 line.')
        assert ladder_of(state, request=request)['next']['needs'] == [need], said


class Named(Scripted):
    """Scripted, with model-written text that carries a name: the hypothesis, the falsifier and
    the plan reason say BRCA1."""

    async def propose(self, context):
        plan = await super().propose(context)
        if not plan.get('branches'):
            return plan
        for branch in plan['branches']:
            branch.update(hypothesis='BRCA1 carriers need a quadratic term.', falsifier='BRCA1 error above the threshold.')
        return {**plan, 'reason': plan['reason'] + ' BRCA1 first.'}


def test_a_name_resolves_only_against_the_studys_own_vocabulary():
    """D020: {{name:x}} resolves when x occurs, exactly and as a whole word, in the goal, an operator
    decision note, a chosen context item or the recorded data of a successful observation; the
    earliest recorded occurrence is its origin. Model-written text never adds a name."""
    said = 'Error {{fit.validation_mse}} for {{name:IL-6}}.'
    needs = lambda state, request: ladder_of(state, request=request)['next']['needs']
    # From the goal.
    request, state = run(Scripted([FIT], say=lambda o: said), goal='Does the IL-6 arm curve?')
    assert ladder_of(state, request=request)['rung'] == 1
    # Unknown to the study: unresolved (L1 unmet), and the claim card says so.
    request, state = run(Scripted([FIT], say=lambda o: said))
    assert needs(state, request) == ['unresolved_reference'] and ladder_of(state, request=request)['verdict'] == 'blocked'
    [card] = build_claims(state, traced(state), None, None, request=request)['claims']
    [shown] = [t for t in card['supported_scope_segments'][0] if t['kind'] == 'name']
    assert shown == {'kind': 'name', 'text': '{{name:IL-6}}', 'observation_id': None, 'field': None, 'value': None,
                     'resolved': False, 'diagnostic': 'unresolved_reference', 'rendered': '{{name:IL-6}}', 'origin': None}
    # Case-sensitive and whole-word: il-6, IL-60, IL-6R and xIL-6 do not make IL-6 known.
    for goal in ('Does the il-6 arm curve?', 'Does the IL-60 arm curve?', 'Does the IL-6R arm curve?', 'Does the xIL-6 arm curve?'):
        request, state = run(Scripted([FIT], say=lambda o: said), goal=goal)
        assert needs(state, request) == ['unresolved_reference'], goal
    # Without the request the goal is unknown: fail closed.
    request, state = run(Scripted([FIT], say=lambda o: said), goal='Does the IL-6 arm curve?')
    assert ladder_of(state)['next']['needs'] == ['unresolved_reference']
    # From a context item the operator chose, and from an operator decision note.
    from arc_science.exploration.changes import MISSION_CHANGES, declare
    from arc_science.exploration.models import ContextItem, OperatorDecision
    request, state = run(Scripted([FIT], say=lambda o: said))
    memo = ContextItem(kind='memory', ref='mem-1', title='Earlier arms', digest='a' * 64, text='The IL-6 arm was flat.')
    chosen = request.model_copy(update={'context_items': (memo,)})
    assert ladder_of(state, request=chosen)['rung'] == 1
    origin = lambda state, request: build_claims(state, traced(state), None, None, request=request)['claims'][0]['references'][1]['origin']
    assert origin(state, chosen) == {'origin': 'context'}
    decision = OperatorDecision(target='branch', target_id='curve', directive='pursue', note='Check IL-6 first.', round=1, plan_digest='b' * 64)
    noted, _ = declare(state, 'decision', MISSION_CHANGES['decision']['derived'], 'Operator decisions.', at=1, decisions=(decision,))
    assert ladder_of(noted, request=request)['rung'] == 1 and origin(noted, request) == {'origin': 'note'}
    # The earliest recorded occurrence wins: the goal precedes the note.
    assert origin(noted, request.model_copy(update={'goal': 'Does the IL-6 arm curve?'})) == {'origin': 'goal'}
    # A name found only in a retrieved record resolves, with that observation as its origin.
    found = [{**SOUND[0], 'title': 'Deep learning with ResNet50 backbones.'}]
    request, state = run(Scripted([READ], falsifier_test=None, say=lambda o: 'The {{name:ResNet50}} review is {{read}}.'),
                         extra_tools=reads(found), egress=True)
    assert ladder_of(state, request=request)['rung'] == 1 and rung_check(decide(request, state)).state == 'satisfied'
    [card] = build_claims(state, traced(state), None, None, receipts=[RECEIPT], request=request)['claims']
    assert card['references'][0] == {'token': '{{name:ResNet50}}', 'kind': 'name', 'observation_id': None, 'field': None,
                                     'value': 'ResNet50', 'resolved': True, 'diagnostic': None,
                                     'origin': {'origin': 'observation', 'observation_id': 'read'}}
    assert 'vocabulary' in rung_check(decide(request, state)).reason
    # A name present only in model-written text (hypothesis, falsifier, plan reason, finding, next
    # test, or the model's own search query echoed in the recorded data) stays unresolved.
    query = {**READ, 'arguments': {'query': 'BRCA1'}}
    request, state = run(Named([query], falsifier_test=None, next_test='Recheck BRCA1.',
                               say=lambda o: 'The {{name:BRCA1}} review is {{read}}; BRCA1 carriers agree.'),
                         extra_tools=reads(SOUND), egress=True)
    assert 'BRCA1' in state.branches[0].hypothesis and state.observations[0].data['query'] == 'BRCA1'
    receipt = {**RECEIPT, 'request_digest': digest(query['arguments'])}
    assert ladder_of(state, request=request, receipts=(receipt,))['next']['needs'] == ['unresolved_reference']
    # A quantity disguised as a name is unresolved unless the study recorded that word.
    disguised = 'Recall rose in {{name:n500}} per {{read}}.'
    request, state = run(Scripted([READ], falsifier_test=None, say=lambda o: disguised), extra_tools=reads(SOUND), egress=True)
    assert needs(state, request) == ['unresolved_reference'] and rung_check(decide(request, state)).state == 'failed'
    recorded = [{**SOUND[0], 'title': 'Deep learning in the n500 cohort.'}]
    request, state = run(Scripted([READ], falsifier_test=None, say=lambda o: disguised), extra_tools=reads(recorded), egress=True)
    assert ladder_of(state, request=request)['rung'] == 1
    # A failed or connector (not claim-eligible) observation adds nothing.
    from arc_science.exploration.validation import study_vocabulary
    assert study_vocabulary(state, request)['n500'] == {'origin': 'observation', 'observation_id': 'read'}
    for update in ({'status': 'error'}, {'claim_eligible': False}):
        other = state.model_copy(update={'observations': tuple(o.model_copy(update=update) for o in state.observations)})
        assert 'n500' not in study_vocabulary(other, request), update


def test_the_vocabulary_is_tokenised_for_exact_lookup_only():
    from arc_science.exploration.validation import words
    assert list(words('p53, BRCA1 and SARS-CoV-2 (IL-6/IL-8); H3K27ac_x 16S rRNA, 三百p53 TGF-β1; 0-5 x² 100 BRCA')) == [
        'p53', 'BRCA1', 'SARS-CoV-2', 'IL-6', 'IL-8', 'H3K27ac', '16S', 'p53', 'TGF-β1']
    # Scope limit: a hyphenated compound is one word, so p53 inside p53-dependent is not a word of its own.
    assert list(words('the p53-dependent arm')) == ['p53-dependent']


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
    # Lookup is mission-wide: an observation the claim leaves out of its evidence resolves when it
    # has an ok timeline row, and it counts as the claim's evidence; without the row it does not
    # resolve, and tracing names the missing row.
    _, state = run(Scripted([FIT, NULL], say=lambda o: BOUND[:-1] + ' against {{null.minimum_shuffled_validation_mse}}.'))
    assert ladder_of(state)['rung'] == 1
    [scoped] = state.claim_scope.branches
    narrowed = scoped.model_copy(update={'evidence_ids': ('fit',)})
    assert ladder_of(state, scoped=narrowed)['rung'] == 1
    ladder = ladder_of(state, scoped=narrowed, rows=[r for r in traced(state) if r['action_id'] != 'null'])
    assert ladder['rung'] == 0 and ladder['next']['needs'] == ['timeline_missing', 'unresolved_reference'] and ladder['verdict'] == 'blocked'


class OtherBranch(DemoAgent):
    """Round 0 runs `peek` on branch 'peek'; round 1 opens 'curve', which runs `curve` and whose
    finding may reference the peek observations."""
    def __init__(self, peek=(FIT,), curve=(DESCRIBE,), finding='Error {{fit.validation_mse}} over {{describe.n}} points.'):
        self.peek, self.curve, self.finding = peek, curve, finding

    def model_for(self, role):
        return MODELS[role]

    async def propose(self, context):
        if context['round'] == 0:
            return {'branches': [{'id': 'peek', 'title': 'Peek', 'hypothesis': 'Look.', 'falsifier': 'None.', 'parents': []}],
                    'actions': [{**a, 'branch_id': 'peek'} for a in self.peek], 'stop': False, 'reason': 'Look.'}
        if context['round'] == 1:
            return {'branches': [{'id': 'curve', 'title': 'Curve', 'hypothesis': 'Quadratic.', 'falsifier': 'None.', 'parents': []}],
                    'actions': [{**a, 'branch_id': 'curve'} for a in self.curve], 'stop': False, 'reason': 'Compare.'}
        return {'stop': True, 'reason': 'Done.'}

    async def assess(self, role, context):
        ok = [o['id'] for o in context['observations'] if o['status'] == 'ok' and o['branch_id'] == 'curve']
        return {'assessments': [{'branch_id': 'curve', 'position': 'support', 'evidence_ids': ok, 'finding': self.finding}] if ok else []}


def test_a_reference_to_another_branch_resolves_with_its_provenance_and_joins_the_evidence():
    _, state = run(OtherBranch())
    ladder = ladder_of(state)
    assert ladder['rung'] == 1 and 'numbers_bound' in ladder['met'] and 'timeline_ok' in ladder['met']
    [card] = [c for c in build_claims(state, traced(state), None, None)['claims'] if c['branch_id'] == 'curve']
    assert card['references'][0]['resolved'] and card['references'][0]['observation_id'] == 'fit'
    # The referenced observation is on the card's evidence list and counts for the claim.
    assert {e['id']: e['counts_for_scope'] for e in card['evidence']} == {'describe': True, 'fit': True}
    # Without an ok timeline row the other branch's observation does not resolve, and the tracing
    # of the evidence it still joins says why.
    missing = [r for r in traced(state) if r['action_id'] != 'fit']
    failed = [{**r, 'outcome': 'error'} if r['action_id'] == 'fit' else r for r in traced(state)]
    assert ladder_of(state, rows=missing)['next']['needs'] == ['timeline_missing', 'unresolved_reference']
    assert ladder_of(state, rows=failed)['next']['needs'] == ['timeline_not_ok', 'unresolved_reference']
    # A connector (not claim-eligible) observation never resolves, on any branch.
    hidden = state.model_copy(update={'observations': tuple(o.model_copy(update={'claim_eligible': False}) if o.id == 'fit' else o
                                                           for o in state.observations)})
    assert ladder_of(hidden)['next']['needs'] == ['unresolved_reference']


def test_a_cross_branch_source_is_checked_for_retraction_and_needs_its_receipt():
    _, state = run(OtherBranch(peek=(READ,), curve=(FIT,), finding='Consistent with {{read}}.'), extra_tools=reads(RECORDS), egress=True)
    ladder = ladder_of(state, verification=passing(state))
    assert ladder['rung'] == 0 and ladder['next']['needs'] == ['retracted_source'] and ladder['verdict'] == 'blocked'
    # Not referenced, the other branch's retrieval is not the claim's evidence.
    _, quiet = run(OtherBranch(peek=(READ,), curve=(FIT,), finding='Consistent.'), extra_tools=reads(RECORDS), egress=True)
    assert ladder_of(quiet)['rung'] == 1
    # A cross-branch read resolves only with its receipt in the grant ledger; without it the read
    # still joins the evidence, so the missing or unchecked receipt is named and a retraction seen.
    _, sound = run(OtherBranch(peek=(READ,), curve=(FIT,), finding='Consistent with {{read}}.'), extra_tools=reads(SOUND), egress=True)
    assert ladder_of(sound)['rung'] == 1 and 'ledger_receipt' in ladder_of(sound)['met']
    for receipts, need in (((), 'receipt_missing'), (({**RECEIPT, 'outcome': 'failed'},), 'receipt_missing'), (None, 'receipt_unchecked')):
        assert ladder_of(sound, receipts=receipts)['next']['needs'] == [need, 'unresolved_reference'], receipts
        assert ladder_of(state, receipts=receipts)['next']['needs'] == [need, 'unresolved_reference', 'retracted_source'], receipts


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
         'value': fit['validation_mse'], 'resolved': True, 'diagnostic': None},
        {'token': '{{fit.degree}}', 'kind': 'number', 'observation_id': 'fit', 'field': 'degree', 'value': 2, 'resolved': True,
         'diagnostic': None},
        {'token': '{{fit.accuracy}}', 'kind': 'number', 'observation_id': 'fit', 'field': 'accuracy', 'value': None, 'resolved': False,
         'diagnostic': 'unresolved_reference'}]
    assert card['ladder']['rung'] == 0 and 'reference traceability' in card['ladder']['note']
    # Typed segments beside each rendered string, one per occurrence; they rebuild it exactly.
    for rendered, parts in zip(card['supported_scope_rendered'], card['supported_scope_segments']):
        assert ''.join(p['rendered'] for p in parts) == rendered
    parts = card['supported_scope_segments'][0]
    assert [p['kind'] for p in parts] == ['text', 'number', 'text', 'number', 'text', 'number', 'text']
    assert parts[1] == {'kind': 'number', 'text': '{{fit.validation_mse}}', 'observation_id': 'fit', 'field': 'validation_mse',
                        'value': fit['validation_mse'], 'resolved': True, 'diagnostic': None,
                        'rendered': repr(fit['validation_mse']) + ' [validation_mse, fit]'}
    assert parts[5]['diagnostic'] == 'unresolved_reference' and parts[5]['rendered'] == '{{fit.accuracy}}'
    # A malformed text is shown verbatim, none of its tokens resolve and every segment says so.
    _, state = run(Scripted([FIT], say=lambda o: 'Error {{fit.validation_mse}} and {{fit.degree}.'))
    [card] = build_claims(state, traced(state), None, None)['claims']
    assert card['supported_scope_rendered'] == card['supported_scope']
    assert [r['resolved'] for r in card['references']] == [False]
    assert {p['diagnostic'] for p in card['supported_scope_segments'][0]} == {'malformed_reference'}


def test_every_finding_text_is_rendered_but_only_the_supported_scope_bears_the_rungs():
    """Uncertainty details, next tests and each role's finding are rendered with their own
    diagnostics; they lie outside the ladder's guarantee (a next test is an instruction)."""
    doubt = lambda o: 'Error {{fit.validation_mse}} may not hold for {{name:BRCA1}}; {{fit.accuracy}} is unknown.'
    request, state = run(Scripted([FIT], say=lambda o: BOUND, doubt=doubt, next_test='Collect 100 samples beyond {{fit.n_train}}.'),
                         goal='Does the curve hold for BRCA1?')
    [card] = build_claims(state, traced(state), None, None, request=request)['claims']
    fit = state.observations[0].data
    value = repr(fit['validation_mse']) + ' [validation_mse, fit]'
    [challenge] = [u for u in card['uncertainties'] if u['reason'] == 'challenged']
    assert challenge['detail'] == doubt(None)
    assert challenge['detail_rendered'] == 'Error ' + value + ' may not hold for BRCA1; {{fit.accuracy}} is unknown.'
    assert [p['diagnostic'] for p in challenge['detail_segments'] if p['diagnostic']] == ['unresolved_reference']
    for test in card['next_tests']:
        assert test['test'] == 'Collect 100 samples beyond {{fit.n_train}}.'
        assert test['test_rendered'] == 'Collect 100 samples beyond ' + repr(fit['n_train']) + ' [n_train, fit].'
        assert test['test_segments'][0] == {'kind': 'text', 'text': 'Collect 100 samples beyond ', 'observation_id': None,
                                            'field': None, 'value': None, 'resolved': None, 'diagnostic': 'literal_numeral',
                                            'rendered': 'Collect 100 samples beyond '}
    findings = {f['role']: f for f in card['findings']}
    assert findings['falsifier']['finding_rendered'] == challenge['detail_rendered']
    assert findings['analyst']['finding_rendered'] == card['supported_scope_rendered'][0].split(': ', 1)[1]
    assert ''.join(p['rendered'] for p in findings['analyst']['finding_segments']) == findings['analyst']['finding_rendered']
    # Their references are listed apart from the scope's, labelled outside the ladder.
    assert {r['token'] for r in card['outside_ladder_references']} == {
        '{{fit.validation_mse}}', '{{name:BRCA1}}', '{{fit.accuracy}}', '{{fit.n_train}}', '{{fit.degree}}'}
    assert 'instruction' in card['outside_ladder_note'] and 'ladder' in card['outside_ladder_note']
    # The typed numeral and the unresolved reference outside the scope leave the rung alone.
    assert card['ladder']['rung'] == 1 and card['ladder']['verdict'] != 'blocked'


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


class Beside(Scripted):
    """Scripted, with a second branch 'peek' that runs `peek` in the same plan; the seats assess
    'curve' on its own observations, so anything from 'peek' reaches the claim only by reference."""

    def __init__(self, actions, peek, **kwargs):
        super().__init__(actions, **kwargs)
        self.peek = peek

    async def propose(self, context):
        plan = await super().propose(context)
        if context['round'] == 0:
            plan['branches'].append({'id': 'peek', 'title': 'Peek', 'hypothesis': 'Look.', 'falsifier': 'None.', 'parents': []})
            plan['actions'] += [{'branch_id': 'peek', **a} for a in self.peek]
        return plan

    async def assess(self, role, context):
        return await super().assess(role, {**context, 'observations': [o for o in context['observations'] if o['branch_id'] == 'curve']})


def test_a_cited_measurement_from_another_branch_counts_against_the_falsifier_and_the_null():
    line = {'id': 'line', 'tool': 'polynomial_fit', 'arguments': {'degree': 1}}
    _, quiet = run(Beside([FIT, NULL], [line], say=lambda o: BOUND))
    ladder = ladder_of(quiet, verification=passing(quiet))
    assert ladder['rung'] == 4 and ladder['verdict'] == 'accepted'  # uncited, the other branch's fit is not the claim's
    _, cited = run(Beside([FIT, NULL], [line], say=lambda o: 'Error {{fit.validation_mse}}; linear {{line.validation_mse}}.'))
    linear = next(o.data['validation_mse'] for o in cited.observations if o.id == 'line')
    assert linear > FIT_ERROR['threshold']
    ladder = ladder_of(cited, verification=passing(cited))
    assert ladder['verdict'] == 'rejected' and 'falsifier_refuted' in ladder['next']['needs']
    assert ladder['facts']['falsifier']['value'] == linear and ladder['facts']['falsifier']['measurements'] == 2
    # A cited control from another branch that beats the fit keeps the null unrejected.
    ctrl = {**NULL, 'id': 'ctrl'}
    _, pair = run(Beside([FIT, NULL], [ctrl], say=lambda o: 'Error {{fit.validation_mse}} against {{ctrl.minimum_shuffled_validation_mse}}.'))
    fit = next(o.data['validation_mse'] for o in pair.observations if o.id == 'fit')
    adverse = pair.model_copy(update={'observations': tuple(
        o.model_copy(update={'data': {**o.data, 'minimum_shuffled_validation_mse': fit / 2}}) if o.id == 'ctrl' else o
        for o in pair.observations)})
    ladder = ladder_of(adverse, verification=passing(adverse))
    assert 'null_not_rejected' in ladder['next']['needs'] and ladder['verdict'] != 'accepted'
    assert ladder['facts']['null_model']['minimum_shuffled_validation_mse'] == fit / 2


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


def test_permutation_controls_of_any_size_are_one_request():
    _, state = run(ControlFirst(32, 128))
    peek, rerun = [o for o in state.observations if o.tool == 'permutation_control']
    assert peek.action.arguments != rerun.action.arguments and request_identity(peek) == request_identity(rerun)
    # Every other tool's request is its arguments: fits of another degree are other requests.
    _, fits = run(Scripted([FIT, {**FIT, 'id': 'cubic', 'arguments': {'degree': 3}}, {**FIT, 'id': 'again'}]))
    quadratic, cubic, again = fits.observations
    assert request_identity(quadratic) == request_identity(again) != request_identity(cubic)


class ReadFirst(Replay):
    """Round 0 reads the literature on branch 'peek': no numerical observation precedes the
    commit. Round 1 opens 'curve' with its falsifier, a fit, a control and a literature read,
    `query` for the second read (the first read's own query makes it the identical request)."""

    def __init__(self, query=READ['arguments']['query']):
        self.query = query

    async def propose(self, context):
        if context['round'] == 0:
            return {'branches': [{'id': 'peek', 'title': 'Peek', 'hypothesis': 'Read first.', 'falsifier': 'None.', 'parents': []}],
                    'actions': [{**READ, 'branch_id': 'peek'}], 'stop': False, 'reason': 'Read.'}
        if context['round'] == 1:
            branch = {'id': 'curve', 'title': 'Curved response', 'hypothesis': 'The response needs a quadratic term.',
                      'falsifier': 'Validation error above the threshold.', 'parents': [], 'falsifier_test': FIT_ERROR}
            return {'branches': [branch], 'actions': [{**FIT, 'branch_id': 'curve'}, {**NULL, 'branch_id': 'curve'},
                                                      {**READ, 'id': 'read2', 'branch_id': 'curve', 'arguments': {'query': self.query}}],
                    'stop': False, 'reason': 'Commit after reading.'}
        return {'stop': True, 'reason': 'Done.'}


def test_an_identical_non_numerical_request_before_the_commit_keeps_l3_unmet():
    """The only earlier observation is a literature read (not in NUMERICAL_CATALOG), so only the
    request-identity rule can tell that the claim's read was seen before the falsifier."""
    other = {'query': 'another fixture'}
    receipts = (RECEIPT, {**RECEIPT, 'id': 'receipt-2', 'request_digest': digest(other)})
    for query, rung in ((READ['arguments']['query'], 2), (other['query'], 4)):
        _, state = run(ReadFirst(query), extra_tools=reads(SOUND), egress=True)
        assert [o.tool for o in state.observations][0] == 'literature_search' and 'literature_search' not in NUMERICAL_CATALOG
        rows = [{**r, 'receipt_id': 'receipt-2'} if r['action_id'] == 'read2' and query != READ['arguments']['query'] else r
                for r in traced(state)]
        ladder = ladder_of(state, rows=rows, receipts=receipts, verification=passing(state))
        assert ladder['rung'] == rung, (query, ladder['next'])
        if rung == 2:
            assert ladder['next'] == {'rung': 3, 'needs': ['falsifier_after_observation']}


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
    assert check.state == 'failed' and 'needs L2' in check.reason and 'recomputation_missing' in check.reason
    # A search's hit_count is a snapshot, traced but never recomputed: L2 stays out of reach for
    # good, so release reports a failed check, not an unknown one.
    check = rung_check(decide(request, counted, passing(counted)))
    assert check.state == 'failed' and 'reference_not_replayable' in check.reason
    assert 'reference_not_replayable' in DEFECTS


def test_l2_needs_every_number_reference_to_be_replayable_on_any_branch():
    request, counted = run(Scripted([FIT, READ], say=lambda o: BOUND[:-1] + ' among {{read.hit_count}} works.'),
                           extra_tools=reads(SOUND), egress=True)
    ladder = ladder_of(counted, verification=passing(counted))
    assert ladder['rung'] == 1 and ladder['next'] == {'rung': 2, 'needs': ['reference_not_replayable']}
    assert 'recomputed' in ladder['met'] and 'references_replayable' not in ladder['met']
    # Replayable references and a passing receipt reach L2; a source reference and a name are not numbers.
    request, plain = run(Scripted([FIT, READ], say=lambda o: BOUND[:-1] + ' for {{name:BRCA1}}, see {{read}}.'),
                         extra_tools=reads(SOUND), egress=True, goal='Does the curve hold for BRCA1?')
    ladder = ladder_of(plain, verification=passing(plain), request=request)
    assert ladder['rung'] >= 2 and 'references_replayable' in ladder['met']
    # A non-replayable snapshot referenced from another branch withholds L2 as well.
    _, cross = run(OtherBranch(peek=(READ,), curve=(FIT,), finding='Error {{fit.validation_mse}} among {{read.hit_count}} works.'),
                   extra_tools=reads(SOUND), egress=True)
    ladder = ladder_of(cross, verification=passing(cross))
    assert ladder['rung'] == 1 and ladder['next'] == {'rung': 2, 'needs': ['reference_not_replayable']}
    # A stored observation that claims to be replayable counts only when a trusted tool made it.
    forged = cross.model_copy(update={'observations': tuple(o.model_copy(update={'replayable': True}) for o in cross.observations)})
    assert ladder_of(forged, verification=passing(forged))['next']['needs'] == ['reference_not_replayable']


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
    assert rung_check(decision).state == 'satisfied' and 'legacy' in rung_check(decision).reason
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
    assert rung_check(fresh).state == 'satisfied' and fresh.eligible_for_human_review


def test_a_legacy_mission_waives_only_the_reference_grammar():
    """Stored-style legacy missions (ladder_policy absent from the stored request) predate
    references: typed numerals and unresolved or malformed references are waived; every other
    unmet L1 or L2 condition still blocks export, defect or not."""
    typed = 'Validation error 0.4242 on the split.'
    # An unknown name is unresolved_reference, waived like the rest of the grammar.
    for said in (typed, 'Error {{fit.accuracy}}.', 'Error {{fit.validation_mse}.', 'Error {{fit.validation_mse}} for {{name:IL-6}}.'):
        request, state = run(Scripted([FIT], say=lambda o, s=said: s), policy='legacy')
        assert 'ladder_policy' not in request.model_dump(mode='json')
        verified = decide(request, state, passing(state))
        assert rung_check(verified).state == 'satisfied' and verified.eligible_for_human_review, said
        assert ladder_of(state, verification=passing(state))['rung'] == 0  # the displayed ladder is unchanged
        # The waived claim is not certified as traced: the reason names the waiver and the lower ladder.
        reason = rung_check(verified).reason
        assert GUARANTEE not in reason and 'reach their minimum rung' not in reason, reason
        assert 'waive' in reason and '1 of them' in reason and 'displayed ladder' in reason, reason
        # The same claim under the reference policy is blocked.
        assert rung_check(decide(request.model_copy(update={'ladder_policy': 'references'}), state, passing(state))).state == 'failed'
        # Unverified, the numeric claim still lacks L2 (recomputed): not waived.
        assert rung_check(decide(request, state)).state == 'unknown' and 'recomputation_missing' in rung_check(decide(request, state)).reason
    # A recorded retracted source blocks export, and a waived syntax failure beside it does not hide it.
    for said in ('Consistent with the recorded analysis.', typed):
        request, cited = run(Scripted([FIT, READ], say=lambda o, s=said: s), extra_tools=reads(RECORDS), egress=True, policy='legacy')
        blocked = decide(request, cited, passing(cited))
        check = rung_check(blocked)
        assert check.state == 'failed' and 'retracted_source' in check.reason and 'literal_numeral' not in check.reason, said
        with pytest.raises(release.ReleaseBlocked, match='claim_rungs:failed'):
            release.assert_exportable(request, cited.model_copy(update={'release': blocked}), event_chain_ok=True,
                                      timeline_rows=traced(cited), receipts=[RECEIPT])
    # A retracted source cited from another branch blocks whether or not its receipt is in the
    # ledger: waiving the unresolved token must not hide the read it names.
    request, cross = run(OtherBranch(peek=(READ,), curve=(FIT,), finding='Consistent with {{read}}.'),
                         extra_tools=reads(RECORDS), egress=True, policy='legacy')
    for receipts in ((RECEIPT,), (), ({**RECEIPT, 'outcome': 'failed'},), None):
        check = rung_check(decide(request, cross, passing(cross), receipts=receipts))
        assert check.state == 'failed' and 'retracted_source' in check.reason, receipts
    # So does a non-replayable snapshot cited from another branch, with or without its receipt.
    request, count = run(OtherBranch(peek=(READ,), curve=(FIT,), finding='Error {{fit.validation_mse}} among {{read.hit_count}} works.'),
                         extra_tools=reads(SOUND), egress=True, policy='legacy')
    for receipts in ((RECEIPT,), (), ({**RECEIPT, 'outcome': 'failed'},), None):
        check = rung_check(decide(request, count, passing(count), receipts=receipts))
        assert check.state == 'failed' and 'reference_not_replayable' in check.reason, receipts
    # A condition outside DEFECTS still blocks: an external read whose receipt cannot be checked.
    request, read = run(Scripted([READ], falsifier_test=None, say=lambda o: typed), extra_tools=reads(SOUND), egress=True, policy='legacy')
    assert rung_check(decide(request, read, passing(read))).state == 'satisfied'
    check = rung_check(decide(request, read, passing(read), receipts=None))
    assert check.state == 'unknown' and 'receipt_unchecked' in check.reason


# Prompts: the review seats are told the syntax and the fields they may reference.

def recorded(i, *, id=None, fields=('validation_mse',), branch='curve'):
    return {'id': id or 'obs-' + format(i, '03d'), 'branch_id': branch, 'tool': 'polynomial_fit', 'status': 'ok', 'claim_eligible': True,
            'data': {field: 0.5 for field in fields}}


def test_the_review_prompts_carry_the_reference_syntax_and_the_recorded_fields():
    from arc_science.exploration.providers import REVIEW_PROMPT, recorded_fields, render_prompt, review_prompt
    _, state = run(Scripted([FIT, NULL, READ]), extra_tools=reads(SOUND), egress=True)
    context = {'observations': [o.model_dump(mode='json') for o in state.observations]}
    listing = recorded_fields(context)
    for field in ('degree', 'training_mse', 'validation_mse', 'n_train', 'n_validation'):
        assert '{{fit.' + field + '}}' in listing, field
    assert '{{null.minimum_shuffled_validation_mse}}' in listing and '{{null.permutations}}' in listing
    assert '{{read}}' in listing and '{{read.hit_count}}' in listing and 'curve' in listing
    assert '{{fit.coefficients}}' not in listing and '{{fit.split}}' not in listing
    # Newest first, every observation listed, nothing left out.
    assert [line.split()[1] for line in listing.splitlines()] == ['read', 'null', 'fit']
    # Each observation is marked replayable or snapshot-only, so reviewers prefer replayable values.
    marks = {line.split()[1]: line for line in listing.splitlines()}
    assert 'replayable' in marks['fit'] and 'replayable' in marks['null'] and 'snapshot-only' in marks['read']
    assert 'snapshot-only' not in marks['fit'] and 'snapshot-only' not in marks['null']
    prompt = review_prompt('falsifier')
    assert prompt.startswith(REVIEW_PROMPT) and prompt.endswith('Role: falsifier')
    assert '{{<observation id>.<field>}}' in prompt and '{{<observation id>}}' in prompt and 'numeral' in prompt
    # Names with digits go in a name token, and a quantity is never written as a name.
    assert '{{name:<name>}}' in prompt and '{{name:SARS-CoV-2}}' in prompt and 'never' in prompt and 'quantity' in prompt
    # A name with digits must appear verbatim in the goal or the recorded data; replayable values are preferred.
    assert 'verbatim' in prompt and 'goal' in prompt and 'recorded data' in prompt and 'snapshot-only' in prompt
    # The listing travels in the user message the review seats share, never in the instructions.
    assert '{{fit.degree}}' not in prompt
    schema = {'title': 'Reconciliation'}
    message = render_prompt(context, schema, references=True)
    assert message.startswith(render_prompt(context, schema)) and listing in message
    assert listing not in render_prompt(context, schema)


def test_the_review_message_lists_the_studys_names_with_digits_newest_first():
    """Up to 60 digit-bearing vocabulary words, newest first, whole entries, with a count of the
    unlisted ones, in the user message both review transports share; never model-written text."""
    from arc_science.exploration.providers import LIST_NAMES, NAMES_LABEL, recorded_names, render_prompt
    assert LIST_NAMES == 60
    read = {**recorded(0, id='read'), 'tool': 'literature_search', 'action': {'arguments': {'query': 'n500 cohort'}},
            'data': {'query': 'n500 cohort', 'records': [{'title': 'ResNet50 in the BRCA1 arm', 'doi': '10.1038/nature14539'}]}}
    context = {'goal': 'Does p53 or BRCA1 drive the curve?', 'mission_context': [{'title': 'IL-6 memo', 'text': 'IL-6 was flat.'}],
               'branches': [{'hypothesis': 'H3K27ac drives it.'}], 'assessments': [{'finding': 'GPT-5 says so.'}],
               'observations': [read, {**recorded(1, id='bad'), 'status': 'error', 'data': {'label': 'X9'}}]}
    names = recorded_names(context)
    assert names.splitlines()[0] == 'nature14539, ResNet50, IL-6, BRCA1, p53'
    for absent in ('n500', 'H3K27ac', 'GPT-5', 'X9'):
        assert absent not in names, absent
    message = render_prompt(context, {'title': 'Reconciliation'}, references=True)
    assert NAMES_LABEL in message and names in message
    assert NAMES_LABEL not in render_prompt(context, {'title': 'Proposal'})
    # At most 60, newest first; the rest counted. A word longer than 40 characters is left out, never cut.
    many = {'goal': ' '.join('g' + str(i) for i in range(70)) + ' ' + 'z' * 40 + '9'}
    lines = recorded_names(many).splitlines()
    assert lines[0].split(', ') == ['g' + str(i) for i in range(69, 9, -1)]
    assert lines[1].startswith('11 ') and 'not listed' in lines[1]
    assert recorded_names({'goal': 'plain words only'}) == 'none yet'


def test_the_listing_is_bounded_newest_first_and_says_what_it_left_out():
    from arc_science.exploration.providers import LIST_CHARS, LIST_ENTRIES, LIST_ID, recorded_fields
    assert (LIST_ENTRIES, LIST_CHARS, LIST_ID) == (40, 4000, 40)
    # At most 40 entries, newest first; the rest are counted and still valid to reference.
    listing = recorded_fields({'observations': [recorded(i) for i in range(50)]})
    lines = listing.splitlines()
    assert [line.split()[1] for line in lines[:-1]] == ['obs-' + format(i, '03d') for i in range(49, 9, -1)]
    assert lines[-1].startswith('10 ') and 'not listed' in lines[-1] and 'still valid' in lines[-1]
    # Exactly 40 fit with nothing left out and no count line.
    assert 'not listed' not in recorded_fields({'observations': [recorded(i) for i in range(40)]})
    # The character budget is spent at whole entries: every listed entry is complete, and the next
    # newest entry would not have fit.
    wide = [recorded(i, fields=['field_' + format(k, '02d') + '_' + 'x' * 20 for k in range(8)]) for i in range(40)]
    listing = recorded_fields({'observations': wide})
    lines = listing.splitlines()
    entries, tail = lines[:-1], lines[-1]
    assert len('\n'.join(entries)) <= LIST_CHARS < len('\n'.join(entries + [entries[0]]))
    assert all(line.count('{{') == 8 for line in entries)
    assert tail.startswith(str(40 - len(entries)) + ' ') and [line.split()[1] for line in entries] == [
        'obs-' + format(i, '03d') for i in range(39, 39 - len(entries), -1)]
    # Complete ids only: an id longer than 40 characters is left out and counted, never cut.
    ids = ['a' * 40, 'b' * 41]
    listing = recorded_fields({'observations': [recorded(0, id=i) for i in ids]})
    assert '- ' + 'a' * 40 + ' ' in listing and 'b' * 40 not in listing and listing.splitlines()[-1].startswith('1 ')
    assert recorded_fields({'observations': []}) == '- none yet'


def test_both_transports_send_the_listing_in_the_user_message_not_the_system_prompt(monkeypatch):
    import sys
    import time
    from arc_science.exploration import cli_seats
    from arc_science.exploration.cli_seats import CliAgent
    from arc_science.exploration.providers import HTTPAgent, ModelEndpoint, recorded_fields
    from arc_science.transport import AccessGrant, ProviderError
    context = {'goal': 'g', 'round': 1, 'branches': [], 'assessments': [], 'observations': [recorded(i) for i in range(3)]}
    listing = recorded_fields(context)
    sent = []

    async def capture(arguments, stdin_text, *rest):
        sent.append((arguments, stdin_text))
        raise ProviderError('captured')
    monkeypatch.setattr(cli_seats, 'run_process', capture)
    cli = CliAgent([sys.executable, str(FIXTURES / 'fake_claude.py'), 'success'], 'm', 'm', provider='anthropic',
                   environment={'PATH': 'x', 'SystemRoot': 'C:/Windows', 'TEMP': 'C:/Temp'})
    try:
        with pytest.raises(ProviderError):
            asyncio.run(cli.assess('falsifier', context))
        with pytest.raises(ProviderError):
            asyncio.run(cli.propose(context))
    finally:
        cli.close()
    (review_argv, review_stdin), (_, plan_stdin) = sent
    system = review_argv[review_argv.index('--system-prompt') + 1]
    assert 'Role: falsifier' in system and '{{obs-000.validation_mse}}' not in system
    assert listing in review_stdin and listing not in plan_stdin
    bodies = []

    def handler(request):
        bodies.append(json.loads(request.content))
        return httpx.Response(503)
    cfg = ModelEndpoint(provider='openai', endpoint='https://api.openai.com/v1/responses', model='gpt-5.6', credential_ref='reviewer')

    async def call():
        async with ASYNC_CLIENT(transport=httpx.MockTransport(handler)) as http:
            agent = HTTPAgent(cfg, client=http, project='p', principal='u',
                              resolver=lambda ref, principal, project: AccessGrant(token='t', principal=principal, project_id=project,
                                                                                    resource=cfg.endpoint, credential_ref=ref,
                                                                                    expires_at=int(time.time()) + 60))
            with pytest.raises(ProviderError):
                await agent.assess('falsifier', context)
    asyncio.run(call())
    [body] = bodies
    assert 'Role: falsifier' in body['instructions'] and '{{obs-000.validation_mse}}' not in body['instructions']
    assert listing in body['input'][0]['content'][0]['text']


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
request = json.JSONDecoder().raw_decode(sys.stdin.read())[0]  # the JSON head; a fenced block or the reference listing may follow
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
