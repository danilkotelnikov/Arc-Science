import React from 'react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {fireEvent, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsWorkspace from './SettingsWorkspace';
import {NATIVE_SESSION, SESSION_COPY} from './http';

const revision = 'a'.repeat(64), newer = 'b'.repeat(64);
const settings = {
  seats: {
    planner: {provider: 'openai', model: 'gpt-5.6-sol', effort: 'medium', auth: 'api_key', credential: 'openai'},
    reviewer: {provider: 'anthropic', model: 'claude-sonnet-5', effort: 'high', auth: 'cli', credential: ''},
    falsifier: {provider: 'gemini', model: 'gemini-3.8-flash', effort: 'medium', auth: 'api_key', credential: 'gemini'},
    vision: {provider: 'openai', model: 'gpt-5.6-luna', effort: 'low', auth: 'api_key', credential: 'openai'},
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
const snapshot = {revision, path: 'C:/Arc/settings.toml', read_only: false, settings, changed: [], effects: [], restart_required: [], restart_note: 'No setting in this build needs a restart.', bound_missions: 0};
const live = {
  configured: true,
  seats: {
    planner: {provider: 'openai', transport: 'api', model: 'gpt-5.6-sol', effort: 'medium'},
    reviewer: {provider: 'anthropic', transport: 'cli', model: 'claude-sonnet-5', effort: 'high'}
  },
  transports: {anthropic: {transport: 'claude-code', executable: 'claude', version: '5.0.0', logged_in: false, auth_method: 'oauth', identity_reported: false, last_probe: null}}
};
// A cut of apps/arc-science/src/arc_science/exploration/model_catalog.json: the shapes the picker reads.
const model = (id, label, efforts, caps = {}) => ({id, label, capabilities: {text: true, vision: true, tool_use: true, ...caps}, efforts, transports: ['api', 'cli']});
const catalog = {
  catalog_version: '2026-09-21.1',
  efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  efforts_by_transport: {'anthropic:api': ['low', 'medium', 'high', 'xhigh', 'max'], 'anthropic:cli': ['low', 'medium', 'high', 'xhigh', 'max'], 'openai:api': ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], 'openai:cli': ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], 'gemini:api': ['minimal', 'low', 'medium', 'high'], 'gemini:cli': [], 'openclaw:api': []},
  providers: {
    anthropic: {label: 'Anthropic', source: 'https://platform.claude.com/docs/en/about-claude/models/overview', models: [
      model('claude-sonnet-5', 'Claude Sonnet 5', ['low', 'medium', 'high', 'xhigh', 'max'], {context_tokens: 1000000, thinking: 'adaptive'}),
      model('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', [], {context_tokens: 200000, thinking: 'extended'})]},
    openai: {label: 'OpenAI', source: 'https://developers.openai.com/api/docs/models', models: [
      model('gpt-5.6-sol', 'GPT-5.6 Sol', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], {context_tokens: 1050000}),
      model('gpt-5.6-luna', 'GPT-5.6 Luna', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], {context_tokens: 1050000})]},
    gemini: {label: 'Gemini', source: 'https://ai.google.dev/gemini-api/docs/models', models: [model('gemini-3.8-flash', 'Gemini 3.8 Flash', ['low', 'medium', 'high'])]},
    openclaw: {label: 'OpenClaw', source: null, models: []}
  },
  auth_modes: {
    anthropic: [{mode: 'cli', label: 'CLI login (Claude Code)', support: 'supported', source: 'https://code.claude.com/docs/en/authentication'}, {mode: 'api_key', label: 'API credential (Console key)', support: 'supported', source: 'https://platform.claude.com/docs/en/manage-claude/authentication'}, {mode: 'console_profile', label: 'Console profile via the external `ant` CLI', support: 'detected only', source: 'https://platform.claude.com/docs/en/cli-sdks-libraries/cli/authentication'}, {mode: 'oauth', label: 'In-app provider OAuth', support: 'unavailable', source: 'https://platform.claude.com/docs/en/manage-claude/authentication'}],
    openai: [{mode: 'cli', label: 'CLI login (Codex)', support: 'supported', source: 'https://learn.chatgpt.com/docs/auth'}, {mode: 'api_key', label: 'API credential', support: 'supported', source: 'https://developers.openai.com/api/reference/overview'}],
    gemini: [{mode: 'cli', label: 'CLI login (Gemini CLI)', support: 'supported', source: 'https://geminicli.com/docs/get-started/authentication/'}, {mode: 'api_key', label: 'API credential (AI Studio key)', support: 'supported', source: 'https://ai.google.dev/gemini-api/docs/api-key'}, {mode: 'oauth', label: 'OAuth desktop client (your own Cloud project)', support: 'not in this build', source: 'https://ai.google.dev/gemini-api/docs/oauth'}],
    openclaw: [{mode: 'api_key', label: 'API credential (Gateway token)', support: 'supported', source: 'apps/arc-science/docs/architecture.md'}, {mode: 'cli', label: 'CLI login', support: 'unavailable', source: 'native/arc-science/src/settings.rs'}]
  }
};
const seatNode = (role, state, code, meaning, next_action = null) => ({role, label: {planner: 'Planner', reviewer: 'Reviewer (QA)', falsifier: 'Falsifier', vision: 'Vision', prose: 'Prose'}[role], state, code, facts: {}, verification: {status: 'not_tested'}, meaning, next_action, source: 'settings revision ' + revision.slice(0, 12)});
const readiness = {
  checked_at: 1_800_000_000,
  session: {kind: 'native', state: 'ready', code: 'session.native', label: 'Desktop session', meaning: 'The desktop app opened this session.', next_action: null, source: 'request header'},
  seats: {
    planner: seatNode('planner', 'ready', 'seat.verified', 'The last probe reached gpt-5.6-sol at medium effort.'),
    reviewer: seatNode('reviewer', 'blocked', 'seat.cli_not_signed_in', 'Claude Code is installed but not signed in.', 'Run `claude` and sign in, then reload readiness.'),
    falsifier: seatNode('falsifier', 'not_tested', 'seat.not_tested', 'A credential is stored; no call has been made.', 'Probe from Connections (spends tokens).'),
    vision: seatNode('vision', 'not_tested', 'seat.not_tested', 'A credential is stored; no call has been made.', 'Probe from Connections (spends tokens).'),
    prose: seatNode('prose', 'not_tested', 'seat.custom_model', 'arc-humane-prose-2 is not in the catalog; nothing is assumed about it.', 'Save and run a prose request to check it.')
  },
  live_mission: {state: 'blocked', code: 'live.blocked', blocking: ['reviewer'], meaning: 'The reviewer seat is blocked.', next_action: 'Sign in to Claude Code.'},
  catalog
};
const json = (data, init = {}) => new Response(JSON.stringify(data), {...init, headers: {'Content-Type': 'application/json', ...(init.headers || {})}});
const put = (base, options, extra = {}) => json({...base, settings: JSON.parse(options.body).settings, changed: ['seats.planner'], effects: [{section: 'seats.planner', applies: 'next live mission start', note: 'Missions already bound to a route keep it; a changed route blocks their resume until it is restored.'}], ...extra});
// The header's token field (main.jsx) stands beside the workspace: autoload listens for it settling.
const shell = props => <><input id="operator-token" aria-label="Operator token"/><SettingsWorkspace token="operator" active readiness={readiness} refreshReadiness={vi.fn(() => Promise.resolve())} {...props}/></>;
const mount = (props = {}) => { const rendered = render(shell(props)); return {...rendered, rerender: next => rendered.rerender(shell(next))}; };
const tokenField = () => screen.getByLabelText('Operator token');
const settingsReads = () => fetch.mock.calls.filter(([path, options]) => path === '/api/settings' && options?.method !== 'PUT').map(([, options]) => options.headers.Authorization);
const WAITING = 'Settings load when you leave the token field (Tab, Enter or a click elsewhere), or press Load settings.';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (path, options = {}) => {
    if (path === '/api/settings' && options.method === 'PUT') return put(snapshot, options);
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

test('settings load by themselves when the workspace is active with a session, once per token', async () => {
  const refreshReadiness = vi.fn(() => Promise.resolve());
  const rendered = mount({refreshReadiness});
  expect(screen.getByText('Loading settings…')).toHaveAttribute('role', 'status');
  expect(await screen.findByLabelText('Planner model')).toHaveValue('gpt-5.6-sol');
  expect(screen.getByRole('button', {name: 'Reload'})).toBeEnabled();
  expect(screen.queryByRole('button', {name: 'Load settings'})).not.toBeInTheDocument();
  expect(refreshReadiness).toHaveBeenCalledTimes(1);
  expect(settingsReads()).toEqual(['Bearer operator']);
  // Leaving and returning keeps the draft: no second load, even with unsaved edits.
  await userEvent.setup().selectOptions(screen.getByLabelText('Planner effort'), 'high');
  rendered.rerender({active: false, refreshReadiness});
  rendered.rerender({refreshReadiness});
  expect(settingsReads()).toHaveLength(1);
  expect(screen.getByLabelText('Planner effort')).toHaveValue('high');
  // A new token resets; the load waits for the field to settle (here: Enter), then runs once.
  rendered.rerender({token: 'operator-2', refreshReadiness});
  expect(screen.getByText(WAITING)).toBeInTheDocument();
  expect(settingsReads()).toHaveLength(1);
  fireEvent.keyDown(tokenField(), {key: 'Enter'});
  expect(await screen.findByLabelText('Planner effort')).toHaveValue('medium');
  expect(settingsReads()).toEqual(['Bearer operator', 'Bearer operator-2']);
});

test('a token typed while Settings is shown sends nothing until it settles', async () => {
  const rendered = mount({token: ''});
  expect(screen.getByText('Settings load once the header holds a Desktop session or an operator token.')).toBeInTheDocument();
  for (const partial of ['s', 'se', 'sec', 'secret']) {
    rendered.rerender({token: partial});
    expect(screen.getByText(WAITING)).toBeInTheDocument();
  }
  expect(fetch).not.toHaveBeenCalled();
  expect(document.body).not.toHaveTextContent(SESSION_COPY.expired.title);
  // Leaving the field (a click elsewhere, Tab) loads with the token on screen; a stale
  // focusout after the load, or a keystroke, does not load again.
  fireEvent.focusOut(tokenField());
  expect(await screen.findByLabelText('Planner model')).toHaveValue('gpt-5.6-sol');
  fireEvent.focusOut(tokenField());
  fireEvent.keyDown(tokenField(), {key: 'a'});
  expect(settingsReads()).toEqual(['Bearer secret']);
  // Shown while another workspace is active, the field settling is not Settings' business.
  rendered.rerender({token: 'secret-2', active: false});
  fireEvent.focusOut(tokenField());
  expect(settingsReads()).toHaveLength(1);
  // Coming back to Settings with that settled token loads it.
  rendered.rerender({token: 'secret-2'});
  expect(await screen.findByLabelText('Planner model')).toHaveValue('gpt-5.6-sol');
  expect(settingsReads()).toEqual(['Bearer secret', 'Bearer secret-2']);
});

test('the desktop session loads settings as soon as the shell reports it', async () => {
  const rendered = mount({token: ''});
  rendered.rerender({token: NATIVE_SESSION});
  expect(await screen.findByLabelText('Planner model')).toHaveValue('gpt-5.6-sol');
  // One read, on the desktop session's header auth: no bearer token.
  expect(settingsReads()).toHaveLength(1);
  expect(fetch.mock.calls.find(([path]) => path === '/api/settings')[1].headers).not.toHaveProperty('Authorization');
});

test('missing supervisor settings file is actionable, does not show a raw 503, and offers Retry', async () => {
  fetch.mockImplementation(async path => path === '/api/settings'
    ? json({detail: 'No settings file is configured for this service'}, {status: 503})
    : json({live: {configured: false}}));
  mount();
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('No settings file was given to this service.');
  expect(screen.getByText('Settings file not configured')).toBeInTheDocument();
  expect(alert).not.toHaveTextContent('Request failed (503)');
  expect(screen.getByText('Settings did not load. Use Retry or Load settings.')).toBeInTheDocument();
  fetch.mockImplementation(async path => path === '/api/settings' ? json(snapshot) : json({live}));
  await userEvent.setup().click(within(alert).getByRole('button', {name: 'Retry'}));
  expect(await screen.findByLabelText('Planner model')).toHaveValue('gpt-5.6-sol');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('locked and offline states are concise and separate from raw request text', async () => {
  const user = userEvent.setup();
  fetch.mockImplementationOnce(async () => json({detail: 'bad token'}, {status: 401}));
  const rendered = mount({token: 'bad-token'});
  // A rejected token is the one lock notice in the error tone: no alert with the same words.
  const lock = (await screen.findByText(SESSION_COPY.expired.title)).closest('.unlock-card');
  expect(lock).toHaveClass('error');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent('Request failed (401)');
  expect(within(lock).getByRole('button', {name: 'Go to token field'})).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/paste/i);

  fetch.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
  rendered.rerender({token: 'operator'});
  fireEvent.keyDown(tokenField(), {key: 'Enter'});
  expect(await screen.findByRole('alert')).toHaveTextContent(SESSION_COPY.offline.title);
  expect(screen.getByRole('alert')).not.toHaveTextContent(SESSION_COPY.expired.title);
  fetch.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(SESSION_COPY.offline.title);
});

test('settings are grouped by user task while advanced controls remain reachable', async () => {
  const user = userEvent.setup();
  mount();
  expect(await screen.findByLabelText('Planner model')).toHaveValue('gpt-5.6-sol');
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

test('the model picker lists the provider catalog and a custom id is marked unverified', async () => {
  const user = userEvent.setup();
  mount();
  const picker = await screen.findByLabelText('Planner model');
  expect(within(picker).getAllByRole('option').map(option => option.textContent)).toEqual(['Choose a model', 'GPT-5.6 Sol (gpt-5.6-sol)', 'GPT-5.6 Luna (gpt-5.6-luna)', 'Custom id…']);
  const planner = screen.getByRole('article', {name: 'Planner seat'});
  expect(planner).toHaveTextContent('In catalog 2026-09-21.1 · 1,050,000 tokens · vision yes · thinking not stated');
  expect(within(planner).getByRole('link', {name: 'catalog source'})).toHaveAttribute('href', 'https://developers.openai.com/api/docs/models');
  expect(screen.queryByLabelText('Planner custom model id')).not.toBeInTheDocument();
  await user.selectOptions(picker, 'Custom id…');
  const custom = screen.getByLabelText('Planner custom model id');
  expect(custom).toHaveValue('gpt-5.6-sol');
  await user.clear(custom);
  await user.type(custom, 'gpt-7-preview');
  expect(planner).toHaveTextContent('Custom id (unverified): not in the catalog; readiness cannot be assumed');
  expect(planner).not.toHaveTextContent('In catalog');
  // Effort options for a custom id are the transport's, since no model list narrows them.
  expect(within(screen.getByLabelText('Planner effort')).getAllByRole('option').map(option => option.value)).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  await user.selectOptions(picker, 'GPT-5.6 Luna (gpt-5.6-luna)');
  expect(screen.queryByLabelText('Planner custom model id')).not.toBeInTheDocument();
  expect(planner).toHaveTextContent('In catalog 2026-09-21.1');
  // A stored id outside the catalog opens as a custom id: the prose seat on OpenClaw.
  const prose = screen.getByRole('article', {name: 'Prose seat'});
  expect(screen.getByLabelText('Prose custom model id')).toHaveValue('arc-humane-prose-2');
  expect(prose).toHaveTextContent('Custom id (unverified)');
  await user.click(within(prose).getByText('Sign-in methods'));
  expect(prose).toHaveTextContent('API credential (Gateway token): supported');
  expect(prose).toHaveTextContent('CLI login: unavailable');
  expect(within(screen.getByLabelText('Prose sign-in')).getAllByRole('option').map(option => option.textContent)).toEqual(['API credential (Gateway token)']);
});

test('effort options are the transport list intersected with the model list, disabled at medium when empty', async () => {
  const user = userEvent.setup();
  mount();
  const reviewerEffort = await screen.findByLabelText('Reviewer (QA) effort');
  expect(within(reviewerEffort).getAllByRole('option').map(option => option.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  const reviewer = screen.getByRole('article', {name: 'Reviewer (QA) seat'});
  await user.selectOptions(screen.getByLabelText('Reviewer (QA) model'), 'claude-haiku-4-5-20251001');
  // The stored effort (high) is kept and marked; Save waits for a choice.
  expect(reviewerEffort).toHaveValue('high');
  expect(reviewerEffort).toHaveAttribute('aria-invalid', 'true');
  expect(reviewerEffort).toBeEnabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Reviewer (QA): No effort control on this model/sign-in; the provider default applies; effort high is not accepted, so choose medium.');
  expect(screen.getByRole('button', {name: 'Save'})).toBeDisabled();
  await user.selectOptions(reviewerEffort, 'medium');
  expect(reviewerEffort).toBeDisabled();
  expect(reviewerEffort).not.toHaveAttribute('aria-invalid');
  expect(reviewer).toHaveTextContent('No effort control on this model/sign-in; the provider default applies.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Save'})).toBeEnabled();
  // Gemini through the CLI has no effort control at all.
  await user.selectOptions(screen.getByLabelText('Falsifier sign-in'), 'cli');
  expect(screen.getByLabelText('Falsifier effort')).toHaveValue('medium');
  expect(screen.getByLabelText('Falsifier effort')).toBeDisabled();
  expect(screen.getByRole('article', {name: 'Falsifier seat'})).toHaveTextContent('No effort control on this model/sign-in; the provider default applies.');
  expect(screen.getByLabelText('Falsifier credential')).toHaveAttribute('placeholder', 'not used with CLI login');
  // Gemini API on a model with low/medium/high drops minimal.
  await user.selectOptions(screen.getByLabelText('Falsifier sign-in'), 'api_key');
  expect(within(screen.getByLabelText('Falsifier effort')).getAllByRole('option').map(option => option.value)).toEqual(['low', 'medium', 'high']);
});

test('changing the provider or sign-in never coerces the stored effort; Save waits for a choice', async () => {
  const user = userEvent.setup();
  mount();
  const effort = await screen.findByLabelText('Planner effort');
  await user.selectOptions(effort, 'minimal');
  await user.selectOptions(screen.getByLabelText('Planner provider'), 'anthropic');
  expect(effort).toHaveValue('minimal');
  expect(effort).toHaveAttribute('aria-invalid', 'true');
  expect(within(effort).getByRole('option', {name: 'minimal (not accepted)'})).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Planner: Effort minimal is not accepted for this provider, sign-in and model; choose one of low, medium, high, xhigh, max.');
  expect(screen.getByRole('button', {name: 'Save'})).toBeDisabled();
  expect(screen.getByText('Save is off until the seat issues under Research Models are fixed.')).toBeInTheDocument();
  // The model id moved with the seat and is now a custom id for Anthropic.
  expect(screen.getByLabelText('Planner custom model id')).toHaveValue('gpt-5.6-sol');
  await user.selectOptions(effort, 'high');
  expect(effort).not.toHaveAttribute('aria-invalid');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Save'})).toBeEnabled();
  // A stored sign-in the provider has no transport for is flagged on the sign-in, not the effort.
  await user.selectOptions(screen.getByLabelText('Reviewer (QA) provider'), 'openclaw');
  expect(screen.getByLabelText('Reviewer (QA) effort')).not.toHaveAttribute('aria-invalid');
  expect(screen.getByLabelText('Reviewer (QA) sign-in')).toHaveValue('cli');
  expect(screen.getByLabelText('Reviewer (QA) sign-in')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('Reviewer (QA): OpenClaw has no CLI login. Choose API credential (Gateway token).');
});

test('seat readiness comes from the service, and a draft edit is an unsaved badge, not a state', async () => {
  const user = userEvent.setup();
  mount();
  const planner = await screen.findByRole('article', {name: 'Planner seat'});
  expect(within(planner).getByText('Ready')).toBeInTheDocument();
  expect(planner).toHaveTextContent('The last probe reached gpt-5.6-sol at medium effort.');
  const reviewer = screen.getByRole('article', {name: 'Reviewer (QA) seat'});
  expect(within(reviewer).getByText('Blocked')).toBeInTheDocument();
  expect(reviewer).toHaveTextContent('Claude Code is installed but not signed in.');
  expect(reviewer).toHaveTextContent('Next: Run `claude` and sign in, then reload readiness.');
  expect(within(screen.getByRole('article', {name: 'Falsifier seat'})).getByText('Not tested')).toBeInTheDocument();
  expect(screen.getByLabelText('Live mission readiness')).toHaveTextContent('Blocked');
  expect(screen.getByLabelText('Live mission readiness')).toHaveTextContent('The reviewer seat is blocked. Next: Sign in to Claude Code.');
  expect(within(planner).queryByText('Unsaved')).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText('Planner credential'));
  await user.type(screen.getByLabelText('Planner credential'), 'openai-2');
  expect(within(planner).getByText('Unsaved')).toBeInTheDocument();
  expect(within(planner).getByText('Ready')).toBeInTheDocument();
  expect(planner).toHaveTextContent('Readiness refers to the saved seat; save to check this draft.');
  expect(document.body).not.toHaveTextContent('Save to apply');
});

test('without readiness every seat is Unknown and the catalog is marked not loaded', async () => {
  mount({readiness: null, readinessError: 'Readiness is unavailable: the service returned 503.'});
  const planner = await screen.findByRole('article', {name: 'Planner seat'});
  expect(within(planner).getByText('Unknown')).toBeInTheDocument();
  expect(planner).toHaveTextContent('Readiness is unavailable: the service returned 503.');
  expect(screen.getByText(/Catalog not loaded \(Readiness is unavailable/)).toBeInTheDocument();
  expect(within(screen.getByLabelText('Planner provider')).getAllByRole('option').map(option => option.textContent)).toEqual(['None', 'Anthropic', 'OpenAI', 'Gemini', 'OpenClaw']);
  // The stored id is shown as is: nothing is called unverified or in the catalog without the catalog.
  expect(screen.getByLabelText('Planner custom model id')).toHaveValue('gpt-5.6-sol');
  expect(planner).toHaveTextContent('Model ids are not checked: catalog not loaded.');
  expect(planner).not.toHaveTextContent('unverified');
  expect(within(screen.getByLabelText('Planner effort')).getAllByRole('option')).toHaveLength(6);
  expect(screen.getByLabelText('Planner effort')).not.toHaveAttribute('aria-invalid');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('MCP and ACP editors keep consented checks visible after edits', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByText('Connections'));
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

test('CLI probes require consent, report failed reachability without claiming identity, and refresh readiness', async () => {
  const user = userEvent.setup();
  const refreshReadiness = vi.fn(() => Promise.resolve());
  mount({refreshReadiness});
  await user.click(await screen.findByText('Connections'));
  expect(screen.getByRole('button', {name: 'Probe Anthropic'})).toBeDisabled();
  await user.click(screen.getByLabelText(/I accept that a probe spends tokens/));
  await user.click(screen.getByRole('button', {name: 'Probe Anthropic'}));
  expect(await screen.findByRole('table', {name: 'CLI logins'})).toHaveTextContent('failed: Credit balance is too low');
  expect(screen.getByRole('table', {name: 'CLI logins'})).not.toHaveTextContent('ok, answering model');
  const probeCall = fetch.mock.calls.find(([path]) => path === '/api/providers/anthropic/probe');
  expect(JSON.parse(probeCall[1].body)).toEqual({spend_tokens: true});
  expect(refreshReadiness).toHaveBeenCalledTimes(2);
});

test('the save notice names each changed section, when it applies, the restart note and bound missions', async () => {
  const refreshReadiness = vi.fn(() => Promise.resolve());
  fetch.mockImplementation(async (path, options = {}) => {
    if (path === '/api/settings' && options.method === 'PUT') return json({...snapshot, revision: newer, settings: JSON.parse(options.body).settings, changed: ['blender', 'seats.planner'],
      effects: [{section: 'blender', applies: 'next render submission', note: ''}, {section: 'seats.planner', applies: 'next live mission start', note: 'Missions already bound to a route keep it; a changed route blocks their resume until it is restored.'}],
      restart_required: [], restart_note: 'No setting in this build needs a restart.', bound_missions: 2});
    if (path === '/api/settings') return json(snapshot);
    if (path === '/api/capabilities') return json({live: {configured: false}});
    throw new Error('Unexpected request ' + path);
  });
  const user = userEvent.setup();
  mount({refreshReadiness});
  expect(await screen.findByText('No unsaved edits.')).toBeInTheDocument();
  await user.type(await screen.findByLabelText('Blender preset'), '-2');
  await user.selectOptions(screen.getByLabelText('Planner effort'), 'high');
  await user.click(screen.getByRole('button', {name: 'Save'}));
  expect(await screen.findByText('Saved (revision bbbbbbbbbbbb). Rendering: applies at next render submission. Planner seat: applies at next live mission start. Missions already bound to a route keep it; a changed route blocks their resume until it is restored. No setting in this build needs a restart. 2 missions keep the route they were bound to.')).toBeInTheDocument();
  expect(screen.getByText(/Revision bbbbbbbbbbbb · saved/)).toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Reload'})).toBeEnabled();
  expect(refreshReadiness).toHaveBeenCalledTimes(2);
  const saved = JSON.parse(fetch.mock.calls.find(([, options]) => options?.method === 'PUT')[1].body);
  expect(saved.if_revision).toBe(revision);
  expect(saved.settings.seats.planner.effort).toBe('high');
});

test('a stale save keeps the edits, and "Reload and keep my edits" puts only them onto the newer revision', async () => {
  const user = userEvent.setup();
  const elsewhere = {...snapshot, revision: newer, settings: {...settings, blender: {default_preset: 'publication_clean_v2'}, seats: {...settings.seats, vision: {...settings.seats.vision, model: 'gpt-5.6-sol'}}}};
  mount();
  const credential = await screen.findByLabelText('Planner credential');
  await user.clear(credential);
  await user.type(credential, 'planner-2');
  fetch.mockImplementationOnce(async () => json({detail: 'Settings revision changed'}, {status: 409}));
  await user.click(screen.getByRole('button', {name: 'Save'}));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Settings changed elsewhere');
  expect(alert).toHaveTextContent('Your edits are still on screen');
  expect(alert).not.toHaveTextContent('Request failed (409)');
  expect(credential).toHaveValue('planner-2');
  expect(screen.getByText(/Revision aaaaaaaaaaaa/)).toBeInTheDocument();
  fetch.mockImplementation(async (path, options = {}) => {
    if (path === '/api/settings' && options.method === 'PUT') return put(elsewhere, options);
    if (path === '/api/settings') return json(elsewhere);
    return json({live});
  });
  await user.click(within(alert).getByRole('button', {name: 'Reload and keep my edits'}));
  expect(await screen.findByText('Edits re-applied onto revision bbbbbbbbbbbb; review and save')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Planner credential')).toHaveValue('planner-2');
  // The other party's changes are in the draft; only the planner credential was re-applied.
  expect(screen.getByLabelText('Vision model')).toHaveValue('gpt-5.6-sol');
  expect(screen.getByText(/Revision bbbbbbbbbbbb · unsaved edits/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', {name: 'Save'}));
  expect(await screen.findByText(/^Saved \(revision bbbbbbbbbbbb\)/)).toBeInTheDocument();
  const saved = JSON.parse(fetch.mock.calls.filter(([, options]) => options?.method === 'PUT').at(-1)[1].body);
  expect(saved.if_revision).toBe(newer);
  expect(saved.settings.seats.planner.credential).toBe('planner-2');
  expect(saved.settings.blender.default_preset).toBe('publication_clean_v2');
});

test('a failed probe is reported beside the probe button and the locked card can reach the token field', async () => {
  const user = userEvent.setup();
  const setToken = vi.fn();
  mount({token: NATIVE_SESSION, setToken});
  await user.click(await screen.findByText('Connections'));
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
  expect(screen.getByLabelText('Planner model')).toHaveValue('gpt-5.6-sol');
  await user.click(within(lock).getByRole('button', {name: 'Use operator token'}));
  expect(setToken).toHaveBeenCalledWith('');
  await vi.waitFor(() => expect(document.getElementById('operator-token')).toHaveFocus());
});
