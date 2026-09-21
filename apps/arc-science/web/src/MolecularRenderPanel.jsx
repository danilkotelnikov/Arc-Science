import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {SESSION_COPY, checkedFetch, sessionState} from './http';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';
import {STAGE_LABELS, useRenderEvents} from './renderEvents';

const pending=status=>status==='queued'||status==='rendering';
const defaults={assembly:'asymmetric_unit',model_index:0,cutoff:4,width:1400,samples:96,seed:23};
const EFFECTS=[['presentation','Presentation (width, samples, seed, preset)'],['scientific_depiction','Scientific depiction (chains, assembly, model, an envelope or stick preset)'],['analysis','Analysis (contact cutoff)']];
const settings=[['model_index','Model index (zero-based)',0,99,1],['cutoff','Contact cutoff (Å)',0.1,10,0.1],['width','Width (px)',640,2400,1],['samples','Render samples',1,128,1],['seed','Random seed',0,2147483647,1]];
const spaced=value=>String(value).replace(/_/g,' ');
const plural=(count,noun)=>count+' '+noun+(count===1?'':'s');
const isAuthError=reason=>/Request failed \((401|403)\)/.test(reason?.message||String(reason));
// The alert beside the action names what failed in the words every workspace uses;
// a rejected token is not an alert but the lock notice in its error tone, said once.
function friendlyError(reason) {
  const message=reason?.message||String(reason);
  if(/Failed to fetch|NetworkError|Load failed/.test(message))return SESSION_COPY.offline.title+'. '+SESSION_COPY.offline.text;
  return message;
}

function request(token,path,signal,body) {
  if(!path.startsWith('/api/molecular/'))throw new Error('This file is not served by the local molecular API.');
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
  return stages.map(s=>STAGE_LABELS[s.stage]||spaced(s.stage)).join(' → ');
}

