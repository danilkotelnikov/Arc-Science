import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Alert} from '@heroui/react/alert';
import {Button} from '@heroui/react/button';
import {Checkbox} from '@heroui/react/checkbox';
import {Description} from '@heroui/react/description';
import {Disclosure} from '@heroui/react/disclosure';
import {EmptyState} from '@heroui/react/empty-state';
import {Fieldset} from '@heroui/react/fieldset';
import {Form} from '@heroui/react/form';
import {Input} from '@heroui/react/input';
import {Label} from '@heroui/react/label';
import {ListBox} from '@heroui/react/list-box';
import {NumberField} from '@heroui/react/number-field';
import {Select} from '@heroui/react/select';
import {Table} from '@heroui/react/table';
import {TextField} from '@heroui/react/textfield';
import {Tooltip} from '@heroui/react/tooltip';
import {checkedFetch, sessionLine, sessionState} from './http';
import {useI18n} from './i18n/index.jsx';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';
import {STAGES, useRenderEvents} from './renderEvents';
import {GravityIcon} from './theme/gravity-icons.jsx';
import {Block, Facts, Kicker} from './ui.jsx';

const pending=status=>status==='queued'||status==='rendering';
const defaults={assembly:'asymmetric_unit',model_index:0,cutoff:4,width:1400,samples:96,seed:23};
const EFFECTS=['presentation','scientific_depiction','analysis'];
const settings=[['model_index',0,99,1],['cutoff',0.1,10,0.1],['width',640,2400,1],['samples',1,128,1],['seed',0,2147483647,1]];
const STATUSES=['queued','rendering','completed','failed','cancelled','interrupted'];
const TONES={completed:'success',failed:'danger',interrupted:'danger',cancelled:'warning',queued:'accent',rendering:'accent'};
// The service's own default preset; a Select key cannot be '', and no preset name starts with ':'.
const DEFAULT_PRESET=':default';
const spaced=value=>String(value).replace(/_/g,' ');
const isAuthError=reason=>/Request failed \((401|403)\)/.test(reason?.message||String(reason));

/** A job status in the reader's words; an unknown one as the service spells it. */
export const statusWord=(status,t)=>STATUSES.includes(status)?t('molecules.status.'+status):spaced(status);
const effectWord=(effect,t)=>EFFECTS.includes(effect)?t('molecules.effect.'+effect):spaced(effect);
const stageName=(stage,t)=>STAGES.includes(stage)?t('render.stage.'+stage):spaced(stage);

// Errors raised here carry a dictionary key as their message; the service's own errors
// are shown as they arrive.
function messageOf(reason,t) {
  const message=reason?.message||String(reason);
  return message.startsWith('molecules.')?t(message):message;
}
// The alert beside the action names what failed in the words every workspace uses;
// a rejected token is not an alert but the lock notice in its error tone, said once.
function friendlyError(reason,t) {
  const message=reason?.message||String(reason);
  if(/Failed to fetch|NetworkError|Load failed/.test(message))return sessionLine('offline',t);
  return messageOf(reason,t);
}

function request(token,path,signal,body) {
  if(!path.startsWith('/api/molecular/'))throw new Error('molecules.error.not_local');
  return checkedFetch(path,{method:body===undefined?'GET':'POST',signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
}

function readSource(file,signal) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    const abort=()=>reader.abort();
    signal.addEventListener('abort',abort,{once:true});
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error('molecules.file.read_failed'));
    reader.onabort=()=>reject(new DOMException('Read cancelled','AbortError'));
    reader.onloadend=()=>signal.removeEventListener('abort',abort);
    reader.readAsText(file);
  });
}

/** The stages the pipeline has written so far, as observations, in order. */
export function stageLine(job,t) {
  return (job?.stages||[]).map(s=>stageName(s.stage,t)).join(', ');
}

const Problem=({children})=>(
  <Alert status="danger" role="alert">
    <Alert.Indicator/>
    <Alert.Content><Alert.Description>{children}</Alert.Description></Alert.Content>
  </Alert>
);
const Note=({children,...props})=><p className="ar-note" {...props}>{children}</p>;
/** A titled section that opens in place; its content stays mounted, as a details element's did. */
const Reveal=({title,level=3,children})=>(
  <Disclosure>
    <Disclosure.Heading level={level}>
      <Button slot="trigger" variant="ghost" className={'ar-mol-reveal'+(level===2?' ar-mol-reveal--title':'')}>{title}<Disclosure.Indicator/></Button>
    </Disclosure.Heading>
    <Disclosure.Content><Disclosure.Body className="ar-stack">{children}</Disclosure.Body></Disclosure.Content>
  </Disclosure>
);
/** Why a control is locked, beside it. */
const Reason=({icon,children})=><p className="ar-row ar-row--tight ar-note"><GravityIcon name={icon}/><span>{children}</span></p>;

