import React, {useCallback, useEffect, useState} from 'react';
import MolecularRenderPanel, {MolecularRenderResult} from './MolecularRenderPanel';

// The workbench opens on the operator's own renders: no packaged example collage.
export default function MolecularWorkspace({token,setToken}) {
  const [renderSelection,setRenderSelection]=useState(null),[showRender,setShowRender]=useState(false);
  const updateRender=useCallback(job=>setRenderSelection({token,job}),[token]);
  const renderJob=renderSelection?.token===token?renderSelection.job:null;
  const generated=showRender&&renderJob;
  useEffect(()=>{setRenderSelection(null);setShowRender(false);},[token]);
  return <div className="molecular-workspace">
    <aside className="inspector" aria-label="Molecular render controls">
      <p className="eyebrow">MOLECULAR WORKBENCH</p><h1>Your structure</h1>
      <p className="muted">Render a complex from your own coordinates with the local pipeline.</p>
      <MolecularRenderPanel token={token} setToken={setToken} onJobChange={updateRender} onShowJob={setShowRender}/>
    </aside>
    {generated?<MolecularRenderResult key={token+':'+renderJob.id} token={token} job={renderJob} onReturn={()=>setShowRender(false)}/>
      :<section className="figure-workspace" aria-label="Molecular figure"><div className="workspace-message"><p role="status">No render selected.</p></div></section>}
  </div>;
}
