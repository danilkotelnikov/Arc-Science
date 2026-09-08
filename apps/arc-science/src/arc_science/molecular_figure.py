"""Immutable molecular render runs and a white, vector-labeled four-panel figure."""
from __future__ import annotations
import base64
import csv
import hashlib
import html
import json
import math
import os
from pathlib import Path
import shutil
import subprocess

from PIL import Image


def _json(path, value):
    path.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n',encoding='utf-8')


def compose_complex(scene: dict, output: Path, *, width: int = 1400) -> dict:
    """White four-panel scientific figure; molecular annotations are projections."""
    import cairosvg
    output=Path(output)
    fields=['antibody_residue','antigen_residue','antibody_atom','antigen_atom','distance','atom_pair_count']
    with (output/'contacts.csv').open('w',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=fields); writer.writeheader(); writer.writerows(scene['contacts'])
    W,H=1400,1090
    svg=[f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{width}" height="{round(width*H/W)}" viewBox="0 0 {W} {H}">',
         '<rect width="1400" height="1090" fill="#FFFFFF"/>']
    def text(x,y,value,size=18,color='#26323B',weight='400',extra=''):
        svg.append(f'<text x="{x}" y="{y}" font-family="DejaVu Sans, Arial, sans-serif" font-size="{size}" fill="{color}" font-weight="{weight}" {extra}>{html.escape(str(value))}</text>')
    def circle(x,y,r,color,extra=''):
        svg.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{color}" {extra}/>')
    def line(points,color='#7D8991',extra=''):
        svg.append(f'<polyline points="{" ".join(f"{x:.3f},{y:.3f}" for x,y in points)}" fill="none" stroke="{color}" stroke-width="1" {extra}/>')
    selection=scene['selection']; cutoff=scene['contact_definition']['cutoff']
    text(36,28,f'{Path(scene["source"]["name"]).stem} · Model {selection["model_number"]} · Assembly {selection["assembly"]}',16,color='#59656E')
    colors=scene['representation']['colors']
    circle(937,22,6,colors['antibody']); text(952,28,'Antibody '+', '.join(selection['antibody_chains']),16)
    circle(1174,22,6,colors['antigen']); text(1189,28,'Antigen '+', '.join(selection['antigen_chains']),16)
    empty=not scene['contacts']
    receipt_path=output/'worker-receipt.json'
    views=json.loads(receipt_path.read_text()).get('views',{}) if receipt_path.exists() else {}
    angle=views.get('rotated',{}).get('rotation_degrees')
    detail_title='Rotated complex' if empty else 'Closest residue pairs'
    if angle is not None: detail_title+=f' · {angle:g}°'
    titles=[('a','Complex',36,78),('b','No contacting residues' if empty else 'Interface',732,78),
            ('c',detail_title,36,559),('d','Geometric contacts',732,559)]
    for letter,title,x,y in titles:
        text(x,y,letter,25,weight='700'); text(x+30,y,title,21,weight='500')
    annotation_records={}; label_layout={}
    for name,x,y in [('overview',36,95),('interface',732,95),('rotated',36,582)]:
        box_w,box_h=632,405
        encoded=base64.b64encode((output/(name+'.png')).read_bytes()).decode()
        svg.append(f'<image x="{x}" y="{y}" width="{box_w}" height="{box_h}" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,{encoded}"/>')
        with Image.open(output/(name+'.png')) as raster:
            scale=min(box_w/raster.width,box_h/raster.height)
            ox=x+(box_w-raster.width*scale)/2; oy=y+(box_h-raster.height*scale)/2
        def mapped(point): return [ox+point[0]*scale,oy+point[1]*scale]
        annotation=views.get(name,{}).get('annotations',{})
        annotation_records[name]=annotation
        if name=='overview' and annotation.get('interface_bounds'):
            bounds=annotation['interface_bounds']
            p=mapped(bounds[:2]); q=mapped(bounds[2:])
            left,top=p[0]-7,p[1]-7; right,bottom=q[0]+7,q[1]+7
            svg.append(f'<rect x="{left}" y="{top}" width="{right-left}" height="{bottom-top}" rx="2" fill="none" stroke="#61727D" stroke-width="1"/>')
            text(right+7,top+14,'b',17,weight='600')
        labels=annotation.get('residue_labels',[])
        occupied=[mapped(point) for point in annotation.get('content_points',[])]
        placements=[]
        def place_label(value,anchor,color):
            # Prefer nearby empty image space. A white mask is painted before
            # the ink; this works in CairoSVG without unsupported paint-order.
            label_w=max(62,len(value)*9+10); label_h=24
            candidates=[]
            for distance in (18,32,48,68,90):
                for dx,dy in ((1,-1),(-1,-1),(1,1),(-1,1),(0,-1),(0,1),(1,0),(-1,0)):
                    left=anchor[0]+dx*distance-(label_w if dx<0 else label_w/2 if dx==0 else 0)
                    top=anchor[1]+dy*distance-(label_h if dy<0 else label_h/2 if dy==0 else 0)
                    if not (x+5<=left and left+label_w<=x+box_w-5 and y+5<=top and top+label_h<=y+box_h-5): continue
                    overlap=sum(max(0,min(left+label_w,p['box'][0]+p['box'][2])-max(left,p['box'][0]))*
                                max(0,min(top+label_h,p['box'][1]+p['box'][3])-max(top,p['box'][1])) for p in placements)
                    molecular=sum(left-5<=px<=left+label_w+5 and top-5<=py<=top+label_h+5 for px,py in occupied)
                    end=[min(max(anchor[0],left),left+label_w),min(max(anchor[1],top),top+label_h)]
                    score=overlap*100+molecular*30+math.dist(anchor,end)
                    candidates.append((score,left,top,end))
            if not candidates: raise ValueError('Molecular annotation cannot fit within its panel')
            _,left,top,end=min(candidates,key=lambda value:value[:3])
            line([anchor,end],'#86959F')
            svg.append(f'<rect x="{left}" y="{top}" width="{label_w}" height="{label_h}" fill="#FFFFFF"/>')
            text(left+5,top+18,value,17,color,weight='500')
            placements.append(dict(text=value,box=[left,top,label_w,label_h],anchor=anchor,leader_end=end))
        for distance in annotation.get('distances',[]):
            endpoints=[mapped(point) for point in distance['endpoints']]
            line(endpoints,'#667780',extra='stroke-dasharray="3 3"')
            mid=[sum(point[i] for point in endpoints)/2 for i in (0,1)]
            place_label(f'{distance["distance"]:.2f} Å',mid,'#354B5B')
        for label in labels:
            place_label(label['atom'],mapped(label['position']),'#425D73' if label['partner']=='antibody' else '#586168')
        label_layout[name]=placements
    contacts=scene['contacts']
    residue_order={r['id']:i for i,r in enumerate(scene['residues'])}
    row_names=sorted({c['antibody_residue'] for c in contacts},key=lambda r:residue_order[r])
    col_names=sorted({c['antigen_residue'] for c in contacts},key=lambda r:residue_order[r])
    x0,y0=835,616
    dx=min(25,474/max(1,len(col_names)-1)); dy=min(18,336/max(1,len(row_names)-1))
    label_size=min(14,max(7,min(dx,dy)*.78))
    text(752,592,'Antibody',15,'#52616D')
    text(1090,1032,'Antigen',15,'#52616D',extra='text-anchor="middle"')
    for i,name in enumerate(row_names):
        text(x0-14,y0+i*dy+4,name,label_size,extra='text-anchor="end"')
        line([[x0-4,y0+i*dy],[x0+(max(1,len(col_names))-1)*dx+4,y0+i*dy]],'#EDF0F2')
    for j,name in enumerate(col_names):
        px=x0+j*dx; py=y0+max(1,len(row_names)-1)*dy+19
        text(px,py,name,label_size,extra=f'transform="rotate(55 {px} {py})"')
    rows={name:i for i,name in enumerate(row_names)}; columns={name:j for j,name in enumerate(col_names)}
    radius=min(4.2,max(1.2,min(dx,dy)*.24))
    for contact in contacts:
        circle(x0+columns[contact['antigen_residue']]*dx,y0+rows[contact['antibody_residue']]*dy,radius,'#6F93AE',extra='class="contact-dot"')
    if not contacts: text(820,780,'No contacts at the selected cutoff.',20)
    text(732,1064,f'{len(contacts)} residue pairs · heavy-atom distance ≤ {cutoff:g} Å',15,color='#59656E')
    svg.append('</svg>')
    (output/'collage.svg').write_text('\n'.join(svg)+'\n',encoding='utf-8')
    cairosvg.svg2png(bytestring='\n'.join(svg).encode(),write_to=str(output/'collage.png'))
    from .molecular_worker import select_detail_contacts
    detail_pairs=select_detail_contacts(scene)
    pair_description=f'{len(detail_pairs)} closest geometric residue pair'+('' if len(detail_pairs)==1 else 's')
    assembly_description=(selection['assembly_application'] if selection['assembly']=='asymmetric_unit'
                          else f'biological assembly {selection["assembly"]} ({selection["assembly_application"]})')
    locator=('The thin locator encloses the projected atoms of contacting residues shown in b.'
             if annotation_records['overview'].get('interface_bounds') else 'No locator is shown in a.')
    caption=[f'# {Path(scene["source"]["name"]).stem}: antibody–antigen interface',
        '',f'Author chains {", ".join(selection["antibody_chains"])} form one antibody partner; antigen chains: {", ".join(selection["antigen_chains"])}. Model {selection["model_number"]}, {assembly_description}.',
        '', f'**a.** Full selected complex as coordinate-derived illustrative atomic envelopes. {locator} These Gaussian density surfaces are approximate, not solvent-excluded surfaces.',
        '', f'**b.** All residues participating in geometric inter-partner contacts. Individual residue covalent sticks retain deposited positions. Labels identify residues in the {pair_description}, using author chain, residue number and insertion code.',
        '', f'**c.** The {pair_description} from b, shown in a rotated local view. All other residues are omitted. Labels and dashed distance segments are projections of deposited atom coordinates. Dashed segments denote geometric separation, not hydrogen bonds. Numbers are distances between the closest heavy atoms of each residue pair.',
        '',f'**d.** Complete binary residue contact matrix: {len(contacts)} pairs. A uniform dot marks a minimum heavy-atom separation ≤ {cutoff:g} Å; absent dots mean no contact at that cutoff. Every contact is retained in contacts.csv.',
        '', '| Antibody atom | Antigen atom | Distance (Å) |', '|---|---|---:|']
    caption.extend(f'| {c["antibody_atom"]} | {c["antigen_atom"]} | {c["distance"]:.4f} |' for c in detail_pairs)
    if empty:
        caption=[paragraph for paragraph in caption if not paragraph.startswith(('**b.**','**c.**'))]
        caption[4:4]=['', '**b–c.** No contacts at the selected cutoff. These views show the full selected complex as illustrative atomic envelopes, with a rotated view in c. No interface or closest-pair annotations are inferred.']
    caption.extend(['', 'Geometric proximity does not establish hydrogen bonds, affinity, energetic hotspots or publication readiness.',
        '',f'Source SHA-256: `{scene["source"]["sha256"]}`. The hybrid SVG embeds transparent molecular rasters; labels and matrix remain editable vector elements. Editable molecular mesh geometry is preserved in the .blend files.',
        '', 'Excluded solvent and representation limitations: '+ ' '.join(scene['warnings'])])
    (output/'caption.md').write_text('\n'.join(caption)+'\n',encoding='utf-8')
    return dict(width=width,height=round(width*H/W),displayed_contact_pairs=len(contacts),
                total_contact_pairs=len(contacts),contact_encoding='binary proximity at declared cutoff',
                detail_pair_count=len(detail_pairs),annotations=annotation_records,empty_contact_fallback=empty,label_layout=label_layout)


