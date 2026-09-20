"""Single-laboratory Arc Science service. Run one worker per state directory."""
from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager, suppress
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import time
import uuid
import hmac
import httpx
import json
from pydantic import BaseModel, Field
from fastapi import Body, FastAPI, Depends, Header, HTTPException, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from . import __version__
from .contracts import digest
from .transport import AccessGrant
from .exploration.models import Event, MissionRequest, MissionState
from .exploration.engine import initialize, explore, MissionCancelled
from .exploration.agents import DemoAgent, DemoVisionAgent
from .exploration.providers import HTTPAgent, ModelEndpoint
from .exploration.cli_seats import redact
from . import anchored
from . import settings as operator_settings
from .exploration.changes import ChangeRefused, MISSION_CHANGES, RESUME_STALE, declare_resume, mission_change, obligation_states
from .exploration.claim_scope import DERIVATION_VERSION as CLAIM_DERIVATION_VERSION, derive_claim_scope
from .exploration.repository import MissionRepository, MissionFinished, RevisionConflict
from .exploration.capsule import export_capsule, verify_capsule
from .exploration import release as release_ledger
from .exploration.evidence import evidence_graph
from .exploration.catalog import TrustedPublicTools

VERSION=__version__


class ProseText(BaseModel):
    text:str=Field(min_length=1,max_length=20000)

class ProseDetect(ProseText):
    allow_egress:bool=False

class ProseHumanise(ProseText):
    """The text leaves this machine for the prose seat's provider: consent per request."""
    allow_egress:bool=False
    instructions:str=Field(default='',max_length=2000)

class SettingsReplace(BaseModel):
    settings:dict
    # The revision the operator read; without it a concurrent change would be overwritten.
    if_revision:str=Field(min_length=64,max_length=64,pattern=r'^[0-9a-f]{64}$')

class ChangeDeclaration(BaseModel):
    kind:str=Field(min_length=1,max_length=40)
    declared_effects:list[str]=Field(default_factory=list,max_length=5)
    note:str=Field(default='',max_length=400)

class ProbeRequest(BaseModel):
    """Explicit consent: a provider probe spends real tokens."""
    spend_tokens:bool=False


class ProbeReply(BaseModel):
    """The smallest schema-valid answer: a probe proves reachability and identity, nothing more."""
    ok:bool

ENDPOINTS={'openai':'https://api.openai.com/v1/responses',
           'anthropic':'https://api.anthropic.com/v1/messages',
           'gemini':'https://generativelanguage.googleapis.com/v1beta'}
# The CLI transports: provider -> (environment override, transport name for reports and audit files).
CLI_TRANSPORTS={'anthropic':('ARC_CLAUDE_CODE_EXE','claude-code'),'openai':(None,'codex'),'gemini':(None,'gemini-cli')}
# Header style per provider for API credentials.
AUTH_STYLES={'anthropic':'x-api-key','gemini':'x-goog-api-key'}


def cli_command(provider):
    """The qualified executable for a provider's CLI transport, or None when not configured.
    The environment may override Claude Code; otherwise the settings name the CLI (a path
    or an executable name on PATH)."""
    if provider not in CLI_TRANSPORTS:raise ValueError(f'No CLI transport for provider {provider}')
    override=CLI_TRANSPORTS[provider][0]
    path=os.environ.get(override) if override else None
    if not path:
        settings=operator_settings.current() or {}
        name=((settings.get('providers') or {}).get(provider) or {}).get('cli') or ''
        if not name:return None
        path=name if Path(name).is_absolute() else shutil.which(name)
        if not path:raise ValueError(f'providers.{provider}.cli names {name}, which is not on PATH')
    executable=Path(path)
    if not executable.is_absolute() or not executable.is_file():
        raise ValueError(f'The {provider} CLI executable must be an absolute path to an existing file')
    return [str(executable)]


def claude_code_command():
    """The qualified Claude Code executable for the subscription transport, or None."""
    return cli_command('anthropic')


def _cli_command(settings, provider):
    """The operator's CLI for a provider: the settings name it, or the environment does."""
    if provider not in CLI_TRANSPORTS:
        raise ValueError(f'The {provider} seat has no CLI login; use an API credential for this seat')
    command=claude_code_command() if provider=='anthropic' else cli_command(provider)
    if not command:
        raise ValueError(f'The {provider} CLI is not configured: set providers.{provider}.cli to its path')
    return command


