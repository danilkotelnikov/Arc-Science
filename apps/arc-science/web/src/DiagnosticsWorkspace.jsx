import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {NATIVE_SESSION, SESSION_COPY, apiFetch, checkedFetch, sessionState} from './http';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';
import './DiagnosticsWorkspace.css';

const OFFLINE = SESSION_COPY.offline.title + '. Start the local service, then retry.';
const LOCKED_LINE = 'Unlocks when the header holds an accepted operator token.';
const NO_SETTINGS = 'missing its settings or the MCP package';
const STATE_LABEL = {ok: 'OK', unchecked: 'Not checked', locked: 'Locked', unavailable: 'Unavailable', unconfigured: 'Not configured'};
const BUSY = {health: 'Refreshing service status…', capabilities: 'Loading capabilities…', mcp: 'Checking MCP servers…', acp: 'Checking ACP agents…'};

const isAuthError = error => /Request failed \((401|403)\)/.test(error?.message || String(error));
const words = value => typeof value === 'string' ? value.replace(/_/g, ' ') : value;
const seat = entry => entry ? entry.provider + ' · ' + entry.model : undefined;

function friendlyError(error, kind) {
  const message = error?.message || String(error);
  if (kind === 'memory' && /Request failed \(503\)/.test(message)) {
    const detail = message.replace(/^Request failed \(503\):?\s*/, '');
    return 'The memory engine is unavailable in this local service' + (detail ? ': ' + detail : '') + '. Fix that, then retry.';
  }
  if (/Request failed \(503\)/.test(message)) return (kind === 'capabilities' ? 'Capabilities are' : 'Connection checks are') + ' unavailable in this local service: it is ' + NO_SETTINGS + '. Fix that, then retry.';
  if (/Request failed \(\d+\)/.test(message)) return 'The request could not complete (the service returned an error). Retry; if it persists, review Settings.';
  if (/Failed to fetch|NetworkError|Load failed/.test(message)) return OFFLINE;
  if (/JSON|Unexpected token|Unexpected end/.test(message)) return 'The service returned an unreadable response. Retry.';
  return message.replace(/\s+/g, ' ').trim();
}

// The card beside a failed protected call keeps one short line; the alert beside the button carries the instruction.
function protectedFailure(error, kind) {
  if (isAuthError(error)) return {locked: true};
  if (/Request failed \(503\)/.test(error?.message || '')) return {available: false, error: 'This local service is ' + NO_SETTINGS + '. Retry after that is fixed.'};
  return {available: false, error: kind === 'capabilities' ? 'The request failed. See the message beside Load capabilities.' : 'The check failed. See the message above.'};
}

function stateFor(value) {
  if (value === null) return 'unchecked';
  if (value?.locked) return 'locked';
  if (value?.available === false) return 'unavailable';
  return 'ok';
}

function StatusCard({title, state, children}) {
  return <article className="diagnostics-card" data-state={state}>
    <div className="diagnostics-card-head"><h3>{title}</h3><span className="diagnostics-state">{STATE_LABEL[state]}</span></div>
    {children}
  </article>;
}

function SummaryLine({label, value}) {
  return <><dt>{label}</dt><dd>{value ?? 'Unavailable'}</dd></>;
}

function ConnectionSummary({capabilities}) {
  let body;
  if (!capabilities) body = <p className="muted">Loads after you paste a token and press Load capabilities.</p>;
  else if (capabilities.locked || capabilities.available === false) body = <div className="diagnostics-grid">
    <StatusCard title="Operator capabilities" state={stateFor(capabilities)}>
      <p className="muted">{capabilities.locked ? LOCKED_LINE : capabilities.error}</p>
    </StatusCard>
  </div>;
  else {
    const live = capabilities.live || {configured: false};
    const {mcp = {}, acp = {}} = capabilities.connectors || {};
    body = <>
      <p className="field-note">A seat is one model assigned to one role.</p>
      <div className="diagnostics-grid">
        <StatusCard title="Model seats" state={live.configured ? 'ok' : 'unconfigured'}>
          {live.configured ? <dl className="diagnostics-kv">
            <SummaryLine label="Planner" value={seat(live.seats?.planner) ?? live.planner}/>
            <SummaryLine label="Reviewer" value={seat(live.seats?.reviewer) ?? live.reviewer}/>
            <SummaryLine label="Falsifier (the reviewing role briefed to refute)" value={seat(live.seats?.falsifier)}/>
            <SummaryLine label="Planner sign-in" value={{cli: 'CLI login', api_key: 'API credential'}[live.auth] || words(live.auth)}/>
          </dl> : <p className="muted">No model seats configured. Set them up in Settings.</p>}
        </StatusCard>
        <StatusCard title="Vision" state={capabilities.vision?.configured ? 'ok' : 'unconfigured'}>
          {capabilities.vision?.configured ? <p>{capabilities.vision.provider} · {capabilities.vision.model}</p> : <p className="muted">The service reported no vision seat.</p>}
        </StatusCard>
        <StatusCard title="MCP connectors" state={mcp.configured ? 'ok' : 'unconfigured'}>
          <p><strong>{mcp.configured ?? 0}</strong> configured · <strong>{mcp.consented ?? 0}</strong> consented</p>
          <p className="field-note">SDK: {mcp.sdk || 'Unavailable'}</p>
        </StatusCard>
        <StatusCard title="ACP connectors" state={acp.configured ? 'ok' : 'unconfigured'}>
          <p><strong>{acp.configured ?? 0}</strong> configured · <strong>{acp.consented ?? 0}</strong> consented</p>
        </StatusCard>
      </div>
      <p className="field-note">Configuration only. Worker health and model reachability are not checked here; MCP tools and ACP agents need the checks below.</p>
    </>;
  }
  return <><h2>Operator capabilities</h2>{body}</>;
}

