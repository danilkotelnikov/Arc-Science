import ast
import hashlib
from pathlib import Path
import pytest
from conftest import module

# Synthetic coordinates for contract tests, not a biological result.
PDB=(
'ATOM      1  CA AALA A   1       0.000   0.000   0.000  0.40 20.00           C  \n'
'ATOM      2  CA BALA A   1       1.000   0.000   0.000  0.60 20.00           C  \n'
'ATOM      3  CA  GLY A   2       4.000   0.000   0.000  1.00 20.00           C  \n'
'HETATM    4  C1  LIG A 101       2.000   1.000   0.000  1.00 20.00           C  \n'
'HETATM    5  O1  LIG A 101       2.000   2.000   0.000  1.00 20.00           O  \n'
'END\n').encode()

def scene():
    s=module('scene')
    return s.prepare_atomic_scene(PDB,format='pdb',source_id='synthetic:test',target_chain='A',
                ligand_chain='A',ligand_name='LIG',ligand_number=101,coordinate_status='experimental',
                assembly_label='synthetic deposited coordinates')

def test_structure_identity_altloc_and_coordinate_provenance():
    value=scene()
    assert value['source_digest']==hashlib.sha256(PDB).hexdigest()
    assert value['coordinate_unit']=='angstrom'
    protein=[a for a in value['atoms'] if a['role']=='protein']
    ligand=[a for a in value['atoms'] if a['role']=='ligand']
    assert len(protein)==2 and len(ligand)==2
    assert protein[0]['altloc']=='B' and protein[0]['xyz']==[1.,0.,0.]
    assert value['coordinate_status']=='experimental'
    assert value['representation']=='atoms_and_ca_trace'
    assert 'bonds' not in value and 'contacts' not in value

def test_unknown_ligand_refuses_to_render_an_invented_pose():
    s=module('scene')
    with pytest.raises(ValueError):s.prepare_atomic_scene(PDB,format='pdb',source_id='synthetic:test',target_chain='A',
                ligand_chain='A',ligand_name='XXX',ligand_number=101,coordinate_status='predicted',assembly_label='none')

def test_mmcif_and_pdb_preserve_same_coordinates():
    s=module('scene');import gemmi
    cif=gemmi.read_pdb_string(PDB.decode()).make_mmcif_document().as_string().encode()
    result=s.prepare_atomic_scene(cif,format='mmcif',source_id='synthetic:test',target_chain='A',
                ligand_chain='A',ligand_name='LIG',ligand_number=101,coordinate_status='experimental',assembly_label='none')
    assert [a['xyz'] for a in result['atoms']]==[a['xyz'] for a in scene()['atoms']]

def test_blender_batch_is_not_a_model_terminal_and_has_safe_flags(tmp_path):
    s=module('scene');job=s.BlenderJob(scene=scene(),output_dir=tmp_path,seed=23,samples=32)
    spec=job.write()
    args=job.argv('/usr/bin/blender')
    assert '--background' in args and '--disable-autoexec' in args and '--factory-startup' in args
    assert '--' in args and str(spec) in args and ';' not in ' '.join(args)
    assert Path(args[args.index('--python')+1]).is_file()
    worker=Path(__file__).resolve().parents[1]/'workers'/'blender_worker.py'
    assert worker.is_file();ast.parse(worker.read_text())

def test_layout_detects_overlap_clipping_fonts_and_leader_crossing():
    s=module('scene')
    items=[s.LayoutItem(id='a',kind='label',x=0,y=0,width=20,height=10,font_pt=6),
           s.LayoutItem(id='b',kind='shape',x=10,y=2,width=20,height=10),
           s.LayoutItem(id='c',kind='shape',x=95,y=0,width=10,height=10)]
    issues=s.audit_layout(100,100,items,connectors=(((0,5),(30,5)),))
    assert {'overlap','clipping','font_too_small','leader_crosses_label'}<=set(x['code'] for x in issues)

def test_layout_has_explicit_parent_containment():
    s=module('scene')
    items=[s.LayoutItem(id='p',kind='panel',x=0,y=0,width=50,height=40),
           s.LayoutItem(id='t',parent='p',kind='label',x=5,y=5,width=20,height=8,font_pt=9)]
    assert not s.audit_layout(100,100,items)

@pytest.mark.parametrize('value',[float('nan'),float('inf'),-1,0])
def test_layout_rejects_invalid_box_dimensions(value):
    s=module('scene')
    with pytest.raises(ValueError):s.LayoutItem(id='a',kind='shape',x=0,y=0,width=value,height=10)

def test_pdf_rasterization_covers_every_page_and_binds_source(tmp_path):
    r=module('raster');store=module('store').ArtifactStore(tmp_path/'cas')
    from reportlab.pdfgen.canvas import Canvas
    import io,json
    data=io.BytesIO();canvas=Canvas(data,pagesize=(200,200))
    canvas.drawString(20,100,'Page one');canvas.showPage();canvas.drawString(20,100,'Page two');canvas.save()
    ref=store.put(data.getvalue(),name='test.pdf',media_type='application/pdf',role='source')
    bundle=r.rasterize_pdf(store,ref,dpi=72,max_pages=3)
    assert len(bundle.views)==2
    manifest=json.loads(store.read(bundle.manifest))
    assert manifest['source_digest']==ref.digest and [v['page'] for v in manifest['views']]==[1,2]
    assert all(a.role=='render' and a.media_type=='image/png' for a in bundle.views)
    with pytest.raises(ValueError):r.rasterize_pdf(store,ref,dpi=72,max_pages=1)

def test_residue_conformer_cannot_mix_atomwise_occupancy_winners():
    s=module('scene')
    data=(
      'ATOM      1  CA AALA A   1       0.000   0.000   0.000  0.60 20.00           C  \n'
      'ATOM      2  CA BALA A   1       1.000   0.000   0.000  0.40 20.00           C  \n'
      'ATOM      3  CB AALA A   1       0.000   1.000   0.000  0.30 20.00           C  \n'
      'ATOM      4  CB BALA A   1       1.000   1.000   0.000  0.70 20.00           C  \n'
      'HETATM    5  C1  LIG A 101       2.000   1.000   0.000  1.00 20.00           C  \n'
      'END\n').encode()
    result=s.prepare_atomic_scene(data,format='pdb',source_id='synthetic:altloc',target_chain='A',
                ligand_chain='A',ligand_name='LIG',ligand_number=101,coordinate_status='experimental',assembly_label='none')
    protein=[a for a in result['atoms'] if a['role']=='protein']
    assert len({a['altloc'] for a in protein})==1
    assert {a['altloc'] for a in protein}=={'B'}