def _endpoint_from_seat(settings, role, seat):
    provider=seat['provider'];auth=seat.get('auth','api_key');effort=seat.get('effort','medium')
    if auth=='cli':
        command=_cli_command(settings,provider)
        return ModelEndpoint(provider=provider,transport='cli',endpoint=command[0],model=seat['model'],credential_ref=role,effort=effort)
    providers=settings.get('providers') or {}
    endpoint=(providers.get(provider) or {}).get('endpoint') or ENDPOINTS.get(provider,'')
    if not endpoint:raise ValueError(f'providers.{provider}.endpoint is not set')
    agent_id=(providers.get('openclaw') or {}).get('agent_id') or None
    return ModelEndpoint(provider=provider,endpoint=endpoint,model=seat['model'],credential_ref=seat.get('credential') or role,
        agent_id=agent_id if provider=='openclaw' else None,
        openclaw_isolated=bool((providers.get('openclaw') or {}).get('isolated')) if provider=='openclaw' else False,
        effort=effort)


def connector_route(settings):
    """The consented connectors a live mission may reach, without anything but their
    identity: part of the route bound to the mission."""
    servers=[{k:s.get(k) for k in ('name','transport','command','args','url')}
             for s in (settings.get('mcp_servers') or []) if s.get('enabled',True) and s.get('consent')]
    agents=[{k:a.get(k) for k in ('name','command','args')}
            for a in (settings.get('acp_agents') or []) if a.get('enabled',True) and a.get('consent')]
    return {'mcp_servers':servers,'acp_agents':agents}


def endpoints_from_settings(settings):
    """(planner, reviewer, falsifier) endpoints from the settings file, or None when
    the planner seat is not configured there."""
    planner=operator_settings.seat(settings,'planner')
    if planner is None:return None
    reviewer=operator_settings.seat(settings,'reviewer') or planner
    falsifier=operator_settings.seat(settings,'falsifier') or reviewer
    # Every seat is its own transport; mixing CLI logins and API credentials is allowed.
    return (_endpoint_from_seat(settings,'planner',planner),_endpoint_from_seat(settings,'reviewer',reviewer),
            _endpoint_from_seat(settings,'falsifier',falsifier))


def configured_endpoints(settings=None):
    from_settings=endpoints_from_settings(operator_settings.current() if settings is None else settings)
    if from_settings is not None:
        return from_settings[0],from_settings[1]
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


def configured_falsifier_endpoint(first,second,settings=None):
    from_settings=endpoints_from_settings(operator_settings.current() if settings is None else settings)
    return from_settings[2] if from_settings is not None else second


def live_seats_ready():
    """Every model seat configured with whatever it needs: a credential file, or the CLI."""
    first,second=configured_endpoints()
    third=configured_falsifier_endpoint(first,second)
    for endpoint in (first,second,third):
        if endpoint.transport=='api':_secret(endpoint.credential_ref)
    return first,second


def live_route(vision_review=False):
    """Everything a live mission reaches, from one reading of the settings: the seats and
    the consented connectors. One immutable snapshot taken when the mission is scheduled
    and handed to the worker, never re-read."""
    settings=operator_settings.current()
    first,second=configured_endpoints(settings)
    seats={'planner':first,'reviewer':second,'falsifier':configured_falsifier_endpoint(first,second,settings)}
    if vision_review:seats['vision']=configured_vision_endpoint(settings)
    return {'seats':seats,**connector_route(settings or {})}


def live_seats(vision_review=False):
    return live_route(vision_review)['seats']


def seat_plan(route):
    """The whole route without secrets (per seat: provider, transport, model, effort,
    credential name, endpoint or executable, OpenClaw agent and isolation; per consented
    connector: its identity), its digest, and a short reading of it. Bound to the mission
    at its first start so a later settings change cannot redirect the same context
    elsewhere unnoticed."""
    seats=route['seats'] if 'seats' in route else route
    plan={'seats':{role:e.model_dump(mode='json') for role,e in seats.items()},
          'mcp_servers':route.get('mcp_servers',[]),'acp_agents':route.get('acp_agents',[])}
    route_digest=digest(plan)
    summary={role:':'.join((e.provider,e.transport,e.model,e.effort or 'default',e.credential_ref)) for role,e in seats.items()}
    for kind in ('mcp_servers','acp_agents'):
        if plan[kind]:summary[kind]=[entry['name'] for entry in plan[kind]]
    return route_digest,'sha256:'+route_digest+' '+json.dumps(summary,separators=(',',':'),sort_keys=True)


def configured_prose_endpoint(settings=None):
    """The prose seat from the settings, or None when it is not configured."""
    if settings is None:settings=operator_settings.current()
    seat=operator_settings.seat(settings,'prose')
    if seat is None:return None
    return _endpoint_from_seat(settings,'prose',seat)


