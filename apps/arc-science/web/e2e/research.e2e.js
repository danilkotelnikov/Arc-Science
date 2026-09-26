// Research: an offline mission's decision tree, reconciliation, verification, capsule
// export, round budget and cancellation, exactly as the browser-QA checklist recorded.
// The selected mission's record is split into tabs; every panel stays mounted but only the
// open one is visible, so each check opens its tab first.
import {test, expect} from '@playwright/test';
import {E2E_TOKEN, STORED_MISSION_KEY, openWorkspace, runDemoMission, selectedMissionId, watchForTokenLeaks} from './fixtures.js';

const openTab = (page, name) => page.getByRole('tablist', {name: 'Mission record'}).getByRole('tab', {name, exact: true}).click();

test('an offline mission explores competing branches, reconciles them and verifies its replay', async ({page}) => {
  const check = watchForTokenLeaks(page);
  await page.goto('/');
  const status = await runDemoMission(page, {goal: 'E2E: which response model fits the fixture?'});
  await expect(status).toHaveText('completed');
  const results = page.getByRole('region', {name: 'Research results'});
  const header = results.getByRole('region', {name: 'Selected mission'});
  await expect(header.getByRole('heading', {name: 'Mission overview'})).toBeVisible();
  // The model source the mission was created with is read from its request, beside the status.
  await expect(header).toContainText('Offline fixture');
  await expect(header.getByRole('term')).toHaveText(['Round', 'Actions', 'Model calls', 'Data source']);
  await expect(header.getByRole('definition').last()).toHaveText('synthetic fixture');
  await expect(results.getByRole('button', {name: /^Resume/})).toBeDisabled();

  // Overview. Decision tree: the fixture opens a linear route, then quadratic and shuffled-control alternatives.
  const branches = results.locator('article[data-branch]');
  await expect(branches).toHaveCount(3);
  await expect(results.locator('article[data-branch][data-focus="true"]')).toHaveCount(1);
  await expect(branches.filter({hasText: /parents: root/})).toHaveCount(1);
  await expect(branches.filter({hasText: 'Would be refuted by'})).toHaveCount(3);

  // Activity. Reconciliation is discoverable but collapsed until the operator asks for the raw role trace.
  await openTab(page, 'Activity');
  const reconciliation = results.getByRole('button', {name: /^Reconciliation \(/});
  await expect(reconciliation).toHaveAttribute('aria-expanded', 'false');
  await reconciliation.click();
  const assessments = results.locator('article[data-position]');
  // The analyst role is printed under the seat that serves it: Reviewer (QA).
  await expect(assessments.filter({hasText: 'Reviewer (QA)'}).first()).toBeVisible();
  await expect(assessments.filter({hasText: 'falsifier'}).first()).toBeVisible();
  await expect(results.locator('article[data-position="challenge"]').first()).toBeVisible();
  // The operational timeline (GET /timeline): one recorded row per operation, in the engine's order, never evidence.
  const timeline = page.getByRole('region', {name: 'Timeline'});
  await expect(timeline).toContainText('not scientific evidence');
  const rows = timeline.locator('tbody tr');
  await expect(rows).toHaveCount(12);
  expect(await rows.evaluateAll(trs => trs.map(tr => tr.dataset.operation))).toEqual(['start', 'plan', 'tool', 'reconcile', 'reconcile', 'plan', 'tool', 'tool', 'reconcile', 'reconcile', 'plan', 'stop']);
  expect(await rows.evaluateAll(trs => trs.map(tr => tr.dataset.outcomeSource))).toEqual(Array(12).fill('recorded'));
  expect(await rows.evaluateAll(trs => trs.map(tr => tr.children[1].textContent.trim() !== '—' && tr.children[2].textContent.trim() !== '—'))).toEqual(Array(12).fill(true));
  await expect(rows.first()).toContainText('operator:token');
  await expect(rows.first()).toHaveAttribute('data-outcome', 'scheduled');
  await expect(rows.last()).toHaveAttribute('data-outcome', 'completed');
  await expect(timeline.getByText('no outcome recorded')).toHaveCount(0);
  // No operator change was declared on this mission; the section says so.
  await expect(page.getByRole('region', {name: 'Declared changes'})).toContainText('No declared change.');

  // Claims. The linear baseline is contradicted, the quadratic route qualified.
  await openTab(page, 'Claims');
  const scope = page.getByRole('region', {name: 'Claim scope'});
  const linear = scope.locator('article[data-status="contradicted"]').filter({has: page.getByRole('heading', {name: 'linear', exact: true})});
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
  await expect(scope.getByText(/provisional support is exploratory, never validation/)).toBeVisible();
  // The cards are derived on read (GET /claims): evidence with method and digest, independence, alternatives, units and the derivation rule.
  for (const row of ['Requested claim', 'Evidence-supported scope', 'Remaining uncertainty', 'Evidence', 'Independence', 'Findings', 'Alternatives', 'Next discriminating test', 'Units', 'Derivation']) {
    await expect(quadratic.locator('dt', {hasText: new RegExp('^' + row + '$')})).toHaveCount(1);
  }
  await expect(quadratic.locator('li[data-evidence-id="fit-quadratic"]')).toHaveText(/fit-quadratic polynomial_fit@arc-numeric-2 digest [0-9a-f]{12}… ok started .+ receipt none validation MSE/);
  await expect(quadratic).toHaveText(/Independent reviewers: no/);
  await expect(quadratic).toHaveText(/parents linear; siblings null-control; children none/);
  await expect(quadratic).toHaveText(/No units are recorded/);
  await expect(quadratic).toHaveText(/arc-claim-scope-3, release check claim scope: passed/);
  await expect(quadratic).toHaveAttribute('data-stale', 'false');
  await expect(scope.getByText(/nothing here is validation/)).toBeVisible();

  // Permissions. An offline fixture binds no route and makes no external call: no grant, no receipt.
  await openTab(page, 'Permissions');
  await expect(page.getByRole('region', {name: 'Mission route'})).toContainText('Offline fixture: scripted roles (scripted-fixture-v1); no route was bound and no grant exists.');
  const grants = page.getByRole('region', {name: 'Grants and receipts'});
  await expect(grants).toContainText('No grants. An offline fixture makes no external calls');
  await expect(grants).toContainText('No receipts');
  await expect(grants.getByRole('grid')).toHaveCount(0);
  await expect(grants.getByRole('button', {name: /^Revoke grant/})).toHaveCount(0);

  // Release. Verify and recompute: replay passes, integrity holds, validity is explicitly not claimed.
  // The fresh report opens the Release tab by itself (from Permissions, where this test stands).
  await results.getByRole('button', {name: 'Replay and verify'}).click();
  await expect(page.getByRole('tablist', {name: 'Mission record'}).getByRole('tab', {name: 'Release', exact: true})).toHaveAttribute('aria-selected', 'true');
  const report = page.getByRole('region', {name: 'Verification report'});
  await expect(report.getByRole('heading', {name: 'Replay verification: passed'})).toBeVisible();
  await expect(report.getByRole('definition')).toHaveText(['passed', 'passed', /^\d+ computations?, \d+ artifacts?$/]);
  await expect(report.getByText('Scientific validity is not established by replay verification.')).toBeVisible();
  await expect(report.getByRole('alert')).toHaveCount(0);
  // The release ledger: eligible after verification, never "validated".
  const ledger = page.getByRole('region', {name: 'Release decision'});
  await expect(ledger).toContainText('Release decision: Eligible for human review');
  await expect(ledger.locator('tr[data-state="satisfied"]')).toHaveCount(8);
  await expect(ledger.locator('tr[data-state="not_applicable"]')).toHaveCount(1);
  await expect(ledger.locator('tr[data-state="satisfied"]').filter({hasText: 'claim scope'})).toHaveText(/contradicted 2, unresolved 1\); a next discriminating test is proposed for 3 of 3/);
  await expect(ledger).toContainText('not validated');
  check();
});

