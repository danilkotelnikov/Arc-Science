// arc-core Cammut console engine (S051). Written from the public tool descriptions of the gateway's Cammut MCP
// (cammut_call, cammut_search, cammut_describe, cammut_servers and the hindsight/* tool names); no Cammut source is used.
//   - servers: the gateway's cammut.upstreams, changed through its settings route (token read here, never returned)
//   - tools: a runner for the Hindsight tools with three classes: read, write (needs a confirm), destructive (needs the tool name)
//   - observer: read-only views of the bank, the notes, the tags, recall answers, models, directives and operations
// The part loads through components.js, so it can be swapped while the app runs. Keys: only a name (cred://NAME) is kept here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cammutCall, cammutMcp } from './console.js';
import { redactSecrets } from './memory-policy.js';

// ---- tool classes: default-deny ----
// Only list_*, get_* and recall run freely. A named additive verb (retain, reflect, create, update, refresh, set, add)
// needs one confirm. Every other name, also one this code has never seen, counts as a delete and needs the typed tool name.
export function classifyTool(tool) {
  if (typeof tool !== 'string' || !/^hindsight\/[a-z][a-z0-9_]*$/.test(tool)) return 'blocked';
  const name = tool.slice('hindsight/'.length);
  if (name === 'recall' || /^(list|get)_/.test(name)) return 'read';
  if (name === 'retain' || name === 'reflect' || /^(create|update|refresh|set|add)_/.test(name)) return 'write';
  return 'destructive';
}

