import React from 'react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsWorkspace from './SettingsWorkspace';
import {NATIVE_SESSION} from './http';
import {I18nProvider} from './i18n/index.jsx';
import en from './i18n/en.js';

const SESSION = id => en['session.' + id + '.title'];
// The probe and grant times as the page writes them (useI18n().d, English outside a provider).
const when = at => new Intl.DateTimeFormat('en', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(at * 1000));

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
// A cut of apps/arc-science/src/arc_science/exploration/model_catalog.json: the shapes the picker reads.
const model = (id, label, efforts, caps = {}) => ({id, label, capabilities: {text: true, vision: true, tool_use: true, ...caps}, efforts, transports: ['api', 'cli']});
const catalog = {
  catalog_version: '2026-09-21.1',
  efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  efforts_by_transport: {'anthropic:api': ['low', 'medium', 'high', 'xhigh', 'max'], 'anthropic:cli': ['low', 'medium', 'high', 'xhigh', 'max'], 'openai:api': ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], 'openai:cli': ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], 'gemini:api': ['minimal', 'low', 'medium', 'high'], 'gemini:cli': [], 'openclaw:api': []},
  providers: {
    anthropic: {label: 'Anthropic', official_origin: 'https://api.anthropic.com', source: 'https://platform.claude.com/docs/en/about-claude/models/overview', models: [
      model('claude-sonnet-5', 'Claude Sonnet 5', ['low', 'medium', 'high', 'xhigh', 'max'], {context_tokens: 1000000, thinking: 'adaptive'}),
      model('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', [], {context_tokens: 200000, thinking: 'extended'})]},
    openai: {label: 'OpenAI', official_origin: 'https://api.openai.com', source: 'https://developers.openai.com/api/docs/models', models: [
      model('gpt-5.6-sol', 'GPT-5.6 Sol', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], {context_tokens: 1050000}),
      model('gpt-5.6-luna', 'GPT-5.6 Luna', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], {context_tokens: 1050000})]},
    gemini: {label: 'Gemini', official_origin: 'https://generativelanguage.googleapis.com', source: 'https://ai.google.dev/gemini-api/docs/models', models: [model('gemini-3.8-flash', 'Gemini 3.8 Flash', ['low', 'medium', 'high'])]},
    openclaw: {label: 'OpenClaw', official_origin: null, source: null, models: []}
  },
  auth_modes: {
    anthropic: [{mode: 'cli', label: 'CLI login (Claude Code)', support: 'supported', source: 'https://code.claude.com/docs/en/authentication'}, {mode: 'api_key', label: 'API credential (Console key)', support: 'supported', source: 'https://platform.claude.com/docs/en/manage-claude/authentication'}, {mode: 'console_profile', label: 'Console profile via the external `ant` CLI', support: 'detected only', source: 'https://platform.claude.com/docs/en/cli-sdks-libraries/cli/authentication'}, {mode: 'oauth', label: 'In-app provider OAuth', support: 'unavailable', source: 'https://platform.claude.com/docs/en/manage-claude/authentication'}],
    openai: [{mode: 'cli', label: 'CLI login (Codex)', support: 'supported', source: 'https://learn.chatgpt.com/docs/auth'}, {mode: 'api_key', label: 'API credential', support: 'supported', source: 'https://developers.openai.com/api/reference/overview'}],
    gemini: [{mode: 'cli', label: 'CLI login (Gemini CLI)', support: 'supported', source: 'https://geminicli.com/docs/get-started/authentication/'}, {mode: 'api_key', label: 'API credential (AI Studio key)', support: 'supported', source: 'https://ai.google.dev/gemini-api/docs/api-key'}, {mode: 'oauth', label: 'OAuth desktop client (your own Cloud project)', support: 'not in this build', source: 'https://ai.google.dev/gemini-api/docs/oauth'}],
    openclaw: [{mode: 'api_key', label: 'API credential (Gateway token)', support: 'supported', source: 'apps/arc-science/docs/architecture.md'}, {mode: 'cli', label: 'CLI login', support: 'unavailable', source: 'native/arc-science/src/settings.rs'}]
  }
};
// Seat nodes as GET /api/readiness builds them: facts (the saved seat and what was read
// about it), a verification (the last probe matched to the seat's subject) and the words.
const PROBED_AT = 1_800_000_000;
const seatNode = (role, state, code, meaning, next_action = null, facts = {}, verification = {status: 'not_tested'}) => ({role, label: {planner: 'Planner', reviewer: 'Reviewer (QA)', falsifier: 'Falsifier', vision: 'Vision', prose: 'Prose'}[role], state, code,
  facts: {provider: settings.seats[role].provider, model: settings.seats[role].model, effort: settings.seats[role].effort, transport: settings.seats[role].auth === 'cli' ? 'cli' : 'api', ...facts},
  verification: {checked_at: null, subject_digest: null, observed_model: null, identity_verified: null, error: null, ...verification}, meaning, next_action, source: 'settings revision ' + revision.slice(0, 12)});
