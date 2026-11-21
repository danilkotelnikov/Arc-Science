// Cammut console tests (slice S051): tool classes, MCP client, server list through the gateway settings route,
// read-only observer, route guard, hot-swappable components with rollback, and the embedded memory store.
// Every test uses a fake fetch and a throwaway folder: nothing here reaches 127.0.0.1:7424 or the real ~/.arc.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONNECTORS,
  cammutCall,
  serveConsoleRoute,
  createResearchSessionStore,
} from '../lib/console.js';
import {
  classifyTool,
  normalizeServerUrl,
  createCammutConsole,
} from '../lib/cammut-console.js';
import { createComponentHost, serveCammutRoute } from '../lib/components.js';
import { createMemoryPolicyStore, createEmbeddedMemoryServer } from '../lib/memory-policy.js';
import { plainServerUrl } from '../lib/cammut-console.js';

const TOKEN = 'a'.repeat(64);
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const mcp = (payload, isError = false) => json({ jsonrpc: '2.0', id: 1, result: { isError, content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] } });

// A fake gateway: /api/config, /health and /cammut/mcp. `calls` records every request for the asserts.
function fakeGateway({ upstreams = ['http://127.0.0.1:7421'], auth = {}, old = false, ignoreWrites = false, tools = {} } = {}) {
  const state = { upstreams: [...upstreams], auth: { ...auth }, calls: [] };
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    state.calls.push({ path: u.pathname, method: init.method || 'GET', headers: { ...(init.headers || {}) }, body });
    if (u.pathname === '/health') return json({ status: 'ok', version: '0.9', cammutUpstreams: Object.fromEntries(state.upstreams.map((x) => [x, ''])) });
    if (u.pathname === '/api/config' && (init.method || 'GET') === 'GET') {
      return json(old ? { defaultReasoningEffort: 'high', keys: {} } : { defaultReasoningEffort: 'high', keys: {}, cammut: { upstreams: state.upstreams, auth: state.auth, keyPresent: Object.fromEntries(Object.entries(state.auth).map(([k, v]) => [k, Boolean(v)])), authFile: true } });
    }
    if (u.pathname === '/api/config') {
      if (init.headers?.['X-Arc-Gateway-Token'] !== TOKEN) return json({ error: 'gateway token required' }, 401);
      if (!ignoreWrites && body.cammut) {
        state.upstreams = body.cammut.upstreams.map((x) => x.replace(/^(https?:\/\/)([^/]+)/i, (m, a, b) => a + b.toLowerCase()).replace(/\/+$/, '')); // as the gateway does
        if (body.cammut.auth) state.auth = body.cammut.auth;
      }
      return json({ saved: true });
    }
    if (u.pathname === '/cammut/mcp') {
      const a = body.params.arguments;
      if (body.params.name === 'cammut_call') {
        const h = tools[a.tool];
        if (!h) return mcp({ error: `unknown ${a.tool}` }, true);
        return mcp(typeof h === 'function' ? h(a.arguments) : h);
      }
      if (body.params.name === 'cammut_search') return mcp([{ tool: 'hindsight/list_tags', description: 'List tags' }, { tool: 'hindsight/delete_bank', description: 'Delete the bank' }]);
      if (body.params.name === 'cammut_describe') return mcp({ tool: a.tool, description: 'd', inputSchema: { type: 'object', properties: {} } });
      if (body.params.name === 'cammut_servers') return mcp([{ name: 'hindsight', status: 'ok', tools: 36 }]);
    }
    return json({ error: 'nope' }, 404);
  };
  return { fetch, state };
}

const mk = (gw, extra = {}) => createCammutConsole({ fetch: gw.fetch, gatewayHost: '127.0.0.1:7424', readToken: () => TOKEN, ...extra });

