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
  const settings = page.getByRole('region', {name: 'Settings'});
  await expect(settings.getByText('Research Models', {exact: true})).toBeVisible();
  await expect(settings.getByText('Connections', {exact: true})).toBeVisible();
  await expect(settings.getByText('Rendering', {exact: true})).toBeVisible();
  await expect(settings.getByText('Viewer', {exact: true})).toBeVisible();
  await expect(settings.getByText('Advanced', {exact: true})).toBeVisible();
  await page.getByLabel('Planner provider').selectOption('openai');
  await page.getByLabel('Planner model').fill('gpt-5.6');
  await page.getByLabel('Planner effort').selectOption('high');
  await page.getByLabel('Planner credential').fill('planner');
  await page.getByLabel('Reviewer (QA) provider').selectOption('anthropic');
  await page.getByLabel('Reviewer (QA) model').fill('claude-sonnet-5');
  await page.getByLabel('Reviewer (QA) sign-in').selectOption('cli');
  await page.getByLabel('Falsifier provider').selectOption('gemini');
  await page.getByLabel('Falsifier model').fill('gemini-3-pro');
  await page.getByLabel('Falsifier sign-in').selectOption('cli');
  await expect(page.getByLabel('Falsifier effort')).toHaveValue('medium');
  await expect(page.getByLabel('Falsifier effort')).toBeDisabled();
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.getByRole('status')).toHaveText(/Saved\. Applied now: Research Models/);
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

test('settings recovery copy hides the raw missing-supervisor error', async ({page}) => {
  await page.route('**/api/settings', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({detail: 'No settings file is configured for this service'})
  }));
  await page.goto('/');
  await openWorkspace(page, 'Settings', 'Settings');
  await page.getByLabel('Operator token').fill(E2E_TOKEN);
  await page.getByRole('button', {name: 'Load settings'}).click();
  await expect(page.getByRole('alert')).toContainText('No settings file was given to this service.');
  await expect(page.getByText('Settings file not configured')).toBeVisible();
  await expect(page.getByRole('alert')).not.toContainText('Request failed (503)');
});
