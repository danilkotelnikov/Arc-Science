// arc-core console rewrite, step 1 (S053, S055): the shared kit (own icons, buttons, rows, switch of views, confirm dialog)
// and the Access page of the Settings dialog, built from the approved prototype.
// The page lists and ends grant records, shows where keys are kept, and lists what the console recorded.
// One test renders it from a real store snapshot, so the fixtures below cannot drift from the backend unseen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createResearchSessionStore } from '../lib/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../ui/panel.js'), 'utf8');
const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) });

function loadPanel(React, globals = {}) {
  let loaded;
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: (m) => { loaded = m; } } }, ...globals });
  return loaded.factory((name) => (name === 'react' ? React : {}));
}
// a still picture: the first state of every component
const still = { createElement, Fragment: 'fragment', useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({ current: null }) };
const mod = loadPanel(still);
const t = (key, vars = {}) => String(mod.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

// turns components into plain element trees, the way React would call them
function expand(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node;
  if (typeof node.type === 'function') return expand(node.type({ ...node.props, children: node.children }));
  return { ...node, children: (node.children || []).map(expand).flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) };
}
// a page that keeps its state between renders, so a test can click and look again
function mount(pick, props, { globals = {}, seed = {} } = {}) {
  const states = { ...seed }, refs = {}; let i = 0, j = 0, effects = [];
  const React = { createElement, Fragment: 'fragment',
    useState: (v) => { const k = i++; if (!(k in states)) states[k] = v; return [states[k], (n) => { states[k] = n; }]; },
    useRef: (v) => { const k = j++; if (!(k in refs)) refs[k] = { current: v }; return refs[k]; },
    useEffect: (fn) => { effects.push(fn); } };
  const m = loadPanel(React, globals);
  const render = () => { i = 0; j = 0; effects = []; const tree = expand({ type: pick(m), props, children: [] }); for (const f of effects) f(); return tree; };
  return { render, states, mod: m };
}
const all = (node, pred, out = []) => { if (node && typeof node === 'object') { if (pred(node)) out.push(node); for (const c of node.children || []) all(c, pred, out); } return out; };
const text = (node) => (node === null || node === undefined ? '' : typeof node !== 'object' ? String(node) : node.type === 'style' ? '' : (node.children || []).map(text).join(' ')).replace(/\s+/g, ' ').trim();
const has = (node, cls) => String(node.props?.className || '').split(/\s+/).includes(cls);
const rowsOf = (tree, kind) => all(tree, (n) => n.props?.['data-row'] === kind);
const dialogOf = (tree) => all(tree, (n) => n.props?.role === 'dialog')[0] || null;
const button = (node, label) => all(node, (n) => n.type === 'button' && text(n) === label)[0];

const DAY = 24 * 3600 * 1000;
const NOW = new Date(2026, 10, 21, 12, 0, 0).getTime(); // local noon, so the shown day is the same in every time zone
const LONG = 'Molecullage figure and structure pack'; // the longest label the store sends today
const data = {
  consents: [
    { appId: 'molecullage-connector', mode: 'Grant for 30 days', scopes: ['read', { odd: 1 }, 'render'], grantedAtMs: NOW, expiresAtMs: NOW + 30 * DAY, secret: 'CANARY-GRANT' },
    { appId: 'stray-tool', mode: 'Single action', scopes: ['read'], grantedAtMs: NOW, expiresAtMs: NOW + 60 * 1000 },
    { appId: 'inspect-connector', mode: 'Grant for 30 days', scopes: ['read'], grantedAtMs: NOW - 31 * DAY, expiresAtMs: NOW - DAY },
  ],
  connectorsDetail: {
    Apps: [{ id: 'molecullage', label: LONG, grants: 1, scopes: ['read', 'render'] }, { id: 'inspect', label: 'Scoped archive inspector', grants: 0, scopes: ['read', 'verify'] }],
    Keys: [
      { id: 'key-cammut', label: 'Gateway and memory settings', ref: '~/.arc/gateway-config.json', state: 'ok', status: 'Memory recall on, prompt caching off.', value: 'CANARY-KEY', secret: 'CANARY-KEY-2' },
      { id: 'key-signing', label: 'Release bundle public key', ref: 'cred://arc-native/release-verify', state: 'idle', status: 'Not set up yet.' },
    ],
    Audit: [{ id: 'a1', kind: 'consent-grant', summary: 'Grant for 30 days for molecullage-connector', atMs: NOW }],
  },
};
const page = (props = {}) => expand({ type: mod.kit.AccessPage, props: { data, t, nowMs: NOW, ...props }, children: [] });

