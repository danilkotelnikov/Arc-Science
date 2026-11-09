/**
 * Minimal Chrome DevTools Protocol driver for the tests (Edge or Chrome, headless, Node's built-in WebSocket). No dependencies.
 * Every browser it starts has its own throwaway profile folder and is killed by its process id when close() runs.
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BROWSERS = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'];
export const browserPath = () => BROWSERS.find(existsSync);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 900, height = 900, port = 9300 + Math.floor(Math.random() * 500) } = {}) {
  const exe = browserPath();
  if (!exe) throw new Error('No Edge or Chrome found');
  const dir = mkdtempSync(join(tmpdir(), 'mm-cdp-'));
  const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let info = null;
  for (let i = 0; i < 80 && !info; i++) {
    await sleep(150);
    try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); const list = await r.json(); info = list.find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  if (!info) { proc.kill(); throw new Error('Browser did not start'); }
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('websocket failed')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
  return {
    send,
    async goto(url) { await send('Page.navigate', { url }); await sleep(300); },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(expression, timeoutMs = 30000) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) { if (await this.eval(expression)) return true; await sleep(100); }
      return false;
    },
    async resize(w, h, scale = 1) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: false }); },
    async screenshot(clip) {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      return Buffer.from(r.data, 'base64');
    },
    async close() {
      try { ws.close(); } catch { /* closed */ }
      try { proc.kill(); } catch { /* gone */ }
      await sleep(400);
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* locked profile, left to the OS temp cleaner */ }
    },
  };
}
