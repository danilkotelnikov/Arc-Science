// arc-mode 0.1.0 (2026-11-07). Every home here is a scratch folder, so no test reads or writes a real settings file.
//   node --test plugins/arc-mode/test/mode.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { homes, hookScript, inventory, readMode, writeMode, promptText, measured, effect, serve, OPEN_BENCHMARKS } from '../lib/mode.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOKS = ['arc-rules', 'attention', 'cammut-mandatory', 'english-gentle-guard', 'flow-guard', 'gtrain-hook', 'no-self-reference', 'pr-review-watch', 'research-gate', 'sm'];

function scratch(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-mode-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { h: homes({}, home), home };
}

function installed(h) {
  const hooks = path.join(h.claude, 'hooks');
  fs.mkdirSync(path.join(hooks, 'research-gate'), { recursive: true });
  fs.mkdirSync(path.join(h.claude, 'scripts', 'shared-memory'), { recursive: true });
  fs.mkdirSync(path.join(h.claude, 'skills'), { recursive: true });
  const file = (name) => name === 'sm' ? path.join(h.claude, 'scripts', 'shared-memory', 'sm.mjs') : name === 'research-gate' ? path.join(hooks, 'research-gate', 'research-gate.mjs') : path.join(hooks, name + (name === 'no-self-reference' ? '.py' : '.mjs'));
  for (const n of HOOKS) fs.writeFileSync(file(n), '');
  const cmd = (n) => n === 'no-self-reference' ? `python "${file(n)}" hook` : n === 'sm' ? `"C:/Program Files/nodejs/node.exe" "${file(n)}" capture --flush` : `"C:/Program Files/nodejs/node.exe" "${file(n)}"`;
  const inline = `[ -n "$TERAX_TERMINAL" ] && printf '{"terminalSequence":"x"}' || true`;
  fs.writeFileSync(path.join(h.claude, 'settings.json'), JSON.stringify({
    env: { SOME_TOKEN: 'do-not-show-this' },
    hooks: {
      Stop: [{ hooks: [...HOOKS.map((n) => ({ type: 'command', command: cmd(n) })), { type: 'command', command: inline }] }],
      PreCompact: [{ matcher: 'x', hooks: [{ type: 'command', command: cmd('attention') }] }],
    },
  }));
  for (const s of ['pdf', 'docx', '.hidden']) fs.mkdirSync(path.join(h.claude, 'skills', s));
}

function client() {
  const source = fs.readFileSync(path.join(here, '../lib/client.js'), 'utf8');
  let loaded;
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: (m) => { loaded = m; } } } });
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) });
  const mod = loaded.factory((name) => (name === 'react' ? { createElement, Fragment: 'fragment', useState: () => [null, () => {}], useEffect: () => {} } : {}));
  return { mod, source };
}

// Expands function components, so a test reads the page as the browser gets it.
function render(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node;
  if (typeof node.type === 'function') return { from: node.type, ...render(node.type({ ...node.props, children: node.children.length === 1 ? node.children[0] : node.children })) };
  return { ...node, children: node.children.map(render) };
}
const nodes = (n) => (n && typeof n === 'object' ? [n, ...n.children.flatMap(nodes)] : []);
const words = (n) => (n && typeof n === 'object' ? n.children.flatMap(words) : n === null || n === undefined || n === false ? [] : [String(n)]);

test('hookScript names the script of a command and refuses an inline one', () => {
  assert.equal(hookScript('"C:/Program Files/nodejs/node.exe" "C:/h/arc-rules.mjs"'), 'C:/h/arc-rules.mjs');
  assert.equal(hookScript('python "C:/h/no-self-reference.py" hook'), 'C:/h/no-self-reference.py');
  assert.equal(hookScript('node /h/sm.mjs capture --flush'), '/h/sm.mjs');
  assert.equal(hookScript(`[ -n "$TERAX_TERMINAL" ] && printf '{"a":"b"}' || true`), null);
});

test('inventory lists what is on disk and shows no other field of the settings file', (t) => {
  const { h } = scratch(t);
  installed(h);
  const inv = inventory(h);
  assert.deepEqual(inv.hooks.map((k) => k.name), HOOKS);
  assert.ok(inv.hooks.every((k) => k.installed));
  assert.deepEqual(inv.hooks.find((k) => k.name === 'attention').events, ['Stop', 'PreCompact']);
  assert.equal(inv.hooks.find((k) => k.name === 'sm').file, '~/.claude/scripts/shared-memory/sm.mjs');
  assert.deepEqual(inv.skills, ['docx', 'pdf']);
  assert.ok(!JSON.stringify(inv).includes('do-not-show-this'));
  assert.ok(!JSON.stringify(inv).includes(path.basename(h.home)), 'no home path reaches the browser');
});