test('the release ledger withholds the capsule until the mission is verified', async ({page, request}) => {
  await page.goto('/');
  await runDemoMission(page, {goal: 'E2E: ledger before verification.'});
  const results = page.getByRole('region', {name: 'Research results'});
  await openTab(page, 'Release');
  const ledger = page.getByRole('region', {name: 'Release decision'});
  await expect(ledger).toContainText('Release decision: Blocked');
  await expect(ledger.locator('tr[data-state="unknown"]').filter({hasText: 'replay integrity'})).toContainText('unverified');
  await expect(results.getByRole('button', {name: 'Export replay archive (.zip)'})).toBeDisabled();
  const missionId = await selectedMissionId(page);
  const refused = await request.get(`/api/missions/${missionId}/capsule`, {headers: {Authorization: `Bearer ${E2E_TOKEN}`}});
  expect(refused.status()).toBe(409);
  expect((await refused.json()).detail).toContain('replay_integrity:unknown');
  await results.getByRole('button', {name: 'Replay and verify'}).click();
  await expect(ledger).toContainText('Release decision: Eligible for human review');
  await expect(results.getByRole('button', {name: 'Export replay archive (.zip)'})).toBeEnabled();
});

test('the replay capsule is delivered as a real browser download once the release is eligible', async ({page}) => {
  await page.goto('/');
  await runDemoMission(page, {goal: 'E2E: capsule export.'});
  const results = page.getByRole('region', {name: 'Research results'});
  await results.getByRole('button', {name: 'Replay and verify'}).click();
  await expect(results.getByRole('button', {name: 'Export replay archive (.zip)'})).toBeEnabled();
  const download = page.waitForEvent('download');
  await results.getByRole('button', {name: 'Export replay archive (.zip)'}).click();
  const capsule = await download;
  expect(capsule.suggestedFilename()).toMatch(/\.zip$/);
  const path = await capsule.path();
  const {statSync} = await import('node:fs');
  expect(statSync(path).size).toBeGreaterThan(1000);
});

