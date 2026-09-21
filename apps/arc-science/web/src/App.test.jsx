import React from 'react';
import {beforeEach, afterEach, expect, test, vi} from 'vitest';
import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {App} from './main.jsx';
import {SESSION_COPY} from './http';

const bioartEntry = {entry_id:18,title:'Antibody',license:'Public Domain',credit:'Courtesy of NIAID',creator:'Ryan Kissinger',collection:'NIAID Visual & Medical Arts',citation:'NIAID BioArt, BIOART-000018',source_url:'https://bioart.niaid.nih.gov/bioart/18',preferred_representation_id:64,representations:[{group_id:63,caption:'Antibody - Colored',files:{PNG:626857,SVG:626858}},{group_id:64,caption:'Antibody - Grey',files:{PNG:626859,SVG:626860,AI:626861,EPS:626862}}]};
const bioartReceipt = {receipt_id:'b'.repeat(64),entry_id:18,title:'Antibody',license:'Public Domain',credit:'Courtesy of NIAID',creator:'Ryan Kissinger',collection:'NIAID Visual & Medical Arts',citation:'NIAID BioArt, BIOART-000018',representation_id:64,caption:'Antibody - Grey',format:'SVG',file_id:626860,source_page_sha256:'c'.repeat(64),sha256:'d'.repeat(64),size:120,preview_eligible:true,import_eligible:true,limitation:null,rights_verified:false,scientific_validity_established:false,preview_url:'/api/bioart/receipts/'+'b'.repeat(64)+'/preview',download_url:'/api/bioart/receipts/'+'b'.repeat(64)+'/source'};
const bioartDownloadReceipt = {...bioartReceipt,receipt_id:'e'.repeat(64),format:'EPS',file_id:626862,preview_eligible:false,import_eligible:false,limitation:'AI/EPS originals are download-only; never executed',preview_url:'/api/bioart/receipts/'+'e'.repeat(64)+'/preview',download_url:'/api/bioart/receipts/'+'e'.repeat(64)+'/source'};
const check=(name,state,reason)=>({name,state,checked_basis_digest:'e'.repeat(64),evidence_digests:[],reason});
const eligibleRelease={policy_digest:'p'.repeat(64),subject_digest:'s'.repeat(64),status:'eligible_for_human_review',eligible_for_human_review:true,blocking_reasons:[],decided_at:1,verification:null,
  checks:[check('operational_status','satisfied','Mission finished as completed.'),check('replay_integrity','satisfied','Capsule verified.'),check('visual_review','not_applicable','Visual review was not requested for this mission.')]};
const blockedRelease={...eligibleRelease,status:'blocked',eligible_for_human_review:false,blocking_reasons:['replay_integrity:unknown'],
  checks:[check('operational_status','satisfied','Mission finished as completed.'),check('replay_integrity','unknown','Replay verification has not been run for this mission.'),check('visual_review','not_applicable','Visual review was not requested for this mission.')]};
const row = {id:'mission-1',release:eligibleRelease,state:{status:'paused',round:1,actions_used:3,model_calls_used:2,data_origin:'fixture',branches:[],assessments:[],observations:[],events:[],visual_reports:[],artifacts:[],stop_reason:'Review needed'}};
const readinessNode=(state,meaning,next_action=null)=>({state,meaning,next_action});
const readiness={checked_at:1700000000,session:{kind:'native',state:'ready',code:'session.native',label:'Desktop session',meaning:'The desktop shell signed this request.',next_action:null,source:'request header'},
  settings:{...readinessNode('ready','Settings can be read and saved.'),code:'settings.available',revision:'abcdef1234567890',path:'C:/data/settings.json',read_only:false,source:'supervisor'},
  roles:[{role:'planner',label:'Planner',purpose:'proposes branches and actions'},{role:'reviewer',label:'Reviewer (QA)',purpose:'assesses'},{role:'falsifier',label:'Falsifier',purpose:'assesses with the brief to refute'},{role:'vision',label:'Vision',purpose:'reviews images'},{role:'prose',label:'Prose',purpose:'edits text'}],
  seats:{planner:{role:'planner',label:'Planner',...readinessNode('not_tested','Configured, never probed.','Probe the planner seat in Settings.'),code:'seat.not_tested',facts:{provider:'anthropic',model:'claude-sonnet-5'},verification:{status:'not_tested'},source:'settings revision abcdef123456'}},
  live_mission:{...readinessNode('not_tested','The planner seat has not been probed.','Probe the planner seat in Settings.'),code:'live.not_tested',blocking:[]},
  connectors:{mcp:[],acp:[],mcp_sdk:null,acp_protocol:'1'},
  renderer:{...readinessNode('blocked','No renderer is configured.','Set the Blender path in Settings.'),code:'renderer.not_configured',facts:{configured:false,exists:null,default_preset:null},source:'settings'},
  memory:{...readinessNode('ready','The memory engine answers.'),code:'memory.available',facts:{protocol:'arc-memory/1',sqlite:'3.53.2'}},
  storage:{...readinessNode('not_tested','The missions database is present.','Integrity is checked on demand: select Read diagnostics under Diagnostics.'),code:'storage.present',facts:{missions_db:true,missions:1}},
  catalog:{},public_reads:{enabled:false}};
