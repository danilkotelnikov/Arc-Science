import React, {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {checkedFetch} from './http';

// Prose control: a rule-based local rewrite that never touches scientific content, and
// third-party AI-detection that needs consent on every request because the text leaves
// this machine. Nothing here is an authorship or validity claim, and neither result has
// any bearing on a release decision.
export default function ProseWorkspace({token, setToken}) {
  const [text, setText] = useState(''), [rules, setRules] = useState(null);
  const [rewritten, setRewritten] = useState(null), [receipt, setReceipt] = useState(null);
  const [consent, setConsent] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  // Humane prose: local diagnostics (nothing leaves), and a rewrite by the operator's own
  // prose seat under the behaviour text, with its own consent because the text leaves.
  const [diagnosis, setDiagnosis] = useState(null), [humane, setHumane] = useState(null), [seatConsent, setSeatConsent] = useState(false);
  const [instructions, setInstructions] = useState(''), [behaviour, setBehaviour] = useState(null);
  const credential = useRef(null);
  useLayoutEffect(() => {
    const controller = new AbortController(); credential.current = controller;
    setText(''); setRules(null); setRewritten(null); setReceipt(null); setConsent(false); setError(''); setBusy(false);
    setDiagnosis(null); setHumane(null); setSeatConsent(false); setInstructions(''); setBehaviour(null);
    return () => controller.abort();
  }, [token]);
  const read = useCallback(async (path, signal, method = 'GET', body) => {
    signal.throwIfAborted();
    const response = await checkedFetch('/api/prose' + path, {
      method, signal, headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    signal.throwIfAborted();
    return data;
  }, [token]);
  async function task(action) {
    const signal = credential.current.signal;
    setBusy(true); setError('');
    try { await action(signal); }
    catch (e) { if (!signal.aborted) setError(e.message); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  async function loadRules(signal) { setRules(await read('/rules', signal)); }
  async function rewrite(signal) { setRewritten(await read('/rewrite', signal, 'POST', {text})); }
  async function detect(signal) {
    // Consent is spent on this one request, whatever its outcome; the next one asks again.
    const granted = consent; setConsent(false);
    setReceipt(await read('/detect', signal, 'POST', {text, allow_egress: granted}));
  }
  async function diagnose(signal) { setDiagnosis(await read('/diagnose', signal, 'POST', {text})); }
  async function humanise(signal) {
    const granted = seatConsent; setSeatConsent(false);
    setHumane(await read('/humanise', signal, 'POST', {text, allow_egress: granted, instructions}));
  }
  async function loadBehaviour(signal) { setBehaviour(await read('/behaviour', signal)); }
  const detection = rules?.detection;
  return <div className="research-workspace">
    <aside className="research-form">
      <p className="eyebrow">PROSE / CONTROL</p><h1>Edit the words, not the evidence.</h1>
      <p className="muted">A rule-based rewrite on this machine that leaves numbers, identifiers, citations, units and code untouched.</p>
      <label htmlFor="prose-text">Text</label>
      <textarea id="prose-text" rows={10} value={text} disabled={busy} onChange={e => setText(e.target.value)} maxLength={20000}/>
      <p className="field-note">{text.length.toLocaleString()} / 20,000 characters.</p>
      <div className="actions">
        <Button isDisabled={busy || !token || !text.trim()} onPress={() => task(rewrite)}>Rewrite locally</Button>
        <Button variant="secondary" isDisabled={busy || !token || !text.trim()} onPress={() => task(diagnose)}>Diagnose locally</Button>
        <Button variant="secondary" isDisabled={busy || !token} onPress={() => task(loadRules)}>{rules ? 'Reload rules' : 'Show rules and detection terms'}</Button>
      </div>
      <fieldset className="prose-detect"><legend>Seat rewrite</legend>
        <p className="field-note">Sends the text to the prose seat configured in Settings and asks for its edit under the humane-prose behaviour; every protected span must come back byte for byte or nothing is returned.</p>
        <label htmlFor="prose-instructions">Instructions to the seat (optional)</label>
        <input id="prose-instructions" value={instructions} disabled={busy} maxLength={2000} onChange={e => setInstructions(e.target.value)} placeholder="e.g. keep British spelling; it is a grant abstract"/>
        <label className="check"><input type="checkbox" checked={seatConsent} disabled={busy} onChange={e => setSeatConsent(e.target.checked)}/>I consent to sending this text to the prose seat's provider for this one request.</label>
        <div className="actions">
          <Button variant="secondary" isDisabled={busy || !token || !seatConsent || !text.trim()} onPress={() => task(humanise)}>Rewrite with the prose seat (sends text)</Button>
          <Button variant="ghost" size="sm" isDisabled={busy || !token} onPress={() => task(loadBehaviour)}>{behaviour ? 'Hide behaviour' : 'Show the behaviour'}</Button>
        </div>
      </fieldset>
      <fieldset className="prose-detect"><legend>Third-party detection</legend>
        <p className="field-note">{detection ? (detection.enabled ? `Sends the text to ${detection.recipient} (${detection.detectors.join(', ')}); ${detection.bounds.min_chars}–${detection.bounds.max_chars.toLocaleString()} characters.` : 'Detection is switched off on this service.') : 'Load the rules to see where the text would be sent.'}</p>
        <label className="check"><input type="checkbox" checked={consent} disabled={busy || !detection?.enabled} onChange={e => setConsent(e.target.checked)}/>I consent to sending this text to api.edgeshop.ai for this one request.</label>
        <Button variant="secondary" isDisabled={busy || !token || !consent || text.length < 20} onPress={() => task(detect)}>Detect (sends text)</Button>
      </fieldset>
      {busy && <p role="status">Prose request in progress…</p>}
      {error && <p role="alert">{error}</p>}
    </aside>
    <section className="research-results" aria-label="Prose results">
      <h2>Diagnosis</h2>
      {diagnosis ? <div className="record" aria-label="Prose diagnosis">
        <h3>{diagnosis.edit_categories.length ? diagnosis.edit_categories.join(' · ') : 'No edit category indicated'} · {diagnosis.protected_count} protected spans</h3>
        <dl className="receipt-metadata">
          <dt>Style words</dt><dd>{diagnosis.observations.style_words.count} ({diagnosis.observations.style_words.per_1000_words} per 1,000 words){Object.keys(diagnosis.observations.style_words.words).length ? ': ' + Object.entries(diagnosis.observations.style_words.words).map(([w, n]) => w + (n > 1 ? ' ×' + n : '')).join(', ') : ''}</dd>
          <dt>Formulaic frames</dt><dd>{diagnosis.observations.formulaic_frames.count ? diagnosis.observations.formulaic_frames.instances.map(f => f.label + ': “' + f.text.trim() + '”').join(' · ') : 'none'}</dd>
          <dt>Sentence length</dt><dd>{diagnosis.observations.sentence_length.sentences} sentences · mean {diagnosis.observations.sentence_length.mean_words} words · spread {diagnosis.observations.sentence_length.spread_words} · {Math.round(diagnosis.observations.sentence_length.share_within_20pct_of_mean * 100)}% within 20% of the mean</dd>
          <dt>Repeated openings</dt><dd>{Object.keys(diagnosis.observations.repeated_openings.openings).length ? Object.entries(diagnosis.observations.repeated_openings.openings).map(([o, n]) => '“' + o + '” ×' + n).join(', ') : 'none'}</dd>
          <dt>Triplets · closing summaries · bullets</dt><dd>{diagnosis.observations.triplets.count} · {diagnosis.observations.closing_summaries.count} of {diagnosis.observations.closing_summaries.paragraphs} paragraphs · {diagnosis.observations.bullets.count}</dd>
        </dl>
        <p className="muted">{diagnosis.note}</p>
      </div> : <p className="muted">No diagnosis yet.</p>}
      <h2>Seat rewrite</h2>
      {humane ? <div className="record" data-status={humane.status}>
        <h3>{humane.status === 'edited' ? 'Edited by the prose seat' : 'Returned unchanged'} · {humane.protected_count} protected spans preserved{humane.transport ? ' · ' + humane.transport.provider + ' ' + humane.transport.requested_model + (humane.transport.observed_model ? ' (observed ' + humane.transport.observed_model + ')' : ' (identity requested-only)') : ''}</h3>
        <pre className="prose-output">{humane.text}</pre>
        {humane.notes.length > 0 && <ul className="edits">{humane.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        {humane.facts_needed.length > 0 && <p className="muted">Facts needed from the author: {humane.facts_needed.join('; ')}</p>}
        <p className="muted">{humane.statement}</p>
      </div> : <p className="muted">No seat rewrite yet.</p>}
      {behaviour && <details className="record" open><summary>Behaviour {behaviour.version}</summary><pre className="prose-output">{behaviour.text}</pre></details>}
      <h2>Local rewrite</h2>
      {rewritten ? <div className="record" data-status={rewritten.status}>
        <h3>{rewritten.status === 'edited' ? `${rewritten.edits.reduce((n, e) => n + e.count, 0)} edits` : 'No change'}{rewritten.reason ? ` · ${rewritten.reason.replace(/_/g, ' ')}` : ''} · {rewritten.protected_count} protected spans ({rewritten.protected_classes.join(', ') || 'none'})</h3>
        <pre className="prose-output">{rewritten.text}</pre>
        {rewritten.edits.length > 0 && <ul className="edits">{rewritten.edits.map(e => <li key={e.rule}>{e.rule} ×{e.count}: “{e.before}” → “{e.after || '∅'}”</li>)}</ul>}
        <p className="muted">{rewritten.statement} Rules {rewritten.rules_version}, protection {rewritten.protection_version}.</p>
      </div> : <p className="muted">No rewrite yet.</p>}
      <h2>Detection receipt</h2>
      {receipt ? <div className="record" data-complete={String(receipt.complete)}>
        <h3>{receipt.service} · {receipt.returned_types.join(', ') || 'no detector answered'}{receipt.missing_types.length ? ` · missing ${receipt.missing_types.join(', ')}` : ''}</h3>
        <dl className="receipt-metadata">{Object.entries(receipt.results).map(([type, result]) => <React.Fragment key={type}><dt>{type}</dt><dd>{Object.entries(result).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}</dd></React.Fragment>)}
          <dt>Text SHA-256</dt><dd><code>{receipt.text_sha256}</code></dd><dt>Response SHA-256</dt><dd><code>{receipt.response_sha256}</code></dd></dl>
        <p className="muted">{receipt.note}</p>
      </div> : <p className="muted">No detection yet.</p>}
      {rules && <details className="record"><summary>Rules ({rules.rules.length}) and protected classes ({rules.protected_classes.length})</summary>
        <ul className="edits">{rules.rules.map(r => <li key={r.rule}><code>{r.rule}</code>: <code>{r.pattern}</code> → “{r.replacement || '∅'}”</li>)}</ul>
        <p className="muted">Protected: {rules.protected_classes.join(', ')}.</p></details>}
    </section>
  </div>;
}
