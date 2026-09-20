import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {NATIVE_SESSION, apiFetch, downloadResponse} from './http';

const EXAMPLE_GOAL='Compare competing explanations of the nonlinear response and challenge the preferred fit.';
const TOKEN_HELP='Run arc-science token --data ./data from this project, or use the token file produced by the local service, then paste the token in the header.';
const LOCKED_MESSAGE=TOKEN_HELP+' Draft text stays in this window.';
const AUTH_RECOVERY='Operator session is locked or expired. Enter a current operator token and retry; your unsent text stays here.';

const RELEASE_LABEL={eligible_for_human_review:'Eligible for human review',blocked:'Blocked'};
function ReleaseLedger({release}) {
  if(!release)return null;
  return <section className="record release-ledger" aria-label="Release decision">
    <h3>Release decision: {RELEASE_LABEL[release.status]||release.status}</h3>
    <p className="muted">Eligible means ready for a human reviewer, not validated.</p>
    <ul className="release-checks">{release.checks.map(check=><li key={check.name} data-state={check.state}><strong>{check.name.replace(/_/g,' ')}</strong> · <span className={'check-state check-'+check.state}>{check.state.replace('_',' ')}</span> — {check.reason}</li>)}</ul>
    {release.blocking_reasons.length>0&&<p role="status">Blocked by: {release.blocking_reasons.join(', ')}.</p>}
  </section>;
}

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

function Artifact({missionId,artifact,request,release,superseded}) {
  const [url,setUrl]=useState('');
  const [error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();let ownedUrl;
    setUrl('');setError('');
    request(`/missions/${missionId}/artifacts/${artifact.digest}`,'GET',undefined,controller.signal)
      .then(r=>r.blob()).then(blob=>{if(!controller.signal.aborted){ownedUrl=URL.createObjectURL(blob);setUrl(ownedUrl);}})
      .catch(e=>{if(!controller.signal.aborted&&e.name!=='AbortError')setError(friendlyError(e));});
    return ()=>{controller.abort();if(ownedUrl)URL.revokeObjectURL(ownedUrl);};
  },[missionId,artifact.digest,request,attempt]);
  return <figure className="artifact">{url?<><img src={url} alt={'Artifact from '+artifact.source_observation_id}/>{release?.eligible_for_human_review?<a href={url} download={artifact.digest+'.png'}>Download authenticated PNG</a>:<span className="muted">Download withheld until the release decision is eligible; inline inspection stays available.</span>}</>:error?<><p role="alert">Artifact unavailable: {error}</p><Button variant="secondary" onPress={()=>setAttempt(n=>n+1)}>Retry artifact</Button><p>Check your token, then retry or select the mission again.</p></>:<p>Loading authenticated artifact…</p>}<figcaption>{artifact.source_observation_id} · {artifact.digest.slice(0,12)}… · preset {artifact.preset||'default'}{artifact.repair_of?' · repair of '+artifact.repair_of.slice(0,12)+'…':''}{superseded?' · superseded by a repair':''}</figcaption></figure>;
}

function friendlyError(error) {
  const message=error?.message||String(error);
  if(/Request failed \((401|403)\)/.test(message))return AUTH_RECOVERY;
  if(/Failed to fetch|NetworkError|Load failed/.test(message))return 'Arc Science service is offline or unreachable. Check the local service, then retry; your draft stays here.';
  return message;
}
function isAuthError(error) { return /Request failed \((401|403)\)/.test(error?.message||String(error)); }

