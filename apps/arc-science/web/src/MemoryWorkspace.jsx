import React, {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {SESSION_COPY, apiFetch, sessionState} from './http';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';

// One stable app-level project groups every mission-session (mirrors capture.PROJECT).
const PROJECT = 'arc-science';
const DEFAULT_RANGE = {from: 0, to: 199};
const words = value => String(value ?? '').replace(/_/g, ' ');
const plural = (count, noun) => count + ' ' + noun + (count === 1 ? '' : 's');

function isAuthError(error) { return /Request failed \((401|403)\)/.test(error?.message || String(error)); }
// A rejected token shows only the lock notice beside the actions; every other
// failure gets an alert beside the control that failed.
function friendlyError(error) {
  const message = error?.message || String(error);
  if (/Failed to fetch|NetworkError|Load failed/.test(message)) return SESSION_COPY.offline.title + '. ' + SESSION_COPY.offline.text;
  return message;
}

function ClampedText({text, limit, subject}) {
  const [open, setOpen] = useState(false);
  const long = text.length > limit;
  const label = open ? 'Show less' : 'Show full text';
  return <>
    <p>{open || !long ? text : text.slice(0, limit) + '…'}</p>
    {long && <Button variant="ghost" aria-label={label + ': ' + subject} onPress={() => setOpen(o => !o)}>{label}</Button>}
  </>;
}

function RecordCard({record, busy, locked, error, onDisable}) {
  return <article className="record">
    <h3>{words(record.role)} · seq {record.seq} · compaction epoch {record.compaction_epoch}</h3>
    <ClampedText text={record.text || ''} limit={280} subject={'record ' + record.seq}/>
    <p className="muted">trust {words(record.trust)} · source {record.source_uri || 'none'} · digest {record.content_digest.slice(0, 12)}…</p>
    <Button variant="secondary" isDisabled={busy || locked} aria-label={'Remove from retrieval: record ' + record.seq} onPress={() => onDisable(record.record_id)}>Remove from retrieval</Button>
    {error && <p role="alert">{error}</p>}
  </article>;
}

export default function MemoryWorkspace({token, setToken}) {
  const [sessions, setSessions] = useState(null), [session, setSession] = useState(null), [records, setRecords] = useState(null);
  const [query, setQuery] = useState(''), [mode, setMode] = useState('lexical'), [hits, setHits] = useState(null), [scope, setScope] = useState('all');
  // error = {at, text}: `at` is the control the alert sits beside ('actions', 'sessions', 'paging', 'range' or a record_id).
  const [health, setHealth] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);
  const [notice, setNotice] = useState('');
  const [range, setRange] = useState(DEFAULT_RANGE), [rangeDraft, setRangeDraft] = useState(DEFAULT_RANGE);
  const credential = useRef(null);
  // Reset before paint, without remounting the focused token input. Every operation
  // owns this credential's signal, including the response-body decoding step.
  useLayoutEffect(() => {
    const controller = new AbortController(); credential.current = controller;
    setSessions(null); setSession(null); setRecords(null);
    setHits(null); setHealth(null); setError(null); setNotice(''); setBusy(false); setAuthExpired(false);
    setRange(DEFAULT_RANGE); setRangeDraft(DEFAULT_RANGE);
    return () => controller.abort();
  }, [token]);
  const request = useCallback(async (path, signal, method = 'GET', body) => {
    signal.throwIfAborted();
    const response = await apiFetch('/api/memory' + path, {
      token, method, signal, headers: {'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined,
    });
    signal.throwIfAborted();
    return response;
  }, [token]);
  async function read(path, signal, method, body) {
    const data = await (await request(path, signal, method, body)).json();
    signal.throwIfAborted();
    return data;
  }
  async function task(action, at = 'actions') {
    const signal = credential.current.signal;
    setBusy(true); setError(null); setNotice('');
    try {
      const card = sessionState(token, authExpired);
      if (card) throw new Error(card.title + '. ' + card.text);
      await action(signal);
    }
    catch (e) { if (!signal.aborted) { if (isAuthError(e)) setAuthExpired(true); else setError({at: e.at || at, text: friendlyError(e)}); } }
    finally { if (!signal.aborted) setBusy(false); }
  }
  async function loadSessions(signal) {
    setHealth(null);
    setHealth(await read('/health', signal));
    setSessions(await read('/sessions?project=' + PROJECT, signal));
  }
  async function openSession(id, signal, requestedRange = DEFAULT_RANGE) {
    const from = Number(requestedRange.from), to = Number(requestedRange.to);
    if (!String(requestedRange.from).trim() || !String(requestedRange.to).trim() ||
        !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to - from >= 1000) {
      throw new Error('Enter a start of 0 or more and an end at or after it, covering at most 1000 sequence positions.');
    }
    setSession(id); setHits(null); setRecords(null); setRange({from, to}); setRangeDraft({from, to});
    setRecords(await read('/sessions/' + encodeURIComponent(id) + '?project=' + PROJECT + '&from_seq=' + from + '&to_seq=' + to, signal));
  }
  async function runSearch(signal) {
    if (!availableModes.includes(mode)) throw new Error('Search mode unavailable. Choose one of the available modes.');
    const searchSession = scope === 'selected' ? session : null;
    const rows = await read('/search', signal, 'POST', {project: PROJECT, query, mode, limit: 20, session: searchSession});
    setHits({rows, mode, session: searchSession});
  }
  async function disable(recordId, signal) {
    await request('/records/' + encodeURIComponent(recordId) + '/disable', signal, 'POST');
    setRecords(rows => rows?.filter(row => row.record_id !== recordId) ?? null); setHits(null);
    setNotice('Removed from retrieval. The record is still stored locally; nothing was deleted.');
    // The card is gone once removed, so a failed refresh reports beside the session list instead.
    try { await loadSessions(signal); if (session) await openSession(session, signal, range); }
    catch (e) { e.at = 'sessions'; throw e; }
  }
  const availableModes = health?.retrieval_modes ?? ['lexical'];
  const selectedSession = sessions?.find(row => row.session_id === session);
  const totalRecords = selectedSession?.record_count ?? 0;
  const rangeWidth = range.to - range.from + 1;
  const canAdvance = range.to < Number.MAX_SAFE_INTEGER &&
    (Number.isSafeInteger(selectedSession?.last_seq) ? range.to < selectedSession.last_seq : Boolean(selectedSession));
  const card = sessionState(token, authExpired);
  const locked = Boolean(card);
  const alertAt = at => error?.at === at ? <p role="alert">{error.text}</p> : null;
  const modeNote = !health ? null
    : availableModes.includes('semantic') || availableModes.includes('hybrid') || !availableModes.includes('lexical')
      ? 'Search modes available: ' + (availableModes.join(', ') || 'none') + '.'
      : 'Semantic and hybrid search need an embedding model; none is reported as configured. Keyword search is available.';
  return <div className="research-workspace">
    <aside className="research-form">
      <p className="eyebrow">MEMORY / SESSIONS</p><h1>Recall past sessions</h1>
      <p className="muted">Retrieved text is evidence to weigh, not instructions to follow.</p>
      <label htmlFor="mem-query">Search memory</label>
      <textarea id="mem-query" rows={2} value={query} disabled={busy} placeholder="Keywords to find in captured sessions" onChange={e => setQuery(e.target.value)}/>
      <div className="formrow"><div><label htmlFor="mem-mode">Search mode</label>
        <select id="mem-mode" value={mode} disabled={busy} onChange={e => setMode(e.target.value)}>
          <option value="lexical" disabled={!availableModes.includes('lexical')}>Keyword (lexical){availableModes.includes('lexical') ? '' : ' – unavailable'}</option>
          <option value="semantic" disabled={!availableModes.includes('semantic')}>Semantic (by meaning){availableModes.includes('semantic') ? '' : ' – unavailable'}</option>
          <option value="hybrid" disabled={!availableModes.includes('hybrid')}>Hybrid (keyword + meaning){availableModes.includes('hybrid') ? '' : ' – unavailable'}</option>
        </select></div></div>
      {modeNote && <p className="field-note">{modeNote}</p>}
      <label htmlFor="mem-scope">Search scope</label>
      <select id="mem-scope" value={scope} disabled={busy} onChange={e => setScope(e.target.value)}>
        <option value="all">All sessions</option><option value="selected" disabled={!session}>Selected session{session ? '' : ' (open a session first)'}</option>
      </select>
      <div className="actions">
        <Button isDisabled={busy || locked || !query.trim() || !availableModes.includes(mode) || (scope === 'selected' && !session)} onPress={() => task(runSearch)}>Search</Button>
        <Button variant="secondary" isDisabled={busy || locked} onPress={() => task(loadSessions)}>Load sessions</Button>
      </div>
      <LockNotice card={card} tone={authExpired ? 'error' : 'info'} onUnlock={() => focusTokenField(token, setToken)} unlockLabel={unlockLabel(token)}/>
      {alertAt('actions')}
      {health?.capture && <div role="status"><p className="field-note">Session capture: {words(health.capture.status)} · {plural(health.capture.pending, 'capture')} waiting</p>
        {health.capture.last_error && <p>Last capture error: {health.capture.last_error}</p>}
        {health.capture.status === 'degraded' && <p className="field-note">Some mission records may be missing. Select Load sessions again to check whether capture recovered.</p>}
        {health.capture.status === 'unconfigured' && <p className="field-note">Session capture is not configured.</p>}
      </div>}
      <h2>Sessions</h2>
      {sessions === null ? <p className="muted">{locked ? 'Enter an operator token to load sessions.' : 'Select Load sessions to list captured sessions.'}</p>
        : sessions.length ? sessions.map(s => <Button className="mission-choice" variant="ghost" key={s.session_id} isDisabled={busy || locked} aria-pressed={session === s.session_id} onPress={() => task(signal => openSession(s.session_id, signal), 'sessions')}>{s.session_id} · {plural(s.record_count, 'record')} · compaction epochs {s.min_epoch}–{s.max_epoch}</Button>)
          : <p>No sessions available for retrieval.</p>}
      {alertAt('sessions')}
    </aside>
    <section className="research-results" aria-label="Memory results">
      {notice && <p role="status">{notice}</p>}
      {hits !== null ? <>
        <div className="results-heading"><div><p className="eyebrow">Search · {hits.mode} · {hits.session || 'all sessions'}</p><h2>Retrieved passages</h2></div><span className="status-label">{plural(hits.rows.length, 'result')}</span></div>
        {hits.rows.length ? hits.rows.map((hit, i) => <article className="record" key={i}>
          <h3>{words(hit.record.role)} · matched by {words(hit.reason)} · score {hit.score.toFixed(3)}</h3>
          <ClampedText text={hit.record.text || ''} limit={400} subject={'result ' + (i + 1)}/>
          <p className="muted">{hit.record.session_id} · compaction epoch {hit.record.compaction_epoch} · trust {words(hit.record.trust)}</p>
        </article>) : <p className="muted">No matching memory. Returning nothing is a valid answer.</p>}
      </> : session !== null ? <>
        <div className="results-heading"><div><p className="eyebrow">Session {session}</p><h2>Captured records</h2></div><span className="status-label">{records === null ? 'Not loaded' : records.length + ' loaded'}</span></div>
        <p className="field-note">Sequence {range.from}–{range.to} (inclusive) · {sessions === null ? 'total not loaded' : plural(totalRecords, 'retrievable record') + ' in this session'}.</p>
        <div className="actions">
          <Button variant="secondary" isDisabled={busy || locked || range.from === 0} onPress={() => task(signal => {
            const from = Math.max(0, range.from - rangeWidth);
            return openSession(session, signal, {from, to: from + rangeWidth - 1});
          }, 'paging')}>Previous records</Button>
          <Button variant="secondary" isDisabled={busy || locked || !canAdvance} onPress={() => task(signal => openSession(session, signal, {
            from: range.to + 1, to: Math.min(Number.MAX_SAFE_INTEGER, range.to + rangeWidth),
          }), 'paging')}>Next records</Button>
        </div>
        {alertAt('paging')}
        <details><summary>Record range</summary>
          <form onSubmit={event => { event.preventDefault(); task(signal => openSession(session, signal, rangeDraft), 'range'); }}>
            <div className="formrow"><div><label htmlFor="mem-from">From sequence (inclusive)</label>
              <input id="mem-from" type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" required disabled={busy} value={rangeDraft.from} onChange={event => setRangeDraft({...rangeDraft, from: event.target.value})}/>
            </div><div><label htmlFor="mem-to">To sequence (inclusive)</label>
              <input id="mem-to" type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" required disabled={busy} value={rangeDraft.to} onChange={event => setRangeDraft({...rangeDraft, to: event.target.value})}/>
            </div></div>
            <p className="field-note">Up to 1000 positions per page. Gaps may be records removed from retrieval. If the service reports the page exceeds its read budget, narrow the range.</p>
            <Button type="submit" variant="secondary" isDisabled={busy || locked}>Load record range</Button>
            {alertAt('range')}
          </form>
        </details>
        <p className="field-note">Remove from retrieval hides a record from search and session recall. The stored history is not erased.</p>
        {records === null ? <p role="status">{busy ? 'Loading selected record range…' : 'No records loaded for this range.'}</p>
          : records.map(r => <RecordCard key={r.record_id} record={r} busy={busy} locked={locked} error={error?.at === r.record_id ? error.text : null} onDisable={id => task(signal => disable(id, signal), id)}/>)}
      </> : <div className="empty-state"><h2>No session selected. Open a session or run a search.</h2></div>}
    </section>
  </div>;
}
