// dsh-hoh 0.3.0 (2026-11-03): the data of the Trace tab. Reads the ledger, never writes it.
import { readFile } from 'node:fs/promises';
import { verifyLedger } from './gates.js';

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 3).trimEnd() + '...' : t; };

function summary(row) {
  if (row.type === 'gate') return clip(`${row.verdict}: ${(row.reasons || []).join('; ') || 'every check held'}`, 160);
  if (row.type === 'freeze') return clip(`${row.files} file(s), candidate ${String(row.candidate).slice(0, 19)}`, 160);
  if (row.type === 'propose') return clip(row.hypothesis, 160);
  return '';
}

/** The newest `limit` ledger events, newest first, plus the chain check and the current Cammut brief. */
export async function traceView(file, getBrief, limit = 50) {
  let text = '';
  try { text = await readFile(file, 'utf8'); } catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
  const items = [];
  for (const line of text.split('\n').filter(Boolean).reverse()) {
    if (items.length >= limit) break;
    try {
      const r = JSON.parse(line);
      items.push({ seq: r.seq, ts: r.ts, type: r.type, goal: clip(r.goal, 80), ...(r.cycle ? { cycle: r.cycle } : {}), summary: summary(r) });
    } catch { /* a broken line shows in the chain check */ }
  }
  return { chain: await verifyLedger(file), items, brief: getBrief() || '' };
}
