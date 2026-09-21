import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Button} from '@heroui/react/button';
import {apiFetch, downloadResponse, SESSION_COPY, sessionState} from './http';
import {Icon} from './icons';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';

const formatOrder=['SVG','PNG','AI','EPS'];
const sessionLine=card=>`${card.title}. ${card.text}`;

function errorMessage(reason) {
  return reason?.message || String(reason || '');
}

function isOfflineError(message) {
  return /failed to fetch|networkerror|load failed/i.test(message);
}

function detailAfterStatus(message) {
  const match=message.match(/^Request failed \((\d+)\)(?::\s*)?(.*)$/);
  return match?{status:Number(match[1]),detail:match[2]||''}:null;
}

function isAuthError(reason) {
  const status=detailAfterStatus(errorMessage(reason))?.status;
  return status===401||status===403;
}

function sanitizeBioArtDetail(detail) {
  return detail
    .replace(/;?\s*explicit\s+--allow-egress\s+required\.?/ig,'')
    .replace(/search\s+--search-html\s+with\s+an\s+operator-supplied\s+browser\s+DOM\s+snapshot/ig,'a browser page snapshot, which this app cannot provide; open NIH search and inspect the entry by ID')
    .replace(/\s+/g,' ')
    .trim();
}

function describeBioArtError(reason,scope='metadata',token='') {
  const message=errorMessage(reason);
  const status=detailAfterStatus(message);
  if (/Operator token is required/i.test(message)) return sessionLine(SESSION_COPY.locked);
  if (status?.status===401 || status?.status===403) return sessionLine(sessionState(token,true));
  if (isOfflineError(message)) return sessionLine(SESSION_COPY.offline);
  if (status?.status===409 && /Missing or stale cache/i.test(status.detail)) {
    const fetching=scope==='fetch';
    return `No cached BioArt ${fetching?'file':'metadata'} is available yet. Permit NIH network access for ${fetching?'this fetch':'the next search or inspection'}, then try again. Consent is used once and clears after the request.`;
  }
  if (status) {
    if (/schema drift/i.test(status.detail)) return 'NIH metadata came in an unexpected shape and could not be read. Try again later, or open NIH search and inspect the entry by ID.';
    const detail=sanitizeBioArtDetail(status.detail);
    if (detail) return detail;
    return 'The BioArt request could not complete. Check the entry, consent, and local service, then retry.';
  }
  return sanitizeBioArtDetail(message) || 'The BioArt request could not complete. Check the entry, consent, and local service, then retry.';
}

function ProtectedPreview({receipt,request,token}) {
  const [url,setUrl]=useState(''),[error,setError]=useState('');
  useEffect(()=>{
    if(!receipt?.preview_eligible)return;
    const controller=new AbortController();let ownedUrl;
    setUrl('');setError('');
    request(receipt.preview_url,'GET',undefined,controller.signal).then(response=>response.blob()).then(blob=>{
      if(!controller.signal.aborted){ownedUrl=URL.createObjectURL(blob);setUrl(ownedUrl);}
    }).catch(reason=>{if(!controller.signal.aborted&&reason.name!=='AbortError')setError(describeBioArtError(reason,'preview',token));});
    return ()=>{controller.abort();if(ownedUrl)URL.revokeObjectURL(ownedUrl);};
  },[receipt,request,token]);
  if(!receipt?.preview_eligible)return <div className="bioart-preview-stage"><p className="muted">This file is download-only; no browser preview is available.</p></div>;
  return <div className="bioart-preview-stage">{error?<p role="alert">Preview unavailable: {error}</p>:url?<img src={url} alt={'Verified BioArt preview: '+receipt.title}/>:<p role="status">Loading preview…</p>}</div>;
}

