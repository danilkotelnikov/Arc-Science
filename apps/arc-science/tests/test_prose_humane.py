"""Humane prose: local diagnostics as observations, and a seat rewrite that keeps every
protected span or returns nothing. No authorship claim, no detector promise."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

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
    assert 'arc-humane-prose-1' in text
    assert 'cannot promise that' in text and 'Preserve before you polish' in text
    assert 'Lack of specificity' in text and 'marked gap' in text
    assert 'Do not add deliberate errors' in text
    skill = Path(__file__).resolve().parents[3] / '.claude' / 'skills' / 'humane-prose' / 'SKILL.md'
    assert skill.is_file() and 'The edits, in order of value' in skill.read_text(encoding='utf-8')


class FakeSeat:
    """A seat whose edit is scripted; the service's checks are what is under test."""

    def __init__(self, edit):
        self.edit = edit
        self.calls = []

    def model_for(self, role):
        return 'fake-model'

    async def _call(self, model, instructions, context, schema, *, role):
        assert 'Preserve before you polish' in instructions and role == 'prose'
        self.calls.append({'transport': 'fake', 'role': role, 'requested_model': model, 'observed_model': model, 'identity_verified': True})
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
        assert behaviour['version'] == 'arc-humane-prose-1' and 'Preserve before you polish' in behaviour['text']
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
        # A seat edit that loses a number is refused and nothing is returned.
        mode['value'] = 'mangle'
        lost = c.post('/api/prose/humanise', headers=AUTH, json={'text': SAMPLE, 'allow_egress': True})
        assert lost.status_code == 409 and lost.json()['detail']['code'] == 'preservation_failed'
        assert 'text' not in lost.json()['detail']
        audit = (tmp_path / 'data' / 'prose' / 'humanise.jsonl').read_text(encoding='utf-8').splitlines()
        records = [json.loads(line) for line in audit]
        assert [r['status'] for r in records] == ['attempted', 'edited', 'attempted', 'preservation_failed']
        assert all(len(r['text_hmac']) == 64 and 'text' not in r for r in records) and 'In today' not in ''.join(audit)
