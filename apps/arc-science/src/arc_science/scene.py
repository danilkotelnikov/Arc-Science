"""Scientific scene preparation and deterministic layout checks, independent of aesthetics."""
from __future__ import annotations
from dataclasses import dataclass
import hashlib
import math
from pathlib import Path
from typing import Literal
from pydantic import Field, model_validator
from .contracts import Record, Identifier, canonical, digest

def prepare_atomic_scene(data:bytes,*,format:str,source_id:str,target_chain:str,
                         ligand_chain:str,ligand_name:str,ligand_number:int,
                         coordinate_status:str,assembly_label:str,model_index:int=0,
                         ligand_insertion_code:str='') -> dict:
    import gemmi
    if len(data)>100*1024*1024:raise ValueError('Structure exceeds size limit')
    if coordinate_status not in {'experimental','predicted','docked'}:raise ValueError('Pose status must be explicit')
    if not source_id or not assembly_label:raise ValueError('Source and assembly status must be explicit')
    if format=='pdb':structure=gemmi.read_pdb_string(data.decode('utf-8'))
    elif format=='mmcif':structure=gemmi.make_structure_from_block(gemmi.cif.read_string(data.decode('utf-8')).sole_block())
    else:raise ValueError('Use PDB or mmCIF')
    if model_index<0 or model_index>=len(structure):raise ValueError('Model index not present')
    selected={}
    for chain in structure[model_index]:
        for residue in chain:
            is_ligand=(chain.name==ligand_chain and residue.name==ligand_name and
                       residue.seqid.num==ligand_number and residue.seqid.icode.strip()==ligand_insertion_code)
            is_protein=chain.name==target_chain and gemmi.find_tabulated_residue(residue.name).is_amino_acid()
            if not is_ligand and not is_protein:continue
            # Choose one coherent residue conformer, retaining shared blank atoms.
            # Atom-by-atom maxima can create a conformation absent from the structure.
            conformers = {}
            for atom in residue:
                alt = atom.altloc.strip('\x00 ')
                if alt and atom.occ > 0 and not atom.element.is_hydrogen:
                    conformers.setdefault(alt, []).append(atom.occ)
            selected_alt = (sorted(conformers, key=lambda a:
                            (-sum(conformers[a])/len(conformers[a]), a))[0]
                            if conformers else '')
            for atom in residue:
                if atom.occ<=0 or atom.element.is_hydrogen:continue
                if atom.altloc.strip('\x00 ') not in {'', selected_alt}:continue
                xyz=[atom.pos.x,atom.pos.y,atom.pos.z]
                if not all(math.isfinite(x) for x in xyz):raise ValueError('Nonfinite atomic coordinate')
                alt=atom.altloc.strip('\x00 ')
                identity=(chain.name,residue.seqid.num,residue.seqid.icode.strip(),residue.name,atom.name)
                value={'chain':chain.name,'residue_number':residue.seqid.num,'insertion_code':residue.seqid.icode.strip(),
                    'residue_name':residue.name,'atom_name':atom.name,'element':atom.element.name,
                    'altloc':alt,'occupancy':atom.occ,'xyz':xyz,'role':'ligand' if is_ligand else 'protein'}
                # Stable highest-occupancy selection; blank conformer wins exact occupancy ties.
                rank=(atom.occ,alt=='',tuple(-ord(x) for x in alt))
                if identity not in selected or rank>selected[identity][0]:selected[identity]=(rank,value)
    atoms=[item[1] for item in selected.values()]
    if not any(a['role']=='ligand' for a in atoms):raise ValueError('Requested ligand is absent; do not invent a pose')
    if not any(a['role']=='protein' for a in atoms):raise ValueError('Requested protein chain is absent')
    if len(atoms)>100000:raise ValueError('Atom count limit exceeded')
    for index,atom in enumerate(atoms):atom['index']=index
    result={'format_version':1,'source_id':source_id,'source_digest':hashlib.sha256(data).hexdigest(),
            'coordinate_status':coordinate_status,'coordinate_unit':'angstrom','assembly_label':assembly_label,
            'assembly_expansion_performed':False,'model_index':model_index,'representation':'atoms_and_ca_trace',
            'altloc_policy':'one_per_residue_by_mean_occupancy_shared_blank_atoms_retained','atoms':atoms,
            'scientific_limitations':['Selection validation is not experimental structure validation.',
             'No chemical bonds or noncovalent interactions inferred.',
             'Biological assembly must be resolved before this worker; deposited coordinates are not automatically an assembly.',
             'C-alpha trace is not a secondary-structure cartoon.',
             'Residue-local alternate selection does not establish correlated conformations across residues.']}
    result['scene_digest']=digest(result)
    return result

