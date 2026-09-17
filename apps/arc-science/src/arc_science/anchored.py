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
