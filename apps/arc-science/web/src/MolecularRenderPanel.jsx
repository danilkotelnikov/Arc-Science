import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {checkedFetch} from './http';
import {STAGE_LABELS, useRenderEvents} from './renderEvents';

const pending=status=>status==='queued'||status==='rendering';
const defaults={assembly:'asymmetric_unit',model_index:0,cutoff:4,width:1400,samples:96,seed:23};
const EFFECTS=[['presentation','Presentation (width, samples, seed)'],['scientific_depiction','Scientific depiction (chains, assembly, model)'],['analysis','Analysis (contact cutoff)']];
const settings=[['model_index','Model index (zero-based)',0,99,1],['cutoff','Contact cutoff (Å)',0.1,10,0.1],['width','Width (px)',640,2400,1],['samples','Samples',1,128,1],['seed','Seed',0,2147483647,1]];

function request(token,path,signal,body) {
  if(!path.startsWith('/api/molecular/'))throw new Error('Invalid molecular artifact address.');
  return checkedFetch(path,{method:body===undefined?'GET':'POST',signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
}

function readSource(file,signal) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    const abort=()=>reader.abort();
    signal.addEventListener('abort',abort,{once:true});
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error('Could not read the coordinate file. Select it again.'));
    reader.onabort=()=>reject(new DOMException('Read cancelled','AbortError'));
    reader.onloadend=()=>signal.removeEventListener('abort',abort);
    reader.readAsText(file);
  });
}

export function stageLine(job) {
  const stages=job?.stages||[];
  if(!stages.length)return '';
  return stages.map(s=>STAGE_LABELS[s.stage]||s.stage).join(' → ');
}

