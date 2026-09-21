"""Readiness: one passive reading of what the service can do now, per seat, connector,
renderer, memory store and mission store. The server is the only authority; the UI
shows these states and never recomputes them. Nothing here spends tokens, starts a
connector or runs Blender: cached facts and files only.
"""
from __future__ import annotations
import asyncio
import json
import os
import subprocess
import time
from urllib.parse import urlsplit
from fastapi import APIRouter, Depends
from .contracts import digest
from .exploration.effort import DEFAULT, accepted_efforts, load_catalog, model_entry
from . import settings as operator_settings

STATES=('ready','not_tested','failed','blocked','unknown')
ROLES=[{'role':'planner','label':'Planner','purpose':'proposes branches and actions'},
       {'role':'reviewer','label':'Reviewer (QA)','purpose':'assesses'},
       {'role':'falsifier','label':'Falsifier','purpose':'assesses with the brief to refute'},
       {'role':'vision','label':'Vision','purpose':'reviews images'},
       {'role':'prose','label':'Prose','purpose':'edits text'}]
LABELS={r['role']:r['label'] for r in ROLES}
# A seat without a provider follows another, in this order (endpoints_from_settings).
INHERITS={'reviewer':('planner',),'falsifier':('reviewer','planner')}
UNCONFIGURED={'planner':'No planner seat is set; a live mission cannot start',
              'vision':'Visual review is unavailable until a vision seat is set',
              'prose':'Prose edits through a model are unavailable; the local rewrite still works'}
STORAGE_NEXT='Integrity is checked on demand in Diagnostics (not in this build).'
# The same refusals service.configured_vision_endpoint raises.
VISION_REFUSED={'cli':'Visual review is not available through a CLI login; give the vision seat an API credential',
                'openclaw':'Visual review requires an OpenAI, Anthropic or Gemini native image endpoint'}


def subject(provider,transport,model,effort,*,executable_sha256=None,endpoint=None,credential_ref=None):
    """What a probe verifies, the same six keys on the probe side and here, so one digest
    names one configuration: the executable for a CLI seat, the endpoint origin for an
    API seat. A CLI seat has no credential, so its ref is None and roles share a digest."""
    if transport=='cli':return {'provider':provider,'transport':transport,'model':model,'effort':effort,'executable_sha256':executable_sha256,'credential_ref':None}
    return {'provider':provider,'transport':transport,'model':model,'effort':effort,'endpoint':endpoint,'credential_ref':credential_ref}


def subject_digest(subject):return digest(subject)


def _origin(url):
    parts=urlsplit(url or '')
    return parts.scheme+'://'+parts.netloc if parts.scheme and parts.netloc else (url or None)