test('a listed hook whose file is gone shows as missing, and a broken settings file shows as unread', (t) => {
  const { h } = scratch(t);
  installed(h);
  fs.rmSync(path.join(h.claude, 'hooks', 'flow-guard.mjs'));
  assert.equal(inventory(h).hooks.find((k) => k.name === 'flow-guard').installed, false);
  fs.writeFileSync(path.join(h.claude, 'settings.json'), '{ broken');
  const inv = inventory(h);
  assert.equal(inv.hooksRead, false);
  assert.deepEqual(inv.hooks, []);
});

test('the mode is off by default, follows the store, and a broken file reads as off', (t) => {
  const { h } = scratch(t);
  assert.equal(readMode(h), false);
  writeMode(h, true);
  assert.equal(readMode(h), true);
  fs.writeFileSync(path.join(h.arc, 'arc-mode', 'mode.json'), 'not json');
  assert.equal(readMode(h), false);
});

test('the written rules reach the prompt only while the mode is on', (t) => {
  const { h } = scratch(t);
  fs.mkdirSync(path.join(h.harness, 'shared', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(h.harness, 'shared', 'rules', 'common.md'), 'the rules');
  assert.equal(promptText(h), '');
  writeMode(h, true);
  assert.equal(promptText(h), 'the rules');
  writeMode(h, false);
  assert.equal(promptText(h), '');
});

test('the route sets the mode only from a boolean', async (t) => {
  const { h } = scratch(t);
  const ask = (body) => serve(new Request('http://x/', { method: 'POST', body }), h);
  assert.equal((await ask('{}')).on, false);
  assert.equal((await ask('{"on":true}')).on, true);
  assert.equal((await ask('{"on":"no"}')).on, true);
  assert.equal((await ask('not json')).on, true);
  assert.equal((await ask('{"on":false}')).on, false);
});

test('a number needs its benchmark, model, date and sample size', () => {
  const good = { benchmark: 'B', model: 'm', date: '2026-11-07', n: 3, unit: 'runs', value: '1 of 3 passed' };
  assert.ok(measured(good));
  for (const k of ['benchmark', 'model', 'date', 'value', 'n', 'unit']) assert.ok(!measured({ ...good, [k]: undefined }), k);
  assert.ok(!measured({ ...good, date: 'undefined' }));
  assert.ok(measured({ ...good, date: '2026-11-01 to 2026-11-07' }));
  assert.ok(!measured({ ...good, n: 0 }));
  assert.ok(!measured(null));
});

test('open benchmarks show no number without a measured row, and private rows stay apart', (t) => {
  const { h } = scratch(t);
  const bench = path.join(h.harness, 'bench');
  fs.mkdirSync(bench, { recursive: true });
  assert.ok(effect(h).open.every((b) => b.rows.length === 0));
  const run = (pass, at) => JSON.stringify({ bench: 1, task: 'E1', model: 'claude-haiku-5-5', effort: 'xhigh', harness: 'on', runner: 'api', pass, at });
  fs.writeFileSync(path.join(bench, 'results.jsonl'), [run(true, '2026-11-08T01:00:00'), run(false, '2026-11-09T01:00:00')].join('\n') + '\n');
  fs.writeFileSync(path.join(bench, 'baseline.json'), JSON.stringify([{ benchmark: 'Work log', model: 'claude-sonnet-5-5', date: '2026-11-01 to 2026-11-07', n: 104, unit: 'prompts', value: '47.1%' }, { benchmark: 'No sample', model: 'm', date: '2026-11-07', unit: 'runs', value: '1%' }]));
  fs.writeFileSync(path.join(bench, 'open-results.jsonl'), JSON.stringify({ benchmark: 'BAISBench', model: 'm', date: '2026-11-09', n: 5, unit: 'runs', value: '3 of 5' }) + '\n' + JSON.stringify({ benchmark: 'Made up', model: 'm', date: '2026-11-09', n: 5, unit: 'runs', value: 'x' }) + '\n');
  const e = effect(h);
  assert.deepEqual(e.private.rows[0], { benchmark: 'Private bench 1, arm on, runner api', model: 'claude-haiku-5-5 xhigh', date: '2026-11-09', n: 2, unit: 'runs', value: '1 of 2 passed' });
  assert.equal(e.private.rows.length, 2);
  assert.equal(e.dropped, 2, 'the row with no sample and the row of an unlisted benchmark');
  assert.equal(e.open.find((b) => b.name === 'BAISBench').rows.length, 1);
  assert.ok(!JSON.stringify(e.open).includes('Private bench'));
  assert.deepEqual(e.open.map((b) => b.name), OPEN_BENCHMARKS.map((b) => b.name));
});

const data = {
  on: true,
  inventory: { rules: { file: 'shared/rules/common.md', installed: true }, hooks: [{ name: 'sm', file: '~/.claude/scripts/shared-memory/sm.mjs', installed: true, events: ['Stop'] }], skills: ['pdf'], hooksRead: true },
  effect: { open: [{ name: 'BAISBench', url: 'https://example.org', why: 'Why.', rows: [] }, { name: 'Terminal-Bench 4.0', url: 'https://example.org', why: 'Why.', rows: [{ benchmark: 'Terminal-Bench 4.0', model: 'claude-opus-5-5', date: '2026-11-09', n: 5, unit: 'runs', value: '3 of 5' }] }], private: { rows: [] }, dropped: 0 },
};
const page = (mod, d = data, onToggle = () => {}) => render({ type: mod.View, props: { data: d, t: (k, v) => (mod.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v?.[x]), onToggle }, children: [] });

test('the switch is a real switch with its state and label', () => {
  const { mod } = client();
  const asked = [];
  const sw = nodes(page(mod, data, (v) => asked.push(v))).find((n) => n.props?.role === 'switch');
  assert.equal(sw.props['aria-checked'], true);
  assert.equal(sw.props['aria-label'], 'Arc Harness mode');
  assert.equal(sw.props.style.color, 'inherit', 'a button keeps its own colour otherwise, and the switch goes dark on a dark page');
  sw.props.onClick();
  const off = nodes(page(mod, { ...data, on: false }, (v) => asked.push(v))).find((n) => n.props?.role === 'switch');
  assert.equal(off.props['aria-checked'], false);
  off.props.onClick();
  assert.deepEqual(asked, [false, true], 'a click asks for the opposite state');
});

test('the page warns when the switch is on and the rules file is missing', () => {
  const { mod } = client();
  const alerts = (d) => nodes(page(mod, d)).filter((n) => n.props?.role === 'alert').flatMap(words);
  const gone = { ...data, inventory: { ...data.inventory, rules: { ...data.inventory.rules, installed: false } } };
  assert.deepEqual(alerts(data), []);
  assert.deepEqual(alerts(gone), [mod.en['rules.missing']]);
  assert.deepEqual(alerts({ ...gone, on: false }), []);
});

test('every code string sits in a monospace rounded rectangle', () => {
  const { mod } = client();
  const all = nodes(page(mod));
  const codes = all.filter((n) => n.type === 'code');
  assert.ok(codes.every((n) => /mono/i.test(n.props.style.fontFamily) && n.props.style.borderRadius >= 4));
  const inCode = new Set(codes.flatMap(words));
  for (const s of ['shared/rules/common.md', 'sm', '~/.claude/scripts/shared-memory/sm.mjs', 'Stop', 'pdf', 'claude-opus-5-5']) assert.ok(inCode.has(s), s);
  const plain = all.filter((n) => n.type !== 'code' && !n.from).flatMap((n) => n.children.filter((c) => typeof c === 'string'));
  assert.ok(!plain.some((s) => /[\/~]|\.mjs|claude-/.test(s) && !/^https?:/.test(s)), 'a code string outside a code box: ' + plain.join(' | '));
});

test('open results and private results are separate parts, and the empty one says Not measured', () => {
  const { mod } = client();
  const tree = page(mod);
  const text = words(tree);
  const open = nodes(tree).find((n) => n.props?.['aria-label'] === 'Open benchmark results');
  const priv = nodes(tree).find((n) => n.props?.['aria-label'] === 'Private results');
  assert.ok(open && priv);
  assert.equal(words(open).filter((w) => w === 'Not measured').length, 1, 'one open benchmark has no row');
  assert.ok(words(open).includes('5 runs'));
  assert.ok(words(priv).includes('Not measured'));
  assert.ok(text.includes('These are not open benchmarks, and the work differs per model, so the rows rank nothing.'));
});

test('the copy uses sentence case, no middle dot and no blue or violet', () => {
  const { mod, source } = client();
  const names = new Set(['Arc', 'Harness', 'Claude', 'Code']);
  for (const [k, s] of Object.entries(mod.en)) {
    assert.match(s, /^[A-Z{]/, k);
    for (const w of s.split(/\s+/).slice(1)) assert.ok(!/^[A-Z]/.test(w) || names.has(w.replace(/\W/g, '')), `${k}: ${w}`);
  }
  assert.ok(!source.includes('\u00b7'));
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(blue|violet|purple|indigo)\b/i);
  for (const b of OPEN_BENCHMARKS) assert.ok(!b.why.includes('\u00b7'));
});

test('the section registers as Advanced in the settings slot', () => {
  const { mod } = client();
  const got = [];
  mod.apply({
    effect: (f) => f(),
    locale: { register: () => () => {}, bind: () => (k) => mod.en[k] ?? k },
    slots: { inject: (name, f) => { got.push(name); return f(); }, register: (row) => { got.push(row); return () => {}; } },
  });
  assert.equal(got[0], 'settings.section');
  assert.equal(got[1].name, 'settings.section');
  assert.equal(got[1].id, 'advanced');
  assert.equal(got[1].label(), 'Advanced');
});
