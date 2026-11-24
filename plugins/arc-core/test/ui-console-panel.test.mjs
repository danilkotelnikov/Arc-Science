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
import { serveConsoleRoute } from '../lib/console.js';

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
// `globals` enter the page context of the panel (fetch, document, setTimeout); `pick` chooses another component than the panel.
function mount(props, { globals = {}, pick = null } = {}) {
  const states = {}, refs = {}; let i = 0, j = 0, effects = [];
  const React = { createElement, Fragment: 'fragment',
    useState: (v) => { const k = i++; if (!(k in states)) states[k] = v; return [states[k], (n) => { states[k] = typeof n === 'function' ? n(states[k]) : n; }]; },
    useRef: (v) => { const k = j++; if (!(k in refs)) refs[k] = { current: v }; return refs[k]; },
    useEffect: (fn) => { effects.push(fn); } };
  const m = loadPanel(React, globals);
  const live = { ...props };
  const render = () => { i = 0; j = 0; effects = []; const tree = expand({ type: pick ? pick(m) : m.kit.ConsolePanel, props: pick ? {} : { t, ...live }, children: [] }); for (const f of effects) f(); return tree; };
  return { render, set: (more) => Object.assign(live, more), refs };
}
const tick = () => new Promise((r) => setImmediate(r));
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
  for (const [workspace, name] of [['Research', 'Research'], ['Memory', 'Memory'], ['Molecullage', 'Figures'], ['Prose', 'Prose'], ['Unknown', 'Research']]) {
    const first = mount({ data: snap({ head: { activeWorkspace: workspace, ladderRungs: [] } }) }).render();
    assert.deepEqual(tabs(first).filter((n) => n.props['aria-selected']).map(text), [name], workspace);
  }
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