def _seat(role,settings,*,credential_stored,cli_transport_reader,probes_reader,catalog,source):
    seat=((settings or {}).get('seats') or {}).get(role) or {}
    provider=seat.get('provider') or '';model=seat.get('model') or '';effort=seat.get('effort') or DEFAULT;auth=seat.get('auth') or 'api_key'
    facts={'provider':provider,'model':model,'effort':effort,'auth':auth,'transport':None,'credential_ref':None,'credential_stored':None,
           'executable':None,'executable_detected':None,'cli_logged_in':None,'cli_auth_method':None,'in_catalog':None,
           'catalog_version':catalog.get('catalog_version'),'inherits_from':None,'effort_accepted':None,'endpoint':None}
    verification={'status':'not_applicable','checked_at':None,'subject_digest':None,'observed_model':None,'identity_verified':None,'error':None}
    def node(state,code,meaning,next_action=None):
        return {'role':role,'label':LABELS[role],'state':state,'code':code,'facts':facts,'verification':verification,
                'meaning':meaning,'next_action':next_action,'source':source}
    if not provider:
        parent=next((p for p in INHERITS.get(role,()) if operator_settings.seat(settings,p)),None)
        if parent:
            facts['inherits_from']=parent
            return node('not_tested','seat.inherits',f'No model of its own; it uses the {parent} seat',
                        'Leave it shared, or set a provider and model here for a separate seat')
        return node('blocked','seat.unconfigured',UNCONFIGURED.get(role,'No model is set for this seat'),
                    'Set the provider and model for this seat in Settings')
    transport='cli' if auth=='cli' else 'api';facts['transport']=transport
    if role=='vision' and (transport=='cli' or provider=='openclaw'):
        # Mirrors service.configured_vision_endpoint: a CLI probe of the same model would
        # otherwise read as verified although visual review refuses this seat.
        return node('blocked','seat.transport_not_accepted',VISION_REFUSED['cli' if transport=='cli' else 'openclaw'],
                    'Give the vision seat an API credential from OpenAI, Anthropic or Gemini')
    if not model:
        return node('blocked','seat.model_missing',f'The {provider} seat names no model','Set the model for this seat in Settings')
    entry=model_entry(provider,model);facts['in_catalog']=entry is not None
    executable_sha256=None;endpoint=None;ref=None
    if transport=='api':
        ref=seat.get('credential') or role;facts['credential_ref']=ref
        stored=bool(credential_stored(ref));facts['credential_stored']=stored
        endpoint=_origin(((settings.get('providers') or {}).get(provider) or {}).get('endpoint') or (catalog['providers'].get(provider) or {}).get('official_origin'))
        facts['endpoint']=endpoint
        if not stored:
            return node('blocked','seat.credential_missing',f'No credential is stored under the name {ref}',
                        f'Store it with arc-science credential --name {ref}')
    else:
        info=cli_transport_reader(provider)
        if not info:
            return node('blocked','seat.cli_missing',f'The {provider} CLI is not configured or its executable was not found',
                        f'Set providers.{provider}.cli to the executable in Settings')
        facts.update(executable=info.get('executable'),executable_detected=True,cli_logged_in=bool(info.get('logged_in')),cli_auth_method=info.get('auth_method'))
        executable_sha256=info.get('executable_sha256')
        if not info.get('logged_in'):
            return node('blocked','seat.cli_not_signed_in',f'The {provider} CLI reports no login','Sign in inside the CLI, then reload this page')
    accepted=accepted_efforts(provider,transport,model)
    ok=effort in accepted if accepted else effort==DEFAULT;facts['effort_accepted']=ok
    if not ok:
        return node('blocked','seat.effort_not_accepted',f'Effort {effort} is not accepted for {model} over the {provider} {transport} transport',
                    'Choose one of '+', '.join(accepted) if accepted else f'Leave the effort at {DEFAULT}; the provider default applies')
    if transport=='api':
        # No probe route covers API seats in this build; the first live call verifies them.
        # The subject digest is what such a probe will have to match.
        verification['status']='not_tested'
        verification['subject_digest']=subject_digest(subject(provider,transport,model,effort,endpoint=endpoint,credential_ref=ref))
        if entry is None:
            return node('not_tested','seat.custom_model',f'{model} is not in the catalogue ({catalog.get("catalog_version")}); it is sent as typed',
                        'No probe covers API seats in this build; the first live call verifies the model')
        return node('not_tested','seat.not_tested','Configured; never verified','No probe covers API seats in this build; the first live call verifies the seat')
    current=subject_digest(subject(provider,transport,model,effort,executable_sha256=executable_sha256))
    verification['subject_digest']=current
    record=probes_reader(provider) or {};results=record.get('results') or []
    match=next((r for r in results if r.get('subject_digest')==current),None)
    if match:
        verification.update(status='ok' if match.get('ok') else 'failed',checked_at=record.get('at'),observed_model=match.get('observed_model'),
                            identity_verified=match.get('identity_verified'),error=match.get('error'))
        if match.get('ok'):
            return node('ready','seat.verified',f'The probe passed for {model} at effort {effort} through this executable')
        return node('failed','seat.probe_failed','The last probe failed: '+str(match.get('error') or 'no detail')[:200],'Fix the cause, then run the probe again in Diagnostics')
    if entry is None:
        verification['status']='not_tested'
        return node('not_tested','seat.custom_model',f'{model} is not in the catalogue ({catalog.get("catalog_version")}); it is sent as typed',
                    'Run the probe in Diagnostics to verify it answers (spends tokens)')
    if any(r.get('model')==model for r in results):
        verification.update(status='stale',checked_at=record.get('at'))
        return node('not_tested','seat.probe_stale','The last probe was for an earlier configuration of this model (effort or executable changed)',
                    'Run the probe again in Diagnostics (spends tokens)')
    verification['status']='not_tested'
    return node('not_tested','seat.not_tested','Configured; never probed','Run the probe in Diagnostics to verify it answers (spends tokens)')


