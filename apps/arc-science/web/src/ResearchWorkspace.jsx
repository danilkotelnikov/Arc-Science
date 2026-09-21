import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {NATIVE_SESSION, SESSION_COPY, apiFetch, downloadResponse, sessionState} from './http';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';
import {STATE_LABEL, releaseWord, sentence, stateOf} from './readiness';

const EXAMPLE_GOAL='Compare competing explanations of the nonlinear response and challenge the preferred fit.';
const MAX_ROUNDS=12;
const clampRounds=value=>Math.min(MAX_ROUNDS,Math.max(1,Math.round(Number(value))||1));
/** Enum values read as words: budget_exhausted -> budget exhausted. */
const words=value=>String(value??'').replace(/_/g,' ');
const plural=(n,noun)=>n+' '+noun+(n===1?'':'s');
const cardLine=card=>card.title+'. '+card.text;
/** The analyst role is served by the Reviewer (QA) seat set in Settings. */
const ROLE_LABEL={analyst:'Reviewer (QA)'};
const role=value=>ROLE_LABEL[value]||value;
/** The model source a mission was created with (request.mode). */
const MODE_LABEL={demo:'Offline fixture',live:'Live models'};
const modeLabel=value=>MODE_LABEL[value]||words(value);

const RELEASE_LABEL={eligible_for_human_review:'Eligible for human review',blocked:'Blocked'};
// The current decision defined where it appears; states follow release.py (BLOCKING = failed, unknown, error, stale) and are shown with releaseWord.
const RELEASE_MEANING={
  eligible_for_human_review:'Eligible for human review: every check below passed or is n/a; ready for a human reviewer, not validated.',
  blocked:'Blocked: at least one check below failed, is unverified, blocked or stale; not validated.',
};
function ReleaseLedger({release}) {
  if(!release)return null;
  return <section className="record release-ledger" aria-label="Release decision">
    <h3>Release decision: {RELEASE_LABEL[release.status]||words(release.status)}</h3>
    <p className="muted">{RELEASE_MEANING[release.status]||'Not validated.'}</p>
    <ul className="release-checks">{release.checks.map(check=><li key={check.name} data-state={check.state}><strong>{words(check.name)}</strong> · <span className={'check-state check-'+check.state}>{releaseWord(check.state)}</span> — {check.reason}</li>)}</ul>
    {release.blocking_reasons.length>0&&<p role="status">Blocked by: {release.blocking_reasons.map(words).join(', ')}.</p>}
  </section>;
}

function VerificationReport({report}) {
  const outcome=value=>value===true?'passed':value===false?'failed':'not reported';
  const count=(value,noun)=>value===null||value===undefined?'not reported '+noun+'s':plural(value,noun);
  return <section className="record" aria-label="Verification report">
    <h3>Replay verification: {outcome(report.reproduction_passed)}</h3>
    <p>Integrity: {outcome(report.integrity)} · Evidence graph: {outcome(report.evidence_graph_valid)}</p>
    <p>Recomputed: {count(report.reproduced,'computation')} · {count(report.artifacts_reproduced,'artifact')}.</p>
    <p>Scientific validity is not established by replay verification.</p>
    {report.failures?.length>0&&<p role="alert">{plural(report.failures.length,'verification failure')}. Open Verification details before relying on this replay.</p>}
    <details><summary>Verification details</summary><pre>{JSON.stringify(report,null,2)}</pre></details>
  </section>;
}