function RenderControls({token,setToken,onJobChange,onShowJob,onSource,showRender}) {
  const {t}=useI18n();
  const [capabilities,setCapabilities]=useState(null),[jobs,setJobs]=useState(null),[job,setJob]=useState(null);
  const [file,setFile]=useState(null),[antibody,setAntibody]=useState(''),[antigen,setAntigen]=useState('');
  // `busy` names the action in flight ('' when idle); `error` is {at, text} for the slot
  // beside the action that failed; `authExpired` is a rejected token, shown on the lock notice.
  const [options,setOptions]=useState(defaults),[busy,setBusy]=useState(''),[error,setError]=useState(null),[authExpired,setAuthExpired]=useState(false),[pollAttempt,setPollAttempt]=useState(0);
  // The render preset: presentation only, from the registry the service reports; '' means the operator's default.
  const [preset,setPreset]=useState('');
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
        else setError({at:'status',text:t('molecules.status_unavailable',{detail:friendlyError(reason,t).replace(/\.?$/,'.')})});
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
    catch(reason){if(!controller.signal.aborted){if(isAuthError(reason))setAuthExpired(true);else setError({at,text:friendlyError(reason,t)});}}
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
    if(!file||!file.size||file.size>maxBytes)throw new Error(t('molecules.error.empty',{limit:maxBytes}));
    if(!/\.(cif|mmcif|pdb)$/i.test(file.name))throw new Error(t('molecules.error.type'));
    const chains=value=>value.split(/[\s,]+/).filter(Boolean);
    const antibodyChains=chains(antibody),antigenChains=chains(antigen);
    if(!antibodyChains.length||!antigenChains.length||antibodyChains.length>16||antigenChains.length>16)throw new Error(t('molecules.error.chains'));
    if(antibodyChains.some(chain=>antigenChains.includes(chain)))throw new Error(t('molecules.error.overlap'));
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
  const alertAt=at=>error?.at===at?<Problem>{error.text}</Problem>:null;
  const fileIssue=!file?'':file.size>maxBytes?t('molecules.file.too_big',{size:file.size,limit:maxBytes}):!/\.(cif|mmcif|pdb)$/i.test(file.name)?t('molecules.file.type'):'';
  // The chain fields name their first blocker: the token before Load renders, then the renderer.
  const unlock=capabilities?.configured?'':!token?t('molecules.unlock.token'):t('molecules.unlock.renderer');
  const blocker=busy||!token||unlock?'':!file?t('molecules.blocker.file'):!antibody.trim()||!antigen.trim()?t('molecules.blocker.chains'):pending(job?.status)?t('molecules.blocker.running'):'';
  // What the two fieldsets of the earlier form disabled: choosing a file needs a session;
  // everything that shapes a render needs the renderer.
  const sourceDisabled=!!busy||!token,renderDisabled=!!busy||!capabilities?.configured;
  const presets=capabilities?.presets?.names||[];
  const presetDefault=spaced(capabilities?.presets?.default||'publication_white');
  const presetDescription=presets.find(p=>p.name===(preset||capabilities?.presets?.default))?.description;
  const defaultLabel=t('molecules.preset.default',{name:presetDefault});
  const stages=job?.stages||[];
  return <div className="ar-stack" aria-busy={!!busy}>
    <Block variant="primary" className="ar-stack" aria-labelledby="molecular-render-heading">
      <h2 id="molecular-render-heading">{t('molecules.render.heading')}</h2>
      <div className="ar-row">
        <Button variant="secondary" isDisabled={!token||!!busy} onPress={()=>run('load',load)}>
          <GravityIcon name="list-ul"/>{jobs===null?t('molecules.render.load'):t('molecules.render.refresh')}
        </Button>
      </div>
      <LockNotice card={session} tone={authExpired?'error':'info'} onUnlock={()=>focusTokenField(token,setToken)} unlockLabel={unlockLabel(token,t)} compact/>
      {busy==='load'?<Note role="status">{t('molecules.render.loading')}</Note>:capabilities&&<p className="ar-tag" data-tone={capabilities.configured?'success':'warning'}>{capabilities.configured?t('molecules.render.configured'):capabilities.reason||t('molecules.render.unavailable')}</p>}
      {alertAt('load')}
      <Form className="ar-stack" onSubmit={event=>{event.preventDefault();run('submit',submit);}}>
        <div className="ar-stack ar-stack--tight">
          <Label htmlFor="molecular-source">{t('molecules.file.label')}</Label>
          <Input id="molecular-source" className="ar-mol-file" type="file" accept=".cif,.mmcif,.pdb" aria-required="true" aria-describedby="molecular-source-note" disabled={sourceDisabled} onChange={event=>{const chosen=event.target.files[0]||null;setFile(chosen);
            // Viewing needs no renderer: the chosen coordinates are shown at once.
            if(chosen&&chosen.size<=maxBytes){const controller=new AbortController();readSource(chosen,controller.signal).then(text=>onSource?.({filename:chosen.name,text,origin:'upload'})).catch(()=>{});}
          }}/>
          <Note id="molecular-source-note">{t('molecules.file.note',{limit:maxBytes})}</Note>
          {fileIssue&&<Problem>{fileIssue}</Problem>}
        </div>
        {unlock&&<Reason icon="lock">{unlock}</Reason>}
        <div className="ar-stack ar-stack--tight">
          <div className="ar-pair">
            <TextField id="molecular-antibody" isRequired isDisabled={renderDisabled} value={antibody} onChange={setAntibody}>
              <Label>{t('molecules.chains.antibody')}</Label><Input placeholder="A, B"/>
            </TextField>
            <TextField id="molecular-antigen" isRequired isDisabled={renderDisabled} value={antigen} onChange={setAntigen}>
              <Label>{t('molecules.chains.antigen')}</Label><Input placeholder="C"/>
            </TextField>
          </div>
          <Note>{t('molecules.chains.note')}</Note>
        </div>
        <Reveal title={t('molecules.settings.title')}>
          <Select fullWidth isDisabled={renderDisabled} value={preset||DEFAULT_PRESET} onChange={value=>setPreset(value==null||value===DEFAULT_PRESET?'':String(value))}>
            <Label>{t('molecules.preset.label')}</Label>
            <Select.Trigger><Select.Value/><Select.Indicator/></Select.Trigger>
            {presetDescription?<Description>{presetDescription}</Description>:null}
            <Select.Popover>
              <ListBox>
                <ListBox.Item id={DEFAULT_PRESET} textValue={defaultLabel}>{defaultLabel}<ListBox.ItemIndicator/></ListBox.Item>
                {presets.map(p=><ListBox.Item key={p.name} id={p.name} textValue={spaced(p.name)}>{spaced(p.name)}<ListBox.ItemIndicator/></ListBox.Item>)}
              </ListBox>
            </Select.Popover>
          </Select>
          <div className="ar-row ar-row--tight">
            <Note>{t('molecules.preset.note')}</Note>
            <Tooltip delay={300}>
              <Button isIconOnly variant="ghost" size="sm" aria-label={t('molecules.preset.about')}><GravityIcon name="circle-info"/></Button>
              <Tooltip.Content>{t('molecules.preset.help')}</Tooltip.Content>
            </Tooltip>
          </div>
          <TextField id="molecular-assembly" isRequired isDisabled={renderDisabled} value={options.assembly} onChange={value=>setOptions({...options,assembly:value})}>
            <Label>{t('molecules.assembly.label')}</Label>
            <Input maxLength={64}/>
            <Description>{t('molecules.assembly.note')}</Description>
          </TextField>
          <div className="ar-mol-fields ar-mol-fields--narrow">
            {settings.map(([name,min,max,step])=><NumberField key={name} id={'molecular-'+name} isRequired isDisabled={renderDisabled}
              minValue={min} maxValue={max} step={step} formatOptions={{useGrouping:false}}
              value={options[name]===''?NaN:options[name]} onChange={value=>setOptions({...options,[name]:value==null||Number.isNaN(value)?'':value})}>
              <Label>{t('molecules.setting.'+name)}</Label>
              <NumberField.Group><NumberField.Input/></NumberField.Group>
            </NumberField>)}
          </div>
        </Reveal>
        {job?.status==='completed'&&job.settings&&<Fieldset className="ar-stack ar-stack--tight">
          <Fieldset.Legend>{t('molecules.change.legend')}</Fieldset.Legend>
          <Checkbox isSelected={asChange} isDisabled={renderDisabled} onChange={selected=>{setAsChange(selected);if(!selected)setDeclared([]);}}>
            <Checkbox.Content><Checkbox.Control><Checkbox.Indicator/></Checkbox.Control>{t('molecules.change.declare',{id:job.id.slice(0,8)})}</Checkbox.Content>
            <Description>{t('molecules.change.same')}</Description>
          </Checkbox>
          {asChange&&<>
            {EFFECTS.map(effect=><Checkbox key={effect} isSelected={declared.includes(effect)} isDisabled={renderDisabled} onChange={selected=>setDeclared(selected?[...declared,effect]:declared.filter(e=>e!==effect))}>
              <Checkbox.Content><Checkbox.Control><Checkbox.Indicator/></Checkbox.Control>{t('molecules.effect.'+effect+'.label')}</Checkbox.Content>
            </Checkbox>)}
            <Note>{t('molecules.change.note')}</Note>
            <Note>{t('molecules.change.server')}</Note>
          </>}
        </Fieldset>}
        <div className="ar-stack ar-stack--tight">
          <div className="ar-row">
            <Button type="submit" variant="primary" isDisabled={!!busy||!token||!capabilities?.configured||!file||!antibody.trim()||!antigen.trim()||pending(job?.status)}>
              <GravityIcon name="play"/>{t('molecules.submit')}
            </Button>
          </div>
          {blocker&&<Reason icon="circle-info">{blocker}</Reason>}
          {busy==='submit'&&<Note role="status">{t('molecules.submitting')}</Note>}
          {alertAt('submit')}
        </div>
      </Form>
      {job&&<div className="ar-stack ar-stack--tight">
        <div className="ar-row">
          {!showRender&&<Button variant="ghost" onPress={()=>onShowJob(true)}><GravityIcon name="eye"/>{t('molecules.job.view')}</Button>}
          {pending(job.status)&&<Button variant="secondary" isDisabled={!!busy} onPress={()=>run('cancel',cancel)}><GravityIcon name="stop"/>{t('molecules.job.cancel')}</Button>}
        </div>
        {busy==='cancel'&&<Note role="status">{t('molecules.job.cancelling')}</Note>}
        {alertAt('cancel')}
      </div>}
      {job&&(stages.length>0||pending(job.status))&&<div className="ar-stack ar-stack--tight" role="status" aria-label={t('molecules.progress.label')}>
        <Kicker>{t('molecules.progress.label')}</Kicker>
        {pending(job.status)&&<Note>{live?t('molecules.progress.live'):t('molecules.progress.polling')}</Note>}
        {stages.length?<ol className="ar-mol-stages">{stages.map(s=><li key={s.stage} className="ar-tag">{stageName(s.stage,t)}</li>)}</ol>:<p>{t('molecules.progress.waiting')}</p>}
      </div>}
      {alertAt('status')}
    </Block>
    {jobs!==null&&<Block className="ar-stack" aria-labelledby="molecular-renders-heading">
      <h2 id="molecular-renders-heading">{t('molecules.renders.heading')}</h2>
      {jobs.length?<ul className="ar-list ar-mol-renders">{jobs.map(row=><li key={row.id}>
        <Button variant="ghost" className="ar-mol-render" isDisabled={!!busy} aria-pressed={job?.id===row.id}
          aria-label={t('molecules.renders.item',{file:row.filename,status:statusWord(row.status,t)})}
          onPress={()=>run('select',signal=>select(row.id,signal))}>
          <span className="ar-mol-render-file">{row.filename}</span>
          <span className="ar-tag" data-tone={TONES[row.status]}>{statusWord(row.status,t)}</span>
        </Button>
      </li>)}</ul>:<EmptyState>{t('molecules.renders.empty')}</EmptyState>}
      {/* Choosing a render happens in this list, so its progress and failure are said here. */}
      {busy==='select'&&<Note role="status">{t('molecules.job.selecting')}</Note>}
      {alertAt('select')}
    </Block>}
  </div>;
}

