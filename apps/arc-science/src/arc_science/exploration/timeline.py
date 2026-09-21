"""Mission timeline: when each operation of a mission started and, when the worker
learned it, how it ended. An operational record, never scientific evidence: it lives in
its own append-only SQLite file beside missions.db, so the mission hash chain is never
touched and a missing or damaged timeline cannot invalidate a mission.

Two rows per operation, never an update: a `started` row and a `finished` row. A crash,
a pause or a cancellation leaves no finished row; the read side then derives
`outcome_unknown` and labels it as derived. Nothing here rewrites a persisted row."""
from __future__ import annotations
from contextlib import closing
import contextvars
from pathlib import Path
import secrets
import sqlite3
import time

from .. import anchored

OPERATIONS=('plan','tool','reconcile','visual_review','stop','start','resume','pause','cancel','interrupt')
# 'analyst' is the engine's name for the Reviewer (QA) seat.
ROLES=('planner','analyst','falsifier','vision','tool','engine','operator','service')
# Who wrote the row: the mission worker (engine hooks + guard), an operator route, the service lifespan.
SOURCES=('worker','operator','service')
OUTCOMES=('ok','error','denied','reused','completed','budget_exhausted','needs_input','scheduled','resumed',
          'paused','cancelled','interrupted')
# Derived at read only for an operation without a finished row; never stored.
OUTCOME_UNKNOWN='outcome_unknown'
TRANSPORTS=('fixture','api','cli')
# The operation in flight in the current task; the worker's log callback sets it after
# each started row so the grant guard can attach its receipt to the operation.
CURRENT_OP=contextvars.ContextVar('arc_timeline_op',default=None)

_SCHEMA='''PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS timeline(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  mission TEXT NOT NULL, op TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('started','finished')),
  at INTEGER NOT NULL,
  operation TEXT, role TEXT, source TEXT,
  round INTEGER, transport TEXT, model_requested TEXT,
  model_observed TEXT, identity_verified INTEGER,
  tool TEXT, action_id TEXT, branch_id TEXT, actor TEXT,
  receipt_id TEXT, outcome TEXT,
  detail TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS timeline_mission ON timeline(mission,seq);
CREATE UNIQUE INDEX IF NOT EXISTS timeline_op_phase ON timeline(op,phase);
CREATE TRIGGER IF NOT EXISTS timeline_no_update BEFORE UPDATE ON timeline BEGIN SELECT RAISE(ABORT,'timeline is append-only'); END;
CREATE TRIGGER IF NOT EXISTS timeline_no_delete BEFORE DELETE ON timeline BEGIN SELECT RAISE(ABORT,'timeline is append-only'); END;
'''
_STARTED=('operation','role','source','round','transport','model_requested','tool','action_id','branch_id','actor')
_FINISHED=('model_observed','identity_verified','receipt_id','outcome')

def _one_of(value,allowed,name):
    if value not in allowed: raise ValueError(name+' must be one of '+', '.join(allowed))
    return value

def _now():return int(time.time()*1000)

def _flag(value):
    return None if value is None else (1 if value else 0)

class MissionTimeline:
    def __init__(self,path):
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with closing(sqlite3.connect(self.path,timeout=15)) as db: db.executescript(_SCHEMA)
        anchored.owner_only(self.path)

    def _db(self):
        db=sqlite3.connect(self.path,timeout=15,isolation_level=None);db.row_factory=sqlite3.Row
        return closing(db)

    def _insert(self,db,row):
        columns=('mission','op','phase','at',*_STARTED,*_FINISHED,'detail')
        db.execute('INSERT INTO timeline('+','.join(columns)+') VALUES ('+','.join(':'+c for c in columns)+')',
                   {c:row.get(c) for c in columns})

    def start(self,mission_id,*,operation,role,source='worker',round=None,transport=None,model_requested=None,
              tool=None,action_id=None,branch_id=None,actor=None,detail=''):
        """The started row of one operation; returns its opaque id for finish()."""
        _one_of(operation,OPERATIONS,'operation');_one_of(role,ROLES,'role');_one_of(source,SOURCES,'source')
        if transport is not None: _one_of(transport,TRANSPORTS,'transport')
        op=secrets.token_hex(16)
        row=dict(mission=mission_id,op=op,phase='started',at=_now(),operation=operation,role=role,source=source,round=round,
                 transport=transport,model_requested=model_requested,tool=tool,action_id=action_id,branch_id=branch_id,
                 actor=actor,detail=(detail or '')[:500])
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE');self._insert(db,row);db.commit()
        return op

    def finish(self,mission_id,op,*,outcome,model_observed=None,identity_verified=None,receipt_id=None,detail=''):
        """The finished row of an operation the worker learned the outcome of."""
        _one_of(outcome,OUTCOMES,'outcome')
        row=dict(mission=mission_id,op=op,phase='finished',at=_now(),model_observed=model_observed,
                 identity_verified=_flag(identity_verified),receipt_id=receipt_id,outcome=outcome,detail=(detail or '')[:500])
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute("SELECT 1 FROM timeline WHERE mission=? AND op=? AND phase='started'",(mission_id,op)).fetchone():
                db.commit();raise KeyError('No started row for this operation')
            try:self._insert(db,row)
            except sqlite3.IntegrityError:db.rollback();raise ValueError('already finished') from None
            db.commit()

    def record(self,mission_id,*,outcome,detail='',**start_fields):
        """start() then finish() for an instantaneous operation (operator and service rows)."""
        op=self.start(mission_id,detail=detail,**start_fields)
        self.finish(mission_id,op,outcome=outcome)
        return op

    def rows(self,mission_id):
        """One merged dict per operation, in the order the operations started."""
        with self._db() as db:
            raw=[dict(r) for r in db.execute('SELECT * FROM timeline WHERE mission=? ORDER BY seq',(mission_id,))]
        merged={}
        for r in raw:
            if r['phase']=='started':
                merged[r['op']]={'id':r['op'],'sequence':r['seq'],'started_at':r['at'],'finished_at':None,
                                 **{c:r[c] for c in _STARTED},'model_observed':None,'identity_verified':None,
                                 'receipt_id':None,'outcome':OUTCOME_UNKNOWN,'outcome_source':'derived','detail':r['detail']}
            elif r['op'] in merged:
                row=merged[r['op']]
                row.update(finished_at=r['at'],model_observed=r['model_observed'],
                           identity_verified=None if r['identity_verified'] is None else bool(r['identity_verified']),
                           receipt_id=r['receipt_id'],outcome=r['outcome'],outcome_source='recorded')
                if r['detail']:row['detail']=r['detail']
        return list(merged.values())
