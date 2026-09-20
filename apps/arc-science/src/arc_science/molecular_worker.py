"""Fixed Blender worker: editable, coordinate-derived envelopes and residue sticks.

Geometry helpers deliberately import no bpy, so scientific invariants can be
checked without a renderer. This is an illustrative density envelope, not SES.
"""
from __future__ import annotations
import json
import math
from pathlib import Path
import sys

# Heavy-atom side-chain topology; backbone edges are supplied separately.
_SIDECHAINS = {
 'ALA':'CA-CB', 'ARG':'CA-CB CB-CG CG-CD CD-NE NE-CZ CZ-NH1 CZ-NH2',
 'ASN':'CA-CB CB-CG CG-OD1 CG-ND2', 'ASP':'CA-CB CB-CG CG-OD1 CG-OD2',
 'CYS':'CA-CB CB-SG', 'GLN':'CA-CB CB-CG CG-CD CD-OE1 CD-NE2',
 'GLU':'CA-CB CB-CG CG-CD CD-OE1 CD-OE2', 'GLY':'',
 'HIS':'CA-CB CB-CG CG-ND1 ND1-CE1 CE1-NE2 NE2-CD2 CD2-CG',
 'ILE':'CA-CB CB-CG1 CB-CG2 CG1-CD1', 'LEU':'CA-CB CB-CG CG-CD1 CG-CD2',
 'LYS':'CA-CB CB-CG CG-CD CD-CE CE-NZ', 'MET':'CA-CB CB-CG CG-SD SD-CE',
 'PHE':'CA-CB CB-CG CG-CD1 CD1-CE1 CE1-CZ CZ-CE2 CE2-CD2 CD2-CG',
 'PRO':'CA-CB CB-CG CG-CD CD-N', 'SER':'CA-CB CB-OG',
 'THR':'CA-CB CB-OG1 CB-CG2',
 'TRP':'CA-CB CB-CG CG-CD1 CD1-NE1 NE1-CE2 CE2-CD2 CD2-CG CD2-CE3 CE3-CZ3 CZ3-CH2 CH2-CZ2 CZ2-CE2',
 'TYR':'CA-CB CB-CG CG-CD1 CD1-CE1 CE1-CZ CZ-CE2 CE2-CD2 CD2-CG CZ-OH',
 'VAL':'CA-CB CB-CG1 CB-CG2',
}


def select_detail_contacts(scene, limit=3):
    """The nearest geometric residue pairs, with stable author-identity ties."""
    return sorted(scene['contacts'],key=lambda c:(c['distance'],c['antibody_residue'],c['antigen_residue']))[:limit]


def view_annotations(scene, view, camera):
    """Project deposited atoms into the exact orthographic image pixel frame."""
    import numpy as np
    atoms={a['id']:a for a in scene['atoms']}
    width,height=camera['width'],camera['height']
    def project(atom):
        relative=np.asarray(atom['position'])-np.asarray(camera['target'])
        x=width/2+float(relative@np.asarray(camera['right']))*width/camera['orthographic_scale']
        y=height/2-float(relative@np.asarray(camera['up']))*width/camera['orthographic_scale']
        return [x,y]
    pairs=select_detail_contacts(scene)
    labels=[]; seen=set()
    for pair in pairs:
        for partner in ('antibody','antigen'):
            rid=pair[partner+'_residue']; atom=atoms[pair[partner+'_atom']]
            if rid not in seen:
                seen.add(rid)
                labels.append(dict(id=rid,atom=atom['id'],partner=partner,position=project(atom)))
    result=dict(residue_labels=labels if view!='overview' else [],distances=[])
    if view=='rotated':
        result['distances']=[dict(distance=c['distance'],antibody_atom=c['antibody_atom'],
            antigen_atom=c['antigen_atom'],endpoints=[project(atoms[c['antibody_atom']]),project(atoms[c['antigen_atom']])]) for c in pairs]
    if view=='overview':
        interface=[project(a) for a in scene['atoms'] if a['residue'] in scene['interface']['residue_ids']]
        if interface:
            p=np.asarray(interface)
            result['interface_bounds']=[float(p[:,0].min()),float(p[:,1].min()),float(p[:,0].max()),float(p[:,1].max())]
    else:
        visible={c[partner+'_residue'] for c in pairs for partner in ('antibody','antigen')} if view=='rotated' else set(scene['interface']['residue_ids'])
        result['content_points']=[project(a) for a in scene['atoms'] if a['residue'] in visible]
    return result


