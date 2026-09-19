import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {checkedFetch, downloadResponse} from './http';

const DEFAULT_GOAL='Compare competing explanations of the nonlinear response and challenge the preferred fit.';

function VerificationReport({report}) {
  const outcome=value=>value===true?'passed':value===false?'failed':'not reported';
  return <section className="record" aria-label="Verification report">
    <h3>Replay verification: {outcome(report.reproduction_passed)}</h3>
    <p>Integrity: {outcome(report.integrity)} · Evidence graph: {outcome(report.evidence_graph_valid)}</p>
    <p>Recomputed: {report.reproduced ?? 'unreported'} computations · {report.artifacts_reproduced ?? 'unreported'} artifacts.</p>
    <p>Scientific validity is not established by replay verification.</p>
    {report.failures?.length>0&&<p role="alert">{report.failures.length} verification failures. Inspect the details before relying on this replay.</p>}
    <details><summary>Verification details</summary><pre>{JSON.stringify(report,null,2)}</pre></details>
  </section>;
}

function Artifact({missionId,artifact,request}) {
  const [url,setUrl]=useState('');
  const [error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();let ownedUrl;
    setUrl('');setError('');
    request(`/missions/${missionId}/artifacts/${artifact.digest}`,'GET',undefined,controller.signal)
      .then(r=>r.blob()).then(blob=>{if(!controller.signal.aborted){ownedUrl=URL.createObjectURL(blob);setUrl(ownedUrl);}})
      .catch(e=>{if(!controller.signal.aborted&&e.name!=='AbortError')setError(e.message);});
    return ()=>{controller.abort();if(ownedUrl)URL.revokeObjectURL(ownedUrl);};
  },[missionId,artifact.digest,request,attempt]);
  return <figure className="artifact">{url?<><img src={url} alt={'Artifact from '+artifact.source_observation_id}/><a href={url} download={artifact.digest+'.png'}>Download authenticated PNG</a></>:error?<><p role="alert">Artifact unavailable: {error}</p><Button variant="secondary" onPress={()=>setAttempt(n=>n+1)}>Retry artifact</Button><p>Check your token, then retry or select the mission again.</p></>:<p>Loading authenticated artifact…</p>}<figcaption>{artifact.source_observation_id} · {artifact.digest.slice(0,12)}…</figcaption></figure>;
}

