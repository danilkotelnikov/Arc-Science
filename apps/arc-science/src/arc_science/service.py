"""Single-laboratory Arc Science service. Run one worker per state directory."""
from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager, suppress
import functools
import os
from pathlib import Path
import secrets
import shlex
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
from .transport import AccessGrant, ProviderError
from .grants import GrantLedger
from .exploration.models import Event, MissionRequest, MissionState
from .exploration.engine import initialize, explore, MissionCancelled
from .exploration.agents import DemoAgent, DemoVisionAgent
from .exploration.providers import HTTPAgent, ModelEndpoint
from .exploration.cli_seats import redact
from .credentials import credential_path, credential_source, read_credential_manager
from .readiness import INHERITS, endpoint_confirmed, origin
from . import anchored
from . import settings as operator_settings
from .exploration.changes import ChangeRefused, MISSION_CHANGES, RESUME_STALE, declare_resume, mission_change, obligation_states
from .exploration.claim_scope import DERIVATION_VERSION as CLAIM_DERIVATION_VERSION, derive_claim_scope
from .exploration.repository import MissionRepository, MissionFinished, RevisionConflict
from .exploration.timeline import CURRENT_OP, MissionTimeline
from .exploration.capsule import export_capsule, verify_capsule
from .exploration import release as release_ledger
from .exploration.evidence import evidence_graph
from .exploration.catalog import TrustedPublicTools
from .diagnostics import host_session

VERSION=__version__
NATIVE_SESSION_ENV='ARC_NATIVE_SESSION_SECRET'


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

class GrantRequest(BaseModel):
    destination:str=Field(min_length=1,max_length=400)
    destination_kind:str=Field(min_length=1,max_length=20)
    data_category:str=Field(default='',max_length=200)
    purpose:str=Field(default='',max_length=200)
    scope:str='mission'

class StartRequest(BaseModel):
    """The operator's approval of the previewed route: its digest and one grant per destination."""
    approved_route_digest:str=Field(min_length=64,max_length=64,pattern=r'^[0-9a-f]{64}$')
    grants:list[GrantRequest]=Field(default_factory=list,max_length=64)

class RevokeRequest(BaseModel):
    reason:str=Field(default='',max_length=400)


def _configured_native_session_secret():
    value=os.environ.get(NATIVE_SESSION_ENV)
    if value is None:return None
    if value!=value.strip():return None
    if len(value)<43:return None
    if len(value)>256:return None
    if any(ord(character)<33 or ord(character)>126 for character in value):return None
    return value


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
    providers=settings.get('providers') or {};entry=providers.get(provider) or {}
    endpoint=entry.get('endpoint') or ENDPOINTS.get(provider,'')
    if not endpoint:raise ValueError(f'providers.{provider}.endpoint is not set')
    # A credential goes only where the operator confirmed: the official origin, or a custom
    # one ticked under Advanced (OpenClaw endpoints are custom by nature).
    if endpoint_confirmed(provider,entry) is False:
        raise ValueError(f'providers.{provider}.endpoint {origin(endpoint)} is not the official origin; confirm it under Advanced before a credential is sent there')
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
    # A role without a seat of its own uses another role's seat, credential included:
    # the seat is built under the owning role so its credential reference stays the owner's.
    reviewer=('reviewer',operator_settings.seat(settings,'reviewer')) if operator_settings.seat(settings,'reviewer') else ('planner',planner)
    falsifier=('falsifier',operator_settings.seat(settings,'falsifier')) if operator_settings.seat(settings,'falsifier') else reviewer
    # Every seat is its own transport; mixing CLI logins and API credentials is allowed.
    return (_endpoint_from_seat(settings,'planner',planner),_endpoint_from_seat(settings,*reviewer),
            _endpoint_from_seat(settings,*falsifier))


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


# What each kind of destination receives under a mission grant, in the operator's words.
SEAT_CATEGORY='mission goal, dataset points, prior observations and assessments';SEAT_PURPOSE='planning, review and refutation'
CONNECTOR_CATEGORY='tool arguments the planner chooses';PUBLIC_READ_CATEGORY='query text the planner chooses'
BIORENDER_CATEGORY='template search terms the planner chooses'
# The origin each shipped public-read tool reaches (public_reads.py fixes the URLs).
PUBLIC_READ_ORIGINS={'literature_search':'https://www.ebi.ac.uk','pdb_metadata':'https://data.rcsb.org'}


def seat_destination(cfg):
    """Where a seat call goes: the endpoint origin of an API seat, the executable of a CLI login."""
    return cfg.endpoint if cfg.transport=='cli' else origin(cfg.endpoint)


def connector_destination(entry):
    """Where a connector call goes: the url of an HTTP server, else the whole command line.
    The launcher alone (npx, uvx, python) is shared by unrelated servers, so the arguments
    are part of the identity a grant names."""
    if entry.get('transport')=='http':return entry['url']
    return (entry.get('command','')+' '+shlex.join(entry.get('args') or [])).strip()


