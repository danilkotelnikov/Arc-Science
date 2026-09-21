"""Grant ledger: an operator's approvals that a destination may receive a data category
for a purpose, and a receipt per attempted dispatch. Settings consent is eligibility only;
a grant is written by an operator route, never derived from connector text, memory or
model output. The ledger is operational, not scientific evidence.

One SQLite file beside missions.db, restricted to the operator like the data directory
(the WAL side files inherit the directory's entries). Append-only: every table carries
triggers that abort any rewrite or removal, so state (active / revoked / expired /
exhausted) is always derived from the rows and events, never stored. A receipt holds a
digest of the arguments, never the arguments, so no secret can enter the file."""
from __future__ import annotations
from contextlib import closing
from pathlib import Path
import re
import secrets
import sqlite3
import time

from . import anchored

SUBJECT_KINDS=('mission','request','persistent')
DESTINATION_KINDS=('seat','mcp','acp','public_read','biorender','prose','bioart','detector')
SCOPES=('once','mission','persistent')
SOURCES=('operator-ui','settings')
OUTCOMES=('ok','denied','failed')
STATES=('active','revoked','expired','exhausted')

_SCHEMA='''PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS grants(
  id TEXT PRIMARY KEY, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL, destination_kind TEXT NOT NULL, data_category TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL, route_digest TEXT NOT NULL DEFAULT '',
  settings_revision TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, granted_at INTEGER NOT NULL,
  expires_at INTEGER, max_uses INTEGER);
CREATE TABLE IF NOT EXISTS grant_events(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, grant_id TEXT NOT NULL, kind TEXT NOT NULL,
  at INTEGER NOT NULL, detail TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS receipts(
  id TEXT PRIMARY KEY, grant_id TEXT, mission_id TEXT, destination TEXT NOT NULL,
  destination_kind TEXT NOT NULL, data_category TEXT NOT NULL, at INTEGER NOT NULL,
  outcome TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', request_digest TEXT,
  observation_id TEXT, role TEXT);
CREATE INDEX IF NOT EXISTS grants_subject ON grants(subject_kind,subject_id);
CREATE INDEX IF NOT EXISTS grants_destination ON grants(destination,destination_kind);
CREATE INDEX IF NOT EXISTS grant_events_grant ON grant_events(grant_id,kind);
CREATE INDEX IF NOT EXISTS receipts_mission ON receipts(mission_id,at);
CREATE INDEX IF NOT EXISTS receipts_grant ON receipts(grant_id,at);
'''+''.join(f"CREATE TRIGGER IF NOT EXISTS {table}_no_{verb} BEFORE {verb.upper()} ON {table} "
            f"BEGIN SELECT RAISE(ABORT,'{table} is append-only'); END;\n"
            for table in ('grants','grant_events','receipts') for verb in ('update','delete'))
# One row per grant with its use count, last use and revocation folded in; state derives from it.
_GRANTS_SQL='''SELECT g.*,
  (SELECT COUNT(*) FROM grant_events e WHERE e.grant_id=g.id AND e.kind='reserved') AS uses,
  (SELECT MAX(at) FROM grant_events e WHERE e.grant_id=g.id AND e.kind='reserved') AS last_used_at,
  (SELECT MIN(at) FROM grant_events e WHERE e.grant_id=g.id AND e.kind='revoked') AS revoked_at
FROM grants g'''
_GRANT_COLUMNS=('id','subject_kind','subject_id','destination','destination_kind','data_category','purpose',
                'scope','route_digest','settings_revision','source','granted_at','expires_at','max_uses')
_RECEIPT_COLUMNS=('id','grant_id','mission_id','destination','destination_kind','data_category','at',
                  'outcome','reason','request_digest','observation_id','role')
_EVENT_COLUMNS=('seq','grant_id','kind','at','detail')
_DIGEST=re.compile(r'[0-9a-f]{64}')

def _one_of(value,allowed,name):
    if value not in allowed: raise ValueError(name+' must be one of '+', '.join(allowed))
    return value

