// Research: an offline mission's decision tree, reconciliation, verification, capsule
// export, round budget and cancellation, exactly as the browser-QA checklist recorded.
import {test, expect} from '@playwright/test';
import {E2E_TOKEN, openWorkspace, runDemoMission, watchForTokenLeaks} from './fixtures.js';

test('an offline mission explores competing branches, reconciles them and verifies its replay', async ({page}) => {
  const check = watchForTokenLeaks(page);
  await page.goto('/');
  const status = await runDemoMission(page, {goal: 'E2E: which response model fits the fixture?'});
  await expect(status).toHaveText('completed');
  const results = page.getByRole('region', {name: 'Research results'});
  await expect(results.getByRole('heading', {name: 'Decision frontier'})).toBeVisible();
  // Decision tree: the fixture opens a linear route, then quadratic and shuffled-control alternatives.
  const branches = results.locator('.branch');
  await expect(branches).toHaveCount(3);
  await expect(results.locator('.branch.focus')).toHaveCount(1);
  await expect(branches.filter({hasText: /parents: root/})).toHaveCount(1);
  await expect(branches.filter({hasText: /Falsifier:/})).toHaveCount(3);
  // Reconciliation keeps analyst and falsifier positions visible, disagreement included.
  await expect(results.getByRole('heading', {name: 'Reconciliation'})).toBeVisible();
  await expect(results.locator('.record h3').filter({hasText: /analyst · /}).first()).toBeVisible();
  await expect(results.locator('.record h3').filter({hasText: /falsifier · /}).first()).toBeVisible();
  await expect(results.locator('.record h3').filter({hasText: /· challenge$/}).first()).toBeVisible();
  await expect(results.getByText(/Round \d+ · \d+ actions · \d+ model-role calls · data: synthetic_fixture/)).toBeVisible();
  // Verify and recompute: replay passes, integrity holds, validity is explicitly not claimed.
  await results.getByRole('button', {name: 'Verify and recompute'}).click();
  const report = page.getByRole('region', {name: 'Verification report'});
  await expect(report.getByRole('heading', {name: 'Replay verification: passed'})).toBeVisible();
  await expect(report.getByText('Integrity: passed · Evidence graph: passed')).toBeVisible();
  await expect(report.getByText('Scientific validity is not established by replay verification.')).toBeVisible();
  await expect(report.getByRole('alert')).toHaveCount(0);
  // The release ledger: blocked by unknown replay checks before verification, then eligible — never "validated".
  const ledger = page.getByRole('region', {name: 'Release decision'});
  await expect(ledger).toContainText('Release decision: Eligible for human review');
  await expect(ledger.locator('li[data-state="satisfied"]')).toHaveCount(8);
  await expect(ledger.locator('li[data-state="not_applicable"]')).toHaveCount(1);
  // Claim scope: the linear baseline is contradicted, the quadratic route provisionally supported and qualified.
  const scope = page.getByRole('region', {name: 'Claim scope'});
  const linear = scope.locator('article[data-status="contradicted"]').filter({hasText: 'linear ·'});
  await expect(linear).toHaveText(/No supported scope/);
  await expect(linear).toHaveText(/challenged \(falsifier\)/);
  // Both roles support the quadratic route, but the scripted fixture runs them as one identity:
  // the scope is shown and qualified, the status stays unresolved and says why.
  const quadratic = scope.locator('article[data-status="unresolved"]');
  await expect(quadratic).toHaveCount(1);
  await expect(quadratic).toHaveText(/Scope: on the exploratory validation split of the frozen dataset; not independent data\./);
  await expect(quadratic).toHaveText(/shared identity: Both roles ran as the same model identity \(scripted-fixture-v1\)/);
  await expect(quadratic).toHaveText(/Next discriminating test/);
  await expect(scope.locator('article[data-status="provisionally_supported"]')).toHaveCount(0);
  await expect(scope.getByText(/Nothing above is scientific validation/)).toBeVisible();
  // No operator change was declared on this mission; the section says what a change would mean.
  const declared = page.getByRole('region', {name: 'Declared changes'});
  await expect(declared).toHaveText(/No change declared\. Resuming declares an analysis change; claims cannot be edited/);
  await expect(results.getByRole('button', {name: /^Resume/})).toBeDisabled();
  await expect(ledger.locator('li[data-state="satisfied"]').filter({hasText: 'claim scope'})).toHaveText(/contradicted 2, unresolved 1\); a next discriminating test is proposed for 3 of 3/);
  await expect(ledger).toContainText('never scientific validation');
  await expect(results.locator('footer')).toContainText('Publication is not authorized');
  check();
});