test('a one-round budget stops the mission as budget_exhausted with alternatives unresolved', async ({page}) => {
  await page.goto('/');
  const status = await runDemoMission(page, {goal: 'E2E: round budget.', rounds: 1});
  await expect(status).toHaveText('budget exhausted');
  const results = page.getByRole('region', {name: 'Research results'});
  // The stop reason opens the Overview tab.
  await expect(results.getByRole('status').first()).toContainText(/unresolved|limit/i);
  await expect(results.getByRole('button', {name: 'Resume', exact: true})).toBeDisabled();
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
  await page.getByLabel('Operator token').fill(E2E_TOKEN);
  await page.getByRole('button', {name: 'Load missions'}).click();
  await page.getByRole('option').filter({hasText: 'E2E: cancel before it runs.'}).filter({hasText: 'ready'}).first().click();
  const results = page.getByRole('region', {name: 'Research results'});
  const status = results.locator('.status-label');
  await expect(status).toHaveText('ready');
  // A created-but-not-started mission offers Start, not Resume.
  await expect(results.getByRole('button', {name: 'Start', exact: true})).toBeEnabled();
  await results.getByRole('button', {name: 'Cancel'}).click();
  await expect(status).toHaveText('cancelled');
  await expect(results.getByRole('status').first()).toContainText('late results fenced');
  await expect(results.getByRole('button', {name: 'Cancel'})).toBeDisabled();
  await expect(results.getByRole('button', {name: 'Resume', exact: true})).toBeDisabled();

  // A completed mission cannot be cancelled: the control is disabled in the UI and the API refuses.
  await runDemoMission(page, {goal: 'E2E: finished missions keep their outcome.'});
  await expect(status).toHaveText('completed');
  await expect(results.getByRole('button', {name: 'Cancel'})).toBeDisabled();
  const missionId = await selectedMissionId(page);
  const denied = await request.post(`/api/missions/${missionId}/cancel`, {headers: {Authorization: `Bearer ${E2E_TOKEN}`}});
  expect(denied.status()).toBe(409);
});