const consoleProfile = {detected: true, profile: 'default', source: 'ant auth status'};
const readiness = {
  checked_at: PROBED_AT,
  session: {kind: 'native', state: 'ready', code: 'session.native', label: 'Desktop session', meaning: 'The desktop app opened this session.', next_action: null, source: 'request header'},
  seats: {
    planner: seatNode('planner', 'ready', 'seat.verified', 'The last probe reached gpt-5.6-sol at medium effort.', null, {credential_ref: 'openai', credential_stored: true, credential_store: 'credential_manager', endpoint: 'https://api.openai.com', endpoint_confirmed: true},
      {status: 'ok', checked_at: PROBED_AT, subject_digest: 'd1', observed_model: 'gpt-5.6-sol', identity_verified: true}),
    reviewer: seatNode('reviewer', 'blocked', 'seat.cli_not_signed_in', 'Claude Code is installed but not signed in.', 'Run `claude` and sign in, then reload readiness.', {executable: 'claude', executable_detected: true, cli_logged_in: false, cli_auth_method: null, console_profile: consoleProfile}),
    falsifier: seatNode('falsifier', 'not_tested', 'seat.not_tested', 'A credential is stored; no call has been made.', 'Test the seat in Settings (spends tokens).', {credential_ref: 'gemini', credential_stored: true, credential_store: 'file'}),
    vision: seatNode('vision', 'failed', 'seat.probe_failed', 'The last probe failed: Credit balance is too low.', 'Fix the cause, then test the seat again in Settings.', {credential_ref: 'openai', credential_stored: true, credential_store: 'credential_manager'},
      {status: 'failed', checked_at: PROBED_AT, subject_digest: 'd2', error: 'Credit balance is too low'}),
    prose: seatNode('prose', 'not_tested', 'seat.custom_model', 'arc-humane-prose-2 is not in the catalog; nothing is assumed about it.', 'Save and run a prose request to check it.', {credential_ref: 'openclaw', credential_stored: true, credential_store: 'file'})
  },
  live_mission: {state: 'blocked', code: 'live.blocked', blocking: ['reviewer'], meaning: 'The reviewer seat is blocked.', next_action: 'Sign in to Claude Code.'},
  providers: {anthropic: {console_profile: consoleProfile}},
  catalog
};
const withSeat = (role, node) => ({...readiness, seats: {...readiness.seats, [role]: node}});
const capabilityReads = () => fetch.mock.calls.filter(([path]) => String(path).includes('/api/capabilities'));
// The desktop host's IPC as the page sees it: a function that receives one JSON string.
const nativeHost = () => { const postMessage = vi.fn(); vi.stubGlobal('ipc', {postMessage}); return postMessage; };
const answer = detail => act(() => { window.dispatchEvent(new CustomEvent('arc-credential', {detail})); });
const json = (data, init = {}) => new Response(JSON.stringify(data), {...init, headers: {'Content-Type': 'application/json', ...(init.headers || {})}});
const put = (base, options, extra = {}) => json({...base, settings: JSON.parse(options.body).settings, changed: ['seats.planner'], effects: [{section: 'seats.planner', applies: 'next live mission start', note: 'Missions already bound to a route keep it; a changed route blocks their resume until it is restored.'}], ...extra});
// The header's token field (main.jsx) stands beside the workspace: autoload listens for it settling.
const shell = props => <><input id="operator-token" aria-label="Operator token"/><SettingsWorkspace token="operator" active readiness={readiness} refreshReadiness={vi.fn(() => Promise.resolve())} {...props}/></>;
const mount = (props = {}) => { const rendered = render(shell(props)); return {...rendered, rerender: next => rendered.rerender(shell(next))}; };
const tokenField = () => byLabel('Operator token');
const settingsReads = () => fetch.mock.calls.filter(([path, options]) => path === '/api/settings' && options?.method !== 'PUT').map(([, options]) => options.headers.Authorization);
const WAITING = 'Settings load when you leave the token field (Tab, Enter or a click elsewhere), or press Load settings.';
// getByLabelText matches every <label> on the page against every control (each select and
// checkbox brings one), which costs about a second per query in jsdom. The controls here are
// named by aria-label, so they are found by that name, still requiring exactly one.
const labelled = (name, root) => [...root.querySelectorAll('[aria-label]')].filter(el => typeof name === 'string' ? el.getAttribute('aria-label') === name : name.test(el.getAttribute('aria-label')));
function byLabel(name, root = document) {
  const found = labelled(name, root);
  if (found.length !== 1) throw new Error(`Expected one element labelled ${name}, found ${found.length}`);
  return found[0];
}
const queryLabel = (name, root = document) => labelled(name, root)[0] || null;
const findLabel = name => waitFor(() => byLabel(name));
// HeroUI selects: the trigger carries the accessible name and shows the chosen item; the
// options exist only while its popover is open.
const field = label => byLabel(label);
const valueOf = label => field(label).querySelector('[data-slot="select-value"]').textContent;
const selectOf = label => field(label).closest('[data-slot="select"]');
async function optionsOf(user, label) {
  await user.click(field(label));
  const names = within(screen.getByRole('listbox')).getAllByRole('option').map(option => option.textContent);
  await user.keyboard('{Escape}');
  return names;
}
async function choose(user, label, name) {
  await user.click(field(label));
  await user.click(within(screen.getByRole('listbox')).getByRole('option', {name}));
}
// Sections are accordion items: the trigger's name starts with the section title.
const openSection = (user, title) => user.click(screen.getByRole('button', {name: new RegExp('^' + title)}));
const cells = (grid, name) => [...within(grid).getByRole('row', {name}).children].map(cell => cell.textContent);

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (path, options = {}) => {
    if (path === '/api/settings' && options.method === 'PUT') return put(snapshot, options);
    if (path === '/api/settings') return json(snapshot);
    if (path === '/api/mcp/servers/check') return json({sdk: 'mcp-1', consented: ['pubmed'], servers: [{server: 'pubmed', ok: true, tools: [{name: 'search', offered: true}]}]});
    if (path === '/api/acp/agents/check') return json({protocol_version: '1', consented: [], agents: [{agent: 'gemini-acp', ok: false, error: 'not signed in'}]});
    if (path === '/api/providers/openai/probe') return json({at: PROBED_AT, transport: 'api', provider: 'openai', results: [{model: 'gpt-5.6-sol', effort: 'medium', roles: ['planner'], transport: 'api', ok: true, observed_model: 'gpt-5.6-sol', identity_verified: true}]});
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
  await findLabel('Planner model');
  expect(valueOf('Planner model')).toBe('GPT-5.6 Sol (gpt-5.6-sol)');
  expect(screen.getByRole('button', {name: 'Reload'})).toBeEnabled();
  expect(screen.queryByRole('button', {name: 'Load settings'})).not.toBeInTheDocument();
  expect(refreshReadiness).toHaveBeenCalledTimes(1);
  expect(settingsReads()).toEqual(['Bearer operator']);
  // Leaving and returning keeps the draft: no second load, even with unsaved edits.
  await choose(userEvent.setup(), 'Planner effort', 'high');
  rendered.rerender({active: false, refreshReadiness});
  rendered.rerender({refreshReadiness});
  expect(settingsReads()).toHaveLength(1);
  expect(valueOf('Planner effort')).toBe('high');
  // A new token resets; the load waits for the field to settle (here: Enter), then runs once.
  rendered.rerender({token: 'operator-2', refreshReadiness});
  expect(screen.getByText(WAITING)).toBeInTheDocument();
  expect(settingsReads()).toHaveLength(1);
  fireEvent.keyDown(tokenField(), {key: 'Enter'});
  await findLabel('Planner effort');
  expect(valueOf('Planner effort')).toBe('medium');
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
  expect(document.body).not.toHaveTextContent(SESSION('expired'));
  // Leaving the field (a click elsewhere, Tab) loads with the token on screen; a stale
  // focusout after the load, or a keystroke, does not load again.
  fireEvent.focusOut(tokenField());
  await findLabel('Planner model');
  expect(valueOf('Planner model')).toBe('GPT-5.6 Sol (gpt-5.6-sol)');
  fireEvent.focusOut(tokenField());
  fireEvent.keyDown(tokenField(), {key: 'a'});
  expect(settingsReads()).toEqual(['Bearer secret']);
  // Shown while another workspace is active, the field settling is not Settings' business.
  rendered.rerender({token: 'secret-2', active: false});
  fireEvent.focusOut(tokenField());
  expect(settingsReads()).toHaveLength(1);
  // Coming back to Settings with that settled token loads it.
  rendered.rerender({token: 'secret-2'});
  await findLabel('Planner model');
  expect(valueOf('Planner model')).toBe('GPT-5.6 Sol (gpt-5.6-sol)');
  expect(settingsReads()).toEqual(['Bearer secret', 'Bearer secret-2']);
});

test('the desktop session loads settings as soon as the shell reports it', async () => {
  const rendered = mount({token: ''});
  rendered.rerender({token: NATIVE_SESSION});
  await findLabel('Planner model');
  expect(valueOf('Planner model')).toBe('GPT-5.6 Sol (gpt-5.6-sol)');
  // One read, on the desktop session's header auth: no bearer token.
  expect(settingsReads()).toHaveLength(1);
  expect(fetch.mock.calls.find(([path]) => path === '/api/settings')[1].headers).not.toHaveProperty('Authorization');
});

