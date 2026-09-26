// Settings: read through the native supervisor, loaded by the workspace once the token
// in the header settles (Enter here), written back with the revision that was read; a
// stale revision is refused by the owner and re-applied onto the newer one on request.
import {test, expect} from '@playwright/test';
import {E2E_TOKEN, openWorkspace, watchForTokenLeaks} from './fixtures.js';

const headers = {Authorization: `Bearer ${E2E_TOKEN}`};
// The file block beside the page head carries the revision and the one status line (save, rebase).
const fileBlock = page => page.getByRole('region', {name: 'Settings file', exact: true});
const sidebarStatus = page => fileBlock(page).getByRole('status');
const settingsRegion = page => page.getByRole('region', {name: 'Settings', exact: true});
// Sections are accordion items; one left open (Reload keeps the form mounted) is not toggled shut.
const openSection = async (page, title) => {
  const trigger = settingsRegion(page).getByRole('button', {name: new RegExp('^' + title)});
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
};
// A field by its name as whole words: a HeroUI select trigger is named by its value, its
// aria-label and its visible label together ("None Planner provider Provider"), and
// React Aria keeps a hidden native select beside it, so only what is on screen counts.
// A text field with a visible label is labelled by itself and that label together
// ("Planner credential Credential name"), which getByLabel reads as two separate labels,
// so text fields are found by role and accessible name like the select triggers.
const words = label => new RegExp('(^|\\s)' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)');
const field = (page, label) => page.getByRole('button', {name: words(label)}).or(page.getByRole('textbox', {name: words(label)}))
  .or(page.getByLabel(words(label))).filter({visible: true}).first();
// A section's panel is named by its trigger (title, then summary) and stays in the page while folded.
const sectionPanel = (page, title) => settingsRegion(page).getByRole('group', {name: new RegExp('^' + title + '\\s'), includeHidden: true});
const choose = async (page, label, option) => {
  await field(page, label).click();
  await page.getByRole('listbox').getByRole('option', typeof option === 'string' ? {name: option, exact: true} : {name: option}).click();
};

async function openSettings(page) {
  await page.goto('/');
  await openWorkspace(page, 'Settings', 'Settings');
  await page.getByLabel('Operator token').fill(E2E_TOKEN);
  await page.getByLabel('Operator token').press('Enter');
}

