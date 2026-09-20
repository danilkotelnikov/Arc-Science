import React from 'react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsWorkspace from './SettingsWorkspace';

const revision = 'a'.repeat(64);
const settings = {
  seats: {
    planner: {provider: 'openai', model: 'gpt-5.6', effort: 'medium', auth: 'api_key', credential: 'openai'},
    reviewer: {provider: 'anthropic', model: 'claude-sonnet-5', effort: 'high', auth: 'cli', credential: ''},
    falsifier: {provider: 'gemini', model: 'gemini-3', effort: 'medium', auth: 'api_key', credential: 'gemini'},
    vision: {provider: 'openai', model: 'gpt-5.6-vision', effort: 'low', auth: 'api_key', credential: 'openai'},
    prose: {provider: 'openclaw', model: 'arc-humane-prose-2', effort: 'medium', auth: 'api_key', credential: 'openclaw'}
  },
  providers: {
    anthropic: {endpoint: 'https://api.anthropic.com', cli: 'claude', agent_id: '', isolated: true},
    openai: {endpoint: 'https://api.openai.com', cli: 'codex', agent_id: '', isolated: true},
    gemini: {endpoint: 'https://generativelanguage.googleapis.com', cli: 'gemini', agent_id: '', isolated: true},
    openclaw: {endpoint: 'local://gateway', cli: '', agent_id: 'trusted-gateway', isolated: true}
  },
  mcp_servers: [{name: 'pubmed', transport: 'stdio', command: 'pubmed-mcp', args: ['--stdio'], url: '', consent: true, enabled: true}],
  acp_agents: [{name: 'gemini-acp', command: 'gemini', args: ['--acp'], consent: false, enabled: true}],
  prose: {detection: false},
  blender: {default_preset: 'publication_clean'},
  viewer: {representation: 'cartoon', colouring: 'chain', assembly: 'asymmetric_unit', background: 'white'}
};
const snapshot = {revision, path: 'C:/Arc/settings.toml', read_only: false, settings};
const live = {
  configured: true,
  seats: {
    planner: {provider: 'openai', transport: 'api', model: 'gpt-5.6', effort: 'medium'},
    reviewer: {provider: 'anthropic', transport: 'cli', model: 'claude-sonnet-5', effort: 'high'}
  },
  transports: {anthropic: {transport: 'claude-code', executable: 'claude', version: '5.0.0', logged_in: false, auth_method: 'oauth', identity_reported: false, last_probe: null}}
};
const json = (data, init = {}) => new Response(JSON.stringify(data), {...init, headers: {'Content-Type': 'application/json', ...(init.headers || {})}});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (path, options = {}) => {
    if (path === '/api/settings' && options.method === 'PUT') return json({...snapshot, settings: JSON.parse(options.body).settings, applied_live: ['seats'], stored_pending: [], restart_required: []});
    if (path === '/api/settings') return json(snapshot);
    if (path === '/api/capabilities') return json({live});
    if (path === '/api/mcp/servers/check') return json({sdk: 'mcp-1', consented: ['pubmed'], servers: [{server: 'pubmed', ok: true, tools: [{name: 'search', offered: true}]}]});
    if (path === '/api/acp/agents/check') return json({protocol_version: '1', consented: [], agents: [{agent: 'gemini-acp', ok: false, error: 'not signed in'}]});
    if (path === '/api/providers/anthropic/probe') return json({transport: 'claude-code', results: [{model: 'claude-sonnet-5', effort: 'high', ok: false, error: 'Credit balance is too low'}]});
    throw new Error('Unexpected request ' + path);
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('missing supervisor settings file is actionable and does not show a raw 503', async () => {
  fetch.mockImplementation(async path => path === '/api/settings'
    ? json({detail: 'No settings file is configured for this service'}, {status: 503})
    : json({live: {configured: false}}));
  const user = userEvent.setup();
  render(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Settings are unavailable because no supervisor settings file is configured.');
  expect(screen.getByText('Supervisor Settings Unavailable')).toBeInTheDocument();
  expect(screen.getByRole('alert')).not.toHaveTextContent('Request failed (503)');
  expect(screen.getByText('Load settings to edit seats and connections.')).toBeInTheDocument();
});

test('locked and offline states are concise and separate from raw request text', async () => {
  const user = userEvent.setup();
  const rendered = render(<SettingsWorkspace token="bad-token"/>);
  fetch.mockImplementationOnce(async () => json({detail: 'bad token'}, {status: 401}));
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Operator session is locked or expired.');
  expect(screen.getByRole('alert')).not.toHaveTextContent('Request failed (401)');

  fetch.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
  rendered.rerender(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Arc Science service is offline or unreachable.');
  expect(screen.getByRole('alert')).not.toHaveTextContent('Operator session is locked');
});

test('settings are grouped by user task while advanced controls remain reachable', async () => {
  const user = userEvent.setup();
  render(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  expect(await screen.findByLabelText('Planner model')).toHaveValue('gpt-5.6');
  const settingsRegion = screen.getByRole('region', {name: 'Settings'});
  expect(within(settingsRegion).getByText('Research Models')).toBeVisible();
  expect(within(settingsRegion).getByText('Connections')).toBeVisible();
  expect(within(settingsRegion).getByText('Rendering')).toBeVisible();
  expect(within(settingsRegion).getByText('Viewer')).toBeVisible();
  expect(within(settingsRegion).getByText('Advanced')).toBeVisible();
  await user.click(screen.getByText('Connections'));
  expect(await screen.findByRole('table', {name: 'CLI logins'})).toHaveTextContent('claude-code');
  expect(screen.getByRole('button', {name: 'List MCP tools'})).toBeEnabled();
  expect(screen.getByRole('button', {name: 'Check ACP agents'})).toBeEnabled();
  await user.click(screen.getByText('Rendering'));
  expect(screen.getByLabelText('Blender preset')).toHaveValue('publication_clean');
  await user.click(screen.getByText('Viewer'));
  expect(screen.getByLabelText('Viewer representation')).toHaveValue('cartoon');
  await user.click(screen.getByText('Advanced'));
  expect(screen.getByLabelText('OpenClaw agent id')).toHaveValue('trusted-gateway');
  expect(screen.getByLabelText('Third-party AI detection may run after request-level consent.')).not.toBeChecked();
});

test('research model seats filter effort by transport and flag invalid combinations before save', async () => {
  const invalid = structuredClone(snapshot);
  invalid.settings.seats.planner = {...invalid.settings.seats.planner, provider: 'gemini', auth: 'api_key', effort: 'max'};
  fetch.mockImplementation(async (path, options = {}) => {
    if (path === '/api/settings' && options.method === 'PUT') return json({...invalid, settings: JSON.parse(options.body).settings, applied_live: ['seats'], stored_pending: [], restart_required: []});
    if (path === '/api/settings') return json(invalid);
    if (path === '/api/capabilities') return json({live: {configured: false}});
    throw new Error('Unexpected request ' + path);
  });
  const user = userEvent.setup();
  render(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Planner: Supported here: minimal, low, medium, high.');
  expect(screen.getByRole('button', {name: 'Save'})).toBeDisabled();
  expect(screen.getByLabelText('Planner effort')).toHaveValue('max');
  expect(within(screen.getByLabelText('Planner effort')).queryByRole('option', {name: 'xhigh'})).toBeNull();
  await user.selectOptions(screen.getByLabelText('Planner effort'), 'high');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Save'})).toBeEnabled();
  await user.selectOptions(screen.getByLabelText('Falsifier auth'), 'cli');
  expect(screen.getByLabelText('Falsifier effort')).toHaveValue('medium');
  expect(screen.getByLabelText('Falsifier effort')).toBeDisabled();
  expect(screen.getByText(/Gemini CLI/)).toHaveTextContent('provider default');
});

test('seat readiness reports configured, incomplete and not-probed states without claiming inference works', async () => {
  const user = userEvent.setup();
  render(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  const plannerRow = screen.getByRole('row', {name: /Planner OpenAI/});
  expect(plannerRow).toHaveTextContent('configured');
  expect(plannerRow).toHaveTextContent('API credential is configured; no live inference was run.');
  const reviewerRow = screen.getByRole('row', {name: /Reviewer \(QA\) Anthropic/});
  expect(reviewerRow).toHaveTextContent('not signed in');
  expect(reviewerRow).not.toHaveTextContent('probed');
  await user.clear(screen.getByLabelText('Vision credential'));
  const visionRow = screen.getByRole('row', {name: /Vision OpenAI/});
  expect(visionRow).toHaveTextContent('incomplete');
  expect(visionRow).toHaveTextContent('Credential file name is required.');
});

test('MCP and ACP editors keep consented checks visible after edits', async () => {
  const user = userEvent.setup();
  render(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  await user.click(screen.getByText('Connections'));
  await user.clear(screen.getByLabelText('mcp name 1'));
  await user.type(screen.getByLabelText('mcp name 1'), 'local-pubmed');
  await user.clear(screen.getByLabelText('mcp args 1'));
  await user.type(screen.getByLabelText('mcp args 1'), '--stdio --safe');
  await user.click(screen.getByRole('button', {name: 'List MCP tools'}));
  expect(await screen.findByLabelText('MCP servers checked')).toHaveTextContent('pubmed');
  expect(screen.getByLabelText('mcp name 1')).toHaveValue('local-pubmed');
  await user.click(screen.getByRole('button', {name: 'Check ACP agents'}));
  expect(await screen.findByLabelText('ACP agents checked')).toHaveTextContent('not signed in');
  await user.click(screen.getByRole('button', {name: 'Add ACP agent'}));
  expect(screen.getByLabelText('acp name 2')).toHaveValue('');
});

test('CLI probes require consent and report failed reachability without marking identity verified', async () => {
  const user = userEvent.setup();
  render(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  await user.click(screen.getByText('Connections'));
  expect(screen.getByRole('button', {name: 'Probe anthropic'})).toBeDisabled();
  await user.click(screen.getByLabelText(/I accept that a probe spends tokens/));
  await user.click(screen.getByRole('button', {name: 'Probe anthropic'}));
  expect(await screen.findByRole('table', {name: 'CLI logins'})).toHaveTextContent('failed - Credit balance is too low');
  const probeCall = fetch.mock.calls.find(([path]) => path === '/api/providers/anthropic/probe');
  expect(JSON.parse(probeCall[1].body)).toEqual({spend_tokens: true});
});

test('failed save preserves unsaved edits and the loaded revision', async () => {
  const user = userEvent.setup();
  render(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  await user.clear(await screen.findByLabelText('Planner model'));
  await user.type(screen.getByLabelText('Planner model'), 'gpt-unsaved');
  fetch.mockImplementationOnce(async () => json({detail: 'Settings revision changed'}, {status: 409}));
  await user.click(screen.getByRole('button', {name: 'Save'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Settings changed elsewhere. Your unsaved edits were kept.');
  expect(screen.getByLabelText('Planner model')).toHaveValue('gpt-unsaved');
  expect(screen.getByText(/Revision aaaaaaaaaaaa/)).toBeInTheDocument();
  expect(screen.getByRole('alert')).not.toHaveTextContent('Request failed (409)');
});
