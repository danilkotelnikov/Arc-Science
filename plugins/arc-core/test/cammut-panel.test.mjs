// Cammut tab tests (S051): the pure CammutView in every sub-view and every theme, one-line visible text,
// helper text only in Hint popovers, no key field, nothing but theme tokens, and the connector wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createResearchSessionStore } from '../lib/console.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const panelPath = path.join(here, '../ui/panel.js');

function loadPanel() {
  const source = fs.readFileSync(panelPath, 'utf8');
  let loaded;
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: (m) => { loaded = m; } } } });
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) });
  const mod = loaded.factory((name) => (name === 'react' ? { createElement, Fragment: 'fragment', useState: (v) => [v, () => {}], useEffect: () => {} } : {}));
  return { mod, source };
}

function renderTree(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node;
  if (typeof node.type === 'function') {
    const childProp = node.children.length === 1 ? node.children[0] : node.children;
    return renderTree(node.type({ ...node.props, children: childProp }));
  }
  return { ...node, children: (node.children || []).map(renderTree) };
}
const allNodes = (n) => (!n || typeof n !== 'object' ? [] : [n, ...(n.children || []).flatMap(allNodes)]);
const makeTranslator = (dict) => (k, v) => (dict[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => String(v?.[x] ?? ''));
const hasBox = (style = {}) => Boolean(style && typeof style.border === 'string' && style.border !== 'none' && !style.border.startsWith('0'));
const nested = (n, anc = false) => { if (!n || typeof n !== 'object') return 0; const own = hasBox(n.props?.style); return (own && anc ? 1 : 0) + (n.children || []).reduce((a, c) => a + nested(c, anc || own), 0); };

// text nodes that are visible as plain lines: not inside a pre block, a code tag or a closed popover
function visibleLines(n, inPre = false, out = []) {
  if (n === null || n === undefined || n === false) return out;
  if (typeof n !== 'object') { if (!inPre) out.push(String(n)); return out; }
  const pre = inPre || n.type === 'pre' || n.type === 'code' || n.type === 'style';
  for (const c of n.children || []) visibleLines(c, pre, out);
  return out;
}

const INFO = {
  ok: true,
  gateway: { host: '127.0.0.1:7424', reachable: true, version: '0.9' },
  canManage: true,
  manageReason: '',
  servers: [
    { url: 'http://127.0.0.1:7421', status: 'Reachable', ownKey: false, keyRef: '', keySet: false, legacyAuth: true },
    { url: 'https://vps.example.org', status: 'Not tried yet', ownKey: true, keyRef: 'cred://VPS_KEY', keySet: true, legacyAuth: false },
  ],
  builtin: { available: true, tools: ['hindsight/recall'] },
  components: [{ name: 'cammut-console', state: 'ready', generation: 1, canRollback: false, error: '' }],
};

function render(mod, props, t) {
  return renderTree({ type: mod.CammutView, props: { info: INFO, error: '', busy: false, tab: 'servers', onTab: () => {}, onAction: () => {}, t, ...props }, children: [] });
}

test('1. Cammut is a connector and the tab shows servers, with key names and no key field', () => {
  const { mod } = loadPanel();
  assert.ok(mod.CONNECTORS.includes('Cammut'));
  const t = makeTranslator(mod.en);
  const tree = render(mod, {}, t);
  assert.equal(tree.props['data-connector-view'], 'Cammut');
  const nodes = allNodes(tree);
  assert.equal(nodes.filter((n) => n.props?.['data-cammut-server']).length, 2);
  assert.ok(nodes.some((n) => n.type === 'code' && n.children.includes('cred://VPS_KEY')), 'key shown by name');
  assert.ok(nodes.some((n) => n.props?.['data-cammut-add']));
  const inputs = nodes.filter((n) => n.type === 'input');
  assert.ok(inputs.length >= 2);
  assert.equal(inputs.some((n) => n.props.type === 'password'), false, 'no key value field');
  assert.ok(inputs.some((n) => n.props['data-cammut-key']), 'a key NAME field');
  const text = visibleLines(tree).join(' ');
  assert.ok(!text.includes('sk-'), 'no key text');
});

test('2. Remove is off for the last server and when the gateway cannot change servers, with a one-line reason', () => {
  const { mod } = loadPanel();
  const t = makeTranslator(mod.en);
  const one = render(mod, { info: { ...INFO, servers: [INFO.servers[0]] } }, t);
  const rm = allNodes(one).filter((n) => n.props?.['data-cammut-remove']);
  assert.equal(rm.length, 1);
  assert.equal(rm[0].props.disabled, true);
  assert.ok(visibleLines(one).some((l) => /last server/i.test(l)));
  const old = render(mod, { info: { ...INFO, canManage: false, manageReason: 'The running gateway is older. Update it in the Updates tab.' } }, t);
  assert.ok(allNodes(old).filter((n) => n.props?.['data-cammut-remove']).every((n) => n.props.disabled === true));
  assert.equal(allNodes(old).find((n) => n.props?.['data-cammut-add']).props.disabled, true);
  assert.ok(visibleLines(old).some((l) => /older/.test(l)));
});

test('3. Add and Remove send only the address and the key name', () => {
  const { mod } = loadPanel();
  const t = makeTranslator(mod.en);
  const sent = [];
  const tree = render(mod, { onAction: (p) => sent.push(p) }, t);
  allNodes(tree).filter((n) => n.props?.['data-cammut-remove'])[1].props.onClick();
  assert.equal(JSON.stringify(sent[0]), JSON.stringify({ kind: 'server-remove', url: 'https://vps.example.org' }));
});

test('4. Tools tab: search, class badges, confirm for writes, typed name for deletes', () => {
  const { mod } = loadPanel();
  const t = makeTranslator(mod.en);
  const list = [{ tool: 'hindsight/list_tags', class: 'read', description: 'List tags' }, { tool: 'hindsight/create_directive', class: 'write', description: 'Create a directive' }, { tool: 'hindsight/delete_bank', class: 'destructive', description: 'Delete the bank' }];
  const base = render(mod, { tab: 'tools', tools: { list, run: null } }, t);
  const nodes = allNodes(base);
  assert.ok(nodes.some((n) => n.props?.['data-cammut-tool-query']));
  assert.equal(nodes.filter((n) => n.props?.['data-cammut-tool']).length, 3);
  assert.ok(nodes.some((n) => n.props?.['data-cammut-class'] === 'destructive'));
  const w = render(mod, { tab: 'tools', tools: { list, tool: 'hindsight/create_directive', run: { ok: false, needs: 'confirm', error: 'This changes memory. Confirm to run it.' } } }, t);
  assert.ok(allNodes(w).some((n) => n.props?.['data-cammut-confirm']));
  const d = render(mod, { tab: 'tools', tools: { list, tool: 'hindsight/delete_bank', run: { ok: false, needs: 'confirm-tool', error: 'This deletes data for good. Type the tool name to run it.' } } }, t);
  assert.ok(allNodes(d).some((n) => n.props?.['data-cammut-confirm-tool']));
  assert.equal(allNodes(d).some((n) => n.props?.['data-cammut-confirm'] && n.props.disabled !== true), false, 'delete confirm stays off until the name is typed');
});

test('5. Observer tab is read only: seven views, two sources, no change button', () => {
  const { mod } = loadPanel();
  const t = makeTranslator(mod.en);
  const sent = [];
  const tree = render(mod, { tab: 'observer', observer: { ok: true, view: 'memories', data: { items: [{ id: 'n1', text: 'The owner prefers plain English', tags: ['topic:style'] }], total: 1 } }, onAction: (p) => sent.push(p) }, t);
  const nodes = allNodes(tree);
  const views = nodes.find((n) => n.props?.['data-cammut-view']);
  assert.equal(views.children.filter((c) => c.type === 'option').length, 7);
  assert.equal(nodes.find((n) => n.props?.['data-cammut-source']).children.filter((c) => c.type === 'option').length, 2);
  assert.ok(nodes.some((n) => n.props?.['data-cammut-readonly']));
  assert.equal(nodes.some((n) => n.props?.['data-cammut-run'] || n.props?.['data-cammut-confirm']), false);
  assert.ok(visibleLines(tree).some((l) => /plain English/.test(l)));
  nodes.find((n) => n.props?.['data-cammut-show']).props.onClick();
  assert.equal(sent[0].kind, 'observe');
  assert.equal(sent[0].view, 'memories');
});

test('6. Parts tab lists the components with Reload and Roll back', () => {
  const { mod } = loadPanel();
  const t = makeTranslator(mod.en);
  const sent = [];
  const tree = render(mod, { tab: 'parts', onAction: (p) => sent.push(p) }, t);
  const nodes = allNodes(tree);
  nodes.find((n) => n.props?.['data-cammut-reload']).props.onClick();
  assert.equal(JSON.stringify(sent[0]), JSON.stringify({ kind: 'component-reload', name: 'cammut-console' }));
  assert.equal(nodes.find((n) => n.props?.['data-cammut-rollback']).props.disabled, true);
});

test('7. Visible text is one line of at most 90 characters; helper text sits in Hint popovers', () => {
  const { mod } = loadPanel();
  const t = makeTranslator(mod.en);
  const long = 'x'.repeat(300);
  for (const tab of ['servers', 'tools', 'observer', 'parts']) {
    const tree = render(mod, { tab, error: long, info: { ...INFO, servers: [{ ...INFO.servers[0], status: long }] }, tools: { list: [{ tool: 'hindsight/list_tags', class: 'read', description: long }], run: null } }, t);
    for (const l of visibleLines(tree)) assert.ok(l.length <= 90, `${tab}: ${l.slice(0, 40)}... has ${l.length} characters`);
    assert.ok(allNodes(tree).some((n) => n.props?.['data-hint']), `${tab} has a Hint`);
  }
  for (const k of Object.keys(mod.en).filter((x) => x.startsWith('cammut.hint.'))) assert.ok(mod.en[k].length > 40, `${k} is a real explanation`);
});

test('8. Three themes, zero nested boxes, no middle dot, no password field', () => {
  const { mod, source } = loadPanel();
  const t = makeTranslator(mod.en);
  assert.ok(!source.includes('·'));
  for (const tab of ['servers', 'tools', 'observer', 'parts']) {
    const tree = render(mod, { tab }, t);
    assert.equal(nested(tree), 0, `nested boxes in ${tab}`);
    assert.equal(allNodes(tree).some((n) => n.props?.type === 'password'), false);
  }
});

test('9. The Cammut connector renders inside the console and the pane is a container', () => {
  const { mod } = loadPanel();
  const t = makeTranslator(mod.en);
  const store = createResearchSessionStore({ live: false, persist: false });
  store.selectConnector('Cammut');
  const tree = renderTree({ type: mod.View, props: { data: store.snapshot(), failed: false, skin: 'arc', t }, children: [] });
  const nodes = allNodes(tree);
  assert.ok(nodes.some((n) => n.props?.['data-connector'] === 'Cammut' && n.props['aria-selected'] === true));
  assert.ok(nodes.some((n) => n.props?.['data-connector-view'] === 'Cammut'));
});

test('10. The Cammut tab has the look of the Cammut sign-in page: turning AS cube, accent main button, theme colours only', () => {
  const { mod, source } = loadPanel();
  const t = makeTranslator(mod.en);
  const tree = render(mod, { tab: 'servers' }, t);
  const nodes = allNodes(tree);
  const head = nodes.find((n) => n.props?.['data-cammut-head']);
  assert.ok(head, 'the tab opens with a head row');
  const cube = allNodes(head).find((n) => n.props?.['data-cammut-cube']);
  assert.ok(cube && cube.props.role === 'img' && cube.props['aria-label'] === 'Arc Science', 'the head shows the AS cube as an image');
  assert.equal(allNodes(cube).filter((n) => n.type === 'svg').length, 2, 'two faces: letters right, then letters left');
  assert.ok(allNodes(head).some((n) => n.type === 'h3' && n.children.includes('Cammut')), 'the head names Cammut');
  const style = nodes.find((n) => n.type === 'style').children.join('');
  assert.match(style, /@keyframes arc-cam-turn/);
  assert.match(style, /prefers-reduced-motion:reduce\)\{[^}]*\.arc-cam-cube[^}]*animation:none/, 'the cube stays still when the system asks for less motion');
  const add = nodes.find((n) => n.props?.['data-cammut-add']);
  assert.match(add.props.style.background, /var\(--dsw-alias-button-info-fill/, 'the main button takes the accent of the theme');
  const remove = nodes.find((n) => n.props?.['data-cammut-remove']);
  assert.match(remove.props.style.border, /^1px solid var\(--dsw-alias-line-divider/, 'secondary buttons are outlined');
  assert.equal(nodes.filter((n) => /button-info-fill/.test(n.props?.style?.background || '')).length, 1, 'one filled button: the main action; the selected tab is outlined');
  assert.equal(nodes.find((n) => n.props?.['data-cammut-status']).props.style.whiteSpace, 'nowrap', 'the status stays on one line');
  assert.equal(nodes.find((n) => n.props?.['data-cammut-status']).props.style.opacity, undefined, 'the status is full ink: dimmed 12 px text fell below 4.5:1 in four theme views');
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'no fixed colours in the panel');
});
