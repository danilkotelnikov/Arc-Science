/**
 * From a layout to a scene (a list of drawing primitives in paint order) and from a scene to an SVG string.
 * Colours are either a literal hex (Molecullage palette families) or a role name that the SVG resolves through CSS custom
 * properties of the Arc Harness theme (--dsw-alias-*). The gate resolves the same roles through the print theme (white paper).
 * Text goes into the SVG through escaping only, so a label can never inject markup.
 */
import { bestText, hueChroma, parseHex, lightness } from './colour.mjs';

// Molecullage palette families (tokens/tokens.base.json), without blue and purple (Arc Theme keeps no blue), plus the Arc paper tones.
export const FAMILIES = {
  cream: { fill: '#FFEDD1', edge: '#151515' },
  white: { fill: '#FFFFFF', edge: '#151515' },
  ink: { fill: '#2B2B2B', edge: '#0A0A0A' },
  mint: { fill: '#91D7AB', edge: '#317F45' },
  rose: { fill: '#E16F6B', edge: '#AC3F3F' },
  apricot: { fill: '#FBB153', edge: '#9A5600' },
  pink: { fill: '#F1C3DD', edge: '#9B2D61' },
  sand: { fill: '#ECE9E2', edge: '#6A574B' },
  palemint: { fill: '#D1F1EB', edge: '#317F45' },
  palepink: { fill: '#FFD9D7', edge: '#AC3F3F' },
};
const FAMILY_ALIAS = {
  ok: 'mint', good: 'mint', pass: 'mint', success: 'mint', done: 'mint', target: 'mint', antigen: 'mint',
  err: 'rose', error: 'rose', bad: 'rose', fail: 'rose', danger: 'rose', binder: 'rose',
  warn: 'apricot', warning: 'apricot', epitope: 'apricot', hot: 'apricot',
  neutral: 'cream', module: 'cream', default: 'cream', complex: 'pink', paper: 'sand', muted: 'sand',
};
const FALLBACK_ORDER = ['mint', 'apricot', 'rose', 'pink', 'sand', 'palemint', 'palepink'];

// Corner radii in drawing units. Small on purpose: cards look like cards, not pills (the stadium shape stays a pill).
export const CORNER = { node: 2, round: 5, cluster: 4, turn: 4, label: 2, frame: 3, participant: 3, note: 2 };

export const PRINT_THEME = {
  bg: '#FFFFFF', labelBg: '#FFFFFF', edge: '#3A3A3A', edgeText: '#2B2B2B', cluster: '#777777', clusterText: '#3A3A3A', lifeline: '#777777',
};
export const ROLE_VARS = {
  bg: ['--dsw-alias-bg-layer-1', '#ffffff'],
  labelBg: ['--dsw-alias-bg-layer-1', '#ffffff'],
  edge: ['--dsw-alias-label-secondary', '#4b463f'],
  edgeText: ['--dsw-alias-label-secondary', '#4b463f'],
  cluster: ['--dsw-alias-label-tertiary', '#75736c'],
  clusterText: ['--dsw-alias-label-secondary', '#4b463f'],
  lifeline: ['--dsw-alias-label-tertiary', '#75736c'],
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (v) => Math.round(v * 10) / 10;

/** The family for a node: class name, then fill colour of classDef or style, else cream. */
export function familyOf(node, model, state) {
  const names = [...node.classes];
  let fill = node.style && node.style.fill;
  for (const c of names) {
    if (FAMILIES[c]) return c;
    if (FAMILY_ALIAS[c]) return FAMILY_ALIAS[c];
    const def = model.classDefs && model.classDefs[c];
    if (def && def.fill && !fill) fill = def.fill;
  }
  if (!fill) return 'cream';
  const hex = normaliseColour(fill);
  if (!hex) return 'cream';
  if (state.map.has(hex)) return state.map.get(hex);
  const { hue, chroma } = hueChroma(hex);
  const L = lightness(hex);
  let fam;
  if (chroma < 0.12) fam = L > 88 ? (L > 97 ? 'white' : 'cream') : L < 40 ? 'ink' : 'sand';
  else if (hue >= 345 || hue < 15) fam = 'rose';
  else if (hue < 70) fam = 'apricot';
  else if (hue < 170) fam = 'mint';
  else if (hue >= 300) fam = 'pink';
  else fam = 'sand';
  if (state.used.has(fam) && state.used.get(fam) !== hex) {
    const free = FALLBACK_ORDER.find((f) => !state.used.has(f));
    if (free) fam = free;
  }
  state.used.set(fam, hex);
  state.map.set(hex, fam);
  return fam;
}

const NAMED = { red: '#ff0000', green: '#008000', yellow: '#ffff00', orange: '#ffa500', pink: '#ffc0cb', white: '#ffffff', black: '#000000', gray: '#808080', grey: '#808080', blue: '#0000ff', purple: '#800080', lightblue: '#add8e6', lightgreen: '#90ee90', lightyellow: '#ffffe0', brown: '#a52a2a' };
function normaliseColour(c) {
  const s = String(c).trim().toLowerCase();
  if (NAMED[s]) return NAMED[s].toUpperCase();
  const p = parseHex(s);
  if (!p) return null;
  return '#' + p.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ---------------------------------------------------------------------------------------------

function dedupe(pts) {
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.abs(q[0] - p[0]) > 0.01 || Math.abs(q[1] - p[1]) > 0.01) out.push(p); }
  const res = [out[0]];
  for (let i = 1; i < out.length - 1; i++) {
    const a = res[res.length - 1], b = out[i], c = out[i + 1];
    const col = (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(b[0] - c[0]) < 0.01) || (Math.abs(a[1] - b[1]) < 0.01 && Math.abs(b[1] - c[1]) < 0.01);
    if (!col) res.push(b);
  }
  res.push(out[out.length - 1]);
  return res;
}