@dataclass(frozen=True)
class BlenderJob:
    scene:dict
    output_dir:Path
    seed:int=23
    samples:int=64

    def write(self) -> Path:
        if self.samples<1 or self.samples>4096 or self.seed<0:raise ValueError('Invalid render limits')
        scene=dict(self.scene);sha=scene.pop('scene_digest',None)
        if sha!=digest(scene):raise ValueError('Scene digest mismatch')
        root=Path(self.output_dir).resolve();root.mkdir(parents=True,exist_ok=True)
        target=root/'scene.json'
        target.write_bytes(canonical({'scene':self.scene,'render':{'seed':self.seed,'samples':self.samples,
             'angstrom_to_blender':0.1,'resolution':[1600,1200],'transparent':True,'engine':'CYCLES'}}))
        return target

    def argv(self,executable:str='blender') -> list[str]:
        worker=Path(__file__).resolve().with_name('blender_worker.py')
        if not worker.is_file():
            # Source-tree layout; wheel installations include the worker inside the package.
            worker=Path(__file__).resolve().parents[2]/'workers'/'blender_worker.py'
        root=Path(self.output_dir).resolve()
        return [executable,'--background','--factory-startup','--disable-autoexec','--python',str(worker),
                '--',str(root/'scene.json'),str(root)]

class LayoutItem(Record):
    id:Identifier
    kind:Literal['label','shape','panel']
    x:float
    y:float
    width:float=Field(gt=0)
    height:float=Field(gt=0)
    font_pt:float|None=Field(default=None,gt=0)
    parent:Identifier|None=None

def audit_layout(width:float,height:float,items:list[LayoutItem],*,connectors=(),min_font_pt:float=7) -> list[dict]:
    if not all(math.isfinite(x) and x>0 for x in (width,height,min_font_pt)):
        raise ValueError('Invalid canvas dimensions')
    by_id={item.id:item for item in items}
    if len(by_id)!=len(items):raise ValueError('Duplicate scene object IDs')
    issues=[]
    def flag(code,*ids):issues.append({'code':code,'objects':list(ids)})
    def inside(a,b):return a.x>=b.x and a.y>=b.y and a.x+a.width<=b.x+b.width and a.y+a.height<=b.y+b.height
    for item in items:
        if item.x<0 or item.y<0 or item.x+item.width>width or item.y+item.height>height:flag('clipping',item.id)
        if item.kind=='label':
            if item.font_pt is None:flag('missing_font_metrics',item.id)
            elif item.font_pt<min_font_pt:flag('font_too_small',item.id)
        if item.parent:
            parent=by_id.get(item.parent)
            if parent is None or parent.kind!='panel' or parent.id==item.id or not inside(item,parent):
                flag('invalid_parent_containment',item.id)
    for i,a in enumerate(items):
        for b in items[i+1:]:
            if a.parent==b.id or b.parent==a.id:continue
            if max(a.x,b.x)<min(a.x+a.width,b.x+b.width) and max(a.y,b.y)<min(a.y+a.height,b.y+b.height):
                flag('overlap',a.id,b.id)
    def crosses(start,end,box):
        # Liang-Barsky clipping; line intersections are checked in the same canvas coordinates.
        x,y=start;dx=end[0]-x;dy=end[1]-y;lo,hi=0.,1.
        for p,q in ((-dx,x-box.x),(dx,box.x+box.width-x),(-dy,y-box.y),(dy,box.y+box.height-y)):
            if p==0:
                if q<0:return False
                continue
            ratio=q/p
            if p<0:lo=max(lo,ratio)
            else:hi=min(hi,ratio)
            if lo>hi:return False
        return True
    for index,(start,end) in enumerate(connectors):
        if not all(math.isfinite(v) for v in (*start,*end)):raise ValueError('Invalid connector coordinates')
        for item in items:
            if item.kind=='label' and crosses(start,end,item):flag('leader_crosses_label',str(index),item.id)
    return issues
