import React from 'react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {act, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MemoryWorkspace from './MemoryWorkspace';

const json = data => new Response(JSON.stringify(data), {headers: {'Content-Type': 'application/json'}});
const health = {protocol: 'arc-memory/1', sqlite: '3.53.2', retrieval_modes: ['lexical'], capture: {status: 'ready', pending: 0, last_error: null}};
const record = {record_id: 'record-1', session_id: 'private-session', role: 'planner', seq: 1, compaction_epoch: 0, text: 'Private remembered finding', trust: 'model_output', content_digest: 'a'.repeat(64)};
let removed;

beforeEach(() => {
  removed = false;
  vi.stubGlobal('fetch', vi.fn(async (path) => {
    if (path.endsWith('/health')) return json(health);
    if (path.endsWith('/disable')) { removed = true; return json({disabled: true}); }
    if (path.includes('/sessions/')) return json(removed ? [] : [record]);
    if (path.includes('/sessions?')) return json(removed ? [] : [{session_id: 'private-session', record_count: 1, first_seq: 1, last_seq: 1, min_epoch: 0, max_epoch: 0}]);
    if (path.endsWith('/search')) return json(removed ? [] : [{record, reason: 'lexical', score: 1}]);
    throw new Error('Unexpected request ' + path);
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('defaults to lexical and explains unavailable semantic modes from health', async () => {
  const user = userEvent.setup(); render(<MemoryWorkspace token="private-token" setToken={vi.fn()}/>);
  expect(screen.getByLabelText('Retrieval')).toHaveValue('lexical');
  expect(screen.getByRole('option', {name: /Semantic/})).toBeDisabled();
  await user.click(screen.getByRole('button', {name: 'Load sessions'}));
  expect(await screen.findByText(/Available retrieval: lexical/)).toBeInTheDocument();
  expect(screen.getByRole('option', {name: /Hybrid/})).toBeDisabled();
  expect(screen.getByText(/Semantic and hybrid retrieval are unavailable/)).toBeInTheDocument();
  await user.type(screen.getByLabelText('Search memory'), 'remembered');
  await user.click(screen.getByRole('button', {name: 'Search'}));
  await screen.findByText('Private remembered finding');
  const call = fetch.mock.calls.find(([path]) => path.endsWith('/search'));
  expect(JSON.parse(call[1].body)).toMatchObject({mode: 'lexical', session: null});
  expect(call[1].headers.Authorization).toBe('Bearer private-token');
  expect(fetch.mock.calls.every(([path]) => !path.includes('private-token'))).toBe(true);
});

test('health enables only advertised retrieval and shows degraded capture with pending work', async () => {
  const original = fetch.getMockImplementation();
  fetch.mockImplementation((path, options) => path.endsWith('/health') ? Promise.resolve(json({...health, retrieval_modes: ['lexical', 'semantic'], capture: {status: 'degraded', pending: 2, last_error: 'Capture worker unavailable'}})) : original(path, options));
  const user = userEvent.setup(); render(<MemoryWorkspace token="operator" setToken={vi.fn()}/>);
  await user.click(screen.getByRole('button', {name: 'Load sessions'}));
  expect(await screen.findByText(/Capture: degraded · 2 pending/)).toBeInTheDocument();
  expect(screen.getByText('Capture worker unavailable')).toBeInTheDocument();
  expect(screen.getByRole('option', {name: 'Semantic'})).not.toBeDisabled();
  expect(screen.getByRole('option', {name: /Hybrid/})).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('Retrieval'), 'semantic');
  await user.type(screen.getByLabelText('Search memory'), 'finding');
  await user.click(screen.getByRole('button', {name: 'Search'}));
  await screen.findByText('Private remembered finding');
  expect(JSON.parse(fetch.mock.calls.find(([path]) => path.endsWith('/search'))[1].body).mode).toBe('semantic');
});

test('explicit scope switches between all sessions and the selected session', async () => {
  const user = userEvent.setup(); render(<MemoryWorkspace token="operator" setToken={vi.fn()}/>);
  await user.click(screen.getByRole('button', {name: 'Load sessions'}));
  await user.click(await screen.findByRole('button', {name: /private-session · 1 records/}));
  await screen.findByText('Private remembered finding');
  expect(screen.getByLabelText('Search scope')).toHaveValue('all');
  await user.type(screen.getByLabelText('Search memory'), 'finding');
  await user.selectOptions(screen.getByLabelText('Search scope'), 'selected');
  await user.click(screen.getByRole('button', {name: 'Search'}));
  await screen.findByText(/Search · lexical · private-session/);
  await user.selectOptions(screen.getByLabelText('Search scope'), 'all');
  await user.click(screen.getByRole('button', {name: 'Search'}));
  await screen.findByText(/Search · lexical · all sessions/);
  expect(fetch.mock.calls.filter(([path]) => path.endsWith('/search')).map(([, options]) => JSON.parse(options.body).session)).toEqual(['private-session', null]);
});

test('a failed refresh does not keep reporting the previous healthy capture state', async () => {
  const user = userEvent.setup(); render(<React.StrictMode><MemoryWorkspace token="operator" setToken={vi.fn()}/></React.StrictMode>);
  await user.click(screen.getByRole('button', {name: 'Load sessions'}));
  await screen.findByText(/Capture: ready/);
  fetch.mockImplementationOnce(async () => new Response(JSON.stringify({detail: 'Memory worker unavailable'}), {status: 503}));
  await user.click(screen.getByRole('button', {name: 'Load sessions'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Memory worker unavailable');
  expect(screen.queryByText(/Capture: ready/)).not.toBeInTheDocument();
});

test('intentional removal refreshes records and sidebar counts and excludes later search hits', async () => {
  const user = userEvent.setup(); render(<MemoryWorkspace token="operator" setToken={vi.fn()}/>);
  await user.click(screen.getByRole('button', {name: 'Load sessions'}));
  await user.click(await screen.findByRole('button', {name: /private-session · 1 records/}));
  await screen.findByText('Private remembered finding');
  expect(fetch.mock.calls.some(([path]) => path.endsWith('/disable'))).toBe(false);
  await user.click(screen.getByRole('button', {name: 'Remove from retrieval'}));
  expect(await screen.findByText(/Removed from retrieval/)).toBeInTheDocument();
  expect(screen.queryByText('Private remembered finding')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {name: /private-session · 1 records/})).not.toBeInTheDocument();
  expect(screen.getByText('0 loaded')).toBeInTheDocument();
  await user.type(screen.getByLabelText('Search memory'), 'finding');
  await user.click(screen.getByRole('button', {name: 'Search'}));
  expect(await screen.findByText(/No matching memory/)).toBeInTheDocument();
});

test('token change clears private state and rejects an old response even during body decoding', async () => {
  const user = userEvent.setup(); const setToken = vi.fn();
  const {rerender} = render(<MemoryWorkspace token="old-token" setToken={setToken}/>);
  await user.click(screen.getByRole('button', {name: 'Load sessions'}));
  await user.click(await screen.findByRole('button', {name: /private-session · 1 records/}));
  await screen.findByText('Private remembered finding');
  let finish;
  fetch.mockImplementationOnce(async () => ({ok: true, json: () => new Promise(resolve => { finish = resolve; })}));
  await user.type(screen.getByLabelText('Search memory'), 'sensitive query');
  await user.click(screen.getByRole('button', {name: 'Search'}));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  const signal = fetch.mock.calls.at(-1)[1].signal;
  rerender(<MemoryWorkspace token="new-token" setToken={setToken}/>);
  expect(signal.aborted).toBe(true);
  expect(screen.getByLabelText('Search memory')).toHaveValue('sensitive query');
  expect(screen.queryByText('Private remembered finding')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {name: /private-session/})).not.toBeInTheDocument();
  await act(async () => finish([{record, reason: 'lexical', score: 1}]));
  expect(screen.queryByText('Private remembered finding')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Load sessions'})).not.toBeDisabled();
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
});

test('locked and expired memory states preserve the draft query without dispatching raw 401 text', async () => {
  const user = userEvent.setup();
  const rendered = render(<MemoryWorkspace token="" setToken={vi.fn()}/>);
  await user.type(screen.getByLabelText('Search memory'), 'kinase memory');
  expect(screen.getByRole('button', {name: 'Search'})).toBeDisabled();
  expect(screen.getByRole('button', {name: 'Load sessions'})).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Local unlock required');
  expect(screen.getByRole('status')).toHaveTextContent('arc-science token --data ./data');
  expect(screen.getByRole('status')).toHaveTextContent('token file');
  expect(fetch).not.toHaveBeenCalled();

  fetch.mockImplementationOnce(async () => new Response(JSON.stringify({detail: 'bad token'}), {status: 401, headers: {'Content-Type': 'application/json'}}));
  rendered.rerender(<MemoryWorkspace token="expired-token" setToken={vi.fn()}/>);
  expect(screen.getByLabelText('Search memory')).toHaveValue('kinase memory');
  await user.click(screen.getByRole('button', {name: 'Load sessions'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Operator session is locked or expired');
  expect(screen.getByRole('alert')).not.toHaveTextContent('Request failed (401)');
  expect(screen.getByLabelText('Search memory')).toHaveValue('kinase memory');
  expect(screen.getByRole('status')).toHaveTextContent('Operator token expired');
  expect(screen.getByRole('button', {name: 'Load sessions'})).toBeDisabled();
  expect(screen.getByRole('button', {name: 'Search'})).toBeDisabled();
  await user.click(screen.getByRole('button', {name: 'Go to token field'}));
});

test('offline memory errors keep service recovery copy separate from auth expiry', async () => {
  fetch.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
  const user = userEvent.setup(); render(<MemoryWorkspace token="operator" setToken={vi.fn()}/>);
  await user.click(screen.getByRole('button', {name: 'Load sessions'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Arc Science service is offline or unreachable');
  expect(screen.getByRole('alert')).not.toHaveTextContent('Operator session is locked or expired');
  expect(screen.getByRole('button', {name: 'Load sessions'})).not.toBeDisabled();
});

test('a large session uses bounded inclusive pages and shows loaded and total counts separately', async () => {
  const original = fetch.getMockImplementation();
  const rows = Array.from({length: 1205}, (_, index) => ({...record, record_id: 'record-' + (index + 1), seq: index + 1, text: 'Finding ' + (index + 1)}));
  fetch.mockImplementation(async (path, options) => {
    if (path.includes('/sessions?')) return json([{session_id: 'private-session', record_count: rows.length, first_seq: 1, last_seq: 1205, min_epoch: 0, max_epoch: 5}]);
    if (path.includes('/sessions/')) {
      const params = new URL(path, 'http://localhost').searchParams;
      if (!params.has('from_seq') || !params.has('to_seq')) return new Response(JSON.stringify({detail: 'Session exceeds the read budget'}), {status: 409});
      return json(rows.filter(row => row.seq >= Number(params.get('from_seq')) && row.seq <= Number(params.get('to_seq'))));
    }
    return original(path, options);
  });
  const user = userEvent.setup(); render(<MemoryWorkspace token="operator" setToken={vi.fn()}/>);
  await user.click(screen.getByRole('button', {name: 'Load sessions'}));
  await user.click(await screen.findByRole('button', {name: /private-session · 1205 records/}));
  expect(await screen.findByText('Finding 199')).toBeInTheDocument();
  expect(screen.queryByText('Finding 200')).not.toBeInTheDocument();
  expect(screen.getByText('199 loaded')).toBeInTheDocument();
  expect(screen.getByText(/1205 total active records/)).toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Previous records'})).toBeDisabled();
  await user.click(screen.getByRole('button', {name: 'Next records'}));
  expect(await screen.findByText('Finding 200')).toBeInTheDocument();
  expect(screen.getByText('Finding 399')).toBeInTheDocument();
  expect(screen.queryByText('Finding 199')).not.toBeInTheDocument();
  expect(screen.getByText('200 loaded')).toBeInTheDocument();
  await user.click(screen.getByRole('button', {name: 'Previous records'}));
  await screen.findByText('Finding 199');
  const ranges = fetch.mock.calls.filter(([path]) => path.includes('/sessions/')).map(([path]) => {
    const params = new URL(path, 'http://localhost').searchParams;
    return [params.get('from_seq'), params.get('to_seq')];
  });
  expect(ranges).toEqual([['0', '199'], ['200', '399'], ['0', '199']]);
});

test('an oversized page preserves range controls so the user can narrow and retry', async () => {
  const original = fetch.getMockImplementation();
  fetch.mockImplementation(async (path, options) => {
    if (path.includes('/sessions/')) {
      const params = new URL(path, 'http://localhost').searchParams;
      if (params.get('from_seq') === '1' && params.get('to_seq') === '1') return json(removed ? [] : [record]);
      return new Response(JSON.stringify({detail: 'Session exceeds the read budget or is unreadable; retry with a narrower sequence range'}), {status: 409});
    }
    return original(path, options);
  });
  const user = userEvent.setup(); render(<MemoryWorkspace token="operator" setToken={vi.fn()}/>);
  await user.click(screen.getByRole('button', {name: 'Load sessions'}));
  await user.click(await screen.findByRole('button', {name: /private-session · 1 records/}));
  expect(await screen.findByRole('alert')).toHaveTextContent('narrower sequence range');
  expect(screen.getByText('Captured trajectory')).toBeInTheDocument();
  expect(screen.queryByText(/0 loaded/)).not.toBeInTheDocument();
  await user.click(screen.getByText('Record range'));
  await user.clear(screen.getByLabelText('From sequence (inclusive)'));
  await user.type(screen.getByLabelText('From sequence (inclusive)'), '1');
  await user.clear(screen.getByLabelText('To sequence (inclusive)'));
  await user.type(screen.getByLabelText('To sequence (inclusive)'), '1');
  await user.click(screen.getByRole('button', {name: 'Load record range'}));
  expect(await screen.findByText('Private remembered finding')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('1 loaded')).toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Next records'})).toBeDisabled();
  await user.click(screen.getByRole('button', {name: 'Remove from retrieval'}));
  await waitFor(() => expect(fetch.mock.calls.filter(([path]) => path.includes('/sessions/'))).toHaveLength(3));
  const last = fetch.mock.calls.filter(([path]) => path.includes('/sessions/')).at(-1)[0];
  expect(last).toContain('from_seq=1&to_seq=1');
  expect(await screen.findByText('0 loaded')).toBeInTheDocument();
  expect(screen.getByText(/0 total active records/)).toBeInTheDocument();
});

test('invalid ranges do not issue requests and credential changes reject an old page', async () => {
  const user = userEvent.setup(); const setToken = vi.fn();
  const {rerender} = render(<MemoryWorkspace token="old-token" setToken={setToken}/>);
  await user.click(screen.getByRole('button', {name: 'Load sessions'}));
  await user.click(await screen.findByRole('button', {name: /private-session · 1 records/}));
  await screen.findByText('Private remembered finding');
  await user.click(screen.getByText('Record range'));
  await user.clear(screen.getByLabelText('To sequence (inclusive)'));
  await user.type(screen.getByLabelText('To sequence (inclusive)'), '1000');
  await user.click(screen.getByRole('button', {name: 'Load record range'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('at most 1000');
  expect(fetch.mock.calls.filter(([path]) => path.includes('/sessions/'))).toHaveLength(1);
  await user.clear(screen.getByLabelText('To sequence (inclusive)'));
  await user.type(screen.getByLabelText('To sequence (inclusive)'), '99');
  let finish;
  fetch.mockImplementationOnce(async () => ({ok: true, json: () => new Promise(resolve => { finish = resolve; })}));
  await user.click(screen.getByRole('button', {name: 'Load record range'}));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  const signal = fetch.mock.calls.at(-1)[1].signal;
  rerender(<MemoryWorkspace token="new-token" setToken={setToken}/>);
  expect(signal.aborted).toBe(true);
  await act(async () => finish([record]));
  expect(screen.queryByText('Private remembered finding')).not.toBeInTheDocument();
  expect(screen.queryByText('Record range')).not.toBeInTheDocument();
});
