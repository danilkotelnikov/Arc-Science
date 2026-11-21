// arc-core UI panel tests (2026-11-09): C2 console, 3-pane Research session, Decision map,
// 30-day consent dialog, Sentence case naming, zero-blue/zero-overplate, and 3-theme verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  apply,
  createResearchSessionStore,
  serveConsoleRoute,
} from '../lib/index.js';
import { gatewayStatus } from '../lib/console.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const panelPath = path.join(here, '../ui/panel.js');
const themePath = path.join(here, '../../arc-theme/lib/client/index.js');

function loadPanel() {
  const source = fs.readFileSync(panelPath, 'utf8');
  let loaded;
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (m) => { loaded = m; } } },
  });
  const createElement = (type, props, ...children) => ({
    type,
    props: props ?? {},
    children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
  });
  const mod = loaded.factory((name) =>
    name === 'react'
      ? { createElement, Fragment: 'fragment', useState: (v) => [v, () => {}], useEffect: () => {} }
      : {},
  );
  return { mod, source };
}

function loadThemes() {
  const source = fs.readFileSync(themePath, 'utf8');
  let loaded;
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (m) => { loaded = m; } } },
    document: {},
    localStorage: {},
  });
  return loaded.factory(() => ({ createElement: () => null, useState: () => [null, () => {}], useEffect: () => {} }));
}

function renderTree(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node;
  if (typeof node.type === 'function') {
    const childProp = node.children.length === 1 ? node.children[0] : node.children;
    return renderTree(node.type({ ...node.props, children: childProp }));
  }
  return { ...node, children: (node.children || []).map(renderTree) };
}

function allNodes(n) {
  if (!n || typeof n !== 'object') return [];
  return [n, ...(n.children || []).flatMap(allNodes)];
}

function allWords(n) {
  if (n === null || n === undefined || n === false) return [];
  if (typeof n !== 'object') return [String(n)];
  return (n.children || []).flatMap(allWords);
}

function hasFullBoxBorder(style = {}) {
  return Boolean(style && typeof style.border === 'string' && style.border !== 'none' && !style.border.startsWith('0'));
}

function countNestedBorderedBoxes(node, ancestorBordered = false) {
  if (!node || typeof node !== 'object') return 0;
  const own = hasFullBoxBorder(node.props?.style);
  let count = own && ancestorBordered ? 1 : 0;
  for (const ch of node.children || []) {
    count += countNestedBorderedBoxes(ch, ancestorBordered || own);
  }
  return count;
}

