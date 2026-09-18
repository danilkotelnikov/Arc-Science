import React from 'react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {act, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BioArtWorkspace from './BioArtWorkspace';

const entry = {
  entry_id:18, title:'Antibody', license:'Public Domain', credit:'Courtesy of NIAID',
  creator:'Ryan Kissinger', collection:'NIAID Visual & Medical Arts', citation:'NIH BIOART-000018',
  source_url:'https://bioart.niaid.nih.gov/bioart/18',
  representations:[{group_id:64, caption:'Antibody - Grey', files:{SVG:626860}}],
};
const json = (value, status=200) => new Response(JSON.stringify(value), {
  status, headers:{'Content-Type':'application/json'},
});
let calls;
beforeEach(() => {
  calls=[];
  vi.stubGlobal('fetch', vi.fn(async (path, options) => {
    calls.push({path, options});
    if (path==='/api/bioart/inspect') return json(entry);
    if (path==='/api/bioart/search') return json({detail:'BioArt schema drift: required metadata missing or inconsistent'},409);
    throw new Error('Unexpected request: '+path);
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('direct entry inspection is authenticated, cache-first and consumes network consent once', async () => {
  const user=userEvent.setup();
  render(<BioArtWorkspace token="local-operator" setToken={()=>{}}/>);
  expect(calls).toHaveLength(0);
  await user.type(screen.getByLabelText('NIH entry ID'),'18');
  const inspect=screen.getByRole('button',{name:'Inspect entry'});
  const consent=screen.getByLabelText('Permit NIH network access for the next search or inspection');
  await user.click(inspect);
  expect(await screen.findByRole('heading',{name:'Antibody'})).toBeVisible();
  await user.click(consent);
  await user.click(inspect);
  await waitFor(()=>expect(inspect).not.toBeDisabled());
  expect(consent).not.toBeChecked();
  await user.click(inspect);
  await waitFor(()=>expect(calls).toHaveLength(3));
  expect(calls.map(call=>JSON.parse(call.options.body))).toEqual([
    {entry_id:18,allow_egress:false}, {entry_id:18,allow_egress:true}, {entry_id:18,allow_egress:false},
  ]);
  expect(calls.every(call=>call.path==='/api/bioart/inspect' && call.options.headers.Authorization==='Bearer local-operator')).toBe(true);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

test('direct inspection requires a token and a positive safe integer entry ID before dispatch', async () => {
  const user=userEvent.setup();
  const rendered=render(<BioArtWorkspace token="" setToken={()=>{}}/>);
  const input=screen.getByLabelText('NIH entry ID');
  const inspect=screen.getByRole('button',{name:'Inspect entry'});
  await user.type(input,'18');
  expect(inspect).toBeDisabled();
  rendered.rerender(<BioArtWorkspace token="operator" setToken={()=>{}}/>);
  expect(inspect).not.toBeDisabled();
  for (const invalid of ['', '0', '-1', '1.5', '1e2', 'BIOART-000018', '9007199254740992']) {
    await user.clear(input);
    if (invalid) await user.type(input,invalid);
    expect(inspect).toBeDisabled();
    await user.click(inspect);
  }
  expect(calls).toHaveLength(0);
  await user.clear(input);
  await user.type(input,'000018');
  await user.click(inspect);
  await screen.findByRole('heading',{name:'Antibody'});
  expect(JSON.parse(calls[0].options.body).entry_id).toBe(18);
});

test('entry inspection freezes input and clears consumed consent while a request is pending', async () => {
  let finish;
  fetch.mockImplementation((path,options)=>new Promise(resolve=>{
    calls.push({path,options}); finish=()=>resolve(json(entry));
  }));
  const user=userEvent.setup();
  render(<BioArtWorkspace token="operator" setToken={()=>{}}/>);
  const input=screen.getByLabelText('NIH entry ID');
  const consent=screen.getByLabelText('Permit NIH network access for the next search or inspection');
  await user.type(input,'18'); await user.click(consent);
  await user.click(screen.getByRole('button',{name:'Inspect entry'}));
  expect(input).toBeDisabled(); expect(consent).toBeDisabled(); expect(consent).not.toBeChecked();
  expect(screen.getByRole('button',{name:'Inspect entry'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Search NIH BioArt'})).toBeDisabled();
  await act(async()=>finish());
  expect(input).not.toBeDisabled();
  expect(await screen.findByRole('heading',{name:'Antibody'})).toBeVisible();
});

test('failed dynamic search preserves its error and offers an official search link plus direct inspection', async () => {
  const user=userEvent.setup();
  render(<BioArtWorkspace token="private-token" setToken={()=>{}}/>);
  const query=screen.getByLabelText('BioArt search query');
  await user.clear(query); await user.type(query,'antibody & grey');
  const link=screen.getByRole('link',{name:'Open NIH search'});
  const destination=new URL(link.href);
  expect(destination.origin+destination.pathname).toBe('https://bioart.niaid.nih.gov/discover');
  expect(destination.searchParams.get('q')).toBe('antibody & grey');
  expect(destination.searchParams.get('sort')).toBe('relevance');
  expect(link).toHaveAttribute('rel','noreferrer');
  expect(link.href).not.toContain('private-token');
  await user.click(screen.getByRole('button',{name:'Search NIH BioArt'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('BioArt schema drift');
  expect(screen.getByText(/NIH.*search.*browser rendering/)).toBeVisible();
  expect(screen.queryByText('No matching entries in the returned metadata.')).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('NIH entry ID'),'18');
  await user.click(screen.getByRole('button',{name:'Inspect entry'}));
  expect(await screen.findByRole('heading',{name:'Antibody'})).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
