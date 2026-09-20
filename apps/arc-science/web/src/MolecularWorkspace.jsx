import React, {Suspense, lazy, useCallback, useEffect, useState} from 'react';
import MolecularRenderPanel, {MolecularRenderResult, stageLine} from './MolecularRenderPanel';
import {checkedFetch} from './http';

// Mol* is its own chunk: the workbench loads it the first time a structure is shown.
const MolecularViewer = lazy(() => import('./MolecularViewer'));
const hasContacts = job => job?.status === 'completed' || (job?.stages || []).some(s => s.stage === 'contacts_ready');

// The workbench opens on the operator's own coordinates: the viewer shows a chosen file
// at once, a selected render's coordinates when it is picked, and the pipeline's
// contacts the moment they are computed. No packaged example is served.
export default function MolecularWorkspace({token, setToken}) {
  const [renderSelection, setRenderSelection] = useState(null), [showRender, setShowRender] = useState(false);
  const [source, setSource] = useState(null), [scene, setScene] = useState(null), [defaults, setDefaults] = useState(null);
  const updateRender = useCallback(job => setRenderSelection({token, job}), [token]);
  const renderJob = renderSelection?.token === token ? renderSelection.job : null;
  const generated = showRender && renderJob;
  useEffect(() => { setRenderSelection(null); setShowRender(false); setSource(null); setScene(null); }, [token]);
  // The viewer's defaults are the operator's settings; without them the viewer keeps its own.
  useEffect(() => {
    if (!token) return undefined;
    const controller = new AbortController();
    checkedFetch('/api/settings', {signal: controller.signal, headers: {Authorization: 'Bearer ' + token}})
      .then(r => r.json()).then(snap => { if (!controller.signal.aborted) setDefaults(snap.settings?.viewer || null); })
      .catch(() => {});
    return () => controller.abort();
  }, [token]);
  // A selected render supplies its own coordinates unless the same upload is already shown.
  useEffect(() => {
    if (!token || !renderJob) return undefined;
    if (source?.origin === 'upload' && source.filename === renderJob.filename && source.job === undefined) {
      setSource(current => ({...current, job: renderJob.id}));
      return undefined;
    }
    if (source?.job === renderJob.id) return undefined;
    const controller = new AbortController();
    checkedFetch('/api/molecular/renders/' + renderJob.id + '/source', {signal: controller.signal, headers: {Authorization: 'Bearer ' + token}})
      .then(r => r.text()).then(text => { if (!controller.signal.aborted) { setSource({filename: renderJob.filename, text, origin: 'job', job: renderJob.id}); setScene(null); } })
      .catch(() => {});
    return () => controller.abort();
  }, [token, renderJob?.id]);
  // Contacts are overlaid as soon as the pipeline has written them, while it still renders.
  useEffect(() => {
    if (!token || !renderJob || !hasContacts(renderJob) || scene?.job === renderJob.id) return undefined;
    const controller = new AbortController();
    checkedFetch('/api/molecular/renders/' + renderJob.id + '/scene', {signal: controller.signal, headers: {Authorization: 'Bearer ' + token}})
      .then(r => r.json()).then(data => { if (!controller.signal.aborted) setScene({...data, job: renderJob.id}); })
      .catch(() => {});
    return () => controller.abort();
  }, [token, renderJob?.id, renderJob?.status, (renderJob?.stages || []).length]);
  const overlay = scene && renderJob && scene.job === renderJob.id && source?.job === renderJob.id ? scene : null;
  const stage = renderJob && source?.job === renderJob.id ? (renderJob.status === 'completed' ? 'render complete' : stageLine(renderJob) || renderJob.status) : '';
  return <div className="molecular-workspace">
    <aside className="inspector" aria-label="Molecular render controls">
      <p className="eyebrow">MOLECULAR WORKBENCH</p><h1>Your structure</h1>
      <p className="muted">Render a complex from your own coordinates with the local pipeline.</p>
      <MolecularRenderPanel token={token} setToken={setToken} onJobChange={updateRender} onShowJob={setShowRender} onSource={setSource}/>
    </aside>
    {generated ? <MolecularRenderResult key={token + ':' + renderJob.id} token={token} job={renderJob} onReturn={() => setShowRender(false)}/>
      : source ? <section className="figure-workspace" aria-label="Molecular figure"><Suspense fallback={<div className="workspace-message"><p role="status">Loading the viewer…</p></div>}>
          <MolecularViewer source={source} scene={overlay} defaults={defaults} stage={stage}/>
        </Suspense></section>
      : <section className="figure-workspace" aria-label="Molecular figure"><div className="workspace-message"><p role="status">Choose a coordinate file or a saved render to view it.</p></div></section>}
  </div>;
}
