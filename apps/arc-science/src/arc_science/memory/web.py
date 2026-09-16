"""Token-gated /api/memory/* routes.

The routes expose read, search, session navigation and retention over the native
memory worker. `append` is deliberately not a route: records are captured internally
by the exploration engine, not written by external callers. Handlers are synchronous
so FastAPI runs them in its threadpool rather than blocking the event loop on the
worker's stdio.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .capture import SessionCapture
from .client import MemoryClient, MemoryError


class SearchRequest(BaseModel):
    project: str
    query: str
    limit: int = 10
    mode: str = "lexical"  # lexical | semantic | hybrid
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
        self._captured: dict[str, tuple[int, int]] = {}
        self.router = APIRouter(prefix="/api/memory", dependencies=[Depends(authorized)])
        self._wire()

    def capture(self, session: str, state: Any) -> None:
        """Best-effort capture of an emitted mission state into memory.

        Auxiliary to the mission: a capture failure is swallowed so it can never fail
        the run. Idempotent appends plus a per-session high-water mark keep this cheap.
        """
        if self._worker_path is None or not self._worker_path.exists():
            return
        try:
            client = self._client_or_503()
            seen_events, seen_models = self._captured.get(session, (0, 0))
            self._captured[session] = SessionCapture(client, session).observe(
                state, seen_events, seen_models
            )
        except Exception:
            pass

    def _client_or_503(self) -> MemoryClient:
        if self._worker_path is None or not self._worker_path.exists():
            raise HTTPException(503, "Native memory worker is not configured")
        if self._client is None:
            self._client = MemoryClient(self._worker_path, self._data_dir / "memory.db")
        return self._client

    def _wire(self) -> None:
        router = self.router

        @router.get("/health")
        def health() -> Any:
            return self._client_or_503().health()

        @router.post("/search")
        def search(request: SearchRequest) -> Any:
            scope = {
                "project": request.project,
                "session": request.session,
                "agent": request.agent,
            }
            client = self._client_or_503()
            try:
                if request.mode == "semantic":
                    return client.semantic(scope, request.query, request.limit)
                if request.mode == "hybrid":
                    return client.hybrid(scope, request.query, request.limit)
                if request.mode == "lexical":
                    return client.search(scope, request.query, request.limit)
                raise HTTPException(422, "mode must be lexical, semantic or hybrid")
            except MemoryError as exc:
                raise HTTPException(409, str(exc)) from None

        @router.get("/records/{record_id}")
        def record(record_id: str) -> Any:
            try:
                return self._client_or_503().inspect(record_id)
            except MemoryError:
                raise HTTPException(404, "Unknown memory record") from None

        @router.post("/records/{record_id}/disable")
        def disable(record_id: str) -> Any:
            try:
                self._client_or_503().disable(record_id)
                return {"disabled": True}
            except MemoryError:
                raise HTTPException(404, "Unknown memory record") from None

        @router.get("/sessions")
        def sessions(project: str) -> Any:
            return self._client_or_503().session_list(project)

        @router.get("/sessions/{session}")
        def session(
            session: str,
            project: str,
            from_seq: Optional[int] = None,
            to_seq: Optional[int] = None,
        ) -> Any:
            return self._client_or_503().session_fetch(project, session, from_seq, to_seq)

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None