function McpReport({report}) {
  if (!report) return <p className="muted">Check MCP connects to each enabled server, lists its tools and shows which would be offered to models. Nothing is called and no mission data is sent.</p>;
  if (report.locked) return <p className="muted">{LOCKED_LINE}</p>;
  if (report.available === false) return <p className="muted">{report.error || 'The MCP check could not complete.'}</p>;
  const servers = report.servers || [];
  return <>
    <p className="field-note">SDK: {report.sdk || 'Unavailable'} · consented servers: {(report.consented || []).join(', ') || 'none'}</p>
    {servers.length ? <table className="diagnostics-table" aria-label="MCP diagnostics">
      <tbody>{servers.map(server => <tr key={server.server}>
        <th scope="row">{server.server}</th>
        <td>{server.ok ? (server.tools || []).map(tool => tool.name + (tool.offered === false ? ' (not offered' + (tool.reason ? ': ' + tool.reason : '') + ')' : '')).join(', ') || 'No tools' : 'Unavailable: ' + (server.error || 'check failed')}</td>
      </tr>)}</tbody>
    </table> : <p className="muted">No enabled MCP servers, so nothing was checked.</p>}
  </>;
}

function AcpReport({report}) {
  if (!report) return <p className="muted">Check ACP starts each enabled agent, exchanges ACP initialize, reads what it says about itself, then stops it. No session and no prompt.</p>;
  if (report.locked) return <p className="muted">{LOCKED_LINE}</p>;
  if (report.available === false) return <p className="muted">{report.error || 'The ACP check could not complete.'}</p>;
  const agents = report.agents || [];
  return <>
    <p className="field-note">Protocol version: {report.protocol_version || 'Unavailable'} · consented agents: {(report.consented || []).join(', ') || 'none'}</p>
    {agents.length ? <table className="diagnostics-table" aria-label="ACP diagnostics">
      <tbody>{agents.map(agent => <tr key={agent.agent}>
        <th scope="row">{agent.agent}</th>
        <td>{agent.ok ? [agent.agent_info?.name || 'Agent', agent.agent_info?.version].filter(Boolean).join(' · ') : 'Unavailable: ' + (agent.error || 'check failed')}</td>
      </tr>)}</tbody>
    </table> : <p className="muted">No enabled ACP agents, so nothing was checked.</p>}
  </>;
}