test('seats load by themselves, are edited in the workspace and persisted by the supervisor', async ({page, request}) => {
  const probe = await request.get('/api/settings', {headers});
  test.skip(probe.status() === 503, 'native supervisor not built; settings unavailable');
  const check = watchForTokenLeaks(page);
  await page.goto('/');
  await openWorkspace(page, 'Settings', 'Settings');
  // Typing the token sends nothing from Settings and draws no rejection; the load waits
  // for the field to settle (Enter), then runs once with the whole token. Settings is the
  // only workspace here that asks for readiness with a manual token, so its reads count it.
  const readinessReads = [];
  page.on('request', r => { if (r.url().endsWith('/api/readiness')) readinessReads.push(r.headers().authorization); });
  await page.getByLabel('Operator token').pressSequentially(E2E_TOKEN.slice(0, 8));
  await expect(settingsRegion(page)).toContainText('Settings load when you leave the token field');
  await expect(fileBlock(page)).not.toContainText('Token not accepted');
  await page.getByLabel('Operator token').fill(E2E_TOKEN);
  await page.getByLabel('Operator token').press('Enter');
  // No click on Load settings: the snapshot loads once the token has settled.
  await expect(field(page, 'Planner provider')).toBeVisible();
  expect(readinessReads).toEqual([`Bearer ${E2E_TOKEN}`]);
  await expect(page.getByRole('button', {name: 'Reload', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Load settings'})).toHaveCount(0);
  for (const title of ['Appearance', 'Research Models', 'Connections', 'Rendering', 'Viewer', 'Advanced', 'Permissions']) await expect(settingsRegion(page).getByText(title, {exact: true})).toBeVisible();
  await choose(page, 'Planner provider', 'OpenAI');
  await choose(page, 'Planner model', /\(gpt-5\.6-sol\)$/);
  await expect(page.getByRole('article', {name: 'Planner seat'})).toContainText('In catalog');
  await choose(page, 'Planner effort', 'high');
  await field(page, 'Planner credential').fill('planner');
  await choose(page, 'Reviewer (QA) provider', 'Anthropic');
  await choose(page, 'Reviewer (QA) model', /\(claude-sonnet-5\)$/);
  await choose(page, 'Reviewer (QA) sign-in', /^CLI login/);
  await choose(page, 'Falsifier provider', 'Gemini');
  await choose(page, 'Falsifier model', /\(gemini-3\.8-flash\)$/);
  await choose(page, 'Falsifier sign-in', /^CLI login/);
  await expect(field(page, 'Falsifier effort')).toHaveText('medium');
  await expect(field(page, 'Falsifier effort')).toBeDisabled();
  await expect(page.getByRole('article', {name: 'Falsifier seat'})).toContainText('No effort control on this model/sign-in; the provider default applies');
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(sidebarStatus(page)).toHaveText(/^Saved \(revision [0-9a-f]{12}\)\. .*applies at next live mission start\./);
  const snap = await (await request.get('/api/settings', {headers})).json();
  expect(snap.settings.seats.planner).toMatchObject({provider: 'openai', model: 'gpt-5.6-sol', effort: 'high'});
  expect(snap.settings.seats.reviewer).toMatchObject({provider: 'anthropic', model: 'claude-sonnet-5', auth: 'cli'});
  // The owner refuses a stale revision and an invalid document; the file keeps its last valid state.
  const stale = await request.put('/api/settings', {headers, data: {settings: snap.settings, if_revision: 'f'.repeat(64)}});
  expect(stale.status()).toBe(409);
  const invalid = {...snap.settings, seats: {...snap.settings.seats, vision: {...snap.settings.seats.vision, provider: 'gemini', model: ''}}};
  const rejected = await request.put('/api/settings', {headers, data: {settings: invalid, if_revision: snap.revision}});
  expect(rejected.status()).toBe(422);
  expect((await rejected.json()).detail).toContain('seats.vision.model');
  expect((await (await request.get('/api/settings', {headers})).json()).revision).toBe(snap.revision);
  check();
});

test('a save onto a stale revision is refused, and "Reload and keep my edits" carries the draft onto the newer one', async ({page, request}) => {
  const probe = await request.get('/api/settings', {headers});
  test.skip(probe.status() === 503, 'native supervisor not built; settings unavailable');
  await openSettings(page);
  await expect(field(page, 'Planner provider')).toBeVisible();
  // Only Research Models opens by itself; the fields this test drives sit in two other sections.
  await openSection(page, 'Rendering');
  await openSection(page, 'Viewer');
  await expect(page.getByLabel('Blender preset')).toBeVisible();
  const loaded = await (await request.get('/api/settings', {headers})).json();
  // The workspace edits one field while another party saves a different one.
  await page.getByLabel('Blender preset').fill('e2e_rebase_preset');
  const elsewhere = {...loaded.settings, viewer: {...loaded.settings.viewer, background: loaded.settings.viewer.background === 'black' ? 'white' : 'black'}};
  expect((await request.put('/api/settings', {headers, data: {settings: elsewhere, if_revision: loaded.revision}})).status()).toBe(200);
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  const conflict = page.getByRole('alert');
  await expect(conflict).toContainText('Settings changed elsewhere');
  await expect(conflict).not.toContainText('Request failed (409)');
  await expect(page.getByLabel('Blender preset')).toHaveValue('e2e_rebase_preset');
  await conflict.getByRole('button', {name: 'Reload and keep my edits'}).click();
  await expect(sidebarStatus(page)).toHaveText(/^Edits re-applied onto revision [0-9a-f]{12}; review and save$/);
  await expect(page.getByLabel('Blender preset')).toHaveValue('e2e_rebase_preset');
  // The select shows the value's word (White, Black).
  await expect(field(page, 'Viewer background')).toHaveText(new RegExp('^' + elsewhere.viewer.background + '$', 'i'));
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(sidebarStatus(page)).toHaveText(/^Saved \(revision [0-9a-f]{12}\)\. Rendering: applies at next render submission\./);
  const snap = await (await request.get('/api/settings', {headers})).json();
  expect(snap.settings.blender.default_preset).toBe('e2e_rebase_preset');
  expect(snap.settings.viewer.background).toBe(elsewhere.viewer.background);
});

test('at 700 px wide the seat cards and the providers fit the viewport', async ({page, request}) => {
  const probe = await request.get('/api/settings', {headers});
  test.skip(probe.status() === 503, 'native supervisor not built; settings unavailable');
  await page.setViewportSize({width: 700, height: 900});
  await openSettings(page);
  await expect(field(page, 'Planner provider')).toBeVisible();
  await openSection(page, 'Advanced');
  await expect(field(page, 'OpenClaw agent id')).toBeVisible();
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth)).toBe(true);
});

test('a custom model id is marked unverified until the service has checked it', async ({page, request}) => {
  const probe = await request.get('/api/settings', {headers});
  test.skip(probe.status() === 503, 'native supervisor not built; settings unavailable');
  await openSettings(page);
  await choose(page, 'Vision provider', 'OpenAI');
  await choose(page, 'Vision model', 'Custom id…');
  await field(page, 'Vision custom model id').fill('gpt-e2e-custom');
  const vision = page.getByRole('article', {name: 'Vision seat'});
  await expect(vision).toContainText('Custom id (unverified): not in the catalog; readiness cannot be assumed');
  await expect(vision).toContainText('Unsaved');
  await expect(vision).not.toContainText('In catalog');
});

test('a browser session stores a credential from a terminal; Test seat needs consent, and a probe with no stored credential spends nothing', async ({page, request}) => {
  const probe = await request.get('/api/settings', {headers});
  test.skip(probe.status() === 503, 'native supervisor not built; settings unavailable');
  const check = watchForTokenLeaks(page);
  await openSettings(page);
  await choose(page, 'Planner provider', 'OpenAI');
  await choose(page, 'Planner model', /\(gpt-5\.6-sol\)$/);
  await choose(page, 'Planner sign-in', /^API credential/);
  await choose(page, 'Planner effort', 'medium');
  await field(page, 'Planner credential').fill('e2e-missing');
  const planner = page.getByRole('article', {name: 'Planner seat'});
  // No desktop host here: the terminal command instead of Store/Remove, and Test seat
  // waits for the save (it probes the saved seat) and then for the consent tick.
  await expect(planner).toContainText('Store it from a terminal: arc-science credential --name e2e-missing --data <data dir>');
  await expect(planner.getByRole('button', {name: 'Planner store credential'})).toHaveCount(0);
  await expect(planner.getByRole('button', {name: 'Planner remove credential'})).toHaveCount(0);
  const testSeat = planner.getByRole('button', {name: 'Planner test seat'});
  await expect(testSeat).toBeDisabled();
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(sidebarStatus(page)).toHaveText(/^Saved \(revision [0-9a-f]{12}\)\./);
  await expect(planner).toContainText('No credential is stored under the name e2e-missing');
  await expect(planner).toContainText('Never probed');
  await expect(testSeat).toBeDisabled();
  await expect(planner).toContainText('Tick the consent box to enable Test seat.');
  await field(page, 'Planner probe consent').check({force: true});
  await expect(testSeat).toBeEnabled();
  // The probe resolves the credential before any request: with none stored under the name,
  // every subject fails at that step, nothing is sent to the provider and no token is spent.
  const [reply] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/providers/openai/probe')), testSeat.click()]);
  expect(reply.status()).toBe(200);
  const results = (await reply.json()).results;
  expect(results.length).toBeGreaterThan(0);
  for (const result of results) {
    expect(result).toMatchObject({transport: 'api', ok: false});
    expect(result.error).toContain('No credential named e2e-missing');
    expect(result).not.toHaveProperty('observed_model');
  }
  // Readiness keeps the same cause; the tick is spent; no request-failure card appears.
  await expect(planner).toContainText('No credential is stored under the name e2e-missing');
  await expect(planner).toContainText('Never probed');
  await expect(field(page, 'Planner probe consent')).not.toBeChecked();
  await expect(testSeat).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  check();
});

test('a custom endpoint is confirmed under Advanced and the confirmation round-trips through save', async ({page, request}) => {
  const probe = await request.get('/api/settings', {headers});
  test.skip(probe.status() === 503, 'native supervisor not built; settings unavailable');
  const official = (await probe.json()).settings.providers.openai.endpoint;
  await openSettings(page);
  await expect(field(page, 'Planner provider')).toBeVisible();
  await openSection(page, 'Advanced');
  await expect(field(page, 'OpenAI endpoint')).toBeVisible();
  // On the official origin there is nothing to confirm; off it, the box appears unticked.
  await expect(field(page, 'OpenAI custom endpoint confirmed')).toHaveCount(0);
  await field(page, 'OpenAI endpoint').fill('https://relay.e2e.invalid/v1/responses');
  const confirm = field(page, 'OpenAI custom endpoint confirmed');
  await expect(confirm).not.toBeChecked();
  await expect(field(page, 'Anthropic custom endpoint confirmed')).toHaveCount(0);
  await confirm.check({force: true});
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(sidebarStatus(page)).toHaveText(/^Saved \(revision [0-9a-f]{12}\)\. OpenAI provider: applies at next live mission start\./);
  let snap = await (await request.get('/api/settings', {headers})).json();
  expect(snap.settings.providers.openai).toMatchObject({endpoint: 'https://relay.e2e.invalid/v1/responses', custom_endpoint_confirmed: true});
  // Reload reads the confirmation back from the owner.
  await page.getByRole('button', {name: 'Reload', exact: true}).click();
  await expect(sidebarStatus(page)).toHaveCount(0);
  await openSection(page, 'Advanced');
  await expect(field(page, 'OpenAI custom endpoint confirmed')).toBeChecked();
  // Withdrawing the confirmation blocks any OpenAI API seat until it is confirmed again or cleared.
  await field(page, 'OpenAI custom endpoint confirmed').uncheck({force: true});
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(sidebarStatus(page)).toHaveText(/^Saved/);
  snap = await (await request.get('/api/settings', {headers})).json();
  expect(snap.settings.providers.openai.custom_endpoint_confirmed).toBe(false);
  if (snap.settings.seats.planner.provider === 'openai' && snap.settings.seats.planner.auth === 'api_key') {
    const planner = page.getByRole('article', {name: 'Planner seat'});
    await expect(planner).toContainText('https://relay.e2e.invalid is not the official origin; the credential is not sent there until it is confirmed');
    await expect(planner).toContainText('Next: Confirm the custom endpoint under Settings → Advanced, or clear it');
  }
  // Back on the official origin the box is gone and the stored flag stays off.
  await field(page, 'OpenAI endpoint').fill(official);
  await expect(field(page, 'OpenAI custom endpoint confirmed')).toHaveCount(0);
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(sidebarStatus(page)).toHaveText(/^Saved/);
  snap = await (await request.get('/api/settings', {headers})).json();
  expect(snap.settings.providers.openai).toMatchObject({endpoint: official, custom_endpoint_confirmed: false});
});

test('settings recovery copy hides the raw missing-supervisor error and offers Retry', async ({page}) => {
  await page.route('**/api/settings', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({detail: 'No settings file is configured for this service'})
  }));
  await openSettings(page);
  await expect(page.getByRole('alert')).toContainText('No settings file was given to this service.');
  await expect(page.getByText('Settings file not configured')).toBeVisible();
  await expect(page.getByRole('alert')).not.toContainText('Request failed (503)');
  await expect(page.getByRole('alert').getByRole('button', {name: 'Retry'})).toBeVisible();
});

