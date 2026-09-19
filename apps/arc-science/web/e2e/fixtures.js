// Shared constants and helpers for the end-to-end suite (real service, real browser).
import {expect} from '@playwright/test';

export const E2E_PORT = 8095;
export const E2E_TOKEN = 'e2e-operator-token-0123456789abcdef0123456789abcdef';
export const BASE = `http://127.0.0.1:${E2E_PORT}`;

/** Tokens travel in memory and request headers only, never in a URL or a query string. */
export function watchForTokenLeaks(page, ...tokens) {
  const secrets = tokens.length ? tokens : [E2E_TOKEN];
  const leaks = [];
  page.on('request', (request) => {
    if (secrets.some((secret) => request.url().includes(secret))) leaks.push(request.url());
  });
  page.on('framenavigated', (frame) => {
    if (secrets.some((secret) => frame.url().includes(secret))) leaks.push(frame.url());
  });
  return () => expect(leaks, 'the operator token must never appear in a URL').toEqual([]);
}

/** Open a workspace from the navigation and wait for its landmark. */
export async function openWorkspace(page, name, landmark) {
  await page.getByRole('navigation', {name: 'Workspaces'}).getByRole('button', {name}).click();
  await expect(page.getByRole('region', {name: landmark}).or(page.getByLabel(landmark)).first()).toBeVisible();
}

/** Create and start an offline (demo) mission; returns when the run reaches a final status. */
export async function runDemoMission(page, {goal, rounds = 5, vision = false} = {}) {
  await openWorkspace(page, 'Research', 'Research results');
  await page.getByLabel('Local operator token').fill(E2E_TOKEN);
  await page.getByLabel('Research goal').fill(goal ?? 'E2E: explore the response curve of the offline fixture.');
  await page.getByLabel('Execution').selectOption('demo');
  await page.getByLabel('Round limit').fill(String(rounds));
  if (vision) await page.getByLabel(/Require configured visual review/).check();
  await page.getByRole('button', {name: 'Create and start'}).click();
  const status = page.locator('.status-label');
  await expect(status).toHaveText(/completed|budget_exhausted|needs_input|cancelled|error/, {timeout: 120_000});
  return status;
}
