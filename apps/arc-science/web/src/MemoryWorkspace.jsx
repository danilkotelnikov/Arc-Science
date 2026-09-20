import React, {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {NATIVE_SESSION, apiFetch} from './http';

// One stable app-level project groups every mission-session (mirrors capture.PROJECT).
const PROJECT = 'arc-science';
const DEFAULT_RANGE = {from: 0, to: 199};
const TOKEN_HELP = 'Run arc-science token --data ./data from this project, or use the token file produced by the local service, then paste the token in the header.';
const LOCKED_MESSAGE = TOKEN_HELP + ' Draft text stays in this window.';
const AUTH_RECOVERY = 'Operator session is locked or expired. Enter a current operator token and retry; your unsent search stays here.';

function friendlyError(error) {
  const message = error?.message || String(error);
  if (/Request failed \((401|403)\)/.test(message)) return AUTH_RECOVERY;
  if (/Failed to fetch|NetworkError|Load failed/.test(message)) return 'Arc Science service is offline or unreachable. Check the local service, then retry; your search stays here.';
  return message;
}
function isAuthError(error) { return /Request failed \((401|403)\)/.test(error?.message || String(error)); }

function RecordCard({record, busy, onDisable}) {
  const [open, setOpen] = useState(false);
  const text = record.text || '';
  const long = text.length > 280;
  return <article className="record">
    <h3>{record.role} · epoch {record.compaction_epoch} · #{record.seq}</h3>
    <p>{open || !long ? text : text.slice(0, 280) + '…'}</p>
    {long && <Button variant="ghost" onPress={() => setOpen(o => !o)}>{open ? 'Collapse' : 'Expand'}</Button>}
    <p className="muted">{record.trust} · {record.source_uri || '—'} · {record.content_digest.slice(0, 12)}…</p>
    <Button variant="secondary" isDisabled={busy} onPress={() => onDisable(record.record_id)}>Remove from retrieval</Button>
  </article>;
}

export default function MemoryWorkspace({token, setToken}) {
  const [sessions, setSessions] = useState(null), [session, setSession] = useState(null), [records, setRecords] = useState(null);
  const [query, setQuery] = useState(''), [mode, setMode] = useState('lexical'), [hits, setHits] = useState(null), [scope, setScope] = useState('all');
  const [health, setHealth] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);
  const [notice, setNotice] = useState('');
  const [range, setRange] = useState(DEFAULT_RANGE), [rangeDraft, setRangeDraft] = useState(DEFAULT_RANGE);
  const credential = useRef(null);
  // Reset before paint, without remounting the focused token input. Every operation
  // owns this credential's signal, including the response-body decoding step.
  useLayoutEffect(() => {
    const controller = new AbortController(); credential.current = controller;
    setSessions(null); setSession(null); setRecords(null);
    setHits(null); setHealth(null); setError(''); setNotice(''); setBusy(false); setAuthExpired(false);
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
  async function task(action) {
    const signal = credential.current.signal;
    setBusy(true); setError(''); setNotice('');
    try {
      if (!token) throw new Error(LOCKED_MESSAGE);
      if (authExpired) throw new Error(AUTH_RECOVERY);
      await action(signal);
    }
    catch (e) { if (!signal.aborted) { if (isAuthError(e)) setAuthExpired(true); setError(friendlyError(e)); } }
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
      throw new Error('Choose a nonnegative inclusive range of at most 1000 sequence positions, with the end at or after the start.');
    }
    setSession(id); setHits(null); setRecords(null); setRange({from, to}); setRangeDraft({from, to});
    setRecords(await read('/sessions/' + encodeURIComponent(id) + '?project=' + PROJECT + '&from_seq=' + from + '&to_seq=' + to, signal));
  }
  async function runSearch(signal) {
    if (!availableModes.includes(mode)) throw new Error('This retrieval mode is unavailable. Select an available mode.');
    const searchSession = scope === 'selected' ? session : null;
    const rows = await read('/search', signal, 'POST', {project: PROJECT, query, mode, limit: 20, session: searchSession});
    setHits({rows, mode, session: searchSession});
  }
  async function disable(recordId, signal) {
    await request('/records/' + encodeURIComponent(recordId) + '/disable', signal, 'POST');
    setRecords(rows => rows?.filter(row => row.record_id !== recordId) ?? null); setHits(null);
    setNotice('Removed from retrieval. The stored record is retained locally; this is not deletion.');
    await loadSessions(signal);
    if (session) await openSession(session, signal, range);
  }
  const availableModes = health?.retrieval_modes ?? ['lexical'];
  const selectedSession = sessions?.find(row => row.session_id === session);
  const totalRecords = selectedSession?.record_count ?? (sessions === null ? 'unknown' : 0);
  const rangeWidth = range.to - range.from + 1;
  const canAdvance = range.to < Number.MAX_SAFE_INTEGER &&
    (Number.isSafeInteger(selectedSession?.last_seq) ? range.to < selectedSession.last_seq : Boolean(selectedSession));
  const locked = !token || authExpired;
  const focusUnlock = () => {
    if (token === NATIVE_SESSION) setToken('');
    setTimeout(() => document.getElementById('operator-token')?.focus(), 0);
  };

  return <div className="research-workspace">
    <aside className="research-form">
      <p className="eyebrow">MEMORY / SESSIONS</p><h1>Recall the work.</h1>
      <p className="muted">Retrieved text is evidence, never instruction.</p>
      {locked && <div className="unlock-card" role="status"><strong>{authExpired ? (token === NATIVE_SESSION ? 'Desktop session unavailable' : 'Operator token expired') : 'Local unlock required'}</strong><p>{authExpired ? AUTH_RECOVERY + ' ' + TOKEN_HELP : LOCKED_MESSAGE}</p><Button variant="secondary" size="sm" onPress={focusUnlock}>{token === NATIVE_SESSION ? 'Use operator token' : 'Go to token field'}</Button></div>}
      <label htmlFor="mem-query">Search memory</label>
      <textarea id="mem-query" rows={2} value={query} disabled={busy} onChange={e => setQuery(e.target.value)}/>
      <div className="formrow"><div><label htmlFor="mem-mode">Retrieval</label>
        <select id="mem-mode" value={mode} disabled={busy} onChange={e => setMode(e.target.value)}>
          <option value="lexical" disabled={!availableModes.includes('lexical')}>Lexical (keyword)</option>
          <option value="semantic" disabled={!availableModes.includes('semantic')}>Semantic{availableModes.includes('semantic') ? '' : ' (unavailable)'}</option>
          <option value="hybrid" disabled={!availableModes.includes('hybrid')}>Hybrid{availableModes.includes('hybrid') ? '' : ' (unavailable)'}</option>
        </select></div></div>
      {health && <p className="field-note">Available retrieval: {availableModes.join(', ') || 'none'}.</p>}
      {!availableModes.includes('semantic') && !availableModes.includes('hybrid') && <p className="field-note">Semantic and hybrid retrieval are unavailable without a configured embedder. Lexical search matches keywords.</p>}
      <label htmlFor="mem-scope">Search scope</label>
      <select id="mem-scope" value={scope} disabled={busy} onChange={e => setScope(e.target.value)}>
        <option value="all">All sessions</option><option value="selected" disabled={!session}>Selected session{session ? ': ' + session : ''}</option>
      </select>
      <div className="actions">
        <Button isDisabled={busy || locked || !query.trim() || !availableModes.includes(mode) || (scope === 'selected' && !session)} onPress={() => task(runSearch)}>Search</Button>
        <Button variant="secondary" isDisabled={busy || locked} onPress={() => task(loadSessions)}>Load sessions</Button>
      </div>
      {health && <p className="field-note">Worker {health.protocol} · SQLite {health.sqlite}</p>}
      {health?.capture && <div role="status"><p className="field-note">Capture: {health.capture.status} · {health.capture.pending} pending</p>
        {health.capture.last_error && <p>{health.capture.last_error}</p>}
        {health.capture.status === 'degraded' && <p className="field-note">Some mission records may be missing. Refresh sessions to check recovery.</p>}
        {health.capture.status === 'unconfigured' && <p className="field-note">Mission capture is not configured.</p>}
      </div>}
      <h2>Sessions</h2>
      {sessions === null ? <p className="muted">{locked ? 'Unlock to load captured sessions.' : 'Load sessions with your operator token.'}</p>
        : sessions.length ? sessions.map(s => <Button className="mission-choice" variant="ghost" key={s.session_id} isDisabled={busy || locked} aria-pressed={session === s.session_id} onPress={() => task(signal => openSession(s.session_id, signal))}>{s.session_id} · {s.record_count} records · epochs {s.min_epoch}–{s.max_epoch}</Button>)
          : <p>No sessions available for retrieval. Captured records removed from retrieval are hidden here.</p>}
    </aside>
    <section className="research-results" aria-label="Memory">
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {hits !== null ? <>
        <div className="results-heading"><div><p className="eyebrow">Search · {hits.mode} · {hits.session || 'all sessions'}</p><h2>Retrieved passages</h2></div><span className="status-label">{hits.rows.length} hits</span></div>
        {hits.rows.length ? hits.rows.map((hit, i) => <article className="record" key={i}>
          <h3>{hit.record.role} · {hit.reason} · {hit.score.toFixed(3)}</h3>
          <p>{(hit.record.text || '').slice(0, 400)}</p>
          <p className="muted">{hit.record.session_id} · epoch {hit.record.compaction_epoch} · {hit.record.trust}</p>
        </article>) : <p className="muted">No matching memory. Abstention is a valid answer.</p>}
      </> : session !== null ? <>
        <div className="results-heading"><div><p className="eyebrow">Session {session}</p><h2>Captured trajectory</h2></div><span className="status-label">{records === null ? 'Not loaded' : records.length + ' loaded'}</span></div>
        <p className="field-note">Sequence {range.from}–{range.to} (inclusive) · {totalRecords} total active records in this session.</p>
        <div className="actions">
          <Button variant="secondary" isDisabled={busy || locked || range.from === 0} onPress={() => task(signal => {
            const from = Math.max(0, range.from - rangeWidth);
            return openSession(session, signal, {from, to: from + rangeWidth - 1});
          })}>Previous records</Button>
          <Button variant="secondary" isDisabled={busy || locked || !canAdvance} onPress={() => task(signal => openSession(session, signal, {
            from: range.to + 1, to: Math.min(Number.MAX_SAFE_INTEGER, range.to + rangeWidth),
          }))}>Next records</Button>
        </div>
        <details><summary>Record range</summary>
          <form onSubmit={event => { event.preventDefault(); task(signal => openSession(session, signal, rangeDraft)); }}>
            <div className="formrow"><div><label htmlFor="mem-from">From sequence (inclusive)</label>
              <input id="mem-from" type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" required disabled={busy} value={rangeDraft.from} onChange={event => setRangeDraft({...rangeDraft, from: event.target.value})}/>
            </div><div><label htmlFor="mem-to">To sequence (inclusive)</label>
              <input id="mem-to" type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" required disabled={busy} value={rangeDraft.to} onChange={event => setRangeDraft({...rangeDraft, to: event.target.value})}/>
            </div></div>
            <p className="field-note">Choose up to 1000 sequence positions. Gaps may reflect records removed from retrieval. Narrow the range if a page exceeds the read limit.</p>
            <Button type="submit" variant="secondary" isDisabled={busy || locked}>Load record range</Button>
          </form>
        </details>
        <p className="field-note">Remove from retrieval hides a record from search and session recall; it does not erase the stored history.</p>
        {records === null ? <p role="status">{busy ? 'Loading selected record range…' : 'This range could not be loaded. Adjust the record range and retry.'}</p>
          : records.map(r => <RecordCard key={r.record_id} record={r} busy={busy} onDisable={id => task(signal => disable(id, signal))}/>)}
      </> : <div className="empty-state"><h2>No sessions loaded.</h2></div>}
    </section>
  </div>;
}