test('saved missions reload with their outcome and an empty list is actionable', async ({page}) => {
  await page.goto('/');
  await runDemoMission(page, {goal: 'E2E: saved mission listing.'});
  await page.reload();
  await openWorkspace(page, 'Research', 'Research results');
  await expect(page.getByText('No mission selected.')).toBeVisible();
  await page.getByLabel('Operator token').fill(E2E_TOKEN);
  await page.getByRole('button', {name: 'Load missions'}).click();
  const saved = page.getByRole('option').filter({hasText: 'E2E: saved mission listing.'});
  await expect(saved.first()).toBeVisible();
  await saved.first().click();
  await expect(page.getByRole('region', {name: 'Research results'}).locator('.status-label')).toHaveText(/completed|budget exhausted/);
});

test('the selected mission is reopened after a reload once the token is entered; the browser stores its id only', async ({page}) => {
  const check = watchForTokenLeaks(page);
  await page.goto('/');
  await runDemoMission(page, {goal: 'E2E: reopen after reload.', rounds: 1});
  const missionId = await selectedMissionId(page);
  expect(await page.evaluate(key => [Object.keys(localStorage), localStorage.getItem(key)], STORED_MISSION_KEY)).toEqual([[STORED_MISSION_KEY], missionId]);
  await page.reload();
  await openWorkspace(page, 'Research', 'Research results');
  // Locked: nothing is restored and nothing is requested until the token is entered.
  await expect(page.getByText('No mission selected.')).toBeVisible();
  const missionReads = [];
  page.on('request', (request) => { if (request.url().includes('/api/missions')) missionReads.push(new URL(request.url()).pathname); });
  await page.getByLabel('Operator token').fill(E2E_TOKEN);
  // Typing alone requests nothing; leaving the field settles the token and restores the mission.
  await page.waitForTimeout(300);
  expect(missionReads).toEqual([]);
  await page.getByLabel('Operator token').press('Tab');
  const results = page.getByRole('region', {name: 'Research results'});
  await expect(results.locator('[data-mission-id]')).toHaveText('Selected mission: ' + missionId);
  await expect(results.locator('.status-label')).toHaveText('budget exhausted');
  expect(missionReads).not.toContain('/api/missions');
  expect(missionReads).toContain(`/api/missions/${missionId}`);
  const stored = await page.evaluate(() => Object.entries(localStorage));
  expect(stored).toEqual([[STORED_MISSION_KEY, missionId]]);
  expect(JSON.stringify(stored)).not.toContain(E2E_TOKEN);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  check();
});

