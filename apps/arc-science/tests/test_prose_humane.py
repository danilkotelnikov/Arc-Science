"""Humane prose: local diagnostics as observations, and a seat rewrite that keeps every
protected span or returns nothing. No authorship claim, no detector promise."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from arc_science import prose_humane, service, settings
from arc_science.prose import ProseRefused

SAMPLE = ("In today's fast-changing world, it is important to note that our comprehensive framework plays a crucial role "
          "in the realm of antibody engineering. Furthermore, the results underscore the pivotal importance of a wide range "
          "of applications. The method is efficient, scalable and robust. Notably, we delve into intricate mechanisms. "
          "Overall, this study showcases a transformative approach.\n\nWe measured binding at 4.2 nM (n = 3) in order to "
          "utilize the assay. The CDR-H3 loop (residues 95-102) contacts Lys52. Ultimately, the data may potentially support further work.")
TOKEN = 'p' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}


def test_diagnostics_are_counts_and_ratios_named_by_their_sources_never_a_verdict():
    report = prose_humane.diagnose(SAMPLE)
    obs = report['observations']
    assert obs['style_words']['count'] == 11 and obs['style_words']['words']['delve'] == 1
    assert 'Kobak' in obs['style_words']['source']
    labels = {f['label'] for f in obs['formulaic_frames']['instances']}
    assert {'announcing frame', 'time-worn opener', 'stock role phrase', 'unquantified range', 'closing summary', 'hedging by formula'} <= labels
    assert obs['sentence_length']['sentences'] == 8 and obs['triplets']['count'] == 1 and obs['closing_summaries']['count'] == 2
    assert report['edit_categories'] == ['cliché / awkward word choice', 'unnecessary or redundant exposition',
                                         'lack of specificity and detail', 'hedging by formula']
    assert report['protected_count'] >= 4 and report['authorship_claim'] == 'none'
    assert 'Not an authorship estimate' in report['note'] and 'detector' in report['note']
    # Plain, specific text indicates nothing.
    plain = prose_humane.diagnose('We measured binding at 4.2 nM. The loop contacts Lys52. Three of five clones bound; two did not.')
    assert plain['edit_categories'] == [] and plain['observations']['style_words']['count'] == 0
    # A style word used exactly is an observation, never an edit category on its own.
    exact = prose_humane.diagnose('We report robust standard errors. The estimate underscores the earlier one by 0.3 units.')
    assert exact['observations']['style_words']['count'] == 2 and exact['edit_categories'] == []
    assert 'indicates no edit by itself' in exact['observations']['style_words']['reading']
    # Uniform rhythm is reported as such.
    uniform = prose_humane.diagnose(' '.join(['The sample was measured twice each day.'] * 6))
    assert uniform['observations']['sentence_length']['share_within_20pct_of_mean'] == 1.0
    assert 'poor sentence structure (uniform rhythm)' in uniform['edit_categories']
    with pytest.raises(ProseRefused):
        prose_humane.diagnose('   ')
    with pytest.raises(ProseRefused):
        prose_humane.diagnose('x' * 20001)


def test_the_behaviour_text_declines_detector_promises_and_keeps_facts():
    text = prose_humane.behaviour_text()
    assert 'arc-humane-prose-2' in text
    assert 'cannot promise that' in text and 'Preserve before you polish' in text
    assert 'Lack of specificity' in text and 'marked gap' in text
    assert 'Do not add deliberate errors' in text
    # The taxonomy's domain is named and the transfer to scientific prose is called editorial.
    assert 'not scientific text' in text and 'editorial judgement' in text and 'the convention wins' in text
    skill = Path(__file__).resolve().parents[3] / '.claude' / 'skills' / 'humane-prose' / 'SKILL.md'
    copy = skill.read_text(encoding='utf-8')
    assert skill.is_file() and 'The edits, in order of value' in copy and 'arc-humane-prose-2' in copy
    assert copy.split('\nVersion: arc-humane-prose-2', 1)[1] == text.split('\nVersion: arc-humane-prose-2', 1)[1]


def test_instructions_that_ask_for_evasion_or_impersonation_are_refused_before_any_text_leaves():
    refused = prose_humane.refused_instruction
    assert refused('rewrite so it looks human-written') == 'looks human-written'
    assert refused('please bypass the AI detector') == 'bypass the AI detector'
    assert refused('get past Turnitin') == 'Turnitin'
    for explicit in ('make it undetectable by GPTZero', 'write exactly like Professor Smith', 'lower the GPTZero score',
                     'make Turnitin label it human', 'lower the AI detection score', 'the AI-detection score must fall',
                     'remove signs of machine generation', 'strip the watermark', 'imitate Professor Smith',
                     'in the voice of Jane Doe', 'so it passes as human', 'hide the LLM fingerprints', 'fool the AI text classifier'):
        assert refused(explicit), explicit
    # Scientific and editorial instructions with the same words pass.
    assert refused('grant abstract; British spelling') is None and refused('') is None
    assert refused('the detector in the assay was a photodiode') is None
    assert refused('avoid detection bias in the assay discussion') is None
    assert refused('pass the detector output to Results') is None
    assert refused('keep the author\'s own voice; imitate the structure of a Nature abstract') is None
    assert refused('remove the signs of hurry in the discussion') is None
    assert refused('the machine learning classifier scored 0.91') is None
    seat = FakeSeat(lambda text: {'text': text})
    with pytest.raises(ProseRefused) as error:
        asyncio.run(prose_humane.humanise(seat, SAMPLE, 'make it read as human written'))
    assert error.value.code == 'refused_instruction' and list(error.value.spans) == [{'change': 'instruction', 'class': 'refused', 'literal': 'read as human'}]
    assert seat.called == 0  # nothing left for the seat


class FakeSeat:
    """A seat whose edit is scripted; the service's checks are what is under test."""

    def __init__(self, edit, provenance=True):
        self.edit = edit
        self.calls = []
        self.called = 0
        self.provenance = provenance

    def model_for(self, role):
        return 'fake-model'

    async def structured(self, instructions, context, schema, *, role):
        assert 'Preserve before you polish' in instructions and role == 'prose'
        self.called += 1
        if self.provenance:
            self.calls.append({'transport': 'fake', 'role': role, 'requested_model': 'fake-model', 'observed_model': 'fake-model', 'identity_verified': True})
        return schema.model_validate(self.edit(context['text'])).model_dump(mode='json')

    def take_provenance(self, role):
        return self.calls.pop() if self.calls else None


