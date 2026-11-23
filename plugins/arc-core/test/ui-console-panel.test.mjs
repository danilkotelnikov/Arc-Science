// arc-core console rewrite (S062): the side panel with the views Research, Memory, Figures, Prose and Status,
// built from the approved prototype on what the console state holds today. The tests read the panel from a real store,
// so the fixtures cannot drift from the backend unseen.
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
const still = { createElement, Fragment: 'fragment', useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({ current: null }) };
const mod = loadPanel(still);
const t = (key, vars = {}) => String(mod.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

function expand(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node;
  if (typeof node.type === 'function') return expand(node.type({ ...node.props, children: node.children }));
  return { ...node, children: (node.children || []).map(expand).flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) };
}
// a panel that keeps its state between renders, so a test can click and look again
function mount(props) {
  const states = {}, refs = {}; let i = 0, j = 0, effects = [];
  const React = { createElement, Fragment: 'fragment',
    useState: (v) => { const k = i++; if (!(k in states)) states[k] = v; return [states[k], (n) => { states[k] = typeof n === 'function' ? n(states[k]) : n; }]; },
    useRef: (v) => { const k = j++; if (!(k in refs)) refs[k] = { current: v }; return refs[k]; },
    useEffect: (fn) => { effects.push(fn); } };
  const m = loadPanel(React);
  const live = { ...props };
  const render = () => { i = 0; j = 0; effects = []; const tree = expand({ type: m.kit.ConsolePanel, props: { t, ...live }, children: [] }); for (const f of effects) f(); return tree; };
  return { render, set: (more) => Object.assign(live, more) };
}
const all = (node, pred, out = []) => { if (node && typeof node === 'object') { if (pred(node)) out.push(node); for (const c of node.children || []) all(c, pred, out); } return out; };
const text = (node) => (node === null || node === undefined ? '' : typeof node !== 'object' ? String(node) : node.type === 'style' ? '' : (node.children || []).map(text).join(' ')).replace(/\s+/g, ' ').trim();
const has = (node, cls) => String(node.props?.className || '').split(/\s+/).includes(cls);
const rowsOf = (tree, kind) => all(tree, (n) => n.props?.['data-row'] === kind);
const button = (node, label) => all(node, (n) => n.type === 'button' && text(n) === label)[0];
const tabs = (tree) => all(tree, (n) => n.props?.role === 'tab');
const nameOf = (row) => text(all(row, (n) => has(n, 'name'))[0]);
const statusOf = (row) => text(all(row, (n) => has(n, 'ak-status'))[0]);
const alerts = (tree) => all(tree, (n) => n.props?.role === 'alert').map(text);
const plain = (x) => JSON.parse(JSON.stringify(x)); // values made inside the panel come from another realm
const click = (node, e = {}) => node.props.onClick({ currentTarget: null, ...e });