def route_preview(route,settings_revision=None):
    """The grants a live route needs before its first start, one per destination, from the
    same snapshot `seat_plan` digests: seats, consented connectors, public reads and
    BioRender when enabled. Passive: nothing is called and no secret is read."""
    route_digest,_=seat_plan(route)
    seats=[{'role':role,'provider':e.provider,'transport':e.transport,'model':e.model,'effort':e.effort,'destination':seat_destination(e),
            'destination_kind':'seat','data_category':SEAT_CATEGORY,'purpose':SEAT_PURPOSE} for role,e in route['seats'].items()]
    connectors=[{'name':s['name'],'kind':'mcp','destination':connector_destination(s),'destination_kind':'mcp',
                 'data_category':CONNECTOR_CATEGORY,'purpose':'tool call'} for s in route['mcp_servers']]
    connectors+=[{'name':a['name'],'kind':'acp','destination':connector_destination(a),'destination_kind':'acp',
                  'data_category':CONNECTOR_CATEGORY,'purpose':'consultation'} for a in route['acp_agents']]
    public_reads=[{'destination':o,'destination_kind':'public_read','data_category':PUBLIC_READ_CATEGORY,'purpose':'public metadata read'}
                  for o in dict.fromkeys(PUBLIC_READ_ORIGINS.values())] if os.environ.get('ARC_PUBLIC_READS')=='1' else []
    biorender=None
    if os.environ.get('ARC_BIORENDER_READS')=='1':
        from .biorender import BIORENDER_ENDPOINT
        biorender={'destination':BIORENDER_ENDPOINT,'destination_kind':'biorender','data_category':BIORENDER_CATEGORY,'purpose':'template search'}
    required={}
    for entry in seats+connectors+public_reads+([biorender] if biorender else []):
        required.setdefault((entry['destination'],entry['destination_kind']),
                            {**{k:entry[k] for k in ('destination','destination_kind','data_category','purpose')},'scope':'mission'})
    return {'settings_revision':settings_revision,'route_digest':route_digest,'seats':seats,'connectors':connectors,
            'public_reads':public_reads,'biorender':biorender,'required_grants':list(required.values())}


def request_grant(ledger,destination,destination_kind,data_category,purpose,request_digest=None):
    """One consented request outside a mission (prose seat, detector, BioArt): a 'once'
    grant reserved now, and a receipt when the returned finish(outcome, reason) is called."""
    grant=ledger.create(subject_kind='request',subject_id=uuid.uuid4().hex,destination=destination,destination_kind=destination_kind,
                        data_category=data_category,purpose=purpose,scope='once',route_digest='',settings_revision='',source='operator-ui',max_uses=1)
    ledger.reserve(grant['id'])
    def finish(outcome,reason=''):
        ledger.receipt(grant_id=grant['id'],mission_id=None,destination=destination,destination_kind=destination_kind,data_category=data_category,
                       outcome=outcome,reason=str(reason)[:300],request_digest=request_digest,observation_id=None,role=None)
    return finish


class GuardedSeatAgent:
    """A SeatAgent whose every call passes the grant ledger first: guard(role, call, *args)
    refuses or records; everything else is the inner agent's."""
    def __init__(self,inner,guard):self.inner=inner;self.guard=guard
    def __getattr__(self,name):return getattr(self.inner,name)
    async def propose(self,context):return await self.guard('planner',self.inner.propose,context)
    async def assess(self,role,context):return await self.guard(role,self.inner.assess,role,context)
    async def review_visual(self,context,artifacts):return await self.guard('vision',self.inner.review_visual,context,artifacts)


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


def _secret(ref):
    # The credential file first, then the Windows Credential Manager, then the legacy
    # environment token files only for the four historical names. A custom name stored
    # nowhere is an error, never a fall-through to another account's credential.
    named=credential_path(ref)
    if named.is_file():value=named.read_text()
    elif (stored:=read_credential_manager(ref)) is not None:value=stored
    elif ref not in LEGACY_REFS:
        raise ValueError(f'No credential named {ref}: store it with arc-science credential --name {ref}')
    else:
        if ref=='biorender':
            path=os.environ.get('ARC_BIORENDER_TOKEN_FILE')
        elif ref=='vision':
            path=(os.environ.get('ARC_VISION_TOKEN_FILE') or os.environ.get('ARC_REVIEWER_TOKEN_FILE')
                  or os.environ.get('ARC_MODEL_TOKEN_FILE'))
        else:
            name='ARC_REVIEWER_TOKEN_FILE' if ref=='reviewer' else 'ARC_MODEL_TOKEN_FILE'
            path=os.environ.get(name) or os.environ.get('ARC_MODEL_TOKEN_FILE')
        if not path:raise ValueError('Provider token file is not configured')
        value=Path(path).read_text()
    value=value.strip()
    if not value or len(value)>8192:raise ValueError('Provider token file is empty or exceeds limit')
    return value


def access_grant(cfg,ref,principal,project):
    """A 60 s grant for one API seat in the provider's official header style (x-api-key
    for Anthropic, x-goog-api-key for Gemini, a Bearer otherwise); the secret is read
    when the grant is made and held by nothing else."""
    return AccessGrant(token=_secret(ref),principal=principal,project_id=project,resource=cfg.endpoint,
        credential_ref=ref,expires_at=int(time.time())+60,auth_style=AUTH_STYLES.get(cfg.provider,'bearer'))