export default function ResearchWorkspace({token,setToken}) {
  const [goal,setGoal]=useState(DEFAULT_GOAL);
  const [mode,setMode]=useState('demo'),[egress,setEgress]=useState(false),[vision,setVision]=useState(false),[rounds,setRounds]=useState(5),[points,setPoints]=useState('');
  const [mission,setMission]=useState(null),[missions,setMissions]=useState(null),[verification,setVerification]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const selected=useRef(null),generation=useRef(0),credential=useRef(null);
  // Clear all private state before paint while keeping token entry focused.
  useLayoutEffect(()=>{
    const controller=new AbortController();credential.current=controller;
    generation.current++;selected.current=null;
    setMission(null);setMissions(null);setVerification(null);setError('');setBusy(false);
    setGoal(DEFAULT_GOAL);setMode('demo');setEgress(false);setVision(false);setRounds(5);setPoints('');
    return()=>controller.abort();
  },[token]);
  const request=useCallback(async(path,method='GET',body,signal)=>{
    signal.throwIfAborted();
    const response=await checkedFetch('/api'+path,{method,signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    signal.throwIfAborted();return response;
  },[token]);
  const read=useCallback(async(path,signal,method='GET',body)=>{
    const data=await(await request(path,method,body,signal)).json();
    signal.throwIfAborted();return data;
  },[request]);
  async function task(action){
    const signal=credential.current.signal;
    setBusy(true);setError('');
    try{await action(signal);}catch(e){if(!signal.aborted)setError(e.message);}finally{if(!signal.aborted)setBusy(false);}
  }
  const refresh=useCallback(async(id,signal)=>{
    const epoch=generation.current;
    const row=await read('/missions/'+id,signal);
    if(epoch===generation.current&&selected.current===id&&!signal.aborted)setMission(row);
    return row;
  },[read]);
  async function select(id,signal){generation.current++;selected.current=id;setMission(null);setVerification(null);await refresh(id,signal);}
  useEffect(()=>{
    if(!mission||!['ready','running'].includes(mission.state.status))return;
    const controller=new AbortController();let timer;
    const owner=credential.current;
    const abort=()=>controller.abort();owner.signal.addEventListener('abort',abort,{once:true});
    async function poll(){try{await refresh(mission.id,controller.signal);}catch(e){if(!controller.signal.aborted&&e.name!=='AbortError')setError(e.message);}if(!controller.signal.aborted)timer=setTimeout(poll,1000);}
    timer=setTimeout(poll,1000);
    return ()=>{controller.abort();clearTimeout(timer);owner.signal.removeEventListener('abort',abort);};
  },[mission?.id,mission?.state.status,refresh]);
  async function start(signal){
    const row=await read('/missions',signal,'POST',{goal,mode,max_rounds:Number(rounds),allow_egress:egress,vision_review:vision,points:points.trim()?JSON.parse(points):null});
    generation.current++;selected.current=row.id;setMission(row);setVerification(null);
    await request('/missions/'+row.id+'/start','POST',undefined,signal);await refresh(row.id,signal);
  }
  async function exportCapsule(signal){
    const response=await request('/missions/'+mission.id+'/capsule','GET',undefined,signal);
    await downloadResponse({blob:async()=>{
      const blob=await response.blob();signal.throwIfAborted();return blob;
    }},'arc-'+mission.id+'.zip');
  }
  const state=mission?.state;
  return <div className="research-workspace">
    <aside className="research-form"><p className="eyebrow">RESEARCH / DEVELOPMENT</p><h1>Start with a question.</h1><p className="muted">Keep alternatives, evidence and uncertainty visible.</p>
      <label htmlFor="token">Local operator token</label><input id="token" type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="off"/><p className="field-note">In memory only. Read with <code>arc-science token --data ./data</code>.</p>
      <label htmlFor="goal">Research goal</label><textarea id="goal" rows={4} value={goal} onChange={e=>setGoal(e.target.value)}/>
      <div className="formrow"><div><label htmlFor="mode">Execution</label><select id="mode" value={mode} onChange={e=>setMode(e.target.value)}><option value="demo">Offline validation fixture</option><option value="live">Configured live models</option></select></div><div><label htmlFor="rounds">Round limit</label><input id="rounds" type="number" min="1" max="12" value={rounds} onChange={e=>setRounds(e.target.value)}/></div></div>
      <details><summary>Optional x/y measurements</summary><label htmlFor="points">Measurement JSON</label><textarea id="points" rows={4} value={points} onChange={e=>setPoints(e.target.value)}/><p className="muted">8–2000 numeric x/y points. Leave empty for public-source exploration in live mode.</p></details>
      <label className="check"><input type="checkbox" checked={egress} onChange={e=>setEgress(e.target.checked)}/>Permit sending this mission’s data to configured models.</label>
      <label className="check"><input type="checkbox" checked={vision} onChange={e=>setVision(e.target.checked)}/>Require configured visual review of each new fit image.</label>
      <div className="actions"><Button isDisabled={busy||!goal.trim()} onPress={()=>task(start)}>Create and start</Button><Button variant="secondary" isDisabled={busy} onPress={()=>task(async signal=>setMissions(await read('/missions',signal)))}>Load missions</Button></div>
      <p className="muted">Offline mode uses a scripted planner and real numerical computations. It is not a live-model benchmark.</p>
      <h2>Saved missions</h2>{missions===null?<p className="muted">Load missions with your operator token.</p>:missions.length?missions.map(row=><Button className="mission-choice" variant="ghost" key={row.id} isDisabled={busy} onPress={()=>task(signal=>select(row.id,signal))}>{row.status} · {row.goal}</Button>):<p>No saved missions. Create a mission to begin.</p>}
    </aside>
    <section className="research-results" aria-label="Research results">
      {error&&<p role="alert">{error}</p>}
      {!state?<div className="empty-state"><h2>Evidence begins with a mission.</h2><p>Create one or load a saved run to inspect its decision frontier.</p></div>:<>
        <div className="results-heading"><div><p className="eyebrow">Selected mission: {mission.id}</p><h2>Decision frontier</h2></div><span className="status-label">{state.status}</span></div>
        <p className="muted">Round {state.round} · {state.actions_used} actions · {state.model_calls_used} model-role calls · data: {state.data_origin}</p>
        <div className="actions"><Button isDisabled={busy} onPress={()=>task(async signal=>setVerification(await read('/missions/'+mission.id+'/verify',signal)))}>Verify and recompute</Button><Button variant="secondary" isDisabled={busy} onPress={()=>task(exportCapsule)}>Export replay capsule</Button><Button variant="ghost" isDisabled={busy||!['ready','paused'].includes(state.status)} onPress={()=>task(async signal=>{await request('/missions/'+mission.id+'/start','POST',undefined,signal);await refresh(mission.id,signal);})}>Resume</Button><Button variant="danger" isDisabled={busy||['cancelled','completed','budget_exhausted','error'].includes(state.status)} onPress={()=>task(async signal=>{await request('/missions/'+mission.id+'/cancel','POST',undefined,signal);await refresh(mission.id,signal);})}>Cancel</Button></div>
        <p role="status">{state.stop_reason}</p>{verification&&<VerificationReport report={verification}/>}
        <div className="branches">{state.branches.map(branch=><article key={branch.id} className={'branch'+(state.focus===branch.id?' focus':'')}><h3>{branch.title}</h3><p>{branch.hypothesis}</p><p>Falsifier: {branch.falsifier}</p><p className="muted">Opened round {branch.created_round} · parents: {branch.parents.join(', ')||'root'}</p></article>)}</div>
        <h2>Visual artifacts</h2><div className="artifacts">{state.artifacts.length?state.artifacts.map(artifact=><Artifact key={mission.id+artifact.digest} missionId={mission.id} artifact={artifact} request={request}/>):<p className="muted">No visual artifacts in this mission.</p>}</div>
        <h2>Visual review</h2>{state.visual_reports.length?state.visual_reports.map((report,i)=><div className="record" key={i}><h3>{report.model} · round {report.round} · {report.verdict}</h3>{report.findings.map((finding,j)=><p key={j}>{finding.category}: {finding.detail}</p>)}</div>):<p className="muted">No visual review report. No passing qualification is implied.</p>}
        <h2>Reconciliation</h2>{state.assessments.slice(-12).map((assessment,i)=><div className="record" key={i}><h3>{assessment.role} · {assessment.branch_id} · {assessment.position}</h3><p>{assessment.finding}</p><p className="muted">Evidence: {assessment.evidence_ids.join(', ')} · Model: {assessment.model}</p></div>)}
        <h2>Execution evidence</h2>{state.observations.map(observation=><details className="record" key={observation.id}><summary>{observation.id} · {observation.tool} · {observation.status}</summary><pre>{JSON.stringify(observation.data,null,2)}</pre></details>)}
        <h2>Event history</h2>{state.events.slice(-15).reverse().map((event,i)=><p className="muted" key={i}>[{event.round}] {event.kind}: {event.detail}</p>)}
      </>}
      <footer>Reconciliation is advisory. Reproducible computation and model agreement do not establish biological validity. Publication is not authorized.</footer>
    </section>
  </div>;
}
