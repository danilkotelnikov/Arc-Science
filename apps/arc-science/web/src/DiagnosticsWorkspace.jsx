import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {NATIVE_SESSION, SESSION_COPY, apiFetch, checkedFetch, sessionState} from './http';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';
import {STATE_LABEL, loginLine, probeLine, stateOf} from './readiness';
import './DiagnosticsWorkspace.css';

const OFFLINE = SESSION_COPY.offline.title + '. Start the local service, then retry.';
const NEEDS_SESSION = 'Needs a desktop session or an operator token.';
const LOCKED_LINE = 'Unlocks when the header holds an accepted desktop session or operator token.';
const NO_SETTINGS = 'missing its settings or the MCP package';
const BUSY = {health: 'Refreshing service status…', readiness: 'Reading readiness…', mcp: 'Checking MCP servers…', acp: 'Checking ACP agents…'};

const isAuthError = error => /Request failed \((401|403)\)/.test(error?.message || String(error));
const words = value => typeof value === 'string' ? value.replace(/_/g, ' ') : value;
const flag = value => typeof value === 'boolean' ? (value ? 'yes' : 'no') : value;

function friendlyError(error, kind) {
  const message = error?.message || String(error);
  if (/Request failed \(503\)/.test(message)) return (kind === 'readiness' ? 'Readiness is' : 'Connection checks are') + ' unavailable in this local service: it is ' + NO_SETTINGS + '. Fix that, then retry.';
  if (/Request failed \(\d+\)/.test(message)) return 'The request could not complete (the service returned an error). Retry; if it persists, review Settings.';
  if (/Failed to fetch|NetworkError|Load failed/.test(message)) return OFFLINE;
  if (/JSON|Unexpected token|Unexpected end/.test(message)) return 'The service returned an unreadable response. Retry.';
  return message.replace(/\s+/g, ' ').trim();
}

// The card beside a failed connection check keeps one short line; the alert beside the button carries the instruction.
function protectedFailure(error) {
  if (isAuthError(error)) return {locked: true};
  if (/Request failed \(503\)/.test(error?.message || '')) return {available: false, error: 'This local service is ' + NO_SETTINGS + '. Retry after that is fixed.'};
  return {available: false, error: 'The check failed. See the message above.'};
}

function stateFor(report) {
  if (report === null) return 'not_tested';
  if (report?.locked) return 'blocked';
  if (report?.available === false) return 'failed';
  return 'ready';
}

function StatusCard({title, state, wide = false, children}) {
  return <article className={'diagnostics-card' + (wide ? ' wide' : '')} data-state={state}>
    <div className="diagnostics-card-head"><h3>{title}</h3><span className="readiness-badge" data-state={state}>{STATE_LABEL[state]}</span></div>
    {children}
  </article>;
}

function SummaryLine({label, value}) {
  return <><dt>{label}</dt><dd>{value ?? 'Unavailable'}</dd></>;
}

// Every readiness node speaks its meaning; a node that is not ready also says what to do.
function Meaning({node}) {
  return <>
    <p>{node.meaning}</p>
    {stateOf(node) !== 'ready' && node.next_action && <p className="field-note">Next: {node.next_action}</p>}
  </>;
}

function ReadinessCard({title, node, placeholder, wide, children}) {
  if (!node) return <StatusCard title={title} state="unknown" wide={wide}><p className="muted">{placeholder}</p></StatusCard>;
  return <StatusCard title={title} state={stateOf(node)} wide={wide}>{children}<Meaning node={node}/></StatusCard>;
}

function NodeRow({name, node, children}) {
  const state = stateOf(node);
  return <tr data-state={state}>
    <th scope="row">{name}</th>
    <td><span className="readiness-badge" data-state={state}>{STATE_LABEL[state]}</span> {node?.meaning}{state !== 'ready' && node?.next_action && <span className="field-note"> Next: {node.next_action}</span>}</td>
    {children}
  </tr>;
}

