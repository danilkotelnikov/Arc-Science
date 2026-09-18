import React, {useCallback, useEffect, useState} from 'react';
import {Button} from '@heroui/react/button';
import {Tabs} from '@heroui/react/tabs';
import {checkedFetch, downloadResponse} from './http';
import {Icon} from './icons';
import MolecularRenderPanel, {MolecularRenderResult} from './MolecularRenderPanel';

const views = [['collage','Collage'],['overview','Full complex'],['interface','Interface'],['rotated','Rotated detail']];
const nativeNames = {overview:'full complex',interface:'interface',rotated:'rotated detail'};

export default function MolecularWorkspace({token,setToken}) {
  const [example,setExample]=useState(null), [error,setError]=useState(''), [view,setView]=useState('collage');
  const [zoom,setZoom]=useState(100), [busy,setBusy]=useState(false), [attempt,setAttempt]=useState(0);
  const [renderSelection,setRenderSelection]=useState(null),[showRender,setShowRender]=useState(false);
  const updateRender=useCallback(job=>setRenderSelection({token,job}),[token]);
  const renderJob=renderSelection?.token===token?renderSelection.job:null;
  const generated=showRender&&renderJob;
  useEffect(()=>{setRenderSelection(null);setShowRender(false);},[token]);
  useEffect(()=>{
    const controller=new AbortController();
    checkedFetch('/api/examples/1dqj',{signal:controller.signal}).then(r=>r.json()).then(setExample)
      .catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return ()=>controller.abort();
  },[attempt]);
  async function download(name) {
    setError('');setBusy(true);
    try { await downloadResponse(await checkedFetch(example.assets[name].url),'1dqj-'+name); }
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  if(!example)return <div className="workspace-message">{error?<><p role="alert">{error}</p><Button variant="secondary" onPress={()=>{setError('');setAttempt(n=>n+1);}}>Retry example</Button></>:<p role="status">Loading the frozen molecular example…</p>}</div>;
  return <div className="molecular-workspace">
    <aside className="inspector" aria-label={generated?'Molecular render controls':'Molecular example details'}>
      <p className="eyebrow">{generated?'MOLECULAR WORKBENCH':'EXAMPLE / 01'}</p><h1>{generated?'Your structure':example.title}</h1>
      {!generated&&<a href={example.source.url} target="_blank" rel="noreferrer">{example.source.id} ↗ RCSB PDB</a>}
      <MolecularRenderPanel token={token} setToken={setToken} onJobChange={updateRender} onShowJob={setShowRender}/>
      {!generated&&<><dl><dt>Structure</dt><dd>Model {example.source.model} · Assembly {example.source.assembly}</dd>
        <dt><span className="partner antibody"/>Antibody</dt><dd>Author chains {example.partners.antibody.join(' + ')}</dd>
        <dt><span className="partner antigen"/>Antigen</dt><dd>Author chain {example.partners.antigen.join(' + ')}</dd>
        <dt>Geometric contacts</dt><dd>{example.contact_pairs} residue pairs · ≤ {example.cutoff_angstrom} Å</dd></dl>
      <div className="inspector-section"><h2>Review record</h2><p>{example.review.status}</p><p className="muted">Illustration acceptance only. Live-provider and browser-layout qualification not established.</p></div>
      <details className="inspector-section"><summary>Interpretation & limits</summary>{example.limitations.map(item=><p key={item}>{item}</p>)}<p>Dashed separations are not inferred hydrogen bonds. Proximity does not establish affinity.</p></details>
      <details className="inspector-section"><summary>Source & downloads</summary>
        {Object.keys(nativeNames).map(name=><Button key={name} variant="ghost" size="sm" isDisabled={busy} onPress={()=>download(name+'.png')}>Native {nativeNames[name]} PNG (unlabeled)</Button>)}
        {['collage.png','contacts.csv','source.cif','scene.json','molecular_worker.py','integrity.json','caption.md','visual-review.md'].map(name=><Button key={name} variant="ghost" size="sm" isDisabled={busy} onPress={()=>download(name)}>{name}</Button>)}
        <p className="muted">Native PNGs retain transparency. Editable .blend scenes are in the separately delivered bundle, not this public package.</p>
      </details></>}
    </aside>
    {generated?<MolecularRenderResult key={token+':'+renderJob.id} token={token} job={renderJob} onReturn={()=>setShowRender(false)}/>:<section className="figure-workspace" aria-label="Molecular figure">
      <div className="figure-toolbar">
        <Tabs selectedKey={view} onSelectionChange={setView} aria-label="Molecular views"><Tabs.List>{views.map(([id,label])=><Tabs.Tab id={id} key={id}>{label}<Tabs.Indicator/></Tabs.Tab>)}</Tabs.List></Tabs>
        <Button size="sm" isDisabled={busy} onPress={()=>download(view+'.svg')}><Icon name="download"/>Export SVG</Button>
      </div>
      {error&&<p role="alert" className="error-line">{error}</p>}
      <div className="figure-stage"><img alt={'Annotated '+view} src={example.assets[view+'.svg'].url} style={{width:zoom+'%',maxWidth:'none'}} onError={()=>setError('Could not display the selected molecular artifact. Try downloading the source SVG.')}/></div>
      <div className="stage-footer"><span>{view==='collage'?'Frozen candidate 03 · original hybrid SVG':view==='rotated'?'Three nearest residue pairs · annotated 65° detail':'Annotated viewport of the original collage'}</span><div className="zoom-controls"><Button aria-label="Zoom out" size="sm" variant="ghost" isDisabled={zoom<=50} onPress={()=>setZoom(z=>Math.max(50,z-25))}>−</Button><Button aria-label="Reset zoom" size="sm" variant="ghost" onPress={()=>setZoom(100)}>{zoom}%</Button><Button aria-label="Zoom in" size="sm" variant="ghost" isDisabled={zoom>=250} onPress={()=>setZoom(z=>Math.min(250,z+25))}>+</Button></div></div>
    </section>}
  </div>;
}