test('Permissions reads the grant ledger when it opens and shows it empty on a fresh service', async ({page, request}) => {
  const probe = await request.get('/api/settings', {headers});
  test.skip(probe.status() === 503, 'native supervisor not built; settings unavailable');
  const ledger = await request.get('/api/grants', {headers});
  test.skip(ledger.status() === 404, 'grant ledger route not in this service build');
  expect(ledger.status()).toBe(200);
  const body = await ledger.json();
  const rows = Array.isArray(body) ? body : body.grants;
  const reads = [];
  page.on('request', r => { if (r.url().endsWith('/api/grants')) reads.push(r.method()); });
  await openSettings(page);
  await expect(field(page, 'Planner provider')).toBeVisible();
  const permissions = sectionPanel(page, 'Permissions');
  await expect(permissions).toContainText('A mission is granted access only when you approve its route in Research.');
  // Nothing was asked of the ledger until the section opened; then one read.
  expect(reads).toEqual([]);
  await openSection(page, 'Permissions');
  if (rows.length === 0) await expect(permissions).toContainText('No grants yet');
  else await expect(permissions.getByRole('grid', {name: 'Grants'}).getByRole('row')).toHaveCount(rows.length + 1);
  await expect(field(page, 'Show')).toHaveText('All');
  expect(reads).toEqual(['GET']);
  await page.getByRole('button', {name: 'Refresh permissions'}).click();
  await expect.poll(() => reads.length).toBe(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
