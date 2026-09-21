"""Credentials: the file the CLI writes, then the Windows Credential Manager the native
host writes, then the legacy environment files; the value never leaves the reader."""
import ctypes
import sys
import uuid

import pytest

from arc_science import credentials, service

WINDOWS = sys.platform == 'win32'


def write_generic(name, blob):
    """A test credential the way the native host writes one (CredWriteW, generic, per user)."""
    from ctypes import wintypes
    advapi32 = ctypes.WinDLL('advapi32', use_last_error=True)
    advapi32.CredWriteW.argtypes = [ctypes.POINTER(credentials.CREDENTIALW), wintypes.DWORD]
    advapi32.CredWriteW.restype = wintypes.BOOL
    buffer = ctypes.create_string_buffer(blob, len(blob))
    record = credentials.CREDENTIALW()
    record.Type = credentials.CRED_TYPE_GENERIC
    record.TargetName = credentials.TARGET_PREFIX + name
    record.UserName = 'openai'
    record.CredentialBlobSize = len(blob)
    record.CredentialBlob = ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))
    record.Persist = 2  # CRED_PERSIST_LOCAL_MACHINE
    if not advapi32.CredWriteW(ctypes.byref(record), 0):
        raise ctypes.WinError(ctypes.get_last_error())


def delete_generic(name):
    from ctypes import wintypes
    advapi32 = ctypes.WinDLL('advapi32', use_last_error=True)
    advapi32.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
    advapi32.CredDeleteW.restype = wintypes.BOOL
    advapi32.CredDeleteW(credentials.TARGET_PREFIX + name, credentials.CRED_TYPE_GENERIC, 0)


@pytest.mark.skipif(not WINDOWS, reason='Windows Credential Manager')
def test_the_credential_manager_is_read_by_name_and_the_file_wins(tmp_path, monkeypatch):
    monkeypatch.setenv('ARC_DATA_DIR', str(tmp_path))
    name = 'arc-test-' + uuid.uuid4().hex
    secret = 'sk-test-' + uuid.uuid4().hex + '-ü'
    assert credentials.read_credential_manager(name) is None and credentials.credential_source(name, tmp_path) is None
    assert service.credential_stored(name) is False
    try:
        write_generic(name, secret.encode('utf-8'))
        assert credentials.read_credential_manager(name) == secret
        assert credentials.credential_source(name, tmp_path) == 'credential_manager' and credentials.credential_source(name) == 'credential_manager'
        assert service._secret(name) == secret and service.credential_stored(name) is True
        path = service.credential_path(name)
        path.parent.mkdir(parents=True)
        path.write_text('from-the-file\n')
        assert credentials.credential_source(name, tmp_path) == 'file' and service._secret(name) == 'from-the-file'
        path.unlink()
        # A blob the host did not write as UTF-8 text is refused, never decoded loosely.
        write_generic(name, b'\xff\xfe\x00')
        with pytest.raises(ValueError, match='not UTF-8'):
            credentials.read_credential_manager(name)
    finally:
        delete_generic(name)
    assert credentials.read_credential_manager(name) is None and service.credential_stored(name) is False


def test_secret_order_is_file_then_manager_then_legacy_environment(tmp_path, monkeypatch):
    monkeypatch.setenv('ARC_DATA_DIR', str(tmp_path))
    monkeypatch.setenv('ARC_MODEL_TOKEN_FILE', str(tmp_path / 'legacy.token'))
    (tmp_path / 'legacy.token').write_text('legacy-planner-secret\n')
    manager = {}
    monkeypatch.setattr(service, 'read_credential_manager', lambda name: manager.get(name))
    # Nowhere: a custom name is refused; a legacy name falls to its environment file.
    with pytest.raises(ValueError, match='No credential named custom-key'):
        service._secret('custom-key')
    assert service.credential_stored('custom-key') is False and service._secret('planner') == 'legacy-planner-secret'
    # The manager beats the legacy file and serves custom names; the file beats the manager.
    manager['planner'] = ' manager-planner-secret\n'
    manager['custom-key'] = 'manager-custom-secret'
    assert service._secret('planner') == 'manager-planner-secret' and service._secret('custom-key') == 'manager-custom-secret'
    assert service.credential_stored('custom-key') is True and credentials.credential_source('custom-key', tmp_path) is None  # the fake is not the real store
    path = service.credential_path('planner')
    path.parent.mkdir()
    path.write_text('file-planner-secret\n')
    assert service._secret('planner') == 'file-planner-secret' and credentials.credential_source('planner', tmp_path) == 'file'
    manager['empty'] = '   '
    with pytest.raises(ValueError, match='empty or exceeds limit'):
        service._secret('empty')
    assert service.credential_stored('empty') is False


def test_the_manager_reader_applies_the_credential_name_rule():
    for bad in ('../x', 'a b', '', 'x' * 81):
        with pytest.raises(ValueError, match='1-80 characters'):
            credentials.read_credential_manager(bad)
    if not WINDOWS:
        assert credentials.read_credential_manager('fine') is None and credentials.credential_source('fine') is None
