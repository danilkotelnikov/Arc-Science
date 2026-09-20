"""Cross-platform anchored-directory file operations.

POSIX uses openat semantics: a directory file descriptor plus ``dir_fd``-relative
``os`` calls, so a component cannot be redirected through a symlink swapped in
mid-operation. Windows Python has neither directory descriptors nor ``dir_fd``, so
the same operations run against absolute paths with explicit reparse-point
(symlink/junction) rejection. The Windows model is weaker against TOCTOU races than
a real directory fd; it is used only on Windows, where these store/run directories
are the local operator's own.

A *handle* is an ``int`` directory fd on POSIX and an absolute path ``str`` on
Windows. Every POSIX branch below forwards to the identical ``os`` call the callers
used inline before, so Linux behaviour is unchanged; only the Windows branch is new.
"""
from __future__ import annotations

import os
from pathlib import Path
import stat

_POSIX = os.name != 'nt'
_DIR_FLAGS = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0) | getattr(os, 'O_NOFOLLOW', 0)
_READ_FLAGS = (os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
               | getattr(os, 'O_BINARY', 0))
_WRITE_FLAGS = (os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
                | getattr(os, 'O_BINARY', 0))
_REPARSE = getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0)


def _basename(name: str) -> str:
    if not isinstance(name, str) or Path(name).name != name or name in ('', '.', '..') or '\x00' in name:
        raise ValueError('Unsafe anchored filename')
    return name


def _is_reparse(info: os.stat_result) -> bool:
    """A Windows symlink, junction or other reparse point, or a POSIX symlink."""
    return bool(getattr(info, 'st_file_attributes', 0) & _REPARSE) or stat.S_ISLNK(info.st_mode)


def _reject_reparse_chain(absolute: str) -> None:
    """Raise if the leaf or any existing ancestor is a symlink/junction/reparse point."""
    current = absolute
    while True:
        try:
            if _is_reparse(os.lstat(current)):
                raise ValueError('Symlink or reparse point in anchored path')
        except FileNotFoundError:
            pass  # A not-yet-created leaf is fine; keep validating real ancestors.
        parent = os.path.dirname(current)
        if parent == current:
            return
        current = parent


def _mkdirs(absolute: str, mode: int) -> None:
    parts = Path(absolute).parts
    current = parts[0]
    for component in parts[1:]:
        current = os.path.join(current, component)
        try:
            os.mkdir(current, mode)
        except FileExistsError:
            pass


# --- directory handles -----------------------------------------------------
def open_directory(path, *, create: bool = False, mode: int = 0o700):
    """Open every directory component without following symlinks; return a handle."""
    absolute = os.path.abspath(os.fspath(path))
    if _POSIX:
        try:
            fd = os.open(Path(absolute).anchor, _DIR_FLAGS)
        except OSError:
            raise ValueError('Path does not have a safe directory root') from None
        try:
            for component in Path(absolute).parts[1:]:
                if create:
                    try:
                        os.mkdir(component, mode, dir_fd=fd)
                    except FileExistsError:
                        pass
                nxt = os.open(component, _DIR_FLAGS, dir_fd=fd)
                os.close(fd)
                fd = nxt
            return fd
        except OSError:
            os.close(fd)
            raise ValueError('Path contains a missing, non-directory, or symlink component') from None
    if create:
        _mkdirs(absolute, mode)
    if not os.path.isdir(absolute):
        raise ValueError('Path is missing or not a directory')
    _reject_reparse_chain(absolute)
    return absolute


def child_directory(handle, name: str, *, create: bool = False, mode: int = 0o700):
    _basename(name)
    if _POSIX:
        if create:
            try:
                os.mkdir(name, mode, dir_fd=handle)
            except FileExistsError:
                pass
        try:
            return os.open(name, _DIR_FLAGS, dir_fd=handle)
        except OSError:
            raise ValueError('Unsafe anchored directory') from None
    child = os.path.join(handle, name)
    if create:
        try:
            os.mkdir(child, mode)
        except FileExistsError:
            pass
    try:
        info = os.lstat(child)
    except OSError:
        raise ValueError('Unsafe anchored directory') from None
    if _is_reparse(info) or not stat.S_ISDIR(info.st_mode):
        raise ValueError('Unsafe anchored directory')
    return child


