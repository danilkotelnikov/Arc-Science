// Settings: read through the native supervisor, loaded by the workspace once the token
// in the header settles (Enter here), written back with the revision that was read; a
// stale revision is refused by the owner and re-applied onto the newer one on request.
import {test, expect} from '@playwright/test';
import {E2E_TOKEN, openWorkspace, watchForTokenLeaks} from './fixtures.js';

const headers = {Authorization: `Bearer ${E2E_TOKEN}`};
const sidebarStatus = page => page.locator('.settings-sidebar [role="status"]');
const settingsRegion = page => page.getByRole('region', {name: 'Settings'});
const openSection = (page, title) => settingsRegion(page).getByText(title, {exact: true}).click();

async function openSettings(page) {
  await page.goto('/');
  await openWorkspace(page, 'Settings', 'Settings');
  await page.getByLabel('Operator token').fill(E2E_TOKEN);
  await page.getByLabel('Operator token').press('Enter');
}

test('seats load by themselves, are edited in the workspace and persisted by the supervisor', async ({page, request}) => {
  const probe = await request.get('/api/settings', {headers});
  test.skip(probe.status() === 503, 'native supervisor not built; settings unavailable');
  const check = watchForTokenLeaks(page);
  await page.goto('/');
  await openWorkspace(page, 'Settings', 'Settings');
  // Typing the token sends nothing from Settings and draws no rejection; the load waits
  // for the field to settle (Enter), then runs once with the whole token. Settings is the
  // only workspace here that asks for readiness with a manual token, so its reads count it.
  const readinessReads = [];
  page.on('request', r => { if (r.url().endsWith('/api/readiness')) readinessReads.push(r.headers().authorization); });
  await page.getByLabel('Operator token').pressSequentially(E2E_TOKEN.slice(0, 8));
  await expect(settingsRegion(page)).toContainText('Settings load when you leave the token field');
  await expect(page.locator('.settings-sidebar')).not.toContainText('Token not accepted');
  await page.getByLabel('Operator token').fill(E2E_TOKEN);
  await page.getByLabel('Operator token').press('Enter');
  // No click on Load settings: the snapshot loads once the token has settled.
  await expect(page.getByLabel('Planner provider')).toBeVisible();
  expect(readinessReads).toEqual([`Bearer ${E2E_TOKEN}`]);
  await expect(page.getByRole('button', {name: 'Reload', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Load settings'})).toHaveCount(0);
  for (const title of ['Research Models', 'Connections', 'Rendering', 'Viewer', 'Advanced']) await expect(settingsRegion(page).getByText(title, {exact: true})).toBeVisible();
  await page.getByLabel('Planner provider').selectOption('openai');
  await page.getByLabel('Planner model').selectOption('gpt-5.6-sol');
  await expect(page.getByRole('article', {name: 'Planner seat'})).toContainText('In catalog');
  await page.getByLabel('Planner effort').selectOption('high');
  await page.getByLabel('Planner credential').fill('planner');
  await page.getByLabel('Reviewer (QA) provider').selectOption('anthropic');
  await page.getByLabel('Reviewer (QA) model').selectOption('claude-sonnet-5');
  await page.getByLabel('Reviewer (QA) sign-in').selectOption('cli');
  await page.getByLabel('Falsifier provider').selectOption('gemini');
  await page.getByLabel('Falsifier model').selectOption('gemini-3.8-flash');
  await page.getByLabel('Falsifier sign-in').selectOption('cli');
  await expect(page.getByLabel('Falsifier effort')).toHaveValue('medium');
  await expect(page.getByLabel('Falsifier effort')).toBeDisabled();
  await expect(page.getByRole('article', {name: 'Falsifier seat'})).toContainText('No effort control on this model/sign-in; the provider default applies');
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(sidebarStatus(page)).toHaveText(/^Saved \(revision [0-9a-f]{12}\)\. .*applies at next live mission start\./);
  const snap = await (await request.get('/api/settings', {headers})).json();
  expect(snap.settings.seats.planner).toMatchObject({provider: 'openai', model: 'gpt-5.6-sol', effort: 'high'});
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

test('a save onto a stale revision is refused, and "Reload and keep my edits" carries the draft onto the newer one', async ({page, request}) => {
  const probe = await request.get('/api/settings', {headers});
  test.skip(probe.status() === 503, 'native supervisor not built; settings unavailable');
  await openSettings(page);
  await expect(page.getByLabel('Planner provider')).toBeVisible();
  // Only Research Models opens by itself; the fields this test drives sit in two other sections.
  await openSection(page, 'Rendering');
  await openSection(page, 'Viewer');
  await expect(page.getByLabel('Blender preset')).toBeVisible();
  const loaded = await (await request.get('/api/settings', {headers})).json();
  // The workspace edits one field while another party saves a different one.
  await page.getByLabel('Blender preset').fill('e2e_rebase_preset');
  const elsewhere = {...loaded.settings, viewer: {...loaded.settings.viewer, background: loaded.settings.viewer.background === 'black' ? 'white' : 'black'}};
  expect((await request.put('/api/settings', {headers, data: {settings: elsewhere, if_revision: loaded.revision}})).status()).toBe(200);
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  const conflict = page.getByRole('alert');
  await expect(conflict).toContainText('Settings changed elsewhere');
  await expect(conflict).not.toContainText('Request failed (409)');
  await expect(page.getByLabel('Blender preset')).toHaveValue('e2e_rebase_preset');
  await conflict.getByRole('button', {name: 'Reload and keep my edits'}).click();
  await expect(sidebarStatus(page)).toHaveText(/^Edits re-applied onto revision [0-9a-f]{12}; review and save$/);
  await expect(page.getByLabel('Blender preset')).toHaveValue('e2e_rebase_preset');
  await expect(page.getByLabel('Viewer background')).toHaveValue(elsewhere.viewer.background);
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(sidebarStatus(page)).toHaveText(/^Saved \(revision [0-9a-f]{12}\)\. Rendering: applies at next render submission\./);
  const snap = await (await request.get('/api/settings', {headers})).json();
  expect(snap.settings.blender.default_preset).toBe('e2e_rebase_preset');
  expect(snap.settings.viewer.background).toBe(elsewhere.viewer.background);
});

test('at 700 px wide the seat cards and the providers table fit the viewport', async ({page, request}) => {
  const probe = await request.get('/api/settings', {headers});
  test.skip(probe.status() === 503, 'native supervisor not built; settings unavailable');
  await page.setViewportSize({width: 700, height: 900});
  await openSettings(page);
  await expect(page.getByLabel('Planner provider')).toBeVisible();
  await openSection(page, 'Advanced');
  await expect(page.getByLabel('OpenClaw agent id')).toBeVisible();
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth)).toBe(true);
});

test('a custom model id is marked unverified until the service has checked it', async ({page, request}) => {
  const probe = await request.get('/api/settings', {headers});
  test.skip(probe.status() === 503, 'native supervisor not built; settings unavailable');
  await openSettings(page);
  await page.getByLabel('Vision provider').selectOption('openai');
  await page.getByLabel('Vision model').selectOption({label: 'Custom id…'});
  await page.getByLabel('Vision custom model id').fill('gpt-e2e-custom');
  const vision = page.getByRole('article', {name: 'Vision seat'});
  await expect(vision).toContainText('Custom id (unverified): not in the catalog; readiness cannot be assumed');
  await expect(vision).toContainText('Unsaved');
  await expect(vision).not.toContainText('In catalog');
});

test('settings recovery copy hides the raw missing-supervisor error and offers Retry', async ({page}) => {
  await page.route('**/api/settings', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({detail: 'No settings file is configured for this service'})
  }));
  await openSettings(page);
  await expect(page.getByRole('alert')).toContainText('No settings file was given to this service.');
  await expect(page.getByText('Settings file not configured')).toBeVisible();
  await expect(page.getByRole('alert')).not.toContainText('Request failed (503)');
  await expect(page.getByRole('alert').getByRole('button', {name: 'Retry'})).toBeVisible();
});
