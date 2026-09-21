"""Diagnostics: on-demand local reads of the mission store, the molecular job records,
the renderer configuration, the running package and the probe records, and a redacted
plain-text report of the same facts beside /health and the readiness summary. Nothing
here calls a model, starts a connector or a worker, or renders. Every section names
its source; the page shows these readings and never recomputes them.
"""
from __future__ import annotations
import asyncio
from contextlib import closing
import json
import os
from pathlib import Path
import platform
import re
import sqlite3
import sys
import time
from fastapi import APIRouter, Depends, Response
from . import __version__
from .exploration.cli_seats import redact

HOST_SESSION_ENV='ARC_HOST_SESSION'
REPORT_FORMAT='arc-diagnostics-report/1'
REDACTION='bearer values, secret pairs, opaque tokens, the operator token and native session secret, and the user home path (~)'
NOTE='Local reads only: no model call, no connector start, no render. Each section names its source.'
STORES=('missions.db','grants.db','timeline.db')
MISSION_LIMIT=200
BROKEN_LIMIT=20
FAILED_STATUSES=('failed','interrupted')
# The same words readiness uses for the renderer (readiness._renderer).
RENDERER_NEXT='Set ARC_MOLECULAR_BLENDER_PYTHON on the server, then restart the service'


def host_session():
    """Who started this service, from the environment the desktop gives its own child;
    read at request time. 'standalone' means no marker: started by hand, by a script,
    by the test client or by an older desktop build. 'reused' is never observable here."""
    return {'mode':'owned' if os.environ.get(HOST_SESSION_ENV)=='owned' else 'standalone','source':HOST_SESSION_ENV}


def sqlite_integrity(path):
    """'ok', 'missing', the first line PRAGMA integrity_check returned, or 'unreadable: <error>'."""
    path=Path(path)
    if not path.is_file():return 'missing'
    try:
        with closing(sqlite3.connect(path,timeout=15)) as db:
            rows=db.execute('PRAGMA integrity_check').fetchall()
    except (sqlite3.Error,OSError) as error:
        return 'unreadable: '+str(error)[:200]
    if rows==[('ok',)]:return 'ok'
    return str(rows[0][0])[:200] if rows and rows[0] else 'unreadable: no result'


def _section(source,state,code,meaning,next_action,**facts):
    return {'source':source,'checked_at':int(time.time()),'state':state,'code':code,'meaning':meaning,'next_action':next_action,**facts}


def _storage(root,repository,memory_routes):
    sqlite={name:sqlite_integrity(root/name) for name in STORES}
    ids=[];total=0;verified=0;broken=[]
    try:
        ids=[r['id'] for r in repository.list(limit=MISSION_LIMIT)];total=repository.count()
        for mid in ids:
            # A row that cannot be read or verified is unverified and named; the loop goes on.
            try:ok=repository.verify(mid)
            except (sqlite3.Error,OSError,ValueError,KeyError):ok=False
            if ok:verified+=1
            elif len(broken)<BROKEN_LIMIT:broken.append(mid)
    except (sqlite3.Error,OSError,ValueError,KeyError):
        # The store itself is unreadable; the sqlite line above says so.
        pass
    checked=len(ids);capture=memory_routes.capture_status()
    sqlite_word='ok' if all(v=='ok' for v in sqlite.values()) else '; '.join(n+' '+v for n,v in sqlite.items() if v!='ok')
    meaning=f'{verified} of {checked} missions verified · sqlite {sqlite_word} (missions, grants, timeline) · memory capture {capture.get("status")}'
    if checked<total:meaning+=f' · newest {MISSION_LIMIT} of {total} checked'
    if any(v=='missing' for v in sqlite.values()):
        state,code,next_action='blocked','storage.missing','Restore the data directory; a restart creates an empty store in place of a missing file'
    elif any(v!='ok' for v in sqlite.values()):
        state,code,next_action='failed','storage.corrupt','Keep the data directory for inspection; do not export from it'
    elif checked>verified:
        state,code,next_action='failed','storage.chain_broken','Do not export the listed missions; keep the data directory for inspection'
    else:state,code,next_action='ready','storage.verified',None
    return _section('missions.db, grants.db and timeline.db in the data directory; memory capture status from the service',state,code,meaning,next_action,
                    missions={'total':total,'checked':checked,'verified':verified,'broken':broken,'limit':MISSION_LIMIT},sqlite=sqlite,memory_capture=capture)


