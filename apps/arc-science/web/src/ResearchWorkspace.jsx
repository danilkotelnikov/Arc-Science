import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {NATIVE_SESSION, SESSION_COPY, apiFetch, downloadResponse, sessionState} from './http';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';
import {GRANT_STATE_LABEL, STATE_LABEL, grantState, releaseWord, sentence, stateOf} from './readiness';

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
  const [error,setError]=useState(''),[attempt,setAttempt]=useState(0),[refused,setRefused]=useState('');
  useEffect(()=>{
    const controller=new AbortController();let ownedUrl;
    setUrl('');setError('');setRefused('');
    request(`/missions/${missionId}/artifacts/${artifact.digest}`,'GET',undefined,controller.signal)
      .then(r=>r.blob()).then(blob=>{if(!controller.signal.aborted){ownedUrl=URL.createObjectURL(blob);setUrl(ownedUrl);}})
      .catch(e=>{if(!controller.signal.aborted&&e.name!=='AbortError')setError(friendlyError(e,token));});
    return ()=>{controller.abort();if(ownedUrl)URL.revokeObjectURL(ownedUrl);};
  },[missionId,artifact.digest,request,token,attempt]);
  // The file download goes through the ledger-gated route; the inline image above stays whatever it answers.
  async function download(){
    setRefused('');
    try{
      const response=await request(`/missions/${missionId}/artifacts/${artifact.digest}/download`,'GET',undefined,new AbortController().signal);
      await downloadResponse(response,'arc-'+missionId+'-'+artifact.digest.slice(0,12)+'.png');
    }catch(e){setRefused(friendlyError(e,token));}
  }
  return <figure className="artifact">{url?<><img src={url} alt={'Artifact from '+artifact.source_observation_id}/>{release?.eligible_for_human_review?<Button size="sm" variant="secondary" onPress={download}>Download PNG</Button>:<span className="muted">Download opens when the release decision is Eligible for human review. You can still inspect the image here.</span>}{refused&&<p role="alert">Download refused: {refused}</p>}</>:error?<><p role="alert">Artifact could not be loaded: {error}</p><Button variant="secondary" onPress={()=>setAttempt(n=>n+1)}>Retry artifact</Button><p className="muted">Retry, or select the mission again.</p></>:<p className="muted">Loading image…</p>}<figcaption>{artifact.source_observation_id} · digest {artifact.digest.slice(0,12)}… · render preset {words(artifact.preset||'default')}{artifact.repair_of?' · repair of '+artifact.repair_of.slice(0,12)+'…':''}{superseded?' · superseded by a repair':''}</figcaption></figure>;
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
const identityWord=value=>value===true?'verified':value===false?'not verified':'not recorded';
/** Epoch milliseconds from the timeline; the dash when no row recorded a time. */
const at=ms=>ms===null||ms===undefined?'—':new Date(ms).toLocaleString();
// The Observation.data fields a claim card reads out; the service copies them verbatim (claims.py NUMERIC_FIELDS).
const NUMERIC_LINES=[['validation_mse','validation MSE'],['mean_shuffled_validation_mse','mean shuffled MSE'],['n','n']];
const numericSummary=summary=>NUMERIC_LINES.filter(([key])=>summary?.[key]!==undefined).map(([key,label])=>' · '+label+' '+summary[key]).join('');
const idList=ids=>ids.length?ids.join(', '):'none';
// The rows every card shows, in this order; the scope, uncertainty and next-test rows read as the persisted view below.
const ScopeRow=({supported_scope,scope_qualifier})=><dd>{supported_scope.length?<>{supported_scope.map((line,i)=><p key={i}>{line}</p>)}<p className="muted">Scope: {scope_qualifier}.</p></>:<span className="muted">No supported scope; the requested claim stands only as a hypothesis.</span>}</dd>;
const UncertaintyRow=({uncertainties})=><dd>{uncertainties.length?<ul>{uncertainties.map((u,i)=><li key={i} data-reason={u.reason}>{words(u.reason)}{u.role?' ('+role(u.role)+')':''}: {u.detail}</li>)}</ul>:<span className="muted">None recorded by either role; provisional support still needs independent data.</span>}</dd>;
const NextTestRow=({next_tests})=><dd>{next_tests.length?<ul>{next_tests.map((t,i)=><li key={i}>{role(t.role)}: {t.test}</li>)}</ul>:<span className="muted">No next test proposed.</span>}</dd>;
function ClaimCard({claim,derivationVersion}) {
  // Every field is the service's derivation from persisted records (GET /claims, source 'derived'):
  // the status is the persisted claim scope's, never a model's own word; times come from the
  // operational timeline or are stated as not recorded.
  const {independence:ind,alternatives:alt}=claim;
  return <article className="record claim" data-status={claim.status} data-stale={String(!!claim.stale_derivation)}>
    <h3>{claim.claim_id} · {CLAIM_LABEL[claim.status]||claim.status}</h3>
    <dl>
      <dt>Requested claim</dt><dd>{claim.requested}</dd>
      <dt>Evidence-supported scope</dt><ScopeRow {...claim}/>
      <dt>Remaining uncertainty</dt><UncertaintyRow {...claim}/>
      <dt>Evidence</dt><dd>{claim.evidence.length?<ul>{claim.evidence.map(e=><li key={e.id} data-evidence-id={e.id}>{e.id} · {e.method} · digest {e.digest.slice(0,12)}… · {words(e.status)}{e.counts_for_scope?'':' · not counted for scope'} · started {e.started_at===null||e.started_at===undefined?'no time recorded':at(e.started_at)} · receipt {e.receipt_id?.slice(0,12)||'none'}{numericSummary(e.numeric_summary)}</li>)}</ul>:<span className="muted">No observation for this hypothesis.</span>}</dd>
      <dt>Independence</dt><dd><p>Independent reviewers: {ind.independent?'yes':'no'}</p>{Object.entries(ind.roles).map(([name,seat])=><p key={name}>{role(name)}: {seat.model} · identity {identityWord(seat.identity_verified)}</p>)}{ind.reasons.length?<p className="muted">{ind.reasons.map(words).join(', ')}</p>:null}</dd>
      <dt>Findings</dt><dd>{claim.findings.length?<ul>{claim.findings.map((f,i)=><li key={i}>{role(f.role)} · {words(f.position)}: {f.finding}</li>)}</ul>:<span className="muted">No finding recorded by either role.</span>}</dd>
      <dt>Alternatives</dt><dd><p>parents {idList(alt.parents)}; siblings {idList(alt.siblings)}; children {idList(alt.children)}</p>{alt.conflicts_source==='unavailable'?<p className="muted">conflicts unavailable</p>:alt.conflicts.map((c,i)=><p key={i}>Conflict: support and challenge both recorded (assessments {idList(c.assessment_ids||[])})</p>)}</dd>
      <dt>Next discriminating test</dt><NextTestRow {...claim}/>
      <dt>Units</dt><dd>{claim.units_note}</dd>
      <dt>Derivation</dt><dd>{derivationVersion||'no derivation'} · release check claim scope: {releaseWord(claim.claim_scope_check)}{claim.stale_derivation&&<> · <strong>Stale: {claim.stale_reason}</strong></>}</dd>
    </dl>
  </article>;
}
function ClaimScopeView({scope,claims,claimsError}) {
  // Requested claim -> evidence-supported scope -> remaining uncertainty -> next
  // discriminating test, derived from the reconciliation at the stop; a narrower
  // conclusion is a valid research output and nothing here is validation. The cards
  // come from GET /claims; when that read fails, the persisted claim scope is shown as is.
  const cards=!claimsError&&claims?.claims?.length?claims:null;
  return <section aria-label="Claim scope"><h2>Claim scope</h2>
    <p className="muted">For each requested claim: what the evidence supports so far, what is still uncertain, and the next test that would tell the branches apart. Two model roles contribute: the reviewer (the Reviewer (QA) seat in Settings), and the falsifier (the role that tries to disprove a result).</p>
    {claimsError&&<p role="alert">{claimsError}</p>}{cards?<>
    <p className="muted">Worked out at round {cards.basis_round}; provisional support is exploratory, never validation. {cards.rule}</p>
    {cards.claims.map(claim=><ClaimCard key={claim.claim_id} claim={claim} derivationVersion={cards.derivation_version}/>)}
    <p className="muted">{cards.uncertainty_note} {cards.note}</p>
  </>:scope?<>
    <p className="muted">Worked out at round {scope.basis_round}; provisional support is exploratory, never validation.</p>
    {scope.branches.map(branch=><article className="record claim" key={branch.branch_id} data-status={branch.status}>
      <h3>{branch.branch_id} · {CLAIM_LABEL[branch.status]||branch.status}</h3>
      <dl>
        <dt>Requested claim</dt><dd>{branch.requested}</dd>
        <dt>Evidence-supported scope</dt><ScopeRow {...branch}/>
        <dt>Remaining uncertainty</dt><UncertaintyRow {...branch}/>
        <dt>Next discriminating test</dt><NextTestRow {...branch}/>
      </dl>
    </article>)}
  </>:<p className="muted">{claims?.note||'Claim scope is worked out when the mission stops. Nothing yet.'}</p>}</section>;
}

