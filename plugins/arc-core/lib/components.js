// arc-core components (S051): parts that load on first use, swap while the app runs, and roll back when a new copy fails.
// The core keeps only this small host and the route guard below. A part that cannot load answers 503 for its own routes
// and nothing else changes. A swap loads the new copy, runs its self-test, and only then replaces the old one.
// ponytail: only the part's own file is loaded again. A file it imports stays cached until the next restart;
// give such helpers a new file name when they change. The Cammut tab of panel.js is loaded by the page, so it needs a page reload.

export function createComponentHost() {
  const parts = new Map();

  function need(name) {
    const p = parts.get(name);
    if (!p) throw new Error(`Unknown part: ${String(name)}`);
    return p;
  }

  async function build(p, load) {
    const gen = ++p.gen;
    const inst = await load(gen);
    if (!inst || typeof inst !== 'object') throw new Error('The part returned nothing');
    if (typeof inst.selfTest === 'function') await inst.selfTest();
    return inst;
  }

  function register(name, spec) {
    if (typeof name !== 'string' || !name || !spec || typeof spec.load !== 'function') throw new Error('A part needs a name and a load function');
    parts.set(name, { load: spec.load, previousLoad: null, current: null, previous: null, gen: 0, version: 0, state: 'unloaded', error: '', swapping: false, loading: null });
  }

  async function get(name) {
    const p = need(name);
    if (p.current) return p.current;
    // two first calls share one load
    p.loading ||= (async () => {
      try {
        p.current = await build(p, p.load);
        p.version++;
        p.state = 'ready';
        p.error = '';
        return p.current;
      } catch (err) {
        p.state = 'failed';
        p.error = String(err?.message || err).slice(0, 200);
        throw new Error(`The part ${name} could not load: ${p.error}`);
      } finally {
        p.loading = null;
      }
    })();
    return p.loading;
  }

  async function swap(name, load) {
    const p = need(name);
    if (p.swapping) return { ok: false, error: 'A swap is already running' };
    p.swapping = true;
    try {
      const next = await build(p, typeof load === 'function' ? load : p.load);
      p.previousLoad = p.load;
      if (typeof load === 'function') p.load = load;
      p.previous = p.current;
      p.current = next;
      p.version++;
      p.state = 'ready';
      p.error = '';
      return { ok: true, generation: p.version };
    } catch (err) {
      const msg = String(err?.message || err).slice(0, 200);
      p.error = msg;
      if (!p.current) p.state = 'failed';
      return { ok: false, rolledBack: Boolean(p.current), error: msg };
    } finally {
      p.swapping = false;
    }
  }

  function rollback(name) {
    const p = need(name);
    if (!p.previous) return { ok: false, error: 'There is no earlier version to go back to' };
    p.current = p.previous;
    p.previous = null;
    p.load = p.previousLoad || p.load;
    p.state = 'ready';
    p.error = '';
    return { ok: true };
  }

  const list = () => [...parts].map(([name, p]) => ({ name, state: p.state, generation: p.version, canRollback: Boolean(p.previous), error: p.error }));
  const has = (name) => parts.has(name);
  return { register, get, swap, rollback, list, has };
}

// ---- Cammut console routes, core side ----
const LOOPBACK_NAME = /^(?:127\.0\.0\.1|localhost|\[::1\])$/;
const fail = (status, error) => ({ ok: false, status, error });

// A page on a rebound name (evil.example that resolves to 127.0.0.1) has a non-loopback Host.
// An Origin of "null" is a sandboxed frame. Both are refused. Actions need POST.
function guard(req, needPost) {
  if (!LOOPBACK_NAME.test(String(req.host || '').replace(/:\d+$/, ''))) return fail(403, 'The Cammut console answers only on this computer.');
  if (req.origin) {
    let o = null;
    try { o = new URL(req.origin); } catch { /* refused below */ }
    if (!o || !LOOPBACK_NAME.test(o.hostname)) return fail(403, 'This page may not use the Cammut console.');
  }
  if (needPost && req.method !== 'POST') return fail(405, 'Use POST.');
  return null;
}

// req: { clean, method, host, origin, payload }. host is the component host holding "cammut-console".
export async function serveCammutRoute(req, host, name = 'cammut-console') {
  const route = String(req.clean || '').replace(/^api\/arc-core\/cammut\//, '');
  if (route !== 'state' && route !== 'action') return { ok: false, error: `Unknown Cammut route: ${route}` };
  const refused = guard(req, route === 'action');
  if (refused) return refused;
  const payload = req.payload && typeof req.payload === 'object' ? req.payload : {};
  // swap and rollback belong to the core, so a part that cannot load can still be fixed
  if (route === 'action' && typeof payload.kind === 'string' && payload.kind.startsWith('component-')) {
    if (payload.kind === 'component-list') return { ok: true, components: host.list() };
    if (!host.has(payload.name)) return { ok: false, error: 'Unknown part.' };
    if (payload.kind === 'component-reload') return { ...(await host.swap(payload.name)), components: host.list() };
    if (payload.kind === 'component-rollback') return { ...host.rollback(payload.name), components: host.list() };
    return { ok: false, error: `Unknown part action: ${payload.kind}` };
  }
  let inst;
  try {
    inst = await host.get(name);
  } catch (err) {
    return { ...fail(503, String(err.message || err)), components: host.list() };
  }
  try {
    if (route === 'state') return { ...(await inst.state()), components: host.list() };
    return await inst.action(payload);
  } catch (err) {
    return fail(500, String(err?.message || 'The Cammut console failed').slice(0, 200));
  }
}
