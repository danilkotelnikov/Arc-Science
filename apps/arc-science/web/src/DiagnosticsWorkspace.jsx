import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {NATIVE_SESSION, apiFetch, checkedFetch} from './http';
import './DiagnosticsWorkspace.css';

const LOCKED = 'Operator session is locked. Run `arc-science token --data <project directory>` locally, or read the project owner-only access.token, then paste it in the shared header. Settings is for provider and connection configuration.';
const OFFLINE = 'Arc Science service is offline or unreachable. Start the local service, then refresh diagnostics.';
const UNCHECKED = 'Not checked';

function friendlyError(error) {
  const message = error?.message || String(error);
  if (/Request failed \((401|403)\)/.test(message)) return LOCKED;
  if (/Request failed \(503\)/.test(message)) return 'Connection checks are unavailable in this local service. Check the project settings service, then retry.';
  if (/Request failed \(\d+\)/.test(message)) return 'The connection check could not complete. Review its settings, then retry.';
  if (/Failed to fetch|NetworkError|Load failed/.test(message)) return OFFLINE;
  return message.replace(/\s+/g, ' ').trim();
}

function protectedFailure(error) {
  const message = error?.message || String(error);
  if (/Request failed \((401|403)\)/.test(message)) return {locked: true, error: LOCKED};
  if (/Request failed \(503\)/.test(message)) return {available: false, error: 'Connection checks are unavailable in this local service. Check the project settings service, then retry.'};
  return {available: false, error: friendlyError(error)};
}

function stateFor(value, error) {
  if (error) return 'error';
  if (value === null) return 'unchecked';
  if (value?.locked) return 'locked';
  if (value?.configured === false || value?.available === false) return 'unavailable';
  return 'ok';
}

function StatusCard({title, state, children}) {
  return <article className="diagnostics-card" data-state={state}>
    <h3>{title}</h3>
    {children}
  </article>;
}

function SummaryLine({label, value}) {
  return <><dt>{label}</dt><dd>{value ?? 'Unavailable'}</dd></>;
}

function ConnectionSummary({capabilities}) {
  if (!capabilities) return <p className="muted">{UNCHECKED}. Load operator capabilities to read configured seats and connectors.</p>;
  if (capabilities.locked || capabilities.available === false) return <>
    <h2>Operator capabilities</h2>
    <div className="diagnostics-grid">
      <StatusCard title="Model seats" state={stateFor(capabilities, null)}>
        <p className="muted">{capabilities.error || (capabilities.locked ? LOCKED : 'Unavailable. Configure model seats in Settings.')}</p>
      </StatusCard>
    </div>
  </>;
  const live = capabilities.live || {configured: false};
  const connectors = capabilities.connectors || {};
  return <>
    <h2>Operator capabilities</h2>
    <div className="diagnostics-grid">
      <StatusCard title="Model seats" state={live.configured ? 'ok' : 'unavailable'}>
        {live.configured ? <dl className="diagnostics-kv">
          <SummaryLine label="Planner" value={live.seats?.planner ? live.seats.planner.provider + ' · ' + live.seats.planner.model : live.planner}/>
          <SummaryLine label="Reviewer" value={live.seats?.reviewer ? live.seats.reviewer.provider + ' · ' + live.seats.reviewer.model : live.reviewer}/>
          <SummaryLine label="Falsifier" value={live.seats?.falsifier ? live.seats.falsifier.provider + ' · ' + live.seats.falsifier.model : 'Unavailable'}/>
          <SummaryLine label="Auth" value={live.auth === 'cli' ? 'CLI login' : live.auth || 'API credential'}/>
        </dl> : <p className="muted">Unavailable. Configure model seats in Settings.</p>}
      </StatusCard>
      <StatusCard title="Vision" state={capabilities.vision?.configured ? 'ok' : 'unavailable'}>
        {capabilities.vision?.configured ? <p>{capabilities.vision.provider} · {capabilities.vision.model}</p> : <p className="muted">Unavailable. No configured vision seat was reported.</p>}
      </StatusCard>
      <StatusCard title="MCP" state={connectors.mcp?.configured ? 'ok' : 'unavailable'}>
        <p><strong>{connectors.mcp?.configured ?? 0}</strong> configured · <strong>{connectors.mcp?.consented ?? 0}</strong> consented</p>
        <p className="field-note">SDK: {connectors.mcp?.sdk || 'Unavailable'}</p>
      </StatusCard>
      <StatusCard title="ACP" state={connectors.acp?.configured ? 'ok' : 'unavailable'}>
        <p><strong>{connectors.acp?.configured ?? 0}</strong> configured · <strong>{connectors.acp?.consented ?? 0}</strong> consented</p>
      </StatusCard>
    </div>
    <p className="field-note">This summary reports configuration only. Worker health, inference reachability, MCP tools, and ACP agents require their own explicit checks.</p>
  </>;
}

