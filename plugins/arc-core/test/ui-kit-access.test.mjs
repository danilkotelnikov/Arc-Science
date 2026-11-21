// arc-core console rewrite (S053): the shared kit (own icons, buttons, rows, switch of views, choice list, confirm dialog),
// the Access page (S055) and the Updates page (S057) of the Settings dialog, built from the approved prototype.
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
import { createUpdater } from '../lib/updater.js';

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
    useState: (v) => { const k = i++; if (!(k in states)) states[k] = v; return [states[k], (n) => { states[k] = typeof n === 'function' ? n(states[k]) : n; }]; },
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

// =====================================================================================================
// Settings, Updates (S057): the page of the rewrite on today's updater. Every state below starts from a real updater
// in a throwaway folder with a scripted release list, so the page is tested on what the updater truly reports.
const UENV = { ARC_UPDATE_ALLOW_LOOPBACK: '1' };
const rel = (v, { kit = true, body = '' } = {}) => ({
  tag_name: `v${v}`, draft: false, prerelease: false, html_url: `https://github.com/o/r/releases/tag/v${v}`, body,
  assets: kit ? [{ name: `Arc-Harness-Kit-${v}-win-x64.zip`, browser_download_url: 'http://127.0.0.1:9/kit.zip' }, { name: 'SHA256SUMS.txt', browser_download_url: 'http://127.0.0.1:9/sums.txt' }] : [],
});
async function realState({ installed = '0.6.0', releases = null, offline = false, mode = '', channel = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-updpage-')), home = path.join(root, '.arc');
  try {
    fs.mkdirSync(path.join(home, 'local-plugins', 'arc-core'), { recursive: true });
    if (installed) fs.writeFileSync(path.join(home, 'local-plugins', 'arc-core', 'package.json'), JSON.stringify({ name: 'arc-core', version: installed }));
    const fetchImpl = async () => { if (offline) throw new TypeError('fetch failed'); return new Response(JSON.stringify(releases), { status: 200 }); };
    const u = createUpdater({ home, gatewayDir: path.join(root, 'gw'), env: UENV, api: 'http://127.0.0.1:9', repo: 'o/r', fetchImpl, now: () => NOW });
    if (mode) u.setMode(mode);
    if (channel) u.setChannel(channel);
    if (releases || offline) await u.check();
    return JSON.parse(JSON.stringify(u.getState()));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
// a later state of the same updater: only fields the updater really sends may change
const derive = (base, over) => { for (const k of Object.keys(over)) assert.ok(k in base, `the updater state has no field ${k}`); return { ...base, ...over }; };
const upage = (info, props = {}) => expand({ type: mod.kit.UpdatesPage, props: { info, t, ...props }, children: [] });
const rowOf = (tree, kind) => rowsOf(tree, kind)[0] || null;
const alertsOf = (tree) => all(tree, (n) => n.props?.role === 'alert');
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b)); // values made inside the panel come from another realm
const updaterSource = fs.readFileSync(path.join(here, '../lib/updater.js'), 'utf8');

test('Updates: before the first check the page names the installed version and offers Check now', async () => {
  const fresh = await realState();
  assert.equal(fresh.latest, null);
  const sent = [];
  const tree = upage(fresh, { onAction: (a) => sent.push(a) });
  assert.equal(tree.props['data-arc-settings'], 'updates');
  assert.equal(tree.props['data-arc-kit'], 'true');
  assert.equal(text(all(tree, (n) => n.type === 'h1')[0]), 'Updates');
  const parts = rowOf(tree, 'parts');
  assert.equal(text(all(parts, (n) => has(n, 'sub'))[0]), 'Installed 0.6.0');
  assert.match(text(parts), /Not checked yet/);
  assert.equal(button(tree, 'Update now'), undefined);
  assert.equal(rowOf(tree, 'earlier'), null, 'no earlier version is kept yet');
  assert.equal(rowOf(tree, 'notes'), null);
  assert.equal(alertsOf(tree).length, 0);
  assert.match(text(rowOf(tree, 'mode')), /When a new version appears/);
  assert.equal(text(all(rowOf(tree, 'mode'), (n) => n.props?.['aria-haspopup'] === 'listbox')[0]), 'Tell me');
  button(tree, 'Check now').props.onClick();
  same(sent, [{ kind: 'check' }]);
  // a computer where the installed version cannot be read
  const unknown = await realState({ installed: '' });
  assert.equal(unknown.installed, '0.0.0');
  assert.equal(text(all(rowOf(upage(unknown), 'parts'), (n) => has(n, 'sub'))[0]), 'Installed version unknown');
});

test('Updates: a newer release shows Needs update; Update now sends one install action; What changed shows the notes as plain text', async () => {
  const body = 'Fixes <b>one</b> thing.\n- second line';
  const ready = await realState({ releases: [rel('0.6.0'), rel('0.6.1', { body })] });
  assert.equal(ready.available && ready.installable, true, 'the real updater offers the release');
  const sent = [];
  const view = mount((m) => m.kit.UpdatesPage, { info: ready, t, onAction: (a) => sent.push(a) });
  let tree = view.render();
  const parts = rowOf(tree, 'parts');
  assert.equal(text(all(parts, (n) => has(n, 'sub'))[0]), 'Installed 0.6.0, newest 0.6.1, checked 21 Nov, 12:00');
  assert.match(text(parts), /Needs update/);
  button(parts, 'Update now').props.onClick();
  same(sent, [{ kind: 'install' }]);
  const fold = all(rowOf(tree, 'notes'), (n) => n.type === 'button')[0];
  assert.equal(text(fold), 'What changed in 0.6.1');
  assert.equal(fold.props['aria-expanded'], false);
  assert.equal(all(tree, (n) => has(n, 'ak-notes')).length, 0);
  fold.props.onClick();
  tree = view.render();
  assert.equal(all(rowOf(tree, 'notes'), (n) => n.type === 'button')[0].props['aria-expanded'], true);
  const notes = all(tree, (n) => has(n, 'ak-notes'))[0];
  assert.deepEqual(notes.children, [body], 'the notes are one text node, so their markup stays text');
  assert.equal(notes.props.dangerouslySetInnerHTML, undefined);
});

test('Updates: a release with no files, no release at all, the newest version and a failed check each say so', async () => {
  const cases = [
    [await realState({ releases: [rel('0.6.1', { kit: false })] }), 'No installable files yet'],
    [await realState({ releases: [] }), 'No release found'],
    [await realState({ releases: [rel('0.6.0')] }), 'Up to date'],
  ];
  for (const [info, word] of cases) {
    const tree = upage(info);
    assert.equal(text(all(rowOf(tree, 'parts'), (n) => has(n, 'ak-status'))[0]), word);
    assert.equal(button(tree, 'Update now'), undefined, `${word}: nothing to install`);
    assert.equal(alertsOf(tree).length, 0, `${word}: no error`);
  }
  assert.equal(all(rowOf(upage(cases[2][0]), 'parts'), (n) => has(n, 'ak-dot') && has(n, 'on')).length, 1, 'only the newest version carries the filled mark');
  assert.equal(all(rowOf(upage(cases[0][0]), 'parts'), (n) => has(n, 'ak-dot') && has(n, 'on')).length, 0);
  const failed = await realState({ offline: true });
  assert.equal(failed.phase, 'failed');
  const tree = upage(failed);
  assert.match(text(alertsOf(tree)[0]), /^Could not reach GitHub/);
  assert.equal(button(tree, 'Check now').props.disabled, false, 'a failed check can run again');
  // a check that runs now
  const checking = upage(derive(failed, { phase: 'checking', message: '', failed: false }));
  assert.equal(text(all(rowOf(checking, 'parts'), (n) => has(n, 'ak-status'))[0]), 'Checking');
  assert.equal(alertsOf(checking).length, 0);
});

test('Updates: while an update runs, each real step has a word and a place on the progress bar, and the buttons wait', async () => {
  const ready = await realState({ releases: [rel('0.6.1')] });
  const steps = ['downloading', 'verifying', 'staging', 'installing', 'testing'];
  const words = new Set();
  steps.forEach((ph, i) => {
    const tree = upage(derive(ready, { busy: true, phase: ph, message: `Step ${ph}`, hasBackup: true, backupVersion: '0.5.9' }));
    const bar = all(tree, (n) => n.props?.role === 'progressbar')[0];
    assert.equal(bar.props['aria-valuemin'], 0);
    assert.equal(bar.props['aria-valuemax'], steps.length);
    assert.equal(bar.props['aria-valuenow'], i + 1);
    assert.equal(bar.props['aria-label'], 'Update progress');
    const word = text(all(rowOf(tree, 'parts'), (n) => has(n, 'ak-status'))[0]);
    assert.ok(word.length > 3, `the step ${ph} has no word`);
    words.add(word);
    assert.equal(button(tree, 'Update now'), undefined);
    assert.equal(button(tree, 'Check now').props.disabled, true);
    assert.equal(button(tree, 'Roll back').props.disabled, true);
  });
  assert.equal(words.size, steps.length, 'each step has its own word');
  // every step the updater names has a look on the page
  const named = new Set([...updaterSource.matchAll(/phase\('([a-z-]+)'/g)].map((m) => m[1]));
  assert.ok(named.size >= 7, `the updater source names only ${named.size} steps`);
  for (const ph of named) assert.ok(['idle', 'checking', 'failed', 'rolled-back', 'done', ...steps].includes(ph), `the page has no look for the step ${ph}`);
  // an action of the page that has not answered yet also holds the buttons
  const waiting = upage(ready, { pending: true });
  assert.equal(button(waiting, 'Check now').props.disabled, true);
  assert.equal(button(waiting, 'Update now'), undefined);
});

test('Updates: after an update the page asks for a restart and keeps the earlier version; Roll back asks first', async () => {
  const base = await realState({ installed: '0.6.1', releases: [rel('0.6.1')] });
  const info = derive(base, { phase: 'done', message: 'Updated to 0.6.1. Restart Arc Harness to use it.', restartNeeded: true, healthy: true, hasBackup: true, backupVersion: '0.6.0' });
  const sent = [];
  const view = mount((m) => m.kit.UpdatesPage, { info, t, onAction: (a) => sent.push(a) });
  let tree = view.render();
  assert.match(text(rowOf(tree, 'parts')), /Restart to finish/);
  assert.equal(all(tree, (n) => n.type === 'button' && /restart/i.test(text(n))).length, 0, 'the app never closes itself, so no button says it does');
  assert.equal(alertsOf(tree).length, 0);
  const earlier = () => rowOf(view.render(), 'earlier');
  assert.match(text(earlier()), /Version before the last update/);
  assert.equal(text(all(earlier(), (n) => has(n, 'sub'))[0]), '0.6.0');
  assert.equal(dialogOf(tree), null);
  const ask = () => button(earlier(), 'Roll back').props.onClick({ currentTarget: null });
  ask();
  const dlg = dialogOf(view.render());
  assert.equal(text(all(dlg, (n) => n.type === 'h2')[0]), 'Roll back to 0.6.0?');
  const line = text(all(dlg, (n) => has(n, 'ak-conseq'))[0]);
  assert.ok(line.length <= 90, `the question line has ${line.length} characters`);
  assert.match(line, /0\.6\.0/);
  assert.match(line, /restart/);
  // the line promises a restart, and the updater does ask for one after a roll back
  assert.match(updaterSource, /async function rollback\(\)[\s\S]*?mem\.restartNeeded = true/);
  button(dlg, 'Cancel').props.onClick();
  assert.equal(dialogOf(view.render()), null);
  ask();
  all(dialogOf(view.render()), (n) => n.type === 'button' && n.props['aria-label'] === 'Close')[0].props.onClick();
  assert.equal(dialogOf(view.render()), null);
  ask();
  let stopped = 0;
  dialogOf(view.render()).props.onKeyDown({ key: 'Escape', stopPropagation: () => { stopped++; }, nativeEvent: { stopImmediatePropagation: () => { stopped++; } } });
  assert.equal(stopped, 2, 'Escape closes the question and not the Settings dialog behind it');
  assert.equal(dialogOf(view.render()), null);
  assert.equal(sent.length, 0, 'nothing was rolled back so far');
  ask();
  button(dialogOf(view.render()), 'Roll back').props.onClick();
  same(sent, [{ kind: 'rollback', version: '0.6.0' }], 'the action names the version the question named');
  assert.equal(dialogOf(view.render()), null);
});

test('Updates: a failed update shows one line with the whole message one click away; a roll back by the user is no error', async () => {
  const ready = await realState({ releases: [rel('0.6.1')] });
  const long = `Files of arc-hoh are in use, so nothing was changed. Close the app and try again. ${'x'.repeat(200)}`;
  const view = mount((m) => m.kit.UpdatesPage, { info: derive(ready, { phase: 'failed', failed: true, message: long }), t });
  let tree = view.render();
  assert.equal(alertsOf(tree).length, 1);
  assert.ok(text(alertsOf(tree)[0]).length <= 90);
  assert.match(text(rowOf(tree, 'parts')), /Needs update/, 'the update can be tried again');
  const whole = all(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'The whole message')[0];
  whole.props.onClick();
  tree = view.render();
  assert.ok(all(tree, (n) => n.props?.role === 'note').some((n) => text(n) === long), 'the hint holds the whole message');
  // a short message needs no second place
  assert.equal(all(upage(derive(ready, { phase: 'failed', failed: true, message: 'Short.' })), (n) => n.props?.['aria-label'] === 'The whole message').length, 0);
  // the updater put the old files back after a failed swap: an error
  const undone = upage(derive(ready, { phase: 'rolled-back', failed: true, message: 'Bad kit. The old files were put back (rolled back).' }));
  assert.match(text(alertsOf(undone)[0]), /old files were put back/);
  // the same failure while an earlier update still waits for its restart: the error must not hide behind the restart note
  const both = upage(derive(ready, { phase: 'rolled-back', failed: true, restartNeeded: true, message: 'Bad kit. The old files were put back (rolled back).' }));
  assert.match(text(alertsOf(both)[0]), /old files were put back/);
  // the user rolled back: a restart is due, and nothing went wrong
  const back = upage(derive(ready, { phase: 'rolled-back', failed: false, message: 'Back to 0.6.0. Restart Arc Harness to use it.', restartNeeded: true, healthy: true }));
  assert.equal(alertsOf(back).length, 0);
  assert.match(text(rowOf(back, 'parts')), /Restart to finish/);
  assert.equal(button(back, 'Update now'), undefined, 'no second swap before the restart');
  // files that could not all be put back
  const broken = upage(derive(ready, { phase: 'failed', failed: true, message: 'The rollback was not complete: arc-core', healthy: false }));
  assert.match(text(rowOf(broken, 'parts')), /Not complete/);
  // files that are not complete stay marked after the next check and beside a restart that is due
  assert.match(text(rowOf(upage(derive(ready, { healthy: false, restartNeeded: true })), 'parts')), /Not complete/);
  assert.equal(alertsOf(broken).length, 1);
  // a refusal of the last action
  assert.equal(text(alertsOf(upage(ready, { error: 'An update is already running.' }))[0]), 'An update is already running.');
  // programs the update could not find on this computer
  const left = mount((m) => m.kit.UpdatesPage, { info: derive(ready, { skippedBinaries: ['arc-validators.exe', 'n'.repeat(300)] }), t });
  const mark = all(left.render(), (n) => n.type === 'button' && n.props['aria-label'] === 'Programs that were not replaced')[0];
  mark.props.onClick();
  const note = all(left.render(), (n) => n.props?.role === 'note').map(text).find((s) => s.includes('arc-validators.exe'));
  assert.ok(note && note.length <= 200, 'the note names the programs and stays short');
  assert.equal(all(upage(ready), (n) => n.props?.['aria-label'] === 'Programs that were not replaced').length, 0);
});

test('Updates: the choice for new versions has three options; Install it asks first and says only what the updater does', async () => {
  const base = await realState({ releases: [rel('0.6.1')] });
  assert.equal(base.mode, 'notify');
  const sent = [];
  const view = mount((m) => m.kit.UpdatesPage, { info: base, t, onAction: (a) => sent.push(a) });
  const trigger = () => all(rowOf(view.render(), 'mode'), (n) => n.props?.['aria-haspopup'] === 'listbox')[0];
  const options = () => all(view.render(), (n) => n.props?.role === 'option');
  assert.equal(trigger().props['aria-expanded'], false);
  assert.equal(options().length, 0);
  trigger().props.onClick();
  assert.equal(trigger().props['aria-expanded'], true);
  assert.deepEqual(options().map(text), ['Do nothing', 'Tell me', 'Install it']);
  assert.deepEqual(options().map((o) => o.props['aria-selected']), [false, true, false]);
  options()[1].props.onClick({ currentTarget: null });
  assert.equal(sent.length, 0, 'the choice that is already set sends nothing');
  trigger().props.onClick();
  options()[0].props.onClick({ currentTarget: null });
  same(sent, [{ kind: 'mode', mode: 'off' }]);
  assert.equal(options().length, 0, 'the list closes after a choice');
  trigger().props.onClick();
  options()[2].props.onClick({ currentTarget: null });
  assert.equal(sent.length, 1, 'Install it waits for the answer');
  const dlg = dialogOf(view.render());
  assert.equal(text(all(dlg, (n) => n.type === 'h2')[0]), 'Install new versions without asking?');
  const line = text(all(dlg, (n) => has(n, 'ak-conseq'))[0]);
  assert.ok(line.length <= 90);
  assert.match(line, /installs by itself/);
  assert.match(line, /next start/);
  // what the line says is what the updater does in this mode: it installs, and the new parts wait for a restart
  assert.match(updaterSource, /async function tick\(\)[\s\S]*?await install\(\{ auto: true \}\)/);
  assert.match(updaterSource, /mem\.healthy = true; mem\.restartNeeded = true;/);
  button(dlg, 'Cancel').props.onClick();
  assert.equal(sent.length, 1);
  assert.equal(dialogOf(view.render()), null);
  trigger().props.onClick();
  options()[2].props.onClick({ currentTarget: null });
  button(dialogOf(view.render()), 'Install without asking').props.onClick();
  same(sent[1], { kind: 'mode', mode: 'auto' });
  assert.equal(dialogOf(view.render()), null);
  // the three choices are the three modes the updater accepts
  for (const [id, word] of [['off', 'Do nothing'], ['notify', 'Tell me'], ['auto', 'Install it']]) {
    const st = await realState({ mode: id });
    assert.equal(st.mode, id);
    assert.equal(text(all(rowOf(upage(st), 'mode'), (n) => n.props?.['aria-haspopup'] === 'listbox')[0]), word);
  }
  // a version that automatic install leaves out is named, and only in that mode
  const auto = await realState({ mode: 'auto', releases: [rel('0.6.1')] });
  const skipped = { version: '0.6.1', reason: 'rolled-back', at: new Date(NOW).toISOString() };
  const sub = (info) => text(all(rowOf(upage(info), 'mode'), (n) => has(n, 'sub'))[0]);
  assert.match(sub(derive(auto, { skipped })), /^Skips 0\.6\.1/);
  assert.ok(sub(derive(auto, { skipped })).length <= 90);
  assert.equal(sub(derive(base, { skipped })), '');
  assert.equal(sub(auto), '');
  assert.match(updaterSource, /if \(auto && sk && sk\.version === toVersion\) return/);
});

test('the kit choice list: a labelled button and a list; Escape closes only the list; arrows move; focus that leaves closes it', () => {
  const picked = [];
  const view = mount((m) => m.kit.Pick, { label: 'Kind', value: 'b', options: [['a', 'First'], ['b', 'Second'], ['c', 'Third']], onChange: (v) => picked.push(v) });
  const btn = () => all(view.render(), (n) => n.props?.['aria-haspopup'] === 'listbox')[0];
  const list = () => all(view.render(), (n) => n.props?.role === 'listbox')[0] || null;
  assert.equal(btn().props['aria-label'], 'Kind: Second');
  assert.equal(text(btn()), 'Second');
  assert.equal(list(), null);
  const stops = { n: 0 }, focus = { n: 0 };
  const key = (k, extra = {}) => view.render().props.onKeyDown({ key: k, preventDefault: () => {}, stopPropagation: () => { stops.n++; }, nativeEvent: { stopImmediatePropagation: () => { stops.n++; } }, currentTarget: { querySelector: () => ({ focus: () => { focus.n++; } }), querySelectorAll: () => [], ownerDocument: {} }, ...extra });
  key('Escape');
  assert.equal(stops.n, 0, 'a closed list leaves Escape to the Settings dialog');
  btn().props.onClick();
  assert.equal(list().props['aria-label'], 'Kind');
  assert.equal(all(list(), (n) => n.props?.role === 'option' && n.props['aria-selected'] === true)[0].props.autoFocus, true, 'the list opens on the chosen option');
  key('Escape');
  assert.equal(stops.n, 2);
  assert.equal(focus.n, 1, 'the focus goes back to the button');
  assert.equal(list(), null);
  key('ArrowDown');
  assert.ok(list(), 'the arrow key opens the list');
  const made = ['a', 'b', 'c'].map((id) => ({ id, focused: 0, focus() { this.focused++; } }));
  const at = (i) => ({ currentTarget: { querySelector: () => null, querySelectorAll: () => made, ownerDocument: { activeElement: made[i] } } });
  key('ArrowDown', at(1)); assert.equal(made[2].focused, 1);
  key('ArrowDown', at(2)); assert.equal(made[0].focused, 1, 'the last option leads to the first');
  key('ArrowUp', at(0)); assert.equal(made[2].focused, 2, 'the first option leads to the last');
  view.render().props.onBlur({ currentTarget: { contains: () => true }, relatedTarget: {} });
  assert.ok(list(), 'focus inside the list keeps it open');
  view.render().props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null });
  assert.equal(list(), null);
  btn().props.onClick();
  all(list(), (n) => n.props?.role === 'option')[2].props.onClick({ currentTarget: null });
  assert.deepEqual(picked, ['c']);
});