/** The last persisted event decides the banner: an interruption or a pause is shown from the event itself, nothing is inferred. */
function Interruption({events}) {
  const last=events[events.length-1];
  if(last?.kind==='mission_interrupted')return <p role="status" className="interruption" data-event={last.kind}>Interrupted: the service exited while this mission was running (persisted event mission_interrupted, round {last.round}). Evidence is retained. Resume continues it as a declared change; timeline rows without a recorded outcome were abandoned by the exit.</p>;
  if(last?.kind==='mission_paused')return <p role="status" className="interruption" data-event={last.kind}>Paused: {last.detail} Resume continues it as a declared change.</p>;
  return null;
}

/** The route bound at the first start, read from the seats_bound event (`sha256:<digest> <json summary>`) and the mission's grants; nothing is recomputed. */
function MissionRoute({state,mode,grants}) {
  const bound=[...state.events].reverse().find(e=>e.kind==='seats_bound');
  let body;
  if(!bound)body=<p className="muted">{mode==='live'?'No route bound yet: a live mission binds its route (event seats_bound) at its first start.':'Offline fixture: scripted roles (scripted-fixture-v1); no route was bound and no grant exists.'}</p>;
  else{
    let summary=null;try{summary=JSON.parse(bound.detail.slice(72));}catch{summary=null;}
    const counts={};for(const grant of grants?.grants||[])counts[grantState(grant)]=(counts[grantState(grant)]||0)+1;
    body=<>
      {summary&&typeof summary==='object'?<ul className="route-lines">{Object.entries(summary).map(([key,value])=><li key={key}>{key} · {Array.isArray(value)?value.join(', '):String(value)}</li>)}</ul>:<p>{bound.detail}</p>}
      <p className="muted">Route digest {bound.detail.slice(7,19)}… · bound at round {bound.round} (event seats_bound)</p>
      <p className="muted">Grants: {counts.active||0} active · {counts.revoked||0} revoked (see Grants and receipts)</p>
    </>;
  }
  return <section aria-label="Mission route"><h2>Route</h2>{body}</section>;
}