test('a presentation finding is repaired, reviewed again as a new candidate, and the ledger reads the repair', async ({page}) => {
  const check = watchForTokenLeaks(page);
  await page.goto('/');
  const status = await runDemoMission(page, {goal: 'E2E: figure repair cycle.', rounds: 2, vision: true});
  await expect(status).toHaveText('budget exhausted');
  const results = page.getByRole('region', {name: 'Research results'});
  await openTab(page, 'Evidence');
  // Round 0: one fit, flagged by the scripted seat, re-rendered once, then found adequate.
  const repairs = page.getByRole('region', {name: 'Figure repair cycles'});
  const cycles = repairs.getByRole('listitem');
  await expect(cycles.first()).toHaveText(/Cycle 1, round 0\. Render preset spacious; addressed legibility\. Review verdict: adequate/);
  await expect(cycles.first()).toHaveAttribute('data-outcome', 'adequate');
  await expect(cycles).toHaveCount(2); // round 1 renders the quadratic fit; it is repaired in its own cycle
  await expect(results.locator('figure figcaption').filter({hasText: 'superseded by a repair'})).toHaveCount(2);
  await expect(results.locator('figure figcaption').filter({hasText: /repair of [0-9a-f]{12}…/})).toHaveCount(2);
  // Every review is the scripted seat's own verdict: issues on the default renders, adequate on the repairs.
  const reviews = verdict => results.locator(`article[data-verdict="${verdict}"]`).filter({hasText: 'scripted-vision-fixture-v1'});
  await expect(reviews('issues')).toHaveCount(2);
  await expect(reviews('adequate')).toHaveCount(2);
  await expect(results.getByText(/Scripted fixture verdict/).first()).toBeVisible();
  // Verification reproduces every render, superseded ones included, and the ledger names the cycles.
  await results.getByRole('button', {name: 'Replay and verify'}).click();
  await openTab(page, 'Release');
  await expect(page.getByRole('region', {name: 'Verification report'}).getByRole('heading', {name: 'Replay verification: passed'})).toBeVisible();
  const ledger = page.getByRole('region', {name: 'Release decision'});
  await expect(ledger.getByRole('heading', {name: 'Release decision: Eligible for human review'})).toBeVisible();
  await expect(ledger.locator('tr[data-state="satisfied"]').filter({hasText: 'visual review'})).toHaveText(/Repair cycles: 1 \(spacious\) -> adequate/);
  await openTab(page, 'Evidence');
  await expect(results.getByRole('button', {name: 'Download PNG'})).toHaveCount(4);
  check();
});

test('live mode on a service without seats is blocked in the composer; nothing is sent and no 409 appears', async ({page}) => {
  const check = watchForTokenLeaks(page);
  const missionPosts = [], conflicts = [], previews = [];
  page.on('request', (request) => { if (request.method() === 'POST' && request.url().includes('/api/missions')) missionPosts.push(request.url()); if (request.url().includes('/api/missions/preview')) previews.push(request.url()); });
  page.on('response', (response) => { if (response.status() === 409) conflicts.push(response.url()); });
  await page.goto('/');
  await openWorkspace(page, 'Research', 'Research results');
  await page.getByLabel('Operator token').fill(E2E_TOKEN);
  await page.getByLabel('Research goal').fill('E2E: live route without seats.');
  await page.getByText('Execution settings', {exact: true}).click();
  await page.getByLabel('Model source').click();
  await page.getByRole('option', {name: /^Live models/}).click();
  await page.getByLabel(/Permit sending/).check({force: true});
  // The e2e data directory has no seat set, so the planner blocks the live route; the server names it.
  const route = page.getByRole('region', {name: 'Live route'});
  await expect(route).toContainText('No seat is configured.');
  await expect(route.getByRole('status')).toContainText('Planner');
  // A blocked route is not previewed: the grants panel says so and lists no destination.
  const grants = page.getByRole('region', {name: 'Route and grants'});
  await expect(grants).toContainText('The route cannot be previewed while the live route is blocked');
  await expect(grants.getByRole('row')).toHaveCount(0);
  await expect(grants.getByLabel('Approve route')).toHaveCount(0);
  const create = page.getByRole('button', {name: 'Create and start'});
  await expect(create).toBeDisabled();
  await expect(create.locator('..')).toContainText('Live models are blocked.');
  await expect(page.getByText('Execution settings', {exact: true}).locator('..')).toContainText('seats: Blocked');
  await route.getByRole('button', {name: 'Open Settings'}).click();
  await expect(page.getByRole('navigation', {name: 'Workspaces'}).getByRole('button', {name: 'Settings'})).toHaveAttribute('aria-current', 'page');
  expect(missionPosts).toEqual([]);
  expect(conflicts).toEqual([]);
  expect(previews).toEqual([]);
  check();
});