test('Updates: before the state arrives the page says so; a refused read shows the sentence of the server and one retry', () => {
  const loading = upage(null);
  assert.equal(loading.props['data-arc-settings'], 'updates');
  assert.match(text(all(loading, (n) => n.props?.role === 'status')[0]), /Loading/);
  assert.equal(rowsOf(loading, 'parts').length, 0);
  let again = 0;
  const off = upage(null, { error: 'Updates are not available in this build.', onRefresh: () => { again++; } });
  assert.equal(text(alertsOf(off)[0]), 'Updates are not available in this build.');
  button(off, 'Try again').props.onClick();
  assert.equal(again, 1);
  assert.equal(rowsOf(off, 'parts').length, 0);
  assert.equal(button(off, 'Check now'), undefined);
});

test('Settings draws the new page for its Updates entry: it reads the update state, and Check now reaches the backend as one action', async () => {
  const state = { ok: true, ...(await realState({ releases: [rel('0.6.1')] })) };
  const posts = [];
  const fetch = async (url, init) => { posts.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => (String(url).endsWith('/state') ? state : { ok: true }) }; };
  const tick = () => new Promise((r) => setImmediate(r));
  let entry = null;
  // the component that Settings registers for the entry "updates"; slot 0 of its state holds the update state
  const view = mount((m) => {
    if (!entry) {
      const sections = [];
      const slots = { inject: (name, fn) => { fn(); return () => {}; }, register: (opts, comp) => { if (opts.name === 'settings.section') sections.push({ ...opts, comp }); return () => {}; } };
      m.apply({ effect: () => {}, locale: { register: () => {}, bind: () => t }, slots, inject: () => {} });
      entry = sections.find((s) => s.id === 'updates');
    }
    return entry.comp;
  }, {}, { globals: { fetch, setInterval: () => 0, clearInterval: () => {} }, seed: { 0: state } });
  const first = view.render();
  assert.equal(entry.label(), 'Updates');
  assert.equal(first.props['data-arc-settings'], 'updates');
  assert.equal(first.props['data-arc-kit'], 'true');
  assert.equal(all(first, (n) => n.props?.['data-connector-view'] === 'Updates').length, 0, 'Settings no longer draws the view of the console tab');
  await tick();
  assert.ok(posts.some(([url]) => url === 'api/arc-core/update/state'), 'the page reads the update state');
  button(view.render(), 'Check now').props.onClick();
  await tick(); await tick();
  same(posts.filter(([url]) => url === 'api/arc-core/update/action').map(([, body]) => body), [{ kind: 'check' }]);
  // the console tab keeps its own view on the same state
  const tab = expand({ type: mod.UpdatesView, props: { info: state, t }, children: [] });
  assert.equal(tab.props['data-connector-view'], 'Updates');
});