function McpReport({report}) {
  if (!report) return <p className="muted">{UNCHECKED}. Run the MCP check to ask configured consented servers for their tools.</p>;
  if (report.locked) return <p className="muted">{LOCKED}</p>;
  if (report.available === false) return <p className="muted">{report.error || 'Unavailable. The MCP check could not complete.'}</p>;
  const servers = report.servers || [];
  return <>
    <p className="field-note">SDK {report.sdk || 'Unavailable'} · consented: {(report.consented || []).join(', ') || 'none'}</p>
    {servers.length ? <table className="diagnostics-table" aria-label="MCP diagnostics">
      <tbody>{servers.map(server => <tr key={server.server}>
        <th scope="row">{server.server}</th>
        <td>{server.ok ? (server.tools || []).map(tool => tool.name + (tool.offered === false ? ' (not offered)' : '')).join(', ') || 'No tools' : 'Unavailable: ' + (server.error || 'check failed')}</td>
      </tr>)}</tbody>
    </table> : <p className="muted">No consented MCP servers were checked.</p>}
  </>;
}

function AcpReport({report}) {
  if (!report) return <p className="muted">{UNCHECKED}. Run the ACP check to initialize configured consented agents.</p>;
  if (report.locked) return <p className="muted">{LOCKED}</p>;
  if (report.available === false) return <p className="muted">{report.error || 'Unavailable. The ACP check could not complete.'}</p>;
  const agents = report.agents || [];
  return <>
    <p className="field-note">Protocol {report.protocol_version || 'Unavailable'} · consented: {(report.consented || []).join(', ') || 'none'}</p>
    {agents.length ? <table className="diagnostics-table" aria-label="ACP diagnostics">
      <tbody>{agents.map(agent => <tr key={agent.agent}>
        <th scope="row">{agent.agent}</th>
        <td>{agent.ok ? [agent.agent_info?.name || 'Agent', agent.agent_info?.version].filter(Boolean).join(' · ') : 'Unavailable: ' + (agent.error || 'check failed')}</td>
      </tr>)}</tbody>
    </table> : <p className="muted">No consented ACP agents were checked.</p>}
  </>;
}

