// Molecules: the empty workbench, an honest renderer-unavailable state (the suite
// configures no Blender runtime), form gating, and the native download notice.
import {test, expect} from '@playwright/test';
import {E2E_TOKEN, watchForTokenLeaks} from './fixtures.js';

test('the render form stays gated until a runtime exists and reports its absence truthfully', async ({page}) => {
  const check = watchForTokenLeaks(page);
  await page.goto('/');
  const controls = page.getByRole('complementary', {name: 'Molecular render controls'}).or(page.getByLabel('Molecular render controls')).first();
  await expect(controls.getByRole('button', {name: 'Load renders'})).toBeDisabled();
  await expect(controls.getByText('Load with your operator token.')).toBeVisible();
  await page.getByLabel('Operator token').fill(E2E_TOKEN);
  await controls.getByRole('button', {name: 'Load renders'}).click();
  await expect(controls.getByText('Configure ARC_MOLECULAR_BLENDER_PYTHON on the server, then restart the service.')).toBeVisible();
  await expect(controls.getByText('Local renderer ready.')).toHaveCount(0);
  // Viewing needs no renderer: the file input stays open while rendering stays gated.
  await expect(controls.getByLabel('Coordinate file')).toBeEnabled();
  await expect(controls.getByLabel('Antibody chains')).toBeDisabled();
  await expect(controls.getByRole('button', {name: 'Render structure'})).toBeDisabled();
  await expect(controls.getByText('No saved renders yet.')).toBeVisible();
  await expect(page.getByRole('region', {name: 'Molecular figure'}).getByRole('status')).toContainText('Choose a coordinate file or a saved render');
  check();
});

const TINY_PDB = ['HEADER    TEST', 'ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 10.00           N',
  'ATOM      2  CA  ALA A   1       1.458   0.000   0.000  1.00 10.00           C', 'ATOM      3  C   ALA A   1       2.009   1.420   0.000  1.00 10.00           C',
  'ATOM      4  O   ALA A   1       1.251   2.390   0.000  1.00 10.00           O', 'ATOM      5  CB  ALA A   1       1.988  -0.773  -1.199  1.00 10.00           C',
  'ATOM      6  N   GLY C   2       3.300   1.600   0.000  1.00 10.00           N', 'ATOM      7  CA  GLY C   2       4.000   2.800   0.000  1.00 10.00           C',
  'ATOM      8  C   GLY C   2       5.500   2.700   0.000  1.00 10.00           C', 'ATOM      9  O   GLY C   2       6.100   1.600   0.000  1.00 10.00           O', 'END', ''].join('\n');

test('a chosen coordinate file is shown in the viewer at once, with its settings, before any render exists', async ({page}) => {
  const check = watchForTokenLeaks(page);
  await page.goto('/');
  await page.getByLabel('Operator token').fill(E2E_TOKEN);
  await page.getByLabel('Coordinate file').setInputFiles({name: 'tiny.pdb', mimeType: 'chemical/x-pdb', buffer: Buffer.from(TINY_PDB)});
  const viewer = page.getByLabel('Molecular viewer');
  await expect(viewer.getByRole('status')).toContainText(/Loaded 9 atoms|viewer could not start/, {timeout: 60_000});
  const status = await viewer.getByRole('status').textContent();
  test.skip(/could not start/.test(status), 'no WebGL in this browser: ' + status);
  await expect(viewer.locator('canvas')).toBeVisible();
  await viewer.getByLabel('Representation').selectOption('ball_and_stick');
  await viewer.getByLabel('Colouring').selectOption('element');
  await viewer.getByLabel('Background').selectOption('black');
  await expect(viewer.getByRole('status')).toContainText('Loaded 9 atoms');
  // The viewer sends nothing anywhere: no molecular request was made for the upload.
  expect(await page.evaluate(() => performance.getEntriesByType('resource').filter(e => e.name.includes('/api/molecular/')).length)).toBe(0);
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
