"""The Windows Credential Manager as the second credential store. The native host writes
a generic credential under ArcScience/<name> (CredWriteW, per user, DPAPI) from the
Windows credential prompt, so no secret ever crosses the page; the service reads it by
name here (CredReadW through ctypes) after the credential file the `arc-science
credential` CLI keeps writing for browser and non-Windows use. Nothing here writes."""
from __future__ import annotations
import ctypes
import os
import sys
from pathlib import Path

TARGET_PREFIX='ArcScience/'
CRED_TYPE_GENERIC=1
ERROR_NOT_FOUND=1168
def credential_path(name,data=None):
    """Where `arc-science credential --name NAME` stores a credential: one directory,
    one file per name, never a key in the settings."""
    if not name or len(name)>80 or not all(c.isascii() and (c.isalnum() or c in '._-') for c in name):
        raise ValueError('A credential name is 1-80 characters of [A-Za-z0-9._-]')
    return Path(data or os.environ.get('ARC_DATA_DIR','./data'))/'credentials'/(name+'.credential')


if sys.platform=='win32':
    from ctypes import wintypes

    class CREDENTIALW(ctypes.Structure):
        _fields_=[('Flags',wintypes.DWORD),('Type',wintypes.DWORD),('TargetName',wintypes.LPWSTR),('Comment',wintypes.LPWSTR),
                  ('LastWritten',wintypes.FILETIME),('CredentialBlobSize',wintypes.DWORD),('CredentialBlob',ctypes.POINTER(ctypes.c_ubyte)),
                  ('Persist',wintypes.DWORD),('AttributeCount',wintypes.DWORD),('Attributes',ctypes.c_void_p),
                  ('TargetAlias',wintypes.LPWSTR),('UserName',wintypes.LPWSTR)]

    _advapi32=ctypes.WinDLL('advapi32',use_last_error=True)
    _advapi32.CredReadW.argtypes=[wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,ctypes.POINTER(ctypes.POINTER(CREDENTIALW))]
    _advapi32.CredReadW.restype=wintypes.BOOL
    _advapi32.CredFree.argtypes=[ctypes.c_void_p];_advapi32.CredFree.restype=None


def read_credential_manager(name):
    """The secret stored under ArcScience/<name>, or None when there is none (or this is
    not Windows). Any other failure of the store is an OSError, never a fall-through."""
    credential_path(name)  # the same name rule as the file store
    if sys.platform!='win32':return None
    handle=ctypes.POINTER(CREDENTIALW)()
    if not _advapi32.CredReadW(TARGET_PREFIX+name,CRED_TYPE_GENERIC,0,ctypes.byref(handle)):
        error=ctypes.get_last_error()
        if error==ERROR_NOT_FOUND:return None
        raise ctypes.WinError(error)
    try:
        record=handle.contents;size=record.CredentialBlobSize
        raw=ctypes.string_at(record.CredentialBlob,size) if size else b''
        try:return raw.decode('utf-8')
        except UnicodeDecodeError:raise ValueError(f'The credential {name} in the Windows Credential Manager is not UTF-8 text') from None
        finally:
            if size:ctypes.memset(record.CredentialBlob,0,size)
    finally:_advapi32.CredFree(handle)


def credential_source(name,data_dir=None):
    """Where a credential of this name is stored ('file' wins over 'credential_manager'),
    or None; the value never leaves this function."""
    if credential_path(name,data_dir).is_file():return 'file'
    return 'credential_manager' if read_credential_manager(name) is not None else None
