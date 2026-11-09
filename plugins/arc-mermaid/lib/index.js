/**
 * arc-mermaid 0.2.0 (2026-11-09): the Host half.
 * The drawing happens in the browser (lib/client.js). The Host has one job: it receives the render reports that the card sends
 * after each drawing, and keeps the latest ones as files, so a person or an agent can look at what the real app drew.
 *   POST /api/arc-mermaid/report   body { report: {...}, png: "data:image/png;base64,..." }
 * Files go to <ARC_HOME or ~/.arc>/arc-mermaid/reports: latest.json, latest.png, and the last 12 as r-<time>-<hash>.json/.png.
 * Nothing else is written. A report holds the diagram source (first 4000 characters), the gate marks, the checks of the real
 * render and a picture of the card. Set ARC_MERMAID_REPORTS=off in the environment of the app to switch the route off.
 */
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const name = 'arc-mermaid';
export const version = '0.2.0';

const KEEP = 12;
const MAX_BYTES = 6 * 1024 * 1024;

export function reportsDir(env = process.env) {
  return join(env.ARC_HOME || join(homedir(), '.arc'), 'arc-mermaid', 'reports');
}

/** Store one report. Returns { ok, file } or { ok: false, error }. Pure enough to test with a temporary folder. */
export function storeReport(body, dir = reportsDir()) {
  const report = body && body.report;
  if (!report || typeof report !== 'object') return { ok: false, error: 'no report' };
  const hash = /^[0-9a-f]{8}$/.test(String(report.hash)) ? String(report.hash) : 'nohash';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  mkdirSync(dir, { recursive: true });
  const base = `r-${stamp}-${hash}`;
  const json = JSON.stringify({ ...report, receivedAt: new Date().toISOString() }, null, 1);
  writeFileSync(join(dir, `${base}.json`), json);
  writeFileSync(join(dir, 'latest.json'), json);
  const m = typeof body.png === 'string' && /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.png);
  if (m) {
    const bytes = Buffer.from(m[1], 'base64');
    writeFileSync(join(dir, `${base}.png`), bytes);
    writeFileSync(join(dir, 'latest.png'), bytes);
  }
  const old = readdirSync(dir).filter((f) => /^r-.*\.json$/.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP))) {
    rmSync(join(dir, f), { force: true });
    rmSync(join(dir, f.replace(/\.json$/, '.png')), { force: true });
  }
  return { ok: true, file: base };
}

export function apply(ctx) {
  if (process.env.ARC_MERMAID_REPORTS === 'off') return;
  if (!ctx || typeof ctx.inject !== 'function') return;
  ctx.inject(['connection'], (c) => {
    const register = c.get('connection')?.fetch?.register;
    if (typeof register !== 'function') return;
    c.effect(() => register.call(c.get('connection').fetch, {
      path: '/api/arc-mermaid/report',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const headers = { 'cache-control': 'no-store' };
        try {
          const raw = await request.text();
          if (raw.length > MAX_BYTES) return Response.json({ ok: false, error: 'too large' }, { headers });
          return Response.json(storeReport(JSON.parse(raw)), { headers });
        } catch (err) {
          return Response.json({ ok: false, error: String(err?.message || 'failed').slice(0, 160) }, { headers });
        }
      },
    }), 'arc-mermaid: report route');
  });
}
