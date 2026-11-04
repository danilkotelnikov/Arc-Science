// Opens the web profile of an Arc Harness archive in a headless browser and reads every main screen.
//   node test/ui-crawl.mjs [--asar build/app.asar] [--out <folder>] [--exe <electron exe>] [--keep]
// Checks, in light and in dark:
//   no DeepSeek, DSH or Whale wording in text, labels, tooltips and placeholders (real model names allowed)
//   no blue, text contrast of at least 3 (4.5 is reported as a warning), the first-run look is Light, Dark is selectable
// Each phase runs on its own server and its own throwaway home (first-run, dark, light), so one phase cannot change another.
//   --phase first-run|dark|light   runs one phase only; without it all three run one after another
// Writes one PNG per screen and report.json to the output folder. Exit 0 only when every check passes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classify } from '../lib/brandrules.mjs';
import { findIn, TIER } from './independent-scan.mjs';
import { quietConfig, removeHome, linkTree, treeHash, treeDiff, dataHome } from '../lib/testhome.mjs';
import { lean } from '../tools/lean-profile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const asar = path.resolve(opt('--asar', path.join(root, 'build', 'app.asar')));
const outDir = path.resolve(opt('--out', path.join(root, '_scratch', 'crawl')));
const APP_DIR = process.env.ARC_APP_DIR || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness');
const EXE = opt('--exe', path.join(APP_DIR, 'DeepSeek Harness.exe'));
const phase = opt('--phase', null);
if (!phase) {
  const reports = [];
  let bad = 0;
  fs.mkdirSync(outDir, { recursive: true });
  for (const ph of ['first-run', 'dark', 'light']) {
    fs.rmSync(path.join(outDir, `report-${ph}.json`), { force: true }); // a report left by an earlier run must not stand in for this one
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...argv, '--phase', ph], { stdio: 'inherit' });
    if (r.status !== 0) { bad++; console.log(`FAIL phase ${ph}: the child ${r.status === null ? 'was killed or did not start' : 'exited with ' + r.status}`); } // a killed child has status null
    try { reports.push(JSON.parse(fs.readFileSync(path.join(outDir, `report-${ph}.json`), 'utf8'))); } catch { bad++; }
  }
  const merged = { asar, failures: reports.flatMap((r) => r.failures), warnings: reports.flatMap((r) => r.warnings), skipped: reports.flatMap((r) => r.skipped || []), phases: reports.map((r) => r.scheme) };
  const lines = {};
  for (const r of reports) for (const sc of Object.values(r.scheme)) for (const [n, v] of Object.entries(sc.screens || {})) (lines[n] ||= []).push(v.lines);
  for (const [n, arr] of Object.entries(lines)) if (arr.length > 1 && Math.min(...arr) < 0.4 * Math.max(...arr)) merged.failures.push(`screen ${n}: the text read differs a lot between phases (${arr.join(', ')} lines)`);
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(merged, null, 1));
  for (const f of merged.failures.filter((x) => x.startsWith('screen '))) console.log('FAIL ' + f);
  console.log(`all phases: failures ${merged.failures.length}, warnings ${merged.warnings.length}; report ${path.join(outDir, 'report.json')}`);
  process.exit(bad || merged.failures.length ? 1 : 0);
}
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
if (!EDGE) { console.error('no Edge or Chrome found'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const killTree = (pid) => { try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };

// ---- the server: the web profile served from the archive under test
const unpacked = asar + '.unpacked';
let madeUnpacked = false;
if (!fs.existsSync(unpacked)) { fs.symlinkSync(path.join(APP_DIR, 'resources', 'app.asar.unpacked'), unpacked, 'junction'); madeUnpacked = true; }
const serverLog = path.join(outDir, 'server.log');
// a throwaway home keeps the settings, sessions and storages of the test apart from the user's data;
// only the plugin profiles are shared (read for plugins and config)
// The profile is a copy of its small config files plus a hard-linked copy of its plugin packages: the app writes settings
// (for example the theme choice) into cordis.patch.yml, and that must never reach the real profile.
const realProfile = path.join(dataHome(), 'profiles', 'web');
const hashOf = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const realConfigs = fs.readdirSync(realProfile).filter((f) => f !== 'node_modules' && fs.statSync(path.join(realProfile, f)).isFile());
const realBefore = new Map(realConfigs.map((f) => [f, hashOf(path.join(realProfile, f))]));
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-home-'));
fs.mkdirSync(path.join(testHome, 'profiles', 'web'), { recursive: true });
// The copy of cordis.patch.yml has the MCP clients switched off (no python child, no call to the local gateway) and no saved theme (lib/testhome.mjs);
// the dark and light phases append their own theme row below, the first-run phase has none.
for (const f of realConfigs) {
  const from = path.join(realProfile, f), to = path.join(testHome, 'profiles', 'web', f);
  if (f === 'cordis.patch.yml') fs.writeFileSync(to, quietConfig(fs.readFileSync(from, 'utf8')));
  else if (f === 'package.json' && argv.includes('--lean')) fs.writeFileSync(to, lean(fs.readFileSync(from, 'utf8'), (b) => fs.existsSync(path.join(realProfile, 'node_modules', b)) || argv.some((a, i) => argv[i - 1] === '--plugin' && path.basename(a) === b))); // the lean bundle list of tools/lean-profile.mjs
  else fs.copyFileSync(from, to);
}
if (phase === 'dark' || phase === 'light') {
  const cfg = path.join(testHome, 'profiles', 'web', 'cordis.patch.yml');
  fs.appendFileSync(cfg, `\n- id: ui-theme\n  name: "@arc-harness/arc-client-ui-theme"\n  config:\n    preference: ${phase}\n`);
}
// The plugin packages are a real tree of hard links to the real files (a junction to the real folder made ten plugins fail to load, because the
// loader resolves @deepseek-ai/* from the real path). The real package files are hashed before and after: a write through a link would change them.
const nmReal = path.join(realProfile, 'node_modules');
const nmBefore = treeHash(nmReal);
const nmCounts = linkTree(nmReal, path.join(testHome, 'profiles', 'web', 'node_modules'));
console.log(`plugin packages: ${nmCounts.linked} files hard-linked, ${nmCounts.copied} copied, ${nmCounts.skipped} links skipped, ${nmCounts.dirs} folders`);
// --plugin <folder>: test a plugin from its source folder. Its links in the throwaway home are replaced by a copy (removing a hard link
// leaves the real file), so the real profile keeps its installed version.
for (let i = argv.indexOf('--plugin'); i >= 0; i = argv.indexOf('--plugin', i + 1)) {
  const src = path.resolve(argv[i + 1]);
  const name = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).name;
  const dst = path.join(testHome, 'profiles', 'web', 'node_modules', name);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true, filter: (f) => !/[\\/](node_modules|test)$/.test(f) });
  console.log(`plugin ${name}: tested from ${src}`);
}
// Every exit, early ones included, goes through here. removeHome never enters a link.
async function cleanupHome() {
  await new Promise((r) => setTimeout(r, 1200));
  if (!(await removeHome(testHome))) console.log(`WARN the throwaway home ${testHome} could not be removed; remove it by hand`);
  if (madeUnpacked) { try { fs.rmdirSync(unpacked); } catch { /* in use */ } }
}
const server = spawn(EXE, ['--expose-internals', `${asar}/arc/node_modules/@arc-harness/arc-desktop-host/lib/cli.js`, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'],
  { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ARC_HOME: testHome, DSH_HOME: testHome }, stdio: ['ignore', fs.openSync(serverLog, 'w'), fs.openSync(serverLog, 'a')], windowsHide: true });
