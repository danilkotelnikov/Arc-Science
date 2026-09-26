"""What a mission spent, summed from the per-call transport records (contract C4).

Every reserved model call must hand over a record whose usage one of the known provider
shapes can read; otherwise the spend is not measured and a budget cannot be honoured."""
from __future__ import annotations
import time

# Input and output token keys of each provider's usage shape: Anthropic Messages and
# Claude Code (with cache reads and writes), OpenAI Responses and Codex turn.completed,
# Gemini generateContent (thinking is billed as output) and the Gemini CLI stats.
INPUT_KEYS = ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'promptTokenCount', 'prompt')
OUTPUT_KEYS = ('output_tokens', 'candidatesTokenCount', 'thoughtsTokenCount', 'candidates', 'thoughts')
# Timeline operations that open and close an interval in which the mission ran.
OPENS = ('start', 'resume')
CLOSES = ('stop', 'pause', 'cancel', 'interrupt')


def _tokens(usage, keys):
    return sum(int(usage[key]) for key in keys if isinstance(usage.get(key), (int, float)) and not isinstance(usage.get(key), bool))


def reports_usage(usage):
    return isinstance(usage, dict) and any(key in usage for key in ('input_tokens', 'promptTokenCount', 'prompt'))


def spent(state, *, minutes: float = 0) -> dict:
    """Tokens, cost and calls of a mission; minutes come from the timeline, which the
    state does not hold. cost_usd is None unless every call reported a cost."""
    transports = [r.transport for r in state.model_records] + [r.transport for r in state.vision_records]
    usages = [t['usage'] for t in transports if t and reports_usage(t.get('usage'))]
    costs = [t.get('cost_usd', t.get('total_cost_usd')) for t in transports if t and reports_usage(t.get('usage'))]
    costs = [c for c in costs if isinstance(c, (int, float)) and not isinstance(c, bool)]
    measured = len(usages) >= state.model_calls_used
    return {'input_tokens': sum(_tokens(u, INPUT_KEYS) for u in usages),
            'output_tokens': sum(_tokens(u, OUTPUT_KEYS) for u in usages),
            'cost_usd': float(round(sum(costs), 6)) if measured and len(costs) >= state.model_calls_used else None,
            'calls': state.model_calls_used, 'minutes': minutes, 'measured': measured,
            'estimated': any(t and t.get('estimated') for t in transports)}


def running_minutes(rows, now_ms: int | None = None) -> float:
    """Minutes between each start or resume and the stop, pause, cancellation or restart
    that ended it, from merged timeline rows; an open interval runs until now. A restart
    after a crash closes the interval late, so the time is over-counted, never under."""
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    total, opened = 0, None
    for row in rows:
        if row['operation'] in OPENS and opened is None:
            opened = row['started_at']
        elif row['operation'] in CLOSES and opened is not None:
            total += row['started_at'] - opened
            opened = None
    if opened is not None:
        total += max(0, now_ms - opened)
    return total / 60000
