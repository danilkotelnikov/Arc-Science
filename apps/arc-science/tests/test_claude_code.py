"""The Claude Code transport: a tool-less, scrubbed, bounded `claude -p` per model call."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

from arc_science.exploration import claude_code
from arc_science.exploration.claude_code import ClaudeCodeAgent, auth_status, failure_category
from arc_science.transport import ProviderError

FAKE = Path(__file__).parent / 'fixtures' / 'fake_claude.py'


def agent(mode, **kwargs):
    return ClaudeCodeAgent([sys.executable, str(FAKE), mode], 'claude-opus-5', 'claude-sonnet-5',
                           environment={'PATH': 'x', 'SystemRoot': 'C:/Windows', 'ANTHROPIC_API_KEY': 'leak',
                                        'ARC_TEST_SECRET': 'leak', 'TEMP': 'C:/Temp'}, **kwargs)


def context():
    return {'goal': 'g', 'round': 0, 'data_origin': 'synthetic_fixture', 'dataset': {'digest': 'a' * 64, 'n': 8},
            'branches': [], 'observations': [], 'assessments': [], 'artifacts': [], 'visual_reports': [],
            'tools': {}, 'remaining': {'rounds': 3, 'actions': 3}, 'rule': 'exploratory'}


def run(coroutine):
    return asyncio.run(coroutine)


def test_success_honours_the_invocation_contract_and_records_observed_identity(monkeypatch):
    monkeypatch.setenv('ANTHROPIC_API_KEY', 'must-not-leak')
    seat = agent('success')
    try:
        proposal = run(seat.propose(context()))
        assert proposal['branches'][0]['id'] == 'linear' and proposal['stop'] is False
        assessment = run(seat.assess('falsifier', context()))
        assert assessment == {'assessments': [], 'summary': 'Nothing observed yet.'}
        planner, falsifier = seat.calls
        assert planner['outcome'] == 'ok' and planner['requested_model'] == 'claude-opus-5'
        assert planner['observed_model'] == 'claude-opus-5' and planner['identity_source'] == 'claude_code_modelUsage'
        assert falsifier['requested_model'] == 'claude-sonnet-5' and falsifier['role'] == 'falsifier'
        assert planner['network_sandboxed'] is False and planner['tools'] == 'disabled'
        assert 'prompt' not in planner and 'ANTHROPIC_API_KEY' not in json.dumps(planner)
        assert seat.model_for('planner') == 'claude-opus-5' and seat.model_for('analyst') == 'claude-sonnet-5'
    finally:
        seat.close()
    assert not seat.workdir.exists()


@pytest.mark.parametrize('mode,expected', [
    ('auth', 'auth_expired'),
    ('credits', 'credit_exhausted'),
    ('stderr-only', 'credit_exhausted'),
    ('wrong-model', 'does not match configuration'),
    ('two-models', 'exactly one model identity'),
    ('tool', 'tool action'),
    ('huge', 'exceeds limit'),
    ('garbage', 'no JSON envelope'),
    ('prose', 'schema validation failed'),
    ('unknown-mode', 'exited with status 2'),
])
def test_every_failure_is_a_provider_error_without_a_synthetic_fallback(mode, expected):
    seat = agent(mode)
    try:
        with pytest.raises(ProviderError) as error:
            run(seat.propose(context()))
        assert expected in str(error.value)
        assert seat.calls[-1]['outcome'] == 'failed'
        assert 'OAuth session' not in json.dumps(seat.calls) or mode == 'auth'
    finally:
        seat.close()


def test_a_hung_call_is_killed_at_the_deadline():
    seat = agent('hang', timeout=1.5)
    try:
        with pytest.raises(ProviderError) as error:
            run(seat.propose(context()))
        assert 'time limit' in str(error.value)
        assert seat.calls[-1]['duration_ms'] < 10_000
    finally:
        seat.close()


def test_visual_review_is_refused_and_egress_is_declared():
    seat = agent('success')
    try:
        assert seat.requires_egress is True and seat.network_sandboxed is False
        with pytest.raises(ProviderError):
            run(seat.review_visual(context(), ()))
    finally:
        seat.close()


def test_auth_status_is_cost_free_and_truthful():
    assert run(auth_status([sys.executable, str(FAKE), 'success'])) == {'logged_in': True, 'auth_method': 'claude.ai'}
    assert run(auth_status([sys.executable, str(FAKE), 'logged-out'])) == {'logged_in': False, 'auth_method': 'none'}
    assert run(auth_status(['definitely-not-a-program'])) == {'logged_in': False, 'auth_method': 'unknown'}


def test_failure_categories_only_map_recognised_texts():
    assert failure_category('Failed to authenticate: OAuth session expired and could not be refreshed') == 'auth_expired'
    assert failure_category('Credit balance is too low') == 'credit_exhausted'
    assert failure_category('something else entirely') == 'provider_rejected'
    assert claude_code.scrubbed_environment({'PATH': 'p', 'ANTHROPIC_API_KEY': 'k'}) == {'PATH': 'p'}
    # Windows spells inherited names in upper case; the CLI crashes without SystemRoot.
    assert claude_code.scrubbed_environment({'SYSTEMROOT': 'C:/Windows', 'Comspec': 'cmd', 'SECRET': 'x'}) == {'SYSTEMROOT': 'C:/Windows', 'Comspec': 'cmd'}
