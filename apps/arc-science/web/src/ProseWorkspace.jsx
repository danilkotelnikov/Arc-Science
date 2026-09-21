import React, {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {SESSION_COPY, apiFetch, sessionState} from './http';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';

// Prose control: a rule-based local rewrite that never touches scientific content, and
// third-party AI-detection that needs consent on every request because the text leaves
// this machine. Nothing here is an authorship or validity claim, and neither result has
// any bearing on a release decision.

// Each action reports under its own group: what is running, or what failed and why.
const ACTION = {
  rewrite: {name: 'Rewrite locally', group: 'local', doing: 'Rewriting locally…'},
  diagnose: {name: 'Diagnose locally', group: 'local', doing: 'Diagnosing locally…'},
  rules: {name: 'Load rules', group: 'local', doing: 'Loading rules…'},
  seat: {name: 'Rewrite with the prose seat', group: 'seat', doing: 'Sending the text to the prose seat…'},
  behaviour: {name: 'Show behaviour text', group: 'seat', doing: 'Loading the behaviour text…'},
  detect: {name: 'Detect', group: 'detect', doing: 'Sending the text to the detection service…'},
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function failure(name, e) {
  if (e instanceof TypeError) return `${name} failed. ${SESSION_COPY.offline.title}. ${SESSION_COPY.offline.text}`;
  const m = /^Request failed \((\d+)\)(?:: (.*))?$/s.exec(e.message);
  if (!m) return `${name} failed: ${e.message}`;
  let detail = m[2] || '';
  // The prose service answers {code, detail, spans}; http.js stringifies it, so unwrap the sentence.
  if (detail.startsWith('{')) { try { detail = JSON.parse(detail).detail || detail; } catch { /* keep the raw text */ } }
  return `${name} failed${detail ? ': ' + detail : ' (HTTP ' + m[1] + ')'}`;
}

export default function ProseWorkspace({token, setToken}) {
  const [text, setText] = useState(''), [rules, setRules] = useState(null);
  const [rewritten, setRewritten] = useState(null), [receipt, setReceipt] = useState(null);
  const [consent, setConsent] = useState(false), [error, setError] = useState(null), [busy, setBusy] = useState(null);
  // Humane prose: local diagnostics (nothing leaves), and a rewrite by the operator's own
  // prose seat under the behaviour text, with its own consent because the text leaves.
  const [diagnosis, setDiagnosis] = useState(null), [humane, setHumane] = useState(null), [seatConsent, setSeatConsent] = useState(false);
  const [instructions, setInstructions] = useState(''), [behaviour, setBehaviour] = useState(null), [authExpired, setAuthExpired] = useState(false);
  const credential = useRef(null);
  useLayoutEffect(() => {
    const controller = new AbortController(); credential.current = controller;
    setText(''); setRules(null); setRewritten(null); setReceipt(null); setConsent(false); setError(null); setBusy(null); setAuthExpired(false);
    setDiagnosis(null); setHumane(null); setSeatConsent(false); setInstructions(''); setBehaviour(null);
    return () => controller.abort();
  }, [token]);
  const read = useCallback(async (path, signal, method = 'GET', body) => {
    signal.throwIfAborted();
    const response = await apiFetch('/api/prose' + path, {
      token, method, signal, headers: {'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    signal.throwIfAborted();
    return data;
  }, [token]);
  async function task(action, meta) {
    const signal = credential.current.signal;
    setBusy(meta); setError(null);
    try { await action(signal); }
    catch (e) {
      if (signal.aborted) return;
      // A rejected token is one card in the error tone, not a card plus an alert.
      if (/Request failed \((401|403)\)/.test(e.message)) { setAuthExpired(true); return; }
      setError({group: meta.group, text: failure(meta.name, e)});
    }
    finally { if (!signal.aborted) setBusy(null); }
  }
  async function loadRules(signal) { setRules(await read('/rules', signal)); }
  async function rewrite(signal) { setRewritten({...await read('/rewrite', signal, 'POST', {text}), source: text}); }
  async function detect(signal) {
    // Consent is spent on this one request, whatever its outcome; the next one asks again.
    const granted = consent; setConsent(false);
    setReceipt({...await read('/detect', signal, 'POST', {text, allow_egress: granted}), source: text});
  }
  async function diagnose(signal) { setDiagnosis({...await read('/diagnose', signal, 'POST', {text}), source: text}); }
  async function humanise(signal) {
    const granted = seatConsent; setSeatConsent(false);
    setHumane({...await read('/humanise', signal, 'POST', {text, allow_egress: granted, instructions}), source: text, source_instructions: instructions});
  }
  async function loadBehaviour(signal) { setBehaviour(behaviour ? null : await read('/behaviour', signal)); }
  // A result is shown for the text it came from; once the text changes it is stale and says so.
  const stale = result => result && result.source !== text;
  const diagnosisStale = stale(diagnosis), rewrittenStale = stale(rewritten), receiptStale = stale(receipt);
  const humaneStale = humane && (humane.source !== text || humane.source_instructions !== instructions);
  const detection = rules?.detection, minChars = detection?.bounds?.min_chars ?? 20;
  const feedback = group => busy?.group === group ? <p role="status">{busy.doing}</p> : error?.group === group ? <p role="alert">{error.text}</p> : null;
  return <div className="research-workspace">
    <aside className="research-form">
      <p className="eyebrow">PROSE</p><h1>Edit the words, not the evidence.</h1>
      <p className="muted">Rewrite and diagnose run on this machine; the two actions marked ‘sends text’ send it away and ask for your consent each time. No rewrite changes a protected span (numbers, identifiers, citations, units, code); ‘Load rules and detection details’ lists the exact classes.</p>
      <label htmlFor="prose-text">Text</label>
      <textarea id="prose-text" rows={10} value={text} disabled={!!busy} onChange={e => setText(e.target.value)} maxLength={20000}/>
      <p className="field-note">{text.length.toLocaleString()} / {(20000).toLocaleString()} characters.</p>
      <div className="actions">
        <Button isDisabled={!!busy || !token || !text.trim()} onPress={() => task(rewrite, ACTION.rewrite)}>Rewrite locally</Button>
        <Button variant="secondary" isDisabled={!!busy || !token || !text.trim()} onPress={() => task(diagnose, ACTION.diagnose)}>Diagnose locally</Button>
        <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => task(loadRules, ACTION.rules)}>{rules ? 'Reload rules' : 'Load rules and detection details'}</Button>
      </div>
      {!token && <p className="field-note">Enter an operator token in the header to use these.</p>}
      <LockNotice card={sessionState(token, authExpired)} tone={authExpired ? 'error' : 'info'} onUnlock={() => focusTokenField(token, setToken)} unlockLabel={unlockLabel(token)}/>
      {rules && <p className="field-note">Rules loaded; the list is at the end of the results.</p>}
      {feedback('local')}
      <fieldset className="prose-detect"><legend>Seat rewrite</legend>
        <p className="field-note">Sends the text to the prose seat (one model assigned to one role; chosen in Settings). The seat edits under a fixed instruction text, the humane-prose behaviour (‘Show behaviour text’ below). If any protected span does not come back byte for byte, nothing is returned. The button unlocks when there is text and the box is ticked.</p>
        <label htmlFor="prose-instructions">Instructions to the seat (optional)</label>
        <input id="prose-instructions" value={instructions} disabled={!!busy} maxLength={2000} onChange={e => setInstructions(e.target.value)} placeholder="e.g. keep British spelling; it is a grant abstract"/>
        <label className="check"><input type="checkbox" checked={seatConsent} disabled={!!busy} onChange={e => setSeatConsent(e.target.checked)}/>I consent to sending this text to the prose seat's provider for this one request.</label>
        <p className="field-note">The box clears after each attempt. Instructions that ask to evade detectors or to impersonate someone are refused before anything is sent.</p>
        <div className="actions">
          <Button variant="secondary" isDisabled={!!busy || !token || !seatConsent || !text.trim()} onPress={() => task(humanise, ACTION.seat)}>Rewrite with the prose seat (sends text)</Button>
          <Button variant="ghost" size="sm" isDisabled={!!busy || !token} onPress={() => task(loadBehaviour, ACTION.behaviour)}>{behaviour ? 'Hide behaviour text' : 'Show behaviour text'}</Button>
        </div>
        {feedback('seat')}
      </fieldset>
      <fieldset className="prose-detect"><legend>Third-party AI-text detection</legend>
        <p className="field-note">{detection ? (detection.enabled
          ? `Sends the text to ${detection.recipient} (${detection.detectors.join(', ')}); ${detection.bounds.min_chars}–${detection.bounds.max_chars.toLocaleString()} characters. Detect unlocks when the text has at least ${minChars} characters and the box is ticked.`
          : 'Detection is switched off on this service.')
          : 'Load the rules (‘Load rules and detection details’, above) to see where the text would be sent; the consent box unlocks once they are loaded.'}</p>
        <label className="check"><input type="checkbox" checked={consent} disabled={!!busy || !detection?.enabled} onChange={e => setConsent(e.target.checked)}/>I consent to sending this text to {detection?.recipient || 'api.edgeshop.ai'} for this one request. The box clears after each attempt.</label>
        <Button variant="secondary" isDisabled={!!busy || !token || !consent || text.trim().length < minChars} onPress={() => task(detect, {...ACTION.detect, doing: `Sending the text to ${detection.recipient}…`})}>Detect (sends text)</Button>
        {feedback('detect')}
      </fieldset>
    </aside>
    <section className="research-results" aria-label="Prose results">
      <h2>Local rewrite</h2>
      {rewritten ? <div className="record" data-status={rewritten.status} data-stale={String(!!rewrittenStale)}>
        {rewrittenStale && <p role="status">The text changed since this rewrite; it applies to the earlier text.</p>}
        <h3>{rewritten.status === 'edited' ? plural(rewritten.edits.reduce((n, e) => n + e.count, 0), 'edit') : 'No change'}{rewritten.reason ? ` · ${rewritten.reason.replace(/_/g, ' ')}` : ''} · {plural(rewritten.protected_count, 'protected span')} ({rewritten.protected_classes.join(', ') || 'none'})</h3>
        <pre className="prose-output">{rewritten.text}</pre>
        {rewritten.edits.length > 0 && <ul className="edits">{rewritten.edits.map(e => <li key={e.rule}>{e.rule} ×{e.count}: “{e.before}” → {e.after ? `“${e.after}”` : '(removed)'}</li>)}</ul>}
        <p className="muted">{rewritten.statement} Rules {rewritten.rules_version}, protection {rewritten.protection_version}.</p>
      </div> : <p className="muted">No rewrite yet.</p>}
      <h2>Diagnosis</h2>
      {diagnosis ? <div className="record" aria-label="Prose diagnosis" data-stale={String(!!diagnosisStale)}>
        {diagnosisStale && <p role="status">The text changed since this diagnosis; diagnose again for the current text.</p>}
        <h3>{diagnosis.edit_categories.length ? diagnosis.edit_categories.join(' · ') : 'No edit category indicated'} · {plural(diagnosis.protected_count, 'protected span')}</h3>
        <dl className="receipt-metadata">
          <dt>Overused style words</dt><dd>{diagnosis.observations.style_words.count} ({diagnosis.observations.style_words.per_1000_words} per 1,000 words){Object.keys(diagnosis.observations.style_words.words).length ? ': ' + Object.entries(diagnosis.observations.style_words.words).map(([w, n]) => w + (n > 1 ? ' ×' + n : '')).join(', ') : ''}</dd>
          <dt>Formulaic frames (e.g. ‘it is important to note’)</dt><dd>{diagnosis.observations.formulaic_frames.count ? diagnosis.observations.formulaic_frames.instances.map(f => f.label + ': “' + f.text.trim() + '”').join(' · ') : 'none'}</dd>
          <dt>Sentence length</dt><dd>{plural(diagnosis.observations.sentence_length.sentences, 'sentence')} · mean {diagnosis.observations.sentence_length.mean_words} words · spread {diagnosis.observations.sentence_length.spread_words} words · {Math.round(diagnosis.observations.sentence_length.share_within_20pct_of_mean * 100)}% of sentences within 20% of the mean length</dd>
          <dt>Repeated openings</dt><dd>{Object.keys(diagnosis.observations.repeated_openings.openings).length ? Object.entries(diagnosis.observations.repeated_openings.openings).map(([o, n]) => '“' + o + '” ×' + n).join(', ') : 'none'}</dd>
          <dt>Lists of three</dt><dd>{diagnosis.observations.triplets.count}</dd>
          <dt>Paragraphs ending in a summary</dt><dd>{diagnosis.observations.closing_summaries.count} of {diagnosis.observations.closing_summaries.paragraphs}</dd>
          <dt>Bullet points</dt><dd>{diagnosis.observations.bullets.count}</dd>
        </dl>
        <p className="muted">{diagnosis.note}</p>
      </div> : <p className="muted">No diagnosis yet.</p>}
      <h2>Seat rewrite</h2>
      {humane ? <div className="record" data-status={humane.status} data-stale={String(!!humaneStale)}>
        {humaneStale && <p role="status">The text or instructions changed since this rewrite; it applies to the earlier text.</p>}
        <h3>{humane.status === 'edited' ? 'Edited by the prose seat' : 'Returned unchanged'} · {plural(humane.protected_count, 'protected span')} preserved</h3>
        <pre className="prose-output">{humane.text}</pre>
        {humane.notes.length > 0 && <ul className="edits">{humane.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        {humane.facts_needed.length > 0 && <p className="muted">Facts needed from the author: {humane.facts_needed.join('; ')}</p>}
        {(humane.transport || humane.instruction_channel === 'prompt') && <p className="muted">
          {humane.transport && `Model: ${humane.transport.provider} ${humane.transport.requested_model}; ${humane.transport.observed_model ? 'the provider confirmed ' + humane.transport.observed_model : 'the provider did not report which model answered'}.`}
          {humane.instruction_channel === 'prompt' && ' The behaviour text was sent inside the message; this seat takes no separate system instructions.'}
        </p>}
        <p className="muted">{humane.statement}</p>
      </div> : <p className="muted">No seat rewrite yet.</p>}
      {behaviour && <details className="record" open><summary>Behaviour text (version {behaviour.version})</summary><pre className="prose-output">{behaviour.text}</pre></details>}
      <h2>Detection receipt</h2>
      {receipt ? <div className="record" data-complete={String(receipt.complete)} data-stale={String(!!receiptStale)}>
        {receiptStale && <p role="status">The text changed since this detection; the receipt (SHA-256 below) applies to the earlier text.</p>}
        <h3>{receipt.service} · {receipt.returned_types.join(', ') || 'no detector answered'}{receipt.missing_types.length ? ` · missing ${receipt.missing_types.join(', ')}` : ''}</h3>
        <dl className="receipt-metadata">{Object.entries(receipt.results).map(([type, result]) => <React.Fragment key={type}><dt>{type}</dt><dd>{Object.entries(result).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}</dd></React.Fragment>)}
          <dt>Text SHA-256</dt><dd><code>{receipt.text_sha256}</code></dd><dt>Response SHA-256</dt><dd><code>{receipt.response_sha256}</code></dd></dl>
        <p className="muted">{receipt.note}</p>
      </div> : <p className="muted">No detection yet.</p>}
      {rules && <details className="record"><summary>Rules ({rules.rules.length}) and protected classes ({rules.protected_classes.length})</summary>
        <ul className="edits">{rules.rules.map(r => <li key={r.rule}><code>{r.rule}</code>: <code>{r.pattern}</code> → {r.replacement ? `“${r.replacement}”` : '(removed)'}</li>)}</ul>
        <p className="muted">Protected: {rules.protected_classes.join(', ')}.</p></details>}
    </section>
  </div>;
}
