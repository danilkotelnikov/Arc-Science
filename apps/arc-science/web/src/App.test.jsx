import React from 'react';
import {beforeEach, afterEach, expect, test, vi} from 'vitest';
import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {App} from './main.jsx';

const bioartEntry = {entry_id:18,title:'Antibody',license:'Public Domain',credit:'Courtesy of NIAID',creator:'Ryan Kissinger',collection:'NIAID Visual & Medical Arts',citation:'NIAID BioArt, BIOART-000018',source_url:'https://bioart.niaid.nih.gov/bioart/18',preferred_representation_id:64,representations:[{group_id:63,caption:'Antibody - Colored',files:{PNG:626857,SVG:626858}},{group_id:64,caption:'Antibody - Grey',files:{PNG:626859,SVG:626860,AI:626861,EPS:626862}}]};
const bioartReceipt = {receipt_id:'b'.repeat(64),entry_id:18,title:'Antibody',license:'Public Domain',credit:'Courtesy of NIAID',creator:'Ryan Kissinger',collection:'NIAID Visual & Medical Arts',citation:'NIAID BioArt, BIOART-000018',representation_id:64,caption:'Antibody - Grey',format:'SVG',file_id:626860,source_page_sha256:'c'.repeat(64),sha256:'d'.repeat(64),size:120,preview_eligible:true,import_eligible:true,limitation:null,rights_verified:false,scientific_validity_established:false,preview_url:'/api/bioart/receipts/'+'b'.repeat(64)+'/preview',download_url:'/api/bioart/receipts/'+'b'.repeat(64)+'/source'};
const bioartDownloadReceipt = {...bioartReceipt,receipt_id:'e'.repeat(64),format:'EPS',file_id:626862,preview_eligible:false,import_eligible:false,limitation:'AI/EPS originals are download-only; never executed',preview_url:'/api/bioart/receipts/'+'e'.repeat(64)+'/preview',download_url:'/api/bioart/receipts/'+'e'.repeat(64)+'/source'};
const check=(name,state,reason)=>({name,state,checked_basis_digest:'e'.repeat(64),evidence_digests:[],reason});
const eligibleRelease={policy_digest:'p'.repeat(64),subject_digest:'s'.repeat(64),status:'eligible_for_human_review',eligible_for_human_review:true,blocking_reasons:[],decided_at:1,verification:null,
  checks:[check('operational_status','satisfied','Mission finished as completed.'),check('replay_integrity','satisfied','Capsule verified.'),check('visual_review','not_applicable','Visual review was not requested for this mission.')]};
const blockedRelease={...eligibleRelease,status:'blocked',eligible_for_human_review:false,blocking_reasons:['replay_integrity:unknown'],
  checks:[check('operational_status','satisfied','Mission finished as completed.'),check('replay_integrity','unknown','Replay verification has not been run for this mission.'),check('visual_review','not_applicable','Visual review was not requested for this mission.')]};
const row = {id:'mission-1',release:eligibleRelease,state:{status:'paused',round:1,actions_used:3,model_calls_used:2,data_origin:'fixture',branches:[],assessments:[],observations:[],events:[],visual_reports:[],artifacts:[],stop_reason:'Review needed'}};
let requests, downloadClick, selectedRow;
const json = (data,init={}) => new Response(JSON.stringify(data),{...init,headers:{'Content-Type':'application/json',...(init.headers||{})}});

beforeEach(()=>{
  requests=[]; selectedRow=structuredClone(row);
  vi.stubGlobal('fetch',vi.fn(async(path,options={})=>{
    requests.push({path,options});
    if(path==='/api/bioart/search')return json({hits:[{entry_id:18,title:'Antibody'}]});
    if(path==='/api/bioart/inspect')return json(bioartEntry);
    if(path==='/api/bioart/fetch')return json(JSON.parse(options.body).format==='EPS'?bioartDownloadReceipt:bioartReceipt);
    if(path===bioartReceipt.preview_url)return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"></svg>',{headers:{'Content-Type':'image/svg+xml'}});
    if(path===bioartReceipt.download_url)return new Response('verified source',{headers:{'Content-Type':'image/svg+xml'}});
    if(path===bioartDownloadReceipt.download_url)return new Response('verified source',{headers:{'Content-Type':'application/postscript'}});
    if(path==='/api/bioart/import')return json({asset_id:'nih-bioart-antibody',asset_manifest:'assets/nih-bioart-antibody/asset.json'});
    if(path==='/api/missions')return json(options.method==='POST'?selectedRow:[{id:'mission-1',status:'paused',goal:'Saved experiment'}]);
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
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});




test('workspace switches retain in-memory token, goal and selected mission',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:'Research'}));
  await user.type(screen.getByLabelText('Local operator token'),'secret-token');
  await user.clear(screen.getByLabelText('Research goal'));await user.type(screen.getByLabelText('Research goal'),'Retained research question');
  await user.click(screen.getByRole('button',{name:'Load missions'}));
  await user.click(await screen.findByRole('button',{name:'paused · Saved experiment'}));
  expect(await screen.findByText('Selected mission: mission-1')).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Molecules'}));
  await user.click(screen.getByRole('button',{name:'Research'}));
  expect(screen.getByLabelText('Local operator token')).toHaveValue('secret-token');
  expect(screen.getByLabelText('Research goal')).toHaveValue('Retained research question');
  expect(screen.getByText('Selected mission: mission-1')).toBeVisible();
  expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);
});