function roundedD(pts, r) {
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], c = pts[i], n = pts[i + 1];
    const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]), l2 = Math.hypot(n[0] - c[0], n[1] - c[1]);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = c[0] - ((c[0] - p[0]) / l1) * rr, ay = c[1] - ((c[1] - p[1]) / l1) * rr;
    const bx = c[0] + ((n[0] - c[0]) / l2) * rr, by = c[1] + ((n[1] - c[1]) / l2) * rr;
    d += ` L${r1(ax)} ${r1(ay)} Q${r1(c[0])} ${r1(c[1])} ${r1(bx)} ${r1(by)}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${r1(l[0])} ${r1(l[1])}`;
}

function dedupeClosed(pts) {
  const out = dedupe([...pts, pts[0]]);
  out.pop();
  return out;
}

function roundedClosedD(pts, r) {
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], c = pts[i], q = pts[(i + 1) % n];
    const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1, l2 = Math.hypot(q[0] - c[0], q[1] - c[1]) || 1;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = c[0] - ((c[0] - p[0]) / l1) * rr, ay = c[1] - ((c[1] - p[1]) / l1) * rr;
    const bx = c[0] + ((q[0] - c[0]) / l2) * rr, by = c[1] + ((q[1] - c[1]) / l2) * rr;
    d += (i === 0 ? 'M' : ' L') + r1(ax) + ' ' + r1(ay) + ' Q' + r1(c[0]) + ' ' + r1(c[1]) + ' ' + r1(bx) + ' ' + r1(by);
  }
  return d + ' Z';
}

function headPrims(kind, tip, dirv, role, sw) {
  const [dx, dy] = dirv;
  const px = -dy, py = dx;
  if (kind === 'arrow') {
    const L = 9, W = 4;
    const bx = tip[0] - dx * L, by = tip[1] - dy * L;
    return [{ t: 'poly', pts: [[tip[0], tip[1]], [bx + px * W, by + py * W], [bx - px * W, by - py * W]], fill: role, stroke: null, sw: 0, role: 'head' }];
  }
  if (kind === 'circle') return [{ t: 'ellipse', cx: tip[0] - dx * 4, cy: tip[1] - dy * 4, rx: 4, ry: 4, fill: 'bg', stroke: role, sw }];
  if (kind === 'cross') {
    const c = [tip[0] - dx * 5, tip[1] - dy * 5];
    const a = 4;
    return [
      { t: 'line', pts: [[c[0] - a, c[1] - a], [c[0] + a, c[1] + a]], stroke: role, sw: 1.6 },
      { t: 'line', pts: [[c[0] - a, c[1] + a], [c[0] + a, c[1] - a]], stroke: role, sw: 1.6 },
    ];
  }
  if (kind === 'open') {
    const L = 8, W = 4;
    const bx = tip[0] - dx * L, by = tip[1] - dy * L;
    return [{ t: 'line', pts: [[bx + px * W, by + py * W], [tip[0], tip[1]], [bx - px * W, by - py * W]], stroke: role, sw: 1.4 }];
  }
  return [];
}

