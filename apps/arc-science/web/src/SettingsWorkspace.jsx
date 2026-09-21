import React, {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {SESSION_COPY, apiFetch, sessionState} from './http';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';
import './SettingsWorkspace.css';

// Settings are owned by the native supervisor: the service reads a snapshot with a
// revision and forwards the whole edited document back with that revision, so a
// concurrent change is refused instead of overwritten. Nothing here holds a key:
// seats name a credential file or the operator's own CLI login.
const ROLES = [['planner', 'Planner'], ['reviewer', 'Reviewer (QA)'], ['falsifier', 'Falsifier'], ['vision', 'Vision'], ['prose', 'Prose']];
const PROVIDERS = [['', 'None'], ['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['gemini', 'Gemini'], ['openclaw', 'OpenClaw']];
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const AUTH = [['api_key', 'API credential'], ['cli', 'CLI login']];
// The running-seats report (capabilities.live.seats) and the CLI probe cover these
// seats only; vision and prose are saved but never reported or probed.
const REPORTED_ROLES = ['planner', 'reviewer', 'falsifier'];
const NO_PROVIDER_NOTE = 'Select a provider to see which effort levels it accepts.';
// Save-outcome keys from the service, shown by the section they belong to.
const SECTION_NAMES = {seats: 'Research Models', 'seats.effort': 'effort', providers: 'providers', prose: 'prose', mcp_servers: 'MCP servers', acp_agents: 'ACP agents', viewer: 'viewer', blender: 'rendering'};
const authLabel = auth => auth === 'cli' ? 'CLI login' : 'API credential';
const pretty = value => value === 'bfactor' ? 'B-factor' : String(value).charAt(0).toUpperCase() + String(value).slice(1).replace(/_/g, ' ');
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

// One card per failure, rendered beside the action that failed. `kind` picks the
// colour. A missing or rejected token is not an error card: the LockNotice says it.
function describeSettingsError(error, action = 'The request') {
  const message = error?.message || String(error || '');
  const detail = message.replace(/^Request failed \(\d+\):?\s*/, '').replace(/\.$/, '');
  if (message.includes('Request failed (503)') && message.toLowerCase().includes('settings file')) return {
    kind: 'unconfigured',
    title: 'Settings file not configured',
    text: 'No settings file was given to this service. Start Arc Science from the desktop app, or set the service settings path, then reload.'
  };
  if (message.includes('Request failed (409)')) return {
    kind: 'conflict',
    title: 'Settings changed elsewhere',
    text: 'A newer revision was saved since you loaded this one. Your edits are still on screen; copy anything you want to keep, then press Reload.'
  };
  if (message.includes('Request failed (422)')) return {
    kind: 'invalid',
    title: 'Settings were rejected',
    text: 'Not saved. The supervisor (the desktop app that owns the file) rejected the settings: ' + (detail || 'no reason given') + '. Fix that and save again.'
  };
  if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('Load failed')) return {kind: 'offline', ...SESSION_COPY.offline};
  return {
    kind: 'error',
    title: 'Request failed',
    text: action + ' did not complete' + (detail ? ': ' + detail : '') + '. Your draft was kept.'
  };
}

function transportFor(seat) {
  return seat.auth === 'cli' ? 'cli' : 'api';
}

function providerLabel(provider) {
  return PROVIDERS.find(([value]) => value === provider)?.[1] || provider || 'Provider';
}

function effortSupport(seat) {
  if (!seat.provider) return {allowed: EFFORTS, disabled: false, note: NO_PROVIDER_NOTE};
  const transport = transportFor(seat);
  const supported = SUPPORTED_EFFORTS[seat.provider + ':' + transport];
  const where = providerLabel(seat.provider) + ' ' + authLabel(seat.auth);
  if (supported === undefined) return {allowed: EFFORTS, disabled: false, invalid: true, note: providerLabel(seat.provider) + ' has no ' + authLabel(seat.auth) + '. Choose ' + authLabel(transport === 'cli' ? 'api_key' : 'cli') + '.'};
  if (supported.length === 0) return {
    allowed: [DEFAULT_EFFORT],
    disabled: true,
    invalid: seat.effort !== DEFAULT_EFFORT,
    note: where + ' has no effort setting; the provider default is used (stored as medium).'
  };
  const invalid = !supported.includes(seat.effort);
  return {
    allowed: supported,
    disabled: false,
    invalid,
    note: (invalid ? 'effort ' + seat.effort + ' is not accepted for ' + where + '. ' : '') + 'Accepted: ' + supported.join(', ') + (seat.provider === 'openai' ? '. OpenAI may still refuse a level for a specific model.' : '.')
  };
}

function seatIssue(role, seat) {
  const label = ROLES.find(([key]) => key === role)?.[1] || role;
  if (seat.provider && !seat.model) return {role, message: label + ': model id is required when a provider is selected.'};
  if (seat.provider && seat.auth === 'api_key' && !seat.credential) return {role, message: label + ': credential file name is required with API credential.'};
  const support = effortSupport(seat);
  if (support.invalid) return {role, message: label + ': ' + support.note};
  return null;
}

// `saved` is the seat as loaded; a draft that differs from it is unsaved, and only then
// is "Save to apply" the advice. A saved seat the running route does not report says why.
function readiness(role, seat, saved, providers, live, probes) {
  if (!seat.provider) return {tone: 'neutral', label: 'inactive', detail: 'No provider selected.'};
  if (!seat.model) return {tone: 'warn', label: 'incomplete', detail: 'Model id is required before this seat can run.'};
  if (seat.auth === 'api_key' && !seat.credential) return {tone: 'warn', label: 'incomplete', detail: 'Credential file name is required.'};
  if (seat.auth === 'cli' && !providers?.[seat.provider]?.cli) return {tone: 'warn', label: 'incomplete', detail: seat.provider === 'openclaw' ? 'OpenClaw has no CLI login. Choose API credential.' : 'No CLI command is set for this provider (Advanced > CLI command).'};
  const unsaved = JSON.stringify(seat) !== JSON.stringify(saved);
  const notSignedIn = {tone: 'warn', label: 'not signed in', detail: 'The CLI is present but not signed in to this provider.'};
  if (unsaved) return {tone: 'warn', label: 'not applied', detail: 'These values are not the running ones. Save to apply.'};
  if (!REPORTED_ROLES.includes(role)) {
    if (seat.auth === 'cli' && live?.transports?.[seat.provider]?.logged_in === false) return notSignedIn;
    return {tone: 'neutral', label: 'configured', detail: 'Saved; not part of the running-seats report; no call was made.'};
  }
  const liveSeat = live?.seats?.[role];
  const matchesLive = liveSeat && liveSeat.provider === seat.provider && liveSeat.model === seat.model && liveSeat.transport === transportFor(seat);
  // live.configured is false when a seat in the route lacks what it runs on; for an API
  // seat that is a credential file, this seat's or another API seat's.
  const notRunning = {tone: 'warn', label: 'not applied', detail: seat.auth === 'api_key' && live?.configured === false
    ? 'Saved. Not in the running route: the credential file is not stored (for this seat or another API seat).'
    : 'Saved. Not in the running route yet; the live seats did not report it.'};
  if (seat.auth === 'cli') {
    const transport = live?.transports?.[seat.provider];
    const probe = probes[seat.provider] || transport?.last_probe;
    if (!transport) return matchesLive ? {tone: 'neutral', label: 'configured', detail: 'CLI login state was not reported.'} : notRunning;
    if (!transport.logged_in) return notSignedIn;
    if (!probe) return {tone: 'neutral', label: 'not probed', detail: 'Signed in. Probe from Connections (needs your consent; spends tokens).'};
    const failed = (probe.results || []).some(result => !result.ok);
    return {tone: failed ? 'warn' : 'ok', label: failed ? 'probe failed' : 'probe ok', detail: failed ? 'Last probe failed for at least one model/effort pair.' : 'Last probe reached the configured model at the configured effort.'};
  }
  return matchesLive ? {tone: 'neutral', label: 'configured', detail: 'Credential file is named; not checked, and no call was made.'} : notRunning;
}

export default function SettingsWorkspace({token, setToken}) {
  const [snapshot, setSnapshot] = useState(null), [draft, setDraft] = useState(null);
  const [error, setError] = useState(null), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null), [probes, setProbes] = useState({}), [consent, setConsent] = useState(false);
  const [checks, setChecks] = useState({}), [authExpired, setAuthExpired] = useState(false);
  const credential = useRef(null);
  useLayoutEffect(() => {
    const controller = new AbortController(); credential.current = controller;
    setSnapshot(null); setDraft(null); setError(null); setNotice(''); setBusy(false); setLive(null); setProbes({}); setConsent(false); setChecks({}); setAuthExpired(false);
    return () => controller.abort();
  }, [token]);
  const read = useCallback(async (path, signal, method = 'GET', body) => {
    signal.throwIfAborted();
    const response = await apiFetch('/api' + path, {token, method, signal, headers: {'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
    const data = await response.json();
    signal.throwIfAborted();
    return data;
  }, [token]);
  // `label` names the action in the error card; `where` says which button the card sits under.
  async function task(action, label = 'The request', where = 'sidebar') {
    const signal = credential.current.signal;
    setBusy(true); setError(null); setNotice('');
    try { await action(signal); }
    catch (e) {
      if (signal.aborted) return;
      // A rejected token is the one LockNotice in the error tone, not a card plus an alert.
      if (/Request failed \((401|403)\)/.test(e.message)) { setAuthExpired(true); return; }
      setError({...describeSettingsError(e, label), where});
    }
    finally { if (!signal.aborted) setBusy(false); }
  }
  const errorAt = where => error?.where === where ? <StateCard state={error}/> : null;
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
    // Explicit consent per click: a probe makes one real model call per distinct model and
    // effort pair among the planner, reviewer and falsifier seats (cli_seats() in the service).
    const result = await read('/providers/' + provider + '/probe', signal, 'POST', {spend_tokens: true});
    setProbes(current => ({...current, [provider]: result}));
  }
  async function save(signal) {
    const snap = await read('/settings', signal, 'PUT', {settings: draft, if_revision: snapshot.revision});
    setSnapshot(snap); setDraft(structuredClone(snap.settings));
    await connections(signal);
    const part = (label, items) => Array.isArray(items) && items.length ? ' ' + label + ': ' + items.map(item => SECTION_NAMES[item] || String(item).replace(/_/g, ' ')).join(', ') + '.' : '';
    setNotice('Saved.' + part('Applied now', snap.applied_live) + part('Takes effect on restart', snap.restart_required) + part('Stored, not yet used', snap.stored_pending));
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
  const loadedSummary = snapshot ? 'Revision ' + snapshot.revision.slice(0, 12) + (readOnly ? ' · read only' : dirty ? ' · unsaved edits' : ' · saved') : 'Not loaded';
  const saveBlocker = !snapshot ? 'Load settings first.' : readOnly ? 'Read only: the supervisor cannot write this file.' : seatIssues.length > 0 ? 'Save is off until the seat issues under Research Models are fixed.' : !dirty ? 'No unsaved edits.' : '';
  return <div className="research-workspace settings-workspace">
    <aside className="research-form settings-sidebar">
      <div className="settings-heading"><p className="eyebrow">SETTINGS</p><h1>Configure Arc Science.</h1>
      <p className="muted">Saving goes through the Arc Science desktop app (the supervisor) and is refused if the file changed since you loaded it, so nothing is overwritten.</p></div>
      <div className={'settings-status' + (snapshot ? '' : ' unloaded')} aria-live="polite">
        {snapshot ? <strong>{loadedSummary}</strong> : <span className="muted">{loadedSummary}</span>}
        {snapshot && <span><code>{snapshot.path.replace(/^\\\\\?\\/, '')}</code>{readOnly ? ' · read only: the supervisor cannot write this file' : ''}</span>}
      </div>
      <div className="actions">
        <Button variant="secondary" isDisabled={busy || !token} onPress={() => task(load, 'Load settings')}>{snapshot ? (dirty ? 'Reload (discards unsaved edits)' : 'Reload') : 'Load settings'}</Button>
        <Button isDisabled={busy || !dirty || readOnly || seatIssues.length > 0} onPress={() => task(save, 'Save')}>Save</Button>
      </div>
      {saveBlocker && token && <p className="field-note">{saveBlocker}</p>}
      <LockNotice card={sessionState(token, authExpired)} tone={authExpired ? 'error' : 'info'} onUnlock={() => focusTokenField(token, setToken)} unlockLabel={unlockLabel(token)}/>
      {busy && <p role="status">Request in progress…</p>}
      {errorAt('sidebar')}
      {notice && <p role="status">{notice}</p>}
    </aside>
    <section className="research-results settings" aria-label="Settings">
      {!draft ? <div className="empty-state"><h2>Load settings to edit seats (one model assigned to one role) and connections.</h2></div> : <>
        <SettingsSection title="Research Models" summary="A seat is one model assigned to one role. Select the provider, model, sign-in method and reasoning effort for each seat." open>
          {seatIssues.length > 0 && <div className="settings-validation" role="alert">
            <strong>Resolve these before saving.</strong>
            <ul>{seatIssues.map(issue => <li key={issue.role}>{issue.message}</li>)}</ul>
          </div>}
          <p className="field-note">Roles: Planner proposes, Reviewer (QA) assesses, Falsifier assesses with the brief to refute, Vision reads images, Prose edits text.</p>
          <div className="settings-table-wrap"><table className="seats settings-table" aria-label="Seats"><thead><tr><th>Seat</th><th>Provider</th><th>Model</th><th>Effort</th><th>Sign-in</th><th>Credential file</th><th>Readiness</th></tr></thead><tbody>
            {ROLES.map(([role, label]) => { const seat = draft.seats[role]; const id = 'seat-' + role; const support = effortSupport(seat); const state = readiness(role, seat, snapshot.settings.seats[role], draft.providers, live, probes); return <tr key={role} className={support.invalid ? 'seat-invalid' : undefined}>
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
              </select>{seat.provider && (support.disabled || support.invalid) && <p className="seat-guidance">{support.note}</p>}</td>
              <td><select aria-label={label + ' sign-in'} value={seat.auth} disabled={readOnly} onChange={e => {
                const next = {...seat, auth: e.target.value};
                const nextSupport = effortSupport(next);
                setDraft(current => {
                  const copy = structuredClone(current);
                  copy.seats[role].auth = e.target.value;
                  if (!nextSupport.allowed.includes(copy.seats[role].effort)) copy.seats[role].effort = nextSupport.allowed[0] || DEFAULT_EFFORT;
                  return copy;
                });
              }}>{AUTH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
              <td><input aria-label={label + ' credential'} value={seat.credential} disabled={readOnly || seat.auth !== 'api_key'} onChange={e => set(['seats', role, 'credential'], e.target.value)} placeholder={seat.auth === 'api_key' ? 'file name' : 'not used with CLI login'}/></td>
              <td><SeatReadiness state={state}/></td>
            </tr>; })}
          </tbody></table></div>
          {ROLES.some(([role]) => !draft.seats[role].provider) && <p className="field-note">{NO_PROVIDER_NOTE}</p>}
          <p className="field-note">API credential: the name of a file created with <code>arc-science credential --name NAME</code>; no key is stored here. CLI login: the account already signed in to that tool (Claude Code, Codex, Gemini CLI). Provider OAuth sign-in inside Arc is not available in this build. An effort level the sign-in method cannot express is refused on save, not rounded.</p>
        </SettingsSection>

        <SettingsSection title="Connections" summary="See which seats are running, probe signed-in CLIs, and manage the MCP servers and ACP agents missions may use.">
          {!live ? <p className="muted">Connection state did not load. Press Reload to retry.</p> : !live.configured ? <p className="muted">No seats are running, so there is nothing to check.</p> : <LiveConnections live={live} probes={probes} consent={consent} setConsent={setConsent} busy={busy} probe={(provider) => task(signal => probe(provider, signal), 'Probe ' + providerLabel(provider), 'probe')} error={errorAt('probe')}/>}
          <h3>MCP servers (Model Context Protocol)</h3>
          <ListEditor rows={draft.mcp_servers} readOnly={readOnly} kind="mcp" onChange={rows => set(['mcp_servers'], rows)}/>
          <div className="actions"><Button variant="secondary" size="sm" isDisabled={busy || !snapshot} onPress={() => task(signal => check('mcp', signal), 'Check MCP servers', 'mcp')}>Check MCP servers</Button></div>
          <p className="field-note">Starts each enabled server, asks it to list its tools, and sends no mission data.</p>
          {errorAt('mcp')}
          {checks.mcp && <div className="check-report" aria-label="MCP servers checked">
            <p className="field-note">MCP SDK {checks.mcp.sdk || 'not installed'} · consented (servers you approved): {formatList(checks.mcp.consented)}</p>
            {(checks.mcp.servers || []).map(srv => <p key={srv.server}><strong>{srv.server}</strong>: {srv.ok ? (srv.tools || []).map(t => t.name + (t.offered ? '' : ' (not offered: ' + t.reason + ')')).join(', ') || 'no tools' : 'failed: ' + srv.error}</p>)}
          </div>}
          <p className="field-note">Missions see only the servers you have consented to. Every call is covered by the mission's own sending consent, given when the mission is created; there is no separate prompt per call. Results are untrusted content.</p>
          <h3>ACP agents (Agent Client Protocol)</h3>
          <ListEditor rows={draft.acp_agents} readOnly={readOnly} kind="acp" onChange={rows => set(['acp_agents'], rows)}/>
          <div className="actions"><Button variant="secondary" size="sm" isDisabled={busy || !snapshot} onPress={() => task(signal => check('acp', signal), 'Check ACP agents', 'acp')}>Check ACP agents</Button></div>
          <p className="field-note">Starts each enabled agent, asks it to initialise, and sends no mission data.</p>
          {errorAt('acp')}
          {checks.acp && <div className="check-report" aria-label="ACP agents checked">
            <p className="field-note">ACP protocol {checks.acp.protocol_version} · consented (agents you approved): {formatList(checks.acp.consented)}</p>
            {(checks.acp.agents || []).map(a => <p key={a.agent}><strong>{a.agent}</strong>: {a.ok ? (a.agent_info?.name || 'agent') + ' ' + (a.agent_info?.version || '') + (a.auth_methods?.length ? ' · auth: ' + a.auth_methods.join(', ') : '') : 'failed: ' + a.error}</p>)}
          </div>}
          <p className="field-note">A consented ACP agent is one consultation tool for missions. Arc gives it no file or terminal access. Its replies are untrusted text, never evidence.</p>
        </SettingsSection>

        <SettingsSection title="Rendering" summary="Choose the Blender render preset used by molecular output.">
          <div className="settings-grid">
            <div><label htmlFor="blender-preset">Blender preset</label><input id="blender-preset" value={draft.blender.default_preset} disabled={readOnly} onChange={e => set(['blender', 'default_preset'], e.target.value)} placeholder="preset name"/></div>
          </div>
        </SettingsSection>

        <SettingsSection title="Viewer" summary="Set the default molecular viewer representation and scene appearance.">
          <div className="settings-grid">
            {Object.entries(VIEWER).map(([key, options]) => <div key={key}><label htmlFor={'viewer-' + key}>Viewer {key.replace('_', ' ')}</label>
              <select id={'viewer-' + key} value={draft.viewer[key]} disabled={readOnly} onChange={e => set(['viewer', key], e.target.value)}>{options.includes(draft.viewer[key]) ? null : <option value={draft.viewer[key]}>{pretty(draft.viewer[key])}</option>}{options.map(v => <option key={v} value={v}>{pretty(v)}</option>)}</select></div>)}
          </div>
        </SettingsSection>

        <SettingsSection title="Advanced" summary="Provider endpoints, OpenClaw options and AI-text detection.">
          <div className="settings-table-wrap"><table className="seats settings-table"><thead><tr><th>Provider</th><th>Endpoint</th><th>CLI command</th><th>OpenClaw agent</th></tr></thead><tbody>
            {['anthropic', 'openai', 'gemini', 'openclaw'].map(name => { const p = draft.providers[name]; return <tr key={name}>
              <th scope="row">{providerLabel(name)}</th>
              <td><input aria-label={providerLabel(name) + ' endpoint'} value={p.endpoint} disabled={readOnly} onChange={e => set(['providers', name, 'endpoint'], e.target.value)}/></td>
              <td>{name === 'openclaw' ? <span className="muted">not applicable</span> : <input aria-label={providerLabel(name) + ' CLI command'} value={p.cli} disabled={readOnly} onChange={e => set(['providers', name, 'cli'], e.target.value)}/>}</td>
              <td>{name === 'openclaw' ? <><input aria-label="OpenClaw agent id" value={p.agent_id} disabled={readOnly} onChange={e => set(['providers', name, 'agent_id'], e.target.value)}/> <label className="check"><input type="checkbox" checked={p.isolated} disabled={readOnly} onChange={e => set(['providers', name, 'isolated'], e.target.checked)}/>Isolated agent (tools disabled; OpenClaw needs this)</label></> : <span className="muted">not applicable</span>}</td>
            </tr>; })}
          </tbody></table></div>
          <label className="check"><input type="checkbox" checked={draft.prose.detection} disabled={readOnly} onChange={e => set(['prose', 'detection'], e.target.checked)}/>Allow third-party AI-text detection. Arc asks again before each request, and the text leaves this machine only when you agree.</label>
        </SettingsSection>
      </>}
    </section>
  </div>;
}

function StateCard({state}) {
  return <div className={'settings-state-card ' + state.kind} role="alert">
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

function LiveConnections({live, probes, consent, setConsent, busy, probe, error}) {
  const transports = Object.keys(live.transports || {});
  const roleLabel = role => ROLES.find(([key]) => key === role)?.[1] || role;
  return <>
    <div className="settings-table-wrap"><table className="seats settings-table" aria-label="Running seats"><thead><tr><th>Seat</th><th>Provider</th><th>Sign-in</th><th>Model</th><th>Effort</th></tr></thead><tbody>
      {Object.entries(live.seats || {}).map(([role, seat]) => <tr key={role}><th scope="row">{roleLabel(role)}</th><td>{providerLabel(seat.provider)}</td><td>{authLabel(seat.transport)}</td><td>{seat.model}</td><td>{seat.effort || 'default'}</td></tr>)}
    </tbody></table></div>
    {transports.length === 0 ? <p className="muted">The planner, reviewer and falsifier seats use API credentials; no CLI login to check.</p> : <>
      <div className="settings-table-wrap"><table className="seats settings-table" aria-label="CLI logins"><thead><tr><th>CLI</th><th>Version</th><th>Login</th><th>Reports answering model</th><th>Last probe</th></tr></thead><tbody>
        {Object.entries(live.transports).map(([provider, t]) => { const last = probes[provider] || t.last_probe; return <tr key={provider}>
          <th scope="row">{t.transport} ({t.executable})</th><td>{t.version}</td>
          <td>{t.logged_in ? 'signed in (' + t.auth_method + ')' : 'not signed in'}</td>
          <td>{t.identity_reported ? 'yes' : 'no (only the requested model is known)'}</td>
          <td>{!last ? 'not run' : (last.results || []).map((r, i) => <div key={i}>{r.model + (r.effort ? '/' + r.effort : '') + ': ' + (r.ok ? 'ok, answering model ' + (r.identity_verified ? r.observed_model : 'not reported') : 'failed: ' + r.error)}</div>)}</td>
        </tr>; })}
      </tbody></table></div>
      <div className="actions">
        <label className="check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>I accept that a probe spends tokens on my account: one real model call per distinct model and effort pair among the planner, reviewer and falsifier seats</label>
        {transports.map(provider => <Button key={provider} variant="secondary" size="sm" isDisabled={busy || !consent} onPress={() => probe(provider)}>Probe {providerLabel(provider)}</Button>)}
      </div>
      {!consent && <p className="field-note">Probe buttons unlock when you tick the consent box.</p>}
      {error}
      <p className="field-note">Signed in only means a session exists. A probe makes one real model call per distinct model and effort pair among the planner, reviewer and falsifier seats to show that they are accepted; the answering model is confirmed only when the CLI reports it.</p>
    </>}
  </>;
}

function ListEditor({rows, readOnly, kind, onChange}) {
  const blank = kind === 'mcp' ? {name: '', transport: 'stdio', command: '', args: [], url: '', consent: false, enabled: true} : {name: '', command: '', args: [], consent: false, enabled: true};
  const update = (index, patch) => onChange(rows.map((row, i) => i === index ? {...row, ...patch} : row));
  const entry = kind === 'mcp' ? 'MCP server' : 'ACP agent';
  return <div className="list-editor">
    {rows.length === 0 && <p className="muted">None.</p>}
    {rows.map((row, i) => { const id = entry + ' ' + (i + 1); return <div className="record" key={i}>
      <div className="settings-grid">
        <div><label>Name<input aria-label={id + ' name'} value={row.name} disabled={readOnly} onChange={e => update(i, {name: e.target.value})}/></label></div>
        {kind === 'mcp' && <div><label>Transport<select aria-label={id + ' transport'} value={row.transport} disabled={readOnly} onChange={e => update(i, {transport: e.target.value})}><option value="stdio">stdio</option><option value="http">http</option></select></label></div>}
        {(kind === 'acp' || row.transport === 'stdio') && <div><label>Command<input aria-label={id + ' command'} value={row.command} disabled={readOnly} onChange={e => update(i, {command: e.target.value})}/></label></div>}
        {kind === 'mcp' && row.transport === 'http' && <div><label>URL<input aria-label={id + ' URL'} value={row.url} disabled={readOnly} onChange={e => update(i, {url: e.target.value})}/></label></div>}
        <div><label>Arguments<input aria-label={id + ' arguments'} value={row.args.join(' ')} disabled={readOnly} onChange={e => update(i, {args: e.target.value.split(/\s+/).filter(Boolean)})} placeholder="space-separated"/></label></div>
      </div>
      <div className="actions">
        <label className="check"><input type="checkbox" checked={row.enabled} disabled={readOnly} onChange={e => update(i, {enabled: e.target.checked})}/>Enabled</label>
        <label className="check"><input type="checkbox" checked={!!row.consent} disabled={readOnly} onChange={e => update(i, {consent: e.target.checked})}/>Consent: missions may send data to this {kind === 'mcp' ? 'server' : 'agent'}</label>
        <Button variant="ghost" size="sm" isDisabled={readOnly} onPress={() => onChange(rows.filter((_, j) => j !== i))}>Remove</Button>
      </div>
    </div>; })}
    <Button variant="secondary" size="sm" isDisabled={readOnly} onPress={() => onChange([...rows, blank])}>Add {entry}</Button>
  </div>;
}
