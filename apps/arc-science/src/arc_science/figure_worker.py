"""Fixed, isolated CPU Cycles worker. Accepts only a closed figure job contract."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import sys
import tempfile

# -I intentionally removes the application directory from sys.path. Load exactly
# the trusted adjacent stdlib helper, never any module from the run or inputs.
_helper = Path(__file__).absolute().with_name('figure_contract.py')
_spec = importlib.util.spec_from_file_location('_arc_figure_contract',_helper)
c = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(c)


def layout(proof_width, proof_height, width, height, style):
    """Aspect-preserving plane dimensions and camera scale with visible margins."""
    art_width = 4.0
    art_height = art_width * proof_height / proof_width
    margin = 0.28 if style == 'studio' else 0.14
    frame_width, frame_height = art_width+2*margin, art_height+2*margin
    # Blender's ortho_scale is the horizontal span for landscape frames and
    # vertical span for portrait frames (sensor fit AUTO).
    aspect = width/height
    vertical = max(frame_height,frame_width/aspect)*1.12
    return art_width,art_height,frame_width,frame_height,vertical*max(1.0,aspect)


def _material(bpy,name,color,roughness=0.8):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color,1)
    bsdf.inputs['Roughness'].default_value = roughness
    return material


def _build_scene(bpy, job, manifest, proof_path):
    settings = job['settings']
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = settings['samples']
    scene.cycles.seed = settings['seed']
    scene.cycles.use_denoising = False
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 4
    scene.render.resolution_x = settings['width']
    scene.render.resolution_y = settings['height']
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.film_transparent = False
    scene.render.use_file_extension = True
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.render.dither_intensity = 0
    scene.display_settings.display_device = 'sRGB'
    scene.world = bpy.data.worlds.new('Neutral environment')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (
        (1.0,1.0,1.0,1) if settings['style']=='publication' else (0.72,0.72,0.72,1))
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = (
        1.0 if settings['style']=='publication' else 0.7)
    aw,ah,fw,fh,scale = layout(manifest['preview']['width'],manifest['preview']['height'],
                             settings['width'],settings['height'],settings['style'])
    image = bpy.data.images.load(str(proof_path),check_existing=False)
    image.colorspace_settings.name = 'sRGB'
    image.alpha_mode = 'STRAIGHT'
    image.pack()
    image.filepath = '//inputs/'+job['asset_id']+'/source.png'
    artwork = bpy.data.materials.new('Untinted source artwork')
    artwork.use_nodes = True
    nodes = artwork.node_tree.nodes; nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    texture = nodes.new('ShaderNodeTexImage'); texture.image = image
    texture.interpolation = 'Linear'; texture.extension = 'CLIP'
    emission = nodes.new('ShaderNodeEmission'); emission.inputs['Strength'].default_value = 1
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    mix = nodes.new('ShaderNodeMixShader')
    links = artwork.node_tree.links
    links.new(texture.outputs['Color'],emission.inputs['Color'])
    links.new(texture.outputs['Alpha'],mix.inputs[0])
    links.new(transparent.outputs[0],mix.inputs[1])
    links.new(emission.outputs[0],mix.inputs[2])
    links.new(mix.outputs[0],output.inputs['Surface'])
    bpy.ops.mesh.primitive_plane_add(size=2,location=(0,0,0.045))
    panel = bpy.context.object; panel.name = 'Source proof, rasterized vector panel'
    panel.scale = (aw/2,ah/2,1); panel.data.materials.append(artwork)
    bpy.context.view_layer.update()
    # Publication proofs float directly on the white canvas. Legacy styles retain
    # their backing, ground, and lighting for callers that request them explicitly.
    if settings['style'] != 'publication':
        bpy.ops.mesh.primitive_cube_add(size=1,location=(0,0,-0.04))
        backing = bpy.context.object; backing.name = 'Neutral backing'
        backing.dimensions = (fw,fh,0.12 if settings['style']=='studio' else 0.025)
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        backing.data.materials.append(_material(bpy,'Backing',(0.93,0.93,0.93)))
        if settings['style']=='studio':
            bevel = backing.modifiers.new('Soft backing edge','BEVEL'); bevel.width = 0.055; bevel.segments = 4
        bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-0.14))
        bpy.context.object.name = 'Neutral ground'
        bpy.context.object.data.materials.append(_material(bpy,'Ground',(0.67,0.67,0.67)))
        from mathutils import Vector
        for name,location,power,size in [('Key',(-3,2,6),350,5),('Fill',(4,-1,5),170,4)]:
            light = bpy.data.lights.new(name,'AREA'); light.energy = power; light.shape = 'DISK'; light.size = size
            obj = bpy.data.objects.new(name,light); scene.collection.objects.link(obj)
            obj.location = location; obj.rotation_euler = (Vector((0,0,0))-obj.location).to_track_quat('-Z','Y').to_euler()
    camera_data = bpy.data.cameras.new('Orthographic figure camera')
    camera = bpy.data.objects.new('Orthographic figure camera',camera_data)
    scene.collection.objects.link(camera); camera.location = (0,0,10)
    camera_data.type = 'ORTHO'; camera_data.ortho_scale = scale
    camera_data.lens = 50; camera.rotation_euler = (0,0,0)
    scene.camera = camera
    scene['representation'] = 'rasterized_vector_panel'
    scene['source_asset_id'] = job['asset_id']
    return scene


def execute(job_path, run_dir):
    run_dir = c.absolute(run_dir); job_path = c.absolute(job_path)
    if job_path != run_dir/'job.json': raise ValueError('Worker requires the fixed job.json path')
    fd = c.open_directory(run_dir)
    try:
        job = c.read_json(fd,'job.json')
        manifest,proof = c.validate_job(job,fd)
        c.validate_reservation(c.read_json(fd,'reservation.json'),job,'reserved')
        c.read_regular(fd,'worker.log',c.LOG_LIMIT,empty=True)
        for name in ['scene.blend','render.png','render-receipt.json']:
            try: os.stat(name,dir_fd=fd,follow_symlinks=False)
            except FileNotFoundError: continue
            raise ValueError('Worker output already exists: '+name)
        # No Blender import or scene allocation occurs before all input checks.
        import bpy
        if tuple(bpy.app.version) < (4,5,0): raise ValueError('Blender 4.5 or later is required')
        with tempfile.TemporaryDirectory(prefix='arc-figure-scene-') as temporary:
            stage = Path(temporary)
            proof_path = stage/'source.png'; proof_path.write_bytes(proof)
            scene = _build_scene(bpy,job,manifest,proof_path)
            # Private staging avoids Blender following links in the delivered run.
            scene.render.filepath = '//render.png'
            bpy.ops.wm.save_as_mainfile(filepath=str(stage/'scene.blend'),check_existing=False,compress=False)
            staging_fd = c.open_directory(stage)
            try:
                scene_bytes = c.read_regular(staging_fd,'scene.blend',c.SCENE_LIMIT)
                c.write_new(fd,'scene.blend',scene_bytes)
                scene.render.filepath = str(stage/'render.png')
                bpy.ops.render.render(write_still=True)
                image = c.read_regular(staging_fd,'render.png',c.IMAGE_LIMIT)
                w,h,_ = c.png_pixels(image)
                if (w,h) != (job['settings']['width'],job['settings']['height']):
                    raise ValueError('Blender output dimensions mismatch')
                c.write_new(fd,'render.png',image)
            finally: os.close(staging_fd)
        receipt = {'format':'arc-figure-receipt/1','run_id':job['run_id'],
                   'job_sha256':c.digest(c.canonical(job)),'asset_id':job['asset_id'],
                   'source_sha256':job['source_sha256'],'proof_sha256':job['proof_sha256'],
                   'representation':'rasterized_vector_panel','settings':job['settings'],
                   'runtime':{'kind':'blender','version':list(bpy.app.version),'version_string':bpy.app.version_string},
                   'outputs':{'scene':{'file':'scene.blend','sha256':c.digest(scene_bytes),'size':len(scene_bytes)},
                              'image':{'file':'render.png','sha256':c.digest(image),'size':len(image),'width':w,'height':h}},
                   'rights_verified':False,'scientific_validity_established':False,'renderer_reexecuted':False}
        c.validate_receipt(receipt,job,fd)
        c.write_new(fd,'render-receipt.json',c.canonical(receipt))
    finally: os.close(fd)


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if '--' not in args or len(args[args.index('--')+1:]) != 2:
        raise ValueError('Expected -- job.json run-directory')
    execute(*args[args.index('--')+1:])


if __name__ == '__main__':
    try: main()
    except (ValueError,RuntimeError,OSError) as exc:
        print(type(exc).__name__+': '+str(exc),file=sys.stderr)
        raise SystemExit(1)
