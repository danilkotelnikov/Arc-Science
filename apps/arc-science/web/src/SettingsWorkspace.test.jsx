import React from 'react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsWorkspace from './SettingsWorkspace';

const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});
const seat = (over = {}) => ({provider: '', model: '', effort: 'medium', auth: 'api_key', credential: '', ...over});
const provider = (endpoint, cli) => ({endpoint, cli, agent_id: '', isolated: false});
const settings = () => ({schema_version: 1,
  seats: {planner: seat(), reviewer: seat(), falsifier: seat(), vision: seat(), prose: seat()},
  providers: {anthropic: provider('https://api.anthropic.com/v1/messages', 'claude'), openai: provider('https://api.openai.com/v1/responses', 'codex'),
    gemini: provider('https://generativelanguage.googleapis.com/v1beta', 'gemini'), openclaw: {endpoint: '', cli: '', agent_id: '', isolated: true}},
  mcp_servers: [], acp_agents: [], prose: {detection: true}, blender: {default_preset: 'publication_white'},
  viewer: {representation: 'cartoon', colouring: 'chain', assembly: 'asymmetric_unit', background: 'white'}});
let calls, stored, revision, live;

beforeEach(() => {
  calls = []; stored = settings(); revision = 'a'.repeat(64); live = {configured: false};
  vi.stubGlobal('fetch', vi.fn(async (path, options = {}) => {
    calls.push({path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, auth: options.headers?.Authorization});
    if (path === '/api/capabilities') return json({live});
    if (path === '/api/mcp/servers/check' && options.method === 'POST') return json({sdk: '1.27.0', consented: ['pubmed'], servers: [
      {server: 'pubmed', ok: true, tools: [{name: 'search_articles', offered: true, as: 'mcp_pubmed_search_articles'}, {name: 'nested', offered: false, reason: 'schema uses $ref, which the catalogue cannot represent'}]},
      {server: 'arxiv', ok: false, error: 'McpError: Connection closed', tools: []}]});
    if (path === '/api/acp/agents/check' && options.method === 'POST') return json({protocol_version: 1, consented: [], agents: [
      {agent: 'gemini', ok: true, protocol_version: 1, agent_info: {name: 'gemini-cli', version: '0.56.0'}, capabilities: {}, auth_methods: ['oauth-personal', 'gemini-api-key']}]});
    if (path === '/api/providers/openai/probe' && options.method === 'POST') return json({transport: 'codex', provider: 'openai', results: [{model: 'gpt-5.5', effort: 'xhigh', roles: ['planner'], ok: true, observed_model: null, identity_verified: false}]});
    if (path === '/api/settings' && (options.method || 'GET') === 'GET') return json({settings: stored, revision, path: 'C:/ws/settings.toml', applied_live: ['seats'], restart_required: []});
    if (path === '/api/settings' && options.method === 'PUT') {
      const body = JSON.parse(options.body);
      if (body.if_revision !== revision) return json({detail: 'Settings changed since they were read; reload and try again'}, 409);
      if (body.settings.seats.planner.provider && !body.settings.seats.planner.model) return json({detail: 'seats.planner.model must name one model when a provider is set'}, 422);
      stored = body.settings; revision = 'b'.repeat(64);
      return json({settings: stored, revision, path: 'C:/ws/settings.toml', applied_live: ['seats', 'seats.effort', 'providers'], stored_pending: ['mcp_servers'], restart_required: []});
    }
    throw new Error('Unexpected ' + path);
  }));
});
afterEach(() => vi.unstubAllGlobals());

test('settings load with the token, edit locally, and save with the revision that was read', async () => {
  const user = userEvent.setup(); render(<SettingsWorkspace token="operator"/>);
  expect(screen.getByRole('button', {name: 'Save'})).toBeDisabled();
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  const table = await screen.findByRole('table', {name: ''}).catch(() => null);
  const planner = await screen.findByLabelText('Planner provider');
  await user.selectOptions(planner, 'openai');
  await user.type(screen.getByLabelText('Planner model'), 'gpt-5.6');
  await user.selectOptions(screen.getByLabelText('Planner effort'), 'high');
  await user.selectOptions(screen.getByLabelText('Falsifier auth'), 'cli');
  expect(screen.getByLabelText('Falsifier credential')).toBeDisabled();
  expect(screen.getByRole('button', {name: 'Save'})).toBeEnabled();
  await user.click(screen.getByRole('button', {name: 'Save'}));
  expect(await screen.findByRole('status')).toHaveTextContent('Saved. Applied live: seats, seats.effort, providers. Stored for later loops: mcp_servers.');
  const put = calls.find(c => c.method === 'PUT');
  expect(put.auth).toBe('Bearer operator');
  expect(put.body.if_revision).toBe('a'.repeat(64));
  expect(put.body.settings.seats.planner).toEqual({provider: 'openai', model: 'gpt-5.6', effort: 'high', auth: 'api_key', credential: ''});
  expect(put.body.settings.seats.falsifier.auth).toBe('cli');
  expect(screen.getByText(/Revision/)).toHaveTextContent('bbbbbbbbbbbb');
  expect(screen.getByRole('button', {name: 'Save'})).toBeDisabled();
  expect(table).toBeNull();
});

