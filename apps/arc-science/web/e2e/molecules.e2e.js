// Molecules: the empty workbench, an honest renderer-unavailable state (the suite
// configures no Blender runtime), form gating, and the native download notice.
import {test, expect} from '@playwright/test';
import {E2E_TOKEN, watchForTokenLeaks} from './fixtures.js';

test('the render form stays gated until a runtime exists and reports its absence truthfully', async ({page}) => {
  const check = watchForTokenLeaks(page);
  await page.goto('/');
  const controls = page.getByRole('complementary', {name: 'Molecular render controls'}).or(page.getByLabel('Molecular render controls')).first();
  await expect(controls.getByRole('button', {name: 'Load renders'})).toBeDisabled();
  await expect(controls.getByText('Load to check the renderer and find saved jobs.')).toBeVisible();
  await controls.getByLabel('Operator token for Molecules').fill(E2E_TOKEN);
  await controls.getByRole('button', {name: 'Load renders'}).click();
  await expect(controls.getByText('Configure ARC_MOLECULAR_BLENDER_PYTHON on the server, then restart the service.')).toBeVisible();
  await expect(controls.getByText('Local renderer ready.')).toHaveCount(0);
  await expect(controls.getByLabel('Coordinate file')).toBeDisabled();
  await expect(controls.getByRole('button', {name: 'Render structure'})).toBeDisabled();
  await expect(controls.getByText('No saved renders yet.')).toBeVisible();
  await expect(page.getByRole('region', {name: 'Molecular figure'}).getByRole('status')).toContainText('No render selected');
  check();
});

test('a finished download reported by the native shell is announced in the header and expires', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('.download-notice')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('arc-download', {detail: {file: 'job-1-collage.png', folder: 'C:\\Users\\lab\\Downloads', success: true}})));
  const notice = page.locator('.download-notice');
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(notice).toHaveText('Saved job-1-collage.png in C:\\Users\\lab\\Downloads');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('arc-download', {detail: {file: 'job-1-contacts.csv', folder: null, success: false}})));
  await expect(notice).toHaveAttribute('role', 'alert');
  await expect(notice).toHaveText('Download failed: job-1-contacts.csv. Nothing was saved.');
});