test('Research, a decision: the detail offers the other decisions, sends the chosen one, and Back returns to the list', async () => {
  const sent = [], chat = [];
  const p = mount({ data: snap(), onDecision: (r) => sent.push(r), onUseInChat: (x) => chat.push(x) });
  click(rowsOf(p.render(), 'research')[0]);
  let tree = p.render();
  const detail = all(tree, (n) => n.props?.['data-detail'])[0];
  assert.equal(detail.props['data-detail'], 'branch:b-cdr3-loop');
  assert.equal(rowsOf(tree, 'research').length, 0, 'the list gives way to the detail');
  assert.equal(text(all(detail, (n) => n.type === 'h2')[0]), 'CDR3 active-site insertion geometry');
  assert.equal(text(all(detail, (n) => has(n, 'ak-tag'))[0]), 'Decision');
  // the two operator switches of the ladder are no checks of a claim, so the scale ends at the fourth level
  assert.equal(text(all(detail, (n) => n.props?.['data-level'])[0]), 'Checked to level 2 of 4');
  const hint = all(detail, (n) => n.props?.['aria-label'] === 'About the levels')[0];
  assert.ok(hint, 'the meaning of a level sits in a hint beside the line');
  assert.equal(text(all(detail, (n) => n.type === 'p')[0]), 'Support 2.84. Value for its cost 1.42.');
  const back = all(detail, (n) => n.props?.['data-back'])[0];
  assert.equal(back.props.autoFocus, true, 'the focus moves into the detail');
  // the decision in force is not offered again
  assert.equal(button(detail, 'Pursue'), undefined);
  click(button(detail, 'Park'));
  assert.deepEqual(plain(sent), [{ branchId: 'b-cdr3-loop', action: 'Park' }]);
  await tick();
  const more = all(detail, (n) => n.props?.['aria-haspopup'] === 'menu')[0];
  assert.equal(more.props['aria-label'], 'More actions');
  assert.equal(more.props['aria-expanded'], false);
  click(more);
  tree = p.render();
  const items = all(tree, (n) => n.props?.role === 'menuitem');
  assert.deepEqual(items.map(text), ['Drop', 'Request a test']);
  click(items[1]);
  assert.deepEqual(plain(sent[1]), { branchId: 'b-cdr3-loop', action: 'Request a test' });
  await tick();
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
  assert.equal(text(all(detail, (n) => n.props?.['data-level'])[0]), 'Checked to level 1 of 4');
  const ev = rowsOf(detail, 'evidence');
  assert.deepEqual(ev.map(nameOf), ['studio/jobs/ml-explainer/compute/sizes.json']);
  assert.deepEqual(ev.map(statusOf), ['Architecture']);
  assert.deepEqual(all(detail, (n) => n.type === 'button' && n.props['aria-label'] !== 'About the levels').map(text), ['Research', 'Use in chat']);
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
    assert.deepEqual(rowsOf(detail, 'evidence').map((r) => [nameOf(r), statusOf(r)]), [['Release checks', 'Accepted']], 'the text box of the Prose view is no check of the release, so the detail does not show it as one');
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
  assert.equal(input.props.value, 'baseline');
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
    // the sample only fills the box, as in the approved preview: nothing is sent and the stored text stays
    const stored = store.snapshot().prose.text;
    click(button(tree, 'Use a sample'));
    assert.equal(calls.length, 2, 'the sample was sent as a check');
    assert.equal(store.snapshot().prose.text, stored);
    tree = p.render();
    const sample = all(tree, (n) => n.type === 'textarea')[0].props.value;
    assert.notEqual(sample, stored);
    await click(button(tree, 'Check text'));
    assert.deepEqual(calls[2], ['check', sample]);
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
  assert.equal(lines(off).Providers, 'Not reached', 'a gateway that did not answer gives no count of providers');
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

// ---- after the isolated review of f8a44a8 (S062): one test for each confirmed finding

test('Research: an action holds its buttons until the state that follows it has arrived, so a second click sends nothing', async () => {
  const sent = []; let done = null;
  const p = mount({ data: snap(), item: 'release:candidate', onVerdict: (r) => { sent.push(plain(r)); return new Promise((resolve) => { done = resolve; }); } });
  click(button(p.render(), 'Approve'));
  const held = all(p.render(), (n) => n.props?.['data-detail'])[0];
  const actions = all(held, (n) => n.type === 'button' && !n.props['data-back'] && text(n) !== 'Use in chat' && !n.props['aria-describedby'] && n.props['aria-label'] !== 'About the levels');
  assert.ok(actions.length >= 2, 'the main button and the menu button are in the detail');
  assert.ok(actions.every((n) => n.props.disabled === true), 'an action button stays live while the action is on its way');
  for (const n of actions) click(n); // a second click, also on a button that a slow page still shows as live
  assert.equal(all(p.render(), (n) => n.props?.role === 'menuitem').length, 0, 'the menu does not open while the action is on its way');
  assert.equal(sent.length, 1);
  done(true);
  await tick();
  const free = all(p.render(), (n) => n.props?.['data-detail'])[0];
  assert.ok(all(free, (n) => n.type === 'button').every((n) => !n.props.disabled));
});

test('Use in chat writes the text into the chat box of the app and says so in one status line', () => {
  const box = { tagName: 'TEXTAREA', value: '', disabled: false, readOnly: false, offsetParent: {}, closest: () => null, dispatchEvent() {}, focus() {} };
  const p = mount({ data: snap(), item: 'claim:c-1mel-contacts' }, { globals: { document: { querySelectorAll: () => [box] } } });
  click(button(p.render(), 'Use in chat')); // no onUseInChat here, as in the app
  assert.match(box.value, /PDB 1MEL forms 55 heavy-atom residue pairs/);
  assert.deepEqual(all(p.render(), (n) => n.props?.role === 'status').map(text), [mod.en['chat.ready']]);
});

test('Research: Back puts the focus on the row that was open', () => {
  const asked = []; let focused = 0;
  const p = mount({ data: snap(), item: 'branch:b-surface-patch' }, { globals: { setTimeout: (fn) => fn() } });
  p.render();
  // the first ref of the panel is its root element; the test stands in for the page
  p.refs[0].current = { querySelector: (sel) => { asked.push(sel); return { focus: () => { focused++; } }; } };
  click(all(p.render(), (n) => n.props?.['data-back'])[0]);
  assert.deepEqual(asked, ['[data-row="research"][data-id="branch:b-surface-patch"]']);
  assert.equal(focused, 1);
});

test('Prose: each kind of mark carries its own plain reason, and an unknown kind a general one', () => {
  const base = snap();
  const findings = [{ kind: 'refused-word', match: 'holistic' }, { kind: 'contrast-x-not-y', match: 'not a, but b' }, { kind: 'formulaic-phrase', match: 'a testament to' }, { kind: 'new-kind', match: 'x' }];
  const tree = mount({ view: 'prose', data: { ...base, prose: { ok: true, text: 'Some text.', report: { ok: false, findings } } } }).render();
  const reasons = rowsOf(tree, 'finding').map((r) => text(all(r, (n) => has(n, 'sub'))[0]));
  assert.deepEqual(reasons, [mod.en['pane.prose.why.word'], mod.en['pane.prose.why.contrast'], mod.en['pane.prose.why.stock'], mod.en['pane.prose.why.other']]);
  assert.equal(new Set(reasons).size, 4);
});

test('Memory: the same failure is said once, also when the state and the action both carry it', () => {
  const base = snap(), line = 'The memory gateway did not answer.';
  const tree = mount({ view: 'memory', actionError: line, data: { ...base, memory: { ...base.memory, lastQuery: 'x', results: [], error: line } } }).render();
  assert.deepEqual(alerts(tree), [line]);
});

test('Figures: a search without a hit says Nothing matches and keeps the pinned sources in view', () => {
  const base = snap();
  const tree = mount({ view: 'figures', data: { ...base, molecullage: { ...base.molecullage, query: 'zzz', items: [], pins: [{ id: 'pdb', name: 'RCSB PDB' }] } } }).render();
  assert.equal(text(all(tree, (n) => has(n, 'ak-empty'))[0]), 'Nothing matches.');
  assert.deepEqual(rowsOf(tree, 'source').map(nameOf), ['RCSB PDB Pinned']);
});

test('the evidence level of a claim reads from the dictionary, and an unknown level keeps its own word', () => {
  for (const lv of ['measured', 'published', 'simulated', 'architecture', 'target']) assert.equal(typeof mod.en[`pane.evidence.${lv}`], 'string', lv);
  const base = snap();
  const tree = mount({ data: { ...base, claims: { ok: true, items: [{ id: 'c1', text: 'One.', level: 'simulated', source: 's', rung: 'L1' }, { id: 'c2', text: 'Two.', level: 'hearsay', source: 's', rung: 'L1' }] } } }).render();
  assert.deepEqual(rowsOf(tree, 'research').slice(3, 5).map(statusOf), [mod.en['pane.evidence.simulated'], 'Hearsay']);
});

test('the side pane that the app registers runs the new panel on the console route: a decision and a text check reach the store', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-panel-'));
  try {
    const store = createResearchSessionStore({ arcHome: tmp, molecullageRoot: path.join(tmp, 'no-library'), live: false });
    const posts = [];
    const fetch = async (url, init) => { const body = JSON.parse(init.body); posts.push([String(url), body]); const out = await serveConsoleRoute(String(url), body, store); return { ok: true, json: async () => JSON.parse(JSON.stringify(out)) }; };
    const settle = async () => { for (let k = 0; k < 8; k++) await tick(); };
    let Pane = null, guide = '';
    const p = mount({}, { globals: { fetch }, pick: (m) => {
      if (!Pane) {
        const slots = { inject: (name, fn) => { fn(); return () => {}; }, register: (opts, comp) => { if (opts.name === 'sidebar.right.pane.tab') Pane = comp; return () => {}; } };
        const sidebarRightTabs = { register: (tab) => { guide = tab.guide[0].description(); return () => {}; } };
        m.apply({ effect: () => {}, locale: { register: () => {}, bind: () => t }, slots, inject: (names, fn) => { fn({ sidebarRightTabs, slots }); } });
      }
      return Pane;
    } });
    p.render();
    assert.equal(typeof Pane, 'function', 'the app got a pane component');
    assert.ok(!/connector|Settings|Molecullage/i.test(guide), `the line of the tab names parts that the panel no longer has: ${guide}`);
    await settle();
    let tree = p.render();
    assert.equal(tree.props['data-arc-panel'], 'console');
    assert.equal(rowsOf(tree, 'research').length, 6, 'the pane passes the console state to the panel');
    click(rowsOf(tree, 'research')[1]);
    click(button(p.render(), 'Pursue'));
    await settle();
    assert.equal(store.snapshot().tree.branches[1].decision, 'Pursue', 'the decision reached the store');
    assert.equal(statusOf(all(p.render(), (n) => n.props?.['data-detail'])[0]), 'Pursued');
    click(tabs(p.render()).find((n) => n.props['data-view'] === 'prose'));
    await settle();
    const draft = 'The method is not a shortcut, but a careful protocol.';
    all(p.render(), (n) => n.type === 'textarea')[0].props.onChange({ target: { value: draft } });
    await click(button(p.render(), 'Check text'));
    await settle();
    assert.equal(store.snapshot().prose.text, draft, 'the text reached the store');
    assert.ok(rowsOf(p.render(), 'finding').length >= 1);
    assert.deepEqual(posts.filter(([url]) => url === 'api/arc-core/console/action').map(([, body]) => body.kind), ['decision', 'workspace', 'prose']);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the root test command of the repository, which CI runs, lists the tests of the side panel', () => {
  const root = JSON.parse(fs.readFileSync(path.join(here, '../../../package.json'), 'utf8'));
  assert.ok(root.scripts.test.includes('plugins/arc-core/test/ui-console-panel.test.mjs'));
});

// ---- the findings carried from the second isolated review (S063)

// the pane that the app registers, on the real console route of a real store. `gate.hold` keeps the answers of the state route back.
function registered(store) {
  const posts = [], gate = { hold: null };
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body); posts.push([String(url), body]);
    if (gate.hold && String(url).endsWith('/state')) await gate.hold;
    const out = await serveConsoleRoute(String(url), body, store);
    return { ok: Boolean(out) && out.ok !== false, json: async () => JSON.parse(JSON.stringify(out)) };
  };
  let Pane = null;
  const p = mount({}, { globals: { fetch }, pick: (m) => {
    if (!Pane) {
      const slots = { inject: (name, fn) => { fn(); return () => {}; }, register: (opts, comp) => { if (opts.name === 'sidebar.right.pane.tab') Pane = comp; return () => {}; } };
      m.apply({ effect: () => {}, locale: { register: () => {}, bind: () => t }, slots, inject: (names, fn) => { fn({ sidebarRightTabs: { register: () => () => {} }, slots }); } });
    }
    return Pane;
  } });
  const settle = async () => { for (let k = 0; k < 8; k++) await tick(); };
  const kinds = () => posts.filter(([url]) => url === 'api/arc-core/console/action').map(([, body]) => body.kind);
  return { p, posts, gate, settle, kinds };
}
const tmpStore = (t0, opts = {}) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-panel-'));
  t0.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return createResearchSessionStore({ arcHome: tmp, molecullageRoot: path.join(tmp, 'no-library'), live: false, ...opts });
};
const menuOf = (node) => all(node, (n) => n.props?.['aria-haspopup'] === 'menu')[0];
const items = (tree) => all(tree, (n) => n.props?.role === 'menuitem');

