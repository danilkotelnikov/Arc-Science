// Native journeys against the real desktop binary (arc-science-desktop.exe) over the
// diagnostic attach: an isolated launch on its own project, app-data folder and port
// (never 8080, never %LOCALAPPDATA%\ArcScience), then eleven named journeys in a fixed
// order — fresh-profile, attach, offline-mission, reopen, diagnostics, open-startup-log,
// export, interrupt-kill, interrupt-reopen, close, release — each recorded in
// <out>/report.json as {name, at, ok, ...facts} beside screenshots 01–14, the downloaded
// PNG and replay archive, and the UIA download log. Every string in the report passes
// redact(): USERPROFILE becomes ~ and the scratch root becomes <scratch>. Nothing leaves
// this machine: the live mission runs on scripts/fixtures/fake_planner_cli.py and
// apps/arc-science/tests/fixtures/fake_mcp_server.py.
//
// usage: node scripts/native-journeys.mjs --out <dir> [--exe <path>] [--port 8090]
//        [--python <exe>] [--journeys a,b] [--scratch <dir>]
// Exit 1 when any journey is not ok or an exception occurred (the report is still written).
import {createRequire} from 'node:module';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import os from 'node:os';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Playwright lives in the web package only (no repo-root node_modules).
const require = createRequire(resolve(repo, 'apps/arc-science/web/package.json'));
const {chromium} = require('@playwright/test');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { args[a.slice(2)] = process.argv[i + 1]; i++; }
}
if (!args.out) { console.error('usage: node scripts/native-journeys.mjs --out <dir> [--exe <path>] [--port 8090] [--python <exe>] [--journeys a,b] [--scratch <dir>]'); process.exit(2); }
const out = resolve(args.out);
const exe = resolve(args.exe || join(repo, 'native/arc-desktop/target/release/arc-science-desktop.exe'));
const port = Number(args.port || 8090);
const scratch = resolve(args.scratch || join(os.tmpdir(), 'arc-native-journeys'));
const python = args.python || execFileSync('where', ['python'], {encoding: 'utf-8'}).split(/\r?\n/)[0].trim();
const ORDER = ['fresh-profile', 'attach', 'offline-mission', 'reopen', 'diagnostics', 'open-startup-log', 'export', 'interrupt-kill', 'interrupt-reopen', 'close', 'release'];
const ALWAYS = ['fresh-profile', 'attach', 'close', 'release'];
const selected = new Set(args.journeys ? [...args.journeys.split(',').map(s => s.trim()).filter(Boolean), ...ALWAYS] : ORDER);
for (const name of selected) if (!ORDER.includes(name)) { console.error(`unknown journey ${name}; known: ${ORDER.join(', ')}`); process.exit(2); }
if (port === 8080) { console.error('port 8080 belongs to the operator instance'); process.exit(2); }
if (!scratch.endsWith('arc-native-journeys')) { console.error(`refusing to wipe ${scratch}: the scratch folder must end in arc-native-journeys`); process.exit(2); }
if (spawnSync(python, ['-c', 'import mcp'], {encoding: 'utf-8'}).status !== 0) { console.error(`${python} cannot import mcp (needed by the fake MCP server)`); process.exit(2); }

rmSync(scratch, {recursive: true, force: true});
mkdirSync(scratch, {recursive: true});
mkdirSync(out, {recursive: true});
for (const f of readdirSync(out)) if (f.startsWith('99-error-')) unlinkSync(join(out, f)); // stale error captures of an earlier run
const project = join(scratch, 'workspace');
const appdata = join(scratch, 'appdata');
const home = process.env.USERPROFILE || os.homedir();
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pathPattern = p => new RegExp(p.split(/[\\/]+/).filter(Boolean).map(escapeRe).join('[\\\\/]+'), 'gi');
const patterns = [[pathPattern(scratch), '<scratch>'], [pathPattern(home), '~']];
const redact = value => {
  if (typeof value === 'string') return patterns.reduce((s, [re, to]) => s.replace(re, to), value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]));
  return value;
};
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();