def close_directory(handle) -> None:
    if _POSIX:
        os.close(handle)


def mkdir(handle, name: str, mode: int = 0o700) -> None:
    _basename(name)
    if _POSIX:
        os.mkdir(name, mode, dir_fd=handle)
    else:
        os.mkdir(os.path.join(handle, name), mode)


def lstat(handle, name: str) -> os.stat_result:
    """stat a child without following a final symlink; raises like os.stat."""
    _basename(name)
    if _POSIX:
        return os.stat(name, dir_fd=handle, follow_symlinks=False)
    return os.lstat(os.path.join(handle, name))


def open_read_fd(handle, name: str) -> int:
    """Open a child file read-only, refusing to follow a symlink/reparse point."""
    _basename(name)
    if _POSIX:
        return os.open(name, _READ_FLAGS, dir_fd=handle)
    target = os.path.join(handle, name)
    if _is_reparse(os.lstat(target)):
        raise ValueError('Refusing to read a symlink or reparse point')
    return os.open(target, _READ_FLAGS)


def open_write_new_fd(handle, name: str, mode: int = 0o600) -> int:
    """Create a new child file exclusively (O_EXCL); never follow an existing link."""
    _basename(name)
    if _POSIX:
        return os.open(name, _WRITE_FLAGS, mode, dir_fd=handle)
    return os.open(os.path.join(handle, name), _WRITE_FLAGS, mode)


def open_file_fd(handle, name: str, flags: int, mode: int = 0o600) -> int:
    """Open a child with caller-chosen flags (binary and no-follow always added)."""
    _basename(name)
    flags = flags | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0)
    if _POSIX:
        return os.open(name, flags, mode, dir_fd=handle)
    return os.open(os.path.join(handle, name), flags, mode)


def rename(handle, src: str, dst: str) -> None:
    _basename(src)
    _basename(dst)
    if _POSIX:
        os.rename(src, dst, src_dir_fd=handle, dst_dir_fd=handle)
    else:
        os.rename(os.path.join(handle, src), os.path.join(handle, dst))


def replace(handle, src: str, dst: str) -> None:
    _basename(src)
    _basename(dst)
    if _POSIX:
        os.replace(src, dst, src_dir_fd=handle, dst_dir_fd=handle)
    else:
        os.replace(os.path.join(handle, src), os.path.join(handle, dst))


def listdir(handle) -> list[str]:
    return os.listdir(handle)


def unlink(handle, name: str) -> None:
    _basename(name)
    if _POSIX:
        os.unlink(name, dir_fd=handle)
    else:
        os.unlink(os.path.join(handle, name))


def rmdir(handle, name: str) -> None:
    _basename(name)
    if _POSIX:
        os.rmdir(name, dir_fd=handle)
    else:
        os.rmdir(os.path.join(handle, name))


def fsync_dir(handle) -> None:
    if _POSIX:
        os.fsync(handle)
    # Windows cannot fsync a directory handle; the parent metadata is durable enough
    # for a local single-operator store.


def identity(handle) -> tuple[int, int]:
    """A (device, inode) pair that changes if the directory is swapped underfoot."""
    info = os.fstat(handle) if _POSIX else os.stat(handle)
    return (info.st_dev, info.st_ino)


def dup_handle(handle):
    """An independent handle to the same directory that a callee may close on its own.

    On POSIX this dups the fd; on Windows the handle is a path and closing is a no-op,
    so returning it as-is is already safe to share."""
    return os.dup(handle) if _POSIX else handle


def dir_fd(handle):
    """The POSIX directory fd, or None on Windows (callers then use the path)."""
    return handle if _POSIX else None


def as_path(handle):
    """The Windows absolute path, or None on POSIX."""
    return None if _POSIX else handle