test('mission creation sends actual egress and visual-review consent and execution settings',async()=>{
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Research'}));
  await user.type(screen.getByLabelText('Local operator token'),'operator');
  await user.selectOptions(screen.getByLabelText('Execution'),'live');
  await user.click(screen.getByLabelText(/Permit sending/));await user.click(screen.getByLabelText(/Require configured visual review/));
  await user.click(screen.getByRole('button',{name:'Create and start'}));
  await waitFor(()=>expect(requests.some(r=>r.path==='/api/missions/mission-1/start')).toBe(true));
  const sent=requests.find(r=>r.path==='/api/missions'&&r.options.method==='POST');
  expect(JSON.parse(sent.options.body)).toMatchObject({mode:'live',max_rounds:5,allow_egress:true,vision_review:true});
  expect(sent.options.headers.Authorization).toBe('Bearer operator');
});

test('selected mission exposes authenticated artifacts, visual reports, verify, capsule, resume and cancel',async()=>{
  selectedRow.state.artifacts=[{digest:'d'.repeat(64),source_observation_id:'obs-1',media_type:'image/png'}];
  selectedRow.state.visual_reports=[{model:'configured-reviewer',round:1,verdict:'revise',findings:[{category:'legibility',detail:'Inspect labels'}]}];
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Research'}));
  await user.type(screen.getByLabelText('Local operator token'),'private');
  await user.click(screen.getByRole('button',{name:'Load missions'}));await user.click(await screen.findByRole('button',{name:'paused · Saved experiment'}));
  expect(await screen.findByRole('img',{name:'Artifact from obs-1'})).toHaveAttribute('src','blob:artifact');
  expect(requests.find(r=>r.path?.includes('/artifacts/')).options.headers.Authorization).toBe('Bearer private');
  expect(screen.getByText('legibility: Inspect labels')).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Verify and recompute'}));
  expect(await screen.findByText(/"reproduction_passed": true/)).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Export replay capsule'}));
  await waitFor(()=>expect(requests.some(r=>r.download==='arc-mission-1.zip')).toBe(true));
  await user.click(screen.getByRole('button',{name:'Resume'}));await user.click(screen.getByRole('button',{name:'Cancel'}));
  await waitFor(()=>expect(requests.some(r=>r.path==='/api/missions/mission-1/cancel')).toBe(true));
  expect(screen.getByRole('button',{name:'Resume'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Cancel'})).toBeDisabled();
});

test('a blocked release ledger explains itself and withholds the capsule until verification',async()=>{
  selectedRow.release=blockedRelease;
  selectedRow.state.artifacts=[{digest:'d'.repeat(64),source_observation_id:'obs-1',media_type:'image/png'}];
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Research'}));
  await user.type(screen.getByLabelText('Local operator token'),'private');
  await user.click(screen.getByRole('button',{name:'Load missions'}));await user.click(await screen.findByRole('button',{name:'paused · Saved experiment'}));
  const ledger=await screen.findByRole('region',{name:'Release decision'});
  expect(ledger).toHaveTextContent('Release decision: Blocked');
  expect(ledger).toHaveTextContent('replay integrity · unknown — Replay verification has not been run for this mission.');
  expect(ledger).toHaveTextContent('Blocked by: replay_integrity:unknown.');
  expect(ledger).toHaveTextContent('never scientific validation');
  expect(screen.getByRole('button',{name:'Export replay capsule'})).toBeDisabled();
  // Inline inspection stays; the explicit file download consults the same ledger.
  expect(await screen.findByRole('img',{name:'Artifact from obs-1'})).toBeInTheDocument();
  expect(screen.queryByRole('link',{name:'Download authenticated PNG'})).toBeNull();
  expect(screen.getByText(/Download withheld until the release decision is eligible/)).toBeInTheDocument();
  // Verification refreshes the mission; the service's new decision opens the export.
  fetch.mockImplementation(async(path,options={})=>{requests.push({path,options});if(path.endsWith('/verify'))return json({reproduction_passed:true,release:eligibleRelease});return json({...selectedRow,release:eligibleRelease});});
  await user.click(screen.getByRole('button',{name:'Verify and recompute'}));
  await waitFor(()=>expect(screen.getByRole('region',{name:'Release decision'})).toHaveTextContent('Eligible for human review'));
  expect(screen.getByRole('button',{name:'Export replay capsule'})).toBeEnabled();
  expect(requests.find(r=>r.path?.endsWith('/verify')).options.method).toBe('POST');
  expect(await screen.findByRole('link',{name:'Download authenticated PNG'})).toBeInTheDocument();
});

test('repair cycles are listed with their own outcomes and superseded artifacts say so',async()=>{
  const first='a'.repeat(64),second='b'.repeat(64);
  selectedRow.state.artifacts=[{digest:first,source_observation_id:'obs-1',media_type:'image/png',preset:'default',repair_of:null},{digest:second,source_observation_id:'obs-1',media_type:'image/png',preset:'spacious',repair_of:first}];
  selectedRow.state.repairs=[{cycle:1,round:0,policy_digest:'e'.repeat(64),preset:'spacious',trigger_report_digest:'c'.repeat(64),addressed:['legibility'],superseded_digests:[first],artifact_digests:[second],outcome:'adequate',reason:''},
    {cycle:2,round:0,policy_digest:'e'.repeat(64),preset:'large_text',trigger_report_digest:'d'.repeat(64),addressed:['labels'],superseded_digests:[second],artifact_digests:[],outcome:'blocked',reason:'The large_text preset rendered an image that already exists; the repair changed nothing.'}];
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Research'}));
  await user.type(screen.getByLabelText('Local operator token'),'private');
  await user.click(screen.getByRole('button',{name:'Load missions'}));await user.click(await screen.findByRole('button',{name:'paused · Saved experiment'}));
  const repairs=await screen.findByRole('region',{name:'Figure repair cycles'});
  const items=within(repairs).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('Cycle 1 · round 0 · preset spacious · addressed legibility → adequate');
  expect(items[1]).toHaveAttribute('data-outcome','blocked');
  expect(items[1]).toHaveTextContent('the repair changed nothing');
  const captions=screen.getAllByText(/preset (default|spacious)/);
  expect(captions[0]).toHaveTextContent('superseded by a repair');
  expect(captions[1]).toHaveTextContent('repair of aaaaaaaaaaaa…');
  expect(captions[1]).not.toHaveTextContent('superseded');
});

test('a finished mission keeps its outcome: Cancel is disabled, Verify and export stay available',async()=>{
  selectedRow.state.status='completed';selectedRow.state.stop_reason='Exploration completed within budget.';
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Research'}));
  await user.type(screen.getByLabelText('Local operator token'),'private');
  await user.click(screen.getByRole('button',{name:'Load missions'}));await user.click(await screen.findByRole('button',{name:'paused · Saved experiment'}));
  expect(await screen.findByText('completed')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Cancel'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Resume'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Verify and recompute'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'Export replay capsule'})).toBeEnabled();
  expect(requests.some(r=>r.path==='/api/missions/mission-1/cancel')).toBe(false);
});

test('molecules opens on the local render form with an empty stage and no packaged example',async()=>{
  render(<App/>);
  expect(await screen.findByRole('heading',{name:'Render your structure locally'})).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('No render selected');
  expect(screen.queryByText(/EXAMPLE/)).toBeNull();
  expect(screen.queryByRole('button',{name:'Export SVG'})).toBeNull();
  expect(requests.some(r=>String(r.path).includes('/api/examples'))).toBe(false);
});

test('empty saved missions have an actionable state',async()=>{
  fetch.mockImplementation(async()=>json([]));
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:'Research'}));await user.click(screen.getByRole('button',{name:'Load missions'}));
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
  await user.type(screen.getByLabelText('Local operator token'),'private');
  await user.click(screen.getByRole('button',{name:'Load missions'}));
  await user.click(await screen.findByRole('button',{name:'paused · Saved experiment'}));
  expect(await screen.findByText(/Artifact unavailable:/)).toHaveTextContent('503');
  expect(screen.queryByText('Loading authenticated artifact…')).not.toBeInTheDocument();
  expect(screen.queryByRole('img',{name:'Artifact from obs-1'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Molecules'}));await user.click(screen.getByRole('button',{name:'Research'}));
  expect(screen.getByLabelText('Local operator token')).toHaveValue('private');
  expect(screen.getByText('Selected mission: mission-1')).toBeVisible();
  unavailable=false;
  await user.click(screen.getByRole('button',{name:'Retry artifact'}));
  expect(await screen.findByRole('img',{name:'Artifact from obs-1'})).toHaveAttribute('src','blob:artifact');
  expect(screen.queryByText(/Artifact unavailable:/)).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  const calls=requests.filter(r=>r.path?.includes('/artifacts/'));
  expect(calls).toHaveLength(2);
  expect(calls.every(r=>r.options.headers.Authorization==='Bearer private')).toBe(true);
  expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);
});


test('BioArt search is authenticated, cache-first, and shares the in-memory operator token',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:'Research'}));
  await user.type(screen.getByLabelText('Local operator token'),'shared-operator');
  await user.click(screen.getByRole('button',{name:'BioArt'}));
  expect(screen.getByLabelText('Operator token for BioArt')).toHaveValue('shared-operator');
  await user.clear(screen.getByLabelText('BioArt search query'));
  await user.type(screen.getByLabelText('BioArt search query'),'antibody');
  await user.click(screen.getByRole('button',{name:'Search NIH BioArt'}));
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
  const token=screen.getByLabelText('Operator token for BioArt');
  const query=screen.getByLabelText('BioArt search query');
  const consent=screen.getByLabelText('Permit NIH network access for the next search or inspection');
  await user.type(token,'operator');await user.click(consent);
  await user.click(screen.getByRole('button',{name:'Search NIH BioArt'}));
  expect(await screen.findByRole('status')).toHaveTextContent('request in progress');
  expect(token).toBeDisabled();expect(query).toBeDisabled();expect(consent).toBeDisabled();
  finish();
  await waitFor(()=>expect(screen.queryByRole('status')).not.toBeInTheDocument());
});