function RenderControls({token,onJobChange,onShowJob,onSource}) {
  const [capabilities,setCapabilities]=useState(null),[jobs,setJobs]=useState(null),[job,setJob]=useState(null);
  const [file,setFile]=useState(null),[antibody,setAntibody]=useState(''),[antigen,setAntigen]=useState('');
  const [options,setOptions]=useState(defaults),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pollAttempt,setPollAttempt]=useState(0);
  // The render preset: presentation only, from the registry the service reports; '' means the operator's default.
  const [preset,setPreset]=useState('');
  const [software,setSoftware]=useState(null),[softwareBusy,setSoftwareBusy]=useState(false);
  // A render can declare itself a change of the selected completed render of the same
  // coordinates; the server derives the real effects and refuses a narrower declaration.
  const [asChange,setAsChange]=useState(false),[declared,setDeclared]=useState([]);
  const operation=useRef(null),polling=useRef(null);
  const updateJob=useCallback(data=>{
    setJob(data);onJobChange(data);
    setJobs(rows=>rows===null?rows:[data,...rows.filter(row=>row.id!==data.id)].slice(0,20));
  },[onJobChange]);

  useEffect(()=>()=>{operation.current?.abort();polling.current?.abort();},[]);
  // Progress arrives on the event stream while a job runs; polling stands in only
  // when the stream is not live.
  const live=useRenderEvents({token,jobId:job?.id,active:!!job&&pending(job.status),onEvent:event=>{
    if(event.event==='stage'){setJob(current=>{
      if(!current||current.id!==job.id)return current;
      const stages=current.stages||[];
      if(stages.some(s=>s.stage===event.data.stage))return current;
      const next={...current,stages:[...stages,event.data]};onJobChange(next);return next;
    });}
    else if(event.event==='status'||event.event==='end'||event.event==='lost'){setPollAttempt(value=>value+1);}
  }});
  useEffect(()=>{
    if(!job||!pending(job.status)||live)return;
    const controller=new AbortController();polling.current=controller;let timer;
    async function poll() {
      try {
        const data=await(await request(token,'/api/molecular/renders/'+job.id,controller.signal)).json();
        if(controller.signal.aborted)return;
        updateJob(data);
        if(pending(data.status))timer=setTimeout(poll,1500);
      } catch(reason) {
        if(!controller.signal.aborted)setError('Status unavailable: '+reason.message+'. Select the render again to retry.');
      }
    }
    timer=setTimeout(poll,1500);
    return()=>{controller.abort();clearTimeout(timer);};
  },[token,job?.id,job?.status,updateJob,pollAttempt]);

  async function run(action) {
    operation.current?.abort();
    const controller=new AbortController();operation.current=controller;
    setBusy(true);setError('');
    try {await action(controller.signal);}
    catch(reason){if(!controller.signal.aborted)setError(reason.message);}
    finally {if(!controller.signal.aborted)setBusy(false);}
  }
  async function load(signal) {
    const [config,rows]=await Promise.all([
      request(token,'/api/molecular/capabilities',signal).then(response=>response.json()),
      request(token,'/api/molecular/renders',signal).then(response=>response.json()),
    ]);
    if(!signal.aborted){setCapabilities(config);setJobs(rows);}
  }
  async function select(id,signal) {
    polling.current?.abort();
    const data=await(await request(token,'/api/molecular/renders/'+id,signal)).json();
    if(!signal.aborted){updateJob(data);setPollAttempt(value=>value+1);onShowJob(true);}
  }
  async function submit(signal) {
    const maxBytes=capabilities.limits.max_source_bytes;
    if(!file||!file.size||file.size>maxBytes)throw new Error('Choose a nonempty coordinate file up to '+maxBytes.toLocaleString()+' bytes.');
    if(!/\.(cif|mmcif|pdb)$/i.test(file.name))throw new Error('Choose a .cif, .mmcif or .pdb coordinate file.');
    const chains=value=>value.split(/[\s,]+/).filter(Boolean);
    const antibodyChains=chains(antibody),antigenChains=chains(antigen);
    if(!antibodyChains.length||!antigenChains.length||antibodyChains.length>16||antigenChains.length>16)throw new Error('Enter 1–16 author chains for each partner.');
    if(antibodyChains.some(chain=>antigenChains.includes(chain)))throw new Error('Antibody and antigen chains must be different.');
    const source=await readSource(file,signal);
    if(signal.aborted)return;
    const body={...options,filename:file.name,source_text:source,antibody_chains:antibodyChains,antigen_chains:antigenChains};
    if(preset)body.preset=preset;
    if(asChange&&job){body.base_job=job.id;body.declared_effects=declared;}
    const data=await(await request(token,'/api/molecular/renders',signal,body)).json();
    if(!signal.aborted){updateJob(data);onShowJob(true);}
  }
  async function cancel(signal) {
    polling.current?.abort();
    const data=await(await request(token,'/api/molecular/renders/'+job.id+'/cancel',signal,{})).json();
    if(!signal.aborted)updateJob(data);
  }

  return <div className="molecular-render-controls" aria-busy={busy}>
    <Button variant="secondary" isDisabled={!token||busy} onPress={()=>run(load)}>{jobs===null?'Load renders':'Refresh renders'}</Button>
    {capabilities?<p>{capabilities.configured?'Local renderer ready.':capabilities.reason||'The local Blender renderer is unavailable.'}</p>:<p className="field-note">Load with your operator token.</p>}
    <form onSubmit={event=>{event.preventDefault();run(submit);}}>
      <fieldset disabled={busy||!token}>
        <label htmlFor="molecular-source">Coordinate file</label><input id="molecular-source" type="file" accept=".cif,.mmcif,.pdb" aria-required="true" onChange={event=>{const chosen=event.target.files[0]||null;setFile(chosen);
          // Viewing needs no renderer: the chosen coordinates are shown at once.
          if(chosen&&chosen.size<=(capabilities?.limits.max_source_bytes||750000)){const controller=new AbortController();readSource(chosen,controller.signal).then(text=>onSource?.({filename:chosen.name,text,origin:'upload'})).catch(()=>{});}
        }}/>
        <p className="field-note">PDB or mmCIF, up to {(capabilities?.limits.max_source_bytes||750000).toLocaleString()} bytes; shown in the viewer at once, rendered only with the local pipeline.</p>
      </fieldset>
      <fieldset disabled={busy||!capabilities?.configured}>
        <label htmlFor="molecular-antibody">Antibody chains</label><input id="molecular-antibody" value={antibody} required placeholder="A, B" onChange={event=>setAntibody(event.target.value)}/>
        <label htmlFor="molecular-antigen">Antigen chains</label><input id="molecular-antigen" value={antigen} required placeholder="C" onChange={event=>setAntigen(event.target.value)}/>
        <p className="field-note">Author chain IDs, separated by commas.</p>
        <details className="molecular-advanced"><summary>Assembly & render settings</summary>
          <label htmlFor="molecular-preset">Render preset</label>
          <select id="molecular-preset" value={preset} onChange={event=>setPreset(event.target.value)}>
            <option value="">{'default ('+(capabilities?.presets?.default||'publication_white')+')'}</option>
            {(capabilities?.presets?.names||[]).map(p=><option key={p.name} value={p.name} title={p.description}>{p.name.replace(/_/g,' ')}</option>)}
          </select>
          <p className="field-note">{(capabilities?.presets?.names||[]).find(p=>p.name===(preset||capabilities?.presets?.default))?.description||'Presentation only: background, finish, colours, envelope and sticks; never the coordinates or the contacts.'}</p>
          <label htmlFor="molecular-assembly">Assembly</label><input id="molecular-assembly" value={options.assembly} maxLength={64} required onChange={event=>setOptions({...options,assembly:event.target.value})}/>
          <p className="field-note">Use asymmetric_unit or an assembly ID recorded in the source.</p>
          {settings.map(([name,label,min,max,step])=><React.Fragment key={name}><label htmlFor={'molecular-'+name}>{label}</label><input id={'molecular-'+name} type="number" min={min} max={max} step={step} required value={options[name]} onChange={event=>setOptions({...options,[name]:event.target.value===''?'':Number(event.target.value)})}/></React.Fragment>)}
        </details>
        {job?.status==='completed'&&job.settings&&<fieldset className="molecular-change"><legend>Change of the selected render</legend>
          <label className="check"><input type="checkbox" checked={asChange} onChange={event=>{setAsChange(event.target.checked);if(!event.target.checked)setDeclared([]);}}/>Render as a declared change of {job.id.slice(0,8)}… (same coordinates; the earlier render is kept)</label>
          {asChange&&<>{EFFECTS.map(([effect,label])=><label className="check" key={effect}><input type="checkbox" checked={declared.includes(effect)} onChange={event=>setDeclared(event.target.checked?[...declared,effect]:declared.filter(e=>e!==effect))}/>{label}</label>)}
          <p className="field-note">Declare every effect the new settings have; the server derives the actual effects and refuses a declaration that is narrower than them.</p></>}
        </fieldset>}
      </fieldset>
      <Button type="submit" isDisabled={busy||!token||!capabilities?.configured||!file||!antibody.trim()||!antigen.trim()||pending(job?.status)}>Render structure</Button>
    </form>
    {busy&&<p role="status">Molecular request in progress…</p>}
    {error&&<p role="alert">{error}</p>}
    {job&&<div className="molecular-job-controls"><Button variant="ghost" onPress={()=>onShowJob(true)}>View selected render</Button>{pending(job.status)&&<Button variant="secondary" isDisabled={busy} onPress={()=>run(cancel)}>Cancel render</Button>}</div>}
    {job&&(job.stages?.length>0||pending(job.status))&&<p className="field-note" aria-label="Render progress">{pending(job.status)?(live?'live':'polling')+' · ':''}{stageLine(job)||'waiting for the pipeline'}</p>}
    {jobs!==null&&<><h2>Recent renders</h2>{jobs.length?jobs.map(row=><Button variant="ghost" key={row.id} isDisabled={busy} aria-pressed={job?.id===row.id} onPress={()=>run(signal=>select(row.id,signal))}>{row.status} · {row.filename}</Button>):<p>No saved renders yet.</p>}</>}
    <details className="molecular-software"><summary>Packages</summary>
      <p className="field-note">The catalogue of structural-biology and cheminformatics software the workbench knows, with what a probe observed: presence, never qualification; nothing is installed.</p>
      <div className="actions"><Button variant="secondary" size="sm" isDisabled={!token||softwareBusy} onPress={async()=>{
        setSoftwareBusy(true);
        try{const data=await(await request(token,'/api/molecular/catalogue'+(software?'?refresh=true':''),new AbortController().signal)).json();setSoftware(data);}
        catch(reason){setError(reason.message);}
        finally{setSoftwareBusy(false);}
      }}>{software?'Probe again':'Check packages'}</Button></div>
      {software&&<div className="software-report" aria-label="Software catalogue">
        <p className="field-note">{software.counts.present} present · {software.counts.absent} absent · {software.counts.unprobed} not probed · {software.counts.total} known</p>
        {Object.entries(software.categories).map(([key,label])=>{const rows=software.entries.filter(e=>e.category===key);return rows.length?<div key={key}><h3>{label}</h3><ul>
          {rows.map(e=><li key={e.id} className={e.present===true?'present':e.present===false?'absent':'unprobed'}><strong>{e.name}</strong> — {e.present===true?'present ('+e.evidence+(e.where?', '+e.where:'')+': '+e.detail+')':e.present===false?'absent ('+e.detail+')':'not probed'+(e.note?' ('+e.note+')':'')}{e.licence?' · '+e.licence:''}</li>)}
        </ul></div>:null;})}
        <p className="field-note">{software.licence_note}</p>
      </div>}
    </details>
  </div>;
}