// GET /api/missions/preview for the seat above: the route a live mission would use and the grants its first start must carry.
const routePreview={settings_revision:'abcdef1234567890',route_digest:'r'.repeat(64),seats:[{role:'planner',provider:'anthropic',transport:'api',model:'claude-sonnet-5',effort:'medium',destination:'https://api.anthropic.com',destination_kind:'seat',data_category:'mission goal, dataset points, prior observations and assessments',purpose:'planning, review and refutation'}],connectors:[],public_reads:[],
  required_grants:[{destination:'https://api.anthropic.com',destination_kind:'seat',data_category:'mission goal, dataset points, prior observations and assessments',purpose:'planning, review and refutation',scope:'mission'}]};
let requests, downloadClick, selectedRow;
const json = (data,init={}) => new Response(JSON.stringify(data),{...init,headers:{'Content-Type':'application/json',...(init.headers||{})}});

// The browser keeps the selected mission's id only (reopen); the token never reaches any storage.
const onlyMissionStored=()=>{expect(Object.keys(localStorage)).toEqual(['arc.research.mission']);expect(localStorage.getItem('arc.research.mission')).toBe('mission-1');expect(Object.values(localStorage).some(v=>/private|operator|token/.test(v))).toBe(false);expect(sessionStorage.length).toBe(0);};
beforeEach(()=>{
  requests=[]; selectedRow=structuredClone(row); localStorage.clear();
  vi.stubGlobal('fetch',vi.fn(async(path,options={})=>{
    requests.push({path,options});
    if(path==='/api/session/status')return json({detail:'Authentication required'},{status:401});
    if(path==='/api/readiness'||path==='/api/readiness?fresh=1')return json(readiness);
    if(path==='/api/bioart/search')return json({hits:[{entry_id:18,title:'Antibody'}]});
    if(path==='/api/bioart/inspect')return json(bioartEntry);
    if(path==='/api/bioart/fetch')return json(JSON.parse(options.body).format==='EPS'?bioartDownloadReceipt:bioartReceipt);
    if(path===bioartReceipt.preview_url)return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"></svg>',{headers:{'Content-Type':'image/svg+xml'}});
    if(path===bioartReceipt.download_url)return new Response('verified source',{headers:{'Content-Type':'image/svg+xml'}});
    if(path===bioartDownloadReceipt.download_url)return new Response('verified source',{headers:{'Content-Type':'application/postscript'}});
    if(path==='/api/bioart/import')return json({asset_id:'nih-bioart-antibody',asset_manifest:'assets/nih-bioart-antibody/asset.json'});
    if(path==='/api/missions')return json(options.method==='POST'?selectedRow:[{id:'mission-1',status:'paused',goal:'Saved experiment'}]);
    if(path.startsWith('/api/missions/preview'))return json(routePreview);
    if(path.endsWith('/grants'))return json({grants:[],receipts:[]});
    if(path.endsWith('/timeline'))return json({mission_id:'mission-1',kind:'operational',recorded:false,count:0,rows:[],note:'Operational record written by the service worker and operator routes; not scientific evidence.'});
    if(path.endsWith('/claims'))return json({mission_id:'mission-1',source:'derived',derivation_version:null,current_derivation_version:'arc-claim-scope-3',basis_round:null,rule:null,evidence_graph:'valid',uncertainty_note:'MSE values are errors on the exploratory validation split of the frozen dataset; no confidence interval or standard error is computed in this build.',note:'Claim cards are derived on read from the persisted claim scope, the recorded reconciliation, the evidence graph and the operational timeline; nothing here is validation.',claims:[]});
    if(path.endsWith('/verify'))return json({reproduction_passed:true});
    if(path.endsWith('/capsule'))return new Response('capsule');
    if(path.includes('/artifacts/'))return new Response('authenticated image',{headers:{'Content-Type':'image/png'}});
    if(path.endsWith('/cancel'))selectedRow.state.status='cancelled';
    if(path==='/api/memory/health')return json({protocol:'arc-memory/1',sqlite:'3.53.2'});
    if(path.startsWith('/api/memory/sessions/'))return json([{record_id:'r2',project_id:'arc-science',session_id:'mission-1',agent_id:'analyst',seq:2,role:'analyst',text:'{"assessments":[{"position":"challenge"}]}',content_digest:'f'.repeat(64),source_uri:'mission://mission-1/round/0/analyst/1',trust:'model_output',visibility:'visible',retention:'active',compaction_epoch:0,wall_time_ms:1}]);
    if(path.startsWith('/api/memory/sessions'))return json([{session_id:'mission-1',record_count:18,first_seq:1,last_seq:18,min_epoch:0,max_epoch:2}]);
    if(path==='/api/memory/search')return json([{record:{record_id:'r9',role:'planner',text:'quadratic term hypothesis',session_id:'mission-1',compaction_epoch:1,content_digest:'a'.repeat(64),trust:'model_output'},score:1.2,reason:'hybrid'}]);
    return json(selectedRow);
  }));
  URL.createObjectURL=vi.fn(()=> 'blob:artifact'); URL.revokeObjectURL=vi.fn();
  downloadClick=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(){requests.push({download:this.download,href:this.href});});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();window.history.replaceState(null,'','/');});