test('1. Tool classes are default-deny: only list, get and recall run freely', () => {
  for (const t of ['hindsight/list_memories', 'hindsight/list_tags', 'hindsight/get_mental_model', 'hindsight/recall']) assert.equal(classifyTool(t), 'read', t);
  for (const t of ['hindsight/retain', 'hindsight/reflect', 'hindsight/create_directive', 'hindsight/refresh_mental_model', 'hindsight/update_bank', 'hindsight/set_mission', 'hindsight/add_tag']) assert.equal(classifyTool(t), 'write', t);
  for (const t of ['hindsight/delete_bank', 'hindsight/delete_document', 'hindsight/clear_memories', 'hindsight/clear_mental_model', 'hindsight/delete_knowledge_node', 'hindsight/purge_bank', 'hindsight/erase_bank', 'hindsight/prune_memories', 'hindsight/truncate_bank', 'hindsight/revoke_key', 'hindsight/forget', 'hindsight/brand_new_tool']) assert.equal(classifyTool(t), 'destructive', t);
  for (const t of ['github/create_issue', 'github/list_issues', 'hindsight/', 'hindsight', '', 'hindsight/../x', 'hindsight/list memories', 42, null]) assert.equal(classifyTool(t), 'blocked', String(t));
});

test('2. normalizeServerUrl keeps only plain http and https addresses', () => {
  assert.deepEqual(normalizeServerUrl('https://memory.example.org/cammut/'), { ok: true, url: 'https://memory.example.org/cammut' });
  assert.equal(normalizeServerUrl(' http://127.0.0.1:7421 ').url, 'http://127.0.0.1:7421');
  for (const bad of ['ftp://a.example', 'https://user:pw' + '\x40a.example', 'https://a.example/?k=v', 'https://a.example/#x', 'a.example', '', 'https:///x', 'javascript:alert(1)']) {
    assert.equal(normalizeServerUrl(bad).ok, false, bad);
  }
});

test('3. cammutCall reads JSON and event-stream bodies and reports tool errors', async () => {
  const sse = async () => new Response('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"a":1}' }] } }) + '\n\n', { status: 200 });
  const r = await cammutCall('127.0.0.1:7424', 'hindsight/list_tags', {}, { fetchImpl: sse });
  assert.equal(r.ok, true);
  assert.equal(r.text, '{"a":1}');
  const gw = fakeGateway({});
  const bad = await cammutCall('127.0.0.1:7424', 'hindsight/nothing', {}, { fetchImpl: gw.fetch });
  assert.equal(bad.toolError, true, 'a tool error is flagged, as the retain path expects');
  const down = await cammutCall('127.0.0.1:7424', 'hindsight/list_tags', {}, { fetchImpl: async () => { throw new Error('connect refused'); } });
  assert.equal(down.ok, false);
  assert.match(down.error, /refused/);
});

test('4. runTool: reads run, writes need a confirm, deletes need the tool name, other tools are refused', async () => {
  const gw = fakeGateway({ tools: { 'hindsight/list_tags': { items: ['a'] }, 'hindsight/create_directive': { id: 'd1' }, 'hindsight/delete_document': { deleted: true } } });
  const c = mk(gw);
  assert.equal((await c.runTool({ tool: 'hindsight/list_tags' })).ok, true);
  const w = await c.runTool({ tool: 'hindsight/create_directive', arguments: { name: 'x' } });
  assert.equal(w.ok, false);
  assert.equal(w.needs, 'confirm');
  assert.equal((await c.runTool({ tool: 'hindsight/create_directive', arguments: { name: 'x' }, confirm: true })).ok, true);
  const before = gw.state.calls.length;
  const d = await c.runTool({ tool: 'hindsight/delete_document', arguments: { document_id: 'z' }, confirm: true });
  assert.equal(d.ok, false);
  assert.equal(d.needs, 'confirm-tool');
  assert.equal(gw.state.calls.length, before, 'a refused delete never reaches the gateway');
  assert.equal((await c.runTool({ tool: 'hindsight/delete_document', arguments: { document_id: 'z' }, confirm: 'hindsight/delete_document' })).ok, true);
  const g = await c.runTool({ tool: 'github/create_issue', arguments: {}, confirm: true });
  assert.equal(g.ok, false);
  assert.match(g.error, /Hindsight/);
});

