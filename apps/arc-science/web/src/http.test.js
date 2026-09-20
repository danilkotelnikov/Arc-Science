import {afterEach, expect, test, vi} from 'vitest';
import {apiFetch, NATIVE_SESSION} from './http';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('apiFetch accepts only local api paths and requires an operator token', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  await expect(apiFetch('/health', {token: 'operator'})).rejects.toThrow('local /api paths');
  await expect(apiFetch('https://example.test/api/settings', {token: 'operator'})).rejects.toThrow('local /api paths');
  await expect(apiFetch('/api/settings')).rejects.toThrow('Operator token');
  expect(fetch).not.toHaveBeenCalled();
});

test('apiFetch sends bearer auth for operator tokens and strips caller authorization overrides', async () => {
  const fetcher = vi.fn(async () => new Response('{}'));
  await apiFetch('/api/settings', {token: 'operator', method: 'POST', headers: {Authorization: 'Bearer wrong', 'Content-Type': 'application/json'}, body: '{}', fetcher});
  expect(fetcher).toHaveBeenCalledWith('/api/settings', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer operator'}, body: '{}'});
});

test('apiFetch omits authorization for the native session sentinel', async () => {
  const fetcher = vi.fn(async () => new Response('{}'));
  await apiFetch('/api/settings', {token: NATIVE_SESSION, headers: {Accept: 'application/json'}, fetcher});
  expect(fetcher).toHaveBeenCalledWith('/api/settings', {headers: {Accept: 'application/json'}});
});
