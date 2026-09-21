import React, {useState} from 'react';
import {beforeEach, afterEach, expect, test, vi} from 'vitest';
import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MolecularWorkspace from './MolecularWorkspace';

// Mol* needs WebGL and a browser; the unit tests stand in a stub for the lazy chunk.
const viewerProbe = vi.hoisted(() => ({mounts: 0}));
vi.mock('./MolecularViewer', async () => {
  const React = await vi.importActual('react');
  return {default: ({source, scene, stage}) => {
    const [instance] = React.useState(() => ++viewerProbe.mounts);
    return <div data-testid="viewer" data-instance={instance}>viewer {source.filename}{source.origin === 'job' ? ' (fetched)' : ' (upload)'}{scene ? ' · ' + scene.contacts.length + ' ' + scene.state + ' contacts' : ''}{stage ? ' · ' + stage : ''}</div>;
  }};
});
const EMPTY = 'Choose a coordinate file or a saved render to view it.';

const assets=Object.fromEntries(['collage.png','collage.svg','contacts.csv','manifest.json'].map(name=>[name,{url:'/api/molecular/renders/job-1/assets/'+name,sha256:'a'.repeat(64),bytes:120,media_type:name.endsWith('.png')?'image/png':'application/octet-stream'}]));
const completed={id:'job-1',status:'completed',filename:'complex.cif',source_sha256:'b'.repeat(64),contact_pairs:42,error:null,assets};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
let jobs, submitted, capabilities, calls, downloads;
function Harness({initialToken='operator'}) {
  const [token,setToken]=useState(initialToken);
  // The operator token lives in the app header; the harness stands in for it.
  return <><label>Operator token<input id="operator-token" type="password" value={token} onChange={e=>setToken(e.target.value)}/></label><MolecularWorkspace token={token} setToken={setToken}/></>;
}
async function openPanel() {
  await screen.findByRole('heading',{name:'Render locally'});
  expect(screen.getByRole('status')).toHaveTextContent(EMPTY);
}
async function loadPanel(user) {
  await openPanel();
  await user.click(screen.getByRole('button',{name:'Load renders'}));
  await screen.findByText('Local renderer configured.');
}
async function fillSource(user) {
  await user.upload(screen.getByLabelText('Coordinate file'),new File(['data_complex\n# coordinates'], 'complex.cif', {type:'text/plain'}));
  await user.type(screen.getByLabelText('Antibody chains'),'A, B');
  await user.type(screen.getByLabelText('Antigen chains'),'C');
}
beforeEach(()=>{
  viewerProbe.mounts = 0;
  jobs=[];submitted={...completed,status:'queued',assets:{},contact_pairs:null};capabilities={configured:true,reason:'',limits:{max_source_bytes:750000},
    presets:{default:'publication_dark',default_source:'settings',names:[{name:'publication_white',description:'The reviewed default.'},{name:'grayscale',description:'Two greys, for print without colour.'}]}};calls=[];downloads=[];
  vi.stubGlobal('fetch',vi.fn(async(path,options={})=>{
    calls.push({path,options});
    if(path==='/api/molecular/capabilities')return json(capabilities);
    if(path==='/api/molecular/renders')return json(options.method==='POST'?submitted:jobs,options.method==='POST'?202:200);
    if(path==='/api/molecular/renders/job-1/cancel')return json({...submitted,status:'cancelled'});
    if(path==='/api/molecular/renders/job-1')return json(jobs.find(job=>job.id==='job-1')||submitted);
    if(path.startsWith('/api/molecular/renders/job-1/assets/'))return new Response('verified artifact');
    if(path==='/api/settings')return json({settings:{viewer:{representation:'surface',colouring:'element',assembly:'asymmetric_unit',background:'black'}}});
    if(path==='/api/molecular/renders/job-1/events')return new Response('',{status:404});
    if(path==='/api/molecular/renders/job-1/source')return new Response('data_complex\n',{headers:{'Content-Type':'chemical/x-mmcif'}});
    if(path.startsWith('/api/molecular/catalogue'))return json({checked_at:1,counts:{present:1,indirect:1,absent:1,unprobed:1,total:4},categories:{cheminformatics:'Cheminformatics',visualization:'Visualisation and rendering',protein_design:'Protein and antibody design'},
      licence_note:'licence names as recorded; confirm at the project home',scope:'presence, not qualification',entries:[
        {id:'rdkit',name:'RDKit',category:'cheminformatics',licence:'BSD-3-Clause',present:true,evidence:'import',where:'host python',detail:'2025.09.1'},
        {id:'obabel',name:'Open Babel',category:'cheminformatics',licence:'GPL-2.0',present:false,detail:'not on PATH'},
        {id:'rfdiffusion',name:'RFdiffusion',category:'protein_design',licence:'see project home',present:null,observed:'environment_seen',evidence:'environment',where:'wsl',detail:'conda env SE3nv exists; the package itself was not observed'},
        {id:'molstar',name:'Mol*',category:'visualization',licence:'MIT',present:null,note:'bundled viewer in this workbench'}]});
    if(path==='/api/molecular/renders/job-1/scene')return new Response(JSON.stringify({contacts:[{antibody_residue:'A:1',antigen_residue:'C:1'}]}),{status:200,headers:{'Content-Type':'application/json','X-Arc-Scene':'verified'}});
    throw new Error('Unexpected path: '+path);
  }));
  URL.createObjectURL=vi.fn(()=> 'blob:molecular');URL.revokeObjectURL=vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(){downloads.push({name:this.download,url:this.href});});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

test('loads explicitly and submits coordinates, author chains and reproducible defaults with bearer auth',async()=>{
  const user=userEvent.setup();render(<Harness/>);await openPanel(user);
  expect(calls.filter(call=>call.path.startsWith('/api/molecular'))).toHaveLength(0);
  await user.click(screen.getByRole('button',{name:'Load renders'}));await screen.findByText('Local renderer configured.');
  await fillSource(user);
  // The chosen coordinates are shown before any render exists, without a request.
  const viewer = await screen.findByTestId('viewer');
  expect(viewer).toHaveTextContent('viewer complex.cif (upload)');
  const instance = viewer.dataset.instance;
  await user.click(screen.getByRole('button',{name:'Render structure'}));
  await screen.findByText('Render status: queued');
  expect(screen.getByTestId('viewer').dataset.instance).toBe(instance);
  const sent=calls.find(call=>call.path==='/api/molecular/renders'&&call.options.method==='POST');
  expect(sent.options.headers.Authorization).toBe('Bearer operator');
  expect(JSON.parse(sent.options.body)).toEqual({filename:'complex.cif',source_text:'data_complex\n# coordinates',antibody_chains:['A','B'],antigen_chains:['C'],assembly:'asymmetric_unit',model_index:0,cutoff:4,width:1400,samples:96,seed:23});
  // A chosen preset travels with the request; the default is left to the service.
  await user.click(screen.getByText('Assembly & render settings'));
  expect(screen.getByLabelText('Render preset')).toHaveDisplayValue('default (publication dark)');
  await user.selectOptions(screen.getByLabelText('Render preset'),'grayscale');
  expect(screen.getByText('Two greys, for print without colour.')).toBeInTheDocument();
  expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);
});

