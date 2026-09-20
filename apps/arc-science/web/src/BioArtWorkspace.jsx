import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Button} from '@heroui/react/button';
import {apiFetch, downloadResponse} from './http';
import {Icon} from './icons';

const formatOrder=['SVG','PNG','AI','EPS'];
const AUTH_RECOVERY='BioArt is locked. Enter a valid operator token in the header, then try again.';

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

function sanitizeBioArtDetail(detail) {
  return detail
    .replace(/;?\s*explicit\s+--allow-egress\s+required\.?/ig,'')
    .replace(/search\s+--search-html\s+with\s+an\s+operator-supplied\s+browser\s+DOM\s+snapshot/ig,'an operator-supplied browser snapshot')
    .replace(/\s+/g,' ')
    .trim();
}

function describeBioArtError(reason,recovery='metadata') {
  const message=errorMessage(reason);
  const status=detailAfterStatus(message);
  if (/Operator token is required/i.test(message) || status?.status===401 || status?.status===403) return AUTH_RECOVERY;
  if (isOfflineError(message)) return 'Arc Science cannot reach the local BioArt service. Check that the desktop service is running, then retry.';
  if (status?.status===409 && /Missing or stale cache/i.test(status.detail)) {
    const target=recovery==='fetch'?'this fetch':'the next search or inspection';
    return `No cached BioArt source is available yet. Permit NIH network access for ${target}, then try again. Consent is used once and clears after the request.`;
  }
  if (status) {
    const detail=sanitizeBioArtDetail(status.detail);
    if (detail) return detail;
    return 'The BioArt request could not complete. Check the entry, consent, and local service, then retry.';
  }
  return sanitizeBioArtDetail(message) || 'The BioArt request could not complete. Check the entry, consent, and local service, then retry.';
}

function ProtectedPreview({receipt,request}) {
  const [url,setUrl]=useState(''),[error,setError]=useState('');
  useEffect(()=>{
    if(!receipt?.preview_eligible)return;
    const controller=new AbortController();let ownedUrl;
    setUrl('');setError('');
    request(receipt.preview_url,'GET',undefined,controller.signal).then(response=>response.blob()).then(blob=>{
      if(!controller.signal.aborted){ownedUrl=URL.createObjectURL(blob);setUrl(ownedUrl);}
    }).catch(reason=>{if(!controller.signal.aborted&&reason.name!=='AbortError')setError(describeBioArtError(reason));});
    return ()=>{controller.abort();if(ownedUrl)URL.revokeObjectURL(ownedUrl);};
  },[receipt,request]);
  if(!receipt?.preview_eligible)return <div className="bioart-preview-stage"><p className="muted">This verified source is download-only; no browser preview is permitted.</p></div>;
  return <div className="bioart-preview-stage">{error?<p role="alert">Preview unavailable: {error}</p>:url?<img src={url} alt={'Verified BioArt preview: '+receipt.title}/>:<p role="status">Loading the authenticated preview…</p>}</div>;
}