def _windows_sid() -> str:
    """The SID of the account this process runs as, from its own token."""
    import ctypes
    from ctypes import wintypes
    advapi32 = ctypes.WinDLL('advapi32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    advapi32.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi32.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    advapi32.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.LPWSTR)]
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    token = wintypes.HANDLE()
    if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0x0008, ctypes.byref(token)):  # TOKEN_QUERY
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        size = wintypes.DWORD()
        advapi32.GetTokenInformation(token, 1, None, 0, ctypes.byref(size))  # TokenUser
        buffer = ctypes.create_string_buffer(size.value)
        if not advapi32.GetTokenInformation(token, 1, buffer, size, ctypes.byref(size)):
            raise ctypes.WinError(ctypes.get_last_error())
        sid = ctypes.c_void_p.from_buffer(buffer).value  # SID_AND_ATTRIBUTES.Sid
        text = wintypes.LPWSTR()
        if not advapi32.ConvertSidToStringSidW(sid, ctypes.byref(text)):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            return text.value
        finally:
            kernel32.LocalFree(text)
    finally:
        kernel32.CloseHandle(token)


_SE_FILE_OBJECT = 1
_DACL = 0x00000004
_PROTECTED_DACL = 0x80000000


def _windows_dacl(path: str) -> str:
    """The file's discretionary ACL as an SDDL string, read from the object itself."""
    import ctypes
    from ctypes import wintypes
    advapi32 = ctypes.WinDLL('advapi32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    advapi32.GetNamedSecurityInfoW.argtypes = [wintypes.LPCWSTR, ctypes.c_int, wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p,
                                               ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    advapi32.ConvertSecurityDescriptorToStringSecurityDescriptorW.argtypes = [ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD,
                                                                              ctypes.POINTER(wintypes.LPWSTR), ctypes.POINTER(wintypes.ULONG)]
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    descriptor = ctypes.c_void_p()
    dacl = ctypes.c_void_p()
    error = advapi32.GetNamedSecurityInfoW(path, _SE_FILE_OBJECT, _DACL, None, None, ctypes.byref(dacl), None, ctypes.byref(descriptor))
    if error:
        raise ctypes.WinError(error)
    try:
        text = wintypes.LPWSTR()
        length = wintypes.ULONG()
        if not advapi32.ConvertSecurityDescriptorToStringSecurityDescriptorW(descriptor, 1, _DACL, ctypes.byref(text), ctypes.byref(length)):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            return text.value
        finally:
            kernel32.LocalFree(text)
    finally:
        kernel32.LocalFree(descriptor)


def _windows_set_dacl(path: str, sddl: str) -> str:
    """Replace the object's DACL with the one `sddl` describes, protected from inheritance;
    returns the canonical SDDL of what was requested (well-known SIDs abbreviated as the
    API abbreviates them), for an exact comparison with what is read back."""
    import ctypes
    from ctypes import wintypes
    advapi32 = ctypes.WinDLL('advapi32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p),
                                                                              ctypes.POINTER(wintypes.ULONG)]
    advapi32.ConvertSecurityDescriptorToStringSecurityDescriptorW.argtypes = [ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD,
                                                                              ctypes.POINTER(wintypes.LPWSTR), ctypes.POINTER(wintypes.ULONG)]
    advapi32.GetSecurityDescriptorDacl.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.BOOL), ctypes.POINTER(ctypes.c_void_p),
                                                   ctypes.POINTER(wintypes.BOOL)]
    advapi32.SetNamedSecurityInfoW.argtypes = [wintypes.LPWSTR, ctypes.c_int, wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p,
                                               ctypes.c_void_p, ctypes.c_void_p]
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    descriptor = ctypes.c_void_p()
    size = wintypes.ULONG()
    if not advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, ctypes.byref(descriptor), ctypes.byref(size)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        present = wintypes.BOOL()
        dacl = ctypes.c_void_p()
        defaulted = wintypes.BOOL()
        if not advapi32.GetSecurityDescriptorDacl(descriptor, ctypes.byref(present), ctypes.byref(dacl), ctypes.byref(defaulted)) or not present.value:
            raise ctypes.WinError(ctypes.get_last_error())
        error = advapi32.SetNamedSecurityInfoW(path, _SE_FILE_OBJECT, _DACL | _PROTECTED_DACL, None, None, dacl, None)
        if error:
            raise ctypes.WinError(error)
        text = wintypes.LPWSTR()
        length = wintypes.ULONG()
        if not advapi32.ConvertSecurityDescriptorToStringSecurityDescriptorW(descriptor, 1, _DACL, ctypes.byref(text), ctypes.byref(length)):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            return text.value
        finally:
            kernel32.LocalFree(text)
    finally:
        kernel32.LocalFree(descriptor)


