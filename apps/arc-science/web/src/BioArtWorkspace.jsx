import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Button} from '@heroui/react/button';
import {checkedFetch, downloadResponse} from './http';
import {Icon} from './icons';

const formatOrder=['SVG','PNG','AI','EPS'];

function ProtectedPreview({receipt,request}) {
  const [url,setUrl]=useState(''),[error,setError]=useState('');
  useEffect(()=>{
    if(!receipt?.preview_eligible)return;
    const controller=new AbortController();let ownedUrl;
    setUrl('');setError('');
    request(receipt.preview_url,'GET',undefined,controller.signal).then(response=>response.blob()).then(blob=>{
      if(!controller.signal.aborted){ownedUrl=URL.createObjectURL(blob);setUrl(ownedUrl);}
    }).catch(reason=>{if(!controller.signal.aborted&&reason.name!=='AbortError')setError(reason.message);});
    return ()=>{controller.abort();if(ownedUrl)URL.revokeObjectURL(ownedUrl);};
  },[receipt,request]);
  if(!receipt?.preview_eligible)return <div className="bioart-preview-stage"><p className="muted">This verified source is download-only; no browser preview is permitted.</p></div>;
  return <div className="bioart-preview-stage">{error?<p role="alert">Preview unavailable: {error}</p>:url?<img src={url} alt={'Verified BioArt preview: '+receipt.title}/>:<p role="status">Loading the authenticated preview…</p>}</div>;
}

export default function BioArtWorkspace({token,setToken}) {
  const [query,setQuery]=useState('antibody'),[metadataEgress,setMetadataEgress]=useState(false),[fetchEgress,setFetchEgress]=useState(false);
  const [hits,setHits]=useState(null),[entry,setEntry]=useState(null),[receipt,setReceipt]=useState(null),[imported,setImported]=useState(null);
  const [format,setFormat]=useState('SVG'),[representation,setRepresentation]=useState('auto');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const request=useCallback((path,method='POST',body,signal)=>checkedFetch(path.startsWith('/api/')?path:'/api/bioart'+path,{method,signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),[token]);
  async function task(action,{consent=false,clearConsent}={}){
    if(clearConsent)clearConsent(false);
    setBusy(true);setError('');try{await action(consent);}catch(reason){setError(reason.message);}finally{setBusy(false);}
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
  return <div className="bioart-workspace" aria-busy={busy}>
    <aside className="bioart-search" aria-label="BioArt search">
      <p className="eyebrow">BIOART / NIH</p><h1>Source vectors.</h1>
      <p className="muted">Search recorded metadata first. Permit a live NIH request only when the project cache is missing or stale.</p>
      <label htmlFor="bioart-token">Operator token for BioArt</label><input id="bioart-token" type="password" value={token} onChange={event=>setToken(event.target.value)} autoComplete="off"/>
      <p className="field-note">Shared with Research in memory only.</p>
      <label htmlFor="bioart-query">BioArt search query</label><input id="bioart-query" value={query} onChange={event=>setQuery(event.target.value)}/>
      <label className="check"><input type="checkbox" checked={metadataEgress} onChange={event=>setMetadataEgress(event.target.checked)}/>Permit NIH network access for the next search or inspection</label>
      <Button isDisabled={busy||!token||!query.trim()} onPress={()=>task(search,{consent:metadataEgress,clearConsent:setMetadataEgress})}><Icon name="search"/>Search NIH BioArt</Button>
      <p className="field-note">Consent is consumed by one action and then cleared. Cache hits remain offline.</p>
      {busy&&<p role="status" className="operation-status">BioArt request in progress…</p>}
      <h2>Results</h2>
      {hits===null?<p className="muted">No search run in this session.</p>:hits.length?<div className="bioart-results-list">{hits.map(hit=><Button className="bioart-result" variant="ghost" key={hit.entry_id} isDisabled={busy} onPress={()=>task(consent=>inspect(hit.entry_id,consent),{consent:metadataEgress,clearConsent:setMetadataEgress})}>{hit.title} · BIOART-{String(hit.entry_id).padStart(6,'0')}</Button>)}</div>:<p>No matching entries in the returned metadata.</p>}
    </aside>
    <section className="bioart-main" aria-label="BioArt evidence workspace">
      {error&&<p role="alert" className="bioart-error">{error}</p>}
      {!entry?<div className="empty-state"><h2>Select source artwork with its evidence attached.</h2><p>Arc retains the entry identity, creator, credit, license label, source-page hash, file mapping, and immutable source hash.</p></div>:<>
        <div className="bioart-heading"><div><p className="eyebrow">BIOART-{String(entry.entry_id).padStart(6,'0')}</p><h1>{entry.title}</h1><a href={entry.source_url} target="_blank" rel="noreferrer">Open NIH source ↗</a></div><div className="status-stack"><span className="status-chip">NIH metadata: {entry.license}</span><span className="status-chip neutral">{receipt?`Verified ${receipt.format} · group ${receipt.representation_id}`:'Source not yet fetched'}</span></div></div>
        <div className="bioart-entry-grid">
          <section aria-labelledby="bioart-source-heading"><h2 id="bioart-source-heading">Source record</h2><dl className="bioart-metadata"><dt>Creator</dt><dd>{entry.creator}</dd><dt>Credit</dt><dd>{entry.credit}</dd><dt>Collection</dt><dd>{entry.collection}</dd><dt>Citation</dt><dd>{entry.citation}</dd></dl></section>
          <section aria-labelledby="bioart-fetch-heading"><h2 id="bioart-fetch-heading">Select source file</h2>
            <div className="bioart-control-row"><div><label htmlFor="bioart-format">Format</label><select id="bioart-format" value={format} onChange={event=>{setFormat(event.target.value);setRepresentation('auto');setReceipt(null);setImported(null);setFetchEgress(false);}}>{formats.map(item=><option key={item} value={item}>{item}</option>)}</select></div>
              <div><label htmlFor="bioart-representation">Representation</label><select id="bioart-representation" value={representation} onChange={event=>{setRepresentation(event.target.value);setReceipt(null);setImported(null);setFetchEgress(false);}}><option value="auto">Automatic · neutral compatible {format}</option>{entry.representations.map(item=><option key={item.group_id} value={String(item.group_id)} disabled={!(format in item.files)}>{item.caption}{format in item.files?'':' · format unavailable'}</option>)}</select></div></div>
            <label className="check bioart-fetch-consent"><input type="checkbox" checked={fetchEgress} onChange={event=>setFetchEgress(event.target.checked)}/>Permit NIH network access for this fetch</label>
            <Button isDisabled={busy||!formats.includes(format)} onPress={()=>task(fetchSource,{consent:fetchEgress,clearConsent:setFetchEgress})}><Icon name="cloud-download"/>Fetch verified {format}</Button>
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
      <footer>BioArt assets remain source artwork. Arc records provenance and validation state; it does not infer reuse rights or scientific correctness.</footer>
    </section>
  </div>;
}
