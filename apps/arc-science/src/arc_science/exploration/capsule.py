"""Portable replay capsule: verify bytes, then re-execute trusted numeric code."""
from __future__ import annotations
import hashlib
from io import BytesIO
import json
import math
from pathlib import Path, PurePosixPath
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from .. import __version__
from ..contracts import canonical, digest
from .models import MissionRequest, MissionState
from . import tools
from .catalog import trusted_replay, trusted_version
from .evidence import evidence_graph
from .vision import required_visual_reason

CAPSULE_FORMAT='arc-research-capsule/2'
MAX_CAPSULE=20*1024*1024

def export_capsule(request:MissionRequest,state:MissionState)->bytes:
    if state.request_digest!=digest(request):raise ValueError('Unbound mission')
    # The release ledger is service-side evidence about the state, not part of it.
    state=state.model_copy(update={'release':None})
    entries={'request.json':canonical(request),'state.json':canonical(state),
             'runtime.json':canonical({'format':CAPSULE_FORMAT,'arc_version':__version__,
                 'numeric_version':tools.TOOL_VERSION,'numeric_source_sha256':hashlib.sha256(Path(tools.__file__).read_bytes()).hexdigest(),
                 'scientific_digest':state.scientific_digest,'scientific_validation':'not_established',
                 'model_replay':'recorded_outputs_only'})}
    entries['manifest.json']=canonical({name:hashlib.sha256(data).hexdigest() for name,data in entries.items()})
    if sum(len(data) for data in entries.values())>MAX_CAPSULE:
        raise ValueError('Expanded capsule would exceed verifier size limit')
    out=BytesIO()
    with ZipFile(out,'w',compression=ZIP_DEFLATED) as z:
        for name,data in sorted(entries.items()):
            info=ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o100600<<16
            z.writestr(info,data)
    blob=out.getvalue()
    if len(blob)>MAX_CAPSULE:raise ValueError('Capsule exceeds size limit')
    return blob

def _equal(a,b):
    if isinstance(a,(int,float)) and not isinstance(a,bool) and isinstance(b,(int,float)) and not isinstance(b,bool):
        return math.isfinite(a) and math.isfinite(b) and math.isclose(a,b,rel_tol=1e-9,abs_tol=1e-10)
    if isinstance(a,dict) and isinstance(b,dict):return a.keys()==b.keys() and all(_equal(a[k],b[k]) for k in a)
    if isinstance(a,list) and isinstance(b,list):return len(a)==len(b) and all(_equal(x,y) for x,y in zip(a,b))
    return type(a)==type(b) and a==b