test('BioArt inspects, fetches the automatic neutral SVG, verifies a protected preview, and imports it',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:'BioArt'}));
  await user.type(screen.getByLabelText('Operator token for BioArt'),'bioart-operator');
  const metadataConsent=screen.getByLabelText('Permit NIH network access for the next search or inspection');
  await user.click(metadataConsent);
  await user.click(screen.getByRole('button',{name:'Search NIH BioArt'}));
  expect(metadataConsent).not.toBeChecked();
  await user.click(metadataConsent);
  await user.click(await screen.findByRole('button',{name:'Antibody · BIOART-000018'}));
  expect(metadataConsent).not.toBeChecked();
  expect(await screen.findByText('Courtesy of NIAID')).toBeInTheDocument();
  expect(screen.getByText('NIH metadata: Public Domain')).toBeInTheDocument();
  expect(screen.getByLabelText('Representation')).toHaveValue('auto');
  const fetchConsent=screen.getByLabelText('Permit NIH network access for this fetch');
  await user.click(fetchConsent);
  expect(metadataConsent).not.toBeChecked();
  await user.click(screen.getByRole('button',{name:'Fetch verified SVG'}));
  expect(fetchConsent).not.toBeChecked();
  expect(await screen.findByRole('img',{name:'Verified BioArt preview: Antibody'})).toHaveAttribute('src','blob:artifact');
  const fetchRequest=requests.find(r=>r.path==='/api/bioart/fetch');
  expect(JSON.parse(fetchRequest.options.body)).toEqual({entry_id:18,format:'SVG',allow_egress:true});
  const previewRequest=requests.find(r=>r.path===bioartReceipt.preview_url);
  expect(previewRequest.options.headers.Authorization).toBe('Bearer bioart-operator');
  expect(screen.getByText('Receipt verified')).toBeInTheDocument();
  expect(screen.getByText('Verified SVG · group 64')).toBeInTheDocument();
  expect(screen.getByText(/Rights metadata has not been independently verified/)).toBeInTheDocument();
  expect(screen.getByText(/Scientific validity is not established/)).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Download verified source'}));
  await waitFor(()=>expect(requests).toContainEqual(expect.objectContaining({download:'bioart-18.svg',href:'blob:artifact'})));
  await user.click(screen.getByRole('button',{name:'Import verified SVG'}));
  expect(await screen.findByText('Imported asset nih-bioart-antibody')).toBeInTheDocument();
  expect(screen.getByText('assets/nih-bioart-antibody/asset.json')).toBeInTheDocument();
});

