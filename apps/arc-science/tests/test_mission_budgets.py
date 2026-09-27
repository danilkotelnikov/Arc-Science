"""Spend and budgets (contracts C2-C4, research B2): what a mission spent, summed from the
per-call transport records; token, cost and time budgets enforced before each model step;
a budget the calls cannot measure fails closed; a cost budget is refused up front when a
bound seat cannot report cost; list rows carry round, max_rounds and updated_at."""
import asyncio
import sqlite3
import sys
import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from arc_science import service
from arc_science.contracts import canonical, digest
from arc_science.error_codes import ERROR_CODES, STOP_CODES
from arc_science.exploration.agents import DemoAgent, DemoVisionAgent
from arc_science.exploration.cli_seats import CliAgent
from arc_science.exploration.engine import explore, initialize
from arc_science.exploration.models import MissionRequest, MissionState, ModelRecord, UnboundCall, VisionRecord
from arc_science.exploration.providers import HTTPAgent, ModelEndpoint, SeatAgent
from arc_science.exploration.repository import MissionRepository
from arc_science.exploration.spend import running_minutes, spent
from arc_science.transport import AccessGrant, ProviderError
from test_claude_code_service import configured  # noqa: F401  (a fixture)

TOKEN = 'b' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}


def run(request, agent=None, **kwargs):
    return asyncio.run(explore(request, agent or DemoAgent(), **kwargs))


def record(role, transport, round=0):
    return ModelRecord(role=role, round=round, model='m', context_digest=digest({}), input_context={}, payload={}, transport=transport)


def state_with(records, calls=None, vision=()):
    base = initialize(MissionRequest(goal='Spend'))
    return base.model_copy(update={'model_records': tuple(records), 'vision_records': tuple(vision),
                                   'model_calls_used': len(records) + len(vision) if calls is None else calls})


# --- spent(state) ---

def test_spent_normalises_every_provider_usage_shape():
    records = [
        # Anthropic Messages: cache reads and writes are input the call consumed.
        record('planner', {'transport': 'http', 'usage': {'input_tokens': 100, 'output_tokens': 10,
                                                          'cache_creation_input_tokens': 5, 'cache_read_input_tokens': 7}}),
        # OpenAI Responses.
        record('analyst', {'transport': 'http', 'usage': {'input_tokens': 200, 'output_tokens': 20, 'total_tokens': 220}}),
        # Gemini generateContent: thinking tokens are billed as output.
        record('falsifier', {'transport': 'http', 'usage': {'promptTokenCount': 300, 'candidatesTokenCount': 30,
                                                            'thoughtsTokenCount': 3, 'totalTokenCount': 333}}),
        # Codex turn.completed.
        record('planner', {'transport': 'codex', 'usage': {'input_tokens': 400, 'cached_input_tokens': 50, 'output_tokens': 40}}, round=1),
        # Claude Code: usage plus the envelope's total_cost_usd, kept as cost_usd.
        record('analyst', {'transport': 'claude-code', 'usage': {'input_tokens': 500, 'output_tokens': 50}, 'cost_usd': 0.25}, round=1),
    ]
    out = spent(state_with(records))
    assert out['input_tokens'] == 112 + 200 + 300 + 400 + 500
    assert out['output_tokens'] == 10 + 20 + 33 + 40 + 50
    assert out['calls'] == 5 and out['measured'] is True and out['estimated'] is False
    # Only one of five calls reported a cost, so the cost is not known.
    assert out['cost_usd'] is None and out['minutes'] == 0
    assert set(out) == {'input_tokens', 'output_tokens', 'cost_usd', 'calls', 'minutes', 'measured', 'estimated', 'unrecorded_calls'}


