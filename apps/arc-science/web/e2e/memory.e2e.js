// Memory: a completed mission is captured, recalled by session and range, searched
// lexically, retention hides a record, and a credential change clears private state.
import {test, expect} from '@playwright/test';
import {E2E_TOKEN, openWorkspace, runDemoMission, watchForTokenLeaks} from './fixtures.js';

test.describe.configure({mode: 'serial'});

test.beforeEach(async ({request}) => {
  // The native worker is a Rust build; without it the routes answer 503 and the
  // recall checks cannot run. Skipping is reported, never counted as a pass.
  const health = await request.get('/api/memory/health', {headers: {Authorization: `Bearer ${E2E_TOKEN}`}});
  test.skip(health.status() === 503, 'arc-memory-worker is not built on this machine');
});

test('a completed mission is recalled from memory, searched, paged and retained truthfully', async ({page}) => {
  const check = watchForTokenLeaks(page);
  await page.goto('/');
  await runDemoMission(page, {goal: 'E2E: memory capture of the quadratic route.'});
  const missionId = (await page.locator('.eyebrow').filter({hasText: 'Selected mission:'}).textContent()).split(': ')[1].trim();

  await openWorkspace(page, 'Memory', 'Memory results');
  await expect(page.getByLabel('Operator token')).toHaveValue(E2E_TOKEN);
  await page.getByRole('button', {name: 'Load sessions'}).click();
  const memory = page.getByRole('region', {name: 'Memory results'});
  const aside = page.locator('aside');
  // Engine and SQLite versions belong to Diagnostics (Version and limits), not this workspace.
  await expect(aside.getByText(/Memory service|SQLite/)).toHaveCount(0);
  await expect(aside.getByText('Semantic and hybrid search need an embedding model; none is reported as configured. Keyword search is available.')).toBeVisible();
  await expect(aside.getByLabel('Search mode')).toHaveValue('lexical');
  await expect(aside.getByLabel('Search mode').locator('option[value="hybrid"]')).toBeDisabled();
  // Capture is asynchronous but bounded: the mission's session appears with its records.
  const session = aside.locator('.mission-choice').filter({hasText: missionId});
  await expect(async () => {
    await aside.getByRole('button', {name: 'Load sessions'}).click();
    await expect(session).toBeVisible({timeout: 2000});
    await expect(aside.getByRole('status')).toContainText('Session capture: ready · 0 captures waiting');
  }).toPass({timeout: 60_000});
  await expect(session).toContainText(/\d+ records? · compaction epochs 0–\d+/);

  await session.click();
  await expect(memory.getByRole('heading', {name: 'Captured records'})).toBeVisible();
  await expect(memory.locator('.status-label')).toHaveText(/\d+ loaded/);
  const total = Number((await memory.getByText(/retrievable records? in this session/).textContent()).match(/(\d+) retrievable/)[1]);
  expect(total).toBeGreaterThan(5);
  await expect(memory.getByText(/\[plan_committed\]|plan_committed/).first()).toBeVisible();

  // Explicit inclusive ranges: one record, then the neighbours.
  await memory.getByText('Record range', {exact: true}).click();
  await memory.getByLabel('From sequence (inclusive)').fill('1');
  await memory.getByLabel('To sequence (inclusive)').fill('1');
  await memory.getByRole('button', {name: 'Load record range'}).click();
  await expect(memory.locator('.status-label')).toHaveText('1 loaded');
  await expect(memory.getByText(/Sequence 1–1 \(inclusive\)/)).toBeVisible();
  await memory.getByRole('button', {name: 'Next records'}).click();
  await expect(memory.getByText(/Sequence 2–2 \(inclusive\)/)).toBeVisible();
  await memory.getByRole('button', {name: 'Previous records'}).click();
  await expect(memory.getByText(/Sequence 1–1 \(inclusive\)/)).toBeVisible();

  // Lexical search over all sessions, then scoped to the selected one.
  await aside.getByLabel('Search memory').fill('quadratic');
  await aside.getByRole('button', {name: 'Search'}).click();
  await expect(memory.getByRole('heading', {name: 'Retrieved passages'})).toBeVisible();
  await expect(memory.locator('.status-label')).toHaveText(/[1-9]\d* results?/);
  await expect(memory.locator('article.record').first()).toContainText(/quadratic/i);
  await expect(memory.locator('article.record').first()).toContainText(/compaction epoch \d+ · trust (model output|operator)/);
  await aside.getByLabel('Search scope').selectOption('selected');
  await aside.getByRole('button', {name: 'Search'}).click();
  await expect(memory.locator('.eyebrow').filter({hasText: `Search · lexical · ${missionId}`})).toBeVisible();

  // Retention: removing a record from retrieval hides it and lowers the active count.
  await session.click();
  await expect(memory.getByRole('heading', {name: 'Captured records'})).toBeVisible();
  const before = Number((await memory.getByText(/retrievable records? in this session/).textContent()).match(/(\d+) retrievable/)[1]);
  const first = memory.locator('article.record').first();
  const removedHeading = await first.locator('h3').textContent(); // "role · seq N · compaction epoch E"
  await first.getByRole('button', {name: /^Remove from retrieval/}).click();
  await expect(memory.getByText(new RegExp(`${before - 1} retrievable records?`))).toBeVisible();
  // The hidden record no longer appears in session recall, but the history is not erased.
  await session.click();
  await expect(memory.getByRole('heading', {name: 'Captured records'})).toBeVisible();
  await expect(memory.locator('article.record h3').filter({hasText: removedHeading})).toHaveCount(0);
  await expect(memory.getByText('Remove from retrieval hides a record from search and session recall. The stored history is not erased.')).toBeVisible();

  // A credential change clears every loaded identity and result.
  await page.getByLabel('Operator token').fill('another-token-that-must-clear-private-state-000');
  await expect(aside.getByText('Select Load sessions to list captured sessions.')).toBeVisible();
  await expect(memory.getByRole('heading', {name: 'No session selected. Open a session or run a search.'})).toBeVisible();
  check();
});

test('memory refuses to answer without a valid operator token', async ({page}) => {
  await page.goto('/');
  await openWorkspace(page, 'Memory', 'Memory results');
  await page.getByLabel('Operator token').fill('not-the-operator-token-at-all-0000000000');
  await page.getByRole('button', {name: 'Load sessions'}).click();
  // One rejected-token notice sits beside the actions in the aside; no alert repeats its words.
  const notice = page.locator('aside .unlock-card');
  await expect(notice).toContainText('Token not accepted');
  await expect(notice).toContainText('Enter a current operator token in the header and retry.');
  await expect(notice).toHaveAttribute('data-tone', 'error');
  await expect(page.locator('aside').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Load sessions'})).toBeDisabled();
  await expect(page.getByRole('button', {name: 'Go to token field'})).toBeVisible();
});
