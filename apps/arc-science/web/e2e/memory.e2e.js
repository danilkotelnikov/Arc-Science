// Memory: a completed mission is captured, recalled by session and range, searched
// lexically, retention hides a record, and a credential change clears private state.
import {test, expect} from '@playwright/test';
import {E2E_TOKEN, openWorkspace, runDemoMission, selectedMissionId, watchForTokenLeaks} from './fixtures.js';

test.describe.configure({mode: 'serial'});

/** A count as the workspace prints it in English ("1,205"), read back as a number. */
const count = text => Number(text.replace(/,/g, ''));

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
  const missionId = await selectedMissionId(page);

  await openWorkspace(page, 'Memory', 'Memory results');
  await expect(page.getByLabel('Operator token')).toHaveValue(E2E_TOKEN);
  const sessions = page.getByRole('complementary', {name: 'Sessions'});
  const memory = page.getByRole('region', {name: 'Memory results'});
  await sessions.getByRole('button', {name: 'Load sessions'}).click();
  // Engine and SQLite versions belong to Diagnostics (Version and limits), not this workspace.
  await expect(sessions.getByText(/Memory service|SQLite/)).toHaveCount(0);
  await expect(page.getByText('Semantic and hybrid search need an embedding model; none is reported as configured.')).toBeVisible();
  await expect(page.getByRole('radio', {name: 'Keyword (lexical)'})).toBeChecked();
  await expect(page.getByRole('radio', {name: /Hybrid/})).toBeDisabled();
  // Capture is asynchronous but bounded: the mission's session appears with its records.
  const session = sessions.getByRole('option').filter({hasText: missionId});
  await expect(async () => {
    await sessions.getByRole('button', {name: 'Load sessions'}).click();
    await expect(session).toBeVisible({timeout: 2000});
    await expect(sessions.getByRole('status')).toContainText('Session capture: ready, 0 captures waiting');
  }).toPass({timeout: 60_000});
  await expect(session).toContainText(/[\d,]+ records?, compaction epochs 0–\d+/);

  await session.click();
  await expect(session).toHaveAttribute('aria-selected', 'true');
  await expect(memory.getByRole('heading', {name: 'Captured records'})).toBeVisible();
  await expect(memory.getByText(/^[\d,]+ loaded$/)).toBeVisible();
  const total = count((await memory.getByText(/retrievable records? in this session/).textContent()).match(/([\d,]+) retrievable/)[1]);
  expect(total).toBeGreaterThan(5);
  await expect(memory.getByText(/\[plan_committed\]|plan_committed/).first()).toBeVisible();

  // Explicit inclusive ranges: one record, then the neighbours.
  await memory.getByRole('button', {name: 'Record range'}).click();
  await memory.getByLabel('From sequence (inclusive)').fill('1');
  await memory.getByLabel('To sequence (inclusive)').fill('1');
  await memory.getByRole('button', {name: 'Load record range'}).click();
  await expect(memory.getByText('1 loaded', {exact: true})).toBeVisible();
  await expect(memory.getByText(/Sequence 1–1 \(inclusive\)/)).toBeVisible();
  await memory.getByRole('button', {name: 'Next records'}).click();
  await expect(memory.getByText(/Sequence 2–2 \(inclusive\)/)).toBeVisible();
  await memory.getByRole('button', {name: 'Previous records'}).click();
  await expect(memory.getByText(/Sequence 1–1 \(inclusive\)/)).toBeVisible();

  // Lexical search over all sessions, then scoped to the selected one.
  await page.getByLabel('Search memory').fill('quadratic');
  await page.getByRole('button', {name: 'Search', exact: true}).click();
  await expect(memory.getByRole('heading', {name: 'Retrieved passages'})).toBeVisible();
  await expect(memory.getByText('Keyword search, all sessions', {exact: true})).toBeVisible();
  await expect(memory.getByText(/^[1-9][\d,]* results?$/)).toBeVisible();
  const hit = memory.locator('article').first();
  await expect(hit).toContainText(/quadratic/i);
  await expect(hit).toContainText(/compaction epoch \d+, trust: (model output|operator)/);
  await page.getByText('Selected session', {exact: true}).click();
  await expect(page.getByRole('radio', {name: 'Selected session'})).toBeChecked();
  await page.getByRole('button', {name: 'Search', exact: true}).click();
  await expect(memory.getByText(`Keyword search, session ${missionId}`, {exact: true})).toBeVisible();

  // Retention: removing a record from retrieval hides it and lowers the active count.
  // A press on the open session returns from the hits to its records.
  await session.click();
  await expect(memory.getByRole('heading', {name: 'Captured records'})).toBeVisible();
  const before = count((await memory.getByText(/retrievable records? in this session/).textContent()).match(/([\d,]+) retrievable/)[1]);
  const first = memory.locator('article').first();
  const removedHeading = (await first.locator('h3').textContent()).trim(); // "Role, seq N"
  await first.getByRole('button', {name: /^Remove from retrieval/}).click();
  await expect(memory.getByRole('status').filter({hasText: 'Removed from retrieval'})).toBeVisible();
  await expect(memory.getByText(new RegExp(`${(before - 1).toLocaleString('en-US')} retrievable records?`))).toBeVisible();
  // The hidden record no longer appears in session recall, but the history is not erased.
  await session.click();
  await expect(memory.getByRole('heading', {name: 'Captured records'})).toBeVisible();
  await expect(memory.getByRole('heading', {level: 3, name: removedHeading, exact: true})).toHaveCount(0);
  await expect(memory.getByText('Remove from retrieval hides a record from search and recall; the stored history stays.')).toBeVisible();

  // A credential change clears every loaded identity and result.
  await page.getByLabel('Operator token').fill('another-token-that-must-clear-private-state-000');
  await expect(sessions.getByText('Select Load sessions to list captured sessions.')).toBeVisible();
  await expect(sessions.getByRole('option')).toHaveCount(0);
  await expect(memory.getByRole('heading', {name: 'No session selected'})).toBeVisible();
  check();
});

test('memory refuses to answer without a valid operator token', async ({page}) => {
  await page.goto('/');
  await openWorkspace(page, 'Memory', 'Memory results');
  await page.getByLabel('Operator token').fill('not-the-operator-token-at-all-0000000000');
  const sessions = page.getByRole('complementary', {name: 'Sessions'});
  await sessions.getByRole('button', {name: 'Load sessions'}).click();
  // One rejected-token notice sits beside the sessions action; no alert repeats its words.
  const notice = sessions.getByRole('status');
  await expect(notice).toContainText('Token not accepted');
  await expect(notice).toContainText('Enter a current operator token in the header and retry.');
  await expect(notice).toHaveAttribute('data-tone', 'error');
  await expect(sessions.getByRole('alert')).toHaveCount(0);
  await expect(sessions.getByRole('button', {name: 'Load sessions'})).toBeDisabled();
  await expect(page.getByRole('button', {name: 'Search', exact: true})).toBeDisabled();
  await expect(sessions.getByRole('button', {name: 'Go to token field'})).toBeVisible();
});