const report = {started: now(), finished: null, exe, exe_sha256: sha256(exe), port, node: process.version, journeys: [], ok: false};
const save = () => { report.finished = now(); report.ok = report.journeys.every(j => j.ok) && !report.error; writeFileSync(join(out, 'report.json'), JSON.stringify(redact(report), null, 1)); };
const journey = (name, facts) => { const entry = {name, at: now(), ok: facts.ok === true, ...facts}; report.journeys.push(entry); console.log(name, entry.ok ? 'ok' : 'NOT OK', JSON.stringify(redact(facts)).slice(0, 700)); save(); return entry; };

// ---- PowerShell helpers (read-only except the two named actions) -----------------------
const ps = script => execFileSync('powershell', ['-NoProfile', '-Command', script], {encoding: 'utf-8', maxBuffer: 1 << 24}).trim();
const psJson = script => JSON.parse(ps('ConvertTo-Json -Compress -Depth 4 -InputObject (& { ' + script + ' })') || 'null');
const list = v => Array.isArray(v) ? v : v == null ? [] : [v];
const launch = attach => {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(repo, 'scripts', 'native-launch.ps1'), '-Exe', exe, '-Project', project, '-AppData', appdata, '-Port', String(port), ...(attach ? ['-Attach'] : [])], {encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit']});
  const line = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
  if (r.status !== 0 || !line) throw new Error(`native-launch.ps1 exited ${r.status}: ${line || '(no JSON line)'}`);
  return JSON.parse(line);
};
const listenerChain = () => ps(`$c=Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop | Select-Object -First 1; $p=$c.OwningProcess; $chain=@(); while($p -and $p -ne 0){ $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$p"; if(-not $proc){break}; $chain+=("$($proc.ProcessId):$($proc.Name)"); $p=$proc.ParentProcessId }; $chain -join ' <- '`);
const processTree = pid => list(psJson(`$d=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; $s=Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | Where-Object { $_.Name -eq 'arc-science-native.exe' } | Select-Object -First 1; $w=if($s){Get-CimInstance Win32_Process -Filter "ParentProcessId=$($s.ProcessId)" | Where-Object { $_.Name -like 'python*' } | Select-Object -First 1}; $m=if($w){Get-CimInstance Win32_Process -Filter "ParentProcessId=$($w.ProcessId)" | Where-Object { $_.Name -eq 'arc-memory-worker.exe' } | Select-Object -First 1}; @(@($d,$s,$w,$m) | Where-Object { $_ } | ForEach-Object { @{pid=$_.ProcessId; name=$_.Name} })`));
// Closes only a window this run launched (the pid comes from native-launch.ps1's JSON line).
const closeWindow = pid => psJson(`$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if(-not $p){ @{closed=$false; exited=$true; note='already gone'} } else { if($p.Path -notlike '*${launched.exe}'){ throw "pid ${pid} is not ${launched.exe}" }; $closed=$p.CloseMainWindow(); $exited=$p.WaitForExit(20000); if(-not $exited){ Stop-Process -Id ${pid} -Force }; @{closed=$closed; exited=$exited} }`);
const alivePids = pids => pids.length ? list(psJson(`@(Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })`)) : [];
const listening = () => list(psJson(`@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess })`));
const profileSnapshot = () => {
  // Read-only: the operator's own profile is never written; only its timestamps are compared.
  const root = join(process.env.LOCALAPPDATA || '', 'ArcScience');
  const stat = p => { try { const s = statSync(p); return {mtime: s.mtimeMs, ...(s.isFile() ? {size: s.size} : {})}; } catch { return null; } };
  return {dir: stat(root), startup_log: stat(join(root, 'startup.log')), attach_record_present: existsSync(join(root, 'diagnostic-attach.json')), webview: stat(join(root, 'webview')), webview_diagnostic: stat(join(root, 'webview-diagnostic'))};
};