function Timeline({timeline,error}) {
  // Operational record (GET /timeline), never evidence: one row per operation with its recorded
  // outcome; a row without a finished row reads 'no outcome recorded' and nothing here says a
  // mission is running — that word comes from the persisted status alone.
  let body;
  if(error)body=<p role="alert">{error}</p>;
  else if(!timeline)body=<p className="muted">Timeline not read yet.</p>;
  else if(!timeline.recorded||!timeline.rows.length)body=<p className="muted">No timeline was recorded for this mission: it ran before the timeline existed, or it has not started. The event history below is the persisted record.</p>;
  else body=<div className="timeline-wrap"><table className="grants timeline"><thead><tr><th>#</th><th>Started</th><th>Finished</th><th>Operation</th><th>Role</th><th>Model</th><th>Identity</th><th>Tool / action</th><th>Branch</th><th>Outcome</th><th>Receipt</th><th>Actor / detail</th></tr></thead>
    <tbody>{timeline.rows.map(row=><tr key={row.id} data-operation={row.operation} data-role={row.role} data-outcome={row.outcome} data-outcome-source={row.outcome_source}>
      <td>{row.sequence}</td><td>{at(row.started_at)}</td><td>{at(row.finished_at)}</td><td>{words(row.operation)}</td><td>{role(row.role)}</td>
      <td>{row.model_requested?row.model_requested+(row.model_observed?' → '+row.model_observed:''):'—'}</td>
      <td>{identityWord(row.identity_verified)}</td>
      <td>{row.tool?row.tool+' · '+row.action_id:'—'}</td><td>{row.branch_id||'—'}</td>
      <td>{row.outcome==='outcome_unknown'?'no outcome recorded':words(row.outcome)}</td>
      <td>{row.receipt_id?row.receipt_id.slice(0,12):'none'}</td>
      <td>{[row.actor,row.detail].filter(Boolean).join(' · ')}</td>
    </tr>)}</tbody></table></div>;
  return <section aria-label="Timeline"><h2>Timeline</h2><p className="muted">{timeline?.note||'Operational record written by the service; not scientific evidence.'}</p>{body}</section>;
}

// Reopen: the browser keeps only the selected mission's id (never the token); it is restored once per page load.
const STORED='arc.research.mission';
const readStored=()=>{try{return localStorage.getItem(STORED)||null;}catch{return null;}};
const store=id=>{try{if(id)localStorage.setItem(STORED,id);else localStorage.removeItem(STORED);}catch{/* no storage: nothing to restore next time */}};
const isNotFound=error=>/Request failed \(404\)/.test(error?.message||String(error));

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