export default function MolecularRenderPanel({token,setToken,onJobChange,onShowJob,onSource,showRender}) {
  return <RenderControls key={token} token={token} setToken={setToken} onJobChange={onJobChange} onShowJob={onShowJob} onSource={onSource} showRender={showRender}/>;
}

/** Structural-biology and cheminformatics software the workbench knows about, and what a
 * probe observed: presence only, never whether a package works. Nothing is installed. */
export function MolecularPackages({token}) {
  const {t,n}=useI18n();
  const [software,setSoftware]=useState(null),[softwareBusy,setSoftwareBusy]=useState(false),[softwareError,setSoftwareError]=useState('');
  async function check() {
    setSoftwareBusy(true);setSoftwareError('');
    try{const data=await(await request(token,software?'/api/molecular/catalogue/refresh':'/api/molecular/catalogue',new AbortController().signal,software?{}:undefined)).json();setSoftware(data);}
    catch(reason){const auth=isAuthError(reason)&&sessionState(token,true,{draft:false});setSoftwareError(t('molecules.packages.failed',{detail:auth?sessionLine(auth.id,t):friendlyError(reason,t)}));}
    finally{setSoftwareBusy(false);}
  }
  const observation=e=>e.present===true?['success',t('molecules.packages.present'),e.evidence+(e.where?', '+e.where:'')+': '+e.detail]
    :e.present===false?['',t('molecules.packages.absent'),e.detail]
    :e.observed?['warning',e.observed==='environment_seen'?t('molecules.packages.observed.environment_seen'):spaced(e.observed),e.detail]
    :['',t('molecules.packages.unprobed'),e.note||''];
  const counts=software?.counts;
  return <Block>
    <Reveal title={t('molecules.packages.heading')} level={2}>
      <Note>{t('molecules.packages.note')}</Note>
      <div className="ar-row">
        <Button variant="secondary" size="sm" isDisabled={!token||softwareBusy} onPress={check}>
          <GravityIcon name="magnifier"/>{software?t('molecules.packages.again'):t('molecules.packages.check')}
        </Button>
      </div>
      {softwareBusy&&<Note role="status">{t('molecules.packages.checking')}</Note>}
      {softwareError&&<Problem>{softwareError}</Problem>}
      {software&&<div className="ar-stack" role="group" aria-label={t('molecules.packages.label')}>
        <Facts items={['present','indirect','absent','unprobed','total'].map(key=>[t('molecules.packages.count.'+key),n(counts[key])])}/>
        {Object.entries(software.categories).map(([key,label])=>{
          const rows=software.entries.filter(e=>e.category===key);
          return rows.length?<div key={key} className="ar-stack ar-stack--tight">
            <h3>{label}</h3>
            <div className="ar-table-scroll">
              <Table>
                <Table.ScrollContainer>
                  <Table.Content aria-label={label}>
                    <Table.Header>
                      <Table.Column isRowHeader>{t('molecules.packages.col.package')}</Table.Column>
                      <Table.Column>{t('molecules.packages.col.observed')}</Table.Column>
                      <Table.Column>{t('molecules.packages.col.detail')}</Table.Column>
                      <Table.Column>{t('molecules.packages.col.licence')}</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {rows.map(e=>{const [tone,word,detail]=observation(e);return <Table.Row key={e.id} id={e.id}>
                        <Table.Cell>{e.name}</Table.Cell>
                        <Table.Cell><span className="ar-tag ar-nowrap" data-tone={tone||undefined}>{word}</span></Table.Cell>
                        <Table.Cell>{detail}</Table.Cell>
                        <Table.Cell>{e.licence||''}</Table.Cell>
                      </Table.Row>;})}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            </div>
          </div>:null;
        })}
        <Note>{software.licence_note}</Note>
      </div>}
    </Reveal>
  </Block>;
}