test('the release ledger withholds the capsule until the mission is verified', async ({page, request}) => {
  await page.goto('/');
  await runDemoMission(page, {goal: 'E2E: ledger before verification.'});
  const results = page.getByRole('region', {name: 'Research results'});
  const ledger = page.getByRole('region', {name: 'Release decision'});
  await expect(ledger).toContainText('Release decision: Blocked');
  await expect(ledger).toContainText('replay integrity · unknown');
  await expect(results.getByRole('button', {name: 'Export replay capsule'})).toBeDisabled();
  const missionId = (await page.locator('.eyebrow').filter({hasText: 'Selected mission:'}).textContent()).split(': ')[1].trim();
  const refused = await request.get(`/api/missions/${missionId}/capsule`, {headers: {Authorization: `Bearer ${E2E_TOKEN}`}});
  expect(refused.status()).toBe(409);
  expect((await refused.json()).detail).toContain('replay_integrity:unknown');
  await results.getByRole('button', {name: 'Verify and recompute'}).click();
  await expect(ledger).toContainText('Release decision: Eligible for human review');
  await expect(results.getByRole('button', {name: 'Export replay capsule'})).toBeEnabled();
});

test('the replay capsule is delivered as a real browser download once the release is eligible', async ({page}) => {
  await page.goto('/');
  await runDemoMission(page, {goal: 'E2E: capsule export.'});
  const results = page.getByRole('region', {name: 'Research results'});
  await results.getByRole('button', {name: 'Verify and recompute'}).click();
  await expect(results.getByRole('button', {name: 'Export replay capsule'})).toBeEnabled();
  const download = page.waitForEvent('download');
  await results.getByRole('button', {name: 'Export replay capsule'}).click();
  const capsule = await download;
  expect(capsule.suggestedFilename()).toMatch(/\.zip$/);
  const path = await capsule.path();
  const {statSync} = await import('node:fs');
  expect(statSync(path).size).toBeGreaterThan(1000);
});

test('a one-round budget stops the mission as budget_exhausted with alternatives unresolved', async ({page}) => {
  await page.goto('/');
  const status = await runDemoMission(page, {goal: 'E2E: round budget.', rounds: 1});
  await expect(status).toHaveText('budget_exhausted');
  const results = page.getByRole('region', {name: 'Research results'});
  await expect(results.getByRole('status').first()).toContainText(/unresolved|limit/i);
  await expect(results.getByRole('button', {name: 'Resume'})).toBeDisabled();
});

test('cancelling an unfinished mission fences late results; a finished one keeps its outcome', async ({page, request}) => {
  // The offline fixture finishes in about a second, so a ready (created, not started)
  // mission is cancelled through the UI; running-mission cancellation is covered by
  // the service tests.
  const created = await request.post('/api/missions', {
    headers: {Authorization: `Bearer ${E2E_TOKEN}`},
    data: {goal: 'E2E: cancel before it runs.', mode: 'demo', max_rounds: 3, allow_egress: false, vision_review: false, points: null},
  });
  expect(created.status()).toBe(201);
  await page.goto('/');
  await openWorkspace(page, 'Research', 'Research results');
  await page.getByLabel('Local operator token').fill(E2E_TOKEN);
  await page.getByRole('button', {name: 'Load missions'}).click();
  await page.locator('.mission-choice').filter({hasText: 'ready · E2E: cancel before it runs.'}).first().click();
  const results = page.getByRole('region', {name: 'Research results'});
  const status = page.locator('.status-label');
  await expect(status).toHaveText('ready');
  await expect(results.getByRole('button', {name: 'Resume'})).toBeEnabled();
  await results.getByRole('button', {name: 'Cancel'}).click();
  await expect(status).toHaveText('cancelled');
  await expect(results.getByRole('status').first()).toContainText('late results fenced');
  await expect(results.getByRole('button', {name: 'Cancel'})).toBeDisabled();
  await expect(results.getByRole('button', {name: 'Resume'})).toBeDisabled();

  // A completed mission cannot be cancelled: the control is disabled in the UI and the API refuses.
  await runDemoMission(page, {goal: 'E2E: finished missions keep their outcome.'});
  await expect(status).toHaveText('completed');
  await expect(results.getByRole('button', {name: 'Cancel'})).toBeDisabled();
  const missionId = (await page.locator('.eyebrow').filter({hasText: 'Selected mission:'}).textContent()).split(': ')[1].trim();
  const denied = await request.post(`/api/missions/${missionId}/cancel`, {headers: {Authorization: `Bearer ${E2E_TOKEN}`}});
  expect(denied.status()).toBe(409);
});

