import React, {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {checkedFetch} from './http';

// Settings are owned by the native supervisor: the service reads a snapshot with a
// revision and forwards the whole edited document back with that revision, so a
// concurrent change is refused instead of overwritten. Nothing here holds a key:
// seats name a credential file or the operator's own CLI login.
const ROLES = [['planner', 'Planner'], ['reviewer', 'Reviewer (QA)'], ['falsifier', 'Falsifier'], ['vision', 'Vision'], ['prose', 'Prose']];
const PROVIDERS = [['', '—'], ['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['gemini', 'Gemini'], ['openclaw', 'OpenClaw']];
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'max'];
const AUTH = [['api_key', 'API credential'], ['cli', 'CLI login (OAuth)']];
const VIEWER = {representation: ['cartoon', 'surface', 'ball_and_stick', 'sticks', 'spacefill', 'backbone'],
  colouring: ['chain', 'element', 'residue', 'secondary_structure', 'bfactor', 'uniform'],
  assembly: ['asymmetric_unit', 'assembly_1', 'assembly_2'], background: ['white', 'black', 'transparent']};

export default function SettingsWorkspace({token}) {
  const [snapshot, setSnapshot] = useState(null), [draft, setDraft] = useState(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const credential = useRef(null);
  useLayoutEffect(() => {
    const controller = new AbortController(); credential.current = controller;
    setSnapshot(null); setDraft(null); setError(''); setNotice(''); setBusy(false);
    return () => controller.abort();
  }, [token]);
  const read = useCallback(async (path, signal, method = 'GET', body) => {
    signal.throwIfAborted();
    const response = await checkedFetch('/api' + path, {method, signal, headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
    const data = await response.json();
    signal.throwIfAborted();
    return data;
  }, [token]);
  async function task(action) {
    const signal = credential.current.signal;
    setBusy(true); setError(''); setNotice('');
    try { await action(signal); }
    catch (e) { if (!signal.aborted) setError(e.message); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  async function load(signal) {
    const snap = await read('/settings', signal);
    setSnapshot(snap); setDraft(structuredClone(snap.settings));
  }
  async function save(signal) {
    const snap = await read('/settings', signal, 'PUT', {settings: draft, if_revision: snapshot.revision});
    setSnapshot(snap); setDraft(structuredClone(snap.settings));
    setNotice('Saved. Applied live: ' + snap.applied_live.join(', ') + (snap.restart_required.length ? '; restart required for ' + snap.restart_required.join(', ') : '') + '.');
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
  return <div className="research-workspace">
    <aside className="research-form">
      <p className="eyebrow">SETTINGS</p><h1>Seats, providers, connections.</h1>
      <p className="muted">One file owned by the native supervisor; every change is validated there before it is written.</p>
      <div className="actions">
        <Button variant="secondary" isDisabled={busy || !token} onPress={() => task(load)}>{snapshot ? 'Reload' : 'Load settings'}</Button>
        <Button isDisabled={busy || !dirty || readOnly} onPress={() => task(save)}>Save</Button>
      </div>
      {snapshot && <p className="field-note">Revision <code>{snapshot.revision.slice(0, 12)}</code> · <code>{snapshot.path}</code>{readOnly ? ' · read only without the supervisor' : ''}</p>}
      {busy && <p role="status">Settings request in progress…</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </aside>
    <section className="research-results settings" aria-label="Settings">
      {!draft ? <p className="muted">Load the settings with your operator token.</p> : <>
        <h2>Model seats</h2>
        <table className="seats"><thead><tr><th>Seat</th><th>Provider</th><th>Model</th><th>Effort</th><th>Auth</th><th>Credential</th></tr></thead><tbody>
          {ROLES.map(([role, label]) => { const seat = draft.seats[role]; const id = 'seat-' + role; return <tr key={role}>
            <th scope="row">{label}</th>
            <td><select aria-label={label + ' provider'} value={seat.provider} disabled={readOnly} onChange={e => set(['seats', role, 'provider'], e.target.value)}>{PROVIDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
            <td><input aria-label={label + ' model'} value={seat.model} disabled={readOnly} onChange={e => set(['seats', role, 'model'], e.target.value)} placeholder="model id" id={id + '-model'}/></td>
            <td><select aria-label={label + ' effort'} value={seat.effort} disabled={readOnly} onChange={e => set(['seats', role, 'effort'], e.target.value)}>{EFFORTS.map(v => <option key={v} value={v}>{v}</option>)}</select></td>
            <td><select aria-label={label + ' auth'} value={seat.auth} disabled={readOnly} onChange={e => set(['seats', role, 'auth'], e.target.value)}>{AUTH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
            <td><input aria-label={label + ' credential'} value={seat.credential} disabled={readOnly || seat.auth !== 'api_key'} onChange={e => set(['seats', role, 'credential'], e.target.value)} placeholder={role}/></td>
          </tr>; })}
        </tbody></table>
        <p className="field-note">A credential is the name of a file stored by <code>arc-science credential</code>; a CLI login uses the provider's own command (claude, codex, gemini) with the account already signed in there.</p>
        <h2>Providers</h2>
        <table className="seats"><thead><tr><th>Provider</th><th>Endpoint</th><th>CLI</th><th>OpenClaw agent</th></tr></thead><tbody>
          {['anthropic', 'openai', 'gemini', 'openclaw'].map(name => { const p = draft.providers[name]; return <tr key={name}>
            <th scope="row">{name}</th>
            <td><input aria-label={name + ' endpoint'} value={p.endpoint} disabled={readOnly} onChange={e => set(['providers', name, 'endpoint'], e.target.value)}/></td>
            <td><input aria-label={name + ' CLI'} value={p.cli} disabled={readOnly || name === 'openclaw'} onChange={e => set(['providers', name, 'cli'], e.target.value)}/></td>
            <td>{name === 'openclaw' ? <><input aria-label="OpenClaw agent id" value={p.agent_id} disabled={readOnly} onChange={e => set(['providers', name, 'agent_id'], e.target.value)}/> <label className="check"><input type="checkbox" checked={p.isolated} disabled={readOnly} onChange={e => set(['providers', name, 'isolated'], e.target.checked)}/>isolated</label></> : <span className="muted">—</span>}</td>
          </tr>; })}
        </tbody></table>
        <h2>MCP servers</h2>
        <ListEditor rows={draft.mcp_servers} readOnly={readOnly} kind="mcp" onChange={rows => set(['mcp_servers'], rows)}/>
        <h2>ACP agents</h2>
        <ListEditor rows={draft.acp_agents} readOnly={readOnly} kind="acp" onChange={rows => set(['acp_agents'], rows)}/>
        <h2>Prose, Blender, viewer</h2>
        <label className="check"><input type="checkbox" checked={draft.prose.detection} disabled={readOnly} onChange={e => set(['prose', 'detection'], e.target.checked)}/>Third-party AI detection may run (each request still needs its own consent).</label>
        <div className="formrow">
          <div><label htmlFor="blender-preset">Blender preset</label><input id="blender-preset" value={draft.blender.default_preset} disabled={readOnly} onChange={e => set(['blender', 'default_preset'], e.target.value)}/></div>
          {Object.entries(VIEWER).map(([key, options]) => <div key={key}><label htmlFor={'viewer-' + key}>Viewer {key.replace('_', ' ')}</label>
            <select id={'viewer-' + key} value={draft.viewer[key]} disabled={readOnly} onChange={e => set(['viewer', key], e.target.value)}>{options.includes(draft.viewer[key]) ? null : <option value={draft.viewer[key]}>{draft.viewer[key]}</option>}{options.map(v => <option key={v} value={v}>{v}</option>)}</select></div>)}
        </div>
      </>}
    </section>
  </div>;
}

function ListEditor({rows, readOnly, kind, onChange}) {
  const blank = kind === 'mcp' ? {name: '', transport: 'stdio', command: '', args: [], url: '', consent: false, enabled: true} : {name: '', command: '', args: [], enabled: true};
  const update = (index, patch) => onChange(rows.map((row, i) => i === index ? {...row, ...patch} : row));
  return <div className="list-editor">
    {rows.length === 0 && <p className="muted">None.</p>}
    {rows.map((row, i) => <div className="record" key={i}>
      <div className="formrow">
        <div><label>Name<input aria-label={kind + ' name ' + (i + 1)} value={row.name} disabled={readOnly} onChange={e => update(i, {name: e.target.value})}/></label></div>
        {kind === 'mcp' && <div><label>Transport<select aria-label={'mcp transport ' + (i + 1)} value={row.transport} disabled={readOnly} onChange={e => update(i, {transport: e.target.value})}><option value="stdio">stdio</option><option value="http">http</option></select></label></div>}
        {(kind === 'acp' || row.transport === 'stdio') && <div><label>Command<input aria-label={kind + ' command ' + (i + 1)} value={row.command} disabled={readOnly} onChange={e => update(i, {command: e.target.value})}/></label></div>}
        {kind === 'mcp' && row.transport === 'http' && <div><label>URL<input aria-label={'mcp url ' + (i + 1)} value={row.url} disabled={readOnly} onChange={e => update(i, {url: e.target.value})}/></label></div>}
        <div><label>Arguments<input aria-label={kind + ' args ' + (i + 1)} value={row.args.join(' ')} disabled={readOnly} onChange={e => update(i, {args: e.target.value.split(/\s+/).filter(Boolean)})}/></label></div>
      </div>
      <div className="actions">
        <label className="check"><input type="checkbox" checked={row.enabled} disabled={readOnly} onChange={e => update(i, {enabled: e.target.checked})}/>enabled</label>
        {kind === 'mcp' && <label className="check"><input type="checkbox" checked={row.consent} disabled={readOnly} onChange={e => update(i, {consent: e.target.checked})}/>missions may send data to it</label>}
        <Button variant="ghost" size="sm" isDisabled={readOnly} onPress={() => onChange(rows.filter((_, j) => j !== i))}>Remove</Button>
      </div>
    </div>)}
    <Button variant="secondary" size="sm" isDisabled={readOnly} onPress={() => onChange([...rows, blank])}>Add {kind === 'mcp' ? 'MCP server' : 'ACP agent'}</Button>
  </div>;
}
