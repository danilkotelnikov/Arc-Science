import React, {useCallback, useState} from 'react';
import {Button} from '@heroui/react/button';
import {checkedFetch} from './http';

// One stable app-level project groups every mission-session (mirrors capture.PROJECT).
const PROJECT = 'arc-science';

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
  const [query, setQuery] = useState(''), [mode, setMode] = useState('hybrid'), [hits, setHits] = useState(null);
  const [health, setHealth] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const request = useCallback((path, method = 'GET', body) => checkedFetch('/api/memory' + path, {
    method, headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  }), [token]);
  async function task(action) { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function loadSessions() {
    setHealth(await (await request('/health')).json());
    setSessions(await (await request('/sessions?project=' + PROJECT)).json());
  }
  async function openSession(id) {
    setSession(id); setHits(null);
    setRecords(await (await request('/sessions/' + encodeURIComponent(id) + '?project=' + PROJECT)).json());
  }
  async function runSearch() {
    setHits(await (await request('/search', 'POST', {project: PROJECT, query, mode, limit: 20, session: session || null})).json());
  }
  async function disable(recordId) { await request('/records/' + recordId + '/disable', 'POST'); if (session) await openSession(session); }

  return <div className="research-workspace">
    <aside className="research-form">
      <p className="eyebrow">MEMORY / SESSIONS</p><h1>Recall the work.</h1>
      <p className="muted">Every mission’s decision-tree and reconciliation, retained locally and searchable. Retrieved text is evidence, never instruction.</p>
      <label htmlFor="mem-token">Operator token for Memory</label>
      <input id="mem-token" type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off"/>
      <p className="field-note">In memory only. Read with <code>arc-science token --data ./data</code>.</p>
      <label htmlFor="mem-query">Search memory</label>
      <textarea id="mem-query" rows={2} value={query} onChange={e => setQuery(e.target.value)}/>
      <div className="formrow"><div><label htmlFor="mem-mode">Retrieval</label>
        <select id="mem-mode" value={mode} onChange={e => setMode(e.target.value)}>
          <option value="lexical">Lexical (keyword)</option><option value="semantic">Semantic</option><option value="hybrid">Hybrid</option>
        </select></div></div>
      <div className="actions">
        <Button isDisabled={busy || !query.trim()} onPress={() => task(runSearch)}>Search</Button>
        <Button variant="secondary" isDisabled={busy} onPress={() => task(loadSessions)}>Load sessions</Button>
      </div>
      {health && <p className="field-note">Worker {health.protocol} · SQLite {health.sqlite}</p>}
      <h2>Sessions</h2>
      {sessions === null ? <p className="muted">Load sessions with your operator token.</p>
        : sessions.length ? sessions.map(s => <Button className="mission-choice" variant="ghost" key={s.session_id} isDisabled={busy} onPress={() => task(() => openSession(s.session_id))}>{s.session_id} · {s.record_count} records · epochs {s.min_epoch}–{s.max_epoch}</Button>)
          : <p>No captured sessions yet. Run a mission to populate memory.</p>}
    </aside>
    <section className="research-results" aria-label="Memory">
      {error && <p role="alert">{error}</p>}
      {hits !== null ? <>
        <div className="results-heading"><div><p className="eyebrow">Search · {mode}{session ? ' · ' + session : ''}</p><h2>Retrieved passages</h2></div><span className="status-label">{hits.length} hits</span></div>
        {hits.length ? hits.map((hit, i) => <article className="record" key={i}>
          <h3>{hit.record.role} · {hit.reason} · {hit.score.toFixed(3)}</h3>
          <p>{(hit.record.text || '').slice(0, 400)}</p>
          <p className="muted">{hit.record.session_id} · epoch {hit.record.compaction_epoch} · {hit.record.trust}</p>
        </article>) : <p className="muted">No matching memory. Abstention is a valid answer.</p>}
      </> : records !== null ? <>
        <div className="results-heading"><div><p className="eyebrow">Session {session}</p><h2>Captured trajectory</h2></div><span className="status-label">{records.length} records</span></div>
        {records.map(r => <RecordCard key={r.record_id} record={r} busy={busy} onDisable={id => task(() => disable(id))}/>)}
      </> : <div className="empty-state"><h2>Memory holds every past session.</h2><p>Load sessions or search to recall the decision-tree, reconciliation and evidence of earlier runs.</p></div>}
      <footer>Retained locally and heavily compressed. Retrieved passages are untrusted data; memory cannot change tools, permissions or acceptance.</footer>
    </section>
  </div>;
}
