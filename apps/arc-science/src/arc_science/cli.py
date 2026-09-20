"""Deployment, reproducibility and inspection commands for Arc Science."""
from __future__ import annotations
import argparse
import asyncio
import getpass
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from . import __version__
from .exploration.models import MissionRequest
from .exploration.agents import DemoAgent
from .exploration.engine import explore
from .exploration.capsule import export_capsule, verify_capsule
from .exploration.biorender_read import discover_biorender


def fixture(output:Path,seed:int=17):
    output.mkdir(parents=True,exist_ok=True)
    request=MissionRequest(goal='Compare competing explanations of the synthetic nonlinear response.',seed=seed)
    state=asyncio.run(explore(request,DemoAgent()))
    data=export_capsule(request,state)
    (output/'capsule.zip').write_bytes(data)
    (output/'state.json').write_text(state.model_dump_json(indent=2),encoding='utf-8')
    result={**verify_capsule(data),'fixture':'explicitly synthetic; scripted planner; no model provider called',
            'branches':len(state.branches),'assessments':len(state.assessments),
            'capsule_sha256':hashlib.sha256(data).hexdigest(),'status':state.status}
    (output/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    return result


def validate(output:Path):
    """Fresh Python processes, different hash seeds, numerical rerun and tamper check."""
    reports=[]
    with tempfile.TemporaryDirectory(prefix='arc-reproduction-') as temp:
        for index,hash_seed in enumerate(('1','937')):
            destination=Path(temp)/str(index)
            env={**os.environ,'PYTHONHASHSEED':hash_seed}
            completed=subprocess.run([sys.executable,'-m','arc_science.cli','fixture','--output',str(destination)],
                                      capture_output=True,text=True,env=env,timeout=60)
            if completed.returncode:raise RuntimeError('Fresh-process fixture failed: '+completed.stderr[-1000:])
            reports.append(json.loads((destination/'result.json').read_text()))
        blob=(Path(temp)/'0'/'capsule.zip').read_bytes()
        # An altered recorded result without a matching manifest must be rejected.
        from io import BytesIO
        from zipfile import ZipFile
        altered=BytesIO()
        with ZipFile(BytesIO(blob)) as source,ZipFile(altered,'w') as target:
            for item in source.infolist():
                data=source.read(item.filename)
                if item.filename=='state.json':data=data.replace(b'quadratic',b'quxdratic',1)
                target.writestr(item.filename,data)
        tamper_rejected=False
        try:verify_capsule(altered.getvalue())
        except ValueError:tamper_rejected=True
    passed=(all(r['reproduction_passed'] for r in reports) and
            reports[0]['scientific_digest']==reports[1]['scientific_digest'] and
            reports[0]['capsule_sha256']==reports[1]['capsule_sha256'] and tamper_rejected)
    result={'passed':passed,'fresh_processes':2,'python_hash_seeds':[1,937],
            'identical_scientific_fingerprints':reports[0]['scientific_digest']==reports[1]['scientific_digest'],
            'identical_capsule_bytes':reports[0]['capsule_sha256']==reports[1]['capsule_sha256'],
            'tamper_rejected':tamper_rejected,'runs':reports,
            'scope':'Offline software reproducibility, not scientific or live-model validation.'}
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    return result


def main(argv=None):
    parser=argparse.ArgumentParser(prog='arc-science',description='Arc Science local research service')
    commands=parser.add_subparsers(dest='command',required=True)
    serve=commands.add_parser('serve');serve.add_argument('--host',default='127.0.0.1');serve.add_argument('--port',type=int,default=8080)
    serve.add_argument('--data',type=Path,default=Path(os.environ.get('ARC_DATA_DIR','./data')))
    show=commands.add_parser('token',help='Show the local operator token');show.add_argument('--data',type=Path,default=Path(os.environ.get('ARC_DATA_DIR','./data')))
    cred=commands.add_parser('credential',help='Store a provider credential locally, outside prompts');cred.add_argument('--data',type=Path,default=Path(os.environ.get('ARC_DATA_DIR','./data')));cred.add_argument('--name',default='planner',help='planner, reviewer, falsifier, vision, biorender, or any name a seat refers to')
    demo=commands.add_parser('fixture');demo.add_argument('--output',type=Path,default=Path('./fixture-output'));demo.add_argument('--seed',type=int,default=17)
    verify=commands.add_parser('verify');verify.add_argument('capsule',type=Path)
    val=commands.add_parser('validate');val.add_argument('--output',type=Path,default=Path('./reproducibility.json'))
    commands.add_parser('doctor')
    commands.add_parser('biorender-discover',help='Inspect the validated BioRender tool schemas and digest')
    from .bioart.cli import register as register_bioart
    register_bioart(commands)
    figure_import=commands.add_parser('figure-import',help='Import an authorized local SVG or PDF')
    figure_import.add_argument('source',type=Path)
    figure_import.add_argument('--project',type=Path,required=True)
    provenance=figure_import.add_mutually_exclusive_group(required=True)
    provenance.add_argument('--provenance')
    provenance.add_argument('--provenance-file',type=Path)
    figure_render=commands.add_parser('figure-render',help='Render a captured vector proof with Blender')
    figure_render.add_argument('asset',type=Path)
    figure_render.add_argument('--project',type=Path,required=True)
    runtime=figure_render.add_mutually_exclusive_group()
    runtime.add_argument('--blender')
    runtime.add_argument('--blender-python')
    figure_render.add_argument('--style',choices=['publication','studio','flat'],default='publication')
    for name,default in [('width',1600),('height',1200),('samples',64),('seed',23),('timeout',180)]:
        figure_render.add_argument('--'+name,type=int,default=default)
    figure_verify=commands.add_parser('figure-verify',help='Check a completed render without renderer replay')
    figure_verify.add_argument('run',type=Path)
    figure_packet=commands.add_parser('figure-review-packet',help='Export a digest-bound offline visual-review packet')
    figure_packet.add_argument('--candidate',type=Path,action='append',required=True)
    figure_packet.add_argument('--reference',type=Path,action='append',required=True)
    figure_packet.add_argument('--candidate-id',required=True)
    figure_packet.add_argument('--output',type=Path,required=True)
    figure_review=commands.add_parser('figure-review',help='Run a configured native-image review for an exported packet')
    figure_review.add_argument('packet',type=Path)
    figure_review.add_argument('--output',type=Path,required=True)
    figure_review.add_argument('--allow-egress',action='store_true',required=True)
    molecule=commands.add_parser('molecule-render',help='Render a coordinate-derived antibody–antigen figure')
    molecule.add_argument('source',type=Path)
    molecule.add_argument('--antibody',required=True,help='Comma-separated author chain IDs, including both Fab chains')
    molecule.add_argument('--antigen',required=True,help='Comma-separated author chain IDs')
    molecule.add_argument('--output',type=Path,required=True,help='New immutable candidate directory')
    molecule.add_argument('--blender-python',required=True)
    molecule.add_argument('--assembly',default='asymmetric_unit')
    molecule.add_argument('--model-index',type=int,default=0)
    molecule.add_argument('--cutoff',type=float,default=4.0)
    for name,default in [('width',1400),('samples',96),('seed',23)]:
        molecule.add_argument('--'+name,type=int,default=default)
    args=parser.parse_args(argv)
    try:
        if args.command=='serve':
            import uvicorn
            from .service import create_app
            print('Local access token: '+str((args.data/'access.token').resolve()),file=sys.stderr)
            uvicorn.run(create_app(data_dir=args.data),host=args.host,port=args.port,workers=1,access_log=False)
            return 0
        if args.command=='token':
            path=Path(os.environ.get('ARC_TOKEN_FILE',str(args.data/'access.token')))
            print(path.read_text().strip());return 0
        if args.command=='credential':
            value=getpass.getpass('Provider credential (input hidden): ').strip()
            if not value or len(value)>8192:raise ValueError('Invalid credential length')
            from .service import credential_path
            path=credential_path(args.name,args.data)
            path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            path.write_text(value+'\n');path.chmod(0o600)
            print('Stored at '+str(path.resolve()));return 0
        if args.command=='fixture':result=fixture(args.output,args.seed)
        elif args.command=='verify':result=verify_capsule(args.capsule.read_bytes())
        elif args.command=='validate':result=validate(args.output)
        elif args.command=='biorender-discover':result=asyncio.run(discover_biorender())
        elif args.command=='bioart':
            from .bioart.cli import run as run_bioart
            result=run_bioart(args)
        elif args.command=='molecule-render':
            from .molecular import prepare_complex
            from .molecular_figure import render_complex
            scene=prepare_complex(args.source,antibody_chains=tuple(c.strip() for c in args.antibody.split(',')),
                antigen_chains=tuple(c.strip() for c in args.antigen.split(',')),
                model_index=args.model_index,assembly=args.assembly,cutoff=args.cutoff)
            result=render_complex(scene,args.output,blender_python=args.blender_python,
                width=args.width,samples=args.samples,seed=args.seed)
        elif args.command=='figure-render':
            from .figure_render import render_figure
            result=render_figure(args.asset,args.project,blender=args.blender,blender_python=args.blender_python,
                                 style=args.style,width=args.width,height=args.height,samples=args.samples,
                                 seed=args.seed,timeout=args.timeout)
        elif args.command=='figure-verify':
            from .figure_render import verify_render
            result=verify_render(args.run)
        elif args.command=='figure-review-packet':
            from .figure_review import build_review_packet
            packet=build_review_packet(args.candidate,args.reference,candidate_id=args.candidate_id)
            args.output.parent.mkdir(parents=True,exist_ok=True)
            with args.output.open('x',encoding='utf-8') as handle:
                json.dump(packet,handle,sort_keys=True,separators=(',',':'))
            result={'packet':str(args.output.resolve()),'candidate_id':packet['candidate_id'],
                    'candidate_digest':packet['candidate_digest'],'packet_digest':packet['packet_digest'],
                    'images':len(packet['images']),'provider_executed':False}
        elif args.command=='figure-review':
            import httpx
            import time
            from .figure_review import configured_figure_vision_endpoint,read_review_packet,request_visual_review
            from .service import _secret
            from .transport import AccessGrant
            if not args.allow_egress:raise ValueError('Live figure review requires explicit egress permission')
            packet=read_review_packet(args.packet)
            config=configured_figure_vision_endpoint()
            project=packet.get('candidate_id','')
            def resolve(ref,principal,project_id):
                return AccessGrant(token=_secret(ref),principal=principal,project_id=project_id,
                    resource=config.endpoint,credential_ref=ref,expires_at=int(time.time())+60,
                    auth_style='x-api-key' if config.provider=='anthropic' else 'bearer')
            async def execute_review():
                async with httpx.AsyncClient(trust_env=False) as client:
                    return await request_visual_review(packet,config=config,client=client,resolver=resolve,
                        project=project,principal='local-operator',allow_egress=True)
            result=asyncio.run(execute_review())
            args.output.parent.mkdir(parents=True,exist_ok=True)
            with args.output.open('x',encoding='utf-8') as handle:
                json.dump(result,handle,sort_keys=True,separators=(',',':'))
        elif args.command=='figure-import':
            from .vector_assets import _read_regular,import_vector,verify_asset
            if args.provenance_file is not None:
                provenance_text=_read_regular(args.provenance_file,64*1024,'Provenance file')
            else:
                provenance_text=args.provenance.encode('utf-8')
                if len(provenance_text)>64*1024:raise ValueError('Provenance JSON exceeds size limit')
            provenance=json.loads(provenance_text)
            if not isinstance(provenance,dict):raise ValueError('Provenance JSON must be an object')
            asset=import_vector(args.source,args.project,provenance)
            manifest=verify_asset(asset)
            result={'asset_manifest':str(asset.resolve()),'asset_id':manifest['asset_id']}
        else:
            result={'version':__version__,'python':sys.version.split()[0],
                'docker_available':bool(shutil.which('docker')),'blender_available':bool(shutil.which('blender')),
                'live_model_configured':bool(os.environ.get('ARC_MODEL')),
                'vision_model_configured':bool(os.environ.get('ARC_VISION_MODEL')),
                'default':'offline synthetic fixture; live mode requires explicit credentials and egress permission'}
        print(json.dumps(result,indent=2))
        if result.get('passed') is False or result.get('reproduction_passed') is False:return 1
        return 0
    except (ValueError,RuntimeError,OSError) as exc:
        print(type(exc).__name__+': '+str(exc),file=sys.stderr);return 1

if __name__=='__main__':raise SystemExit(main())