test('5. runTool refuses secrets in arguments and hides secrets in answers', async () => {
  const leak = 'sk-' + 'x'.repeat(30);
  const gw = fakeGateway({ tools: { 'hindsight/retain': { ok: 1 }, 'hindsight/list_memories': { items: [{ text: `key ${leak} here` }] } } });
  const c = mk(gw);
  const r = await c.runTool({ tool: 'hindsight/retain', arguments: { content: `my key ${leak}` }, confirm: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /secret/i);
  assert.ok(!gw.state.calls.some((x) => x.path === '/cammut/mcp'), 'nothing was sent');
  const read = await c.runTool({ tool: 'hindsight/list_memories' });
  assert.ok(!JSON.stringify(read).includes(leak));
  assert.match(JSON.stringify(read), /REDACTED/);
});

test('6. Observer is read only: views map to read tools, unknown views and writes are refused', async () => {
  const seen = [];
  const gw = fakeGateway({ tools: new Proxy({}, { get: (_, tool) => (args) => { seen.push([tool, args]); return { items: [], total: 0 }; } }) });
  const c = mk(gw);
  for (const view of ['memories', 'tags', 'documents', 'recall', 'models', 'directives', 'operations']) {
    const r = await c.observe({ source: 'cammut', view, q: 'vpn', limit: 5 });
    assert.equal(r.ok, true, view);
  }
  assert.deepEqual(seen.map(([t]) => t), ['hindsight/list_memories', 'hindsight/list_tags', 'hindsight/list_documents', 'hindsight/recall', 'hindsight/list_mental_models', 'hindsight/list_directives', 'hindsight/list_operations']);
  assert.equal(seen.every(([t]) => classifyTool(t) === 'read'), true);
  assert.equal(seen[0][1].limit, 5);
  assert.equal(seen[3][1].query, 'vpn');
  assert.equal((await c.observe({ source: 'cammut', view: 'delete_bank' })).ok, false);
  assert.equal((await c.observe({ source: 'cammut', view: 'memories', limit: 100000 })).ok, true);
  assert.ok(seen.at(-1)[1].limit <= 100, 'limit is capped');
});

test('7. Observer also reads the built-in store, without a network call', async () => {
  const store = createMemoryPolicyStore();
  store.retainNote({ text: 'The owner prefers plain English', tags: ['project:arc'] });
  const gw = fakeGateway({});
  const c = mk(gw, { embedded: createEmbeddedMemoryServer(store) });
  const mem = await c.observe({ source: 'builtin', view: 'memories' });
  assert.equal(mem.ok, true);
  assert.match(JSON.stringify(mem.data), /plain English/);
  assert.equal((await c.observe({ source: 'builtin', view: 'tags' })).ok, true);
  assert.equal((await c.observe({ source: 'builtin', view: 'recall', q: 'English' })).ok, true);
  assert.equal((await c.observe({ source: 'builtin', view: 'operations' })).ok, false);
  assert.equal(gw.state.calls.length, 0);
});

test('8. state lists servers and shows a key name, never a key value', async () => {
  const gw = fakeGateway({ upstreams: ['http://127.0.0.1:7421', 'https://vps.example.org'], auth: { 'https://vps.example.org': 'VPS_KEY' } });
  const s = await mk(gw).state();
  assert.equal(s.ok, true);
  assert.equal(s.gateway.reachable, true);
  assert.equal(s.canManage, true);
  const vps = s.servers.find((x) => x.url === 'https://vps.example.org');
  assert.equal(vps.keyRef, 'cred://VPS_KEY');
  assert.equal(vps.keySet, true);
  assert.equal(s.servers.find((x) => x.url === 'http://127.0.0.1:7421').ownKey, false);
  assert.ok(!JSON.stringify(s).includes(TOKEN));
});

test('9. state says the gateway is too old when it does not list servers', async () => {
  const s = await mk(fakeGateway({ old: true })).state();
  assert.equal(s.ok, true);
  assert.equal(s.canManage, false);
  assert.match(s.manageReason, /older|update/i);
});

test('10. addServer writes through the settings route with the token and reads the result back', async () => {
  const gw = fakeGateway({});
  const c = mk(gw);
  const r = await c.addServer({ url: 'https://vps.example.org/', keyRef: 'cred://VPS_KEY' });
  assert.equal(r.ok, true);
  const post = gw.state.calls.find((x) => x.method === 'POST' && x.path === '/api/config');
  assert.equal(post.headers['X-Arc-Gateway-Token'], TOKEN);
  assert.deepEqual(post.body.cammut.upstreams, ['http://127.0.0.1:7421', 'https://vps.example.org']);
  assert.equal(post.body.cammut.auth['https://vps.example.org'], 'VPS_KEY');
  assert.ok(!JSON.stringify(r).includes(TOKEN));
  assert.equal(gw.state.calls.filter((x) => x.method === 'GET' && x.path === '/api/config').length >= 2, true, 'read before and after');
});

test('11. addServer refuses bad addresses, bad key names, duplicates and secrets in the key field', async () => {
  const gw = fakeGateway({});
  const c = mk(gw);
  for (const url of ['ftp://x.example', 'https://u:p' + '\x40x.example', 'https://x.example/?token=1']) assert.equal((await c.addServer({ url })).ok, false, url);
  for (const keyRef of ['sk-' + 'a'.repeat(30), 'Bearer abcdefghijklmnop', 'has space', 'cred://']) assert.equal((await c.addServer({ url: 'https://x.example', keyRef })).ok, false, keyRef);
  assert.equal((await c.addServer({ url: 'http://127.0.0.1:7421/' })).ok, false, 'duplicate');
  assert.equal(gw.state.calls.filter((x) => x.method === 'POST').length, 0, 'nothing was written');
});

test('12. addServer reports an old gateway that ignores the change', async () => {
  const r = await mk(fakeGateway({ ignoreWrites: true })).addServer({ url: 'https://vps.example.org' });
  assert.equal(r.ok, false);
  assert.match(r.error, /did not apply|older|update/i);
  const old = await mk(fakeGateway({ old: true })).addServer({ url: 'https://vps.example.org' });
  assert.equal(old.ok, false);
});

test('13. removeServer drops the server and its key entry, and keeps the last one', async () => {
  const gw = fakeGateway({ upstreams: ['http://127.0.0.1:7421', 'https://vps.example.org'], auth: { 'https://vps.example.org': 'VPS_KEY' } });
  const c = mk(gw);
  assert.equal((await c.removeServer({ url: 'https://vps.example.org' })).ok, true);
  const post = gw.state.calls.find((x) => x.method === 'POST');
  assert.deepEqual(post.body.cammut.upstreams, ['http://127.0.0.1:7421']);
  assert.deepEqual(post.body.cammut.auth, {});
  const last = await c.removeServer({ url: 'http://127.0.0.1:7421' });
  assert.equal(last.ok, false);
  assert.match(last.error, /last/i);
  assert.equal((await c.removeServer({ url: 'https://nothere.example' })).ok, false);
});

test('14. A missing token file gives a clear answer and sends nothing', async () => {
  const gw = fakeGateway({});
  const c = createCammutConsole({ fetch: gw.fetch, readToken: () => null });
  const r = await c.addServer({ url: 'https://vps.example.org' });
  assert.equal(r.ok, false);
  assert.match(r.error, /token/i);
  assert.equal(gw.state.calls.filter((x) => x.method === 'POST').length, 0);
});

test('15. Route guard: actions are POST only from a loopback page; state needs a loopback Host', async () => {
  const gw = fakeGateway({});
  const host = createComponentHost();
  host.register('cammut-console', { load: async () => mk(gw) });
  const req = (o) => serveCammutRoute({ clean: 'api/arc-core/cammut/action', method: 'POST', host: '127.0.0.1:8080', origin: null, payload: { kind: 'tool-search', query: 'tags' }, ...o }, host);
  assert.equal((await req({})).ok, true);
  assert.equal((await req({ method: 'GET' })).status, 405);
  assert.equal((await req({ host: 'evil.example' })).status, 403);
  assert.equal((await req({ origin: 'https://evil.example' })).status, 403);
  assert.equal((await req({ origin: 'null' })).status, 403);
  assert.equal((await req({ origin: 'http://localhost:3000' })).ok, true);
  const st = (o) => serveCammutRoute({ clean: 'api/arc-core/cammut/state', method: 'GET', host: '127.0.0.1:8080', origin: null, payload: {}, ...o }, host);
  assert.equal((await st({})).ok, true);
  assert.equal((await st({ host: 'evil.example' })).status, 403);
  assert.equal((await req({ clean: 'api/arc-core/cammut/nothing' })).ok, false);
});

test('16. serveConsoleRoute hands cammut routes to extra.cammut and lists the Cammut connector', async () => {
  assert.ok(CONNECTORS.includes('Cammut'));
  const store = createResearchSessionStore({ live: false, persist: false });
  assert.equal(store.selectConnector('Cammut').ok, true);
  const seen = [];
  const out = await serveConsoleRoute({ url: 'http://127.0.0.1:8080/api/arc-core/cammut/state', method: 'GET', headers: new Headers({ origin: 'http://127.0.0.1:8080' }) }, {}, store, { cammut: async (r) => { seen.push(r); return { ok: true }; } });
  assert.equal(out.ok, true);
  // a local request reaches the Cammut guard as 127.0.0.1 with no Origin
  assert.deepEqual([seen[0].clean, seen[0].method, seen[0].host, seen[0].origin], ['api/arc-core/cammut/state', 'GET', '127.0.0.1', null]);
  // The desktop window: http://arc.internal/..., Origin "null", a JSON POST (the shape seen in the live test of the update routes).
  const call = (url, headers, method = 'POST') => { seen.length = 0; return serveConsoleRoute({ url, method, headers: new Headers(headers), text: async () => '{"kind":"tool-search","query":"x"}' }, {}, store, { cammut: async (r) => { seen.push(r); return serveCammutRoute(r, { has: () => false, list: () => [], get: async () => ({ state: async () => ({ ok: true }), action: async () => ({ ok: true }) }) }); } }); };
  assert.equal((await call('http://arc.internal/api/arc-core/cammut/action', { 'content-type': 'application/json', origin: 'null' })).ok, true, 'the desktop window may use the Cammut console');
  assert.equal((await call('http://arc.internal/api/arc-core/cammut/action', { 'content-type': 'application/json', origin: 'arc-app://app' })).ok, true);
  assert.equal((await call('http://arc.internal/api/arc-core/cammut/action', { 'content-type': 'application/json', origin: 'arc-app://evil' })).status, 403, 'another app page is refused');
  assert.equal((await call('http://evil.example/api/arc-core/cammut/action', { 'content-type': 'application/json' })).status, 403, 'a page on another host is refused');
  assert.equal((await call('http://127.0.0.1:7777/api/arc-core/cammut/action', { 'content-type': 'text/plain', origin: 'null' })).status, 415, 'a cross-site form cannot send JSON, so a plain body is refused');
  assert.equal((await call('http://127.0.0.1:7777/api/arc-core/cammut/action', { 'content-type': 'text/plain', origin: 'http://localhost:3000' })).status, 415, 'a plain form from another local page is refused too');
  assert.equal((await call('http://arc.internal/api/arc-core/cammut/action', { host: '127.0.0.1:5140', 'content-type': 'application/json', origin: 'null' })).ok, true, 'a loopback Host with a port is local');
  assert.equal((await call('http://arc.internal/api/arc-core/cammut/action', { host: 'evil.example:5140', 'content-type': 'application/json', origin: 'null' })).status, 403, 'a rebound name is refused');
  assert.equal(seen.length, 0, 'a refused request never reaches the Cammut part');
  assert.equal((await call('http://127.0.0.1:7777/api/arc-core/cammut/state', { origin: 'https://evil.example' }, 'GET')).status, 403, 'a foreign page cannot read the state');
});

test('17. Components swap without a restart, and a bad update rolls back', async () => {
  const host = createComponentHost();
  let gen = 0;
  host.register('part', { load: async () => ({ version: ++gen, serve: () => `v${gen}`, selfTest: async () => true }) });
  assert.equal((await host.get('part')).serve(), 'v1');
  const ok = await host.swap('part');
  assert.equal(ok.ok, true);
  assert.equal((await host.get('part')).serve(), 'v2');
  // a candidate that throws on load, and one that fails its self-test
  const bad = await host.swap('part', async () => { throw new Error('syntax error in new file'); });
  assert.equal(bad.ok, false);
  assert.equal(bad.rolledBack, true);
  assert.equal((await host.get('part')).serve(), 'v2', 'the working version still serves');
  assert.equal((await host.swap('part', async () => ({ serve: () => 'broken', selfTest: async () => { throw new Error('self-test failed'); } }))).ok, false);
  assert.equal((await host.get('part')).serve(), 'v2');
  // go back to the version before the last good swap
  await host.swap('part', async () => ({ serve: () => 'v3', selfTest: async () => true }));
  assert.equal((await host.get('part')).serve(), 'v3');
  assert.equal(host.rollback('part').ok, true);
  assert.equal((await host.get('part')).serve(), 'v2');
  const list = host.list();
  assert.equal(list[0].name, 'part');
  assert.equal(list[0].state, 'ready');
});

test('18. A component that cannot load never breaks the route or the core', async () => {
  const host = createComponentHost();
  host.register('cammut-console', { load: async () => { throw new Error('SyntaxError: bad file'); } });
  const r = await serveCammutRoute({ clean: 'api/arc-core/cammut/state', method: 'GET', host: '127.0.0.1:8080', origin: null, payload: {} }, host);
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
  assert.match(r.error, /could not load/i);
  // reload and rollback are handled by the core, so a broken part can still be fixed
  const reload = await serveCammutRoute({ clean: 'api/arc-core/cammut/action', method: 'POST', host: '127.0.0.1:8080', origin: null, payload: { kind: 'component-reload', name: 'cammut-console' } }, host);
  assert.equal(reload.ok, false);
  const listed = await serveCammutRoute({ clean: 'api/arc-core/cammut/action', method: 'POST', host: '127.0.0.1:8080', origin: null, payload: { kind: 'component-list' } }, host);
  assert.equal(listed.ok, true);
  assert.equal(listed.components[0].state, 'failed');
});

test('19. Reload only accepts registered names and never a file path from the page', async () => {
  const host = createComponentHost();
  host.register('cammut-console', { load: async () => ({ serve: () => ({ ok: true }), selfTest: async () => true }) });
  const r = await serveCammutRoute({ clean: 'api/arc-core/cammut/action', method: 'POST', host: '127.0.0.1:8080', origin: null, payload: { kind: 'component-reload', name: '../../evil.js', file: 'C:/x.js' } }, host);
  assert.equal(r.ok, false);
});

test('20. The built-in store keeps notes in a file, refuses secrets and serves the Hindsight subset', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-mem-'));
  const file = path.join(dir, 'notes.json');
  try {
    const a = createMemoryPolicyStore({ persistFile: file });
    assert.equal(a.retainNote({ text: 'Plain English for the owner', tags: ['topic:style'] }).ok, true);
    assert.equal(a.retainNote({ text: 'key sk-' + 'q'.repeat(30) }).ok, false);
    const b = createMemoryPolicyStore({ persistFile: file });
    assert.equal(b.recallNotes({ query: 'plain english' }).length, 1, 'a new store reads the file');
    const srv = createEmbeddedMemoryServer(b);
    const rec = await srv.callTool('hindsight/recall', { query: 'english' });
    assert.equal(rec.ok, true);
    const list = await srv.callTool('hindsight/list_memories', { limit: 10 });
    assert.equal(list.data.items.length, 1);
    const tags = await srv.callTool('hindsight/list_tags', {});
    assert.ok(tags.data.items.some((t) => t.tag === 'topic:style'));
    const ret = await srv.callTool('hindsight/retain', { content: 'Another fact about hooks', tags: ['topic:hooks'] });
    assert.equal(ret.ok, true);
    assert.equal(createMemoryPolicyStore({ persistFile: file }).listAll().length, 2);
    assert.equal((await srv.callTool('hindsight/delete_bank', {})).ok, false, 'the built-in store has no delete tools');
    // a broken file is never overwritten
    fs.writeFileSync(file, '{ not json');
    const c = createMemoryPolicyStore({ persistFile: file });
    assert.equal(c.retainNote({ text: 'new note after a broken file' }).ok, true);
    assert.equal(fs.readFileSync(file, 'utf8'), '{ not json', 'the broken file is kept as it was');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('21. apply mounts the Cammut routes, loads the part on first use and reloads it from its file', async () => {
  const { apply } = await import('../lib/index.js');
  const registered = new Map();
  const gw = fakeGateway({});
  const srv = apply({ tools: { register: () => {} }, inject: (_d, fn) => fn({ get: () => ({ fetch: { register: (cfg) => { registered.set(cfg.path, cfg); return () => {}; } } }), effect: (m) => m() }) }, { cammut: { fetch: gw.fetch }, console: { live: false, persist: false } });
  assert.ok(registered.has('/api/arc-core/cammut/state') && registered.has('/api/arc-core/cammut/action'));
  assert.equal(srv.components.list()[0].state, 'unloaded', 'nothing loads at start');
  const st = await registered.get('/api/arc-core/cammut/state').fetch(new Request('http://127.0.0.1:8080/api/arc-core/cammut/state'));
  const j = await st.json();
  assert.equal(st.status, 200);
  assert.equal(j.canManage, true);
  assert.equal(j.builtin.available, true);
  const evil = await registered.get('/api/arc-core/cammut/action').fetch(new Request('http://evil.example/api/arc-core/cammut/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"kind":"tool-search","query":"x"}' }));
  assert.equal(evil.status, 403);
  const reload = await srv.components.swap('cammut-console');
  assert.equal(reload.ok, true, 'reloads from the file on disk without a restart');
  assert.equal(srv.components.list()[0].generation, 2);
  assert.equal(srv.components.rollback('cammut-console').ok, true);
});

// ---- Argon review fixes (S051) ----
test('22. A reply that is not valid is an error, not a result', async () => {
  const bad = async () => new Response('gateway fault', { status: 200 });
  const c = createCammutConsole({ fetch: bad, readToken: () => TOKEN });
  assert.equal((await c.runTool({ tool: 'hindsight/list_tags' })).ok, false);
  assert.equal((await c.searchTools({ query: 'tags' })).ok, false);
  assert.equal((await c.describeTool({ tool: 'hindsight/list_tags' })).ok, false);
});

test('23. Without an injected reader the token file is not read under the test runner', async () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'this test runs under node:test');
  const gw = fakeGateway({});
  const r = await createCammutConsole({ fetch: gw.fetch }).addServer({ url: 'https://vps.example.org' });
  assert.equal(r.ok, false);
  assert.match(r.error, /token/i);
});