def _live(seats,settings):
    needed=['planner']+[r for r in ('reviewer','falsifier') if operator_settings.seat(settings,r)]
    blocking=[r for r in needed if seats[r]['state'] in ('blocked','failed')]
    if any(seats[r]['state']=='blocked' for r in needed):
        return {'state':'blocked','code':'live.blocked','blocking':blocking,'meaning':'A live mission cannot start: '+', '.join(f'{r} is {seats[r]["state"]}' for r in blocking),
                'next_action':'Resolve each blocking seat above'}
    if blocking:
        return {'state':'failed','code':'live.failed','blocking':blocking,'meaning':'The last probe failed for: '+', '.join(blocking),
                'next_action':'Fix the failed seats, then probe again'}
    if all(seats[r]['state']=='ready' for r in needed):
        return {'state':'ready','code':'live.verified','blocking':[],'meaning':'Every seat a live mission needs passed its probe','next_action':None}
    return {'state':'not_tested','code':'live.not_tested','blocking':[],'meaning':'The seats are configured; not every one is verified',
            'next_action':'Probe the CLI seats in Diagnostics; API seats are verified by their first live call'}


def _connector(entry,kind):
    enabled=entry.get('enabled',True);consented=bool(entry.get('consent'))
    base={'name':entry.get('name'),'enabled':enabled,'consented':consented}
    if kind=='mcp':base['transport']=entry.get('transport')
    if not enabled:
        return {**base,'state':'blocked','code':'connector.disabled','meaning':'Disabled in Settings; a mission cannot reach it','next_action':'Enable it in Settings'}
    if not consented:
        return {**base,'state':'blocked','code':'connector.not_consented','meaning':'Enabled without consent to send mission data',
                'next_action':'Give consent in Settings to let a live mission reach it'}
    check='list its tools' if kind=='mcp' else 'exchange initialize with it'
    return {**base,'state':'not_tested','code':'connector.eligible','meaning':'Enabled with consent; a live mission binds it at start',
            'next_action':f'Run the connection check in Diagnostics to {check}'}


def _connectors_summary(rows):
    """One state for the connectors card, computed here so the page shows nothing it
    derived itself: eligible connectors are untested until their check runs."""
    eligible=[r for r in rows if r['code']=='connector.eligible']
    if not rows:
        return {'state':'not_tested','code':'connectors.none','meaning':'No MCP server or ACP agent is configured; missions use only the built-in tools',
                'next_action':'Add a connector in Settings to let missions consult it'}
    if not eligible:
        return {'state':'blocked','code':'connectors.none_eligible','meaning':'No configured connector is enabled with consent',
                'next_action':'Enable a connector and give consent in Settings'}
    return {'state':'not_tested','code':'connectors.eligible','meaning':f'{len(eligible)} of {len(rows)} connectors can be bound by a live mission; none is checked here',
            'next_action':'Run the connection checks in Diagnostics'}


