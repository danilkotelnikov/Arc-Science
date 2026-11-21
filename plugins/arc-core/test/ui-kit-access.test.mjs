// arc-core console rewrite, step 1 (S053): the shared kit (own icons, buttons, rows, switch of views, confirm dialog)
// and the Access page of the Settings dialog, built from the approved prototype. The page uses only today's backend:
// the app list, the active grants, the key list and the activity list of the console state.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../ui/panel.js'), 'utf8');

function loadPanel() {
  let loaded;
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: (m) => { loaded = m; } } } });
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) });
  return loaded.factory((name) => (name === 'react' ? { createElement, Fragment: 'fragment', useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({ current: null }) } : {}));
}
const mod = loadPanel();
const t = (key, vars = {}) => String(mod.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

// turns components into plain element trees, the way React would call them
function expand(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node;
  if (typeof node.type === 'function') return expand(node.type({ ...node.props, children: node.children }));
  return { ...node, children: (node.children || []).map(expand).flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) };
}
const all = (node, pred, out = []) => { if (node && typeof node === 'object') { if (pred(node)) out.push(node); for (const c of node.children || []) all(c, pred, out); } return out; };
const text = (node) => (node === null || node === undefined ? '' : typeof node !== 'object' ? String(node) : (node.children || []).map(text).join(' ')).replace(/\s+/g, ' ').trim();
const has = (node, cls) => String(node.props?.className || '').split(/\s+/).includes(cls);

const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const data = {
  consents: [{ appId: 'figma-connector', mode: 'Grant for 30 days', scopes: ['read', 'write'], grantedAtMs: NOW, expiresAtMs: NOW + 30 * DAY }],
  connectorsDetail: {
    Apps: [{ id: 'figma', label: 'Figma', grants: 1, scopes: ['read'] }, { id: 'notion', label: 'Notion', grants: 0, scopes: ['read'] }],
    Keys: [
      { id: 'k1', label: 'Radium', ref: 'RADIUM_API_KEY', status: 'The key is set.', state: 'ok' },
      { id: 'k2', label: 'GC', ref: 'GC_API_KEY', status: 'The key is not set.', state: 'attention' },
    ],
    Audit: [{ id: 'a1', kind: 'consent-grant', summary: 'Grant for 30 days for figma-connector', atMs: NOW }],
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

test('kit buttons and the switch of views keep the sizes of the host app', () => {
  const css = mod.kit.CSS;
  assert.match(css, /\.ak-btn\{[^}]*height:36px[^}]*border-radius:10px/);
  assert.match(css, /\.ak-btn\.sm\{[^}]*height:28px[^}]*border-radius:8px/);
  assert.match(css, /\.ak-seg button\{[^}]*height:28px/);
  assert.match(css, /\.ak-row\{[^}]*padding:14px 0/);
  // every rule sits under the kit root, so the host app keeps its own look
  for (const rule of css.split('}').map((r) => r.trim()).filter(Boolean)) assert.ok(rule.startsWith('[data-arc-kit]'), `a rule leaves the kit root: ${rule.slice(0, 60)}`);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(css), 'a fixed colour: every colour must come from the theme');
  assert.ok(!css.includes('·'));
});

test('Access, Apps: an app with a grant shows what it may use, its end date and End access', () => {
  const tree = page();
  assert.equal(tree.props['data-arc-settings'], 'access');
  assert.equal(tree.props['data-arc-kit'], 'true');
  assert.equal(text(all(tree, (n) => n.type === 'h1')[0]), 'Access');
  const tabs = all(tree, (n) => n.props?.role === 'tab');
  assert.deepEqual(tabs.map(text), ['Apps', 'Keys', 'Activity']);
  assert.deepEqual(tabs.map((b) => b.props['aria-selected']), [true, false, false]);
  const rows = all(tree, (n) => n.props?.['data-row'] === 'app');
  assert.equal(rows.length, 2);
  const [figma, notion] = rows;
  assert.equal(text(all(figma, (n) => has(n, 'name'))[0]), 'Figma');
  assert.deepEqual(all(figma, (n) => has(n, 'ak-chip')).map(text), ['read', 'write']);
  assert.match(text(all(figma, (n) => has(n, 'ak-status'))[0]), /^Until 21 Dec/);
  const end = all(figma, (n) => n.type === 'button');
  assert.deepEqual(end.map(text), ['End access']);
  assert.ok(has(end[0], 'outline') && has(end[0], 'sm'));
  assert.equal(end[0].props['aria-label'], 'End access for Figma');
  // the list is the panel of the open tab
  const panel = all(tree, (n) => n.props?.role === 'tabpanel')[0];
  assert.equal(panel.props['aria-labelledby'], tabs[0].props.id);
  // a grant that has ended counts as no access, also when the state is old
  const late = page({ nowMs: NOW + 31 * DAY });
  assert.deepEqual(all(late, (n) => has(n, 'ak-status')).map(text), ['No access', 'No access']);
  assert.equal(all(late, (n) => n.type === 'button' && text(n) === 'End access').length, 0);
  // an app without a grant: one plain state, no button, no list of rights
  assert.equal(text(all(notion, (n) => has(n, 'ak-status'))[0]), 'No access');
  assert.equal(all(notion, (n) => n.type === 'button').length, 0);
  assert.equal(all(notion, (n) => has(n, 'ak-chip')).length, 0);
  // no dialog at rest
  assert.equal(all(tree, (n) => n.props?.role === 'dialog').length, 0);
});

