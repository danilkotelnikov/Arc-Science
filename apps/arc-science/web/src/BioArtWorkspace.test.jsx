import React from 'react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {NATIVE_SESSION} from './http';
import en from './i18n/en.js';
import ru from './i18n/ru.js';
import {I18nProvider} from './i18n/index.jsx';
import BioArtWorkspace from './BioArtWorkspace';

const entry = {
  entry_id:18, title:'Antibody', license:'Public Domain', credit:'Courtesy of NIAID',
  creator:'Ryan Kissinger', collection:'NIAID Visual & Medical Arts', citation:'NIH BIOART-000018',
  source_url:'https://bioart.niaid.nih.gov/bioart/18',
  representations:[{group_id:64, caption:'Antibody - Grey', files:{SVG:626860}}],
};
const receipt = {
  receipt_id:'b'.repeat(64), entry_id:18, title:'Antibody', representation_id:64, caption:'Antibody - Grey', format:'SVG', file_id:626860,
  source_page_sha256:'c'.repeat(64), sha256:'d'.repeat(64), size:1234, preview_eligible:true, import_eligible:true, limitation:null,
  rights_verified:false, scientific_validity_established:false,
  preview_url:'/api/bioart/receipts/'+'b'.repeat(64)+'/preview', download_url:'/api/bioart/receipts/'+'b'.repeat(64)+'/source',
};
const epsReceipt = {
  ...receipt, receipt_id:'e'.repeat(64), representation_id:63, caption:'Antibody - Colored', format:'EPS', file_id:626862,
  preview_eligible:false, import_eligible:false, limitation:'AI/EPS originals are download-only; never executed',
  preview_url:'/api/bioart/receipts/'+'e'.repeat(64)+'/preview', download_url:'/api/bioart/receipts/'+'e'.repeat(64)+'/source',
};
const session = id => ({title:en[`session.${id}.title`], text:en[`session.${id}.text`]});
const json = (value, status=200) => new Response(JSON.stringify(value), {
  status, headers:{'Content-Type':'application/json'},
});
// getByText compares against whitespace-normalised text, which turns no-break spaces into spaces.
const plain = text => text.replace(/\s+/g, ' ');
const searchRegion = () => screen.getByRole('complementary',{name:'BioArt search'});
/** A HeroUI Select trigger: its name is the chosen value, then the field label. */
const picker = label => screen.getByRole('button',{name:new RegExp(label+'$')});
/** Pick an option of a HeroUI Select by its visible label, the way a user does. */
async function choose(user, label, option) {
  await user.click(picker(label));
  await user.click(await screen.findByRole('option',{name:option}));
}
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
  expect(input).not.toHaveAttribute('aria-invalid','true');
  for (const invalid of ['', '0', '-1', '1.5', '1e2', 'BIOART-000018', '9007199254740992']) {
    await user.clear(input);
    if (invalid) await user.type(input,invalid);
    expect(inspect).toBeDisabled();
    if (invalid) expect(input).toHaveAttribute('aria-invalid','true');
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
  expect(screen.getByLabelText('BioArt search query')).toBeDisabled();
  expect(screen.getByRole('button',{name:'Inspect entry'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Search BioArt'})).toBeDisabled();
  expect(within(searchRegion()).getByRole('status')).toHaveTextContent('BioArt request in progress');
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
  expect(link).toHaveAttribute('target','_blank');
  expect(link.href).not.toContain('private-token');
  await user.click(screen.getByRole('button',{name:'Search BioArt'}));
  const alert=await screen.findByRole('alert');
  expect(alert).toHaveTextContent('NIH metadata came in an unexpected shape');
  expect(alert).not.toHaveTextContent('schema drift');
  expect(alert).not.toHaveTextContent('Request failed');
  expect(alert).not.toHaveTextContent('--search-html');
  // The error sits next to the search controls, not in the entry column.
  expect(within(searchRegion()).getByRole('alert')).toBe(alert);
  // One caveat beside the search: live search lives on the official site, which the link opens.
  const caveat=screen.getByText(/Live NIH search is not available here/);
  expect(caveat).toBeVisible();
  expect(caveat).toContainElement(link);
  expect(screen.getByText('Matches the local cache only.')).toBeVisible();
  // The longer account (cache-first search, consented lookups, one-use consent) is one disclosure away.
  await user.click(within(searchRegion()).getByRole('button',{name:'How NIH access works'}));
  expect(screen.getByText('Search matches the local cache; with consent, entry lookups (Inspect entry) fetch from NIH.')).toBeVisible();
  expect(screen.getByText('Consent covers one search or inspection, then clears.')).toBeVisible();
  expect(screen.getByText('Cached entries never contact NIH.')).toBeVisible();
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
  const expired=session('expired');
  const notice=(await within(searchRegion()).findByText(expired.title)).closest('[role="status"]');
  expect(notice).toHaveTextContent(expired.text);
  expect(notice).toHaveAttribute('data-tone','error');
  expect(notice).not.toHaveTextContent('403');
  expect(within(notice).getByRole('button',{name:'Go to token field'})).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getAllByText(expired.title)).toHaveLength(1);
  await user.click(screen.getByRole('button',{name:'Search BioArt'}));
  const offline=session('offline');
  expect(await screen.findByRole('alert')).toHaveTextContent(offline.title+'. '+offline.text);
  expect(screen.getByRole('alert')).not.toHaveTextContent('Failed to fetch');
});

test('without a token the locked line sits beside the search controls and result cards stay disabled', async () => {
  const user=userEvent.setup();
  fetch.mockImplementation(async (path, options) => { calls.push({path, options}); return json({hits:[{entry_id:18,title:'Antibody'}]}); });
  // The header token field the lock notice hands focus to.
  const rendered=render(<><input id="operator-token" aria-label="Operator token"/><BioArtWorkspace token="operator"/></>);
  const locked=session('locked');
  expect(screen.queryByText(locked.title)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Search BioArt'}));
  const row=await screen.findByRole('button',{name:'Inspect Antibody, BIOART-000018'});
  expect(row).not.toBeDisabled();
  rendered.rerender(<><input id="operator-token" aria-label="Operator token"/><BioArtWorkspace token=""/></>);
  expect(screen.getByRole('button',{name:'Search BioArt'})).toBeDisabled();
  expect(row).toBeDisabled();
  const notice=within(searchRegion()).getByRole('status');
  expect(notice).toBeVisible();
  expect(notice).toHaveTextContent(locked.title);
  expect(notice).toHaveTextContent(locked.text);
  expect(notice).toHaveAttribute('data-tone','info');
  expect(screen.getAllByText(locked.title)).toHaveLength(1);
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
  expect(picker('Format')).toHaveTextContent('PNG');
  const fetchButton=screen.getByRole('button',{name:'Fetch and verify PNG'});
  expect(fetchButton).not.toBeDisabled();
  await user.click(fetchButton);
  const alert=await screen.findByRole('alert');
  expect(alert).toHaveTextContent('No cached BioArt file is available yet. Permit NIH network access for this fetch');
  expect(alert).not.toHaveTextContent('--allow-egress');
  expect(within(screen.getByRole('region',{name:'Select source file'})).getByRole('alert')).toBe(alert);
  expect(within(searchRegion()).queryByRole('alert')).not.toBeInTheDocument();
  expect(JSON.parse(calls.at(-1).options.body)).toEqual({entry_id:18,format:'PNG',allow_egress:false});
});

test('the record shows the NIH facts, fetches the chosen variant, previews it behind the token and imports the SVG', async () => {
  const user=userEvent.setup();
  const colored={group_id:63, caption:'Antibody - Colored', files:{PNG:626857, SVG:626858}};
  fetch.mockImplementation(async (path, options) => {
    calls.push({path, options});
    if (path==='/api/bioart/inspect') return json({...entry, representations:[colored, ...entry.representations]});
    if (path==='/api/bioart/fetch') return json(receipt);
    if (path===receipt.preview_url) return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {headers:{'Content-Type':'image/svg+xml'}});
    if (path===receipt.download_url) return new Response('verified source', {headers:{'Content-Type':'image/svg+xml'}});
    if (path==='/api/bioart/import') return json({asset_id:'nih-bioart-antibody', asset_manifest:'assets/nih-bioart-antibody/asset.json'});
    throw new Error('Unexpected request: '+path);
  });
  URL.createObjectURL=vi.fn(()=>'blob:artifact'); URL.revokeObjectURL=vi.fn();
  const saved=[];
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(){ saved.push({download:this.download, href:this.href}); });
  render(<BioArtWorkspace token="bioart-operator" setToken={()=>{}}/>);
  await user.type(screen.getByLabelText('NIH entry ID'),'18');
  await user.click(screen.getByRole('button',{name:'Inspect entry'}));
  await screen.findByRole('heading',{name:'Antibody'});
  for (const value of ['Public Domain','Courtesy of NIAID','Ryan Kissinger','NIAID Visual & Medical Arts','NIH BIOART-000018']) expect(screen.getByText(value)).toBeVisible();
  expect(screen.getByText('License per NIH')).toBeVisible();
  expect(screen.getByText('File not fetched yet')).toBeVisible();
  expect(screen.getByRole('link',{name:'Open NIH source'})).toHaveAttribute('href','https://bioart.niaid.nih.gov/bioart/18');
  expect(picker('Variant')).toHaveTextContent('Automatic (prefers a grey or black-and-white SVG)');
  await choose(user,'Variant','Antibody - Colored');
  const consent=screen.getByLabelText('Permit NIH network access for this fetch');
  await user.click(consent);
  await user.click(screen.getByRole('button',{name:'Fetch and verify SVG'}));
  expect(consent).not.toBeChecked();
  expect(await screen.findByRole('img',{name:'Verified BioArt preview: Antibody'})).toHaveAttribute('src','blob:artifact');
  expect(JSON.parse(calls.find(call=>call.path==='/api/bioart/fetch').options.body)).toEqual({entry_id:18,format:'SVG',allow_egress:true,representation_id:63});
  expect(calls.find(call=>call.path===receipt.preview_url).options.headers.Authorization).toBe('Bearer bioart-operator');
  const record=screen.getByRole('region',{name:'Verified fetch record'});
  expect(within(record).getByRole('heading',{name:'File fetched and verified'})).toBeVisible();
  expect(screen.getByText('Verified SVG, variant 64')).toBeVisible();
  expect(within(record).getByText('1,234 bytes')).toBeVisible();
  expect(within(record).getByText('d'.repeat(64))).toBeVisible();
  expect(within(record).getByText('Rights metadata has not been independently verified.')).toBeVisible();
  expect(within(record).getByText(/Scientific validity is not established/)).toBeVisible();
  await user.click(screen.getByRole('button',{name:'Download verified file'}));
  await waitFor(()=>expect(saved).toContainEqual({download:'bioart-18.svg', href:'blob:artifact'}));
  await user.click(screen.getByRole('button',{name:'Import verified SVG'}));
  const imported=await screen.findByText('Imported asset nih-bioart-antibody');
  expect(imported.closest('[role="status"]')).toHaveTextContent('assets/nih-bioart-antibody/asset.json');
  expect(JSON.parse(calls.find(call=>call.path==='/api/bioart/import').options.body)).toEqual({receipt_id:receipt.receipt_id});
});

