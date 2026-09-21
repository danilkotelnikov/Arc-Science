import React from 'react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsWorkspace from './SettingsWorkspace';
import {NATIVE_SESSION, SESSION_COPY} from './http';

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
  expect(await screen.findByRole('alert')).toHaveTextContent('No settings file was given to this service.');
  expect(screen.getByText('Settings file not configured')).toBeInTheDocument();
  expect(screen.getByRole('alert')).not.toHaveTextContent('Request failed (503)');
  expect(screen.getByText(/Load settings to edit seats/)).toBeInTheDocument();
});

test('locked and offline states are concise and separate from raw request text', async () => {
  const user = userEvent.setup();
  const rendered = render(<SettingsWorkspace token="bad-token"/>);
  fetch.mockImplementationOnce(async () => json({detail: 'bad token'}, {status: 401}));
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  // A rejected token is the one lock notice in the error tone: no alert with the same words.
  const lock = (await screen.findByText(SESSION_COPY.expired.title)).closest('.unlock-card');
  expect(lock).toHaveClass('error');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent('Request failed (401)');
  expect(within(lock).getByRole('button', {name: 'Go to token field'})).toBeInTheDocument();

  fetch.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
  rendered.rerender(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(SESSION_COPY.offline.title);
  expect(screen.getByRole('alert')).not.toHaveTextContent(SESSION_COPY.expired.title);
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
  expect(screen.getByRole('button', {name: 'Check MCP servers'})).toBeEnabled();
  expect(screen.getByRole('button', {name: 'Check ACP agents'})).toBeEnabled();
  await user.click(screen.getByText('Rendering'));
  expect(screen.getByLabelText('Blender preset')).toHaveValue('publication_clean');
  await user.click(screen.getByText('Viewer'));
  expect(screen.getByLabelText('Viewer representation')).toHaveValue('cartoon');
  await user.click(screen.getByText('Advanced'));
  expect(screen.getByLabelText('OpenClaw agent id')).toHaveValue('trusted-gateway');
  expect(screen.getByLabelText(/Allow third-party AI-text detection/)).not.toBeChecked();
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
  expect(await screen.findByRole('alert')).toHaveTextContent('Planner: effort max is not accepted for Gemini API credential. Accepted: minimal, low, medium, high.');
  expect(screen.getByRole('button', {name: 'Save'})).toBeDisabled();
  expect(screen.getByText('Save is off until the seat issues under Research Models are fixed.')).toBeInTheDocument();
  expect(screen.getByLabelText('Planner effort')).toHaveValue('max');
  expect(within(screen.getByLabelText('Planner effort')).queryByRole('option', {name: 'xhigh'})).toBeNull();
  await user.selectOptions(screen.getByLabelText('Planner effort'), 'high');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Save'})).toBeEnabled();
  expect(screen.getByRole('button', {name: 'Reload (discards unsaved edits)'})).toBeEnabled();
  await user.selectOptions(screen.getByLabelText('Falsifier sign-in'), 'cli');
  expect(screen.getByLabelText('Falsifier effort')).toHaveValue('medium');
  expect(screen.getByLabelText('Falsifier effort')).toBeDisabled();
  expect(screen.getByText(/Gemini CLI login/)).toHaveTextContent('provider default');
  expect(screen.getByLabelText('Falsifier credential')).toHaveAttribute('placeholder', 'not used with CLI login');
  await user.selectOptions(screen.getByLabelText('Prose sign-in'), 'cli');
  expect(screen.getByRole('alert')).toHaveTextContent('Prose: OpenClaw has no CLI login. Choose API credential.');
});

test('seat readiness reports configured, incomplete and not-probed states without claiming inference works', async () => {
  const user = userEvent.setup();
  render(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  const seats = within(screen.getByRole('table', {name: 'Seats'}));
  const plannerRow = seats.getByRole('row', {name: /Planner OpenAI/});
  expect(plannerRow).toHaveTextContent('configured');
  expect(plannerRow).toHaveTextContent('Credential file is named; not checked, and no call was made.');
  const falsifierRow = seats.getByRole('row', {name: /Falsifier Gemini/});
  expect(falsifierRow).toHaveTextContent('not applied');
  // Nothing is unsaved, so the advice is never "Save to apply": it says why the seat is not running.
  expect(falsifierRow).toHaveTextContent('Saved. Not in the running route yet; the live seats did not report it.');
  expect(screen.queryByText(/Save to apply/)).not.toBeInTheDocument();
  const reviewerRow = seats.getByRole('row', {name: /Reviewer \(QA\) Anthropic/});
  expect(reviewerRow).toHaveTextContent('not signed in');
  expect(reviewerRow).not.toHaveTextContent('probed');
  // Vision and prose are never in the running-seats report or a probe, so no mismatch warning.
  const visionRow = seats.getByRole('row', {name: /Vision OpenAI/});
  expect(visionRow).toHaveTextContent('configured');
  expect(visionRow).toHaveTextContent('Saved; not part of the running-seats report; no call was made.');
  expect(seats.getByRole('row', {name: /Prose OpenClaw/})).toHaveTextContent('Saved; not part of the running-seats report; no call was made.');
  await user.type(screen.getByLabelText('Vision model'), '-next');
  expect(visionRow).toHaveTextContent('not applied');
  expect(visionRow).toHaveTextContent('These values are not the running ones. Save to apply.');
  await user.clear(screen.getByLabelText('Vision credential'));
  expect(visionRow).toHaveTextContent('incomplete');
  expect(visionRow).toHaveTextContent('Credential file name is required.');
});

test('a saved API seat the route could not load names the missing credential file, and the effort hint appears once', async () => {
  const bare = structuredClone(snapshot);
  bare.settings.seats.vision = {provider: '', model: '', effort: 'medium', auth: 'api_key', credential: ''};
  bare.settings.seats.prose = {provider: '', model: '', effort: 'medium', auth: 'api_key', credential: ''};
  fetch.mockImplementation(async path => path === '/api/settings' ? json(bare) : json({live: {configured: false}}));
  const user = userEvent.setup();
  render(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  const seats = within(await screen.findByRole('table', {name: 'Seats'}));
  const plannerRow = seats.getByRole('row', {name: /Planner OpenAI/});
  expect(plannerRow).toHaveTextContent('not applied');
  expect(plannerRow).toHaveTextContent('Saved. Not in the running route: the credential file is not stored (for this seat or another API seat).');
  expect(screen.queryByText(/Save to apply/)).not.toBeInTheDocument();
  expect(screen.getAllByText('Select a provider to see which effort levels it accepts.')).toHaveLength(1);
});

test('MCP and ACP editors keep consented checks visible after edits', async () => {
  const user = userEvent.setup();
  render(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  await user.click(screen.getByText('Connections'));
  await user.clear(screen.getByLabelText('MCP server 1 name'));
  await user.type(screen.getByLabelText('MCP server 1 name'), 'local-pubmed');
  await user.clear(screen.getByLabelText('MCP server 1 arguments'));
  await user.type(screen.getByLabelText('MCP server 1 arguments'), '--stdio --safe');
  await user.click(screen.getByRole('button', {name: 'Check MCP servers'}));
  expect(await screen.findByLabelText('MCP servers checked')).toHaveTextContent('pubmed');
  expect(screen.getByLabelText('MCP server 1 name')).toHaveValue('local-pubmed');
  await user.click(screen.getByRole('button', {name: 'Check ACP agents'}));
  expect(await screen.findByLabelText('ACP agents checked')).toHaveTextContent('not signed in');
  await user.click(screen.getByRole('button', {name: 'Add ACP agent'}));
  expect(screen.getByLabelText('ACP agent 2 name')).toHaveValue('');
});

test('CLI probes require consent and report failed reachability without marking identity verified', async () => {
  const user = userEvent.setup();
  render(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  await user.click(screen.getByText('Connections'));
  expect(screen.getByRole('button', {name: 'Probe Anthropic'})).toBeDisabled();
  await user.click(screen.getByLabelText(/I accept that a probe spends tokens/));
  await user.click(screen.getByRole('button', {name: 'Probe Anthropic'}));
  expect(await screen.findByRole('table', {name: 'CLI logins'})).toHaveTextContent('failed: Credit balance is too low');
  expect(screen.getByRole('table', {name: 'CLI logins'})).not.toHaveTextContent('ok, answering model');
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
  expect(await screen.findByRole('alert')).toHaveTextContent('Settings changed elsewhere');
  expect(screen.getByRole('alert')).toHaveTextContent('Your edits are still on screen');
  expect(screen.getByLabelText('Planner model')).toHaveValue('gpt-unsaved');
  expect(screen.getByText(/Revision aaaaaaaaaaaa/)).toBeInTheDocument();
  expect(screen.getByRole('alert')).not.toHaveTextContent('Request failed (409)');
});

test('save notice names only the non-empty outcome groups', async () => {
  fetch.mockImplementation(async (path, options = {}) => {
    if (path === '/api/settings' && options.method === 'PUT') return json({...snapshot, settings: JSON.parse(options.body).settings, applied_live: [], stored_pending: ['prose'], restart_required: ['mcp_servers']});
    if (path === '/api/settings') return json(snapshot);
    if (path === '/api/capabilities') return json({live: {configured: false}});
    throw new Error('Unexpected request ' + path);
  });
  const user = userEvent.setup();
  render(<SettingsWorkspace token="operator"/>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  expect(await screen.findByText('No unsaved edits.')).toBeInTheDocument();
  await user.type(await screen.findByLabelText('Blender preset'), '-2');
  await user.click(screen.getByRole('button', {name: 'Save'}));
  expect(await screen.findByText('Saved. Takes effect on restart: MCP servers. Stored, not yet used: prose.')).toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Reload'})).toBeEnabled();
});

test('a failed probe is reported beside the probe button and the locked card can reach the token field', async () => {
  const user = userEvent.setup();
  const setToken = vi.fn();
  render(<><input id="operator-token"/><SettingsWorkspace token={NATIVE_SESSION} setToken={setToken}/></>);
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  await user.click(screen.getByText('Connections'));
  await user.click(screen.getByLabelText(/I accept that a probe spends tokens/));
  fetch.mockImplementationOnce(async () => json({detail: 'probe timed out'}, {status: 500}));
  await user.click(screen.getByRole('button', {name: 'Probe Anthropic'}));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Probe Anthropic did not complete: probe timed out. Your draft was kept.');
  expect(within(alert.closest('details')).getByRole('table', {name: 'CLI logins'})).toBeInTheDocument();
  fetch.mockImplementationOnce(async () => json({detail: 'stale'}, {status: 401}));
  await user.click(screen.getByRole('button', {name: 'Reload'}));
  const lock = (await screen.findByText(SESSION_COPY.nativeExpired.title)).closest('.unlock-card');
  expect(lock).toHaveClass('error');
  expect(lock).toHaveTextContent('Your draft stays in this window.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Planner model')).toHaveValue('gpt-5.6');
  await user.click(within(lock).getByRole('button', {name: 'Use operator token'}));
  expect(setToken).toHaveBeenCalledWith('');
  await vi.waitFor(() => expect(document.getElementById('operator-token')).toHaveFocus());
});