function Artifact({missionId,artifact,request,token,release,superseded}) {
  const [url,setUrl]=useState('');
  const [error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();let ownedUrl;
    setUrl('');setError('');
    request(`/missions/${missionId}/artifacts/${artifact.digest}`,'GET',undefined,controller.signal)
      .then(r=>r.blob()).then(blob=>{if(!controller.signal.aborted){ownedUrl=URL.createObjectURL(blob);setUrl(ownedUrl);}})
      .catch(e=>{if(!controller.signal.aborted&&e.name!=='AbortError')setError(friendlyError(e,token));});
    return ()=>{controller.abort();if(ownedUrl)URL.revokeObjectURL(ownedUrl);};
  },[missionId,artifact.digest,request,token,attempt]);
  return <figure className="artifact">{url?<><img src={url} alt={'Artifact from '+artifact.source_observation_id}/>{release?.eligible_for_human_review?<a href={url} download={artifact.digest+'.png'}>Download PNG</a>:<span className="muted">Download opens when the release decision is Eligible for human review. You can still inspect the image here.</span>}</>:error?<><p role="alert">Artifact could not be loaded: {error}</p><Button variant="secondary" onPress={()=>setAttempt(n=>n+1)}>Retry artifact</Button><p className="muted">Retry, or select the mission again.</p></>:<p className="muted">Loading image…</p>}<figcaption>{artifact.source_observation_id} · digest {artifact.digest.slice(0,12)}… · render preset {words(artifact.preset||'default')}{artifact.repair_of?' · repair of '+artifact.repair_of.slice(0,12)+'…':''}{superseded?' · superseded by a repair':''}</figcaption></figure>;
}

/** One line for the alert beside the action that failed; session cards come from http.js so every workspace reads the same. */
function friendlyError(error,token) {
  const message=error?.message||String(error);
  if(/Request failed \((401|403)\)/.test(message))return cardLine(token===NATIVE_SESSION?SESSION_COPY.nativeExpired:SESSION_COPY.expired);
  if(/Failed to fetch|NetworkError|Load failed/.test(message))return cardLine(SESSION_COPY.offline);
  return message;
}
function isAuthError(error) { return /Request failed \((401|403)\)/.test(error?.message||String(error)); }

const CLAIM_LABEL={unassessed:'Unassessed',provisionally_supported:'Provisionally supported',contradicted:'Contradicted',unresolved:'Unresolved'};
function ClaimScopeView({scope}) {
  // Requested claim -> evidence-supported scope -> remaining uncertainty -> next
  // discriminating test, derived from the reconciliation at the stop; a narrower
  // conclusion is a valid research output and nothing here is validation.
  return <section aria-label="Claim scope"><h2>Claim scope</h2>
    <p className="muted">For each requested claim: what the evidence supports so far, what is still uncertain, and the next test that would tell the branches apart. Two model roles contribute: the reviewer (the Reviewer (QA) seat in Settings), and the falsifier (the role that tries to disprove a result).</p>{scope?<>
    <p className="muted">Worked out at round {scope.basis_round}; provisional support is exploratory, never validation.</p>
    {scope.branches.map(branch=><article className="record claim" key={branch.branch_id} data-status={branch.status}>
      <h3>{branch.branch_id} · {CLAIM_LABEL[branch.status]||branch.status}</h3>
      <dl>
        <dt>Requested claim</dt><dd>{branch.requested}</dd>
        <dt>Evidence-supported scope</dt><dd>{branch.supported_scope.length?<>{branch.supported_scope.map((line,i)=><p key={i}>{line}</p>)}<p className="muted">Scope: {branch.scope_qualifier}.</p></>:<span className="muted">No supported scope; the requested claim stands only as a hypothesis.</span>}</dd>
        <dt>Remaining uncertainty</dt><dd>{branch.uncertainties.length?<ul>{branch.uncertainties.map((u,i)=><li key={i} data-reason={u.reason}>{words(u.reason)}{u.role?' ('+role(u.role)+')':''}: {u.detail}</li>)}</ul>:<span className="muted">None recorded by either role; provisional support still needs independent data.</span>}</dd>
        <dt>Next discriminating test</dt><dd>{branch.next_tests.length?<ul>{branch.next_tests.map((t,i)=><li key={i}>{role(t.role)}: {t.test}</li>)}</ul>:<span className="muted">No next test proposed.</span>}</dd>
      </dl>
    </article>)}
  </>:<p className="muted">Claim scope is worked out when the mission stops. Nothing yet.</p>}</section>;
}

