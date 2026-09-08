"""Catch false covalent edges, inaccurate surfaces, clipping and export corruption."""
import importlib.util
import json
from pathlib import Path
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image, ImageDraw
import pytest

from test_molecular import structure


def module(name):
    assert importlib.util.find_spec('arc_science.'+name), f'{name} is not implemented'
    return __import__('arc_science.'+name, fromlist=['*'])


def test_envelope_tracks_real_coordinates_and_bounds_memory():
    worker = module('molecular_worker')
    vertices, faces, info = worker.atomic_envelope([[10,20,30], [13,20,30]])
    vertices = np.array(vertices)
    assert vertices[:,0].min() < 10 and vertices[:,0].max() > 13
    assert vertices.mean(axis=0)[1:] == pytest.approx([20,30], abs=.2)
    assert len(faces) > 10
    assert info['grid_voxels'] <= 4_000_000
    with pytest.raises(ValueError, match='extent'):
        worker.atomic_envelope([[0,0,0],[1e7,0,0]])


def test_known_covalent_geometry_never_connects_partners():
    worker = module('molecular_worker')
    scene = {'atoms':[
        {'index':0,'name':'N','residue':'H:1','position':[0,0,0]},
        {'index':1,'name':'CA','residue':'H:1','position':[1.45,0,0]},
        {'index':2,'name':'CB','residue':'H:1','position':[1.45,1.5,0]},
        {'index':3,'name':'CA','residue':'A:7','position':[2.9,0,0]},
    ], 'residues':[
        {'id':'H:1','name':'ALA','chain':'H','atom_indices':[0,1,2]},
        {'id':'A:7','name':'ALA','chain':'A','atom_indices':[3]},
    ]}
    assert worker.covalent_bonds(scene) == [(0,1),(1,2)]


def images(path, *, clipped=False, opaque=False):
    for name in ('overview','interface','rotated'):
        im = Image.new('RGBA',(200,160),(255,255,255,255) if opaque else (0,0,0,0))
        ImageDraw.Draw(im).ellipse((0 if clipped else 25,25,175,135),fill=(113,139,163,255))
        im.save(path/(name+'.png'))


