import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {NATIVE_SESSION, SESSION_COPY, apiFetch, sessionState} from './http';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';
import {STATE_LABEL, sentence, stateOf} from './readiness';
import './SettingsWorkspace.css';

// Settings are owned by the native supervisor: the service reads a snapshot with a
// revision and forwards the whole edited document back with that revision, so a
// concurrent change is refused instead of overwritten. Nothing here holds a key:
// seats name a credential file or the operator's own CLI login.
// Readiness (which seat can run) and the catalog (which providers, models, efforts and
// sign-in methods exist) arrive through props from GET /api/readiness; nothing here
// recomputes them. The fallback below only names the providers while that is unloaded.
const ROLES = [['planner', 'Planner'], ['reviewer', 'Reviewer (QA)'], ['falsifier', 'Falsifier'], ['vision', 'Vision'], ['prose', 'Prose']];
const PROVIDER_NAMES = ['anthropic', 'openai', 'gemini', 'openclaw'];
const FALLBACK_CATALOG = {catalog_version: null, efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], efforts_by_transport: null,
  providers: {anthropic: {label: 'Anthropic', models: []}, openai: {label: 'OpenAI', models: []}, gemini: {label: 'Gemini', models: []}, openclaw: {label: 'OpenClaw', models: []}}, auth_modes: {}};
const FALLBACK_AUTH = [['api_key', 'API credential'], ['cli', 'CLI login']];
const DEFAULT_EFFORT = 'medium';
const CUSTOM = '__custom__';
const NO_EFFORT_NOTE = 'No effort control on this model/sign-in; the provider default applies';
const CATALOG_NOT_LOADED = 'catalog not loaded';
// Save-effect sections from the service, shown by the section they belong to.
const SECTION_LABEL = {mcp_servers: 'MCP servers', acp_agents: 'ACP agents', prose: 'Prose', blender: 'Rendering', viewer: 'Viewer'};
const VIEWER = {representation: ['cartoon', 'surface', 'ball_and_stick', 'sticks', 'spacefill', 'backbone'],
  colouring: ['chain', 'element', 'residue', 'secondary_structure', 'bfactor', 'uniform'],
  assembly: ['asymmetric_unit', 'assembly_1', 'assembly_2'], background: ['white', 'black', 'transparent']};
const pretty = value => value === 'bfactor' ? 'B-factor' : String(value).charAt(0).toUpperCase() + String(value).slice(1).replace(/_/g, ' ');
const roleLabel = role => ROLES.find(([key]) => key === role)?.[1] || role;
const transportFor = seat => seat.auth === 'cli' ? 'cli' : 'api';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const providerLabel = (catalog, provider) => catalog.providers?.[provider]?.label || provider || 'Provider';
const authLabel = (catalog, provider, auth) => catalog.auth_modes?.[provider]?.find(mode => mode.mode === auth)?.label || FALLBACK_AUTH.find(([value]) => value === auth)?.[1] || auth;
const modelEntry = (catalog, seat) => (catalog.providers?.[seat.provider]?.models || []).find(model => model.id === seat.model) || null;
// Sign-in options are the catalog's supported modes; a stored mode outside them stays
// selectable (marked) so the value on screen is the stored one until the operator changes it.
const signInModes = (catalog, provider) => catalog.auth_modes?.[provider]?.filter(mode => mode.support === 'supported').map(mode => [mode.mode, mode.label]) || FALLBACK_AUTH;

function formatList(items, fallback = 'none') {
  return Array.isArray(items) && items.length ? items.join(', ') : fallback;
}

// Leaf paths whose value differs between `base` and `next`. Arrays are leaves (a list is
// replaced whole), so an edited connector list re-applies as that list.
function changedPaths(base, next, path = []) {
  if (isObject(base) && isObject(next)) return Object.keys(next).flatMap(key => changedPaths(base[key], next[key], [...path, key]));
  return JSON.stringify(base) === JSON.stringify(next) ? [] : [[path, next]];
}