export default function BioArtWorkspace({token,setToken}) {
  const [query,setQuery]=useState('antibody'),[metadataEgress,setMetadataEgress]=useState(false),[fetchEgress,setFetchEgress]=useState(false);
  const [entryId,setEntryId]=useState('');
  const [hits,setHits]=useState(null),[entry,setEntry]=useState(null),[receipt,setReceipt]=useState(null),[imported,setImported]=useState(null);
  const [format,setFormat]=useState('SVG'),[representation,setRepresentation]=useState('auto');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const request=useCallback((path,method='POST',body,signal)=>apiFetch(path.startsWith('/api/')?path:'/api/bioart'+path,{token,method,signal,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),[token]);
  async function task(action,{consent=false,clearConsent,recovery}={}){
    if(clearConsent)clearConsent(false);
    setBusy(true);setError('');try{await action(consent);}catch(reason){setError(describeBioArtError(reason,recovery));}finally{setBusy(false);}
  }
  async function search(consent){
    const data=await(await request('/search','POST',{query,allow_egress:consent})).json();
    setHits(data.hits);setEntry(null);setReceipt(null);setImported(null);setFetchEgress(false);
  }
  async function inspect(entryId,consent){
    const data=await(await request('/inspect','POST',{entry_id:entryId,allow_egress:consent})).json();
    setEntry(data);setFormat('SVG');setRepresentation('auto');setReceipt(null);setImported(null);setFetchEgress(false);
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
      <p className="eyebrow">BIOART / NIH</p><h1>Source vectors.</h1>
      <p className="muted">Recorded metadata first; a live NIH request only with consent.</p>
      <label htmlFor="bioart-query">BioArt search query</label><input id="bioart-query" value={query} disabled={busy} onChange={event=>setQuery(event.target.value)}/>
      <label className="check"><input type="checkbox" checked={metadataEgress} disabled={busy} onChange={event=>setMetadataEgress(event.target.checked)}/>Permit NIH network access for the next search or inspection</label>
      <Button isDisabled={busy||!token||!query.trim()} onPress={()=>task(search,{consent:metadataEgress,clearConsent:setMetadataEgress,recovery:'metadata'})}><Icon name="search"/>Search NIH BioArt</Button>
      <p className="field-note">Consent covers one action. Cache hits stay offline.</p>
      <p className="field-note">NIH’s live search currently requires browser rendering. <a href={nihSearchUrl} target="_blank" rel="noreferrer">Open NIH search</a> to find an entry ID, then inspect it here.</p>
      <label htmlFor="bioart-entry-id">NIH entry ID</label><input id="bioart-entry-id" inputMode="numeric" value={entryId} disabled={busy} aria-describedby="bioart-entry-id-help" aria-invalid={entryId.trim()!==''&&!validEntryId} onChange={event=>setEntryId(event.target.value)}/>
      <p id="bioart-entry-id-help" className="field-note">Enter the positive whole-number ID. For BIOART-000018, enter 18.</p>
      <Button variant="secondary" isDisabled={busy||!token||!validEntryId} onPress={()=>task(consent=>inspect(Number(entryId),consent),{consent:metadataEgress,clearConsent:setMetadataEgress,recovery:'metadata'})}>Inspect entry</Button>
      {busy&&<p role="status" className="operation-status">BioArt request in progress…</p>}
      <h2>Results</h2>
      {hits===null?<p className="muted">No search run in this session.</p>:hits.length?<div className="bioart-results-list">{hits.map(hit=><Button className="bioart-result" variant="ghost" key={hit.entry_id} isDisabled={busy} onPress={()=>task(consent=>inspect(hit.entry_id,consent),{consent:metadataEgress,clearConsent:setMetadataEgress,recovery:'metadata'})}>{hit.title} · BIOART-{String(hit.entry_id).padStart(6,'0')}</Button>)}</div>:<p>No matching entries in the returned metadata.</p>}
    </aside>
    <section className="bioart-main" aria-label="BioArt evidence workspace">
      {error&&<p role="alert" className="bioart-error">{error}</p>}
      {!entry?<div className="empty-state"><h2>No entry selected.</h2></div>:<>
        <div className="bioart-heading"><div><p className="eyebrow">BIOART-{String(entry.entry_id).padStart(6,'0')}</p><h1>{entry.title}</h1><a href={entry.source_url} target="_blank" rel="noreferrer">Open NIH source ↗</a></div><div className="status-stack"><span className="status-chip">NIH metadata: {entry.license}</span><span className="status-chip neutral">{receipt?`Verified ${receipt.format} · group ${receipt.representation_id}`:'Source not yet fetched'}</span></div></div>
        <div className="bioart-entry-grid">
          <section aria-labelledby="bioart-source-heading"><h2 id="bioart-source-heading">Source record</h2><dl className="bioart-metadata"><dt>Creator</dt><dd>{entry.creator}</dd><dt>Credit</dt><dd>{entry.credit}</dd><dt>Collection</dt><dd>{entry.collection}</dd><dt>Citation</dt><dd>{entry.citation}</dd></dl></section>
          <section aria-labelledby="bioart-fetch-heading"><h2 id="bioart-fetch-heading">Select source file</h2>
            <div className="bioart-control-row"><div><label htmlFor="bioart-format">Format</label><select id="bioart-format" value={format} disabled={busy} onChange={event=>{setFormat(event.target.value);setRepresentation('auto');setReceipt(null);setImported(null);setFetchEgress(false);}}>{formats.map(item=><option key={item} value={item}>{item}</option>)}</select></div>
              <div><label htmlFor="bioart-representation">Representation</label><select id="bioart-representation" value={representation} disabled={busy} onChange={event=>{setRepresentation(event.target.value);setReceipt(null);setImported(null);setFetchEgress(false);}}><option value="auto">Automatic · neutral compatible {format}</option>{entry.representations.map(item=><option key={item.group_id} value={String(item.group_id)} disabled={!(format in item.files)}>{item.caption}{format in item.files?'':' · format unavailable'}</option>)}</select></div></div>
            <label className="check bioart-fetch-consent"><input type="checkbox" checked={fetchEgress} disabled={busy} onChange={event=>setFetchEgress(event.target.checked)}/>Permit NIH network access for this fetch</label>
            <Button isDisabled={busy||!formats.includes(format)} onPress={()=>task(fetchSource,{consent:fetchEgress,clearConsent:setFetchEgress,recovery:'fetch'})}><Icon name="cloud-download"/>Fetch verified {format}</Button>
            <p className="field-note">Automatic selection prefers an explicitly grey, grayscale, or black-and-white representation that contains the requested format.</p>
          </section>
        </div>
        <section className="bioart-representations" aria-labelledby="available-representations"><h2 id="available-representations">Available source variants</h2><div className="representation-list">{entry.representations.map(item=><div key={item.group_id}><strong>{item.caption}</strong><span>Group {item.group_id} · {Object.keys(item.files).join(' · ')}</span></div>)}</div></section>
        {receipt&&<section className="bioart-receipt" aria-label="Verified receipt">
          <div className="receipt-heading"><Icon name="shield-check"/><div><h2>Receipt verified</h2><p>{receipt.caption} · file {receipt.file_id} · {receipt.format}</p></div></div>
          <div className="receipt-grid"><ProtectedPreview receipt={receipt} request={request}/><dl className="receipt-metadata"><dt>Source SHA-256</dt><dd><code>{receipt.sha256}</code></dd><dt>Source page SHA-256</dt><dd><code>{receipt.source_page_sha256}</code></dd><dt>Size</dt><dd>{receipt.size.toLocaleString()} bytes</dd><dt>Receipt</dt><dd><code>{receipt.receipt_id}</code></dd></dl></div>
          <div className="evidence-notes"><p>Rights metadata has not been independently verified. Review the NIH entry and retained credit before publication.</p><p>Scientific validity is not established by metadata parsing, file validation, or visual quality.</p>{receipt.limitation&&<p>{receipt.limitation}</p>}</div>
          <div className="actions"><Button variant="secondary" isDisabled={busy} onPress={()=>task(downloadSource)}><Icon name="download"/>Download verified source</Button><Button isDisabled={busy||!receipt.import_eligible} onPress={()=>task(importSource)}><Icon name="import"/>{receipt.import_eligible?'Import verified SVG':`${receipt.format} import unavailable`}</Button></div>
          {imported&&<div className="import-record" role="status"><strong>Imported asset {imported.asset_id}</strong><code>{imported.asset_manifest}</code></div>}
        </section>}
      </>}
      <footer>Reuse rights are not inferred; the entry's own credit and license are recorded.</footer>
    </section>
  </div>;
}