export default function DiagnosticsWorkspace({token, active = true}) {
  const [health, setHealth] = useState(null), [capabilities, setCapabilities] = useState(null);
  const [mcp, setMcp] = useState(null), [acp, setAcp] = useState(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const credential = useRef(null);

  useLayoutEffect(() => {
    const controller = new AbortController();
    credential.current = controller;
    setCapabilities(null); setMcp(null); setAcp(null); setError(''); setBusy('');
    return () => controller.abort();
  }, [token]);

  const run = useCallback(async (kind, action) => {
    const signal = credential.current.signal;
    setBusy(kind); setError('');
    try { await action(signal); }
    catch (err) { if (!signal.aborted) setError(friendlyError(err)); }
    finally { if (!signal.aborted) setBusy(''); }
  }, []);

  const loadHealth = useCallback(signal => run('health', async activeSignal => {
    setHealth(null);
    try {
      const response = await checkedFetch('/health', {signal: signal || activeSignal});
      setHealth(await response.json());
    }
    catch (error) {
      setHealth({available: false, status: 'unavailable', error: friendlyError(error)});
      throw error;
    }
  }), [run]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    loadHealth(controller.signal);
    return () => controller.abort();
  }, [active, loadHealth]);

  async function loadProtected(path, signal, setter, method = 'GET') {
    if (!token) {
      setter({locked: true});
      throw new Error(LOCKED);
    }
    try {
      const response = await apiFetch(path, {token, method, signal});
      signal.throwIfAborted();
      setter(await response.json());
    }
    catch (error) {
      if (!signal.aborted) setter(protectedFailure(error));
      throw error;
    }
  }

  const sessionLocked = !token || capabilities?.locked || mcp?.locked || acp?.locked;
  const sessionUnavailable = !sessionLocked && (capabilities?.available === false || mcp?.available === false || acp?.available === false);
  const sessionState = sessionLocked ? 'locked' : sessionUnavailable ? 'unavailable' : token ? 'unchecked' : 'locked';
  const sessionCopy = !token
    ? 'Locked. Authenticated diagnostics are disabled.'
    : sessionLocked
      ? token === NATIVE_SESSION ? 'Desktop session unavailable. Use an operator token to retry.' : 'Locked. The current operator token was rejected by an authenticated check.'
      : sessionUnavailable
        ? (token === NATIVE_SESSION ? 'Desktop session ready.' : 'Operator token present.') + ' At least one authenticated diagnostic route is unavailable in this service.'
        : token === NATIVE_SESSION ? 'Desktop session ready. Authenticated diagnostics have not been loaded yet.' : 'Operator token present. Authenticated diagnostics have not been loaded yet.';

  return <div className="research-workspace diagnostics-workspace">
    <aside className="research-form">
      <p className="eyebrow">DIAGNOSTICS</p><h1>Check the local system.</h1>
      <p className="muted">Public service status is separate from authenticated operator checks.</p>
      {!token && <div className="unlock-card" role="status"><strong>Local unlock required</strong><p>{LOCKED}</p></div>}
      <div className="actions">
        <Button isDisabled={!!busy} onPress={() => loadHealth()}>Refresh service</Button>
        <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => run('capabilities', signal => loadProtected('/api/capabilities', signal, setCapabilities))}>Load capabilities</Button>
      </div>
      {busy && <p role="status">{busy === 'health' ? 'Refreshing service status…' : 'Diagnostics request in progress…'}</p>}
      {error && <p role="alert">{error}</p>}
    </aside>
    <section className="research-results" aria-label="Diagnostics">
      <div className="results-heading"><div><p className="eyebrow">Local service</p><h2>Runtime status</h2></div><span className="status-label">{health ? health.status : UNCHECKED}</span></div>
      <div className="diagnostics-grid">
        <StatusCard title="Service" state={stateFor(health, null)}>
          {health?.available === false ? <p className="muted">{health.error || OFFLINE}</p> : health ? <>
            <dl className="diagnostics-kv">
            <SummaryLine label="Status" value={health.status}/>
            <SummaryLine label="Deployment" value={health.deployment}/>
            </dl>
            <details className="diagnostics-advanced">
              <summary>Advanced</summary>
              <dl className="diagnostics-kv">
                <SummaryLine label="Version" value={health.version}/>
              </dl>
              <p className="field-note">Scientific validity, model reachability, worker health, MCP, and ACP are not proven by this public service check.</p>
            </details>
          </> : <p className="muted">{UNCHECKED}. Refresh service to read public readiness.</p>}
          <p className="field-note">This public check does not prove token validity.</p>
        </StatusCard>
        <StatusCard title="Session" state={sessionState}>
          <p>{sessionCopy}</p>
        </StatusCard>
      </div>
      <ConnectionSummary capabilities={capabilities}/>
      <h2>Explicit connection checks</h2>
      <div className="actions">
        <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => run('mcp', signal => loadProtected('/api/mcp/servers/check', signal, setMcp, 'POST'))}>Check MCP</Button>
        <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => run('acp', signal => loadProtected('/api/acp/agents/check', signal, setAcp, 'POST'))}>Check ACP</Button>
      </div>
      <div className="diagnostics-grid">
        <StatusCard title="MCP servers" state={stateFor(mcp, null)}><McpReport report={mcp}/></StatusCard>
        <StatusCard title="ACP agents" state={stateFor(acp, null)}><AcpReport report={acp}/></StatusCard>
      </div>
    </section>
  </div>;
}
