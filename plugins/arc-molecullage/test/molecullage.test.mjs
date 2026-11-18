// arc-molecullage 0.1.0 (2026-11-08): tests for the unified Molecullage workspace plugin.
//   node --test plugins/arc-molecullage/test/molecullage.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { checkOverplating, atlasSummary, pipelineStatus, serve, apply, handleAction } from "../lib/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function client() {
  const source = fs.readFileSync(path.join(here, "../lib/client.js"), "utf8");
  let loaded;
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: (m) => { loaded = m; } } } });
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) });
  const mod = loaded.factory((name) => (name === "react" ? { createElement, Fragment: "fragment", useState: () => [null, () => {}], useEffect: () => {} } : {}));
  return { mod, source };
}

function render(node) {
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (typeof node.type === "function") return { from: node.type, ...render(node.type({ ...node.props, children: node.children.length === 1 ? node.children[0] : node.children })) };
  return { ...node, children: node.children.map(render) };
}
const nodes = (n) => (n && typeof n === "object" ? [n, ...n.children.flatMap(nodes)] : []);
const words = (n) => (n && typeof n === "object" ? n.children.flatMap(words) : n === null || n === undefined || n === false ? [] : [String(n)]);

test("locale metadata uses Molecullage in sentence case", () => {
  const locale = JSON.parse(fs.readFileSync(path.join(here, "../locale/en.json"), "utf8"));
  assert.equal(locale.meta.title, "Molecullage");
  assert.ok(!/BioArt|Molecules/i.test(JSON.stringify(locale)));
});

test("checkOverplating enforces the five-gate grammar and nestedBoxes = 0", () => {
  const baseline = checkOverplating();
  assert.equal(baseline.ok, true);
  assert.equal(baseline.nestedBoxes, 0);
  assert.equal(baseline.overplate, 0);
  assert.equal(baseline.rules, 56);
  assert.equal(baseline.gates.length, 5);
  assert.deepEqual(baseline.failedGates, []);

  const overplated = checkOverplating({ nestedBoxes: 2, minFontPt: 5.5 });
  assert.equal(overplated.ok, false);
  assert.equal(overplated.nestedBoxes, 2);
  assert.deepEqual(overplated.failedGates, ["no-nested-boxes", "canvas-typography"]);
});

test("atlasSummary exposes 231 sources and 8 domains", () => {
  const atlas = atlasSummary();
  assert.equal(atlas.sources, 231);
  assert.equal(atlas.domainsCount, 8);
  assert.equal(atlas.grammarRules, 56);
  assert.equal(atlas.domains.length, 8);
});

test("pipelineStatus exposes the 3D structure, Blender, build, QA and blind-read stages", () => {
  const pipe = pipelineStatus();
  assert.equal(pipe.ok, true);
  assert.deepEqual(pipe.stages.map((s) => s.id), ["chimerax", "blender", "build", "qa", "blind-read"]);
});

test("serve returns the unified Molecullage console state over HTTP POST", async () => {
  const state = await serve(new Request("http://localhost/api/arc-molecullage/state", { method: "POST", body: "{}" }));
  assert.equal(state.ok, true);
  assert.deepEqual(state.workspace.consoles, ["Research", "Memory", "Molecullage", "Prose"]);
  assert.equal(state.antiOverplating.nestedBoxes, 0);
  assert.equal(state.atlas.sources, 231);
  assert.equal(state.pipeline.stages.length, 5);
});

test("host apply registers /api/arc-molecullage/state", async () => {
  let registered = null;
  apply({
    inject: (_deps, fn) => fn({
      get: () => ({ fetch: { register: (cfg) => { registered = cfg; return () => {}; } } }),
      effect: (fn2) => fn2(),
    }),
  });
  assert.ok(registered);
  assert.equal(registered.path, "/api/arc-molecullage/state");
  const res = await registered.fetch(new Request("http://localhost/api/arc-molecullage/state", { method: "POST", body: "{}" }));
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.antiOverplating.nestedBoxes, 0);
});