test('a stale revision and an owner rejection are shown as they are, and nothing is lost', async () => {
  const user = userEvent.setup(); render(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  await user.selectOptions(await screen.findByLabelText('Planner provider'), 'anthropic');
  revision = 'c'.repeat(64); // someone else saved meanwhile
  await user.click(screen.getByRole('button', {name: 'Save'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Settings changed since they were read; reload and try again');
  expect(screen.getByLabelText('Planner provider')).toHaveValue('anthropic');
  await user.click(screen.getByRole('button', {name: 'Reload'}));
  await user.selectOptions(await screen.findByLabelText('Planner provider'), 'anthropic');
  await user.click(screen.getByRole('button', {name: 'Save'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('seats.planner.model must name one model');
});

test('connections show each CLI login without spending, and a probe needs consent per click', async () => {
  live = {configured: true, planner: 'gpt-5.5', reviewer: 'claude-sonnet-5', provider: 'openai', auth: 'cli',
    seats: {planner: {provider: 'openai', transport: 'cli', model: 'gpt-5.5', effort: 'xhigh'}, reviewer: {provider: 'anthropic', transport: 'api', model: 'claude-sonnet-5', effort: 'high'}, falsifier: {provider: 'anthropic', transport: 'api', model: 'claude-sonnet-5', effort: 'high'}},
    transports: {openai: {transport: 'codex', executable: 'codex.CMD', version: 'codex-cli 0.149.1', logged_in: true, auth_method: 'chatgpt', identity_reported: false, last_probe: null}}};
  const user = userEvent.setup(); render(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  const logins = within(await screen.findByRole('table', {name: 'CLI logins'}));
  expect(logins.getByText('signed in (chatgpt)')).toBeInTheDocument();
  expect(logins.getByText('no: requested-only')).toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Probe openai'})).toBeDisabled();
  await user.click(screen.getByLabelText(/I accept that a probe spends tokens/));
  await user.click(screen.getByRole('button', {name: 'Probe openai'}));
  expect(await logins.findByText('gpt-5.5/xhigh: reachable, schema-valid, identity unverified')).toBeInTheDocument();
  const probe = calls.find(c => c.path === '/api/providers/openai/probe');
  expect(probe.method).toBe('POST'); expect(probe.body).toEqual({spend_tokens: true}); expect(probe.auth).toBe('Bearer operator');
  expect(calls.filter(c => c.path === '/api/providers/openai/probe')).toHaveLength(1);
});

test('MCP servers and ACP agents are edited as rows', async () => {
  const user = userEvent.setup(); render(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  await user.click(await screen.findByRole('button', {name: 'Add MCP server'}));
  await user.type(screen.getByLabelText('mcp name 1'), 'tools');
  await user.selectOptions(screen.getByLabelText('mcp transport 1'), 'http');
  await user.type(screen.getByLabelText('mcp url 1'), 'http://127.0.0.1:9000/mcp');
  await user.click(screen.getByLabelText('missions may send data to it'));
  await user.click(screen.getByRole('button', {name: 'Add ACP agent'}));
  await user.type(screen.getByLabelText('acp name 1'), 'gemini');
  await user.type(screen.getByLabelText('acp command 1'), 'gemini');
  await user.type(screen.getByLabelText('acp args 1'), '--acp');
  await user.click(screen.getByRole('button', {name: 'Save'}));
  await screen.findByRole('status');
  const put = calls.find(c => c.method === 'PUT');
  expect(put.body.settings.mcp_servers).toEqual([{name: 'tools', transport: 'http', command: '', args: [], url: 'http://127.0.0.1:9000/mcp', consent: true, enabled: true}]);
  expect(put.body.settings.acp_agents).toEqual([{name: 'gemini', command: 'gemini', args: ['--acp'], consent: false, enabled: true}]);
});

test('connection checks list MCP tools and ACP agents as the service reports them', async () => {
  const user = userEvent.setup(); render(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  await user.click(await screen.findByRole('button', {name: 'List MCP tools'}));
  const mcp = within(await screen.findByLabelText('MCP servers checked'));
  expect(mcp.getByText(/SDK 1\.27\.0/)).toBeInTheDocument();
  expect(mcp.getByText(/search_articles, nested \(not offered: schema uses \$ref/)).toBeInTheDocument();
  expect(mcp.getByText(/failed — McpError: Connection closed/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', {name: 'Check ACP agents'}));
  const acp = within(await screen.findByLabelText('ACP agents checked'));
  expect(acp.getByText(/gemini-cli 0\.56\.0 · auth: oauth-personal, gemini-api-key/)).toBeInTheDocument();
  expect(calls.filter(c => c.path === '/api/mcp/servers/check' || c.path === '/api/acp/agents/check').every(c => c.method === 'POST' && c.auth === 'Bearer operator')).toBe(true);
});