function shapePrims(n, fam, o) {
  const f = FAMILIES[fam];
  const { x, y, w, h } = n;
  const sw = n.style && n.style['stroke-width'] ? Math.min(3, Math.max(1, parseFloat(n.style['stroke-width']) || 1.4)) : 1.4;
  const dash = n.style && n.style['stroke-dasharray'] ? '5 4' : null;
  const base = { fill: f.fill, stroke: f.edge, sw, dash, role: 'node', id: n.id };
  const cxm = x + w / 2, cym = y + h / 2;
  const out = [];
  switch (n.shape) {
    case 'round': out.push({ t: 'rect', x, y, w, h, rx: Math.min(CORNER.round, h / 2), ...base }); break;
    case 'stadium': out.push({ t: 'rect', x, y, w, h, rx: h / 2, ...base }); break;
    case 'subroutine':
      out.push({ t: 'rect', x, y, w, h, rx: CORNER.node, ...base });
      out.push({ t: 'line', pts: [[x + 7, y], [x + 7, y + h]], stroke: f.edge, sw: 1.2 }, { t: 'line', pts: [[x + w - 7, y], [x + w - 7, y + h]], stroke: f.edge, sw: 1.2 });
      break;
    case 'cylinder': {
      const ry = 7;
      const pts = [];
      for (let i = 0; i <= 12; i++) { const a = Math.PI + (i / 12) * Math.PI; pts.push([cxm + (w / 2) * Math.cos(a), y + ry + ry * Math.sin(a)]); }
      for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; pts.push([cxm + (w / 2) * Math.cos(a), y + h - ry + ry * Math.sin(a)]); }
      const d = `M${r1(x)} ${r1(y + ry)} A${r1(w / 2)} ${ry} 0 0 1 ${r1(x + w)} ${r1(y + ry)} L${r1(x + w)} ${r1(y + h - ry)} A${r1(w / 2)} ${ry} 0 0 1 ${r1(x)} ${r1(y + h - ry)} Z`;
      out.push({ t: 'path', d, rpts: pts, ...base });
      out.push({ t: 'path', d: `M${r1(x)} ${r1(y + ry)} A${r1(w / 2)} ${ry} 0 0 0 ${r1(x + w)} ${r1(y + ry)}`, rpts: [], fill: 'none', stroke: f.edge, sw: 1.2, role: 'node-detail' });
      break;
    }
    case 'diamond': out.push({ t: 'poly', pts: [[cxm, y], [x + w, cym], [cxm, y + h], [x, cym]], ...base }); break;
    case 'hexagon': { const k = h * 0.3; out.push({ t: 'poly', pts: [[x + k, y], [x + w - k, y], [x + w, cym], [x + w - k, y + h], [x + k, y + h], [x, cym]], ...base }); break; }
    case 'parallelogram': { const k = h * 0.3; out.push({ t: 'poly', pts: [[x + k, y], [x + w, y], [x + w - k, y + h], [x, y + h]], ...base }); break; }
    case 'parallelogramAlt': { const k = h * 0.3; out.push({ t: 'poly', pts: [[x, y], [x + w - k, y], [x + w, y + h], [x + k, y + h]], ...base }); break; }
    case 'trapezoid': { const k = h * 0.3; out.push({ t: 'poly', pts: [[x + k, y], [x + w - k, y], [x + w, y + h], [x, y + h]], ...base }); break; }
    case 'trapezoidAlt': { const k = h * 0.3; out.push({ t: 'poly', pts: [[x, y], [x + w, y], [x + w - k, y + h], [x + k, y + h]], ...base }); break; }
    case 'asym': { const k = h * 0.3; out.push({ t: 'poly', pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x + k, cym]], ...base }); break; }
    case 'circle': out.push({ t: 'ellipse', cx: cxm, cy: cym, rx: w / 2, ry: h / 2, ...base }); break;
    case 'doublecircle':
      out.push({ t: 'ellipse', cx: cxm, cy: cym, rx: w / 2, ry: h / 2, ...base });
      out.push({ t: 'ellipse', cx: cxm, cy: cym, rx: w / 2 - 4, ry: h / 2 - 4, fill: 'none', stroke: f.edge, sw: 1.2, role: 'node-detail' });
      break;
    case 'startmark': out.push({ t: 'ellipse', cx: cxm, cy: cym, rx: w / 2, ry: h / 2, fill: '#0A0A0A', stroke: '#0A0A0A', sw: 1, role: 'mark', id: n.id }); break;
    case 'endmark':
      out.push({ t: 'ellipse', cx: cxm, cy: cym, rx: w / 2 - 1, ry: h / 2 - 1, fill: '#FFFFFF', stroke: '#0A0A0A', sw: 1.6, role: 'mark', id: n.id });
      out.push({ t: 'ellipse', cx: cxm, cy: cym, rx: w / 2 - 6, ry: h / 2 - 6, fill: '#0A0A0A', stroke: null, sw: 0, role: 'mark-detail' });
      break;
    case 'bar': out.push({ t: 'rect', x, y, w, h, rx: 2, fill: '#0A0A0A', stroke: '#0A0A0A', sw: 1, role: 'mark', id: n.id }); break;
    default: out.push({ t: 'rect', x, y, w, h, rx: CORNER.node, ...base });
  }
  return out;
}