test('the kit carries its own icons: every icon has a shape and no two share one', () => {
  const names = Object.keys(mod.kit.ICONS);
  assert.ok(names.length >= 50, `only ${names.length} icons`);
  for (const n of names) assert.ok(/<(path|circle|rect|ellipse)\b/.test(mod.kit.ICONS[n]), `the icon ${n} is empty`);
  assert.equal(new Set(Object.values(mod.kit.ICONS)).size, names.length, 'two icons share one shape');
  const svg = expand({ type: mod.kit.Ic, props: { n: 'shield' }, children: [] });
  assert.equal(svg.type, 'svg');
  assert.equal(svg.props['aria-hidden'], true);
  assert.equal(svg.props.viewBox, '0 0 16 16');
  assert.ok(svg.props.dangerouslySetInnerHTML.__html.length > 10);
});

test('kit styles keep the sizes of the host app, stay under the kit root, and take every colour from the theme', () => {
  const css = mod.kit.CSS;
  assert.match(css, /\.ak-btn\{[^}]*height:36px[^}]*border-radius:10px/);
  assert.match(css, /\.ak-btn\.sm\{[^}]*height:28px[^}]*border-radius:8px/);
  assert.match(css, /\.ak-seg button\{[^}]*height:28px/);
  assert.match(css, /\.ak-row\{[^}]*padding:14px 0/);
  for (const rule of css.split('}').map((r) => r.trim()).filter(Boolean)) assert.ok(rule.startsWith('[data-arc-kit]'), `a rule leaves the kit root: ${rule.slice(0, 60)}`);
  // An allow-list, so a colour in any other form fails. In each declaration that can carry a colour, and in each kit token,
  // only theme variables, color-mix in srgb, currentColor, transparent, Canvas, numbers and three layout words may stand.
  const allowed = new Set(['var', 'color-mix', 'in', 'srgb', 'currentColor', 'transparent', 'Canvas', 'solid', 'inset', 'none']);
  const stray = (value) => (value.replace(/--[\w-]+/g, ' ').replace(/\d*\.?\d+(px|%|em|rem)?/g, ' ').match(/[A-Za-z#][\w-]*/g) || []).filter((w) => !allowed.has(w));
  let seen = 0;
  for (const m of css.matchAll(/[;{]\s*(--ak-[\w-]+|color|background|border(?:-(?:top|bottom|left|right|color))?|box-shadow|outline(?:-color)?|fill|stroke)\s*:([^;}]*)/g)) {
    seen++;
    assert.deepEqual(stray(m[2]), [], `the declaration "${m[1]}:${m[2].trim()}" holds a colour that is no theme colour`);
  }
  assert.ok(seen >= 25, `the colour check read only ${seen} declarations`);
  // the check itself must catch a colour name, a hex value and a colour function
  for (const bad of ['teal', '#abc', 'oklab(0.5 0.1 0.1)', 'color(display-p3 1 0 0)', 'tomato']) assert.notDeepEqual(stray(bad), [], `the check lets ${bad} through`);
  assert.ok(!css.includes('·'));
});

test('Access, Apps: every active grant has a row, with what it covers, when it ends, and End access', () => {
  const tree = page();
  assert.equal(tree.props['data-arc-settings'], 'access');
  assert.equal(tree.props['data-arc-kit'], 'true');
  assert.equal(text(all(tree, (n) => n.type === 'h1')[0]), 'Access');
  const tabs = all(tree, (n) => n.props?.role === 'tab');
  assert.deepEqual(tabs.map(text), ['Apps', 'Keys', 'Activity']);
  assert.deepEqual(tabs.map((b) => b.props['aria-selected']), [true, false, false]);
  assert.equal(all(tree, (n) => n.props?.role === 'tabpanel')[0].props['aria-labelledby'], tabs[0].props.id);
  const rows = rowsOf(tree, 'app');
  assert.deepEqual(rows.map((r) => text(all(r, (n) => has(n, 'name'))[0])), [LONG, 'Scoped archive inspector', 'stray-tool']);
  const [pack, inspect, stray] = rows;
  // a scope that is no text is left out, so one bad grant cannot break the page
  assert.deepEqual(all(pack, (n) => has(n, 'ak-chip')).map(text), ['read', 'render']);
  assert.equal(text(all(pack, (n) => has(n, 'ak-status'))[0]), 'Until 21 Dec');
  const end = all(pack, (n) => n.type === 'button');
  assert.deepEqual(end.map(text), ['End access']);
  assert.ok(has(end[0], 'outline') && has(end[0], 'sm'));
  assert.equal(end[0].props['aria-label'], `End access for ${LONG}`);
  // the grant of this app ended a day ago: one plain state, no button, no list of rights
  assert.equal(text(all(inspect, (n) => has(n, 'ak-status'))[0]), 'No access');
  assert.equal(all(inspect, (n) => n.type === 'button').length, 0);
  assert.equal(all(inspect, (n) => has(n, 'ak-chip')).length, 0);
  // a grant of no listed app stays visible under its own id; one that ends today shows its time
  assert.ok(has(all(stray, (n) => has(n, 'name'))[0], 'mono'));
  assert.equal(text(all(stray, (n) => has(n, 'ak-status'))[0]), 'Until 21 Nov, 12:01');
  assert.equal(all(stray, (n) => n.type === 'button').length, 1);
  assert.equal(dialogOf(tree), null, 'no question at rest');
  // two app ids that start alike: the grant goes to the longer id, and the shorter app still has its row
  const alike = page({ data: { consents: [{ appId: 'inspect-connector', scopes: [], expiresAtMs: NOW + 5 * DAY }], connectorsDetail: { Apps: [{ id: 'in', label: 'Inbox' }, { id: 'inspect', label: 'Inspector' }] } } });
  assert.deepEqual(rowsOf(alike, 'app').map((r) => [text(all(r, (n) => has(n, 'name'))[0]), text(all(r, (n) => has(n, 'ak-status'))[0])]), [['Inbox', 'No access'], ['Inspector', 'Until 26 Nov']]);
});

test('Access, Apps: End access asks first; Cancel, the close button and Escape end nothing; the action ends only that grant', () => {
  const calls = [];
  const view = mount((m) => m.kit.AccessPage, { data, t, nowMs: NOW, onEnd: (req) => calls.push(JSON.parse(JSON.stringify(req))) });
  const open = (label) => { const row = rowsOf(view.render(), 'app').find((r) => text(all(r, (n) => has(n, 'name'))[0]) === label); button(row, 'End access').props.onClick({ currentTarget: null }); return dialogOf(view.render()); };

  let dialog = open('stray-tool');
  assert.ok(dialog, 'the row button opens the question');
  assert.equal(calls.length, 0, 'the row button ends nothing by itself');
  assert.equal(text(all(dialog, (n) => n.type === 'h2')[0]), 'End access for stray-tool?');
  button(dialog, 'Cancel').props.onClick();
  assert.equal(dialogOf(view.render()), null);
  assert.equal(calls.length, 0, 'Cancel ends nothing');

  dialog = open('stray-tool');
  all(dialog, (n) => n.type === 'button' && n.props['aria-label'] === 'Close')[0].props.onClick();
  assert.equal(dialogOf(view.render()), null);
  assert.equal(calls.length, 0, 'the close button ends nothing');

  dialog = open('stray-tool');
  let stopped = 0;
  dialog.props.onKeyDown({ key: 'Escape', stopPropagation: () => { stopped++; }, nativeEvent: { stopImmediatePropagation: () => { stopped++; } } });
  assert.equal(dialogOf(view.render()), null);
  assert.equal(stopped, 2, 'Escape stays in the question and does not reach the Settings dialog');
  assert.equal(calls.length, 0, 'Escape ends nothing');

  dialog = open('stray-tool');
  const buttons = all(dialog, (n) => n.type === 'button' && text(n));
  assert.deepEqual(buttons.map(text), ['Cancel', 'End access']);
  assert.ok(has(buttons[1], 'primary'));
  buttons[1].props.onClick();
  assert.deepEqual(calls, [{ appId: 'stray-tool', mode: 'Revoke' }], 'one call, for the grant of that row and no other');
  assert.equal(dialogOf(view.render()), null);
});

test('Access: the question names the app, states only what the action does, and fits one line with the longest label', () => {
  const dialog = dialogOf(page({ ending: 'molecullage-connector' }));
  assert.equal(dialog.props['aria-modal'], true);
  assert.equal(dialog.props.tabIndex, -1);
  const title = all(dialog, (n) => n.type === 'h2')[0];
  assert.equal(dialog.props['aria-labelledby'], title.props.id);
  const conseq = all(dialog, (n) => has(n, 'ak-conseq'))[0];
  assert.equal(dialog.props['aria-describedby'], conseq.props.id);
  assert.equal(text(conseq), `The grant for ${LONG} ends now. The app can ask again.`);
  assert.ok(text(conseq).length <= 90, `${text(conseq).length} characters`);
  // a very long app label and a very long grant id are cut, so the line never passes 90 characters
  const wide = 'W'.repeat(120);
  const longApp = { consents: [{ appId: 'pack-connector', scopes: [], expiresAtMs: NOW + DAY * 3 }, { appId: wide, scopes: [], expiresAtMs: NOW + DAY * 3 }], connectorsDetail: { Apps: [{ id: 'pack', label: wide }] } };
  for (const id of ['pack-connector', wide]) {
    const line = text(all(dialogOf(page({ data: longApp, ending: id })), (n) => has(n, 'ak-conseq'))[0]);
    assert.ok(line.length <= 90 && line.length >= 80, `${line.length} characters for a 120 character name`);
  }
  // the app does not yet check a grant before a tool call, so the text must not promise that
  assert.doesNotMatch(text(dialog), /no longer|cannot use|can not use|blocked/i);
});

test('Access: a question whose grant is gone closes by itself', () => {
  const view = mount((m) => m.kit.AccessPage, { data, t, nowMs: NOW, ending: 'inspect-connector' });
  assert.equal(dialogOf(view.render()), null, 'an ended grant opens no question');
  assert.ok(!Object.values(view.states).includes('inspect-connector'), 'the stale id is cleared');
});

test('Access, tabs: a click selects the view', () => {
  const view = mount((m) => m.kit.AccessPage, { data, t, nowMs: NOW });
  all(view.render(), (n) => n.props?.role === 'tab')[1].props.onClick();
  const tree = view.render();
  assert.deepEqual(all(tree, (n) => n.props?.role === 'tab').map((b) => b.props['aria-selected']), [false, true, false]);
  assert.equal(rowsOf(tree, 'key').length, 2);
});

test('Access, Keys: a row says what the entry is and where it is kept; no value and no field shows', () => {
  const tree = page({ tab: 'keys' });
  const rows = rowsOf(tree, 'key');
  assert.equal(rows.length, 2);
  assert.equal(text(all(rows[0], (n) => has(n, 'name'))[0]), 'Gateway and memory settings');
  assert.equal(text(all(rows[0], (n) => has(n, 'sub'))[0]), 'Memory recall on, prompt caching off.');
  assert.equal(text(all(rows[0], (n) => has(n, 'mono'))[0]), '~/.arc/gateway-config.json');
  assert.ok(all(rows[0], (n) => has(n, 'ak-dot'))[0].props.className.includes('on'));
  assert.ok(!all(rows[1], (n) => has(n, 'ak-dot'))[0].props.className.includes('on'));
  assert.equal(all(tree, (n) => n.type === 'input' || n.type === 'textarea').length, 0);
  assert.equal(all(rowsOf(tree, 'key')[0], (n) => n.type === 'button').length, 0, 'a plain list, no dead control');
  // fields that could hold a value never reach the page, in any view
  for (const tab of ['apps', 'keys', 'activity']) assert.ok(!JSON.stringify(page({ tab })).includes('CANARY'), `${tab} carries a field it must not carry, as text or as an attribute`);
  // long lines of the backend are cut to one line of 90 characters
  const long = page({ tab: 'keys', data: { ...data, connectorsDetail: { ...data.connectorsDetail, Keys: [{ id: 'k', label: 'L'.repeat(200), ref: 'r'.repeat(200), state: 'ok', status: 'S'.repeat(200) }] } } });
  for (const leaf of all(long, (n) => has(n, 'name') || has(n, 'sub') || has(n, 'mono')).map(text)) assert.ok(leaf.length <= 90, `a key line has ${leaf.length} characters`);
});

test('Access, Activity: each entry shows what happened, its kind and its time; an empty list says so', () => {
  const rows = rowsOf(page({ tab: 'activity' }), 'activity');
  assert.equal(rows.length, 1);
  assert.ok(text(rows[0]).includes('Grant for 30 days for molecullage-connector'));
  assert.equal(text(all(rows[0], (n) => has(n, 'mono'))[0]), 'consent-grant');
  assert.equal(text(all(rows[0], (n) => has(n, 'sub'))[0]), '21 Nov, 12:00');
  const wordy = page({ tab: 'activity', data: { ...data, connectorsDetail: { ...data.connectorsDetail, Audit: [{ id: 'x', kind: 'k'.repeat(200), summary: 'A'.repeat(200), atMs: NOW }] } } });
  for (const leaf of all(wordy, (n) => has(n, 'mono') || has(n, 'sub')).map(text)) assert.ok(leaf.length <= 90, `an activity line has ${leaf.length} characters`);
  assert.equal(text(all(rowsOf(wordy, 'activity')[0], (n) => has(n, 'name'))[0]).replace(/ k+\u2026$/, '').length, 90);
  const empty = page({ tab: 'activity', data: { ...data, connectorsDetail: { ...data.connectorsDetail, Audit: [] } } });
  assert.equal(text(all(empty, (n) => has(n, 'ak-empty'))[0]), 'Nothing was recorded yet.');
});

test('Access: before the state arrives the page says so, and a failed read offers one retry', () => {
  assert.equal(text(all(page({ data: null }), (n) => n.props?.role === 'status')[0]), 'Loading…');
  let retried = 0;
  const failed = page({ data: null, failed: true, onRefresh: () => { retried++; } });
  assert.equal(text(all(failed, (n) => n.props?.role === 'alert')[0]), 'Could not read the console state.');
  const b = all(failed, (n) => n.type === 'button')[0];
  assert.equal(text(b), 'Try again');
  b.props.onClick();
  assert.equal(retried, 1);
  assert.equal(text(all(page({ actionError: 'The grant could not be ended.' }), (n) => n.props?.role === 'alert')[0]), 'The grant could not be ended.');
});

test('Access on a real store: the three views show what the backend sends, and End access ends the grant in the store', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-access-'));
  try {
    const store = createResearchSessionStore({ arcHome: tmp, live: false });
    const render = (props = {}) => expand({ type: mod.kit.AccessPage, props: { data: store.snapshot(), t, ...props }, children: [] });
    const names = (tree, kind) => rowsOf(tree, kind).map((r) => text(all(r, (n) => has(n, 'name'))[0]));
    assert.deepEqual(names(render(), 'app').slice(0, 2), [LONG, 'Scoped archive inspector']);
    assert.ok(rowsOf(render(), 'app').every((r) => text(all(r, (n) => has(n, 'ak-status'))[0]) === 'No access'));
    const keys = render({ tab: 'keys' });
    assert.deepEqual(names(keys, 'key'), ['Gateway and memory settings', 'Release bundle public key']);
    assert.deepEqual(rowsOf(keys, 'key').map((r) => text(all(r, (n) => has(n, 'mono'))[0])), ['~/.arc/gateway-config.json', 'cred://arc-native/release-verify']);
    // every visible line of the page fits the one-line limit of helper text, on real data
    for (const tab of ['apps', 'keys', 'activity']) for (const leaf of all(render({ tab }), (n) => ['p', 'h1'].includes(n.type) || has(n, 'sub') || has(n, 'name')).map(text)) assert.ok(leaf.length <= 90, `"${leaf}" is longer than one line`);

    // the console tab makes a grant from its "Review access" button; the Access page must show and end exactly that grant
    let asked = null;
    const consoleApps = expand({ type: mod.ConnectorView, props: { connector: 'Apps', detail: store.snapshot().connectorsDetail, grants: 0, onOpenConsent: (req) => { asked = JSON.parse(JSON.stringify(req)); }, t }, children: [] });
    all(consoleApps, (n) => n.props?.['data-connector-consent'] === 'molecullage')[0].props.onClick();
    assert.equal(asked.appId, 'molecullage-connector');
    assert.equal(store.applyConsent({ ...asked, mode: 'Grant for 30 days' }).ok, true);
    // a second grant of the same app, to prove that End access ends one grant and leaves the other
    assert.equal(store.applyConsent({ appId: 'molecullage-batch', scopes: ['read'], mode: 'Grant for 30 days' }).ok, true);
    assert.equal(rowsOf(render(), 'app').filter((r) => button(r, 'End access')).length, 2);
    const sent = [];
    const withGrant = render({ ending: 'molecullage-connector', onEnd: (req) => sent.push(JSON.parse(JSON.stringify(req))) });
    const row = rowsOf(withGrant, 'app')[0];
    assert.match(text(all(row, (n) => has(n, 'ak-status'))[0]), /^Until \d{1,2} \w+$/);
    assert.equal(row.props['data-id'], 'molecullage-connector');
    assert.ok(button(row, 'End access'));
    assert.ok(text(all(dialogOf(withGrant), (n) => has(n, 'ak-conseq'))[0]).length <= 90);
    button(dialogOf(withGrant), 'End access').props.onClick();
    assert.deepEqual(sent, [{ appId: 'molecullage-connector', mode: 'Revoke' }]);
    assert.equal(store.applyConsent(sent[0]).ok, true);
    const left = rowsOf(render(), 'app').filter((r) => button(r, 'End access'));
    assert.deepEqual(left.map((r) => r.props['data-id']), ['molecullage-batch'], 'that grant is gone from the store, and the other grant of the app stays');
    assert.ok(names(render({ tab: 'activity' }), 'activity').some((n) => n.includes('Revoked molecullage-connector')), 'the end of the grant is on record');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('Settings draws the Access page for its Access entry, and End access reaches the backend as one consent action', async () => {
  const posts = [];
  const snapshot = { ok: true, ...data, consents: data.consents.map((g) => ({ ...g, expiresAtMs: Date.now() + 30 * DAY })) };
  const fetch = async (url, init) => { posts.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => (String(url).endsWith('/state') ? snapshot : { ok: true }) }; };
  const tick = () => new Promise((r) => setImmediate(r));
  let access = null;
  // the component that Settings registers for the entry "access"; slot 0 of its state holds the console state
  const view = mount((m) => {
    if (!access) {
      const sections = [];
      const slots = { inject: (name, fn) => { fn(); return () => {}; }, register: (opts, comp) => { if (opts.name === 'settings.section') sections.push({ ...opts, comp }); return () => {}; } };
      m.apply({ effect: () => {}, locale: { register: () => {}, bind: () => t }, slots, inject: () => {} });
      access = sections.find((s) => s.id === 'access');
    }
    return access.comp;
  }, {}, { globals: { fetch }, seed: { 0: snapshot } });
  const first = view.render();
  assert.equal(access.label(), 'Access');
  assert.equal(first.props['data-arc-settings'], 'access');
  assert.equal(first.props['data-arc-kit'], 'true');
  await tick();
  assert.ok(posts.some(([url]) => url === 'api/arc-core/console/state'), 'the page reads the console state');
  button(rowsOf(view.render(), 'app')[0], 'End access').props.onClick({ currentTarget: null });
  button(dialogOf(view.render()), 'End access').props.onClick();
  await tick(); await tick();
  assert.deepEqual(posts.filter(([url]) => url === 'api/arc-core/console/action').map(([, body]) => body), [{ kind: 'consent', appId: 'molecullage-connector', mode: 'Revoke' }]);
});

test('Settings lists Access once, in place of the old Keys page, and the Connectors page keeps only servers', () => {
  const ids = mod.SETTINGS_SECTIONS.map((s) => s.id);
  assert.ok(ids.includes('access'));
  assert.ok(!ids.includes('keys'));
  assert.equal(mod.en['settings.nav.access'], 'Access');
  const conn = expand({ type: mod.SettingsSectionView, props: { section: 'connectors', data, t }, children: [] });
  assert.deepEqual(all(conn, (n) => n.props?.['data-connector-view']).map((n) => n.props['data-connector-view']), ['Servers']);
});

test('texts of the Access page follow the writing rules', () => {
  const keys = Object.keys(mod.en).filter((k) => k.startsWith('access.') || k === 'settings.nav.access');
  assert.ok(keys.length >= 10);
  for (const k of keys) {
    const s = mod.en[k];
    assert.ok(!s.includes('·') && !/!!!/.test(s), k);
    assert.ok(s.length <= 90, `${k} has ${s.length} characters`);
  }
});

test('Access: two grants of one app have a row each, each names its grant, and End access ends only the chosen one', () => {
  const twin = { consents: [{ appId: 'molecullage-connector', scopes: ['read'], expiresAtMs: NOW + 9 * DAY }, { appId: 'molecullage-batch', scopes: ['render'], expiresAtMs: NOW + 9 * DAY }], connectorsDetail: { Apps: [{ id: 'molecullage', label: LONG }] } };
  const calls = [];
  const view = mount((m) => m.kit.AccessPage, { data: twin, t, nowMs: NOW, onEnd: (req) => calls.push(JSON.parse(JSON.stringify(req))) });
  const rows = rowsOf(view.render(), 'app');
  assert.deepEqual(rows.map((r) => r.props['data-id']), ['molecullage-connector', 'molecullage-batch']);
  assert.deepEqual(rows.map((r) => text(all(r, (n) => has(n, 'mono'))[0])), ['molecullage-connector', 'molecullage-batch'], 'each row shows the id of its grant');
  assert.deepEqual(rows.map((r) => button(r, 'End access').props['aria-label']), ['End access for molecullage-connector', 'End access for molecullage-batch']);
  button(rows[1], 'End access').props.onClick({ currentTarget: null });
  const dialog = dialogOf(view.render());
  assert.equal(text(all(dialog, (n) => n.type === 'h2')[0]), 'End access for molecullage-batch?');
  button(dialog, 'End access').props.onClick();
  assert.deepEqual(calls, [{ appId: 'molecullage-batch', mode: 'Revoke' }]);
});

test('Access: the page calls the same hooks before and after its data arrives, as React requires', () => {
  // the app opens the page without data and draws it again when the state arrives; a hook that runs only then breaks React
  const counts = [];
  let n = 0;
  const React = { createElement, Fragment: 'fragment', useState: (v) => { n++; return [v, () => {}]; }, useRef: () => { n++; return { current: null }; }, useEffect: () => { n++; } };
  const m = loadPanel(React);
  for (const props of [{ data: null }, { data: null, failed: true }, { data }, { data, ending: 'stray-tool' }]) { n = 0; m.kit.AccessPage({ t, nowMs: NOW, ...props }); counts.push(n); }
  assert.ok(counts[0] > 0);
  assert.deepEqual(counts, [counts[0], counts[0], counts[0], counts[0]], `hook calls differ between renders: ${counts}`);
});