export function MolecularRenderResult({job,token,onReturn}) {
  const {t}=useI18n();
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
    }).catch(reason=>{if(!controller.signal.aborted)setPreviewError(messageOf(reason,t));});
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
    } catch(reason){if(!controller.signal.aborted)setDownloadError(messageOf(reason,t));}
    finally{if(!controller.signal.aborted)setDownloading(false);}
  }
  const list=(values,word)=>values.map(word).join(', ');
  const change=job.change;
  return <Block className="ar-stack" aria-label={t('molecules.result.label')}>
    <div className="ar-mol-head">
      <div className="ar-stack ar-stack--tight"><Kicker>{t('molecules.result.kicker')}</Kicker><h2>{job.filename}</h2></div>
      <Button variant="secondary" size="sm" onPress={onReturn}><GravityIcon name="xmark"/>{t('molecules.result.close')}</Button>
    </div>
    <p role="status" className="ar-tag" data-tone={TONES[job.status]}>{t('molecules.result.status',{status:statusWord(job.status,t)})}</p>
    <Facts items={[
      [t('molecules.result.job'),<code className="ar-mol-hash">{job.id}</code>],
      job.contact_pairs!==null&&job.contact_pairs!==undefined&&[t('molecules.result.contacts'),t('molecules.result.pairs',{count:job.contact_pairs})],
    ]}/>
    {change&&<div className="ar-stack ar-stack--tight" role="group" aria-label={t('molecules.change.record',{id:change.base_job.slice(0,8)})}>
      <Kicker>{t('molecules.change.record',{id:change.base_job.slice(0,8)})}</Kicker>
      <Facts items={[
        [t('molecules.change.declared'),list(change.declared_effects,e=>effectWord(e,t))||t('molecules.change.nothing')],
        [t('molecules.change.derived'),list(change.derived_effects,e=>effectWord(e,t))],
        [t('molecules.change.changed'),list(change.changed_fields,spaced)],
        [t('molecules.change.checks'),list(change.required_checks,spaced)],
      ]}/>
    </div>}
    <Note>{t('molecules.result.limits')}</Note>
    {job.error&&<Problem>{job.error}</Problem>}
    {job.status==='interrupted'&&<p>{t('molecules.result.interrupted')}</p>}
    {job.status==='cancelled'&&<p>{t('molecules.result.cancelled')}</p>}
    {job.status==='completed'?<>
      <figure className="ar-stack ar-stack--tight ar-mol-preview">
        {!asset?<Problem>{t('molecules.result.no_preview')}</Problem>
          :previewError?<div className="ar-stack ar-stack--tight">
            <Problem>{t('molecules.result.preview_failed',{detail:previewError})}</Problem>
            <div className="ar-row"><Button variant="secondary" onPress={()=>setAttempt(value=>value+1)}><GravityIcon name="arrow-rotate-left"/>{t('molecules.result.retry')}</Button></div>
          </div>
          :preview?<img src={preview} alt={t('molecules.result.preview_alt',{file:job.filename})} onError={()=>setPreviewError(t('molecules.result.preview_broken'))}/>
          :<Note role="status">{t('molecules.result.preview_loading')}</Note>}
        <figcaption className="ar-stack ar-stack--tight">
          <Note>{t('molecules.result.surface')}</Note>
          <Note>{t('molecules.result.lines')}</Note>
        </figcaption>
      </figure>
      <div className="ar-stack ar-stack--tight">
        <h3>{t('molecules.result.files')}</h3>
        <Note>{t('molecules.result.manifest')}</Note>
        {downloadError&&<Problem>{downloadError}</Problem>}
        <div className="ar-row">{Object.keys(job.assets).map(name=><Button key={name} size="sm" variant="secondary" isDisabled={downloading} onPress={()=>download(name)}>
          <GravityIcon name="download"/>{t('molecules.result.download',{name})}
        </Button>)}</div>
        <Reveal title={t('molecules.result.hashes')}>
          <div className="ar-table-scroll">
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label={t('molecules.result.hashes')}>
                  <Table.Header>
                    <Table.Column isRowHeader>{t('molecules.result.col.file')}</Table.Column>
                    <Table.Column>{t('molecules.result.col.size')}</Table.Column>
                    <Table.Column>{t('molecules.result.col.sha')}</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {[
                      ...(job.source_sha256?[{id:':source',name:t('molecules.result.source'),size:'',sha:job.source_sha256}]:[]),
                      ...Object.entries(job.assets).map(([name,info])=>({id:name,name,size:t('molecules.bytes',{count:info.bytes}),sha:info.sha256})),
                    ].map(row=><Table.Row key={row.id} id={row.id}>
                      <Table.Cell>{row.name}</Table.Cell>
                      <Table.Cell><span className="ar-nowrap">{row.size}</span></Table.Cell>
                      <Table.Cell><code className="ar-mol-hash">{row.sha}</code></Table.Cell>
                    </Table.Row>)}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </div>
        </Reveal>
      </div>
    </>:pending(job.status)&&<p>{t('molecules.result.running')}</p>}
  </Block>;
}