def test_spent_counts_vision_calls_and_every_reserved_call():
    context = {'round': 0}
    vision = VisionRecord(candidate_digest='a' * 64, reviewed_digests=('b' * 64,), context_digest=digest(context),
                          input_context=context, round=0, model='vision-model', status='accepted', report_digest='c' * 64,
                          transport={'transport': 'claude-code', 'usage': {'input_tokens': 9, 'output_tokens': 1}, 'cost_usd': 0.5})
    planner = record('planner', {'transport': 'claude-code', 'usage': {'input_tokens': 1, 'output_tokens': 1}, 'cost_usd': 0.25})
    out = spent(state_with([planner], vision=[vision]))
    assert (out['input_tokens'], out['output_tokens'], out['cost_usd'], out['calls'], out['measured']) == (10, 2, 0.75, 2, True)
    # A reserved call that left no record (interrupted, timed out) is disclosed as unrecorded;
    # it is not a call that answered without usage.
    gap = spent(state_with([planner], calls=2))
    assert (gap['measured'], gap['unrecorded_calls'], gap['calls'], gap['cost_usd']) == (True, 1, 2, 0.25)
    # A record without usage, or with keys no provider uses, is unmeasured too.
    assert spent(state_with([record('planner', {'transport': 'http', 'usage': None})]))['measured'] is False
    assert spent(state_with([record('planner', {'transport': 'http', 'usage': {'tokens': 5}})]))['measured'] is False
    assert spent(state_with([record('planner', None)]))['measured'] is False
    # Nothing called yet: nothing spent, and that is measured.
    assert spent(state_with([])) == {'input_tokens': 0, 'output_tokens': 0, 'cost_usd': 0.0, 'calls': 0,
                                     'minutes': 0, 'measured': True, 'estimated': False, 'unrecorded_calls': 0}


@pytest.mark.parametrize('usage', [{'input_tokens': None, 'output_tokens': None}, {'input_tokens': '12', 'output_tokens': 3},
                                   {'input_tokens': float('nan'), 'output_tokens': 1}, {'input_tokens': -5000, 'output_tokens': 1},
                                   {'input_tokens': 10, 'output_tokens': float('inf')}, {'input_tokens': True, 'output_tokens': 1},
                                   {'promptTokenCount': 10, 'candidatesTokenCount': None}])
def test_usage_that_is_not_a_count_is_unmeasured(usage):
    out = spent(state_with([record('planner', {'transport': 'http', 'outcome': 'ok', 'usage': usage, 'cost_usd': 0.1})] * 7))
    assert out['measured'] is False and out['cost_usd'] is None and out['unrecorded_calls'] == 0


def test_a_negative_or_non_finite_cost_is_not_a_cost():
    for cost in (-1, float('nan'), float('inf'), '0.1', True):
        out = spent(state_with([record('planner', {'transport': 'claude-code', 'usage': {'input_tokens': 1, 'output_tokens': 1}, 'cost_usd': cost})]))
        assert out['measured'] is True and out['cost_usd'] is None


def test_a_failed_call_without_usage_is_unrecorded_not_unmeasured():
    failed = UnboundCall(role='analyst', round=0, outcome='failed', transport={'transport': 'http', 'outcome': 'failed', 'reason': 'HTTP 500'})
    base = state_with([record('planner', {'transport': 'http', 'usage': {'input_tokens': 5, 'output_tokens': 1}})], calls=2)
    out = spent(base.model_copy(update={'unbound_calls': (failed,)}))
    assert (out['measured'], out['unrecorded_calls'], out['input_tokens']) == (True, 1, 5)
    # A rejected answer that reported usage is counted like any other call.
    rejected = UnboundCall(role='falsifier', round=0, outcome='rejected',
                           transport={'transport': 'http', 'outcome': 'ok', 'usage': {'input_tokens': 7, 'output_tokens': 2}})
    out = spent(base.model_copy(update={'unbound_calls': (rejected,)}))
    assert (out['measured'], out['unrecorded_calls'], out['input_tokens'], out['output_tokens']) == (True, 0, 12, 3)


def test_running_minutes_sums_the_intervals_between_start_and_stop():
    rows = [{'operation': 'start', 'started_at': 0}, {'operation': 'plan', 'started_at': 1000},
            {'operation': 'pause', 'started_at': 120_000}, {'operation': 'resume', 'started_at': 600_000},
            {'operation': 'stop', 'started_at': 660_000}, {'operation': 'resume', 'started_at': 900_000}]
    # Two closed intervals (2 min, 1 min) and one still open for 30 s.
    assert running_minutes(rows, now_ms=930_000) == pytest.approx(3.5)
    assert running_minutes([], now_ms=5) == 0


