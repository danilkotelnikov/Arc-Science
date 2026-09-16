"""The app mounts /api/memory and degrades gracefully when no worker is configured."""
from __future__ import annotations

from fastapi.testclient import TestClient

from arc_science.service import create_app


def test_app_mounts_memory_routes(tmp_path, monkeypatch):
    monkeypatch.delenv("ARC_MEMORY_WORKER", raising=False)
    token = "x" * 40
    app = create_app(data_dir=tmp_path, token=token)
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        # mounted + auth enforced
        assert client.get("/api/memory/sessions", params={"project": "p"}).status_code == 401
        # configured-but-no-worker -> graceful 503, not a crash
        gated = client.get(
            "/api/memory/health", headers={"Authorization": "Bearer " + token}
        )
        assert gated.status_code == 503
