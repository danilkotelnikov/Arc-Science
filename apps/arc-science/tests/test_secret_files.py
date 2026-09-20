"""Secret files — the access token, a stored credential, the prose audit key — are readable
by their owner alone on both platforms (mode on POSIX, one ACL entry on Windows)."""
from __future__ import annotations

from fastapi.testclient import TestClient

from arc_science import anchored, cli, prose, service


def test_token_credential_and_audit_key_are_restricted_to_the_owner(tmp_path, monkeypatch):
    monkeypatch.setenv('ARC_DATA_DIR', str(tmp_path))
    monkeypatch.delenv('ARC_TOKEN_FILE', raising=False)
    monkeypatch.setenv('ARC_PROSE_DETECTION', 'off')
    with TestClient(service.create_app(data_dir=tmp_path)):
        pass
    token = tmp_path / 'access.token'
    assert token.is_file() and anchored.owner_only_holds(token)
    monkeypatch.setattr(cli.getpass, 'getpass', lambda _: 'seat-secret')
    assert cli.main(['credential', '--name', 'prose-key', '--data', str(tmp_path)]) == 0
    assert anchored.owner_only_holds(tmp_path / 'credentials' / 'prose-key.credential')
    detector = prose.Detector(tmp_path, enabled=False)
    assert len(detector._key()) == 32 and anchored.owner_only_holds(tmp_path / 'prose' / 'audit.key')
    # A plain file written beside them is not restricted, so the check is discriminating.
    plain = tmp_path / 'plain.txt'
    plain.write_text('x')
    assert not anchored.owner_only_holds(plain)
    assert anchored.owner_only(plain) in ('mode 0600', 'owner-only ACL') and anchored.owner_only_holds(plain)
