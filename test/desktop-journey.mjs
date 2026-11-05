// Walks the desktop app the way a person does, with real mouse clicks, on a throwaway copy of the desktop profile.
//   node test/desktop-journey.mjs [--mode settings|reply|retry|shots|task] [--theme light|dark] [--model <provider>/<model>] [--out <folder>] [--exe <electron exe>] [--size 1280x800] [--prompt <file>] [--minutes 12] [--ledger <file>] [--memory]
// settings: the window opens; a Settings control is on screen; a click opens Settings; the Models page lists Anthropic and Google Vertex.
// reply: a typed message gets a real model reply through the local gateway (uses a temporary copy of the credentials file).
// retry: the gateway address is broken on purpose, and the retry line must stay still and on one line.
// shots: the screens for the documents, at twice the pixel density, with a real reply on screen.
// task: a real multi-step task from --prompt runs to its end; the journey saves a frame every 20 s and the button labels it sees.
//   --ledger starts from an earlier ledger; --memory turns the Cammut client on and saves the foot of the Trace tab.
//   A permission prompt stays for a person: the journey never answers one.
// Writes one PNG per step and report.json to the output folder. Exit 0 only when every step passes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { quietConfig, removeHome, linkTree, dataHome } from '../lib/testhome.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const APP_DIR = process.env.ARC_APP_DIR || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness');
const EXE = opt('--exe', path.join(APP_DIR, 'DeepSeek Harness.exe'));
const outDir = path.resolve(opt('--out', path.join(root, '_scratch', 'journey')));
const [W, H] = opt('--size', '1280x800').split('x').map(Number);
const mode = opt('--mode', 'settings');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const killTree = (pid) => spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });

if (!fs.existsSync(EXE)) { console.error(`no app at ${EXE}; set ARC_APP_DIR or pass --exe`); process.exit(2); }
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-home-'));
// runs on every exit, a crash and Ctrl-C included: the temporary credentials copy never stays behind
process.on('exit', () => fs.rmSync(path.join(home, '.credentials.yaml'), { force: true }));
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-journey-ud-'));
const real = path.join(dataHome(), 'profiles', 'desktop');
const dst = path.join(home, 'profiles', 'desktop');
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(real)) {
  const from = path.join(real, f);
  if (!fs.statSync(from).isFile()) continue;
  if (f === 'cordis.patch.yml') {
    const quiet = quietConfig(fs.readFileSync(from, 'utf8'));
    const text = argv.includes('--memory') ? quiet.replace(/(id: mcp-cammut\r?\n) *disabled: true\r?\n/, '$1') : quiet;
    const route = (/^([^/]+)\/(.+)$/.exec(opt('--model', '')) || []).slice(1);
    const picked = route[1] ? text.replace(/(id: agent-default-model[\s\S]*?provider: )\S+(\s+model: )\S+/, `$1${route[0]}$2${route[1]}`) : text;
    const theme = mode === 'shots' || mode === 'task' ? `\n- id: ui-theme\n  name: "@arc-harness/arc-client-ui-theme"\n  config:\n    preference: ${opt('--theme', 'light')}\n` : '';
    fs.writeFileSync(path.join(dst, f), (mode === 'retry' ? picked.replaceAll('127.0.0.1:7424', '127.0.0.1:9') : picked) + theme);
  }
  else fs.copyFileSync(from, path.join(dst, f));
}
linkTree(path.join(real, 'node_modules'), path.join(dst, 'node_modules'));
if (mode === 'reply' || mode === 'shots' || mode === 'task') fs.copyFileSync(path.join(dataHome(), '.credentials.yaml'), path.join(home, '.credentials.yaml'));
fs.mkdirSync(outDir, { recursive: true });
if (opt('--ledger')) { fs.mkdirSync(path.join(home, 'hoh'), { recursive: true }); fs.copyFileSync(opt('--ledger'), path.join(home, 'hoh', 'ledger.jsonl')); }

