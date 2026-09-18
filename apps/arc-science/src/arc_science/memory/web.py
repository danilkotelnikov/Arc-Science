"""Token-gated /api/memory/* routes.

The routes expose read, search, session navigation and retention over the native
memory worker. `append` is deliberately not a route: records are captured internally
by the exploration engine, not written by external callers. Handlers are synchronous
so FastAPI runs them in its threadpool rather than blocking the event loop on the
worker's stdio.
"""
from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .capture import SessionCapture
from .client import MemoryClient, MemoryError, MemoryUnavailable


class SearchRequest(BaseModel):
    project: str
    query: str
    limit: int = Field(default=10, ge=1, le=100)
    mode: Literal["lexical", "semantic", "hybrid"] = "lexical"
    session: Optional[str] = None
    agent: Optional[str] = None


class MemoryRoutes:
    """Owns the single memory worker client and the /api/memory router."""

    def __init__(
        self,
        data_dir: Path,
        worker_path: Optional[Path],
        authorized: Callable[..., Any],
    ) -> None:
        self._data_dir = Path(data_dir)
        self._worker_path = Path(worker_path) if worker_path is not None else None
        self._client: Optional[MemoryClient] = None
        self._client_lock = threading.Lock()
        self._capture_lock = threading.Lock()
        self._captured: dict[str, tuple[int, int]] = {}
        self._state_lock = threading.Lock()
        self._pending: OrderedDict[str, Any] = OrderedDict()
        self._inflight: Optional[str] = None
        self._failed: set[str] = set()
        self._snapshot_source: Optional[Callable] = None
        self._reconcile_requested = False
        self._reconciling = False
        self._reconcile_error = False
        self._overflow = False
        self._draining = False
        self._closing = False
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="arc-memory-capture")
        self.router = APIRouter(prefix="/api/memory", dependencies=[Depends(authorized)])
        self._wire()

    def capture(self, session: str, state: Any) -> bool:
        """Best-effort capture of an emitted mission state into memory.

        Auxiliary to the mission: a capture failure is swallowed so it can never fail
        the run. Idempotent appends plus a per-session high-water mark keep this cheap.
        """
        if self._worker_path is None or not self._worker_path.exists():
            return False
        try:
            with self._capture_lock:  # atomic high-water advance for a session
                client = self._client_or_503()
                seen_events, seen_models = self._captured.get(session, (0, 0))
                self._captured[session] = SessionCapture(client, session).observe(
                    state, seen_events, seen_models
                )
            with self._state_lock:
                self._failed.discard(session)
            return True
        except Exception:
            with self._state_lock:
                self._failed.add(session)
            return False

    def capture_status(self) -> dict[str, Any]:
        configured = self._worker_path is not None and self._worker_path.is_file()
        with self._state_lock:
            degraded = bool(self._failed or self._reconcile_error or self._overflow
                            or self._reconciling or self._reconcile_requested)
            return {
                "status": "unconfigured" if not configured else ("degraded" if degraded else "ready"),
                "pending": len(self._pending) + int(self._inflight is not None)
                           + int(self._reconciling or self._reconcile_requested),
                "last_error": ("Native memory worker is not configured" if not configured else
                               "Memory capture is incomplete; retained mission snapshots will be retried."
                               if self._failed or self._reconcile_error or self._overflow else None),
            }

    def set_snapshot_source(self, source: Callable) -> None:
        """Supply a bounded iterator of retained (session, immutable state) pairs."""
        self._snapshot_source = source

    def _start_drain_locked(self) -> None:
        if not self._draining:
            self._draining = True
            self._executor.submit(self._drain)

    def schedule_capture(self, session: str, state: Any) -> None:
        """Coalesce snapshots; one bounded capture thread never blocks a mission."""
        if self._worker_path is None:
            return
        with self._state_lock:
            if self._closing:
                return
            if session not in self._pending and len(self._pending) >= 100:
                self._overflow = True
                return  # the authoritative repository retains this snapshot
            self._pending[session] = state
            self._start_drain_locked()

    def schedule_reconcile(self) -> None:
        if self._worker_path is None or self._snapshot_source is None:
            return
        with self._state_lock:
            if self._closing or self._reconcile_requested:
                return
            # A shutdown pause can occur after the active replay read this mission.
            # Keep one follow-up pass, even when a repair is already in progress.
            self._reconcile_requested = True
            self._start_drain_locked()

    def _drain(self) -> None:
        while True:
            with self._state_lock:
                if self._pending:
                    session, state = self._pending.popitem(last=False)
                    self._inflight = session
                    replay = False
                elif self._reconcile_requested:
                    self._reconcile_requested = False
                    self._reconciling = True
                    replay = True
                else:
                    self._draining = False
                    return
            if replay:
                complete = False
                try:
                    complete = True
                    for session, state in self._snapshot_source():
                        if not self.capture(session, state):
                            complete = False
                            break  # one failed worker cannot stall every retained mission
                except Exception:
                    complete = False
                with self._state_lock:
                    self._reconciling = False
                    self._reconcile_error = not complete
                    if complete:
                        self._overflow = False
            else:
                self.capture(session, state)
                with self._state_lock:
                    self._inflight = None

    def _client_or_503(self) -> MemoryClient:
        if self._worker_path is None or not self._worker_path.exists():
            raise HTTPException(503, "Native memory worker is not configured")
        with self._client_lock:  # exactly one live worker per DB, including recovery
            if self._client is None or not self._client.is_alive():
                replacing = self._client is not None
                if replacing:
                    self._client.close()
                    self._client = None
                try:
                    self._client = MemoryClient(self._worker_path, self._data_dir / "memory.db")
                except (OSError, MemoryError):
                    raise HTTPException(503, "Native memory worker is unavailable; check its installation") from None
                if replacing:
                    with self._state_lock:
                        replaying = self._reconciling
                    # A failed worker encountered by replay must not perpetually
                    # enqueue its own replacement pass. External requests retry it.
                    if not replaying:
                        self.schedule_reconcile()
        return self._client

    def _operation(self, method: str, *args: Any) -> Any:
        try:
            return getattr(self._client_or_503(), method)(*args)
        except MemoryUnavailable:
            raise HTTPException(503, "Native memory worker disconnected; retry to recover") from None
        except MemoryError as exc:
            if method in {"inspect", "disable"} and str(exc) == "record not found":
                raise HTTPException(404, "Unknown memory record") from None
            if method == "session_fetch":
                raise HTTPException(409, "Session exceeds the read budget or is unreadable; retry with a narrower sequence range") from None
            if "read budget" in str(exc) or "frame limit" in str(exc):
                raise HTTPException(409, "Memory result exceeds the read budget; narrow the scope or reduce the result limit") from None
            raise HTTPException(409, "Memory operation failed; check the query, record or requested range") from None

    def _wire(self) -> None:
        router = self.router

        @router.get("/health")
        def health() -> Any:
            try:
                data = self._operation("health")
            except HTTPException as exc:
                capture = self.capture_status()
                if capture["status"] != "unconfigured":
                    capture = {**capture, "status": "degraded", "last_error": exc.detail}
                return JSONResponse(status_code=503, content={
                    "protocol": None, "sqlite": None, "retrieval_modes": [],
                    "capture": capture, "detail": exc.detail,
                })
            with self._state_lock:
                retry = bool(self._failed or self._reconcile_error or self._overflow)
            if retry:
                self.schedule_reconcile()
            return {**data, "capture": self.capture_status()}

        @router.post("/search")
        def search(request: SearchRequest) -> Any:
            scope = {
                "project": request.project,
                "session": request.session,
                "agent": request.agent,
            }
            method = "search" if request.mode == "lexical" else request.mode
            return self._operation(method, scope, request.query, request.limit)

        @router.get("/records/{record_id}")
        def record(record_id: str) -> Any:
            return self._operation("inspect", record_id)

        @router.post("/records/{record_id}/disable")
        def disable(record_id: str) -> Any:
            self._operation("disable", record_id)
            return {"disabled": True}

        @router.get("/sessions")
        def sessions(project: str) -> Any:
            return self._operation("session_list", project)

        @router.get("/sessions/{session}")
        def session(
            session: str,
            project: str,
            from_seq: Optional[int] = Query(default=None, ge=0, le=2**63-1),
            to_seq: Optional[int] = Query(default=None, ge=0, le=2**63-1),
        ) -> Any:
            if from_seq is not None and to_seq is not None and from_seq > to_seq:
                raise HTTPException(422, "from_seq must not exceed to_seq")
            return self._operation("session_fetch", project, session, from_seq, to_seq)

    def close(self) -> None:
        with self._state_lock:
            self._closing = True
        self._executor.shutdown(wait=True)
        with self._client_lock:
            if self._client is not None:
                self._client.close()
                self._client = None
