// Shell, identity and navigation against the real service and compiled bundle.
import {test, expect} from '@playwright/test';
import {openWorkspace, watchForTokenLeaks} from './fixtures.js';

test('the workbench opens with its mark, four workspaces and no packaged example', async ({page}) => {
  const requested = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto('/');
  await expect(page).toHaveTitle('Arc Science');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/snoggo-mark.svg');
  const mark = page.locator('img.brand-mark');
  await expect(mark).toBeVisible();
  expect(await mark.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  const nav = page.getByRole('navigation', {name: 'Workspaces'});
  for (const name of ['Molecules', 'BioArt', 'Research', 'Memory']) {
    await expect(nav.getByRole('button', {name})).toBeEnabled();
  }
  // Molecules is the landing workspace and it is empty: the operator's renders only.
  await expect(page.getByRole('heading', {name: 'Render your structure locally'})).toBeVisible();
  await expect(page.getByRole('region', {name: 'Molecular figure'}).getByRole('status')).toContainText('No render selected');
  await expect(page.getByRole('button', {name: 'Export SVG'})).toHaveCount(0);
  await expect(page.getByText(/EXAMPLE \/ 01/)).toHaveCount(0);
  expect(requested.filter((url) => url.includes('/api/examples'))).toEqual([]);
});

test('workspaces switch without losing the shared in-memory token, and the token never enters a URL', async ({page}) => {
  const check = watchForTokenLeaks(page);
  await page.goto('/');
  await openWorkspace(page, 'Research', 'Research results');
  await page.getByLabel('Local operator token').fill('shared-token-in-memory-only-0123456789');
  await openWorkspace(page, 'Memory', 'Memory');
  await expect(page.getByLabel('Operator token for Memory')).toHaveValue('shared-token-in-memory-only-0123456789');
  await openWorkspace(page, 'BioArt', 'BioArt evidence workspace');
  await expect(page.getByLabel('Operator token for BioArt')).toHaveValue('shared-token-in-memory-only-0123456789');
  await openWorkspace(page, 'Molecules', 'Molecular figure');
  await expect(page.getByLabel('Operator token for Molecules')).toHaveValue('shared-token-in-memory-only-0123456789');
  check();
});

test('the diagnostics page and the API refuse unauthenticated private reads', async ({page, request}) => {
  const api = await request.get('/api/missions');
  expect(api.status()).toBe(401);
  expect(api.headers()['www-authenticate']).toBe('Bearer');
  const diagnostics = await request.get('/diagnostics');
  expect(diagnostics.status()).toBe(200);
  expect(diagnostics.headers()['content-security-policy']).toContain("script-src 'self'");
  await page.goto('/');
  await expect(page.getByRole('link', {name: /Diagnostics/})).toHaveAttribute('href', '/diagnostics');
});