// ---- addresses and key names ----
export function normalizeServerUrl(input) {
  const raw = String(input ?? '').trim();
  const bad = (error) => ({ ok: false, error });
  if (!/^https?:\/\/[^/?#\s]/i.test(raw)) return bad('Use an http or https address with a host.');
  if (/[?#]/.test(raw)) return bad('The address holds no query or fragment.');
  let u;
  try { u = new URL(raw); } catch { return bad('That is not a valid address.'); }
  if (u.username || u.password) return bad('The address holds no user name or password.');
  return { ok: true, url: `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, '') };
}

// A key is only ever named: cred://VPS_KEY or VPS_KEY. The value stays in the gateway's credential file.
export function normalizeKeyRef(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: true, name: '' };
  const name = raw.startsWith('cred://') ? raw.slice('cred://'.length) : raw;
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name) || redactSecrets(raw).redacted) {
    return { ok: false, error: 'Give a key name in capitals, for example VPS_KEY. Never the key itself.' };
  }
  return { ok: true, name };
}

// ---- shaping answers: secrets out, sizes capped ----
function shape(v, depth = 0) {
  if (typeof v === 'string') return redactSecrets(v).clean.slice(0, 2000);
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (depth > 6) return '[deep]';
  if (Array.isArray(v)) return v.slice(0, 100).map((x) => shape(x, depth + 1));
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 60).map(([k, x]) => [k, shape(x, depth + 1)]));
  return undefined;
}
const parseText = (text) => {
  try { return shape(JSON.parse(text)); } catch { return { text: redactSecrets(String(text)).clean.slice(0, 4000) }; }
};
// The address without user name, password, query and fragment. An older build could save an address with a secret in it:
// the panel never shows that part, and the server can still be found and removed.
export function plainServerUrl(raw) {
  const text = String(raw ?? '').trim();
  try {
    const u = new URL(text);
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return text.replace(/[?#].*$/, '').replace(/\/\/.*@/, '//').replace(/\/+$/, '');
  }
}
const sameServer = (a, b) => plainServerUrl(a) === b;
// One line of text for the panel. An address inside it (a gateway error names the server it called) loses its user name
// and query first, because a key in a query is not a pattern that redactSecrets knows.
const scrubAddrs = (s) => String(s ?? '').replace(/https?:\/\/[^\s"'<>]+/g, (m) => plainServerUrl(m));
const line = (s, n = 90) => String(redactSecrets(scrubAddrs(s)).clean).replace(/\s+/g, ' ').slice(0, n);
const num = (v, lo, hi, dflt) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : dflt);

// ---- observer views: each one maps to one read tool ----
const VIEWS = Object.freeze({
  memories: { tool: 'hindsight/list_memories', pick: ['limit', 'offset', 'q', 'tags'] },
  tags: { tool: 'hindsight/list_tags', pick: ['limit', 'offset', 'q'] },
  documents: { tool: 'hindsight/list_documents', pick: ['limit', 'offset', 'q'] },
  models: { tool: 'hindsight/list_mental_models', pick: ['limit', 'offset', 'tags'] },
  directives: { tool: 'hindsight/list_directives', pick: ['limit', 'offset', 'tags'] },
  operations: { tool: 'hindsight/list_operations', pick: ['limit', 'offset'] },
  recall: { tool: 'hindsight/recall', pick: [] },
});

export function createCammutConsole(opts = {}) {
  const gatewayHost = typeof opts.gatewayHost === 'string' && opts.gatewayHost.trim() ? opts.gatewayHost.trim() : '127.0.0.1:7424';
  const fetchImpl = typeof opts.fetch === 'function' ? opts.fetch : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const arcHome = typeof opts.arcHome === 'string' && opts.arcHome.trim() ? opts.arcHome.trim() : path.join(os.homedir(), '.arc');
  const embedded = opts.embedded || null;
  // The token file belongs to the gateway. The token goes into one request header and nowhere else.
  // Under the test runner the real token file is never read.
  const readToken = typeof opts.readToken === 'function' ? opts.readToken : () => {
    if (process.env.NODE_TEST_CONTEXT) return null;
    try {
      const t = fs.readFileSync(path.join(arcHome, '.gateway-token'), 'utf8').trim();
      return /^[0-9a-f]{64}$/.test(t) ? t : null;
    } catch {
      return null;
    }
  };

  async function gw(route, init = {}, timeoutMs = 2500) {
    if (!fetchImpl) return { ok: false, status: 0, data: null };
    try {
      const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
      const res = await fetchImpl(`http://${gatewayHost}${route}`, { ...init, signal });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    } catch {
      return { ok: false, status: 0, data: null };
    }
  }

  // ---- servers ----
  async function readServers() {
    const r = await gw('/api/config');
    if (r.status === 0) return { ok: false, error: 'The gateway is not running.' };
    const c = r.data?.cammut;
    if (!r.ok || !c || !Array.isArray(c.upstreams)) return { ok: false, old: true, error: 'The running gateway is older. Update it in the Updates tab.' };
    return { ok: true, upstreams: c.upstreams.map(String), auth: c.auth && typeof c.auth === 'object' ? c.auth : {}, keyPresent: c.keyPresent || {}, authFile: Boolean(c.authFile) };
  }

  async function state() {
    const [health, cfg] = await Promise.all([gw('/health', {}, 1500), readServers()]);
    const seen = health.data?.cammutUpstreams && typeof health.data.cammutUpstreams === 'object' ? health.data.cammutUpstreams : {};
    const servers = cfg.ok ? cfg.upstreams.map((url) => {
      const key = url.replace(/\/+$/, '');
      const own = Object.prototype.hasOwnProperty.call(cfg.auth, key);
      const ref = own ? String(cfg.auth[key] || '') : '';
      const err = seen[url] ?? seen[key];
      return {
        url: plainServerUrl(url),
        status: err === undefined ? 'Not tried yet' : err === '' ? 'Reachable' : line(err),
        ownKey: own,
        keyRef: ref ? `cred://${ref}` : '',
        keySet: Boolean(cfg.keyPresent[key]),
        legacyAuth: !own && cfg.authFile,
      };
    }) : [];
    return {
      ok: true,
      gateway: { host: gatewayHost, reachable: health.ok, version: String(health.data?.version || '') },
      canManage: cfg.ok,
      manageReason: cfg.ok ? '' : cfg.error,
      servers,
      builtin: { available: Boolean(embedded), tools: embedded ? [...embedded.tools] : [] },
    };
  }

  async function postServers(upstreams, auth) {
    const token = await readToken();
    if (!token) return { ok: false, error: 'The gateway token file was not found. Start the gateway once.' };
    const r = await gw('/api/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Arc-Gateway-Token': token },
      body: JSON.stringify({ cammut: { upstreams, auth } }),
    }, 5000);
    if (r.status === 0) return { ok: false, error: 'The gateway did not answer.' };
    if (r.status === 401) return { ok: false, error: 'The gateway refused the token.' };
    if (!r.ok) return { ok: false, error: line(r.data?.error || `The gateway answered ${r.status}.`) };
    return { ok: true };
  }

  async function change(build) {
    const cur = await readServers();
    if (!cur.ok) return cur;
    const next = build(cur);
    if (!next.ok) return next;
    const wrote = await postServers(next.upstreams, next.auth);
    if (!wrote.ok) return wrote;
    const back = await readServers();
    const norm = (list) => list.map((u) => normalizeServerUrl(u).url ?? u);
    if (!back.ok || JSON.stringify(norm(back.upstreams)) !== JSON.stringify(norm(next.upstreams))) {
      return { ok: false, error: 'The gateway did not apply the change. It may be older; update it.' };
    }
    return { ok: true, ...(await state()) };
  }

  const addServer = ({ url, keyRef } = {}) => {
    const n = normalizeServerUrl(url);
    if (!n.ok) return Promise.resolve(n);
    const k = normalizeKeyRef(keyRef);
    if (!k.ok) return Promise.resolve(k);
    return change((cur) => {
      if (cur.upstreams.some((u) => sameServer(u, n.url))) return { ok: false, error: 'That server is already in the list.' };
      // an empty key name sends no entry: the gateway then keeps the owner's file for the default server and gives any other new one none
      return { ok: true, upstreams: [...cur.upstreams, n.url], auth: k.name ? { ...cur.auth, [n.url]: k.name } : { ...cur.auth } };
    });
  };

  const removeServer = ({ url } = {}) => {
    const n = normalizeServerUrl(url);
    if (!n.ok) return Promise.resolve(n);
    return change((cur) => {
      const keep = cur.upstreams.filter((u) => !sameServer(u, n.url));
      if (keep.length === cur.upstreams.length) return { ok: false, error: 'That server is not in the list.' };
      if (keep.length === 0) return { ok: false, error: 'The last server stays. Add another one first.' };
      const auth = Object.fromEntries(Object.entries(cur.auth).filter(([k]) => !sameServer(k, n.url)));
      return { ok: true, upstreams: keep, auth };
    });
  };

  // ---- tools ----
  async function searchTools({ query, source } = {}) {
    if (source === 'builtin') {
      // the store on this computer: its own short tool list, no network call; an empty word lists all of them
      const word = String(query ?? '').trim().toLowerCase().slice(0, 100);
      const tools = (embedded ? embedded.tools : []).filter((x) => !word || x.includes(word))
        .map((tool) => ({ tool, class: classifyTool(tool), description: 'Built-in store on this computer' }));
      return { ok: true, tools };
    }
    const q = String(query ?? '').trim().slice(0, 100);
    if (!q) return { ok: false, error: 'Type a word to search the tools.' };
    const r = await cammutMcp(gatewayHost, 'cammut_search', { query: q }, { fetchImpl, timeoutMs: 6000 });
    if (!r.ok || r.toolError || !r.parsed) return { ok: false, error: line(r.error || 'Search failed.') };
    let list = [];
    try { list = JSON.parse(r.text); } catch { /* empty */ }
    const tools = (Array.isArray(list) ? list : []).filter((x) => classifyTool(x?.tool) !== 'blocked')
      .map((x) => ({ tool: x.tool, class: classifyTool(x.tool), description: line(x.description, 200) }));
    return { ok: true, tools };
  }

  async function describeTool({ tool } = {}) {
    if (classifyTool(tool) === 'blocked') return { ok: false, error: 'Only Hindsight tools can be described here.' };
    const r = await cammutMcp(gatewayHost, 'cammut_describe', { tool }, { fetchImpl, timeoutMs: 6000 });
    if (!r.ok || r.toolError || !r.parsed) return { ok: false, error: line(r.error || 'Describe failed.') };
    return { ok: true, class: classifyTool(tool), data: parseText(r.text) };
  }

  async function runTool({ tool, arguments: args = {}, confirm, source } = {}) {
    const cls = classifyTool(tool);
    if (cls === 'blocked') return { ok: false, error: 'Only Hindsight tools can run here.' };
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, error: 'The arguments must be an object.' };
    const body = JSON.stringify(args);
    if (body.length > 20000) return { ok: false, error: 'The arguments are too long.' };
    if (redactSecrets(body).redacted) return { ok: false, error: 'The arguments hold what looks like a secret. Nothing was sent.' };
    if (cls === 'write' && confirm !== true) return { ok: false, class: cls, needs: 'confirm', error: 'This changes memory. Confirm to run it.' };
    if (cls === 'destructive' && confirm !== tool) return { ok: false, class: cls, needs: 'confirm-tool', error: 'This deletes data for good. Type the tool name to run it.' };
    if (source === 'builtin') {
      // the same confirm gates as above, then the store on this computer; no network call
      if (!embedded || !embedded.tools.includes(tool)) return { ok: false, class: cls, error: 'The built-in store does not have this tool.' };
      const b = await embedded.callTool(tool, args);
      return b.ok ? { ok: true, class: cls, source, data: shape(b.data) } : { ok: false, class: cls, error: line(b.error) };
    }
    const r = await cammutCall(gatewayHost, tool, args, { fetchImpl, timeoutMs: cls === 'read' ? 8000 : 30000 });
    if (!r.ok || r.toolError || !r.parsed) return { ok: false, class: cls, error: line(r.error || 'The call failed.') };
    return { ok: true, class: cls, data: parseText(r.text) };
  }

  // ---- observer: read only, by construction ----
  async function observe({ source = 'cammut', view, q, tags, limit, offset } = {}) {
    const spec = Object.prototype.hasOwnProperty.call(VIEWS, view) ? VIEWS[view] : null;
    if (!spec) return { ok: false, error: 'Unknown view.' };
    if (classifyTool(spec.tool) !== 'read') return { ok: false, error: 'The observer reads only.' };
    const given = {
      limit: num(limit, 1, 100, 20),
      offset: num(offset, 0, 1e6, 0),
      ...(typeof q === 'string' && q.trim() ? { q: q.trim().slice(0, 200) } : {}),
      ...(Array.isArray(tags) && tags.length ? { tags: tags.map((t) => String(t).slice(0, 80)).slice(0, 10) } : {}),
    };
    let args = Object.fromEntries(spec.pick.filter((k) => k in given).map((k) => [k, given[k]]));
    if (view === 'recall') {
      if (!given.q) return { ok: false, error: 'Type a question to recall.' };
      args = { query: given.q, budget: 'low', max_tokens: 1500, ...(given.tags ? { tags: given.tags } : {}) };
    }
    if (source === 'builtin') {
      if (!embedded || !embedded.tools.includes(spec.tool)) return { ok: false, error: 'The built-in store does not have this view.' };
      const r = await embedded.callTool(spec.tool, args);
      return r.ok ? { ok: true, source, view, data: shape(r.data) } : { ok: false, error: line(r.error) };
    }
    const r = await runTool({ tool: spec.tool, arguments: args });
    return r.ok ? { ok: true, source: 'cammut', view, data: r.data } : { ok: false, error: r.error };
  }

  async function action(p = {}) {
    switch (p.kind) {
      case 'server-add': return addServer(p);
      case 'server-remove': return removeServer(p);
      case 'tool-search': return searchTools(p);
      case 'tool-describe': return describeTool(p);
      case 'tool-run': return runTool(p);
      case 'observe': return observe(p);
      default: return { ok: false, error: `Unknown Cammut action: ${String(p.kind || '')}` };
    }
  }

  // A swap runs this before the new copy replaces the old one.
  async function selfTest() {
    if (classifyTool('hindsight/list_tags') !== 'read' || classifyTool('hindsight/delete_bank') !== 'destructive' || classifyTool('github/x') !== 'blocked') throw new Error('tool classes are wrong');
    if (!normalizeServerUrl('http://127.0.0.1:1').ok || normalizeServerUrl('https://u:p' + '\x40x.example').ok) throw new Error('address check is wrong');
    return true;
  }

  return { state, addServer, removeServer, searchTools, describeTool, runTool, observe, action, selfTest };
}
