"""Memory error codes (contract C1): every /api/memory error detail is
`{code, detail, facts}`, where `detail` is the English fallback and `facts` holds the
variable parts a translation needs. Codes follow `<area>.<reason>`."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException

MEMORY_ERROR_CODES = {
    "memory.worker_unconfigured": "Native memory worker is not configured",
    "memory.worker_unavailable": "Native memory worker is unavailable; check its installation",
    "memory.worker_disconnected": "Native memory worker disconnected; retry to recover",
    "memory.record_not_found": "Unknown memory record",
    "memory.read_budget": "Memory result exceeds the read budget; narrow the scope or reduce the result limit",
    "memory.record_corrupt": "A stored memory record is damaged and cannot be read",
    "memory.operation_failed": "Memory operation failed; check the query, record or requested range",
    "memory.invalid_range": "The sequence range is reversed; from_seq must not exceed to_seq",
    "memory.declaration_refused": "The declared effects do not cover this change",
    "memory.capture_incomplete": "Memory capture is incomplete; retained mission snapshots will be retried.",
}


def memory_error(status: int, code: str, detail: Optional[str] = None, **facts: Any) -> HTTPException:
    return HTTPException(status, {"code": code, "detail": detail or MEMORY_ERROR_CODES[code], "facts": facts})