def credential_stored(ref):
    """Whether a credential is stored under the name; nothing about its validity, and
    the value never leaves this function. A store that cannot be read raises OSError so
    readiness can say so instead of "missing"."""
    try:_secret(ref);return True
    except ValueError:return False


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
    started_at=int(time.time())
    root=Path(data_dir or os.environ.get('ARC_DATA_DIR','./data')).resolve()
    root.mkdir(parents=True,exist_ok=True,mode=0o700)
    # The data directory is the operator's alone before any secret is written into it;
    # a PermissionError here refuses the start rather than serving with an open token.
    anchored.owner_only(root)
    if token is None:
        # ARC_TOKEN_FILE may point outside the data directory; then only the file is
        # restricted, and its directory must already be the operator's own (a principal
        # with create or delete rights there could replace the file). The default lives
        # in the restricted data directory.
        token_path=Path(os.environ.get('ARC_TOKEN_FILE',str(root/'access.token')))
        if not token_path.exists():
            token_path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            try:
                with token_path.open('x') as f:f.write(secrets.token_urlsafe(36)+'\n')
            except FileExistsError:pass
        anchored.owner_only(token_path)
        token=token_path.read_text().strip()
    if len(token)<32:raise ValueError('Use a randomly generated API token of at least 32 characters')
    native_session_secret=_configured_native_session_secret()
    repository=MissionRepository(root/'missions.db');running={}
    # The grant ledger is operational and append-only, apart from the mission state and its chain.
    ledger=GrantLedger(root/'grants.db');consented=functools.partial(request_grant,ledger)
    # The operational timeline: when each operation started and ended; never evidence.
    timeline=MissionTimeline(root/'timeline.db')
    INTERRUPTED=('Service exit noticed; the mission was running and is now paused (event mission_interrupted). '
                 'Rows above without a recorded outcome were abandoned.')

    @asynccontextmanager
    async def lifespan(app):
        for mid in repository.pause_interrupted():
            timeline.record(mid,operation='interrupt',role='service',source='service',outcome='interrupted',detail=INTERRUPTED)
        memory_routes.schedule_reconcile()
        yield
        await molecular_jobs.close()
        for task in tuple(running.values()):task.cancel()
        for task in tuple(running.values()):
            with suppress(asyncio.CancelledError):await task
        for mid in repository.pause_interrupted():
            timeline.record(mid,operation='interrupt',role='service',source='service',outcome='interrupted',detail=INTERRUPTED)
        # Capture final paused/cancelled/error snapshots, then drain the single
        # capture worker before closing its stdio process.
        memory_routes.schedule_reconcile()
        await asyncio.to_thread(memory_routes.close)

    app=FastAPI(title='Arc Science',version=VERSION,lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
    app.state.repository=repository
    app.state.running=running
    app.state.grants=ledger
    app.state.timeline=timeline

    async def authorized(authorization:str|None=Header(default=None),
                         x_arc_native_session:str|None=Header(default=None)):
        # 'token' (Operator token) or 'native' (Desktop session); dependencies=[...] callers ignore it.
        expected='Bearer '+token
        if authorization and secrets.compare_digest(authorization,expected):return 'token'
        if (native_session_secret and x_arc_native_session and
                secrets.compare_digest(x_arc_native_session,native_session_secret)):
            return 'native'
        raise HTTPException(401,'Authentication required',headers={'WWW-Authenticate':'Bearer'})

    @app.get('/api/session/status',dependencies=[Depends(authorized)])
    async def session_status():
        return {'status':'authorized'}

    from .bioart.web import create_router as create_bioart_router
    # The BioArt cache lives inside the project; under the native supervisor the
    # project is the workspace (ARC_PROJECT) and the cache path it passes is absolute
    # under that workspace, not under the data directory.
    bioart_project=Path(os.environ.get('ARC_PROJECT') or root)
    app.include_router(create_bioart_router(bioart_project if bioart_project.is_dir() else root,authorized,egress=consented))

    from .molecular_jobs import MolecularJobs
    def default_preset():
        return ((operator_settings.current() or {}).get('blender') or {}).get('default_preset')
    molecular_jobs=MolecularJobs(root,authorized,default_preset)
    app.state.molecular_jobs=molecular_jobs
    app.include_router(molecular_jobs.router)

    from . import prose as prose_module
    detector=prose_module.Detector(root);detector.egress=consented
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
            # The consent is also a once-scoped grant in the ledger, with its receipt.
            finish=consented(seat_destination(cfg),'prose','the submitted text and instructions','a reader-facing edit by the prose seat',keyed)
            seat=None
            try:
                async with httpx.AsyncClient(trust_env=False) as client:
                    if cfg.transport=='cli':
                        command=claude_code_command() if cfg.provider=='anthropic' else [cfg.endpoint]
                        seat=CliAgent(command,cfg.model,cfg.model,provider=cfg.provider,efforts={'prose':cfg.effort} if cfg.effort else None)
                    else:
                        seat=HTTPAgent(cfg,reviewer_config=cfg,falsifier_config=cfg,client=client,project='prose',principal='local-operator',
                                       resolver=lambda ref,principal,project:access_grant(cfg,ref,principal,project))
                    result=await prose_humane.humanise(seat,body.text,body.instructions)
            except prose_module.ProseRefused as refused:
                finish('failed',refused.code);line({'status':refused.code});prose_error(refused)
            except Exception as error:
                finish('failed','provider_rejected');line({'status':'provider_rejected'})
                raise HTTPException(502,{'code':'provider_rejected','detail':'The prose seat did not return a usable edit: '+str(error)[:200],'spans':[]}) from None
            finally:
                if seat is not None and hasattr(seat,'close'):seat.close()
            finish('ok');line({'status':result['status'],'rewritten_sha256':result['rewritten_sha256']})
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
    # Every section is consumed when it is next read, so a save reports which sections
    # changed and when each takes effect; nothing in this build needs a restart.
    ROUTE_NOTE='Missions already bound to a route keep it; a changed route blocks their resume until it is restored.'
    EFFECTS={'seats':('next live mission start',ROUTE_NOTE),'providers':('next live mission start',ROUTE_NOTE),
             'mcp_servers':('next live mission start',ROUTE_NOTE),'acp_agents':('next live mission start',ROUTE_NOTE),
             'prose':('next prose request','Detection and the prose seat read the settings on each request.'),
             'blender':('next render submission','The default preset is read when a render is submitted.'),
             'viewer':('next Molecules session','The Molecules workspace reads viewer defaults when its session token changes; this build does not reload them on save.')}
    APPLIED={'restart_required':[],'restart_note':'No setting in this build needs a restart.'}
    def settings_changed(before,after):
        changed=[]
        for section in ('seats','providers'):
            old=before.get(section) or {};new=after.get(section) or {}
            changed+=[section+'.'+name for name in sorted(set(old)|set(new)) if old.get(name)!=new.get(name)]
        changed+=[section for section in ('mcp_servers','acp_agents','prose','blender','viewer') if before.get(section)!=after.get(section)]
        return changed
    async def settings_report(snap,changed):
        effects=[{'section':section,'applies':EFFECTS[section.split('.')[0]][0],'note':EFFECTS[section.split('.')[0]][1]} for section in changed]
        return {**snap,**APPLIED,'changed':changed,'effects':effects,'applied_live':changed,
                'bound_missions':await asyncio.to_thread(repository.count_bound_live)}
    settings_writer=asyncio.Semaphore(1)
    @app.get('/api/settings',dependencies=[Depends(authorized)])
    async def settings_snapshot():
        try:snap=await asyncio.to_thread(operator_settings.snapshot)
        except operator_settings.SettingsUnavailable as why:raise HTTPException(503,str(why)) from None
        except (operator_settings.SettingsRejected,ValueError,OSError,subprocess.SubprocessError) as why:raise HTTPException(500,str(why)[:700]) from None
        return await settings_report(snap,[])

    @app.put('/api/settings',dependencies=[Depends(authorized)])
    async def settings_replace(body:SettingsReplace):
        async with settings_writer:
            try:
                before=(await asyncio.to_thread(operator_settings.snapshot))['settings']
                snap=await asyncio.to_thread(operator_settings.replace,body.settings,body.if_revision)
            except operator_settings.SettingsUnavailable as why:raise HTTPException(503,str(why)) from None
            except operator_settings.SettingsStale as why:raise HTTPException(409,str(why)) from None
            except operator_settings.SettingsRejected as why:raise HTTPException(422,str(why)) from None
            except (ValueError,OSError,subprocess.SubprocessError) as why:raise HTTPException(500,str(why)[:700]) from None
        return await settings_report(snap,settings_changed(before,snap['settings']))

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

    def health_document():
        # host_session says who started the service (the desktop marks its own child); it is
        # read from the environment on every call and is never authentication.
        return {'status':'ready','version':VERSION,'deployment':'single-trust-domain','host_session':host_session()}

    @app.get('/health')
    async def health(response:Response):
        # Public compatibility marker for the local desktop, never authentication.
        response.headers['X-Arc-Science-Service']='arc-science-v1'
        return health_document()

    @app.get('/api/missions',dependencies=[Depends(authorized)])
    async def list_missions():return repository.list()

    def settings_revision():
        try:return operator_settings.snapshot().get('revision')
        except Exception:return None

    # Registered before /api/missions/{mid}: the route a live mission would bind now and
    # the grants it needs, for the operator to approve; passive.
    @app.get('/api/missions/preview',dependencies=[Depends(authorized)])
    async def mission_preview(vision_review:int=0):
        try:route=live_route(bool(vision_review))
        except Exception as error:raise HTTPException(409,'Configure the model seats before starting: '+str(error)[:300]) from None
        return route_preview(route,settings_revision())

    @app.get('/api/missions/{mid}/grants',dependencies=[Depends(authorized)])
    async def mission_grants(mid:str):
        get(mid)
        # The ledger clamps at 1000 receipts; a longer mission says so instead of dropping silently.
        receipts=ledger.receipts(mission_id=mid,limit=1000)
        return {'grants':ledger.list('mission',mid),'receipts':receipts,'receipts_truncated':len(receipts)>=1000}

    @app.get('/api/missions/{mid}/timeline',dependencies=[Depends(authorized)])
    async def mission_timeline(mid:str):
        get(mid);rows=timeline.rows(mid)
        return {'mission_id':mid,'kind':'operational','recorded':bool(rows),'count':len(rows),'rows':rows,
                'note':'Operational record written by the service worker and operator routes; not scientific evidence. '
                       'A row whose outcome is not recorded is in flight while the mission status is running; '
                       'otherwise it was abandoned by a pause, a cancellation or a service exit.'}

    @app.get('/api/missions/{mid}/claims',dependencies=[Depends(authorized)])
    async def mission_claims(mid:str):
        # Derived on read from the persisted claim scope, the timeline and the evidence graph.
        from .exploration.claims import build_claims, route_states
        row,state=with_release(get(mid))
        try:graph=evidence_graph(state)
        except ValueError:graph=None
        # 'routes' is additive and read-only here; the capsule's claims.json is unchanged.
        return {'mission_id':mid,**build_claims(state,timeline.rows(mid),graph,row['release']),'routes':route_states(state)}

    @app.get('/api/grants',dependencies=[Depends(authorized)])
    async def list_grants(subject_kind:str|None=None,subject_id:str|None=None):
        return ledger.list(subject_kind or None,subject_id or None)

    @app.post('/api/grants/{grant_id}/revoke',dependencies=[Depends(authorized)])
    async def revoke_grant(grant_id:str,body:RevokeRequest=Body(default=RevokeRequest())):
        # Idempotent: the next call of a running mission under this grant is refused and recorded.
        try:return ledger.revoke(grant_id,body.reason)
        except KeyError:raise HTTPException(404,'Unknown grant') from None

    # The last probe record per CLI transport name and, for API subjects, per provider.
    PROVIDERS=('anthropic','openai','gemini','openclaw')
    probes={name:None for _,name in CLI_TRANSPORTS.values()}|{provider:None for provider in PROVIDERS}
    transport_cache={}

    def provider_seats(settings,provider):
        """Every configured seat on one provider by role, an inherited seat under its owner
        (so it shares the owner's subject); a seat the service cannot build raises its
        reason. A vision seat readiness refuses (CLI login, OpenClaw) is left out."""
        seats={}
        for role in ('planner','reviewer','falsifier','vision','prose'):
            owner=next((r for r in (role,)+INHERITS.get(role,()) if operator_settings.seat(settings,r)),None)
            seat=operator_settings.seat(settings,owner) if owner else None
            if not seat or seat['provider']!=provider:continue
            if role=='vision' and (seat.get('auth')=='cli' or provider=='openclaw'):continue
            seats[role]=_endpoint_from_seat(settings,owner,seat)
        if not operator_settings.seat(settings,'planner'):
            # No planner in the settings: the environment route, when it is configured at all.
            with suppress(ValueError):
                first,second=configured_endpoints(settings)
                seats.update(planner=first,reviewer=second,falsifier=configured_falsifier_endpoint(first,second,settings))
        return {role:e for role,e in seats.items() if e.provider==provider}

    async def cli_transport(provider,fresh=False):
        # Cost-free readiness: executable identity and the CLI's own login state, cached briefly.
        from .exploration import cli_seats as seats_module
        name=CLI_TRANSPORTS[provider][1]
        command=_cli_command(operator_settings.current() or {},provider)
        cached=transport_cache.get(provider)
        if fresh or cached is None or time.monotonic()-cached['at']>30:
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
    async def probe_provider(provider:str,consent:ProbeRequest=Body(...)):
        """An explicit, token-spending minimal call through the production adapter for every
        distinct subject among the provider's seats (planner, reviewer, falsifier, vision,
        prose; an inherited seat under its owner): CLI subjects through the CLI seat, API
        subjects through one text-only HTTP call with the same grant a mission uses. One
        probe at a time, with a cooldown, and an audit line per transport in the data
        directory. A pass means reachable, schema-valid and the requested selector accepted;
        identity is verified where the CLI or the response reports it."""
        from .exploration.cli_seats import CliAgent, executable_digest
        from .readiness import subject as probe_subject, subject_digest
        provider='anthropic' if provider=='claude-code' else provider
        if provider not in PROVIDERS:raise HTTPException(404,'Unknown provider')
        name=CLI_TRANSPORTS[provider][1] if provider in CLI_TRANSPORTS else None
        if not consent.spend_tokens:raise HTTPException(422,'Confirm spend_tokens=true; a probe makes a real model call per configured model')
        settings=operator_settings.current() or {}
        try:seats=provider_seats(settings,provider)
        except Exception as error:raise HTTPException(409,str(error)) from None
        if not seats:raise HTTPException(409,f'No seat uses the provider {provider}')
        if probe_lock.locked():raise HTTPException(409,'A probe is already running')
        if time.monotonic()-probe_last['at']<PROBE_COOLDOWN:raise HTTPException(429,'Probe cooldown: wait before spending again')
        async with probe_lock:
            probe_last['at']=time.monotonic()
            command=_cli_command(settings,provider) if any(e.transport=='cli' for e in seats.values()) else None
            executable_sha256=await executable_digest(command[0]) if command else None
            # The subject names what a result verifies; readiness matches a seat to it by digest.
            distinct={}
            for role,e in seats.items():
                verified=(probe_subject(provider,'cli',e.model,e.effort,executable_sha256=executable_sha256) if e.transport=='cli'
                          else probe_subject(provider,'api',e.model,e.effort,endpoint=origin(e.endpoint),credential_ref=e.credential_ref))
                distinct.setdefault(subject_digest(verified),(verified,e,[]))[2].append(role)
            results=[]
            async with httpx.AsyncClient(trust_env=False) as client:
                for digest_value,(verified,e,roles) in distinct.items():
                    record={'model':e.model,'effort':e.effort,'roles':roles,'transport':e.transport,'subject':verified,'subject_digest':digest_value}
                    started=time.monotonic();seat=None
                    try:
                        if e.transport=='cli':
                            seat=CliAgent(command,e.model,e.model,provider=provider,efforts={'probe':e.effort} if e.effort else None);target=e.model
                        else:
                            seat=HTTPAgent(e,client=client,project='probe',principal='local-operator',
                                           resolver=lambda ref,principal,project,e=e:access_grant(e,ref,principal,project));target=e
                        await seat._call(target,PROBE_INSTRUCTIONS,{'probe':True},ProbeReply,role='probe')
                        call=seat.calls[-1]
                        results.append({**record,'ok':True,'observed_model':call['observed_model'],
                                        'identity_verified':call['identity_verified'],'applied_effort':call['applied_effort'],
                                        'duration_ms':int((time.monotonic()-started)*1000)})
                    except Exception as error:
                        results.append({**record,'ok':False,'error':redact(str(error))[:300],
                                        'duration_ms':int((time.monotonic()-started)*1000)})
                    finally:
                        if seat is not None and hasattr(seat,'close'):seat.close()
            at=int(time.time());reply={'at':at,'transport':name if command else 'api','provider':provider,'results':results}
            (root/'providers').mkdir(parents=True,exist_ok=True)
            for key,transport in ((name,'cli'),(provider,'api')):
                mine=[r for r in results if r['transport']==transport]
                if not mine:continue
                probes[key]={'at':at,'transport':key if transport=='cli' else 'api','provider':provider,'results':mine}
                with (root/'providers'/(key+'-probes.jsonl')).open('a',encoding='utf-8') as log:log.write(json.dumps(probes[key])+'\n')
            return reply

    from .readiness import create_router as readiness_router
    readiness_api=readiness_router(authorized=authorized,root=root,repository=repository,cli_transport=cli_transport,cli_transports=CLI_TRANSPORTS,
                                   probes=probes,credential_stored=credential_stored,credential_source=credential_source,memory_routes=memory_routes,molecular_jobs=molecular_jobs)
    app.include_router(readiness_api)
    # On-demand local reads (storage integrity, failed renders, renderer, package, probes)
    # and the redacted report; the report's readiness summary calls the readiness handler.
    from .diagnostics import create_router as diagnostics_router
    app.include_router(diagnostics_router(authorized=authorized,root=root,repository=repository,molecular_jobs=molecular_jobs,memory_routes=memory_routes,
                                          probes=probes,settings_revision=settings_revision,health=health_document,readiness=readiness_api.read,
                                          secrets=(token,native_session_secret),started_at=started_at))

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
        # never a claim of validity, only of eligibility for human review. The validated
        # state is returned beside the row so one request validates it once.
        request=MissionRequest.model_validate(row['request']);state=MissionState.model_validate(row['state'])
        decision=release_ledger.current_decision(request,state,event_chain_ok=repository.verify(row['id']))
        obligations={change.id:list(obligation_states(change,decision)) for change in state.changes}
        return {**row,'release':decision.model_dump(mode='json'),'change_obligations':obligations},state

    def manifest_view(row,state):
        return {**row,'state':{**row['state'],'artifacts':[a.manifest() for a in state.artifacts]}}

    @app.get('/api/missions/{mid}',dependencies=[Depends(authorized)])
    async def read_mission(mid:str):
        # Artifact manifests only: the image bytes are served by the artifact route, and
        # the export and verify paths read full artifacts from the repository.
        row,state=with_release(get(mid))
        return manifest_view(row,state)

    @app.get('/api/missions/{mid}/head',dependencies=[Depends(authorized)])
    async def mission_head(mid:str):
        # The cheap poll: revision, status and round read inside SQLite, no release derivation.
        try:return {'id':mid,**repository.head(mid)}
        except KeyError:raise HTTPException(404,'Unknown mission') from None

    @app.get('/api/missions/{mid}/release',dependencies=[Depends(authorized)])
    async def read_release(mid:str):return with_release(get(mid))[0]['release']

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
        def cancelled():return repository.status(mid)=='cancelled'
        receipts={}   # op -> the receipt row the guard wrote for it; timeline linkage only
        def note(receipt):
            op=CURRENT_OP.get()
            if op:receipts[op]=receipt
            return receipt
        transports={}   # role -> 'api'|'cli' of the bound route; empty for the offline fixture
        def log(phase,op=None,**fields):
            if phase=='started':
                if fields['role'] in ('planner','analyst','falsifier','vision'):
                    fields.setdefault('transport','fixture' if request.mode=='demo' else transports.get(fields['role']))
                op=timeline.start(mid,source='worker',**fields);CURRENT_OP.set(op);return op
            receipt=receipts.pop(op,None);provenance=fields.pop('transport',None) or {}
            if receipt and receipt['outcome']=='denied':fields['outcome']='denied'
            timeline.finish(mid,op,model_observed=provenance.get('observed_model'),identity_verified=provenance.get('identity_verified'),
                            receipt_id=receipt['id'] if receipt else None,**fields)
        def guard(kind,destination,category,call,*,role=None,error=ValueError,request_digest=None):
            """The ledger check before one external call of this mission and the receipt
            after it: a refusal never reaches the destination and is recorded as denied,
            raised as the error the engine already records for that call."""
            async def run(*args):
                verdict=ledger.authorize('mission',mid,destination,kind)
                fields={'grant_id':verdict['grant_id'],'mission_id':mid,'destination':destination,'destination_kind':kind,'data_category':category,
                        'role':role,'request_digest':request_digest(*args) if request_digest else None,'observation_id':None}
                if not verdict['allowed']:
                    note(ledger.receipt(**fields,outcome='denied',reason=verdict['reason']))
                    raise error('Refused by the grant ledger: '+verdict['reason'])
                try:result=await call(*args)
                except Exception as why:
                    note(ledger.receipt(**fields,outcome='failed',reason=redact(str(why))[:300]));raise
                note(ledger.receipt(**fields,outcome='ok',reason=''))
                return result
            return run
        def guard_tool(binding,destination,kind,category=CONNECTOR_CATEGORY):
            spec,function=binding
            return spec,guard(kind,destination,category,function,request_digest=lambda arguments:digest(arguments))
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
                        return access_grant(cfg,ref,principal,project)
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
                    # Every seat call passes the ledger under the seat's own destination
                    # (the engine's analyst role is the reviewer seat).
                    cfgs={'planner':first,'reviewer':second,'falsifier':third,'vision':vision}
                    transports.update({'planner':first.transport,'analyst':second.transport,'reviewer':second.transport,
                                       'falsifier':third.transport,'vision':vision.transport if vision else None})
                    def guard_seat(role,call,*args):
                        cfg=cfgs.get(role) or second
                        return guard('seat',seat_destination(cfg),SEAT_CATEGORY,call,role=role,error=ProviderError)(*args)
                    agent=GuardedSeatAgent(agent,guard_seat)
                    if os.environ.get('ARC_PUBLIC_READS')=='1':
                        from .exploration.public_reads import public_tools
                        tools=combine_trusted_tools(tools,public_tools(client))
                        for name,origin_ in PUBLIC_READ_ORIGINS.items():
                            if name in tools:tools[name]=guard_tool(tools[name],origin_,'public_read',PUBLIC_READ_CATEGORY)
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
                        for name in adapter:tools[name]=guard_tool(tools[name],BIORENDER_ENDPOINT,'biorender',BIORENDER_CATEGORY)
                    # The consented connectors bound with the route, for this mission only: MCP
                    # sessions open now and close with the mission; ACP agents start on first use.
                    from .exploration.acp_client import AcpConsultations
                    from .exploration.mcp_tools import McpToolset
                    consultations=AcpConsultations([{**a,'consent':True} for a in route['acp_agents']])
                    servers=[{**s,'consent':True} for s in route['mcp_servers']]
                    mcp=McpToolset(servers) if servers else None
                    # One consultation tool per agent, in the agents' order.
                    for (name,binding),acp_agent in zip(consultations.tools.items(),consultations.agents):
                        if name in tools:raise ValueError('Connector tool name collides: '+name)
                        tools[name]=guard_tool(binding,connector_destination(acp_agent),'acp')
                if mcp is not None:
                    async with mcp:
                        # The toolset's report says which server offered each tool.
                        by_server={s['name']:s for s in mcp.servers}
                        server_of={t['as']:by_server[entry['server']] for entry in mcp.report for t in entry['tools'] if t.get('offered')}
                        for name,binding in mcp.tools.items():
                            if name in tools:raise ValueError('Connector tool name collides: '+name)
                            tools[name]=guard_tool(binding,connector_destination(server_of[name]),'mcp')
                        await explore(request,agent,initial=MissionState.model_validate(row['state']),emit=emit,cancelled=cancelled,extra_tools=tools,log=log)
                else:
                    await explore(request,agent,initial=MissionState.model_validate(row['state']),emit=emit,cancelled=cancelled,extra_tools=tools,log=log)
        except (MissionCancelled,RevisionConflict):pass
        except asyncio.CancelledError:raise
        except Exception as why:
            fresh=repository.get(mid)
            if fresh['state']['status']!='cancelled':
                error=MissionState.model_validate({**fresh['state'],'status':'error','stop_reason':'Service execution failed; inspect configuration. No success inferred.'})
                with suppress(RevisionConflict):repository.save(mid,error,expected_revision=fresh['revision'])
                timeline.record(mid,operation='stop',role='service',source='worker',round=fresh['state']['round'],outcome='error',
                                detail=redact(str(why))[:300] or 'Service execution failed')
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

    def schedule(row,declared=None,note='',approval=None,actor='operator'):
        """The one path that starts or resumes a mission: the live route is checked against
        the plan bound at the first start before anything is written; then the resume is
        recorded, the plan bound if this is the first start, and the worker scheduled with
        the same immutable snapshot of the seats. A first start needs the operator's
        approval of the previewed route: the grants are written once the plan is bound."""
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
            granted=ledger.list('mission',row['id'])
            if bound is None or not granted:
                if approval is None:
                    raise HTTPException(409,'Review the route and approve its grants before the first start' if bound is None else
                                        'This mission was bound before its grants were recorded; review the route and approve its grants to start it')
                revision=settings_revision()
                if approval.approved_route_digest!=route_digest:
                    raise HTTPException(409,'The route changed since it was previewed; review it again'+(f'; settings revision {revision[:12]}' if revision else ''))
                preview=route_preview(route,revision)
                approved={(g.destination,g.destination_kind) for g in approval.grants if g.scope=='mission'}
                missing=[g for g in preview['required_grants'] if (g['destination'],g['destination_kind']) not in approved]
                if missing:raise HTTPException(409,'No grant approved for the '+missing[0]['destination_kind']+' destination '+missing[0]['destination'])
        change=None
        if row['state']['status'] in ('paused','error'):
            change=record_resume(row,declared if declared is not None else MISSION_CHANGES['resume']['derived'],note or 'Resumed from the workspace.')
            row=get(row['id'])
        if route is not None and (bound is None or not granted):
            # The ledger records what the operator approved, in the service's own words,
            # before the plan is bound: a bound mission without grants asks again.
            for grant in preview['required_grants']:
                ledger.create(subject_kind='mission',subject_id=row['id'],**grant,route_digest=route_digest,settings_revision=revision or '',source='operator-ui')
        if route is not None and bound is None:
            state=MissionState.model_validate(row['state'])
            state=state.model_copy(update={'events':state.events+(Event(kind='seats_bound',round=state.round,detail=detail[:1200]),)})
            try:repository.save(row['id'],state,expected_revision=row['revision'])
            except RevisionConflict:raise HTTPException(409,'Mission changed; retry') from None
        timeline.record(row['id'],operation='resume' if change else 'start',role='operator',source='operator',actor=actor,
                        round=row['state']['round'],outcome='resumed' if change else 'scheduled',detail=(change.note if change else ''))
        running[row['id']]=asyncio.create_task(worker(row['id'],route))
        return change

    @app.post('/api/missions/{mid}/start',status_code=202)
    async def start(mid:str,approval:StartRequest|None=Body(default=None),principal:str=Depends(authorized)):
        row=get(mid)
        if mid in running or row['state']['status'] not in ('ready','paused'):
            raise HTTPException(409,'Only ready or interrupted missions can start or resume')
        schedule(row,approval=approval,actor='operator:'+principal)
        return {'id':mid,'status':'scheduled'}

    @app.get('/api/changes',dependencies=[Depends(authorized)])
    async def change_kinds():
        return {kind:{'applies':entry['applies'],'derived_effects':list(entry['derived']),'reason':entry['reason']}
                for kind,entry in MISSION_CHANGES.items()}

    @app.post('/api/missions/{mid}/changes',status_code=202)
    async def declare_change(mid:str,declaration:ChangeDeclaration=Body(...),principal:str=Depends(authorized)):
        row=get(mid)
        # The declaration is checked before anything moves; a refusal names the table's reason.
        try:derived,checks=mission_change(declaration.kind,declaration.declared_effects)
        except ChangeRefused as refused:raise HTTPException(409,str(refused)) from None
        if mid in running or row['state']['status'] not in ('paused','error'):
            raise HTTPException(409,'Only an interrupted or errored mission can be resumed')
        # A retry from an error is a declared change whose reason the operator states.
        if row['state']['status']=='error' and not declaration.note.strip():
            raise HTTPException(409,'A retry from an error states its reason in the note')
        change=schedule(row,declaration.declared_effects,declaration.note,actor='operator:'+principal)
        return {'id':mid,'status':'scheduled','change':change.model_dump(mode='json')}

    @app.post('/api/missions/{mid}/pause')
    async def pause(mid:str,principal:str=Depends(authorized)):
        get(mid);actor='operator:'+principal
        # The pause save bumps the revision, so the worker's late commit is refused; the task is cancelled as for cancel.
        try:row=repository.pause(mid,actor=actor)
        except RevisionConflict:raise HTTPException(409,'Mission changed; retry pause') from None
        except ValueError as why:raise HTTPException(409,str(why)) from None
        if mid in running:running[mid].cancel()
        timeline.record(mid,operation='pause',role='operator',source='operator',actor=actor,round=row['state']['round'],
                        outcome='paused',detail=row['state']['stop_reason'])
        state=MissionState.model_validate(row['state'])
        memory_routes.schedule_capture(mid,state)
        return manifest_view(row,state)

    @app.post('/api/missions/{mid}/cancel')
    async def cancel(mid:str,principal:str=Depends(authorized)):
        before=get(mid);actor='operator:'+principal
        try:row=repository.cancel(mid,actor=actor)
        except MissionFinished as finished:raise HTTPException(409,str(finished)) from None
        except RevisionConflict:raise HTTPException(409,'Mission changed; retry cancellation') from None
        if mid in running:running[mid].cancel()
        # A repeated cancel changes nothing (same revision) and records nothing.
        if row['revision']!=before['revision']:
            timeline.record(mid,operation='cancel',role='operator',source='operator',actor=actor,round=row['state']['round'],
                            outcome='cancelled',detail=row['state']['events'][-1]['detail'])
        state=MissionState.model_validate(row['state'])
        memory_routes.schedule_capture(mid,state)
        return manifest_view(row,state)

    @app.get('/api/missions/{mid}/artifacts/{artifact_digest}',dependencies=[Depends(authorized)])
    async def artifact(mid:str,artifact_digest:str):
        state=MissionState.model_validate(get(mid)['state'])
        item=next((item for item in state.artifacts if item.digest==artifact_digest),None)
        if item is None:raise HTTPException(404,'Unknown mission artifact')
        return Response(item.bytes,media_type=item.media_type,
                        headers={'ETag':'"'+item.digest+'"','Content-Disposition':'inline'})

    @app.get('/api/missions/{mid}/artifacts/{artifact_digest}/download',dependencies=[Depends(authorized)])
    async def artifact_download(mid:str,artifact_digest:str):
        # The inline preview above serves any mission; a file leaving the page consults the
        # ledger exactly as the capsule does.
        row=get(mid)
        item=next((a for a in MissionState.model_validate(row['state']).artifacts if a.digest==artifact_digest),None)
        if item is None:raise HTTPException(404,'Unknown mission artifact')
        chain=repository.verify(mid)
        if not chain:raise HTTPException(409,'Mission integrity check failed')
        request=MissionRequest.model_validate(row['request']);state=MissionState.model_validate(row['state'])
        try:release_ledger.assert_exportable(request,state,event_chain_ok=chain)
        except release_ledger.ReleaseBlocked as blocked:
            raise HTTPException(409,'Release blocked; verify the mission and resolve: '+', '.join(blocked.reasons)) from None
        return Response(item.bytes,media_type=item.media_type,
                        headers={'ETag':'"'+item.digest+'"','Content-Disposition':f'attachment; filename="arc-{mid}-{item.digest[:12]}.png"'})

    @app.get('/api/missions/{mid}/capsule',dependencies=[Depends(authorized)])
    async def capsule(mid:str):
        row=get(mid)
        chain=repository.verify(mid)
        if not chain:raise HTTPException(409,'Mission integrity check failed')
        request=MissionRequest.model_validate(row['request']);state=MissionState.model_validate(row['state'])
        # Every release export consults the ledger: a blocked mission is not exported.
        try:decision=release_ledger.assert_exportable(request,state,event_chain_ok=chain)
        except release_ledger.ReleaseBlocked as blocked:
            raise HTTPException(409,'Release blocked; verify the mission and resolve: '+', '.join(blocked.reasons)) from None
        # Capsule format 3: the decision, the derived graph and claims, and the operational
        # timeline and grants travel with the state; the informational members are never evidence.
        from .exploration.claims import build_claims
        release=decision.model_dump(mode='json')
        try:graph=evidence_graph(state)
        except ValueError:raise HTTPException(409,'Evidence graph is invalid; verify the mission') from None
        rows=timeline.rows(mid)
        receipts=ledger.receipts(mission_id=mid,limit=1000)
        grants={'grants':ledger.list('mission',mid),'receipts':receipts,'receipts_truncated':len(receipts)>=1000}
        data=export_capsule(request,state,release=release,claims=build_claims(state,rows,graph,release),timeline=rows,grants=grants)
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
    web=static/'web'
    @app.get('/diagnostics')
    async def diagnostics():
        # A direct URL and a refresh open the same authenticated workbench shell.
        # Keep the legacy page only as a recovery fallback when no UI bundle exists.
        return FileResponse(web/'index.html' if (web/'index.html').exists() else static/'diagnostics.html')
    app.mount('/assets-local',StaticFiles(directory=static),name='diagnostic-assets')
    if web.is_dir() and (web/'index.html').exists():
        app.mount('/',StaticFiles(directory=web,html=True),name='web')
    else:
        @app.get('/')
        async def home():return FileResponse(static/'diagnostics.html')
    return app