function Changes({changes,obligations}) {
  // Every operator change on the mission: what was declared, what the server derived,
  // and the state of each obligation as the release ledger reads it now.
  return <section aria-label="Declared changes"><h2>Declared changes</h2>
    <p className="muted">Changes you declared on this mission: the effect you declared, the effect the service derived, and the checks each change obliges, as the release decision reads them now.</p>
    {changes.length?<ol className="changes">{changes.map(change=><li key={change.id} data-kind={change.kind}>
      <strong>{words(change.kind)}, round {change.round}</strong>
      <p>Declared effect: {change.declared_effects.map(words).join(', ')||'none'} · Derived effect: {change.derived_effects.map(words).join(', ')||'none'}</p>
      <p>Required checks: {(obligations?.[change.id]||change.required_checks.map(check=>({check,state:'unknown'}))).map(o=><span key={o.check} className={'check-state check-'+o.state}>{words(o.check)} {words(o.state)}</span>).reduce((acc,el,i)=>i?[...acc,' · ',el]:[el],[])}</p>
      {change.note?<p className="muted">{change.note}</p>:null}
    </li>)}</ol>:<p className="muted">No declared change.</p>}</section>;
}

/** The seats a blocked live mission waits on, as GET /api/readiness names them; nothing here is recomputed. */
const blockingSeats=readiness=>(readiness?.live_mission?.blocking||[]).map(role=>readiness.seats?.[role]).filter(Boolean);
const seatAction=seat=>seat.label+' — '+sentence(seat.next_action||seat.meaning);
function LiveRoute({readiness,error,locked,onNavigate,onCheck,token}) {
  let body;
  if(locked)body=<p className="muted">Seats are read once the session is unlocked.</p>;
  else if(error)body=<><p role="alert">{friendlyError(error,token)}</p><Button variant="secondary" size="sm" onPress={onCheck}>Check seats again</Button></>;
  else if(!readiness)body=<><p role="status" className="muted">Seats not read yet.</p><Button variant="secondary" size="sm" onPress={onCheck}>Check seats</Button></>;
  else{
    const seats=(readiness.roles||[]).map(r=>readiness.seats?.[r.role]).filter(seat=>seat?.facts?.provider);
    const live=readiness.live_mission,liveState=stateOf(live),blocking=blockingSeats(readiness);
    body=<>
      {seats.length?<ul className="live-seats">{seats.map(seat=><li key={seat.role} data-state={seat.state}>{seat.label} · {seat.facts.provider} · {seat.facts.model||'no model'} · {seat.facts.effort||'default effort'} · {STATE_LABEL[seat.state]||seat.state}</li>)}</ul>:<p className="muted">No seat is configured.</p>}
      {liveState==='blocked'?<><p role="status">{sentence(live.meaning)}{blocking.length?' Blocked by: '+blocking.map(seatAction).join(' '):live.next_action?' '+sentence(live.next_action):''}</p><Button variant="secondary" size="sm" onPress={()=>onNavigate?.('settings')}>Open Settings</Button></>
      :liveState==='not_tested'?<p className="muted">Seats are configured but not tested; a probe is available in Settings → Connections.</p>
      :<p className="muted">{STATE_LABEL[liveState]||liveState} — {sentence(live?.meaning||'Readiness could not be determined')}{liveState!=='ready'&&live?.next_action?' '+sentence(live.next_action):''}</p>}
    </>;
  }
  return <section className="live-route" aria-label="Live route"><h3>Live route</h3>{body}</section>;
}

function RepairCycles({repairs}) {
  // Each cycle re-rendered the reviewed images under a presentation preset and had
  // them reviewed again as a new candidate; the outcome is that fresh review's own
  // verdict, or the reason the cycle could not run. Nothing here is inferred.
  return <section aria-label="Figure repair cycles"><h2>Figure repair cycles</h2>{repairs.length?<ol className="repairs">{repairs.map((cycle,i)=><li key={i} data-outcome={cycle.outcome}>Cycle {cycle.cycle} · round {cycle.round} · render preset {words(cycle.preset)} · addressed {cycle.addressed.map(words).join(', ')||'nothing'} · review verdict: <strong>{words(cycle.outcome)}</strong>{cycle.reason?<span className="muted"> — {cycle.reason}</span>:null}</li>)}</ol>:<p className="muted">No repair cycles.</p>}</section>;
}