def test_composition_keeps_canvas_white_svg_text_and_full_contact_table(tmp_path):
    figure = module('molecular_figure')
    from arc_science.molecular import prepare_complex
    scene = prepare_complex(structure(tmp_path), antibody_chains=('L','H'), antigen_chains=('A',))
    images(tmp_path)
    figure.compose_complex(scene,tmp_path,width=1000)
    im = Image.open(tmp_path/'collage.png').convert('RGB')
    assert im.getpixel((0,0)) == (255,255,255)
    assert im.getpixel((im.width//2,im.height-1)) == (255,255,255)
    root = ET.parse(tmp_path/'collage.svg').getroot()
    texts = [e.text for e in root.iter('{http://www.w3.org/2000/svg}text')]
    assert any('Geometric' in t for t in texts if t)
    assert len(list(root.iter('{http://www.w3.org/2000/svg}image'))) == 3
    assert 'H:1,A:7' in (tmp_path/'contacts.csv').read_text()
    checks = figure.check_images(tmp_path)
    assert checks['passed']


@pytest.mark.parametrize('options', [{'clipped':True},{'opaque':True}])
def test_image_checks_fail_for_clipping_or_no_alpha(tmp_path, options):
    figure = module('molecular_figure')
    images(tmp_path, **options)
    assert figure.check_images(tmp_path)['passed'] is False


def test_render_refuses_existing_directory_and_changed_source(tmp_path):
    figure = module('molecular_figure')
    from arc_science.molecular import prepare_complex
    path = structure(tmp_path)
    scene = prepare_complex(path, antibody_chains=('L','H'), antigen_chains=('A',))
    existing = tmp_path/'existing'; existing.mkdir(); (existing/'keep').write_text('original')
    with pytest.raises(FileExistsError):
        figure.render_complex(scene,existing,blender_python='/missing/runtime')
    assert (existing/'keep').read_text() == 'original'
    path.write_text(path.read_text()+'\n# changed\n')
    with pytest.raises(ValueError, match='digest'):
        figure.render_complex(scene,tmp_path/'new',blender_python='/missing/runtime')
    assert not (tmp_path/'new').exists()


def test_render_rejects_mutated_scene_before_creating_candidate(tmp_path):
    figure = module('molecular_figure')
    from arc_science.molecular import prepare_complex
    scene = prepare_complex(structure(tmp_path), antibody_chains=('L','H'), antigen_chains=('A',))
    scene['atoms'][0]['position'][0] = 0
    with pytest.raises(ValueError, match='reproduce'):
        figure.render_complex(scene,tmp_path/'forged',blender_python='/missing/runtime')
    assert not (tmp_path/'forged').exists()


def test_cli_accepts_author_chain_groups_and_reports_bad_selection(tmp_path, capsys):
    from arc_science.cli import main
    result = main(['molecule-render',str(structure(tmp_path)),'--antibody','L,H','--antigen','A',
                   '--assembly','missing','--output',str(tmp_path/'render'),'--blender-python','/missing/runtime'])
    assert result == 1
    assert 'assembly is absent' in capsys.readouterr().err


@pytest.mark.parametrize('cutoff,want_contacts',[(4.0,1),(1.0,0)])
def test_real_blender_export_binds_editable_geometry_and_worker_code(tmp_path, cutoff, want_contacts):
    import hashlib
    import os
    runtime = os.environ.get('ARC_MOLECULAR_BLENDER_PYTHON')
    if not runtime:
        pytest.skip('Set ARC_MOLECULAR_BLENDER_PYTHON to run actual Blender export')
    figure = module('molecular_figure')
    from arc_science.molecular import prepare_complex
    scene = prepare_complex(structure(tmp_path), antibody_chains=('L','H'), antigen_chains=('A',),cutoff=cutoff)
    result = figure.render_complex(scene,tmp_path/'actual',blender_python=runtime,width=640,samples=1)
    assert result['passed']
    run = Path(result['run_dir'])
    manifest = json.loads((run/'manifest.json').read_text())
    assert manifest['worker']['sha256'] == hashlib.sha256((run/'molecular_worker.py').read_bytes()).hexdigest()
    assert manifest['files']['source.cif']['sha256'] == scene['source']['sha256']
    assert manifest['composition']['total_contact_pairs'] == want_contacts
    if not want_contacts:
        receipt=json.loads((run/'worker-receipt.json').read_text())
        assert all('no contacts' in view['scope'] for view in receipt['views'].values())
        assert manifest['composition']['empty_contact_fallback'] is True
    import subprocess
    # Blender 5 stores compressed .blend files; loading them proves editability
    # more directly than relying on an obsolete uncompressed magic signature.
    script = '''import bpy, json, pathlib, sys
root=pathlib.Path(sys.argv[1]); checks={}
for view in ('overview','interface','rotated'):
    bpy.ops.wm.open_mainfile(filepath=str(root/(view+'.blend')))
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and not o.hide_render]
    checks[view]={'meshes':len(meshes),'vertices':sum(len(o.data.vertices) for o in meshes),
                  'camera':bpy.context.scene.camera.data.type,'transparent':bpy.context.scene.render.film_transparent}
(root/'test-inspection.json').write_text(json.dumps(checks))
'''
    subprocess.run([runtime,'-I','-c',script,str(run)],check=True,capture_output=True,timeout=60)
    inspection=json.loads((run/'test-inspection.json').read_text())
    for view in ('overview','interface','rotated'):
        assert inspection[view]['meshes'] > 0
        assert inspection[view]['vertices'] > 10
        assert inspection[view]['camera'] == 'ORTHO'
        assert inspection[view]['transparent'] is True
        assert Image.open(run/(view+'.png')).mode == 'RGBA'


def test_all_contact_pairs_are_visible_as_uniform_binary_dots(tmp_path):
    figure = module('molecular_figure')
    from arc_science.molecular import prepare_complex
    scene = prepare_complex(structure(tmp_path), antibody_chains=('L','H'), antigen_chains=('A',))
    # Nineteen distinct rows/columns catches the previous arbitrary 18-axis cap.
    scene['contacts'] = [dict(antibody_residue=f'H:{n}',antigen_residue=f'A:{n}',
        antibody_atom=f'H:{n}:CA',antigen_atom=f'A:{n}:CA',distance=2+n/20,atom_pair_count=1) for n in range(1,20)]
    scene['residues'] = [dict(id=f'{c}:{n}') for c in ('H','A') for n in range(1,20)]
    images(tmp_path)
    result = figure.compose_complex(scene,tmp_path,width=1000)
    assert result['displayed_contact_pairs'] == 19
    assert result['contact_encoding'] == 'binary proximity at declared cutoff'
    root = ET.parse(tmp_path/'collage.svg').getroot()
    dots = [e for e in root.iter('{http://www.w3.org/2000/svg}circle') if e.get('class') == 'contact-dot']
    assert len(dots) == 19
    assert len({e.get('r') for e in dots}) == 1
    assert (tmp_path/'caption.md').exists()


def test_detail_pairs_and_projection_labels_use_deposited_atom_ids(tmp_path):
    worker = module('molecular_worker')
    from arc_science.molecular import prepare_complex
    scene = prepare_complex(structure(tmp_path,insertion='B'),antibody_chains=('L','H'),antigen_chains=('A',))
    assert hasattr(worker,'view_annotations'), 'Coordinate-projected view annotations are absent'
    camera = dict(target=[0,0,0],right=[1,0,0],up=[0,1,0],orthographic_scale=10,width=200,height=160)
    annotations = worker.view_annotations(scene,'rotated',camera)
    assert [(x['id'],x['atom'],x['position']) for x in annotations['residue_labels']] == [
        ('H:1B','H:1B:CA',[100.0,80.0]),('A:7B','A:7B:CA',[170.0,80.0])]
    assert annotations['distances'][0]['distance'] == pytest.approx(3.5)
    assert annotations['distances'][0]['endpoints'] == [[100.0,80.0],[170.0,80.0]]
    overview = worker.view_annotations(scene,'overview',camera)
    assert overview['interface_bounds'] == [100.0,80.0,170.0,80.0]


def test_detail_selection_is_nearest_distance_with_stable_identity_ties():
    worker = module('molecular_worker')
    assert hasattr(worker,'select_detail_contacts'), 'Deterministic detail selection is absent'
    contacts = [dict(antibody_residue='H:'+a,antigen_residue='A:7',distance=d) for a,d in [('4',3.9),('3B',2.8),('2',2.1),('1',2.8)]]
    assert [c['antibody_residue'] for c in worker.select_detail_contacts({'contacts':contacts})] == ['H:2','H:1','H:3B']


def test_no_contact_caption_truthfully_scopes_full_complex_fallback(tmp_path):
    figure = module('molecular_figure')
    from arc_science.molecular import prepare_complex
    scene=prepare_complex(structure(tmp_path),antibody_chains=('L','H'),antigen_chains=('A',),cutoff=1)
    images(tmp_path)
    result=figure.compose_complex(scene,tmp_path,width=1000)
    assert result['empty_contact_fallback'] is True
    caption=(tmp_path/'caption.md').read_text()
    assert 'No contacts at the selected cutoff' in caption
    assert 'full selected complex' in caption
    assert 'three closest geometric residue pairs from b' not in caption


def test_camera_basis_is_finite_for_coincident_partner_centroids():
    worker=module('molecular_worker')
    assert hasattr(worker,'camera_axes'), 'Camera basis has no degenerate-centroid handling'
    scene={'atoms':[dict(partner=p,position=xyz) for p in ('antibody','antigen') for xyz in ([-1,0,0],[1,0,0])]}
    right,up,direction=worker.camera_axes(scene)
    basis=np.array([right,up,direction])
    assert np.isfinite(basis).all()
    assert basis@basis.T == pytest.approx(np.eye(3),abs=1e-8)
    assert worker.camera_axes(scene) == (right,up,direction)


def test_camera_depth_range_contains_long_geometry():
    worker=module('molecular_worker')
    assert hasattr(worker,'camera_frame'), 'Camera depth framing is fixed rather than geometry-derived'
    points=[[-1,-1,-900],[1,1,900]]
    frame=worker.camera_frame(points,center=[0,0,0],direction=[0,0,1],right=[1,0,0],width=640,height=422)
    assert frame['distance'] > 900
    assert frame['clip_start'] < frame['distance']-900
    assert frame['clip_end'] > frame['distance']+900


def test_capture_rechecks_source_size_before_read(tmp_path, monkeypatch):
    from arc_science.molecular import prepare_complex
    figure=module('molecular_figure')
    source=structure(tmp_path)
    scene=prepare_complex(source,antibody_chains=('L','H'),antigen_chains=('A',))
    with source.open('wb') as stream: stream.truncate(100*1024*1024+1)
    def unexpected_read(*args,**kwargs):
        pytest.fail('Capture read oversized coordinates before preflight')
    monkeypatch.setattr(Path,'read_bytes',unexpected_read)
    with pytest.raises(ValueError,match='100 MiB'):
        figure.render_complex(scene,tmp_path/'capture',blender_python='/missing/runtime')
    assert not (tmp_path/'capture').exists()


def test_envelope_resolves_atoms_separated_by_four_angstroms():
    worker=module('molecular_worker')
    vertices,faces,_=worker.atomic_envelope([[0,0,0],[4,0,0]])
    parent=list(range(len(vertices)))
    def root(i):
        while parent[i]!=i:
            parent[i]=parent[parent[i]]; i=parent[i]
        return i
    for a,b,c in faces:
        parent[root(b)]=root(a); parent[root(c)]=root(a)
    assert len({root(i) for i in range(len(vertices))}) == 2


def test_raster_contains_visible_projected_atom_labels_and_distances(tmp_path):
    figure=module('molecular_figure')
    from arc_science.molecular import prepare_complex
    scene=prepare_complex(structure(tmp_path),antibody_chains=('L','H'),antigen_chains=('A',))
    images(tmp_path)
    annotations=dict(residue_labels=[
        dict(id='H:1',atom='H:1:CA',partner='antibody',position=[85,80]),
        dict(id='A:7',atom='A:7:CA',partner='antigen',position=[115,80])],
        distances=[dict(distance=3.5,antibody_atom='H:1:CA',antigen_atom='A:7:CA',endpoints=[[85,80],[115,80]])])
    (tmp_path/'worker-receipt.json').write_text(json.dumps({'views':{'rotated':{'annotations':annotations,'rotation_degrees':65}}}))
    result=figure.compose_complex(scene,tmp_path,width=1400)
    assert 'label_layout' in result, 'Rendered annotation visibility is not recorded'
    placements=result['label_layout']['rotated']
    assert {label['text'] for label in placements} == {'H:1:CA','A:7:CA','3.50 Å'}
    rgb=np.array(Image.open(tmp_path/'collage.png').convert('RGB'))
    for label in placements:
        x,y,w,h=[round(v) for v in label['box']]
        ink=rgb[y:y+h,x:x+w].min(axis=2)<120
        assert int(ink.sum()) >= 10, f'No visible ink for {label["text"]}'
    texts=[e.text for e in ET.parse(tmp_path/'collage.svg').getroot().iter('{http://www.w3.org/2000/svg}text')]
    assert any('65°' in text for text in texts if text)


@pytest.mark.parametrize('entrypoint',['cli','api'])
def test_default_render_emits_reviewed_candidate_settings(tmp_path, monkeypatch, entrypoint):
    import sys
    from arc_science import figure_render
    from arc_science.cli import main
    from arc_science.molecular import prepare_complex
    figure=module('molecular_figure')
    commands=[]
    def stop_at_renderer_boundary(argv, *args):
        commands.append(argv)
        raise RuntimeError('Blender execution deliberately stopped at test boundary')
    # Source selection/capture and command construction run for real. Only the
    # external render process is intercepted; no new candidate image is made.
    monkeypatch.setattr(figure_render,'_execute',stop_at_renderer_boundary)
    source=structure(tmp_path); output=tmp_path/'defaults'
    if entrypoint=='cli':
        assert main(['molecule-render',str(source),'--antibody','L,H','--antigen','A',
                     '--output',str(output),'--blender-python',sys.executable]) == 1
    else:
        scene=prepare_complex(source,antibody_chains=('L','H'),antigen_chains=('A',))
        with pytest.raises(RuntimeError,match='test boundary'):
            figure.render_complex(scene,output,blender_python=sys.executable)
    # 1400-wide figure -> 640-wide molecular raster, with reviewed 96/23 settings.
    assert len(commands)==1
    assert commands[0][-3:] == ['640','96','23']