test('workspace switches retain in-memory token, goal and selected mission',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.type(screen.getByLabelText('Operator token'),'secret-token');
  await user.clear(screen.getByLabelText('Research goal'));await user.type(screen.getByLabelText('Research goal'),'Retained research question');
  await user.click(screen.getByRole('button',{name:'Load missions'}));
  await user.click(await screen.findByRole('button',{name:'paused · Saved experiment'}));
  expect(await screen.findByText('Selected mission: mission-1')).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Molecules'}));
  await user.click(screen.getByRole('button',{name:'Research'}));
  expect(screen.getByLabelText('Operator token')).toHaveValue('secret-token');
  expect(screen.getByLabelText('Research goal')).toHaveValue('Retained research question');
  expect(screen.getByText('Selected mission: mission-1')).toBeVisible();
  onlyMissionStored();
});

test('mission creation sends actual egress and visual-review consent and execution settings',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.type(screen.getByLabelText('Operator token'),'operator');
  await user.type(screen.getByLabelText('Research goal'),'Live nonlinear response check');
  await user.selectOptions(screen.getByLabelText('Model source'),'live');
  await user.click(screen.getByLabelText(/Permit sending/));await user.click(screen.getByLabelText(/Require configured visual review/));
  // The route is previewed for the visual-review flag as set; the start is refused until that route is approved.
  await waitFor(()=>expect(requests.some(r=>r.path==='/api/missions/preview?vision_review=1')).toBe(true));
  expect(screen.getByRole('button',{name:'Create and start'})).toBeDisabled();
  await user.click(await screen.findByLabelText('Approve route'));
  await user.click(screen.getByRole('button',{name:'Create and start'}));
  await waitFor(()=>expect(requests.some(r=>r.path==='/api/missions/mission-1/start')).toBe(true));
  const sent=requests.find(r=>r.path==='/api/missions'&&r.options.method==='POST');
  expect(JSON.parse(sent.options.body)).toMatchObject({mode:'live',max_rounds:5,allow_egress:true,vision_review:true});
  expect(sent.options.headers.Authorization).toBe('Bearer operator');
  const started=requests.find(r=>r.path==='/api/missions/mission-1/start');
  expect(JSON.parse(started.options.body)).toEqual({approved_route_digest:routePreview.route_digest,grants:routePreview.required_grants});
});