test('BioArt manual representation override is explicit and fetch errors preserve the inspected entry',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:'BioArt'}));
  await user.type(screen.getByLabelText('Operator token for BioArt'),'operator');
  await user.click(screen.getByRole('button',{name:'Search NIH BioArt'}));
  await user.click(await screen.findByRole('button',{name:'Antibody · BIOART-000018'}));
  await user.selectOptions(screen.getByLabelText('Representation'),'63');
  await user.click(screen.getByRole('button',{name:'Fetch verified SVG'}));
  await screen.findByRole('img',{name:'Verified BioArt preview: Antibody'});
  const sent=requests.findLast(r=>r.path==='/api/bioart/fetch');
  expect(JSON.parse(sent.options.body)).toEqual({entry_id:18,representation_id:63,format:'SVG',allow_egress:false});

  fetch.mockImplementationOnce(async()=>json({detail:'Unknown or restricted license requires operator review; fetch/import blocked'},{status:409}));
  await user.click(screen.getByRole('button',{name:'Fetch verified SVG'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('restricted license');
  expect(screen.getByText('Courtesy of NIAID')).toBeInTheDocument();
});

test('BioArt exposes original vector formats without previewing or importing download-only EPS',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:'BioArt'}));
  await user.type(screen.getByLabelText('Operator token for BioArt'),'operator');
  await user.click(screen.getByRole('button',{name:'Search NIH BioArt'}));
  await user.click(await screen.findByRole('button',{name:'Antibody · BIOART-000018'}));
  expect(screen.getAllByRole('option').map(option=>option.value)).toEqual(expect.arrayContaining(['SVG','PNG','AI','EPS']));
  await user.selectOptions(screen.getByLabelText('Format'),'EPS');
  await user.click(screen.getByRole('button',{name:'Fetch verified EPS'}));
  expect(await screen.findByText(/download-only; no browser preview/)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'EPS import unavailable'})).toBeDisabled();
  const sent=requests.findLast(request=>request.path==='/api/bioart/fetch');
  expect(JSON.parse(sent.options.body)).toEqual({entry_id:18,format:'EPS',allow_egress:false});
  expect(requests.some(request=>request.path===bioartDownloadReceipt.preview_url)).toBe(false);
  await user.click(screen.getByRole('button',{name:'Download verified source'}));
  await waitFor(()=>expect(requests).toContainEqual(expect.objectContaining({download:'bioart-18.eps',href:'blob:artifact'})));
});

