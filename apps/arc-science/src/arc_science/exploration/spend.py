"""What a mission spent, summed from the per-call transport records (contract C4).

Each reserved model call ends in one of three ways. It is measured when its transport record
carries usage that one of the known provider shapes reads as counts. It is unmeasured when the
provider answered but reported no usable usage: a set budget cannot be honoured then. It is
unrecorded when no answer came back (the provider failed, or a pause, restart or timeout cut
the call off): its usage is unknown, and the spend says how many such calls there are."""
from __future__ import annotations
import math
import time

# Input and output token keys of each provider's usage shape: Anthropic Messages and
# Claude Code (with cache reads and writes), OpenAI Responses and Codex turn.completed,
# Gemini generateContent (thinking is billed as output) and the Gemini CLI stats.
INPUT_KEYS = ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'promptTokenCount', 'prompt')
OUTPUT_KEYS = ('output_tokens', 'candidatesTokenCount', 'thoughtsTokenCount', 'candidates', 'thoughts')
# Timeline operations that open and close an interval in which the mission ran.
OPENS = ('start', 'resume')
CLOSES = ('stop', 'pause', 'cancel', 'interrupt')


def count(value):
    """A finite, non-negative number of tokens or dollars."""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def _tokens(usage, keys):
    return sum(int(usage[key]) for key in keys if key in usage)


def reports_usage(usage):
    """Usage with an input count, in which every known key holds a count."""
    return (isinstance(usage, dict) and any(key in usage for key in ('input_tokens', 'promptTokenCount', 'prompt'))
            and all(count(usage[key]) for key in INPUT_KEYS + OUTPUT_KEYS if key in usage))


def tally(state):
    """The measured transports and the number of unmeasured calls. An accepted record always
    answered; a rejected call answered unless it has no transport or the transport failed.
    Every other reserved call is unrecorded."""
    answered = [r.transport for r in state.model_records] + [r.transport for r in state.vision_records if r.status == 'accepted']
    rejected = [r.transport for r in state.vision_records if r.status == 'rejected'] + [c.transport for c in state.unbound_calls]
    measured = [t for t in answered + rejected if t and reports_usage(t.get('usage'))]
    unmeasured = sum(1 for t in answered if not (t and reports_usage(t.get('usage'))))
    unmeasured += sum(1 for t in rejected if t and t.get('outcome', 'ok') != 'failed' and not reports_usage(t.get('usage')))
    return measured, unmeasured


def spent(state, *, minutes: float = 0) -> dict:
    """Tokens, cost and calls of a mission; minutes come from the timeline, which the
    state does not hold. cost_usd is None unless every measured call reported a cost. With
    unrecorded calls, tokens and cost are what is known: a lower bound."""
    measured, unmeasured = tally(state)
    costs = [t.get('cost_usd', t.get('total_cost_usd')) for t in measured]
    transports = [r.transport for r in state.model_records + state.vision_records + state.unbound_calls]
    return {'input_tokens': sum(_tokens(t['usage'], INPUT_KEYS) for t in measured),
            'output_tokens': sum(_tokens(t['usage'], OUTPUT_KEYS) for t in measured),
            'cost_usd': float(round(sum(costs), 6)) if not unmeasured and all(count(c) for c in costs) else None,
            'calls': state.model_calls_used, 'minutes': minutes, 'measured': not unmeasured,
            'unrecorded_calls': max(0, state.model_calls_used - len(measured) - unmeasured),
            'estimated': any(t and t.get('estimated') for t in transports)}


def running_minutes(rows, now_ms: int | None = None) -> float:
    """Minutes between each start or resume and the stop, pause or cancellation that ended
    it, from merged timeline rows; an open interval runs until now. The service writes a
    crash's interrupt row only when it starts again, so an interval ended by an interrupt
    closes at the last moment a row inside it recorded, never at the restart."""
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    total, opened, last = 0, None, None
    for row in rows:
        if row['operation'] in OPENS and opened is None:
            opened = last = row['started_at']
        elif row['operation'] in CLOSES and opened is not None:
            total += (last if row['operation'] == 'interrupt' else row['started_at']) - opened
            opened = None
        elif opened is not None:
            last = max(last, row['started_at'], row.get('finished_at') or 0)
    if opened is not None:
        total += max(0, now_ms - opened)
    return total / 60000