const CLAIM_LABEL={unassessed:'Unassessed',provisionally_supported:'Provisionally supported',contradicted:'Contradicted',unresolved:'Unresolved'};
function ClaimScopeView({scope}) {
  // Requested claim -> evidence-supported scope -> remaining uncertainty -> next
  // discriminating test, derived from the reconciliation at the stop; a narrower
  // conclusion is a valid research output and nothing here is validation.
  return <section aria-label="Claim scope"><h2>Claim scope</h2>{scope?<>
    <p className="muted">Derived at round {scope.basis_round}; provisional support is exploratory, never validation.</p>
    {scope.branches.map(branch=><article className="record claim" key={branch.branch_id} data-status={branch.status}>
      <h3>{branch.branch_id} · {CLAIM_LABEL[branch.status]||branch.status}</h3>
      <dl>
        <dt>Requested claim</dt><dd>{branch.requested}</dd>
        <dt>Evidence-supported scope</dt><dd>{branch.supported_scope.length?<>{branch.supported_scope.map((line,i)=><p key={i}>{line}</p>)}<p className="muted">Scope: {branch.scope_qualifier}.</p></>:<span className="muted">No supported scope; the requested claim stands only as a hypothesis.</span>}</dd>
        <dt>Remaining uncertainty</dt><dd>{branch.uncertainties.length?<ul>{branch.uncertainties.map((u,i)=><li key={i} data-reason={u.reason}>{u.reason.replace(/_/g,' ')}{u.role?' ('+u.role+')':''}: {u.detail}</li>)}</ul>:<span className="muted">None recorded by either role; provisional support still needs independent data.</span>}</dd>
        <dt>Next discriminating test</dt><dd>{branch.next_tests.length?<ul>{branch.next_tests.map((t,i)=><li key={i}>{t.role}: {t.test}</li>)}</ul>:<span className="muted">No next test proposed.</span>}</dd>
      </dl>
    </article>)}
  </>:<p className="muted">The claim scope is derived when the mission stops; none yet.</p>}</section>;
}

function Changes({changes,obligations}) {
  // Every operator change on the mission: what was declared, what the server derived,
  // and the state of each obligation as the release ledger reads it now.
  return <section aria-label="Declared changes"><h2>Declared changes</h2>{changes.length?<ol className="changes">{changes.map(change=><li key={change.id} data-kind={change.kind}>{change.kind} at round {change.round} · declared {change.declared_effects.join(', ')} · derived {change.derived_effects.join(', ')} · obligations: {(obligations?.[change.id]||change.required_checks.map(check=>({check,state:'unknown'}))).map(o=><span key={o.check} className={'check-state check-'+o.state}>{o.check.replace(/_/g,' ')} {o.state.replace('_',' ')}</span>).reduce((acc,el,i)=>i?[...acc,' · ',el]:[el],[])}{change.note?<span className="muted"> — {change.note}</span>:null}</li>)}</ol>:<p className="muted">No declared change.</p>}</section>;
}

function RepairCycles({repairs}) {
  // Each cycle re-rendered the reviewed images under a presentation preset and had
  // them reviewed again as a new candidate; the outcome is that fresh review's own
  // verdict, or the reason the cycle could not run. Nothing here is inferred.
  return <section aria-label="Figure repair cycles"><h2>Figure repair cycles</h2>{repairs.length?<ol className="repairs">{repairs.map((cycle,i)=><li key={i} data-outcome={cycle.outcome}>Cycle {cycle.cycle} · round {cycle.round} · preset {cycle.preset} · addressed {cycle.addressed.join(', ')||'—'} → <strong>{cycle.outcome}</strong>{cycle.reason?<span className="muted"> — {cycle.reason}</span>:null}</li>)}</ol>:<p className="muted">No repair cycle.</p>}</section>;
}

