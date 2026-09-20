// Settings: read through the native supervisor, edited in the workspace, written back
// with the revision that was read; a stale revision is refused by the owner.
import {test, expect} from '@playwright/test';
import {E2E_TOKEN, openWorkspace, watchForTokenLeaks} from './fixtures.js';

const headers = {Authorization: `Bearer ${E2E_TOKEN}`};

test('seats are edited in the workspace and persisted by the supervisor', async ({page, request}) => {
  const probe = await request.get('/api/settings', {headers});
  test.skip(probe.status() === 503, 'native supervisor not built; settings unavailable');
  const check = watchForTokenLeaks(page);
  await page.goto('/');
  await openWorkspace(page, 'Settings', 'Settings');
  await page.getByLabel('Operator token').fill(E2E_TOKEN);
  await page.getByRole('button', {name: 'Load settings'}).click();
  await page.getByLabel('Planner provider').selectOption('openai');
  await page.getByLabel('Planner model').fill('gpt-5.6');
  await page.getByLabel('Planner effort').selectOption('high');
  await page.getByLabel('Reviewer (QA) provider').selectOption('anthropic');
  await page.getByLabel('Reviewer (QA) model').fill('claude-sonnet-5');
  await page.getByLabel('Reviewer (QA) auth').selectOption('cli');
  await page.getByRole('button', {name: 'Save'}).click();
  await expect(page.getByRole('status')).toHaveText(/Saved\. Applied live: seats/);
  const snap = await (await request.get('/api/settings', {headers})).json();
  expect(snap.settings.seats.planner).toMatchObject({provider: 'openai', model: 'gpt-5.6', effort: 'high'});
  expect(snap.settings.seats.reviewer).toMatchObject({provider: 'anthropic', model: 'claude-sonnet-5', auth: 'cli'});
  // The owner refuses a stale revision and an invalid document; the file keeps its last valid state.
  const stale = await request.put('/api/settings', {headers, data: {settings: snap.settings, if_revision: 'f'.repeat(64)}});
  expect(stale.status()).toBe(409);
  const invalid = {...snap.settings, seats: {...snap.settings.seats, vision: {...snap.settings.seats.vision, provider: 'gemini', model: ''}}};
  const rejected = await request.put('/api/settings', {headers, data: {settings: invalid, if_revision: snap.revision}});
  expect(rejected.status()).toBe(422);
  expect((await rejected.json()).detail).toContain('seats.vision.model');
  expect((await (await request.get('/api/settings', {headers})).json()).revision).toBe(snap.revision);
  check();
});