test('Figures on a real store: a pinned source that the search does not return keeps its use line and its licence', (t0) => {
  const store = tmpStore(t0);
  const src = { id: 'tol', name: 'Paul Tol colour schemes', kind: 'palette', licenceClass: 'CC-BY-4.0', use: 'Colour sets that stay clear for all readers', section: 'colour' };
  assert.equal(store.toggleMolecullagePin({ source: src }).ok, true);
  const chat = [];
  const p = mount({ data: store.snapshot(), view: 'figures', onUseInChat: (x) => chat.push(x) });
  const row = rowsOf(p.render(), 'source')[0];
  assert.equal(text(all(row, (n) => has(n, 'sub'))[0]), 'Colour sets that stay clear for all readers');
  click(menuOf(row));
  click(items(p.render())[1]);
  assert.match(chat[0], /licence: CC-BY-4\.0/);
});

test('Figures: a source without a licence field says nothing about a licence', () => {
  const base = snap(), chat = [];
  const p = mount({ view: 'figures', onUseInChat: (x) => chat.push(x), data: { ...base, molecullage: { ...base.molecullage, items: [], pins: [{ id: 'old', name: 'A pin of an older store', section: 'library' }] } } });
  click(menuOf(p.render()));
  click(items(p.render())[1]);
  assert.match(chat[0], /A pin of an older store/);
  assert.ok(!/licen/i.test(chat[0]), `the text states a licence that the row does not hold: ${chat[0]}`);
});