/** The scene of a flow layout. */
export function sceneFlow(model, layout, o = {}) {
  const prims = [];
  const state = { used: new Map(), map: new Map() };
  const px = layout.params.fontPx, lpx = layout.params.labelPx;
  const lineH = Math.round(px * 1.35), labelLineH = Math.round(lpx * 1.3);
  const fills = [];
  const textFor = (lines, cx, cy, size, fill, weight, lh, anchor = 'middle', id) => {
    const total = lines.length * lh;
    const w = lines.reduce((m, l) => Math.max(m, l.length), 0);
    void w;
    return { t: 'text', lines, x: cx, y: cy - total / 2 + lh * 0.5 + size * 0.34, lh, size, fill, weight, anchor, id };
  };

  for (const c of layout.clusters) {
    const outline = dedupeClosed(c.poly);
    prims.push({ t: 'path', d: roundedClosedD(outline, CORNER.cluster), rpts: outline, closed: true, fill: 'none', stroke: 'cluster', sw: 1.2, dash: '5 4', role: 'cluster', id: c.id });
    const tw = Math.min(c.w - 24, c.title.length * (lpx * 0.6));
    const tx = c.titleAt[0] + 12, ty = c.titleAt[1] + 14;
    prims.push({ ...textFor([c.title], tx, ty, lpx + 0.5, 'clusterText', 600, labelLineH, 'start', c.id), role: 'cluster-title', bbox: { x: tx, y: ty - 8, w: tw, h: labelLineH } });
  }  const sw0 = 1.4;
  for (const e of layout.edges) {
    if (e.kind === 'invisible') continue;
    let pts = dedupe(e.pts);
    if (pts.length < 2) continue;
    const dirAt = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    const heads = [];
    const sw = e.kind === 'thick' ? 2.6 : sw0;
    const endDir = dirAt(pts[pts.length - 2], pts[pts.length - 1]);
    const startDir = dirAt(pts[1], pts[0]);
    const trim = (k) => (k === 'arrow' ? 8 : k === 'open' ? 2 : k === 'circle' ? 7 : k === 'cross' ? 2 : 0);
    const tipE = pts[pts.length - 1], tipS = pts[0];
    const ne = [...pts];
    if (e.headEnd && e.headEnd !== 'none') { const t = trim(e.headEnd); ne[ne.length - 1] = [tipE[0] - endDir[0] * t, tipE[1] - endDir[1] * t]; heads.push(...headPrims(e.headEnd, tipE, endDir, 'edge', sw)); }
    if (e.headStart && e.headStart !== 'none') { const t = trim(e.headStart); ne[0] = [tipS[0] - startDir[0] * t, tipS[1] - startDir[1] * t]; heads.push(...headPrims(e.headStart, tipS, startDir, 'edge', sw)); }
    pts = ne;
    prims.push({ t: 'path', d: roundedD(pts, CORNER.turn), rpts: pts, fill: 'none', stroke: 'edge', sw, dash: e.kind === 'dotted' ? '2 4' : null, cap: e.kind === 'dotted' ? 'round' : null, role: 'edge', from: e.from, to: e.to });
    prims.push(...heads);
    if (e.label) {
      const L = e.label;
      prims.push({ t: 'rect', x: L.x, y: L.y, w: L.w, h: L.h, rx: CORNER.label, fill: 'labelBg', stroke: null, sw: 0, role: 'label-bg', from: e.from, to: e.to });
      prims.push({ ...textFor(L.lines, L.x + L.w / 2, L.y + L.h / 2, lpx, 'edgeText', 400, labelLineH, 'middle'), role: 'edge-label', bbox: { x: L.x + 3, y: L.y + 3, w: L.w - 6, h: L.h - 6 } });
    }
  }
  const nodeInfo = [];
  for (const n of layout.nodes) {
    const fam = familyOf(n, model, state);
    const f = FAMILIES[fam];
    fills.push({ id: n.id, fill: f.fill, fam });
    prims.push(...shapePrims(n, fam, o));
    if (n.lines.length) {
      const tcol = bestText(f.fill);
      const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
      const off = n.shape === 'cylinder' ? 3 : 0;
      prims.push({ ...textFor(n.lines, cx, cy + off, px, tcol, 500, lineH, 'middle', n.id), role: 'node-text', bbox: { x: cx - n.tw / 2, y: cy + off - (n.lines.length * lineH) / 2, w: n.tw, h: n.lines.length * lineH }, onFill: f.fill });
    }
    nodeInfo.push({ id: n.id, fam });
  }
  return { kind: 'flow', width: layout.width, height: layout.height, prims, fills, nodeInfo, words: wordCount(layout.nodes.map((n) => n.label).concat(layout.edges.map((e) => (e.label ? e.label.lines.join(' ') : ''))).concat(layout.clusters.map((c) => c.title))) };
}