test('missing supervisor settings file is actionable, does not show a raw 503, and offers Retry', async () => {
  fetch.mockImplementation(async () => json({detail: 'No settings file is configured for this service'}, {status: 503}));
  mount();
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('No settings file was given to this service.');
  expect(screen.getByText('Settings file not configured')).toBeInTheDocument();
  expect(alert).not.toHaveTextContent('Request failed (503)');
  expect(screen.getByText('Settings did not load. Use Retry or Load settings.')).toBeInTheDocument();
  fetch.mockImplementation(async () => json(snapshot));
  await userEvent.setup().click(within(alert).getByRole('button', {name: 'Retry'}));
  await findLabel('Planner model');
  expect(valueOf('Planner model')).toBe('GPT-5.6 Sol (gpt-5.6-sol)');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('locked and offline states are concise and separate from raw request text', async () => {
  const user = userEvent.setup();
  fetch.mockImplementationOnce(async () => json({detail: 'bad token'}, {status: 401}));
  const rendered = mount({token: 'bad-token'});
  // A rejected token is the one lock notice in the error tone: no alert with the same words.
  const lock = (await screen.findByText(SESSION('expired'))).closest('.bp-lock');
  expect(lock).toHaveAttribute('data-tone', 'error');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent('Request failed (401)');
  expect(within(lock).getByRole('button', {name: 'Go to token field'})).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/paste/i);

  fetch.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
  rendered.rerender({token: 'operator'});
  fireEvent.keyDown(tokenField(), {key: 'Enter'});
  expect(await screen.findByRole('alert')).toHaveTextContent(SESSION('offline'));
  expect(screen.getByRole('alert')).not.toHaveTextContent(SESSION('expired'));
  fetch.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
  await user.click(screen.getByRole('button', {name: 'Load settings'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(SESSION('offline'));
});

test('settings are grouped by user task while advanced controls remain reachable', async () => {
  const user = userEvent.setup();
  mount();
  await findLabel('Planner model');
  expect(valueOf('Planner model')).toBe('GPT-5.6 Sol (gpt-5.6-sol)');
  const settingsRegion = screen.getByRole('region', {name: 'Settings'});
  expect(within(settingsRegion).getByText('Research Models')).toBeVisible();
  expect(within(settingsRegion).getByText('Connections')).toBeVisible();
  expect(within(settingsRegion).getByText('Rendering')).toBeVisible();
  expect(within(settingsRegion).getByText('Viewer')).toBeVisible();
  expect(within(settingsRegion).getByText('Advanced')).toBeVisible();
  expect(within(settingsRegion).getByText('Permissions')).toBeVisible();
  await openSection(user, 'Connections');
  expect(await screen.findByRole('grid', {name: 'CLI logins'})).toHaveTextContent('claude');
  expect(screen.getByRole('button', {name: 'Check MCP servers'})).toBeEnabled();
  expect(screen.getByRole('button', {name: 'Check ACP agents'})).toBeEnabled();
  await openSection(user, 'Rendering');
  expect(screen.getByRole('textbox', {name: 'Blender preset'})).toHaveValue('publication_clean');
  await openSection(user, 'Viewer');
  expect(valueOf('Viewer representation')).toBe('Cartoon');
  await openSection(user, 'Advanced');
  expect(byLabel('OpenClaw agent id')).toHaveValue('trusted-gateway');
  expect(screen.getByRole('checkbox', {name: /Allow third-party AI-text detection/})).not.toBeChecked();
});

test('the model picker lists the provider catalog and a custom id is marked unverified', async () => {
  const user = userEvent.setup();
  mount();
  await findLabel('Planner model');
  // No model chosen shows the "Choose a model" placeholder; the list is the catalog plus a custom id.
  expect(await optionsOf(user, 'Planner model')).toEqual(['GPT-5.6 Sol (gpt-5.6-sol)', 'GPT-5.6 Luna (gpt-5.6-luna)', 'Custom id…']);
  const planner = screen.getByRole('article', {name: 'Planner seat'});
  expect(planner).toHaveTextContent('In catalog 2026-09-21.1, 1,050,000 tokens, vision yes, thinking not stated, catalog source');
  expect(within(planner).getByRole('link', {name: 'catalog source'})).toHaveAttribute('href', 'https://developers.openai.com/api/docs/models');
  expect(queryLabel('Planner custom model id')).not.toBeInTheDocument();
  await choose(user, 'Planner model', 'Custom id…');
  const custom = byLabel('Planner custom model id');
  expect(custom).toHaveValue('gpt-5.6-sol');
  await user.clear(custom);
  await user.type(custom, 'gpt-7-preview');
  expect(planner).toHaveTextContent('Custom id (unverified): not in the catalog; readiness cannot be assumed');
  expect(planner).not.toHaveTextContent('In catalog');
  // Effort options for a custom id are the transport's, since no model list narrows them.
  expect(await optionsOf(user, 'Planner effort')).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  await choose(user, 'Planner model', 'GPT-5.6 Luna (gpt-5.6-luna)');
  expect(queryLabel('Planner custom model id')).not.toBeInTheDocument();
  expect(planner).toHaveTextContent('In catalog 2026-09-21.1');
  // A stored id outside the catalog opens as a custom id: the prose seat on OpenClaw.
  const prose = screen.getByRole('article', {name: 'Prose seat'});
  expect(byLabel('Prose custom model id')).toHaveValue('arc-humane-prose-2');
  expect(prose).toHaveTextContent('Custom id (unverified)');
  await user.click(within(prose).getByText('Sign-in methods'));
  expect(prose).toHaveTextContent('API credential (Gateway token): supported');
  expect(prose).toHaveTextContent('CLI login: unavailable');
  expect(await optionsOf(user, 'Prose sign-in')).toEqual(['API credential (Gateway token)']);
});

test('effort options are the transport list intersected with the model list, disabled at medium when empty', async () => {
  const user = userEvent.setup();
  mount();
  await findLabel('Reviewer (QA) effort');
  expect(await optionsOf(user, 'Reviewer (QA) effort')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  const reviewer = screen.getByRole('article', {name: 'Reviewer (QA) seat'});
  await choose(user, 'Reviewer (QA) model', 'Claude Haiku 4.5 (claude-haiku-4-5-20251001)');
  // The stored effort (high) is kept and marked; Save waits for a choice.
  expect(valueOf('Reviewer (QA) effort')).toBe('high (not accepted)');
  expect(selectOf('Reviewer (QA) effort')).toHaveAttribute('data-invalid', 'true');
  expect(field('Reviewer (QA) effort')).toBeEnabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Reviewer (QA): No effort control on this model/sign-in; the provider default applies; effort high is not accepted, so choose medium.');
  expect(screen.getByRole('button', {name: 'Save'})).toBeDisabled();
  await choose(user, 'Reviewer (QA) effort', 'medium');
  expect(field('Reviewer (QA) effort')).toBeDisabled();
  expect(selectOf('Reviewer (QA) effort')).not.toHaveAttribute('data-invalid');
  expect(reviewer).toHaveTextContent('No effort control on this model/sign-in; the provider default applies.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Save'})).toBeEnabled();
  // Gemini through the CLI has no effort control at all.
  await choose(user, 'Falsifier sign-in', 'CLI login (Gemini CLI)');
  expect(valueOf('Falsifier effort')).toBe('medium');
  expect(field('Falsifier effort')).toBeDisabled();
  expect(screen.getByRole('article', {name: 'Falsifier seat'})).toHaveTextContent('No effort control on this model/sign-in; the provider default applies.');
  expect(byLabel('Falsifier credential')).toHaveAttribute('placeholder', 'not used with CLI login');
  // Gemini API on a model with low/medium/high drops minimal.
  await choose(user, 'Falsifier sign-in', 'API credential (AI Studio key)');
  expect(await optionsOf(user, 'Falsifier effort')).toEqual(['low', 'medium', 'high']);
});

test('changing the provider or sign-in never coerces the stored effort; Save waits for a choice', async () => {
  const user = userEvent.setup();
  mount();
  await findLabel('Planner effort');
  await choose(user, 'Planner effort', 'minimal');
  await choose(user, 'Planner provider', 'Anthropic');
  // The stored effort stays on screen, marked as not accepted.
  expect(valueOf('Planner effort')).toBe('minimal (not accepted)');
  expect(selectOf('Planner effort')).toHaveAttribute('data-invalid', 'true');
  expect(await optionsOf(user, 'Planner effort')).toContain('minimal (not accepted)');
  expect(screen.getByRole('alert')).toHaveTextContent('Planner: Effort minimal is not accepted for this provider, sign-in and model; choose one of low, medium, high, xhigh, max.');
  expect(screen.getByRole('button', {name: 'Save'})).toBeDisabled();
  expect(screen.getByText('Save is off until the seat issues under Research Models are fixed.')).toBeInTheDocument();
  // The model id moved with the seat and is now a custom id for Anthropic.
  expect(byLabel('Planner custom model id')).toHaveValue('gpt-5.6-sol');
  await choose(user, 'Planner effort', 'high');
  expect(selectOf('Planner effort')).not.toHaveAttribute('data-invalid');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Save'})).toBeEnabled();
  // A stored sign-in the provider has no transport for is flagged on the sign-in, not the effort.
  await choose(user, 'Reviewer (QA) provider', 'OpenClaw');
  expect(selectOf('Reviewer (QA) effort')).not.toHaveAttribute('data-invalid');
  expect(valueOf('Reviewer (QA) sign-in')).toBe('CLI login (not supported)');
  expect(selectOf('Reviewer (QA) sign-in')).toHaveAttribute('data-invalid', 'true');
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
  expect(byLabel('Live mission readiness')).toHaveTextContent('Blocked');
  expect(byLabel('Live mission readiness')).toHaveTextContent('The reviewer seat is blocked. Next: Sign in to Claude Code.');
  expect(within(planner).queryByText('Unsaved')).not.toBeInTheDocument();
  await user.clear(byLabel('Planner credential'));
  await user.type(byLabel('Planner credential'), 'openai-2');
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
  const user = userEvent.setup();
  expect(await optionsOf(user, 'Planner provider')).toEqual(['None', 'Anthropic', 'OpenAI', 'Gemini', 'OpenClaw']);
  // The stored id is shown as is: nothing is called unverified or in the catalog without the catalog.
  expect(byLabel('Planner custom model id')).toHaveValue('gpt-5.6-sol');
  expect(planner).toHaveTextContent('Model ids are not checked: catalog not loaded.');
  expect(planner).not.toHaveTextContent('unverified');
  expect(await optionsOf(user, 'Planner effort')).toHaveLength(6);
  expect(selectOf('Planner effort')).not.toHaveAttribute('data-invalid');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('MCP and ACP editors keep consented checks visible after edits', async () => {
  const user = userEvent.setup();
  mount();
  await findLabel('Planner model');
  await openSection(user, 'Connections');
  await user.clear(byLabel('MCP server 1 name'));
  await user.type(byLabel('MCP server 1 name'), 'local-pubmed');
  await user.clear(byLabel('MCP server 1 arguments'));
  await user.type(byLabel('MCP server 1 arguments'), '--stdio --safe');
  await user.click(screen.getByRole('button', {name: 'Check MCP servers'}));
  expect(await findLabel('MCP servers checked')).toHaveTextContent('pubmed');
  expect(byLabel('MCP server 1 name')).toHaveValue('local-pubmed');
  await user.click(screen.getByRole('button', {name: 'Check ACP agents'}));
  expect(await findLabel('ACP agents checked')).toHaveTextContent('not signed in');
  await user.click(screen.getByRole('button', {name: 'Add ACP agent'}));
  expect(byLabel('ACP agent 2 name')).toHaveValue('');
});

test('the Connections tables are readiness facts and verification; nothing asks /api/capabilities', async () => {
  const user = userEvent.setup();
  const rendered = mount();
  await findLabel('Planner model');
  await openSection(user, 'Connections');
  const seats = screen.getByRole('grid', {name: 'Configured seats'});
  expect(cells(seats, 'Planner')).toEqual(['Planner', 'OpenAI', 'API credential (stored in the Windows Credential Manager)', 'gpt-5.6-sol', 'medium']);
  expect(cells(seats, 'Reviewer (QA)')).toEqual(['Reviewer (QA)', 'Anthropic', 'CLI login', 'claude-sonnet-5', 'high']);
  expect(cells(seats, 'Falsifier')).toEqual(['Falsifier', 'Gemini', 'API credential (stored as a file in the data directory)', 'gemini-3.8-flash', 'medium']);
  const logins = screen.getByRole('grid', {name: 'CLI logins'});
  expect(cells(logins, 'Reviewer (QA)')).toEqual(['Reviewer (QA)', 'claude', 'Not signed in', 'Never probed']);
  // An inherited seat is named after its owner, and without a CLI seat there is no login table.
  rendered.rerender({readiness: withSeat('reviewer', seatNode('reviewer', 'not_tested', 'seat.inherits', 'No model of its own; it uses the planner seat', null, {provider: '', model: '', transport: null, inherits_from: 'planner'}))});
  expect(cells(screen.getByRole('grid', {name: 'Configured seats'}), 'Reviewer (QA)')).toEqual(['Reviewer (QA)', 'uses the Planner seat']);
  expect(screen.queryByRole('grid', {name: 'CLI logins'})).not.toBeInTheDocument();
  expect(screen.getByText('No seat uses a CLI login; there is nothing to sign in to.')).toBeInTheDocument();
  rendered.rerender({readiness: null, readinessError: 'Readiness is unavailable: the service returned 503.'});
  expect(screen.getByText('Seat facts did not load: Readiness is unavailable: the service returned 503.')).toBeInTheDocument();
  expect(capabilityReads()).toEqual([]);
  expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/settings']);
});

test('in the desktop window an API seat stores its credential through the host; the page posts a name and reads back an answer', async () => {
  const user = userEvent.setup();
  const postMessage = nativeHost();
  const refreshReadiness = vi.fn(() => Promise.resolve());
  mount({token: NATIVE_SESSION, refreshReadiness});
  const planner = await screen.findByRole('article', {name: 'Planner seat'});
  expect(planner).toHaveTextContent('Credential openai: stored in the Windows Credential Manager.');
  expect(planner).not.toHaveTextContent('Store it from a terminal');
  await user.click(within(planner).getByRole('button', {name: 'Planner store credential'}));
  expect(postMessage).toHaveBeenCalledTimes(1);
  expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({kind: 'store-credential', name: 'openai', provider: 'openai'});
  expect(within(planner).getByRole('status')).toHaveTextContent('Waiting for the Windows credential prompt…');
  expect(screen.getByRole('button', {name: 'Save'})).toBeDisabled();
  // Another name's answer is not this seat's.
  answer({kind: 'store-credential', name: 'gemini', provider: 'gemini', stored: true, cancelled: false, error: null});
  expect(within(planner).getByRole('status')).toHaveTextContent('Waiting for the Windows credential prompt…');
  answer({kind: 'store-credential', name: 'openai', provider: 'openai', stored: true, cancelled: false, error: null});
  expect(await screen.findByText('Credential openai is stored in the Windows Credential Manager as ArcScience/openai.')).toBeInTheDocument();
  expect(refreshReadiness).toHaveBeenLastCalledWith({fresh: true});
  expect(within(planner).queryByRole('status')).not.toBeInTheDocument();
  // A cancelled prompt stores nothing and re-reads nothing.
  await user.click(within(planner).getByRole('button', {name: 'Planner store credential'}));
  answer({kind: 'store-credential', name: 'openai', provider: 'openai', stored: false, cancelled: true, error: null});
  expect(await screen.findByText('The credential prompt was cancelled; nothing was stored.')).toBeInTheDocument();
  expect(refreshReadiness).toHaveBeenCalledTimes(2);
  // A host error is the card under this seat.
  await user.click(within(planner).getByRole('button', {name: 'Planner store credential'}));
  answer({kind: 'store-credential', name: 'openai', provider: 'openai', stored: false, cancelled: false, error: 'The Credential Manager refused the write'});
  expect(await within(planner).findByRole('alert')).toHaveTextContent('Store credential did not complete: The Credential Manager refused the write. Your draft was kept.');
  // Cancel waiting only stops waiting; the prompt, if open, is the host's.
  await user.click(within(planner).getByRole('button', {name: 'Planner store credential'}));
  await user.click(within(planner).getByRole('button', {name: 'Cancel waiting'}));
  expect(await screen.findByText('Stopped waiting for the credential prompt. If it is still open, finish it there, then press Reload.')).toBeInTheDocument();
  expect(within(planner).queryByRole('button', {name: 'Cancel waiting'})).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Save'})).toBeDisabled();
  expect(screen.getByRole('button', {name: 'Reload'})).toBeEnabled();
  // Four requests, each naming the credential and nothing else.
  expect(postMessage.mock.calls.map(([message]) => JSON.parse(message))).toEqual(Array(4).fill({kind: 'store-credential', name: 'openai', provider: 'openai'}));
});

test('Remove credential asks inline before posting; a file credential is not removable from here; a bad name disables both', async () => {
  const user = userEvent.setup();
  const postMessage = nativeHost();
  const refreshReadiness = vi.fn(() => Promise.resolve());
  mount({token: NATIVE_SESSION, refreshReadiness});
  const planner = await screen.findByRole('article', {name: 'Planner seat'});
  await user.click(within(planner).getByRole('button', {name: 'Planner remove credential'}));
  expect(postMessage).not.toHaveBeenCalled();
  const confirm = within(planner).getByRole('group', {name: 'Planner remove confirmation'});
  expect(confirm).toHaveTextContent('Remove ArcScience/openai from the Windows Credential Manager? Seats naming it stop working until a new one is stored.');
  await user.click(within(confirm).getByRole('button', {name: 'Keep it'}));
  expect(within(planner).queryByRole('group', {name: 'Planner remove confirmation'})).not.toBeInTheDocument();
  expect(postMessage).not.toHaveBeenCalled();
  await user.click(within(planner).getByRole('button', {name: 'Planner remove credential'}));
  await user.click(within(planner).getByRole('button', {name: 'Planner confirm remove'}));
  expect(postMessage.mock.calls.map(([message]) => JSON.parse(message))).toEqual([{kind: 'remove-credential', name: 'openai'}]);
  answer({kind: 'remove-credential', name: 'openai', provider: 'openai', stored: false, cancelled: false, error: null});
  expect(await screen.findByText('Credential openai was removed from the Windows Credential Manager.')).toBeInTheDocument();
  expect(refreshReadiness).toHaveBeenLastCalledWith({fresh: true});
  const falsifier = screen.getByRole('article', {name: 'Falsifier seat'});
  expect(falsifier).toHaveTextContent('Credential gemini: stored as a file in the data directory.');
  expect(within(falsifier).getByRole('button', {name: 'Falsifier remove credential'})).toBeDisabled();
  expect(within(falsifier).getByRole('button', {name: 'Falsifier store credential'})).toBeEnabled();
  expect(falsifier).toHaveTextContent('A file credential is removed by deleting it from the data directory, not from here.');
  await user.clear(byLabel('Falsifier credential'));
  await user.type(byLabel('Falsifier credential'), 'bad name!');
  expect(within(falsifier).getByRole('button', {name: 'Falsifier store credential'})).toBeDisabled();
  expect(within(falsifier).getByRole('button', {name: 'Falsifier remove credential'})).toBeDisabled();
  expect(falsifier).toHaveTextContent('Give the credential a name first: 1–80 letters, digits, dots, underscores or hyphens.');
});

test('outside the desktop window the credential is stored from a terminal; no host prompt is offered', async () => {
  const rendered = mount();
  const planner = await screen.findByRole('article', {name: 'Planner seat'});
  expect(planner).toHaveTextContent('Store it from a terminal: arc-science credential --name openai --data <data dir>');
  expect(within(planner).queryByRole('button', {name: 'Planner store credential'})).not.toBeInTheDocument();
  expect(within(planner).queryByRole('button', {name: 'Planner remove credential'})).not.toBeInTheDocument();
  expect(within(planner).getByRole('button', {name: 'Planner test seat'})).toBeInTheDocument();
  // A desktop session whose host offers no IPC (an older shell) gets the same line.
  rendered.unmount();
  mount({token: NATIVE_SESSION});
  expect(await screen.findByRole('article', {name: 'Planner seat'})).toHaveTextContent('Store it from a terminal');
  expect(screen.queryByRole('button', {name: 'Planner store credential'})).not.toBeInTheDocument();
});

test('Test seat waits for its consent tick, probes the saved seat\'s provider and reads the result through readiness', async () => {
  const user = userEvent.setup();
  const refreshReadiness = vi.fn(() => Promise.resolve());
  mount({refreshReadiness});
  const planner = await screen.findByRole('article', {name: 'Planner seat'});
  const testSeat = within(planner).getByRole('button', {name: 'Planner test seat'});
  expect(testSeat).toBeDisabled();
  expect(planner).toHaveTextContent('Tick the consent box to enable Test seat.');
  const consent = byLabel('Planner probe consent', planner);
  expect(consent.closest('label')).toHaveTextContent('One real call per distinct seat of OpenAI; it spends tokens on your account');
  await user.click(consent);
  expect(testSeat).toBeEnabled();
  // The other seats keep waiting for their own tick.
  expect(within(screen.getByRole('article', {name: 'Falsifier seat'})).getByRole('button', {name: 'Falsifier test seat'})).toBeDisabled();
  await user.click(testSeat);
  const probeCall = fetch.mock.calls.find(([path]) => path === '/api/providers/openai/probe');
  expect(probeCall[1].method).toBe('POST');
  expect(JSON.parse(probeCall[1].body)).toEqual({spend_tokens: true});
  await vi.waitFor(() => expect(refreshReadiness).toHaveBeenCalledTimes(2));
  // The tick is spent by the click; the words come from readiness, not from the reply.
  expect(consent).not.toBeChecked();
  expect(testSeat).toBeDisabled();
  expect(planner).toHaveTextContent('Last probe ' + when(PROBED_AT) + ', answering model gpt-5.6-sol, identity verified');
  expect(screen.getByRole('article', {name: 'Vision seat'})).toHaveTextContent('Probe failed: Credit balance is too low');
  expect(screen.getByRole('article', {name: 'Falsifier seat'})).toHaveTextContent('Never probed');
  // An edited seat is not what a probe would test.
  await user.click(consent);
  await choose(user, 'Planner effort', 'high');
  expect(testSeat).toBeDisabled();
  expect(planner).toHaveTextContent('Save the seat first; Test seat uses the saved seat.');
});

test('a CLI seat shows the login as read, Re-check re-reads it, and the ant profile is reported only', async () => {
  const user = userEvent.setup();
  const refreshReadiness = vi.fn(() => Promise.resolve());
  const rendered = mount({refreshReadiness});
  const reviewer = await screen.findByRole('article', {name: 'Reviewer (QA) seat'});
  expect(reviewer).toHaveTextContent('Not signed in. Sign in inside Claude Code, then press Re-check.');
  expect(within(reviewer).queryByRole('button', {name: 'Reviewer (QA) store credential'})).not.toBeInTheDocument();
  expect(reviewer).not.toHaveTextContent('Store it from a terminal');
  expect(reviewer).toHaveTextContent('Never probed');
  await user.click(within(reviewer).getByRole('button', {name: 'Reviewer (QA) re-check'}));
  expect(refreshReadiness).toHaveBeenLastCalledWith({fresh: true});
  rendered.rerender({refreshReadiness, readiness: withSeat('reviewer', seatNode('reviewer', 'not_tested', 'seat.not_tested', 'Configured; never probed', 'Test the seat in Settings (spends tokens)',
    {executable: 'claude', executable_detected: true, cli_logged_in: true, cli_auth_method: 'oauth', console_profile: consoleProfile}))});
  expect(reviewer).toHaveTextContent('Signed in via claude (oauth). Sign in inside Claude Code, then press Re-check.');
  await user.click(within(reviewer).getByText('Sign-in methods'));
  expect(reviewer).toHaveTextContent('Console profile via the external `ant` CLI: detected (default) — reported only, not used');
  expect(reviewer).toHaveTextContent('In-app provider OAuth: unavailable');
  rendered.rerender({refreshReadiness, readiness: {...readiness, providers: {anthropic: {console_profile: {detected: false, profile: null, source: 'ant auth status'}}}}});
  expect(reviewer).toHaveTextContent('Console profile via the external `ant` CLI: not detected — reported only, not used');
});

test('a custom endpoint shows its confirmation only when the origin differs; the seat stays unconfirmed until it is saved', async () => {
  const user = userEvent.setup();
  const custom = {...snapshot, settings: {...settings, providers: {...settings.providers, openai: {...settings.providers.openai, endpoint: 'https://proxy.example.net/v1'}}}};
  fetch.mockImplementation(async (path, options = {}) => {
    if (path === '/api/settings' && options.method === 'PUT') return put(custom, options, {changed: ['providers.openai'], effects: [{section: 'providers.openai', applies: 'next live mission start', note: ''}]});
    if (path === '/api/settings') return json(custom);
    throw new Error('Unexpected request ' + path);
  });
  const refreshReadiness = vi.fn(() => Promise.resolve());
  const unconfirmed = seatNode('planner', 'blocked', 'seat.endpoint_unconfirmed', 'providers.openai.endpoint https://proxy.example.net is not the official origin; the credential is not sent there until it is confirmed',
    'Confirm the custom endpoint under Settings → Advanced, or clear it', {credential_ref: 'openai', endpoint: 'https://proxy.example.net', endpoint_confirmed: false});
  mount({refreshReadiness, readiness: withSeat('planner', unconfirmed)});
  const planner = await screen.findByRole('article', {name: 'Planner seat'});
  expect(within(planner).getByText('Blocked')).toBeInTheDocument();
  expect(planner).toHaveTextContent('https://proxy.example.net is not the official origin; the credential is not sent there until it is confirmed');
  expect(planner).toHaveTextContent('Next: Confirm the custom endpoint under Settings → Advanced, or clear it');
  await openSection(user, 'Advanced');
  const confirm = byLabel('OpenAI custom endpoint confirmed');
  expect(confirm).not.toBeChecked();
  expect(confirm.closest('label')).toHaveTextContent('This endpoint may receive the credential (custom endpoint confirmed)');
  expect(screen.getByText('Off the official origin https://api.openai.com. Until this is ticked and saved, the credential is not sent there.')).toBeInTheDocument();
  // The official origin, with or without a path, and OpenClaw (custom by nature) show no box.
  expect(queryLabel('Anthropic custom endpoint confirmed')).not.toBeInTheDocument();
  expect(queryLabel('OpenClaw custom endpoint confirmed')).not.toBeInTheDocument();
  await user.type(byLabel('Anthropic endpoint'), '/v1');
  expect(queryLabel('Anthropic custom endpoint confirmed')).not.toBeInTheDocument();
  await user.clear(byLabel('Anthropic endpoint'));
  await user.type(byLabel('Anthropic endpoint'), 'https://relay.example.net');
  expect(byLabel('Anthropic custom endpoint confirmed')).not.toBeChecked();
  await user.clear(byLabel('Anthropic endpoint'));
  await user.type(byLabel('Anthropic endpoint'), 'https://api.anthropic.com');
  // Ticking is a draft edit: the seat keeps the server's state until the save is read back.
  await user.click(confirm);
  expect(within(planner).getByText('Blocked')).toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Save'})).toBeEnabled();
  await user.click(screen.getByRole('button', {name: 'Save'}));
  expect(await screen.findByText(/^Saved \(revision aaaaaaaaaaaa\)\. OpenAI provider: applies at next live mission start\./)).toBeInTheDocument();
  const saved = JSON.parse(fetch.mock.calls.find(([, options]) => options?.method === 'PUT')[1].body);
  expect(saved.settings.providers.openai).toEqual({endpoint: 'https://proxy.example.net/v1', cli: 'codex', agent_id: '', isolated: true, custom_endpoint_confirmed: true});
  // Typing an endpoint resets its confirmation (a confirmation belongs to one origin), so the flag is written as false.
  expect(saved.settings.providers.anthropic.custom_endpoint_confirmed).toBe(false);
  expect(refreshReadiness).toHaveBeenCalledTimes(2);
});

test('the save notice names each changed section, when it applies, the restart note and bound missions', async () => {
  const refreshReadiness = vi.fn(() => Promise.resolve());
  fetch.mockImplementation(async (path, options = {}) => {
    if (path === '/api/settings' && options.method === 'PUT') return json({...snapshot, revision: newer, settings: JSON.parse(options.body).settings, changed: ['blender', 'seats.planner'],
      effects: [{section: 'blender', applies: 'next render submission', note: ''}, {section: 'seats.planner', applies: 'next live mission start', note: 'Missions already bound to a route keep it; a changed route blocks their resume until it is restored.'}],
      restart_required: [], restart_note: 'No setting in this build needs a restart.', bound_missions: 2});
    if (path === '/api/settings') return json(snapshot);
    throw new Error('Unexpected request ' + path);
  });
  const user = userEvent.setup();
  mount({refreshReadiness});
  expect(await screen.findByText('No unsaved edits.')).toBeInTheDocument();
  await openSection(user, 'Rendering');
  await user.type(screen.getByRole('textbox', {name: 'Blender preset'}), '-2');
  await choose(user, 'Planner effort', 'high');
  await user.click(screen.getByRole('button', {name: 'Save'}));
  expect(await screen.findByText('Saved (revision bbbbbbbbbbbb). Rendering: applies at next render submission. Planner seat: applies at next live mission start. Missions already bound to a route keep it; a changed route blocks their resume until it is restored. No setting in this build needs a restart. 2 missions keep the route they were bound to.')).toBeInTheDocument();
  expect(screen.getByText(/Revision bbbbbbbbbbbb, saved/)).toBeInTheDocument();
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
  const credential = await findLabel('Planner credential');
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
    throw new Error('Unexpected request ' + path);
  });
  await user.click(within(alert).getByRole('button', {name: 'Reload and keep my edits'}));
  expect(await screen.findByText('Edits re-applied onto revision bbbbbbbbbbbb; review and save')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(byLabel('Planner credential')).toHaveValue('planner-2');
  // The other party's changes are in the draft; only the planner credential was re-applied.
  expect(valueOf('Vision model')).toBe('GPT-5.6 Sol (gpt-5.6-sol)');
  expect(screen.getByText(/Revision bbbbbbbbbbbb, unsaved edits/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', {name: 'Save'}));
  expect(await screen.findByText(/^Saved \(revision bbbbbbbbbbbb\)/)).toBeInTheDocument();
  const saved = JSON.parse(fetch.mock.calls.filter(([, options]) => options?.method === 'PUT').at(-1)[1].body);
  expect(saved.if_revision).toBe(newer);
  expect(saved.settings.seats.planner.credential).toBe('planner-2');
  expect(saved.settings.blender.default_preset).toBe('publication_clean_v2');
});

test('a refused probe is reported under its seat and the locked card can reach the token field', async () => {
  const user = userEvent.setup();
  const setToken = vi.fn();
  mount({token: NATIVE_SESSION, setToken});
  const planner = await screen.findByRole('article', {name: 'Planner seat'});
  await user.click(byLabel('Planner probe consent', planner));
  fetch.mockImplementationOnce(async () => json({detail: 'Probe cooldown: wait before spending again'}, {status: 429}));
  await user.click(within(planner).getByRole('button', {name: 'Planner test seat'}));
  const alert = await within(planner).findByRole('alert');
  expect(alert).toHaveTextContent('Test Planner seat did not complete: Probe cooldown: wait before spending again. Your draft was kept.');
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  fetch.mockImplementationOnce(async () => json({detail: 'stale'}, {status: 401}));
  await user.click(screen.getByRole('button', {name: 'Reload'}));
  const lock = (await screen.findByText(SESSION('nativeExpired'))).closest('.bp-lock');
  expect(lock).toHaveAttribute('data-tone', 'error');
  expect(lock).toHaveTextContent('Your draft stays in this window.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(valueOf('Planner model')).toBe('GPT-5.6 Sol (gpt-5.6-sol)');
  await user.click(within(lock).getByRole('button', {name: 'Use operator token'}));
  expect(setToken).toHaveBeenCalledWith('');
  await vi.waitFor(() => expect(document.getElementById('operator-token')).toHaveFocus());
});

// The ledger as GET /api/grants lists it: fields as stored plus the derived state, uses and last use.
const ROUTE = 'c'.repeat(64), MISSION = 'd'.repeat(32), NIH = 'https://eutils.ncbi.nlm.nih.gov';
const grant = (id, patch) => ({id, subject_kind: 'mission', subject_id: MISSION, destination: 'https://api.openai.com', destination_kind: 'seat', data_category: 'mission goal, dataset points, prior observations and assessments',
  purpose: 'planning, review and refutation', scope: 'mission', route_digest: ROUTE, settings_revision: revision, source: 'operator-ui', granted_at: PROBED_AT, expires_at: null, max_uses: null,
  state: 'active', uses: 0, last_used_at: null, revoked_at: null, ...patch});
const ledger = () => [
  grant('1'.repeat(32), {uses: 3, last_used_at: PROBED_AT + 60}),
  grant('2'.repeat(32), {destination: 'pubmed-mcp --stdio', destination_kind: 'mcp', data_category: 'tool arguments the planner chooses', purpose: 'consultation or tool call', state: 'revoked', uses: 1, last_used_at: PROBED_AT + 30, revoked_at: PROBED_AT + 90}),
  grant('3'.repeat(32), {subject_kind: 'request', subject_id: 'r'.repeat(32), destination_kind: 'prose', data_category: 'the text being edited', purpose: 'prose editing', scope: 'once', max_uses: 1, state: 'exhausted', uses: 1, last_used_at: PROBED_AT + 5}),
  grant('4'.repeat(32), {subject_kind: 'persistent', subject_id: '', destination: NIH, destination_kind: 'public_read', data_category: 'query text the planner chooses', purpose: 'public read', scope: 'persistent'})
];
const grantReads = () => fetch.mock.calls.filter(([path, options]) => path === '/api/grants' && options?.method !== 'POST');
const revokes = () => fetch.mock.calls.filter(([, options]) => options?.method === 'POST');
const withLedger = rows => fetch.mockImplementation(async (path, options = {}) => {
  if (path === '/api/settings') return json(snapshot);
  if (path === '/api/grants') return json({grants: rows});
  const revoke = /^\/api\/grants\/([0-9a-f]{32})\/revoke$/.exec(path);
  if (revoke && options.method === 'POST') {
    const row = rows.find(item => item.id === revoke[1]); Object.assign(row, {state: 'revoked', revoked_at: PROBED_AT + 120});
    return json({seq: 9, grant_id: row.id, kind: 'revoked', at: PROBED_AT + 120, detail: JSON.parse(options.body).reason});
  }
  throw new Error('Unexpected request ' + path);
});
const openPermissions = async user => { await openSection(user, 'Permissions'); return byLabel('Permissions'); };
const grantsTable = () => screen.getByRole('grid', {name: 'Grants'});

test('Permissions reads the ledger only when the section opens, lists each grant with its state and filters them', async () => {
  const user = userEvent.setup();
  withLedger(ledger());
  mount();
  await findLabel('Planner model');
  const permissions = byLabel('Permissions');
  expect(permissions).toHaveTextContent('A mission is granted access only when you approve its route in Research.');
  expect(permissions).toHaveTextContent('Permissions load when this section opens.');
  expect(grantReads()).toHaveLength(0);
  await openPermissions(user);
  const table = await within(permissions).findByRole('grid', {name: 'Grants'});
  expect(grantReads()).toHaveLength(1);
  expect(within(table).getAllByRole('row').slice(1).map(row => row.textContent)).toEqual([
    'seathttps://api.openai.commission goal, dataset points, prior observations and assessmentsmissionActive3' + when(PROBED_AT + 60) + 'mission ' + MISSION + 'Revoke',
    'mcppubmed-mcp --stdiotool arguments the planner choosesmissionRevoked1' + when(PROBED_AT + 30) + 'mission ' + MISSION + 'Revoke',
    'prosehttps://api.openai.comthe text being editedonceExhausted1 of 1' + when(PROBED_AT + 5) + 'requestRevoke',
    'public read' + NIH + 'query text the planner choosespersistentActive0neverpersistentRevoke'
  ]);
  // Only an active grant can be revoked; the others are already refused.
  expect(within(table).getAllByRole('button', {name: /^Revoke grant /}).map(button => button.disabled)).toEqual([false, true, true, false]);
  expect(valueOf('Show')).toBe('All');
  await choose(user, 'Show', 'Revoked');
  expect(within(grantsTable()).getAllByRole('row')).toHaveLength(2);
  expect(grantsTable()).toHaveTextContent('pubmed-mcp --stdio');
  await choose(user, 'Show', 'Active');
  expect(within(grantsTable()).getAllByRole('row')).toHaveLength(3);
  // Refresh re-reads without the filter as a parameter; an empty ledger says so.
  withLedger([]);
  await user.click(screen.getByRole('button', {name: 'Refresh permissions'}));
  expect(await within(permissions).findByText('No grants yet.')).toBeInTheDocument();
  expect(grantReads().map(([path]) => path)).toEqual(['/api/grants', '/api/grants']);
  expect(fetch.mock.calls.filter(([path]) => path === '/api/settings')).toHaveLength(1);
});

test('Revoke asks for a reason, posts it to the grant and re-reads the ledger', async () => {
  const user = userEvent.setup();
  withLedger(ledger());
  mount();
  await findLabel('Planner model');
  const permissions = await openPermissions(user);
  const table = await within(permissions).findByRole('grid', {name: 'Grants'});
  await user.click(within(table).getByRole('button', {name: 'Revoke grant ' + NIH}));
  // The reason form opens under the table, for that grant only.
  const form = within(permissions).getByRole('group', {name: 'Revoke the grant for ' + NIH});
  const confirm = within(form).getByRole('button', {name: 'Confirm revoke ' + NIH});
  expect(confirm).toBeDisabled();
  await user.type(byLabel('Revoke reason ' + NIH, form), '  wrong host  ');
  expect(confirm).toBeEnabled();
  // Keep it withdraws without a request.
  await user.click(within(form).getByRole('button', {name: 'Keep it'}));
  expect(queryLabel('Revoke reason ' + NIH)).not.toBeInTheDocument();
  expect(revokes()).toHaveLength(0);
  await user.click(within(table).getByRole('button', {name: 'Revoke grant ' + NIH}));
  await user.type(byLabel('Revoke reason ' + NIH), '  wrong host  ');
  await user.click(screen.getByRole('button', {name: 'Confirm revoke ' + NIH}));
  expect(await screen.findByText('Revoked the grant for ' + NIH + '; its next call is refused.')).toBeInTheDocument();
  expect(revokes().map(([path]) => path)).toEqual(['/api/grants/' + '4'.repeat(32) + '/revoke']);
  expect(JSON.parse(revokes()[0][1].body)).toEqual({reason: 'wrong host'});
  expect(grantReads()).toHaveLength(2);
  const row = within(grantsTable()).getAllByRole('row').at(-1);
  expect(row).toHaveTextContent('Revoked');
  expect(within(row).getByRole('button', {name: 'Revoke grant ' + NIH})).toBeDisabled();
  expect(queryLabel(/Revoke reason/)).not.toBeInTheDocument();
  // A refused revoke is the card under this section; the ledger on screen is unchanged.
  // Two grants name the seat origin (mission and prose request), so the row scopes the lookup.
  const seat = () => within(grantsTable()).getAllByRole('row')[1];
  await user.click(within(seat()).getByRole('button', {name: 'Revoke grant https://api.openai.com'}));
  await user.type(byLabel('Revoke reason https://api.openai.com'), 'done with it');
  fetch.mockImplementationOnce(async () => json({detail: 'Unknown grant'}, {status: 404}));
  await user.click(screen.getByRole('button', {name: 'Confirm revoke https://api.openai.com'}));
  expect(await within(permissions).findByRole('alert')).toHaveTextContent('Revoke grant did not complete: Unknown grant. Your draft was kept.');
  expect(seat()).toHaveTextContent('Active');
  expect(grantReads()).toHaveLength(2);
});

test('the workspace reads in Russian, and Appearance drives the palette, motion and language of the shell', async () => {
  const user = userEvent.setup();
  const appearance = {palette: 'arc-paper', onPalette: vi.fn(), motion: 'system', onMotion: vi.fn(), locale: 'ru', setLocale: vi.fn()};
  render(<I18nProvider locale="ru"><input id="operator-token" aria-label="Operator token"/>
    <SettingsWorkspace token="operator" active readiness={readiness} refreshReadiness={vi.fn(() => Promise.resolve())} appearance={appearance}/></I18nProvider>);
  const planner = await screen.findByRole('article', {name: 'Модель роли «Планировщик»'});
  expect(within(planner).getByText('Готово')).toBeInTheDocument();
  expect(within(screen.getByRole('region', {name: 'Настройки'})).getByText('Модели исследования')).toBeVisible();
  expect(screen.getByRole('button', {name: 'Перезагрузить'})).toBeEnabled();
  expect(screen.getByRole('button', {name: 'Сохранить'})).toBeDisabled();
  expect(screen.getByText('Несохранённых правок нет.')).toBeInTheDocument();
  // Appearance needs no session: it hands each choice to the shell.
  await openSection(user, 'Оформление');
  await user.click(screen.getByRole('radio', {name: 'EN'}));
  expect(appearance.setLocale).toHaveBeenCalledWith('en');
  await user.click(screen.getByRole('radio', {name: 'Выключена'}));
  expect(appearance.onMotion).toHaveBeenCalledWith('off');
});