def configured_vision_endpoint(settings=None):
    if settings is None:settings=operator_settings.current()
    first,second=configured_endpoints(settings)
    vision=operator_settings.seat(settings,'vision')
    if vision is not None:
        if vision.get('auth')=='cli':
            raise ValueError('Visual review is not available through a CLI login; give the vision seat an API credential')
        endpoint=_endpoint_from_seat(settings,'vision',vision)
        if endpoint.provider=='openclaw':
            raise ValueError('Visual review requires an OpenAI, Anthropic or Gemini native image endpoint')
        return endpoint
    provider=(os.environ.get('ARC_VISION_PROVIDER') or ('claude-code' if second.transport=='cli' else second.provider))
    if provider=='claude-code':
        raise ValueError('Visual review is not available through the Claude Code transport; '
                         'set ARC_VISION_PROVIDER to anthropic or openai with its own credential file')
    model=os.environ.get('ARC_VISION_MODEL','')
    endpoint=(os.environ.get('ARC_VISION_URL') or ENDPOINTS.get(provider,''))
    if not model or not endpoint:
        raise ValueError('Configure ARC_VISION_MODEL and the vision provider endpoint first')
    return ModelEndpoint(provider=provider,endpoint=endpoint,model=model,credential_ref='vision')


LEGACY_REFS=('planner','reviewer','vision','biorender')


def credential_path(name,data=None):
    """Where `arc-science credential --name NAME` stores a credential: one directory,
    one file per name, never a key in the settings."""
    if not name or len(name)>80 or not all(c.isascii() and (c.isalnum() or c in '._-') for c in name):
        raise ValueError('A credential name is 1-80 characters of [A-Za-z0-9._-]')
    return Path(data or os.environ.get('ARC_DATA_DIR','./data'))/'credentials'/(name+'.credential')