def _renderer(raw):
    facts={'configured':bool(raw.get('configured')),'exists':raw.get('exists'),'default_preset':raw.get('default_preset')}
    if facts['configured'] and facts['exists']:
        return {'state':'not_tested','code':'renderer.configured','facts':facts,'meaning':'Blender Python is configured; it is checked when a render is submitted',
                'next_action':'Submit a render in Molecules to check it','source':'environment'}
    meaning='The configured Blender Python does not exist' if facts['configured'] else 'No Blender Python is configured'
    return {'state':'blocked','code':'renderer.not_configured','facts':facts,'meaning':meaning,
            'next_action':'Set ARC_MOLECULAR_BLENDER_PYTHON on the server, then restart the service','source':'environment'}


def _memory(raw):
    capture=raw.get('capture') or {}
    if not raw.get('configured'):
        return {'state':'blocked','code':'memory.unavailable','facts':{'capture':capture},'meaning':'The native memory worker is not configured',
                'next_action':'Set ARC_MEMORY_WORKER to the worker executable, then restart the service'}
    health=raw.get('health')
    if health:
        return {'state':'ready','code':'memory.available','facts':{'protocol':health.get('protocol'),'sqlite':health.get('sqlite'),'capture':capture},
                'meaning':'The memory worker answers','next_action':None}
    if raw.get('error'):
        return {'state':'unknown','code':'memory.not_checked','facts':{'capture':capture,'error':raw['error']},
                'meaning':'The memory worker did not answer: '+str(raw['error'])[:200],'next_action':'Open Memory in Diagnostics to retry'}
    return {'state':'unknown','code':'memory.not_checked','facts':{'capture':capture},
            'meaning':'The memory worker is not running yet; this reading does not start it','next_action':'Open Memory in Diagnostics to start it'}


def _storage(raw):
    facts={'missions_db':bool(raw.get('missions_db')),'missions':raw.get('missions')}
    if facts['missions_db']:
        return {'state':'not_tested','code':'storage.present','facts':facts,'meaning':f'missions.db is present with {facts["missions"]} missions','next_action':STORAGE_NEXT}
    return {'state':'blocked','code':'storage.missing','facts':facts,'meaning':'missions.db is missing from the data directory','next_action':STORAGE_NEXT}


def build_readiness(principal,*,settings_snapshot,credential_stored,cli_transport_reader,probes_reader,catalog,memory_health,renderer,storage,
                    mcp_sdk=None,acp_protocol=1,public_reads=False):
    """The whole reading from already-collected facts: settings_snapshot is the owner's
    snapshot or None when unavailable; credential_stored(ref) -> bool; cli_transport_reader
    (provider) -> the cached transport facts or None when no executable resolves;
    probes_reader(provider) -> the last probe record or None; memory_health, renderer and
    storage are the raw facts their readers gathered."""
    native=principal=='native'
    session={'kind':'native' if native else 'token','state':'ready','code':'session.native' if native else 'session.token',
             'label':'Desktop session' if native else 'Operator token',
             'meaning':'Authenticated by the desktop app' if native else 'Authenticated by the operator token',
             'next_action':None,'source':'request header'}
    snap=settings_snapshot;settings=(snap or {}).get('settings') if snap else None
    if snap is None:
        node={'state':'blocked','code':'settings.unavailable','revision':None,'path':None,'read_only':True,
              'meaning':'No settings are available to this service','next_action':'Start the service through the desktop app, or set ARC_SETTINGS_FILE','source':None}
        source='settings unavailable'
    elif snap.get('read_only'):
        node={'state':'blocked','code':'settings.read_only','revision':snap.get('revision'),'path':snap.get('path'),'read_only':True,
              'meaning':'Settings are read from a file and cannot be changed here','next_action':'Start the service through the desktop app to change settings','source':'file'}
        source='settings revision '+str(snap.get('revision'))[:12]
    else:
        node={'state':'ready','code':'settings.available','revision':snap.get('revision'),'path':snap.get('path'),'read_only':False,
              'meaning':'Settings are read and written through the desktop app','next_action':None,'source':'supervisor'}
        source='settings revision '+str(snap.get('revision'))[:12]
    seats={r['role']:_seat(r['role'],settings,credential_stored=credential_stored,cli_transport_reader=cli_transport_reader,
                           probes_reader=probes_reader,catalog=catalog,source=source) for r in ROLES}
    if settings is None:
        for seat in seats.values():seat.update(state='unknown',code='seat.unknown',meaning='Settings are unavailable, so the seat cannot be read',next_action=node['next_action'])
        live={'state':'unknown','code':'live.unknown','blocking':['planner'],'meaning':'Settings are unavailable, so the seats cannot be read','next_action':node['next_action']}
    else:live=_live(seats,settings)
    mcp=[_connector(e,'mcp') for e in ((settings or {}).get('mcp_servers') or [])]
    acp=[_connector(e,'acp') for e in ((settings or {}).get('acp_agents') or [])]
    return {'checked_at':int(time.time()),'session':session,'settings':node,'roles':ROLES,'seats':seats,'live_mission':live,
            'connectors':{'mcp':mcp,'acp':acp,'mcp_sdk':mcp_sdk,'acp_protocol':acp_protocol,**_connectors_summary(mcp+acp)},
            'renderer':_renderer(renderer),'memory':_memory(memory_health),'storage':_storage(storage),
            'catalog':catalog,'public_reads':{'enabled':bool(public_reads)}}


