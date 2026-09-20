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
      : json({live: {configured: false}, vision: {configured: false}, connectors: {}})));
    const user = userEvent.setup();
    render(<DiagnosticsWorkspace token={NATIVE_SESSION}/>);
    expect(await screen.findByText(/Desktop session ready. Authenticated diagnostics/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Load capabilities'}));
    expect(fetch.mock.calls.find(([path]) => path === '/api/capabilities')[1].headers.Authorization).toBeUndefined();
  });
  const card = title => screen.getByRole('heading', {name: title}).closest('article');

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
    expect(screen.getByText(/arc-science token --data <project directory>/)).toBeInTheDocument();
    expect(screen.getByText(/owner-only access.token/)).toBeInTheDocument();
    expect(screen.getByText(/paste it in the shared header/)).toBeInTheDocument();
    expect(screen.queryByText(/desktop unlock action|diagnostic console/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Research'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Settings'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Refresh service'})).toBeEnabled();
    expect(screen.getByRole('button', {name: 'Load capabilities'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Check MCP'})).toBeDisabled();
    expect(screen.getByText(/This public check does not prove token validity/)).toBeInTheDocument();
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
      throw new Error('unexpected ' + path);
    });
    vi.stubGlobal('fetch', fetch);

    const user = userEvent.setup();
    render(<DiagnosticsWorkspace token="operator" onNavigateResearch={vi.fn()} onNavigateSettings={vi.fn()}/>);

    await screen.findByText('single-trust-domain');
    expect(screen.getByText(/Load operator capabilities/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Load capabilities'}));

    await screen.findByText('anthropic · claude-sonnet-5');
    expect(screen.getByText('openai · gpt-5.6-vision')).toBeInTheDocument();
    expect(screen.getByText('SDK: 1.2.3')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
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
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Operator session is locked');
    expect(screen.queryByText(/do not show/)).not.toBeInTheDocument();
    expect(card('Model seats')).toHaveAttribute('data-state', 'locked');
    expect(card('Model seats')).toHaveTextContent('Operator session is locked');
    expect(card('Session')).toHaveAttribute('data-state', 'locked');
    expect(card('Session')).toHaveTextContent('current operator token was rejected');
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
    expect(card('MCP servers')).toHaveAttribute('data-state', 'unavailable');
    expect(within(card('MCP servers')).getByText(/Connection checks are unavailable/)).toBeInTheDocument();
    expect(card('Session')).toHaveAttribute('data-state', 'unavailable');
    expect(card('Session')).toHaveTextContent('authenticated diagnostic route is unavailable');
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
    expect(screen.getByRole('alert')).toHaveTextContent('offline or unreachable');
    await waitFor(() => expect(screen.getByText('unavailable')).toBeInTheDocument());
    expect(screen.queryByText('single-trust-domain')).not.toBeInTheDocument();
  });
});
