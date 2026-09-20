import React from 'react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {act, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {NATIVE_SESSION} from './http';
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
  expect(screen.getByRole('alert')).not.toHaveTextContent('Request failed');
  expect(screen.getByRole('alert')).not.toHaveTextContent('--search-html');
  expect(screen.getByText(/NIH.*search.*browser rendering/)).toBeVisible();
  expect(screen.queryByText('No matching entries in the returned metadata.')).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('NIH entry ID'),'18');
  await user.click(screen.getByRole('button',{name:'Inspect entry'}));
  expect(await screen.findByRole('heading',{name:'Antibody'})).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('cache miss uses a plain one-use consent recovery without backend flags', async () => {
  fetch.mockImplementation(async (path, options) => {
    calls.push({path, options});
    if (path==='/api/bioart/search') return json({detail:'Missing or stale cache; explicit --allow-egress required'},409);
    throw new Error('Unexpected request: '+path);
  });
  const user=userEvent.setup();
  render(<BioArtWorkspace token="operator" setToken={()=>{}}/>);
  const consent=screen.getByLabelText('Permit NIH network access for the next search or inspection');
  await user.click(screen.getByRole('button',{name:'Search NIH BioArt'}));
  const alert=await screen.findByRole('alert');
  expect(alert).toHaveTextContent('No cached BioArt source is available yet');
  expect(alert).toHaveTextContent('Permit NIH network access for the next search or inspection');
  expect(alert).toHaveTextContent('Consent is used once and clears after the request');
  expect(alert).not.toHaveTextContent('409');
  expect(alert).not.toHaveTextContent('--allow-egress');
  expect(consent).not.toBeChecked();
});

test('authorization and offline failures are actionable without raw transport strings', async () => {
  const user=userEvent.setup();
  fetch.mockImplementationOnce(async (path, options) => {
    calls.push({path, options});
    return json({detail:'Forbidden'},403);
  }).mockImplementationOnce(async (path, options) => {
    calls.push({path, options});
    throw new TypeError('Failed to fetch');
  });
  render(<BioArtWorkspace token="operator" setToken={()=>{}}/>);
  await user.click(screen.getByRole('button',{name:'Search NIH BioArt'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('BioArt is locked. Enter a valid operator token in the header, then try again.');
  expect(screen.getByRole('alert')).not.toHaveTextContent('403');
  await user.click(screen.getByRole('button',{name:'Search NIH BioArt'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Arc Science cannot reach the local BioArt service. Check that the desktop service is running, then retry.');
  expect(screen.getByRole('alert')).not.toHaveTextContent('Failed to fetch');
});


test('native session sentinel performs protected BioArt requests without a bearer secret', async () => {
  const user=userEvent.setup();
  render(<BioArtWorkspace token={NATIVE_SESSION} setToken={()=>{}}/>);
  await user.type(screen.getByLabelText('NIH entry ID'),'18');
  await user.click(screen.getByRole('button',{name:'Inspect entry'}));
  expect(await screen.findByRole('heading',{name:'Antibody'})).toBeVisible();
  expect(calls.at(-1).path).toBe('/api/bioart/inspect');
  expect(calls.at(-1).options.headers.Authorization).toBeUndefined();
});