def camera_axes(scene):
    """Deterministic orthonormal basis, including coincident partner centroids."""
    import numpy as np
    atoms=scene['atoms']
    xyz=np.asarray([a['position'] for a in atoms])
    _,_,axes=np.linalg.svd(xyz-xyz.mean(axis=0),full_matrices=False)
    centers={p:np.mean([a['position'] for a in atoms if a['partner']==p],axis=0) for p in ('antibody','antigen')}
    horizontal=centers['antigen']-centers['antibody']
    if np.linalg.norm(horizontal)<1e-8:
        horizontal=axes[0].copy()
        significant=np.flatnonzero(np.abs(horizontal)>1e-8)
        if significant.size and horizontal[significant[0]]<0: horizontal=-horizontal
    horizontal/=np.linalg.norm(horizontal)
    vertical=axes[0]-np.dot(axes[0],horizontal)*horizontal
    if np.linalg.norm(vertical)<.01:
        ref=np.array([0.,0,1]) if abs(horizontal[2])<.9 else np.array([0.,1,0])
        vertical=ref-np.dot(ref,horizontal)*horizontal
    vertical/=np.linalg.norm(vertical)
    if vertical[2]<0: vertical=-vertical
    normal=np.cross(horizontal,vertical); normal/=np.linalg.norm(normal)
    return horizontal.tolist(),vertical.tolist(),normal.tolist()


def camera_frame(points, *, center, direction, right, width, height, padding=1.16):
    """Fit both image-plane bounds and camera clipping to coordinate geometry."""
    import numpy as np
    points=np.asarray(points); center=np.asarray(center,dtype=float)
    direction=np.asarray(direction,dtype=float); right=np.asarray(right,dtype=float)
    up=np.cross(direction,right); up/=np.linalg.norm(up)
    px=(points-center)@right; py=(points-center)@up
    center=center+right*((px.max()+px.min())/2)+up*((py.max()+py.min())/2)
    aspect=width/height
    scale=max(float(np.ptp(py))*aspect,float(np.ptp(px)),.01)*padding
    depth=(points-center)@direction
    margin=max(10.,float(np.ptp(depth))*.1)
    distance=max(50.,float(depth.max())+margin)
    return dict(target=center.tolist(),direction=direction.tolist(),right=right.tolist(),up=up.tolist(),
        orthographic_scale=scale,width=width,height=height,distance=distance,clip_start=.01,
        clip_end=distance-float(depth.min())+margin,
        geometry_depth_range=[float(depth.min()),float(depth.max())])


def covalent_bonds(scene, residue_ids=None):
    """Known residue edges, gated by plausible deposited covalent distances.

No inter-residue edges are guessed. Contact residues are shown as individual
residues, avoiding fictitious links across omitted segments or partner chains.
"""
    bonds = []
    atoms = scene['atoms']
    for residue in scene['residues']:
        if residue_ids is not None and residue['id'] not in residue_ids:
            continue
        names = {atoms[i]['name']: i for i in residue['atom_indices']}
        edges = 'N-CA CA-C C-O C-OXT ' + _SIDECHAINS.get(residue['name'], '')
        for edge in edges.split():
            a, b = edge.split('-')
            if a in names and b in names:
                i,j = names[a],names[b]
                d = math.dist(atoms[i]['position'],atoms[j]['position'])
                max_distance = 2.2 if a.startswith('S') or b.startswith('S') else 1.95
                if .9 <= d <= max_distance:
                    bonds.append((i,j))
    return bonds


DEFAULT_STYLE = {'background': 'transparent', 'world_strength': .7, 'roughness': .72, 'specular': .22,
                 'antibody_color': '#91AEC5', 'antigen_color': '#C4C9CC', 'isovalue': .45, 'stick_radius': .13}
