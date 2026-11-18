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
  assert.equal(effects.length, 6);

  for (const route of [
    '/api/arc-core/session/head',
    '/api/arc-core/session/timeline',
    '/api/arc-core/session/tree',
    '/api/arc-core/session/decisions',
    '/api/arc-core/console/state',
    '/api/arc-core/console/action',
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
  assert.deepEqual(headJson.connectors, ['Servers', 'Keys', 'Apps', 'Audit']);
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

    for (const conn of ['Servers', 'Keys', 'Apps', 'Audit']) {
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
      assert.equal(activeBtn.props['aria-pressed'], true, `${conn} button active`);
      assert.equal(activeBtn.props.style.fontWeight, 600, `${conn} button highlighted`);
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