/** The destinations a live mission would send data to, as GET /api/missions/preview lists them; the grants posted at start are the preview's own required_grants. */
const routeRows=preview=>[
  ...(preview.seats||[]).map(seat=>({...seat,name:role(seat.role)+' · '+seat.provider+' '+(seat.model||'no model')})),
  ...(preview.connectors||[]),
  ...(preview.public_reads||[]).map(read=>({...read,name:'public read',purpose:read.purpose||'planner query'})),
  ...(preview.biorender?[{name:'BioRender',...preview.biorender}]:[]),
];
const when=at=>at>0?new Date(at*1000).toLocaleString():'never';
const isConflict=error=>/Request failed \(409\)/.test(error?.message||String(error));
function RouteGrants({preview,error,blocked,locked,approved,onApprove,onRetry}) {
  let body;
  if(locked)body=<p className="muted">The route is read once the session is unlocked.</p>;
  else if(blocked)body=<p className="muted">The route cannot be previewed while the live route is blocked; see Live route above.</p>;
  else if(error)body=<><p role="alert">{error}</p><Button variant="secondary" size="sm" onPress={onRetry}>Preview the route again</Button></>;
  else if(!preview)body=<p role="status" className="muted">Reading the route…</p>;
  else{
    const rows=routeRows(preview);
    body=<>
      <table className="grants"><thead><tr><th>Kind</th><th>Name</th><th>Destination</th><th>Data category</th><th>Purpose</th></tr></thead>
        <tbody>{rows.map((row,i)=><tr key={i}><td>{row.destination_kind}</td><td>{row.name}</td><td>{row.destination}</td><td>{row.data_category}</td><td>{row.purpose}</td></tr>)}</tbody></table>
      <p className="muted">Route digest {preview.route_digest.slice(0,12)} · settings revision {preview.settings_revision}. Settings consent only makes a destination eligible; this approval is the grant, recorded per destination for this mission.</p>
      <label className="check"><input type="checkbox" aria-label="Approve route" checked={approved} onChange={e=>onApprove(e.target.checked)}/>Approve this route for this mission: each destination above may receive its data category for its purpose until the mission stops.</label>
    </>;
  }
  return <section className="route-grants" aria-label="Route and grants"><h3>Route and grants</h3>{body}</section>;
}

