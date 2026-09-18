"""Capture the exploration decision-tree and HoH reconciliation into memory.

The exploration engine already surfaces its whole trajectory through `emit(state)`:
`state.events` records the control flow (plan committed, observations, artifacts,
visual review, reconciliation, focus changes, stop) and `state.model_records` holds
each planner / analyst / falsifier / vision call with its payload. This observer reads
that emitted state and appends the *new* events and model records to memory. It never
changes mission state, tools, permissions or acceptance — captured content is data.

Each mission is one memory *session*; the mission round is carried as the record's
compaction epoch so the UI can navigate any round of any past mission. Appends are
idempotent by `(session, kind, index)`, so resume/replay re-emits never duplicate.
"""
from __future__ import annotations

import json
import hashlib
import time
from typing import Any

# One stable app-level project groups every mission-session in a single-lab deployment.
PROJECT = "arc-science"

# Roles the native store understands; anything else is recorded as a system note.
_ALLOWED_ROLES = {
    "user",
    "assistant",
    "planner",
    "analyst",
    "falsifier",
    "reconciliation",
    "vision",
    "tool",
    "system",
}


def _map_role(role: str) -> str:
    return role if role in _ALLOWED_ROLES else "system"


def _payload_text(payload: Any) -> str:
    if isinstance(payload, str):
        return payload
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


class SessionCapture:
    """Appends the new tail of an emitted mission state to one memory session."""

    def __init__(self, client: Any, session: str, project: str = PROJECT) -> None:
        self._client = client
        self._session = session
        self._project = project

    def observe(self, state: Any, from_event: int = 0, from_model: int = 0) -> tuple[int, int]:
        events = list(getattr(state, "events", ()) or ())
        models = list(getattr(state, "model_records", ()) or ())
        now = int(time.time() * 1000)

        for index in range(from_event, len(events)):
            event = events[index]
            self._client.append(
                {
                    "project_id": self._project,
                    "session_id": self._session,
                    "agent_id": "engine",
                    "role": "system",
                    "text": f"[{event.kind}] {event.detail}",
                    "source_uri": f"mission://{self._session}/round/{event.round}/event/{index}",
                    "trust": "operator",
                    "compaction_epoch": event.round,
                    "wall_time_ms": now,
                    "idempotency_key": f"{self._session}:event:{index}",
                }
            )

        for index in range(from_model, len(models)):
            record = models[index]
            self._client.append(
                {
                    "project_id": self._project,
                    "session_id": self._session,
                    "agent_id": record.role,
                    "role": _map_role(record.role),
                    "text": _payload_text(record.payload),
                    "source_uri": f"mission://{self._session}/round/{record.round}/{record.role}/{index}",
                    "trust": "model_output",
                    "compaction_epoch": record.round,
                    "wall_time_ms": now,
                    "idempotency_key": f"{self._session}:model:{index}",
                }
            )

        # Service cancellation, failures and restart pauses need not emit an engine
        # event. Retain their authoritative status as an explicitly typed snapshot.
        if hasattr(state, "status"):
            text = _payload_text({
                "kind": "mission_snapshot", "status": state.status,
                "round": state.round, "stop_reason": state.stop_reason,
                "events": len(events), "model_records": len(models),
            })
            fingerprint = hashlib.sha256(text.encode("utf-8")).hexdigest()
            self._client.append({
                "project_id": self._project, "session_id": self._session,
                "agent_id": "service", "role": "system", "text": text,
                "source_uri": f"mission://{self._session}/snapshot", "trust": "operator",
                "compaction_epoch": state.round, "wall_time_ms": now,
                "idempotency_key": f"{self._session}:snapshot:{fingerprint}",
            })

        return (len(events), len(models))
