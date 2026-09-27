"""Stable codes beside the service's English (contract C1).

An HTTP refusal is {code, detail, facts}: `code` is '<area>.<reason>' from ERROR_CODES,
`detail` the English sentence (the registry's, or a more specific one from the route) and
`facts` the variable parts a page needs to say it in another language. STOP_CODES names
why a mission stopped; the engine, the repository and the service worker record one in state.stop_code with
its facts beside the English stop_reason."""
from __future__ import annotations

from fastapi import HTTPException

ERROR_CODES = {
    'auth.required': 'Authentication required',
    'request.invalid': 'The request does not match the expected fields',
    'request.too_large': 'The request body is larger than 1 MiB',
    # Prose control: one code per ProseRefused reason, plus the seat prerequisites.
    'prose.audit_key': 'The prose audit key is not available',
    'prose.bounds': 'The text is outside the accepted bounds',
    'prose.busy': 'A seat rewrite is already in flight',
    'prose.consent_required': 'The text would leave this machine; consent to this one request',
    'prose.disabled': 'Detection is switched off in the settings',
    'prose.empty': 'The text is empty',
    'prose.network': 'The detector could not be reached',
    'prose.preservation_failed': 'A protected span did not survive the edit',
    'prose.provenance_missing': 'The detector answer lacks provenance',
    'prose.provider_rejected': 'The prose seat did not return a usable edit',
    'prose.provider_failed': 'The prose provider answered with an error',
    'prose.refused_instruction': 'The instruction asks for detector evasion or impersonation',
    'prose.seat_unavailable': 'The prose seat has no stored credential',
    'prose.seat_unusable': 'The prose seat is not usable',
    'prose.seat_unconfigured': 'Configure the prose seat in the settings before a seat rewrite',
    'prose.timeout': 'The detector did not answer in time',
    'prose.too_long': 'The text is too long',
    'settings.unavailable': 'Settings are not available to this service',
    'settings.read_failed': 'Settings could not be read',
    'settings.revision_conflict': 'Settings changed since they were read; reload and try again',
    'settings.rejected': 'The settings owner rejected the document',
    'settings.write_failed': 'Settings could not be written',
    'mcp.unavailable': 'The MCP client is not available',
    'mission.not_found': 'Unknown mission',
    'mission.seats_unconfigured': 'Configure the model seats before starting',
    'mission.live_unconfigured': 'Configure model endpoints and server-side credential files before live use',
    'mission.vision_unconfigured': 'Configure a separate vision model endpoint and server-side credential file before required vision review',
    'mission.biorender_unconfigured': 'Configure the separate BioRender credential, protocol and schema pin before enabling reads',
    'mission.idempotency_conflict': 'Idempotency key conflicts with an earlier request',
    'mission.invalid': 'Invalid creation key or mission state',
    'mission.revision_conflict': 'Mission changed; retry',
    'mission.seats_changed': 'The model seats or connectors changed since this mission was first started',
    'mission.approval_required': 'Review the route and approve its grants before the first start',
    'mission.grants_unrecorded': 'This mission was bound before its grants were recorded; review the route and approve its grants to start it',
    'mission.route_changed': 'The route changed since it was previewed; review it again',
    'mission.grant_missing': 'No grant approved for a destination of the route',
    'mission.not_startable': 'Only ready or interrupted missions can start or resume',
    'mission.change_refused': 'The declared change was refused',
    'mission.not_resumable': 'Only an interrupted or errored mission can be resumed',
    'mission.retry_note_required': 'A retry from an error states its reason in the note',
    'mission.not_pausable': 'Only a running mission can be paused',
    'mission.finished': 'Mission already finished; its outcome is retained',
    'mission.artifact_not_found': 'Unknown mission artifact',
    'mission.integrity_failed': 'Mission integrity check failed',
    'mission.evidence_invalid': 'Evidence graph is invalid; verify the mission',
    'mission.running': 'Mission is still running; verify after it finishes',
    'crew.unknown_role': 'The crew names a role that is not planner, reviewer, falsifier or vision',
    'crew.no_seat': 'The crew names a role that has no configured seat for this mission',
    'crew.effort_not_supported': 'The seat cannot express this effort on this model',
    'context.unknown_record': 'An attached memory record or mission does not exist or is not visible',
    'context.too_large': 'The attached context is longer than the mission context limit',
    'memory.unavailable': 'The memory store is not available; try again or attach no memory records',
    'budget.cost_unreported': 'A cost budget needs every bound seat to report its cost; only Claude Code CLI seats do',
    'release.blocked': 'Release blocked; verify the mission and resolve its checks',
    'grant.not_found': 'Unknown grant',
    'consent.remember_needs_consent': 'Send remember_days only together with the consent flag of the same request',
    'provider.unknown': 'Unknown provider',
    'probe.consent_required': 'Confirm spend_tokens=true; a probe makes a real model call per configured model',
    'probe.seat_invalid': 'A seat on this provider cannot be built',
    'probe.no_seat': 'No seat uses this provider',
    'probe.busy': 'A probe is already running',
    'probe.cooldown': 'Probe cooldown: wait before spending again',
}

STOP_CODES = {
    'plan_stop': 'The planner stopped the exploration',
    'no_observations': 'The planner stopped before any observation',
    'vision_required': 'Required visual review is missing, failed, not possible or found problems',
    'no_actions': 'The planner proposed no executable action',
    'action_reused': 'An action ID was reused with different inputs',
    'planning_failed': 'Planning failed validation or provider execution',
    'render_failed': 'Trusted plot rendering failed validation',
    'call_limit': 'Model-call limit reached',
    'action_limit': 'Action limit reached',
    'round_limit': 'Round limit reached',
    'token_limit': 'Token budget reached',
    'cost_limit': 'Cost budget reached',
    'time_limit': 'Time budget reached',
    'budget_unmeasurable': 'A model call answered without reporting usable usage or cost, so the budget cannot be enforced',
    'paused_by_operator': 'Paused by the operator',
    'cancelled': 'Cancelled by the operator',
    'interrupted': 'The service restarted while the mission ran',
    'service_failed': 'Service execution failed outside the engine; no success is inferred',
}


def api_error(status: int, code: str, detail: str | None = None, *, facts: dict | None = None,
              headers: dict | None = None, **extra) -> HTTPException:
    """The HTTPException for one refusal; the caller raises it. An unregistered code is a
    programming error and raises KeyError before any response is built."""
    english = ERROR_CODES[code]
    return HTTPException(status, {'code': code, 'detail': detail or english, 'facts': facts or {}, **extra}, headers=headers)


def prose_code(reason: str) -> str:
    """The registered code of a ProseRefused reason; a provider status (http_503) and any
    other unregistered reason are prose.provider_failed, with the reason in the facts."""
    code = 'prose.' + reason
    return code if code in ERROR_CODES else 'prose.provider_failed'