def test_a_crash_closes_the_interval_at_the_last_worker_row_not_at_the_restart():
    # Ran 5 minutes, crashed; the service came back 8 hours later and wrote the interrupt row.
    rows = [{'operation': 'start', 'started_at': 0, 'finished_at': None},
            {'operation': 'plan', 'started_at': 60_000, 'finished_at': 120_000},
            {'operation': 'tool', 'started_at': 240_000, 'finished_at': 300_000},
            {'operation': 'reconcile', 'started_at': 290_000, 'finished_at': None},
            {'operation': 'interrupt', 'started_at': 485 * 60_000, 'finished_at': 485 * 60_000},
            {'operation': 'resume', 'started_at': 486 * 60_000, 'finished_at': None}]
    assert running_minutes(rows, now_ms=486 * 60_000) == pytest.approx(5.0)
    # A crash before any worker row closes the interval where it opened.
    assert running_minutes(rows[:1] + rows[4:5], now_ms=486 * 60_000) == 0


# --- the request fields ---

def test_budget_fields_are_bounded_optional_and_later_fields():
    plain = MissionRequest(goal='No budget')
    assert (plain.max_tokens, plain.max_cost_usd, plain.max_minutes) == (None, None, None)
    for field in ('max_tokens', 'max_cost_usd', 'max_minutes'):
        assert field in MissionRequest.LATER_FIELDS and field not in plain.model_dump(mode='json')
    # A request without budgets keeps the digest it had before the fields existed.
    assert digest(plain) == digest(MissionRequest.model_validate({**plain.model_dump(mode='json'), 'max_tokens': None}))
    bounded = MissionRequest(goal='Budget', max_tokens=1000, max_cost_usd=0.01, max_minutes=1)
    assert bounded.model_dump(mode='json')['max_cost_usd'] == 0.01
    MissionRequest(goal='Budget', max_tokens=5_000_000, max_cost_usd=500, max_minutes=1440)
    for bad in ({'max_tokens': 999}, {'max_tokens': 5_000_001}, {'max_cost_usd': 0.001}, {'max_cost_usd': 500.01},
                {'max_minutes': 0}, {'max_minutes': 1441}, {'max_cost_usd': float('inf')}):
        with pytest.raises(ValidationError):
            MissionRequest(goal='Budget', **bad)


# --- the demo agents report estimated usage ---

