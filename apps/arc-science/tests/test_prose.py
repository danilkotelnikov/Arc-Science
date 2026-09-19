"""Prose control: a rule-based local rewrite that preserves scientific content byte for
byte, and consented, bounded, audited third-party detection that claims nothing."""
import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from arc_science import prose

TOKEN = 'p' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}
SCIENTIFIC = ('It is important to note that we utilize a polynomial fit in order to describe the data '
              '(Smith et al., 2020). The residual was 0.12 ± 0.03 µM at 37 °C, p < 0.05, n = 12 [3]. Tyr33 of chain H '
              'contacts Asp101; the 1DQJ structure and UniProt P01308 were used prior to analysis. See `arc-science verify` '
              'and https://example.org/x. Moreover, IL-6 and TNF-α rose by 12%. Sequence QVQLVQSGAEVKK was subsequent to '
              'v0.6.0 on 2026-09-19, as $E=mc^2$ and NaCl in "the quoted utilize" show.')


def app(tmp_path):
    from arc_science.service import create_app
    return create_app(data_dir=tmp_path, token=TOKEN)


def test_the_rewrite_edits_only_prose_and_keeps_every_protected_span_in_order():
    before = [(n, lit) for _, _, n, lit in prose.protected_spans(SCIENTIFIC)]
    result = prose.rewrite(SCIENTIFIC)
    assert result['status'] == 'edited'
    after = [(n, lit) for _, _, n, lit in prose.protected_spans(result['text'])]
    assert after == before
    literals = [lit for _, lit in before]
    for literal in ('(Smith et al., 2020)', '0.12 ± 0.03 µM', '37 °C', 'p < 0.05', 'n = 12', '[3]', 'Tyr33', 'Asp101',
                    '1DQJ', 'P01308', '`arc-science verify`', 'https://example.org/x', 'IL-6', 'TNF-α', '12%',
                    'QVQLVQSGAEVKK', 'v0.6.0', '2026-09-19', '$E=mc^2$', 'NaCl', '"the quoted utilize"'):
        assert literal in literals, literal
        assert literal in result['text']
    assert result['text'].startswith('We use a polynomial fit to describe the data')
    assert 'were used before analysis' in result['text'] and 'Moreover' not in result['text']
    assert {e['rule'] for e in result['edits']} == {'opener', 'in-order-to', 'prior-to', 'subsequent-to', 'utilize'}
    assert result['authorship_claim'] == 'none' and result['semantic_equivalence_established'] is False
    assert result['scientific_validity_established'] is False and 'not a human-authorship claim' in result['statement']
    assert result['rules_version'] == 'arc-prose-rules-1' and result['protected_count'] == len(before)
    # Idempotent: a second pass finds nothing left to edit.
    again = prose.rewrite(result['text'])
    assert again['status'] == 'no_change' and again['reason'] == 'no_applicable_safe_rule' and again['text'] == result['text']


def test_no_change_is_a_result_not_an_error_and_all_protected_text_says_so():
    assert prose.rewrite('The fit was adequate on the split.')['status'] == 'no_change'
    only = prose.rewrite('p < 0.05')
    assert only['status'] == 'no_change' and only['reason'] == 'all_text_protected'
    with pytest.raises(prose.ProseRefused) as refused:
        prose.rewrite('   ')
    assert refused.value.code == 'empty'


def test_meaning_sensitive_words_are_not_in_the_safe_rule_table():
    patterns = ' '.join(pattern for _, pattern, _ in prose.RULES)
    for word in ('very', 'really', 'wide range', 'leverage', 'majority', 'significant'):
        assert word not in patterns
    assert all(rule['rule'] and rule['pattern'] for rule in prose.RULE_TABLE)


def test_a_rule_never_edits_inside_a_protected_span():
    text = 'Run `in order to` and see "utilize this" (Doe et al., 2019) in order to compare.'
    result = prose.rewrite(text)
    assert result['text'] == 'Run `in order to` and see "utilize this" (Doe et al., 2019) to compare.'


def test_preservation_failure_refuses_atomically(monkeypatch):
    # A rule can never overlap a protected span, so force one whose replacement would
    # introduce a new protected literal: the ordered span sequence changes and the
    # rewrite is refused with no output.
    monkeypatch.setattr(prose, 'RULES', (('bad', r'\bsee\b', 'see 7'),))
    with pytest.raises(prose.ProseRefused) as refused:
        prose.rewrite('Please see 42 for details of the fit.')
    assert refused.value.code == 'preservation_failed'
    assert refused.value.spans == ({'change': 'added', 'class': 'number', 'literal': '7'},)


