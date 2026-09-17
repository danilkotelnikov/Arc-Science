"""Render contracts; synthetic workers here do not qualify Blender itself."""
import base64
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

from PIL import Image
import pytest

from arc_science import anchored


def _symlinks_supported():
    import tempfile
    with tempfile.TemporaryDirectory() as work:
        try:
            os.symlink(work, os.path.join(work, 'probe'))
            return True
        except (OSError, NotImplementedError, AttributeError):
            return False


# The POSIX render sandbox (openat/dir_fd, killpg process group, control/status
# pipes, rename of an open directory) has no Windows equivalent; the Windows path
# is a bounded CREATE_NEW_PROCESS_GROUP subprocess, covered by the molecular tests.
_POSIX_SANDBOX = pytest.mark.skipif(os.name == 'nt',
    reason='POSIX openat/pipe/rename sandbox mechanism; Windows uses the path-based branch')
_NEEDS_SYMLINK = pytest.mark.skipif(not _symlinks_supported(),
    reason='requires privilege to create symlinks (Developer Mode / admin on Windows)')


@pytest.fixture
def valid_asset(tmp_path):
    from arc_science.vector_assets import import_vector
    source = tmp_path / 'art.svg'
    source.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40">'
                      '<rect width="40" height="40" fill="#ff0000"/></svg>')
    return import_vector(source, tmp_path / 'assets-project', {
        'origin': 'synthetic_fixture', 'title': 'Original test art',
        'permission_note': 'Test author authorizes external rendering.',
        'external_rendering_authorized': True})


def test_worker_contract_biorender_public_detail(valid_asset, biorender_provenance_case):
    from arc_science.figure_contract import canonical, digest, open_directory, validate_asset

    provenance, accepted = biorender_provenance_case
    # Rebind a synthetic bundle directly so host intake cannot mask worker rejection.
    manifest = json.loads(valid_asset.read_text())
    manifest['provenance'] = provenance
    unsigned = dict(manifest)
    unsigned.pop('asset_id')
    manifest['asset_id'] = digest(canonical(unsigned))
    valid_asset.write_bytes(canonical(manifest))
    renamed = valid_asset.parent.with_name(manifest['asset_id'])
    valid_asset.parent.rename(renamed)
    fd = open_directory(renamed)
    try:
        if accepted:
            validated, proof = validate_asset(fd, manifest['asset_id'])
            assert validated['provenance'] == provenance
            assert validated['rights_verified'] is False
            assert proof == (renamed / 'source.png').read_bytes()
        else:
            with pytest.raises(ValueError):
                validate_asset(fd, manifest['asset_id'])
    finally:
        anchored.close_directory(fd)


def _runtime(tmp_path, body):
    if os.name == 'nt':
        # Windows honours no shebang; wrap the body as a .cmd that runs it with Python.
        script = tmp_path / 'runtime_body.py'
        script.write_text(body)
        path = tmp_path / 'runtime.cmd'
        path.write_text('@echo off\r\n"%s" "%s" %%*\r\n' % (sys.executable, script))
        return str(path)
    path = tmp_path / 'runtime'
    path.write_text('#!' + sys.executable + '\n' + body)
    path.chmod(0o700)
    return str(path)


