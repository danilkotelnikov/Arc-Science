import React, {useState} from 'react';
import {beforeEach, afterEach, expect, test, vi} from 'vitest';
import {act, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MolecularWorkspace from './MolecularWorkspace';

const assets=Object.fromEntries(['collage.png','collage.svg','contacts.csv','manifest.json'].map(name=>[name,{url:'/api/molecular/renders/job-1/assets/'+name,sha256:'a'.repeat(64),bytes:120,media_type:name.endsWith('.png')?'image/png':'application/octet-stream'}]));
const completed={id:'job-1',status:'completed',filename:'complex.cif',source_sha256:'b'.repeat(64),contact_pairs:42,error:null,assets};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
let jobs, submitted, capabilities, calls, downloads;
function Harness({initialToken='operator'}) {
  const [token,setToken]=useState(initialToken);
  return <MolecularWorkspace token={token} setToken={setToken}/>;
}
async function openPanel() {
  await screen.findByRole('heading',{name:'Render your structure locally'});
  expect(screen.getByRole('status')).toHaveTextContent('No render selected');
}
async function loadPanel(user) {
  await openPanel();
  await user.click(screen.getByRole('button',{name:'Load renders'}));
  await screen.findByText('Local renderer ready.');
}
async function fillSource(user) {
  await user.upload(screen.getByLabelText('Coordinate file'),new File(['data_complex\n# coordinates'], 'complex.cif', {type:'text/plain'}));
  await user.type(screen.getByLabelText('Antibody chains'),'A, B');
  await user.type(screen.getByLabelText('Antigen chains'),'C');
}
beforeEach(()=>{
  jobs=[];submitted={...completed,status:'queued',assets:{},contact_pairs:null};capabilities={configured:true,reason:'',limits:{max_source_bytes:750000}};calls=[];downloads=[];
  vi.stubGlobal('fetch',vi.fn(async(path,options={})=>{
    calls.push({path,options});
    if(path==='/api/molecular/capabilities')return json(capabilities);
    if(path==='/api/molecular/renders')return json(options.method==='POST'?submitted:jobs,options.method==='POST'?202:200);
    if(path==='/api/molecular/renders/job-1/cancel')return json({...submitted,status:'cancelled'});
    if(path==='/api/molecular/renders/job-1')return json(jobs.find(job=>job.id==='job-1')||submitted);
    if(path.startsWith('/api/molecular/renders/job-1/assets/'))return new Response('verified artifact');
    throw new Error('Unexpected path: '+path);
  }));
  URL.createObjectURL=vi.fn(()=> 'blob:molecular');URL.revokeObjectURL=vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(){downloads.push({name:this.download,url:this.href});});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

test('loads explicitly and submits coordinates, author chains and reproducible defaults with bearer auth',async()=>{
  const user=userEvent.setup();render(<Harness/>);await openPanel(user);
  expect(calls.filter(call=>call.path.startsWith('/api/molecular'))).toHaveLength(0);
  await user.click(screen.getByRole('button',{name:'Load renders'}));await screen.findByText('Local renderer ready.');
  await fillSource(user);await user.click(screen.getByRole('button',{name:'Render structure'}));
  await screen.findByText('Render status: queued');
  const sent=calls.find(call=>call.path==='/api/molecular/renders'&&call.options.method==='POST');
  expect(sent.options.headers.Authorization).toBe('Bearer operator');
  expect(JSON.parse(sent.options.body)).toEqual({filename:'complex.cif',source_text:'data_complex\n# coordinates',antibody_chains:['A','B'],antigen_chains:['C'],assembly:'asymmetric_unit',model_index:0,cutoff:4,width:1400,samples:96,seed:23});
  expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);
});

test('completed render uses an authenticated blob preview and downloads, then closes to the empty stage',async()=>{
  jobs=[completed];const user=userEvent.setup();const rendered=render(<Harness/>);await loadPanel(user);
  await user.click(screen.getByRole('button',{name:'completed · complex.cif'}));
  expect(await screen.findByRole('img',{name:'Rendered molecular collage: complex.cif'})).toHaveAttribute('src','blob:molecular');
  expect(calls.find(call=>call.path===assets['collage.png'].url).options.headers.Authorization).toBe('Bearer operator');
  expect(screen.getByText(/42 residue pairs/)).toBeInTheDocument();
  expect(screen.getByText(/Rendering does not establish scientific validity/)).toBeVisible();
  expect(screen.queryByText(/No render selected/)).not.toBeInTheDocument();
  await user.click(screen.getByText('Artifact hashes'));
  expect(screen.getByText(completed.source_sha256)).toBeVisible();
  await user.click(screen.getByRole('button',{name:'Download manifest.json'}));
  await waitFor(()=>expect(downloads).toContainEqual({name:'job-1-manifest.json',url:'blob:molecular'}));
  expect(calls.find(call=>call.path===assets['manifest.json'].url).options.headers.Authorization).toBe('Bearer operator');
  expect(calls.every(call=>!call.path.includes('operator'))).toBe(true);
  await user.click(screen.getByRole('button',{name:'Close render'}));
  expect(screen.getByRole('status')).toHaveTextContent('No render selected');
  expect(calls.every(call=>!call.path.includes('/api/examples/'))).toBe(true);
  rendered.unmount();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:molecular');
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
  await user.clear(screen.getByLabelText('Operator token for Molecules'));
  await user.type(screen.getByLabelText('Operator token for Molecules'),'different');
  await act(async()=>finish());
  expect(screen.queryByRole('img',{name:'Rendered molecular collage: complex.cif'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'completed · complex.cif'})).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('No render selected');
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
  await user.click(screen.getByLabelText('Presentation (width, samples, seed)'));
  await user.click(screen.getByLabelText('Scientific depiction (chains, assembly, model)'));
  await fillSource(user);
  const width=screen.getByLabelText('Width (px)');await user.clear(width);await user.type(width,'1600');
  await user.click(screen.getByRole('button',{name:'Render structure'}));
  await screen.findByText('Render status: queued');
  const sent=JSON.parse(calls.find(call=>call.path==='/api/molecular/renders'&&call.options.method==='POST').options.body);
  expect(sent.base_job).toBe('job-1');expect(sent.declared_effects).toEqual(['presentation','scientific_depiction']);expect(sent.width).toBe(1600);
  expect(screen.getByText(/Declared change of render job-1/)).toHaveTextContent('declared presentation, scientific_depiction; derived presentation (width); checks obliged: geometry, readability.');
});
