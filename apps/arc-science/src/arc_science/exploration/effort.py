"""Reasoning effort per seat: one operator vocabulary, mapped per provider and transport.

A level the transport cannot express is refused when the seat is built, never
coerced to a neighbour; a transport with no control accepts only the default and
records that the provider's own default applied. The OpenAI levels are passed through
because they vary per model (the CLI's model catalogue on this machine lists low..max
for the 5.6 family and low..xhigh for 5.5): the provider's refusal is surfaced as is.
"""
from __future__ import annotations
from functools import lru_cache
import json
from pathlib import Path

EFFORTS = ('minimal', 'low', 'medium', 'high', 'xhigh', 'max')
DEFAULT = 'medium'

# (provider, transport) -> the levels that transport can express.
SUPPORTED = {
    ('anthropic', 'api'): ('low', 'medium', 'high', 'xhigh', 'max'),     # output_config.effort
    ('anthropic', 'cli'): ('low', 'medium', 'high', 'xhigh', 'max'),     # claude --effort
    ('openai', 'api'): EFFORTS,                                          # reasoning.effort, per model
    ('openai', 'cli'): EFFORTS,                                          # codex -c model_reasoning_effort
    ('gemini', 'api'): ('minimal', 'low', 'medium', 'high'),             # thinkingConfig.thinkingLevel
    ('gemini', 'cli'): (),                                               # no per-call control
    ('openclaw', 'api'): (),                                             # the agent's own configuration
}


def applied_effort(provider: str, transport: str, effort: str) -> tuple[str | None, str]:
    """(value the transport sends, source): ('high', 'seat') when the level is expressed,
    (None, 'provider_default') when the transport has no control and the seat keeps the
    default. Anything else is refused with the levels the seat may use."""
    if effort not in EFFORTS:
        raise ValueError(f'effort must be one of {", ".join(EFFORTS)}')
    supported = SUPPORTED.get((provider, transport))
    if supported is None:
        raise ValueError(f'No {transport} transport for provider {provider}')
    if not supported:
        if effort != DEFAULT:
            raise ValueError(f'The {provider} {transport} seat has no effort control; leave it at {DEFAULT} '
                             + '(the provider default applies)')
        return None, 'provider_default'
    if effort not in supported:
        raise ValueError(f'The {provider} {transport} seat does not express effort {effort}; use one of '
                         + ', '.join(supported))
    return effort, 'seat'


@lru_cache(maxsize=1)
def load_catalog():
    """The published model catalogue shipped with the package (ids, efforts per model,
    efforts per transport); a listing means the provider published the id, not that
    this machine can reach it."""
    return json.loads((Path(__file__).with_name('model_catalog.json')).read_text(encoding='utf-8'))


def model_entry(provider: str, model: str):
    """The catalogue entry for a model under a provider, or None (a custom model)."""
    models=(load_catalog()['providers'].get(provider) or {}).get('models') or []
    return next((entry for entry in models if entry['id']==model),None)


def accepted_efforts(provider: str, transport: str, model: str) -> tuple:
    """The levels a seat on this model may name: the transport's levels, narrowed by the
    catalogue entry when the model has one. Empty means no control: only DEFAULT is
    accepted and the provider's own default applies."""
    supported=SUPPORTED.get((provider,transport)) or ()
    entry=model_entry(provider,model)
    if entry is None:return tuple(supported)
    return tuple(level for level in supported if level in entry.get('efforts',()))