def _owner_only_sddl(path: Path) -> str:
    # One allow entry, full control, for the account this process runs as; a directory's
    # entry is inherited by what is created inside it, so a secret file is restricted
    # from its first byte. Nothing for SYSTEM or Administrators: owner-only means that.
    flags = 'OICI' if path.is_dir() else ''
    return 'D:P(A;' + flags + ';FA;;;' + _windows_sid() + ')'


def owner_only(path) -> str:
    """Restrict a secret file or directory (the data directory, a token, a credential, the
    audit key) to the account running this process. POSIX: mode 0600 (0700 for a
    directory). Windows: the mode only toggles the read-only bit, so the object's DACL
    is replaced by one protected entry for this account and read back; anything else
    raises PermissionError, and callers refuse to start, store or use the secret."""
    path = Path(path)
    if os.name != 'nt':
        path.chmod(0o700 if path.is_dir() else 0o600)
        if not owner_only_holds(path):
            raise PermissionError('Cannot restrict ' + str(path) + ' to its owner')
        return 'mode 0700' if path.is_dir() else 'mode 0600'
    try:
        wanted = _windows_set_dacl(str(path), _owner_only_sddl(path))
        actual = _windows_dacl(str(path))
    except OSError as error:
        raise PermissionError('Cannot restrict ' + str(path) + ' to its owner: ' + str(error)[:160]) from None
    if not _dacl_matches(actual, wanted):
        raise PermissionError('The access entries of ' + str(path) + ' did not take: ' + actual[:200])
    return 'owner-only DACL'


def _dacl_matches(actual: str, wanted: str) -> bool:
    """The read-back DACL is protected — control flags exactly `P` or `PAI`, the AI flag the
    API adds to record how the DACL was written carrying no permission — and its entries
    are exactly the wanted ones."""
    if not (actual.startswith('D:') and wanted.startswith('D:')):
        return False
    flags, _, entries = actual[2:].partition('(')
    return flags in ('P', 'PAI') and entries == wanted[2:].partition('(')[2]


def owner_only_holds(path) -> bool:
    """Whether the object is accessible to this account alone: the exact mode on POSIX;
    on Windows a protected DACL whose only entry is this account's, read back from the
    object (a different trustee, an extra entry or an inheritable DACL all fail)."""
    path = Path(path)
    if os.name != 'nt':
        return stat.S_IMODE(path.stat().st_mode) == (0o700 if path.is_dir() else 0o600)
    try:
        return _dacl_matches(_windows_dacl(str(path)), _canonical_sddl(_owner_only_sddl(path)))
    except OSError:
        return False


def _canonical_sddl(sddl: str) -> str:
    """The SDDL as the API writes it (well-known accounts abbreviated), without touching any object."""
    import ctypes
    from ctypes import wintypes
    advapi32 = ctypes.WinDLL('advapi32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p),
                                                                              ctypes.POINTER(wintypes.ULONG)]
    advapi32.ConvertSecurityDescriptorToStringSecurityDescriptorW.argtypes = [ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD,
                                                                              ctypes.POINTER(wintypes.LPWSTR), ctypes.POINTER(wintypes.ULONG)]
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    descriptor = ctypes.c_void_p()
    size = wintypes.ULONG()
    if not advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, ctypes.byref(descriptor), ctypes.byref(size)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        text = wintypes.LPWSTR()
        length = wintypes.ULONG()
        if not advapi32.ConvertSecurityDescriptorToStringSecurityDescriptorW(descriptor, 1, _DACL, ctypes.byref(text), ctypes.byref(length)):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            return text.value
        finally:
            kernel32.LocalFree(text)
    finally:
        kernel32.LocalFree(descriptor)