function RenderControls({token,setToken,onJobChange,onShowJob,onSource,showRender}) {
  const [capabilities,setCapabilities]=useState(null),[jobs,setJobs]=useState(null),[job,setJob]=useState(null);
  const [file,setFile]=useState(null),[antibody,setAntibody]=useState(''),[antigen,setAntigen]=useState('');
  // `busy` names the action in flight ('' when idle); `error` is {at, text} for the slot
  // beside the action that failed; `authExpired` is a rejected token, shown on the lock notice.
  const [options,setOptions]=useState(defaults),[busy,setBusy]=useState(''),[error,setError]=useState(null),[authExpired,setAuthExpired]=useState(false),[pollAttempt,setPollAttempt]=useState(0);
  // The render preset: presentation only, from the registry the service reports; '' means the operator's default.
  const [preset,setPreset]=useState('');
  const [software,setSoftware]=useState(null),[softwareBusy,setSoftwareBusy]=useState(false),[softwareError,setSoftwareError]=useState('');
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
        if(controller.signal.aborted)return;
        if(isAuthError(reason))setAuthExpired(true);
        else setError({at:'status',text:'Status unavailable: '+friendlyError(reason).replace(/\.?$/,'.')+' Select the render again to retry.'});
      }
    }
    timer=setTimeout(poll,1500);
    return()=>{controller.abort();clearTimeout(timer);};
  },[token,job?.id,job?.status,updateJob,pollAttempt]);

  async function run(at,action) {
    operation.current?.abort();
    const controller=new AbortController();operation.current=controller;
    setBusy(at);setError(null);
    try {await action(controller.signal);}
    catch(reason){if(!controller.signal.aborted){if(isAuthError(reason))setAuthExpired(true);else setError({at,text:friendlyError(reason)});}}
    finally {if(!controller.signal.aborted)setBusy('');}
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
    if(!antibodyChains.length||!antigenChains.length||antibodyChains.length>16||antigenChains.length>16)throw new Error('Enter 1–16 chain IDs for the antibody and 1–16 for the antigen.');
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

  const maxBytes=capabilities?.limits.max_source_bytes||750000;
  // Adjacent copy for what is locked and why; each reason is said once on the screen.
  const session=sessionState(token,authExpired);
  const alertAt=at=>error?.at===at?<p role="alert">{error.text}</p>:null;
  const fileIssue=!file?'':file.size>maxBytes?'This file is '+file.size.toLocaleString()+' bytes; the limit is '+maxBytes.toLocaleString()+' bytes.':!/\.(cif|mmcif|pdb)$/i.test(file.name)?'Choose a .cif, .mmcif or .pdb file.':'';
  // The chain fields name their first blocker: the token before Load renders, then the renderer.
  const unlock=capabilities?.configured?'':!token?'Needs a desktop session or an operator token, then press Load renders.':'Locked until Load renders reports the local renderer is configured.';
  const blocker=busy||!token||unlock?'':!file?'Choose a coordinate file first.':!antibody.trim()||!antigen.trim()?'Enter antibody and antigen chains first.':pending(job?.status)?'Locked while the selected render runs. Cancel it or wait for it to finish.':'';
  return <div className="molecular-render-controls" aria-busy={!!busy}>
    <Button variant="secondary" isDisabled={!token||!!busy} onPress={()=>run('load',load)}>{jobs===null?'Load renders':'Refresh renders'}</Button>
    <LockNotice card={session} tone={authExpired?'error':'info'} onUnlock={()=>focusTokenField(token,setToken)} unlockLabel={unlockLabel(token)} compact/>
    {busy==='load'?<p role="status">Loading renders…</p>:capabilities&&<p>{capabilities.configured?'Local renderer configured.':capabilities.reason||'The local Blender renderer is unavailable.'}</p>}
    {alertAt('load')}
    <form onSubmit={event=>{event.preventDefault();run('submit',submit);}}>
      <fieldset disabled={busy||!token}>
        <label htmlFor="molecular-source">Coordinate file</label><input id="molecular-source" type="file" accept=".cif,.mmcif,.pdb" aria-required="true" onChange={event=>{const chosen=event.target.files[0]||null;setFile(chosen);
          // Viewing needs no renderer: the chosen coordinates are shown at once.
          if(chosen&&chosen.size<=maxBytes){const controller=new AbortController();readSource(chosen,controller.signal).then(text=>onSource?.({filename:chosen.name,text,origin:'upload'})).catch(()=>{});}
        }}/>
        {fileIssue&&<p role="alert">{fileIssue}</p>}
        <p className="field-note">PDB or mmCIF, up to {maxBytes.toLocaleString()} bytes. Shown in the viewer at once; rendered only by the local pipeline.</p>
      </fieldset>
      <fieldset disabled={busy||!capabilities?.configured}>
        {unlock&&<p className="field-note">{unlock}</p>}
        <label htmlFor="molecular-antibody">Antibody chains</label><input id="molecular-antibody" value={antibody} required placeholder="A, B" onChange={event=>setAntibody(event.target.value)}/>
        <label htmlFor="molecular-antigen">Antigen chains</label><input id="molecular-antigen" value={antigen} required placeholder="C" onChange={event=>setAntigen(event.target.value)}/>
        <p className="field-note">Chain IDs as written in the file (author IDs), separated by commas.</p>
        <details className="molecular-advanced"><summary>Assembly & render settings</summary>
          <label htmlFor="molecular-preset">Render preset</label>
          <select id="molecular-preset" value={preset} onChange={event=>setPreset(event.target.value)}>
            <option value="">{'default ('+spaced(capabilities?.presets?.default||'publication_white')+')'}</option>
            {(capabilities?.presets?.names||[]).map(p=><option key={p.name} value={p.name} title={p.description}>{spaced(p.name)}</option>)}
          </select>
          <p className="field-note">{(capabilities?.presets?.names||[]).find(p=>p.name===(preset||capabilities?.presets?.default))?.description||'Presets change the panel background, finish and colours (presentation). Envelope and stick presets also change the drawn mesh (scientific depiction). No preset changes the coordinates or the contacts.'}</p>
          <label htmlFor="molecular-assembly">Assembly</label><input id="molecular-assembly" value={options.assembly} maxLength={64} required onChange={event=>setOptions({...options,assembly:event.target.value})}/>
          <p className="field-note">Use asymmetric_unit (no symmetry operators applied) or an assembly ID listed in the file.</p>
          {settings.map(([name,label,min,max,step])=><React.Fragment key={name}><label htmlFor={'molecular-'+name}>{label}</label><input id={'molecular-'+name} type="number" min={min} max={max} step={step} required value={options[name]} onChange={event=>setOptions({...options,[name]:event.target.value===''?'':Number(event.target.value)})}/></React.Fragment>)}
        </details>
        {job?.status==='completed'&&job.settings&&<fieldset className="molecular-change"><legend>Change of the selected render</legend>
          <label className="check"><input type="checkbox" checked={asChange} onChange={event=>{setAsChange(event.target.checked);if(!event.target.checked)setDeclared([]);}}/>Render as a declared change of {job.id.slice(0,8)}… — same coordinates (choose the same file again); the earlier render is kept</label>
          {asChange&&<>{EFFECTS.map(([effect,label])=><label className="check" key={effect}><input type="checkbox" checked={declared.includes(effect)} onChange={event=>setDeclared(event.target.checked?[...declared,effect]:declared.filter(e=>e!==effect))}/>{label}</label>)}
          <p className="field-note">Tick every effect the new settings have. The server derives the actual effects and refuses the render if your declaration is narrower.</p></>}
        </fieldset>}
      </fieldset>
      <Button type="submit" isDisabled={!!busy||!token||!capabilities?.configured||!file||!antibody.trim()||!antigen.trim()||pending(job?.status)}>Render structure</Button>
      {blocker&&<p className="field-note">{blocker}</p>}
      {busy==='submit'&&<p role="status">Submitting the render…</p>}
      {alertAt('submit')}
    </form>
    {job&&<div className="molecular-job-controls">{!showRender&&<Button variant="ghost" onPress={()=>onShowJob(true)}>View selected render</Button>}{pending(job.status)&&<Button variant="secondary" isDisabled={!!busy} onPress={()=>run('cancel',cancel)}>Cancel render</Button>}{busy==='cancel'&&<p role="status">Cancelling the render…</p>}{alertAt('cancel')}</div>}
    {job&&(job.stages?.length>0||pending(job.status))&&<p className="field-note" role="status" aria-label="Render progress">{pending(job.status)?(live?'live updates':'checking every 1.5 s')+' · ':''}{stageLine(job)||'waiting for the pipeline'}</p>}
    {jobs!==null&&<><h3>Recent renders</h3>{jobs.length?jobs.map(row=><Button variant="ghost" key={row.id} isDisabled={!!busy} aria-pressed={job?.id===row.id} onPress={()=>run('select',signal=>select(row.id,signal))}>{spaced(row.status)} · {row.filename}</Button>):<p>No saved renders yet.</p>}</>}
    {busy==='select'&&<p role="status">Loading the selected render…</p>}
    {alertAt('select')}{alertAt('status')}
    <details className="molecular-software"><summary>Packages</summary>
      <p className="field-note">Structural-biology and cheminformatics software the workbench knows about, and what a probe observed. Presence only, not whether a package works. Nothing is installed.</p>
      <div className="actions"><Button variant="secondary" size="sm" isDisabled={!token||softwareBusy} onPress={async()=>{
        setSoftwareBusy(true);setSoftwareError('');
        try{const data=await(await request(token,software?'/api/molecular/catalogue/refresh':'/api/molecular/catalogue',new AbortController().signal,software?{}:undefined)).json();setSoftware(data);}
        catch(reason){const auth=isAuthError(reason)&&sessionState(token,true,{draft:false});setSoftwareError('Package check failed: '+(auth?auth.title+'. '+auth.text:friendlyError(reason)));}
        finally{setSoftwareBusy(false);}
      }}>{software?'Check again':'Check packages'}</Button></div>
      {softwareBusy&&<p role="status">Checking packages…</p>}
      {softwareError&&<p role="alert">{softwareError}</p>}
      {software&&<div className="software-report" role="group" aria-label="Software catalogue">
        <p className="field-note">{software.counts.present} present · {software.counts.indirect} seen indirectly · {software.counts.absent} absent · {software.counts.unprobed} not probed · {software.counts.total} known</p>
        {Object.entries(software.categories).map(([key,label])=>{const rows=software.entries.filter(e=>e.category===key);return rows.length?<div key={key}><h3>{label}</h3><ul>
          {rows.map(e=><li key={e.id} className={e.present===true?'present':e.present===false?'absent':e.observed?'indirect':'unprobed'}><strong>{e.name}</strong> — {e.present===true?'present ('+e.evidence+(e.where?', '+e.where:'')+': '+e.detail+')':e.present===false?'absent ('+e.detail+')':e.observed?spaced(e.observed)+' ('+e.detail+')':'not probed'+(e.note?' ('+e.note+')':'')}{e.licence?' · '+e.licence:''}</li>)}
        </ul></div>:null;})}
        <p className="field-note">{software.licence_note}</p>
      </div>}
    </details>
  </div>;
}