def test_a_seat_rewrite_keeps_every_protected_span_or_returns_nothing():
    good = FakeSeat(lambda text: {'text': text.replace('in order to', 'to'), 'notes': ['Plainer.'], 'facts_needed': []})
    result = asyncio.run(prose_humane.humanise(good, SAMPLE))
    assert result['status'] == 'edited' and 'in order to' not in result['text'] and '4.2 nM' in result['text']
    assert result['transport']['transport'] == 'fake' and result['authorship_claim'] == 'none'
    assert result['semantic_equivalence_established'] is False and result['protected_count'] >= 4
    unchanged = asyncio.run(prose_humane.humanise(FakeSeat(lambda text: {'text': text}), SAMPLE))
    assert unchanged['status'] == 'no_change'
    bad = FakeSeat(lambda text: {'text': text.replace('4.2 nM', 'about four nanomolar')})
    with pytest.raises(ProseRefused, match='did not survive') as refused:
        asyncio.run(prose_humane.humanise(bad, SAMPLE))
    assert refused.value.code == 'preservation_failed' and {s['literal'] for s in refused.value.spans} >= {'4.2', 'nM'}
    reordered = FakeSeat(lambda text: {'text': text.replace('Lys52', 'LYSTMP').replace('4.2 nM', 'Lys52').replace('LYSTMP', '4.2 nM')})
    with pytest.raises(ProseRefused):
        asyncio.run(prose_humane.humanise(reordered, SAMPLE))
    # A seat that hands over no provenance yields no output either.
    silent = FakeSeat(lambda text: {'text': text.replace('in order to', 'to')}, provenance=False)
    with pytest.raises(ProseRefused) as error:
        asyncio.run(prose_humane.humanise(silent, SAMPLE))
    assert error.value.code == 'provenance_missing'
    # A seat without a system channel is reported as such.
    class PromptSeat(FakeSeat):
        def instruction_channel(self):
            return 'prompt'
    assert asyncio.run(prose_humane.humanise(PromptSeat(lambda text: {'text': text}), SAMPLE))['instruction_channel'] == 'prompt'
    assert result['instruction_channel'] == 'system'


