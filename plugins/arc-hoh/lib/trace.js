// arc-hoh 0.4.0 (2026-11-15): the data and routes of the Trace tab.
import { readFile } from 'node:fs/promises';
import { redact, retainNote } from './brief.js';
import { ledgerFile, optedOut, verifyLedger, withLedger } from './gates.js';

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 3).trimEnd() + '...' : t; };
const PROJECT_TAG = process.env.ARC_HOH_PROJECT_TAG || 'project:arc-harness';
const REVIEW_ACTIONS = new Set(['comment', 'verdict', 'retain']);
const REVIEW_VERDICTS = new Set(['approve', 'revise', 'hold']);

async function inspectLedger(file, targetSeq, untargetedGoal = null) {
  let raw = '';
  try { raw = await readFile(file, 'utf8'); } catch (err) {
    if (err?.code === 'ENOENT') return { targetRow: null, lastReview: null };
    throw err;
  }
  let targetRow = null, lastReview = null;
  for (const line of raw.split('\n').filter(Boolean)) {
    try {
      const row = JSON.parse(line);
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      if (targetSeq !== null && row.seq === targetSeq) targetRow = row;
      if (row.type === 'review' && (targetSeq !== null ? row.targetSeq === targetSeq : row.targetSeq === undefined && (untargetedGoal === null || (row.goal || '') === untargetedGoal))) lastReview = row;
    } catch {}
  }
  return { targetRow, lastReview };
}
function parseTargetSeq(v) {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 && v <= 1e9 ? v : null;
  return typeof v === 'string' && /^[1-9][0-9]{0,8}$/.test(v.trim()) ? Number(v.trim()) : null;
}
async function readJsonBody(req) {
  if (!req || typeof req.text !== 'function') return req && typeof req === 'object' && !Array.isArray(req) ? req : {};
  const raw = await req.text();
  return raw && raw.trim() ? JSON.parse(raw) : {};
}

function summary(row) {
  if (row.type === 'gate') {
    const rs = Array.isArray(row.reasons) ? row.reasons.join('; ') : String(row.reasons || '');
    return clip(`${row.verdict}: ${rs || 'every check held'}`, 160);
  }
  if (row.type === 'freeze') return clip(`${row.files} file(s), candidate ${String(row.candidate).slice(0, 19)}`, 160);
  if (row.type === 'propose') return clip(row.hypothesis, 160);
  if (row.type === 'decide') {
    const parts = [row.id, row.action, row.outcome, row.effectiveTaint].filter(Boolean);
    if (row.gateSeq !== null && row.gateSeq !== undefined) parts.push(`gate #${row.gateSeq}`);
    return clip(parts.join(', '), 160);
  }
  if (row.type === 'review') {
    const head = [row.verdict, row.targetSeq ? `#${row.targetSeq}` : ''].filter(Boolean).join(' ');
    const text = [head, row.note].filter(Boolean).join(': ');
    return clip(text || row.action || 'review', 160);
  }
  return '';
}