test('saved missions reload with their outcome and an empty list is actionable', async ({page}) => {
  await page.goto('/');
  await runDemoMission(page, {goal: 'E2E: saved mission listing.'});
  await page.reload();
  await openWorkspace(page, 'Research', 'Research results');
  await expect(page.getByText('Evidence begins with a mission.')).toBeVisible();
  await page.getByLabel('Local operator token').fill(E2E_TOKEN);
  await page.getByRole('button', {name: 'Load missions'}).click();
  const saved = page.locator('.mission-choice').filter({hasText: 'E2E: saved mission listing.'});
  await expect(saved.first()).toBeVisible();
  await saved.first().click();
  await expect(page.locator('.status-label')).toHaveText(/completed|budget_exhausted/);
});

test('a presentation finding is repaired, reviewed again as a new candidate, and the ledger reads the repair', async ({page}) => {
  const check = watchForTokenLeaks(page);
  await page.goto('/');
  const status = await runDemoMission(page, {goal: 'E2E: figure repair cycle.', rounds: 2, vision: true});
  await expect(status).toHaveText('budget_exhausted');
  const results = page.getByRole('region', {name: 'Research results'});
  // Round 0: one fit, flagged by the scripted seat, re-rendered once, then found adequate.
  const repairs = page.getByRole('region', {name: 'Figure repair cycles'});
  const cycles = repairs.getByRole('listitem');
  await expect(cycles.first()).toHaveText(/Cycle 1 · round 0 · preset spacious · addressed legibility → adequate/);
  await expect(cycles.first()).toHaveAttribute('data-outcome', 'adequate');
  await expect(cycles).toHaveCount(2); // round 1 renders the quadratic fit; it is repaired in its own cycle
  await expect(results.locator('.artifact figcaption').filter({hasText: 'superseded by a repair'})).toHaveCount(2);
  await expect(results.locator('.artifact figcaption').filter({hasText: /repair of [0-9a-f]{12}…/})).toHaveCount(2);
  // Every review is the scripted seat's own verdict: issues on the default renders, adequate on the repairs.
  const reviews = results.locator('.record h3').filter({hasText: 'scripted-vision-fixture-v1'});
  await expect(reviews.filter({hasText: /· issues$/})).toHaveCount(2);
  await expect(reviews.filter({hasText: /· adequate$/})).toHaveCount(2);
  await expect(results.getByText(/Scripted fixture verdict/).first()).toBeVisible();
  // Verification reproduces every render, superseded ones included, and the ledger names the cycles.
  await results.getByRole('button', {name: 'Verify and recompute'}).click();
  await expect(page.getByRole('region', {name: 'Verification report'}).getByRole('heading', {name: 'Replay verification: passed'})).toBeVisible();
  const ledger = page.getByRole('region', {name: 'Release decision'});
  await expect(ledger.getByRole('heading', {name: 'Release decision: Eligible for human review'})).toBeVisible();
  await expect(ledger.locator('li[data-state="satisfied"]').filter({hasText: 'visual review'})).toHaveText(/Repair cycles: 1 \(spacious\) -> adequate/);
  await expect(results.getByRole('link', {name: 'Download authenticated PNG'})).toHaveCount(4);
  check();
});