function setPath(target, path, value) {
  let cursor = target;
  for (const key of path.slice(0, -1)) cursor = cursor[key] = isObject(cursor[key]) ? cursor[key] : {};
  cursor[path[path.length - 1]] = value;
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
    text: 'A newer revision was saved since you loaded this one. Your edits are still on screen: Reload and keep my edits puts them onto the newer revision for review; Reload discards them.'
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

// The efforts a seat may store: the transport's list intersected with the model's when
// the model is in the catalog. `transport` marks a sign-in the provider has no transport
// for (the sign-in, not the effort, is what to change). Nothing is coerced: an effort
// outside `allowed` stays on screen, marked, until the operator picks one.
function effortSupport(catalog, seat) {
  const all = catalog.efforts || FALLBACK_CATALOG.efforts;
  if (!seat.provider) return {allowed: all, disabled: false, invalid: false, note: ''};
  if (!catalog.efforts_by_transport) return {allowed: all, disabled: false, invalid: false, note: 'Accepted efforts are not checked here: ' + CATALOG_NOT_LOADED + '.'};
  const table = catalog.efforts_by_transport[seat.provider + ':' + transportFor(seat)];
  if (table === undefined) return {allowed: all, disabled: false, invalid: true, transport: true,
    note: providerLabel(catalog, seat.provider) + ' has no ' + authLabel(catalog, seat.provider, seat.auth) + '. Choose ' + (signInModes(catalog, seat.provider).map(([, label]) => label).join(' or ') || 'another sign-in') + '.'};
  const entry = modelEntry(catalog, seat);
  const allowed = entry && Array.isArray(entry.efforts) ? table.filter(effort => entry.efforts.includes(effort)) : table;
  if (allowed.length === 0) return {allowed: [DEFAULT_EFFORT], disabled: seat.effort === DEFAULT_EFFORT, invalid: seat.effort !== DEFAULT_EFFORT,
    note: NO_EFFORT_NOTE + (seat.effort === DEFAULT_EFFORT ? '.' : '; effort ' + seat.effort + ' is not accepted, so choose ' + DEFAULT_EFFORT + '.')};
  const invalid = !allowed.includes(seat.effort);
  return {allowed, disabled: false, invalid, note: invalid ? 'Effort ' + seat.effort + ' is not accepted for this provider, sign-in and model; choose one of ' + allowed.join(', ') + '.' : 'Accepted: ' + allowed.join(', ') + '.'};
}

function seatIssue(catalog, role, seat) {
  const label = roleLabel(role);
  if (!seat.provider) return null;
  if (!seat.model) return {role, message: label + ': a model id is required when a provider is selected.'};
  if (seat.auth === 'api_key' && !seat.credential) return {role, message: label + ': a credential file name is required with an API credential.'};
  const support = effortSupport(catalog, seat);
  if (support.invalid) return {role, message: label + ': ' + support.note};
  return null;
}

function sectionLabel(catalog, section) {
  const [group, name] = String(section).split('.');
  if (group === 'seats' && name) return roleLabel(name) + ' seat';
  if (group === 'providers' && name) return providerLabel(catalog, name) + ' provider';
  return SECTION_LABEL[section] || String(section).replace(/_/g, ' ');
}

export default function SettingsWorkspace({token, setToken, active = false, readiness = null, readinessError = null, refreshReadiness, onNavigate}) {
  const [snapshot, setSnapshot] = useState(null), [draft, setDraft] = useState(null);
  const [error, setError] = useState(null), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null), [probes, setProbes] = useState({}), [consent, setConsent] = useState(false);
  const [checks, setChecks] = useState({}), [authExpired, setAuthExpired] = useState(false);
  // Roles whose model picker is on "Custom id…" although the typed id may be in the catalog.
  const [customRoles, setCustomRoles] = useState({});
  const credential = useRef(null), autoloaded = useRef(false), running = useRef(false);
  const catalog = readiness?.catalog || FALLBACK_CATALOG, catalogLoaded = Boolean(readiness?.catalog);
  useLayoutEffect(() => {
    const controller = new AbortController(); credential.current = controller;
    setSnapshot(null); setDraft(null); setError(null); setNotice(''); setBusy(false); setLive(null); setProbes({}); setConsent(false); setChecks({}); setAuthExpired(false); setCustomRoles({});
    autoloaded.current = false; running.current = false;
    return () => controller.abort();
  }, [token]);
  const read = useCallback(async (path, signal, method = 'GET', body) => {
    signal.throwIfAborted();
    const response = await apiFetch('/api' + path, {token, method, signal, headers: {'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
    const data = await response.json();
    signal.throwIfAborted();
    return data;
  }, [token]);
  // `label` names the action in the error card; `where` says which button the card sits
  // under; `recover` turns the failure into the card's one button, when there is one.
  async function task(action, label = 'The request', where = 'sidebar', recover) {
    // One request at a time. Buttons are disabled while busy; the ref also covers the
    // same tick, when the token field's focusout autoload precedes a click on Load settings.
    if (running.current) return;
    const signal = credential.current.signal;
    running.current = true; setBusy(true); setError(null); setNotice('');
    try { await action(signal); }
    catch (e) {
      if (signal.aborted) return;
      // A rejected token is the one LockNotice in the error tone, not a card plus an alert.
      if (/Request failed \((401|403)\)/.test(e.message)) { setAuthExpired(true); return; }
      setError({...describeSettingsError(e, label), where, action: recover?.(e) || null});
    }
    finally { if (!signal.aborted) { running.current = false; setBusy(false); } }
  }
  const errorAt = where => error?.where === where ? <StateCard state={error}/> : null;
  async function connections(signal) {
    // Cost-free: the CLI's own login state per provider, never an inference.
    const caps = await read('/capabilities', signal);
    setLive(caps.live || {configured: false});
  }
  async function load(signal) {
    const snap = await read('/settings', signal);
    setSnapshot(snap); setDraft(structuredClone(snap.settings)); setCustomRoles({});
    await connections(signal);
  }
  // main.jsx owns the readiness request and its error; this only asks (cached, idempotent).
  const askReadiness = () => Promise.resolve(refreshReadiness?.()).catch(() => {});
  const loadTask = () => { askReadiness(); return task(load, 'Load settings', 'sidebar', () => ({label: 'Retry', run: loadTask})); };
  // The snapshot loads by itself on discrete events only: the workspace shown with a
  // session, the shell's desktop session arriving, and the header token field settling
  // (Tab, Enter or a click elsewhere) while Settings is shown. Never on a keystroke: a
  // half-typed token sends nothing and draws no rejection. Later visits keep whatever is
  // on screen (unsaved edits included); a new token resets and waits to settle again.
  const native = token === NATIVE_SESSION;
  const autoload = () => {
    if (!active || !token || snapshot || busy || autoloaded.current) return;
    autoloaded.current = true;
    loadTask();
  };
  useEffect(() => { autoload(); }, [active, native]);
  useEffect(() => {
    // Re-subscribed each render so the handler loads with the token on screen at that moment.
    if (!active) return undefined;
    const settled = event => { if (event.target?.id === 'operator-token' && (event.type === 'focusout' || event.key === 'Enter')) autoload(); };
    document.addEventListener('focusout', settled); document.addEventListener('keydown', settled);
    return () => { document.removeEventListener('focusout', settled); document.removeEventListener('keydown', settled); };
  });
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
    askReadiness();
  }
  async function save(signal) {
    const snap = await read('/settings', signal, 'PUT', {settings: draft, if_revision: snapshot.revision});
    setSnapshot(snap); setDraft(structuredClone(snap.settings));
    await connections(signal);
    askReadiness();
    const effects = Array.isArray(snap.effects) ? snap.effects : [];
    const bound = Number(snap.bound_missions) || 0;
    setNotice(['Saved (revision ' + snap.revision.slice(0, 12) + ').',
      ...effects.map(effect => sectionLabel(catalog, effect.section) + ': applies at ' + effect.applies + '.'),
      ...new Set(effects.map(effect => effect.note).filter(Boolean)),
      snap.restart_note,
      bound > 0 ? (bound === 1 ? '1 mission keeps the route it was bound to.' : bound + ' missions keep the route they were bound to.') : ''
    ].filter(Boolean).join(' '));
  }
  // After a 409: the newer snapshot is loaded and only the paths this draft changed
  // (against the snapshot it was loaded from) are put back onto it, for review.
  async function rebase(signal) {
    const changes = changedPaths(snapshot.settings, draft);
    const snap = await read('/settings', signal);
    const next = structuredClone(snap.settings);
    for (const [path, value] of changes) setPath(next, path, value);
    setSnapshot(snap); setDraft(next);
    await connections(signal);
    setNotice('Edits re-applied onto revision ' + snap.revision.slice(0, 12) + '; review and save');
  }
  const saveTask = () => task(save, 'Save', 'sidebar', e => /Request failed \(409\)/.test(e.message) ? {label: 'Reload and keep my edits', run: () => task(rebase, 'Reload and keep my edits')} : null);
  const dirty = snapshot && draft && JSON.stringify(draft) !== JSON.stringify(snapshot.settings);
  const set = (path, value) => setDraft(current => {
    const next = structuredClone(current);
    setPath(next, path, value);
    return next;
  });
  const readOnly = snapshot?.read_only === true;
  const seatIssues = draft ? ROLES.map(([role]) => seatIssue(catalog, role, draft.seats[role])).filter(Boolean) : [];
  const loadedSummary = snapshot ? 'Revision ' + snapshot.revision.slice(0, 12) + (readOnly ? ' · read only' : dirty ? ' · unsaved edits' : ' · saved') : 'Not loaded';
  const saveBlocker = !snapshot ? 'Settings are not loaded.' : readOnly ? 'Read only: the supervisor cannot write this file.' : seatIssues.length > 0 ? 'Save is off until the seat issues under Research Models are fixed.' : !dirty ? 'No unsaved edits.' : '';
  const liveMission = readiness?.live_mission || null;
  const liveState = stateOf(liveMission);
  return <div className="research-workspace settings-workspace">
    <aside className="research-form settings-sidebar">
      <div className="settings-heading"><p className="eyebrow">SETTINGS</p><h1>Configure Arc Science.</h1>
      <p className="muted">Saving goes through the Arc Science desktop app (the supervisor) and is refused if the file changed since you loaded it, so nothing is overwritten.</p></div>
      <div className={'settings-status' + (snapshot ? '' : ' unloaded')} aria-live="polite">
        {snapshot ? <strong>{loadedSummary}</strong> : <span className="muted">{loadedSummary}</span>}
        {snapshot && <span><code>{snapshot.path.replace(/^\\\\\?\\/, '')}</code>{readOnly ? ' · read only: the supervisor cannot write this file' : ''}</span>}
      </div>
      <div className="actions">
        <Button variant="secondary" isDisabled={busy || !token} onPress={loadTask}>{snapshot ? (dirty ? 'Reload (discards unsaved edits)' : 'Reload') : 'Load settings'}</Button>
        <Button isDisabled={busy || !dirty || readOnly || seatIssues.length > 0} onPress={saveTask}>Save</Button>
      </div>
      {saveBlocker && token && !busy && <p className="field-note">{saveBlocker}</p>}
      <LockNotice card={sessionState(token, authExpired)} tone={authExpired ? 'error' : 'info'} onUnlock={() => focusTokenField(token, setToken)} unlockLabel={unlockLabel(token)}/>
      {busy && <p role="status">Request in progress…</p>}
      {errorAt('sidebar')}
      {notice && <p role="status">{notice}</p>}
    </aside>
    <section className="research-results settings" aria-label="Settings">
      {!draft ? <div className="empty-state">
        {!token ? <h2>Settings load once the header holds a Desktop session or an operator token.</h2>
          : error || authExpired ? <h2>Settings did not load. Use Retry or Load settings.</h2>
          : busy ? <p role="status">Loading settings…</p>
          : <h2>Settings load when you leave the token field (Tab, Enter or a click elsewhere), or press Load settings.</h2>}
      </div> : <>
        <SettingsSection title="Research Models" summary="A seat is one model assigned to one role. Select the provider, model, sign-in method and reasoning effort for each seat." open>
          {seatIssues.length > 0 && <div className="settings-validation" role="alert">
            <strong>Resolve these before saving.</strong>
            <ul>{seatIssues.map(issue => <li key={issue.role}>{issue.message}</li>)}</ul>
          </div>}
          <p className="field-note">Roles: Planner proposes, Reviewer (QA) assesses, Falsifier assesses with the brief to refute, Vision reads images, Prose edits text.</p>
          {!catalogLoaded && <p className="field-note settings-catalog-missing">Catalog not loaded{readinessError ? ' (' + readinessError + ')' : ''}: provider names only; models, efforts and sign-in methods are not checked here, and the service still refuses an invalid seat on save.</p>}
          <div className="seat-live" role="group" data-state={liveState} aria-label="Live mission readiness">
            <span className="badge" data-state={liveState}>{STATE_LABEL[liveState]}</span>
            <span><strong>Live mission:</strong> {sentence(liveMission?.meaning || readinessError || 'Readiness has not loaded yet')}{liveMission?.next_action ? ' Next: ' + sentence(liveMission.next_action) : ''}</span>
            {onNavigate && liveState === 'ready' && <Button variant="ghost" size="sm" onPress={() => onNavigate('research')}>Open Research</Button>}
          </div>
          <div className="seat-cards">
            {ROLES.map(([role, label]) => <SeatCard key={role} role={role} label={label} seat={draft.seats[role]} saved={snapshot.settings.seats[role]} node={readiness?.seats?.[role] || null}
              readinessError={readinessError} catalog={catalog} catalogLoaded={catalogLoaded} readOnly={readOnly} custom={Boolean(customRoles[role])}
              setCustom={on => setCustomRoles(current => ({...current, [role]: on}))} set={(key, value) => set(['seats', role, key], value)}/>)}
          </div>
          <p className="field-note">API credential: the name of a file created with <code>arc-science credential --name NAME</code>; no key is stored here. CLI login: the account already signed in to that tool (Claude Code, Codex, Gemini CLI). Provider OAuth sign-in inside Arc is not available in this build. An effort level the sign-in method cannot express is refused on save, not rounded.</p>
        </SettingsSection>

        <SettingsSection title="Connections" summary="See which seats are running, probe signed-in CLIs, and manage the MCP servers and ACP agents missions may use.">
          {!live ? <p className="muted">Connection state did not load. Press Reload to retry.</p> : !live.configured ? <p className="muted">No seats are running, so there is nothing to check.</p> : <LiveConnections live={live} probes={probes} catalog={catalog} consent={consent} setConsent={setConsent} busy={busy} probe={(provider) => task(signal => probe(provider, signal), 'Probe ' + providerLabel(catalog, provider), 'probe')} error={errorAt('probe')}/>}
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
          <div className="settings-table-wrap"><table className="seats settings-table providers-table"><thead><tr><th>Provider</th><th>Endpoint</th><th>CLI command</th><th>OpenClaw agent</th></tr></thead><tbody>
            {PROVIDER_NAMES.map(name => { const p = draft.providers[name]; const label = providerLabel(catalog, name); return <tr key={name}>
              <th scope="row">{label}</th>
              <td data-label="Endpoint"><input aria-label={label + ' endpoint'} value={p.endpoint} disabled={readOnly} onChange={e => set(['providers', name, 'endpoint'], e.target.value)}/></td>
              <td data-label="CLI command">{name === 'openclaw' ? <span className="muted">not applicable</span> : <input aria-label={label + ' CLI command'} value={p.cli} disabled={readOnly} onChange={e => set(['providers', name, 'cli'], e.target.value)}/>}</td>
              <td data-label="OpenClaw agent">{name === 'openclaw' ? <><input aria-label="OpenClaw agent id" value={p.agent_id} disabled={readOnly} onChange={e => set(['providers', name, 'agent_id'], e.target.value)}/> <label className="check"><input type="checkbox" checked={p.isolated} disabled={readOnly} onChange={e => set(['providers', name, 'isolated'], e.target.checked)}/>Isolated agent (tools disabled; OpenClaw needs this)</label></> : <span className="muted">not applicable</span>}</td>
            </tr>; })}
          </tbody></table></div>
          <label className="check"><input type="checkbox" checked={draft.prose.detection} disabled={readOnly} onChange={e => set(['prose', 'detection'], e.target.checked)}/>Allow third-party AI-text detection. Arc asks again before each request, and the text leaves this machine only when you agree.</label>
        </SettingsSection>
      </>}
    </section>
  </div>;
}

// One seat: the five controls, the server's readiness for the saved seat, and the
// draft-versus-saved difference as its own badge (never as a readiness state).
function SeatCard({role, label, seat, saved, node, readinessError, catalog, catalogLoaded, readOnly, custom, setCustom, set}) {
  const state = stateOf(node);
  const unsaved = JSON.stringify(seat) !== JSON.stringify(saved);
  const entry = modelEntry(catalog, seat);
  const models = catalog.providers?.[seat.provider]?.models || [];
  const isCustom = custom || (seat.model !== '' && !entry);
  const support = effortSupport(catalog, seat);
  const modes = signInModes(catalog, seat.provider);
  const allModes = catalog.auth_modes?.[seat.provider] || [];
  const source = catalog.providers?.[seat.provider]?.source;
  const caps = entry?.capabilities || {};
  const meaning = node?.meaning || readinessError || (catalogLoaded ? 'No readiness was reported for this seat.' : 'Readiness has not loaded yet.');
  return <article className="seat-card" aria-label={label + ' seat'} data-state={state}>
    <div className="seat-card-head">
      <h3>{label}</h3>
      <span className="badge" data-state={state}>{STATE_LABEL[state]}</span>
      {unsaved && <span className="badge" data-state="unsaved">Unsaved</span>}
    </div>
    <div className="seat-controls">
      <div className="seat-field"><span className="seat-field-label">Provider</span>
        <select aria-label={label + ' provider'} value={seat.provider} disabled={readOnly} onChange={e => set('provider', e.target.value)}>
          <option value="">None</option>
          {PROVIDER_NAMES.map(name => <option key={name} value={name}>{providerLabel(catalog, name)}</option>)}
        </select>
      </div>
      <div className="seat-field"><span className="seat-field-label">Model</span>
        <select aria-label={label + ' model'} value={isCustom ? CUSTOM : seat.model} disabled={readOnly} onChange={e => {
          if (e.target.value === CUSTOM) setCustom(true);
          else { setCustom(false); set('model', e.target.value); }
        }}>
          {isCustom ? null : <option value="">Choose a model</option>}
          {models.map(model => <option key={model.id} value={model.id}>{model.label} ({model.id})</option>)}
          <option value={CUSTOM}>Custom id…</option>
        </select>
        {isCustom && <input aria-label={label + ' custom model id'} value={seat.model} disabled={readOnly} onChange={e => set('model', e.target.value)} placeholder="model id"/>}
        {seat.provider && !catalogLoaded && <p className="seat-note">Model ids are not checked: {CATALOG_NOT_LOADED}.</p>}
        {entry && <p className="seat-note">In catalog {catalog.catalog_version} · {caps.context_tokens ? Number(caps.context_tokens).toLocaleString('en-US') + ' tokens' : 'context not stated'} · vision {caps.vision ? 'yes' : 'no'} · {caps.thinking ? 'thinking ' + caps.thinking : 'thinking not stated'}{source && <> · <a href={source} target="_blank" rel="noreferrer">catalog source</a></>}</p>}
        {catalogLoaded && !entry && seat.model && <p className="seat-note">Custom id (unverified): not in the catalog; readiness cannot be assumed</p>}
      </div>
      <div className="seat-field"><span className="seat-field-label">Effort</span>
        <select aria-label={label + ' effort'} value={seat.effort} disabled={readOnly || support.disabled} aria-invalid={(support.invalid && !support.transport) || undefined} onChange={e => set('effort', e.target.value)}>
          {support.allowed.includes(seat.effort) ? null : <option value={seat.effort}>{seat.effort} (not accepted)</option>}
          {support.allowed.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        {seat.provider && support.note && !support.transport && <p className="seat-note">{support.note}</p>}
      </div>
      <div className="seat-field"><span className="seat-field-label">Sign-in</span>
        <select aria-label={label + ' sign-in'} value={seat.auth} disabled={readOnly} aria-invalid={support.transport || undefined} onChange={e => set('auth', e.target.value)}>
          {modes.some(([value]) => value === seat.auth) ? null : <option value={seat.auth}>{authLabel(catalog, seat.provider, seat.auth)} (not supported)</option>}
          {modes.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
        {support.transport && <p className="seat-note">{support.note}</p>}
      </div>
      <div className="seat-field"><span className="seat-field-label">Credential file</span>
        <input aria-label={label + ' credential'} value={seat.credential} disabled={readOnly || seat.auth !== 'api_key'} onChange={e => set('credential', e.target.value)} placeholder={seat.auth === 'api_key' ? 'file name' : 'not used with CLI login'}/>
      </div>
    </div>
    <p className="seat-meaning">{meaning}</p>
    {node?.next_action && state !== 'ready' && <p className="seat-next">Next: {node.next_action}</p>}
    {unsaved && <p className="seat-next">Readiness refers to the saved seat; save to check this draft.</p>}
    {allModes.length > 0 && <details className="seat-auth-modes"><summary>Sign-in methods</summary>
      <ul>{allModes.map(mode => <li key={mode.mode}>{mode.label}: {mode.support}{mode.source && <> · <a href={mode.source} target="_blank" rel="noreferrer">basis</a></>}</li>)}</ul>
    </details>}
  </article>;
}

function StateCard({state}) {
  return <div className={'settings-state-card ' + state.kind} role="alert">
    <strong>{state.title}</strong>
    <p>{state.text}</p>
    {state.action && <Button variant="secondary" size="sm" onPress={state.action.run}>{state.action.label}</Button>}
  </div>;
}

function SettingsSection({title, summary, open = false, children}) {
  return <details className="settings-section" open={open}>
    <summary><span>{title}</span><small>{summary}</small></summary>
    <div className="settings-section-body">{children}</div>
  </details>;
}

function LiveConnections({live, probes, catalog, consent, setConsent, busy, probe, error}) {
  const transports = Object.keys(live.transports || {});
  return <>
    <div className="settings-table-wrap"><table className="seats settings-table" aria-label="Running seats"><thead><tr><th>Seat</th><th>Provider</th><th>Sign-in</th><th>Model</th><th>Effort</th></tr></thead><tbody>
      {Object.entries(live.seats || {}).map(([role, seat]) => <tr key={role}><th scope="row">{roleLabel(role)}</th><td>{providerLabel(catalog, seat.provider)}</td><td>{seat.transport === 'cli' ? 'CLI login' : 'API credential'}</td><td>{seat.model}</td><td>{seat.effort || 'default'}</td></tr>)}
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
        {transports.map(provider => <Button key={provider} variant="secondary" size="sm" isDisabled={busy || !consent} onPress={() => probe(provider)}>Probe {providerLabel(catalog, provider)}</Button>)}
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
