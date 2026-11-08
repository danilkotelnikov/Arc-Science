// arc-molecullage 0.1.0 (2026-11-08): tests for the unified Molecullage workspace plugin.
//   node --test plugins/arc-molecullage/test/molecullage.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { checkOverplating, atlasSummary, pipelineStatus, serve, apply } from "../lib/index.js";

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