/** The newest `limit` ledger events, newest first, plus the chain check, owner reviews and the current Cammut brief. */
export async function traceView(file, getBrief, limit = 50) {
  let text = '';
  try { text = await readFile(file, 'utf8'); } catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
  const rows = [];
  const rowMap = new Map();
  const bySeq = {};
  const latestReviews = [];

  for (const line of text.split('\n').filter(Boolean)) {
    try {
      const r = JSON.parse(line);
      if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
      rows.push(r);
      if (Number.isInteger(r.seq) && r.type !== 'review') rowMap.set(r.seq, r);
      if (r.type === 'review') {
        const targetSeq = Number.isInteger(r.targetSeq) && r.targetSeq > 0 ? r.targetSeq : null;
        const tr = targetSeq !== null ? rowMap.get(targetSeq) : null;
        const hashOk = Boolean(tr && r.seq > targetSeq && (!r.targetHash || !tr.hash || r.targetHash === tr.hash));
        const rev = { seq: r.seq, ts: r.ts, action: clip(r.action || 'comment', 32), targetSeq, goal: clip(r.goal, 80), caller: clip(r.caller || 'owner', 40), ...(r.verdict ? { verdict: clip(r.verdict, 32) } : {}), ...(r.note ? { note: clip(r.note, 300) } : {}) };
        latestReviews.push(rev);
        if (targetSeq !== null && hashOk) {
          const b = bySeq[targetSeq] || { targetSeq, verdict: null, notes: [], lastSeq: 0, ts: null };
          if (rev.verdict) b.verdict = rev.verdict;
          if (rev.note) b.notes.push({ seq: rev.seq, ts: rev.ts, caller: rev.caller, ...(rev.verdict ? { verdict: rev.verdict } : {}), note: rev.note });
          b.lastSeq = rev.seq; b.ts = rev.ts; bySeq[targetSeq] = b;
        }
      }
    } catch { /* a broken line shows in the chain check */ }
  }

  const items = [];
  for (let i = rows.length - 1; i >= 0 && items.length < limit; i--) {
    try {
      const r = rows[i];
      const decision = r.type === 'decide' ? { id: clip(r.id, 64), action: clip(r.action, 64), allowExit: r.allowExit === true, outcome: clip(r.outcome, 64), effectiveTaint: clip(r.effectiveTaint, 64), checksPassed: r.checksPassed === true, crossFamilyVerified: r.crossFamilyVerified === true, ...(r.gateSeq != null ? { gateSeq: r.gateSeq } : {}) } : null;
      const review = r.type === 'review' ? { action: clip(r.action || 'comment', 32), ...(Number.isInteger(r.targetSeq) ? { targetSeq: r.targetSeq } : {}), ...(r.verdict ? { verdict: clip(r.verdict, 32) } : {}), ...(r.note ? { note: clip(r.note, 300) } : {}), caller: clip(r.caller || 'owner', 40) } : null;
      const attached = r.type !== 'review' ? bySeq[r.seq] : null;
      items.push({ seq: r.seq, ts: r.ts, type: r.type, goal: clip(r.goal, 80), ...(r.cycle ? { cycle: r.cycle } : {}), ...(decision ? { decision } : {}), ...(review ? { review } : {}), ...(attached?.verdict ? { reviewVerdict: attached.verdict } : {}), ...(attached?.notes?.length ? { reviewNotes: attached.notes } : {}), summary: summary(r) });
    } catch {}
  }
  return { chain: await verifyLedger(file), items, brief: getBrief() || '', reviews: { latest: latestReviews.slice(-20).reverse(), bySeq } };
}
const fail = (status, error) => ({ ok: false, status, error }), jsonRes = (b, status = 200) => Response.json(b, { status, headers: { 'cache-control': 'no-store' } });

