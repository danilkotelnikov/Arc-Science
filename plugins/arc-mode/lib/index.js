/**
 * arc-mode 0.1.0 (2026-11-07)
 * Host half. While the mode is on, the written rules go into every system prompt of this app.
 * POST /api/arc-mode/state reads the mode, the installed list and the measured results, and a boolean "on" sets the mode.
 * The hooks and skills of Claude Code stay as they are: this plugin reads their list and never writes their settings.
 */
import { homes, promptText, serve } from './mode.js';

export const name = 'arc-mode';

export function apply(ctx) {
  const h = homes();
  ctx.inject(['systemPrompt'], (c) => {
    c.systemPrompt.variable('arc_mode_rules', () => promptText(h));
    c.systemPrompt.section({ name: 'arc-mode:rules', order: 9400, text: '{{arc_mode_rules}}' });
  });
  ctx.inject(['connection'], (c) => {
    const register = c.get('connection')?.fetch?.register;
    if (typeof register !== 'function') return;
    c.effect(() => register.call(c.get('connection').fetch, {
      path: '/api/arc-mode/state', methods: ['POST'], requestBody: 'buffered',
      fetch: async (request) => {
        try { return Response.json(await serve(request, h), { headers: { 'cache-control': 'no-store' } }); }
        catch (err) { return Response.json({ ok: false, error: String(err?.code ?? 'failed') }, { headers: { 'cache-control': 'no-store' } }); }
      },
    }), 'arc-mode: state route');
  });
}
