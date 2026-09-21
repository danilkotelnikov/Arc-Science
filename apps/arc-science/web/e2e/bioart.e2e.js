// BioArt: cache-first, egress only by explicit single-use consent, and never a
// network request from the browser itself to NIH during the offline checks.
import {test, expect} from '@playwright/test';
import {E2E_TOKEN, openWorkspace, watchForTokenLeaks} from './fixtures.js';

test('an offline search miss requires explicit egress consent and the browser never contacts NIH', async ({page}) => {
  const check = watchForTokenLeaks(page);
  const external = [];
  page.on('request', (request) => {
    const host = new URL(request.url()).host;
    if (host !== '127.0.0.1:8095') external.push(request.url());
  });
  await page.goto('/');
  await openWorkspace(page, 'BioArt', 'BioArt evidence workspace');
  const search = page.getByRole('complementary', {name: 'BioArt search'}).or(page.getByLabel('BioArt search')).first();
  await expect(search.getByRole('button', {name: 'Search BioArt'})).toBeDisabled();
  // Without a token the shared lock notice sits under the search action and leads to the token field.
  await expect(search.getByRole('status')).toContainText('Operator token required');
  await search.getByRole('button', {name: 'Go to token field'}).click();
  await expect(page.getByLabel('Operator token')).toBeFocused();
  await page.getByLabel('Operator token').fill(E2E_TOKEN);
  await expect(search.getByRole('status')).toHaveCount(0);
  await search.getByLabel('BioArt search query').fill('');
  await expect(search.getByRole('button', {name: 'Search BioArt'})).toBeDisabled();
  await search.getByLabel('BioArt search query').fill('antibody');
  await expect(search.getByRole('checkbox', {name: /Permit NIH network access/})).not.toBeChecked();
  await search.getByRole('button', {name: 'Search BioArt'}).click();
  // Search and inspection errors render beside their controls in the search column.
  const alert = search.getByRole('alert');
  await expect(alert).toContainText('No cached BioArt metadata is available yet');
  await expect(alert).toContainText('Consent is used once and clears after the request');
  await expect(alert).not.toContainText('409');
  await expect(alert).not.toContainText('--allow-egress');
  // The documented fallback for dynamic keyword search is the official site, opened outside the app.
  const link = search.getByRole('link', {name: 'Open NIH search'});
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('href', /^https:\/\/bioart\.niaid\.nih\.gov\/discover\?q=antibody/);
  expect(external).toEqual([]);
  check();
});

test('direct entry inspection validates the identifier before any request and requires the token', async ({page}) => {
  await page.goto('/');
  await openWorkspace(page, 'BioArt', 'BioArt evidence workspace');
  const search = page.getByLabel('BioArt search');
  const inspect = search.getByRole('button', {name: 'Inspect entry'});
  await expect(inspect).toBeDisabled();
  await page.getByLabel('Operator token').fill(E2E_TOKEN);
  await search.getByLabel('NIH entry ID').fill('-3');
  await expect(search.getByLabel('NIH entry ID')).toHaveAttribute('aria-invalid', 'true');
  await expect(inspect).toBeDisabled();
  await search.getByLabel('NIH entry ID').fill('18');
  await expect(search.getByLabel('NIH entry ID')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(inspect).toBeEnabled();
  // Without consent the inspection stays offline: a cache miss is a 409, not a fetch.
  await inspect.click();
  const alert = search.getByRole('alert');
  await expect(alert).toContainText('No cached BioArt metadata is available yet');
  await expect(alert).not.toContainText('409');
});
