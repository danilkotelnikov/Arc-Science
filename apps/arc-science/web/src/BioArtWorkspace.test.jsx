import React from 'react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {NATIVE_SESSION, SESSION_COPY} from './http';
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
  expect(screen.getByRole('button',{name:'Search BioArt'})).toBeDisabled();
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
  await user.click(screen.getByRole('button',{name:'Search BioArt'}));
  const alert=await screen.findByRole('alert');
  expect(alert).toHaveTextContent('NIH metadata came in an unexpected shape');
  expect(alert).not.toHaveTextContent('schema drift');
  expect(alert).not.toHaveTextContent('Request failed');
  expect(alert).not.toHaveTextContent('--search-html');
  // The error sits next to the search controls, not in the other column.
  expect(within(screen.getByRole('complementary',{name:'BioArt search'})).getByRole('alert')).toBe(alert);
  // One caveat: cache-first search, consented lookups, and the official site for live search.
  const caveat=screen.getByText(/Live NIH search is not available here/);
  expect(caveat).toBeVisible();
  expect(caveat).toHaveTextContent('Search matches the local cache; with consent, entry lookups (Inspect entry, below) fetch from NIH.');
  expect(caveat).toHaveTextContent('Consent covers one search or inspection, then clears. Cached entries never contact NIH.');
  expect(caveat).toContainElement(link);
  expect(screen.queryByText(/browser rendering/)).not.toBeInTheDocument();
  expect(screen.queryByText('No entries match this query.')).not.toBeInTheDocument();
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
  await user.click(screen.getByRole('button',{name:'Search BioArt'}));
  const alert=await screen.findByRole('alert');
  expect(alert).toHaveTextContent('No cached BioArt metadata is available yet');
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
  await user.click(screen.getByRole('button',{name:'Search BioArt'}));
  // A rejected token is session state: the shared lock notice in its error tone, once, and no alert with the same words.
  const search=screen.getByRole('complementary',{name:'BioArt search'});
  const notice=(await within(search).findByText(SESSION_COPY.expired.title)).closest('[role="status"]');
  expect(notice).toHaveTextContent(SESSION_COPY.expired.text);
  expect(notice).toHaveAttribute('data-tone','error');
  expect(notice).not.toHaveTextContent('403');
  expect(within(notice).getByRole('button',{name:'Go to token field'})).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getAllByText(SESSION_COPY.expired.title)).toHaveLength(1);
  await user.click(screen.getByRole('button',{name:'Search BioArt'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(SESSION_COPY.offline.title+'. '+SESSION_COPY.offline.text);
  expect(screen.getByRole('alert')).not.toHaveTextContent('Failed to fetch');
});

test('without a token the locked line sits beside the search controls and result rows stay disabled', async () => {
  const user=userEvent.setup();
  fetch.mockImplementation(async (path, options) => { calls.push({path, options}); return json({hits:[{entry_id:18,title:'Antibody'}]}); });
  // The header token field the lock notice hands focus to.
  const rendered=render(<><input id="operator-token" aria-label="Operator token"/><BioArtWorkspace token="operator"/></>);
  expect(screen.queryByText(SESSION_COPY.locked.title)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Search BioArt'}));
  const row=await screen.findByRole('button',{name:'Antibody · BIOART-000018'});
  expect(row).not.toBeDisabled();
  rendered.rerender(<><input id="operator-token" aria-label="Operator token"/><BioArtWorkspace token=""/></>);
  expect(screen.getByRole('button',{name:'Search BioArt'})).toBeDisabled();
  expect(row).toBeDisabled();
  const search=screen.getByRole('complementary',{name:'BioArt search'});
  const notice=within(search).getByRole('status');
  expect(notice).toBeVisible();
  expect(notice).toHaveTextContent(SESSION_COPY.locked.title);
  expect(notice).toHaveTextContent(SESSION_COPY.locked.text);
  expect(notice).toHaveAttribute('data-tone','info');
  expect(screen.getAllByText(SESSION_COPY.locked.title)).toHaveLength(1);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  // The notice sits under the search action, and its button leads to the token field.
  expect(screen.getByRole('button',{name:'Search BioArt'}).compareDocumentPosition(notice)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await user.click(within(notice).getByRole('button',{name:'Go to token field'}));
  await waitFor(()=>expect(screen.getByLabelText('Operator token')).toHaveFocus());
});

test('an entry without SVG starts on its first available format and fetch errors sit beside the fetch button', async () => {
  const user=userEvent.setup();
  fetch.mockImplementation(async (path, options) => {
    calls.push({path, options});
    if (path==='/api/bioart/inspect') return json({...entry, representations:[{group_id:63, caption:'Antibody - Colored', files:{PNG:626857, EPS:626859}}]});
    if (path==='/api/bioart/fetch') return json({detail:'Missing or stale cache; explicit --allow-egress required'},409);
    throw new Error('Unexpected request: '+path);
  });
  render(<BioArtWorkspace token="operator"/>);
  await user.type(screen.getByLabelText('NIH entry ID'),'18');
  await user.click(screen.getByRole('button',{name:'Inspect entry'}));
  await screen.findByRole('heading',{name:'Antibody'});
  expect(screen.getByLabelText('Format')).toHaveValue('PNG');
  const fetchButton=screen.getByRole('button',{name:'Fetch and verify PNG'});
  expect(fetchButton).not.toBeDisabled();
  await user.click(fetchButton);
  const alert=await screen.findByRole('alert');
  expect(alert).toHaveTextContent('No cached BioArt file is available yet. Permit NIH network access for this fetch');
  expect(alert).not.toHaveTextContent('--allow-egress');
  expect(fetchButton.parentElement).toContainElement(alert);
  expect(within(screen.getByRole('complementary',{name:'BioArt search'})).queryByRole('alert')).not.toBeInTheDocument();
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
