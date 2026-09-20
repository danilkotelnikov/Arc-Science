import React, {Suspense, lazy, useCallback, useEffect, useState} from 'react';
import MolecularRenderPanel, {MolecularRenderResult, stageLine} from './MolecularRenderPanel';
import {checkedFetch} from './http';

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

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
  // A selected render supplies its own coordinates; the upload already shown is reused
  // only when its digest is the one the render recorded, never by name.
  useEffect(() => {
    if (!token || !renderJob || source?.job === renderJob.id) return undefined;
    const controller = new AbortController();
    (async () => {
      const captured = source;
      if (captured?.origin === 'upload' && captured.job === undefined && captured.digest === undefined) {
        const digest = await sha256Hex(captured.text).catch(() => null);
        if (controller.signal.aborted) return;
        // Only the very upload that was hashed may take the digest and the job; a file
        // chosen meanwhile is left alone and will be hashed on its own.
        if (digest && digest === renderJob.source_sha256) { setSource(current => current === captured ? {...current, digest, job: renderJob.id} : current); return; }
      }
      try {
        const response = await checkedFetch('/api/molecular/renders/' + renderJob.id + '/source', {signal: controller.signal, headers: {Authorization: 'Bearer ' + token}});
        const text = await response.text();
        if (!controller.signal.aborted) { setSource({filename: renderJob.filename, text, origin: 'job', job: renderJob.id, digest: renderJob.source_sha256}); setScene(null); }
      } catch { /* the viewer keeps what it has; the render result still opens */ }
    })();
    return () => controller.abort();
  }, [token, renderJob?.id, source]);
  // Contacts are overlaid as soon as the pipeline has written them (provisional while it
  // still renders, verified once the artifacts are collected).
  useEffect(() => {
    if (!token || !renderJob || !hasContacts(renderJob)) return undefined;
    if (scene?.job === renderJob.id && (scene.state === 'verified' || renderJob.status !== 'completed')) return undefined;
    const controller = new AbortController();
    checkedFetch('/api/molecular/renders/' + renderJob.id + '/scene', {signal: controller.signal, headers: {Authorization: 'Bearer ' + token}})
      .then(async r => ({data: await r.json(), state: r.headers.get('X-Arc-Scene') || 'provisional'}))
      .then(({data, state}) => { if (!controller.signal.aborted) setScene({...data, job: renderJob.id, state}); })
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