def _records(molecular_jobs):
    return sorted(molecular_jobs.jobs.values(),key=lambda row:row['created_at'],reverse=True)


def _jobs(molecular_jobs):
    rows=_records(molecular_jobs);failed=[]
    for row in rows:
        if row['status'] not in FAILED_STATUSES:continue
        has_input=(molecular_jobs.root/row['id']/'input'/row['filename']).is_file()
        retryable=row.get('settings') is not None and has_input
        note=None if retryable else ('Recorded before settings tracking; render it again from Molecules' if row.get('settings') is None
                                     else 'The uploaded coordinates are no longer available')
        failed.append({'id':row['id'],'status':row['status'],'filename':row['filename'],'error':row.get('error'),
                       'updated_at':row['updated_at'],'retryable':retryable,'retry_note':note})
    if not rows:state,code,meaning,next_action='not_tested','jobs.none','No molecular render has been recorded',None
    elif not failed:state,code,meaning,next_action='ready','jobs.clean',f'{len(rows)} molecular renders recorded; none failed or was interrupted',None
    else:state,code,meaning,next_action='failed','jobs.failed',f'{len(failed)} of {len(rows)} molecular renders failed or was interrupted','Retry a render below, or render again from Molecules'
    return _section('molecular job records (molecular/<id>/job.json) held by the service',state,code,meaning,next_action,total=len(rows),failed=failed)


def _executable(env,resolved):
    value=os.environ.get(env)
    if not value:return {'configured':False,'exists':None,'executable':None}
    return {'configured':True,'exists':resolved is not None,'executable':os.path.basename(resolved or value)}


def _renderer(molecular_jobs):
    blender=_executable('ARC_MOLECULAR_BLENDER_PYTHON',molecular_jobs.runtime)
    svg=_executable('ARC_SVG2PNG',molecular_jobs.svg2png)
    probe=molecular_jobs.probe_result
    runtime_probe={'checked':probe is not None,'ok':probe[0] if probe else None,'reason':probe[1] if probe else None}
    rows=_records(molecular_jobs)
    last={'id':rows[0]['id'],'status':rows[0]['status'],'updated_at':rows[0]['updated_at'],'error':rows[0].get('error')} if rows else None
    if not (blender['configured'] and blender['exists']):
        state,code,next_action='blocked','renderer.not_configured',RENDERER_NEXT
        meaning='The configured Blender Python does not exist' if blender['configured'] else 'No Blender Python is configured'
    elif probe is not None and not probe[0]:state,code,meaning,next_action='failed','renderer.probe_failed',probe[1],'Fix the runtime the reason names, restart the service, then submit a render'
    elif probe is not None:state,code,meaning,next_action='ready','renderer.probe_passed',probe[1],None
    else:state,code,meaning,next_action='not_tested','renderer.configured','Blender Python is configured; it is checked when a render is submitted','Submit a render in Molecules to check it'
    return _section('ARC_MOLECULAR_BLENDER_PYTHON and ARC_SVG2PNG in the service environment; the runtime probe if one already ran; the newest molecular job record',
                    state,code,meaning,next_action,blender_python=blender,svg_rasterizer=svg,runtime_probe=runtime_probe,last_render=last)


def _package(root,settings_revision,version,started_at):
    supervisor=os.environ.get('ARC_SUPERVISOR') or None
    return _section('the running service process and its environment','not_tested','package.facts',
                    'Facts about the running service; nothing here is verified against the files on disk',None,
                    version=version,python={'version':platform.python_version(),'executable':sys.executable},
                    supervisor={'configured':bool(supervisor) and Path(supervisor).is_file(),'path':supervisor,'source':'ARC_SUPERVISOR'},
                    settings={'revision':settings_revision()},data_dir=str(root),started_at=started_at)


def _last_record(root,probes,name):
    if probes.get(name):return probes[name]
    try:
        lines=(root/'providers'/(name+'-probes.jsonl')).read_bytes().strip().splitlines()
        return json.loads(lines[-1]) if lines else None
    except (OSError,ValueError):return None