test('an EPS original is download-only: never previewed, never imported', async () => {
  const user=userEvent.setup();
  fetch.mockImplementation(async (path, options) => {
    calls.push({path, options});
    if (path==='/api/bioart/inspect') return json({...entry, representations:[{group_id:63, caption:'Antibody - Colored', files:{SVG:626858, AI:626861, EPS:626862}}]});
    if (path==='/api/bioart/fetch') return json(epsReceipt);
    if (path===epsReceipt.download_url) return new Response('verified source', {headers:{'Content-Type':'application/postscript'}});
    throw new Error('Unexpected request: '+path);
  });
  URL.createObjectURL=vi.fn(()=>'blob:artifact'); URL.revokeObjectURL=vi.fn();
  const saved=[];
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(){ saved.push({download:this.download, href:this.href}); });
  render(<BioArtWorkspace token="operator" setToken={()=>{}}/>);
  await user.type(screen.getByLabelText('NIH entry ID'),'18');
  await user.click(screen.getByRole('button',{name:'Inspect entry'}));
  await screen.findByRole('heading',{name:'Antibody'});
  await user.click(picker('Format'));
  expect((await screen.findAllByRole('option')).map(option=>option.textContent)).toEqual(['SVG','AI','EPS']);
  await user.click(screen.getByRole('option',{name:'EPS'}));
  await user.click(screen.getByRole('button',{name:'Fetch and verify EPS'}));
  expect(await screen.findByText(/download-only; no browser preview/)).toBeVisible();
  expect(screen.getByText('AI/EPS originals are download-only; never executed')).toBeVisible();
  expect(screen.getByRole('button',{name:'EPS import unavailable'})).toBeDisabled();
  expect(JSON.parse(calls.findLast(call=>call.path==='/api/bioart/fetch').options.body)).toEqual({entry_id:18,format:'EPS',allow_egress:false});
  expect(calls.some(call=>call.path===epsReceipt.preview_url)).toBe(false);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Download verified file'}));
  await waitFor(()=>expect(saved).toContainEqual({download:'bioart-18.eps', href:'blob:artifact'}));
  expect(calls.some(call=>call.path==='/api/bioart/import')).toBe(false);
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

test('the workspace reads in Russian inside the Russian provider', async () => {
  const user=userEvent.setup();
  render(<I18nProvider locale="ru"><BioArtWorkspace token="operator" setToken={()=>{}}/></I18nProvider>);
  expect(screen.getByRole('heading',{level:1,name:'Иллюстрации NIH BioArt'})).toBeVisible();
  expect(screen.getByRole('complementary',{name:ru['bioart.search.landmark']})).toBeVisible();
  expect(screen.getByRole('button',{name:ru['bioart.search.submit']})).toBeEnabled();
  await user.type(screen.getByLabelText(ru['bioart.search.entry_id']),'18');
  await user.click(screen.getByRole('button',{name:ru['bioart.search.inspect']}));
  await screen.findByRole('heading',{name:'Antibody'});
  expect(screen.getByText(plain(ru['bioart.entry.license']))).toBeVisible();
  expect(screen.getByText(plain(ru['bioart.entry.not_fetched']))).toBeVisible();
  expect(screen.getByRole('button',{name:ru['bioart.fetch.submit'].replace('{format}', 'SVG')})).toBeEnabled();
  expect(document.body.textContent).not.toMatch(/bioart\.[a-z_.]+/);
});
