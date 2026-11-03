/**
 * dsh-hoh 0.3.0 (2026-11-03)
 * Harness^2 (Google, arXiv 2610.14224) and Harness-of-Harness (arXiv 2609.01481) inside the harness:
 *  - an operating contract in every system prompt (Cammut memory, Propose-Probe-Compose, the HoH cycle);
 *  - four tools: hoh_propose, hoh_freeze, hoh_gate (deterministic accept gate, verdict kept in Cammut), hoh_verify_ledger;
 *  - a short brief from Cammut in the prompt, refreshed every 20 minutes (fail open, notes are data).
 *  - a Trace tab in the right sidebar (lib/client.js), fed by POST /api/dsh-hoh/trace: the ledger, newest first, and the brief.
 * Set DSH_HOH_BRIEF=0 to switch the brief off.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { makeTools, registerPrompt } from './register.js';
import { fetchBrief } from './brief.js';
import { ledgerFile } from './gates.js';
import { traceView } from './trace.js';

export const name = 'dsh-hoh';
export const inject = ['tools'];

const BRIEF_QUERY = 'operating rules and lessons for DeepSeek Harness work: Cammut, HoH, Harness2, English only, no blue';
const PROJECT_TAG = process.env.DSH_HOH_PROJECT_TAG || 'project:arc-harness';
const BRIEF_TAGS = [PROJECT_TAG, 'topic:arc-harness'];
const REFRESH_MS = 20 * 60 * 1000;

export function apply(ctx) {
  for (const tool of makeTools(defineTool)) ctx.tools.register(tool);

  const state = { brief: '' };
  ctx.inject(['systemPrompt'], (c) => registerPrompt(c.systemPrompt, () => state.brief));
  ctx.inject(['connection'], (c) => {
    const register = c.get('connection')?.fetch?.register;
    if (typeof register !== 'function') return;
    c.effect(() => register.call(c.get('connection').fetch, {
      path: '/api/dsh-hoh/trace', methods: ['POST'], requestBody: 'buffered',
      fetch: async () => {
        try { return Response.json({ ok: true, ...(await traceView(ledgerFile(), () => state.brief)) }, { headers: { 'cache-control': 'no-store' } }); }
        catch (err) { return Response.json({ ok: false, error: String((err && err.message) || err).slice(0, 200) }, { headers: { 'cache-control': 'no-store' } }); }
      },
    }), 'dsh-hoh: trace route');
  });

  if (process.env.DSH_HOH_BRIEF === '0') return;
  const refresh = async () => {
    const text = await fetchBrief({ query: BRIEF_QUERY, tags: BRIEF_TAGS });
    if (text) state.brief = text;
  };
  refresh();
  ctx.effect(() => {
    const timer = setInterval(refresh, REFRESH_MS);
    if (typeof timer.unref === 'function') timer.unref();
    return () => clearInterval(timer);
  }, 'dsh-hoh: brief refresh');
}
