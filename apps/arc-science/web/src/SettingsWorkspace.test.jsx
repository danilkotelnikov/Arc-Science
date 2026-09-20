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
let calls, stored, revision;

beforeEach(() => {
  calls = []; stored = settings(); revision = 'a'.repeat(64);
  vi.stubGlobal('fetch', vi.fn(async (path, options = {}) => {
    calls.push({path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, auth: options.headers?.Authorization});
    if (path === '/api/settings' && (options.method || 'GET') === 'GET') return json({settings: stored, revision, path: 'C:/ws/settings.toml', applied_live: ['seats'], restart_required: []});
    if (path === '/api/settings' && options.method === 'PUT') {
      const body = JSON.parse(options.body);
      if (body.if_revision !== revision) return json({detail: 'Settings changed since they were read; reload and try again'}, 409);
      if (body.settings.seats.planner.provider && !body.settings.seats.planner.model) return json({detail: 'seats.planner.model must name one model when a provider is set'}, 422);
      stored = body.settings; revision = 'b'.repeat(64);
      return json({settings: stored, revision, path: 'C:/ws/settings.toml', applied_live: ['seats', 'providers'], stored_pending: ['seats.effort'], restart_required: []});
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
  expect(await screen.findByRole('status')).toHaveTextContent('Saved. Applied live: seats, providers. Stored for later loops: seats.effort.');
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
  expect(put.body.settings.acp_agents).toEqual([{name: 'gemini', command: 'gemini', args: ['--acp'], enabled: true}]);
});
