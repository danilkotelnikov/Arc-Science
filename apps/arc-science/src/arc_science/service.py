"""Single-laboratory Arc Science service. Run one worker per state directory."""
from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager, suppress
import os
from pathlib import Path
import secrets
import time
import uuid
import httpx
import json
from pydantic import BaseModel
from fastapi import Body, FastAPI, Depends, Header, HTTPException, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from . import __version__
from .contracts import digest
from .transport import AccessGrant
from .exploration.models import MissionRequest, MissionState
from .exploration.engine import initialize, explore, MissionCancelled
from .exploration.agents import DemoAgent, DemoVisionAgent
from .exploration.providers import HTTPAgent, ModelEndpoint
from .exploration.repository import MissionRepository, MissionFinished, RevisionConflict
from .exploration.capsule import export_capsule, verify_capsule
from .exploration import release as release_ledger
from .exploration.evidence import evidence_graph
from .exploration.catalog import TrustedPublicTools

VERSION=__version__


class ProbeRequest(BaseModel):
    """Explicit consent: a provider probe spends real tokens."""
    spend_tokens:bool=False


class ProbeReply(BaseModel):
    """The smallest schema-valid answer: a probe proves reachability and identity, nothing more."""
    ok:bool

ENDPOINTS={'openai':'https://api.openai.com/v1/responses',
           'anthropic':'https://api.anthropic.com/v1/messages'}


def claude_code_command():
    """The qualified Claude Code executable for the subscription transport, or None."""
    path=os.environ.get('ARC_CLAUDE_CODE_EXE')
    if not path:return None
    executable=Path(path)
    if not executable.is_absolute() or not executable.is_file():
        raise ValueError('ARC_CLAUDE_CODE_EXE must be the absolute path of the installed Claude Code executable')
    return [str(executable)]


def configured_endpoints():
    provider=(os.environ.get('ARC_PROVIDER') or 'openai')
    model=os.environ.get('ARC_MODEL','')
    if provider=='claude-code':
        # The subscription route: the operator's own Claude Code login, no token file.
        command=claude_code_command()
        if not model or not command:raise ValueError('Configure ARC_MODEL and ARC_CLAUDE_CODE_EXE first')
        if (os.environ.get('ARC_REVIEWER_PROVIDER') or provider)!='claude-code':
            raise ValueError('Mixed transports are not supported: the reviewer seat must also use claude-code')
        first=ModelEndpoint(provider=provider,endpoint=command[0],model=model,credential_ref='planner')
        second=ModelEndpoint(provider=provider,endpoint=command[0],model=(os.environ.get('ARC_REVIEWER_MODEL') or model),credential_ref='reviewer')
        return first,second
    endpoint=(os.environ.get('ARC_PROVIDER_URL') or ENDPOINTS.get(provider,''))
    if not model or not endpoint:raise ValueError('Configure ARC_MODEL and the provider endpoint first')
    first=ModelEndpoint(provider=provider,endpoint=endpoint,model=model,credential_ref='planner',
        agent_id=os.environ.get('ARC_OPENCLAW_AGENT'),openclaw_isolated=os.environ.get('ARC_OPENCLAW_ISOLATED')=='1')
    rp=(os.environ.get('ARC_REVIEWER_PROVIDER') or provider)
    if rp=='claude-code':raise ValueError('Mixed transports are not supported: set ARC_PROVIDER=claude-code for both seats')
    second=ModelEndpoint(provider=rp,endpoint=(os.environ.get('ARC_REVIEWER_URL') or ENDPOINTS.get(rp,endpoint)),
        model=(os.environ.get('ARC_REVIEWER_MODEL') or model),credential_ref='reviewer',
        agent_id=os.environ.get('ARC_REVIEWER_AGENT',first.agent_id),openclaw_isolated=first.openclaw_isolated)
    return first,second


def live_seats_ready():
    """Both model seats configured with whatever they need: token files, or the CLI."""
    first,second=configured_endpoints()
    if first.provider!='claude-code':
        _secret('planner');_secret('reviewer')
    return first,second


