"""Content-addressed files and compare-and-swap event history for one trusted service."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import tempfile
from .contracts import ArtifactRef, canonical, digest

class IntegrityError(ValueError):
    pass

class ConflictError(RuntimeError):
    pass

class ArtifactStore:
    def __init__(self, root: Path, *, max_bytes: int=32*1024*1024):
        if max_bytes<=0: raise ValueError('max_bytes must be positive')
        self.root=Path(root).resolve();self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.max_bytes=max_bytes

    def path(self, sha: str) -> Path:
        if not re.fullmatch(r'[a-f0-9]{64}',sha): raise ValueError('Invalid digest')
        return self.root/sha

    def put(self, data: bytes, *, name: str, media_type: str, role: str) -> ArtifactRef:
        if len(data)>self.max_bytes: raise ValueError('Artifact size limit exceeded')
        ref=ArtifactRef(name=name,digest=hashlib.sha256(data).hexdigest(),size=len(data),
                        media_type=media_type,role=role)
        destination=self.path(ref.digest)
        with tempfile.NamedTemporaryFile(dir=self.root,delete=False) as file:
            temporary=Path(file.name);file.write(data);file.flush();os.fsync(file.fileno())
        try:
            try: os.link(temporary,destination)
            except FileExistsError: pass
        finally:
            temporary.unlink(missing_ok=True)
        if self.read(ref)!=data: raise IntegrityError('Stored artifact mismatch')
        return ref

    def read(self, ref: ArtifactRef) -> bytes:
        if ref.size>self.max_bytes: raise IntegrityError('Artifact size limit exceeded')
        path=self.path(ref.digest)
        try:
            # This store directory belongs to the trusted service. Model workers do not mount it.
            if path.is_symlink(): raise IntegrityError('Symlinks are forbidden')
            fd=os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
            with os.fdopen(fd,'rb') as file:
                info=os.fstat(file.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size!=ref.size:
                    raise IntegrityError('Artifact size or type changed')
                data=file.read(self.max_bytes+1)
        except OSError as exc:
            raise IntegrityError('Artifact unavailable') from exc
        if len(data)!=ref.size or hashlib.sha256(data).hexdigest()!=ref.digest:
            raise IntegrityError('Artifact digest mismatch')
        return data

class EventLedger:
    """Hash-chained audit records; not a signature or protection against a malicious DBA."""
    def __init__(self,path: Path):
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True)
        with sqlite3.connect(self.path) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('''CREATE TABLE IF NOT EXISTS events (
              project TEXT NOT NULL, seq INTEGER NOT NULL, key TEXT NOT NULL,
              kind TEXT NOT NULL, payload TEXT NOT NULL, previous TEXT NOT NULL,
              hash TEXT NOT NULL, PRIMARY KEY(project,seq), UNIQUE(project,key))''')

    def append(self, project: str, kind: str, payload: dict, *, key: str, expected_seq: int) -> str:
        encoded=canonical(payload).decode()
        if len(encoded.encode())>128*1024: raise ValueError('Event too large')
        with sqlite3.connect(self.path,timeout=10,isolation_level=None) as db:
            db.execute('BEGIN IMMEDIATE')
            prior=db.execute('SELECT kind,payload,hash FROM events WHERE project=? AND key=?',(project,key)).fetchone()
            if prior:
                if prior[:2]!=(kind,encoded): raise ConflictError('Idempotency key reused for different content')
                db.commit();return prior[2]
            last=db.execute('SELECT seq,hash FROM events WHERE project=? ORDER BY seq DESC LIMIT 1',(project,)).fetchone()
            seq,previous=last if last else (0,'0'*64)
            if seq!=expected_seq: raise ConflictError('Stale event sequence')
            sha=digest([project,seq+1,key,kind,payload,previous])
            db.execute('INSERT INTO events VALUES (?,?,?,?,?,?,?)',(project,seq+1,key,kind,encoded,previous,sha))
            db.commit();return sha

    def verify(self, project: str) -> bool:
        with sqlite3.connect(self.path) as db:
            rows=db.execute('SELECT seq,key,kind,payload,previous,hash FROM events WHERE project=? ORDER BY seq',(project,)).fetchall()
        previous='0'*64
        for expected,row in enumerate(rows,1):
            seq,key,kind,payload,parent,sha=row
            try: calculated=digest([project,seq,key,kind,json.loads(payload),parent])
            except (ValueError,TypeError): return False
            if seq!=expected or parent!=previous or sha!=calculated: return False
            previous=sha
        return True
