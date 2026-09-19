// Prose: a rule-based local rewrite through the real service that keeps every protected
// span, and third-party detection that refuses without consent. No text leaves the
// machine in this suite; the network path is covered by the service tests.
import {test, expect} from '@playwright/test';
import {E2E_TOKEN, openWorkspace, watchForTokenLeaks} from './fixtures.js';

const TEXT = 'It is important to note that we utilize a polynomial fit in order to describe the data (Smith et al., 2020). '
  + 'The residual was 0.12 ± 0.03 µM at 37 °C, p < 0.05, n = 12 [3]; Tyr33 contacts Asp101 in 1DQJ, see `arc-science verify`.';

test('the local rewrite edits prose only and every protected span survives byte for byte', async ({page, request}) => {
  const check = watchForTokenLeaks(page);
  await page.goto('/');
  await openWorkspace(page, 'Prose', 'Prose results');
  await page.getByLabel('Operator token for Prose').fill(E2E_TOKEN);
  await page.getByLabel('Text', {exact: true}).fill(TEXT);
  await page.getByRole('button', {name: 'Rewrite locally'}).click();
  const results = page.getByRole('region', {name: 'Prose results'});
  const output = results.locator('pre.prose-output');
  await expect(output).toHaveText(/^We use a polynomial fit to describe the data \(Smith et al\., 2020\)\./);
  for (const literal of ['0.12 ± 0.03 µM', '37 °C', 'p < 0.05', 'n = 12', '[3]', 'Tyr33', 'Asp101', '1DQJ', '`arc-science verify`']) {
    await expect(output).toContainText(literal);
  }
  await expect(output).not.toContainText('utilize');
  await expect(results.getByRole('heading', {level: 3}).first()).toHaveText(/^\d+ edits · \d+ protected spans \(/);
  await expect(results.getByText(/not a human-authorship claim/)).toBeVisible();
  // Deterministic: the service gives the same answer to the same text.
  const direct = await request.post('/api/prose/rewrite', {headers: {Authorization: `Bearer ${E2E_TOKEN}`}, data: {text: TEXT}});
  expect(direct.status()).toBe(200);
  expect((await direct.json()).text).toBe(await output.textContent());
  check();
});

test('detection is refused without consent and the workspace names the recipient before asking for it', async ({page, request}) => {
  await page.goto('/');
  await openWorkspace(page, 'Prose', 'Prose results');
  await page.getByLabel('Operator token for Prose').fill(E2E_TOKEN);
  await page.getByLabel('Text', {exact: true}).fill(TEXT);
  const consent = page.getByLabel(/I consent to sending this text to api.edgeshop.ai/);
  await expect(consent).toBeDisabled();
  await expect(page.getByRole('button', {name: 'Detect (sends text)'})).toBeDisabled();
  await page.getByRole('button', {name: 'Show rules and detection terms'}).click();
  await expect(page.getByText(/Sends the text to api.edgeshop.ai \(COPYLEAKS, HEMINGWAY\)/)).toBeVisible();
  await expect(consent).toBeEnabled();
  await expect(page.getByRole('button', {name: 'Detect (sends text)'})).toBeDisabled();
  // The service itself refuses a request that lacks consent; nothing is audited or sent.
  const refused = await request.post('/api/prose/detect', {headers: {Authorization: `Bearer ${E2E_TOKEN}`}, data: {text: TEXT}});
  expect(refused.status()).toBe(422);
  expect((await refused.json()).detail.code).toBe('consent_required');
  const rules = await (await request.get('/api/prose/rules', {headers: {Authorization: `Bearer ${E2E_TOKEN}`}})).json();
  expect(rules.detection.recipient).toBe('api.edgeshop.ai');
  expect(rules.rewrite.egress).toBe(false);
});