WORLD_COLORS = {'transparent': (1, 1, 1), 'white': (1, 1, 1), 'light': (.92, .92, .92), 'dark': (.12, .12, .13), 'black': (0, 0, 0)}


def load_style(path):
    """The preset's style as written by the pipeline, or the reviewed default; every
    value is bounded here again so a stray file cannot steer the renderer."""
    style = dict(DEFAULT_STYLE)
    if path:
        given = json.loads(Path(path).read_text())
        for key in DEFAULT_STYLE:
            if key in given:
                style[key] = given[key]
    if style['background'] not in WORLD_COLORS: raise ValueError('Unknown background')
    for key, low, high in (('world_strength', 0, 3), ('roughness', 0, 1), ('specular', 0, 1), ('isovalue', .2, .8), ('stick_radius', .1, .5)):
        if not isinstance(style[key], (int, float)) or not low <= style[key] <= high: raise ValueError('Style value out of range: ' + key)
    for key in ('antibody_color', 'antigen_color'):
        value = style[key]
        if not (isinstance(value, str) and len(value) == 7 and value[0] == '#' and all(c in '0123456789abcdefABCDEF' for c in value[1:])):
            raise ValueError('Style colour is not a hex triplet: ' + key)
    return style


def atomic_envelope(positions, *, spacing=.6, isovalue=.45):
    """A bounded Gaussian density isosurface, preserving deposited coordinates."""
    import numpy as np
    from scipy.ndimage import gaussian_filter
    from skimage.measure import marching_cubes
    xyz = np.asarray(positions,dtype=float)
    if xyz.ndim != 2 or xyz.shape[1] != 3 or not len(xyz) or not np.isfinite(xyz).all():
        raise ValueError('Envelope requires finite atom coordinates')
    extent = np.ptp(xyz,axis=0)
    if max(extent) > 2000:
        raise ValueError('Molecular extent exceeds the supported 2000 angstrom bound')
    origin = xyz.min(axis=0)-5
    shape = np.ceil((extent+10)/spacing).astype(int)+1
    while math.prod(shape) > 4_000_000:
        spacing *= 1.15
        shape = np.ceil((extent+10)/spacing).astype(int)+1
    grid = np.zeros(tuple(shape),dtype=np.float32)
    # Trilinear deposition avoids snapping atomic centers to lattice points.
    fractional = (xyz-origin)/spacing
    lower = np.floor(fractional).astype(int)
    fraction = fractional-lower
    for x in (0,1):
        for y in (0,1):
            for z in (0,1):
                offset = np.array([x,y,z])
                weight = np.prod(np.where(offset,fraction,1-fraction),axis=1)
                ix = lower+offset
                np.add.at(grid,tuple(ix.T),weight)
    sigma = 1.0
    gaussian_filter(grid,sigma/spacing,output=grid)
    grid *= (math.sqrt(2*math.pi)*sigma/spacing)**3
    vertices, faces, _, _ = marching_cubes(grid, level=isovalue, spacing=(spacing,)*3)
    vertices += origin
    return vertices.tolist(),faces.tolist(),dict(grid_voxels=int(math.prod(shape)),spacing=spacing,
        gaussian_sigma=sigma,isovalue=isovalue,representation='illustrative atomic envelope')


def _stick_mesh(atoms, bonds, stick_radius=.13):
    """Batch spheres and cylinders into a single editable residue mesh."""
    import numpy as np
    vertices, faces = [], []
    def sphere(center, radius=.28):
        start = len(vertices)
        for lat in range(9):
            theta = math.pi*lat/8
            for lon in range(12):
                phi = 2*math.pi*lon/12
                vertices.append((center+radius*np.array([math.sin(theta)*math.cos(phi),math.sin(theta)*math.sin(phi),math.cos(theta)])).tolist())
        for lat in range(8):
            for lon in range(12):
                a=start+lat*12+lon; b=start+lat*12+(lon+1)%12
                faces.append((a,b,b+12,a+12))
    positions = {a['index']:np.array(a['position']) for a in atoms}
    for a in atoms:
        sphere(positions[a['index']], .30 if a['element'] in ('S','P') else .25)
    for i,j in bonds:
        if i not in positions or j not in positions:
            continue
        p,q=positions[i],positions[j]; axis=q-p; axis/=np.linalg.norm(axis)
        ref=np.array([1.,0,0]) if abs(axis[0])<.8 else np.array([0.,1,0])
        u=np.cross(axis,ref); u/=np.linalg.norm(u); v=np.cross(axis,u)
        start=len(vertices)
        for end in (p,q):
            for n in range(8):
                angle=2*math.pi*n/8
                vertices.append((end+stick_radius*(u*math.cos(angle)+v*math.sin(angle))).tolist())
        for n in range(8):
            faces.append((start+n,start+(n+1)%8,start+(n+1)%8+8,start+n+8))
    return vertices,faces