test('selected mission exposes authenticated artifacts, visual reports, verify, capsule, resume and cancel',async()=>{
  selectedRow.state.artifacts=[{digest:'d'.repeat(64),source_observation_id:'obs-1',media_type:'image/png'}];
  selectedRow.state.visual_reports=[{model:'configured-reviewer',round:1,verdict:'revise',findings:[{category:'legibility',detail:'Inspect labels'}]}];
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Research'}));
  await user.type(screen.getByLabelText('Operator token'),'private');
  await user.click(screen.getByRole('button',{name:'Load missions'}));await user.click(await screen.findByRole('button',{name:'paused · Saved experiment'}));
  expect(await screen.findByRole('img',{name:'Artifact from obs-1'})).toHaveAttribute('src','blob:artifact');
  expect(requests.find(r=>r.path?.includes('/artifacts/')).options.headers.Authorization).toBe('Bearer private');
  expect(screen.getByText('legibility: Inspect labels')).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Replay and verify'}));
  expect(await screen.findByText(/"reproduction_passed": true/)).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Export replay archive (.zip)'}));
  await waitFor(()=>expect(requests.some(r=>r.download==='arc-mission-1.zip')).toBe(true));
  await user.click(screen.getByRole('button',{name:'Resume (recorded as an analysis and claim change)'}));await user.click(screen.getByRole('button',{name:'Cancel'}));
  await waitFor(()=>expect(requests.some(r=>r.path==='/api/missions/mission-1/cancel')).toBe(true));
  expect(screen.getByRole('button',{name:/^Resume/})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Cancel'})).toBeDisabled();
});

test('a blocked release ledger explains itself and withholds the capsule until verification',async()=>{
  selectedRow.release=blockedRelease;
  selectedRow.state.artifacts=[{digest:'d'.repeat(64),source_observation_id:'obs-1',media_type:'image/png'}];
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Research'}));
  await user.type(screen.getByLabelText('Operator token'),'private');
  await user.click(screen.getByRole('button',{name:'Load missions'}));await user.click(await screen.findByRole('button',{name:'paused · Saved experiment'}));
  const ledger=await screen.findByRole('region',{name:'Release decision'});
  expect(ledger).toHaveTextContent('Release decision: Blocked');
  expect(ledger).toHaveTextContent('replay integrity · unverified — Replay verification has not been run for this mission.');
  expect(ledger).toHaveTextContent('Blocked by: replay integrity:unknown.');
  expect(ledger).toHaveTextContent('not validated');
  expect(screen.getByRole('button',{name:'Export replay archive (.zip)'})).toBeDisabled();
  // Inline inspection stays; the explicit file download consults the same ledger.
  expect(await screen.findByRole('img',{name:'Artifact from obs-1'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Download PNG'})).toBeNull();
  expect(screen.getByText(/Download opens when the release decision is Eligible for human review/)).toBeInTheDocument();
  // Verification refreshes the mission; the service's new decision opens the export.
  fetch.mockImplementation(async(path,options={})=>{requests.push({path,options});if(path.endsWith('/verify'))return json({reproduction_passed:true,release:eligibleRelease});return json({...selectedRow,release:eligibleRelease});});
  await user.click(screen.getByRole('button',{name:'Replay and verify'}));
  await waitFor(()=>expect(screen.getByRole('region',{name:'Release decision'})).toHaveTextContent('Eligible for human review'));
  expect(screen.getByRole('button',{name:'Export replay archive (.zip)'})).toBeEnabled();
  expect(requests.find(r=>r.path?.endsWith('/verify')).options.method).toBe('POST');
  expect(await screen.findByRole('button',{name:'Download PNG'})).toBeInTheDocument();
});

test('repair cycles are listed with their own outcomes and superseded artifacts say so',async()=>{
  const first='a'.repeat(64),second='b'.repeat(64);
  selectedRow.state.artifacts=[{digest:first,source_observation_id:'obs-1',media_type:'image/png',preset:'default',repair_of:null},{digest:second,source_observation_id:'obs-1',media_type:'image/png',preset:'spacious',repair_of:first}];
  selectedRow.state.repairs=[{cycle:1,round:0,policy_digest:'e'.repeat(64),preset:'spacious',trigger_report_digest:'c'.repeat(64),addressed:['legibility'],superseded_digests:[first],artifact_digests:[second],outcome:'adequate',reason:''},
    {cycle:2,round:0,policy_digest:'e'.repeat(64),preset:'large_text',trigger_report_digest:'d'.repeat(64),addressed:['labels'],superseded_digests:[second],artifact_digests:[],outcome:'blocked',reason:'The large_text preset rendered an image that already exists; the repair changed nothing.'}];
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Research'}));
  await user.type(screen.getByLabelText('Operator token'),'private');
  await user.click(screen.getByRole('button',{name:'Load missions'}));await user.click(await screen.findByRole('button',{name:'paused · Saved experiment'}));
  const repairs=await screen.findByRole('region',{name:'Figure repair cycles'});
  const items=within(repairs).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('Cycle 1 · round 0 · render preset spacious · addressed legibility · review verdict: adequate');
  expect(items[1]).toHaveAttribute('data-outcome','blocked');
  expect(items[1]).toHaveTextContent('the repair changed nothing');
  const captions=screen.getAllByText(/render preset (default|spacious)/);
  expect(captions[0]).toHaveTextContent('superseded by a repair');
  expect(captions[1]).toHaveTextContent('repair of aaaaaaaaaaaa…');
  expect(captions[1]).not.toHaveTextContent('superseded');
});

test('the claim scope shows each hypothesis narrowed to its evidence, its uncertainty and its next test',async()=>{
  selectedRow.state.status='completed';
  selectedRow.state.claim_scope={derivation_version:'arc-claim-scope-1',basis_round:2,counts:{provisionally_supported:1,contradicted:1,unresolved:0,unassessed:0},
    rule:'A narrower conclusion is a valid research output. Nothing above is scientific validation.',
    branches:[{branch_id:'linear',requested:'A linear curve adequately describes the fixture.',status:'contradicted',supported_scope:[],scope_qualifier:'',
      uncertainties:[{reason:'challenged',role:'falsifier',detail:'The linear fit leaves substantial residual error.',evidence_ids:['fit-linear']}],next_tests:[{role:'falsifier',round:0,test:'Compare a nonlinear alternative.',evidence_ids:['fit-linear']}],evidence_ids:['fit-linear']},
     {branch_id:'quadratic',requested:'The response requires a quadratic term.',status:'provisionally_supported',supported_scope:['analyst: Low error on the exploratory split.','falsifier: Low error on the exploratory split. Adaptive reuse prevents confirmatory interpretation.'],scope_qualifier:'on the exploratory validation split of the frozen dataset; not independent data',
      uncertainties:[],next_tests:[{role:'analyst',round:1,test:'Use independently acquired data before a scientific conclusion.',evidence_ids:['fit-quadratic']}],evidence_ids:['fit-quadratic']}]};
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Research'}));
  await user.type(screen.getByLabelText('Operator token'),'private');
  await user.click(screen.getByRole('button',{name:'Load missions'}));await user.click(await screen.findByRole('button',{name:'paused · Saved experiment'}));
  const scope=await screen.findByRole('region',{name:'Claim scope'});
  expect(scope).toHaveTextContent('provisional support is exploratory, never validation');
  const claims=within(scope).getAllByRole('article');
  expect(claims).toHaveLength(2);
  expect(claims[0]).toHaveAttribute('data-status','contradicted');
  expect(claims[0]).toHaveTextContent(/Requested claim\s*A linear curve adequately describes the fixture\./);
  expect(claims[0]).toHaveTextContent('No supported scope; the requested claim stands only as a hypothesis.');
  expect(claims[0]).toHaveTextContent('challenged (falsifier): The linear fit leaves substantial residual error.');
  expect(claims[0]).toHaveTextContent(/Next discriminating test\s*falsifier: Compare a nonlinear alternative\./);
  expect(claims[1]).toHaveTextContent('quadratic · Provisionally supported');
  expect(claims[1]).toHaveTextContent('Scope: on the exploratory validation split of the frozen dataset; not independent data.');
  expect(claims[1]).toHaveTextContent('None recorded by either role; provisional support still needs independent data.');
});

test('declared changes list what was declared, what was derived and each obligation as the ledger reads it',async()=>{
  selectedRow.state.changes=[{id:'c'.repeat(32),kind:'resume',declared_effects:['analysis','claim'],derived_effects:['analysis','claim'],required_checks:['re_execution','dependent_claim_invalidation','evidence_review','scope_review'],base_digest:'e'.repeat(64),note:'Second round.',round:1,at:1}];
  selectedRow.change_obligations={['c'.repeat(32)]:[{check:'re_execution',state:'satisfied',sources:['operational_status']},{check:'dependent_claim_invalidation',state:'stale',sources:['claim_scope']},{check:'evidence_review',state:'stale',sources:['evidence_graph','reconciliation']},{check:'scope_review',state:'stale',sources:['claim_scope']}]};
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Research'}));
  await user.type(screen.getByLabelText('Operator token'),'private');
  await user.click(screen.getByRole('button',{name:'Load missions'}));await user.click(await screen.findByRole('button',{name:'paused · Saved experiment'}));
  const changes=await screen.findByRole('region',{name:'Declared changes'});
  const item=within(changes).getByRole('listitem');
  expect(item).toHaveTextContent(/resume, round 1\s*Declared effect: analysis, claim · Derived effect: analysis, claim\s*Required checks: re execution satisfied · dependent claim invalidation stale · evidence review stale · scope review stale\s*Second round\./);
  expect(item.querySelectorAll('.check-stale')).toHaveLength(3);
});

test('a finished mission keeps its outcome: Cancel is disabled, Verify and export stay available',async()=>{
  selectedRow.state.status='completed';selectedRow.state.stop_reason='Exploration completed within budget.';
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Research'}));
  await user.type(screen.getByLabelText('Operator token'),'private');
  await user.click(screen.getByRole('button',{name:'Load missions'}));await user.click(await screen.findByRole('button',{name:'paused · Saved experiment'}));
  expect(await screen.findByText('completed')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Cancel'})).toBeDisabled();
  expect(screen.getByRole('button',{name:/^Resume/})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Replay and verify'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'Export replay archive (.zip)'})).toBeEnabled();
  expect(requests.some(r=>r.path==='/api/missions/mission-1/cancel')).toBe(false);
});

test('a stored mission id is reopened once the operator token is entered, without Load missions',async()=>{
  localStorage.setItem('arc.research.mission','mission-1');
  // Nothing is requested while the token is typed; the restore happens once the field settles (Tab), with the whole token.
  const normalFetch=fetch.getMockImplementation();
  fetch.mockImplementation((path,options={})=>String(path).startsWith('/api/missions')&&options.headers?.Authorization!=='Bearer private'
    ? (requests.push({path,options}),Promise.resolve(json({detail:'bad token'},{status:401}))) : normalFetch(path,options));
  const user=userEvent.setup();render(<App/>);
  expect(screen.getByText('No mission selected.')).toBeVisible();
  expect(requests.some(r=>String(r.path).startsWith('/api/missions'))).toBe(false);
  await user.type(screen.getByLabelText('Operator token'),'private');
  await new Promise(resolve=>setTimeout(resolve,50));
  expect(requests.some(r=>String(r.path).startsWith('/api/missions'))).toBe(false);
  expect(screen.queryByText(SESSION_COPY.expired.title)).not.toBeInTheDocument();
  await user.tab();
  expect(await screen.findByText('Selected mission: mission-1')).toBeVisible();
  expect(requests.some(r=>r.path==='/api/missions')).toBe(false);
  expect(requests.filter(r=>r.path==='/api/missions/mission-1').at(-1).options.headers.Authorization).toBe('Bearer private');
  expect(screen.queryByText(SESSION_COPY.expired.title)).not.toBeInTheDocument();
  expect(requests.every(r=>!String(r.path).includes('private'))).toBe(true);
  expect(screen.getByRole('region',{name:'Timeline'})).toHaveTextContent('No timeline was recorded for this mission');
  onlyMissionStored();
});

test('cold launch opens Research with a blank question and an explicit example opt-in',async()=>{
  render(<App/>);
  expect(await screen.findByRole('heading',{name:'Start with a question.'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Research'})).toHaveAttribute('aria-pressed','true');
  expect(within(screen.getByRole('navigation',{name:'Workspaces'})).getAllByRole('button').map(button=>button.textContent)).toEqual(['Research','Memory','Molecules','BioArt','Prose','Settings','Diagnostics']);
  expect(screen.getByLabelText('Research goal')).toHaveValue('');
  expect(screen.getByRole('button',{name:'Create and start'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Load missions'})).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent(SESSION_COPY.locked.title);
  await userEvent.setup().click(screen.getByRole('button',{name:'Use example'}));
  expect(screen.getByLabelText('Research goal')).toHaveValue('Compare competing explanations of the nonlinear response and challenge the preferred fit.');
  expect(requests.some(r=>String(r.path).includes('/api/missions'))).toBe(false);
  expect(requests.some(r=>String(r.path).includes('/api/examples'))).toBe(false);
});

test('Diagnostics stays in the shared shell and browser history restores the workspace',async()=>{
  window.history.replaceState(null,'','/');
  const user=userEvent.setup();render(<App/>);
  await user.type(screen.getByLabelText('Operator token'),'temporary-operator');
  await user.click(screen.getByRole('button',{name:'Diagnostics'}));
  expect(window.location.pathname).toBe('/diagnostics');
  expect(screen.getByRole('region',{name:'Diagnostics'})).toBeVisible();
  expect(screen.getByLabelText('Operator token')).toHaveValue('temporary-operator');
  expect(screen.queryByText('0.6.0 development')).not.toBeInTheDocument();
  await user.click(within(screen.getByRole('navigation',{name:'Workspaces'})).getByRole('button',{name:'Research'}));
  expect(window.location.pathname).toBe('/');
  window.history.back();
  await waitFor(()=>expect(screen.getByRole('region',{name:'Diagnostics'})).toBeVisible());
  expect(screen.getByLabelText('Operator token')).toHaveValue('temporary-operator');
  window.history.replaceState(null,'','/');
});

test('an owned native session unlocks without a page bearer and has a manual fallback',async()=>{
  const normalFetch=fetch.getMockImplementation();
  fetch.mockImplementation((path,options)=>path==='/api/session/status'
    ? Promise.resolve(json({status:'authorized'})) : normalFetch(path,options));
  const user=userEvent.setup();render(<App/>);
  expect(await screen.findByText('Desktop session ready')).toBeInTheDocument();
  expect(screen.queryByLabelText('Operator token')).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Research goal'),'A local native-session question');
  await user.click(screen.getByRole('button',{name:'Create and start'}));
  await waitFor(()=>expect(requests.some(r=>r.path==='/api/missions'&&r.options.method==='POST')).toBe(true));
  expect(requests.find(r=>r.path==='/api/missions'&&r.options.method==='POST').options.headers.Authorization).toBeUndefined();
  // The shell reads readiness on its own for a desktop session, once, with the native header auth only.
  await waitFor(()=>expect(requests.filter(r=>r.path==='/api/readiness')).toHaveLength(1));
  expect(requests.find(r=>r.path==='/api/readiness').options.headers.Authorization).toBeUndefined();
  await user.click(screen.getByRole('button',{name:'Diagnostics'}));
  const session=screen.getByRole('heading',{name:'Session',level:3}).closest('article');
  expect(session).toHaveAttribute('data-state','ready');
  expect(session).toHaveTextContent('Desktop session');
  expect(session).toHaveTextContent('The desktop shell signed this request.');
  expect(screen.getByRole('heading',{name:'Seats',level:3}).closest('article')).toHaveTextContent('Next: Probe the planner seat in Settings.');
  expect(screen.getByRole('region',{name:'Diagnostics'}).textContent).not.toMatch(/paste/i);
  // Switching to a manual token drops the desktop answer; nothing is read until a workspace asks.
  await user.click(screen.getByRole('button',{name:'Use operator token'}));
  expect(screen.getByLabelText('Operator token')).toHaveValue('');
  expect(screen.getByLabelText('Operator token')).toHaveAttribute('placeholder','Operator token');
  expect(session).toHaveAttribute('data-state','blocked');
  // The Research data field still says "Paste a JSON list"; only token copy is banned.
  expect(document.body.textContent).not.toMatch(/paste[^.]*token|paste to unlock/i);
  expect(requests.filter(r=>r.path==='/api/readiness')).toHaveLength(1);
  await user.click(screen.getByRole('button',{name:'Research'}));
  expect(screen.getByLabelText('Research goal')).toHaveValue('A local native-session question');
});

test('a manual token reads readiness only when a workspace asks, with the bearer header and one shared request',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.type(screen.getByLabelText('Operator token'),'operator');
  expect(requests.some(r=>r.path==='/api/readiness')).toBe(false);
  await user.click(screen.getByRole('button',{name:'Diagnostics'}));
  expect(requests.some(r=>r.path==='/api/readiness')).toBe(false);
  await user.click(screen.getByRole('button',{name:'Refresh readiness'}));
  await waitFor(()=>expect(screen.getByRole('heading',{name:'Session',level:3}).closest('article')).toHaveAttribute('data-state','ready'));
  const read=requests.filter(r=>r.path==='/api/readiness');
  expect(read).toHaveLength(1);
  expect(read[0].options.headers.Authorization).toBe('Bearer operator');
  expect(read[0].options.signal).toEqual(expect.any(AbortSignal));
  expect(screen.getByText('arc-memory/1 · SQLite 3.53.2')).toBeInTheDocument();
  expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);
});

test('re-reading logins is the same readiness read with fresh=1 in the query, and a cached read in flight joins it',async()=>{
  const normalFetch=fetch.getMockImplementation();
  let answer;
  fetch.mockImplementation((path,options)=>path==='/api/readiness?fresh=1'
    ? (requests.push({path,options}),new Promise(resolve=>{answer=()=>resolve(json(readiness));})) : normalFetch(path,options));
  const user=userEvent.setup();render(<App/>);
  await user.type(screen.getByLabelText('Operator token'),'operator');
  await user.click(screen.getByRole('button',{name:'Diagnostics'}));
  await user.click(screen.getByRole('button',{name:'Refresh readiness (re-read logins)'}));
  const read=()=>requests.filter(r=>r.path.startsWith('/api/readiness'));
  await waitFor(()=>expect(read().map(r=>r.path)).toEqual(['/api/readiness?fresh=1']));
  expect(read()[0].options.headers.Authorization).toBe('Bearer operator');
  expect(read()[0].options.method).toBeUndefined();
  // Research asks for a cached read while the fresh one is still out: it shares that fetch.
  await user.click(screen.getByRole('button',{name:'Research'}));
  await user.selectOptions(screen.getByLabelText('Model source'),'live');
  expect(read().map(r=>r.path)).toEqual(['/api/readiness?fresh=1']);
  await act(async()=>{answer();});
  await user.click(screen.getByRole('button',{name:'Diagnostics'}));
  await waitFor(()=>expect(screen.getByRole('heading',{name:'Session',level:3}).closest('article')).toHaveAttribute('data-state','ready'));
  expect(screen.getByRole('heading',{name:'Seats',level:3}).closest('article')).toHaveTextContent('Never probed');
  // A cached read after the fresh one settled is its own request.
  await user.click(screen.getByRole('button',{name:'Refresh readiness'}));
  await waitFor(()=>expect(read().map(r=>r.path)).toEqual(['/api/readiness?fresh=1','/api/readiness']));
  expect(read()[0].options.signal.aborted).toBe(false);
});

test('empty saved missions have an actionable state',async()=>{
  fetch.mockImplementation(async()=>json([]));
  const user=userEvent.setup();render(<App/>);
  await user.type(screen.getByLabelText('Operator token'),'operator');
  await user.click(screen.getByRole('button',{name:'Load missions'}));
  expect(await screen.findByText('No saved missions. Create a mission to begin.')).toBeInTheDocument();
});

test('failed authenticated artifact stops loading and retries without losing Research state',async()=>{
  selectedRow.state.artifacts=[{digest:'d'.repeat(64),source_observation_id:'obs-1',media_type:'image/png'}];
  const normalFetch=fetch.getMockImplementation();let unavailable=true;
  fetch.mockImplementation(async(path,options)=>{
    if(path.includes('/artifacts/')&&unavailable){requests.push({path,options});return new Response('unavailable',{status:503});}
    return normalFetch(path,options);
  });
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Research'}));
  await user.type(screen.getByLabelText('Operator token'),'private');
  await user.click(screen.getByRole('button',{name:'Load missions'}));
  await user.click(await screen.findByRole('button',{name:'paused · Saved experiment'}));
  expect(await screen.findByText(/Artifact could not be loaded:/)).toHaveTextContent('503');
  expect(screen.queryByText('Loading image…')).not.toBeInTheDocument();
  expect(screen.queryByRole('img',{name:'Artifact from obs-1'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Molecules'}));await user.click(screen.getByRole('button',{name:'Research'}));
  expect(screen.getByLabelText('Operator token')).toHaveValue('private');
  expect(screen.getByText('Selected mission: mission-1')).toBeVisible();
  unavailable=false;
  await user.click(screen.getByRole('button',{name:'Retry artifact'}));
  expect(await screen.findByRole('img',{name:'Artifact from obs-1'})).toHaveAttribute('src','blob:artifact');
  expect(screen.queryByText(/Artifact could not be loaded:/)).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  const calls=requests.filter(r=>r.path?.includes('/artifacts/'));
  expect(calls).toHaveLength(2);
  expect(calls.every(r=>r.options.headers.Authorization==='Bearer private')).toBe(true);
  onlyMissionStored();
});


test('BioArt search is authenticated, cache-first, and shares the in-memory operator token',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:'Research'}));
  await user.type(screen.getByLabelText('Operator token'),'shared-operator');
  await user.click(screen.getByRole('button',{name:'BioArt'}));
  expect(screen.getByLabelText('Operator token')).toHaveValue('shared-operator');
  await user.clear(screen.getByLabelText('BioArt search query'));
  await user.type(screen.getByLabelText('BioArt search query'),'antibody');
  await user.click(screen.getByRole('button',{name:'Search BioArt'}));
  expect(await screen.findByRole('button',{name:'Antibody · BIOART-000018'})).toBeInTheDocument();
  const sent=requests.find(r=>r.path==='/api/bioart/search');
  expect(sent.options.headers.Authorization).toBe('Bearer shared-operator');
  expect(JSON.parse(sent.options.body)).toEqual({query:'antibody',allow_egress:false});
  expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);
});

test('BioArt freezes request controls while their submitted state is in flight',async()=>{
  const normalFetch=fetch.getMockImplementation();let finish;
  fetch.mockImplementation((path,options)=>{
    if(path==='/api/bioart/search')return new Promise(resolve=>{finish=()=>resolve(json({hits:[]}));});
    return normalFetch(path,options);
  });
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:'BioArt'}));
  const token=screen.getByLabelText('Operator token');
  const query=screen.getByLabelText('BioArt search query');
  const consent=screen.getByLabelText('Permit NIH network access for the next search or inspection');
  await user.type(token,'operator');await user.click(consent);
  await user.click(screen.getByRole('button',{name:'Search BioArt'}));
  expect(await screen.findByRole('status')).toHaveTextContent('request in progress');
  // The shared header token stays editable; the request's own controls freeze.
  expect(query).toBeDisabled();expect(consent).toBeDisabled();
  finish();
  await waitFor(()=>expect(screen.queryByRole('status')).not.toBeInTheDocument());
});

test('BioArt inspects, fetches the automatic neutral SVG, verifies a protected preview, and imports it',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:'BioArt'}));
  await user.type(screen.getByLabelText('Operator token'),'bioart-operator');
  const metadataConsent=screen.getByLabelText('Permit NIH network access for the next search or inspection');
  await user.click(metadataConsent);
  await user.click(screen.getByRole('button',{name:'Search BioArt'}));
  expect(metadataConsent).not.toBeChecked();
  await user.click(metadataConsent);
  await user.click(await screen.findByRole('button',{name:'Antibody · BIOART-000018'}));
  expect(metadataConsent).not.toBeChecked();
  expect(await screen.findByText('Courtesy of NIAID')).toBeInTheDocument();
  expect(screen.getByText('License per NIH: Public Domain')).toBeInTheDocument();
  expect(screen.getByLabelText('Variant')).toHaveValue('auto');
  const fetchConsent=screen.getByLabelText('Permit NIH network access for this fetch');
  await user.click(fetchConsent);
  expect(metadataConsent).not.toBeChecked();
  await user.click(screen.getByRole('button',{name:'Fetch and verify SVG'}));
  expect(fetchConsent).not.toBeChecked();
  expect(await screen.findByRole('img',{name:'Verified BioArt preview: Antibody'})).toHaveAttribute('src','blob:artifact');
  const fetchRequest=requests.find(r=>r.path==='/api/bioart/fetch');
  expect(JSON.parse(fetchRequest.options.body)).toEqual({entry_id:18,format:'SVG',allow_egress:true});
  const previewRequest=requests.find(r=>r.path===bioartReceipt.preview_url);
  expect(previewRequest.options.headers.Authorization).toBe('Bearer bioart-operator');
  expect(screen.getByText('File fetched and verified')).toBeInTheDocument();
  expect(screen.getByText('Verified SVG · variant 64')).toBeInTheDocument();
  expect(screen.getByText(/Rights metadata has not been independently verified/)).toBeInTheDocument();
  expect(screen.getByText(/Scientific validity is not established/)).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Download verified file'}));
  await waitFor(()=>expect(requests).toContainEqual(expect.objectContaining({download:'bioart-18.svg',href:'blob:artifact'})));
  await user.click(screen.getByRole('button',{name:'Import verified SVG'}));
  expect(await screen.findByText('Imported asset nih-bioart-antibody')).toBeInTheDocument();
  expect(screen.getByText('assets/nih-bioart-antibody/asset.json')).toBeInTheDocument();
});

test('BioArt manual representation override is explicit and fetch errors preserve the inspected entry',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:'BioArt'}));
  await user.type(screen.getByLabelText('Operator token'),'operator');
  await user.click(screen.getByRole('button',{name:'Search BioArt'}));
  await user.click(await screen.findByRole('button',{name:'Antibody · BIOART-000018'}));
  await user.selectOptions(screen.getByLabelText('Variant'),'63');
  await user.click(screen.getByRole('button',{name:'Fetch and verify SVG'}));
  await screen.findByRole('img',{name:'Verified BioArt preview: Antibody'});
  const sent=requests.findLast(r=>r.path==='/api/bioart/fetch');
  expect(JSON.parse(sent.options.body)).toEqual({entry_id:18,representation_id:63,format:'SVG',allow_egress:false});

  fetch.mockImplementationOnce(async()=>json({detail:'Unknown or restricted license requires operator review; fetch/import blocked'},{status:409}));
  await user.click(screen.getByRole('button',{name:'Fetch and verify SVG'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('restricted license');
  expect(screen.getByText('Courtesy of NIAID')).toBeInTheDocument();
});

test('BioArt exposes original vector formats without previewing or importing download-only EPS',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:'BioArt'}));
  await user.type(screen.getByLabelText('Operator token'),'operator');
  await user.click(screen.getByRole('button',{name:'Search BioArt'}));
  await user.click(await screen.findByRole('button',{name:'Antibody · BIOART-000018'}));
  expect(screen.getAllByRole('option').map(option=>option.value)).toEqual(expect.arrayContaining(['SVG','PNG','AI','EPS']));
  await user.selectOptions(screen.getByLabelText('Format'),'EPS');
  await user.click(screen.getByRole('button',{name:'Fetch and verify EPS'}));
  expect(await screen.findByText(/download-only; no browser preview/)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'EPS import unavailable'})).toBeDisabled();
  const sent=requests.findLast(request=>request.path==='/api/bioart/fetch');
  expect(JSON.parse(sent.options.body)).toEqual({entry_id:18,format:'EPS',allow_egress:false});
  expect(requests.some(request=>request.path===bioartDownloadReceipt.preview_url)).toBe(false);
  await user.click(screen.getByRole('button',{name:'Download verified file'}));
  await waitFor(()=>expect(requests).toContainEqual(expect.objectContaining({download:'bioart-18.eps',href:'blob:artifact'})));
});