test('memory workspace loads a captured session and searches its reasoning',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:'Memory'}));
  await user.type(screen.getByLabelText('Operator token for Memory'),'tok');
  await user.click(screen.getByRole('button',{name:'Load sessions'}));
  await user.click(await screen.findByRole('button',{name:/mission-1 · 18 records/}));
  await screen.findByText(/Captured trajectory/);
  await screen.findByText(/analyst · epoch 0/);
  await user.type(screen.getByLabelText('Search memory'),'quadratic');
  await user.click(screen.getByRole('button',{name:'Search'}));
  await screen.findByText(/quadratic term hypothesis/);
});

test('native shell download outcomes are announced in the header and replace each other',async()=>{
  render(<App/>);await screen.findByRole('heading',{name:'Render your structure locally'});
  expect(document.querySelector('.download-notice')).toBeNull();
  act(()=>{window.dispatchEvent(new CustomEvent('arc-download',{detail:{file:'1dqj-collage.svg',folder:'C:\Users\a b\Downloads',success:true}}));});
  expect(screen.getByText('Saved 1dqj-collage.svg in C:\Users\a b\Downloads')).toHaveAttribute('role','status');
  act(()=>{window.dispatchEvent(new CustomEvent('arc-download',{detail:{file:'1dqj-contacts.csv',folder:null,success:false}}));});
  expect(screen.getByRole('alert')).toHaveTextContent('Download failed: 1dqj-contacts.csv. Nothing was saved.');
  expect(screen.queryByText(/Saved 1dqj-collage/)).toBeNull();
});