// ---- page helpers (HeroUI v3 workbench; patterns from apps/arc-science/web/e2e) ---------
let browser = null, page = null, launched = null;
const pids = new Set();
const shot = name => page.screenshot({path: join(out, name + '.png'), fullPage: false});
const text = async loc => (await loc.innerText()).replace(/\s+/g, ' ');
const nav = () => page.getByRole('navigation', {name: 'Workspaces'});
const open = async name => { await nav().getByRole('button', {name}).click(); await page.waitForTimeout(500); };
const results = () => page.getByRole('region', {name: 'Research results'});
const status = () => results().locator('.status-label').first();
// The mission record is split into tabs; every panel stays mounted but only the open one is
// visible, so the timeline is read with includeHidden and each screenshot opens its tab first.
const timeline = () => page.getByRole('region', {name: 'Timeline', includeHidden: true});
const openTab = async name => {
  const tab = results().getByRole('tablist', {name: 'Mission record'}).getByRole('tab', {name, exact: true});
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await page.waitForTimeout(300);
};
const TERMINAL = /completed|budget|needs|error|cancelled/;
const timelineRows = async () => {
  const rows = timeline().locator('tbody tr');
  const n = await rows.count(); const list = [];
  for (let i = 0; i < n; i++) {
    const r = rows.nth(i);
    list.push({operation: await r.getAttribute('data-operation'), role: await r.getAttribute('data-role'), outcome: await r.getAttribute('data-outcome'), source: await r.getAttribute('data-outcome-source'), text: (await r.innerText()).replace(/\s+/g, ' ').slice(0, 200)});
  }
  return list;
};
// The selected mission's id is on the element that reads 'Selected mission: <id>'.
const selectedId = () => page.evaluate(() => document.querySelector('[data-mission-id]')?.dataset.missionId?.toLowerCase() || null).catch(() => null);
const waitForNewMission = async previous => page.waitForFunction(prev => { const id = document.querySelector('[data-mission-id]')?.dataset.missionId; return !!id && id.toLowerCase() !== String(prev).toLowerCase(); }, previous, {timeout: 30000});
const waitForLastRow = async (operation, seconds = 15) => { for (let i = 0; i < seconds * 2; i++) { const rows = await timelineRows(); if (rows.length && rows.at(-1).operation === operation) return rows; await sleep(500); } return timelineRows(); };
const storage = () => page.evaluate(() => { try { return Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])); } catch (e) { return {error: String(e)}; } });
// The interface follows the WebView's language (Russian on a Russian Windows) until the header's
// EN/RU toggle is pressed; the journeys read English, so EN is pressed once. The choice is stored
// as arc.ui.locale in this run's isolated WebView2 profile, so a relaunch opens in English.
const LOCALE_KEY = 'arc.ui.locale';
const sessionReady = async () => {
  await page.locator('header.ar-header').waitFor({timeout: 30000});
  await page.waitForFunction(() => ['en', 'ru'].includes(document.documentElement.lang), null, {timeout: 10000});
  const lang = await page.evaluate(() => document.documentElement.lang);
  if (lang !== 'en') await page.locator('header.ar-header').getByText('EN', {exact: true}).click();
  // A desktop session shows the 'Desktop session' chip beside 'Use operator token'.
  await page.getByRole('button', {name: 'Use operator token'}).waitFor({timeout: 30000});
  return lang;
};
const connect = async endpoint => {
  browser = await chromium.connectOverCDP(endpoint);
  page = browser.contexts()[0].pages()[0];
  return sessionReady();
};
// 'Execution settings' is an accordion item; a reload closes it and a click on an open one closes it too.
const openExecutionSettings = async () => { if (!(await page.getByLabel('Round limit').isVisible())) await page.getByText('Execution settings', {exact: true}).click(); };
// Settings (HeroUI): selects are trigger buttons named by value, aria-label and label ("None Planner
// provider Provider"), text fields by aria-label and label; see field()/choose() in e2e/settings.e2e.js.
const settingsRegion = () => page.getByRole('region', {name: 'Settings', exact: true});
const openSection = async title => {
  const trigger = settingsRegion().getByRole('button', {name: new RegExp('^' + title)});
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
};
const words = label => new RegExp('(^|\\s)' + escapeRe(label) + '(\\s|$)');
const field = label => page.getByRole('button', {name: words(label)}).or(page.getByRole('textbox', {name: words(label)}))
  .or(page.getByLabel(words(label))).filter({visible: true}).first();