test('Updates: the page calls the same hooks in every state and with every view open, as React requires', async () => {
  const ready = await realState({ releases: [rel('0.6.1', { body: 'Notes.' })] });
  const kept = derive(ready, { hasBackup: true, backupVersion: '0.6.0' });
  let n = 0;
  const React = { createElement, Fragment: 'fragment', useState: (v) => { n++; return [v, () => {}]; }, useRef: () => { n++; return { current: null }; }, useEffect: () => { n++; } };
  const m = loadPanel(React);
  const views = [
    { info: null }, { info: null, error: 'Refused.' }, { info: ready }, { info: ready, error: 'Refused.' }, { info: ready, pending: true },
    { info: derive(ready, { busy: true, phase: 'installing' }) }, { info: derive(kept, { restartNeeded: true, phase: 'done' }) },
    { info: derive(ready, { phase: 'failed', failed: true, message: 'm'.repeat(200) }) }, { info: ready, asking: 'auto' }, { info: kept, asking: 'rollback' }, { info: ready, open: true },
  ];
  const counts = views.map((props) => { n = 0; m.kit.UpdatesPage({ t, ...props }); return n; });
  assert.ok(counts[0] > 0);
  assert.deepEqual(counts, counts.map(() => counts[0]), `hook calls differ between renders: ${counts}`);
});