test('completed render uses authenticated artifacts while preserving the same viewer',async()=>{
  jobs=[completed];const user=userEvent.setup();const rendered=render(<Harness/>);await loadPanel(user);
  await user.click(screen.getByRole('button',{name:'completed · complex.cif'}));
  const viewer = await screen.findByTestId('viewer');
  expect(viewer).toHaveTextContent('viewer complex.cif (fetched) · 1 verified contacts · render complete');
  const instance = viewer.dataset.instance;
  expect(await screen.findByRole('img',{name:'Rendered molecular collage: complex.cif'})).toHaveAttribute('src','blob:molecular');
  expect(screen.getByTestId('viewer').dataset.instance).toBe(instance);
  expect(calls.find(call=>call.path===assets['collage.png'].url).options.headers.Authorization).toBe('Bearer operator');
  expect(screen.getByText(/42 contact residue pairs/)).toBeInTheDocument();
  expect(screen.getByText(/A render does not establish scientific validity/)).toBeVisible();
  expect(screen.queryByText(/No render selected/)).not.toBeInTheDocument();
  await user.click(screen.getByText('File hashes (SHA-256)'));
  expect(screen.getByText(completed.source_sha256)).toBeVisible();
  await user.click(screen.getByRole('button',{name:'Download manifest.json'}));
  await waitFor(()=>expect(downloads).toContainEqual({name:'job-1-manifest.json',url:'blob:molecular'}));
  expect(calls.find(call=>call.path===assets['manifest.json'].url).options.headers.Authorization).toBe('Bearer operator');
  expect(calls.every(call=>!call.path.includes('operator'))).toBe(true);
  // The reopen button exists only while the details are closed.
  expect(screen.queryByRole('button',{name:'View selected render'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Close details'}));
  expect(screen.getByRole('button',{name:'View selected render'})).toBeInTheDocument();
  // Closing the render details leaves the already-mounted viewer on the render's coordinates and contacts.
  expect(screen.queryByRole('img',{name:'Rendered molecular collage: complex.cif'})).not.toBeInTheDocument();
  expect(screen.getByTestId('viewer')).toHaveTextContent('viewer complex.cif (fetched) · 1 verified contacts · render complete');
  expect(screen.getByTestId('viewer').dataset.instance).toBe(instance);
  expect(calls.find(call=>call.path==='/api/molecular/renders/job-1/source').options.headers.Authorization).toBe('Bearer operator');
  expect(calls.every(call=>!call.path.includes('/api/examples/'))).toBe(true);
  rendered.unmount();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:molecular');
});

test('the package catalogue reports what each probe observed, never more',async()=>{
  const user=userEvent.setup();render(<Harness/>);await openPanel(user);
  await user.click(screen.getByText('Packages'));
  await user.click(screen.getByRole('button',{name:'Check packages'}));
  const report=within(await screen.findByLabelText('Software catalogue'));
  expect(report.getByText(/1 present · 1 seen indirectly · 1 absent · 1 not probed · 4 known/)).toBeInTheDocument();
  expect(report.getByText(/present \(import, host python: 2025\.09\.1\)/)).toBeInTheDocument();
  expect(report.getByText(/absent \(not on PATH\)/)).toBeInTheDocument();
  // An environment seen is said to be exactly that, never the package.
  expect(report.getByText(/environment seen \(conda env SE3nv exists; the package itself was not observed\)/)).toBeInTheDocument();
  expect(report.getByText(/not probed \(bundled viewer in this workbench\)/)).toBeInTheDocument();
  expect(calls.find(c=>c.path.startsWith('/api/molecular/catalogue')).options.headers.Authorization).toBe('Bearer operator');
  await user.click(screen.getByRole('button',{name:'Check again'}));
  await waitFor(()=>expect(calls.filter(c=>c.path==='/api/molecular/catalogue/refresh'&&c.options.method==='POST')).toHaveLength(1));
});

test('shows unavailable runtime while retained completed renders remain available',async()=>{
  capabilities={configured:false,reason:'Blender Python is not configured.',limits:{max_source_bytes:750000}};jobs=[completed];
  const user=userEvent.setup();render(<Harness/>);await openPanel(user);await user.click(screen.getByRole('button',{name:'Load renders'}));
  expect(await screen.findByText('Blender Python is not configured.')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Render structure'})).toBeDisabled();
  await user.click(screen.getByRole('button',{name:'completed · complex.cif'}));
  expect(await screen.findByRole('img',{name:'Rendered molecular collage: complex.cif'})).toBeInTheDocument();
});

test('cancels a pending render and renders server failures without exposing an artifact',async()=>{
  const user=userEvent.setup();render(<Harness/>);await loadPanel(user);await fillSource(user);
  await user.click(screen.getByRole('button',{name:'Render structure'}));await screen.findByText('Render status: queued');
  await user.click(screen.getByRole('button',{name:'Cancel render'}));
  expect(await screen.findByText('Render status: cancelled')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Cancel render'})).not.toBeInTheDocument();
  jobs=[{...completed,status:'failed',error:'Selected antigen chain was not found.',assets:{},contact_pairs:null}];
  await user.click(screen.getByRole('button',{name:'Refresh renders'}));await user.click(await screen.findByRole('button',{name:'failed · complex.cif'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Selected antigen chain was not found.');
  expect(screen.queryByRole('img',{name:'Rendered molecular collage: complex.cif'})).not.toBeInTheDocument();
});

test('token changes clear protected state and suppress an obsolete authenticated response',async()=>{
  jobs=[completed];let finish;
  const original=fetch.getMockImplementation();
  fetch.mockImplementation((path,options)=>path===assets['collage.png'].url?new Promise(resolve=>{calls.push({path,options});finish=()=>resolve(new Response('private old image'));}):original(path,options));
  const user=userEvent.setup();render(<Harness/>);await loadPanel(user);await user.click(screen.getByRole('button',{name:'completed · complex.cif'}));
  await waitFor(()=>expect(finish).toBeTypeOf('function'));
  await user.clear(screen.getByLabelText('Operator token'));
  await user.type(screen.getByLabelText('Operator token'),'different');
  await act(async()=>finish());
  expect(screen.queryByRole('img',{name:'Rendered molecular collage: complex.cif'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'completed · complex.cif'})).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(EMPTY);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(calls.find(call=>call.path===assets['collage.png'].url).options.signal.aborted).toBe(true);
});

test('polling stops on unmount',async()=>{
  jobs=[submitted];const user=userEvent.setup();const rendered=render(<Harness/>);await loadPanel(user);
  await user.click(screen.getByRole('button',{name:'queued · complex.cif'}));await screen.findByText('Render status: queued');
  rendered.unmount();const before=calls.length;
  await act(async()=>new Promise(resolve=>setTimeout(resolve,1700)));expect(calls).toHaveLength(before);
});

test('reselecting an active render restarts polling after a status request fails',async()=>{
  jobs=[submitted];const original=fetch.getMockImplementation();let failPoll=false;
  fetch.mockImplementation((path,options)=>path==='/api/molecular/renders/job-1'&&failPoll?Promise.resolve(new Response('',{status:503})):original(path,options));
  const user=userEvent.setup();render(<Harness/>);await loadPanel(user);
  await user.click(screen.getByRole('button',{name:'queued · complex.cif'}));await screen.findByText('Render status: queued');
  failPoll=true;
  expect(await screen.findByRole('alert',{}, {timeout:2500})).toHaveTextContent('Status unavailable');failPoll=false;
  await user.click(screen.getByRole('button',{name:'queued · complex.cif'}));await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  jobs=[completed];
  expect(await screen.findByText('Render status: completed',{}, {timeout:2500})).toBeInTheDocument();
  expect(await screen.findByRole('img',{name:'Rendered molecular collage: complex.cif'})).toBeInTheDocument();
});

test('an obsolete poll cannot overwrite a more recent render selection',async()=>{
  const second={...completed,id:'job-2',filename:'other.pdb',status:'failed',error:'Other file is invalid.',assets:{}};
  jobs=[submitted,second];const original=fetch.getMockImplementation();let delayPoll=false,finish;
  fetch.mockImplementation((path,options)=>{
    if(path==='/api/molecular/renders/job-2')return Promise.resolve(json(second));
    if(path==='/api/molecular/renders/job-1'&&delayPoll)return new Promise(resolve=>{calls.push({path,options});finish=()=>resolve(json(completed));});
    return original(path,options);
  });
  const user=userEvent.setup();render(<Harness/>);await loadPanel(user);
  await user.click(screen.getByRole('button',{name:'queued · complex.cif'}));await screen.findByText('Render status: queued');
  delayPoll=true;await waitFor(()=>expect(finish).toBeTypeOf('function'),{timeout:2500});
  await user.click(screen.getByRole('button',{name:'failed · other.pdb'}));await screen.findByText('Other file is invalid.');
  await act(async()=>finish());
  expect(screen.getByRole('heading',{name:'other.pdb'})).toBeInTheDocument();
  expect(screen.queryByRole('img',{name:'Rendered molecular collage: complex.cif'})).not.toBeInTheDocument();
  expect(calls.filter(call=>call.path==='/api/molecular/renders/job-1').at(-1).options.signal.aborted).toBe(true);
});

test('a failed authenticated preview can be retried without submitting a new render',async()=>{
  jobs=[completed];const original=fetch.getMockImplementation();let unavailable=true;
  fetch.mockImplementation((path,options)=>path===assets['collage.png'].url&&unavailable?Promise.resolve(new Response('',{status:503})):original(path,options));
  const user=userEvent.setup();render(<Harness/>);await loadPanel(user);await user.click(screen.getByRole('button',{name:'completed · complex.cif'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('503');unavailable=false;
  await user.click(screen.getByRole('button',{name:'Retry preview'}));
  expect(await screen.findByRole('img',{name:'Rendered molecular collage: complex.cif'})).toBeInTheDocument();
  expect(calls.filter(call=>call.options.method==='POST')).toHaveLength(0);
});

test('a render can be declared a change of the selected completed render, and the record shows what the server derived',async()=>{
  jobs=[{...completed,settings:{antibody_chains:['A','B'],antigen_chains:['C'],assembly:'asymmetric_unit',model_index:0,cutoff:4,width:1400,samples:96,seed:23}}];
  submitted={...submitted,id:'job-1',change:{base_job:'job-1',declared_effects:['presentation','scientific_depiction'],derived_effects:['presentation'],changed_fields:['width'],required_checks:['geometry','readability']}};
  const user=userEvent.setup();render(<Harness/>);await loadPanel(user);
  await user.click(screen.getByRole('button',{name:'completed · complex.cif'}));
  await user.click(screen.getByRole('button',{name:'Render structure'}).closest('form').querySelector('summary'));
  await user.click(screen.getByLabelText(/Render as a declared change of job-1/));
  await user.click(screen.getByLabelText('Presentation (width, samples, seed, preset)'));
  await user.click(screen.getByLabelText('Scientific depiction (chains, assembly, model, an envelope or stick preset)'));
  await fillSource(user);
  const width=screen.getByLabelText('Width (px)');await user.clear(width);await user.type(width,'1600');
  await user.click(screen.getByRole('button',{name:'Render structure'}));
  await screen.findByText('Render status: queued');
  const sent=JSON.parse(calls.find(call=>call.path==='/api/molecular/renders'&&call.options.method==='POST').options.body);
  expect(sent.base_job).toBe('job-1');expect(sent.declared_effects).toEqual(['presentation','scientific_depiction']);expect(sent.width).toBe(1600);
  expect(screen.getByText(/Change of render job-1/)).toHaveTextContent('Declared: presentation, scientific depiction. Derived by the server: presentation (changed: width). Required checks: geometry, readability.');
});

test('locked controls say what unlocks them, next to the control',async()=>{
  const user=userEvent.setup();render(<Harness initialToken=""/>);await screen.findByRole('heading',{name:'Render locally'});
  const controls=within(screen.getByRole('complementary',{name:'Molecular render controls'}));
  expect(controls.getByText('Operator token required')).toBeVisible();
  expect(controls.getByRole('button',{name:'Load renders'})).toBeDisabled();
  // The chain fields name their first blocker: the token comes before Load renders.
  expect(controls.getByText('Paste an operator token, then press Load renders.')).toBeVisible();
  expect(controls.queryByText(/Locked until Load renders/)).not.toBeInTheDocument();
  await user.click(controls.getByRole('button',{name:'Go to token field'}));
  await waitFor(()=>expect(screen.getByLabelText('Operator token')).toHaveFocus());
  await user.type(screen.getByLabelText('Operator token'),'operator');
  expect(controls.queryByText('Operator token required')).not.toBeInTheDocument();
  expect(controls.getByText('Locked until Load renders reports the local renderer is configured.')).toBeVisible();
  await user.click(controls.getByRole('button',{name:'Load renders'}));await screen.findByText('Local renderer configured.');
  expect(controls.queryByText(/Locked until Load renders/)).not.toBeInTheDocument();
  expect(controls.getByText('Choose a coordinate file first.')).toBeVisible();
  // An oversize file is reported next to the file input before Render structure is pressed.
  await user.upload(screen.getByLabelText('Coordinate file'),new File(['x'.repeat(750001)],'big.pdb',{type:'text/plain'}));
  expect(controls.getByRole('alert')).toHaveTextContent(/This file is 750.001 bytes; the limit is 750.000 bytes\./);
  expect(controls.getByText('Enter antibody and antigen chains first.')).toBeVisible();
});

test('a dead service and a rejected token are said in the shared words, beside Load renders',async()=>{
  const original=fetch.getMockImplementation();let mode='offline';
  fetch.mockImplementation((path,options)=>path==='/api/molecular/capabilities'?(mode==='offline'?Promise.reject(new TypeError('Failed to fetch')):Promise.resolve(new Response('Authentication required',{status:401}))):original(path,options));
  const user=userEvent.setup();render(<Harness/>);await openPanel(user);
  const controls=within(screen.getByRole('complementary',{name:'Molecular render controls'}));
  await user.click(controls.getByRole('button',{name:'Load renders'}));
  expect(await controls.findByRole('alert')).toHaveTextContent('Arc Science is not reachable. Start the local service, then retry.');
  expect(controls.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  mode='auth';
  await user.click(controls.getByRole('button',{name:'Load renders'}));
  // A rejected token is the lock notice in its error tone, said once: no alert with the same words.
  expect(await controls.findByText('Token not accepted')).toBeVisible();
  expect(controls.queryByRole('alert')).not.toBeInTheDocument();
  expect(controls.queryByText(/Request failed \(401\)/)).not.toBeInTheDocument();
  expect(controls.getByRole('button',{name:'Go to token field'})).toBeInTheDocument();
});

test('the renderer line reports the load, then the capability, never both',async()=>{
  const original=fetch.getMockImplementation();let finish;
  fetch.mockImplementation((path,options)=>path==='/api/molecular/capabilities'?new Promise(resolve=>{finish=()=>resolve(json(capabilities));}):original(path,options));
  const user=userEvent.setup();render(<Harness/>);await openPanel(user);
  const controls=within(screen.getByRole('complementary',{name:'Molecular render controls'}));
  await user.click(controls.getByRole('button',{name:'Load renders'}));
  expect(await controls.findByRole('status')).toHaveTextContent('Loading renders…');
  expect(controls.queryByText('Local renderer configured.')).not.toBeInTheDocument();
  await waitFor(()=>expect(finish).toBeTypeOf('function'));await act(async()=>finish());
  expect(await controls.findByText('Local renderer configured.')).toBeVisible();
  expect(controls.queryByText('Loading renders…')).not.toBeInTheDocument();
});

test('a failed package check is reported inside Packages, not in the shared alert',async()=>{
  const original=fetch.getMockImplementation();
  fetch.mockImplementation((path,options)=>path.startsWith('/api/molecular/catalogue')?Promise.resolve(new Response('',{status:503})):original(path,options));
  const user=userEvent.setup();render(<Harness/>);await openPanel(user);
  await user.click(screen.getByText('Packages'));await user.click(screen.getByRole('button',{name:'Check packages'}));
  const alert=await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Package check failed: Request failed (503)');
  expect(alert.closest('details')).toHaveTextContent('Packages');
});