const choose = async (label, option) => {
  await field(label).click();
  await page.getByRole('listbox').getByRole('option', typeof option === 'string' ? {name: option, exact: true} : {name: option}).click();
};
const startOfflineMission = async (goal, rounds) => {
  await open('Research');
  await page.waitForTimeout(1500);
  const previous = await selectedId();
  await page.getByLabel('Research goal').fill(goal);
  await openExecutionSettings();
  await page.getByLabel('Round limit').fill(String(rounds));
  await page.getByRole('button', {name: 'Create and start'}).click();
  await waitForNewMission(previous);
  const mid = await selectedId();
  await status().filter({hasText: TERMINAL}).waitFor({timeout: 120000});
  await page.waitForTimeout(1500);
  return mid;
};
const attachJourney = async () => {
  launched = launch(true);
  pids.add(launched.pid);
  const record = JSON.parse(readFileSync(join(appdata, 'diagnostic-attach.json'), 'utf-8'));
  const chain = listenerChain();
  const tree = processTree(launched.pid);
  for (const p of tree) pids.add(p.pid);
  const facts = {launch: launched, record, listener_chain: chain, belongs_to_exe: chain.includes(`${launched.pid}:${launched.exe}`), tree};
  facts.ok = facts.belongs_to_exe && launched.health_ready === true;
  const lang = await connect(record.endpoint);
  facts.interface_language = {on_attach: lang, switched_to_en: lang !== 'en'};
  return facts;
};