test('memory workspace loads a captured session and searches its reasoning',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:'Memory'}));
  await user.type(screen.getByLabelText('Operator token'),'tok');
  await user.click(screen.getByRole('button',{name:'Load sessions'}));
  await user.click(await screen.findByRole('button',{name:/mission-1 · 18 records/}));
  await screen.findByText(/Captured records/);
  await screen.findByText(/analyst · seq 2 · compaction epoch 0/);
  await user.type(screen.getByLabelText('Search memory'),'quadratic');
  await user.click(screen.getByRole('button',{name:'Search'}));
  await screen.findByText(/quadratic term hypothesis/);
});

test('native shell download outcomes are announced in the header and replace each other',async()=>{
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Molecules'}));await screen.findByRole('heading',{name:'Render locally'});
  expect(document.querySelector('.download-notice')).toBeNull();
  act(()=>{window.dispatchEvent(new CustomEvent('arc-download',{detail:{file:'1dqj-collage.svg',folder:'C:\Users\a b\Downloads',success:true}}));});
  expect(screen.getByText('Saved 1dqj-collage.svg in C:\Users\a b\Downloads')).toHaveAttribute('role','status');
  act(()=>{window.dispatchEvent(new CustomEvent('arc-download',{detail:{file:'1dqj-contacts.csv',folder:null,success:false}}));});
  expect(screen.getByRole('alert')).toHaveTextContent('Download failed: 1dqj-contacts.csv. Nothing was saved.');
  expect(screen.queryByText(/Saved 1dqj-collage/)).toBeNull();
});