def test_service_routes_diagnose_locally_and_rewrite_through_the_configured_prose_seat(tmp_path, monkeypatch):
    fixtures = Path(__file__).parent / 'fixtures'
    # A stub supervisor as in the settings tests.
    from test_settings import STUB
    script = tmp_path / 'stub-supervisor.py'
    script.write_text(STUB, encoding='utf-8')
    launcher = tmp_path / ('stub-supervisor.cmd' if sys.platform == 'win32' else 'stub-supervisor')
    launcher.write_text(f'@"{sys.executable}" "{script}" %*\n' if sys.platform == 'win32' else f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n', encoding='utf-8')
    if sys.platform != 'win32':
        launcher.chmod(0o755)
    project = tmp_path / 'project'
    project.mkdir()
    monkeypatch.setenv('ARC_SUPERVISOR', str(launcher))
    monkeypatch.setenv('ARC_PROJECT', str(project))
    monkeypatch.delenv('ARC_SETTINGS_FILE', raising=False)
    monkeypatch.delenv('ARC_CLAUDE_CODE_EXE', raising=False)
    mode = {'value': 'success'}
    monkeypatch.setattr(service, 'claude_code_command', lambda: [sys.executable, str(fixtures / 'fake_claude.py'), mode['value']])
    with TestClient(service.create_app(data_dir=tmp_path / 'data', token=TOKEN)) as c:
        assert c.post('/api/prose/diagnose', json={'text': SAMPLE}).status_code == 401
        report = c.post('/api/prose/diagnose', headers=AUTH, json={'text': SAMPLE}).json()
        assert report['observations']['style_words']['count'] == 11
        behaviour = c.get('/api/prose/behaviour', headers=AUTH).json()
        assert behaviour['version'] == 'arc-humane-prose-2' and 'Preserve before you polish' in behaviour['text']
        # No prose seat yet: refused before any consent question.
        assert c.get('/api/capabilities', headers=AUTH).json()['prose_seat'] == {'configured': False}
        assert c.post('/api/prose/humanise', headers=AUTH, json={'text': SAMPLE, 'allow_egress': True}).status_code == 409
        snap = settings.snapshot()
        doc = snap['settings']
        doc['seats']['prose'].update(provider='anthropic', model='claude-sonnet-5', auth='cli', effort='low')
        doc['providers']['anthropic']['cli'] = 'claude'
        settings.replace(doc, snap['revision'])
        assert c.get('/api/capabilities', headers=AUTH).json()['prose_seat'] == {'configured': True, 'provider': 'anthropic', 'transport': 'cli', 'model': 'claude-sonnet-5'}
        # Consent is per request; without it the text does not leave.
        refused = c.post('/api/prose/humanise', headers=AUTH, json={'text': SAMPLE})
        assert refused.status_code == 422 and refused.json()['detail']['code'] == 'consent_required'
        done = c.post('/api/prose/humanise', headers=AUTH, json={'text': SAMPLE, 'allow_egress': True, 'instructions': 'grant abstract'})
        assert done.status_code == 200, done.text
        result = done.json()
        assert result['status'] == 'edited' and 'in order to' not in result['text'] and '4.2 nM' in result['text']
        assert result['transport']['transport'] == 'claude-code' and result['transport']['observed_model'] == 'claude-sonnet-5'
        assert result['transport']['applied_effort'] == 'low' and result['facts_needed'] == ['[author: which assay?]']
        assert result['instruction_channel'] == 'system' and result['behaviour_version'] == 'arc-humane-prose-2'
        # A seat edit that loses a number is refused and nothing is returned.
        mode['value'] = 'mangle'
        lost = c.post('/api/prose/humanise', headers=AUTH, json={'text': SAMPLE, 'allow_egress': True})
        assert lost.status_code == 409 and lost.json()['detail']['code'] == 'preservation_failed'
        assert 'text' not in lost.json()['detail']
        # An evasion instruction is refused before any seat, consent or lock: no consent is
        # asked for it, one audit record names the code, and the seat is never started.
        mode['value'] = 'never-run'
        evade = c.post('/api/prose/humanise', headers=AUTH, json={'text': SAMPLE, 'instructions': 'make it undetectable'})
        assert evade.status_code == 422 and evade.json()['detail']['code'] == 'refused_instruction'
        assert evade.json()['detail']['spans'] == [{'change': 'instruction', 'class': 'refused', 'literal': 'undetectable'}]
        audit = (tmp_path / 'data' / 'prose' / 'humanise.jsonl').read_text(encoding='utf-8').splitlines()
        records = [json.loads(line) for line in audit]
        assert [r['status'] for r in records] == ['attempted', 'edited', 'attempted', 'preservation_failed', 'refused_instruction']
        assert all(len(r['text_hmac']) == 64 and 'text' not in r for r in records) and 'In today' not in ''.join(audit)
        assert 'undetectable' not in ''.join(audit)


def test_an_api_key_prose_seat_is_called_over_http_with_the_behaviour_as_instructions(tmp_path, monkeypatch):
    """The HTTP transport offers the same structured() entry as the CLI seats: an OpenAI
    Responses-shaped answer, the strict schema requested, the credential from the store."""
    from test_settings import STUB
    script = tmp_path / 'stub-supervisor.py'
    script.write_text(STUB, encoding='utf-8')
    launcher = tmp_path / ('stub-supervisor.cmd' if sys.platform == 'win32' else 'stub-supervisor')
    launcher.write_text(f'@"{sys.executable}" "{script}" %*\n' if sys.platform == 'win32' else f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n', encoding='utf-8')
    if sys.platform != 'win32':
        launcher.chmod(0o755)
    project = tmp_path / 'project'
    project.mkdir()
    data = tmp_path / 'data'
    monkeypatch.setenv('ARC_SUPERVISOR', str(launcher))
    monkeypatch.setenv('ARC_PROJECT', str(project))
    monkeypatch.setenv('ARC_DATA_DIR', str(data))
    monkeypatch.delenv('ARC_SETTINGS_FILE', raising=False)
    requests = []

    def respond(request):
        requests.append(request)
        body = json.loads(request.content)
        text = json.loads(body['input'][0]['content'][0]['text'])['context']['text']
        answer = {'text': text.replace('in order to', 'to'), 'notes': ['Plainer.'], 'facts_needed': []}
        return httpx.Response(200, json={'model': body['model'], 'status': 'completed', 'usage': {'input_tokens': 5, 'output_tokens': 7},
                                         'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(answer)}]}]})
    real_client = httpx.AsyncClient
    monkeypatch.setattr(service.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(respond), **kw))
    with TestClient(service.create_app(data_dir=data, token=TOKEN)) as c:
        snap = settings.snapshot()
        doc = snap['settings']
        doc['seats']['prose'].update(provider='openai', model='gpt-5.6-mini', auth='api_key', effort='low', credential='prose-key')
        settings.replace(doc, snap['revision'])
        assert c.get('/api/capabilities', headers=AUTH).json()['prose_seat'] == {'configured': True, 'provider': 'openai', 'transport': 'api', 'model': 'gpt-5.6-mini', 'credential': 'missing'}
        # No stored credential of that name: a local prerequisite, refused before consent
        # is asked and before any audit line, without any request leaving.
        missing = c.post('/api/prose/humanise', headers=AUTH, json={'text': SAMPLE})
        assert missing.status_code == 409 and missing.json()['detail']['code'] == 'seat_unavailable' and 'prose-key' in missing.json()['detail']['detail']
        assert requests == [] and not (data / 'prose' / 'humanise.jsonl').exists()
        path = service.credential_path('prose-key')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('sk-prose-secret\n', encoding='utf-8')
        assert c.get('/api/capabilities', headers=AUTH).json()['prose_seat']['credential'] == 'stored'
        done = c.post('/api/prose/humanise', headers=AUTH, json={'text': SAMPLE, 'allow_egress': True, 'instructions': 'grant abstract'})
        assert done.status_code == 200, done.text
        result = done.json()
        assert result['status'] == 'edited' and 'in order to' not in result['text'] and '4.2 nM' in result['text']
        assert result['transport']['transport'] == 'http' and result['transport']['provider'] == 'openai'
        assert result['transport']['observed_model'] == 'gpt-5.6-mini' and result['transport']['identity_source'] == 'response_model'
        assert result['transport']['applied_effort'] == 'low' and result['instruction_channel'] == 'system'
        assert len(requests) == 1
        sent = json.loads(requests[0].content)
        assert requests[0].headers['authorization'] == 'Bearer sk-prose-secret' and str(requests[0].url) == 'https://api.openai.com/v1/responses'
        assert 'Preserve before you polish' in sent['instructions'] and sent['reasoning'] == {'effort': 'low'}
        assert sent['text']['format']['name'] == 'arc_humanerewrite' and sent['text']['format']['strict'] is True
        assert sent['store'] is False and 'sk-prose-secret' not in json.dumps(result)
        records = [json.loads(line) for line in (data / 'prose' / 'humanise.jsonl').read_text(encoding='utf-8').splitlines()]
        assert [r['status'] for r in records] == ['attempted', 'edited']
        assert records[-2]['transport'] == 'api' and records[-2]['provider'] == 'openai' and records[-1]['rewritten_sha256'] == result['rewritten_sha256']