def _probes(root,probes):
    records=[]
    for name in probes:
        record=_last_record(root,probes,name)
        if not isinstance(record,dict):continue
        results=record.get('results') or []
        records.append({'name':name,'provider':record.get('provider'),'at':record.get('at'),'transport':record.get('transport'),
                        'results':len(results),'ok':sum(1 for r in results if isinstance(r,dict) and r.get('ok'))})
    if records:meaning,code=f'{len(records)} probe records; readiness matches them to seats by subject digest','probes.recorded'
    else:meaning,code='No probe has been recorded; readiness matches probe records to seats by subject digest','probes.none'
    return _section('the last probe record per transport: memory, then providers/<name>-probes.jsonl','not_tested',code,meaning,
                    None if records else 'Probe a seat in Settings',records=records)


def build_diagnostics(*,root,repository,molecular_jobs,memory_routes,probes,settings_revision,version,started_at):
    """The whole reading, bounded: the newest 200 missions' chains, three integrity checks,
    at most 100 job records. No cache; the page's button is the retry."""
    root=Path(root)
    return {'checked_at':int(time.time()),'note':NOTE,
            'storage':_storage(root,repository,memory_routes),'jobs':_jobs(molecular_jobs),'renderer':_renderer(molecular_jobs),
            'package':_package(root,settings_revision,version,started_at),'probes':_probes(root,probes)}


def readiness_summary(doc):
    """States and codes only, from a readiness document: enough to read the report,
    without the facts (executables, endpoints, paths) the full document carries."""
    def node(value):
        value=value if isinstance(value,dict) else {}
        return {'state':value.get('state'),'code':value.get('code')}
    settings=doc.get('settings') if isinstance(doc.get('settings'),dict) else {}
    revision=settings.get('revision')
    seats={role:{**node(seat),'verification':((seat.get('verification') or {}).get('status') if isinstance(seat,dict) else None)}
           for role,seat in (doc.get('seats') or {}).items()}
    return {'checked_at':doc.get('checked_at'),'session':{**node(doc.get('session')),'kind':(doc.get('session') or {}).get('kind')},
            'settings':{**node(settings),'revision':str(revision)[:12] if revision else None},'seats':seats,
            **{name:node(doc.get(name)) for name in ('live_mission','connectors','renderer','memory','storage')}}


def _home_pattern(home):
    parts=[re.escape(part) for part in re.split(r'[\\/]+',str(home).rstrip('\\/'))]
    return re.compile(r'(?:\\\\\?\\)?'+r'[\\/]+'.join(parts)+r'(?![A-Za-z0-9_.-])',re.IGNORECASE)


def redact_report(value,*,secrets=(),home=None):
    """Every string in a dict/list tree rewritten (keys untouched): exact secrets, then the
    user home prefix (~), then the transport's redaction of bearer values, secret pairs
    and opaque tokens — the same three rules the desktop applies to its startup log."""
    secrets=tuple(s for s in secrets if s)
    pattern=_home_pattern(home or Path.home())
    def text(s):
        for secret in secrets:s=s.replace(secret,'[redacted]')
        return redact(pattern.sub('~',s))
    def walk(v):
        if isinstance(v,dict):return {k:walk(x) for k,x in v.items()}
        if isinstance(v,(list,tuple)):return [walk(x) for x in v]
        return text(v) if isinstance(v,str) else v
    return walk(value)


def render_report(report):
    return json.dumps(report,indent=2,sort_keys=True,ensure_ascii=False)


def create_router(*,authorized,root,repository,molecular_jobs,memory_routes,probes,settings_revision,health,readiness,secrets,
                  version=__version__,started_at=None):
    """GET /api/diagnostics (the reading) and GET /api/diagnostics/report (the redacted
    text: /health, the readiness summary and the reading). `health()` returns the /health
    document; `readiness(principal, fresh=False)` is the readiness handler."""
    router=APIRouter();started_at=int(time.time()) if started_at is None else started_at
    def reading():
        return build_diagnostics(root=root,repository=repository,molecular_jobs=molecular_jobs,memory_routes=memory_routes,probes=probes,
                                 settings_revision=settings_revision,version=version,started_at=started_at)

    @router.get('/api/diagnostics',dependencies=[Depends(authorized)])
    async def diagnostics():
        return await asyncio.to_thread(reading)

    @router.get('/api/diagnostics/report')
    async def report(principal:str=Depends(authorized)):
        documents={'health':health(),'readiness':readiness_summary(await readiness(principal,fresh=False)),
                   'diagnostics':await asyncio.to_thread(reading)}
        report={'format':REPORT_FORMAT,'generated_at':int(time.time()),'redaction':REDACTION,**redact_report(documents,secrets=secrets)}
        return Response(render_report(report),media_type='text/plain; charset=utf-8')
    return router