test('the registered pane: a verdict, a rewrite and a source search reach the store, and a refused memory search keeps its one line', async (t0) => {
  const store = tmpStore(t0);
  const { p, settle, kinds } = registered(store);
  p.render(); await settle();
  click(rowsOf(p.render(), 'research')[5]);
  click(button(p.render(), 'Approve'));
  await settle();
  assert.equal(store.snapshot().verdicts['release:candidate'].verdict, 'Approve');
  click(tabs(p.render()).find((n) => n.props['data-view'] === 'prose'));
  await settle();
  const draft = 'The method is not a shortcut, but a careful protocol.';
  all(p.render(), (n) => n.type === 'textarea')[0].props.onChange({ target: { value: draft } });
  await click(button(p.render(), 'Check text')); await settle();
  await click(button(p.render(), 'Replace with plain words')); await settle();
  assert.notEqual(store.snapshot().prose.text, draft, 'the rewrite reached the store');
  click(tabs(p.render()).find((n) => n.props['data-view'] === 'figures'));
  await settle();
  all(p.render(), (n) => n.type === 'input')[0].props.onChange({ target: { value: 'tol' } });
  all(p.render(), (n) => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  await settle();
  assert.equal(store.snapshot().molecullage.query, 'tol');
  assert.equal(text(all(p.render(), (n) => has(n, 'ak-empty'))[0]), 'Nothing matches.');
  // this store has no live gateway, so it refuses a memory search with one line
  click(tabs(p.render()).find((n) => n.props['data-view'] === 'memory'));
  await settle();
  all(p.render(), (n) => n.type === 'input')[0].props.onChange({ target: { value: 'baseline' } });
  all(p.render(), (n) => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  await settle();
  assert.deepEqual(alerts(p.render()), ['Live gateway probing is turned off'], 'a refused search shows its line once and keeps it');
  assert.deepEqual(kinds(), ['verdict', 'workspace', 'prose', 'prose-rewrite', 'workspace', 'molecullage-search', 'workspace', 'memory-search']);
});

test('the registered pane: the action buttons stay held until the state that follows the action has arrived', async (t0) => {
  const store = tmpStore(t0);
  const { p, gate, settle } = registered(store);
  p.render(); await settle();
  click(rowsOf(p.render(), 'research')[1]);
  let open = null;
  gate.hold = new Promise((r) => { open = r; });
  click(button(p.render(), 'Pursue'));
  await settle();
  assert.equal(store.snapshot().tree.branches[1].decision, 'Pursue', 'the action itself is done');
  const held = all(p.render(), (n) => n.props?.['data-detail'])[0];
  assert.equal(all(held, (n) => has(n, 'primary'))[0].props.disabled, true, 'the main button is live before the new state is read');
  open(); gate.hold = null;
  await settle();
  const free = all(p.render(), (n) => n.props?.['data-detail'])[0];
  assert.equal(Boolean(all(free, (n) => has(n, 'primary'))[0].props.disabled), false);
  assert.equal(statusOf(free), 'Pursued');
});

test('the search boxes show the search that the store answered last', () => {
  const base = snap();
  const mem = mount({ view: 'memory', data: { ...base, memory: { ...base.memory, lastQuery: 'baseline', results: [] } } }).render();
  assert.equal(all(mem, (n) => n.type === 'input')[0].props.value, 'baseline');
  const fig = mount({ view: 'figures', data: { ...base, molecullage: { ...base.molecullage, query: 'tol', items: [] } } }).render();
  assert.equal(all(fig, (n) => n.type === 'input')[0].props.value, 'tol');
});

test('Memory: Nothing matches waits for the answer of the search that is on its way', async () => {
  const base = snap(); let done = null;
  const data = { ...base, memory: { ...base.memory, lastQuery: 'zzz', results: [] } };
  const p = mount({ view: 'memory', data, onSearchMemory: () => new Promise((r) => { done = r; }) });
  assert.equal(all(p.render(), (n) => has(n, 'ak-empty')).length, 1, 'an answered search without a hit says so');
  all(p.render(), (n) => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.equal(all(p.render(), (n) => has(n, 'ak-empty')).length, 0, 'the line shows although the search is still on its way');
  done({ ok: true });
  await tick();
  assert.equal(all(p.render(), (n) => has(n, 'ak-empty')).length, 1);
});

test('an error line that is cut carries the whole message in a hint; a short one has no hint', () => {
  const long = 'The gateway refused the action because the stored state is older than the request. '.repeat(3).trim();
  const withHint = mount({ data: snap(), actionError: long }).render();
  assert.ok(alerts(withHint)[0].length <= 90);
  const hint = all(withHint, (n) => n.props?.['aria-label'] === mod.en['upd.detail']);
  assert.equal(hint.length, 1);
  const p = mount({ data: snap(), actionError: long });
  click(all(p.render(), (n) => n.props?.['aria-label'] === mod.en['upd.detail'])[0]);
  assert.ok(text(all(p.render(), (n) => n.props?.role === 'note')[0]).length > 150, 'the hint holds the rest of the message');
  const short = mount({ data: snap(), actionError: 'Unknown branch: zzz' }).render();
  assert.equal(all(short, (n) => n.props?.['aria-label'] === mod.en['upd.detail']).length, 0);
});

test('the line of Use in chat leaves when the view changes', () => {
  const box = { tagName: 'TEXTAREA', value: '', disabled: false, readOnly: false, offsetParent: {}, closest: () => null, dispatchEvent() {}, focus() {} };
  const p = mount({ data: snap(), item: 'claim:c-1mel-contacts' }, { globals: { document: { querySelectorAll: () => [box] } } });
  click(button(p.render(), 'Use in chat'));
  assert.equal(all(p.render(), (n) => n.props?.role === 'status').length, 1);
  click(tabs(p.render()).find((n) => n.props['data-view'] === 'status'));
  assert.equal(all(p.render(), (n) => n.props?.role === 'status').length, 0);
});

test('the level hint opens toward the panel, because its button sits near the right edge', () => {
  const p = mount({ data: snap(), item: 'branch:b-cdr3-loop' });
  click(all(p.render(), (n) => n.props?.['aria-label'] === 'About the levels')[0]);
  const note = all(p.render(), (n) => n.props?.role === 'note')[0];
  assert.equal(note.props.style.right, 0);
  assert.equal(note.props.style.left, undefined);
  assert.match(text(note), /Level 4 is the hardest/);
});

test('the menu of the kit: it closes when the focus leaves it, the arrow keys move inside it, and a choice returns the focus to its button', () => {
  const p = mount({ data: snap(), item: 'branch:b-cdr3-loop' });
  const wrap = () => all(p.render(), (n) => has(n, 'ak-pick'))[0];
  click(menuOf(p.render()));
  const made = [0, 1].map(() => ({ focused: 0, focus() { this.focused++; } }));
  const at = (i) => ({ querySelectorAll: () => made, ownerDocument: { activeElement: made[i] } });
  wrap().props.onKeyDown({ key: 'ArrowDown', preventDefault() {}, currentTarget: at(0) });
  assert.equal(made[1].focused, 1);
  wrap().props.onKeyDown({ key: 'ArrowDown', preventDefault() {}, currentTarget: at(1) });
  assert.equal(made[0].focused, 1, 'the last entry leads to the first');
  wrap().props.onKeyDown({ key: 'ArrowUp', preventDefault() {}, currentTarget: at(0) });
  assert.equal(made[1].focused, 2, 'the first entry leads to the last');
  wrap().props.onBlur({ currentTarget: { contains: () => true }, relatedTarget: {} });
  assert.equal(items(p.render()).length, 2, 'the focus moved inside the menu');
  wrap().props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null });
  assert.equal(items(p.render()).length, 0);
  click(menuOf(p.render()));
  let back = 0;
  const trigger = { focus() { back++; } };
  items(p.render())[0].props.onClick({ currentTarget: { closest: () => ({ querySelector: () => trigger }) } });
  assert.equal(back, 1);
});

test('Status and Research: each state word has its own case, on fixtures that are not symmetric', () => {
  const base = snap();
  const lines = (tree) => Object.fromEntries(rowsOf(tree, 'statusline').map((r) => [nameOf(r), statusOf(r)]));
  const st = mount({ view: 'status', data: { ...base,
    memory: { ...base.memory, reachable: true, configured: true, recall: false, routes: ['radium'] },
    connectorsDetail: { ...base.connectorsDetail, Servers: [{ id: 'a', state: 'ok' }, { id: 'b', state: 'ok' }, { id: 'c', state: 'idle' }] },
    addons: { ok: true, items: [{ id: 'x' }] }, update: { available: false, latest: '9.9.9' } } }).render();
  assert.deepEqual(lines(st), { 'Local gateway': 'Running', Providers: 'Listed: 1', 'Tool servers': 'On: 2 of 3', Memory: 'Recall off', 'Add-ons': 'Installed: 1' });
  const branch = (id, decision) => ({ id, title: id, supportLogLR: 0, voiPerCost: 0, rung: 'L1', status: 'active', decision });
  const words = (verdict) => rowsOf(mount({ data: { ...base, tree: { ok: true, branches: [branch('a', 'Pursue'), branch('b', 'Park'), branch('c', 'Drop'), branch('d', 'Request a test'), branch('e', 'Later')] }, claims: { ok: true, items: [] }, verdicts: verdict ? { 'release:candidate': { verdict } } : {} } }).render(), 'research').map(statusOf);
  assert.deepEqual(words(''), ['Pursued', 'Parked', 'Dropped', 'Needs a test', 'Open', 'Waits for you']);
  assert.equal(words('Revise')[5], 'To revise');
  assert.equal(words('Hold')[5], 'On hold');
});

test('the fields that the test fixtures lay over the state exist in the state of a real store', () => {
  const s = snap();
  for (const k of ['lastQuery', 'results', 'error', 'reachable', 'configured', 'recall', 'routes']) assert.ok(k in s.memory, `the state has no memory.${k}`);
  for (const k of ['items', 'pins', 'query']) assert.ok(k in s.molecullage, `the state has no molecullage.${k}`);
  assert.ok(Array.isArray(s.connectorsDetail.Servers) && s.connectorsDetail.Servers.every((x) => 'state' in x));
  assert.ok(Array.isArray(s.addons.items));
  assert.ok('text' in s.prose && Array.isArray(s.prose.report.findings));
  assert.ok(Array.isArray(s.head.ladderRungs) && s.head.ladderRungs.every((r) => 'id' in r));
});