def detector(tmp_path, handler, enabled=True):
    return prose.Detector(tmp_path, enabled=enabled, transport=httpx.MockTransport(handler))


def audit(tmp_path):
    return [json.loads(line) for line in (tmp_path / 'prose' / 'detections.jsonl').read_text(encoding='utf-8').splitlines()]


def test_detection_sends_the_reference_request_and_returns_a_bound_receipt(tmp_path):
    seen = {}

    def handler(request):
        seen['url'] = str(request.url); seen['headers'] = dict(request.headers); seen['body'] = json.loads(request.content)
        return httpx.Response(200, json=[
            {'detectionType': 'COPYLEAKS', 'detectionResult': {'probability': '0.93', 'ai': '0.93', 'human': '0.07', 'classification': 'ai',
                                                                 'totalWords': '40', 'modelVersion': 'v3', 'scanId': 'abc', 'creationTime': 'now',
                                                                 'text': 'must be dropped'}},
            {'detectionType': 'HEMINGWAY', 'detectionResult': {'sentences': '3', 'grade': '9', 'words': '40', 'letters': '200'}}])

    text = 'The polynomial fit reproduced the measurements on the exploratory split without structure.'
    receipt = asyncio.run(detector(tmp_path, handler).detect(text, allow_egress=True))
    assert seen['url'] == 'https://api.edgeshop.ai/rewrite/text-detection'
    assert seen['body'] == {'type': 'original_text', 'text': text, 'detectionTypeList': ['COPYLEAKS', 'HEMINGWAY']}
    assert seen['headers']['user-agent'] == 'ai-humanizer-mcp-server/1.0' and seen['headers']['accept'] == 'application/json'
    assert receipt['status'] == 'ok' and receipt['complete'] is True and receipt['missing_types'] == []
    assert receipt['results']['COPYLEAKS']['probability'] == '0.93' and 'text' not in receipt['results']['COPYLEAKS']
    assert receipt['results']['HEMINGWAY']['grade'] == '9'
    assert receipt['service'] == 'api.edgeshop.ai' and receipt['reference_client'] == 'text2go/ai-humanizer-mcp-server'
    assert receipt['authorship_claim'] == 'none' and 'neither AI nor human authorship' in receipt['note']
    assert len(receipt['text_sha256']) == 64 and len(receipt['response_sha256']) == 64
    # The audit holds a keyed hash and the attempt before the outcome, never the text.
    lines = audit(tmp_path)
    assert [line['status'] for line in lines] == ['attempted', 'ok'] and lines[0]['text_hmac'] != receipt['text_sha256']
    assert text not in (tmp_path / 'prose' / 'detections.jsonl').read_text(encoding='utf-8')
    assert (tmp_path / 'prose' / 'audit.key').stat().st_size == 32


def test_a_single_object_answer_is_incomplete_and_says_which_detector_is_missing(tmp_path):
    handler = lambda request: httpx.Response(200, json={'detectionType': 'COPYLEAKS', 'detectionResult': {'probability': '0.1'}})  # noqa: E731
    receipt = asyncio.run(detector(tmp_path, handler).detect('x' * 40, allow_egress=True))
    assert receipt['complete'] is False and receipt['missing_types'] == ['HEMINGWAY'] and receipt['returned_types'] == ['COPYLEAKS']


@pytest.mark.parametrize('handler,code', [
    (lambda r: httpx.Response(500, text='boom'), 'http_500'),
    (lambda r: httpx.Response(302, headers={'location': 'https://elsewhere.example/'}), 'http_302'),
    (lambda r: httpx.Response(200, json={'unexpected': True}), 'provider_rejected'),
    (lambda r: httpx.Response(200, content=b'x' * (prose.RESPONSE_CAP + 1)), 'provider_rejected'),
    (lambda r: (_ for _ in ()).throw(httpx.ReadTimeout('slow')), 'timeout'),
    (lambda r: (_ for _ in ()).throw(httpx.ConnectError('down')), 'network'),
])
def test_every_failure_is_a_named_refusal_with_an_audit_line(tmp_path, handler, code):
    with pytest.raises(prose.ProseRefused) as refused:
        asyncio.run(detector(tmp_path, handler).detect('y' * 40, allow_egress=True))
    assert refused.value.code == code
    assert [line['status'] for line in audit(tmp_path)] == ['attempted', code]