def verify_capsule(blob:bytes)->dict:
    if len(blob)>MAX_CAPSULE:raise ValueError('Capsule exceeds size limit')
    try:
        with ZipFile(BytesIO(blob)) as z:
            infos=z.infolist();names=[i.filename for i in infos]
            if len(names)!=len(set(names)) or set(names)!={'request.json','state.json','runtime.json','manifest.json'}:
                raise ValueError('Unexpected or duplicate archive members')
            if sum(i.file_size for i in infos)>MAX_CAPSULE:raise ValueError('Expanded archive exceeds size limit')
            if any(PurePosixPath(i.filename).is_absolute() or '..' in PurePosixPath(i.filename).parts or
                   ((i.external_attr>>16)&0o170000)==0o120000 for i in infos):raise ValueError('Unsafe archive member')
            entries={name:z.read(name) for name in names}
        manifest=json.loads(entries.pop('manifest.json'))
        if set(manifest)!=set(entries):raise ValueError('Manifest membership mismatch')
        if any(hashlib.sha256(data).hexdigest()!=manifest[name] for name,data in entries.items()):raise ValueError('Artifact checksum mismatch')
        request=MissionRequest.model_validate_json(entries['request.json'])
        state=MissionState.model_validate_json(entries['state.json']);runtime=json.loads(entries['runtime.json'])
    except ValueError:raise
    except Exception:raise ValueError('Invalid replay capsule') from None
    required_runtime={'format','arc_version','numeric_version','numeric_source_sha256',
                      'scientific_digest','scientific_validation','model_replay'}
    if not isinstance(runtime,dict) or set(runtime)!=required_runtime:
        raise ValueError('Invalid capsule runtime metadata')
    if (runtime['format']!=CAPSULE_FORMAT or runtime['arc_version']!=__version__ or
            runtime['numeric_version']!=tools.TOOL_VERSION or
            runtime['scientific_validation']!='not_established' or
            runtime['model_replay']!='recorded_outputs_only'):
        raise ValueError('Unsupported capsule runtime contract; use the matching release verifier')
    if state.request_digest!=digest(request) or state.dataset_digest!=digest([p.model_dump(mode='json') for p in state.points]):
        raise ValueError('Input binding mismatch')
    if request.vision_review and state.status=='completed':
        reason=required_visual_reason(state.artifacts,state.visual_reports,state.vision_records)
        if reason:raise ValueError('Required visual review is incomplete: '+reason)
    from .engine import initialize
    expected=initialize(request)
    if state.points!=expected.points or state.data_origin!=expected.data_origin:
        raise ValueError('Recorded input differs from the requested frozen dataset')
    if any(obs.status=='ok' and trusted_replay(obs.tool) is None for obs in state.observations):
        raise ValueError('Unknown successful tool cannot be verified as a snapshot')
    graph=None;graph_check=True;graph_failure=None
    try:
        graph=evidence_graph(state)
    except ValueError as exc:
        if (str(exc).startswith('Invalid observation') or
                str(exc).startswith('Recorded contextual observation binding mismatch') or
                str(exc).startswith('Recorded contextual artifact binding mismatch') or
                str(exc).startswith('Recorded contextual visual report binding mismatch') or
                str(exc).startswith('Invalid artifact source observation binding')):
            graph_check=False;graph_failure='evidence graph: '+str(exc)
        else:
            raise
    if runtime['scientific_digest']!=state.scientific_digest:raise ValueError('Scientific state mismatch')
    if runtime['numeric_source_sha256']!=hashlib.sha256(Path(tools.__file__).read_bytes()).hexdigest():
        raise ValueError('Numeric implementation changed; explicitly review migration before replay')
    reproduced=0;artifacts_reproduced=0;failures=[graph_failure] if graph_failure else [];snapshot_only=[]
    branches={b.id for b in state.branches}
    for obs in state.observations:
        if (obs.id,obs.branch_id,obs.tool)!=(obs.action.id,obs.action.branch_id,obs.action.tool) or obs.branch_id not in branches:
            failures.append(obs.id+': observation/action identity mismatch');continue
        if obs.dataset_digest!=state.dataset_digest or obs.request_digest!=digest([obs.action.model_dump(mode='json'),state.dataset_digest]):
            failures.append(obs.id+': input binding mismatch');continue
        policy=trusted_replay(obs.tool)
        if policy is None:
            if obs.status=='ok':raise ValueError('Unknown successful tool cannot be verified as a snapshot')
            continue
        expected_replayable=policy=='numerical'
        if obs.replayable is not expected_replayable:
            raise ValueError(obs.id+': replay classification conflicts with trusted tool policy')
        if policy=='public_snapshot':
            if obs.tool_version!=trusted_version(obs.tool):failures.append(obs.id+': tool version mismatch')
            snapshot_only.append(obs.id);continue
        if obs.tool_version!=tools.TOOL_VERSION:failures.append(obs.id+': tool version mismatch');continue
        try:
            computed=tools.execute_numeric(obs.tool,obs.action.arguments,state.points)
            if obs.status!='ok' or not _equal(computed,obs.data):failures.append(obs.id+': numerical mismatch')
            else:reproduced+=1
        except Exception:
            if obs.status!='error':failures.append(obs.id+': execution no longer reproduces')
    from .artifacts import artifact_for_observation
    observations={observation.id:observation for observation in state.observations}
    for artifact in state.artifacts:
        source=observations.get(artifact.source_observation_id)
        if source is None:
            failures.append(artifact.digest+': artifact source observation missing');continue
        try:
            computed=artifact_for_observation(state.points,source)
            if computed != artifact:
                failures.append(artifact.digest+': artifact rendering mismatch')
            else:
                artifacts_reproduced+=1
        except Exception:
            failures.append(artifact.digest+': artifact rendering no longer reproduces')
    return {'integrity':True,'reproduction_passed':not failures,'reproduced':reproduced,'failures':failures,
            'artifacts_reproduced':artifacts_reproduced,
            'snapshot_only':snapshot_only,'scientific_digest':state.scientific_digest,
            'evidence_graph':graph,'evidence_graph_valid':graph_check,
            'live_models_reexecuted':False,'scientific_validity_established':False,
            'limitations':'Hashes detect corruption relative to this manifest; they are not external signatures or proof of truth.'}