def test_demo_agents_report_usage_estimated_from_text_length():
    agent = DemoAgent()
    context = {'round': 0, 'observations': []}
    payload = asyncio.run(agent.propose(context))
    provenance = agent.take_provenance('planner')
    assert provenance['transport'] == 'fixture' and provenance['estimated'] is True
    assert provenance['usage_source'] == 'fixture_estimate' and provenance['cost_usd'] == 0.0
    assert provenance['usage'] == {'input_tokens': len(canonical(context)) // 4, 'output_tokens': len(canonical(payload)) // 4}
    # Handed over once.
    assert agent.take_provenance('planner')['usage'] is None
    final = run(MissionRequest(goal='Demo spend', max_tokens=5_000_000, max_cost_usd=500, max_minutes=1440))
    assert final.stop_code == 'plan_stop'
    out = spent(final)
    assert out['measured'] and out['estimated'] and out['cost_usd'] == 0.0
    assert out['calls'] == final.model_calls_used and out['input_tokens'] > 0 and out['output_tokens'] > 0


def test_vision_calls_record_their_transport_usage():
    final = run(MissionRequest(goal='Vision spend', vision_review=True, max_rounds=3), DemoVisionAgent())
    accepted = [r for r in final.vision_records if r.status == 'accepted']
    assert accepted and all(r.transport['transport'] == 'fixture' and r.transport['usage']['input_tokens'] > 0 for r in accepted)
    assert spent(final)['measured'] is True and spent(final)['calls'] == final.model_calls_used


def test_a_seat_agent_hands_over_the_vision_seats_provenance():
    class Seat:
        def __init__(self, name): self.name = name
        def model_for(self, role): return self.name
        def take_provenance(self, role): return {'from': self.name, 'role': role}
    agent = SeatAgent({'planner': Seat('planner'), 'reviewer': Seat('reviewer')}, vision=Seat('vision'))
    assert agent.take_provenance('vision') == {'from': 'vision', 'role': 'vision'}
    assert agent.take_provenance('analyst') == {'from': 'reviewer', 'role': 'analyst'}


# --- engine enforcement ---

def test_a_token_budget_stops_before_the_next_step_with_facts():
    final = run(MissionRequest(goal='Token budget', max_tokens=1000))
    assert (final.status, final.stop_code) == ('budget_exhausted', 'token_limit')
    facts = final.stop_facts
    assert facts['kind'] == 'tokens' and facts['limit'] == 1000
    total = spent(final)['input_tokens'] + spent(final)['output_tokens']
    assert facts['spent'] == total >= 1000
    # The planner stayed under the limit, so the reviewer step ran and crossed it; the next
    # planner call was never made: the overshoot is that one step.
    planner = final.model_records[0].transport['usage']
    assert planner['input_tokens'] + planner['output_tokens'] < 1000
    assert final.model_calls_used == 3 and [r.role for r in final.model_records] == ['planner', 'analyst', 'falsifier']
    assert STOP_CODES['token_limit']


class Priced(DemoAgent):
    """The fixture, reporting a price per call like the Claude Code transport."""
    def take_provenance(self, role):
        record = super().take_provenance(role)
        return {**record, 'cost_usd': 0.02}


def test_a_cost_budget_stops_with_facts():
    final = run(MissionRequest(goal='Cost budget', max_cost_usd=0.05), Priced())
    assert (final.status, final.stop_code) == ('budget_exhausted', 'cost_limit')
    assert final.stop_facts['kind'] == 'cost_usd' and final.stop_facts['limit'] == 0.05
    assert final.stop_facts['spent'] == pytest.approx(spent(final)['cost_usd']) and final.stop_facts['spent'] >= 0.05
    # Planner (0.02) then two reviewers (0.04): the limit is crossed by at most one step.
    assert final.model_calls_used == 3


def test_a_time_budget_stops_with_facts():
    minutes = iter([0.5, 2.0])
    final = run(MissionRequest(goal='Time budget', max_minutes=1), clock=lambda: next(minutes))
    assert (final.status, final.stop_code) == ('budget_exhausted', 'time_limit')
    assert final.stop_facts == {'kind': 'minutes', 'spent': 2.0, 'limit': 1}
    assert final.model_calls_used == 1


def test_without_a_clock_the_engine_times_its_own_run():
    # A generous limit is not reached by an offline run.
    assert run(MissionRequest(goal='Own clock', max_minutes=5)).stop_code == 'plan_stop'


class Unmeasured(DemoAgent):
    """A live-like transport that answered but reported no usage."""
    def take_provenance(self, role):
        super().take_provenance(role)
        return {'transport': 'http', 'role': role, 'outcome': 'ok', 'usage': None}


def test_a_call_without_usage_fails_closed_when_a_budget_is_set():
    final = run(MissionRequest(goal='Unmeasured', max_tokens=1_000_000), Unmeasured())
    assert (final.status, final.stop_code) == ('needs_input', 'budget_unmeasurable')
    assert final.stop_facts == {'kind': 'tokens', 'limit': 1_000_000, 'calls': 1, 'measured_calls': 0}
    # The paid record is kept.
    assert [r.role for r in final.model_records] == ['planner'] and final.model_records[0].transport['usage'] is None
    # Without a budget nothing is enforced and the mission runs to its end.
    assert run(MissionRequest(goal='No budget'), Unmeasured()).stop_code == 'plan_stop'


def test_a_cost_budget_fails_closed_when_calls_report_no_cost():
    final = run(MissionRequest(goal='No cost reported', max_cost_usd=1), type('Uncosted', (DemoAgent,), {
        'take_provenance': lambda self, role: {**DemoAgent.take_provenance(self, role), 'cost_usd': None}})())
    assert (final.stop_code, final.stop_facts['kind']) == ('budget_unmeasurable', 'cost_usd')


class Rejected(DemoAgent):
    """The fixture whose round-0 falsifier cites evidence that does not exist: the engine
    rejects the answer after the model was paid for it."""
    def _assess(self, role, context):
        out = super()._assess(role, context)
        if role == 'falsifier' and context['round'] == 0:
            out['assessments'][0]['evidence_ids'] = ['nope']
        return out


def test_a_rejected_review_keeps_its_usage_and_the_budget_keeps_running():
    final = run(MissionRequest(goal='Rejected review', max_tokens=5_000_000), Rejected())
    assert (final.status, final.stop_code) == ('completed', 'plan_stop')
    assert [(c.role, c.round, c.outcome) for c in final.unbound_calls] == [('falsifier', 0, 'rejected')]
    usage = final.unbound_calls[0].transport['usage']
    assert usage['input_tokens'] > 0
    out = spent(final)
    assert out['measured'] and out['unrecorded_calls'] == 0 and out['calls'] == final.model_calls_used
    accepted = sum(r.transport['usage']['input_tokens'] for r in final.model_records)
    assert out['input_tokens'] == accepted + usage['input_tokens']


def test_a_rejected_visual_review_keeps_its_usage():
    class BadVision(DemoVisionAgent):
        async def review_visual(self, context, artifacts):
            await super().review_visual(context, artifacts)
            return {'not': 'a report'}
    final = run(MissionRequest(goal='Bad vision', vision_review=True, max_rounds=3, max_tokens=5_000_000), BadVision())
    assert (final.stop_code, final.stop_facts['cause']) == ('vision_required', 'review_failed')
    rejected = [r for r in final.vision_records if r.status == 'rejected']
    assert len(rejected) == 1 and rejected[0].transport['usage']['input_tokens'] > 0
    assert spent(final)['measured'] and spent(final)['unrecorded_calls'] == 0


def test_a_reservation_abandoned_by_a_pause_does_not_kill_a_budgeted_mission():
    request = MissionRequest(goal='Paused mid-call', max_tokens=5_000_000)
    # A pause or restart during the round-0 planner call: the call was reserved, no record exists.
    paused = initialize(request).model_copy(update={'status': 'paused', 'model_calls_used': 1})
    final = asyncio.run(explore(request, DemoAgent(), initial=paused))
    assert (final.status, final.stop_code) == ('completed', 'plan_stop')
    out = spent(final)
    assert out['measured'] and out['unrecorded_calls'] == 1 and out['calls'] == final.model_calls_used


def test_an_unmeasured_last_planner_call_fails_closed_before_completing():
    class LastUnmeasured(DemoAgent):
        def take_provenance(self, role):
            record = super().take_provenance(role)
            return {**record, 'usage': None} if role == 'planner' and self.__dict__.get('_stopping') else record

        def _plan(self, context):
            plan = super()._plan(context)
            self.__dict__['_stopping'] = plan['stop']
            return plan
    final = run(MissionRequest(goal='Last call unmeasured', max_tokens=5_000_000), LastUnmeasured())
    assert (final.status, final.stop_code) == ('needs_input', 'budget_unmeasurable')
    assert final.stop_facts['calls'] == final.model_calls_used
    assert final.stop_facts['measured_calls'] == final.model_calls_used - 1


def test_the_last_step_spend_is_checked_before_the_round_limit():
    final = run(MissionRequest(goal='Last step', max_rounds=1, max_tokens=1000))
    assert (final.status, final.stop_code) == ('budget_exhausted', 'token_limit')
    assert final.stop_facts['spent'] >= 1000 and final.round == 1


def test_budget_stops_are_registered():
    for code in ('token_limit', 'cost_limit', 'time_limit', 'budget_unmeasurable'):
        assert STOP_CODES[code]
    assert ERROR_CODES['budget.cost_unreported']


def test_a_planner_answer_rejected_without_a_logger_still_keeps_its_usage():
    class BadPlan(DemoAgent):
        def _plan(self, context):
            plan = super()._plan(context)
            return {**plan, 'actions': [{**plan['actions'][0], 'branch_id': 'nowhere'}]} if plan['actions'] else plan
    final = run(MissionRequest(goal='Bad plan', max_tokens=5_000_000), BadPlan())  # no log= passed
    assert final.stop_code == 'planning_failed'
    assert [(c.role, c.outcome) for c in final.unbound_calls] == [('planner', 'rejected')]
    assert spent(final)['unrecorded_calls'] == 0 and spent(final)['input_tokens'] > 0


# --- answers a live transport rejects keep their usage ---

FAKE_CLAUDE = Path(__file__).parent / 'fixtures' / 'fake_claude.py'


def claude_seat(mode):
    return CliAgent([sys.executable, str(FAKE_CLAUDE), mode], 'claude-opus-5', environment={'PATH': 'x', 'SystemRoot': 'C:/Windows'})


def test_a_cli_answer_that_fails_the_schema_keeps_its_usage_and_cost():
    seat = claude_seat('prose')  # a paid envelope whose result is prose, not the schema
    try:
        with pytest.raises(ProviderError):
            asyncio.run(seat.assess('falsifier', {'goal': 'g'}))
        call = seat.take_provenance('falsifier')
    finally:
        seat.close()
    assert (call['outcome'], call['usage'], call['cost_usd']) == ('rejected', {'input_tokens': 10, 'output_tokens': 20}, 0.001)
    assert call['observed_model'] == 'claude-opus-5' and 'reason' in call


def test_rejected_cli_reviews_count_against_a_cost_budget():
    planner, reviewer = claude_seat('success'), claude_seat('prose')
    try:
        # Each fake call costs 0.001, three a round; only with the rejected reviews counted is 0.01 reached.
        final = run(MissionRequest(goal='Rejected CLI reviews', max_rounds=8, max_cost_usd=0.01, allow_egress=True),
                    SeatAgent({'planner': planner, 'reviewer': reviewer}))
    finally:
        planner.close()
        reviewer.close()
    # Uncounted, the reviews let the mission run all 8 rounds (24 paid calls) while reporting 0.008.
    assert (final.status, final.stop_code) == ('budget_exhausted', 'cost_limit')
    assert final.stop_facts['spent'] == pytest.approx(0.01) and final.round == 3
    assert [(c.role, c.outcome) for c in final.unbound_calls] == [('analyst', 'rejected'), ('falsifier', 'rejected')] * 3
    assert spent(final)['unrecorded_calls'] == 0 and spent(final)['calls'] == 10


def http_seat(body):
    cfg = ModelEndpoint(provider='anthropic', endpoint='https://api.example/v1/messages', model='m', credential_ref='k')

    def grant(ref, principal, project):
        return AccessGrant(token='s', principal=principal, project_id=project, resource=cfg.endpoint,
                           credential_ref=ref, expires_at=int(time.time()) + 300, auth_style='x-api-key')
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=body)))
    return HTTPAgent(cfg, client=client, resolver=grant, project='p', principal='local')