def test_consent_bounds_switch_and_single_flight_are_enforced_before_any_egress(tmp_path):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=[{'detectionType': 'COPYLEAKS', 'detectionResult': {}}])

    d = detector(tmp_path, handler)
    for text, consent, code in (('z' * 40, False, 'consent_required'), ('short', True, 'bounds'), ('z' * 20001, True, 'bounds')):
        with pytest.raises(prose.ProseRefused) as refused:
            asyncio.run(d.detect(text, allow_egress=consent))
        assert refused.value.code == code
    assert calls == [] and not (tmp_path / 'prose').exists()
    off = detector(tmp_path, handler, enabled=False)
    with pytest.raises(prose.ProseRefused) as refused:
        asyncio.run(off.detect('z' * 40, allow_egress=True))
    assert refused.value.code == 'disabled' and calls == [] and not (tmp_path / 'prose').exists()
    assert off.capabilities()['detection']['enabled'] is False
    d.busy = True
    with pytest.raises(prose.ProseRefused) as refused:
        asyncio.run(d.detect('z' * 40, allow_egress=True))
    assert refused.value.code == 'busy'


def test_routes_expose_rules_rewrite_and_consented_detection(tmp_path, monkeypatch):
    with TestClient(app(tmp_path)) as c:
        assert c.get('/api/prose/rules').status_code == 401
        rules = c.get('/api/prose/rules', headers=AUTH).json()
        assert rules['rules_version'] == 'arc-prose-rules-1' and 'residue' in rules['protected_classes']
        assert rules['detection']['recipient'] == 'api.edgeshop.ai' and rules['detection']['enabled'] is True
        assert c.get('/api/capabilities', headers=AUTH).json()['prose']['rewrite']['egress'] is False
        rewritten = c.post('/api/prose/rewrite', headers=AUTH, json={'text': SCIENTIFIC}).json()
        assert rewritten['status'] == 'edited' and 'Tyr33' in rewritten['text']
        refused = c.post('/api/prose/detect', headers=AUTH, json={'text': SCIENTIFIC})
        assert refused.status_code == 422 and refused.json()['detail']['code'] == 'consent_required'
        assert 'api.edgeshop.ai' in refused.json()['detail']['detail']
        assert not (tmp_path / 'prose').exists()
        c.app.state.detector.transport = httpx.MockTransport(
            lambda r: httpx.Response(200, json=[{'detectionType': 'HEMINGWAY', 'detectionResult': {'grade': '8'}}]))
        receipt = c.post('/api/prose/detect', headers=AUTH, json={'text': SCIENTIFIC, 'allow_egress': True}).json()
        assert receipt['status'] == 'ok' and receipt['missing_types'] == ['COPYLEAKS'] and receipt['authorship_claim'] == 'none'
        c.app.state.detector.transport = httpx.MockTransport(lambda r: httpx.Response(503))
        failed = c.post('/api/prose/detect', headers=AUTH, json={'text': SCIENTIFIC, 'allow_egress': True})
        assert failed.status_code == 502 and failed.json()['detail']['code'] == 'http_503'


@pytest.mark.parametrize('text,expected', [
    ('Moreover, c-Myc expression increased.', 'c-Myc expression increased.'),
    ('Furthermore, qPCR and scRNA-seq agreed with mRNA levels in eLife.', 'qPCR and scRNA-seq agreed with mRNA levels in eLife.'),
    ('Additionally, p53 was lost.', 'p53 was lost.'),
    ('Additionally, the fit held.', 'The fit held.'),
])
def test_opener_removal_never_recases_an_identifier(text, expected):
    result = prose.rewrite(text)
    assert result['text'] == expected
    for token in ('c-Myc', 'qPCR', 'scRNA-seq', 'mRNA', 'eLife', 'p53'):
        if token in text:
            assert token in [lit for _, _, _, lit in prose.protected_spans(text)]


def test_the_audit_key_is_created_once_and_a_wrong_key_refuses_detection(tmp_path):
    handler = lambda request: httpx.Response(200, json=[{'detectionType': 'HEMINGWAY', 'detectionResult': {'grade': '8'}}])  # noqa: E731
    d = detector(tmp_path, handler)
    first = asyncio.run(d.detect('k' * 40, allow_egress=True))
    key = (tmp_path / 'prose' / 'audit.key').read_bytes()
    assert len(key) == 32
    second = asyncio.run(d.detect('k' * 40, allow_egress=True))
    lines = audit(tmp_path)
    assert lines[0]['text_hmac'] == lines[2]['text_hmac'] and first['text_sha256'] == second['text_sha256']
    (tmp_path / 'prose' / 'audit.key').write_bytes(b'short')
    with pytest.raises(prose.ProseRefused) as refused:
        asyncio.run(d.detect('k' * 40, allow_egress=True))
    assert refused.value.code == 'audit_key' and len(audit(tmp_path)) == 4