export default function ResearchWorkspace({token,setToken}) {
  const [goal,setGoal]=useState('');
  const [mode,setMode]=useState('demo'),[egress,setEgress]=useState(false),[vision,setVision]=useState(false),[rounds,setRounds]=useState(5),[points,setPoints]=useState('');
  const [mission,setMission]=useState(null),[missions,setMissions]=useState(null),[verification,setVerification]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [authExpired,setAuthExpired]=useState(false);
  const selected=useRef(null),generation=useRef(0),credential=useRef(null),lastToken=useRef(token),validatedToken=useRef(''),authExpiredRef=useRef(false);
  useEffect(()=>{authExpiredRef.current=authExpired;},[authExpired]);
  // Token edits invalidate loaded protected data immediately. Draft text survives
  // initial unlock and expired-token recovery; switching away from a proven,
  // still-valid credential clears the mission draft because it may belong to
  // another operator identity.
  useLayoutEffect(()=>{
    const previous=lastToken.current;
    const provenSwitch=previous&&token&&previous!==token&&validatedToken.current===previous&&!authExpiredRef.current;
    const controller=new AbortController();credential.current=controller;
    generation.current++;selected.current=null;
    setMission(null);setMissions(null);setVerification(null);setError('');setBusy(false);setAuthExpired(false);
    if(token&&previous!==token){setEgress(false);setVision(false);}
    if(provenSwitch){setGoal('');setPoints('');}
    lastToken.current=token;
    return()=>controller.abort();
  },[token]);
  const request=useCallback(async(path,method='GET',body,signal)=>{
    signal.throwIfAborted();
    const response=await apiFetch('/api'+path,{token,method,signal,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    signal.throwIfAborted();
    if(token)validatedToken.current=token;
    return response;
  },[token]);
  const read=useCallback(async(path,signal,method='GET',body)=>{
    const data=await(await request(path,method,body,signal)).json();
    signal.throwIfAborted();return data;
  },[request]);
  async function task(action){
    const signal=credential.current.signal;
    setBusy(true);setError('');
    try{
      if(!token)throw new Error(LOCKED_MESSAGE);
      if(authExpired)throw new Error(AUTH_RECOVERY);
      await action(signal);
    }catch(e){if(!signal.aborted){if(isAuthError(e))setAuthExpired(true);setError(friendlyError(e));}}finally{if(!signal.aborted)setBusy(false);}
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
    async function poll(){try{await refresh(mission.id,controller.signal);}catch(e){if(!controller.signal.aborted&&e.name!=='AbortError'){if(isAuthError(e)){setAuthExpired(true);setError(friendlyError(e));controller.abort();return;}setError(friendlyError(e));}}if(!controller.signal.aborted)timer=setTimeout(poll,1000);}
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
  const locked=!token||authExpired;
  const focusUnlock=()=>{
    if(token===NATIVE_SESSION)setToken('');
    setTimeout(()=>document.getElementById('operator-token')?.focus(),0);
  };
  const lockTitle=authExpired?(token===NATIVE_SESSION?'Desktop session unavailable':'Operator token expired'):'Local unlock required';
  const lockCopy=authExpired?AUTH_RECOVERY+' '+TOKEN_HELP:LOCKED_MESSAGE;
  return <div className="research-workspace guided-research">
    <section className="research-composer" aria-label="Research mission composer">
      <div className="composer-heading"><p className="eyebrow">RESEARCH / DEVELOPMENT</p><h1>Start with a question.</h1><p className="muted">Keep alternatives, evidence and uncertainty visible.</p></div>
      <div className="composer-grid">
        <div className="question-field">
          <label htmlFor="goal">Research goal</label><textarea id="goal" rows={4} value={goal} onChange={e=>setGoal(e.target.value)}/>
          <div className="example-row"><Button variant="ghost" size="sm" onPress={()=>setGoal(EXAMPLE_GOAL)}>Use example</Button><span className="field-note">Adds a sample question to the draft. It will not start a mission.</span></div>
        </div>
        <div className="composer-action-panel">
          <Button isDisabled={busy||locked||!goal.trim()} onPress={()=>task(start)}>Create and start</Button>
          {locked?<div className="unlock-card compact" role="status"><strong>{lockTitle}</strong><p>{lockCopy}</p><Button variant="secondary" size="sm" onPress={focusUnlock}>{token===NATIVE_SESSION?'Use operator token':'Go to token field'}</Button></div>:<p className="muted">Offline mode uses scripted roles with real numerical computation.</p>}
        </div>
      </div>
      <details className="research-options"><summary>Execution settings</summary>
        <div className="formrow"><div><label htmlFor="mode">Execution</label><select id="mode" value={mode} onChange={e=>setMode(e.target.value)}><option value="demo">Offline validation fixture</option><option value="live">Configured live models</option></select></div><div><label htmlFor="rounds">Round limit</label><input id="rounds" type="number" min="1" max="12" value={rounds} onChange={e=>setRounds(e.target.value)}/></div></div>
        <label className="check"><input type="checkbox" checked={egress} onChange={e=>setEgress(e.target.checked)}/>Permit sending this mission's data to configured models.</label>
        <label className="check"><input type="checkbox" checked={vision} onChange={e=>setVision(e.target.checked)}/>Require configured visual review of each new fit image.</label>
        <details><summary>Optional x/y measurements</summary><label htmlFor="points">Measurement JSON</label><textarea id="points" rows={4} value={points} onChange={e=>setPoints(e.target.value)}/><p className="muted">8-2000 numeric x/y points. Leave empty for public-source exploration in live mode.</p></details>
      </details>
    </section>
    <div className="research-workbench">
      <aside className="saved-missions" aria-label="Saved missions">
        <div className="saved-missions-heading"><h2>Saved missions</h2><Button variant="secondary" isDisabled={busy||locked} onPress={()=>task(async signal=>setMissions(await read('/missions',signal)))}>Load missions</Button></div>
        {missions===null?<p className="muted">{locked?'Unlock to load saved missions.':'Load missions with your operator token.'}</p>:missions.length?missions.map(row=><Button className="mission-choice" variant="ghost" key={row.id} isDisabled={busy||locked} onPress={()=>task(signal=>select(row.id,signal))}>{row.status} · {row.goal}</Button>):<p>No saved missions. Create a mission to begin.</p>}
      </aside>
      <section className="research-results" aria-label="Research results">
      {error&&<p role="alert">{error}</p>}
      {!state?<div className="empty-state"><h2>No mission selected.</h2></div>:<>
        <div className="results-heading"><div><p className="eyebrow">Selected mission: {mission.id}</p><h2>Decision frontier</h2></div><span className="status-label">{state.status}</span></div>
        <p className="muted">Round {state.round} · {state.actions_used} actions · {state.model_calls_used} model-role calls · data: {state.data_origin}</p>
        <div className="actions"><Button isDisabled={busy||locked} onPress={()=>task(async signal=>{setVerification(await (await request('/missions/'+mission.id+'/verify','POST',undefined,signal)).json());await refresh(mission.id,signal);})}>Verify and recompute</Button><Button variant="secondary" isDisabled={busy||locked||!mission.release?.eligible_for_human_review} onPress={()=>task(exportCapsule)}>Export replay capsule</Button><Button variant="ghost" isDisabled={busy||locked||!['ready','paused'].includes(state.status)} onPress={()=>task(async signal=>{await request('/missions/'+mission.id+'/start','POST',undefined,signal);await refresh(mission.id,signal);})}>{state.status==='paused'?'Resume (declares an analysis change)':'Resume'}</Button><Button variant="danger" isDisabled={busy||locked||['cancelled','completed','budget_exhausted','error','needs_input'].includes(state.status)} onPress={()=>task(async signal=>{await request('/missions/'+mission.id+'/cancel','POST',undefined,signal);await refresh(mission.id,signal);})}>Cancel</Button></div>
        <p role="status">{state.stop_reason}</p><ReleaseLedger release={mission.release}/>{verification&&<VerificationReport report={verification}/>}
        <ClaimScopeView scope={state.claim_scope}/>
        <div className="branches">{state.branches.map(branch=><article key={branch.id} className={'branch'+(state.focus===branch.id?' focus':'')}><h3>{branch.title}</h3><p>{branch.hypothesis}</p><p>Falsifier: {branch.falsifier}</p><p className="muted">Opened round {branch.created_round} · parents: {branch.parents.join(', ')||'root'}</p></article>)}</div>
        <h2>Visual artifacts</h2><div className="artifacts">{state.artifacts.length?state.artifacts.map(artifact=><Artifact key={mission.id+artifact.digest} missionId={mission.id} artifact={artifact} request={request} release={mission.release} superseded={state.artifacts.some(a=>a.repair_of===artifact.digest)}/>):<p className="muted">No visual artifacts in this mission.</p>}</div>
        <h2>Visual review</h2>{state.visual_reports.length?state.visual_reports.map((report,i)=><div className="record" key={i}><h3>{report.model} · round {report.round} · {report.verdict}</h3>{report.findings.map((finding,j)=><p key={j}>{finding.category}: {finding.detail}</p>)}</div>):<p className="muted">No visual review.</p>}
        <RepairCycles repairs={state.repairs||[]}/>
        <Changes changes={state.changes||[]} obligations={mission.change_obligations}/>
        <details className="result-disclosure"><summary>Reconciliation</summary>{state.assessments.slice(-12).map((assessment,i)=><div className="record" key={i}><h3>{assessment.role} · {assessment.branch_id} · {assessment.position}</h3><p>{assessment.finding}</p><p className="muted">Evidence: {assessment.evidence_ids.join(', ')} · Model: {assessment.model}</p></div>)}</details>
        <details className="result-disclosure"><summary>Execution evidence</summary>{state.observations.map(observation=><details className="record" key={observation.id}><summary>{observation.id} · {observation.tool} · {observation.status}</summary><pre>{JSON.stringify(observation.data,null,2)}</pre></details>)}</details>
        <details className="result-disclosure"><summary>Event history</summary>{state.events.slice(-15).reverse().map((event,i)=><p className="muted" key={i}>[{event.round}] {event.kind}: {event.detail}</p>)}</details>
      </>}
      </section>
    </div>
  </div>;
}