export default function BioArtWorkspace({token,setToken}) {
  const [query,setQuery]=useState('antibody'),[metadataEgress,setMetadataEgress]=useState(false),[fetchEgress,setFetchEgress]=useState(false);
  const [entryId,setEntryId]=useState('');
  const [hits,setHits]=useState(null),[entry,setEntry]=useState(null),[receipt,setReceipt]=useState(null),[imported,setImported]=useState(null);
  const [format,setFormat]=useState('SVG'),[representation,setRepresentation]=useState('auto');
  // scope = which action the busy line and the error belong to, so both render next to that action.
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[scope,setScope]=useState('metadata');
  // A rejected token is session state, shown once by the shared lock notice, not as an action error.
  const [authExpired,setAuthExpired]=useState(false);
  useEffect(()=>{setAuthExpired(false);},[token]);
  const request=useCallback((path,method='POST',body,signal)=>apiFetch(path.startsWith('/api/')?path:'/api/bioart'+path,{token,method,signal,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),[token]);
  async function task(action,{consent=false,clearConsent,scope:where='action'}={}){
    if(clearConsent)clearConsent(false);
    setScope(where);setBusy(true);setError('');
    try{await action(consent);setAuthExpired(false);}
    catch(reason){if(isAuthError(reason))setAuthExpired(true);else setError(describeBioArtError(reason,where,token));}
    finally{setBusy(false);}
  }
  const feedback=where=>scope===where&&<>{busy&&<p role="status" className="operation-status">BioArt request in progress…</p>}{error&&<p role="alert">{error}</p>}</>;
  async function search(consent){
    const data=await(await request('/search','POST',{query,allow_egress:consent})).json();
    setHits(data.hits);setEntry(null);setReceipt(null);setImported(null);setFetchEgress(false);
  }
  async function inspect(entryId,consent){
    const data=await(await request('/inspect','POST',{entry_id:entryId,allow_egress:consent})).json();
    setEntry(data);setFormat(formatOrder.find(candidate=>data.representations.some(item=>candidate in item.files))||'SVG');setRepresentation('auto');setReceipt(null);setImported(null);setFetchEgress(false);
  }
  async function fetchSource(consent){
    const body={entry_id:entry.entry_id,format,allow_egress:consent};
    if(representation!=='auto')body.representation_id=Number(representation);
    setReceipt(await(await request('/fetch','POST',body)).json());setImported(null);
  }
  async function importSource(){
    setImported(await(await request('/import','POST',{receipt_id:receipt.receipt_id})).json());
  }
  async function downloadSource(){
    const response=await request(receipt.download_url,'GET');
    await downloadResponse(response,`bioart-${receipt.entry_id}.${receipt.format.toLowerCase()}`);
  }
  const formats=useMemo(()=>entry?formatOrder.filter(candidate=>entry.representations.some(item=>candidate in item.files)):[],[entry]);
  const validEntryId=/^[0-9]+$/.test(entryId.trim())&&Number.isSafeInteger(Number(entryId))&&Number(entryId)>0;
  const nihSearchUrl='https://bioart.niaid.nih.gov/discover?'+new URLSearchParams({q:query.trim(),sort:'relevance'});
  return <div className="bioart-workspace" aria-busy={busy}>
    <aside className="bioart-search" aria-label="BioArt search">
      <p className="eyebrow">BIOART / NIH</p><h1>NIH BioArt illustrations.</h1>
      <p className="muted">Search matches the local cache; with consent, entry lookups (Inspect entry, below) fetch from NIH. Live NIH search is not available here. <a href={nihSearchUrl} target="_blank" rel="noreferrer">Open NIH search</a> to find an entry ID, then enter it below. Consent covers one search or inspection, then clears. Cached entries never contact NIH.</p>
      <label htmlFor="bioart-query">BioArt search query</label><input id="bioart-query" value={query} disabled={busy} onChange={event=>setQuery(event.target.value)}/>
      <label className="check"><input type="checkbox" checked={metadataEgress} disabled={busy} onChange={event=>setMetadataEgress(event.target.checked)}/>Permit NIH network access for the next search or inspection</label>
      <Button isDisabled={busy||!token||!query.trim()} onPress={()=>task(search,{consent:metadataEgress,clearConsent:setMetadataEgress,scope:'metadata'})}><Icon name="search"/>Search BioArt</Button>
      <LockNotice card={sessionState(token,authExpired)} tone={authExpired?'error':'info'} onUnlock={()=>focusTokenField(token,setToken)} unlockLabel={unlockLabel(token)}/>
      <label htmlFor="bioart-entry-id">NIH entry ID</label><input id="bioart-entry-id" inputMode="numeric" value={entryId} disabled={busy} aria-describedby="bioart-entry-id-help" aria-invalid={entryId.trim()!==''&&!validEntryId} onChange={event=>setEntryId(event.target.value)}/>
      <p id="bioart-entry-id-help" className="field-note">Enter only the number. For BIOART-000018, enter 18.</p>
      <Button variant="secondary" isDisabled={busy||!token||!validEntryId} onPress={()=>task(consent=>inspect(Number(entryId),consent),{consent:metadataEgress,clearConsent:setMetadataEgress,scope:'metadata'})}>Inspect entry</Button>
      {feedback('metadata')}
      <h2>Results</h2>
      {hits===null?<p className="muted">No search run in this session.</p>:hits.length?<div className="bioart-results-list">{hits.map(hit=><Button className="bioart-result" variant="ghost" key={hit.entry_id} isDisabled={busy||!token} onPress={()=>task(consent=>inspect(hit.entry_id,consent),{consent:metadataEgress,clearConsent:setMetadataEgress,scope:'metadata'})}>{hit.title} · BIOART-{String(hit.entry_id).padStart(6,'0')}</Button>)}</div>:<p>No entries match this query.</p>}
    </aside>
    <section className="bioart-main" aria-label="BioArt evidence workspace">
      {!entry?<div className="empty-state"><h2>No entry selected.</h2></div>:<>
        <div className="bioart-heading"><div><p className="eyebrow">BIOART-{String(entry.entry_id).padStart(6,'0')}</p><h2>{entry.title}</h2><a href={entry.source_url} target="_blank" rel="noreferrer">Open NIH source</a></div><div className="status-stack"><span className="status-chip">License per NIH: {entry.license}</span><span className="status-chip neutral">{receipt?`Verified ${receipt.format} · variant ${receipt.representation_id}`:'File not fetched yet'}</span></div></div>
        <div className="bioart-entry-grid">
          <section aria-labelledby="bioart-source-heading"><h2 id="bioart-source-heading">Source record</h2><dl className="bioart-metadata"><dt>Creator</dt><dd>{entry.creator}</dd><dt>Credit</dt><dd>{entry.credit}</dd><dt>Collection</dt><dd>{entry.collection}</dd><dt>Citation</dt><dd>{entry.citation}</dd></dl></section>
          <section aria-labelledby="bioart-fetch-heading"><h2 id="bioart-fetch-heading">Select source file</h2>
            <div className="bioart-control-row"><div><label htmlFor="bioart-format">Format</label><select id="bioart-format" value={format} disabled={busy} onChange={event=>{setFormat(event.target.value);setRepresentation('auto');setReceipt(null);setImported(null);setFetchEgress(false);}}>{formats.map(item=><option key={item} value={item}>{item}</option>)}</select>{formats.length===0&&<p className="field-note">This entry lists no downloadable files.</p>}</div>
              <div><label htmlFor="bioart-representation">Variant</label><select id="bioart-representation" value={representation} disabled={busy} onChange={event=>{setRepresentation(event.target.value);setReceipt(null);setImported(null);setFetchEgress(false);}}><option value="auto">Automatic (prefers a grey or black-and-white {format})</option>{entry.representations.map(item=><option key={item.group_id} value={String(item.group_id)} disabled={!(format in item.files)}>{item.caption}{format in item.files?'':` · no ${format} file`}</option>)}</select></div></div>
            <label className="check bioart-fetch-consent"><input type="checkbox" checked={fetchEgress} disabled={busy} onChange={event=>setFetchEgress(event.target.checked)}/>Permit NIH network access for this fetch</label>
            <Button isDisabled={busy||!formats.includes(format)} onPress={()=>task(fetchSource,{consent:fetchEgress,clearConsent:setFetchEgress,scope:'fetch'})}><Icon name="cloud-download"/>Fetch and verify {format}</Button>
            {feedback('fetch')}
            <p className="field-note">Automatic prefers a variant labelled grey, grayscale, or black-and-white that has this format.</p>
          </section>
        </div>
        <section className="bioart-representations" aria-labelledby="available-representations"><h2 id="available-representations">Available source variants</h2><div className="representation-list">{entry.representations.map(item=><div key={item.group_id}><strong>{item.caption}</strong><span>Variant {item.group_id} · {Object.keys(item.files).join(' · ')}</span></div>)}</div></section>
        {receipt&&<section className="bioart-receipt" aria-label="Verified fetch record">
          <div className="receipt-heading"><Icon name="shield-check"/><div><h2>File fetched and verified</h2><p>{receipt.caption} · file {receipt.file_id} · {receipt.format}</p></div></div>
          <div className="receipt-grid"><ProtectedPreview receipt={receipt} request={request} token={token}/><dl className="receipt-metadata"><dt>File SHA-256</dt><dd><code>{receipt.sha256}</code></dd><dt>NIH page SHA-256</dt><dd><code>{receipt.source_page_sha256}</code></dd><dt>Size</dt><dd>{receipt.size.toLocaleString()} {receipt.size===1?'byte':'bytes'}</dd><dt>Receipt ID</dt><dd><code>{receipt.receipt_id}</code></dd></dl></div>
          <div className="evidence-notes"><p>Rights metadata has not been independently verified; the credit and license are recorded from the NIH entry. Review the NIH entry and the retained credit before publication.</p><p>Scientific validity is not established by metadata, file checks, or appearance.</p></div>
          <div className="actions"><Button variant="secondary" isDisabled={busy} onPress={()=>task(downloadSource)}><Icon name="download"/>Download verified file</Button><Button isDisabled={busy||!receipt.import_eligible} onPress={()=>task(importSource)}><Icon name="import"/>{receipt.import_eligible?'Import verified SVG':`${receipt.format} import unavailable`}</Button></div>
          {(receipt.limitation||!receipt.import_eligible)&&<p className="field-note">{receipt.limitation||(receipt.format==='SVG'?'This SVG cannot be imported.':'Only SVG files can be imported.')}</p>}
          {feedback('action')}
          {imported&&<div className="import-record" role="status"><strong>Imported asset {imported.asset_id}</strong><span>Manifest: <code>{imported.asset_manifest}</code></span></div>}
        </section>}
      </>}
    </section>
  </div>;
}