def check_images(output: Path) -> dict:
    """Pixel evidence for alpha, white canvas and safe molecular image margins."""
    import numpy as np
    checks={}
    for name in ('overview','interface','rotated'):
        with Image.open(Path(output)/(name+'.png')) as image:
            rgba=np.array(image.convert('RGBA')); alpha=rgba[:,:,3]
            mask=alpha>8
            ys,xs=np.where(mask)
            meaningful=bool(len(xs) and np.count_nonzero(alpha==0)>.05*alpha.size and np.count_nonzero(alpha>128)>.005*alpha.size)
            bounds=[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)] if len(xs) else None
            margin=max(2,round(min(image.size)*.01))
            contained=bool(bounds and bounds[0]>=margin and bounds[1]>=margin and bounds[2]<=image.width-margin and bounds[3]<=image.height-margin)
            checks[name]=dict(rgba=image.mode=='RGBA',meaningful_alpha=meaningful,alpha_bounds=bounds,
                              inside_bounds=contained,width=image.width,height=image.height,
                              passed=image.mode=='RGBA' and meaningful and contained)
    collage=Path(output)/'collage.png'
    if collage.exists():
        with Image.open(collage) as image:
            rgb=np.array(image.convert('RGB'))
            # Border and panel gutters are outside molecular content and labels.
            border=np.concatenate([rgb[0],rgb[-1],rgb[:,0],rgb[:,-1]])
            gutter=rgb[int(image.height*.1):int(image.height*.9),int(image.width*.49):int(image.width*.51)]
            white=bool((border==255).all() and (gutter==255).all())
            checks['canvas']=dict(white_background_pixels=white,passed=white)
    return dict(passed=all(c['passed'] for c in checks.values()),images=checks,
                scope='Pixel integrity and containment only; no visual-provider review is implied')


