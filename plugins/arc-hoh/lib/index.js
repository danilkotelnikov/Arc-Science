/**
 * arc-hoh 0.4.0 (2026-11-15)
 * Harness^2 (Google, arXiv 2610.14224) and Harness-of-Harness (arXiv 2609.01481) inside the harness:
 *  - an operating contract in every system prompt (Cammut memory, Propose-Probe-Compose, the HoH cycle);
 *  - five tools: hoh_propose, hoh_freeze, hoh_gate, hoh_verify_ledger, hoh_decide;
 *  - a short brief from Cammut in the prompt, refreshed every 20 minutes (fail open, notes are data);
 *  - an interactive Trace tab in the right sidebar (lib/client.js), fed by POST /api/arc-hoh/trace and POST /api/arc-hoh/action.
 * Set ARC_HOH_BRIEF=0 to switch the brief off.
 */
import { defineTool } from '@arc-harness/arc-tools';
import { makeTools, registerPrompt } from './register.js';
import { fetchBrief } from './brief.js';
import { optedOut } from './gates.js';
import { handleTraceAction, registerTraceRoutes } from './trace.js';

export const name = 'arc-hoh';
export const inject = ['tools'];
export { handleTraceAction, registerTraceRoutes };

const BRIEF_QUERY = 'operating rules and lessons for Arc Harness work: Cammut, HoH, Harness2, English only, plain style';
const PROJECT_TAG = process.env.ARC_HOH_PROJECT_TAG || 'project:arc-harness';
const BRIEF_TAGS = [PROJECT_TAG, 'topic:arc-harness'];
const REFRESH_MS = 20 * 60 * 1000;

export function apply(ctx) {
  for (const tool of makeTools(defineTool)) ctx.tools.register(tool);

  const state = { brief: '' };
  ctx.inject(['systemPrompt'], (c) => registerPrompt(c.systemPrompt, () => state.brief));
  registerTraceRoutes(ctx, state);

  if (optedOut('BRIEF')) return;
  const refresh = async () => {
    try {
      const text = await fetchBrief({ query: BRIEF_QUERY, tags: BRIEF_TAGS });
      if (text) state.brief = text;
    } catch { /* fail open */ }
  };
  void refresh();
  ctx.effect(() => {
    const timer = setInterval(refresh, REFRESH_MS);
    if (typeof timer.unref === 'function') timer.unref();
    return () => clearInterval(timer);
  }, 'arc-hoh: brief refresh');
}

export * from './formal.js';
export * from './intuition.js';
export * from './budget.js';
export * from './delta-ledger.js';