function GrantsLedger({ledger,error,busy,locked,onRevoke}) {
  // Operational record, never evidence: which destinations this mission may send data to
  // (grants) and each attempted dispatch (receipts). Revoking refuses the mission's next call.
  const [reasons,setReasons]=useState({});
  const grants=ledger?.grants||[],receipts=ledger?.receipts||[];
  let body;
  if(error)body=<p role="alert">Grants could not be read: {error}</p>;
  else if(!ledger)body=<p className="muted">Grants not read yet.</p>;
  else body=<>
    {grants.length?<table className="grants"><thead><tr><th>Destination</th><th>Kind</th><th>Data category</th><th>Scope</th><th>State</th><th>Uses</th><th>Last use</th><th></th></tr></thead>
      <tbody>{grants.map(grant=><tr key={grant.id} data-state={grantState(grant)}><td>{grant.destination}</td><td>{grant.destination_kind}</td><td>{grant.data_category}</td><td>{grant.scope}</td><td>{GRANT_STATE_LABEL[grantState(grant)]}{grant.revoked_at?' '+when(grant.revoked_at):''}</td><td>{grant.uses}{grant.max_uses?' of '+grant.max_uses:''}</td><td>{when(grant.last_used_at)}</td>
        <td>{grantState(grant)==='active'&&<span className="revoke"><input type="text" aria-label="Revoke reason" placeholder="Reason" value={reasons[grant.id]||''} onChange={e=>setReasons({...reasons,[grant.id]:e.target.value})}/><Button variant="danger" size="sm" aria-label={'Revoke grant '+grant.destination} isDisabled={busy||locked} onPress={()=>onRevoke(grant.id,reasons[grant.id]||'')}>Revoke</Button></span>}</td></tr>)}</tbody></table>
    :<p className="muted">No grants. An offline fixture makes no external calls; a live mission's grants are recorded when it is first started.</p>}
    <h3>Receipts</h3>
    {receipts.length?<table className="grants"><thead><tr><th>Time</th><th>Destination</th><th>Data category</th><th>Outcome</th><th>Reason</th><th>Observation</th></tr></thead>
      <tbody>{receipts.map(receipt=><tr key={receipt.id} data-outcome={receipt.outcome}><td>{when(receipt.at)}</td><td>{receipt.destination}</td><td>{receipt.data_category}</td><td>{receipt.outcome}</td><td>{receipt.reason}</td><td>{receipt.observation_id||''}</td></tr>)}</tbody></table>
    :<p className="muted">No receipts: nothing has been dispatched under a grant.</p>}
    {ledger.receipts_truncated&&<p className="muted">Only the newest {receipts.length} receipts are shown; older dispatches are in the ledger.</p>}
  </>;
  return <section className="grants-ledger" aria-label="Grants and receipts"><h2>Grants and receipts</h2>
    <p className="muted">Which destinations this mission may send data to, and each attempted dispatch. Operational record, not scientific evidence; revoking a grant refuses the mission's next call to that destination.</p>{body}</section>;
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
  // A start, resume or retry the service accepted (202) keeps the mission polled until its persisted
  // status leaves paused or error (30 s at most): a live worker connects its connectors before its
  // first commit, so the row read right after the 202 can still say paused.
  const [scheduled,setScheduled]=useState(null);
  const accepted=id=>setScheduled({id,until:Date.now()+30000});
  // The route preview (GET /api/missions/preview) and the operator's approval of it; the ledger of the selected mission.
  const [preview,setPreview]=useState(null),[previewError,setPreviewError]=useState(''),[previewEpoch,setPreviewEpoch]=useState(0),[approved,setApproved]=useState(false),[routeConflict,setRouteConflict]=useState(false);
  const [grants,setGrants]=useState(null),[grantsError,setGrantsError]=useState('');
  // The operational timeline and the derived claim cards of the selected mission, each read beside it.
  const [timeline,setTimeline]=useState(null),[timelineError,setTimelineError]=useState('');
  const [claims,setClaims]=useState(null),[claimsError,setClaimsError]=useState('');
  const [retryReason,setRetryReason]=useState('');
  // Which action the alert or progress line belongs to: 'start', 'list' or 'results'.
  const [slot,setSlot]=useState('results');
  const [authExpired,setAuthExpired]=useState(false);
  const selected=useRef(null),generation=useRef(0),credential=useRef(null),lastToken=useRef(token),validatedToken=useRef(''),authExpiredRef=useRef(false),results=useRef(null);
  const pending=useRef(readStored());
  useEffect(()=>{authExpiredRef.current=authExpired;},[authExpired]);
  const clearSide=()=>{setGrants(null);setGrantsError('');setTimeline(null);setTimelineError('');setClaims(null);setClaimsError('');setRetryReason('');};
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
    setPreview(null);setPreviewError('');setApproved(false);setRouteConflict(false);clearSide();
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
    setSlot(where);setBusy(true);setError('');setRouteConflict(false);
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
    const current=()=>epoch===generation.current&&selected.current===id&&!signal.aborted;
    // The ledger, the timeline and the claim cards are read beside the mission on every refresh (selection, each poll,
    // after an action), each guarded on its own: a failed or unshaped answer is stated in its section and never blocks the mission.
    // They land before the mission row does: a status change ends the poll and aborts its signal, so the final
    // poll's sections (the claim cards exist only once the mission has stopped) must already be in place.
    const beside=async(path,shaped,set,setError,unshaped)=>{
      try{const data=await read('/missions/'+id+path,signal);if(!current())return;if(shaped(data)){set(data);setError('');}else{set(null);setError(unshaped);}}
      catch(e){if(isAuthError(e)||signal.aborted)throw e;if(current())setError(friendlyError(e,token));}
    };
    await beside('/grants',()=>true,setGrants,setGrantsError,'');
    await beside('/timeline',data=>Array.isArray(data?.rows),setTimeline,setTimelineError,'The timeline answer had no rows list; the service may be out of date.');
    await beside('/claims',data=>Array.isArray(data?.claims),setClaims,setClaimsError,'The claims answer had no claims list; the service may be out of date.');
    if(current())setMission(row);
    return row;
  },[read,token]);
  async function select(id,signal){generation.current++;selected.current=id;setMission(null);setVerification(null);clearSide();store(id);await refresh(id,signal);}
  useEffect(()=>{
    if(!mission)return;
    const awaited=scheduled?.id===mission.id&&['paused','error'].includes(mission.state.status)&&Date.now()<scheduled.until;
    if(scheduled?.id===mission.id&&!awaited)setScheduled(null);
    if(!['ready','running'].includes(mission.state.status)&&!awaited)return;
    const controller=new AbortController();let timer;
    const owner=credential.current;
    const abort=()=>controller.abort();owner.signal.addEventListener('abort',abort,{once:true});
    async function poll(){try{await refresh(mission.id,controller.signal);}catch(e){if(!controller.signal.aborted&&e.name!=='AbortError'){setSlot('results');if(isAuthError(e)){setAuthExpired(true);controller.abort();return;}setError(friendlyError(e,token));}}if(!controller.signal.aborted)timer=setTimeout(poll,1000);}
    timer=setTimeout(poll,1000);
    return ()=>{controller.abort();clearTimeout(timer);owner.signal.removeEventListener('abort',abort);};
  },[mission?.id,mission?.state.status,refresh,token,scheduled]);
  function parsePoints(){
    if(!points.trim())return null;
    try{return JSON.parse(points);}catch(e){throw new Error('Measurement JSON is not valid JSON: '+e.message+'. Fix it under Execution settings, then retry.');}
  }
  // A live mission's first start carries the approved route digest and the grants the preview asked for; an offline one sends no body.
  const startBody=()=>mode==='live'&&approved&&preview?{approved_route_digest:preview.route_digest,grants:preview.required_grants}:undefined;
  async function startMission(id,body,signal){
    try{await request('/missions/'+id+'/start','POST',body,signal);}
    catch(e){if(isConflict(e))setRouteConflict(true);throw e;}
    accepted(id);
    await refresh(id,signal);
  }
  async function start(signal){
    const parsed=parsePoints();
    const body=startBody();
    const row=await read('/missions',signal,'POST',{goal,mode,max_rounds:clampRounds(rounds),allow_egress:egress,vision_review:vision,points:parsed});
    generation.current++;selected.current=row.id;setMission(row);setVerification(null);clearSide();store(row.id);
    // The composer stays as it is (your draft stays in this window); the result is brought into view.
    results.current?.scrollIntoView?.({block:'start'});
    await startMission(row.id,body,signal);
  }
  function reviewRoute(){setRouteConflict(false);setError('');setApproved(false);setPreviewEpoch(n=>n+1);}
  async function exportCapsule(signal){
    const response=await request('/missions/'+mission.id+'/capsule','GET',undefined,signal);
    await downloadResponse({blob:async()=>{
      const blob=await response.blob();signal.throwIfAborted();return blob;
    }},'arc-'+mission.id+'.zip');
  }
  const state=mission?.state;
  const locked=!token||authExpired;
  const card=sessionState(token,authExpired);
  // Reopen: once per page load, when the session is unlocked, the stored mission id is selected again; a token
  // switch afterwards clears the selection as always and does not restore. A mission that is gone drops the key.
  // An attempt cut short (the token still being typed, or rejected) is not the one attempt: the next unlock retries.
  // Never on a keystroke: like Settings, a manual token counts once it has settled (Tab, Enter or a click
  // elsewhere) or has already been accepted by a protected read; the desktop session needs no settling.
  const settledToken=useRef(token),[settleTick,setSettleTick]=useState(0);
  useEffect(()=>{
    const settle=event=>{if(event.target?.id==='operator-token'&&(event.type==='focusout'||event.key==='Enter')){settledToken.current=event.target.value;setSettleTick(n=>n+1);}};
    document.addEventListener('focusout',settle);document.addEventListener('keydown',settle);
    return()=>{document.removeEventListener('focusout',settle);document.removeEventListener('keydown',settle);};
  },[]);
  useEffect(()=>{
    if(locked||!pending.current)return;
    if(token!==NATIVE_SESSION&&validatedToken.current!==token&&settledToken.current!==token)return;
    // Not a task: the restore is a read that must not disable the action buttons, or the click that
    // settled the token (Load missions, Create and start) would land on a disabled control and be lost.
    const id=pending.current,signal=credential.current.signal;
    (async()=>{
      try{await select(id,signal);pending.current=null;}
      catch(e){
        if(signal.aborted)return;
        if(isAuthError(e)){setAuthExpired(true);return;}
        pending.current=null;setSlot('results');
        if(!isNotFound(e)){setError(friendlyError(e,token));return;}
        store(null);selected.current=null;setError('The last mission ('+id+') is no longer stored.');
      }
    })();
  },[locked,token,settleTick]);
  // Live mode reads the seats from GET /api/readiness; main.jsx caches the call, so repeats are free.
  // The read is tied to selecting Live, not to the token: a token typed afterwards resets the reading
  // (main.jsx), and until Check seats is pressed the seats count as not read, which blocks the start.
  const checkSeats=()=>Promise.resolve(refreshReadiness?.()).catch(()=>{/* readinessError carries the reason */});
  useEffect(()=>{if(mode==='live'&&!locked)checkSeats();},[mode,locked]);
  // The service refuses a live mission without consent at creation, and refuses one whose seats are blocked
  // or unread; each is stated beside Create and start instead of being sent.
  const consentMissing=mode==='live'&&!egress;
  const liveBlocked=mode==='live'&&(!readiness||stateOf(readiness?.live_mission)==='blocked');
  // The route preview is read once the seats are read and not blocked, and again when the visual-review flag, the
  // readiness reading or a 409 review changes it; every fresh preview needs a fresh approval.
  useEffect(()=>{
    if(mode!=='live'||locked||liveBlocked)return;
    const controller=new AbortController();
    const owner=credential.current,abort=()=>controller.abort();owner.signal.addEventListener('abort',abort,{once:true});
    setPreview(null);setPreviewError('');setApproved(false);
    // An answer without the digest and the grant requests cannot be approved or posted; it is shown as an error line, never rendered as a route.
    read('/missions/preview?vision_review='+(vision?1:0),controller.signal).then(data=>{if(controller.signal.aborted)return;if(typeof data?.route_digest==='string'&&Array.isArray(data.required_grants))setPreview(data);else setPreviewError('The route preview did not include a route digest and its grant requests; the service may be out of date.');})
      .catch(e=>{if(controller.signal.aborted)return;if(isAuthError(e))setAuthExpired(true);else setPreviewError(friendlyError(e,token));});
    return ()=>{controller.abort();owner.signal.removeEventListener('abort',abort);};
  },[mode,locked,liveBlocked,vision,readiness,previewEpoch,read,token]);
  const approvalMissing=mode==='live'&&!liveBlocked&&!(approved&&preview);
  const modeNote=mode==='demo'?'Offline fixture: the model roles are scripted; the numerical fits are computed for real.'
    :liveBlocked&&!readiness?'Live models: the seats have not been read yet. Press Check seats under Execution settings.'
    :liveBlocked?'Live models are blocked. '+(blockingSeats(readiness).map(seatAction).join(' ')||readiness.live_mission.next_action||readiness.live_mission.meaning)+' See Live route under Execution settings.'
    :'Live models: the seats set in Settings (a seat is one model assigned to one role). '+(!egress?'A live mission is refused until you tick the consent box in Execution settings; the goal and data then leave this machine.'
      :approvalMissing?'Tick Approve route under Execution settings, Route and grants: each destination there is granted its data category for this mission.':'This mission\'s goal and data will be sent to them.');
  return <div className="research-workspace guided-research">
    <section className="research-composer" aria-label="Research mission composer">
      <div className="composer-heading"><p className="eyebrow">RESEARCH</p><h1>Start with a question.</h1><p className="muted">Keep alternatives, evidence and uncertainty visible.</p></div>
      <div className="composer-grid">
        <div className="question-field">
          <label htmlFor="goal">Research goal</label><textarea id="goal" rows={4} value={goal} onChange={e=>setGoal(e.target.value)}/>
          <div className="example-row"><Button variant="ghost" size="sm" onPress={()=>setGoal(EXAMPLE_GOAL)}>Use example</Button><span className="field-note">Replaces the draft with a sample question. It does not start a mission.</span></div>
        </div>
        <div className="composer-action-panel">
          <Button isDisabled={busy||locked||!goal.trim()||consentMissing||liveBlocked||approvalMissing} onPress={()=>task(start,'start')}>Create and start</Button>
          {notice('start')}
          {routeConflict&&slot==='start'&&error&&<Button variant="secondary" size="sm" onPress={reviewRoute}>Review the route again</Button>}
          {card?<LockNotice card={card} tone={authExpired?'error':'info'} onUnlock={()=>focusTokenField(token,setToken)} unlockLabel={unlockLabel(token)} compact/>
            :!goal.trim()?<p className="muted">Enter a research goal to enable Create and start.</p>
            :<p className="muted">{modeNote}</p>}
        </div>
      </div>
      <details className="research-options"><summary><span>Execution settings</span><span className="muted"> · {mode==='demo'?'offline fixture (nothing is sent)':'live models · sending data '+(egress?'permitted':'not permitted')+(readiness?' · seats: '+STATE_LABEL[stateOf(readiness.live_mission)]:'')}</span></summary>
        <div className="formrow"><div><label htmlFor="mode">Model source</label><select id="mode" value={mode} onChange={e=>setMode(e.target.value)}><option value="demo">Offline fixture (scripted roles; nothing is sent)</option><option value="live">Live models (seats set in Settings)</option></select></div><div><label htmlFor="rounds">Round limit (1–{MAX_ROUNDS})</label><input id="rounds" type="number" min="1" max={MAX_ROUNDS} value={rounds} onChange={e=>setRounds(e.target.value)} onBlur={()=>setRounds(clampRounds(rounds))}/></div></div>
        {mode==='live'&&<LiveRoute readiness={readiness} error={readinessError} locked={locked} onNavigate={onNavigate} onCheck={checkSeats} token={token}/>}
        {mode==='live'&&<RouteGrants preview={preview} error={previewError} blocked={liveBlocked} locked={locked} approved={approved} onApprove={setApproved} onRetry={reviewRoute}/>}
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
        <div className="actions"><Button isDisabled={busy||locked} onPress={()=>task(async signal=>{setVerification(await (await request('/missions/'+mission.id+'/verify','POST',undefined,signal)).json());await refresh(mission.id,signal);})}>Replay and verify</Button><Button variant="secondary" isDisabled={busy||locked||!mission.release?.eligible_for_human_review} onPress={()=>task(exportCapsule)}>Export replay archive (.zip)</Button><Button variant="ghost" isDisabled={busy||locked||!['ready','paused'].includes(state.status)||(state.status==='ready'&&mission.request?.mode==='live'&&!startBody())} onPress={()=>task(signal=>startMission(mission.id,state.status==='ready'?startBody():undefined,signal))}>{state.status==='paused'?'Resume (recorded as an analysis and claim change)':state.status==='ready'?'Start':'Resume'}</Button><Button variant="secondary" isDisabled={busy||locked||state.status!=='running'} onPress={()=>task(async signal=>{await request('/missions/'+mission.id+'/pause','POST',undefined,signal);await refresh(mission.id,signal);})}>Pause</Button>{state.status==='error'&&<span className="retry"><input type="text" aria-label="Retry reason" placeholder="Reason for the retry" value={retryReason} onChange={e=>setRetryReason(e.target.value)}/><Button variant="secondary" isDisabled={busy||locked||!retryReason.trim()} onPress={()=>task(async signal=>{await request('/missions/'+mission.id+'/changes','POST',{kind:'resume',declared_effects:['analysis','claim'],note:'Retry after error: '+retryReason.trim()},signal);setRetryReason('');accepted(mission.id);await refresh(mission.id,signal);})}>Retry after error</Button></span>}<Button variant="danger" isDisabled={busy||locked||!['ready','running','paused'].includes(state.status)} onPress={()=>task(async signal=>{await request('/missions/'+mission.id+'/cancel','POST',undefined,signal);await refresh(mission.id,signal);})}>Cancel</Button></div>
        {!mission.release?.eligible_for_human_review&&<p className="muted">Export opens when the release decision is Eligible for human review.</p>}
        {state.status==='ready'&&mission.request?.mode==='live'&&!startBody()&&<p className="muted">Start opens once the route is approved under Execution settings, Route and grants (live mode).</p>}
        {state.status==='error'&&<p className="muted">Retry after error continues the mission as a declared analysis and claim change with your reason in its note; on live seats it may call the planner again.</p>}
        {notice('results')}
        {routeConflict&&slot==='results'&&error&&<Button variant="secondary" size="sm" onPress={reviewRoute}>Review the route again</Button>}
        {state.stop_reason&&<p role="status">Stop reason: {state.stop_reason}</p>}
        <Interruption events={state.events}/>
        <MissionRoute state={state} mode={mission.request?.mode} grants={grants}/>
        <Timeline timeline={timeline} error={timelineError}/>
        <ReleaseLedger release={mission.release}/>{verification&&<VerificationReport report={verification}/>}
        <ClaimScopeView scope={state.claim_scope} claims={claims} claimsError={claimsError}/>
        <div className="branches">{state.branches.map(branch=><article key={branch.id} className={'branch'+(state.focus===branch.id?' focus':'')}><h3>{branch.title}</h3><p>{branch.hypothesis}</p><p>Would be refuted by: {branch.falsifier}</p><p className="muted">Opened round {branch.created_round} · parents: {branch.parents.join(', ')||'root'}</p></article>)}</div>
        <h2>Visual artifacts</h2><div className="artifacts">{state.artifacts.length?state.artifacts.map(artifact=><Artifact key={mission.id+artifact.digest} missionId={mission.id} artifact={artifact} request={request} token={token} release={mission.release} superseded={state.artifacts.some(a=>a.repair_of===artifact.digest)}/>):<p className="muted">No visual artifacts in this mission.</p>}</div>
        <h2>Visual review</h2>{state.visual_reports.length?state.visual_reports.map((report,i)=><div className="record" key={i}><h3>{report.model} · round {report.round} · {words(report.verdict)}</h3>{report.findings.map((finding,j)=><p key={j}>{words(finding.category)}: {finding.detail}</p>)}</div>):<p className="muted">No visual review.</p>}
        <RepairCycles repairs={state.repairs||[]}/>
        <Changes changes={state.changes||[]} obligations={mission.change_obligations}/>
        <GrantsLedger ledger={grants} error={grantsError} busy={busy} locked={locked} onRevoke={(id,reason)=>task(async signal=>{await request('/grants/'+id+'/revoke','POST',{reason},signal);await refresh(mission.id,signal);})}/>
        <details className="result-disclosure"><summary>Reconciliation ({state.assessments.length>12?'last 12 of '+state.assessments.length+' assessments':plural(state.assessments.length,'assessment')})</summary>{state.assessments.slice(-12).map((assessment,i)=><div className="record" key={i}><h3>{role(assessment.role)} · {assessment.branch_id} · {words(assessment.position)}</h3><p>{assessment.finding}</p><p className="muted">Evidence: {assessment.evidence_ids.join(', ')} · Model: {assessment.model}</p></div>)}</details>
        <details className="result-disclosure"><summary>Execution evidence</summary>{state.observations.map(observation=><details className="record" key={observation.id}><summary>{observation.id} · {observation.tool} · {words(observation.status)}</summary><pre>{JSON.stringify(observation.data,null,2)}</pre></details>)}</details>
        <details className="result-disclosure"><summary>Event history ({state.events.length>15?'last 15 of '+state.events.length+' events':plural(state.events.length,'event')})</summary>{state.events.slice(-15).reverse().map((event,i)=><p className="muted" key={i}>[{event.round}] {words(event.kind)}: {event.detail}</p>)}</details>
      </>}
      </section>
    </div>
  </div>;
}
