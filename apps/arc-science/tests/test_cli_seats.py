"""The Codex and Gemini CLI seats: tool-less, scrubbed, bounded print-mode calls with
the same bounded runner as Claude Code; effort mapped per transport, never coerced."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

from arc_science.exploration.cli_seats import CliAgent, auth_status
from arc_science.exploration.effort import applied_effort
from arc_science.exploration.providers import ModelEndpoint, SeatAgent
from arc_science.transport import ProviderError

FAKES = {'openai': Path(__file__).parent / 'fixtures' / 'fake_codex.py',
         'gemini': Path(__file__).parent / 'fixtures' / 'fake_gemini.py'}
ENV = {'PATH': 'x', 'SystemRoot': 'C:/Windows', 'TEMP': 'C:/Temp', 'OPENAI_API_KEY': 'leak', 'GEMINI_API_KEY': 'leak',
       'ARC_TEST_SECRET': 'leak'}


def agent(provider, mode, model='gpt-5.5', **kwargs):
    return CliAgent([sys.executable, str(FAKES[provider]), mode], model, model, provider=provider, environment=ENV, **kwargs)


def context():
    return {'goal': 'g', 'round': 0, 'data_origin': 'synthetic_fixture', 'dataset': {'digest': 'a' * 64, 'n': 8},
            'branches': [], 'observations': [], 'assessments': [], 'artifacts': [], 'visual_reports': [],
            'tools': {}, 'remaining': {'rounds': 3, 'actions': 3}, 'rule': 'exploratory'}


def run(coroutine):
    return asyncio.run(coroutine)


def test_codex_honours_the_restricted_contract_and_records_requested_only_identity(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'must-not-leak')
    seat = agent('openai', 'success', efforts={'planner': 'xhigh', 'falsifier': 'low'})
    try:
        proposal = run(seat.propose(context()))
        assert proposal['branches'][0]['id'] == 'linear'
        assessment = run(seat.assess('falsifier', context()))
        assert assessment['summary'].endswith('(effort low).')
        planner, falsifier = seat.calls
        assert planner['transport'] == 'codex' and planner['outcome'] == 'ok' and planner['provider'] == 'openai'
        assert planner['observed_model'] is None and planner['identity_source'] == 'requested_only'
        assert planner['identity_verified'] is False and planner['notes'] == ['skills_excluded']
        assert (planner['requested_effort'], planner['applied_effort'], planner['effort_source']) == ('xhigh', 'xhigh', 'seat')
        assert (falsifier['requested_effort'], falsifier['applied_effort']) == ('low', 'low')
        assert planner['usage']['output_tokens'] == 15 and 'prompt' not in planner
        # Per-call schema and final-message files do not outlive the call.
        assert sorted(p.name for p in seat.workdir.iterdir()) == []
        arguments = seat.arguments('gpt-5.5', 'x', 'high', {'schema': Path('s'), 'last': Path('l')})
        assert arguments[-1] == '-' and '--strict-config' in arguments and 'model_reasoning_effort="high"' in arguments
        assert not any(a.startswith('tools.view_image') for a in arguments)
    finally:
        seat.close()
    assert not seat.workdir.exists()


@pytest.mark.parametrize('mode,expected', [
    ('tool', 'attempted a tool action .command_execution.'),
    ('error-item', 'rate_limited'),
    ('turn-failed', 'model_unsupported'),
    ('two-messages', 'Missing or ambiguous'),
    ('mismatch', 'final message and event stream disagree'),
    ('no-last', 'wrote no final message'),
    ('garbage', 'no JSON envelope'),
])
def test_every_codex_failure_is_a_provider_error(mode, expected):
    seat = agent('openai', mode)
    try:
        with pytest.raises(ProviderError, match=expected):
            run(seat.propose(context()))
        assert seat.calls[-1]['outcome'] == 'failed'
    finally:
        seat.close()


def test_gemini_cli_honours_the_plan_mode_contract_and_reports_identity():
    seat = agent('gemini', 'success', model='gemini-3-pro')
    try:
        proposal = run(seat.propose(context()))
        assert proposal['stop'] is False
        call = seat.calls[-1]
        assert call['transport'] == 'gemini-cli' and call['observed_model'] == 'gemini-3-pro'
        assert call['identity_source'] == 'gemini_cli_stats_models' and call['identity_verified'] is True
        assert call['usage'] == {'input': 100, 'candidates': 20, 'total': 120}
        assert call['effort_source'] == 'provider_default' and call['applied_effort'] is None
        assert sorted(p.name for p in seat.workdir.iterdir()) == ['deny-all.toml', 'system-settings.json']
    finally:
        seat.close()
    dated = agent('gemini', 'dated-model', model='gemini-3-pro')
    try:
        run(dated.propose(context()))
        assert dated.calls[-1]['observed_model'] == 'gemini-3-pro-20260901'
    finally:
        dated.close()


@pytest.mark.parametrize('mode,expected', [
    ('ineligible', 'account_ineligible'),
    ('tool', 'attempted a tool action'),
    ('wrong-model', 'does not match configuration'),
    ('garbage', 'no JSON envelope'),
    ('unknown-mode', 'exited with status 2'),
])
def test_every_gemini_failure_is_a_provider_error(mode, expected):
    seat = agent('gemini', mode, model='gemini-3-pro')
    try:
        with pytest.raises(ProviderError, match=expected):
            run(seat.propose(context()))
    finally:
        seat.close()


def test_a_hung_cli_is_killed_at_the_deadline():
    seat = agent('openai', 'hang', timeout=2)
    try:
        with pytest.raises(ProviderError, match='time limit'):
            run(seat.propose(context()))
    finally:
        seat.close()


def test_effort_is_mapped_per_transport_and_never_coerced():
    assert applied_effort('anthropic', 'api', 'xhigh') == ('xhigh', 'seat')
    assert applied_effort('openai', 'cli', 'max') == ('max', 'seat')
    assert applied_effort('gemini', 'api', 'minimal') == ('minimal', 'seat')
    assert applied_effort('gemini', 'cli', 'medium') == (None, 'provider_default')
    assert applied_effort('openclaw', 'api', 'medium') == (None, 'provider_default')
    for provider, transport, level in (('anthropic', 'api', 'minimal'), ('gemini', 'api', 'xhigh'), ('gemini', 'cli', 'high'),
                                       ('openclaw', 'api', 'low'), ('anthropic', 'cli', 'minimal')):
        with pytest.raises(ValueError):
            applied_effort(provider, transport, level)
    with pytest.raises(ValueError, match='no effort control'):
        CliAgent([sys.executable], 'gemini-3-pro', provider='gemini', efforts={'planner': 'high'}).close()
    with pytest.raises(ValueError, match='does not express effort minimal'):
        ModelEndpoint(provider='anthropic', endpoint='https://api.anthropic.com/v1/messages', model='claude-opus-5',
                      credential_ref='planner', effort='minimal')
    # The historical name of the Anthropic CLI transport still resolves.
    legacy = ModelEndpoint(provider='claude-code', endpoint='C:/claude.exe', model='claude-opus-5', credential_ref='planner')
    assert (legacy.provider, legacy.transport, legacy.effort) == ('anthropic', 'cli', None)
    with pytest.raises(ValueError, match='Gemini model id'):
        ModelEndpoint(provider='gemini', endpoint='https://generativelanguage.googleapis.com/v1beta', model='../x', credential_ref='p')


def test_login_status_is_cost_free_per_cli():
    assert run(auth_status([sys.executable, str(FAKES['openai']), 'success'], provider='openai')) == {
        'logged_in': True, 'auth_method': 'chatgpt', 'api_provider': 'openai'}
    assert run(auth_status([sys.executable, str(FAKES['openai']), 'logged-out'], provider='openai'))['logged_in'] is False
    assert run(auth_status([sys.executable], environment={'USERPROFILE': 'C:/nowhere'}, provider='gemini')) == {
        'logged_in': False, 'auth_method': 'none', 'api_provider': 'google'}


def test_the_composite_agent_dispatches_each_role_to_its_own_seat_and_closes_each_once():
    planner = agent('openai', 'success', efforts={'planner': 'high'})
    reviewer = agent('gemini', 'success', model='gemini-3-pro')
    composite = SeatAgent({'planner': planner, 'reviewer': reviewer, 'falsifier': planner})
    try:
        assert composite.model_for('planner') == 'gpt-5.5' and composite.model_for('analyst') == 'gemini-3-pro'
        assert composite.model_for('falsifier') == 'gpt-5.5' and composite.model == 'gpt-5.5'
        run(composite.propose(context()))
        run(composite.assess('analyst', context()))
        run(composite.assess('falsifier', context()))
        assert composite.take_provenance('analyst')['transport'] == 'gemini-cli'
        assert composite.take_provenance('falsifier')['transport'] == 'codex'
        assert composite.take_provenance('planner')['applied_effort'] == 'high'
        assert composite.take_provenance('planner') is None
        with pytest.raises(ProviderError, match='visual review endpoint is not configured'):
            run(composite.review_visual(context(), ()))
    finally:
        composite.close()
    assert not planner.workdir.exists() and not reviewer.workdir.exists()
    with pytest.raises(ValueError, match='Planner and reviewer seats are required'):
        SeatAgent({'planner': planner})


def test_a_codex_probe_reply_is_schema_valid_without_an_observed_identity():
    from arc_science.service import ProbeReply
    seat = agent('openai', 'success', efforts={'probe': 'low'})
    try:
        assert run(seat._call('gpt-5.5', "You are Arc Science's readiness probe. Return only the JSON object {\"ok\": true}.",
                              {'probe': True}, ProbeReply, role='probe')) == {'ok': True}
        assert seat.calls[-1]['identity_verified'] is False and seat.calls[-1]['applied_effort'] == 'low'
    finally:
        seat.close()


def test_the_codex_schema_file_is_the_strict_response_schema(tmp_path):
    # The live CLI refused the plain pydantic schema (no additionalProperties: false); the
    # strict form the OpenAI HTTP adapter sends is what goes on disk.
    seat = agent('openai', 'success')
    try:
        files = seat.flavour.files(seat.workdir, 'call1', 'x', {'type': 'object', 'title': 'ProbeReply',
                                                              'properties': {'ok': {'type': 'boolean', 'default': True}}})
        assert json.loads(files['schema'].read_text(encoding='utf-8')) == {
            'type': 'object', 'title': 'ProbeReply', 'properties': {'ok': {'type': 'boolean'}}, 'required': ['ok'],
            'additionalProperties': False}
    finally:
        seat.close()


def test_provider_text_is_redacted_before_it_is_shown_or_stored():
    from arc_science.exploration.cli_seats import failure_reason, redact
    assert redact('Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz0123456789') == 'Authorization: [redacted]'
    assert redact('api_key=sk-live-1234 and token: xyz') == 'api_key=[redacted] and token: [redacted]'
    assert redact('opaque ' + 'A' * 40 + ' end') == 'opaque [redacted] end'
    assert redact('The model is not supported when using Codex') == 'The model is not supported when using Codex'
    assert failure_reason('HTTP 400 secret=abc') == 'provider_rejected (HTTP 400 secret=[redacted])'
    assert failure_reason('Rate limit reached') == 'rate_limited'


def test_openclaw_may_sit_on_an_exact_loopback_like_the_native_rule():
    from arc_science.exploration.providers import HTTPAgent
    from arc_science.transport import is_loopback_http, validate_endpoint
    for genuine in ('http://127.0.0.1:18789/v1/responses', 'http://localhost/v1', 'http://[::1]:8080/x'):
        assert is_loopback_http(genuine) and validate_endpoint(genuine, loopback=True) == genuine
    for deceptive in ('http://localhost.evil.example/v1', 'http://127.0.0.1.evil/v1', 'http://127.0.0.1:0/v1',
                      'http://127.0.0.1:x/v1', 'http://[::1]x/v1', 'http://user@127.0.0.1/v1'):
        assert not is_loopback_http(deceptive)
        with pytest.raises(ValueError):
            validate_endpoint(deceptive, loopback=True)
    with pytest.raises(ValueError):
        validate_endpoint('http://127.0.0.1:18789/v1/responses')  # only OpenClaw seats ask for loopback
    claw = ModelEndpoint(provider='openclaw', endpoint='http://127.0.0.1:18789/v1/responses', model='agent', credential_ref='c',
                         agent_id='iso', openclaw_isolated=True)
    assert HTTPAgent(claw, client=None, resolver=None, project='p', principal='x').model == 'agent'
    bad = claw.model_copy(update={'endpoint': 'http://localhost.evil.example/v1/responses'})
    with pytest.raises(ValueError):
        HTTPAgent(bad, client=None, resolver=None, project='p', principal='x')
