"""Reasoning effort per seat: one operator vocabulary, mapped per provider and transport.

A level the transport cannot express is refused when the seat is built, never
coerced to a neighbour; a transport with no control accepts only the default and
records that the provider's own default applied. The OpenAI levels are passed through
because they vary per model (the CLI's model catalogue on this machine lists low..max
for the 5.6 family and low..xhigh for 5.5): the provider's refusal is surfaced as is.
"""
from __future__ import annotations

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