def main(scene_path, output, width, samples, seed, style_path=None):
    import bpy
    import numpy as np
    from mathutils import Matrix, Vector
    scene_data=json.loads(Path(scene_path).read_text())
    style=load_style(style_path)
    output=Path(output)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    scene.cycles.device='CPU'; scene.cycles.samples=samples; scene.cycles.seed=seed
    scene.cycles.use_denoising=True
    scene.render.threads_mode='FIXED'; scene.render.threads=4
    scene.render.resolution_x=width; scene.render.resolution_y=round(width*.66)
    scene.render.resolution_percentage=100
    scene.render.film_transparent=style['background']=='transparent'
    scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGBA'
    scene.render.image_settings.color_depth='8'
    scene.view_settings.view_transform='Standard'
    scene.world=bpy.data.worlds.new('Preset environment')
    scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(*WORLD_COLORS[style['background']],1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=style['world_strength']
    materials={}
    partner_colors={'antibody':style['antibody_color'],'antigen':style['antigen_color']}
    for name,color in partner_colors.items():
        rgb=[int(color[i:i+2],16)/255 for i in (1,3,5)]
        # Material inputs are linear; preserve the specified sRGB partner hues.
        rgb=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
        material=bpy.data.materials.new(name); material.diffuse_color=(*rgb,1)
        material.use_nodes=True
        shader=material.node_tree.nodes['Principled BSDF']
        shader.inputs['Base Color'].default_value=(*rgb,1)
        shader.inputs['Roughness'].default_value=style['roughness']
        shader.inputs['Specular IOR Level'].default_value=style['specular']
        materials[name]=material
    def mesh_object(name,vertices,faces,partner):
        mesh=bpy.data.meshes.new(name); mesh.from_pydata(vertices,[],faces); mesh.update()
        obj=bpy.data.objects.new(name,mesh); scene.collection.objects.link(obj)
        obj.data.materials.append(materials[partner])
        for polygon in mesh.polygons: polygon.use_smooth=True
        return obj
    all_atoms=scene_data['atoms']
    envelope_objects=[]; envelope_points=[]; geometries=[]
    for chain in scene_data['chains']:
        vertices,faces,info=atomic_envelope([all_atoms[i]['position'] for i in chain['atom_indices']],isovalue=style['isovalue'])
        obj=mesh_object('Envelope author chain '+chain['id'],vertices,faces,chain['partner'])
        obj['representation']='illustrative atomic envelope; Gaussian density, not SES'
        obj['author_chain']=chain['id']
        envelope_objects.append(obj); envelope_points.extend(vertices)
        geometries.append(dict(chain=chain['id'],vertices=len(vertices),faces=len(faces),**info))
    selected=set(scene_data['interface']['residue_ids']) or {r['id'] for r in scene_data['residues']}
    detail_pairs=select_detail_contacts(scene_data)
    detail_residues={c[partner+'_residue'] for c in detail_pairs for partner in ('antibody','antigen')} or selected
    bonds=covalent_bonds(scene_data,selected)
    stick_objects=[]; stick_points=[]; detail_points=[]
    for residue in scene_data['residues']:
        if residue['id'] not in selected: continue
        atoms=[all_atoms[i] for i in residue['atom_indices']]
        vertices,faces=_stick_mesh(atoms,bonds,style['stick_radius'])
        obj=mesh_object(residue['name']+' '+residue['id'],vertices,faces,residue['partner'])
        obj['residue_id']=residue['id']; obj['model_number']=scene_data['selection']['model_number']
        obj['assembly']=scene_data['selection']['assembly']
        stick_objects.append(obj); stick_points.extend(vertices)
        if residue['id'] in detail_residues: detail_points.extend(vertices)
    horizontal,vertical,normal=[np.asarray(axis) for axis in camera_axes(scene_data)]
    xyz=np.asarray([a['position'] for a in all_atoms])
    camera_data=bpy.data.cameras.new('Orthographic molecular camera')
    camera=bpy.data.objects.new('Orthographic molecular camera',camera_data); scene.collection.objects.link(camera)
    camera.data.type='ORTHO'; scene.camera=camera
    lights=[]
    for name,energy,size in [('Soft key',10000,65),('Soft fill',4000,55)]:
        data=bpy.data.lights.new(name,type='AREA'); data.energy=energy; data.shape='DISK'; data.size=size
        obj=bpy.data.objects.new(name,data); scene.collection.objects.link(obj); lights.append(obj)
    view_records={}
    for view,angle,points in [('overview',0,envelope_points),('interface',0,stick_points),('rotated',65,detail_points)]:
        detailed=view!='overview' and bool(scene_data['contacts'])
        if not detailed: points=envelope_points
        for obj in envelope_objects: obj.hide_render=detailed; obj.hide_viewport=detailed
        for obj in stick_objects:
            hidden=not detailed or (view=='rotated' and obj['residue_id'] not in detail_residues)
            obj.hide_render=hidden; obj.hide_viewport=hidden
        radians=math.radians(angle)
        direction=normal*math.cos(radians)+vertical*math.sin(radians)
        points=np.asarray(points)
        camera_right=horizontal.copy()
        if detailed:
            # Align the longest in-plane molecular extent horizontally, keeping
            # the chosen viewing direction and actual coordinate relationships.
            centered=points-points.mean(axis=0)
            plane=centered-np.outer(centered@direction,direction)
            _,_,plane_axes=np.linalg.svd(plane,full_matrices=False)
            camera_right=plane_axes[0]
            if np.dot(camera_right,vertical)<0: camera_right=-camera_right
        center=np.asarray(scene_data['interface']['center']) if detailed else xyz.mean(axis=0)
        frame=camera_frame(points,center=center,direction=direction,right=camera_right,
            width=scene.render.resolution_x,height=scene.render.resolution_y,padding=1.38 if detailed else 1.16)
        center=np.asarray(frame['target']); camera_up=np.asarray(frame['up'])
        camera.data.ortho_scale=frame['orthographic_scale']
        camera.data.clip_start=frame['clip_start']; camera.data.clip_end=frame['clip_end']
        camera.location=Vector(center+direction*frame['distance'])
        camera.rotation_euler=Matrix((camera_right,camera_up,direction)).transposed().to_euler()
        # Camera right is constrained to the partner axis, giving comparable angles.
        for light,offset in zip(lights,[direction*60+camera_up*45-horizontal*35,direction*45-camera_up*10+horizontal*45]):
            light.location=Vector(center+offset)
            light.rotation_euler=Vector(-offset).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=str(output/(view+'.png'))
        bpy.ops.wm.save_as_mainfile(filepath=str(output/(view+'.blend')))
        bpy.ops.render.render(write_still=True)
        view_records[view]=dict(**frame,rotation_degrees=angle,
            scope=('full selected complex; no contacts at selected cutoff' if not scene_data['contacts'] else 'full selected complex') if not detailed else 'all contacting residues' if view=='interface' else 'three closest geometric residue pairs',
            residue_ids=sorted(selected if view=='interface' else detail_residues) if detailed else [])
        view_records[view]['annotations']=view_annotations(scene_data,view,view_records[view])
    receipt=dict(format='molecular-worker/v1',blender_version=bpy.app.version_string,
                 engine='CYCLES',device='CPU',samples=samples,seed=seed,style=style,
                 envelope_geometry=geometries,covalent_bond_count=len(bonds),views=view_records,
                 geometry_source_sha256=scene_data['source']['sha256'])
    (output/'worker-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')


if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]
    main(args[0],args[1],int(args[2]),int(args[3]),int(args[4]),args[5] if len(args)>5 else None)