export async function handleTraceAction(input = {}, opts = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'Action payload must be a JSON object');
  const action = typeof input.action === 'string' ? input.action.trim().toLowerCase() : '';
  if (!REVIEW_ACTIONS.has(action)) return fail(400, 'Action must be comment, verdict or retain');
  let ts = null;
  if (input.targetSeq !== undefined && input.targetSeq !== null && input.targetSeq !== '') { ts = parseTargetSeq(input.targetSeq); if (ts === null) return fail(400, 'targetSeq must be a positive integer'); }
  if (action === 'verdict' && ts === null) return fail(400, 'targetSeq is required for verdict action');
  let verdict = '';
  if (input.verdict !== undefined && input.verdict !== null && String(input.verdict).trim() !== '') { verdict = String(input.verdict).trim().toLowerCase(); if (!REVIEW_VERDICTS.has(verdict)) return fail(400, 'Verdict must be approve, revise or hold'); }
  if (action === 'verdict' && !verdict) return fail(400, 'Verdict is required for verdict action');
  const cl = (v, n) => clip(redact(String(v ?? '')).replace(/\s+/g, ' ').trim(), n), note = input.note != null ? cl(input.note, 500) : '';
  if (action === 'comment' && !note) return fail(400, 'Comment note is required');
  if (action === 'retain' && !note && !verdict && ts === null) return fail(400, 'Retain requires a note, verdict or targetSeq');
  const env = opts.env || process.env, file = opts.ledgerPath || ledgerFile(env), inGoal = cl((typeof input.goal === 'string' && input.goal.trim()) || 'trace-review', 80);
  const res = await withLedger(file, async (append) => {
    const { targetRow, lastReview } = await inspectLedger(file, ts, ts === null ? inGoal : null);
    if (ts !== null) { if (!targetRow) return { err: fail(404, 'Target ledger entry not found') }; if (targetRow.type === 'review') return { err: fail(409, 'Cannot target a review row') }; }
    const goal = typeof targetRow?.goal === 'string' && targetRow.goal.trim() ? cl(targetRow.goal, 80) : inGoal;
    const isDup = Boolean(lastReview && (ts !== null || (lastReview.goal || '') === goal) && (lastReview.action || '') === action && (lastReview.verdict || '') === verdict && (lastReview.note || '') === note);
    const ev = { type: 'review', caller: 'owner', action, goal, ...(ts !== null ? { targetSeq: ts, ...(targetRow?.hash ? { targetHash: String(targetRow.hash) } : {}), ...(targetRow?.type ? { targetType: String(targetRow.type) } : {}) } : {}), ...(verdict ? { verdict } : {}), ...(note ? { note } : {}) };
    const { seq, hash, entry } = isDup ? { seq: lastReview.seq, hash: lastReview.hash || null, entry: lastReview } : await (async () => { const r = await append(ev); return { ...r, entry: { seq: r.seq, ...ev } }; })();
    return { goal, isDup, seq, hash, entry };
  });
  if (res.err) return res.err;
  const { goal, isDup, seq, hash, entry } = res;
  let retained = false;
  if ((action === 'retain' || input.retain === true) && !optedOut('RETAIN', env)) {
    const fn = typeof opts.retain === 'function' ? opts.retain : retainNote, content = `Owner Trace review on goal "${goal}"${ts !== null ? ` (entry #${ts})` : ''}: ${[verdict ? `verdict ${verdict}` : '', note].filter(Boolean).join('. ') || 'saved for carry-over'}.`;
    try {
      const ms = Number.isInteger(opts.retainTimeoutMs) ? opts.retainTimeoutMs : 1500;
      const p = Promise.resolve(fn({ content, context: 'Owner review from Arc Trace tab', tags: [env.ARC_HOH_PROJECT_TAG || PROJECT_TAG, 'source:owner', 'topic:arc-hoh', 'hoh:review', `date:${new Date().toISOString().slice(0, 10)}`], ...(opts.cammutBase ? { base: opts.cammutBase } : {}), timeoutMs: ms })).catch(() => false);
      const t = new Promise((r) => { const h = setTimeout(() => r(false), ms + 100); h.unref?.(); });
      retained = (await Promise.race([p, t])) === true;
    } catch { retained = false; }
  }
  return { ok: true, seq, hash, ...(isDup ? { duplicate: true } : {}), entry, retained };
}

/** Register `/api/arc-hoh/action` and `/api/arc-hoh/trace` on Cordis `connection.fetch`. */
export function registerTraceRoutes(ctx, state = { brief: '' }, opts = {}) {
  if (!ctx || typeof ctx.inject !== 'function') return;
  const env = opts.env || process.env;
  const mount = (path, label, handler) => ctx.inject(['connection'], (c) => {
    const register = c.get('connection')?.fetch?.register;
    if (typeof register === 'function') c.effect(() => register.call(c.get('connection').fetch, { path, methods: ['POST'], requestBody: 'buffered', fetch: handler }), label);
  });
  mount('/api/arc-hoh/action', 'arc-hoh: action route', async (req) => {
    try {
      const res = await handleTraceAction(await readJsonBody(req), opts);
      return jsonRes(res, res.ok ? 200 : (res.status || 400));
    } catch (err) {
      return jsonRes({ ok: false, error: err instanceof SyntaxError ? 'Invalid JSON body' : 'Internal trace action error' }, err instanceof SyntaxError ? 400 : 500);
    }
  });
  mount('/api/arc-hoh/trace', 'arc-hoh: trace route', async (req) => {
    try {
      let limit = 50;
      try { const b = await readJsonBody(req); if (Number.isInteger(b?.limit) && b.limit > 0 && b.limit <= 200) limit = b.limit; } catch {}
      return jsonRes({ ok: true, ...(await traceView(opts.ledgerPath || ledgerFile(env), () => state.brief, limit)) });
    } catch { return jsonRes({ ok: false, error: 'Internal trace read error' }, 500); }
  });
}
