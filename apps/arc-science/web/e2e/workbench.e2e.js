// Shell, identity and navigation against the real service and compiled bundle.
import {test, expect} from '@playwright/test';
import {E2E_TOKEN, openWorkspace, watchForTokenLeaks} from './fixtures.js';

test('the workbench opens on a blank Research question in the requested order', async ({page}) => {
  const requested = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto('/');
  await expect(page).toHaveTitle('Arc Science');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/snoggo-mark.svg');
  const mark = page.locator('img.brand-mark');
  await expect(mark).toBeVisible();
  expect(await mark.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  const nav = page.getByRole('navigation', {name: 'Workspaces'});
  const names = ['Research', 'Memory', 'Molecules', 'BioArt', 'Prose', 'Settings', 'Diagnostics'];
  for (const name of names) {
    await expect(nav.getByRole('button', {name})).toBeEnabled();
  }
  expect(await nav.getByRole('button').allTextContents()).toEqual(names);
  await expect(page.getByRole('heading', {name: 'Start with a question.'})).toBeVisible();
  await expect(page.getByLabel('Research goal')).toHaveValue('');
  await expect(page.getByRole('button', {name: 'Create and start'})).toBeDisabled();
  await nav.getByRole('button', {name: 'Molecules'}).click();
  await expect(page.getByRole('region', {name: 'Molecular figure'}).getByRole('status')).toContainText('Choose a coordinate file or a saved render');
  await expect(page.getByRole('button', {name: 'Export SVG'})).toHaveCount(0);
  await expect(page.getByText(/EXAMPLE \/ 01/)).toHaveCount(0);
  expect(requested.filter((url) => url.includes('/api/examples'))).toEqual([]);
});

test('workspaces switch without losing the shared in-memory token, and the token never enters a URL', async ({page}) => {
  const shared = 'shared-token-in-memory-only-0123456789';
  const check = watchForTokenLeaks(page, shared);
  await page.goto('/');
  await openWorkspace(page, 'Research', 'Research results');
  await page.getByLabel('Operator token').fill(shared);
  await openWorkspace(page, 'Memory', 'Memory');
  await expect(page.getByLabel('Operator token')).toHaveValue(shared);
  await openWorkspace(page, 'BioArt', 'BioArt evidence workspace');
  await expect(page.getByLabel('Operator token')).toHaveValue(shared);
  await openWorkspace(page, 'Molecules', 'Molecular figure');
  await expect(page.getByLabel('Operator token')).toHaveValue(shared);
  // The token also stays out of the page URL and history.
  expect(page.url()).not.toContain(shared);
  check();
});

test('Diagnostics shares the shell and the API refuses unauthenticated private reads', async ({page, request}) => {
  const api = await request.get('/api/missions');
  expect(api.status()).toBe(401);
  expect(api.headers()['www-authenticate']).toBe('Bearer');
  const diagnostics = await request.get('/diagnostics');
  expect(diagnostics.status()).toBe(200);
  expect(diagnostics.headers()['content-security-policy']).toContain("script-src 'self'");
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Workspaces'}).getByRole('button', {name: 'Diagnostics'}).click();
  await expect(page).toHaveURL(/\/diagnostics$/);
  await expect(page.getByRole('region', {name: 'Diagnostics'})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Operator token required');
  await page.getByRole('button', {name: 'Research', exact: true}).last().click();
  await expect(page.getByRole('heading', {name: 'Start with a question.'})).toBeVisible();
});

test('at 700×800 Research and Diagnostics fit the viewport and every Diagnostics button is reachable by Tab', async ({page}) => {
  await page.setViewportSize({width: 700, height: 800});
  const fitsViewport = async () => expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= document.documentElement.clientWidth)).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Start with a question.'})).toBeVisible();
  await fitsViewport();
  await openWorkspace(page, 'Diagnostics', 'Diagnostics');
  await page.getByLabel('Operator token').fill(E2E_TOKEN); // the operator checks enable with a token
  await fitsViewport();
  // Labels belong to the Diagnostics workspace; here only the count and the Tab order matter.
  const buttons = page.getByRole('main').getByRole('button', {disabled: false});
  await expect(buttons).toHaveCount(4);
  const labels = await buttons.allTextContents();
  const reached = new Set();
  await page.getByLabel('Operator token').focus();
  for (let i = 0; i < 60 && reached.size < labels.length; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => { const el = document.activeElement; return el?.tagName === 'BUTTON' && el.closest('main') ? el.textContent : null; });
    if (focused !== null && labels.includes(focused)) reached.add(focused);
  }
  expect([...reached].sort()).toEqual([...labels].sort());
});