export default function ResearchWorkspace({token,setToken,readiness=null,readinessError=null,refreshReadiness,onNavigate}) {
  const [goal,setGoal]=useState('');
  const [mode,setMode]=useState('demo'),[egress,setEgress]=useState(false),[vision,setVision]=useState(false),[rounds,setRounds]=useState(5),[points,setPoints]=useState('');
  const [mission,setMission]=useState(null),[missions,setMissions]=useState(null),[verification,setVerification]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  // Which action the alert or progress line belongs to: 'start', 'list' or 'results'.
  const [slot,setSlot]=useState('results');
  const [authExpired,setAuthExpired]=useState(false);
  const selected=useRef(null),generation=useRef(0),credential=useRef(null),lastToken=useRef(token),validatedToken=useRef(''),authExpiredRef=useRef(false),results=useRef(null);
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
  async function task(action,where='results'){
    const signal=credential.current.signal;
    setSlot(where);setBusy(true);setError('');
    try{
      // A missing or rejected token is stated once, by the LockNotice beside Create and start.
      if(sessionState(token,authExpired))return;
      await action(signal);
    }catch(e){if(!signal.aborted){if(isAuthError(e))setAuthExpired(true);else setError(friendlyError(e,token));}}finally{if(!signal.aborted)setBusy(false);}
  }
  const notice=where=>where!==slot?null:error?<p role="alert">{error}</p>:busy?<p role="status" className="muted">Research request in progress…</p>:null;
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
    async function poll(){try{await refresh(mission.id,controller.signal);}catch(e){if(!controller.signal.aborted&&e.name!=='AbortError'){setSlot('results');if(isAuthError(e)){setAuthExpired(true);controller.abort();return;}setError(friendlyError(e,token));}}if(!controller.signal.aborted)timer=setTimeout(poll,1000);}
    timer=setTimeout(poll,1000);
    return ()=>{controller.abort();clearTimeout(timer);owner.signal.removeEventListener('abort',abort);};
  },[mission?.id,mission?.state.status,refresh,token]);
  function parsePoints(){
    if(!points.trim())return null;
    try{return JSON.parse(points);}catch(e){throw new Error('Measurement JSON is not valid JSON: '+e.message+'. Fix it under Execution settings, then retry.');}
  }
  async function start(signal){
    const parsed=parsePoints();
    const row=await read('/missions',signal,'POST',{goal,mode,max_rounds:clampRounds(rounds),allow_egress:egress,vision_review:vision,points:parsed});
    generation.current++;selected.current=row.id;setMission(row);setVerification(null);
    // The composer stays as it is (your draft stays in this window); the result is brought into view.
    results.current?.scrollIntoView?.({block:'start'});
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
  const card=sessionState(token,authExpired);
  // Live mode reads the seats from GET /api/readiness; main.jsx caches the call, so repeats are free.
  // The read is tied to selecting Live, not to the token: a token typed afterwards resets the reading
  // (main.jsx), and until Check seats is pressed the seats count as not read, which blocks the start.
  const checkSeats=()=>Promise.resolve(refreshReadiness?.()).catch(()=>{/* readinessError carries the reason */});
  useEffect(()=>{if(mode==='live'&&!locked)checkSeats();},[mode,locked]);
  // The service refuses a live mission without consent at creation, and refuses one whose seats are blocked
  // or unread; each is stated beside Create and start instead of being sent.
  const consentMissing=mode==='live'&&!egress;
  const liveBlocked=mode==='live'&&(!readiness||stateOf(readiness?.live_mission)==='blocked');
  const modeNote=mode==='demo'?'Offline fixture: the model roles are scripted; the numerical fits are computed for real.'
    :liveBlocked&&!readiness?'Live models: the seats have not been read yet. Press Check seats under Execution settings.'
    :liveBlocked?'Live models are blocked. '+(blockingSeats(readiness).map(seatAction).join(' ')||readiness.live_mission.next_action||readiness.live_mission.meaning)+' See Live route under Execution settings.'
    :'Live models: the seats set in Settings (a seat is one model assigned to one role). '+(egress?'This mission\'s goal and data will be sent to them.':'A live mission is refused until you tick the consent box in Execution settings; the goal and data then leave this machine.');
  return <div className="research-workspace guided-research">
    <section className="research-composer" aria-label="Research mission composer">
      <div className="composer-heading"><p className="eyebrow">RESEARCH</p><h1>Start with a question.</h1><p className="muted">Keep alternatives, evidence and uncertainty visible.</p></div>
      <div className="composer-grid">
        <div className="question-field">
          <label htmlFor="goal">Research goal</label><textarea id="goal" rows={4} value={goal} onChange={e=>setGoal(e.target.value)}/>
          <div className="example-row"><Button variant="ghost" size="sm" onPress={()=>setGoal(EXAMPLE_GOAL)}>Use example</Button><span className="field-note">Replaces the draft with a sample question. It does not start a mission.</span></div>
        </div>
        <div className="composer-action-panel">
          <Button isDisabled={busy||locked||!goal.trim()||consentMissing||liveBlocked} onPress={()=>task(start,'start')}>Create and start</Button>
          {notice('start')}
          {card?<LockNotice card={card} tone={authExpired?'error':'info'} onUnlock={()=>focusTokenField(token,setToken)} unlockLabel={unlockLabel(token)} compact/>
            :!goal.trim()?<p className="muted">Enter a research goal to enable Create and start.</p>
            :<p className="muted">{modeNote}</p>}
        </div>
      </div>
      <details className="research-options"><summary><span>Execution settings</span><span className="muted"> · {mode==='demo'?'offline fixture (nothing is sent)':'live models · sending data '+(egress?'permitted':'not permitted')+(readiness?' · seats: '+STATE_LABEL[stateOf(readiness.live_mission)]:'')}</span></summary>
        <div className="formrow"><div><label htmlFor="mode">Model source</label><select id="mode" value={mode} onChange={e=>setMode(e.target.value)}><option value="demo">Offline fixture (scripted roles; nothing is sent)</option><option value="live">Live models (seats set in Settings)</option></select></div><div><label htmlFor="rounds">Round limit (1–{MAX_ROUNDS})</label><input id="rounds" type="number" min="1" max={MAX_ROUNDS} value={rounds} onChange={e=>setRounds(e.target.value)} onBlur={()=>setRounds(clampRounds(rounds))}/></div></div>
        {mode==='live'&&<LiveRoute readiness={readiness} error={readinessError} locked={locked} onNavigate={onNavigate} onCheck={checkSeats} token={token}/>}
        <label className="check"><input type="checkbox" checked={egress} onChange={e=>setEgress(e.target.checked)}/>Permit sending this mission's goal and data to the configured models (the text leaves this machine).</label>
        <label className="check"><input type="checkbox" checked={vision} onChange={e=>setVision(e.target.checked)}/>Require configured visual review of each new fit image (plot).</label>
        <details><summary>Optional x/y measurements</summary><label htmlFor="points">Measurement JSON</label><textarea id="points" rows={4} value={points} onChange={e=>setPoints(e.target.value)}/><p className="muted">Paste a JSON list of 8–2000 points, each {'{"x": number, "y": number}'}, with x within ±1,000,000 and y within ±1e12. Leave it empty and a live mission starts with no dataset; it can read public data only when the service has public reads enabled.</p></details>
      </details>
    </section>
    <div className="research-workbench">
      <aside className="saved-missions" aria-label="Saved missions">
        <div className="saved-missions-heading"><h2>Saved missions</h2><Button variant="secondary" isDisabled={busy||locked} onPress={()=>task(async signal=>setMissions(await read('/missions',signal)),'list')}>Load missions</Button></div>
        {notice('list')}
        {missions===null?<p className="muted">{locked?'Enter an operator token to load saved missions.':'Press Load missions to list your saved missions.'}</p>:missions.length?missions.map(row=><Button className="mission-choice" variant="ghost" key={row.id} isDisabled={busy||locked} onPress={()=>task(signal=>select(row.id,signal),'list')}>{words(row.status)} · {row.goal}{row.mode?' · '+modeLabel(row.mode):''}</Button>):<p>No saved missions. Create a mission to begin.</p>}
      </aside>
      <section className="research-results" aria-label="Research results" ref={results}>
      {!state?<>{notice('results')}<div className="empty-state"><h2>No mission selected.</h2><p>Create one above or load a saved mission.</p></div></>:<>
        <div className="results-heading"><div><p className="eyebrow">Selected mission: {mission.id}</p><h2>Mission overview</h2></div><div className="status-stack"><span className="status-label">{words(state.status)}</span>{mission.request?.mode&&<span className="mode-chip">{modeLabel(mission.request.mode)}</span>}{mission.release&&<span className={'release-chip release-'+mission.release.status}>Release: {RELEASE_LABEL[mission.release.status]||words(mission.release.status)}</span>}</div></div>
        <p className="muted">Round {state.round} · {plural(state.actions_used,'action')} · {plural(state.model_calls_used,'model call')} · data source: {words(state.data_origin)}</p>
        <div className="actions"><Button isDisabled={busy||locked} onPress={()=>task(async signal=>{setVerification(await (await request('/missions/'+mission.id+'/verify','POST',undefined,signal)).json());await refresh(mission.id,signal);})}>Replay and verify</Button><Button variant="secondary" isDisabled={busy||locked||!mission.release?.eligible_for_human_review} onPress={()=>task(exportCapsule)}>Export replay archive (.zip)</Button><Button variant="ghost" isDisabled={busy||locked||!['ready','paused'].includes(state.status)} onPress={()=>task(async signal=>{await request('/missions/'+mission.id+'/start','POST',undefined,signal);await refresh(mission.id,signal);})}>{state.status==='paused'?'Resume (recorded as an analysis change)':state.status==='ready'?'Start':'Resume'}</Button><Button variant="danger" isDisabled={busy||locked||['cancelled','completed','budget_exhausted','error','needs_input'].includes(state.status)} onPress={()=>task(async signal=>{await request('/missions/'+mission.id+'/cancel','POST',undefined,signal);await refresh(mission.id,signal);})}>Cancel</Button></div>
        {!mission.release?.eligible_for_human_review&&<p className="muted">Export opens when the release decision is Eligible for human review.</p>}
        {notice('results')}
        {state.stop_reason&&<p role="status">Stop reason: {state.stop_reason}</p>}<ReleaseLedger release={mission.release}/>{verification&&<VerificationReport report={verification}/>}
        <ClaimScopeView scope={state.claim_scope}/>
        <div className="branches">{state.branches.map(branch=><article key={branch.id} className={'branch'+(state.focus===branch.id?' focus':'')}><h3>{branch.title}</h3><p>{branch.hypothesis}</p><p>Would be refuted by: {branch.falsifier}</p><p className="muted">Opened round {branch.created_round} · parents: {branch.parents.join(', ')||'root'}</p></article>)}</div>
        <h2>Visual artifacts</h2><div className="artifacts">{state.artifacts.length?state.artifacts.map(artifact=><Artifact key={mission.id+artifact.digest} missionId={mission.id} artifact={artifact} request={request} token={token} release={mission.release} superseded={state.artifacts.some(a=>a.repair_of===artifact.digest)}/>):<p className="muted">No visual artifacts in this mission.</p>}</div>
        <h2>Visual review</h2>{state.visual_reports.length?state.visual_reports.map((report,i)=><div className="record" key={i}><h3>{report.model} · round {report.round} · {words(report.verdict)}</h3>{report.findings.map((finding,j)=><p key={j}>{words(finding.category)}: {finding.detail}</p>)}</div>):<p className="muted">No visual review.</p>}
        <RepairCycles repairs={state.repairs||[]}/>
        <Changes changes={state.changes||[]} obligations={mission.change_obligations}/>
        <details className="result-disclosure"><summary>Reconciliation ({state.assessments.length>12?'last 12 of '+state.assessments.length+' assessments':plural(state.assessments.length,'assessment')})</summary>{state.assessments.slice(-12).map((assessment,i)=><div className="record" key={i}><h3>{role(assessment.role)} · {assessment.branch_id} · {words(assessment.position)}</h3><p>{assessment.finding}</p><p className="muted">Evidence: {assessment.evidence_ids.join(', ')} · Model: {assessment.model}</p></div>)}</details>
        <details className="result-disclosure"><summary>Execution evidence</summary>{state.observations.map(observation=><details className="record" key={observation.id}><summary>{observation.id} · {observation.tool} · {words(observation.status)}</summary><pre>{JSON.stringify(observation.data,null,2)}</pre></details>)}</details>
        <details className="result-disclosure"><summary>Event history ({state.events.length>15?'last 15 of '+state.events.length+' events':plural(state.events.length,'event')})</summary>{state.events.slice(-15).reverse().map((event,i)=><p className="muted" key={i}>[{event.round}] {words(event.kind)}: {event.detail}</p>)}</details>
      </>}
      </section>
    </div>
  </div>;
}
