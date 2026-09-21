import React from 'react';
import {describe, expect, it, vi, afterEach} from 'vitest';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DiagnosticsWorkspace from './DiagnosticsWorkspace';
import {NATIVE_SESSION} from './http';

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {status: init.status || 200, headers: {'Content-Type': 'application/json'}});
}
const health = () => json({status: 'ready', version: '0.6.0', deployment: 'single-trust-domain'});
const seat = (role, label, state, code, meaning, next_action = null) => ({role, label, state, code, facts: {}, verification: {status: 'not_tested'}, meaning, next_action, source: 'settings revision abcdef123456'});
const ROLES = [{role: 'planner', label: 'Planner', purpose: 'proposes branches and actions'}, {role: 'reviewer', label: 'Reviewer (QA)', purpose: 'assesses'}, {role: 'falsifier', label: 'Falsifier', purpose: 'assesses with the brief to refute'}, {role: 'vision', label: 'Vision', purpose: 'reviews images'}, {role: 'prose', label: 'Prose', purpose: 'edits text'}];
const readiness = (kind = 'token') => ({
  checked_at: 1_700_000_000,
  session: {kind, state: 'ready', code: 'session.' + kind, label: kind === 'native' ? 'Desktop session' : 'Operator token', meaning: kind === 'native' ? 'The desktop shell signed this request.' : 'The bearer token was accepted.', next_action: null, source: 'request header'},
  settings: {state: 'ready', code: 'settings.available', revision: 'abcdef1234567890', path: 'C:/data/settings.json', read_only: false, meaning: 'Settings can be read and saved.', next_action: null, source: 'supervisor'},
  roles: ROLES,
  seats: {
    planner: seat('planner', 'Planner', 'ready', 'seat.verified', 'Verified against the configured model.'),
    reviewer: seat('reviewer', 'Reviewer (QA)', 'not_tested', 'seat.inherits', 'Inherits the planner seat.', 'Run the probe in Settings to verify it.'),
    falsifier: seat('falsifier', 'Falsifier', 'failed', 'seat.probe_failed', 'The last probe failed.', 'Fix the credential, then probe again in Settings.'),
    vision: seat('vision', 'Vision', 'blocked', 'seat.unconfigured', 'Visual review is unavailable until a vision seat is set', 'Set a vision seat in Settings.'),
    prose: seat('prose', 'Prose', 'blocked', 'seat.unconfigured', 'Prose edits through a model are unavailable; the local rewrite still works', 'Set a prose seat in Settings.'),
  },
  live_mission: {state: 'failed', code: 'live.failed', blocking: ['falsifier'], meaning: 'A live mission would fail on the falsifier seat.', next_action: 'Repair the falsifier seat, then probe it.'},
  connectors: {mcp: [{name: 'fake', transport: 'stdio', enabled: true, consented: true, state: 'not_tested', code: 'connector.eligible', meaning: 'Enabled and consented.', next_action: 'Check MCP below reaches it.'}], acp: [{name: 'agent', enabled: true, consented: false, state: 'blocked', code: 'connector.not_consented', meaning: 'Enabled but not consented.', next_action: 'Consent in Settings.'}], mcp_sdk: '1.2.3', acp_protocol: '1', state: 'not_tested', code: 'connectors.eligible', meaning: '1 of 2 connectors can be bound by a live mission; none is checked here', next_action: 'Run the connection checks in Diagnostics'},
  renderer: {state: 'not_tested', code: 'renderer.configured', facts: {configured: true, exists: true, default_preset: 'default'}, meaning: 'Blender is configured.', next_action: 'Submit a render in Molecules to test it.', source: 'settings'},
  memory: {state: 'ready', code: 'memory.available', facts: {protocol: 'arc-memory/1', sqlite: '3.53.2'}, meaning: 'The memory engine answers.', next_action: null},
  storage: {state: 'not_tested', code: 'storage.present', facts: {missions_db: true, missions: 3}, meaning: 'The missions database is present.', next_action: 'Integrity is checked on demand in Diagnostics (not in this build).'},
  catalog: {},
  public_reads: {enabled: false},
});
const card = title => screen.getByRole('heading', {name: title, level: 3}).closest('article');

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

    expect(card('Session')).toHaveAttribute('data-state', 'ready');
    expect(card('Session')).toHaveTextContent('Desktop session');
    expect(card('Session')).toHaveTextContent('The desktop shell signed this request.');
    expect(card('Settings')).toHaveAttribute('data-state', 'ready');
    expect(card('Settings')).toHaveTextContent('abcdef123456');
    expect(card('Settings')).not.toHaveTextContent('abcdef1234567890');
    expect(card('Settings')).toHaveTextContent('C:/data/settings.json');

    const seats = within(screen.getByRole('table', {name: 'Seat readiness'})).getAllByRole('row');
    expect(seats).toHaveLength(5);
    expect(seats[0]).toHaveTextContent('Planner');
    expect(seats[0]).toHaveTextContent('Ready');
    expect(seats[0]).not.toHaveTextContent('Next:');
    expect(seats[1]).toHaveAttribute('data-state', 'not_tested');
    expect(seats[1]).toHaveTextContent('Reviewer (QA)Not tested Inherits the planner seat. Next: Run the probe in Settings to verify it.');
    expect(seats[2]).toHaveAttribute('data-state', 'failed');
    expect(seats[2]).toHaveTextContent('Failed');
    expect(seats[3]).toHaveTextContent('Vision');
    expect(seats[3]).toHaveTextContent('Blocked');
    expect(seats[3]).toHaveTextContent('Visual review is unavailable until a vision seat is set');
    expect(seats[3]).toHaveTextContent('Next: Set a vision seat in Settings.');
    expect(card('Seats')).toHaveAttribute('data-state', 'failed');
    expect(card('Seats')).toHaveTextContent('Next: Repair the falsifier seat, then probe it.');
    await user.click(within(card('Seats')).getByRole('button', {name: 'Open Settings'}));
    expect(onNavigate).toHaveBeenCalledWith('settings');

    expect(card('Connectors')).toHaveAttribute('data-state', 'not_tested');
    expect(card('Connectors')).toHaveTextContent('1 of 2 connectors can be bound');
    const connectors = within(screen.getByRole('table', {name: 'Connector readiness'})).getAllByRole('row');
    expect(connectors[0]).toHaveTextContent('MCP · fake');
    expect(connectors[0]).toHaveTextContent('Not tested');
    expect(connectors[1]).toHaveTextContent('ACP · agentBlocked Enabled but not consented. Next: Consent in Settings.');
    expect(card('Connectors')).toHaveTextContent('MCP SDK: 1.2.3 · ACP protocol: 1');
    expect(card('Renderer')).toHaveAttribute('data-state', 'not_tested');
    expect(card('Renderer')).toHaveTextContent('Next: Submit a render in Molecules to test it.');
    expect(card('Memory')).toHaveAttribute('data-state', 'ready');
    expect(card('Memory')).toHaveTextContent('arc-memory/1');
    expect(card('Storage')).toHaveAttribute('data-state', 'not_tested');
    expect(within(card('Storage')).getByText('3')).toBeInTheDocument();
    expect(card('Storage')).toHaveTextContent('Integrity is checked on demand');
    expect(screen.getByText('arc-memory/1 · SQLite 3.53.2')).toBeInTheDocument();
    expect(screen.queryByText('not loaded')).not.toBeInTheDocument();
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
    expect(screen.getByRole('button', {name: 'Check MCP'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Check ACP'})).toBeDisabled();
    // The reason sits beside both disabled button groups and in each unread card.
    expect(within(screen.getByRole('complementary')).getByText('Needs a desktop session or an operator token.')).toBeInTheDocument();
    expect(screen.queryByText(/Operator checks need a token|Load capabilities/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/paste/i);
    expect(card('Service')).toHaveAttribute('data-state', 'ready');
    expect(card('Session')).toHaveAttribute('data-state', 'blocked');
    expect(card('Session')).toHaveTextContent('No desktop session and no operator token.');
    expect(card('Session')).toHaveTextContent('Next: Unlock in the header.');
    for (const title of ['Settings', 'Seats', 'Connectors', 'Renderer', 'Memory', 'Storage']) {
      expect(card(title)).toHaveAttribute('data-state', 'unknown');
      expect(card(title)).toHaveTextContent('Needs a desktop session or an operator token.');
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
    rerender(<DiagnosticsWorkspace token="operator" readiness={current} refreshReadiness={refreshReadiness}/>);
    expect(card('Session')).toHaveAttribute('data-state', 'ready');
    expect(card('Session')).toHaveTextContent('Operator token');
    expect(card('Session')).toHaveTextContent('The bearer token was accepted.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/paste/i);
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
    expect(within(screen.getByRole('complementary')).getByRole('alert')).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', {name: 'Check ACP'}));
    await screen.findByText('fake-acp · 0.1');
    expect(card('ACP agents')).toHaveAttribute('data-state', 'ready');
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
    expect(within(screen.getByRole('region', {name: 'Diagnostics'})).getByRole('alert')).toBeInTheDocument();
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
    expect(screen.queryByText('single-trust-domain')).not.toBeInTheDocument();
  });
});