def _secret(ref):
    # The credential store first; the legacy environment token files only for the
    # four historical names. A custom name that has no file is an error, never a
    # fall-through to another account's credential.
    named=credential_path(ref)
    if named.is_file():
        value=named.read_text().strip()
        if not value or len(value)>8192:raise ValueError('Provider token file is empty or exceeds limit')
        return value
    if ref not in LEGACY_REFS:
        raise ValueError(f'No credential named {ref}: store it with arc-science credential --name {ref}')
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
    # The data directory is the operator's alone before any secret is written into it;
    # a PermissionError here refuses the start rather than serving with an open token.
    anchored.owner_only(root)
    if token is None:
        token_path=Path(os.environ.get('ARC_TOKEN_FILE',str(root/'access.token')))
        if not token_path.exists():
            token_path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            try:
                with token_path.open('x') as f:f.write(secrets.token_urlsafe(36)+'\n')
            except FileExistsError:pass
        anchored.owner_only(token_path)
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
    def default_preset():
        return ((operator_settings.current() or {}).get('blender') or {}).get('default_preset')
    molecular_jobs=MolecularJobs(root,authorized,default_preset)
    app.state.molecular_jobs=molecular_jobs
    app.include_router(molecular_jobs.router)

    from . import prose as prose_module
    detector=prose_module.Detector(root)
    app.state.detector=detector

    # Prose control: a rule-based local rewrite that never touches scientific content,
    # and third-party detection that needs consent on every request because the text
    # leaves this machine. Neither result is an authorship or validity claim.
    @app.get('/api/prose/rules',dependencies=[Depends(authorized)])
    async def prose_rules():
        return {'rules':list(prose_module.RULE_TABLE),'rules_version':prose_module.RULES_VERSION,
                'protected_classes':[name for name,_ in prose_module.PROTECTED],'protection_version':prose_module.PROTECTION_VERSION,
                **detector.capabilities()}

    def prose_error(refused):
        status={'consent_required':422,'bounds':422,'empty':422,'too_long':422,'refused_instruction':422,'disabled':409,'busy':409,
                'preservation_failed':409,'provenance_missing':409,'audit_key':409,'seat_unavailable':409}.get(refused.code,502)
        raise HTTPException(status,{'code':refused.code,'detail':str(refused),'spans':list(refused.spans)})

    @app.post('/api/prose/rewrite',dependencies=[Depends(authorized)])
    async def prose_rewrite(body:ProseText):
        try:return prose_module.rewrite(body.text)
        except prose_module.ProseRefused as refused:prose_error(refused)

    from . import prose_humane
    humanise_lock=asyncio.Lock()

    @app.get('/api/prose/behaviour',dependencies=[Depends(authorized)])
    async def prose_behaviour():
        return {'version':prose_humane.BEHAVIOUR_VERSION,'text':prose_humane.behaviour_text(),
                'digest':'docs/prose/humane-prose-2026-09-20.md'}

    @app.post('/api/prose/diagnose',dependencies=[Depends(authorized)])
    async def prose_diagnose(body:ProseText):
        # Local counts and ratios; nothing leaves the machine and nothing is a verdict.
        try:return prose_humane.diagnose(body.text)
        except prose_module.ProseRefused as refused:prose_error(refused)

    @app.post('/api/prose/humanise',dependencies=[Depends(authorized)])
    async def prose_humanise(body:ProseHumanise):
        """One consented call to the operator's prose seat under the humane-prose behaviour;
        refused unless every protected span survives byte for byte; one at a time; an
        audit line with a keyed hash of the text, never the text."""
        from .exploration.cli_seats import CliAgent
        try:key=detector._key()
        except prose_module.ProseRefused as refused:prose_error(refused)
        keyed=hmac.new(key,body.text.encode('utf-8'),'sha256').hexdigest()
        audit=root/'prose'/'humanise.jsonl'
        def line(record):
            with audit.open('a',encoding='utf-8') as handle:handle.write(json.dumps({'at':int(time.time()),'text_hmac':keyed,**record},sort_keys=True)+'\n')
        # Policy first: an instruction that asks for detector evasion or impersonation is
        # refused before any seat, consent or lock is involved; one audit record, no text.
        matched=prose_humane.refused_instruction(body.instructions)
        if matched:
            line({'status':'refused_instruction'})
            prose_error(prose_module.ProseRefused('refused_instruction','The instruction asks for detector evasion or impersonation, which this '
                'behaviour does not do; the reader-facing edit is available without it',[{'change':'instruction','class':'refused','literal':matched}]))
        try:cfg=configured_prose_endpoint()
        except Exception as error:raise HTTPException(409,'The prose seat is not usable: '+str(error)[:300]) from None
        if cfg is None:raise HTTPException(409,'Configure the prose seat in the settings before a seat rewrite')
        if cfg.transport=='api':
            # A missing credential is a local prerequisite, not a provider answer.
            try:_secret(cfg.credential_ref)
            except ValueError as error:prose_error(prose_module.ProseRefused('seat_unavailable','The prose seat has no stored credential: '+str(error)[:200]))
        if not body.allow_egress:
            prose_error(prose_module.ProseRefused('consent_required','The text would leave this machine for the '+cfg.provider
                +' seat; send allow_egress: true to consent to this one request'))
        if humanise_lock.locked():prose_error(prose_module.ProseRefused('busy','A seat rewrite is already in flight'))
        async with humanise_lock:
            line({'status':'attempted','provider':cfg.provider,'transport':cfg.transport,'model':cfg.model,'chars':len(body.text)})
            seat=None
            try:
                async with httpx.AsyncClient(trust_env=False) as client:
                    if cfg.transport=='cli':
                        command=claude_code_command() if cfg.provider=='anthropic' else [cfg.endpoint]
                        seat=CliAgent(command,cfg.model,cfg.model,provider=cfg.provider,efforts={'prose':cfg.effort} if cfg.effort else None)
                    else:
                        def resolve(ref,principal,project):
                            style=AUTH_STYLES.get(cfg.provider,'bearer')
                            if cfg.provider=='anthropic' and os.environ.get('ARC_ANTHROPIC_AUTH') in ('oauth','bearer'):style='oauth'
                            return AccessGrant(token=_secret(ref),principal=principal,project_id=project,resource=cfg.endpoint,
                                credential_ref=ref,expires_at=int(time.time())+60,auth_style=style)
                        seat=HTTPAgent(cfg,reviewer_config=cfg,falsifier_config=cfg,client=client,resolver=resolve,project='prose',principal='local-operator')
                    result=await prose_humane.humanise(seat,body.text,body.instructions)
            except prose_module.ProseRefused as refused:
                line({'status':refused.code});prose_error(refused)
            except Exception as error:
                line({'status':'provider_rejected'})
                raise HTTPException(502,{'code':'provider_rejected','detail':'The prose seat did not return a usable edit: '+str(error)[:200],'spans':[]}) from None
            finally:
                if seat is not None and hasattr(seat,'close'):seat.close()
            line({'status':result['status'],'rewritten_sha256':result['rewritten_sha256']})
            return result

    @app.post('/api/prose/detect',dependencies=[Depends(authorized)])
    async def prose_detect(body:ProseDetect):
        # The settings switch is consumed at request time; the environment switch stays.
        current=operator_settings.current()
        if current is not None and not (current.get('prose') or {}).get('detection',True):
            prose_error(prose_module.ProseRefused('disabled','Detection is switched off in the settings'))
        try:return await detector.detect(body.text,allow_egress=body.allow_egress)
        except prose_module.ProseRefused as refused:prose_error(refused)

    # Operator settings: the native supervisor owns the file; the service reads the
    # snapshot and forwards a whole replacement with the revision the operator saw.
    # What the service consumes today, and what is stored for a later loop; the UI
    # shows both so nothing reads as applied when it is not.
    APPLIED={'applied_live':['seats','seats.effort','providers','prose','mcp_servers','acp_agents','viewer','blender'],
             'stored_pending':[],'restart_required':[]}
    settings_writer=asyncio.Semaphore(1)
    @app.get('/api/settings',dependencies=[Depends(authorized)])
    async def settings_snapshot():
        try:snap=await asyncio.to_thread(operator_settings.snapshot)
        except operator_settings.SettingsUnavailable as why:raise HTTPException(503,str(why)) from None
        except (operator_settings.SettingsRejected,ValueError,OSError,subprocess.SubprocessError) as why:raise HTTPException(500,str(why)[:700]) from None
        return {**snap,**APPLIED}

    @app.put('/api/settings',dependencies=[Depends(authorized)])
    async def settings_replace(body:SettingsReplace):
        async with settings_writer:
            try:snap=await asyncio.to_thread(operator_settings.replace,body.settings,body.if_revision)
            except operator_settings.SettingsUnavailable as why:raise HTTPException(503,str(why)) from None
            except operator_settings.SettingsStale as why:raise HTTPException(409,str(why)) from None
            except operator_settings.SettingsRejected as why:raise HTTPException(422,str(why)) from None
            except (ValueError,OSError,subprocess.SubprocessError) as why:raise HTTPException(500,str(why)[:700]) from None
        return {**snap,**APPLIED}

    # Connectors: the operator's connection checks. Listing an MCP server's tools and
    # exchanging `initialize` with an ACP agent send no mission data; consent to send
    # data is a per-entry setting, and every mission call still needs egress consent.
    def connector_entries(key):
        current=operator_settings.current()
        if current is None:raise HTTPException(503,'Settings are not available to this service')
        return [dict(entry) for entry in (current.get(key) or [])]

    @app.post('/api/mcp/servers/check',dependencies=[Depends(authorized)])
    async def mcp_servers():
        from .exploration import mcp_tools
        entries=connector_entries('mcp_servers')
        try:report=await mcp_tools.inspect_servers(entries)
        except RuntimeError as why:raise HTTPException(503,str(why)) from None
        return {'sdk':mcp_tools.sdk_version(),'servers':report,
                'consented':[e['name'] for e in entries if e.get('enabled',True) and e.get('consent')]}

    @app.post('/api/acp/agents/check',dependencies=[Depends(authorized)])
    async def acp_agents():
        from .exploration import acp_client
        entries=connector_entries('acp_agents')
        return {'protocol_version':acp_client.PROTOCOL_VERSION,'agents':await acp_client.inspect_agents(entries),
                'consented':[e['name'] for e in entries if e.get('enabled',True) and e.get('consent')]}

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

    probes={name:None for _,name in CLI_TRANSPORTS.values()}
    transport_cache={}

    def cli_seats():
        """The configured seats that run through a CLI login, by role."""
        first,second=configured_endpoints()
        seats={'planner':first,'reviewer':second,'falsifier':configured_falsifier_endpoint(first,second)}
        return {role:e for role,e in seats.items() if e.transport=='cli'}

    async def cli_transport(provider):
        # Cost-free readiness: executable identity and the CLI's own login state, cached briefly.
        from .exploration import cli_seats as seats_module
        name=CLI_TRANSPORTS[provider][1]
        command=_cli_command(operator_settings.current() or {},provider)
        cached=transport_cache.get(provider)
        if cached is None or time.monotonic()-cached['at']>30:
            value={'transport':name,'provider':provider,'executable':Path(command[0]).name,
                'executable_sha256':await seats_module.executable_digest(command[0]),
                'version':await seats_module.version(command),
                **await seats_module.auth_status(command,provider=provider),
                'checked_at':int(time.time()),'tools':'disabled','network_sandboxed':False,
                'contract':seats_module.FLAVOURS[provider].contract,
                'identity_reported':provider!='openai',
                'note':'logged_in reports that a login exists, not that inference will succeed; run the probe for that'}
            transport_cache[provider]={'at':time.monotonic(),'value':value}
        return {**transport_cache[provider]['value'],'last_probe':probes[name]}

    probe_lock=asyncio.Lock();probe_last={'at':0.0}
    PROBE_COOLDOWN=30.0
    PROBE_INSTRUCTIONS='You are Arc Science\'s readiness probe. Return only the JSON object {"ok": true}.'

    @app.post('/api/providers/{provider}/probe',dependencies=[Depends(authorized)])
    async def probe_cli(provider:str,consent:ProbeRequest=Body(...)):
        """An explicit, token-spending minimal call through the production adapter for every
        distinct (model, effort) among the provider's CLI seats: one probe at a time, with a
        cooldown, and an audit line in the data directory. A pass means reachable, schema-valid
        and the requested selector accepted; identity is verified only where the CLI reports it."""
        from .exploration.cli_seats import CliAgent
        provider='anthropic' if provider=='claude-code' else provider
        if provider not in CLI_TRANSPORTS:raise HTTPException(404,'Unknown CLI transport')
        name=CLI_TRANSPORTS[provider][1]
        if not consent.spend_tokens:raise HTTPException(422,'Confirm spend_tokens=true; a probe makes a real model call per configured model')
        try:seats={role:e for role,e in cli_seats().items() if e.provider==provider}
        except Exception as error:raise HTTPException(409,str(error)) from None
        if not seats:raise HTTPException(409,f'No seat uses the {name} transport')
        if probe_lock.locked():raise HTTPException(409,'A probe is already running')
        if time.monotonic()-probe_last['at']<PROBE_COOLDOWN:raise HTTPException(429,'Probe cooldown: wait before spending again')
        async with probe_lock:
            probe_last['at']=time.monotonic()
            results=[];command=_cli_command(operator_settings.current() or {},provider)
            distinct={}
            for role,e in seats.items():distinct.setdefault((e.model,e.effort),[]).append(role)
            for (model,effort),roles in distinct.items():
                seat=CliAgent(command,model,model,provider=provider,efforts={'probe':effort} if effort else None)
                started=time.monotonic()
                try:
                    await seat._call(model,PROBE_INSTRUCTIONS,{'probe':True},ProbeReply,role='probe')
                    call=seat.calls[-1]
                    results.append({'model':model,'effort':effort,'roles':roles,'ok':True,'observed_model':call['observed_model'],
                                    'identity_verified':call['identity_verified'],'applied_effort':call['applied_effort'],
                                    'duration_ms':int((time.monotonic()-started)*1000)})
                except Exception as error:
                    results.append({'model':model,'effort':effort,'roles':roles,'ok':False,'error':redact(str(error))[:300],
                                    'duration_ms':int((time.monotonic()-started)*1000)})
                finally:seat.close()
            probes[name]={'at':int(time.time()),'transport':name,'provider':provider,'results':results}
            audit=root/'providers'/(name+'-probes.jsonl')
            audit.parent.mkdir(parents=True,exist_ok=True)
            with audit.open('a',encoding='utf-8') as log:log.write(json.dumps(probes[name])+'\n')
            return probes[name]

    @app.get('/api/capabilities',dependencies=[Depends(authorized)])
    async def capabilities():
        try:
            first,second=live_seats_ready()
            third=configured_falsifier_endpoint(first,second)
            live={'configured':True,'planner':first.model,'reviewer':second.model,'provider':first.provider,
                  'auth':'cli' if first.transport=='cli' else 'api_key',
                  'seats':{role:{'provider':e.provider,'transport':e.transport,'model':e.model,'effort':e.effort}
                           for role,e in (('planner',first),('reviewer',second),('falsifier',third))}}
            if first.transport=='cli':live['transport']=await cli_transport(first.provider)
            transports={}
            for e in (first,second,third):
                if e.transport=='cli' and e.provider not in transports:transports[e.provider]=await cli_transport(e.provider)
            live['transports']=transports
        except Exception:live={'configured':False}
        try:
            vision=configured_vision_endpoint();_secret(vision.credential_ref)
            visual={'configured':True,'provider':vision.provider,'model':vision.model}
        except Exception:visual={'configured':False}
        try:biorender=biorender_configuration()
        except Exception:biorender={'enabled':os.environ.get('ARC_BIORENDER_READS')=='1',
                                   'configured':False,'live_qualified':False}
        from .exploration import mcp_tools
        current=operator_settings.current() or {}
        def summary(key):
            entries=current.get(key) or []
            return {'configured':len(entries),'consented':len([e for e in entries if e.get('enabled',True) and e.get('consent')])}
        try:prose_seat=configured_prose_endpoint()
        except Exception:prose_seat=None
        prose_summary={'configured':prose_seat is not None}
        if prose_seat:
            prose_summary.update(provider=prose_seat.provider,transport=prose_seat.transport,model=prose_seat.model)
            if prose_seat.transport=='api':
                # Whether the named credential is stored; nothing about its validity.
                try:_secret(prose_seat.credential_ref);prose_summary['credential']='stored'
                except ValueError:prose_summary['credential']='missing'
        return {'version':VERSION,'live':live,'vision':visual,
                'prose_seat':prose_summary,
                'connectors':{'mcp':{**summary('mcp_servers'),'sdk':mcp_tools.sdk_version()},'acp':summary('acp_agents')},
                'numeric_tools':['describe_data','polynomial_fit','permutation_control'],
                'public_network_tools_enabled':os.environ.get('ARC_PUBLIC_READS')=='1',
                'biorender':biorender,
                'blender':'batch adapter retained; renderer availability must be checked separately',
                'prose':detector.capabilities(),
                'publication_authorization':False}

    @app.post('/api/missions',status_code=201,dependencies=[Depends(authorized)])
    async def new_mission(request:MissionRequest,idempotency_key:str|None=Header(default=None)):
        if request.mode=='live':
            try:live_seats_ready()
            except Exception:raise HTTPException(409,'Configure model endpoints and server-side credential files before live use') from None
            if request.vision_review:
                try:_secret(configured_vision_endpoint().credential_ref)
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
        obligations={change.id:list(obligation_states(change,decision)) for change in state.changes}
        return {**row,'release':decision.model_dump(mode='json'),'change_obligations':obligations}

    @app.get('/api/missions/{mid}',dependencies=[Depends(authorized)])
    async def read_mission(mid:str):return with_release(get(mid))

    @app.get('/api/missions/{mid}/release',dependencies=[Depends(authorized)])
    async def read_release(mid:str):return with_release(get(mid))['release']

    @app.get('/api/missions/{mid}/evidence',dependencies=[Depends(authorized)])
    async def read_evidence(mid:str):
        return evidence_graph(MissionState.model_validate(get(mid)['state']))

    async def worker(mid,route=None):
        row=repository.get(mid);revision=row['revision']
        request=MissionRequest.model_validate(row['request'])
        def emit(state):
            nonlocal revision
            fresh=repository.save(mid,state,expected_revision=revision);revision=fresh['revision']
            # Best-effort capture off the event loop: blocking worker stdio must not
            # stall mission progress, status polling or cancellation.
            memory_routes.schedule_capture(mid,state)
        def cancelled():return repository.get(mid)['state']['status']=='cancelled'
        agent=None;consultations=None;mcp=None
        try:
            async with httpx.AsyncClient(trust_env=False) as client:
                tools=TrustedPublicTools()
                if request.mode=='demo':agent=DemoVisionAgent() if request.vision_review else DemoAgent()
                else:
                    # The snapshot bound when the mission was scheduled, never the current settings.
                    seats=route['seats']
                    first,second,third=seats['planner'],seats['reviewer'],seats['falsifier']
                    vision=seats.get('vision') if request.vision_review else None
                    def resolve(ref,principal,project):
                        cfg={'planner':first,'vision':vision,'falsifier':third}.get(ref,second)
                        if ref not in ('planner','reviewer','vision','falsifier','biorender'):cfg=next((c for c in (first,second,third,vision) if c and c.credential_ref==ref),second)
                        style=AUTH_STYLES.get(cfg.provider,'bearer')
                        if cfg.provider=='anthropic' and os.environ.get('ARC_ANTHROPIC_AUTH') in ('oauth','bearer'):style='oauth'
                        return AccessGrant(token=_secret(ref),principal=principal,project_id=project,resource=cfg.endpoint,
                            credential_ref=ref,expires_at=int(time.time())+60,auth_style=style)
                    from .exploration.cli_seats import CliAgent
                    from .exploration.providers import SeatAgent
                    # The visual seat, when configured, is always a native image endpoint.
                    visual=HTTPAgent(vision,reviewer_config=vision,vision_config=vision,client=client,
                                     resolver=resolve,project=mid,principal='local-operator') if vision else None
                    def seat_for(role,cfg):
                        if cfg.transport=='cli':
                            command=claude_code_command() if cfg.provider=='anthropic' else [cfg.endpoint]
                            return CliAgent(command,cfg.model,cfg.model,provider=cfg.provider,falsifier_model=cfg.model,
                                            efforts={role:cfg.effort} if cfg.effort else None)
                        return HTTPAgent(cfg,reviewer_config=cfg,falsifier_config=cfg,client=client,resolver=resolve,
                                         project=mid,principal='local-operator')
                    agent=SeatAgent({role:seat_for(role,cfg) for role,cfg in (('planner',first),('reviewer',second),('falsifier',third))},
                                    vision=visual)
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
                    # The consented connectors bound with the route, for this mission only: MCP
                    # sessions open now and close with the mission; ACP agents start on first use.
                    from .exploration.acp_client import AcpConsultations
                    from .exploration.mcp_tools import McpToolset
                    consultations=AcpConsultations([{**a,'consent':True} for a in route['acp_agents']])
                    servers=[{**s,'consent':True} for s in route['mcp_servers']]
                    mcp=McpToolset(servers) if servers else None
                    for name,binding in consultations.tools.items():
                        if name in tools:raise ValueError('Connector tool name collides: '+name)
                        tools[name]=binding
                if mcp is not None:
                    async with mcp:
                        for name,binding in mcp.tools.items():
                            if name in tools:raise ValueError('Connector tool name collides: '+name)
                            tools[name]=binding
                        await explore(request,agent,initial=MissionState.model_validate(row['state']),emit=emit,cancelled=cancelled,extra_tools=tools)
                else:
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
            if consultations is not None:await consultations.close()
            fresh=repository.get(mid)
            memory_routes.schedule_capture(mid,MissionState.model_validate(fresh['state']))
            running.pop(mid,None)

    def record_resume(row,declared,note):
        # Resuming is a declared change: it is recorded on the mission, bound to the
        # event history, and every release check goes stale until re-verified.
        state,change=declare_resume(MissionState.model_validate(row['state']),declared,note)
        if state.release is not None:
            state=state.model_copy(update={'release':release_ledger.invalidate_release(state.release,RESUME_STALE,
                'Declared change '+change.id[:8]+' (resume): '+', '.join(change.derived_effects)+'; verify again after the mission stops.')})
        try:repository.save(row['id'],state,expected_revision=row['revision'])
        except RevisionConflict:raise HTTPException(409,'Mission changed; retry') from None
        return change

    def schedule(row,declared=None,note=''):
        """The one path that starts or resumes a mission: the live route is checked against
        the plan bound at the first start before anything is written; then the resume is
        recorded, the plan bound if this is the first start, and the worker scheduled with
        the same immutable snapshot of the seats."""
        request=MissionRequest.model_validate(row['request']);route=None
        if request.mode=='live':
            try:route=live_route(request.vision_review)
            except Exception as error:raise HTTPException(409,'Configure the model seats before starting: '+str(error)[:300]) from None
            route_digest,detail=seat_plan(route)
            state=MissionState.model_validate(row['state'])
            bound=next((e for e in reversed(state.events) if e.kind=='seats_bound'),None)
            if bound is not None and not bound.detail.startswith('sha256:'+route_digest+' '):
                raise HTTPException(409,'The model seats or connectors changed since this mission was first started; a permission change is a '
                                        'separate authorization: restore the seats or create a new mission')
        change=None
        if row['state']['status']=='paused':
            change=record_resume(row,declared if declared is not None else MISSION_CHANGES['resume']['derived'],note or 'Resumed from the workspace.')
            row=get(row['id'])
        if route is not None and bound is None:
            state=MissionState.model_validate(row['state'])
            state=state.model_copy(update={'events':state.events+(Event(kind='seats_bound',round=state.round,detail=detail[:1200]),)})
            try:repository.save(row['id'],state,expected_revision=row['revision'])
            except RevisionConflict:raise HTTPException(409,'Mission changed; retry') from None
        running[row['id']]=asyncio.create_task(worker(row['id'],route))
        return change

    @app.post('/api/missions/{mid}/start',status_code=202,dependencies=[Depends(authorized)])
    async def start(mid:str):
        row=get(mid)
        if mid in running or row['state']['status'] not in ('ready','paused'):
            raise HTTPException(409,'Only ready or interrupted missions can start or resume')
        schedule(row)
        return {'id':mid,'status':'scheduled'}

    @app.get('/api/changes',dependencies=[Depends(authorized)])
    async def change_kinds():
        return {kind:{'applies':entry['applies'],'derived_effects':list(entry['derived']),'reason':entry['reason']}
                for kind,entry in MISSION_CHANGES.items()}

    @app.post('/api/missions/{mid}/changes',status_code=202,dependencies=[Depends(authorized)])
    async def declare_change(mid:str,declaration:ChangeDeclaration=Body(...)):
        row=get(mid)
        # The declaration is checked before anything moves; a refusal names the table's reason.
        try:derived,checks=mission_change(declaration.kind,declaration.declared_effects)
        except ChangeRefused as refused:raise HTTPException(409,str(refused)) from None
        if mid in running or row['state']['status']!='paused':
            raise HTTPException(409,'Only an interrupted mission can be resumed')
        change=schedule(row,declaration.declared_effects,declaration.note)
        return {'id':mid,'status':'scheduled','change':change.model_dump(mode='json')}

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
        if state.status in ('completed','budget_exhausted','needs_input') and (
                state.claim_scope is None or state.claim_scope.derivation_version!=CLAIM_DERIVATION_VERSION):
            # A mission that stopped before claim scopes existed, or under an earlier
            # derivation rule, gets its scope derived here under the current rule: the only
            # bounded write verification makes besides the ledger itself.
            state=state.model_copy(update={'claim_scope':derive_claim_scope(state)})
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