test('24. A server written with capital letters in the config can still be removed or seen as a duplicate', async () => {
  const gw = fakeGateway({ upstreams: ['http://127.0.0.1:7421', 'https://VPS.Example.org:443/'] });
  const c = mk(gw);
  assert.equal((await c.addServer({ url: 'https://vps.example.org' })).ok, false, 'duplicate seen');
  assert.equal((await c.removeServer({ url: 'https://vps.example.org' })).ok, true);
  assert.equal(JSON.stringify(gw.state.upstreams), JSON.stringify(['http://127.0.0.1:7421']));
});

test('25. Components: one load for two first calls, rollback restores the old loader, errors clear, 503 lists the parts', async () => {
  const host = createComponentHost();
  let loads = 0;
  host.register('p', { load: async () => { loads++; await new Promise((r) => setTimeout(r, 5)); return { tag: 'a', selfTest: async () => true }; } });
  const [x, y] = await Promise.all([host.get('p'), host.get('p')]);
  assert.equal(x, y);
  assert.equal(loads, 1);
  assert.equal((await host.swap('p', async () => ({ tag: 'b', selfTest: async () => true }))).ok, true);
  assert.equal(host.rollback('p').ok, true);
  assert.equal((await host.get('p')).tag, 'a');
  assert.equal((await host.swap('p')).ok, true, 'a later reload uses the old loader again');
  assert.equal((await host.get('p')).tag, 'a');
  assert.equal(host.list()[0].generation, 3, 'version counts good loads only');
  await host.swap('p', async () => { throw new Error('boom'); });
  assert.equal(host.list()[0].generation, 3, 'a failed swap does not change the version');
  const broken = createComponentHost();
  broken.register('cammut-console', { load: async () => { throw new Error('bad file'); } });
  const r = await serveCammutRoute({ clean: 'api/arc-core/cammut/state', method: 'GET', host: '127.0.0.1:1', origin: null, payload: {} }, broken);
  assert.equal(r.status, 503);
  assert.equal(r.components[0].state, 'failed');
});

