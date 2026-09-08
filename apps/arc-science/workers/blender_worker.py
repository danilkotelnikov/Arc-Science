"""Run only inside a network-isolated Blender worker with a trusted scene manifest.

Draws actual atomic coordinates and an explicit C-alpha trace, not invented ribbon geometry.
No arbitrary scene Python, external assets or auto-executing blend files are accepted.
"""
import hashlib
import json
import math
from pathlib import Path
import sys


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()


def main():
    import bpy
    from mathutils import Vector
    if bpy.app.version<(4,5,0):raise RuntimeError('Blender 4.5+ required')
    marker=sys.argv.index('--');source=Path(sys.argv[marker+1]).resolve();out=Path(sys.argv[marker+2]).resolve()
    payload=json.loads(source.read_text());spec=payload['scene'];render=payload['render']
    unsigned={k:v for k,v in spec.items() if k!='scene_digest'}
    if hashlib.sha256(canonical(unsigned)).hexdigest()!=spec['scene_digest']:raise ValueError('Scene hash mismatch')
    atoms=spec['atoms']
    if not atoms or len(atoms)>100000:raise ValueError('Invalid atom count')
    if not all(len(a['xyz'])==3 and all(math.isfinite(x) for x in a['xyz']) for a in atoms):
        raise ValueError('Invalid coordinates')
    scale=render['angstrom_to_blender']
    if not 0<scale<=1 or not 1<=render['samples']<=4096:raise ValueError('Invalid renderer limits')
    out.mkdir(parents=True,exist_ok=True)
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    centre=sum((Vector(a['xyz']) for a in atoms),Vector())/len(atoms)
    coordinates=[(Vector(a['xyz'])-centre)*scale for a in atoms]
    radius=max(v.length for v in coordinates)+scale

    def material(name,colour):
        mat=bpy.data.materials.new(name);mat.use_nodes=True
        shader=mat.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value=(*colour,1);shader.inputs['Roughness'].default_value=.7
        return mat
    protein_mat=material('Protein - neutral',(0.56,.62,.67))
    ligand_mat=material('Ligand - highlight',(.85,.40,.16))

    def instances(name,indices,radius_a,mat):
        mesh=bpy.data.meshes.new(name);mesh.from_pydata([coordinates[i] for i in indices],[],[]);mesh.update()
        attribute=mesh.attributes.new('arc_atom_index','INT','POINT')
        attribute.data.foreach_set('value',indices)
        obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
        group=bpy.data.node_groups.new(name+'Geometry','GeometryNodeTree')
        group.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry')
        group.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
        n=group.nodes;l=group.links
        inp=n.new('NodeGroupInput');output=n.new('NodeGroupOutput')
        sphere=n.new('GeometryNodeMeshIcoSphere');sphere.inputs['Radius'].default_value=radius_a*scale
        sphere.inputs['Subdivisions'].default_value=2
        mats=n.new('GeometryNodeSetMaterial');mats.inputs['Material'].default_value=mat
        inst=n.new('GeometryNodeInstanceOnPoints')
        l.new(sphere.outputs['Mesh'],mats.inputs['Geometry']);l.new(mats.outputs['Geometry'],inst.inputs['Instance'])
        l.new(inp.outputs['Geometry'],inst.inputs['Points']);l.new(inst.outputs['Instances'],output.inputs['Geometry'])
        modifier=obj.modifiers.new(name='Atomic instances',type='NODES');modifier.node_group=group
        obj['source_scene_digest']=spec['scene_digest']
    ca=[a['index'] for a in atoms if a['role']=='protein' and a['atom_name']=='CA']
    lig=[a['index'] for a in atoms if a['role']=='ligand']
    instances('Protein CA atoms',ca,.28,protein_mat);instances('Ligand atoms',lig,.38,ligand_mat)
    # Draw only neighboring residues with plausible C-alpha separation; these are trace segments, not chemical bonds.
    curve=bpy.data.curves.new('C-alpha trace','CURVE');curve.dimensions='3D';curve.bevel_depth=.16*scale
    curve.bevel_resolution=3
    for previous,current in zip(ca,ca[1:]):
        a,b=atoms[previous],atoms[current]
        distance=(coordinates[previous]-coordinates[current]).length/scale
        if a['chain']!=b['chain'] or not 0<=b['residue_number']-a['residue_number']<=1 or not 2<=distance<=4.5:continue
        spline=curve.splines.new('POLY');spline.points.add(1)
        spline.points[0].co=(*coordinates[previous],1);spline.points[1].co=(*coordinates[current],1)
    trace=bpy.data.objects.new('C-alpha trace',curve);bpy.context.collection.objects.link(trace);curve.materials.append(protein_mat)
    camera_data=bpy.data.cameras.new('Camera');camera=bpy.data.objects.new('Camera',camera_data)
    bpy.context.collection.objects.link(camera);camera.location=Vector((1.3,-2,1.1)).normalized()*radius*4
    camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler()
    camera_data.type='ORTHO';camera_data.ortho_scale=radius*2.7;bpy.context.scene.camera=camera
    for name,location,energy in [('Key',(2,-3,4),600),('Fill',(-3,-1,2),250)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=radius*2
        light=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(light)
        light.location=Vector(location)*radius;light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU'
    scene.cycles.samples=render['samples'];scene.cycles.seed=render['seed'];scene.cycles.use_denoising=True
    scene.world.color=(.2,.2,.2);scene.render.film_transparent=True
    scene.render.resolution_x,scene.render.resolution_y=render['resolution'];scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.render.filepath=str(out/'structure.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'structure.blend'))
    bpy.ops.render.render(write_still=True)
    receipt={'scene_digest':spec['scene_digest'],'source_digest':spec['source_digest'],
        'blender_version':bpy.app.version_string,'engine':'CYCLES','device':'CPU',
        'seed':render['seed'],'samples':render['samples'],'coordinate_status':spec['coordinate_status'],
        'representation':spec['representation'],'coordinate_unit':'angstrom',
        'centre_angstrom':list(centre),'angstrom_to_blender':scale,
        'camera_matrix':[list(row) for row in camera.matrix_world],
        'image_digest':hashlib.sha256((out/'structure.png').read_bytes()).hexdigest(),
        'blend_digest':hashlib.sha256((out/'structure.blend').read_bytes()).hexdigest()}
    (out/'render-receipt.json').write_bytes(canonical(receipt))

if __name__=='__main__':main()