export default function MolecularRenderPanel({token,setToken,onJobChange,onShowJob,onSource,showRender}) {
  return <section className="inspector-section molecular-render-panel" aria-labelledby="molecular-render-heading"><h2 id="molecular-render-heading">Render locally</h2>
    <RenderControls key={token} token={token} setToken={setToken} onJobChange={onJobChange} onShowJob={onShowJob} onSource={onSource} showRender={showRender}/>
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
  return <section className="molecular-render-result" aria-label="Generated molecular figure">
    <div className="figure-toolbar"><div><p className="eyebrow">LOCAL RENDER</p><h2>{job.filename}</h2></div><Button variant="secondary" size="sm" onPress={onReturn}>Close details</Button></div>
    <div className="molecular-render-summary"><p role="status">Render status: {spaced(job.status)}</p>{job.change&&<p className="molecular-change-record">Change of render {job.change.base_job.slice(0,8)}… Declared: {job.change.declared_effects.map(spaced).join(', ')||'nothing'}. Derived by the server: {job.change.derived_effects.map(spaced).join(', ')} (changed: {job.change.changed_fields.map(spaced).join(', ')}). Required checks: {job.change.required_checks.map(spaced).join(', ')}.</p>}<p className="muted">Job {job.id}{job.contact_pairs!==null&&job.contact_pairs!==undefined?' · '+plural(job.contact_pairs,'contact residue pair'):''}</p>
      <p>A render does not establish scientific validity, visual acceptance or publication approval. The surface is a Gaussian envelope around the atoms; dashed distance lines show proximity only, not hydrogen bonds or affinity.</p>
      {job.error&&<p role="alert">{job.error}</p>}
      {job.status==='interrupted'&&<p>The server stopped before this render finished. Submit the structure again to create a new job.</p>}
      {job.status==='cancelled'&&<p>This render was cancelled. No output files are available.</p>}
    </div>
    {job.status==='completed'?<><div className="figure-stage molecular-render-stage">
      {!asset?<p role="alert">The completed job has no preview image (collage.png).</p>:previewError?<><p role="alert">Preview unavailable: {previewError}</p><Button variant="secondary" onPress={()=>setAttempt(value=>value+1)}>Retry preview</Button></>:preview?<img src={preview} alt={'Rendered molecular collage: '+job.filename} onError={()=>setPreviewError('The returned image could not be displayed.')}/>:<p role="status">Loading preview…</p>}
      </div><div className="molecular-render-downloads"><h3>Output files & provenance</h3><p className="muted">manifest.json records the source file, chain selection and render settings.</p>
        {downloadError&&<p role="alert">{downloadError}</p>}
        <div className="actions">{Object.keys(job.assets).map(name=><Button key={name} size="sm" variant="secondary" isDisabled={downloading} onPress={()=>download(name)}>Download {name}</Button>)}</div>
        <details><summary>File hashes (SHA-256)</summary><dl className="receipt-metadata">{job.source_sha256&&<><dt>Uploaded source SHA-256</dt><dd><code>{job.source_sha256}</code></dd></>}{Object.entries(job.assets).map(([name,info])=><React.Fragment key={name}><dt>{name} · {info.bytes.toLocaleString()} bytes</dt><dd><code>{info.sha256}</code></dd></React.Fragment>)}</dl></details>
      </div></>:pending(job.status)&&<div className="workspace-message"><p>The local renderer is working. Status updates automatically; you can close this view while it runs.</p></div>}
  </section>;
}