def render_complex(scene: dict, output: Path, *, blender_python: str,
                   width: int = 1400, samples: int = 96, seed: int = 23) -> dict:
    """Create a fresh candidate directory. Existing candidates are never overwritten."""
    output=Path(output).absolute()
    if output.exists(): raise FileExistsError('Candidate directory already exists: '+str(output))
    if not isinstance(width,int) or not 640<=width<=4000: raise ValueError('Width must be in [640, 4000]')
    if not isinstance(samples,int) or not 1<=samples<=256: raise ValueError('Samples must be in [1, 256]')
    if not isinstance(seed,int) or not 0<=seed<2**31: raise ValueError('Seed must be a nonnegative 31-bit integer')
    from .molecular import prepare_complex, read_coordinate_source
    raw=read_coordinate_source(Path(scene['source']['path']))
    if hashlib.sha256(raw).hexdigest()!=scene['source']['sha256']:
        raise ValueError('Source digest changed since coordinate preparation')
    # Verify that the selected coordinates and every derived contact still match
    # the captured source. A mutated in-memory scene cannot claim its old digest.
    selection=scene['selection']
    replay=prepare_complex(Path(scene['source']['path']),antibody_chains=tuple(selection['antibody_chains']),
        antigen_chains=tuple(selection['antigen_chains']),model_index=selection['model_index'],
        assembly=selection['assembly'],cutoff=scene['contact_definition']['cutoff'])
    for field in ('atoms','residues','chains','contacts','interface','selection','contact_definition'):
        if replay[field]!=scene[field]: raise ValueError('Scene does not reproduce source coordinates: '+field)
    runtime=os.path.abspath(blender_python) if os.sep in blender_python else shutil.which(blender_python)
    if not runtime or not Path(runtime).is_file(): raise ValueError('Blender Python executable is absent')
    output.mkdir(parents=True,exist_ok=False)
    _json(output/'scene.json',scene)
    suffix=Path(scene['source']['path']).suffix.lower()
    (output/('source'+suffix)).write_bytes(raw)
    _json(output/'run.json',dict(status='rendering',width=width,samples=samples,seed=seed))
    try:
        worker_bytes=Path(__file__).with_name('molecular_worker.py').read_bytes()
        worker=output/'molecular_worker.py'
        worker.write_bytes(worker_bytes)
        worker_sha256=hashlib.sha256(worker_bytes).hexdigest()
        argv=[runtime,'-I',str(worker),'--',str(output/'scene.json'),str(output),str((width-120)//2),str(samples),str(seed)]
        # Reuse the bounded local renderer executor: sanitized environment,
        # process-group timeout, and capped logs; no credentials in the worker.
        from .figure_render import _execute
        fd=os.open(output,os.O_RDONLY|os.O_DIRECTORY)
        log_fd=os.open(output/'worker.log',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        try: _execute(argv,fd,log_fd,900)
        finally: os.close(log_fd); os.close(fd)
        if json.loads((output/'scene.json').read_text())!=scene: raise ValueError('Scene changed during rendering')
        if hashlib.sha256((output/('source'+suffix)).read_bytes()).hexdigest()!=scene['source']['sha256']:
            raise ValueError('Captured source digest changed')
        receipt=json.loads((output/'worker-receipt.json').read_text())
        if receipt['geometry_source_sha256']!=scene['source']['sha256']: raise ValueError('Worker source digest mismatch')
        if hashlib.sha256(worker.read_bytes()).hexdigest()!=worker_sha256: raise ValueError('Worker code digest changed')
        for name in ('overview','interface','rotated'):
            if (output/(name+'.blend')).stat().st_size<1000: raise ValueError('Missing editable Blender geometry')
        composition=compose_complex(scene,output,width=width)
        checks=check_images(output)
        checks['source_replay']=True
        checks['finite_coordinates']=all(math.isfinite(v) for a in scene['atoms'] for v in a['position'])
        _json(output/'checks.json',checks)
        if not checks['passed']: raise RuntimeError('Molecular image checks failed; inspect checks.json')
        _json(output/'run.json',dict(status='completed',width=width,samples=samples,seed=seed))
        files={p.name:dict(sha256=hashlib.sha256(p.read_bytes()).hexdigest(),bytes=p.stat().st_size)
               for p in sorted(output.iterdir()) if p.is_file() and p.name!='manifest.json'}
        manifest=dict(format='molecular-artifacts/v1',source_sha256=scene['source']['sha256'],files=files,
            worker=dict(file='molecular_worker.py',sha256=worker_sha256,blender_version=receipt['blender_version']),
            selection=selection,representation=scene['representation'],composition=composition,
            checks_passed=True,scientific_scope='Coordinate-derived geometric contacts; no affinity or hydrogen-bond inference',
            visual_review='not performed by this renderer',publication_ready=False)
        _json(output/'manifest.json',manifest)
        return dict(passed=True,run_dir=str(output),image=str(output/'collage.png'),
                    manifest=str(output/'manifest.json'),source_sha256=scene['source']['sha256'],
                    contact_pairs=len(scene['contacts']))
    except BaseException as exc:
        _json(output/'run.json',dict(status='failed',error=type(exc).__name__+': '+str(exc)))
        raise