let offlineMission = null, offlineRows = 0, liveMission = null;
const profileBefore = profileSnapshot();
const fresh = journey('fresh-profile', {ok: false, before: profileBefore, after: null, note: 'compared again after release'});
const steps = {
  attach: attachJourney,
  'offline-mission': async () => {
    offlineMission = await startOfflineMission('Slice 6 native: offline fixture mission for the timeline and claim cards.', 3);
    const rows = await waitForLastRow('stop');
    offlineRows = rows.length;
    await openTab('Activity');
    await timeline().scrollIntoViewIfNeeded();
    await shot('01-research-timeline');
    await openTab('Permissions');
    const route = (await text(page.getByRole('region', {name: 'Mission route'})).catch(() => 'absent')).slice(0, 400);
    await openTab('Claims');
    const claims = page.getByRole('region', {name: 'Claim scope'});
    const cards = claims.locator('article[data-status]');
    const n = await cards.count(); const cardData = [];
    for (let i = 0; i < n; i++) {
      const c = cards.nth(i);
      cardData.push({status: await c.getAttribute('data-status'), stale: await c.getAttribute('data-stale'), dts: await c.locator('dt').allInnerTexts(), head: (await c.locator('h3').first().innerText()).slice(0, 80)});
    }
    await claims.scrollIntoViewIfNeeded();
    await shot('02-research-claim-cards');
    await openTab('Release');
    const release = (await text(results().getByRole('region', {name: 'Release decision'})).catch(() => 'absent')).slice(0, 500);
    await shot('03-research-release');
    const TEN = ['Requested claim', 'Evidence-supported scope', 'Remaining uncertainty', 'Evidence', 'Independence', 'Findings', 'Alternatives', 'Next discriminating test', 'Units', 'Derivation'];
    const tenRowCards = cardData.filter(c => c.dts.length === 10 && TEN.every(l => c.dts.includes(l))).length;
    return {ok: rows[0]?.operation === 'start' && rows.at(-1)?.operation === 'stop' && rows.length >= 8 && tenRowCards >= 1,
      mission: offlineMission, status: await status().innerText(), rows, route, claim_cards: cardData, ten_row_cards: tenRowCards, release};
  },
  reopen: async () => {
    const before = await selectedId();
    await page.reload();
    await sessionReady();
    await open('Research');
    await results().locator('[data-mission-id]').waitFor({timeout: 20000}).catch(() => {});
    await page.waitForTimeout(1000);
    await openTab('Activity').catch(() => {});
    const rows = await timelineRows();
    const store = await storage();
    await shot('04-research-reopened');
    const selected = await selectedId();
    // The interface-language choice (arc.ui.locale, 'en') is the one key besides the mission id; it is reported apart.
    const {[LOCALE_KEY]: locale, ...rest} = store;
    return {ok: !!before && selected === before && rows.length === offlineRows, before, selected, rows: rows.length, storage_keys: Object.keys(store), storage_values_are_ids: Object.values(rest).every(v => /^[0-9a-f]{32}$/i.test(String(v))), storage_locale: locale ?? null};
  },
  diagnostics: async () => {
    await open('Diagnostics');
    const service = page.locator('article[data-host-session]');
    await service.waitFor({timeout: 20000});
    const hostSession = await service.getAttribute('data-host-session');
    const hostText = (await text(service)).slice(0, 400);
    await shot('05-diagnostics-host-session');
    await page.getByRole('button', {name: 'Read diagnostics'}).click();
    const sections = ['storage', 'jobs', 'renderer', 'package', 'probes'];
    for (const s of sections) await page.locator(`[data-section="${s}"]`).filter({hasText: 'Source:'}).waitFor({timeout: 60000});
    const cards = {}; let sources = 0;
    for (const s of sections) { const t = await text(page.locator(`[data-section="${s}"]`)); if (t.includes('Source:')) sources++; cards[s] = t.slice(0, 300); }
    await page.locator('[data-section="storage"]').scrollIntoViewIfNeeded();
    await shot('06-diagnostics-read');
    await page.getByRole('button', {name: 'Copy redacted report'}).click();
    await page.waitForTimeout(2500);
    // The report text sits in a 'Redacted report' disclosure (open by itself only when the clipboard refused it).
    const reads = page.locator('section[aria-labelledby="diagnostics-reads"]');
    const disclosure = reads.getByRole('button', {name: 'Redacted report', exact: true});
    if (await disclosure.count() && (await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
    const area = reads.locator('pre.ar-code').first();
    const reportText = (await area.textContent({timeout: 5000}).catch(() => '')) || '';
    await area.scrollIntoViewIfNeeded({timeout: 5000}).catch(() => {});
    const format = (reportText.match(/"format": "([^"]+)"/) || [])[1] || null;
    const hasHome = reportText.toLowerCase().includes(home.toLowerCase());
    const hasBearer = /Bearer (?!\[redacted\])\S+/.test(reportText);
    await shot('07-diagnostics-report');
    return {ok: hostSession === 'owned' && sources === 5 && !hasHome && !hasBearer, host_session: hostSession, host_text: hostText, cards, sources, report_chars: reportText.length, format, has_home_path: hasHome, has_bearer_value: hasBearer};
  },
  'open-startup-log': async () => {
    await open('Diagnostics');
    const button = page.getByRole('button', {name: 'Open startup log'});
    if (await button.count() === 0) return {ok: false, error: 'no Open startup log button: the served bundle predates the slice-6 Diagnostics change'};
    const clickedAt = new Date();
    await button.click();
    const logPath = join(appdata, 'startup.log');
    const requested = 'Diagnostics: open log requested by the workbench page';
    let log = '';
    for (let i = 0; i < 10; i++) { log = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : ''; if (log.includes(requested)) break; await sleep(500); }
    const notice = await page.getByRole('status').filter({hasText: /startup log/}).first().innerText().catch(() => 'absent');
    // Only a viewer started after the click and titled with the log's name is closed (Notepad takes a
    // few seconds to title its window); an already running editor that opened a tab is left alone.
    let viewers = [];
    for (let i = 0; i < 20 && !viewers.length; i++) {
      await sleep(500);
      // ToLocalTime: the ISO string parses as Kind=Utc while StartTime is local, and -gt compares ticks regardless of Kind.
      viewers = list(psJson(`$t=[datetime]::Parse('${clickedAt.toISOString()}', $null, 'RoundtripKind').ToLocalTime(); @(Get-Process | Where-Object { $_.MainWindowTitle -like '*startup.log*' -and $_.StartTime -gt $t } | ForEach-Object { $null=$_.CloseMainWindow(); $_.ProcessName })`));
    }
    const lines = log.split(/\r?\n/).filter(l => l.startsWith('Diagnostics'));
    return {ok: log.includes(requested) && !log.includes('Diagnostics open log failed'), log_lines: lines, notice: notice.trim(), viewer: viewers.length ? viewers.join(',') : 'viewer not identified'};
  },
  export: async () => {
    const mid = await startOfflineMission('Slice 6 native: export the replay archive and download the figure.', 2);
    await openTab('Evidence');
    const figures = results().locator('figure[data-artifact]');
    await figures.first().waitFor({timeout: 20000});
    const before = {figures: await figures.count(), download_buttons: await results().getByRole('button', {name: 'Download PNG'}).count(), blocked_sentence: await results().getByText(/Download opens when the release decision is Eligible for human review/).count(), export_enabled: await results().getByRole('button', {name: /Export replay archive/}).isEnabled()};
    await figures.first().scrollIntoViewIfNeeded();
    await shot('08-research-figure-before-verify');
    // A fresh replay report opens the Release tab by itself.
    await results().getByRole('button', {name: 'Replay and verify'}).click();
    await results().getByText(/Release decision: Eligible for human review/).waitFor({timeout: 60000});
    const release = (await text(results().getByRole('region', {name: 'Release decision'}))).slice(0, 200);
    await shot('09-research-after-verify');
    // Download PNG lives in the Evidence tab; it stays selected while UI Automation clicks.
    await openTab('Evidence');
    await results().getByRole('button', {name: 'Download PNG'}).first().waitFor({timeout: 20000});
    const after = {release, download_buttons: await results().getByRole('button', {name: 'Download PNG'}).count(), export_enabled: await results().getByRole('button', {name: /Export replay archive/}).isEnabled()};
    // A WebView2 download needs a user gesture and no CDP client attached (slice 5: a CDP click
    // produced nothing and Playwright's attach suppressed the UIA download), so the driver is
    // disconnected while UI Automation clicks, then reattached for the screenshot.
    await browser.close(); browser = null;
    const uia = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(repo, 'scripts', 'native-uia-download.ps1'), '-Out', out, '-ProcessId', String(launched.pid), '-Downloads', join(home, 'Downloads')], {encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit']});
    const result = (uia.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
    const m = result.match(/^RESULT png=(.*) zip=(.*)$/);
    await connect(launched.attach.endpoint);
    await open('Research');
    await openTab('Evidence').catch(() => {});
    await results().locator('figure[data-artifact]').first().scrollIntoViewIfNeeded().catch(() => {});
    await shot('10-research-downloads');
    if (uia.status !== 0 || !m || !m[1] || !m[2]) return {ok: false, mission: mid, before, after, uia_exit: uia.status, uia_result: result, error: 'download missing'};
    const files = {};
    for (const [kind, from] of [['png', m[1]], ['zip', m[2]]]) {
      const to = join(out, basename(from));
      try { renameSync(from, to); } catch { copyFileSync(from, to); unlinkSync(from); }
      files[kind] = {name: basename(to), bytes: statSync(to).size, sha256: sha256(to)};
    }
    const verify = spawnSync(python, ['-m', 'arc_science', 'verify', join(out, files.zip.name)], {encoding: 'utf-8', env: {...process.env, PYTHONPATH: join(repo, 'apps', 'arc-science', 'src'), PYTHONUTF8: '1'}});
    let verified = {};
    try { verified = JSON.parse(verify.stdout); } catch { verified = {parse_error: (verify.stderr || verify.stdout || '').slice(0, 300)}; }
    const summary = {exit: verify.status, format: verified.format ?? null, integrity: verified.integrity ?? null, reproduction_passed: verified.reproduction_passed ?? null, members: Array.isArray(verified.members) ? verified.members.length : null};
    const digest12 = (files.png.name.match(/^arc-[0-9a-f]{32}-([0-9a-f]{12})\.png$/i) || [])[1] || '';
    return {ok: summary.integrity === true && summary.format === 'arc-research-capsule/3' && digest12.length === 12 && files.png.sha256.startsWith(digest12.toLowerCase()), mission: mid, before, after, files, verify: summary, png_digest_prefix: digest12};
  },
  'interrupt-kill': async () => {
    const cmd = join(scratch, 'fake-claude.cmd');
    // The Settings arguments field splits on whitespace (no quoting), so a repo path with spaces
    // cannot be passed; the fixture is copied unchanged into the scratch folder and its digest recorded.
    const mcpFixture = join(repo, 'apps', 'arc-science', 'tests', 'fixtures', 'fake_mcp_server.py');
    const mcpServer = join(scratch, 'fake_mcp_server.py');
    copyFileSync(mcpFixture, mcpServer);
    if (/\s/.test(mcpServer) || /\s/.test(python)) throw new Error('the MCP server command and script paths must not contain spaces (the arguments field splits on whitespace)');
    writeFileSync(cmd, `@"${python}" "${join(repo, 'scripts', 'fixtures', 'fake_planner_cli.py')}" --arc-sleep 25 %*\r\n`);
    await open('Settings');
    await page.getByRole('article', {name: 'Planner seat'}).waitFor({timeout: 15000});
    await choose('Planner provider', 'Anthropic');
    await choose('Planner model', /\(claude-opus-5\)$/);
    await choose('Planner sign-in', /^CLI login/);
    await openSection('Advanced');
    await field('Anthropic CLI command').fill(cmd);
    await openSection('Connections');
    if (await field('MCP server 1 name').count() === 0) {
      await page.getByRole('button', {name: 'Add MCP server'}).click();
      await field('MCP server 1 name').fill('fake');
      await field('MCP server 1 command').fill(python);
      await field('MCP server 1 arguments').fill(mcpServer);
      await page.getByRole('group', {name: 'MCP server 1'}).getByLabel('Consent: missions may send data to this server').check({force: true});
    }
    await page.getByRole('button', {name: 'Save', exact: true}).click();
    await page.getByRole('status').filter({hasText: /Saved \(revision/}).first().waitFor({timeout: 20000});
    await open('Research');
    await page.waitForTimeout(1500);
    const previous = await selectedId();
    await page.getByLabel('Research goal').fill('Slice 6 native: interrupt the service mid-mission, reopen, resume.');
    await openExecutionSettings();
    await page.getByLabel('Model source').click();
    await page.getByRole('option', {name: /^Live models/}).click();
    await page.getByLabel('Round limit').fill('4');
    // HeroUI draws each checkbox's box over its hidden input, so the inputs are checked with force.
    const routePanel = page.getByRole('region', {name: 'Route and grants'});
    await routePanel.getByLabel('Approve route').waitFor({state: 'attached', timeout: 20000});
    await page.getByLabel(/Permit sending/).check({force: true});
    await routePanel.getByLabel('Approve route').check({force: true});
    await page.getByRole('button', {name: 'Create and start'}).click();
    await waitForNewMission(previous);
    liveMission = await selectedId();
    await status().filter({hasText: /running/}).waitFor({timeout: 60000});
    await openTab('Activity');
    await timeline().locator('tbody tr[data-operation="plan"]').first().waitFor({timeout: 60000});
    const rows = await timelineRows();
    await shot('11-research-live-running');
    // Exactly one python.exe: the service of this run (arc_science, this port, this workspace); anything else throws.
    const killed = ps(`$p=@(Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*arc_science*' -and $_.CommandLine -like '*--port ${port} *' -and $_.CommandLine -like '*${project.replace(/'/g, "''")}*' }); if($p.Count -ne 1){ throw "expected exactly one service process, found $($p.Count)" }; Stop-Process -Id $p[0].ProcessId -Force; "killed $($p[0].ProcessId)"`);
    await sleep(4000);
    const pageText = (await text(results()).catch(() => '')).slice(0, 400);
    const alerts = await page.getByRole('alert').allInnerTexts().catch(() => []);
    await shot('12-research-after-service-exit');
    await browser.close(); browser = null;
    const closed = closeWindow(launched.pid);
    writeFileSync(cmd, `@"${python}" "${join(repo, 'scripts', 'fixtures', 'fake_planner_cli.py')}" --arc-sleep 2 %*\r\n`);
    return {ok: rows.some(r => r.operation === 'plan') && killed.startsWith('killed') && closed.exited === true, mission: liveMission, rows, killed, not_reachable: alerts, page_text: pageText, window: closed, mcp_server: {copied_from: mcpFixture, sha256: sha256(mcpServer)}};
  },
  'interrupt-reopen': async () => {
    const facts = await attachJourney();
    await open('Research');
    await results().locator('[data-mission-id]').waitFor({timeout: 20000}).catch(() => {});
    await page.waitForTimeout(1000);
    const selected = await selectedId();
    const statusText = await status().innerText().catch(() => 'absent');
    // The interruption banner (an alert carrying data-event="mission_interrupted") is on the Overview tab.
    await openTab('Overview').catch(() => {});
    const banner = (await results().locator('[data-event]').first().innerText({timeout: 5000}).catch(() => 'absent')).replace(/\s+/g, ' ').slice(0, 300);
    const rows = await timelineRows();
    const buttons = {};
    for (const name of ['Pause', 'Retry after error', 'Cancel', 'Start']) buttons[name] = await results().getByRole('button', {name, exact: true}).isEnabled({timeout: 3000}).catch(() => 'absent');
    const resume = results().getByRole('button', {name: /^Resume/});
    buttons.resume = (await resume.innerText().catch(() => 'absent')) + ' · enabled ' + (await resume.isEnabled().catch(() => 'absent'));
    await results().locator('[data-event]').first().scrollIntoViewIfNeeded({timeout: 5000}).catch(() => {});
    await shot('13-research-reopened-interrupted');
    const reopened = selected === liveMission && /paused/.test(statusText) && banner.includes('Interrupted') && rows.some(r => r.operation === 'interrupt' && r.role === 'service') && rows.some(r => r.operation === 'plan' && r.outcome === 'outcome_unknown' && r.source === 'derived');
    await resume.click();
    // A planner call still in flight keeps the 25 s delay; the rewritten .cmd sleeps 2 s per call afterwards.
    await status().filter({hasText: TERMINAL}).waitFor({timeout: 480000});
    await page.waitForTimeout(1500);
    const finalRows = await waitForLastRow('stop');
    await openTab('Permissions');
    const grants = (await text(page.getByRole('region', {name: 'Grants and receipts'})).catch(() => 'absent')).slice(0, 600);
    await openTab('Activity');
    await timeline().scrollIntoViewIfNeeded().catch(() => {});
    await shot('14-research-resumed-finished');
    return {ok: facts.ok && reopened && finalRows.at(-1)?.operation === 'stop', relaunch: facts, selected, status: statusText, banner, rows, buttons, resumed_status: await status().innerText(), resumed_rows: finalRows, tool_outcomes: finalRows.filter(r => r.operation === 'tool').map(r => r.outcome), grants};
  },
  close: async () => {
    if (browser) { await browser.close(); browser = null; }
    const closed = launched ? closeWindow(launched.pid) : {closed: false, exited: true, note: 'never launched'};
    return {ok: closed.exited === true, ...closed};
  },
  release: async () => {
    const recorded = [...pids];
    let alive = recorded, listeners = [];
    for (let i = 0; i < 40; i++) { alive = alivePids(recorded); listeners = listening(); if (!alive.length && !listeners.length) break; await sleep(500); }
    fresh.after = profileSnapshot();
    fresh.ok = JSON.stringify(fresh.after) === JSON.stringify(fresh.before);
    console.log('fresh-profile', fresh.ok ? 'ok' : 'NOT OK', JSON.stringify(fresh.after));
    return {ok: !alive.length && !listeners.length, recorded_pids: recorded, alive, listeners};
  },
};

try {
  for (const name of ORDER.slice(1)) {
    if (!selected.has(name)) continue;
    if (report.error && !['close', 'release'].includes(name)) continue;
    let facts;
    try { facts = await steps[name](); }
    catch (error) {
      facts = {ok: false, error: String(error).slice(0, 700)};
      if (page) await shot('99-error-' + name).catch(() => {});
      report.error = `${name}: ${String(error).slice(0, 300)}`;
    }
    journey(name, facts);
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  save();
  console.log(report.ok ? 'all journeys ok' : 'NOT OK', join(out, 'report.json'));
}
process.exit(report.ok ? 0 : 1);