// The last probe is what readiness verified; a CLI seat's login is a fact beside it, not a verification.
function SeatRow({name, node}) {
  const login = loginLine(node);
  return <NodeRow name={name} node={node}><td>{probeLine(node)}{login && <span className="field-note"> {login}</span>}</td></NodeRow>;
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

export default function DiagnosticsWorkspace({token, setToken, active = true, readiness = null, readinessError = null, refreshReadiness, onNavigate}) {
  const [health, setHealth] = useState(null);
  const [mcp, setMcp] = useState(null), [acp, setAcp] = useState(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(null);
  const credential = useRef(null);

  useLayoutEffect(() => {
    const controller = new AbortController();
    credential.current = controller;
    setMcp(null); setAcp(null); setError(null); setBusy('');
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

  async function loadProtected(path, signal, setter) {
    if (!token) return setter({locked: true});
    try {
      const response = await apiFetch(path, {token, method: 'POST', signal});
      signal.throwIfAborted();
      setter(await response.json());
    }
    catch (error) {
      if (!signal.aborted) setter(protectedFailure(error));
      throw error;
    }
  }

  const native = token === NATIVE_SESSION;
  const who = native ? 'Desktop session' : 'Operator token';
  const rejected = !!token && (isAuthError(readinessError) || [mcp, acp].some(report => report?.locked));
  const lock = sessionState(token, rejected, {draft: false});
  const readingFailed = !!readinessError && !isAuthError(readinessError);
  // A desktop session reads readiness on its own; a manual token reads it when asked.
  const placeholder = !token ? NEEDS_SESSION : busy === 'readiness' || (native && !readinessError) ? BUSY.readiness
    : rejected ? 'Not read: the session was rejected.' : readingFailed ? 'Readiness could not be read. See the message beside Refresh readiness.' : 'Select Refresh readiness to read it.';
  // A malformed answer is data, not a crash: missing nodes read as unknown.
  const session = readiness?.session || (readiness ? {state: 'unknown', meaning: 'The service did not describe the session.'}
    : !token ? {state: 'blocked', meaning: 'No desktop session and no operator token.', next_action: 'Unlock in the header.'}
    : rejected ? {state: 'failed', meaning: (native ? 'The desktop session' : 'The operator token') + ' was rejected by the service.'}
    : readingFailed ? {state: 'unknown', meaning: who + ' present; readiness could not be read.', next_action: 'See the message beside Refresh readiness.'}
    : {state: 'not_tested', meaning: who + ' present, not yet verified.', next_action: native ? null : 'Select Refresh readiness.'});
  const engine = readiness?.memory?.facts;
  const connectors = readiness ? [...(readiness.connectors?.mcp || []).map(row => ({kind: 'MCP', ...row})), ...(readiness.connectors?.acp || []).map(row => ({kind: 'ACP', ...row}))] : [];
  // The card's own state comes from the server summary; rows keep theirs beside them.
  const connectorNode = readiness && {state: stateOf(readiness.connectors), meaning: readiness.connectors?.meaning, next_action: readiness.connectors?.next_action};
  const feedback = (...kinds) => <>
    {kinds.includes(busy) && <p role="status">{BUSY[busy]}</p>}
    {error && kinds.includes(error.kind) && <p role="alert">{error.text}</p>}
    {kinds.includes('readiness') && readingFailed && busy !== 'readiness' && friendlyError(readinessError, 'readiness') !== error?.text && <p role="alert">{friendlyError(readinessError, 'readiness')}</p>}
  </>;

  return <div className="research-workspace diagnostics-workspace">
    <aside className="research-form">
      <p className="eyebrow">Diagnostics</p><h1>Check the local system.</h1>
      <p className="muted">Service status is public. Everything else comes from one readiness read, which needs a desktop session or an operator token: it reads settings and cached facts, spends no model tokens and starts nothing. Re-read logins asks each CLI for its login state again instead of the 30 s cache.</p>
      <LockNotice card={lock} tone={rejected ? 'error' : 'info'} onUnlock={() => focusTokenField(token, setToken)} unlockLabel={unlockLabel(token)}/>
      <div className="actions">
        <Button isDisabled={!!busy} onPress={() => loadHealth()}>Refresh service</Button>
        <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => run('readiness', () => refreshReadiness?.())}>Refresh readiness</Button>
        <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => run('readiness', () => refreshReadiness?.({fresh: true}))}>Refresh readiness (re-read logins)</Button>
      </div>
      {!token && <p className="field-note">{NEEDS_SESSION}</p>}
      {feedback('health', 'readiness')}
    </aside>
    <section className="research-results" aria-label="Diagnostics">
      <div className="results-heading"><div><p className="eyebrow">Local service</p><h2>Service status</h2></div><span className="status-label">{health ? words(health.status) : STATE_LABEL.not_tested}</span></div>
      <div className="diagnostics-grid">
        <StatusCard title="Service" state={health ? (health.available === false ? 'failed' : health.status === 'ready' ? 'ready' : 'unknown') : 'not_tested'}>
          {health?.available === false ? <p className="muted">The last refresh failed. See the message beside Refresh service.</p> : health ? <>
            <dl className="diagnostics-kv">
            <SummaryLine label="Status" value={words(health.status)}/>
            <SummaryLine label="Deployment mode" value={health.deployment}/>
            </dl>
            <details className="diagnostics-advanced">
              <summary>Version and limits</summary>
              <dl className="diagnostics-kv">
                <SummaryLine label="Version" value={health.version}/>
                <SummaryLine label="Memory engine" value={engine?.protocol ? engine.protocol + ' · SQLite ' + engine.sqlite : readiness ? 'unavailable' : 'not loaded'}/>
              </dl>
              <p className="field-note">This public check does not prove scientific validity, model reachability, worker health, MCP or ACP.</p>
            </details>
          </> : <p className="muted">Select Refresh service to read the public service status.</p>}
          <p className="field-note">This public check does not prove the session is accepted.</p>
        </StatusCard>
        <StatusCard title="Session" state={stateOf(session)}>
          {session.label && <p><strong>{session.label}</strong></p>}
          <Meaning node={session}/>
        </StatusCard>
      </div>
      <h2>Readiness</h2>
      <p className="field-note">A seat is one model assigned to one role; a connector is an MCP server or an ACP agent.{readiness?.checked_at > 0 && ' Read at ' + new Date(readiness.checked_at * 1000).toLocaleString() + '.'}</p>
      <div className="diagnostics-grid">
        <ReadinessCard title="Settings" node={readiness?.settings} placeholder={placeholder}>
          {readiness && <dl className="diagnostics-kv">
            <SummaryLine label="Revision" value={readiness.settings?.revision?.slice(0, 12)}/>
            <SummaryLine label="Path" value={readiness.settings?.path?.replace(/^\\\\\?\\/, '')}/>
            <SummaryLine label="Read-only" value={flag(readiness.settings?.read_only)}/>
          </dl>}
        </ReadinessCard>
        <ReadinessCard title="Seats" node={readiness?.live_mission} placeholder={placeholder} wide>
          {readiness && <>
            <table className="diagnostics-table" aria-label="Seat readiness">
              <thead className="visually-hidden"><tr><th scope="col">Seat</th><th scope="col">Readiness</th><th scope="col">Last probe</th></tr></thead>
              <tbody>{(readiness.roles || []).map(role => <SeatRow key={role.role} name={role.label} node={readiness.seats?.[role.role]}/>)}</tbody>
            </table>
            {onNavigate && <Button variant="secondary" size="sm" onPress={() => onNavigate('settings')}>Open Settings</Button>}
          </>}
        </ReadinessCard>
        <ReadinessCard title="Connectors" node={connectorNode} placeholder={placeholder} wide>
          {readiness && <>
            {connectors.length > 0 && <table className="diagnostics-table" aria-label="Connector readiness">
              <tbody>{connectors.map(row => <NodeRow key={row.kind + ' ' + row.name} name={row.kind + ' · ' + row.name} node={row}/>)}</tbody>
            </table>}
            <p className="field-note">MCP SDK: {readiness.connectors?.mcp_sdk || 'Unavailable'} · ACP protocol: {readiness.connectors?.acp_protocol || 'Unavailable'}</p>
          </>}
        </ReadinessCard>
        <ReadinessCard title="Renderer" node={readiness?.renderer} placeholder={placeholder}>
          {readiness && <dl className="diagnostics-kv">
            <SummaryLine label="Configured" value={flag(readiness.renderer?.facts?.configured)}/>
            <SummaryLine label="Executable found" value={flag(readiness.renderer?.facts?.exists)}/>
            <SummaryLine label="Default preset" value={readiness.renderer?.facts?.default_preset}/>
          </dl>}
        </ReadinessCard>
        <ReadinessCard title="Memory" node={readiness?.memory} placeholder={placeholder}>
          {engine && Object.keys(engine).length > 0 && <dl className="diagnostics-kv">
            {Object.entries(engine).filter(([, value]) => typeof value !== 'object').map(([key, value]) => <SummaryLine key={key} label={words(key)} value={flag(value)}/>)}
          </dl>}
        </ReadinessCard>
        <ReadinessCard title="Storage" node={readiness?.storage} placeholder={placeholder}>
          {readiness && <dl className="diagnostics-kv">
            <SummaryLine label="Missions database" value={flag(readiness.storage?.facts?.missions_db)}/>
            <SummaryLine label="Missions" value={readiness.storage?.facts?.missions}/>
          </dl>}
        </ReadinessCard>
      </div>
      <h2>Connection checks (run on demand)</h2>
      <p className="field-note">Consented means you approved that connector.</p>
      <div className="actions">
        <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => run('mcp', signal => loadProtected('/api/mcp/servers/check', signal, setMcp))}>Check MCP</Button>
        <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => run('acp', signal => loadProtected('/api/acp/agents/check', signal, setAcp))}>Check ACP</Button>
      </div>
      {!token && <p className="field-note">{NEEDS_SESSION}</p>}
      {feedback('mcp', 'acp')}
      <div className="diagnostics-grid">
        <StatusCard title="MCP servers" state={stateFor(mcp)}><McpReport report={mcp}/></StatusCard>
        <StatusCard title="ACP agents" state={stateFor(acp)}><AcpReport report={acp}/></StatusCard>
      </div>
    </section>
  </div>;
}
