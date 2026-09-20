"""Secret files — the access token, a stored credential, the prose audit key — and the
directories that hold them are accessible to their owner alone (the exact mode on POSIX,
one protected access entry on Windows), and the callers refuse when that cannot hold."""
from __future__ import annotations

import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from arc_science import anchored, cli, prose, service


def test_token_credential_audit_key_and_their_directories_are_restricted_to_the_owner(tmp_path, monkeypatch):
    monkeypatch.setenv('ARC_DATA_DIR', str(tmp_path))
    monkeypatch.delenv('ARC_TOKEN_FILE', raising=False)
    monkeypatch.setenv('ARC_PROSE_DETECTION', 'off')
    with TestClient(service.create_app(data_dir=tmp_path)):
        pass
    token = tmp_path / 'access.token'
    assert token.is_file() and anchored.owner_only_holds(token) and anchored.owner_only_holds(tmp_path)
    monkeypatch.setattr(cli.getpass, 'getpass', lambda _: 'seat-secret')
    assert cli.main(['credential', '--name', 'prose-key', '--data', str(tmp_path)]) == 0
    assert anchored.owner_only_holds(tmp_path / 'credentials') and anchored.owner_only_holds(tmp_path / 'credentials' / 'prose-key.credential')
    detector = prose.Detector(tmp_path, enabled=False)
    assert len(detector._key()) == 32 and detector._key_protected
    assert anchored.owner_only_holds(tmp_path / 'prose') and anchored.owner_only_holds(tmp_path / 'prose' / 'audit.key')
    # A plain file written beside them is not restricted, so the check is discriminating;
    # and on Windows a single entry for the wrong trustee is not accepted either.
    plain = tmp_path / 'plain.txt'
    plain.write_text('x')
    if sys.platform == 'win32':
        assert subprocess.run(['icacls', str(plain), '/inheritance:r', '/grant:r', '*S-1-1-0:R'], capture_output=True).returncode == 0
    else:
        plain.chmod(0o644)
    assert not anchored.owner_only_holds(plain)
    assert anchored.owner_only(plain) in ('mode 0600', 'owner-only DACL') and anchored.owner_only_holds(plain)


def test_a_secret_that_cannot_be_restricted_is_refused_not_served(tmp_path, monkeypatch):
    monkeypatch.setenv('ARC_DATA_DIR', str(tmp_path))
    monkeypatch.setenv('ARC_PROSE_DETECTION', 'off')

    def failing(path):
        raise PermissionError('Cannot restrict ' + str(path) + ' to its owner: simulated')
    monkeypatch.setattr(anchored, 'owner_only', failing)
    with pytest.raises(PermissionError, match='simulated'):
        service.create_app(data_dir=tmp_path)
    monkeypatch.setattr(cli.getpass, 'getpass', lambda _: 'seat-secret')
    assert cli.main(['credential', '--name', 'prose-key', '--data', str(tmp_path)]) != 0
    assert not (tmp_path / 'credentials' / 'prose-key.credential').exists()  # nothing left behind
    detector = prose.Detector(tmp_path, enabled=False)
    with pytest.raises(prose.ProseRefused) as refused:
        detector._key()
    assert refused.value.code == 'audit_key' and not detector._key_protected