export default function MolecularRenderPanel({token,setToken,onJobChange,onShowJob,onSource}) {
  return <section className="inspector-section molecular-render-panel" aria-labelledby="molecular-render-heading"><h2 id="molecular-render-heading">Render locally</h2>
    <RenderControls key={token} token={token} onJobChange={onJobChange} onShowJob={onShowJob} onSource={onSource}/>
  </section>;
}

export function MolecularRenderResult({job,token,onReturn}) {
  const [preview,setPreview]=useState(''),[previewError,setPreviewError]=useState(''),[attempt,setAttempt]=useState(0);
  const [downloadError,setDownloadError]=useState(''),[downloading,setDownloading]=useState(false);
  const downloads=useRef(new Map()),downloadController=useRef(null);
  const asset=job.status==='completed'?job.assets['collage.png']:null;
  useEffect(()=>{
    if(!asset)return;
    const controller=new AbortController();let ownedUrl;
    setPreview('');setPreviewError('');
    request(token,asset.url,controller.signal).then(response=>response.blob()).then(blob=>{
      if(!controller.signal.aborted){ownedUrl=URL.createObjectURL(blob);setPreview(ownedUrl);}
    }).catch(reason=>{if(!controller.signal.aborted)setPreviewError(reason.message);});
    return()=>{controller.abort();if(ownedUrl)URL.revokeObjectURL(ownedUrl);};
  },[token,asset?.url,attempt]);
  useEffect(()=>()=>{
    downloadController.current?.abort();
    for(const [url,timer] of downloads.current){clearTimeout(timer);URL.revokeObjectURL(url);}
    downloads.current.clear();
  },[]);
  async function download(name) {
    const controller=new AbortController();downloadController.current=controller;
    setDownloading(true);setDownloadError('');
    try {
      const blob=await(await request(token,job.assets[name].url,controller.signal)).blob();
      if(controller.signal.aborted)return;
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=job.id+'-'+name;document.body.appendChild(link);
      try{link.click();}finally{
        link.remove();
        downloads.current.set(url,setTimeout(()=>{URL.revokeObjectURL(url);downloads.current.delete(url);},1000));
      }
    } catch(reason){if(!controller.signal.aborted)setDownloadError(reason.message);}
    finally{if(!controller.signal.aborted)setDownloading(false);}
  }
  return <section className="figure-workspace" aria-label="Generated molecular figure">
    <div className="figure-toolbar"><div><p className="eyebrow">LOCAL RENDER</p><h2>{job.filename}</h2></div><Button variant="secondary" size="sm" onPress={onReturn}>Close render</Button></div>
    <div className="molecular-render-summary"><p role="status">Render status: {job.status}</p>{job.change&&<p className="molecular-change-record">Declared change of render {job.change.base_job.slice(0,8)}…: declared {job.change.declared_effects.join(', ')||'nothing'}; derived {job.change.derived_effects.join(', ')} ({job.change.changed_fields.join(', ')}); checks obliged: {job.change.required_checks.join(', ')}.</p>}<p className="muted">Job {job.id}{job.contact_pairs!==null&&job.contact_pairs!==undefined?' · '+job.contact_pairs+' residue pairs':''}</p>
      <p className="muted">Rendering does not establish scientific validity, visual acceptance, or publication approval. The surface is a Gaussian atomic envelope; dashed distances indicate proximity, not hydrogen bonds or affinity.</p>
      {job.error&&<p role="alert">{job.error}</p>}
      {job.status==='interrupted'&&<p>The server stopped before this render finished. Submit the structure again to create a new job.</p>}
      {job.status==='cancelled'&&<p>This render was cancelled. No completed artifacts are available.</p>}
    </div>
    {job.status==='completed'?<><div className="figure-stage molecular-render-stage">
      {!asset?<p role="alert">The completed job did not include a collage preview.</p>:previewError?<><p role="alert">Preview unavailable: {previewError}</p><Button variant="secondary" onPress={()=>setAttempt(value=>value+1)}>Retry preview</Button></>:preview?<img src={preview} alt={'Rendered molecular collage: '+job.filename} onError={()=>setPreviewError('The returned image could not be displayed.')}/>:<p role="status">Loading authenticated collage…</p>}
      </div><div className="molecular-render-downloads"><h2>Artifacts & provenance</h2><p className="muted">The manifest records the source, chain selection and render settings.</p>
        {downloadError&&<p role="alert">{downloadError}</p>}
        <div className="actions">{Object.keys(job.assets).map(name=><Button key={name} size="sm" variant="secondary" isDisabled={downloading} onPress={()=>download(name)}>Download {name}</Button>)}</div>
        <details><summary>Artifact hashes</summary><dl className="receipt-metadata">{job.source_sha256&&<><dt>Uploaded source SHA-256</dt><dd><code>{job.source_sha256}</code></dd></>}{Object.entries(job.assets).map(([name,info])=><React.Fragment key={name}><dt>{name} · {info.bytes.toLocaleString()} bytes</dt><dd><code>{info.sha256}</code></dd></React.Fragment>)}</dl></details>
      </div></>:pending(job.status)&&<div className="workspace-message"><p>The local renderer is working. Status updates automatically; you can close this view while it runs.</p></div>}
  </section>;
}