export default function DiagnosticsWorkspace({token, setToken, active = true}) {
  const [health, setHealth] = useState(null), [capabilities, setCapabilities] = useState(null);
  const [mcp, setMcp] = useState(null), [acp, setAcp] = useState(null), [memory, setMemory] = useState(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(null);
  const credential = useRef(null);

  useLayoutEffect(() => {
    const controller = new AbortController();
    credential.current = controller;
    setCapabilities(null); setMcp(null); setAcp(null); setMemory(null); setError(null); setBusy('');
    return () => controller.abort();
  }, [token]);

  // A rejected token or desktop session is announced by the unlock card, not by a second alert.
  const run = useCallback(async (kind, action) => {
    const signal = credential.current.signal;
    setBusy(kind); setError(null);
    try { await action(signal); }
    catch (err) { if (!signal.aborted && !isAuthError(err)) setError({kind, text: friendlyError(err, kind)}); }
    finally { if (!signal.aborted) setBusy(''); }
  }, []);

  const loadHealth = useCallback(signal => run('health', async activeSignal => {
    setHealth(null);
    try {
      const response = await checkedFetch('/health', {signal: signal || activeSignal});
      setHealth(await response.json());
    }
    catch (error) {
      setHealth({available: false, status: 'unavailable'});
      throw error;
    }
  }), [run]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    loadHealth(controller.signal);
    return () => controller.abort();
  }, [active, loadHealth]);

  async function loadProtected(kind, path, signal, setter, method = 'GET') {
    if (!token) return setter({locked: true});
    try {
      const response = await apiFetch(path, {token, method, signal});
      signal.throwIfAborted();
      setter(await response.json());
    }
    catch (error) {
      if (!signal.aborted) setter(protectedFailure(error, kind));
      throw error;
    }
  }

  // The memory engine line rides on Load capabilities; its failure is reported beside that button.
  async function loadMemory(signal) {
    try {
      const response = await apiFetch('/api/memory/health', {token, signal});
      signal.throwIfAborted();
      const data = await response.json();
      setMemory({protocol: data.protocol, sqlite: data.sqlite});
    }
    catch (err) {
      if (!signal.aborted && !isAuthError(err)) setError({kind: 'capabilities', text: friendlyError(err, 'memory')});
    }
  }

  const native = token === NATIVE_SESSION;
  const reports = [capabilities, mcp, acp];
  const authExpired = !!token && reports.some(report => report?.locked);
  const lock = sessionState(token, authExpired, {draft: false});
  const unavailable = !lock && reports.some(report => report?.available === false);
  const verified = !lock && !unavailable && reports.some(Boolean);
  const sessionStatus = lock ? 'locked' : unavailable ? 'unavailable' : verified ? 'ok' : 'unchecked';
  const who = native ? 'Desktop session' : 'Operator token';
  const sessionCopy = {
    locked: !token ? 'No operator token, so authenticated checks are disabled.' : native ? 'The desktop session was rejected by an authenticated check.' : 'The current operator token was rejected by an authenticated check.',
    unavailable: who + ' present. At least one authenticated check is unavailable in this service; see the card marked Unavailable.',
    ok: native ? 'Desktop session verified by an authenticated check.' : 'Operator token accepted by an authenticated check.',
    unchecked: who + ' present, not yet verified. Load capabilities or run a check.',
  }[sessionStatus];
  const feedback = (...kinds) => <>
    {kinds.includes(busy) && <p role="status">{BUSY[busy]}</p>}
    {error && kinds.includes(error.kind) && <p role="alert">{error.text}</p>}
  </>;

  return <div className="research-workspace diagnostics-workspace">
    <aside className="research-form">
      <p className="eyebrow">Diagnostics</p><h1>Check the local system.</h1>
      <p className="muted">Service status is public. Operator checks need a token: loading capabilities, checking MCP (Model Context Protocol) servers and checking ACP (Agent Client Protocol) agents.</p>
      <LockNotice card={lock} tone={authExpired ? 'error' : 'info'} onUnlock={() => focusTokenField(token, setToken)} unlockLabel={unlockLabel(token)}/>
      <div className="actions">
        <Button isDisabled={!!busy} onPress={() => loadHealth()}>Refresh service</Button>
        <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => run('capabilities', async signal => {
          await loadProtected('capabilities', '/api/capabilities', signal, setCapabilities);
          await loadMemory(signal);
        })}>Load capabilities</Button>
      </div>
      {feedback('health', 'capabilities')}
    </aside>
    <section className="research-results" aria-label="Diagnostics">
      <div className="results-heading"><div><p className="eyebrow">Local service</p><h2>Service status</h2></div><span className="status-label">{health ? words(health.status) : STATE_LABEL.unchecked}</span></div>
      <div className="diagnostics-grid">
        <StatusCard title="Service" state={stateFor(health)}>
          {health?.available === false ? <p className="muted">The last refresh failed. See the message beside Refresh service.</p> : health ? <>
            <dl className="diagnostics-kv">
            <SummaryLine label="Status" value={words(health.status)}/>
            <SummaryLine label="Deployment mode" value={health.deployment}/>
            </dl>
            <details className="diagnostics-advanced">
              <summary>Version and limits</summary>
              <dl className="diagnostics-kv">
                <SummaryLine label="Version" value={health.version}/>
                <SummaryLine label="Memory engine" value={memory ? memory.protocol + ' · SQLite ' + memory.sqlite : 'not loaded'}/>
              </dl>
              <p className="field-note">This public check does not prove scientific validity, model reachability, worker health, MCP or ACP.</p>
            </details>
          </> : <p className="muted">Select Refresh service to read the public service status.</p>}
          <p className="field-note">This public check does not prove token validity.</p>
        </StatusCard>
        <StatusCard title="Operator session" state={sessionStatus}>
          <p>{sessionCopy}</p>
        </StatusCard>
      </div>
      <ConnectionSummary capabilities={capabilities}/>
      <h2>Connection checks (run on demand)</h2>
      <p className="field-note">Consented means you approved that connector.</p>
      <div className="actions">
        <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => run('mcp', signal => loadProtected('mcp', '/api/mcp/servers/check', signal, setMcp, 'POST'))}>Check MCP</Button>
        <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => run('acp', signal => loadProtected('acp', '/api/acp/agents/check', signal, setAcp, 'POST'))}>Check ACP</Button>
      </div>
      {!token && <p className="field-note">Disabled until the header holds an operator token.</p>}
      {feedback('mcp', 'acp')}
      <div className="diagnostics-grid">
        <StatusCard title="MCP servers" state={stateFor(mcp)}><McpReport report={mcp}/></StatusCard>
        <StatusCard title="ACP agents" state={stateFor(acp)}><AcpReport report={acp}/></StatusCard>
      </div>
    </section>
  </div>;
}