const wordCount = (texts) => texts.reduce((s, t) => s + String(t).split(/\s+/).filter(Boolean).length, 0);

/** The scene of a sequence layout. */
export function sceneSequence(model, layout) {
  const prims = [];
  const px = layout.params.fontPx, lpx = layout.params.labelPx;
  const lineH = Math.round(px * 1.35), labelLineH = Math.round(lpx * 1.3);
  const fills = [];
  // y is the centre of the whole text block; the first baseline sits half a block above it
  const text = (lines, x, y, size, fill, weight, lh, anchor, role, bbox, extra = {}) => ({ t: 'text', lines, x, y: y - (lines.length * lh) / 2 + lh / 2 + size * 0.34, lh, size, fill, weight, anchor, role, bbox, ...extra });
  if (layout.title) prims.push(text([layout.title.text], layout.title.x, layout.title.y - px * 0.34 + 4, px + 1, 'clusterText', 600, lineH, 'start', 'title', { x: layout.title.x, y: layout.title.y - px, w: layout.title.text.length * px * 0.58, h: lineH }));
  const bottom = layout.lifelines.length ? layout.lifelines[0].y1 : 0;
  void bottom;
  // Lifelines first, so that frames, their tabs and every label sit above them. A label gets a pill in the card colour, so a
  // lifeline never strikes through text.
  const pill = (bx, by, bw, bh) => ({ t: 'rect', x: bx - 3, y: by - 1.5, w: bw + 6, h: bh + 3, rx: CORNER.label, fill: 'labelBg', stroke: null, sw: 0, role: 'label-bg' });
  for (const l of layout.lifelines) prims.push({ t: 'line', pts: [[l.x, l.y0], [l.x, l.y1]], stroke: 'lifeline', sw: 1.1, dash: '4 4', role: 'lifeline' });
  for (const f of layout.frames.slice().sort((a, b) => a.depth - b.depth)) {
    prims.push({ t: 'rect', x: f.x, y: f.y, w: f.w, h: f.h, rx: CORNER.frame, fill: 'none', stroke: 'cluster', sw: 1.2, dash: null, role: 'cluster', id: f.kind });
    const tag = `${f.kind}`;
    const tw = f.tabW;
    prims.push({ t: 'rect', x: f.x, y: f.y, w: tw, h: labelLineH + 6, rx: CORNER.frame, fill: FAMILIES.sand.fill, stroke: FAMILIES.sand.edge, sw: 1, role: 'node', id: 'tab' });
    prims.push(text([tag], f.x + 9, f.y + (labelLineH + 6) / 2, lpx, '#0A0A0A', 600, labelLineH, 'start', 'node-text', { x: f.x + 9, y: f.y + 3, w: tw - 18, h: labelLineH }, { onFill: FAMILIES.sand.fill }));
    if (f.label) {
      prims.push(pill(f.x + tw + 8, f.y + 3, f.labelW, labelLineH));
      prims.push(text([`[${f.label}]`], f.x + tw + 8, f.y + (labelLineH + 6) / 2, lpx, 'clusterText', 400, labelLineH, 'start', 'frame-label', { x: f.x + tw + 8, y: f.y + 3, w: f.labelW, h: labelLineH }));
    }
    for (const d of f.dividers) {
      prims.push({ t: 'line', pts: [[f.x, d.y], [f.x + f.w, d.y]], stroke: 'cluster', sw: 1.1, dash: '5 4', role: 'divider' });
      if (d.label) {
        prims.push(pill(f.x + 10, d.y + 6, d.labelW, labelLineH));
        prims.push(text([`[${d.label}]`], f.x + 10, d.y + labelLineH / 2 + 5, lpx, 'clusterText', 400, labelLineH, 'start', 'frame-label', { x: f.x + 10, y: d.y + 6, w: d.labelW, h: labelLineH }));
      }
    }
  }  for (const a of layout.activations) prims.push({ t: 'rect', x: a.cx - 4 + a.level * 4, y: a.y0, w: 8, h: Math.max(8, a.y1 - a.y0), rx: 2, fill: FAMILIES.sand.fill, stroke: FAMILIES.sand.edge, sw: 1.1, role: 'node', id: 'activation' });
  for (const m of layout.messages) {
    const sw = 1.4;
    let pts = m.pts.map((p) => [...p]);
    const heads = [];
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const l = Math.hypot(last[0] - prev[0], last[1] - prev[1]) || 1;
    const dirv = [(last[0] - prev[0]) / l, (last[1] - prev[1]) / l];
    if (m.head === 'arrow') { pts[pts.length - 1] = [last[0] - dirv[0] * 8, last[1] - dirv[1] * 8]; heads.push(...headPrims('arrow', last, dirv, 'edge', sw)); }
    else if (m.head === 'cross') heads.push(...headPrims('cross', last, dirv, 'edge', sw));
    else if (m.head === 'open') heads.push(...headPrims('open', last, dirv, 'edge', sw));
    prims.push({ t: m.self ? 'path' : 'line', ...(m.self ? { d: roundedD(pts, CORNER.turn), rpts: pts, fill: 'none' } : { pts }), stroke: 'edge', sw, dash: m.dash ? '6 4' : null, role: 'edge' });
    prims.push(...heads);
    const L = m.label;
    if (L.lines.length && L.lines.join('')) {
      const cx = L.anchor === 'middle' ? L.x + L.w / 2 : L.x;
      prims.push(pill(L.x, L.y, L.w, L.h));
      prims.push(text(L.lines, cx, L.y + L.h / 2, lpx, 'edgeText', 400, labelLineH, L.anchor, 'edge-label', { x: L.x, y: L.y, w: L.w, h: L.h }));
    }
  }
  for (const p of layout.participants) {
    const fam = FAMILIES.cream;
    fills.push({ id: p.id, fill: fam.fill, fam: 'cream' });
    prims.push({ t: 'rect', x: p.x, y: p.y, w: p.w, h: p.h, rx: p.kind === 'actor' ? p.h / 2 : CORNER.participant, fill: fam.fill, stroke: fam.edge, sw: 1.4, role: 'node', id: p.id });
    prims.push(text(p.lines, p.cx, p.y + p.h / 2, px, '#0A0A0A', 600, lineH, 'middle', 'node-text', { x: p.cx - p.tw / 2, y: p.y + p.h / 2 - (p.lines.length * lineH) / 2, w: p.tw, h: p.lines.length * lineH }, { onFill: fam.fill, id: p.id }));
  }
  for (const q of layout.notes) {
    const fam = FAMILIES.sand;
    prims.push({ t: 'rect', x: q.x, y: q.y, w: q.w, h: q.h, rx: CORNER.note, fill: fam.fill, stroke: fam.edge, sw: 1.1, role: 'note', id: 'note' });
    prims.push(text(q.lines, q.x + q.w / 2, q.y + q.h / 2, lpx, '#0A0A0A', 400, labelLineH, 'middle', 'node-text', { x: q.x + 8, y: q.y + 6, w: q.w - 16, h: q.h - 12 }, { onFill: fam.fill }));
  }
  const words = wordCount(layout.participants.map((p) => p.lines.join(' ')).concat(layout.messages.map((m) => m.label.lines.join(' '))).concat(layout.notes.map((q) => q.lines.join(' '))));
  return { kind: 'sequence', width: layout.width, height: layout.height, prims, fills, nodeInfo: [], words };
}