test('texts of the Updates page follow the writing rules', () => {
  const keys = Object.keys(mod.en).filter((k) => k.startsWith('upd.'));
  assert.ok(keys.length >= 25, `only ${keys.length} texts`);
  for (const k of keys) {
    const s = mod.en[k];
    assert.ok(/^[A-Z]/.test(s), `${k} starts with a capital letter`);
    assert.ok(!s.includes('·') && !/!|, not /.test(s), k);
    // a hint may hold more; every visible line fits one line, also with a version number in it
    if (!k.endsWith('.hint')) assert.ok(s.replace(/\{\w+\}/g, '00.00.00').length <= 90, `${k} has ${s.length} characters`);
  }
  // untrusted text of a release cannot stretch a line: the version comes cut, the notes are capped by the updater
  const odd = upage({ installed: '9'.repeat(300), latest: '8'.repeat(300), available: true, installable: true, reason: '', releaseUrl: '', notes: 'n', checkedAt: null, phase: 'idle', message: '', busy: false, mode: 'notify', intervalHours: 12, hasBackup: true, backupVersion: '7'.repeat(300), skipped: null, skippedBinaries: [], restartNeeded: false, healthy: null });
  for (const leaf of all(odd, (n) => has(n, 'sub') || has(n, 'ak-status') || n.type === 'button').map(text)) assert.ok(leaf.length <= 90, `a line has ${leaf.length} characters`);
});