function withStore(run, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-panel-'));
  try { return run(createResearchSessionStore({ arcHome: tmp, molecullageRoot: path.join(tmp, "no-library"), live: false, ...opts })); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
const snap = (over = {}) => withStore((store) => ({ ...store.snapshot(), ...over }));

test('the panel is one kit root with five views; the old top controls are gone', () => {
  const tree = mount({ data: snap() }).render();
  assert.equal(tree.props['data-arc-kit'], 'true');
  assert.equal(tree.props['data-arc-panel'], 'console');
  assert.equal(tree.props['data-arc-console'], undefined, 'the old style rules must not reach the new panel');
  assert.deepEqual(tabs(tree).map(text), ['Research', 'Memory', 'Figures', 'Prose', 'Status']);
  assert.deepEqual(tabs(tree).map((n) => n.props['aria-selected']), [true, false, false, false, false]);
  assert.deepEqual(tabs(tree).map((n) => n.props.tabIndex), [0, -1, -1, -1, -1]);
  const list = all(tree, (n) => n.props?.role === 'tablist')[0];
  assert.equal(list.props['aria-label'], 'Console views');
  assert.equal(typeof list.props.onKeyDown, 'function');
  const body = all(tree, (n) => n.props?.role === 'tabpanel')[0];
  assert.equal(body.props['aria-labelledby'], tabs(tree)[0].props.id);
  assert.equal(all(tree, (n) => n.type === 'button' && /Connectors|Settings/.test(text(n))).length, 0);
});

test('before the state arrives the panel says so; a failed read shows one line and Try again', () => {
  const loading = mount({ data: null }).render();
  assert.equal(text(all(loading, (n) => n.props?.role === 'status')[0]), t('state.loading'));
  assert.equal(tabs(loading).length, 0);
  let again = 0;
  const failed = mount({ data: null, failed: true, onRefresh: () => { again++; } }).render();
  assert.deepEqual(alerts(failed), [t('state.error')]);
  click(button(failed, 'Try again'));
  assert.equal(again, 1);
});

test('a view is chosen in the panel; the four views with a workspace also tell the store', () => {
  const sent = [];
  const p = mount({ data: snap(), onSelectView: (w) => sent.push(w) });
  for (const id of ['memory', 'figures', 'prose', 'status']) click(tabs(p.render()).find((n) => n.props['data-view'] === id));
  assert.deepEqual(sent, ['Memory', 'Molecullage', 'Prose']);
  assert.deepEqual(tabs(p.render()).filter((n) => n.props['aria-selected']).map(text), ['Status']);
  // the workspace of the store decides the first view until the user picks one
  const first = mount({ data: snap({ head: { activeWorkspace: 'Molecullage', ladderRungs: [] } }) }).render();
  assert.deepEqual(tabs(first).filter((n) => n.props['aria-selected']).map(text), ['Figures']);
});

test('Research: one row for each decision, claim and release of the store, with its kind and its state', () => {
  const tree = mount({ data: snap() }).render();
  const rows = rowsOf(tree, 'research');
  assert.ok(rows.every((r) => r.type === 'button'), 'a research row opens its detail, so it is a button');
  assert.deepEqual(rows.map(nameOf), [
    'CDR3 active-site insertion geometry', 'Flat framework contact patch', 'Unconstrained loop length sampling',
    'PDB 1MEL forms 55 heavy-atom residue pairs within 4.5 A between camel VH and lysozyme.',
    'Combined autoencoder and denoiser Adam training states occupy 6.54 GB (8.2% of an 80 GB N…',
    'Release candidate 4fcea07',
  ]);
  assert.deepEqual(rows.map((r) => text(all(r, (n) => has(n, 'sub'))[0])), ['Decision', 'Decision', 'Decision', 'Claim', 'Claim', 'Release']);
  assert.deepEqual(rows.map(statusOf), ['Pursued', 'Parked', 'Dropped', 'Published', 'Architecture', 'Waits for you']);
  const dots = rows.map((r) => String(all(r, (n) => has(n, 'ak-dot'))[0].props.className).replace('ak-dot', '').trim());
  assert.deepEqual(dots, ['on', '', '', 'on', '', 'warn']);
});

test('Research, a decision: the detail offers the other decisions, sends the chosen one, and Back returns to the list', () => {
  const sent = [], chat = [];
  const p = mount({ data: snap(), onDecision: (r) => sent.push(r), onUseInChat: (x) => chat.push(x) });
  click(rowsOf(p.render(), 'research')[0]);
  let tree = p.render();
  const detail = all(tree, (n) => n.props?.['data-detail'])[0];
  assert.equal(detail.props['data-detail'], 'branch:b-cdr3-loop');
  assert.equal(rowsOf(tree, 'research').length, 0, 'the list gives way to the detail');
  assert.equal(text(all(detail, (n) => n.type === 'h2')[0]), 'CDR3 active-site insertion geometry');
  assert.equal(text(all(detail, (n) => has(n, 'ak-tag'))[0]), 'Decision');
  assert.equal(text(all(detail, (n) => n.props?.['data-level'])[0]), 'Checked to level 2 of 6');
  assert.equal(text(all(detail, (n) => n.type === 'p')[0]), 'Support 2.84. Value for its cost 1.42.');
  const back = all(detail, (n) => n.props?.['data-back'])[0];
  assert.equal(back.props.autoFocus, true, 'the focus moves into the detail');
  // the decision in force is not offered again
  assert.equal(button(detail, 'Pursue'), undefined);
  click(button(detail, 'Park'));
  assert.deepEqual(plain(sent), [{ branchId: 'b-cdr3-loop', action: 'Park' }]);
  const more = all(detail, (n) => n.props?.['aria-haspopup'] === 'menu')[0];
  assert.equal(more.props['aria-label'], 'More actions');
  assert.equal(more.props['aria-expanded'], false);
  click(more);
  tree = p.render();
  const items = all(tree, (n) => n.props?.role === 'menuitem');
  assert.deepEqual(items.map(text), ['Drop', 'Request a test']);
  click(items[1]);
  assert.deepEqual(plain(sent[1]), { branchId: 'b-cdr3-loop', action: 'Request a test' });
  assert.equal(all(p.render(), (n) => n.props?.role === 'menuitem').length, 0, 'a choice closes the menu');
  click(button(p.render(), 'Use in chat'));
  assert.match(chat[0], /CDR3 active-site insertion geometry/);
  click(all(p.render(), (n) => n.props?.['data-back'])[0]);
  assert.equal(rowsOf(p.render(), 'research').length, 6);
});

test('Research on a real store: a decision changes the state word of its row', () => withStore((store) => {
  const p = mount({ data: store.snapshot(), onDecision: (r) => { assert.equal(store.recordDecision(r).ok, true); p.set({ data: store.snapshot() }); } });
  click(rowsOf(p.render(), 'research')[1]);
  assert.equal(statusOf(all(p.render(), (n) => n.props?.['data-detail'])[0]), 'Parked');
  click(button(p.render(), 'Pursue'));
  const detail = all(p.render(), (n) => n.props?.['data-detail'])[0];
  assert.equal(statusOf(detail), 'Pursued');
  assert.equal(button(detail, 'Pursue'), undefined);
  assert.ok(button(detail, 'Park'));
}));

test('Research, a claim: the detail shows the whole text and its source; a claim has no decision', () => {
  const sent = [];
  const p = mount({ data: snap(), item: 'claim:c-a100-share', onDecision: (r) => sent.push(r), onVerdict: (r) => sent.push(r) });
  const detail = all(p.render(), (n) => n.props?.['data-detail'])[0];
  assert.equal(text(all(detail, (n) => n.type === 'p')[0]), 'Combined autoencoder and denoiser Adam training states occupy 6.54 GB (8.2% of an 80 GB NVIDIA A100).');
  assert.equal(text(all(detail, (n) => n.props?.['data-level'])[0]), 'Checked to level 1 of 6');
  const ev = rowsOf(detail, 'evidence');
  assert.deepEqual(ev.map(nameOf), ['studio/jobs/ml-explainer/compute/sizes.json']);
  assert.deepEqual(ev.map(statusOf), ['Architecture']);
  assert.deepEqual(all(detail, (n) => n.type === 'button').map(text), ['Research', 'Use in chat']);
  assert.equal(all(detail, (n) => n.props?.['aria-haspopup'] === 'menu').length, 0);
  assert.deepEqual(sent, []);
});

test('Research, the release: the verdict goes to the store and the state follows the saved verdict', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-panel-'));
  try {
    const store = createResearchSessionStore({ arcHome: tmp, molecullageRoot: path.join(tmp, 'no-library'), live: false });
    const sent = [];
    const p = mount({ data: store.snapshot(), item: 'release:candidate', onVerdict: (r) => sent.push(r) });
    let detail = all(p.render(), (n) => n.props?.['data-detail'])[0];
    assert.equal(statusOf(detail), 'Waits for you');
    assert.deepEqual(rowsOf(detail, 'evidence').map((r) => [nameOf(r), statusOf(r)]), [['Release checks', 'Accepted'], ['Prose check', 'Clean']]);
    click(button(detail, 'Approve'));
    assert.deepEqual(plain(sent), [{ targetType: 'release', targetId: 'candidate', verdict: 'Approve' }]);
    assert.equal((await store.annotateVerdict(sent[0])).ok, true);
    p.set({ data: store.snapshot() });
    detail = all(p.render(), (n) => n.props?.['data-detail'])[0];
    assert.equal(statusOf(detail), 'Approved');
    assert.equal(button(detail, 'Approve'), undefined);
    assert.ok(button(detail, 'Revise'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('Research: an entry that leaves the state closes its detail', () => {
  const data = snap();
  const p = mount({ data, item: 'branch:b-unconstrained' });
  assert.equal(all(p.render(), (n) => n.props?.['data-detail']).length, 1);
  p.set({ data: { ...data, tree: { ok: true, branches: data.tree.branches.slice(0, 2) } } });
  p.render(); // the effect of this render drops the entry that is gone
  const tree = p.render();
  assert.equal(all(tree, (n) => n.props?.['data-detail']).length, 0);
  assert.equal(rowsOf(tree, 'research').length, 5);
  // an entry of the same name that comes back later does not open by itself
  p.set({ data });
  assert.equal(all(p.render(), (n) => n.props?.['data-detail']).length, 0);
  assert.equal(rowsOf(p.render(), 'research').length, 6);
});

test('Memory: a search sends the trimmed words, an empty one sends nothing, and each found note can go to the chat', () => {
  const sent = [], chat = [];
  const results = [{ id: 'n1', context: 'project:vhh', text: 'The baseline panel is 1MEL for every later comparison.' }, { text: 'A note without a label.' }];
  const base = snap();
  const p = mount({ data: { ...base, memory: { ...base.memory, lastQuery: 'baseline', results } }, view: 'memory', onSearchMemory: (q) => sent.push(q), onUseInChat: (x) => chat.push(x) });
  let tree = p.render();
  const form = all(tree, (n) => n.type === 'form')[0];
  const input = all(form, (n) => n.type === 'input')[0];
  assert.equal(input.props['aria-label'], 'Search the shared notes');
  assert.equal(all(form, (n) => n.type === 'button')[0].props.type, 'submit');
  form.props.onSubmit({ preventDefault() {} });
  input.props.onChange({ target: { value: '   ' } });
  all(p.render(), (n) => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(sent, []);
  input.props.onChange({ target: { value: '  melt data ' } });
  tree = p.render();
  assert.equal(all(tree, (n) => n.type === 'input')[0].props.value, '  melt data ');
  all(tree, (n) => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(sent, ['melt data']);
  const rows = rowsOf(tree, 'note');
  assert.deepEqual(rows.map(nameOf), results.map((r) => r.text));
  assert.deepEqual(rows.map((r) => all(r, (n) => has(n, 'ak-chip')).map(text)), [['project:vhh'], ['memory']]);
  const use = all(rows[0], (n) => n.type === 'button')[0];
  assert.equal(text(use), 'Use in chat');
  assert.match(use.props['aria-label'], /^Use in chat: The baseline panel/);
  click(use);
  assert.equal(chat[0], 'Shared memory [project:vhh]: The baseline panel is 1MEL for every later comparison.');
});

test('Memory: a search without a hit says so, and a failed search shows its one line', () => {
  const base = snap();
  const none = mount({ data: { ...base, memory: { ...base.memory, lastQuery: 'zzz', results: [] } }, view: 'memory' }).render();
  assert.equal(text(all(none, (n) => has(n, 'ak-empty'))[0]), 'Nothing matches.');
  const fresh = mount({ data: base, view: 'memory' }).render();
  assert.equal(all(fresh, (n) => has(n, 'ak-empty')).length, 0, 'before the first search the view says nothing');
  const long = 'The memory gateway did not answer. '.repeat(6);
  const bad = mount({ data: { ...base, memory: { ...base.memory, lastQuery: 'x', results: [], error: long } }, view: 'memory' }).render();
  assert.equal(alerts(bad).length, 1);
  assert.ok(alerts(bad)[0].length <= 90);
  assert.equal(all(bad, (n) => has(n, 'ak-empty')).length, 0);
});

test('Figures: the found sources and the pinned ones; the menu of a source pins it, unpins it or sends it to the chat', () => {
  const sent = [], chat = [], asked = [];
  const base = snap();
  const items = [{ id: 'bioart', name: 'NIH BioArt', use: 'Vector art for biology', licenceClass: 'public' }, { id: 'tol', name: 'Paul Tol colour schemes', kind: 'palette', use: 'none' }];
  const pins = [{ id: 'bioart', name: 'NIH BioArt' }, { id: 'pdb', name: 'RCSB PDB', section: 'structures' }];
  const p = mount({ data: { ...base, molecullage: { ...base.molecullage, items, pins } }, view: 'figures', onPinSource: (r) => sent.push(r), onUseInChat: (x) => chat.push(x), onSearchFigures: (q) => asked.push(q) });
  let tree = p.render();
  const rows = rowsOf(tree, 'source');
  assert.deepEqual(rows.map(nameOf), ['RCSB PDB Pinned', 'NIH BioArt Pinned', 'Paul Tol colour schemes'], 'a pinned source outside the found ones stays in the list');
  assert.deepEqual(rows.map((r) => text(all(r, (n) => has(n, 'sub'))[0])), ['structures', 'Vector art for biology', 'palette'], 'the library writes the word none for an empty field, and the row must not show it');
  const menuOf = (row) => all(row, (n) => n.props?.['aria-haspopup'] === 'menu')[0];
  assert.equal(menuOf(rows[2]).props['aria-label'], 'More for Paul Tol colour schemes');
  click(menuOf(rows[2]));
  tree = p.render();
  assert.deepEqual(all(tree, (n) => n.props?.role === 'menuitem').map(text), ['Pin', 'Use in chat']);
  click(all(tree, (n) => n.props?.role === 'menuitem')[0]);
  assert.deepEqual(plain(sent), [{ source: items[1] }]);
  click(menuOf(rowsOf(p.render(), 'source')[1]));
  tree = p.render();
  assert.deepEqual(all(tree, (n) => n.props?.role === 'menuitem').map(text), ['Unpin', 'Use in chat']);
  click(all(tree, (n) => n.props?.role === 'menuitem')[1]);
  assert.match(chat[0], /NIH BioArt/);
  // an empty search is sent too: it brings the whole list back
  all(p.render(), (n) => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(asked, ['']);
  const empty = mount({ data: { ...base, molecullage: { ...base.molecullage, items: [], pins: [] } }, view: 'figures' }).render();
  assert.equal(text(all(empty, (n) => has(n, 'ak-empty'))[0]), 'No source is listed.');
});

test('Figures on a real store: a pin made through the store shows as Pinned', () => withStore((store) => {
  const src = { id: 'tol', name: 'Paul Tol colour schemes', kind: 'palette' };
  assert.equal(store.toggleMolecullagePin({ source: src }).ok, true);
  const tree = mount({ data: store.snapshot(), view: 'figures' }).render();
  assert.deepEqual(rowsOf(tree, 'source').map(nameOf), ['Paul Tol colour schemes Pinned']);
}));

test('Prose on a real store: Check text sends the draft, the marks show with a plain reason, and the replace step is offered', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-panel-'));
  try {
    const store = createResearchSessionStore({ arcHome: tmp, molecullageRoot: path.join(tmp, 'no-library'), live: false });
    const calls = [];
    const p = mount({ data: store.snapshot(), view: 'prose',
      onProseCheck: async (x) => { calls.push(['check', x]); store.updateProseDraft(x); p.set({ data: store.snapshot() }); return true; },
      onProseRewrite: async (x) => { calls.push(['rewrite', x]); store.rewriteProseDraft(x); p.set({ data: store.snapshot() }); return true; } });
    let tree = p.render();
    const area = all(tree, (n) => n.type === 'textarea')[0];
    assert.equal(area.props['aria-label'], 'Text to check');
    assert.equal(area.props.value, store.snapshot().prose.text);
    assert.equal(statusOf(all(tree, (n) => has(n, 'ak-acts'))[0]), 'Clean');
    assert.equal(button(tree, 'Replace with plain words'), undefined, 'a clean text offers no replace step');
    const draft = 'The method is not a shortcut, but a careful protocol.';
    assert.ok(store.updateProseDraft(draft).report.findings.length > 0, 'the test text must hold a mark of the word rules');
    store.updateProseDraft('The bath holds 40 C.');
    p.set({ data: store.snapshot() });
    area.props.onChange({ target: { value: draft } });
    tree = p.render();
    assert.equal(all(tree, (n) => n.type === 'textarea')[0].props.value, draft);
    assert.equal(all(all(tree, (n) => has(n, 'ak-acts'))[0], (n) => has(n, 'ak-status')).length, 0, 'an edited text shows no mark count of the older text');
    await click(button(tree, 'Check text'));
    assert.deepEqual(calls[0], ['check', draft]);
    tree = p.render();
    const marks = rowsOf(tree, 'finding');
    assert.ok(marks.length >= 1);
    assert.equal(statusOf(all(tree, (n) => has(n, 'ak-acts'))[0]), `To fix: ${marks.length}`);
    assert.equal(all(marks[0], (n) => n.type === 'q').length, 1);
    assert.equal(text(all(marks[0], (n) => has(n, 'sub'))[0]), 'A contrast frame. Say what the thing is.');
    await click(button(tree, 'Replace with plain words'));
    assert.deepEqual(calls[1], ['rewrite', draft]);
    tree = p.render();
    assert.equal(all(tree, (n) => n.type === 'textarea')[0].props.value, store.snapshot().prose.text);
    assert.notEqual(store.snapshot().prose.text, draft);
    await click(button(tree, 'Use a sample'));
    assert.equal(calls[2][0], 'check');
    assert.ok(store.snapshot().prose.report.findings.length > 0, 'the sample shows the check at work');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('Prose: a check that the backend refuses keeps the typed text', async () => {
  const p = mount({ data: snap(), view: 'prose', onProseCheck: async () => false });
  all(p.render(), (n) => n.type === 'textarea')[0].props.onChange({ target: { value: 'my words' } });
  await click(button(p.render(), 'Check text'));
  assert.equal(all(p.render(), (n) => n.type === 'textarea')[0].props.value, 'my words');
});

test('Status: one line for each part, with what the state says about it', () => {
  const base = snap();
  const off = mount({ data: base, view: 'status' }).render();
  const lines = (tree) => Object.fromEntries(rowsOf(tree, 'statusline').map((r) => [nameOf(r), statusOf(r)]));
  assert.deepEqual(Object.keys(lines(off)), ['Local gateway', 'Providers', 'Tool servers', 'Memory', 'Add-ons']);
  assert.equal(lines(off)['Local gateway'], 'Not reached');
  assert.equal(lines(off).Memory, 'Not reached');
  assert.ok(rowsOf(off, 'statusline').every((r) => all(r, (n) => n.type === 'svg').length === 1), 'each line carries its own icon');
  const on = mount({ view: 'status', data: { ...base,
    memory: { ...base.memory, reachable: true, configured: true, recall: true, routes: ['radium', 'merge', 'vertex'] },
    connectorsDetail: { ...base.connectorsDetail, Servers: [{ id: 'a', state: 'ok' }, { id: 'b', state: 'idle' }] },
    addons: { ok: true, items: [{ id: 'x' }, { id: 'y' }] }, update: { available: true, latest: '9.9.9' } } }).render();
  assert.deepEqual(lines(on), { 'Local gateway': 'Running', Providers: 'Listed: 3', 'Tool servers': 'On: 1 of 2', Memory: 'Recall on', 'Add-ons': 'Installed: 2', Updates: 'Needs update' });
  const unset = mount({ view: 'status', data: { ...base, memory: { ...base.memory, reachable: true, configured: false } } }).render();
  assert.equal(lines(unset).Memory, t('state.unset'));
});

test('the menu of the kit: Escape closes the open menu only, and the arrow keys open it', () => {
  const p = mount({ data: snap(), item: 'branch:b-cdr3-loop' });
  const wrap = () => all(p.render(), (n) => has(n, 'ak-pick'))[0];
  let stopped = 0;
  const key = (k) => wrap().props.onKeyDown({ key: k, stopPropagation: () => { stopped++; }, preventDefault() {}, currentTarget: null });
  key('Escape');
  assert.equal(stopped, 0, 'a closed menu leaves Escape to the app');
  key('ArrowDown');
  assert.equal(all(wrap(), (n) => n.props?.role === 'menu').length, 1);
  assert.equal(all(wrap(), (n) => n.props?.role === 'menuitem')[0].props.autoFocus, true);
  key('Escape');
  assert.equal(stopped, 1);
  assert.equal(all(wrap(), (n) => n.props?.role === 'menu').length, 0);
});

test('an action that the backend refused shows as one alert line in every view', () => {
  for (const view of ['research', 'memory', 'figures', 'prose', 'status']) {
    const tree = mount({ data: snap(), view, actionError: 'Unknown branch: zzz' }).render();
    assert.deepEqual(alerts(tree), ['Unknown branch: zzz'], view);
  }
});

test('the words of the panel: plain, one line, and free of the middle dot', () => {
  const keys = Object.keys(mod.en).filter((k) => k.startsWith('pane.'));
  assert.ok(keys.length >= 45, `only ${keys.length} panel lines`);
  for (const k of keys) {
    assert.ok(mod.en[k].length <= 90, `${k} is longer than one line`);
    assert.ok(!mod.en[k].includes('·'), `${k} holds a middle dot`);
    assert.ok(!/\b(leverage|unlock|seamless|holistic|delve)/i.test(mod.en[k]), `${k} holds a filler word`);
  }
});

test('the app mounts the new panel in the side pane, with every action wired to the console route', () => {
  const pane = source.slice(source.indexOf('function makePane('), source.indexOf('const SETTINGS_SECTIONS'));
  assert.match(pane, /h\(ConsolePanel, \{/);
  assert.ok(!/h\(View, \{/.test(pane), 'the old view is no longer mounted');
  for (const kind of ['workspace', 'decision', 'verdict', 'molecullage-pin', 'prose', 'prose-rewrite', 'memory-search', 'molecullage-search', 'refresh']) assert.ok(pane.includes(`kind: "${kind}"`), `the pane does not send ${kind}`);
});
