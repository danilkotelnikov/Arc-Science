from fastapi.testclient import TestClient

from arc_science.service import create_app


TOKEN = "t" * 40
SECRET_A = "native-session-secret-A-0123456789abcdef0123456789abcdef"
SECRET_B = "native-session-secret-B-0123456789abcdef0123456789abcdef"


def bearer():
    return {"Authorization": "Bearer " + TOKEN}


def native(secret=SECRET_A):
    return {"X-Arc-Native-Session": secret}


def test_bearer_auth_still_authorizes_when_native_session_is_configured(tmp_path, monkeypatch):
    monkeypatch.setenv("ARC_NATIVE_SESSION_SECRET", SECRET_A)
    with TestClient(create_app(data_dir=tmp_path, token=TOKEN)) as client:
        response = client.get("/api/session/status", headers=bearer())

    assert response.status_code == 200
    assert response.json() == {"status": "authorized"}


def test_native_session_authorizes_low_data_probe_and_existing_routes(tmp_path, monkeypatch):
    monkeypatch.setenv("ARC_NATIVE_SESSION_SECRET", SECRET_A)
    with TestClient(create_app(data_dir=tmp_path, token=TOKEN)) as client:
        status = client.get("/api/session/status", headers=native())
        missions = client.get("/api/missions", headers=native())

    assert status.status_code == 200
    assert status.json() == {"status": "authorized"}
    assert missions.status_code == 200
    assert missions.json() == []


def test_missing_wrong_and_disabled_native_session_are_unauthorized(tmp_path, monkeypatch):
    monkeypatch.setenv("ARC_NATIVE_SESSION_SECRET", SECRET_A)
    with TestClient(create_app(data_dir=tmp_path / "enabled", token=TOKEN)) as client:
        missing = client.get("/api/session/status")
        wrong = client.get(
            "/api/session/status",
            headers=native("wrong-native-secret-0123456789abcdef0123456789abcdef"),
        )

    monkeypatch.delenv("ARC_NATIVE_SESSION_SECRET", raising=False)
    with TestClient(create_app(data_dir=tmp_path / "disabled", token=TOKEN)) as client:
        disabled = client.get("/api/session/status", headers=native())

    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert disabled.status_code == 401


def test_weak_or_malformed_native_secret_disables_native_auth(tmp_path, monkeypatch):
    malformed = (
        "short",
        SECRET_A + "\n",
        "native secret with spaces 0123456789abcdef0123456789abcdef",
    )
    for index, configured in enumerate(malformed):
        monkeypatch.setenv("ARC_NATIVE_SESSION_SECRET", configured)
        with TestClient(create_app(data_dir=tmp_path / f"case-{index}", token=TOKEN)) as client:
            assert client.get("/api/session/status", headers=native()).status_code == 401
            assert client.get("/api/session/status", headers=bearer()).status_code == 200


def test_native_session_is_bound_to_one_service_generation(tmp_path, monkeypatch):
    monkeypatch.setenv("ARC_NATIVE_SESSION_SECRET", SECRET_A)
    with TestClient(create_app(data_dir=tmp_path / "first", token=TOKEN)) as client:
        assert client.get("/api/session/status", headers=native(SECRET_A)).status_code == 200
        assert client.get("/api/session/status", headers=native(SECRET_B)).status_code == 401

    monkeypatch.setenv("ARC_NATIVE_SESSION_SECRET", SECRET_B)
    with TestClient(create_app(data_dir=tmp_path / "second", token=TOKEN)) as client:
        assert client.get("/api/session/status", headers=native(SECRET_A)).status_code == 401
        assert client.get("/api/session/status", headers=native(SECRET_B)).status_code == 200


def test_native_session_secret_is_not_disclosed_in_auth_errors(tmp_path, monkeypatch):
    monkeypatch.setenv("ARC_NATIVE_SESSION_SECRET", SECRET_A)
    with TestClient(create_app(data_dir=tmp_path, token=TOKEN)) as client:
        response = client.get("/api/session/status", headers=native(SECRET_B))

    assert response.status_code == 401
    assert SECRET_A not in response.text
    assert SECRET_B not in response.text
    assert TOKEN not in response.text
