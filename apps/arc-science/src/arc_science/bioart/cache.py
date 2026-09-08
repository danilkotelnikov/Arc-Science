"""Flat, bounded, descriptor-anchored cache. No eviction or source overwrites."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat

from ..vector_assets import _open_directory, _read_regular_at, _write_regular_at


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()


class Cache:
    def __init__(self, root: Path, budget: int):
        if (os.name != 'posix' or not getattr(os,'O_NOFOLLOW',0) or
                not getattr(os,'O_NONBLOCK',0) or not getattr(os,'O_DIRECTORY',0) or
                not {os.open,os.stat,os.mkdir,os.unlink,os.link} <= os.supports_dir_fd):
            raise ValueError('BioArt cache/import requires POSIX no-follow directory/file primitives; Windows Python provider support is unavailable')
        if '..' in Path(root).parts: raise ValueError('Unsafe cache path')
        self.root = Path(os.path.abspath(root)); self.budget = budget

    def read(self, name, limit):
        fd = _open_directory(self.root,create=True)
        try:
            try: os.stat(name,dir_fd=fd,follow_symlinks=False)
            except FileNotFoundError: return None
            return _read_regular_at(fd,name,limit,'BioArt cache')
        finally: os.close(fd)

    def write(self, entries, *, replace=()):
        fd = _open_directory(self.root,create=True); locked = False; temporary = []
        try:
            try:
                _write_regular_at(fd,'.writer-lock',b'BioArt write in progress')
                locked = True
            except FileExistsError:
                raise ValueError('BioArt cache busy; review stale writer lock after an interrupted process') from None
            total = 0
            sizes = {}
            for name in os.listdir(fd):
                info = os.stat(name,dir_fd=fd,follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode): raise ValueError('BioArt cache contains non-regular or symlink entry')
                if name != '.writer-lock': total += info.st_size; sizes[name] = info.st_size
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
                    os.replace(temp,name,src_dir_fd=fd,dst_dir_fd=fd)
                else:
                    os.link(temp,name,src_dir_fd=fd,dst_dir_fd=fd,follow_symlinks=False)
                    os.unlink(temp,dir_fd=fd)
                temporary.remove(temp)
            os.fsync(fd)
        finally:
            for temp in temporary:
                os.unlink(temp,dir_fd=fd)
            if locked: os.unlink('.writer-lock',dir_fd=fd)
            os.close(fd)
