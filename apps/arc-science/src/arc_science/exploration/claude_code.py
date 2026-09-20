"""The Claude Code seat: the Anthropic flavour of the CLI transport in `cli_seats`,
kept under its historical name for the environment-configured route and the tests."""
from __future__ import annotations

from .cli_seats import (  # noqa: F401 — re-exported contract helpers
    CALL_TIMEOUT, ENV_ALLOWLIST, FAILURE_CATEGORIES, MAX_PROMPT, MAX_STDERR, MAX_STDOUT, STDERR_TAIL,
    Claude, CliAgent, auth_status, executable_digest, failure_category, identity_matches, run_process,
    scrubbed_environment, version,
)

TRANSPORT = Claude.transport
CONTRACT_VERSION = Claude.contract


class ClaudeCodeAgent(CliAgent):
    """Planner and reconciliation seats over `claude -p`."""

    def __init__(self, command, planner_model, reviewer_model=None, *, timeout=CALL_TIMEOUT, environment=None,
                 vision=None, falsifier_model=None, efforts=None):
        super().__init__(command, planner_model, reviewer_model, provider='anthropic', timeout=timeout,
                         environment=environment, vision=vision, falsifier_model=falsifier_model, efforts=efforts)