const steps = [];
const step = (name, ok, detail = '') => { steps.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`); };
const port = 9300 + (process.pid % 500);
const app = spawn(EXE, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
  env: { ...process.env, ARC_HOME: home, DSH_HOME: home, ...(mode === 'retry' ? { RADIUM_API_KEY: 'test', MERGE_API_KEY: 'test' } : {}) }, stdio: 'ignore', detached: false,
});

app.on('error', (e) => { console.error('the app did not start: ' + e.message); process.exit(2); });

let exitCode = 1;
try {
  let target = null;
  for (let i = 0; i < 90 && !target; i++) {
    await sleep(1000);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools:') && t.url !== 'about:blank');
    } catch { /* not yet */ }
  }
  step('a window opens', target, target ? target.url.replace(/token=[^&]+/, 'token=hidden').slice(0, 70) : 'no page in 90 s');
  if (!target) throw new Error('stop');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const waiting = new Map();
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { const { res, rej } = waiting.get(m.id); waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiting.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: mode === 'shots' || mode === 'task' ? 2 : 1, mobile: false });
  const evalIn = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.data, 'base64')); };
  // finds the visible control whose label starts with the text, and returns its centre; nothing is clicked from inside the page
  const locate = (text, scope = 'document') => evalIn(`(() => {
    const lab = (b) => (b.getAttribute('aria-label') || b.textContent || '').trim();
    const inView = (r) => r.width > 2 && r.height > 2 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    const b = [...${scope}.querySelectorAll('button,[role=tab],[role=menuitem],a')].find((x) => lab(x).startsWith(${JSON.stringify(text)}) && inView(x.getBoundingClientRect()));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return { x, y, label: lab(b), onTop: !!top && (b === top || b.contains(top)) };
  })()`);
  const click = async ({ x, y }) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const buttons = () => evalIn(`[...document.querySelectorAll('button,a')].map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 28)).filter(Boolean).slice(0, 40).join(' | ')`);

  let ready = false;
  for (let i = 0; i < 45 && !ready; i++) { await sleep(1000); ready = await evalIn(`document.querySelectorAll('button').length > 3`); }
  await sleep(2500);
  await shot('1-home');
  step('the app screen loads', ready, await evalIn('document.title'));
  const say = async (text) => {
    const box = await evalIn(`(() => { const e = document.querySelector('textarea,[contenteditable=true]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    step('a message box is on screen', box);
    if (!box) throw new Error('stop');
    await click(box);
    await sleep(300);
    await send('Input.insertText', { text });
    await sleep(300);
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined });
  };
  if (mode === 'shots') {
    const tag = opt('--theme', 'light');
    const open = async (name, file) => {
      const b = await locate(name, `document.querySelector('[role=dialog]')`);
      step(`Settings page ${name}`, b?.onTop);
      if (b?.onTop) { await click(b); await sleep(1800); await shot(`${tag}-${file}`); }
    };
    await shot(`${tag}-home`);
    await click(await locate('Settings'));
    await sleep(1800);
    await open('General', 'settings-general');
    await open('Models', 'settings-models');
    await open('Built-in plugins', 'settings-plugins');
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(900);
    await say('In two short sentences, what does a hash-chained ledger prove about an agent run?');
    let done = false;
    for (let i = 0; i < 80 && !done; i++) {
      await sleep(1000);
      done = await evalIn(`!document.querySelector('[data-shimmer="true"]') && !!document.querySelector('main, body') && document.body.innerText.includes('ledger') && [...document.querySelectorAll('button')].some((b) => /copy/i.test(b.getAttribute('aria-label') || '')) && document.body.innerText.split('hash-chained').length >= 2`);
    }
    await sleep(2500);
    await shot(`${tag}-session`);
    step('a session with a reply is on screen', done);
    await click({ x: W - 26, y: 65 });
    await sleep(1500);
    const trace = await locate('Trace');
    step('the Trace tab is on screen', trace?.onTop);
    if (trace?.onTop) { await click(trace); await sleep(1800); await shot(`${tag}-trace`); }
    ws.close();
    exitCode = steps.every((s) => s.ok) ? 0 : 1;
    throw new Error('stop');
  }
  if (mode === 'task') {
    await say(fs.readFileSync(opt('--prompt'), 'utf8').trim());
    const started = Date.now();
    const limit = Number(opt('--minutes', '12')) * 60000;
    const seen = new Set();
    let frame = 0, idle = 0, held = 0;
    while (Date.now() - started < limit && idle < 8) {
      await sleep(5000);
      for (const b of String(await buttons()).split(' | ')) seen.add(b);
      const busy = await evalIn(`!!document.querySelector('[data-shimmer="true"]')`);
      // a permission prompt stays for a person: the journey never answers it
      held = (await evalIn(`document.body.innerText.includes('Waiting for approval')`)) ? held + 1 : 0;
      if (held >= 12) { await shot('task-approval'); break; }
      idle = busy ? 0 : idle + 1;
      const s = Math.round((Date.now() - started) / 1000);
      if (s >= frame * 20) await shot(`run-${String(frame++).padStart(3, '0')}`);
      fs.writeFileSync(path.join(outDir, 'task-text.txt'), await evalIn('document.body.innerText'));
    }
    fs.writeFileSync(path.join(outDir, 'task-buttons.txt'), [...seen].join('\n'));
    step('the task ends on screen', idle >= 8, `${Math.round((Date.now() - started) / 1000)} s`);
    await shot('task-end');
    await click({ x: W - 26, y: 65 });
    await sleep(1500);
    await shot('task-sidebar');
    fs.writeFileSync(path.join(outDir, 'sidebar-buttons.txt'), await buttons());
    const trace = await locate('Trace');
    step('the Trace tab is on screen', trace?.onTop);
    if (trace?.onTop) { await click(trace); await sleep(2500); await shot('task-trace'); }
    if (trace?.onTop && argv.includes('--memory')) {
      await evalIn(`(() => { const all = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 40 && e.getBoundingClientRect().left > innerWidth * 0.5); all.forEach((e) => { e.scrollTop = e.scrollHeight; }); })()`);
      await sleep(1200);
      await shot('task-memory');
      fs.writeFileSync(path.join(outDir, 'memory-text.txt'), await evalIn('document.body.innerText'));
    }
    const ledger = path.join(home, 'hoh', 'ledger.jsonl');
    if (fs.existsSync(ledger)) fs.copyFileSync(ledger, path.join(outDir, 'ledger.jsonl'));
    ws.close();
    exitCode = steps.every((x) => x.ok) ? 0 : 1;
    throw new Error('stop');
  }
  if (mode === 'reply') {
    const word = 'PINEAPPLE';
    await say(`Reply with the single word ${word} and nothing else.`);
    let hits = 0, retries = false;
    for (let i = 0; i < 90 && hits < 2; i++) {
      await sleep(1000);
      const body = await evalIn('document.body.innerText');
      hits = (body.match(new RegExp(word, 'g')) || []).length;
      retries ||= body.includes('Retrying model request');
    }
    await shot('reply');
    const why = await evalIn(`[...document.querySelectorAll('details')].map((d) => { d.open = true; return d.innerText; }).join(' || ')`);
    if (why) fs.writeFileSync(path.join(outDir, 'reply-failure.txt'), why);
    step('a real model reply arrives', hits >= 2, retries ? 'after retries' : '');
    step('no retry was needed', !retries);
    ws.close();
    exitCode = steps.every((s) => s.ok) ? 0 : 1;
    throw new Error('stop');
  }
  if (mode === 'retry') {
    await say('Say hello.');
    const probe = `(() => { const e = [...document.querySelectorAll('[role=status]')].find((x) => x.textContent.includes('Retrying model request')); if (!e) return null; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { x: r.left, y: r.top, w: r.width, h: r.height, animation: c.animationName, lineHeight: parseFloat(c.lineHeight) || 20, text: e.textContent, copy: (() => { const d = e.querySelector('[class*=_decoration_]'); return d ? getComputedStyle(d).display : 'gone'; })(), shine: (() => { const x = e.querySelector('[class*=_text_]'); return x ? getComputedStyle(x).animationName : 'none'; })() }; })()`;
    let seen = null;
    for (let i = 0; i < 60 && !seen; i++) { await sleep(500); seen = await evalIn(probe); }
    step('the retry line appears', seen, seen?.text || '');
    if (!seen) throw new Error('stop');
    const rows = [];
    for (let i = 0; i < 40; i++) {
      const s = await evalIn(probe);
      if (s) {
        rows.push(s);
        const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, s.x - 20), y: Math.max(0, s.y - 30), width: Math.min(620, W - s.x), height: 90, scale: 2 } });
        fs.writeFileSync(path.join(outDir, `retry-${i}.png`), Buffer.from(r.data, 'base64'));
      }
      await sleep(350);
    }
    step('the retry line stays on one line', rows.every((s) => s.h <= s.lineHeight * 1.6), rows.map((s) => Math.round(s.h)).join(','));
    step('the running label has one text layer', rows.every((s) => s.copy === 'none' || s.copy === 'gone'), [...new Set(rows.map((s) => s.copy))].join(','));
    step('the running label shines from one gradient', rows.every((s) => s.shine === 'arcShine'), [...new Set(rows.map((s) => s.shine))].join(','));
    ws.close();
    exitCode = steps.every((s) => s.ok) ? 0 : 1;
    throw new Error('stop');
  }
  let settings = await locate('Settings');
  step('a Settings control is on screen', settings?.onTop, settings ? `at ${Math.round(settings.x)},${Math.round(settings.y)}` : 'buttons: ' + (await buttons()));
  if (!settings?.onTop) throw new Error('stop');
  await click(settings);
  await sleep(1800);
  await shot('2-settings');
  const dialog = await evalIn(`!!document.querySelector('[role=dialog]')`);
  step('a click opens Settings', dialog);
  if (!dialog) throw new Error('stop');
  const models = await locate('Models', `document.querySelector('[role=dialog]')`);
  step('Settings has a Models page', models?.onTop);
  if (!models?.onTop) throw new Error('stop');
  await click(models);
  await sleep(1800);
  await shot('3-models');
  const text = await evalIn(`document.querySelector('[role=dialog]').innerText`);
  fs.writeFileSync(path.join(outDir, 'models.txt'), text);
  const add = await locate('Add', `document.querySelector('[role=dialog]')`);
  step('the Models page offers to add a provider', add?.onTop, add?.label || '');
  if (add?.onTop) { await click(add); await sleep(1500); await shot('4-add-provider'); }
  const full = await evalIn(`document.body.innerText`);
  fs.writeFileSync(path.join(outDir, 'add-provider.txt'), full);
  // a provider is either a row on the page (display name) or an entry in the catalog list (lower-case id); the catalog hides configured rows
  const listed = (row, id) => new RegExp(`(^|\\n)(${row}|${id})(\\n|$)`).test(full);
  step('Anthropic is a row or can be chosen', listed('Anthropic', 'anthropic'));
  step('Google Vertex is a row or can be chosen', listed('Google Vertex AI \\(Local Gateway\\)', 'google-vertex'));
  ws.close();
  exitCode = steps.every((s) => s.ok) ? 0 : 1;
} catch (e) {
  if (e.message !== 'stop') { step('the journey ran to the end', false, e.message); }
} finally {
  killTree(app.pid);
  await sleep(1500);
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ steps }, null, 1));
  if (!(await removeHome(home))) console.log(`WARN remove ${home} by hand`);
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 3 });
}
console.log(`journey: ${steps.filter((s) => s.ok).length} of ${steps.length} steps pass; pictures in ${outDir}`);
process.exit(exitCode);