test('Updates: an update that starts closes an open Roll back question, since the updater refuses a roll back while it runs', async () => {
  const ready = await realState({ releases: [rel('0.6.1')] });
  const sent = [];
  const view = mount((m) => m.kit.UpdatesPage, { info: derive(ready, { hasBackup: true, backupVersion: '0.6.0', busy: true, phase: 'downloading' }), t, asking: 'rollback', onAction: (a) => sent.push(a) });
  assert.equal(dialogOf(view.render()), null, 'no question offers Roll back while an update runs');
  assert.equal(view.states[0], null);
  assert.match(updaterSource, /async function rollback\(\) \{\s+if \(mem\.busy \|\| !lock\(\)\) return \{ ok: false/);
});

test('Updates: an earlier version that nobody could read is not shown as a number', async () => {
  const ready = await realState({ releases: [rel('0.6.1')] });
  const tree = upage(derive(ready, { hasBackup: true, backupVersion: '0.0.0' }), { asking: 'rollback' });
  assert.equal(text(all(rowOf(tree, 'earlier'), (n) => has(n, 'sub'))[0]), 'Version unknown');
  const dlg = dialogOf(tree);
  assert.equal(text(all(dlg, (n) => n.type === 'h2')[0]), 'Roll back to the earlier version?');
  assert.ok(!text(dlg).includes('0.0.0'));
  assert.ok(text(all(dlg, (n) => has(n, 'ak-conseq'))[0]).length <= 90);
});

test('Updates: after a question closes, the focus goes to a control that can take it', async () => {
  const ready = await realState({ releases: [rel('0.6.1')] });
  const pick = { isConnected: true, n: 0, focus() { this.n++; } };
  const from = { isConnected: true, n: 0, focus() { this.n++; }, closest: () => ({ querySelector: (sel) => (sel === '.ak-dd' ? pick : null) }) };
  const view = mount((m) => m.kit.UpdatesPage, { info: derive(ready, { hasBackup: true, backupVersion: '0.6.0' }), t, onAction: () => {} }, { globals: { setTimeout: (fn) => fn() } });
  const ask = () => button(rowOf(view.render(), 'earlier'), 'Roll back').props.onClick({ currentTarget: from });
  ask();
  button(dialogOf(view.render()), 'Cancel').props.onClick({});
  assert.deepEqual([from.n, pick.n], [1, 0], 'Cancel gives the focus back to the Roll back button');
  ask();
  button(dialogOf(view.render()), 'Roll back').props.onClick({});
  assert.deepEqual([from.n, pick.n], [1, 1], 'after Roll back its button is off, so the choice list takes the focus');
});

test('Updates: release notes are a wrapped text of limited height, so a long line cannot stretch the page', () => {
  assert.match(mod.kit.CSS, /\.ak-notes\{[^}]*max-height:240px;overflow:auto[^}]*white-space:pre-wrap;overflow-wrap:anywhere/);
  const tree = upage({ installed: '0.6.0', latest: '0.6.1', available: true, installable: true, notes: 'x'.repeat(5000), phase: 'idle', mode: 'notify', skippedBinaries: [] }, { open: true });
  const cut = all(tree, (n) => has(n, 'ak-notes'))[0].children[0];
  assert.equal(cut.length, 1200);
  assert.ok(cut.endsWith('\u2026'), 'a cut text says so');
  const pair = upage({ installed: '0.6.0', latest: '0.6.1', notes: 'x'.repeat(1198) + '\u{1F600}' + 'y', phase: 'idle', mode: 'notify' }, { open: true });
  assert.ok(!/[\uD800-\uDBFF]\u2026$/.test(all(pair, (n) => has(n, 'ak-notes'))[0].children[0]), 'the cut does not split a character');
  const short = upage({ installed: '0.6.0', latest: '0.6.1', notes: 'Short notes.', phase: 'idle', mode: 'notify' }, { open: true });
  assert.deepEqual(all(short, (n) => has(n, 'ak-notes'))[0].children, ['Short notes.']);
});

test('Updates: a Roll back question whose kept version is gone closes by itself', async () => {
  const ready = await realState({ releases: [rel('0.6.1')] });
  assert.equal(ready.hasBackup, false);
  const view = mount((m) => m.kit.UpdatesPage, { info: ready, t, asking: 'rollback' });
  assert.equal(dialogOf(view.render()), null);
  assert.equal(view.states[0], null, 'the question is closed, so it cannot come back with a later kept version');
});

test('Updates: a hint at the start of a line opens toward the page, and a hint at the end of a row opens back into it', async () => {
  const ready = await realState({ releases: [rel('0.6.1')] });
  const info = derive(ready, { phase: 'failed', failed: true, message: 'm'.repeat(200), restartNeeded: false, hasBackup: true, backupVersion: '0.6.0', skippedBinaries: ['arc-validators.exe'] });
  const side = (label, pick = 0) => {
    const view = mount((m) => m.kit.UpdatesPage, { info, t });
    all(view.render(), (n) => n.type === 'button' && n.props['aria-label'] === label)[pick].props.onClick();
    const note = all(view.render(), (n) => n.props?.role === 'note')[0];
    return 'left' in note.props.style ? 'left' : 'right';
  };
  assert.equal(side('The whole message'), 'left', 'the hint under the title starts at the page edge, so its note goes right');
  assert.equal(side('Programs that were not replaced'), 'left');
  // the four hints named About this page, in the order of the rows: channel, parts, Roll back, the choice for new versions
  assert.equal(side('About this page', 0), 'left', 'the hint beside the word Channel');
  assert.equal(side('About this page', 1), 'left', 'the hint beside the name of the parts');
  assert.equal(side('About this page', 2), 'right', 'the hint beside Roll back, at the end of its row');
  assert.equal(side('About this page', 3), 'left', 'the hint beside the choice for new versions');
});

test('Updates: the buttons stay held until the page has the state that follows an action', async () => {
  const state = { ok: true, ...(await realState({ releases: [rel('0.6.1')] })) };
  const seen = [];
  let acted = false, view = null;
  const fetch = async (url) => {
    if (String(url).endsWith('/action')) acted = true;
    else if (acted) seen.push(view.states[3]); // slot 3 of the shared hook is its waiting mark
    return { ok: true, json: async () => (String(url).endsWith('/state') ? state : { ok: true }) };
  };
  const tick = () => new Promise((r) => setImmediate(r));
  let entry = null;
  view = mount((m) => {
    if (!entry) {
      const sections = [];
      const slots = { inject: (name, fn) => { fn(); return () => {}; }, register: (opts, comp) => { if (opts.name === 'settings.section') sections.push({ ...opts, comp }); return () => {}; } };
      m.apply({ effect: () => {}, locale: { register: () => {}, bind: () => t }, slots, inject: () => {} });
      entry = sections.find((s) => s.id === 'updates');
    }
    return entry.comp;
  }, {}, { globals: { fetch, setInterval: () => 0, clearInterval: () => {} }, seed: { 0: state } });
  button(view.render(), 'Check now').props.onClick();
  await tick(); await tick(); await tick();
  assert.ok(seen.length >= 1, 'the state was read again after the action');
  assert.equal(seen[0], true, 'the waiting mark is still set while the fresh state is on its way');
  assert.equal(view.states[3], false, 'and it is cleared afterwards');
});

// ---- the channel row (S058)
const chanButtons = (tree) => all(rowOf(tree, 'channel'), (n) => n.type === 'button' && n.props['aria-pressed'] !== undefined);

test('Updates, channel: three pressed buttons, the chosen one marked; Release and Beta switch at once', async () => {
  const onRelease = await realState({ releases: [rel('0.6.1'), rel('0.7.0-beta.1')] });
  assert.equal(onRelease.channel, 'release');
  assert.equal(onRelease.latest, '0.6.1', 'the real updater keeps the beta away from Release');
  const sent = [];
  const tree = upage(onRelease, { onAction: (a) => sent.push(a) });
  const row = rowOf(tree, 'channel');
  assert.equal(rowsOf(tree, 'channel').length, 1);
  assert.equal(all(tree, (n) => n.props?.['data-row'])[0].props['data-row'], 'channel', 'the channel is the first row, as in the approved screen');
  const group = all(row, (n) => n.props?.role === 'group')[0];
  assert.equal(group.props['aria-label'], 'Channel');
  assert.deepEqual(chanButtons(tree).map(text), ['Release', 'Beta', 'Alpha']);
  assert.deepEqual(chanButtons(tree).map((b) => b.props['aria-pressed']), [true, false, false]);
  assert.equal(all(row, (n) => n.props?.role === 'tab' || n.props?.role === 'tablist').length, 0, 'a setting is no set of tabs');
  assert.equal(text(all(row, (n) => has(n, 'sub'))[0]), 'Tested versions.');
  chanButtons(tree)[0].props.onClick({ currentTarget: null });
  assert.equal(sent.length, 0, 'the channel that is already set sends nothing');
  chanButtons(tree)[1].props.onClick({ currentTarget: null });
  same(sent, [{ kind: 'channel', channel: 'beta' }]);
  // on Beta the real updater offers the beta, and the row says what Beta is
  const onBeta = await realState({ channel: 'beta', releases: [rel('0.6.1'), rel('0.7.0-beta.1')] });
  assert.equal(onBeta.latest, '0.7.0-beta.1');
  const beta = upage(onBeta);
  assert.deepEqual(chanButtons(beta).map((b) => b.props['aria-pressed']), [false, true, false]);
  assert.equal(text(all(rowOf(beta, 'channel'), (n) => has(n, 'sub'))[0]), 'The next version, for a try before its release.');
  assert.match(text(rowOf(beta, 'parts')), /Installed 0\.6\.0, newest 0\.7\.0-beta\.1/);
  assert.ok(button(rowOf(beta, 'parts'), 'Update now'));
  // while an update runs the channel waits
  const busy = upage(derive(onRelease, { busy: true, phase: 'installing' }));
  assert.deepEqual(chanButtons(busy).map((b) => b.props.disabled), [true, true, true]);
  // a state without a channel (an older answer) reads as Release
  const { channel: dropped, ...old } = onRelease;
  assert.equal(dropped, 'release');
  assert.deepEqual(chanButtons(upage(old)).map((b) => b.props['aria-pressed']), [true, false, false]);
  assert.match(mod.kit.CSS, /\.ak-seg button\[aria-pressed=true\]\{/);
});

test('Updates, channel: Alpha asks first, and the question says what the updater then does in the chosen mode', async () => {
  const notify = await realState({ releases: [rel('0.6.1')] });
  const sent = [];
  const view = mount((m) => m.kit.UpdatesPage, { info: notify, t, onAction: (a) => sent.push(a) });
  chanButtons(view.render())[2].props.onClick({ currentTarget: null });
  assert.equal(sent.length, 0, 'Alpha waits for the answer');
  let dlg = dialogOf(view.render());
  assert.equal(text(all(dlg, (n) => n.type === 'h2')[0]), 'Switch to Alpha?');
  let line = text(all(dlg, (n) => has(n, 'ak-conseq'))[0]);
  assert.ok(line.length <= 90);
  assert.match(line, /can break/);
  assert.match(line, /switch back/);
  assert.ok(!/each change|every change/.test(line), 'versions are published by hand, so the line promises none after each change');
  button(dlg, 'Cancel').props.onClick({});
  assert.equal(dialogOf(view.render()), null);
  assert.equal(sent.length, 0);
  chanButtons(view.render())[2].props.onClick({ currentTarget: null });
  button(dialogOf(view.render()), 'Switch to Alpha').props.onClick({});
  same(sent, [{ kind: 'channel', channel: 'alpha' }]);
  assert.equal(dialogOf(view.render()), null);
  // with automatic install the question says that alphas then install by themselves, which is what the updater does
  const auto = await realState({ mode: 'auto', releases: [rel('0.6.1')] });
  dlg = dialogOf(upage(auto, { asking: 'alpha' }));
  line = text(all(dlg, (n) => has(n, 'ak-conseq'))[0]);
  assert.ok(line.length <= 90);
  assert.match(line, /install by themselves/);
  assert.match(updaterSource, /async function tick\(\)[\s\S]*?await install\(\{ auto: true \}\)/);
  assert.match(updaterSource, /const pick = pickRelease\(mem\.releases, named, channel\);/);
  // a question about a channel that is already set closes by itself
  const onAlpha = await realState({ channel: 'alpha', releases: [rel('0.6.1')] });
  const stale = mount((m) => m.kit.UpdatesPage, { info: onAlpha, t, asking: 'alpha' });
  stale.render();
  assert.equal(stale.states[0], null);
  assert.deepEqual(chanButtons(stale.render()).map((b) => b.props['aria-pressed']), [false, false, true]);
  assert.equal(text(all(rowOf(stale.render(), 'channel'), (n) => has(n, 'sub'))[0]), 'The earliest versions. A version can break.');
});

test('Updates, channel: a version newer than the channel says so; Go back asks first and names no version to the backend', async () => {
  const ahead = await realState({ installed: '0.7.0-beta.2', releases: [rel('0.6.1'), rel('0.7.0-beta.3')] });
  assert.deepEqual({ latest: ahead.latest, ahead: ahead.ahead, available: ahead.available }, { latest: '0.6.1', ahead: true, available: false }, 'the real updater reports the state');
  const sent = [];
  const view = mount((m) => m.kit.UpdatesPage, { info: ahead, t, onAction: (a) => sent.push(a) });
  const parts = () => rowOf(view.render(), 'parts');
  assert.equal(text(all(parts(), (n) => has(n, 'ak-status'))[0]), 'Newer than Release');
  assert.equal(button(parts(), 'Update now'), undefined);
  assert.equal(all(parts(), (n) => has(n, 'ak-dot') && has(n, 'on')).length, 0, 'it is not marked as up to date');
  button(parts(), 'Go back to 0.6.1').props.onClick({ currentTarget: null });
  assert.equal(sent.length, 0);
  const dlg = dialogOf(view.render());
  assert.equal(text(all(dlg, (n) => n.type === 'h2')[0]), 'Go back to 0.6.1?');
  const line = text(all(dlg, (n) => has(n, 'ak-conseq'))[0]);
  assert.ok(line.length <= 90);
  assert.match(line, /0\.6\.1/);
  assert.match(line, /restart/);
  button(dlg, 'Cancel').props.onClick({});
  assert.equal(sent.length, 0);
  button(parts(), 'Go back to 0.6.1').props.onClick({ currentTarget: null });
  button(dialogOf(view.render()), 'Go back').props.onClick({});
  same(sent, [{ kind: 'install', back: true, version: '0.6.1', channel: 'release' }], 'the action carries what the question named, for the updater to compare');
  // no files to go back to, an update that runs, a restart that is due: no Go back
  const noKit = await realState({ installed: '0.7.0-beta.2', releases: [rel('0.6.1', { kit: false })] });
  assert.equal(text(all(rowOf(upage(noKit), 'parts'), (n) => has(n, 'ak-status'))[0]), 'Newer than Release');
  for (const info of [noKit, derive(ahead, { busy: true, phase: 'downloading' }), derive(ahead, { restartNeeded: true })]) {
    assert.equal(all(upage(info), (n) => n.type === 'button' && /^Go back/.test(text(n))).length, 0);
  }
  // a question that can no longer be acted on closes by itself
  for (const info of [derive(ahead, { ahead: false }), derive(ahead, { busy: true, phase: 'downloading' }), derive(ahead, { installable: false, reason: 'no-kit' }), derive(ahead, { restartNeeded: true })]) {
    const stale = mount((m) => m.kit.UpdatesPage, { info, t, asking: 'back' });
    assert.equal(dialogOf(stale.render()), null);
    assert.equal(stale.states[0], null);
  }
  // on Beta the same computer is offered the newer beta instead
  const onBeta = await realState({ installed: '0.7.0-beta.2', channel: 'beta', releases: [rel('0.6.1'), rel('0.7.0-beta.3')] });
  assert.match(text(rowOf(upage(onBeta), 'parts')), /Needs update/);
});

test('Updates, channel: the new questions add no hook, and every line holds a full version number', async () => {
  const ready = await realState({ releases: [rel('0.6.1')] });
  const ahead = await realState({ installed: '0.7.0-beta.2', releases: [rel('0.6.1')] });
  let n = 0;
  const React = { createElement, Fragment: 'fragment', useState: (v) => { n++; return [v, () => {}]; }, useRef: () => { n++; return { current: null }; }, useEffect: () => { n++; } };
  const m = loadPanel(React);
  const counts = [{ info: null }, { info: ready }, { info: ready, asking: 'alpha' }, { info: ahead }, { info: ahead, asking: 'back' }].map((props) => { n = 0; m.kit.UpdatesPage({ t, ...props }); return n; });
  assert.ok(counts[0] > 0);
  assert.deepEqual(counts, counts.map(() => counts[0]), 'hook calls differ between renders: ' + counts);
  // the longest version the updater accepts and the page shows is cut at 20 characters
  for (const k of Object.keys(mod.en).filter((x) => x.startsWith('upd.') && !x.endsWith('.hint'))) {
    const s = mod.en[k].replace(/\{(v|i|n)\}/g, '0.10.10-alpha.123456').replace(/\{date\}/g, '21 Nov, 12:00').replace(/\{channel\}/g, 'Release');
    assert.ok(s.length <= 90, k + ' has ' + s.length + ' characters with a long version');
  }
});

test('Updates: an error line starts with its plain words, without the code name of the updater', async () => {
  const ready = await realState({ releases: [rel('0.6.1')] });
  const line = (message) => text(alertsOf(upage(derive(ready, { phase: 'failed', failed: true, message })))[0]);
  assert.equal(line('ERR_UPDATE_HTTP: HTTP 404 from github.com'), 'HTTP 404 from github.com');
  // the raw text of the line, which the helper above would trim
  const raw = (message) => alertsOf(upage(derive(ready, { phase: 'failed', failed: true, message })))[0].children[0];
  assert.equal(raw('ERR_UPDATE_HTTP: HTTP 404 from github.com'), 'HTTP 404 from github.com');
  assert.equal(raw('ERR_UPDATE_SUMS:sss is a word'), 'sss is a word', 'only the code name, the colon and the space after it go');
  assert.equal(line('ERR_UPDATE_CHECKSUM: the kit zip does not match its checksum'), 'the kit zip does not match its checksum');
  assert.equal(line('Could not reach GitHub or read its answer: ERR_X: y'), 'Could not reach GitHub or read its answer: ERR_X: y', 'only a code at the very start is dropped');
  assert.equal(text(alertsOf(upage(ready, { error: 'ERR_UPDATE_SIZE: the download is too large' }))[0]), 'the download is too large');
});