test('26. A notes file with the wrong shape is kept as it is and the store starts empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-mem-'));
  try {
    for (const bad of ['{"notes":"bad"}', '{"notes":[{"id":"x"}]}', '[]', 'null']) {
      const file = path.join(dir, 'n.json');
      fs.writeFileSync(file, bad);
      const s = createMemoryPolicyStore({ persistFile: file });
      assert.equal(s.listAll().length, 0, bad);
      s.retainNote({ text: 'fresh note stays in memory' });
      assert.equal(fs.readFileSync(file, 'utf8'), bad, `${bad} is kept`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('27. Adding a server beside one written with capital letters still reads back as applied', async () => {
  const gw = fakeGateway({ upstreams: ['http://127.0.0.1:7421', 'https://VPS.Example.org:443/'] });
  const r = await mk(gw).addServer({ url: 'https://new.example.org/cammut' });
  assert.equal(r.ok, true, r.error);
  assert.equal(gw.state.upstreams.length, 3);
});

test('28. The tool runner can save a note in the built-in store, behind the same confirm, and the Observer shows it', async () => {
  const gw = fakeGateway();
  const c = mk(gw, { embedded: createEmbeddedMemoryServer(createMemoryPolicyStore({})) });
  const before = gw.state.calls.length;
  const list = await c.searchTools({ source: 'builtin', query: '' });
  assert.deepEqual(list.tools.map((x) => [x.tool, x.class]), [['hindsight/retain', 'write'], ['hindsight/recall', 'read'], ['hindsight/list_memories', 'read'], ['hindsight/list_tags', 'read']]);
  const args = { content: 'The lab meeting moved to Thursday', tags: ['topic:lab'] };
  const ask = await c.runTool({ source: 'builtin', tool: 'hindsight/retain', arguments: args });
  assert.deepEqual([ask.ok, ask.needs], [false, 'confirm'], 'a write to the built-in store needs the confirm too');
  assert.equal((await c.observe({ source: 'builtin', view: 'memories' })).data.items.length, 0, 'nothing is saved before the confirm');
  const done = await c.runTool({ source: 'builtin', tool: 'hindsight/retain', arguments: args, confirm: true });
  assert.equal(done.ok, true);
  const mem = await c.observe({ source: 'builtin', view: 'memories' });
  assert.equal(mem.data.items.length, 1, 'the Observer shows the saved note');
  assert.equal((await c.runTool({ source: 'builtin', tool: 'hindsight/delete_bank', arguments: {}, confirm: 'hindsight/delete_bank' })).ok, false, 'the built-in store has no delete tool');
  assert.equal((await c.runTool({ source: 'builtin', tool: 'hindsight/retain', arguments: { content: 'my key sk-' + 'x'.repeat(30) }, confirm: true })).ok, false, 'a secret is refused before the store');
  assert.equal(gw.state.calls.length, before, "the built-in store makes no network call");
});

test('29. An address saved with a user name or a query is shown without them and can still be removed', async () => {
  assert.equal(plainServerUrl('https://user:pw' + '@MCP.example/cammut/?key=abc#x'), 'https://mcp.example/cammut');
  assert.equal(plainServerUrl('http://127.0.0.1:7421/'), 'http://127.0.0.1:7421');
  const gw = fakeGateway({ upstreams: ['http://127.0.0.1:7421', 'https://mcp.example/cammut?key=abc'], auth: {} });
  const c = mk(gw);
  const st = await c.state();
  assert.deepEqual(st.servers.map((x) => x.url), ['http://127.0.0.1:7421', 'https://mcp.example/cammut']);
  assert.equal(JSON.stringify(st).includes('key=abc'), false, 'the panel never gets the query');
  const out = await c.removeServer({ url: 'https://mcp.example/cammut' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.servers.map((x) => x.url), ['http://127.0.0.1:7421']);
});
