import React from 'react';
import {describe, expect, it, vi, afterEach} from 'vitest';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DiagnosticsWorkspace from './DiagnosticsWorkspace';
import {NATIVE_SESSION} from './http';

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {status: init.status || 200, headers: {'Content-Type': 'application/json'}});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DiagnosticsWorkspace', () => {
  it('describes a native desktop session without pretending an operator token was typed', async () => {
    vi.stubGlobal('fetch', vi.fn(async path => path === '/health'
      ? json({status: 'ready', deployment: 'single-trust-domain'})
      : path === '/api/memory/health' ? json({protocol: 'arc-memory/1', sqlite: '3.53.2'})
        : json({live: {configured: false}, vision: {configured: false}, connectors: {}})));
    const user = userEvent.setup();
    render(<DiagnosticsWorkspace token={NATIVE_SESSION}/>);
    expect(await screen.findByText(/Desktop session present, not yet verified/)).toBeInTheDocument();
    expect(card('Operator session')).toHaveAttribute('data-state', 'unchecked');
    await user.click(screen.getByRole('button', {name: 'Load capabilities'}));
    expect(fetch.mock.calls.find(([path]) => path === '/api/capabilities')[1].headers.Authorization).toBeUndefined();
    expect(await screen.findByText('Desktop session verified by an authenticated check.')).toBeInTheDocument();
    expect(card('Operator session')).toHaveAttribute('data-state', 'ok');
    expect(card('Vision')).toHaveAttribute('data-state', 'unconfigured');
  });
  const card = title => screen.getByRole('heading', {name: title, level: 3}).closest('article');

  it('loads only public service health on mount and keeps authenticated checks locked without a token', async () => {
    const fetch = vi.fn(async path => {
      if (path === '/health') return json({status: 'ready', version: '0.6.0', deployment: 'single-trust-domain'});
      throw new Error('unexpected ' + path);
    });
    vi.stubGlobal('fetch', fetch);

    render(<DiagnosticsWorkspace token="" onNavigateResearch={vi.fn()} onNavigateSettings={vi.fn()}/>);

    await screen.findByText('single-trust-domain');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/health', expect.objectContaining({signal: expect.any(AbortSignal)}));
    expect(screen.getByRole('status')).toHaveTextContent('Operator token required');
    expect(screen.getByText(/arc-science token --data <data directory>/)).toBeInTheDocument();
    expect(screen.getByText(/owner-only file/)).toBeInTheDocument();
    expect(screen.getByText(/Paste your operator token in the header/)).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Go to token field'})).toBeInTheDocument();
    expect(screen.queryByText(/desktop unlock action|diagnostic console/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Research'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Settings'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Refresh service'})).toBeEnabled();
    expect(screen.getByRole('button', {name: 'Load capabilities'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Check MCP'})).toBeDisabled();
    expect(screen.getByText('Disabled until the header holds an operator token.')).toBeInTheDocument();
    expect(screen.getByText(/This public check does not prove token validity/)).toBeInTheDocument();
    expect(card('Operator session')).toHaveTextContent('No operator token, so authenticated checks are disabled.');
  });

  it('loads capability summaries only after explicit operator action', async () => {
    const fetch = vi.fn(async (path, options = {}) => {
      if (path === '/health') return json({status: 'ready', version: '0.6.0', deployment: 'single-trust-domain'});
      if (path === '/api/capabilities') {
        expect(options.headers.Authorization).toBe('Bearer operator');
        return json({
          live: {configured: true, auth: 'cli', seats: {
            planner: {provider: 'anthropic', model: 'claude-sonnet-5'},
            reviewer: {provider: 'openai', model: 'gpt-5.6'},
            falsifier: {provider: 'gemini', model: 'gemini-3'},
          }},
          vision: {configured: true, provider: 'openai', model: 'gpt-5.6-vision'},
          connectors: {mcp: {configured: 2, consented: 1, sdk: '1.2.3'}, acp: {configured: 1, consented: 1}},
        });
      }
      if (path === '/api/memory/health') {
        expect(options.headers.Authorization).toBe('Bearer operator');
        return json({protocol: 'arc-memory/1', sqlite: '3.53.2', retrieval_modes: ['lexical']});
      }
      throw new Error('unexpected ' + path);
    });
    vi.stubGlobal('fetch', fetch);

    const user = userEvent.setup();
    render(<DiagnosticsWorkspace token="operator" onNavigateResearch={vi.fn()} onNavigateSettings={vi.fn()}/>);

    await screen.findByText('single-trust-domain');
    expect(screen.getByText('Loads after you paste a token and press Load capabilities.')).toBeInTheDocument();
    expect(screen.getByText(/Operator token present, not yet verified/)).toBeInTheDocument();
    expect(screen.getByText('not loaded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Load capabilities'}));

    await screen.findByText('anthropic · claude-sonnet-5');
    expect(screen.getByText('openai · gpt-5.6-vision')).toBeInTheDocument();
    expect(screen.getByText('SDK: 1.2.3')).toBeInTheDocument();
    expect(screen.getByText('Planner sign-in')).toBeInTheDocument();
    expect(screen.getByText('CLI login')).toBeInTheDocument();
    expect(screen.getByText('Memory engine')).toBeInTheDocument();
    expect(screen.getByText('arc-memory/1 · SQLite 3.53.2')).toBeInTheDocument();
    expect(screen.queryByText('not loaded')).not.toBeInTheDocument();
    expect(card('Operator session')).toHaveAttribute('data-state', 'ok');
    expect(card('Operator session')).toHaveTextContent('Operator token accepted by an authenticated check.');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps capabilities and reports a missing memory worker beside Load capabilities', async () => {
    vi.stubGlobal('fetch', vi.fn(async path => {
      if (path === '/health') return json({status: 'ready', version: '0.6.0', deployment: 'single-trust-domain'});
      if (path === '/api/capabilities') return json({live: {configured: false}, vision: {configured: false}, connectors: {}});
      if (path === '/api/memory/health') return json({protocol: null, sqlite: null, detail: 'Native memory worker is not configured'}, {status: 503});
      throw new Error('unexpected ' + path);
    }));
    const user = userEvent.setup();
    render(<DiagnosticsWorkspace token="operator"/>);
    await user.click(await screen.findByRole('button', {name: 'Load capabilities'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('The memory engine is unavailable in this local service: Native memory worker is not configured. Fix that, then retry.');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/503|missing its settings/);
    expect(within(screen.getByRole('complementary')).getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('not loaded')).toBeInTheDocument();
    expect(card('Model seats')).toHaveAttribute('data-state', 'unconfigured');
    expect(card('Operator session')).toHaveAttribute('data-state', 'ok');
  });

  it('runs MCP and ACP checks explicitly and labels unavailable rows without raw JSON', async () => {
    const fetch = vi.fn(async (path, options = {}) => {
      if (path === '/health') return json({status: 'ready', version: '0.6.0', deployment: 'single-trust-domain'});
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
    render(<DiagnosticsWorkspace token="operator" onNavigateResearch={vi.fn()} onNavigateSettings={vi.fn()}/>);

    await user.click(await screen.findByRole('button', {name: 'Check MCP'}));
    await screen.findByText('mcp_fake_echo');
    expect(screen.getByText('Unavailable: command missing')).toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Check ACP'}));
    await screen.findByText('fake-acp · 0.1');
    expect(screen.queryByText(/"servers"/)).not.toBeInTheDocument();
  });

  it('turns authenticated 401s into a friendly recovery message', async () => {
    vi.stubGlobal('fetch', vi.fn(async path => {
      if (path === '/health') return json({status: 'ready', version: '0.6.0', deployment: 'single-trust-domain'});
      return json({detail: {raw: 'do not show'}}, {status: 401});
    }));

    const user = userEvent.setup();
    render(<DiagnosticsWorkspace token="expired" onNavigateResearch={vi.fn()} onNavigateSettings={vi.fn()}/>);

    await user.click(await screen.findByRole('button', {name: 'Load capabilities'}));
    // The shared LockNotice states the rejection once (tone error, role status); no second alert repeats it.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Token not accepted'));
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'error');
    expect(within(screen.getByRole('status')).getByRole('button', {name: 'Go to token field'})).toBeInTheDocument();
    expect(screen.getAllByText(/Token not accepted/)).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/do not show/)).not.toBeInTheDocument();
    expect(card('Operator capabilities')).toHaveAttribute('data-state', 'locked');
    expect(card('Operator capabilities')).toHaveTextContent('Unlocks when the header holds an accepted operator token.');
    expect(card('Operator session')).toHaveAttribute('data-state', 'locked');
    expect(card('Operator session')).toHaveTextContent('current operator token was rejected');
  });

  it('maps an unreadable service response to plain text instead of the parser message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', {status: 200, headers: {'Content-Type': 'text/html'}})));
    render(<DiagnosticsWorkspace token=""/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('The service returned an unreadable response. Retry.');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/Unexpected token|JSON/);
    expect(card('Service')).toHaveAttribute('data-state', 'unavailable');
  });

  it('explains an unavailable settings service without displaying raw HTTP detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async path => path === '/health'
      ? json({status: 'ready', deployment: 'single-trust-domain'})
      : json({detail: 'Settings are not available to this service'}, {status: 503})));
    const user = userEvent.setup();
    render(<DiagnosticsWorkspace token="operator" onNavigateResearch={vi.fn()} onNavigateSettings={vi.fn()}/>);
    await user.click(await screen.findByRole('button', {name: 'Check MCP'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection checks are unavailable in this local service');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Request failed (503)');
    expect(within(screen.getByRole('region', {name: 'Diagnostics'})).getByRole('alert')).toBeInTheDocument();
    expect(card('MCP servers')).toHaveAttribute('data-state', 'unavailable');
    expect(within(card('MCP servers')).getByText(/missing its settings or the MCP package/)).toBeInTheDocument();
    expect(card('Operator session')).toHaveAttribute('data-state', 'unavailable');
    expect(card('Operator session')).toHaveTextContent('authenticated check is unavailable');
  });

  it('marks service unavailable after a refresh failure instead of keeping stale ready state', async () => {
    let healthCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async path => {
      if (path === '/health') {
        healthCalls += 1;
        if (healthCalls === 1) return json({status: 'ready', version: '0.6.0', deployment: 'single-trust-domain'});
        throw new TypeError('Failed to fetch');
      }
      throw new Error('unexpected ' + path);
    }));

    const user = userEvent.setup();
    render(<DiagnosticsWorkspace token="" onNavigateResearch={vi.fn()} onNavigateSettings={vi.fn()}/>);

    await screen.findByText('single-trust-domain');
    await user.click(screen.getByRole('button', {name: 'Refresh service'}));

    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Arc Science is not reachable. Start the local service, then retry.');
    await waitFor(() => expect(screen.getByText('unavailable')).toBeInTheDocument());
    expect(card('Service')).toHaveTextContent('The last refresh failed. See the message beside Refresh service.');
    expect(screen.queryByText('single-trust-domain')).not.toBeInTheDocument();
  });
});