function makeTranslator(dict) {
  return (k, v) => (dict[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => String(v?.[x] ?? ''));
}

test('1. Built-in session read routes (head, timeline, tree, decisions) mount via Cordis connection.fetch with c.effect', async () => {
  const registered = new Map();
  const effects = [];
  let injectedDeps = null;
  const srv = apply({
    tools: { register: () => {} },
    inject: (deps, fn) => {
      injectedDeps = deps;
      return fn({
        get: (serviceName) =>
          serviceName === 'connection'
            ? {
                fetch: {
                  register(cfg) {
                    registered.set(cfg.path, cfg);
                    return () => {};
                  },
                },
              }
            : null,
        effect: (mountFn, label) => {
          effects.push(label);
          mountFn();
        },
      });
    },
  });

  assert.deepEqual(injectedDeps, ['connection']);
  assert.equal(effects.length, 8);

  for (const route of [
    '/api/arc-core/session/head',
    '/api/arc-core/session/timeline',
    '/api/arc-core/session/tree',
    '/api/arc-core/session/decisions',
    '/api/arc-core/console/state',
    '/api/arc-core/console/action',
    '/api/arc-core/update/state',
    '/api/arc-core/update/action',
  ]) {
    assert.ok(registered.has(route), `missing route ${route}`);
    const cfg = registered.get(route);
    assert.deepEqual(cfg.methods, ['GET', 'POST']);
    assert.equal(cfg.requestBody, 'buffered');
  }

  const headRes = await registered.get('/api/arc-core/session/head').fetch(
    new Request('http://127.0.0.1/api/arc-core/session/head'),
  );
  assert.equal(headRes.headers.get('cache-control'), 'no-store');
  const headJson = await headRes.json();
  assert.equal(headJson.ok, true);
  assert.deepEqual(headJson.workspaces, ['Research', 'Memory', 'Molecullage', 'Prose']);
  assert.deepEqual(headJson.connectors, ['Servers', 'Keys', 'Apps', 'Audit', 'Updates']);
  assert.deepEqual(headJson.seats, ['Planner', 'Reviewer', 'Falsifier', 'Vision', 'Prose']);
  assert.equal(headJson.ladderRungs.find((r) => r.id === 'L5').active, false);
  assert.equal(headJson.ladderRungs.find((r) => r.id === 'L6').active, false);

  const treeRes = await registered.get('/api/arc-core/session/tree').fetch(
    new Request('http://127.0.0.1/api/arc-core/session/tree'),
  );
  const treeJson = await treeRes.json();
  assert.equal(treeJson.branches.length, 3);
  assert.ok(srv.console);
});

test('2. 3-pane Research session renders Seats, Map, Claims, Evidence, Release, and Decision map actions', () => {
  const { mod } = loadPanel();
  const t = makeTranslator(mod.en);
  const store = createResearchSessionStore();
  let lastDecision = null;

  const tree = renderTree({
    type: mod.View,
    props: {
      data: store.snapshot(),
      failed: false,
      skin: 'arc',
      t,
      onDecision: (d) => {
        lastDecision = d;
        store.recordDecision(d);
      },
    },
    children: [],
  });

  const nodes = allNodes(tree);
  assert.ok(nodes.some((n) => n.props?.['data-research-three-pane'] === 'true'));
  assert.ok(nodes.some((n) => n.props?.['data-research-seats'] === 'true'));
  for (const seat of ['Planner', 'Reviewer', 'Falsifier', 'Vision', 'Prose']) {
    assert.ok(nodes.some((n) => n.props?.['data-seat'] === seat), `missing seat ${seat}`);
  }
  for (const pane of ['Map', 'Claims', 'Evidence']) {
    assert.ok(nodes.some((n) => n.props?.['data-pane'] === pane), `missing pane ${pane}`);
  }
  assert.ok(allWords(tree).some((w) => w.includes('6.54 GB (8.2% of an 80 GB NVIDIA A100)')));

  for (const action of ['Pursue', 'Park', 'Drop', 'Request a test']) {
    const btn = nodes.find((n) => n.props?.['data-decision-action'] === action && n.props?.['data-branch-id'] === 'b-surface-patch');
    assert.ok(btn, `missing decision button ${action}`);
  }

  const reqBtn = nodes.find((n) => n.props?.['data-decision-action'] === 'Request a test' && n.props?.['data-branch-id'] === 'b-surface-patch');
  reqBtn.props.onClick();
  assert.deepEqual({ ...lastDecision }, { branchId: 'b-surface-patch', action: 'Request a test' });
  assert.equal(store.tree().branches.find((b) => b.id === 'b-surface-patch').decision, 'Request a test');

  store.selectResearchView('Release');
  const releaseTree = renderTree({
    type: mod.View,
    props: { data: store.snapshot(), failed: false, skin: 'arc', t },
    children: [],
  });
  assert.ok(allNodes(releaseTree).some((n) => n.props?.['data-pane'] === 'Release'));
});

test('3. 30-day consent dialog supports Single action, Grant for 30 days, expiry, and Revoke', async () => {
  const { mod } = loadPanel();
  const t = makeTranslator(mod.en);
  let fakeNow = 1_000_000;
  const store = createResearchSessionStore({ now: () => fakeNow });

  const tree = renderTree({
    type: mod.View,
    props: {
      data: store.snapshot(),
      failed: false,
      skin: 'arc',
      pendingConsent: { appId: 'servers-connector', scopes: ['read', 'verify'] },
      onConsent: (req) => store.applyConsent(req),
      t,
    },
    children: [],
  });

  const nodes = allNodes(tree);
  const dialog = nodes.find((n) => n.props?.role === 'dialog');
  assert.ok(dialog, 'consent dialog rendered');
  assert.equal(dialog.props['aria-label'], 'Connector consent');

  const grantBtn = nodes.find((n) => n.props?.['data-consent-mode'] === 'Grant for 30 days');
  assert.ok(grantBtn);
  grantBtn.props.onClick();

  assert.equal(store.listActiveGrants().length, 1);
  assert.equal(store.listActiveGrants()[0].appId, 'servers-connector');

  // After 31 days, 30-day grant expires automatically
  fakeNow += 31 * 86_400 * 1000;
  assert.equal(store.listActiveGrants().length, 0);

  // Re-grant and explicitly revoke
  await serveConsoleRoute('/api/arc-core/console/action', {
    kind: 'consent',
    appId: 'keys-connector',
    scopes: ['read'],
    mode: 'Grant for 30 days',
  }, store);
  assert.equal(store.listActiveGrants().length, 1);

  const revokeBtn = nodes.find((n) => n.props?.['data-consent-mode'] === 'Revoke');
  assert.ok(revokeBtn);
  await serveConsoleRoute('/api/arc-core/console/action', {
    kind: 'consent',
    appId: 'keys-connector',
    mode: 'Revoke',
  }, store);
  assert.equal(store.listActiveGrants().length, 0);
});

test('4. Workspaces, Connectors, local Prose rewrite, and Settings render with Sentence case, zero blue, and zero overplating across all 3 themes', () => {
  const { mod, source } = loadPanel();
  const themeExp = loadThemes();
  const t = makeTranslator(mod.en);
  const store = createResearchSessionStore();

  // Zero hardcoded hex/rgb/hsl/oklch or blue words or middle dots/bullets in panel.js source
  assert.ok(!source.includes('\u00b7') && !source.includes('\u2022'), 'no middle dots or bullet characters');
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|(?<!var\(--)\b(blue|violet|purple|indigo)\b/i);

  // Verify non-colliding guide order 25 on sidebar registration
  let registeredGuideOrder = null;
  mod.apply({
    effect: () => {},
    locale: { register: () => {}, bind: () => t },
    inject: (_deps, fn) =>
      fn({
        sidebarRightTabs: {
          register: (cfg) => {
            registeredGuideOrder = cfg.guide?.[0]?.order;
            return () => {};
          },
        },
        slots: { inject: () => () => {}, register: () => () => {} },
      }),
  });
  assert.equal(registeredGuideOrder, 25);

  // Sentence case check on all UI dictionary strings (first word capitalized, no ALL-CAPS shouting)
  for (const [k, val] of Object.entries(mod.en)) {
    assert.ok(/^[A-Z]/.test(val), `dictionary ${k} starts with capital letter`);
    assert.ok(!/[A-Z]{2,}/.test(val), `dictionary ${k} avoids ALL-CAPS shouting`);
  }

  // Test across all three themes: Arc Harness (arc), Black and white (v0), Radium (radium)
  for (const skinId of ['arc', 'v0', 'radium']) {
    const skinDef = themeExp.SKINS[skinId];
    assert.ok(skinDef, `theme ${skinId} exists in arc-theme`);
    for (const mode of ['light', 'dark']) {
      const bg = skinDef.tokens['--dsw-alias-bg-base'][mode];
      const inkKey = mode === 'light' ? '--dsw-static-neutral-bluish-1000' : '--dsw-static-neutral-bluish-50';
      const fg = skinDef.tokens[inkKey][mode];
      const btnFill = skinDef.tokens['--dsw-alias-button-info-fill'][mode];
      assert.match(bg, /^#[0-9a-f]{6}$/i);
      assert.match(fg, /^#[0-9a-f]{6}$/i);
      assert.match(btnFill, /^#[0-9a-f]{6}$/i);
    }

    for (const ws of ['Research', 'Memory', 'Molecullage', 'Prose']) {
      store.selectWorkspace(ws);
      if (ws === 'Prose') {
        store.updateProseDraft('This is not a toy, but a direct structure check that we delve into seamlessly.');
      }
      const tree = renderTree({
        type: mod.View,
        props: {
          data: store.snapshot(),
          failed: false,
          skin: skinId,
          pendingConsent: { appId: 'apps-connector', scopes: ['read'] },
          onProseRewrite: () => store.rewriteProseDraft(),
          t,
        },
        children: [],
      });
      assert.equal(tree.props['data-arc-skin'], skinId);
      assert.equal(countNestedBorderedBoxes(tree), 0, `zero nested bordered boxes in ${skinId}/${ws}`);
      if (ws === 'Prose') {
        assert.ok(allWords(tree).includes('Formulaic phrasing detected'));
        const rewriteBtn = allNodes(tree).find((n) => n.props?.['data-prose-rewrite'] === 'true');
        assert.ok(rewriteBtn, 'local prose rewrite button rendered');
        rewriteBtn.props.onClick();
        const cleanedTree = renderTree({
          type: mod.View,
          props: { data: store.snapshot(), failed: false, skin: skinId, t },
          children: [],
        });
        assert.ok(allWords(cleanedTree).includes('Clean plain prose'));
      }
    }

    for (const conn of ['Servers', 'Keys', 'Apps', 'Audit', 'Updates']) {
      store.selectConnector(conn);
      const connTree = renderTree({
        type: mod.View,
        props: {
          data: store.snapshot(),
          failed: false,
          skin: skinId,
          onSelectConnector: (c) => store.selectConnector(c),
          t,
        },
        children: [],
      });
      const nodes = allNodes(connTree);
      const activeBtn = nodes.find((n) => n.props?.['data-connector'] === conn);
      assert.equal(activeBtn.props.role, 'tab', `${conn} is a tab`);
      assert.equal(activeBtn.props['aria-selected'], true, `${conn} tab selected`);
      assert.equal(activeBtn.props.style.fontWeight, 600, `${conn} tab highlighted`);
      assert.ok(nodes.some((n) => n.props?.['data-connector-view'] === conn), `${conn} connector view rendered`);
      assert.equal(countNestedBorderedBoxes(connTree), 0, `zero nested bordered boxes in ${skinId}/connector:${conn}`);
    }

    store.toggleSettings(true);
    const settingsTree = renderTree({
      type: mod.View,
      props: { data: store.snapshot(), failed: false, skin: skinId, t },
      children: [],
    });
    const text = allWords(settingsTree);
    const expectedLabel = skinId === 'arc' ? 'Arc Harness' : skinId === 'v0' ? 'Black and white' : 'Radium';
    assert.ok(text.includes(expectedLabel), `Settings displays ${expectedLabel}`);
    assert.equal(countNestedBorderedBoxes(settingsTree), 0);
    store.toggleSettings(false);
  }
});

test('5. Plugin bundle files (cordis.patch.yml, icon.svg) and ~/.arc/local-plugins/arc-core stay in sync', () => {
  const pluginRoot = path.join(here, '..');
  const patchFile = path.join(pluginRoot, 'cordis.patch.yml');
  const iconFile = path.join(pluginRoot, 'icon.svg');
  assert.equal(fs.existsSync(patchFile), true, 'cordis.patch.yml exists');
  assert.equal(fs.existsSync(iconFile), true, 'icon.svg exists');
  const iconSvg = fs.readFileSync(iconFile, 'utf8');
  assert.match(iconSvg, /viewBox="0 0 24 24"/);
  assert.doesNotMatch(iconSvg, /#[0-9a-f]{3,8}\b|<image\b/i);

  const localDir = path.join(os.homedir(), '.arc', 'local-plugins', 'arc-core');
  if (!fs.existsSync(localDir)) return;
  for (const rel of ['package.json', 'cordis.patch.yml', 'icon.svg', 'lib/index.js', 'lib/console.js', 'ui/panel.js']) {
    const localFile = path.join(localDir, rel);
    const repoFile = path.join(pluginRoot, rel);
    assert.equal(fs.existsSync(localFile), true, `${rel} synced to ~/.arc/local-plugins/arc-core`);
    assert.equal(fs.readFileSync(localFile, 'utf8'), fs.readFileSync(repoFile, 'utf8'), `${rel} matches repo`);
  }
});

test('6. Console action handles owner notes, verdicts, pins, non-blocking retain, and composer insertion', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-cn-')), eq = assert.equal;
  try {
    const cm = [], st = createResearchSessionStore({ arcHome: tmpDir, live: true, fetch: async (u, i) => String(u).includes('/cammut/mcp') ? (cm.push(JSON.parse(i.body)), { ok: true, text: async () => '{"result":{"content":[{"text":"{}"}]}}' }) : { ok: false, json: async () => ({}) } });
    const act = (b) => serveConsoleRoute('/api/arc-core/console/action', b, st);
    eq((await act({ kind: 'verdict', targetType: 'branch', targetId: 'b-cdr3-loop', verdict: 'Unknown' })).ok, false);
    eq((await act({ kind: 'verdict', targetType: 'branch', targetId: 'b-cdr3-loop', verdict: 'constructor' })).ok, false);
    const rel = await act({ kind: 'verdict', targetType: 'release', targetId: 'candidate', verdict: 'Approve' });
    eq(rel.ok, true); eq(rel.key, 'release:candidate'); eq(st.snapshot().verdicts['release:candidate'].verdict, 'Approve');
    const nRes = await act({ kind: 'note', targetType: 'branch', targetId: 'b-cdr3-loop', text: 'CDR3 Bearer secretToken123456789012', retain: true });
    eq(nRes.ok, true); eq(nRes.saved, true); eq(nRes.retained.ok, true); assert.ok(!nRes.note.text.includes('secretToken123456789012')); eq(cm.length, 1);
    const vRes = await act({ kind: 'verdict', targetType: 'branch', targetId: 'b-cdr3-loop', verdict: 'Approve', note: 'Ready' });
    eq(vRes.ok, true); eq(vRes.review.verdict, 'Approve');
    const pRes = await act({ kind: 'molecullage-pin', source: { id: 'pdb-1mel', name: 'PDB 1MEL', section: 'structure', doi: '10.1038/nsb0996-803' } });
    eq(pRes.ok, true); eq(pRes.pinned, true); eq(pRes.pins.length, 1);
    const snap = createResearchSessionStore({ arcHome: tmpDir, live: false }).snapshot();
    eq(snap.notes.items.length, 2); eq(snap.verdicts['branch:b-cdr3-loop'].verdict, 'Approve'); eq(snap.molecullage.pins.length, 1);
    let loaded, clip = '', cVal = '', evN = 0;
    const cEl = { tagName: 'TEXTAREA', value: '', disabled: false, offsetParent: {}, closest: () => null, dispatchEvent: (e) => { if (e.type === 'input') evN += 1; }, focus: () => {} };
    Object.defineProperty(cEl, 'value', { get: () => cVal, set: (v) => { cVal = v; }, configurable: true });
    const pEl = { tagName: 'TEXTAREA', value: 'inside', offsetParent: {}, closest: (s) => (s === '[data-arc-plugin-pane="true"]' ? {} : null) };
    vm.runInNewContext(fs.readFileSync(panelPath, 'utf8'), {
      window: { __ModuleLoader__: { load: (m) => { loaded = m; } } }, navigator: { clipboard: { writeText: (s) => ((clip = s), Promise.resolve()) } },
      document: { querySelectorAll: () => [pEl, cEl] }, Event: class { constructor(type, opts) { this.type = type; this.opts = opts; } },
    });
    const ce = (type, props, ...ch) => ({ type, props: props ?? {}, children: ch.flat(Infinity).filter((c) => c != null && c !== false) });
    let states = [], idx = 0;
    const mod = loaded.factory((n) => n === 'react' ? { createElement: ce, Fragment: 'fragment', useState: (i0) => { const i = idx++; if (!(i in states)) states[i] = typeof i0 === 'function' ? i0() : i0; return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; }, useEffect: () => {} } : {});
    const t = makeTranslator(mod.en), acts = [];
    const ren = (ex = {}) => { idx = 0; return renderTree({ type: mod.View, props: { data: { ...snap, ...ex }, failed: false, skin: 'arc', onAnnotateVerdict: (r) => acts.push({ kind: 'verdict', ...r }), onAddNote: (r) => acts.push({ kind: 'note', ...r }), onPinSource: (r) => acts.push({ kind: 'molecullage-pin', ...r }), t }, children: [] }); };
    const rTree = ren(); eq(countNestedBorderedBoxes(rTree), 0);
    const rNodes = allNodes(rTree), revBtn = rNodes.find((n) => n.props?.['data-verdict-action'] === 'Revise' && n.props?.['data-branch-id'] === 'b-cdr3-loop');
    assert.ok(revBtn); revBtn.props.onClick(); eq(acts[0].kind, 'verdict'); eq(acts[0].verdict, 'Revise');
    const chatBtn = rNodes.find((n) => n.props?.['data-use-chat'] === 'branch:b-cdr3-loop'); assert.ok(chatBtn); chatBtn.props.onClick();
    assert.ok(cVal.includes('CDR3 active-site insertion geometry')); eq(clip, cVal); eq(evN, 1); eq(pEl.value, 'inside');
    cVal = 'Existing draft'; chatBtn.props.onClick(); assert.ok(cVal.startsWith('Existing draft\n\n'));
    let ls = null; const le = { isContentEditable: true, textContent: 'Bold line', closest: () => null, __lexicalEditor: { getEditorState: () => ({ toJSON: () => ({ root: { children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Bold line', format: 1 }] }], direction: null, format: '', indent: 0, type: 'root', version: 1 } }) }), parseEditorState: (j) => JSON.parse(j), setEditorState: (s) => { ls = s; }, focus: () => {} } };
    let ld; vm.runInNewContext(fs.readFileSync(panelPath, 'utf8'), { window: { __ModuleLoader__: { load: (m) => { ld = m; } } }, document: { querySelectorAll: () => [le] } });
    assert.equal(ld.factory((n) => n === 'react' ? { createElement: ce, Fragment: 'fragment', useState: (i0) => [i0, () => {}], useEffect: () => {} } : {}).pushToChatComposer('New ctx'), true);
    assert.equal(ls.root.children[0].children[0].format, 1); assert.ok(ls.root.children.at(-1).children[0].text.includes('New ctx'));
    const mTree = ren({ head: { ...snap.head, activeWorkspace: 'Molecullage' }, molecullage: { ...snap.molecullage, items: [{ id: 'pdb-1mel', name: 'PDB 1MEL', kind: 'molecular', section: 'structure', licenceClass: 'CC0', use: 'VH' }] } });
    eq(countNestedBorderedBoxes(mTree), 0);
    const pinBtn = allNodes(mTree).find((n) => n.props?.['data-molecullage-pin'] === 'pdb-1mel'); assert.ok(pinBtn);
    pinBtn.props.onClick(); eq(acts.at(-1).kind, 'molecullage-pin');
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test('7. Updates connector: status line, mode buttons, actions, progress, restart prompt, release notes; helper text lives in Hint popovers', () => {
  const { mod, source } = loadPanel();
  const en = makeTranslator(mod.en);
  const view = (info, error) => renderTree({ type: mod.UpdatesView, props: { info, error, pending: false, onAction: () => {}, t: en }, children: [] });
  const base = { installed: '0.6.0', latest: '0.6.0', available: false, installable: true, mode: 'notify', phase: 'idle', busy: false, hasBackup: false, notes: '', restartNeeded: false };
  const find = (tree, key) => allNodes(tree).find((n) => n.props && n.props[key] !== undefined);
  const text = (n) => allWords(n).join(' ');
  const btn = (tree, key, val) => allNodes(tree).find((n) => n.type === 'button' && n.props[key] === (val ?? 'true'));

  let tree = view(base);
  assert.match(text(find(tree, 'data-updates-status')), /up to date/i);
  assert.equal(text(find(tree, 'data-updates-versions')).includes('0.6.0'), true);
  assert.equal(btn(tree, 'data-update-install').props.disabled, true, 'nothing newer: Update now is disabled');
  assert.equal(btn(tree, 'data-update-rollback').props.disabled, true, 'no backup: Roll back is disabled');
  assert.equal(btn(tree, 'data-update-mode', 'notify').props['aria-pressed'], true);
  assert.equal(btn(tree, 'data-update-mode', 'auto').props['aria-pressed'], false);

  tree = view({ ...base, latest: '0.7.0', available: true, notes: 'Notes for 0.7.0', hasBackup: true });
  assert.match(text(find(tree, 'data-updates-status')), /0\.7\.0 is ready/);
  assert.equal(btn(tree, 'data-update-install').props.disabled, false);
  assert.equal(btn(tree, 'data-update-rollback').props.disabled, false);
  assert.ok(find(tree, 'data-updates-notes'), 'release notes show');
  const calls = [];
  const onClick = btn(tree, 'data-update-mode', 'auto').props.onClick;
  assert.equal(typeof onClick, 'function');

  tree = view({ ...base, latest: '0.7.0', available: true, installable: false });
  assert.match(text(find(tree, 'data-updates-status')), /no installable kit/i);
  assert.equal(btn(tree, 'data-update-install').props.disabled, true);

  tree = view({ ...base, latest: '0.7.0', available: true, busy: true, phase: 'verifying', message: 'Checking the checksum and every file' });
  assert.ok(find(tree, 'data-updates-progress'), 'progress phases show while an update runs');
  assert.equal(allNodes(tree).find((n) => n.props && n.props.role === 'progressbar').props['aria-valuenow'], 2);
  assert.equal(btn(tree, 'data-update-check').props.disabled, true);
  assert.match(text(find(tree, 'data-updates-why')), /running/i);

  tree = view({ ...base, installed: '0.7.0', latest: '0.7.0', phase: 'done', restartNeeded: true, hasBackup: true });
  assert.ok(find(tree, 'data-updates-restart'), 'a restart prompt, never a silent close');

  // R005: the visible one-line texts are at most 90 characters; the long explanations sit in Hint popovers
  const long = 'x'.repeat(200);
  const lineTexts = ['data-updates-status', 'data-updates-why'].map((k) => text(find(view({ ...base, busy: true }, long), k)));
  for (const l of lineTexts) assert.ok(l.length <= 90, `${l.length} chars: ${l}`);
  assert.equal(allNodes(view(base)).filter((n) => n.props && n.props['data-hint'] === 'true').length >= 4, true);
  for (const k of Object.keys(mod.en).filter((x) => x.startsWith('updates.hint.'))) assert.ok(mod.en[k].length > 40);
  for (const [k, v] of Object.entries(mod.en).filter(([x]) => /^updates\.(status|why)\./.test(x))) assert.ok(v.length <= 90, `${k}: ${v.length}`);
  void calls; void source;
});

test('8. Updates panel source: no blue or violet, no default blue controls, no middle dot, no HTML injection', () => {
  const { source } = loadPanel();
  const start = source.indexOf('// ---- Updates connector'), end = source.indexOf('function ConnectorView');
  const part = source.slice(start, end);
  assert.ok(part.length > 1000);
  assert.equal(/·|·/.test(part), false, 'no middle dot');
  assert.equal(/dangerouslySetInnerHTML|innerHTML/.test(part), false, 'notes are plain text');
  assert.equal(/type:\s*"radio"|<progress|type:\s*"range"/.test(part), false, 'no browser-default blue radio, progress or range');
  assert.equal(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/.test(part), false, 'colours come from theme tokens, never from literals');
  assert.equal(/\b(blue|purple|violet|indigo|navy)\b/i.test(part), false);
  assert.match(part, /outline:2px solid currentColor/, 'own focus ring, not the default blue one');
});

// ---- Console rework (road map 1b.4, sub-step T4; D-20261120-28): top controls, status rows, Settings sections.
// the visible text of a tree: every string leaf outside a style element
const leaves = (n) => (n === null || n === undefined || n === false ? [] : typeof n !== 'object' ? [String(n)] : n.type === 'style' ? [] : (n.children || []).flatMap(leaves));
const noSecretFields = (nodes) => nodes.every((n) => n.props?.type !== 'password');

test('9. Console navigation has at most six top-level controls, tab roles, a second row for connectors and arrow-key focus', () => {
  const { mod } = loadPanel();
  const t = makeTranslator(mod.en);
  const store = createResearchSessionStore({ live: false });
  let refreshed = 0;
  const render = () => renderTree({
    type: mod.View,
    props: {
      data: store.snapshot(), failed: false, skin: 'arc', t,
      onSelectWorkspace: (w) => store.selectWorkspace(w),
      onSelectConnector: (c) => store.selectConnector(c),
      onToggleSettings: (o) => store.toggleSettings(o),
      onRefresh: () => { refreshed += 1; },
    },
    children: [],
  });
  const topOf = (nodes) => nodes.filter((n) => n.props?.['data-top-control']);

  let tree = render();
  let nodes = allNodes(tree);
  assert.deepEqual(topOf(nodes).map((n) => n.props['data-top-control']), ['Research', 'Memory', 'Molecullage', 'Prose', 'Connectors', 'Settings']);
  const primary = nodes.find((n) => n.props?.['data-console-tabs'] === 'primary');
  assert.equal(primary.props.role, 'tablist');
  assert.ok(primary.props['aria-label']);
  const tabs = allNodes(primary).filter((n) => n.props?.role === 'tab');
  assert.equal(tabs.length, 5);
  assert.deepEqual(tabs.filter((n) => n.props['aria-selected'] === true).map((n) => n.props['data-top-control']), ['Research']);
  for (const tab of tabs) assert.equal(tab.props.tabIndex, tab.props['aria-selected'] ? 0 : -1, 'only the selected tab is in the Tab order');
  const panel = nodes.find((n) => n.props?.role === 'tabpanel');
  assert.equal(panel.props['aria-labelledby'], tabs[0].props.id);
  assert.equal(tabs[0].props['aria-controls'], panel.props.id);
  // workspace mode: one row, no loose footer, no access line
  assert.equal(nodes.some((n) => n.props?.['data-console-tabs'] === 'connectors'), false);
  assert.equal(nodes.some((n) => n.type === 'footer'), false);
  assert.ok(!leaves(tree).some((w) => /Connector view|30-day grants/.test(w)));

  // an update that is ready shows on the Connectors tab in every workspace, not only in the second row
  assert.equal(tabs.find((n) => n.props['data-top-control'] === 'Connectors').props['aria-label'], undefined);
  const withUpdate = allNodes(renderTree({ type: mod.View, props: { data: { ...store.snapshot(), update: { available: true, latest: '0.7.0' } }, failed: false, skin: 'arc', t }, children: [] }));
  const connTab = withUpdate.find((n) => n.props?.['data-top-control'] === 'Connectors');
  assert.equal(connTab.props['aria-label'], 'Connectors, version 0.7.0 is available');
  assert.ok(allNodes(connTab).some((n) => n.props?.['data-state'] === 'attention'));
  // a connector without its own view still has a title and an empty line (the Cammut entry of the open change)
  assert.ok(mod.en['view.cammut'] && mod.en['empty.cammut']);

  // the Connectors tab opens the second row, built from the CONNECTORS list
  tabs.find((n) => n.props['data-top-control'] === 'Connectors').props.onClick();
  assert.equal(store.head().activePaneMode, 'connector');
  tree = render();
  nodes = allNodes(tree);
  const second = nodes.find((n) => n.props?.['data-console-tabs'] === 'connectors');
  assert.equal(second.props.role, 'tablist');
  const subTabs = allNodes(second).filter((n) => n.props?.role === 'tab');
  assert.deepEqual(subTabs.map((n) => n.props['data-connector']), ['Servers', 'Keys', 'Apps', 'Audit', 'Updates']);
  assert.deepEqual(allNodes(nodes.find((n) => n.props?.['data-console-tabs'] === 'primary')).filter((n) => n.props?.['aria-selected'] === true).map((n) => n.props['data-top-control']), ['Connectors']);
  assert.equal(topOf(nodes).length, 6);
  // Refresh sits in the title row of the view it refreshes
  const refresh = nodes.find((n) => n.props?.['data-refresh-console'] === 'true');
  assert.ok(refresh && !refresh.props['data-top-control']);
  refresh.props.onClick();
  assert.equal(refreshed, 1);

  // the Cammut tab of the open change fits into the second row beside Updates
  mod.CONNECTORS.push('Cammut');
  nodes = allNodes(render());
  assert.deepEqual(allNodes(nodes.find((n) => n.props?.['data-console-tabs'] === 'connectors')).filter((n) => n.props?.role === 'tab').map((n) => n.props['data-connector']), ['Servers', 'Keys', 'Apps', 'Audit', 'Updates', 'Cammut']);
  assert.equal(topOf(nodes).length, 6);
  mod.CONNECTORS.length = 5;

  // arrow keys move focus and wrap; they select nothing (each selection is a server call)
  const focused = [];
  const fake = ['a', 'b', 'c'].map((id) => ({ id, focus: () => focused.push(id) }));
  const key = (k, target) => { let stopped = false; primary.props.onKeyDown({ key: k, target, currentTarget: { querySelectorAll: () => fake }, preventDefault: () => { stopped = true; } }); return stopped; };
  const before = store.head().activeWorkspace;
  assert.equal(key('ArrowRight', fake[1]), true);
  assert.equal(key('ArrowRight', fake[2]), true);
  assert.equal(key('ArrowLeft', fake[0]), true);
  assert.equal(key('Home', fake[2]), true);
  assert.equal(key('End', fake[0]), true);
  assert.equal(key('a', fake[0]), false);
  assert.deepEqual(focused, ['c', 'a', 'c', 'a', 'c']);
  assert.equal(store.head().activeWorkspace, before);

  // the gear opens the console settings; its switches are real switches
  nodes.find((n) => n.props?.['data-top-control'] === 'Settings').props.onClick();
  assert.equal(store.head().settingsOpen, true);
  nodes = allNodes(render());
  const gear = nodes.find((n) => n.props?.['data-top-control'] === 'Settings');
  assert.equal(gear.props['aria-pressed'], true);
  assert.ok(gear.props['aria-label']);
  const settingsPanel = nodes.find((n) => n.props?.id === 'arc-console-panel');
  assert.equal(settingsPanel.props.role, 'region', 'no tab is selected, so the content is a plain region');
  assert.equal(settingsPanel.props['aria-labelledby'], gear.props.id);
  assert.equal(nodes.filter((n) => n.props?.role === 'tab' && n.props.tabIndex === 0).length, 1, 'one tab stays in the Tab order');
  for (const sw of nodes.filter((n) => n.props?.['data-operator-switch'])) {
    assert.equal(sw.props.role, 'switch');
    assert.equal(sw.props['aria-checked'], false);
  }
});

test('10. Status rows use plain words, keep the raw code in a hint and offer the next step', async () => {
  const { mod } = loadPanel();
  const t = makeTranslator(mod.en);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-st-'));
  try {
    const store = createResearchSessionStore({ arcHome: tmpDir, live: true, fetch: async () => { throw new TypeError('fetch failed'); } });
    await serveConsoleRoute('/api/arc-core/console/action', { kind: 'refresh' }, store);
    const detail = store.snapshot().connectorsDetail;
    const srv = detail.Servers[0];
    assert.equal(srv.state, 'attention');
    assert.equal(srv.code, 'TypeError');
    assert.equal(srv.action, 'refresh');
    for (const list of [detail.Servers, detail.Keys]) {
      for (const row of list) {
        assert.ok(['ok', 'attention', 'idle'].includes(row.state), `${row.id} has a state`);
        assert.match(row.status, /^[A-Z]/, `${row.id} status is a sentence`);
        assert.ok(row.status.length <= 90, `${row.id} status fits one line`);
        assert.doesNotMatch(row.status, /TypeError|local config|cammutRecall|promptCaching|http-\d/, `${row.id} status has no raw code`);
      }
    }
    assert.equal(store.snapshot().memory.state, 'attention');
    assert.doesNotMatch(store.snapshot().memory.status, /TypeError/);
    assert.equal(gatewayStatus({ status: 'no-fetch' }).action, '', 'no retry is offered where a retry cannot work');
    assert.equal(gatewayStatus({ status: 'http-503' }).code, 'http-503');
    assert.match(gatewayStatus({ reachable: true, routes: ['/a'], cammut: true }).status, /^Running, 1 route, memory on\.$/);
    store.selectWorkspace('Memory');
    let memChecks = 0;
    const memTree = renderTree({ type: mod.View, props: { data: store.snapshot(), failed: false, skin: 'arc', onRefresh: () => { memChecks += 1; }, t }, children: [] });
    const memRow = allNodes(memTree).find((n) => n.props?.['data-memory-status'] === 'true');
    assert.ok(memRow, 'the Memory workspace shows the status row');
    assert.ok(!leaves(memTree).some((w) => /Loopback|status: offline|TypeError/.test(w)));
    allNodes(memRow).find((n) => n.props?.['data-row-action'] === 'memory').props.onClick();
    assert.equal(memChecks, 1);

    let refreshed = 0;
    const view = (connector, d = detail) => renderTree({ type: mod.ConnectorView, props: { connector, detail: d, onRefresh: () => { refreshed += 1; }, t }, children: [] });
    const srvTree = view('Servers');
    const srvNodes = allNodes(srvTree);
    assert.ok(!leaves(srvTree).some((w) => /TypeError|local config/.test(w)), 'the raw code is not in the visible text');
    assert.ok(srvNodes.some((n) => n.props?.['data-state'] === 'attention'), 'state dot rendered');
    assert.ok(srvNodes.some((n) => n.props?.role === 'status'), 'status has a status role');
    const again = srvNodes.find((n) => n.props?.['data-row-action'] === 'srv-cammut');
    assert.ok(again, 'next step offered on the row');
    again.props.onClick();
    assert.equal(refreshed, 1);
    assert.ok(srvNodes.some((n) => n.props?.['data-hint'] === 'true'), 'details live in a hint');
    assert.equal(srvNodes.filter((n) => n.props?.['data-row-action']).length, 1, 'rows that are fine show no button');

    store.recordDecision({ branchId: 'b-cdr3-loop', action: 'Park' });
    const auditTree = view('Audit', store.snapshot().connectorsDetail);
    assert.ok(!leaves(auditTree).some((w) => /\d{12,}/.test(w)), 'no raw millisecond stamps');
    assert.ok(leaves(auditTree).some((w) => /^Recorded .*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d/.test(w)), 'the date is written in the language of the page');
    const midnight = new Date(2026, 10, 20, 0, 5).getTime();
    assert.ok(leaves(view('Audit', { Audit: [{ id: 'm', kind: 'k', summary: 's', atMs: midnight }] })).some((w) => /00:05/.test(w)), 'five past midnight reads 00:05');
    const emptyTree = view('Audit', { Audit: [] });
    assert.ok(allNodes(emptyTree).some((n) => n.props?.['data-empty-state'] === 'Audit'));
    for (const c of ['Servers', 'Keys', 'Apps', 'Audit']) {
      for (const w of leaves(view(c, store.snapshot().connectorsDetail))) assert.ok(w.length <= 90, `${c}: "${w}" fits one line`);
    }

    // a failed first load says so and offers a retry
    const failTree = renderTree({ type: mod.View, props: { data: null, failed: true, skin: 'arc', onRefresh: () => { refreshed += 1; }, t }, children: [] });
    const retry = allNodes(failTree).find((n) => n.props?.['data-console-retry'] === 'true');
    assert.ok(retry);
    retry.props.onClick();
    assert.equal(refreshed, 2);
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test('11. Settings dialog gets Memory, Connectors, Keys, Add-ons and Updates sections; Updates leaves when its view is absent', () => {
  const { mod } = loadPanel();
  const t = makeTranslator(mod.en);
  const registerAll = () => {
    const sections = [];
    const slots = {
      inject: (name, fn) => { fn(); return () => {}; },
      register: (opts, comp) => { if (opts.name === 'settings.section') sections.push({ ...opts, comp }); return () => {}; },
    };
    mod.apply({ effect: () => {}, locale: { register: () => {}, bind: () => t }, slots, inject: () => {} });
    return sections;
  };
  const sections = registerAll();
  assert.deepEqual(sections.map((s) => s.id), ['memory', 'connectors', 'keys', 'add-ons', 'updates']);
  for (const s of sections) {
    assert.ok(s.order > 10 && s.order < 20, `${s.id} sits between Models (10) and Advanced (20)`);
    assert.match(s.label(), /^[A-Z][a-z-]+$/, `${s.id} label is one plain word`);
    assert.equal(typeof s.comp, 'function');
  }
  assert.deepEqual(sections.map((s) => s.order), [...sections.map((s) => s.order)].sort((a, b) => a - b));
  mod.CONNECTORS.length = 4;
  assert.deepEqual(registerAll().map((s) => s.id), ['memory', 'connectors', 'keys', 'add-ons']);
  mod.CONNECTORS.push('Updates');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-ss-'));
  try {
    fs.mkdirSync(path.join(tmpDir, 'local-plugins', 'arc-core'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'local-plugins', 'arc-core', 'package.json'), JSON.stringify({ name: 'arc-core', version: '0.6.0', description: 'Shared console' }));
    fs.mkdirSync(path.join(tmpDir, 'local-plugins', 'arc-theme'), { recursive: true });
    // the unfinished copy of an update that a scanner held: it is no add-on (review note on pull request 41)
    fs.mkdirSync(path.join(tmpDir, 'local-plugins', 'arc-hoh.arc-new'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'local-plugins', 'arc-hoh.arc-new', 'package.json'), JSON.stringify({ name: 'arc-hoh', version: '0.7.0' }));
    const store = createResearchSessionStore({ arcHome: tmpDir, live: false });
    const data = store.snapshot();
    assert.deepEqual(data.addons.items.map((a) => [a.id, a.version]), [['arc-core', '0.6.0'], ['arc-theme', '']]);
    let consent = null, refreshed = 0;
    for (const s of sections) {
      const tree = renderTree({ type: mod.SettingsSectionView, props: { section: s.id, data, failed: false, onRefresh: () => { refreshed += 1; }, onOpenConsent: (r) => { consent = r; }, t }, children: [] });
      const nodes = allNodes(tree);
      assert.equal(tree.props['data-arc-settings'], s.id);
      assert.equal(countNestedBorderedBoxes(tree), 0, `${s.id}: no nested boxes`);
      assert.ok(nodes.some((n) => n.type === 'h3'), `${s.id}: has a heading`);
      assert.ok(noSecretFields(nodes), `${s.id}: no secret field`);
      for (const w of leaves(tree)) assert.ok(w.length <= 90, `${s.id}: "${w}" fits one line`);
      assert.ok(!leaves(tree).some((w) => w.includes('·')), `${s.id}: no middle dot`);
      if (s.id === 'keys') assert.equal(nodes.some((n) => n.type === 'input' || n.type === 'textarea'), false, 'keys are named, never typed');
      if (s.id === 'memory') {
        assert.ok(leaves(tree).includes(mod.en['state.unset']), 'recall is not called off when nothing is set up');
        assert.ok(leaves(tree).some((w) => w.includes('127.0.0.1:7424')));
        assert.ok(nodes.some((n) => n.props?.role === 'status'));
        nodes.find((n) => n.props?.['data-refresh-console'] === 'true').props.onClick();
      }
      if (s.id === 'connectors') {
        assert.ok(nodes.some((n) => n.props?.['data-connector-view'] === 'Servers'));
        assert.ok(nodes.some((n) => n.props?.['data-connector-view'] === 'Apps'));
        nodes.find((n) => n.props?.['data-connector-consent'] === 'molecullage').props.onClick();
      }
      if (s.id === 'updates') {
        assert.ok(nodes.some((n) => n.props?.['data-connector-view'] === 'Updates'));
        for (const a of ['data-update-check', 'data-update-install', 'data-update-rollback', 'data-updates-status']) assert.ok(nodes.some((n) => n.props?.[a]), `updates: keeps ${a}`);
      }
      if (s.id === 'add-ons') {
        assert.ok(leaves(tree).includes('arc-core') && leaves(tree).includes('0.6.0'));
        assert.equal(nodes.some((n) => n.type === 'button' && !n.props?.['data-hint']), false, 'a plain list, no dead controls');
      }
    }
    assert.equal(refreshed, 1);
    assert.equal(consent.appId, 'molecullage-connector');

    const empty = renderTree({ type: mod.SettingsSectionView, props: { section: 'add-ons', data: { ...data, addons: { ok: true, items: [] } }, t }, children: [] });
    assert.ok(allNodes(empty).some((n) => n.props?.['data-empty-state'] === 'add-ons'));
    const loading = renderTree({ type: mod.SettingsSectionView, props: { section: 'memory', data: null, failed: false, t }, children: [] });
    assert.ok(leaves(loading).includes(mod.en['state.loading']));
    const failedTree = renderTree({ type: mod.SettingsSectionView, props: { section: 'memory', data: null, failed: true, onRefresh: () => { refreshed += 1; }, t }, children: [] });
    allNodes(failedTree).find((n) => n.props?.['data-console-retry'] === 'true').props.onClick();
    assert.equal(refreshed, 2);
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test('12. The console reloads on window focus, and a slow state answer never overwrites a newer one', async () => {
  const source = fs.readFileSync(panelPath, 'utf8');
  let loaded;
  const listeners = {};
  const answers = []; // one resolver per state request, in the order the requests start
  const fetchStub = () => new Promise((resolve) => { answers.push((state) => resolve({ ok: true, json: async () => state })); });
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (m) => { loaded = m; } }, addEventListener: (k, fn) => { listeners[k] = fn; }, removeEventListener: (k) => { delete listeners[k]; } },
    fetch: fetchStub,
  });
  const applied = [];
  const effects = [];
  const mod = loaded.factory((name) => (name === 'react'
    ? { createElement: () => null, Fragment: 'fragment', useState: (v) => [v, (x) => { if (x && typeof x === 'object' && x.ok) applied.push(x.tag); }], useEffect: (fn) => { effects.push(fn); } }
    : {}));
  const tick = () => new Promise((r) => setImmediate(r));

  mod.useConsole();
  const cleanup = effects[0](); // the first request starts, and the focus listener is set
  assert.equal(typeof listeners.focus, 'function');
  listeners.focus(); // the window gets the focus back: a second request starts
  assert.equal(answers.length, 2);
  answers[1]({ ok: true, tag: 'new' }); // the second request answers first
  await tick(); await tick();
  answers[0]({ ok: true, tag: 'old' }); // the first request answers late
  await tick(); await tick();
  assert.deepEqual(applied, ['new'], 'the late answer of the older request is dropped');
  cleanup();
  assert.equal(listeners.focus, undefined, 'the listener is removed with the pane');
});

// Review finding 7 (21.XI.2026): the Updates panel with working state and a scripted server.
function liveUpdatesPanel(server) {
  let loaded, tick = null;
  vm.runInNewContext(fs.readFileSync(panelPath, 'utf8'), {
    window: { __ModuleLoader__: { load: (m) => { loaded = m; } } },
    fetch: async (route, init) => ({ json: async () => server(String(route), JSON.parse(init.body)) }),
    setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => {},
  });
  const ce = (type, props, ...ch) => ({ type, props: props ?? {}, children: ch.flat(Infinity).filter((c) => c != null && c !== false) });
  const states = [], deps = [], due = [];
  let si = 0, ei = 0;
  const mod = loaded.factory((n) => (n === 'react' ? {
    createElement: ce, Fragment: 'fragment',
    useState: (i0) => { const i = si++; if (!(i in states)) states[i] = typeof i0 === 'function' ? i0() : i0; return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useEffect: (fn, d) => { const i = ei++; if (!deps[i] || !d || d.some((x, k) => x !== deps[i][k])) due.push(fn); deps[i] = d || null; },
  } : {}));
  const t = makeTranslator(mod.en);
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  const draw = () => { si = 0; ei = 0; return renderTree({ type: mod.UpdatesPanel, props: { t }, children: [] }); };
  // draw, run the effects that are due, let their requests finish, draw again with the new state
  const render = async () => { draw(); for (const fn of due.splice(0)) fn(); await settle(); const tree = draw(); for (const fn of due.splice(0)) fn(); await settle(); return tree; };
  const status = (tree) => allWords(allNodes(tree).find((n) => n.props && n.props['data-updates-status'] !== undefined)).join(' ');
  const press = async (tree, key) => { await allNodes(tree).find((n) => n.type === 'button' && n.props[key] === 'true').props.onClick(); await settle(); };
  return { render, status, press, poll: async () => { await tick(); await settle(); } };
}

test('13. Updates panel: a refusal goes away when the update moves on, and stays while nothing changes', async () => {
  const base = { ok: true, installed: '0.6.0', latest: '0.7.0', available: true, installable: true, mode: 'notify', phase: 'idle', busy: false, hasBackup: true, notes: '', restartNeeded: false, message: '' };
  // 1. another window is already updating; this panel still shows the old state and its Update now is live
  let state = { ...base }, reply = { ok: false, error: 'An update is already running.' };
  let p = liveUpdatesPanel((route) => (route.endsWith('update/action') ? reply : state));
  let tree = await p.render();
  assert.match(p.status(tree), /0\.7\.0 is ready/);
  state = { ...base, busy: true, phase: 'installing', message: 'Replacing plugins and programs' };
  await p.press(tree, 'data-update-install');
  assert.match(p.status(await p.render()), /Replacing plugins and programs/, 'the running update shows; the refusal belonged to the old picture');
  const done = { ...base, installed: '0.7.0', available: false, phase: 'done', restartNeeded: true, message: 'Updated to 0.7.0. Restart Arc Harness to use it.' };
  state = done;
  await p.poll();
  assert.match(p.status(await p.render()), /Restart Arc Harness to finish the update/, 'the restart prompt is not hidden by the old refusal');

  // 1b. the other update finishes between the refusal and the next read of the state: the refusal must not stick to "done"
  state = { ...base };
  p = liveUpdatesPanel((route) => { if (route.endsWith('update/action')) { state = done; return reply; } return state; });
  tree = await p.render();
  await p.press(tree, 'data-update-install');
  assert.match(p.status(await p.render()), /Restart Arc Harness to finish the update/, 'a refusal that is already out of date never shows');

  // 2. a refusal while nothing else happens stays in view (the defect of the first live test must not come back)
  state = { ...base }; reply = { ok: false, error: 'There is no backup to roll back to.' };
  p = liveUpdatesPanel((route) => (route.endsWith('update/action') ? reply : state));
  tree = await p.render();
  await p.press(tree, 'data-update-rollback');
  await p.poll(); await p.poll();
  assert.match(p.status(await p.render()), /no backup to roll back to/);
  // and once the picture has changed, the old refusal does not come back when the picture returns
  state = { ...base, phase: 'checking' }; await p.poll(); await p.render();
  state = { ...base }; await p.poll();
  assert.match(p.status(await p.render()), /0\.7\.0 is ready/, 'an old refusal does not reappear');
});