// ---------------------------------------------------------------------------------------------
// Serialisation

export function resolveColour(c, theme) {
  if (!c || c === 'none') return null;
  if (c[0] === '#') return c;
  return theme[c] || null;
}

function colourAttr(c, mode) {
  if (!c || c === 'none') return 'none';
  if (c[0] === '#') return c;
  return mode === 'css' ? `var(--mm-${c})` : mode[c];
}

/** SVG text of a scene. mode 'css' uses custom properties; a theme object writes literal colours (exports, tests). */
export function toSvg(scene, o = {}) {
  const mode = o.theme || 'css';
  const a = (name, v) => (v === undefined || v === null ? '' : ` ${name}="${v}"`);
  const out = [];
  const vars = mode === 'css'
    ? Object.entries(ROLE_VARS).map(([k, [v, fb]]) => `--mm-${k}:var(${v},${fb})`).join(';')
    : '';
  const fontStack = o.fontFamily || 'var(--dsw-font-family,Geist),Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif';
  const label = o.ariaLabel || 'Diagram';
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r1(scene.width)} ${r1(scene.height)}" width="${r1(scene.width)}" height="${r1(scene.height)}" role="img" aria-label="${esc(label)}" font-family='${fontStack.replace(/'/g, '')}'${vars ? ` style="font-family:${fontStack.replace(/"/g, "'")};${vars}"` : ''}>`);
  if (o.background) out.push(`<rect width="100%" height="100%" fill="${colourAttr(o.background, mode)}"/>`);
  for (const p of scene.prims) {
    const stroke = colourAttr(p.stroke, mode);
    const fill = colourAttr(p.fill, mode);
    const paint = `${a('fill', fill)}${p.stroke ? a('stroke', stroke) + a('stroke-width', p.sw) : ''}${p.dash ? a('stroke-dasharray', p.dash) : ''}${p.cap ? a('stroke-linecap', p.cap) : ''}`;
    switch (p.t) {
      case 'rect': out.push(`<rect x="${r1(p.x)}" y="${r1(p.y)}" width="${r1(p.w)}" height="${r1(p.h)}"${p.rx ? a('rx', r1(p.rx)) : ''}${paint}/>`); break;
      case 'ellipse': out.push(`<ellipse cx="${r1(p.cx)}" cy="${r1(p.cy)}" rx="${r1(p.rx)}" ry="${r1(p.ry)}"${paint}/>`); break;
      case 'poly': out.push(`<polygon points="${p.pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ')}"${paint} stroke-linejoin="round"/>`); break;
      case 'line': out.push(`<polyline points="${p.pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ')}" fill="none"${p.stroke ? a('stroke', stroke) + a('stroke-width', p.sw) : ''}${p.dash ? a('stroke-dasharray', p.dash) : ''} stroke-linecap="round" stroke-linejoin="round"/>`); break;
      case 'path': out.push(`<path d="${p.d}"${paint} stroke-linejoin="round"${p.cap ? '' : ' stroke-linecap="round"'}/>`); break;
      case 'text': {
        const tf = colourAttr(p.fill, mode);
        const tsp = p.lines.map((l, i) => `<tspan x="${r1(p.x)}"${i ? ` dy="${p.lh}"` : ''}>${esc(l)}</tspan>`).join('');
        out.push(`<text x="${r1(p.x)}" y="${r1(p.y)}" font-size="${r1(p.size)}" font-weight="${p.weight}" text-anchor="${p.anchor}" fill="${tf}">${tsp}</text>`);
        break;
      }
      default: break;
    }
  }
  out.push('</svg>');
  return out.join('');
}