def create_router(*,authorized,root,repository,cli_transport,cli_transports,probes,credential_stored,memory_routes,molecular_jobs):
    """GET /api/readiness with the service's own readers: the settings owner, the credential
    store (presence only), the 30 s CLI transport cache (read once when cold: local and
    cost-free), the probe records in memory then on disk, the memory worker only when it is
    already running, the renderer configuration and the mission store."""
    from .exploration import acp_client, mcp_tools
    router=APIRouter()

    def last_probe(provider):
        name=cli_transports[provider][1]
        if probes.get(name):return probes[name]
        path=root/'providers'/(name+'-probes.jsonl')
        try:
            lines=path.read_bytes().strip().splitlines()
            return json.loads(lines[-1]) if lines else None
        except (OSError,ValueError):return None

    def memory_raw():
        capture=memory_routes.capture_status()
        raw={'configured':capture.get('status')!='unconfigured','capture':capture,'health':None,'error':None}
        if raw['configured']:
            try:raw['health']=memory_routes.passive_health()
            except Exception as why:raw['error']=str(why)[:200]
        return raw

    @router.get('/api/readiness')
    async def readiness(principal:str=Depends(authorized)):
        try:snap=await asyncio.to_thread(operator_settings.snapshot)
        except (operator_settings.SettingsUnavailable,operator_settings.SettingsRejected,ValueError,OSError,subprocess.SubprocessError):snap=None
        settings=(snap or {}).get('settings')
        transports={}
        for entry in ROLES:
            seat=operator_settings.seat(settings,entry['role'])
            if seat and seat.get('auth')=='cli' and seat['provider'] in cli_transports and seat['provider'] not in transports:
                try:transports[seat['provider']]=await cli_transport(seat['provider'])
                except Exception:transports[seat['provider']]=None
        blender=os.environ.get('ARC_MOLECULAR_BLENDER_PYTHON')
        db=root/'missions.db'
        return build_readiness(principal,settings_snapshot=snap,credential_stored=credential_stored,cli_transport_reader=transports.get,
            probes_reader=last_probe,catalog=load_catalog(),memory_health=await asyncio.to_thread(memory_raw),
            renderer={'configured':bool(blender),'exists':(molecular_jobs.runtime is not None) if blender else None,
                      'default_preset':((settings or {}).get('blender') or {}).get('default_preset')},
            storage={'missions_db':db.is_file(),'missions':await asyncio.to_thread(repository.count) if db.is_file() else None},
            mcp_sdk=mcp_tools.sdk_version(),acp_protocol=acp_client.PROTOCOL_VERSION,public_reads=os.environ.get('ARC_PUBLIC_READS')=='1')
    return router
