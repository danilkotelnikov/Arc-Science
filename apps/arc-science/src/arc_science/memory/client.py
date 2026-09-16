"""Client for the native arc-memory worker.

Spawns the `arc-memory-worker` binary and speaks the `arc-memory/1` protocol
(4-byte little-endian length prefix + JSON body) over its stdio. One client owns
one long-lived worker process bound to one memory database. Calls are serialized
with a lock so a single worker can serve the application's agents.
"""
from __future__ import annotations

import json
import os
import struct
import subprocess
import threading
from pathlib import Path
from typing import Any, Optional


class MemoryError(RuntimeError):
    """Raised when the worker reports an error or the connection is lost."""


class MemoryClient:
    def __init__(self, worker_path: os.PathLike[str] | str, data_path: os.PathLike[str] | str):
        self._data_path = Path(data_path)
        self._data_path.parent.mkdir(parents=True, exist_ok=True)
        self._proc = subprocess.Popen(
            [str(worker_path), "--data", str(self._data_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        self._lock = threading.Lock()

    def _read_exact(self, count: int) -> bytes:
        assert self._proc.stdout is not None
        chunks: list[bytes] = []
        remaining = count
        while remaining > 0:
            chunk = self._proc.stdout.read(remaining)
            if not chunk:
                raise MemoryError("memory worker closed the connection")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _call(self, request: dict[str, Any]) -> Any:
        body = json.dumps(request).encode("utf-8")
        with self._lock:
            if self._proc.poll() is not None:
                raise MemoryError("memory worker is not running")
            assert self._proc.stdin is not None
            self._proc.stdin.write(struct.pack("<I", len(body)))
            self._proc.stdin.write(body)
            self._proc.stdin.flush()
            (length,) = struct.unpack("<I", self._read_exact(4))
            payload = self._read_exact(length)
        response = json.loads(payload)
        if response.get("status") != "ok":
            raise MemoryError(response.get("error", "unknown memory error"))
        return response["data"]

    # --- operations -------------------------------------------------------
    def health(self) -> dict[str, Any]:
        return self._call({"op": "health"})

    def append(self, record: dict[str, Any]) -> str:
        return self._call({"op": "append", "record": record})["record_id"]

    def inspect(self, record_id: str) -> dict[str, Any]:
        return self._call({"op": "inspect", "record_id": record_id})

    def search(self, scope: dict[str, Any], query: str, limit: int = 10) -> list[dict[str, Any]]:
        return self._call({"op": "search", "scope": scope, "query": query, "limit": limit})

    def semantic(self, scope: dict[str, Any], query: str, limit: int = 10) -> list[dict[str, Any]]:
        return self._call({"op": "semantic", "scope": scope, "query": query, "limit": limit})

    def hybrid(self, scope: dict[str, Any], query: str, limit: int = 10) -> list[dict[str, Any]]:
        return self._call({"op": "hybrid", "scope": scope, "query": query, "limit": limit})

    def session_list(self, project: str) -> list[dict[str, Any]]:
        return self._call({"op": "session_list", "project": project})

    def session_fetch(
        self,
        project: str,
        session: str,
        from_seq: Optional[int] = None,
        to_seq: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        return self._call(
            {
                "op": "session_fetch",
                "project": project,
                "session": session,
                "from_seq": from_seq,
                "to_seq": to_seq,
            }
        )

    def disable(self, record_id: str) -> None:
        self._call({"op": "disable", "record_id": record_id})

    def embed(self) -> int:
        return self._call({"op": "embed"})["embedded"]

    # --- lifecycle --------------------------------------------------------
    def close(self) -> None:
        if self._proc.poll() is not None:
            return
        try:
            if self._proc.stdin is not None:
                self._proc.stdin.close()
            self._proc.wait(timeout=5)
        except Exception:
            self._proc.kill()
            self._proc.wait()

    def __enter__(self) -> "MemoryClient":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()
