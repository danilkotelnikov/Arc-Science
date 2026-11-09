/**
 * Engine: Mermaid source in, gated SVG out. A fixed, ordered list of layout candidates is drawn and scored by the Molecullage gate;
 * the search stops at the first candidate that passes every mark, otherwise the lowest score wins (ties go to the earlier candidate).
 * The list depends only on the diagram, never on the clock, so the same source gives the same drawing.
 */
import { parse, ParseError } from './parse.mjs';
import { layoutFlow, tableMeasure } from './layout.mjs';
import { layoutSequence } from './layout-seq.mjs';
import { sceneFlow, sceneSequence, toSvg } from './scene.mjs';
import { gate } from './gate.mjs';

export const VERSION = '0.2.0';
export const MAX_NODES = 400;

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const swapDir = (d) => (d === 'TB' || d === 'BT' ? 'LR' : 'TB');

/** The ordered candidate list for a model. */
export function candidatesFor(model, o = {}) {
  const out = [];
  if (model.type === 'sequence') {
    for (const spacing of [1, 0.85]) for (const wrap of [200, 150, 260]) out.push({ dir: 'TB', wrap, spacing, seed: 0 });
    return out;
  }
  const authored = model.dir;
  const rotate = o.allowRotate === true && !model.isState; // the author's direction stays unless the setting allows a turn
  const dirs = rotate ? [authored, swapDir(authored)] : [authored];
  const big = model.nodes.size > 60;
  for (const dir of dirs) {
    for (const seed of [0, 1, 2, 3]) out.push({ dir, wrap: 200, spacing: 1, seed });
    for (const wrap of [150, 260, 120, 320]) out.push({ dir, wrap, spacing: 1, seed: 0 });
    for (const wrap of [200, 150]) out.push({ dir, wrap, spacing: 0.8, seed: 0 });
    if (big) break;
  }
  return out.slice(0, big ? 8 : 26);
}

function drawCandidate(model, cand, o, measure) {
  const base = { fontPx: o.fontPx || 13, margin: 16, ...cand };
  const layout = model.type === 'sequence' ? layoutSequence(model, base, measure) : layoutFlow(model, base, measure);
  const scene = model.type === 'sequence' ? sceneSequence(model, layout) : sceneFlow(model, layout);
  const report = gate(model, layout, scene, { live: o.live, raster: o.raster });
  return { layout, scene, report, cand };
}

/** Generator: yields { tried, total, best } after every candidate and returns the final result. */
export function* search(source, o = {}) {
  const measure = o.measure || tableMeasure;
  let model;
  try { model = parse(source); } catch (e) {
    if (e instanceof ParseError) return { ok: false, reason: 'parse', message: e.message, line: e.line };
    throw e;
  }
  if (model.type === 'unsupported') return { ok: false, reason: 'unsupported', kind: model.kind };
  if (model.type === 'flow' && model.nodes.size === 0) return { ok: false, reason: 'empty' };
  if (model.type === 'flow' && model.nodes.size > MAX_NODES) return { ok: false, reason: 'too-large', nodes: model.nodes.size };
  const cands = candidatesFor(model, o);
  let best = null;
  let tried = 0;
  for (const cand of cands) {
    const r = drawCandidate(model, cand, o, measure);
    tried++;
    r.order = tried;
    if (!best || r.report.score < best.report.score) best = r;
    yield { tried, total: cands.length, best };
    if (best.report.level === 'pass') break;
  }
  const label = model.type === 'sequence' ? `Sequence diagram, ${model.participants.length} participants` : `${model.isState ? 'State' : 'Flow'} diagram, ${best.layout.nodes.length} nodes`;
  const svg = toSvg(best.scene, { ariaLabel: label });
  return {
    ok: true,
    kind: model.type === 'sequence' ? 'sequence' : model.isState ? 'state' : 'flow',
    svg,
    scene: best.scene,
    layout: best.layout,
    model,
    report: {
      ...best.report,
      params: best.cand,
      candidates: { tried, total: cands.length, chosen: best.order },
      stats: best.layout.stats,
      size: { width: Math.round(best.layout.width), height: Math.round(best.layout.height) },
      hash: fnv1a(svg),
      engine: VERSION,
      measure: o.measureId || 'table',
    },
  };
}

export function renderDiagram(source, o = {}) {
  const it = search(source, o);
  for (;;) {
    const s = it.next();
    if (s.done) return s.value;
  }
}

export { parse, ParseError, tableMeasure, toSvg, gate };