def configured_vision_endpoint():
    first,second=configured_endpoints()
    provider=(os.environ.get('ARC_VISION_PROVIDER') or second.provider)
    if provider=='claude-code':
        raise ValueError('Visual review is not available through the Claude Code transport; '
                         'set ARC_VISION_PROVIDER to anthropic or openai with its own credential file')
    model=os.environ.get('ARC_VISION_MODEL','')
    endpoint=(os.environ.get('ARC_VISION_URL') or ENDPOINTS.get(provider,''))
    if not model or not endpoint:
        raise ValueError('Configure ARC_VISION_MODEL and the vision provider endpoint first')
    return ModelEndpoint(provider=provider,endpoint=endpoint,model=model,credential_ref='vision')


def _secret(ref):
    if ref=='biorender':
        path=os.environ.get('ARC_BIORENDER_TOKEN_FILE')
    elif ref=='vision':
        path=(os.environ.get('ARC_VISION_TOKEN_FILE') or os.environ.get('ARC_REVIEWER_TOKEN_FILE')
              or os.environ.get('ARC_MODEL_TOKEN_FILE'))
    else:
        name='ARC_REVIEWER_TOKEN_FILE' if ref=='reviewer' else 'ARC_MODEL_TOKEN_FILE'
        path=os.environ.get(name) or os.environ.get('ARC_MODEL_TOKEN_FILE')
    if not path:raise ValueError('Provider token file is not configured')
    value=Path(path).read_text().strip()
    if not value or len(value)>8192:raise ValueError('Provider token file is empty or exceeds limit')
    return value


def biorender_configuration():
    """Report static readiness without claiming endpoint or credential qualification."""
    enabled=os.environ.get('ARC_BIORENDER_READS')=='1'
    if not enabled:return {'enabled':False,'configured':False,'live_qualified':False}
    from .biorender import LEGACY_PROTOCOL, SELECTABLE_PROTOCOLS
    protocol=os.environ.get('ARC_BIORENDER_PROTOCOL') or LEGACY_PROTOCOL
    schema_digest=os.environ.get('ARC_BIORENDER_SCHEMA_DIGEST','')
    if protocol not in SELECTABLE_PROTOCOLS:raise ValueError('Unsupported ARC_BIORENDER_PROTOCOL')
    if len(schema_digest)!=64 or any(character not in '0123456789abcdef' for character in schema_digest):
        raise ValueError('Configure a valid ARC_BIORENDER_SCHEMA_DIGEST')
    _secret('biorender')
    return {'enabled':True,'configured':True,'protocol':protocol,
            'schema_digest':schema_digest,'live_qualified':False}


def combine_trusted_tools(*collections):
    """Merge runtime-installed adapters while retaining their trusted identity marker."""
    combined=TrustedPublicTools()
    for collection in collections:
        if collection and not isinstance(collection,TrustedPublicTools):
            raise ValueError('Only runtime-installed public tools can be combined')
        for name,binding in collection.items():
            if name in combined:raise ValueError('Duplicate trusted public tool')
            combined[name]=binding
    return combined