@pytest.mark.parametrize('body', [
    {'model': 'm', 'stop_reason': 'max_tokens', 'content': [{'type': 'text', 'text': '{"assess'}]},  # cut off, billed in full
    {'model': 'm', 'stop_reason': 'end_turn', 'content': [{'type': 'text', 'text': '{"assessments": "no"}'}]},  # fails the schema
    {'model': 'other', 'stop_reason': 'end_turn', 'content': [{'type': 'text', 'text': '{}'}]},  # identity mismatch
])
def test_an_http_answer_rejected_after_a_200_keeps_its_usage(body):
    seat = http_seat({**body, 'usage': {'input_tokens': 12000, 'output_tokens': 800}})
    with pytest.raises(ProviderError):
        asyncio.run(seat.assess('falsifier', {'goal': 'g'}))
    call = seat.take_provenance('falsifier')
    assert (call['outcome'], call['usage']) == ('rejected', {'input_tokens': 12000, 'output_tokens': 800})
    # Rejected without usage it is unmeasured, so a set budget fails closed rather than undercounting.
    seat = http_seat(body)
    with pytest.raises(ProviderError):
        asyncio.run(seat.assess('falsifier', {'goal': 'g'}))
    call = seat.take_provenance('falsifier')
    assert (call['outcome'], call['usage']) == ('rejected', None)
    state = state_with([record('planner', {'usage': {'input_tokens': 1, 'output_tokens': 1}})], calls=2)
    out = spent(state.model_copy(update={'unbound_calls': (UnboundCall(role='falsifier', round=0, outcome='rejected', transport=call),)}))
    assert (out['measured'], out['unrecorded_calls']) == (False, 0)


