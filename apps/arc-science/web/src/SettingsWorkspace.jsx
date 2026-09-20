import React, {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {apiFetch} from './http';
import './SettingsWorkspace.css';

// Settings are owned by the native supervisor: the service reads a snapshot with a
// revision and forwards the whole edited document back with that revision, so a
// concurrent change is refused instead of overwritten. Nothing here holds a key:
// seats name a credential file or the operator's own CLI login.
const ROLES = [['planner', 'Planner'], ['reviewer', 'Reviewer (QA)'], ['falsifier', 'Falsifier'], ['vision', 'Vision'], ['prose', 'Prose']];
const PROVIDERS = [['', '-'], ['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['gemini', 'Gemini'], ['openclaw', 'OpenClaw']];
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const AUTH = [['api_key', 'API credential'], ['cli', 'CLI login (OAuth)']];
const DEFAULT_EFFORT = 'medium';
const SUPPORTED_EFFORTS = {
  'anthropic:api': ['low', 'medium', 'high', 'xhigh', 'max'],
  'anthropic:cli': ['low', 'medium', 'high', 'xhigh', 'max'],
  'openai:api': EFFORTS,
  'openai:cli': EFFORTS,
  'gemini:api': ['minimal', 'low', 'medium', 'high'],
  'gemini:cli': [],
  'openclaw:api': []
};
const VIEWER = {representation: ['cartoon', 'surface', 'ball_and_stick', 'sticks', 'spacefill', 'backbone'],
  colouring: ['chain', 'element', 'residue', 'secondary_structure', 'bfactor', 'uniform'],
  assembly: ['asymmetric_unit', 'assembly_1', 'assembly_2'], background: ['white', 'black', 'transparent']};

function formatList(items, fallback = 'none') {
  return Array.isArray(items) && items.length ? items.join(', ') : fallback;
}

function describeSettingsError(error) {
  const message = error?.message || String(error || '');
  if (message.includes('Operator token is required')) return {
    kind: 'locked',
    title: 'Unlock Settings',
    text: 'Enter an operator token in the header, or open Arc Science from the native desktop session.',
    alert: 'Settings is locked. Add an operator token before loading settings.'
  };
  if (message.includes('Request failed (401)')) return {
    kind: 'locked',
    title: 'Session Expired',
    text: 'The operator session was rejected. Refresh the token in the header and retry.',
    alert: 'Operator session is locked or expired.'
  };
  if (message.includes('Request failed (503)') && message.toLowerCase().includes('settings file')) return {
    kind: 'unconfigured',
    title: 'Supervisor Settings Unavailable',
    text: 'This service was started without a supervisor settings file. Start Arc Science from the native app or configure the service settings path, then reload.',
    alert: 'Settings are unavailable because no supervisor settings file is configured.'
  };
  if (message.includes('Request failed (409)')) return {
    kind: 'conflict',
    title: 'Settings Changed Elsewhere',
    text: 'The saved revision is newer than the one you loaded. Your edits are still on screen; reload only after copying anything you want to keep.',
    alert: 'Settings changed elsewhere. Your unsaved edits were kept.'
  };
  if (message.includes('Request failed (422)')) return {
    kind: 'invalid',
    title: 'Settings Need Attention',
    text: message.replace(/^Request failed \(422\):?\s*/, '') || 'The supervisor rejected the edited settings.',
    alert: 'Settings validation failed. Fix the highlighted values and retry.'
  };
  if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('Load failed')) return {
    kind: 'offline',
    title: 'Service Unreachable',
    text: 'Arc Science is not reachable from this window. Keep this page open, restart the service, then retry.',
    alert: 'Arc Science service is offline or unreachable.'
  };
  return {
    kind: 'error',
    title: 'Settings Request Failed',
    text: 'The request did not complete. The current draft was kept.',
    alert: message.replace(/^Request failed \(\d+\):?\s*/, '') || 'Settings request failed.'
  };
}

function transportFor(seat) {
  return seat.auth === 'cli' ? 'cli' : 'api';
}

function providerLabel(provider) {
  return PROVIDERS.find(([value]) => value === provider)?.[1] || provider || 'Provider';
}

function effortSupport(seat) {
  if (!seat.provider) return {allowed: EFFORTS, disabled: false, note: 'Select a provider to check transport effort support.'};
  const transport = transportFor(seat);
  const supported = SUPPORTED_EFFORTS[seat.provider + ':' + transport];
  if (supported === undefined) return {allowed: EFFORTS, disabled: false, invalid: true, note: 'This provider/auth transport is not available.'};
  if (supported.length === 0) return {
    allowed: [DEFAULT_EFFORT],
    disabled: true,
    invalid: seat.effort !== DEFAULT_EFFORT,
    note: providerLabel(seat.provider) + ' ' + transport.toUpperCase() + ' has no per-call effort control; medium keeps the provider default.'
  };
  return {
    allowed: supported,
    disabled: false,
    invalid: !supported.includes(seat.effort),
    note: 'Supported here: ' + supported.join(', ') + (seat.provider === 'openai' ? '. OpenAI can still refuse a level for a specific model.' : '.')
  };
}

function seatIssue(role, seat) {
  const label = ROLES.find(([key]) => key === role)?.[1] || role;
  if (seat.provider && !seat.model) return {role, message: label + ': model id is required when a provider is selected.'};
  if (seat.provider && seat.auth === 'api_key' && !seat.credential) return {role, message: label + ': credential file name is required for API auth.'};
  const support = effortSupport(seat);
  if (support.invalid) return {role, message: label + ': ' + support.note};
  return null;
}

function readiness(role, seat, providers, live, probes) {
  if (!seat.provider) return {tone: 'neutral', label: 'inactive', detail: 'No provider selected.'};
  if (!seat.model) return {tone: 'warn', label: 'incomplete', detail: 'Model id is required before this seat can run.'};
  if (seat.auth === 'api_key' && !seat.credential) return {tone: 'warn', label: 'incomplete', detail: 'Credential file name is required.'};
  if (seat.auth === 'cli' && !providers?.[seat.provider]?.cli) return {tone: 'warn', label: 'incomplete', detail: 'CLI executable is not configured for this provider.'};
  const liveSeat = live?.seats?.[role];
  const matchesLive = liveSeat && liveSeat.provider === seat.provider && liveSeat.model === seat.model && liveSeat.transport === transportFor(seat);
  if (seat.auth === 'cli') {
    const transport = live?.transports?.[seat.provider];
    const probe = probes[seat.provider] || transport?.last_probe;
    if (!transport) return {tone: matchesLive ? 'neutral' : 'warn', label: matchesLive ? 'configured' : 'not checked', detail: matchesLive ? 'Configured, but CLI login state is not reported.' : 'Load connection state to check this CLI seat.'};
    if (!transport.logged_in) return {tone: 'warn', label: 'not signed in', detail: 'Configured CLI exists, but the provider session is not signed in.'};
    if (!probe) return {tone: 'neutral', label: 'not probed', detail: 'Signed-in CLI detected. Probe only with explicit consent.'};
    const failed = (probe.results || []).some(result => !result.ok);
    return {tone: failed ? 'warn' : 'ok', label: failed ? 'probe failed' : 'probed', detail: failed ? 'Last probe reported at least one failed selector.' : 'Last probe reached the configured selector.'};
  }
  return {tone: matchesLive ? 'neutral' : 'warn', label: matchesLive ? 'configured' : 'not checked', detail: matchesLive ? 'API credential is configured; no live inference was run.' : 'Load connection state to compare this API seat with the running route.'};
}

export default function SettingsWorkspace({token}) {
  const [snapshot, setSnapshot] = useState(null), [draft, setDraft] = useState(null);
  const [error, setError] = useState(null), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null), [probes, setProbes] = useState({}), [consent, setConsent] = useState(false);
  const [checks, setChecks] = useState({});
  const credential = useRef(null);
  useLayoutEffect(() => {
    const controller = new AbortController(); credential.current = controller;
    setSnapshot(null); setDraft(null); setError(null); setNotice(''); setBusy(false); setLive(null); setProbes({}); setConsent(false); setChecks({});
    return () => controller.abort();
  }, [token]);
  const read = useCallback(async (path, signal, method = 'GET', body) => {
    signal.throwIfAborted();
    const response = await apiFetch('/api' + path, {token, method, signal, headers: {'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
    const data = await response.json();
    signal.throwIfAborted();
    return data;
  }, [token]);
  async function task(action) {
    const signal = credential.current.signal;
    setBusy(true); setError(null); setNotice('');
    try { await action(signal); }
    catch (e) { if (!signal.aborted) setError(describeSettingsError(e)); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  async function connections(signal) {
    // Cost-free: the CLI's own login state per provider, never an inference.
    const caps = await read('/capabilities', signal);
    setLive(caps.live || {configured: false});
  }
  async function load(signal) {
    const snap = await read('/settings', signal);
    setSnapshot(snap); setDraft(structuredClone(snap.settings));
    await connections(signal);
  }
  async function check(kind, signal) {
    // Cost-free and data-free: an MCP server lists its tools, an ACP agent answers initialize.
    const result = await read(kind === 'mcp' ? '/mcp/servers/check' : '/acp/agents/check', signal, 'POST');
    setChecks(current => ({...current, [kind]: result}));
  }
  async function probe(provider, signal) {
    // Explicit consent per click: a probe makes one real model call per distinct seat.
    const result = await read('/providers/' + provider + '/probe', signal, 'POST', {spend_tokens: true});
    setProbes(current => ({...current, [provider]: result}));
  }
  async function save(signal) {
    const snap = await read('/settings', signal, 'PUT', {settings: draft, if_revision: snapshot.revision});
    setSnapshot(snap); setDraft(structuredClone(snap.settings));
    await connections(signal);
    setNotice('Saved. Applied live: ' + formatList(snap.applied_live) + '. Stored for later loops: ' + formatList(snap.stored_pending) + '.' + ((snap.restart_required || []).length ? ' Restart required for ' + snap.restart_required.join(', ') + '.' : ''));
  }
  const dirty = snapshot && draft && JSON.stringify(draft) !== JSON.stringify(snapshot.settings);
  const set = (path, value) => setDraft(current => {
    const next = structuredClone(current);
    let cursor = next;
    for (const key of path.slice(0, -1)) cursor = cursor[key];
    cursor[path[path.length - 1]] = value;
    return next;
  });
  const readOnly = snapshot?.read_only === true;
  const seatIssues = draft ? ROLES.map(([role]) => seatIssue(role, draft.seats[role])).filter(Boolean) : [];
  const loadedSummary = snapshot ? 'Revision ' + snapshot.revision.slice(0, 12) + (readOnly ? ' read only' : dirty ? ' unsaved edits' : ' saved') : 'Not loaded';
  return <div className="research-workspace settings-workspace">
    <aside className="research-form settings-sidebar">
      <p className="eyebrow">SETTINGS</p><h1>Configure Arc Science.</h1>
      <p className="muted">Settings are edited here and written back through the native supervisor with the revision you loaded.</p>
      <div className="settings-status" aria-live="polite">
        <strong>{loadedSummary}</strong>
        {snapshot && <span><code>{snapshot.path}</code>{readOnly ? ' - supervisor write access is unavailable' : ''}</span>}
      </div>
      <div className="actions">
        <Button variant="secondary" isDisabled={busy || !token} onPress={() => task(load)}>{snapshot ? 'Reload' : 'Load settings'}</Button>
        <Button isDisabled={busy || !dirty || readOnly || seatIssues.length > 0} onPress={() => task(save)}>Save</Button>
      </div>
      {!token && <StateCard state={describeSettingsError(new Error('Operator token is required for protected requests.'))}/>}
      {busy && <p role="status">Settings request in progress...</p>}
      {error && <StateCard state={error}/>}
      {error && <p role="alert">{error.alert}</p>}
      {notice && <p role="status">{notice}</p>}
    </aside>
    <section className="research-results settings" aria-label="Settings">
      {!draft ? <div className="empty-state"><h2>Load settings to edit seats and connections.</h2><p>When the supervisor is unavailable, this page will show the recovery step instead of a raw service error.</p></div> : <>
        <SettingsSection title="Research Models" summary="Select the provider, model, auth method and reasoning effort for each role." open>
          {seatIssues.length > 0 && <div className="settings-validation" role="alert">
            <strong>Resolve these before saving.</strong>
            <ul>{seatIssues.map(issue => <li key={issue.role}>{issue.message}</li>)}</ul>
          </div>}
          <table className="seats settings-table"><thead><tr><th>Seat</th><th>Provider</th><th>Model</th><th>Effort</th><th>Auth</th><th>Credential</th><th>Readiness</th></tr></thead><tbody>
            {ROLES.map(([role, label]) => { const seat = draft.seats[role]; const id = 'seat-' + role; const support = effortSupport(seat); const state = readiness(role, seat, draft.providers, live, probes); return <tr key={role} className={support.invalid ? 'seat-invalid' : undefined}>
              <th scope="row">{label}</th>
              <td><select aria-label={label + ' provider'} value={seat.provider} disabled={readOnly} onChange={e => {
                const next = {...seat, provider: e.target.value};
                const nextSupport = effortSupport(next);
                setDraft(current => {
                  const copy = structuredClone(current);
                  copy.seats[role].provider = e.target.value;
                  if (!nextSupport.allowed.includes(copy.seats[role].effort)) copy.seats[role].effort = nextSupport.allowed[0] || DEFAULT_EFFORT;
                  return copy;
                });
              }}>{PROVIDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
              <td><input aria-label={label + ' model'} value={seat.model} disabled={readOnly} onChange={e => set(['seats', role, 'model'], e.target.value)} placeholder="model id" id={id + '-model'}/></td>
              <td><select aria-label={label + ' effort'} value={seat.effort} disabled={readOnly || (support.disabled && !support.invalid)} aria-invalid={support.invalid || undefined} onChange={e => set(['seats', role, 'effort'], e.target.value)}>
                {support.allowed.includes(seat.effort) ? null : <option value={seat.effort}>{seat.effort} (unsupported)</option>}
                {support.allowed.map(v => <option key={v} value={v}>{v}</option>)}
              </select><p className="seat-guidance">{support.note}</p></td>
              <td><select aria-label={label + ' auth'} value={seat.auth} disabled={readOnly} onChange={e => {
                const next = {...seat, auth: e.target.value};
                const nextSupport = effortSupport(next);
                setDraft(current => {
                  const copy = structuredClone(current);
                  copy.seats[role].auth = e.target.value;
                  if (!nextSupport.allowed.includes(copy.seats[role].effort)) copy.seats[role].effort = nextSupport.allowed[0] || DEFAULT_EFFORT;
                  return copy;
                });
              }}>{AUTH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
              <td><input aria-label={label + ' credential'} value={seat.credential} disabled={readOnly || seat.auth !== 'api_key'} onChange={e => set(['seats', role, 'credential'], e.target.value)} placeholder={role}/></td>
              <td><SeatReadiness state={state}/></td>
            </tr>; })}
          </tbody></table>
          <p className="field-note">Credentials name files written by <code>arc-science credential --name NAME</code>; CLI login uses the provider's own signed-in account. Effort a transport cannot express is refused by the supervisor, not rounded.</p>
        </SettingsSection>

        <SettingsSection title="Connections" summary="Review live seats, probe signed-in CLIs and manage consented MCP/ACP tools.">
          {!live ? <p className="muted">Load settings to inspect live connection state.</p> : !live.configured ? <p className="muted">No live seats are configured, so nothing is connected.</p> : <LiveConnections live={live} probes={probes} consent={consent} setConsent={setConsent} busy={busy} probe={(provider) => task(signal => probe(provider, signal))}/>}
          <h3>MCP servers</h3>
          <ListEditor rows={draft.mcp_servers} readOnly={readOnly} kind="mcp" onChange={rows => set(['mcp_servers'], rows)}/>
          <div className="actions"><Button variant="secondary" size="sm" isDisabled={busy || !snapshot} onPress={() => task(signal => check('mcp', signal))}>List MCP tools</Button></div>
          {checks.mcp && <div className="check-report" aria-label="MCP servers checked">
            <p className="field-note">SDK {checks.mcp.sdk || 'not installed'} - consented: {formatList(checks.mcp.consented)}</p>
            {(checks.mcp.servers || []).map(srv => <p key={srv.server}><strong>{srv.server}</strong>: {srv.ok ? (srv.tools || []).map(t => t.name + (t.offered ? '' : ' (not offered: ' + t.reason + ')')).join(', ') || 'no tools' : 'failed - ' + srv.error}</p>)}
          </div>}
          <p className="field-note">Only a server with consent is offered to missions, every call still needs mission egress consent, and results are untrusted content.</p>
          <h3>ACP agents</h3>
          <ListEditor rows={draft.acp_agents} readOnly={readOnly} kind="acp" onChange={rows => set(['acp_agents'], rows)}/>
          <div className="actions"><Button variant="secondary" size="sm" isDisabled={busy || !snapshot} onPress={() => task(signal => check('acp', signal))}>Check ACP agents</Button></div>
          {checks.acp && <div className="check-report" aria-label="ACP agents checked">
            <p className="field-note">Protocol {checks.acp.protocol_version} - consented: {formatList(checks.acp.consented)}</p>
            {(checks.acp.agents || []).map(a => <p key={a.agent}><strong>{a.agent}</strong>: {a.ok ? (a.agent_info?.name || 'agent') + ' ' + (a.agent_info?.version || '') + (a.auth_methods?.length ? ' - auth: ' + a.auth_methods.join(', ') : '') : 'failed - ' + a.error}</p>)}
          </div>}
          <p className="field-note">A consented ACP agent is one consultation tool for missions; Arc gives it no file or terminal access. Its reply is untrusted text, never evidence.</p>
        </SettingsSection>

        <SettingsSection title="Rendering" summary="Choose the Blender render preset used by molecular output.">
          <div className="settings-grid">
            <div><label htmlFor="blender-preset">Blender preset</label><input id="blender-preset" value={draft.blender.default_preset} disabled={readOnly} onChange={e => set(['blender', 'default_preset'], e.target.value)}/></div>
          </div>
        </SettingsSection>

        <SettingsSection title="Viewer" summary="Set the default molecular viewer representation and scene appearance.">
          <div className="settings-grid">
            {Object.entries(VIEWER).map(([key, options]) => <div key={key}><label htmlFor={'viewer-' + key}>Viewer {key.replace('_', ' ')}</label>
              <select id={'viewer-' + key} value={draft.viewer[key]} disabled={readOnly} onChange={e => set(['viewer', key], e.target.value)}>{options.includes(draft.viewer[key]) ? null : <option value={draft.viewer[key]}>{draft.viewer[key]}</option>}{options.map(v => <option key={v} value={v}>{v}</option>)}</select></div>)}
          </div>
        </SettingsSection>

        <SettingsSection title="Advanced" summary="Provider endpoints, OpenClaw isolation and prose diagnostics.">
          <table className="seats settings-table"><thead><tr><th>Provider</th><th>Endpoint</th><th>CLI</th><th>OpenClaw agent</th></tr></thead><tbody>
            {['anthropic', 'openai', 'gemini', 'openclaw'].map(name => { const p = draft.providers[name]; return <tr key={name}>
              <th scope="row">{name}</th>
              <td><input aria-label={name + ' endpoint'} value={p.endpoint} disabled={readOnly} onChange={e => set(['providers', name, 'endpoint'], e.target.value)}/></td>
              <td><input aria-label={name + ' CLI'} value={p.cli} disabled={readOnly || name === 'openclaw'} onChange={e => set(['providers', name, 'cli'], e.target.value)}/></td>
              <td>{name === 'openclaw' ? <><input aria-label="OpenClaw agent id" value={p.agent_id} disabled={readOnly} onChange={e => set(['providers', name, 'agent_id'], e.target.value)}/> <label className="check"><input type="checkbox" checked={p.isolated} disabled={readOnly} onChange={e => set(['providers', name, 'isolated'], e.target.checked)}/>isolated</label></> : <span className="muted">-</span>}</td>
            </tr>; })}
          </tbody></table>
          <label className="check"><input type="checkbox" checked={draft.prose.detection} disabled={readOnly} onChange={e => set(['prose', 'detection'], e.target.checked)}/>Third-party AI detection may run after request-level consent.</label>
        </SettingsSection>
      </>}
    </section>
  </div>;
}

function StateCard({state}) {
  return <div className={'settings-state-card ' + state.kind} role="status">
    <strong>{state.title}</strong>
    <p>{state.text}</p>
  </div>;
}

function SettingsSection({title, summary, open = false, children}) {
  return <details className="settings-section" open={open}>
    <summary><span>{title}</span><small>{summary}</small></summary>
    <div className="settings-section-body">{children}</div>
  </details>;
}

function SeatReadiness({state}) {
  return <div className={'seat-readiness ' + state.tone}>
    <strong>{state.label}</strong>
    <span>{state.detail}</span>
  </div>;
}

function LiveConnections({live, probes, consent, setConsent, busy, probe}) {
  const transports = Object.keys(live.transports || {});
  return <>
    <table className="seats settings-table"><thead><tr><th>Seat</th><th>Provider</th><th>Transport</th><th>Model</th><th>Effort</th></tr></thead><tbody>
      {Object.entries(live.seats || {}).map(([role, seat]) => <tr key={role}><th scope="row">{role}</th><td>{seat.provider}</td><td>{seat.transport === 'cli' ? 'CLI login' : 'API credential'}</td><td>{seat.model}</td><td>{seat.effort || 'default'}</td></tr>)}
    </tbody></table>
    {transports.length === 0 ? <p className="muted">Every seat uses an API credential.</p> : <>
      <table className="seats settings-table" aria-label="CLI logins"><thead><tr><th>CLI</th><th>Version</th><th>Login</th><th>Identity reported</th><th>Last probe</th></tr></thead><tbody>
        {Object.entries(live.transports).map(([provider, t]) => { const last = probes[provider] || t.last_probe; return <tr key={provider}>
          <th scope="row">{t.transport} ({t.executable})</th><td>{t.version}</td>
          <td>{t.logged_in ? 'signed in (' + t.auth_method + ')' : 'not signed in'}</td>
          <td>{t.identity_reported ? 'yes' : 'no: requested-only'}</td>
          <td>{!last ? '-' : (last.results || []).map(r => r.model + (r.effort ? '/' + r.effort : '') + ': ' + (r.ok ? 'reachable, schema-valid' + (r.identity_verified ? ', identity ' + r.observed_model : ', identity unverified') : 'failed - ' + r.error)).join('; ')}</td>
        </tr>; })}
      </tbody></table>
      <div className="actions">
        <label className="check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>I accept that a probe spends tokens on my account, one call per distinct seat</label>
        {transports.map(provider => <Button key={provider} variant="secondary" size="sm" isDisabled={busy || !consent} onPress={() => probe(provider)}>Probe {provider}</Button>)}
      </div>
      <p className="field-note">A login only reports that a session exists. A probe proves reachability and selector handling, and identity only where the CLI reports it.</p>
    </>}
  </>;
}

function ListEditor({rows, readOnly, kind, onChange}) {
  const blank = kind === 'mcp' ? {name: '', transport: 'stdio', command: '', args: [], url: '', consent: false, enabled: true} : {name: '', command: '', args: [], consent: false, enabled: true};
  const update = (index, patch) => onChange(rows.map((row, i) => i === index ? {...row, ...patch} : row));
  return <div className="list-editor">
    {rows.length === 0 && <p className="muted">None.</p>}
    {rows.map((row, i) => <div className="record" key={i}>
      <div className="settings-grid">
        <div><label>Name<input aria-label={kind + ' name ' + (i + 1)} value={row.name} disabled={readOnly} onChange={e => update(i, {name: e.target.value})}/></label></div>
        {kind === 'mcp' && <div><label>Transport<select aria-label={'mcp transport ' + (i + 1)} value={row.transport} disabled={readOnly} onChange={e => update(i, {transport: e.target.value})}><option value="stdio">stdio</option><option value="http">http</option></select></label></div>}
        {(kind === 'acp' || row.transport === 'stdio') && <div><label>Command<input aria-label={kind + ' command ' + (i + 1)} value={row.command} disabled={readOnly} onChange={e => update(i, {command: e.target.value})}/></label></div>}
        {kind === 'mcp' && row.transport === 'http' && <div><label>URL<input aria-label={'mcp url ' + (i + 1)} value={row.url} disabled={readOnly} onChange={e => update(i, {url: e.target.value})}/></label></div>}
        <div><label>Arguments<input aria-label={kind + ' args ' + (i + 1)} value={row.args.join(' ')} disabled={readOnly} onChange={e => update(i, {args: e.target.value.split(/\s+/).filter(Boolean)})}/></label></div>
      </div>
      <div className="actions">
        <label className="check"><input type="checkbox" checked={row.enabled} disabled={readOnly} onChange={e => update(i, {enabled: e.target.checked})}/>enabled</label>
        <label className="check"><input type="checkbox" checked={!!row.consent} disabled={readOnly} onChange={e => update(i, {consent: e.target.checked})}/>missions may send data to it</label>
        <Button variant="ghost" size="sm" isDisabled={readOnly} onPress={() => onChange(rows.filter((_, j) => j !== i))}>Remove</Button>
      </div>
    </div>)}
    <Button variant="secondary" size="sm" isDisabled={readOnly} onPress={() => onChange([...rows, blank])}>Add {kind === 'mcp' ? 'MCP server' : 'ACP agent'}</Button>
  </div>;
}