def create_app(*,data_dir:Path|None=None,token:str|None=None):
    root=Path(data_dir or os.environ.get('ARC_DATA_DIR','./data')).resolve()
    root.mkdir(parents=True,exist_ok=True,mode=0o700)
    if token is None:
        token_path=Path(os.environ.get('ARC_TOKEN_FILE',str(root/'access.token')))
        if not token_path.exists():
            token_path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            try:
                with token_path.open('x') as f:f.write(secrets.token_urlsafe(36)+'\n')
                token_path.chmod(0o600)
            except FileExistsError:pass
        token=token_path.read_text().strip()
    if len(token)<32:raise ValueError('Use a randomly generated API token of at least 32 characters')
    repository=MissionRepository(root/'missions.db');running={}

    @asynccontextmanager
    async def lifespan(app):
        repository.pause_interrupted()
        memory_routes.schedule_reconcile()
        yield
        await molecular_jobs.close()
        for task in tuple(running.values()):task.cancel()
        for task in tuple(running.values()):
            with suppress(asyncio.CancelledError):await task
        repository.pause_interrupted()
        # Capture final paused/cancelled/error snapshots, then drain the single
        # capture worker before closing its stdio process.
        memory_routes.schedule_reconcile()
        await asyncio.to_thread(memory_routes.close)

    app=FastAPI(title='Arc Science',version=VERSION,lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
    app.state.repository=repository
    app.state.running=running

    async def authorized(authorization:str|None=Header(default=None)):
        expected='Bearer '+token
        if not authorization or not secrets.compare_digest(authorization,expected):
            raise HTTPException(401,'Authentication required',headers={'WWW-Authenticate':'Bearer'})

    from .bioart.web import create_router as create_bioart_router
    app.include_router(create_bioart_router(root,authorized))

    from .molecular_jobs import MolecularJobs
    molecular_jobs=MolecularJobs(root,authorized)
    app.state.molecular_jobs=molecular_jobs
    app.include_router(molecular_jobs.router)

    from .memory.web import MemoryRoutes
    worker_path=os.environ.get('ARC_MEMORY_WORKER')
    memory_routes=MemoryRoutes(root,Path(worker_path) if worker_path else None,authorized)
    app.state.memory_routes=memory_routes
    def memory_snapshots():
        # Reconciliation is a bounded repair of the visible retained missions.
        # Overflow remains degraded, never an assertion of complete capture.
        retained=repository.list(limit=101)
        for item in retained[:100]:
            row=repository.get(item['id'])
            yield row['id'],MissionState.model_validate(row['state'])
        if len(retained)>100:raise RuntimeError('Retained mission replay exceeds bounded repair limit')
    memory_routes.set_snapshot_source(memory_snapshots)
    app.include_router(memory_routes.router)

    @app.middleware('http')
    async def security_headers(request,call_next):
        if request.headers.get('content-length','0').isdigit() and int(request.headers.get('content-length','0'))>1024*1024:
            return Response(status_code=413)
        response=await call_next(request)
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='no-referrer'
        response.headers['Cache-Control']='no-store'
        response.headers.setdefault('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        return response

    def get(mid):
        try:return repository.get(mid)
        except KeyError:raise HTTPException(404,'Unknown mission') from None

    @app.get('/health')
    async def health(response:Response):
        # Public compatibility marker for the local desktop, never authentication.
        response.headers['X-Arc-Science-Service']='arc-science-v1'
        return {'status':'ready','version':VERSION,'deployment':'single-trust-domain'}

    @app.get('/api/missions',dependencies=[Depends(authorized)])
    async def list_missions():return repository.list()

    probes={'claude-code':None}
    transport_cache={'at':0.0,'value':None}

    async def claude_code_transport():
        # Cost-free readiness: executable identity and the CLI's own login state, cached briefly.
        from .exploration import claude_code
        command=claude_code_command()
        if time.monotonic()-transport_cache['at']>30 or transport_cache['value'] is None:
            transport_cache['value']={'transport':'claude-code','executable':Path(command[0]).name,
                'executable_sha256':await claude_code.executable_digest(command[0]),
                'version':await claude_code.version(command),**await claude_code.auth_status(command),
                'checked_at':int(time.time()),'tools':'disabled','network_sandboxed':False,
                'contract':claude_code.CONTRACT_VERSION,
                'note':'logged_in reports that a login exists, not that inference will succeed; run the probe for that'}
            transport_cache['at']=time.monotonic()
        return {**transport_cache['value'],'last_probe':probes['claude-code']}

    probe_lock=asyncio.Lock();probe_last={'at':0.0}
    PROBE_COOLDOWN=30.0

    @app.post('/api/providers/claude-code/probe',dependencies=[Depends(authorized)])
    async def probe_claude_code(consent:ProbeRequest=Body(...)):
        """An explicit, token-spending minimal call through the production adapter, per model:
        one at a time, with a cooldown, and an audit line in the data directory."""
        from .exploration.claude_code import ClaudeCodeAgent
        if not consent.spend_tokens:raise HTTPException(422,'Confirm spend_tokens=true; a probe makes a real model call per configured model')
        try:first,second=configured_endpoints()
        except Exception as error:raise HTTPException(409,str(error)) from None
        if first.provider!='claude-code':raise HTTPException(409,'The claude-code transport is not configured')
        if probe_lock.locked():raise HTTPException(409,'A probe is already running')
        if time.monotonic()-probe_last['at']<PROBE_COOLDOWN:raise HTTPException(429,'Probe cooldown: wait before spending again')
        async with probe_lock:
            probe_last['at']=time.monotonic()
            results=[]
            for model in dict.fromkeys((first.model,second.model)):
                seat=ClaudeCodeAgent(claude_code_command(),model,model)
                started=time.monotonic()
                try:
                    await seat._call(model,'You are Arc Science\'s readiness probe. Return only the JSON object {"ok": true}.',
                                     {'probe':True},ProbeReply,role='probe')
                    results.append({'model':model,'ok':True,'observed_model':seat.calls[-1]['observed_model'],
                                    'duration_ms':int((time.monotonic()-started)*1000)})
                except Exception as error:
                    results.append({'model':model,'ok':False,'error':str(error)[:300],'duration_ms':int((time.monotonic()-started)*1000)})
                finally:seat.close()
            probes['claude-code']={'at':int(time.time()),'results':results}
            audit=root/'providers'/'claude-code-probes.jsonl'
            audit.parent.mkdir(parents=True,exist_ok=True)
            with audit.open('a',encoding='utf-8') as log:log.write(json.dumps(probes['claude-code'])+'\n')
            return probes['claude-code']

    @app.get('/api/capabilities',dependencies=[Depends(authorized)])
    async def capabilities():
        try:
            first,second=live_seats_ready()
            live={'configured':True,'planner':first.model,'reviewer':second.model,'provider':first.provider}
            if first.provider=='claude-code':live['transport']=await claude_code_transport()
        except Exception:live={'configured':False}
        try:
            vision=configured_vision_endpoint();_secret('vision')
            visual={'configured':True,'provider':vision.provider,'model':vision.model}
        except Exception:visual={'configured':False}
        try:biorender=biorender_configuration()
        except Exception:biorender={'enabled':os.environ.get('ARC_BIORENDER_READS')=='1',
                                   'configured':False,'live_qualified':False}
        return {'version':VERSION,'live':live,'vision':visual,
                'numeric_tools':['describe_data','polynomial_fit','permutation_control'],
                'public_network_tools_enabled':os.environ.get('ARC_PUBLIC_READS')=='1',
                'biorender':biorender,
                'blender':'batch adapter retained; renderer availability must be checked separately',
                'publication_authorization':False}

    @app.post('/api/missions',status_code=201,dependencies=[Depends(authorized)])
    async def new_mission(request:MissionRequest,idempotency_key:str|None=Header(default=None)):
        if request.mode=='live':
            try:live_seats_ready()
            except Exception:raise HTTPException(409,'Configure model endpoints and server-side credential files before live use') from None
            if request.vision_review:
                try:configured_vision_endpoint();_secret('vision')
                except Exception:raise HTTPException(409,'Configure a separate vision model endpoint and server-side credential file before required vision review') from None
            if os.environ.get('ARC_BIORENDER_READS')=='1':
                try:biorender_configuration()
                except Exception:raise HTTPException(409,'Configure the separate BioRender credential, protocol and schema pin before enabling reads') from None
        try:
            row=repository.create(request,initialize(request),key=idempotency_key or uuid.uuid4().hex)
            memory_routes.schedule_capture(row['id'],MissionState.model_validate(row['state']))
            return row
        except RevisionConflict:raise HTTPException(409,'Idempotency key conflicts with an earlier request') from None
        except ValueError:raise HTTPException(422,'Invalid creation key or mission state') from None

    def with_release(row):
        # The current decision is derived on read from the persisted ledger; it is
        # never a claim of validity, only of eligibility for human review.
        request=MissionRequest.model_validate(row['request']);state=MissionState.model_validate(row['state'])
        decision=release_ledger.current_decision(request,state,event_chain_ok=repository.verify(row['id']))
        return {**row,'release':decision.model_dump(mode='json')}

    @app.get('/api/missions/{mid}',dependencies=[Depends(authorized)])
    async def read_mission(mid:str):return with_release(get(mid))

    @app.get('/api/missions/{mid}/release',dependencies=[Depends(authorized)])
    async def read_release(mid:str):return with_release(get(mid))['release']

    @app.get('/api/missions/{mid}/evidence',dependencies=[Depends(authorized)])
    async def read_evidence(mid:str):
        return evidence_graph(MissionState.model_validate(get(mid)['state']))

    async def worker(mid):
        row=repository.get(mid);revision=row['revision']
        request=MissionRequest.model_validate(row['request'])
        def emit(state):
            nonlocal revision
            fresh=repository.save(mid,state,expected_revision=revision);revision=fresh['revision']
            # Best-effort capture off the event loop: blocking worker stdio must not
            # stall mission progress, status polling or cancellation.
            memory_routes.schedule_capture(mid,state)
        def cancelled():return repository.get(mid)['state']['status']=='cancelled'
        agent=None
        try:
            async with httpx.AsyncClient(trust_env=False) as client:
                tools=TrustedPublicTools()
                if request.mode=='demo':agent=DemoVisionAgent() if request.vision_review else DemoAgent()
                else:
                    first,second=configured_endpoints()
                    vision=configured_vision_endpoint() if request.vision_review else None
                    def resolve(ref,principal,project):
                        cfg=first if ref=='planner' else (vision if ref=='vision' else second)
                        return AccessGrant(token=_secret(ref),principal=principal,project_id=project,resource=cfg.endpoint,
                            credential_ref=ref,expires_at=int(time.time())+60,
                            auth_style=(('oauth' if os.environ.get('ARC_ANTHROPIC_AUTH') in ('oauth','bearer') else 'x-api-key') if cfg.provider=='anthropic' else 'bearer'))
                    if first.provider=='claude-code':
                        from .exploration.claude_code import ClaudeCodeAgent
                        # The visual seat, when configured, stays a native image endpoint.
                        visual=HTTPAgent(vision,reviewer_config=vision,vision_config=vision,client=client,
                                         resolver=resolve,project=mid,principal='local-operator') if vision else None
                        agent=ClaudeCodeAgent(claude_code_command(),first.model,second.model,vision=visual)
                    else:
                        agent=HTTPAgent(first,reviewer_config=second,vision_config=vision,
                                        client=client,resolver=resolve,project=mid,principal='local-operator')
                    if os.environ.get('ARC_PUBLIC_READS')=='1':
                        from .exploration.public_reads import public_tools
                        tools=combine_trusted_tools(tools,public_tools(client))
                    if os.environ.get('ARC_BIORENDER_READS')=='1':
                        from .biorender import BIORENDER_ENDPOINT, BioRenderClient
                        from .exploration.biorender_read import biorender_tools
                        biorender=biorender_configuration()
                        def resolve_biorender(ref,principal,project):
                            return AccessGrant(token=_secret('biorender'),principal=principal,project_id=project,
                                resource=BIORENDER_ENDPOINT,credential_ref='biorender',
                                expires_at=int(time.time())+60)
                        provider=BioRenderClient(client=client,grant_resolver=resolve_biorender,
                            principal='local-operator',project_id=mid,credential_ref='biorender',
                            protocol=biorender['protocol'])
                        adapter=await biorender_tools(provider,schema_digest=biorender['schema_digest'])
                        tools=combine_trusted_tools(tools,adapter)
                await explore(request,agent,initial=MissionState.model_validate(row['state']),emit=emit,cancelled=cancelled,extra_tools=tools)
        except (MissionCancelled,RevisionConflict):pass
        except asyncio.CancelledError:raise
        except Exception:
            fresh=repository.get(mid)
            if fresh['state']['status']!='cancelled':
                error=MissionState.model_validate({**fresh['state'],'status':'error','stop_reason':'Service execution failed; inspect configuration. No success inferred.'})
                with suppress(RevisionConflict):repository.save(mid,error,expected_revision=fresh['revision'])
        finally:
            if hasattr(agent,'close'):agent.close()
            fresh=repository.get(mid)
            memory_routes.schedule_capture(mid,MissionState.model_validate(fresh['state']))
            running.pop(mid,None)

    @app.post('/api/missions/{mid}/start',status_code=202,dependencies=[Depends(authorized)])
    async def start(mid:str):
        row=get(mid)
        if mid in running or row['state']['status'] not in ('ready','paused'):
            raise HTTPException(409,'Only ready or interrupted missions can start or resume')
        running[mid]=asyncio.create_task(worker(mid))
        return {'id':mid,'status':'scheduled'}

    @app.post('/api/missions/{mid}/cancel',dependencies=[Depends(authorized)])
    async def cancel(mid:str):
        get(mid)
        try:row=repository.cancel(mid)
        except MissionFinished as finished:raise HTTPException(409,str(finished)) from None
        except RevisionConflict:raise HTTPException(409,'Mission changed; retry cancellation') from None
        if mid in running:running[mid].cancel()
        memory_routes.schedule_capture(mid,MissionState.model_validate(row['state']))
        return row

    @app.get('/api/missions/{mid}/artifacts/{artifact_digest}',dependencies=[Depends(authorized)])
    async def artifact(mid:str,artifact_digest:str):
        state=MissionState.model_validate(get(mid)['state'])
        item=next((item for item in state.artifacts if item.digest==artifact_digest),None)
        if item is None:raise HTTPException(404,'Unknown mission artifact')
        return Response(item.bytes,media_type=item.media_type,
                        headers={'ETag':'"'+item.digest+'"','Content-Disposition':'inline'})

    @app.get('/api/missions/{mid}/capsule',dependencies=[Depends(authorized)])
    async def capsule(mid:str):
        row=get(mid)
        chain=repository.verify(mid)
        if not chain:raise HTTPException(409,'Mission integrity check failed')
        request=MissionRequest.model_validate(row['request']);state=MissionState.model_validate(row['state'])
        # Every release export consults the ledger: a blocked mission is not exported.
        try:release_ledger.assert_exportable(request,state,event_chain_ok=chain)
        except release_ledger.ReleaseBlocked as blocked:
            raise HTTPException(409,'Release blocked; verify the mission and resolve: '+', '.join(blocked.reasons)) from None
        data=export_capsule(request,state)
        return Response(data,media_type='application/zip',headers={'Content-Disposition':f'attachment; filename="arc-{mid}.zip"'})

    @app.post('/api/missions/{mid}/verify',dependencies=[Depends(authorized)])
    async def verify(mid:str):
        row=get(mid)
        # Verification writes the ledger; it never competes with an active worker
        # (the revision lock below catches a start that slips in meanwhile).
        if mid in running or row['state']['status']=='running':
            raise HTTPException(409,'Mission is still running; verify after it finishes')
        chain=repository.verify(mid)
        if not chain:raise HTTPException(409,'Mission integrity check failed')
        request=MissionRequest.model_validate(row['request']);state=MissionState.model_validate(row['state'])
        report=await asyncio.to_thread(verify_capsule,export_capsule(request,state))
        # Persist what was observed and the decision it yields; a later change stales it.
        receipt=release_ledger.receipt_from_report(report,state)
        decision=release_ledger.evaluate_release(request,state,receipt,event_chain_ok=chain)
        try:repository.save(mid,state.model_copy(update={'release':decision}),expected_revision=row['revision'])
        except RevisionConflict:raise HTTPException(409,'Mission changed during verification; retry') from None
        return {**report,'event_chain':True,'release':decision.model_dump(mode='json')}

    static=Path(__file__).parent/'static'
    @app.get('/diagnostics')
    async def diagnostics():return FileResponse(static/'diagnostics.html')
    app.mount('/assets-local',StaticFiles(directory=static),name='diagnostic-assets')
    web=static/'web'
    if web.is_dir() and (web/'index.html').exists():
        app.mount('/',StaticFiles(directory=web,html=True),name='web')
    else:
        @app.get('/')
        async def home():return FileResponse(static/'diagnostics.html')
    return app