# --- the service ---

def app(tmp_path):
    return service.create_app(data_dir=tmp_path / 'data', token=TOKEN)


def finished(c, mid):
    for _ in range(3000):
        row = c.get(f'/api/missions/{mid}', headers=AUTH).json()
        if row['state']['status'] not in ('ready', 'running'):
            return row
        time.sleep(.01)
    raise AssertionError('mission did not finish')


def test_mission_reads_carry_spend_and_list_rows_carry_progress(tmp_path):
    with TestClient(app(tmp_path)) as c:
        before = int(time.time() * 1000)
        mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Spend read', 'max_rounds': 2, 'max_tokens': 5_000_000}).json()['id']
        listed = c.get('/api/missions', headers=AUTH).json()[0]
        assert (listed['id'], listed['round'], listed['max_rounds']) == (mid, 0, 2) and listed['updated_at'] >= before
        assert c.post(f'/api/missions/{mid}/start', headers=AUTH).status_code == 202
        row = finished(c, mid)
        assert row['request']['max_tokens'] == 5_000_000 and row['state']['stop_code'] == 'round_limit'
        out = row['spent']
        assert out['measured'] and out['estimated'] and out['calls'] == row['state']['model_calls_used'] == 6
        assert out['input_tokens'] > 0 and out['cost_usd'] == 0.0 and 0 <= out['minutes'] < 1
        listed = c.get('/api/missions', headers=AUTH).json()[0]
        assert (listed['round'], listed['max_rounds']) == (2, 2) and listed['updated_at'] >= before