def _successful_runtime(tmp_path, extra=''):
    png = BytesIO()
    Image.new('RGBA', (256, 256), (255, 0, 0, 255)).save(png, format='PNG')
    # This deliberately synthetic receipt exercises the host's bound-file checks.
    return _runtime(tmp_path, '''import base64, hashlib, json, pathlib, sys
run = pathlib.Path(sys.argv[-1])
job = json.loads((run/'job.json').read_text())
def digest(data): return hashlib.sha256(data).hexdigest()
def canonical(data): return json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()
scene = b'BLENDER-v405 synthetic test scene'
image = base64.b64decode(''' + repr(base64.b64encode(png.getvalue()).decode()) + ''')
(run/'scene.blend').write_bytes(scene)
(run/'render.png').write_bytes(image)
receipt = {'format':'arc-figure-receipt/1', 'run_id':job['run_id'],
 'job_sha256':digest(canonical(job)), 'asset_id':job['asset_id'],
 'source_sha256':job['source_sha256'], 'proof_sha256':job['proof_sha256'],
 'representation':'rasterized_vector_panel', 'settings':job['settings'],
 'runtime':{'kind':'blender', 'version':[4,5,0], 'version_string':'4.5.0'},
 'outputs':{'scene':{'file':'scene.blend','sha256':digest(scene),'size':len(scene)},
 'image':{'file':'render.png','sha256':digest(image),'size':len(image),'width':256,'height':256}},
 'rights_verified':False, 'scientific_validity_established':False, 'renderer_reexecuted':False}
''' + extra + "\n(run/'render-receipt.json').write_bytes(canonical(receipt))\n")


def _run(valid_asset, tmp_path, **kwargs):
    from arc_science.figure_render import render_figure
    return render_figure(valid_asset, tmp_path / 'project', width=256, height=256,
                         samples=1, **kwargs)


@pytest.mark.parametrize('setting,value', [
    ('width', True), ('width',255), ('height',2049), ('samples',False),
    ('samples',0), ('samples',513), ('seed',True), ('seed',-1),
    ('seed',2**31), ('timeout',False), ('timeout',0), ('timeout',901),
    ('style','unknown'), ('width',256.0)])
def test_invalid_settings_rejected_before_reservation(valid_asset,tmp_path,setting,value):
    from arc_science.figure_render import render_figure
    with pytest.raises(ValueError):
        render_figure(valid_asset,tmp_path/'project',**{setting:value})
    assert not (tmp_path/'project'/'renders').exists()


def test_runtime_options_exclusive_before_reservation(valid_asset,tmp_path):
    from arc_science.figure_render import render_figure
    with pytest.raises(ValueError):
        render_figure(valid_asset,tmp_path/'project',blender='x',blender_python='y')
    assert not (tmp_path/'project'/'renders').exists()


@_NEEDS_SYMLINK
@pytest.mark.parametrize('boundary',['source','project'])
def test_tampering_and_symlink_escape_rejected_before_launch(valid_asset,tmp_path,boundary):
    if boundary=='source':
        (valid_asset.parent/'source.svg').write_text('changed')
    else:
        (tmp_path/'project').symlink_to(tmp_path/'assets-project',target_is_directory=True)
    with pytest.raises((ValueError,OSError)):
        _run(valid_asset,tmp_path,blender='/absent')
    assert not (tmp_path/'assets-project'/'renders').exists()


def test_failed_worker_retains_checkpoints(valid_asset,tmp_path):
    with pytest.raises((ValueError,RuntimeError,OSError)):
        _run(valid_asset,tmp_path,blender='/definitely/absent/blender')
    runs=list((tmp_path/'project'/'renders').iterdir())
    assert len(runs)==1
    assert (runs[0]/'job.json').is_file()
    assert (runs[0]/'worker.log').is_file()
    reservation=json.loads((runs[0]/'reservation.json').read_text())
    assert reservation['status']=='failed'
    assert reservation['failure']


def test_timeout_kills_descendants_and_bounds_logs(valid_asset,tmp_path):
    runtime=_runtime(tmp_path, '''import os, subprocess, sys, time
subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'])
sys.stdout.write('x'*3000000);sys.stdout.flush()
time.sleep(60)
''')
    start=time.monotonic()
    with pytest.raises(RuntimeError,match='timeout'):
        _run(valid_asset,tmp_path,blender=runtime,timeout=1)
    assert time.monotonic()-start<6
    run=next((tmp_path/'project'/'renders').iterdir())
    assert (run/'worker.log').stat().st_size<=1024*1024
    assert 'timeout' in (run/'worker.log').read_text()
    assert json.loads((run/'reservation.json').read_text())['status']=='failed'


