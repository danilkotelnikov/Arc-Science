// Shell, identity and navigation against the real service and compiled bundle.
import {test, expect} from '@playwright/test';
import {E2E_TOKEN, openWorkspace, watchForTokenLeaks} from './fixtures.js';

test('the workbench opens on a blank Research question in the requested order', async ({page}) => {
  const requested = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto('/');
  await expect(page).toHaveTitle('Arc Science');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
  expect((await page.request.get('/favicon.svg')).status()).toBe(200);
  // The lockup is drawn inline from the logo geometry: tile, letters and wordmark.
  const brand = page.getByRole('banner').getByRole('img', {name: 'Arc Science'});
  await expect(brand).toBeVisible();
  expect(await brand.locator('path').count()).toBe(3);
  // Kyiv Type Sans, the interface face, is loaded from the bundle rather than the system.
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => [...document.fonts].some(face => face.family.replace(/"/g, '') === 'Arc Kyiv' && face.status === 'loaded'))).toBe(true);
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
  await openWorkspace(page, 'Memory', 'Memory results');
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
  // Labels belong to the Diagnostics workspace; here only the count and the Tab order matter:
  // Refresh service, Version and limits, Refresh readiness, Refresh readiness (re-read logins), Read diagnostics, Copy redacted report, Check MCP, Check ACP.
  const buttons = page.getByRole('main').getByRole('button', {disabled: false});
  await expect(buttons).toHaveCount(8);
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

test('Diagnostics reads storage integrity and the redacted report carries no token', async ({request}) => {
  const headers = {Authorization: 'Bearer ' + E2E_TOKEN};
  const diagnostics = await request.get('/api/diagnostics', {headers});
  expect(diagnostics.status()).toBe(200);
  const doc = await diagnostics.json();
  expect(doc.storage.sqlite['missions.db']).toBe('ok');
  for (const name of ['storage', 'jobs', 'renderer', 'package', 'probes']) {
    expect(typeof doc[name].source, name + '.source').toBe('string');
    expect(doc[name].checked_at, name + '.checked_at').toBeGreaterThan(0);
  }
  // The service redacts before the page sees the text: no operator token, no bearer value, no home directory.
  const report = await request.get('/api/diagnostics/report', {headers});
  expect(report.status()).toBe(200);
  expect(report.headers()['content-type']).toContain('text/plain');
  const text = await report.text();
  expect(text).not.toContain(E2E_TOKEN);
  expect(text).not.toMatch(/Bearer [^[]/);
  expect(text).not.toMatch(/[\\/]Users[\\/]/);
  expect(JSON.parse(text).format).toBe('arc-diagnostics-report/1');
  // The suite's service is started by e2e/serve.mjs, not by the desktop app.
  const health = await request.get('/health');
  expect((await health.json()).host_session.mode).toBe('standalone');
});