def test_a_token_budget_stops_a_service_mission(tmp_path):
    with TestClient(app(tmp_path)) as c:
        mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Budget stop', 'max_tokens': 1000}).json()['id']
        c.post(f'/api/missions/{mid}/start', headers=AUTH)
        state = finished(c, mid)['state']
        assert state['stop_code'] == 'token_limit' and state['stop_facts']['limit'] == 1000


def test_a_store_from_before_updated_at_gains_the_column(tmp_path):
    path = tmp_path / 'missions.db'
    request = MissionRequest(goal='Old store')
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE missions (id TEXT PRIMARY KEY, request TEXT NOT NULL, request_digest TEXT NOT NULL, '
                   'state TEXT NOT NULL, revision INTEGER NOT NULL, creation_key TEXT UNIQUE NOT NULL)')
        db.execute('INSERT INTO missions VALUES(?,?,?,?,?,?)', ('old', canonical(request).decode(), digest(request),
                                                                canonical(initialize(request)).decode(), 0, 'k'))
    repository = MissionRepository(path)
    assert repository.list() == [{'id': 'old', 'goal': 'Old store', 'mode': 'demo', 'status': 'ready', 'revision': 0,
                                  'round': 0, 'max_rounds': 5, 'updated_at': None}]
    fresh = repository.create(MissionRequest(goal='New row'), initialize(MissionRequest(goal='New row')), key='n')
    assert repository.list()[0]['id'] == fresh['id'] and repository.list()[0]['updated_at'] > 0


def test_a_cost_budget_is_refused_when_a_bound_seat_cannot_report_cost(tmp_path, monkeypatch):
    cli = ModelEndpoint(provider='anthropic', transport='cli', endpoint='claude', model='claude-opus-5', credential_ref='planner')
    api = ModelEndpoint(provider='openai', endpoint='https://api.openai.com/v1/responses', model='gpt-5.6', credential_ref='reviewer')
    codex = ModelEndpoint(provider='openai', transport='cli', endpoint='codex', model='gpt-5.6', credential_ref='falsifier')
    monkeypatch.setattr(service, 'live_seats_ready', lambda: (cli, api))
    monkeypatch.setattr(service, 'live_seats', lambda vision_review=False: {'planner': cli, 'reviewer': api, 'falsifier': codex})
    body = {'goal': 'Priced live', 'mode': 'live', 'allow_egress': True, 'max_cost_usd': 1}
    with TestClient(app(tmp_path)) as c:
        refused = c.post('/api/missions', headers=AUTH, json=body)
        assert refused.status_code == 409
        assert refused.json()['detail'] == {'code': 'budget.cost_unreported', 'detail': ERROR_CODES['budget.cost_unreported'],
                                            'facts': {'roles': ['reviewer', 'falsifier']}}
        assert c.get('/api/missions', headers=AUTH).json() == []
        # A token budget needs no cost, so the same seats are accepted.
        assert c.post('/api/missions', headers=AUTH, json={**body, 'max_cost_usd': None, 'max_tokens': 1000}).status_code == 201