test("client View renders loading state, five gates, 231-source atlas and 3D pipeline without blue or middle dots", async () => {
  const { mod, source } = client();
  const t = (k, v) => (mod.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v?.[x]);

  const loadingTree = render({ type: mod.View, props: { data: null, failed: false, t }, children: [] });
  assert.ok(words(loadingTree).includes("Loading Molecullage workspace…"));

  const state = await serve({});
  const tree = render({ type: mod.View, props: { data: state, failed: false, t }, children: [] });
  const text = words(tree);
  assert.ok(text.includes("56 rules, nested boxes: 0"));
  assert.ok(text.includes("231 verified sources across 8 domains"));
  assert.ok(text.includes("Accepted"));
  assert.ok(text.includes("render_structure"));
  assert.ok(text.includes("build_figure"));
  assert.ok(text.includes("qa_figure"));

  assert.ok(!source.includes("\u00b7"));
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(blue|violet|purple|indigo)\b/i);
  const allNodes = nodes(tree);
  assert.ok(allNodes.some((n) => n.props?.style?.fontVariantNumeric === "tabular-nums"));
});

test("serve supports live library filtering with fallback when disk library is absent", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mol-lib-"));
  try {
    const libDir = path.join(tmp, "studio", "library");
    fs.mkdirSync(path.join(libDir, "atlas", "domains"), { recursive: true });
    fs.writeFileSync(path.join(libDir, "sources.json"), JSON.stringify({
      sources: [
        { id: "s1", name: "ChimeraX", kind: "app", section: "structure", licenceClass: "academic", use: "macromolecular render" },
        { id: "s2", name: "Blender", kind: "app", section: "3d", licenceClass: "GPL-3.0", use: "cellular studio scene" },
      ],
    }), "utf8");
    const filtered = await serve({ query: "chimera" }, { molecullageRoot: tmp, arcHome: tmp });
    assert.equal(filtered.ok, true);
    assert.equal(filtered.atlas.sources, 2);
    assert.equal(filtered.matchedSources.length, 1);
    assert.equal(filtered.matchedSources[0].name, "ChimeraX");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("handleAction persists notes, pins, and 5-gate checks to molecullage-notes.json with optional Cammut retain", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mol-notes-")), act = (b, o = {}) => handleAction(b, { arcHome: tmp, ...o }), eq = assert.equal;
  try {
    const rc = [], nRes = await act({ action: "note", text: "1MEL Bearer secretToken1234567890123456", doi: "10.1038/nsb0996-803", retain: true }, { retain: async (p) => (rc.push(p), true) });
    eq(nRes.ok, true); eq(nRes.retained, true); eq(nRes.notes.length, 1); assert.ok(!nRes.notes[0].text.includes("secretToken1234567890123456")); eq(rc.length, 1);
    const pRes = await act({ action: "toggle-pin", source: { id: "pdb-1mel", name: "PDB 1MEL", kind: "molecular", section: "structure", licenceClass: "CC0", doi: "10.1038/nsb0996-803" } });
    eq(pRes.ok, true); eq(pRes.pinned, true); eq(pRes.pins.length, 1);
    const cFail = await act({ action: "check", nestedBoxes: 1, minFontPt: 5.0 });
    eq(cFail.ok, true); eq(cFail.antiOverplating.ok, false); assert.deepEqual(cFail.antiOverplating.failedGates, ["no-nested-boxes", "canvas-typography"]);
    const st = await serve({}, { arcHome: tmp, molecullageRoot: tmp }); eq(st.notes.length, 1); eq(st.pins.length, 1); eq(st.antiOverplating.ok, false);
    const lRet = await act({ action: "retain", text: "Keep", retain: true }, { retainTimeoutMs: 20, retain: () => new Promise(() => {}) });
    eq(lRet.ok, true); eq(lRet.retained, false); eq((await act({ action: "retain", text: "Keep", retain: true }, { retain: async () => true })).notes.length, 2);
    eq((await serve({ domain: "constructor" }, { arcHome: tmp })).ok, true);
    const sseFail = await act({ action: "retain", text: "SSE" }, { fetch: async () => ({ ok: true, text: async () => 'event: message\ndata: {"result":{"isError":true}}\n\n' }) });
    eq(sseFail.retained, false); eq((await act({ action: "check", reset: true })).antiOverplating.ok, true); eq((await act({ action: "unpin", sourceId: "pdb-1mel" })).pins.length, 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("host apply registers /api/arc-molecullage/action before /state", () => {
  const reg = [];
  apply({ inject: (_d, fn) => fn({ get: () => ({ fetch: { register: (c) => (reg.push(c), () => {}) } }), effect: (f) => f() }) });
  assert.deepEqual(reg.map((r) => r.path), ["/api/arc-molecullage/action", "/api/arc-molecullage/state"]);
});

test("interactive client supports 5-gate runner, domain chips, pinning, prompt reuse, and polling pause", async () => {
  const src = fs.readFileSync(path.join(here, "../lib/client.js"), "utf8"), eq = assert.equal;
  assert.ok(!src.includes("\u00b7") && !src.includes("\u2022"));
  assert.doesNotMatch(src, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|(?<!var\(--)\b(blue|violet|purple|indigo)\b/i);
  let loaded, clip = "", cVal = "", evN = 0;
  const cEl = { tagName: "TEXTAREA", value: "", disabled: false, closest: () => null, getBoundingClientRect: () => ({ width: 320, height: 64 }), dispatchEvent: (e) => { if (e.type === "input") evN += 1; }, focus: () => {} };
  Object.defineProperty(cEl, "value", { get: () => cVal, set: (v) => { cVal = v; }, configurable: true });
  const aCalls = [], dClicks = [], baseState = await serve({});
  baseState.matchedSources = [{ id: "s-cx", name: "ChimeraX", kind: "molecular", section: "structure", licenceClass: "academic", doi: "10.1002/pro.4792", use: "ribbon" }];
  vm.runInNewContext(src, {
    window: { __ModuleLoader__: { load: (m) => { loaded = m; } } }, navigator: { clipboard: { writeText: (s) => ((clip = s), Promise.resolve()) } },
    document: { querySelectorAll: () => [cEl] }, Event: class { constructor(type, opts) { this.type = type; this.opts = opts; } },
    fetch: async () => ({ ok: true, json: async () => baseState }), setInterval: () => 1, clearInterval: () => {},
  });
  let states = [], idx = 0;
  const mod = loaded.factory((n) => n === "react" ? { createElement: (type, props, ...ch) => ({ type, props: props ?? {}, children: ch.flat(Infinity) }), Fragment: "fragment", useState: (i0) => { const i = idx++; if (!(i in states)) states[i] = typeof i0 === "function" ? i0() : i0; return [states[i], (v) => { states[i] = typeof v === "function" ? v(states[i]) : v; }]; }, useEffect: () => {} } : {});
  const t = (k, v) => (mod.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v?.[x] ?? "");
  const ren = (ex = {}) => { idx = 0; return render({ type: mod.View, props: { data: baseState, failed: false, activeDomain: "", paused: false, onAction: (p) => aCalls.push(p), onSelectDomain: (d) => dClicks.push(d), onFilter: () => {}, t, ...ex }, children: [] }); };
  const list = nodes(ren()), hasB = (s) => Boolean(s && typeof s.border === "string" && s.border !== "none" && !s.border.startsWith("0"));
  assert.ok(!list.some((n) => hasB(n.props?.style)), "zero bordered boxes");
  list.find((n) => n.props?.["data-molecullage-domain"] === "3d").props.onClick(); assert.deepEqual(dClicks, ["3d"]);
  list.find((n) => n.props?.["data-molecullage-pin"] === "s-cx").props.onClick(); eq(aCalls[0].action, "toggle-pin"); eq(aCalls[0].source.id, "s-cx");
  list.find((n) => n.props?.["data-molecullage-stage-prompt"] === "qa").props.onClick(); assert.ok(cVal.includes("qa_figure")); eq(clip, ""); eq(evN, 1);
  cEl.getBoundingClientRect = () => ({ width: 0, height: 0 });
  list.find((n) => n.props?.["data-molecullage-stage-prompt"] === "build").props.onClick(); assert.ok(clip.includes("build_figure"));
  list.find((n) => n.props?.["data-molecullage-nested-input"] === "true").props.onChange({ target: { value: "2" } });
  nodes(ren()).find((n) => n.props?.["data-molecullage-nested-input"] === "true").props.onChange({ target: { value: "0" } });
  nodes(ren()).find((n) => n.props?.["data-molecullage-run-checks"] === "true").props.onClick();
  eq(aCalls.at(-1).action, "check"); eq(aCalls.at(-1).figureSpec.overplate, 0);
  assert.ok(nodes(ren({ paused: true })).some((n) => n.props?.["data-molecullage-polling-paused"] === "true"));
});