def test_child_environment_does_not_forward_credentials(valid_asset,tmp_path,monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','secret-test-token')
    monkeypatch.setenv('AWS_SECRET_ACCESS_KEY','cloud-token')
    monkeypatch.setenv('PYTHONPATH','/malicious')
    runtime=_runtime(tmp_path, 'import json, os\nprint(json.dumps(dict(os.environ)))\nraise SystemExit(7)\n')
    with pytest.raises(RuntimeError): _run(valid_asset,tmp_path,blender=runtime)
    log=next((tmp_path/'project'/'renders').iterdir()).joinpath('worker.log').read_text()
    assert 'secret-test-token' not in log and 'cloud-token' not in log
    assert 'PYTHONPATH' not in log
    assert 'OMP_NUM_THREADS' in log


def test_completed_runs_are_portable_unique_and_bound(valid_asset,tmp_path):
    from arc_science.figure_render import verify_render
    runtime=_successful_runtime(tmp_path)
    first=_run(valid_asset,tmp_path,blender=runtime)
    second=_run(valid_asset,tmp_path,blender=runtime)
    assert first['run_dir']!=second['run_dir']
    assert first['passed'] is True
    for field in ['rights_verified','scientific_validity_established','renderer_reexecuted']:
        assert first[field] is False
    run=Path(first['run_dir'])
    job=json.loads((run/'job.json').read_text())
    assert job['asset']==f'inputs/{valid_asset.parent.name}/asset.json'
    assert str(valid_asset.parent) not in (run/'job.json').read_text()
    assert (run/job['asset']).read_bytes()==valid_asset.read_bytes()
    moved=tmp_path/'delivery'/'moved-run'
    shutil.copytree(run,moved)
    shutil.rmtree(valid_asset.parent.parent)
    assert verify_render(moved)['passed'] is True
    (moved/'render.png').write_bytes(b'corrupt')
    with pytest.raises(ValueError): verify_render(moved)


@pytest.mark.parametrize('extra', [
    "receipt['job_sha256']='0'*64", "receipt['asset_id']='0'*64",
    "receipt['settings']['width']=512", "receipt['outputs']['image']['width']=512",
    "receipt['outputs']['scene']['file']='../scene.blend'",
    "receipt['rights_verified']=True", "receipt['runtime']['version']=[4,4,9]",
])
def test_forged_receipt_cannot_complete(valid_asset,tmp_path,extra):
    with pytest.raises((ValueError,RuntimeError)):
        _run(valid_asset,tmp_path,blender=_successful_runtime(tmp_path,extra))
    run=next((tmp_path/'project'/'renders').iterdir())
    assert json.loads((run/'reservation.json').read_text())['status']=='failed'


@_NEEDS_SYMLINK
def test_failed_reservation_and_symlink_outputs_never_verify(valid_asset,tmp_path):
    from arc_science.figure_render import verify_render
    result=_run(valid_asset,tmp_path,blender=_successful_runtime(tmp_path))
    run=Path(result['run_dir'])
    reservation=json.loads((run/'reservation.json').read_text())
    reservation['status']='failed'; reservation['failure']='injected'
    (run/'reservation.json').write_text(json.dumps(reservation))
    with pytest.raises(ValueError): verify_render(run)
    reservation['status']='completed'; reservation['failure']=None
    (run/'reservation.json').write_text(json.dumps(reservation))
    image=run/'render.png'; saved=tmp_path/'saved.png'; image.rename(saved); image.symlink_to(saved)
    with pytest.raises(ValueError): verify_render(run)


def test_direct_worker_rejects_invalid_job_without_bpy(valid_asset,tmp_path):
    import arc_science.figure_worker as worker
    with pytest.raises((RuntimeError,OSError)):
        _run(valid_asset,tmp_path,blender='/absent')
    run=next((tmp_path/'project'/'renders').iterdir())
    job=json.loads((run/'job.json').read_text()); job['settings']['width']=True
    (run/'job.json').write_text(json.dumps(job))
    result=subprocess.run([sys.executable,'-I',str(Path(worker.__file__)),'--',str(run/'job.json'),str(run)],capture_output=True,text=True,timeout=10)
    assert result.returncode!=0
    assert 'bpy' not in result.stderr
    assert not (run/'scene.blend').exists()


def test_worker_contract_rejects_bypasses(valid_asset,tmp_path):
    from arc_science.figure_contract import validate_job, read_json, open_directory
    with pytest.raises((RuntimeError,OSError)):
        _run(valid_asset,tmp_path,blender='/absent')
    run=next((tmp_path/'project'/'renders').iterdir())
    fd=open_directory(run)
    try:
        job=read_json(fd,'job.json')
        for key,value in [('asset','../asset.json'),('proof_sha256','0'*64),('unexpected','code')]:
            bad=json.loads(json.dumps(job)); bad[key]=value
            with pytest.raises(ValueError): validate_job(bad,fd)
        (run/job['asset']).with_name('source.png').write_bytes(b'not PNG')
        with pytest.raises(ValueError): validate_job(job,fd)
    finally: anchored.close_directory(fd)


def test_cli_render_and_verify_and_exclusive_runtime(valid_asset,tmp_path,capsys):
    from arc_science.cli import main
    runtime=_successful_runtime(tmp_path)
    assert main(['figure-render',str(valid_asset),'--project',str(tmp_path/'project'),
                 '--blender',runtime,'--width','256','--height','256','--samples','1'])==0
    result=json.loads(capsys.readouterr().out)
    assert main(['figure-verify',result['run_dir']])==0
    assert json.loads(capsys.readouterr().out)['passed'] is True
    with pytest.raises(SystemExit) as raised:
        main(['figure-render',str(valid_asset),'--project',str(tmp_path/'project'),
              '--blender','x','--blender-python','y'])
    assert raised.value.code==2


def test_default_render_is_publication_style_and_receipt_still_verifies(valid_asset,tmp_path,capsys):
    from arc_science.cli import main
    runtime=_successful_runtime(tmp_path)
    assert main(['figure-render',str(valid_asset),'--project',str(tmp_path/'project'),
                 '--blender',runtime,'--width','256','--height','256','--samples','1'])==0
    result=json.loads(capsys.readouterr().out)
    run=Path(result['run_dir'])
    assert json.loads((run/'job.json').read_text())['settings']['style']=='publication'
    assert main(['figure-verify',str(run)])==0
    assert json.loads(capsys.readouterr().out)['passed'] is True


def _reserved_run(valid_asset,tmp_path):
    with pytest.raises((RuntimeError,OSError)):
        _run(valid_asset,tmp_path,blender='/absent')
    run=next((tmp_path/'project'/'renders').iterdir())
    job=json.loads((run/'job.json').read_text())
    reservation=json.loads((run/'reservation.json').read_text())
    reservation['status']='reserved'; reservation['failure']=None
    (run/'reservation.json').write_text(json.dumps(reservation))
    return run,job,reservation


def _canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()


@pytest.mark.parametrize('mutation',['boolean','oversize','path','digest','unexpected','stale','proof','reservation'])
def test_direct_worker_validates_every_boundary_before_import(valid_asset,tmp_path,mutation):
    import arc_science.figure_worker as worker
    run,job,reservation=_reserved_run(valid_asset,tmp_path)
    if mutation=='boolean': job['settings']['samples']=True
    elif mutation=='oversize': job['settings']['width']=2049
    elif mutation=='path': job['asset']='../../asset.json'
    elif mutation=='digest': job['proof_sha256']='0'*64
    elif mutation=='unexpected': job['script']='print(1)'
    elif mutation=='stale': (run/'scene.blend').write_bytes(b'stale')
    elif mutation=='proof': (run/job['asset']).with_name('source.png').write_bytes(b'broken')
    elif mutation=='reservation': reservation['job_sha256']='0'*64
    (run/'job.json').write_bytes(_canonical(job))
    if mutation!='reservation': reservation['job_sha256']=hashlib.sha256(_canonical(job)).hexdigest()
    (run/'reservation.json').write_bytes(_canonical(reservation))
    result=subprocess.run([sys.executable,'-I',str(Path(worker.__file__)),'--',str(run/'job.json'),str(run)],
                          capture_output=True,text=True,timeout=10)
    assert result.returncode==1
    assert 'ValueError:' in result.stderr
    assert 'bpy' not in result.stderr
    assert not (run/'render.png').exists()


@_NEEDS_SYMLINK
def test_isolated_module_mode_argv_preserves_venv_path(valid_asset,tmp_path):
    runtime=_successful_runtime(tmp_path, "assert sys.argv[1]=='-I'\nassert sys.argv[3]=='--'")
    alias=tmp_path/'venv-python'; alias.symlink_to(runtime)
    result=_run(valid_asset,tmp_path,blender_python=str(alias))
    assert result['passed'] is True


@_POSIX_SANDBOX
def test_missing_no_follow_primitive_fails_closed(valid_asset,tmp_path,monkeypatch):
    from arc_science.figure_render import render_figure
    monkeypatch.delattr(os,'O_NOFOLLOW')
    with pytest.raises(ValueError,match='filesystem'):
        render_figure(valid_asset,tmp_path/'project')
    assert not (tmp_path/'project').exists()


@_POSIX_SANDBOX
def test_child_exit_does_not_wait_for_inherited_pipe(valid_asset,tmp_path):
    runtime=_successful_runtime(tmp_path,
        "import subprocess\nsubprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'])")
    start=time.monotonic()
    result=_run(valid_asset,tmp_path,blender=runtime,timeout=3)
    assert result['passed'] is True
    assert time.monotonic()-start<3


@pytest.mark.parametrize('style',['publication','studio','flat'])
@pytest.mark.parametrize('proof_size,frame_size', [((80,40),(1600,1200)),((40,80),(1600,1200)),((2048,1),(256,2048)),((1,2048),(2048,256))])
def test_framing_preserves_aspect_and_all_content(style,proof_size,frame_size):
    from arc_science.figure_worker import layout
    aw,ah,fw,fh,scale=layout(*proof_size,*frame_size,style)
    assert aw/ah==pytest.approx(proof_size[0]/proof_size[1])
    assert fw>aw and fh>ah
    aspect=frame_size[0]/frame_size[1]
    horizontal=scale if aspect>=1 else scale*aspect
    vertical=scale/aspect if aspect>=1 else scale
    assert horizontal>fw and vertical>fh


@_POSIX_SANDBOX
def test_returned_run_path_cannot_be_replaced_after_verification(valid_asset,tmp_path,monkeypatch):
    import arc_science.figure_render as rendering
    real_verify=rendering._verified_outputs
    def verify_then_swap(fd,job):
        result=real_verify(fd,job)
        run=tmp_path/'project'/'renders'/job['run_id']
        run.rename(run.with_name('held-original'))
        run.mkdir()
        return result
    monkeypatch.setattr(rendering,'_verified_outputs',verify_then_swap)
    with pytest.raises(ValueError,match='changed'):
        _run(valid_asset,tmp_path,blender=_successful_runtime(tmp_path))
    held=tmp_path/'project'/'renders'/'held-original'
    assert json.loads((held/'reservation.json').read_text())['status']=='failed'


@pytest.mark.skipif(not os.environ.get('ARC_FIGURE_TEST_BLENDER_PYTHON'),reason='Explicit official bpy runtime is needed for scene integration')
@pytest.mark.parametrize('style',['publication','studio','flat'])
def test_real_scene_packs_transparent_untinted_artwork(valid_asset,tmp_path,style):
    import arc_science.figure_worker as worker
    run,job,_=_reserved_run(valid_asset,tmp_path)
    job['settings']['style']=style
    script=tmp_path/'inspect_scene.py'
    script.write_text('''import importlib.util, json, pathlib, sys
import bpy
worker_path=pathlib.Path(sys.argv[1])
spec=importlib.util.spec_from_file_location('worker',worker_path)
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
run=pathlib.Path(sys.argv[2]);job=json.loads(sys.argv[3]);manifest=json.loads((run/job['asset']).read_text())
scene=worker._build_scene(bpy,job,manifest,(run/job['asset']).with_name('source.png'))
art=bpy.data.materials['Untinted source artwork'];nodes=art.node_tree.nodes
image=next(node.image for node in nodes if node.type=='TEX_IMAGE')
assert image.packed_file is not None and image.filepath.startswith('//inputs/')
assert image.alpha_mode=='STRAIGHT' and image.colorspace_settings.name=='sRGB'
assert any(link.from_socket.name=='Alpha' and link.to_node.type=='MIX_SHADER' for link in art.node_tree.links)
assert any(link.from_socket.name=='Color' and link.to_node.type=='EMISSION' for link in art.node_tree.links)
assert next(node for node in nodes if node.type=='EMISSION').inputs['Strength'].default_value==1
assert scene.view_settings.view_transform=='Standard' and scene.view_settings.exposure==0
assert scene.cycles.device=='CPU' and scene.render.threads==4 and scene.cycles.seed==23
panel=bpy.data.objects['Source proof, rasterized vector panel']
assert abs(panel.dimensions.x/panel.dimensions.y-2)<1e-6
assert scene.camera.data.type=='ORTHO'
if job['settings']['style']=='publication':
    assert 'Neutral backing' not in bpy.data.objects and 'Neutral ground' not in bpy.data.objects
    assert tuple(scene.world.node_tree.nodes['Background'].inputs['Color'].default_value)==(1.0,1.0,1.0,1.0)
    assert scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value==1.0
else:
    backing=bpy.data.objects['Neutral backing']
    assert bool(backing.modifiers)==(job['settings']['style']=='studio')
print('SCENE_ASSERTIONS_PASSED')
''')
    result=subprocess.run([os.environ['ARC_FIGURE_TEST_BLENDER_PYTHON'],'-I',str(script),
                           worker.__file__,str(run),json.dumps(job)],capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stderr+result.stdout
    assert 'SCENE_ASSERTIONS_PASSED' in result.stdout


@pytest.mark.skipif(not os.environ.get('ARC_FIGURE_TEST_BLENDER_PYTHON'),reason='Explicit official bpy runtime is needed for render integration')
def test_real_default_publication_render_has_exact_white_outer_canvas(valid_asset,tmp_path):
    from arc_science.figure_render import verify_render
    result=_run(valid_asset,tmp_path,
                blender_python=os.environ['ARC_FIGURE_TEST_BLENDER_PYTHON'])
    run=Path(result['run_dir'])
    image=Image.open(run/'render.png').convert('RGB')
    width,height=image.size
    border=([image.getpixel((x,y)) for x in range(width) for y in (0,height-1)] +
            [image.getpixel((x,y)) for y in range(height) for x in (0,width-1)])
    assert set(border)=={(255,255,255)}
    assert json.loads((run/'job.json').read_text())['settings']['style']=='publication'
    assert verify_render(run)['passed'] is True


def test_capture_failure_retains_failed_checkpoint(valid_asset,tmp_path,monkeypatch):
    import arc_science.figure_render as rendering
    def interrupted_capture(*args):
        raise ValueError('Source changed during capture')
    monkeypatch.setattr(rendering,'_capture',interrupted_capture)
    with pytest.raises(ValueError,match='capture'):
        _run(valid_asset,tmp_path,blender='/absent')
    run=next((tmp_path/'project'/'renders').iterdir())
    assert (run/'job.json').is_file()
    assert 'capture' in (run/'worker.log').read_text()
    assert json.loads((run/'reservation.json').read_text())['status']=='failed'
