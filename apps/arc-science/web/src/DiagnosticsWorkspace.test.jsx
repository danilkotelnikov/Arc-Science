import React from 'react';
import {describe, expect, it, vi, afterEach} from 'vitest';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DiagnosticsWorkspace from './DiagnosticsWorkspace';
import {NATIVE_SESSION} from './http';
import {I18nProvider} from './i18n/index.jsx';

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {status: init.status || 200, headers: {'Content-Type': 'application/json'}});
}
// Times read the way the page writes them: a medium date and a short time.
const when = seconds => new Intl.DateTimeFormat('en', {dateStyle: 'medium', timeStyle: 'short'}).format(seconds * 1000).replace(/\s+/g, ' ');
const health = () => json({status: 'ready', version: '0.6.0', deployment: 'single-trust-domain'});
const seat = (role, label, state, code, meaning, next_action = null, extra = {}) => ({role, label, state, code, facts: {}, verification: {status: 'not_tested'}, meaning, next_action, source: 'settings revision abcdef123456', ...extra});
const PROBED_AT = 1_699_999_000, PROBED = when(PROBED_AT);
const ROLES = [{role: 'planner', label: 'Planner', purpose: 'proposes branches and actions'}, {role: 'reviewer', label: 'Reviewer (QA)', purpose: 'assesses'}, {role: 'falsifier', label: 'Falsifier', purpose: 'assesses with the brief to refute'}, {role: 'vision', label: 'Vision', purpose: 'reviews images'}, {role: 'prose', label: 'Prose', purpose: 'edits text'}];
const readiness = (kind = 'token') => ({
  checked_at: 1_700_000_000,
  session: {kind, state: 'ready', code: 'session.' + kind, label: kind === 'native' ? 'Desktop session' : 'Operator token', meaning: kind === 'native' ? 'The desktop shell signed this request.' : 'The bearer token was accepted.', next_action: null, source: 'request header'},
  settings: {state: 'ready', code: 'settings.available', revision: 'abcdef1234567890', path: 'C:/data/settings.json', read_only: false, meaning: 'Settings can be read and saved.', next_action: null, source: 'supervisor'},
  roles: ROLES,
  seats: {
    planner: seat('planner', 'Planner', 'ready', 'seat.verified', 'Verified against the configured model.', null, {facts: {transport: 'cli', executable: 'claude.cmd', cli_logged_in: true, cli_auth_method: 'claude.ai'}, verification: {status: 'ok', checked_at: PROBED_AT, observed_model: 'claude-sonnet-5', identity_verified: true}}),
    reviewer: seat('reviewer', 'Reviewer (QA)', 'not_tested', 'seat.inherits', 'Inherits the planner seat.', 'Run the probe in Settings to verify it.'),
    falsifier: seat('falsifier', 'Falsifier', 'failed', 'seat.probe_failed', 'The last probe failed.', 'Fix the credential, then probe again in Settings.', {facts: {transport: 'api', credential_ref: 'falsifier-key', credential_stored: true, credential_store: 'credential_manager'}, verification: {status: 'failed', checked_at: PROBED_AT, observed_model: null, identity_verified: null, error: 'HTTP 401 from the provider'}}),
    vision: seat('vision', 'Vision', 'blocked', 'seat.cli_not_signed_in', 'The openai CLI reports no login', 'Sign in inside the CLI, then reload this page', {facts: {transport: 'cli', executable: 'codex', cli_logged_in: false, cli_auth_method: 'none'}, verification: {status: 'not_applicable'}}),
    prose: seat('prose', 'Prose', 'blocked', 'seat.unconfigured', 'Prose edits through a model are unavailable; the local rewrite still works', 'Set a prose seat in Settings.'),
  },
  live_mission: {state: 'failed', code: 'live.failed', blocking: ['falsifier'], meaning: 'A live mission would fail on the falsifier seat.', next_action: 'Repair the falsifier seat, then probe it.'},
  connectors: {mcp: [{name: 'fake', transport: 'stdio', enabled: true, consented: true, state: 'not_tested', code: 'connector.eligible', meaning: 'Enabled and consented.', next_action: 'Check MCP below reaches it.'}], acp: [{name: 'agent', enabled: true, consented: false, state: 'blocked', code: 'connector.not_consented', meaning: 'Enabled but not consented.', next_action: 'Consent in Settings.'}], mcp_sdk: '1.2.3', acp_protocol: '1', state: 'not_tested', code: 'connectors.eligible', meaning: '1 of 2 connectors can be bound by a live mission; none is checked here', next_action: 'Run the connection checks in Diagnostics'},
  renderer: {state: 'not_tested', code: 'renderer.configured', facts: {configured: true, exists: true, default_preset: 'default'}, meaning: 'Blender is configured.', next_action: 'Submit a render in Molecules to test it.', source: 'settings'},
  memory: {state: 'ready', code: 'memory.available', facts: {protocol: 'arc-memory/1', sqlite: '3.53.2'}, meaning: 'The memory engine answers.', next_action: null},
  storage: {state: 'not_tested', code: 'storage.present', facts: {missions_db: true, missions: 3}, meaning: 'The missions database is present.', next_action: 'Integrity is checked on demand: select Read diagnostics under Diagnostics.'},
  catalog: {},
  public_reads: {enabled: false},
});
const card = title => screen.getByRole('heading', {name: title, level: 3}).closest('article');
// The value beside a label in a Facts list.
const fact = (container, label) => within(container).getByText(label, {selector: 'dt'}).nextElementSibling;
const region = name => screen.getByRole('region', {name});
// The /api/diagnostics document of §4: every section names its source and its read time.
const READ_AT = 1_700_000_100;
const section = (source, state, code, meaning, next_action, facts) => ({source, checked_at: READ_AT, state, code, meaning, next_action, ...facts});
const diagnostics = () => ({
  checked_at: READ_AT,
  note: 'Local reads only: no model call, no connector start, no render. Each section names its source.',
  storage: section('missions.db, grants.db and timeline.db in the data directory; memory capture status from the service', 'ready', 'storage.verified',
    '3 of 3 missions verified, sqlite ok (missions, grants, timeline), memory capture unconfigured', null,
    {missions: {total: 3, checked: 3, verified: 3, broken: [], limit: 200}, sqlite: {'missions.db': 'ok', 'grants.db': 'ok', 'timeline.db': 'ok'}, memory_capture: {status: 'unconfigured', pending: 0, last_error: 'Native memory worker is not configured'}}),
  jobs: section('molecular job records (molecular/<id>/job.json) held by the service', 'failed', 'jobs.failed', '2 of 4 molecular renders failed or were interrupted', 'Retry a render below, or render again from Molecules',
    {total: 4, failed: [
      {id: 'a'.repeat(32), status: 'failed', filename: 'complex.cif', error: 'Molecular rendering failed: the stand-in refused', updated_at: READ_AT - 100.5, retryable: true, retry_note: null},
      {id: 'b'.repeat(32), status: 'interrupted', filename: 'older.cif', error: 'Interrupted by a service restart', updated_at: READ_AT - 900, retryable: false, retry_note: 'Recorded before settings tracking; render it again from Molecules'},
    ]}),
  renderer: section('ARC_MOLECULAR_BLENDER_PYTHON and ARC_SVG2PNG in the service environment; the runtime probe if one already ran; the newest molecular job record', 'blocked', 'renderer.not_configured', 'No Blender Python is configured', 'Set ARC_MOLECULAR_BLENDER_PYTHON on the server, then restart the service',
    {blender_python: {configured: false, exists: null, executable: null}, svg_rasterizer: {configured: true, exists: true, executable: 'arc-svg2png.exe'}, runtime_probe: {checked: false, ok: null, reason: null}, last_render: {id: 'a'.repeat(32), status: 'failed', updated_at: READ_AT - 100.5, error: 'Molecular rendering failed: the stand-in refused'}}),
  package: section('the running service process and its environment', 'not_tested', 'package.facts', 'Facts about the running service; nothing here is verified against the files on disk', null,
    {version: '0.6.0', python: {version: '3.13.7', executable: 'C:/py/python.exe'}, supervisor: {configured: false, path: null, source: 'ARC_SUPERVISOR'}, settings: {revision: 'abcdef1234567890'}, data_dir: 'C:/data', started_at: READ_AT - 1000}),
  probes: section('the last probe record per transport: memory, then providers/<name>-probes.jsonl', 'not_tested', 'probes.none', 'No probe has been recorded; readiness matches probe records to seats by subject digest', 'Probe a seat in Settings', {records: []}),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DiagnosticsWorkspace', () => {
  it('shows every readiness card with the shared vocabulary, its meaning and its next action', async () => {
    vi.stubGlobal('fetch', vi.fn(async path => path === '/health' ? health() : Promise.reject(new Error('unexpected ' + path))));
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<DiagnosticsWorkspace token={NATIVE_SESSION} readiness={readiness('native')} refreshReadiness={vi.fn(async () => null)} onNavigate={onNavigate}/>);
    await screen.findByText('single-trust-domain');
    expect(document.body.textContent).not.toMatch(/paste/i);
    expect(screen.queryByText(/Operator checks need a token|Load capabilities/)).not.toBeInTheDocument();

    // The summary names each area with the same state mark its card carries.
    const status = region('Status');
    expect(fact(status, 'Service')).toHaveTextContent('Ready');
    expect(fact(status, 'Session')).toHaveTextContent('Ready');
    expect(fact(status, 'Seats')).toHaveTextContent('Failed');
    expect(fact(status, 'Seats').querySelector('.bp-status')).toHaveAttribute('data-state', 'failed');
    expect(fact(status, 'Connectors')).toHaveTextContent('Not tested');

    expect(card('Session')).toHaveAttribute('data-state', 'ready');
    expect(card('Session')).toHaveTextContent('Desktop session');
    expect(card('Session')).toHaveTextContent('The desktop shell signed this request.');
    expect(card('Settings')).toHaveAttribute('data-state', 'ready');
    expect(card('Settings')).toHaveTextContent('abcdef123456');
    expect(card('Settings')).not.toHaveTextContent('abcdef1234567890');
    expect(card('Settings')).toHaveTextContent('C:/data/settings.json');

    const table = screen.getByRole('grid', {name: 'Seat readiness'});
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Seat', 'Readiness', 'Last probe']);
    const seats = within(table).getAllByRole('row').slice(1);
    expect(seats).toHaveLength(5);
    const probe = row => within(row).getAllByRole('gridcell')[1];
    expect(seats[0]).toHaveTextContent('Planner');
    expect(seats[0]).toHaveTextContent('Ready');
    expect(seats[0]).not.toHaveTextContent('Next:');
    // The third column is the verification as readiness reports it, plus a CLI seat's login fact.
    expect(probe(seats[0])).toHaveTextContent('Last probe ' + PROBED + ', answering model claude-sonnet-5, identity verified');
    expect(probe(seats[0])).toHaveTextContent('Signed in via claude.cmd (claude.ai)');
    expect(seats[1]).toHaveAttribute('data-state', 'not_tested');
    expect(within(seats[1]).getByRole('rowheader')).toHaveTextContent('Reviewer (QA)');
    const readinessCell = within(seats[1]).getAllByRole('gridcell')[0];
    expect(within(readinessCell).getByText('Not tested')).toBeInTheDocument();
    expect(within(readinessCell).getByText('Inherits the planner seat.')).toBeInTheDocument();
    expect(within(readinessCell).getByText('Next: Run the probe in Settings to verify it.')).toBeInTheDocument();
    expect(probe(seats[1])).toHaveTextContent(/^Never probed$/);
    expect(seats[2]).toHaveAttribute('data-state', 'failed');
    expect(seats[2]).toHaveTextContent('Failed');
    expect(probe(seats[2])).toHaveTextContent('Probe failed: HTTP 401 from the provider');
    expect(seats[2]).not.toHaveTextContent(/Signed in|Not signed in/);
    expect(seats[3]).toHaveTextContent('Vision');
    expect(seats[3]).toHaveTextContent('Blocked');
    expect(seats[3]).toHaveTextContent('The openai CLI reports no login');
    expect(seats[3]).toHaveTextContent('Next: Sign in inside the CLI, then reload this page');
    expect(probe(seats[3])).toHaveTextContent('Never probed');
    expect(probe(seats[3])).toHaveTextContent('Not signed in');
    expect(seats[4]).toHaveTextContent('Prose');
    expect(probe(seats[4])).toHaveTextContent('Never probed');
    expect(card('Seats')).toHaveAttribute('data-state', 'failed');
    expect(card('Seats')).toHaveTextContent('Next: Repair the falsifier seat, then probe it.');
    await user.click(within(card('Seats')).getByRole('button', {name: 'Open Settings'}));
    expect(onNavigate).toHaveBeenCalledWith('settings');

    expect(card('Connectors')).toHaveAttribute('data-state', 'not_tested');
    expect(card('Connectors')).toHaveTextContent('1 of 2 connectors can be bound');
    const connectors = within(screen.getByRole('grid', {name: 'Connector readiness'})).getAllByRole('row').slice(1);
    expect(within(connectors[0]).getByRole('rowheader')).toHaveTextContent('fake');
    expect(connectors[0]).toHaveTextContent('MCP');
    expect(connectors[0]).toHaveTextContent('Not tested');
    expect(within(connectors[1]).getByRole('rowheader')).toHaveTextContent('agent');
    expect(connectors[1]).toHaveTextContent('ACP');
    const connectorCell = within(connectors[1]).getAllByRole('gridcell')[1];
    expect(within(connectorCell).getByText('Blocked')).toBeInTheDocument();
    expect(within(connectorCell).getByText('Enabled but not consented.')).toBeInTheDocument();
    expect(within(connectorCell).getByText('Next: Consent in Settings.')).toBeInTheDocument();
    expect(fact(card('Connectors'), 'MCP SDK')).toHaveTextContent('1.2.3');
    expect(fact(card('Connectors'), 'ACP protocol')).toHaveTextContent('1');
    expect(card('Renderer')).toHaveAttribute('data-state', 'not_tested');
    expect(card('Renderer')).toHaveTextContent('Next: Submit a render in Molecules to test it.');
    expect(card('Memory')).toHaveAttribute('data-state', 'ready');
    expect(card('Memory')).toHaveTextContent('arc-memory/1');
    expect(card('Storage')).toHaveAttribute('data-state', 'not_tested');
    expect(within(card('Storage')).getByText('3')).toBeInTheDocument();
    expect(card('Storage')).toHaveTextContent('Integrity is checked on demand');
    expect(screen.getByText('arc-memory/1, SQLite 3.53.2')).toBeInTheDocument();
    expect(screen.queryByText('not loaded')).not.toBeInTheDocument();
    expect(region('Readiness')).toHaveTextContent('Read at ' + when(1_700_000_000));
    // Readiness is passive: nothing but the public health line was fetched here.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('loads only public service health on mount and keeps readiness and connection checks locked without a session', async () => {
    const fetch = vi.fn(async path => {
      if (path === '/health') return health();
      throw new Error('unexpected ' + path);
    });
    vi.stubGlobal('fetch', fetch);
    render(<DiagnosticsWorkspace token="" refreshReadiness={vi.fn()}/>);

    await screen.findByText('single-trust-domain');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/health', expect.objectContaining({signal: expect.any(AbortSignal)}));
    expect(screen.getByRole('status')).toHaveTextContent('Operator token required');
    expect(screen.getByRole('button', {name: 'Go to token field'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Refresh service'})).toBeEnabled();
    expect(screen.getByRole('button', {name: 'Refresh readiness'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Refresh readiness (re-read logins)'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Check MCP'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Check ACP'})).toBeDisabled();
    // The reason sits beside each disabled button group and in each unread card.
    expect(within(region('Status')).getByText('Needs a desktop session or an operator token.')).toBeInTheDocument();
    const checks = region('Connection checks');
    expect(within(checks).getAllByText('Needs a desktop session or an operator token.').some(note => note.parentElement === checks)).toBe(true);
    expect(screen.queryByText(/Operator checks need a token|Load capabilities/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/paste/i);
    expect(card('Service')).toHaveAttribute('data-state', 'ready');
    expect(card('Session')).toHaveAttribute('data-state', 'blocked');
    expect(card('Session')).toHaveTextContent('No desktop session and no operator token.');
    expect(card('Session')).toHaveTextContent('Next: Unlock in the header.');
    for (const title of ['Settings', 'Seats', 'Connectors', 'Renderer', 'Memory', 'Storage']) {
      expect(card(title)).toHaveAttribute('data-state', 'unknown');
      expect(card(title)).toHaveTextContent('Needs a desktop session or an operator token.');
      expect(fact(region('Status'), title)).toHaveTextContent('Unknown');
    }
    expect(screen.getByText('not loaded')).toBeInTheDocument();
  });

  it('reads readiness for a manual token only when asked and reflects the answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async path => path === '/health' ? health() : Promise.reject(new Error('unexpected ' + path))));
    let current = null;
    const refreshReadiness = vi.fn(async () => { current = readiness('token'); return current; });
    const user = userEvent.setup();
    const {rerender} = render(<DiagnosticsWorkspace token="operator" readiness={null} refreshReadiness={refreshReadiness}/>);
    await screen.findByText('single-trust-domain');
    expect(refreshReadiness).not.toHaveBeenCalled();
    expect(card('Session')).toHaveAttribute('data-state', 'not_tested');
    expect(card('Session')).toHaveTextContent('Operator token present, not yet verified.');
    expect(card('Session')).toHaveTextContent('Next: Select Refresh readiness.');
    expect(card('Seats')).toHaveTextContent('Select Refresh readiness to read it.');
    await user.click(screen.getByRole('button', {name: 'Refresh readiness'}));
    expect(refreshReadiness).toHaveBeenCalledTimes(1);
    expect(refreshReadiness).toHaveBeenLastCalledWith();
    rerender(<DiagnosticsWorkspace token="operator" readiness={current} refreshReadiness={refreshReadiness}/>);
    expect(card('Session')).toHaveAttribute('data-state', 'ready');
    expect(card('Session')).toHaveTextContent('Operator token');
    expect(card('Session')).toHaveTextContent('The bearer token was accepted.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/paste/i);
    // Re-read logins is the same read with fresh=true; the shell builds the URL, this page only asks.
    await user.click(screen.getByRole('button', {name: 'Refresh readiness (re-read logins)'}));
    expect(refreshReadiness).toHaveBeenCalledTimes(2);
    expect(refreshReadiness).toHaveBeenLastCalledWith({fresh: true});
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the rejected desktop session to the shared card and no other instruction', async () => {
    vi.stubGlobal('fetch', vi.fn(async path => path === '/health' ? health() : Promise.reject(new Error('unexpected ' + path))));
    render(<DiagnosticsWorkspace token={NATIVE_SESSION} readiness={null} readinessError="Request failed (401): Authentication required" refreshReadiness={vi.fn()}/>);
    await screen.findByText('single-trust-domain');
    expect(screen.getByRole('status')).toHaveTextContent('Desktop session not accepted');
    expect(screen.getByRole('status')).toHaveTextContent('Switch to an operator token in the header and retry.');
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'error');
    expect(within(screen.getByRole('status')).getByRole('button', {name: 'Use operator token'})).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Authentication required/)).not.toBeInTheDocument();
    expect(card('Session')).toHaveAttribute('data-state', 'failed');
    expect(card('Session')).toHaveTextContent('The desktop session was rejected by the service.');
    expect(card('Session')).not.toHaveTextContent('Next:');
    expect(card('Seats')).toHaveAttribute('data-state', 'unknown');
    expect(card('Seats')).toHaveTextContent('Not read: the session was rejected.');
    expect(screen.getByRole('button', {name: 'Refresh readiness'})).toBeEnabled();
  });

  it('reports a readiness read that failed for another reason beside Refresh readiness', async () => {
    vi.stubGlobal('fetch', vi.fn(async path => path === '/health' ? health() : Promise.reject(new Error('unexpected ' + path))));
    render(<DiagnosticsWorkspace token="operator" readiness={null} readinessError="Request failed (503): Settings are not available to this service" refreshReadiness={vi.fn()}/>);
    await screen.findByText('single-trust-domain');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Readiness is unavailable in this local service');
    expect(alert).not.toHaveTextContent('Request failed (503)');
    expect(within(region('Status')).getByRole('alert')).toBeInTheDocument();
    expect(card('Session')).toHaveAttribute('data-state', 'unknown');
    expect(card('Session')).toHaveTextContent('Next: See the message beside Refresh readiness.');
    expect(screen.queryByText('Operator token required')).not.toBeInTheDocument();
  });

  it('runs MCP and ACP checks explicitly and labels unavailable rows without raw JSON', async () => {
    const fetch = vi.fn(async (path, options = {}) => {
      if (path === '/health') return health();
      expect(options.headers.Authorization).toBe('Bearer operator');
      if (path === '/api/mcp/servers/check') return json({sdk: '1.2.3', consented: ['fake'], servers: [
        {server: 'fake', ok: true, tools: [{name: 'mcp_fake_echo', offered: true}]},
        {server: 'broken', ok: false, error: 'command missing'},
      ]});
      if (path === '/api/acp/agents/check') return json({protocol_version: 1, consented: ['agent'], agents: [
        {agent: 'agent', ok: true, agent_info: {name: 'fake-acp', version: '0.1'}},
      ]});
      throw new Error('unexpected ' + path);
    });
    vi.stubGlobal('fetch', fetch);

    const user = userEvent.setup();
    render(<DiagnosticsWorkspace token="operator" readiness={readiness()} refreshReadiness={vi.fn()}/>);
    expect(card('MCP servers')).toHaveAttribute('data-state', 'not_tested');
    await user.click(await screen.findByRole('button', {name: 'Check MCP'}));
    await screen.findByText('mcp_fake_echo');
    expect(screen.getByText('Unavailable: command missing')).toBeInTheDocument();
    expect(card('MCP servers')).toHaveAttribute('data-state', 'ready');
    expect(fact(card('MCP servers'), 'Consented servers')).toHaveTextContent('fake');
    expect(fetch).toHaveBeenLastCalledWith('/api/mcp/servers/check', expect.objectContaining({method: 'POST'}));

    await user.click(screen.getByRole('button', {name: 'Check ACP'}));
    await screen.findByText('fake-acp 0.1');
    expect(card('ACP agents')).toHaveAttribute('data-state', 'ready');
    expect(fetch).toHaveBeenLastCalledWith('/api/acp/agents/check', expect.objectContaining({method: 'POST'}));
    expect(screen.queryByText(/"servers"/)).not.toBeInTheDocument();
  });

  it('turns a 401 from a connection check into the shared recovery card', async () => {
    vi.stubGlobal('fetch', vi.fn(async path => {
      if (path === '/health') return health();
      return json({detail: {raw: 'do not show'}}, {status: 401});
    }));

    const user = userEvent.setup();
    render(<DiagnosticsWorkspace token="expired" readiness={null} refreshReadiness={vi.fn(async () => null)}/>);

    await user.click(await screen.findByRole('button', {name: 'Check MCP'}));
    // The shared LockNotice states the rejection once (tone error, role status); no second alert repeats it.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Token not accepted'));
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'error');
    expect(within(screen.getByRole('status')).getByRole('button', {name: 'Go to token field'})).toBeInTheDocument();
    expect(screen.getAllByText(/Token not accepted/)).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/do not show/)).not.toBeInTheDocument();
    expect(card('MCP servers')).toHaveAttribute('data-state', 'blocked');
    expect(card('MCP servers')).toHaveTextContent('Unlocks when the header holds an accepted desktop session or operator token.');
    expect(card('Session')).toHaveAttribute('data-state', 'failed');
    expect(card('Session')).toHaveTextContent('The operator token was rejected by the service.');
  });

  it('maps an unreadable service response to plain text instead of the parser message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', {status: 200, headers: {'Content-Type': 'text/html'}})));
    render(<DiagnosticsWorkspace token=""/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('The service returned an unreadable response. Retry.');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/Unexpected token|JSON/);
    expect(card('Service')).toHaveAttribute('data-state', 'failed');
  });

  it('explains an unavailable settings service in a connection check without displaying raw HTTP detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async path => path === '/health'
      ? health()
      : json({detail: 'Settings are not available to this service'}, {status: 503})));
    const user = userEvent.setup();
    render(<DiagnosticsWorkspace token="operator" readiness={readiness()} refreshReadiness={vi.fn()}/>);
    await user.click(await screen.findByRole('button', {name: 'Check MCP'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection checks are unavailable in this local service');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Request failed (503)');
    expect(within(region('Connection checks')).getByRole('alert')).toBeInTheDocument();
    expect(card('MCP servers')).toHaveAttribute('data-state', 'failed');
    expect(within(card('MCP servers')).getByText(/missing its settings or the MCP package/)).toBeInTheDocument();
    expect(card('Session')).toHaveAttribute('data-state', 'ready');
  });

  it('marks service unavailable after a refresh failure instead of keeping stale ready state', async () => {
    let healthCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async path => {
      if (path === '/health') {
        healthCalls += 1;
        if (healthCalls === 1) return health();
        throw new TypeError('Failed to fetch');
      }
      throw new Error('unexpected ' + path);
    }));

    const user = userEvent.setup();
    render(<DiagnosticsWorkspace token=""/>);

    await screen.findByText('single-trust-domain');
    await user.click(screen.getByRole('button', {name: 'Refresh service'}));

    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Arc Science is not reachable. Start the local service, then retry.');
    await waitFor(() => expect(screen.getByText('unavailable')).toBeInTheDocument());
    expect(card('Service')).toHaveAttribute('data-state', 'failed');
    expect(card('Service')).toHaveTextContent('The last refresh failed. See the message beside Refresh service.');
    expect(fact(region('Status'), 'Service')).toHaveTextContent('Failed');
    expect(screen.queryByText('single-trust-domain')).not.toBeInTheDocument();
  });

  it("shows the host session from /health beside the page's own session", async () => {
    const healthWith = host_session => json({status: 'ready', version: '0.6.0', deployment: 'single-trust-domain', ...(host_session && {host_session})});
    const cases = [
      [{mode: 'owned', source: 'ARC_HOST_SESSION'}, NATIVE_SESSION, 'owned', 'owned by this window'],
      [{mode: 'owned', source: 'ARC_HOST_SESSION'}, 'operator', 'reused', 'reused (started elsewhere)'],
      [{mode: 'standalone', source: 'ARC_HOST_SESSION'}, 'operator', 'standalone', 'standalone (not started by the desktop app)'],
      [null, 'operator', 'unreported', 'not reported by this service'],
    ];
    for (const [hostSession, token, key, value] of cases) {
      vi.stubGlobal('fetch', vi.fn(async path => path === '/health' ? healthWith(hostSession) : Promise.reject(new Error('unexpected ' + path))));
      const {unmount} = render(<DiagnosticsWorkspace token={token} readiness={null} refreshReadiness={vi.fn()}/>);
      await screen.findByText('single-trust-domain');
      expect(card('Service')).toHaveAttribute('data-host-session', key);
      expect(fact(card('Service'), 'Host session')).toHaveTextContent(value);
      expect(within(card('Service')).getByText(/^Source: \/health/)).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('reads diagnostics only when asked and renders every section with its source', async () => {
    const fetch = vi.fn(async path => {
      if (path === '/health') return health();
      if (path === '/api/diagnostics') return json(diagnostics());
      throw new Error('unexpected ' + path);
    });
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<DiagnosticsWorkspace token="operator" readiness={null} refreshReadiness={vi.fn()}/>);
    await screen.findByText('single-trust-domain');
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const title of ['Storage integrity', 'Failed renders', 'Renderer facts', 'Package', 'Probes']) {
      expect(card(title)).toHaveAttribute('data-state', 'unknown');
      expect(card(title)).toHaveTextContent('Select Read diagnostics to read it.');
    }
    await user.click(screen.getByRole('button', {name: 'Read diagnostics'}));
    await waitFor(() => expect(card('Storage integrity')).toHaveAttribute('data-state', 'ready'));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith('/api/diagnostics', expect.objectContaining({headers: {Authorization: 'Bearer operator'}, signal: expect.any(AbortSignal)}));

    const integrity = card('Storage integrity');
    expect(integrity).toHaveAttribute('data-section', 'storage');
    expect(fact(integrity, 'Missions verified')).toHaveTextContent(/^3 of 3$/);
    expect(fact(integrity, 'SQLite')).toHaveTextContent('missions.db ok, grants.db ok, timeline.db ok');
    expect(fact(integrity, 'Memory capture')).toHaveTextContent('unconfigured, pending 0, Native memory worker is not configured');
    expect(integrity).not.toHaveTextContent('Broken chains');

    expect(card('Failed renders')).toHaveAttribute('data-section', 'jobs');
    expect(card('Failed renders')).toHaveAttribute('data-state', 'failed');
    expect(card('Failed renders')).toHaveTextContent('Next: Retry a render below, or render again from Molecules');
    const rows = within(screen.getByRole('grid', {name: 'Failed renders'})).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole('rowheader')).toHaveTextContent('complex.cif');
    expect(within(rows[0]).getByRole('rowheader')).toHaveTextContent('aaaaaaaaaaaa…');
    expect(within(rows[0]).getAllByRole('gridcell')[0]).toHaveTextContent(/^failed$/);
    expect(within(rows[0]).getAllByRole('gridcell')[1]).toHaveTextContent('Molecular rendering failed: the stand-in refused');
    expect(within(rows[0]).getByRole('button', {name: 'Retry render'})).toBeEnabled();
    expect(within(rows[0]).getByRole('button', {name: 'Retry render'})).toHaveAttribute('data-job-id', 'a'.repeat(32));
    expect(rows[1]).toHaveTextContent('interrupted');
    expect(within(rows[1]).getByRole('button', {name: 'Retry render'})).toBeDisabled();
    expect(rows[1]).toHaveTextContent('Recorded before settings tracking; render it again from Molecules');

    const rendererFacts = card('Renderer facts');
    expect(rendererFacts).toHaveAttribute('data-section', 'renderer');
    expect(rendererFacts).toHaveAttribute('data-state', 'blocked');
    expect(fact(rendererFacts, 'Blender Python')).toHaveTextContent('configured no, found unknown, none');
    expect(fact(rendererFacts, 'SVG rasterizer')).toHaveTextContent('configured yes, found yes, arc-svg2png.exe');
    expect(fact(rendererFacts, 'Runtime probe')).toHaveTextContent('not run in this service');
    expect(fact(rendererFacts, 'Last render')).toHaveTextContent('failed, render aaaaaaaaaaaa…, ' + when(READ_AT - 100.5));
    expect(rendererFacts).toHaveTextContent('Next: Set ARC_MOLECULAR_BLENDER_PYTHON on the server, then restart the service');
    const pkg = card('Package');
    expect(pkg).toHaveAttribute('data-section', 'package');
    expect(fact(pkg, 'Python')).toHaveTextContent('3.13.7');
    expect(fact(pkg, 'Python executable')).toHaveTextContent('C:/py/python.exe');
    expect(fact(pkg, 'Supervisor')).toHaveTextContent('not configured (ARC_SUPERVISOR unset)');
    expect(fact(pkg, 'Settings revision')).toHaveTextContent(/^abcdef123456$/);
    expect(card('Probes')).toHaveAttribute('data-section', 'probes');
    expect(card('Probes')).toHaveTextContent('No probe recorded.');
    for (const title of ['Storage integrity', 'Failed renders', 'Renderer facts', 'Package', 'Probes']) {
      expect(card(title)).toHaveTextContent('Source:');
      expect(card(title)).toHaveTextContent('Read at ' + when(READ_AT));
    }
    expect(screen.queryByRole('button', {name: /startup log/i})).toBeNull();
    expect(screen.getByText(/this page can open it only inside the desktop window/)).toBeInTheDocument();
    expect(screen.queryByText(/"storage"/)).not.toBeInTheDocument();
  });

  it('retries a failed render through the service and re-reads', async () => {
    const fetch = vi.fn(async (path, options = {}) => {
      if (path === '/health') return health();
      if (path === '/api/diagnostics') return json(diagnostics());
      if (path === '/api/molecular/renders/' + 'a'.repeat(32) + '/retry') {
        expect(options.method).toBe('POST');
        expect(options.headers.Authorization).toBe('Bearer operator');
        return json({id: 'c'.repeat(32), status: 'queued', filename: 'complex.cif'}, {status: 202});
      }
      throw new Error('unexpected ' + path);
    });
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<DiagnosticsWorkspace token="operator" readiness={null} refreshReadiness={vi.fn()}/>);
    await screen.findByText('single-trust-domain');
    await user.click(screen.getByRole('button', {name: 'Read diagnostics'}));
    const retryButton = () => screen.getAllByRole('button', {name: 'Retry render'}).find(button => !button.disabled);
    await waitFor(() => expect(retryButton()).toBeDefined());
    await user.click(retryButton());
    expect(await screen.findByText('Resubmitted as render cccccccccccc…; open Molecules to follow it.')).toHaveAttribute('role', 'status');
    expect(fetch.mock.calls.filter(([path]) => path === '/api/diagnostics')).toHaveLength(2);
    expect(fetch.mock.calls.filter(([path]) => path.endsWith('/retry'))).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fetch.mockImplementation(async path => {
      if (path === '/health') return health();
      if (path === '/api/diagnostics') return json(diagnostics());
      return json({detail: 'Molecular rendering is unavailable; check server capabilities'}, {status: 409});
    });
    await user.click(retryButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('The service refused it: Molecular rendering is unavailable; check server capabilities');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Request failed (409)');
    expect(screen.queryByText(/Resubmitted as render/)).not.toBeInTheDocument();
  });

  it('copies the redacted report verbatim or shows it to copy by hand', async () => {
    const text = '{\n  "format": "arc-diagnostics-report/1",\n  "health": {"host_session": {"mode": "standalone"}}\n}';
    vi.stubGlobal('fetch', vi.fn(async path => {
      if (path === '/health') return health();
      if (path === '/api/diagnostics/report') return new Response(text, {status: 200, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
      throw new Error('unexpected ' + path);
    }));
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true});
    render(<DiagnosticsWorkspace token="operator" readiness={null} refreshReadiness={vi.fn()}/>);
    await screen.findByText('single-trust-domain');
    const reportToggle = () => screen.queryByRole('button', {name: 'Redacted report'});
    // The report panel keeps the service's text exactly, whitespace included.
    const reportPanel = () => document.getElementById(reportToggle().getAttribute('aria-controls'));
    const reportText = () => reportPanel().querySelector('pre.ar-code').textContent;
    expect(reportToggle()).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Copy redacted report'}));
    expect(await screen.findByText('Copied the redacted report to the clipboard.')).toHaveAttribute('role', 'status');
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(text);
    expect(reportText()).toBe(text);
    expect(reportToggle()).toHaveAttribute('aria-expanded', 'false');

    writeText.mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'));
    await user.click(screen.getByRole('button', {name: 'Copy redacted report'}));
    expect(await screen.findByText('Clipboard unavailable; the report is shown below to copy by hand.')).toHaveAttribute('role', 'status');
    expect(reportToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(reportPanel()).toBeVisible();
    expect(reportText()).toBe(text);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps the new buttons locked without a session', async () => {
    vi.stubGlobal('fetch', vi.fn(async path => path === '/health' ? health() : Promise.reject(new Error('unexpected ' + path))));
    render(<DiagnosticsWorkspace token="" refreshReadiness={vi.fn()}/>);
    await screen.findByText('single-trust-domain');
    expect(screen.getByRole('button', {name: 'Read diagnostics'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Copy redacted report'})).toBeDisabled();
    for (const title of ['Storage integrity', 'Failed renders', 'Renderer facts', 'Package', 'Probes']) {
      expect(card(title)).toHaveAttribute('data-state', 'unknown');
      expect(card(title)).toHaveTextContent('Needs a desktop session or an operator token.');
    }
    const reads = region('Storage, renders and package');
    expect(within(reads).getAllByText('Needs a desktop session or an operator token.').some(note => note.parentElement === reads)).toBe(true);
    expect(screen.queryByRole('button', {name: 'Redacted report'})).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('offers Open startup log only inside the desktop window and asks the host over IPC', async () => {
    const fetch = vi.fn(async path => path === '/health' ? health() : Promise.reject(new Error('unexpected ' + path)));
    vi.stubGlobal('fetch', fetch);
    const postMessage = vi.fn();
    window.ipc = {postMessage};
    try {
      const user = userEvent.setup();
      render(<DiagnosticsWorkspace token={NATIVE_SESSION} readiness={readiness('native')} refreshReadiness={vi.fn(async () => null)}/>);
      await screen.findByText('single-trust-domain');
      expect(screen.queryByText(/this page can open it only inside the desktop window/)).toBeNull();
      await user.click(screen.getByRole('button', {name: 'Open startup log'}));
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage).toHaveBeenCalledWith('{"kind":"open-startup-log"}');
      expect(await screen.findByText('Asked the desktop app to open the startup log.')).toHaveAttribute('role', 'status');
      expect(fetch.mock.calls.filter(([path]) => path === '/api/diagnostics')).toHaveLength(0);
    } finally {
      delete window.ipc;
    }
  });

  it('reads in Russian inside the Russian provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async path => path === '/health' ? health() : Promise.reject(new Error('unexpected ' + path))));
    render(<I18nProvider locale="ru"><DiagnosticsWorkspace token="" refreshReadiness={vi.fn()}/></I18nProvider>);
    await screen.findByText('single-trust-domain');
    expect(screen.getByRole('region', {name: 'Диагностика'})).toBeInTheDocument();
    expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Проверка локальной системы');
    expect(screen.getByRole('status')).toHaveTextContent('Нужен токен оператора');
    expect(screen.getByRole('button', {name: 'Обновить готовность'})).toBeDisabled();
    expect(card('Служба')).toHaveAttribute('data-state', 'ready');
    expect(fact(card('Служба'), 'Режим развёртывания')).toHaveTextContent('single-trust-domain');
    expect(card('Сеанс')).toHaveTextContent('Нет ни сеанса приложения, ни токена оператора.');
    expect(fact(region('Состояние'), 'Модели ролей')).toHaveTextContent('Неизвестно');
    expect(document.body.textContent).not.toMatch(/Refresh|Needs a desktop session/);
  });

  it('names a failed service read in the reader\'s language', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    render(<I18nProvider locale="ru"><DiagnosticsWorkspace token="" refreshReadiness={vi.fn()}/></I18nProvider>);
    await waitFor(() => expect(card('Служба')).toHaveAttribute('data-state', 'failed'));
    expect(fact(card('Служба'), 'Состояние')).toHaveTextContent(/^недоступна$/);
    expect(card('Служба')).not.toHaveTextContent('unavailable');
  });
});
