"""Flat, bounded, descriptor-anchored cache. No eviction or source overwrites."""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat

try:
    import fcntl
except ImportError:  # Windows: an msvcrt byte-range lock stands in for flock.
    fcntl = None

from .. import anchored
from ..vector_assets import _open_directory, _read_regular_at, _write_regular_at


_PRIVATE_TEMPORARY = re.compile(r'\.write-[0-9a-f]{32}')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()


class Cache:
    def __init__(self, root: Path, budget: int):
        if os.name == 'posix':
            if (fcntl is None or not getattr(os,'O_NOFOLLOW',0) or not getattr(os,'O_NONBLOCK',0) or
                    not getattr(os,'O_DIRECTORY',0) or
                    not {os.open,os.stat,os.mkdir,os.unlink,os.link} <= os.supports_dir_fd):
                raise ValueError('BioArt cache/import requires POSIX no-follow directory/file primitives')
        elif os.name != 'nt':
            raise ValueError('BioArt cache/import is supported on POSIX and Windows only')
        if '..' in Path(root).parts: raise ValueError('Unsafe cache path')
        self.root = Path(os.path.abspath(root)); self.budget = budget

    def read(self, name, limit):
        fd = _open_directory(self.root,create=True)
        try:
            try: anchored.lstat(fd,name)
            except FileNotFoundError: return None
            return _read_regular_at(fd,name,limit,'BioArt cache')
        finally: anchored.close_directory(fd)

    def write(self, entries, *, replace=()):
        fd = _open_directory(self.root,create=True); lock_fd = None; temporary = []
        try:
            try:
                lock_fd = anchored.open_file_fd(fd, '.writer-lock',
                    os.O_RDWR | os.O_CREAT | getattr(os, 'O_CLOEXEC', 0), 0o600)
                info = os.fstat(lock_fd)
                if not stat.S_ISREG(info.st_mode):
                    raise ValueError('BioArt cache lock is not a regular file')
                if os.name == 'posix':
                    if info.st_nlink != 1 or info.st_uid != os.geteuid():
                        raise ValueError('BioArt cache lock is not a private regular file')
                    os.fchmod(lock_fd, 0o600)
                    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                else:
                    # Windows has no flock/ownership; a byte-range lock gives the same
                    # single-writer exclusion (weaker: no private-owner attestation).
                    import msvcrt
                    msvcrt.locking(lock_fd, msvcrt.LK_NBLCK, 1)
            except BlockingIOError:
                raise ValueError('BioArt cache busy; another writer is active') from None
            except OSError:
                raise ValueError('BioArt cache lock is unavailable or unsafe') from None
            total = 0
            sizes = {}
            for name in anchored.listdir(fd):
                info = anchored.lstat(fd,name)
                if not stat.S_ISREG(info.st_mode): raise ValueError('BioArt cache contains non-regular or symlink entry')
                if _PRIVATE_TEMPORARY.fullmatch(name):
                    anchored.unlink(fd,name)
                elif name != '.writer-lock':
                    total += info.st_size; sizes[name] = info.st_size
            pending = {}
            for name, data in entries.items():
                if Path(name).name != name or name.startswith('.'): raise ValueError('Unsafe cache filename')
                if name in sizes and name not in replace:
                    if _read_regular_at(fd,name,max(len(data),1),'BioArt cache') != data:
                        raise ValueError('Immutable cache digest collision or corruption')
                else: pending[name] = data
            # Include temporary bytes: do not transiently exceed the budget on refresh.
            if total + sum(map(len,pending.values())) > self.budget:
                raise ValueError('BioArt cache budget exceeded; use a new project cache')
            for name,data in pending.items():
                temp = '.write-' + secrets.token_hex(16); temporary.append(temp)
                _write_regular_at(fd,temp,data)
                if name in replace:
                    anchored.replace(fd,temp,name)
                elif os.name == 'posix':
                    os.link(temp,name,src_dir_fd=fd,dst_dir_fd=fd,follow_symlinks=False)
                    anchored.unlink(fd,temp)
                else:
                    # Windows os.rename is create-only (fails if the immutable entry exists).
                    anchored.rename(fd,temp,name)
                temporary.remove(temp)
            anchored.fsync_dir(fd)
        finally:
            for temp in temporary:
                anchored.unlink(fd,temp)
            if lock_fd is not None: os.close(lock_fd)
            anchored.close_directory(fd)
