import React from 'react';
import {beforeEach, afterEach, expect, test, vi} from 'vitest';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {App} from './main.jsx';

const assets = Object.fromEntries(['collage.png','collage.svg','overview.svg','interface.svg','rotated.svg','overview.png','interface.png','rotated.png','contacts.csv','source.cif','scene.json','molecular_worker.py','integrity.json','caption.md','visual-review.md'].map(name=>[name,{url:'/api/examples/1dqj/assets/'+name,sha256:'a'.repeat(64),bytes:12,media_type:name.endsWith('.svg')?'image/svg+xml':'image/png'}]));
const example = {id:'1dqj',title:'HyHEL-63 Fab · Lysozyme',source:{id:'1DQJ',model:1,assembly:'1',url:'https://www.rcsb.org/structure/1DQJ'},partners:{antibody:['A','B'],antigen:['C']},contact_pairs:49,cutoff_angstrom:4,review:{status:'Accepted illustrative figure, candidate 03',scope:'Historical direct image review',live_provider_qualified:false,browser_layout_verified:false},limitations:['Gaussian atomic envelope, not a solvent-excluded surface.'],assets};
const row = {id:'mission-1',state:{status:'paused',round:1,actions_used:3,model_calls_used:2,data_origin:'fixture',branches:[],assessments:[],observations:[],events:[],visual_reports:[],artifacts:[],stop_reason:'Review needed'}};
let requests, downloadClick, selectedRow;
const json = data => new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});

beforeEach(()=>{
  requests=[]; selectedRow=structuredClone(row);
  vi.stubGlobal('fetch',vi.fn(async(path,options={})=>{
    requests.push({path,options});
    if(path==='/api/examples/1dqj')return json(example);
    if(path.startsWith('/api/examples/1dqj/assets/'))return new Response('real selected artifact');
    if(path==='/api/missions')return json(options.method==='POST'?selectedRow:[{id:'mission-1',status:'paused',goal:'Saved experiment'}]);
    if(path.endsWith('/verify'))return json({reproduction_passed:true});
    if(path.endsWith('/capsule'))return new Response('capsule');
    if(path.includes('/artifacts/'))return new Response('authenticated image',{headers:{'Content-Type':'image/png'}});
    if(path.endsWith('/cancel'))selectedRow.state.status='cancelled';
    return json(selectedRow);
  }));
  URL.createObjectURL=vi.fn(()=> 'blob:artifact'); URL.revokeObjectURL=vi.fn();
  downloadClick=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(){requests.push({download:this.download,href:this.href});});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

test('selected annotated view and zoom change the actual scientific stage',async()=>{
  const user=userEvent.setup();render(<App/>);
  const figure=await screen.findByRole('img',{name:'Annotated collage'});
  expect(figure).toHaveAttribute('src',assets['collage.svg'].url);
  await user.click(await screen.findByRole('tab',{name:'Interface'}));
  expect(screen.getByRole('img',{name:'Annotated interface'})).toHaveAttribute('src',assets['interface.svg'].url);
  const before=screen.getByRole('img',{name:'Annotated interface'}).style.width;
  await user.click(screen.getByRole('button',{name:'Zoom in'}));
  expect(screen.getByRole('img',{name:'Annotated interface'}).style.width).not.toBe(before);
  await user.click(await screen.findByRole('tab',{name:'Rotated detail'}));
  expect(screen.getByRole('img',{name:'Annotated rotated'})).toHaveAttribute('src',assets['rotated.svg'].url);
});

test('export fetches and downloads the selected actual SVG, and labels native PNGs honestly',async()=>{
  const user=userEvent.setup();render(<App/>);await screen.findByRole('img',{name:'Annotated collage'});
  await user.click(await screen.findByRole('tab',{name:'Full complex'}));
  await user.click(screen.getByRole('button',{name:'Export SVG'}));
  await waitFor(()=>expect(requests).toContainEqual(expect.objectContaining({download:'1dqj-overview.svg',href:'blob:artifact'})));
  expect(requests.some(r=>r.path===assets['overview.svg'].url)).toBe(true);
  await user.click(screen.getByText('Source & downloads'));
  expect(screen.getByRole('button',{name:'Native full complex PNG (unlabeled)'})).toBeInTheDocument();
});

test('failed export shows an error instead of a success or broken download',async()=>{
  const user=userEvent.setup();render(<App/>);await screen.findByRole('img',{name:'Annotated collage'});
  fetch.mockImplementationOnce(async()=>new Response('unavailable',{status:503}));
  await user.click(screen.getByRole('button',{name:'Export SVG'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('503');
  expect(downloadClick).not.toHaveBeenCalled();
});

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
});

test('empty saved missions and public example failures have actionable states',async()=>{
  fetch.mockImplementation(async(path)=>path==='/api/examples/1dqj'?new Response('',{status:503}):json([]));
  const user=userEvent.setup();render(<App/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('503');
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

test('view selection and export work from the keyboard',async()=>{
  const user=userEvent.setup();render(<App/>);
  const tab=await screen.findByRole('tab',{name:'Collage'});
  tab.focus();await user.keyboard('{ArrowRight}');
  expect(await screen.findByRole('img',{name:'Annotated overview'})).toHaveAttribute('src',assets['overview.svg'].url);
  screen.getByRole('button',{name:'Export SVG'}).focus();await user.keyboard('{Enter}');
  await waitFor(()=>expect(requests.some(r=>r.download==='1dqj-overview.svg')).toBe(true));
});
