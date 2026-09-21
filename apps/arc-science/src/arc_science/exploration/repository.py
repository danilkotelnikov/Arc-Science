"""Transactional mission snapshots, cancellation fencing and hash-chained receipts."""
from __future__ import annotations
from contextlib import closing, contextmanager
import json
import sqlite3
import time
import uuid
from pathlib import Path
from ..contracts import canonical, digest
from .models import MissionRequest, MissionState

# Statuses whose recorded outcome cancellation must not rewrite (needs_input has no
# resume transition in this API, so it is finished as far as the operator can act).
FINISHED=('completed','budget_exhausted','error','needs_input')

class MissionFinished(ValueError):pass

_iso=lambda at=None: time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(time.time() if at is None else at))

class RevisionConflict(RuntimeError): pass

class MissionRepository:
    def __init__(self,path: Path):
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True)
        with self._connect() as db:
            db.executescript('''PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS missions (
                    id TEXT PRIMARY KEY, request TEXT NOT NULL, request_digest TEXT NOT NULL,
                    state TEXT NOT NULL, revision INTEGER NOT NULL, creation_key TEXT UNIQUE NOT NULL);
                CREATE TABLE IF NOT EXISTS mission_events (
                    mission TEXT NOT NULL, revision INTEGER NOT NULL, state_digest TEXT NOT NULL,
                    previous TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(mission,revision));''')

    @contextmanager
    def _connect(self):
        # SQLite's transaction context commits/rolls back but does not close the
        # connection. Release handles deterministically, including error paths.
        with closing(sqlite3.connect(self.path,timeout=15,isolation_level=None)) as db:
            with db:
                yield db

    @staticmethod
    def _row(row):
        if row is None:raise KeyError('Unknown mission')
        return {'id':row[0],'request':json.loads(row[1]),'request_digest':row[2],
                'state':json.loads(row[3]),'revision':row[4]}

    def create(self,request:MissionRequest,state:MissionState,*,key:str):
        if not key or len(key)>128:raise ValueError('Invalid idempotency key')
        if state.request_digest!=digest(request):raise ValueError('Unbound initial state')
        encoded=canonical(state).decode();q=canonical(request).decode();rid=digest(request)
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            old=db.execute('SELECT * FROM missions WHERE creation_key=?',(key,)).fetchone()
            if old:
                if old[2]!=rid:raise RevisionConflict('Creation key already used for a different request')
                db.commit();return self._row(old)
            mid=uuid.uuid4().hex
            db.execute('INSERT INTO missions VALUES(?,?,?,?,?,?)',(mid,q,rid,encoded,0,key))
            sha=digest([mid,0,digest(state),'0'*64])
            db.execute('INSERT INTO mission_events VALUES(?,?,?,?,?)',(mid,0,digest(state),'0'*64,sha))
            db.commit()
        return self.get(mid)

    def get(self,mid):
        with self._connect() as db:return self._row(db.execute('SELECT * FROM missions WHERE id=?',(mid,)).fetchone())

    def list(self,limit=100):
        with self._connect() as db:
            rows=db.execute('SELECT id,request,state,revision FROM missions ORDER BY rowid DESC LIMIT ?',(limit,)).fetchall()
        return [{'id':i,'goal':(req:=json.loads(q))['goal'],'mode':req.get('mode','demo'),'status':json.loads(s)['status'],'revision':r} for i,q,s,r in rows]

    def count(self):
        with self._connect() as db:return db.execute('SELECT COUNT(*) FROM missions').fetchone()[0]

    def count_bound_live(self,statuses=('ready','running','paused')):
        """Live missions already bound to a route (a seats_bound event) in one of the statuses."""
        marks=','.join('?'*len(statuses))
        with self._connect() as db:
            return db.execute("SELECT COUNT(*) FROM missions WHERE json_extract(request,'$.mode')='live' AND json_extract(state,'$.status') IN ("+marks+") "
                              "AND EXISTS (SELECT 1 FROM json_each(state,'$.events') WHERE json_extract(value,'$.kind')='seats_bound')",tuple(statuses)).fetchone()[0]

    def save(self,mid,state:MissionState,*,expected_revision:int):
        encoded=canonical(state).decode()
        if len(encoded)>8*1024*1024:raise ValueError('Mission state exceeds configured size limit')
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            old=self._row(db.execute('SELECT * FROM missions WHERE id=?',(mid,)).fetchone())
            if old['revision']!=expected_revision:raise RevisionConflict('Stale mission revision')
            if old['state']['status']=='cancelled':raise RevisionConflict('Cancelled mission cannot commit results')
            if state.request_digest!=old['request_digest']:raise RevisionConflict('Mission contract changed')
            previous=db.execute('SELECT hash FROM mission_events WHERE mission=? ORDER BY revision DESC LIMIT 1',(mid,)).fetchone()[0]
            rev=expected_revision+1;sha=digest([mid,rev,digest(state),previous])
            db.execute('UPDATE missions SET state=?,revision=? WHERE id=?',(encoded,rev,mid))
            db.execute('INSERT INTO mission_events VALUES(?,?,?,?,?)',(mid,rev,digest(state),previous,sha))
            db.commit()
        return self.get(mid)

    def cancel(self,mid,*,actor='operator',at=None):
        old=self.get(mid)
        if old['state']['status']=='cancelled':return old
        # A finished mission keeps its recorded outcome; only unfinished work is fenced.
        if old['state']['status'] in FINISHED:
            raise MissionFinished('Mission already finished; its outcome is retained')
        from .models import Event
        cancelled=Event(kind='mission_cancelled',round=old['state']['round'],detail=f'Cancelled by {actor} at {_iso(at)}; late results fenced.')
        state=MissionState.model_validate({**old['state'],'status':'cancelled','stop_reason':'Cancelled by operator; late results fenced.',
                                           'events':list(old['state']['events'])+[cancelled.model_dump(mode='json')]})
        return self.save(mid,state,expected_revision=old['revision'])

    def pause(self,mid,*,actor='operator',at=None):
        # The worker's next commit is refused by the revision fence; the route cancels its task.
        old=self.get(mid)
        if old['state']['status']!='running':raise ValueError('Only a running mission can be paused; this one is '+old['state']['status'])
        from .models import Event
        detail=f'Paused by {actor} at {_iso(at)}; resume explicitly.'
        paused=Event(kind='mission_paused',round=old['state']['round'],detail=detail)
        state=MissionState.model_validate({**old['state'],'status':'paused','stop_reason':detail,
                                           'events':list(old['state']['events'])+[paused.model_dump(mode='json')]})
        return self.save(mid,state,expected_revision=old['revision'])

    def pause_interrupted(self):
        paused=[]
        # Explicit resumption is safer than silently repeating paid calls after a restart.
        with self._connect() as db:
            ids=[x[0] for x in db.execute('SELECT id FROM missions').fetchall()]
        for mid in ids:
            row=self.get(mid)
            if row['state']['status']=='running':
                from .models import Event
                interrupted=Event(kind='mission_interrupted',round=row['state']['round'],detail='Service restarted; evidence retained. Resume explicitly.')
                state=MissionState.model_validate({**row['state'],'status':'paused','stop_reason':interrupted.detail,
                                                   'events':list(row['state']['events'])+[interrupted.model_dump(mode='json')]})
                self.save(mid,state,expected_revision=row['revision']);paused.append(mid)
        return paused

    def verify(self,mid):
        row=self.get(mid)
        if row['request_digest']!=digest(row['request']):return False
        with self._connect() as db:
            events=db.execute('SELECT revision,state_digest,previous,hash FROM mission_events WHERE mission=? ORDER BY revision',(mid,)).fetchall()
        parent='0'*64
        for expected,(rev,sd,prev,sha) in enumerate(events):
            if rev!=expected or prev!=parent or sha!=digest([mid,rev,sd,prev]):return False
            parent=sha
        return bool(events and events[-1][0]==row['revision'] and events[-1][1]==digest(row['state']))