def test_the_cost_refusal_is_repeated_against_the_route_bound_at_start(tmp_path, monkeypatch):
    cli = ModelEndpoint(provider='anthropic', transport='cli', endpoint='claude', model='claude-opus-5', credential_ref='planner')
    api = ModelEndpoint(provider='openai', endpoint='https://api.openai.com/v1/responses', model='gpt-5.6', credential_ref='reviewer')
    seats = {'planner': cli, 'reviewer': cli, 'falsifier': cli}
    monkeypatch.setattr(service, 'live_seats_ready', lambda: (cli, cli))
    monkeypatch.setattr(service, 'live_route', lambda vision_review=False: {'seats': dict(seats)})
    with TestClient(app(tmp_path)) as c:
        made = c.post('/api/missions', headers=AUTH, json={'goal': 'Seats change', 'mode': 'live', 'allow_egress': True, 'max_cost_usd': 1})
        assert made.status_code == 201, made.text
        mid = made.json()['id']
        # The operator moves the reviewer and falsifier to a metered API seat before the first start.
        seats.update(reviewer=api, falsifier=api)
        refused = c.post(f'/api/missions/{mid}/start', headers=AUTH, json={'approved_route_digest': 'a' * 64, 'grants': []})
        assert refused.status_code == 409
        assert refused.json()['detail']['code'] == 'budget.cost_unreported'
        assert refused.json()['detail']['facts'] == {'roles': ['reviewer', 'falsifier']}
        # Nothing was bound or scheduled.
        row = c.get(f'/api/missions/{mid}', headers=AUTH).json()
        assert row['state']['status'] == 'ready' and not [e for e in row['state']['events'] if e['kind'] == 'seats_bound']


def test_a_cost_budget_with_vision_review_names_the_vision_seat(tmp_path, monkeypatch):
    cli = ModelEndpoint(provider='anthropic', transport='cli', endpoint='claude', model='claude-opus-5', credential_ref='planner')
    vision = ModelEndpoint(provider='anthropic', endpoint='https://api.anthropic.com/v1/messages', model='claude-opus-5', credential_ref='vision')
    monkeypatch.setattr(service, 'live_seats_ready', lambda: (cli, cli))
    monkeypatch.setattr(service, 'configured_vision_endpoint', lambda settings=None: vision)
    monkeypatch.setattr(service, '_secret', lambda ref: 'secret')
    monkeypatch.setattr(service, 'live_route', lambda vision_review=False: {
        'seats': {'planner': cli, 'reviewer': cli, 'falsifier': cli, **({'vision': vision} if vision_review else {})}})
    body = {'goal': 'Priced vision', 'mode': 'live', 'allow_egress': True, 'max_cost_usd': 1}
    with TestClient(app(tmp_path)) as c:
        refused = c.post('/api/missions', headers=AUTH, json={**body, 'vision_review': True})
        assert refused.status_code == 409 and refused.json()['detail']['facts'] == {'roles': ['vision']}
        assert c.post('/api/missions', headers=AUTH, json=body).status_code == 201


def test_a_live_claude_code_mission_measures_its_cost_against_the_budget(configured, tmp_path):
    with TestClient(app(tmp_path)) as c:
        mid = c.post('/api/missions', headers=AUTH, json={'goal': 'Priced CLI run', 'mode': 'live', 'allow_egress': True,
                                                          'max_rounds': 1, 'max_cost_usd': 0.01}).json()['id']
        preview = c.get('/api/missions/preview', headers=AUTH).json()
        started = c.post(f'/api/missions/{mid}/start', headers=AUTH,
                         json={'approved_route_digest': preview['route_digest'], 'grants': preview['required_grants']})
        assert started.status_code == 202, started.text
        row = finished(c, mid)
        state = row['state']
        assert state['stop_code'] == 'round_limit', state['stop_reason']
        # The fake Claude Code envelope reports total_cost_usd 0.001 per call.
        assert [r['transport']['cost_usd'] for r in state['model_records']] == [0.001, 0.001, 0.001]
        assert row['spent']['cost_usd'] == pytest.approx(0.003) and row['spent']['measured'] is True
        assert row['spent']['calls'] == 3 and row['spent']['unrecorded_calls'] == 0


def test_claude_code_seats_can_carry_a_cost_budget(configured, tmp_path):
    with TestClient(app(tmp_path)) as c:
        made = c.post('/api/missions', headers=AUTH,
                      json={'goal': 'Priced CLI', 'mode': 'live', 'allow_egress': True, 'max_cost_usd': 1})
        assert made.status_code == 201, made.text
        assert made.json()['request']['max_cost_usd'] == 1