def _text(value,name,*,required=True,limit=500):
    if not isinstance(value,str) or (required and not value.strip()): raise ValueError(name+' must be a non-empty string')
    return value[:limit]

def _state(row,now):
    if row['revoked_at'] is not None: return 'revoked'
    if row['expires_at'] is not None and row['expires_at']<=now: return 'expired'
    if row['max_uses'] is not None and row['uses']>=row['max_uses']: return 'exhausted'
    return 'active'

def _grant(row,now):
    grant=dict(row);grant['state']=_state(row,now);return grant

class GrantLedger:
    def __init__(self,path):
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with closing(sqlite3.connect(self.path,timeout=15)) as db: db.executescript(_SCHEMA)
        anchored.owner_only(self.path)  # raises PermissionError rather than serving an open ledger

    def _db(self):
        db=sqlite3.connect(self.path,timeout=15,isolation_level=None);db.row_factory=sqlite3.Row
        return closing(db)

    def create(self,*,subject_kind,destination,destination_kind,data_category,scope,purpose='',subject_id='',
               route_digest='',settings_revision='',source='operator-ui',expires_at=None,max_uses=None):
        _one_of(subject_kind,SUBJECT_KINDS,'subject_kind');_one_of(destination_kind,DESTINATION_KINDS,'destination_kind')
        _one_of(scope,SCOPES,'scope');_one_of(source,SOURCES,'source')
        if (subject_kind=='persistent')!=(subject_id==''): raise ValueError('subject_id is empty exactly for a persistent grant')
        if scope=='once': max_uses=1
        if max_uses is not None and (not isinstance(max_uses,int) or max_uses<1): raise ValueError('max_uses must be a positive integer')
        if expires_at is not None and not isinstance(expires_at,int): raise ValueError('expires_at must be epoch seconds')
        now=int(time.time())
        row=dict(id=secrets.token_hex(16),subject_kind=subject_kind,subject_id=_text(subject_id,'subject_id',required=False),
                 destination=_text(destination,'destination'),destination_kind=destination_kind,
                 data_category=_text(data_category,'data_category'),purpose=_text(purpose,'purpose',required=False),scope=scope,
                 route_digest=_text(route_digest,'route_digest',required=False),
                 settings_revision=_text(settings_revision,'settings_revision',required=False),source=source,
                 granted_at=now,expires_at=expires_at,max_uses=max_uses)
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('INSERT INTO grants('+','.join(_GRANT_COLUMNS)+') VALUES ('+','.join(':'+c for c in _GRANT_COLUMNS)+')',row)
            db.execute('INSERT INTO grant_events(grant_id,kind,at,detail) VALUES (?,?,?,?)',(row['id'],'created',now,source))
            db.commit()
            return _grant(db.execute(_GRANTS_SQL+' WHERE g.id=?',(row['id'],)).fetchone(),now)

    def get(self,grant_id):
        with self._db() as db:
            row=db.execute(_GRANTS_SQL+' WHERE g.id=?',(grant_id,)).fetchone()
        return _grant(row,int(time.time())) if row else None

    def revoke(self,grant_id,reason=''):
        """The revocation event; a second revoke returns the first one unchanged."""
        reason=_text(reason,'reason',required=False)
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM grants WHERE id=?',(grant_id,)).fetchone(): db.commit();raise KeyError(grant_id)
            prior=db.execute('SELECT '+','.join(_EVENT_COLUMNS)+' FROM grant_events WHERE grant_id=? AND kind=? ORDER BY seq LIMIT 1',
                             (grant_id,'revoked')).fetchone()
            if prior: db.commit();return dict(prior)
            at=int(time.time())
            seq=db.execute('INSERT INTO grant_events(grant_id,kind,at,detail) VALUES (?,?,?,?)',(grant_id,'revoked',at,reason)).lastrowid
            db.commit()
        return {'seq':seq,'grant_id':grant_id,'kind':'revoked','at':at,'detail':reason}

    def _reserve(self,db,grant_id,now):
        # Inside the caller's BEGIN IMMEDIATE, so the state read and the use written are one step.
        row=db.execute(_GRANTS_SQL+' WHERE g.id=?',(grant_id,)).fetchone()
        if row is None or _state(row,now)!='active': return False
        db.execute('INSERT INTO grant_events(grant_id,kind,at,detail) VALUES (?,?,?,?)',(grant_id,'reserved',now,''));return True

    def reserve(self,grant_id):
        """Consume one use; False when the grant is unknown, revoked, expired or exhausted."""
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE');ok=self._reserve(db,grant_id,int(time.time()));db.commit()
        return ok

    def authorize(self,subject_kind,subject_id,destination,destination_kind):
        """The most specific active grant for this destination — the subject's own before a
        persistent one — reserved in the same transaction; otherwise why not."""
        now=int(time.time())
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            rows=db.execute(_GRANTS_SQL+''' WHERE g.destination=? AND g.destination_kind=?
                AND ((g.subject_kind=? AND g.subject_id=?) OR g.subject_kind='persistent')
                ORDER BY g.subject_kind='persistent', g.granted_at DESC, g.rowid DESC''',
                (destination,destination_kind,subject_kind,subject_id)).fetchall()
            for row in rows:
                if _state(row,now)=='active' and self._reserve(db,row['id'],now):
                    db.commit();return {'allowed':True,'grant_id':row['id'],'reason':'Grant '+row['id'][:12]+' ('+row['scope']+')'}
            db.commit()
        if not rows: return {'allowed':False,'grant_id':None,'reason':'No grant for '+destination+' ('+destination_kind+')'}
        return {'allowed':False,'grant_id':rows[0]['id'],'reason':'Grant '+rows[0]['id'][:12]+' for '+destination+' is '+_state(rows[0],now)}

    def receipt(self,*,destination,destination_kind,data_category,outcome,reason='',grant_id=None,mission_id=None,
                request_digest=None,observation_id=None,role=None):
        _one_of(destination_kind,DESTINATION_KINDS,'destination_kind');_one_of(outcome,OUTCOMES,'outcome')
        if request_digest is not None and not _DIGEST.fullmatch(request_digest):
            raise ValueError('request_digest must be a sha256 hex digest of the arguments, never the arguments')
        row=dict(id=secrets.token_hex(16),grant_id=grant_id,mission_id=mission_id,destination=_text(destination,'destination'),
                 destination_kind=destination_kind,data_category=_text(data_category,'data_category'),at=int(time.time()),
                 outcome=outcome,reason=_text(reason,'reason',required=False),request_digest=request_digest,
                 observation_id=observation_id,role=role)
        with self._db() as db:
            db.execute('INSERT INTO receipts('+','.join(_RECEIPT_COLUMNS)+') VALUES ('+','.join(':'+c for c in _RECEIPT_COLUMNS)+')',row)
        return row

    def list(self,subject_kind=None,subject_id=None):
        where,args=[],[]
        if subject_kind is not None: where.append('g.subject_kind=?');args.append(subject_kind)
        if subject_id is not None: where.append('g.subject_id=?');args.append(subject_id)
        sql=_GRANTS_SQL+(' WHERE '+' AND '.join(where) if where else '')+' ORDER BY g.granted_at DESC, g.rowid DESC'
        now=int(time.time())
        with self._db() as db: return [_grant(row,now) for row in db.execute(sql,args)]

    def receipts(self,mission_id=None,grant_id=None,limit=200):
        where,args=[],[]
        if mission_id is not None: where.append('mission_id=?');args.append(mission_id)
        if grant_id is not None: where.append('grant_id=?');args.append(grant_id)
        sql=('SELECT '+','.join(_RECEIPT_COLUMNS)+' FROM receipts'+(' WHERE '+' AND '.join(where) if where else '')
             +' ORDER BY at DESC, rowid DESC LIMIT ?')
        with self._db() as db: return [dict(row) for row in db.execute(sql,args+[max(1,min(int(limit),1000))])]