test('Access, Apps: End access asks first, names the consequence, and then ends that one grant', () => {
  const calls = [];
  const tree = page({ ending: 'figma', onEnd: (req) => calls.push(req) });
  const dialog = all(tree, (n) => n.props?.role === 'dialog')[0];
  assert.ok(dialog, 'no dialog');
  assert.equal(dialog.props['aria-modal'], true);
  const title = all(dialog, (n) => n.type === 'h2')[0];
  assert.equal(text(title), 'End access for Figma?');
  assert.equal(dialog.props['aria-labelledby'], title.props.id);
  assert.equal(dialog.props.tabIndex, -1);
  assert.equal(dialog.props['aria-describedby'], all(dialog, (n) => has(n, 'ak-conseq'))[0].props.id);
  const conseq = text(all(dialog, (n) => has(n, 'ak-conseq'))[0]);
  assert.ok(conseq.includes('Figma') && conseq.length <= 120, conseq);
  const buttons = all(dialog, (n) => n.type === 'button' && text(n));
  assert.deepEqual(buttons.map(text), ['Cancel', 'End access']);
  assert.ok(has(buttons[1], 'primary'));
  buttons[1].props.onClick();
  assert.equal(JSON.stringify(calls), JSON.stringify([{ appId: 'figma-connector', mode: 'Revoke' }]));
});

test('Access, Keys: a key shows its name and state, never a value; a missing key hands over to a session', () => {
  const asked = [];
  const tree = page({ tab: 'keys', onAsk: (p) => asked.push(p) });
  const rows = all(tree, (n) => n.props?.['data-row'] === 'key');
  assert.equal(rows.length, 2);
  assert.equal(text(all(rows[0], (n) => has(n, 'name'))[0]), 'RADIUM_API_KEY');
  assert.ok(has(all(rows[0], (n) => has(n, 'name'))[0], 'mono'));
  assert.equal(text(all(rows[0], (n) => has(n, 'sub'))[0]), 'Used by Radium');
  assert.equal(text(all(rows[0], (n) => has(n, 'ak-status'))[0]), 'Set');
  assert.equal(all(rows[0], (n) => n.type === 'button').length, 0);
  assert.equal(text(all(rows[1], (n) => has(n, 'ak-status'))[0]), 'Not set');
  const btn = all(rows[1], (n) => n.type === 'button')[0];
  assert.equal(text(btn), 'Set in a session');
  assert.equal(btn.props['aria-label'], 'Set GC_API_KEY in a session');
  btn.props.onClick();
  assert.equal(asked.length, 1);
  assert.ok(asked[0].includes('GC_API_KEY') && !/sk-|ghp_|Bearer/.test(asked[0]));
  // no field for a key value on this page
  assert.equal(all(tree, (n) => n.type === 'input' || n.type === 'textarea').length, 0);
});

test('Access, Activity: each entry shows what happened, its kind and its time; an empty list says so', () => {
  const tree = page({ tab: 'activity' });
  const rows = all(tree, (n) => n.props?.['data-row'] === 'activity');
  assert.equal(rows.length, 1);
  assert.ok(text(rows[0]).includes('Grant for 30 days for figma-connector'));
  assert.equal(text(all(rows[0], (n) => has(n, 'mono'))[0]), 'consent-grant');
  assert.match(text(all(rows[0], (n) => has(n, 'sub'))[0]), /21 Nov/);
  const empty = page({ tab: 'activity', data: { ...data, connectorsDetail: { ...data.connectorsDetail, Audit: [] } } });
  assert.equal(text(all(empty, (n) => has(n, 'ak-empty'))[0]), 'Nothing was recorded yet.');
});

test('Access: before the state arrives the page says so, and a failed read offers one retry', () => {
  const loading = page({ data: null });
  assert.equal(text(all(loading, (n) => n.props?.role === 'status')[0]), 'Loading…');
  let retried = 0;
  const failed = page({ data: null, failed: true, onRefresh: () => { retried++; } });
  assert.equal(text(all(failed, (n) => n.props?.role === 'alert')[0]), 'Could not read the console state.');
  const b = all(failed, (n) => n.type === 'button')[0];
  assert.equal(text(b), 'Try again');
  b.props.onClick();
  assert.equal(retried, 1);
  const err = page({ actionError: 'The grant could not be ended.' });
  assert.equal(text(all(err, (n) => n.props?.role === 'alert')[0]), 'The grant could not be ended.');
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