let url = null;
for (let i = 0; i < 90 && !url; i++) {
  await sleep(1000);
  const m = /http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/.exec(fs.readFileSync(serverLog, 'utf8'));
  if (m) url = m[0];
}
if (!url) { killTree(server.pid); await cleanupHome(); console.error('server did not start; see ' + serverLog); process.exit(2); }

// ---- the browser (Chrome DevTools protocol over a plain WebSocket)
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-crawl-'));
const browser = spawn(EDGE, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore', windowsHide: true });
let port = 0;
for (let i = 0; i < 60 && !port; i++) {
  await sleep(500);
  try { port = +fs.readFileSync(path.join(profileDir, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { /* not yet */ }
}
if (!port) { killTree(server.pid); killTree(browser.pid); await cleanupHome(); console.error('browser did not start'); process.exit(2); }

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const waiting = new Map();
  const opened = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { const { res, rej } = waiting.get(m.id); waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiting.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  return { opened, send, close: () => ws.close() };
}

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const cdp = connect(target.webSocketDebuggerUrl);
await cdp.opened;
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
const evalIn = async (expr) => {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
};
const shot = async (name) => {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.data, 'base64'));
};
const emulate = async (scheme) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
};

// ---- helpers that run inside the page
const PAGE = `(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lab = (b) => (b.getAttribute('aria-label') || b.textContent || '').trim();
  const find = (starts) => [...document.querySelectorAll('button,[role=tab],[role=menuitem],[role=option],a')].find((b) => lab(b).startsWith(starts));
  const toRgb = (s) => { const m = s && s.match(/rgba?\\(([\\d.]+)[ ,]+([\\d.]+)[ ,]+([\\d.]+)(?:[ ,/]+([\\d.]+))?/); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const hsl = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return { h, s, l }; };
  const blend = (top, under) => { const a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; };
  const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) { const c = toRgb(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) chain.push(c); if (c && c[3] >= 0.99) break; } let acc = [255, 255, 255, 1]; for (const c of chain.reverse()) acc = blend(c, acc); return acc; };
  const texts = () => {
    const out = [];
    out.push(document.title);
    out.push(...document.body.innerText.split('\\n'));
    for (const e of document.querySelectorAll('[aria-label],[title],[placeholder],[alt]')) { for (const a of ['aria-label', 'title', 'placeholder', 'alt']) { const v = e.getAttribute(a); if (v) out.push(v); } }
    return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
  };
  const colours = () => {
    const blue = [], contrast = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      for (const p of ['color', 'backgroundColor', 'borderTopColor', 'fill', 'stroke']) {
        const c = toRgb(cs[p]);
        if (!c || c[3] < 0.3) continue;
        const x = hsl(c);
        if (x.h >= 195 && x.h <= 265 && x.s >= 0.2 && x.l > 0.08 && x.l < 0.97) { const k = cs[p] + p; if (!seen.has(k)) { seen.add(k); blue.push(p + ' ' + cs[p] + ' on ' + el.tagName + '.' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 40)); } }
      }
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
      if (own) {
        const fg = toRgb(cs.color); if (!fg) continue;
        const bg = bgOf(el); const fgc = fg[3] < 1 ? blend(fg, bg) : fg;
        const l1 = lum(fgc), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
        if (ratio < (big ? 3 : 4.5)) contrast.push({ ratio: +ratio.toFixed(2), text: el.textContent.trim().slice(0, 40), color: cs.color });
      }
    }
    return { blue, contrast };
  };
  // wait while a loading skeleton is on the page (up to 15 s), then until the text stops changing
  const settle = async () => {
    for (let i = 0; i < 30 && document.querySelector('[class*="keleton"],[aria-busy="true"]'); i++) await sleep(500);
    let last = -1;
    for (let i = 0; i < 12; i++) { const n = document.body.innerText.length; if (n === last) return; last = n; await sleep(500); }
  };
  const clickAndWait = async (starts, ms = 1300) => { const b = find(starts); if (!b) return false; b.click(); await sleep(ms); await settle(); return true; };
  const dialogOpen = () => !!document.querySelector('[role=dialog]');
  const closeDialog = async () => { const c = [...document.querySelectorAll('[role=dialog] button')].find((b) => lab(b) === 'Close'); if (c) c.click(); await sleep(500); };
  const openSettings = async (section) => {
    if (!dialogOpen()) { const b = find('Settings'); if (!b) return false; b.click(); await sleep(1500); }
    if (!dialogOpen()) return false;
    const nav = [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim().startsWith(section));
    if (!nav) return false;
    nav.click(); await sleep(1100); return true;
  };
  const chooseAppearance = async (name) => {
    if (!(await openSettings('General'))) return false;
    const b = [...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.trim() === name);
    if (!b) return false;
    b.click(); await sleep(1200); return true;
  };
  const bodyBg = () => getComputedStyle(document.body).backgroundColor;
  window.__arc = { settle, sleep, find, texts, colours, clickAndWait, dialogOpen, closeDialog, openSettings, chooseAppearance, bodyBg };
  return 'ready';
})()`;

// Escape as a real key press (a synthetic event does not close every popup), then the dialog's own Close button
const pressEscape = async () => {
  for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
};
async function closeAll() {
  for (let i = 0; i < 3; i++) {
    await pressEscape();
    await sleep(300);
    if (await evalIn('__arc.dialogOpen()')) await evalIn('__arc.closeDialog()');
  }
  return !(await evalIn('__arc.dialogOpen()'));
}

// ---- the screens
// Every screen must open. A screen may be marked optional only with a reason (it is absent on a fresh data home).
// The screens that sit on the composer start from the home page (the Plugins page replaces it).
const HOME = "__arc.clickAndWait('New session', 900)";
const OPT_SETTINGS = 'the settings page appears only when the data home holds data of that plugin; a fresh test home has none';
const LEAN = argv.includes('--lean'); // the lean profile (tools/lean-profile.mjs) on the lean core (patch 14 of tools/build.mjs)
const ABSENT_NAV = ['Plugins', 'Automation tasks', 'Context Insights', 'More', 'Import Sessions', 'Standard mode', 'Minimal mode', 'Creator mode', 'PTC mode'];
const ABSENT_SETTINGS = ['Built-in plugins', 'Agent presets', 'Skills', 'Visualize', 'Side card', 'Vision Router', 'Archived sessions', 'Account'];
const LEAN_SCREENS = [
  { name: 'home', run: async () => true },
  { name: 'model-menu', pre: HOME, run: async () => evalIn("__arc.clickAndWait('Select model')") },
  { name: 'search-sessions', run: async () => evalIn("__arc.clickAndWait('Search sessions')") },
  { name: 'plus-menu', pre: HOME, run: async () => evalIn("__arc.clickAndWait('Add files or run commands')") },
  { name: 'access-mode', pre: HOME, run: async () => evalIn("__arc.clickAndWait('Access mode')") },
  { name: 'right-sidebar', pre: HOME, run: async () => evalIn("__arc.clickAndWait('Open right sidebar')") },
  ...['General', 'Models'].map((n) => ({ name: 'settings-' + n.toLowerCase(), run: async () => evalIn(`__arc.openSettings(${JSON.stringify(n)})`) })),
];
const SCREENS = LEAN ? LEAN_SCREENS : [
  { name: 'home', run: async () => true },
  { name: 'model-menu', pre: HOME, run: async () => evalIn("__arc.clickAndWait('Select model')") },
  { name: 'plugins', run: async () => evalIn("__arc.clickAndWait('Plugins')") },
  { name: 'automation', run: async () => evalIn("__arc.clickAndWait('Automation tasks')") },
  { name: 'context-insights', optional: 'the button appears only when the data home holds session history', run: async () => evalIn("__arc.clickAndWait('Context Insights', 2500)") },
  { name: 'more', run: async () => evalIn("__arc.clickAndWait('More')") },
  { name: 'search-sessions', run: async () => evalIn("__arc.clickAndWait('Search sessions')") },
  { name: 'plus-menu', pre: HOME, run: async () => evalIn("__arc.clickAndWait('Add files or run commands')") },
  { name: 'access-mode', pre: HOME, run: async () => evalIn("__arc.clickAndWait('Access mode')") },
  { name: 'right-sidebar', pre: HOME, run: async () => evalIn("__arc.clickAndWait('Open right sidebar')") },
  ...['General', 'Models', 'Built-in plugins', 'Agent presets', 'Skills', 'Archived sessions', 'Visualize', 'Side card', 'Vision Router'].map((n) => ({
    name: 'settings-' + n.toLowerCase().replace(/[^a-z]+/g, '-'),
    optional: ['Archived sessions', 'Visualize', 'Side card'].includes(n) ? OPT_SETTINGS : undefined,
    run: async () => evalIn(`__arc.openSettings(${JSON.stringify(n)})`),
  })),
];

const report = { asar, scheme: {}, failures: [], warnings: [], skipped: [] };
const fail = (m) => { report.failures.push(m); console.log('FAIL ' + m); };
const warn = (m) => { report.warnings.push(m); };

async function crawl(scheme, tag) {
  await emulate(scheme);
  await cdp.send('Page.navigate', { url });
  await sleep(6000);
  await evalIn(PAGE);
  const res = { bodyBg: await evalIn('__arc.bodyBg()'), screens: {} };
  for (const s of SCREENS) {
    if (!(await closeAll())) warn(`${tag}: a dialog stayed open`);
    let ok = false;
    try { if (s.pre) await evalIn(s.pre); ok = await s.run(); } catch (e) { warn(`${tag}/${s.name}: ${e.message}`); }
    // a screen may be skipped only with a stated reason; a skip without one fails
    if (!ok) {
      if (s.optional) { warn(`${tag}/${s.name}: not present (${s.optional})`); report.skipped.push({ screen: `${tag}/${s.name}`, reason: s.optional }); } else fail(`${tag}/${s.name}: screen could not be opened`);
      continue;
    }
    await sleep(500);
    const lines = await evalIn('__arc.texts()');
    const col = await evalIn('__arc.colours()');
    await shot(`${tag}-${s.name}`);
    // two word finders: the build rules and the independent scan (lower case command and provider names are the rename slices' work)
    // (TIER holds the ids that are counted but do not fail)
    const dirty = lines.flatMap((l) => { const ids = [classify(l), ...findIn(l).filter((id) => !TIER.has(id))].filter(Boolean); return ids.length ? [[l, ids[0]]] : []; });
    for (const [l, c] of dirty) fail(`${tag}/${s.name}: [${c}] ${l.slice(0, 100)}`);
    for (const b of col.blue) fail(`${tag}/${s.name}: blue ${b}`);
    const bad = col.contrast.filter((c) => c.ratio < 3);
    for (const c of bad.slice(0, 6)) fail(`${tag}/${s.name}: contrast ${c.ratio} for "${c.text}" (${c.color})`);
    if (col.contrast.length > bad.length) warn(`${tag}/${s.name}: ${col.contrast.length - bad.length} texts between 3 and 4.5 contrast`);
    res.screens[s.name] = { lines: lines.length, dirty: dirty.length, blue: col.blue.length, lowContrast: col.contrast.length };
  }
  if (LEAN) {
    // what the lean core removed must be gone, not hidden: no button with the label, and no settings page of that name
    await evalIn(HOME);
    for (const l of ABSENT_NAV) if (await evalIn(`!!__arc.find(${JSON.stringify(l)})`)) fail(`${tag}: the lean core still shows "${l}"`);
    for (const n of ABSENT_SETTINGS) { if (await evalIn(`__arc.openSettings(${JSON.stringify(n)})`)) fail(`${tag}: the lean core still has the settings page "${n}"`); await closeAll(); }
    // patch 15: no "Show coding view" row in General
    if (!(await evalIn("__arc.openSettings('General')"))) fail(`${tag}: General settings could not be opened`);
    else if ((await evalIn('__arc.texts()')).some((l) => l.includes('Show coding view'))) fail(`${tag}: General settings still show "Show coding view"`);
    await closeAll();
    // the Trace tab of arc-hoh: the HoH ledger and the Cammut brief in the right sidebar
    await evalIn(HOME);
    if (!(await evalIn("!!__arc.find('Trace') || __arc.clickAndWait('Open right sidebar')"))) fail(`${tag}: the right sidebar could not be opened`); // an earlier screen may have left it open
    else if (!(await evalIn("__arc.clickAndWait('Trace', 1200)"))) fail(`${tag}: the right sidebar has no Trace tab`);
    else { await shot(`${tag}-trace`); if (!(await evalIn('__arc.texts()')).some((l) => l.includes('HoH ledger'))) fail(`${tag}: the Trace tab does not show the HoH ledger section`); }
    await closeAll();
  }
  if (!(await closeAll())) warn(`${tag}: a dialog stayed open`);
  return res;
}

const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

try {
  const near = (c, r, g, bl) => Math.abs(c[0] - r) <= 3 && Math.abs(c[1] - g) <= 3 && Math.abs(c[2] - bl) <= 3;
  if (phase === 'first-run') {
    // the first-run look: Light even when the system asks for dark (cream paper, #faf9f6)
    report.scheme.firstRun = await crawl('dark', 'first-run');
    if (!near(parse(report.scheme.firstRun.bodyBg), 250, 249, 246)) fail(`first-run paper is not #faf9f6 (body ${report.scheme.firstRun.bodyBg})`);
    // choosing Dark in Settings gives the dark set (#171614), and Light brings the paper back
    if (!(await evalIn("__arc.chooseAppearance('Dark')"))) fail('could not choose Dark in Settings');
    await closeAll();
    if (!near(parse(await evalIn('__arc.bodyBg()')), 23, 22, 20)) fail('choosing Dark in Settings does not give the dark set #171614');
    if (!(await evalIn("__arc.chooseAppearance('Light')"))) fail('could not choose Light in Settings');
    await closeAll();
    if (!near(parse(await evalIn('__arc.bodyBg()')), 250, 249, 246)) fail('choosing Light in Settings does not give the paper #faf9f6');
  } else if (phase === 'dark') {
    report.scheme.dark = await crawl('dark', 'dark');
    if (!near(parse(report.scheme.dark.bodyBg), 23, 22, 20)) fail(`dark set is not #171614 (body ${report.scheme.dark.bodyBg})`);
  } else {
    report.scheme.light = await crawl('light', 'light');
    if (!near(parse(report.scheme.light.bodyBg), 250, 249, 246)) fail(`light paper is not #faf9f6 (body ${report.scheme.light.bodyBg})`);
  }
} catch (e) {
  fail('crawl stopped: ' + e.message);
} finally {
  try { cdp.close(); } catch { /* closed */ }
  killTree(browser.pid);
  if (!argv.includes('--keep')) killTree(server.pid);
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* in use */ }
  await cleanupHome();
  for (const [f, h] of realBefore) if (hashOf(path.join(realProfile, f)) !== h) fail(`the test changed the real profile file ${f}`);
  const nmDiff = treeDiff(nmBefore, treeHash(nmReal));
  if (nmDiff.length) fail(`the real plugin packages changed during the run (${nmDiff.length}): ${nmDiff.slice(0, 8).join('; ')}`);
  fs.writeFileSync(path.join(outDir, `report-${phase}.json`), JSON.stringify(report, null, 1));
}
console.log(`phase ${phase}: ${Object.values(report.scheme).reduce((n, sc) => n + Object.keys(sc.screens || {}).length, 0)} screens read, skipped ${report.skipped.length}`);
for (const k of report.skipped) console.log(`  skipped ${k.screen}: ${k.reason}`);
console.log(`phase ${phase}: failures ${report.failures.length}, warnings ${report.warnings.length}`);
process.exit(report.failures.length ? 1 : 0);
