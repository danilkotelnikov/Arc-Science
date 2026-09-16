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
from fastapi import FastAPI, Depends, Header, HTTPException, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from . import __version__
from .contracts import digest
from .transport import AccessGrant
from .exploration.models import MissionRequest, MissionState
from .exploration.engine import initialize, explore, MissionCancelled
from .exploration.agents import DemoAgent
from .exploration.providers import HTTPAgent, ModelEndpoint
from .exploration.repository import MissionRepository, RevisionConflict
from .exploration.capsule import export_capsule, verify_capsule
from .exploration.evidence import evidence_graph
from .exploration.catalog import TrustedPublicTools

VERSION=__version__
ENDPOINTS={'openai':'https://api.openai.com/v1/responses',
           'anthropic':'https://api.anthropic.com/v1/messages'}


def configured_endpoints():
    provider=(os.environ.get('ARC_PROVIDER') or 'openai')
    model=os.environ.get('ARC_MODEL','')
    endpoint=(os.environ.get('ARC_PROVIDER_URL') or ENDPOINTS.get(provider,''))
    if not model or not endpoint:raise ValueError('Configure ARC_MODEL and the provider endpoint first')
    first=ModelEndpoint(provider=provider,endpoint=endpoint,model=model,credential_ref='planner',
        agent_id=os.environ.get('ARC_OPENCLAW_AGENT'),openclaw_isolated=os.environ.get('ARC_OPENCLAW_ISOLATED')=='1')
    rp=(os.environ.get('ARC_REVIEWER_PROVIDER') or provider)
    second=ModelEndpoint(provider=rp,endpoint=(os.environ.get('ARC_REVIEWER_URL') or ENDPOINTS.get(rp,endpoint)),
        model=(os.environ.get('ARC_REVIEWER_MODEL') or model),credential_ref='reviewer',
        agent_id=os.environ.get('ARC_REVIEWER_AGENT',first.agent_id),openclaw_isolated=first.openclaw_isolated)
    return first,second


def configured_vision_endpoint():
    first,second=configured_endpoints()
    provider=(os.environ.get('ARC_VISION_PROVIDER') or second.provider)
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
    repository=MissionRepository(root/'missions.db');running={};memory_holder={}

    @asynccontextmanager
    async def lifespan(app):
        repository.pause_interrupted()
        yield
        for task in tuple(running.values()):task.cancel()
        for task in tuple(running.values()):
            with suppress(asyncio.CancelledError):await task
        routes=memory_holder.get('memory')
        if routes is not None:routes.close()
        repository.pause_interrupted()

    app=FastAPI(title='Arc Science',version=VERSION,lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
    from .molecular_web import router as molecular_router
    app.include_router(molecular_router)
    app.state.repository=repository
    app.state.running=running

    async def authorized(authorization:str|None=Header(default=None)):
        expected='Bearer '+token
        if not authorization or not secrets.compare_digest(authorization,expected):
            raise HTTPException(401,'Authentication required',headers={'WWW-Authenticate':'Bearer'})

    from .bioart.web import create_router as create_bioart_router
    app.include_router(create_bioart_router(root,authorized))

    from .memory.web import MemoryRoutes
    worker_path=os.environ.get('ARC_MEMORY_WORKER')
    memory_routes=MemoryRoutes(root,Path(worker_path) if worker_path else None,authorized)
    memory_holder['memory']=memory_routes
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
    async def health():return {'status':'ready','version':VERSION,'deployment':'single-trust-domain'}

    @app.get('/api/missions',dependencies=[Depends(authorized)])
    async def list_missions():return repository.list()

    @app.get('/api/capabilities',dependencies=[Depends(authorized)])
    async def capabilities():
        try:
            first,second=configured_endpoints();_secret('planner');_secret('reviewer')
            live={'configured':True,'planner':first.model,'reviewer':second.model,'provider':first.provider}
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
            try:configured_endpoints();_secret('planner');_secret('reviewer')
            except Exception:raise HTTPException(409,'Configure model endpoints and server-side credential files before live use') from None
            if request.vision_review:
                try:configured_vision_endpoint();_secret('vision')
                except Exception:raise HTTPException(409,'Configure a separate vision model endpoint and server-side credential file before required vision review') from None
            if os.environ.get('ARC_BIORENDER_READS')=='1':
                try:biorender_configuration()
                except Exception:raise HTTPException(409,'Configure the separate BioRender credential, protocol and schema pin before enabling reads') from None
        try:return repository.create(request,initialize(request),key=idempotency_key or uuid.uuid4().hex)
        except RevisionConflict:raise HTTPException(409,'Idempotency key conflicts with an earlier request') from None
        except ValueError:raise HTTPException(422,'Invalid creation key or mission state') from None

    @app.get('/api/missions/{mid}',dependencies=[Depends(authorized)])
    async def read_mission(mid:str):return get(mid)

    @app.get('/api/missions/{mid}/evidence',dependencies=[Depends(authorized)])
    async def read_evidence(mid:str):
        return evidence_graph(MissionState.model_validate(get(mid)['state']))

    async def worker(mid):
        row=repository.get(mid);revision=row['revision']
        request=MissionRequest.model_validate(row['request'])
        def emit(state):
            nonlocal revision
            fresh=repository.save(mid,state,expected_revision=revision);revision=fresh['revision']
        def cancelled():return repository.get(mid)['state']['status']=='cancelled'
        try:
            async with httpx.AsyncClient(trust_env=False) as client:
                tools=TrustedPublicTools()
                if request.mode=='demo':agent=DemoAgent()
                else:
                    first,second=configured_endpoints()
                    vision=configured_vision_endpoint() if request.vision_review else None
                    def resolve(ref,principal,project):
                        cfg=first if ref=='planner' else (vision if ref=='vision' else second)
                        return AccessGrant(token=_secret(ref),principal=principal,project_id=project,resource=cfg.endpoint,
                            credential_ref=ref,expires_at=int(time.time())+60,auth_style='x-api-key' if cfg.provider=='anthropic' else 'bearer')
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
        finally:running.pop(mid,None)

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
        except RevisionConflict:raise HTTPException(409,'Mission changed; retry cancellation') from None
        if mid in running:running[mid].cancel()
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
        if not repository.verify(mid):raise HTTPException(409,'Mission integrity check failed')
        data=export_capsule(MissionRequest.model_validate(row['request']),MissionState.model_validate(row['state']))
        return Response(data,media_type='application/zip',headers={'Content-Disposition':f'attachment; filename="arc-{mid}.zip"'})

    @app.get('/api/missions/{mid}/verify',dependencies=[Depends(authorized)])
    async def verify(mid:str):
        row=get(mid)
        if not repository.verify(mid):raise HTTPException(409,'Mission integrity check failed')
        report=await asyncio.to_thread(verify_capsule,export_capsule(MissionRequest.model_validate(row['request']),MissionState.model_validate(row['state'])))
        return {**report,'event_chain':True}

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
