/**
 * Layered layout for flowcharts and state diagrams. Deterministic: the same model, options and text measure give the same numbers.
 *
 * Steps: node sizes, cycle removal, longest-path layers (two layers per rank, so every edge has a middle layer for its label),
 * dummy nodes for long edges, cluster-aware barycentre ordering with a crossing count, coordinates by isotonic regression per layer,
 * edge ports and orthogonal routes with one track per jog, cluster boxes. Pure functions, no DOM.
 */

// ---------------------------------------------------------------------------------------------
// Text

const NARROW = new Set("iljI.,:;'|!`".split(''));
const MID = new Set(' ftr()[]{}/\\-*"'.split(''));
const WIDE = new Set('mwMW@%&'.split(''));

/** A fixed width table close to Geist. Used in tests and as the fallback when no canvas is available. */
export function tableMeasure(text, px, bold = false) {
  let w = 0;
  for (const ch of String(text)) {
    let k;
    if (NARROW.has(ch)) k = 0.3;
    else if (MID.has(ch)) k = 0.38;
    else if (WIDE.has(ch)) k = 0.86;
    else if (ch >= 'A' && ch <= 'Z') k = 0.68;
    else if (ch >= '0' && ch <= '9') k = 0.58;
    else if (ch >= '\u0400' && ch <= '\u04FF') k = ch === ch.toUpperCase() ? 0.7 : 0.58;
    else if (ch.charCodeAt(0) > 0x2e80) k = 1.0;
    else k = 0.56;
    w += k * px;
  }
  return Math.ceil((w * (bold ? 1.06 : 1)) * 2) / 2;
}

export function wrapLines(label, maxW, px, measure, bold = false) {
  const out = [];
  for (const para of String(label).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    // A word wider than the line is cut into pieces that fit.
    const parts = [];
    for (const w of words) {
      if (measure(w, px, bold) <= maxW) { parts.push(w); continue; }
      let piece = '';
      for (const ch of w) {
        if (piece && measure(piece + ch, px, bold) > maxW) { parts.push(piece); piece = ''; }
        piece += ch;
      }
      if (piece) parts.push(piece);
    }
    words.length = 0;
    words.push(...parts);
    let cur = words[0];
    for (let i = 1; i < words.length; i++) {
      const t = cur + ' ' + words[i];
      if (measure(t, px, bold) <= maxW) cur = t;
      else { out.push(cur); cur = words[i]; }
    }
    out.push(cur);
  }
  return out;
}

const textWidth = (lines, px, measure, bold) => lines.reduce((m, l) => Math.max(m, measure(l, px, bold)), 0);

// ---------------------------------------------------------------------------------------------
// Shapes

export const ELLIPSE_SHAPES = new Set(['circle', 'doublecircle', 'startmark', 'endmark']);

export function nodeSize(shape, tw, th, fontPx) {
  const k = fontPx / 13;
  const padX = 14 * k, padY = 9 * k;
  let w = tw + 2 * padX, h = th + 2 * padY;
  switch (shape) {
    case 'stadium': w = tw + 2 * padX + h * 0.5; break;
    case 'subroutine': w += 14; break;
    case 'cylinder': h += 14; break;
    case 'hexagon': case 'parallelogram': case 'parallelogramAlt': case 'trapezoid': case 'trapezoidAlt': w += h * 0.6; break;
    case 'asym': w += 14; break;
    case 'diamond': w = tw * 1.75 + 16; h = th * 2.4 + 8; if (tw === 0) { w = 34; h = 34; } break;
    case 'circle': { const d = Math.hypot(tw, th) + 18; w = h = Math.max(d, 38); break; }
    case 'doublecircle': { const d = Math.hypot(tw, th) + 26; w = h = Math.max(d, 44); break; }
    case 'startmark': w = h = 16; return { w, h };
    case 'endmark': w = h = 22; return { w, h };
    case 'bar': w = 64; h = 8; return { w, h };
    default: break;
  }
  return { w: Math.max(w, 40), h: Math.max(h, 34 * k) };
}

/** Half of the vertical extent of a shape at horizontal offset dx from its centre (a = half width, b = half height). */
export function boundaryOffset(shape, dx, a, b) {
  const r = Math.min(1, Math.abs(dx) / Math.max(a, 1e-6));
  if (shape === 'diamond') return b * (1 - r);
  if (ELLIPSE_SHAPES.has(shape)) return b * Math.sqrt(Math.max(0, 1 - r * r));
  return b;
}

// ---------------------------------------------------------------------------------------------
// Flow layout

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

function commonPrefix(a, b) {
  const out = [];
  for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) out.push(a[i]);
  return out;
}

export function layoutFlow(model, o, measure) {
  const fontPx = o.fontPx || 13;
  const labelPx = fontPx - 1.5;
  const wrap = o.wrap || 200;
  const sp = o.spacing || 1;
  const nodeSep = 30 * sp, edgeSep = 14, gap0 = 22 * sp, clPad = 14, portGap = 13;
  const titleH = Math.round(fontPx * 1.1) + 10;
  const lineH = Math.round(fontPx * 1.35);
  const labelLineH = Math.round(labelPx * 1.3);
  const dir = o.dir || model.dir || 'TB';
  const horizontal = dir === 'LR' || dir === 'RL';
  const reversedLayers = dir === 'BT' || dir === 'RL';
  const seed = o.seed || 0;

  // ---- groups
  const groupsById = new Map(model.groups.map((g) => [g.id, g]));
  const ownerOf = new Map();
  for (const g of model.groups) for (const m of g.members) if (!ownerOf.has(m) && model.nodes.has(m)) ownerOf.set(m, g.id);
  const pathOf = (id) => {
    const path = [];
    let g = groupsById.get(ownerOf.get(id));
    const guard = new Set();
    while (g && !guard.has(g.id)) { guard.add(g.id); path.unshift(g.id); g = g.parent ? groupsById.get(g.parent) : null; }
    return path;
  };

  // ---- real items
  const ids = [...model.nodes.keys()];
  const items = [];
  const real = new Map();
  for (const id of ids) {
    const n = model.nodes.get(id);
    const lines = n.label === '' ? [] : wrapLines(n.label, wrap, fontPx, measure);
    const tw = textWidth(lines, fontPx, measure, false);
    const th = lines.length * lineH;
    const sz = nodeSize(n.shape, tw, th, fontPx);
    let w = sz.w, h = sz.h;
    if (n.shape === 'bar' && horizontal) { w = 8; h = 64; }
    const it = { kind: 'real', id, node: n, shape: n.shape, lines, w, h, tw, th, cl: pathOf(id), idx: items.length, up: [], down: [] };
    it.cs = horizontal ? h : w;
    it.ls = horizontal ? w : h;
    items.push(it);
    real.set(id, it);
  }

  // ---- edges
  const selfLoops = [];
  const edges = [];
  model.edges.forEach((e, i) => {
    if (!real.has(e.from) || !real.has(e.to) || e.kind === 'invisible-skip') return;
    if (e.from === e.to) { selfLoops.push({ e, i }); return; }
    const lines = e.label ? wrapLines(e.label, 160, labelPx, measure) : [];
    const lw = lines.length ? textWidth(lines, labelPx, measure, false) + 10 : 0;
    const lh = lines.length ? lines.length * labelLineH + 6 : 0;
    edges.push({ e, i, from: real.get(e.from), to: real.get(e.to), lines, lw, lh, minlen: Math.max(1, e.minlen || 1) });
  });
  for (const s of selfLoops) {
    const it = real.get(s.e.from);
    const lines = s.e.label ? wrapLines(s.e.label, 160, labelPx, measure) : [];
    s.lines = lines;
    s.lw = lines.length ? textWidth(lines, labelPx, measure, false) + 10 : 0;
    s.lh = lines.length ? lines.length * labelLineH + 6 : 0;
    const extra = 26 + s.lw;
    if (horizontal) it.ls += 0; // loops hang on the cross-axis side in LR; widen the cross size
    it.cs += horizontal ? Math.max(26, s.lh) : extra;
  }

  // ---- cycle removal (DFS in declaration order)
  const outE = new Map(ids.map((id) => [id, []]));
  for (const ed of edges) outE.get(ed.from.id).push(ed);
  const state = new Map();
  for (const id of ids) {
    if (state.get(id)) continue;
    const stack = [{ id, i: 0 }];
    state.set(id, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const list = outE.get(top.id);
      if (top.i >= list.length) { state.set(top.id, 2); stack.pop(); continue; }
      const ed = list[top.i++];
      const s = state.get(ed.to.id) || 0;
      if (s === 1) ed.rev = true;
      else if (s === 0) { state.set(ed.to.id, 1); stack.push({ id: ed.to.id, i: 0 }); }
    }
  }
  for (const ed of edges) { ed.a = ed.rev ? ed.to : ed.from; ed.b = ed.rev ? ed.from : ed.to; ed.len = 2 * ed.minlen; }

  // ---- layers
  const indeg = new Map(ids.map((id) => [id, 0]));
  const outs = new Map(ids.map((id) => [id, []]));
  for (const ed of edges) { indeg.set(ed.b.id, indeg.get(ed.b.id) + 1); outs.get(ed.a.id).push(ed); }
  const topo = [];
  const deg = new Map(indeg);
  const queue = ids.filter((id) => deg.get(id) === 0);
  while (queue.length) {
    const id = queue.shift();
    topo.push(id);
    for (const ed of outs.get(id)) { deg.set(ed.b.id, deg.get(ed.b.id) - 1); if (deg.get(ed.b.id) === 0) queue.push(ed.b.id); }
  }
  for (const id of ids) if (!topo.includes(id)) topo.push(id);
  for (const id of ids) real.get(id).layer = 0;
  for (const id of topo) for (const ed of outs.get(id)) ed.b.layer = Math.max(ed.b.layer, ed.a.layer + ed.len);
  for (let k = topo.length - 1; k >= 0; k--) {
    const it = real.get(topo[k]);
    if (indeg.get(it.id) === 0 && outs.get(it.id).length) it.layer = Math.min(...outs.get(it.id).map((ed) => ed.b.layer - ed.len));
  }

  // ---- dummies and chains
  for (const ed of edges) {
    const span = ed.b.layer - ed.a.layer;
    const chain = [ed.a];
    const mid = ed.a.layer + Math.floor(span / 2);
    const cl = commonPrefix(ed.a.cl, ed.b.cl);
    for (let l = ed.a.layer + 1; l < ed.b.layer; l++) {
      const isLabel = ed.lines.length > 0 && l === mid;
      const d = { kind: 'dummy', edge: ed, layer: l, cl, idx: items.length, up: [], down: [], isLabel };
      d.cs = isLabel ? (horizontal ? ed.lh : ed.lw) : 2;
      d.ls = isLabel ? (horizontal ? ed.lw : ed.lh) : 2;
      items.push(d);
      chain.push(d);
    }
    chain.push(ed.b);
    ed.chain = chain;
    for (let k = 0; k < chain.length - 1; k++) { chain[k].down.push(chain[k + 1]); chain[k + 1].up.push(chain[k]); }
  }
  // ---- cluster borders: in every layer a cluster spans, a left and a right border item bracket its members.
  // Ordering keeps them at the ends of the cluster, so no foreign item can sit inside a cluster in any layer.
  const groupPath = (gid) => {
    const path = [];
    const seenG = new Set();
    let g = groupsById.get(gid);
    while (g && !seenG.has(g.id)) { seenG.add(g.id); path.unshift(g.id); g = g.parent ? groupsById.get(g.parent) : null; }
    return path;
  };
  const realOfGroup = new Map();
  for (const it of items) if (it.kind === 'real') for (const gid of it.cl) { if (!realOfGroup.has(gid)) realOfGroup.set(gid, []); realOfGroup.get(gid).push(it); }
  const borderOf = new Map(); // gid -> [{ l, L, R }]
  for (const g of model.groups) {
    const mem = realOfGroup.get(g.id);
    if (!mem || !mem.length) continue;
    const lmin0 = Math.min(...mem.map((i) => i.layer)), lmax0 = Math.max(...mem.map((i) => i.layer));
    const path = groupPath(g.id);
    const list = [];
    for (let l = lmin0; l <= lmax0; l++) {
      const mk = (side) => {
        const b = { kind: 'border', side, gid: g.id, layer: l, cl: path, idx: items.length, up: [], down: [] };
        b.cs = clPad + (side === 'L' && horizontal ? titleH : 0);
        b.ls = 0;
        items.push(b);
        return b;
      };
      list.push({ l, L: mk('L'), R: mk('R') });
    }
    borderOf.set(g.id, list);
  }
  const isBorder = (it) => it.kind === 'border';
  const maxLayer = items.reduce((m, it) => Math.max(m, it.layer), 0);
  const layers = Array.from({ length: maxLayer + 1 }, () => []);
  for (const it of items) layers[it.layer].push(it);

  // ---- initial order
  const dfsIdx = new Map();
  {
    let c = 0;
    const roots = ids.filter((id) => indeg.get(id) === 0);
    const order = seed === 3 ? [...roots].reverse() : roots;
    const visit = (id) => {
      if (dfsIdx.has(id)) return;
      dfsIdx.set(id, c++);
      const ch = outs.get(id).map((ed) => ed.b.id);
      for (const x of seed === 1 ? [...ch].reverse() : ch) visit(x);
    };
    if (seed === 2) ids.forEach((id) => dfsIdx.set(id, dfsIdx.size));
    else { order.forEach(visit); ids.forEach(visit); }
  }
  const keyOf = (it) => (it.kind === 'real' ? dfsIdx.get(it.id) : it.kind === 'dummy' ? dfsIdx.get(it.edge.a.id) + 0.5 + it.edge.i * 1e-4 : 0);
  for (const L of layers) { L.sort((p, q) => keyOf(p) - keyOf(q) || p.idx - q.idx); L.forEach((it, i) => (it.order = i)); }

  const BIG = 1e12;
  const sortLayer = (L, bcOf) => {
    const rec = (list, depth) => {
      const direct = [], sub = new Map();
      for (const it of list) {
        if (it.cl.length <= depth) direct.push(it);
        else { const g = it.cl[depth]; if (!sub.has(g)) sub.set(g, []); sub.get(g).push(it); }
      }
      const entries = direct.map((it) => ({ k: isBorder(it) ? (it.side === 'L' ? -BIG : BIG) : bcOf(it), o: it.order, items: [it] }));
      for (const arr of sub.values()) {
        const flat = rec(arr, depth + 1);
        const body = flat.filter((i) => !isBorder(i));
        entries.push({ k: body.length ? mean(body.map(bcOf)) : mean(flat.map((i) => i.order)), o: Math.min(...arr.map((i) => i.order)), items: flat });
      }
      entries.sort((p, q) => p.k - q.k || p.o - q.o);
      return entries.flatMap((e) => e.items);
    };
    const sorted = rec(L, 0);
    sorted.forEach((it, i) => (it.order = i));
    L.length = 0;
    L.push(...sorted);
  };
  // the first order already keeps every cluster in one piece
  for (const L of layers) sortLayer(L, (it) => it.order);

  const crossings = () => {
    let total = 0;
    for (let l = 0; l < layers.length - 1; l++) {
      const segs = [];
      for (const a of layers[l]) for (const b of a.down) segs.push([a.order, b.order]);
      for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if ((segs[i][0] - segs[j][0]) * (segs[i][1] - segs[j][1]) < 0) total++;
    }
    return total;
  };
  const snapshot = () => layers.map((L) => L.map((it) => it));
  const restore = (snap) => snap.forEach((L, l) => { layers[l].length = 0; layers[l].push(...L); layers[l].forEach((it, i) => (it.order = i)); });

  let best = { c: crossings(), snap: snapshot() };
  for (let iter = 0; iter < 14 && best.c > 0; iter++) {
    for (let l = 1; l < layers.length; l++) sortLayer(layers[l], (it) => (it.up.length ? mean(it.up.map((u) => u.order)) : it.order));
    for (let l = layers.length - 2; l >= 0; l--) sortLayer(layers[l], (it) => (it.down.length ? mean(it.down.map((u) => u.order)) : it.order));
    // transpose adjacent items of the same cluster
    for (let pass = 0; pass < 2; pass++) {
      for (let l = 0; l < layers.length; l++) {
        const L = layers[l];
        for (let i = 0; i + 1 < L.length; i++) {
          const A = L[i], B = L[i + 1];
          if (isBorder(A) || isBorder(B) || A.cl.join('/') !== B.cl.join('/')) continue;
          const cross = (x, y) => { let c = 0; for (const nx of [...x.up, ...x.down]) for (const ny of [...y.up, ...y.down]) { if ((nx.layer === ny.layer) && nx.order > ny.order) c++; } return c; };
          if (cross(B, A) < cross(A, B)) { L[i] = B; L[i + 1] = A; A.order = i + 1; B.order = i; }
        }
      }
    }
    const c = crossings();
    if (c < best.c) best = { c, snap: snapshot() };
  }
  restore(best.snap);
  const crossingCount = best.c;

  // ---- x coordinates
  // b lies inside the cluster that border a closes (b may be a nested border or the other border of a)
  const insideOf = (b, border) => b.cl.length >= border.cl.length && border.cl.every((g, i) => b.cl[i] === g);
  const sepOf = (a, b) => {
    const ab = isBorder(a), bb = isBorder(b);
    let base;
    if ((ab && insideOf(b, a)) || (bb && insideOf(a, b))) base = a.kind === 'dummy' || b.kind === 'dummy' ? edgeSep / 2 : 0;
    else if (ab || bb) base = a.kind === 'dummy' || b.kind === 'dummy' ? edgeSep : nodeSep * 0.5;
    else base = a.kind === 'dummy' || b.kind === 'dummy' ? edgeSep : nodeSep;
    return (a.cs + b.cs) / 2 + base;
  };
  for (const L of layers) {
    let x = 0;
    L.forEach((it, i) => { if (i === 0) x = it.cs / 2; else x += sepOf(L[i - 1], it); it.x = x; });
  }
  const wOf = (p, q) => (p.kind === 'dummy' && q.kind === 'dummy' ? 8 : p.kind === 'dummy' || q.kind === 'dummy' ? 2 : 1);
  const place = (L, desired) => {
    const n = L.length;
    if (!n) return;
    const cum = [0];
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + sepOf(L[i - 1], L[i]);
    const blocks = [];
    for (let i = 0; i < n; i++) {
      blocks.push({ sum: desired[i] - cum[i], wt: 1, from: i, to: i });
      while (blocks.length > 1) {
        const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
        if (a.sum / a.wt <= b.sum / b.wt) break;
        blocks.pop();
        a.sum += b.sum; a.wt += b.wt; a.to = b.to;
      }
    }
    for (const b of blocks) for (let i = b.from; i <= b.to; i++) L[i].x = b.sum / b.wt + cum[i];
  };
  const desiredFrom = (L, which) => {
    const d = new Map();
    for (const it of L) {
      if (isBorder(it)) continue;
      const nb = which === 'up' ? it.up : which === 'down' ? it.down : [...it.up, ...it.down];
      if (!nb.length) { d.set(it, it.x); continue; }
      let s = 0, w = 0;
      for (const m of nb) { const k = wOf(it, m); s += m.x * k; w += k; }
      d.set(it, s / w);
    }
    // A border hugs what its cluster holds in this layer: innermost clusters first.
    const bs = L.filter(isBorder).sort((p, q) => q.cl.length - p.cl.length);
    for (const b of bs) {
      let lo = Infinity, hi = -Infinity;
      for (const it of L) {
        if (it === b || !d.has(it) || !insideOf(it, b)) continue;
        if (isBorder(it) && it.gid === b.gid) continue;
        lo = Math.min(lo, d.get(it) - it.cs / 2);
        hi = Math.max(hi, d.get(it) + it.cs / 2);
      }
      if (lo === Infinity) d.set(b, b.x);
      else d.set(b, b.side === 'L' ? lo - b.cs / 2 : hi + b.cs / 2);
    }    return L.map((it) => d.get(it));
  };
  for (let pass = 0; pass < 22; pass++) {
    for (let l = 1; l < layers.length; l++) place(layers[l], desiredFrom(layers[l], 'up'));
    for (let l = layers.length - 2; l >= 0; l--) place(layers[l], desiredFrom(layers[l], 'down'));
  }
  for (let pass = 0; pass < 2; pass++) for (let l = 0; l < layers.length; l++) place(layers[l], desiredFrom(layers[l], 'both'));

  // A cluster outline follows its border items layer by layer. Where the space beside a border is free, the border
  // stretches to the widest extent of its cluster, so most outlines are plain rectangles. Outermost clusters go first;
  // an inner cluster is then held by the inner edge of its parent's border. A stretched border never meets a neighbour.
  {
    const ordered = [...borderOf.entries()].sort((p, q) => p[1][0].L.cl.length - q[1][0].L.cl.length);
    for (const [, list] of ordered) {
      const cLo = Math.min(...list.map((r) => r.L.x - r.L.cs / 2)), cHi = Math.max(...list.map((r) => r.R.x + r.R.cs / 2));
      for (const { l, L: bl, R: br } of list) {
        const arr = layers[l];
        const il = arr.indexOf(bl), ir = arr.indexOf(br);
        const prev = il > 0 ? arr[il - 1] : null, next = ir < arr.length - 1 ? arr[ir + 1] : null;
        const inner = bl.x + bl.cs / 2;
        const newLo = Math.min(inner - bl.cs, Math.max(cLo, prev ? prev.x + prev.cs / 2 + 3 : -Infinity));
        bl.cs = inner - newLo; bl.x = newLo + bl.cs / 2;
        const innerR = br.x - br.cs / 2;
        const newHi = Math.max(innerR + br.cs, Math.min(cHi, next ? next.x - next.cs / 2 - 3 : Infinity));
        br.cs = newHi - innerR; br.x = innerR + br.cs / 2;
      }
    }
  }
  // ---- layer coordinates
  const realList = items.filter((i) => i.kind === 'real');
  const clusterInfo = new Map();
  for (const g of model.groups) clusterInfo.set(g.id, { g, lmin: Infinity, lmax: -Infinity });
  for (const it of realList) for (const gid of it.cl) { const c = clusterInfo.get(gid); c.lmin = Math.min(c.lmin, it.layer); c.lmax = Math.max(c.lmax, it.layer); }
  const H = layers.map((L) => L.reduce((m, it) => Math.max(m, it.ls), 0));
  const gaps = [];
  const padEnd = []; // padding that the clusters ending at layer l need below it
  for (let l = 0; l < layers.length - 1; l++) {
    let g = gap0, pe = 0;
    for (const c of clusterInfo.values()) {
      if (c.lmin === Infinity) continue;
      if (c.lmin === l + 1) g += clPad + (!horizontal && !reversedLayers ? titleH : 0);
      if (c.lmax === l) { const p = clPad + (!horizontal && reversedLayers ? titleH : 0); g += p; pe += p; }
    }
    gaps.push(g);
    padEnd.push(pe);
  }
  const yTop = [0];
  for (let l = 0; l < layers.length - 1; l++) yTop.push(yTop[l] + H[l] + gaps[l]);
  const totalLayerExtent = yTop[yTop.length - 1] + H[H.length - 1];
  for (const L of layers) L.forEach((it) => { it.y = yTop[it.layer] + H[it.layer] / 2; });

  // ---- ports
  const portOut = new Map(); // key edge.i + ':' + 'out'|'in' -> x
  const sidePorts = (it, list, neighbourX, key) => {
    if (!list.length) return;
    const sorted = [...list].sort((p, q) => neighbourX(p) - neighbourX(q) || p.i - q.i);
    const m = sorted.length;
    const half = Math.max(2, Math.min(it.cs * (it.shape === 'diamond' ? 0.3 : ELLIPSE_SHAPES.has(it.shape) ? 0.3 : 0.38) , ((m - 1) * portGap) / 2));
    const desired = sorted.map((ed) => Math.max(it.x - half, Math.min(it.x + half, neighbourX(ed))));
    const xs = [...desired];
    for (let k = 1; k < m; k++) xs[k] = Math.max(xs[k], xs[k - 1] + portGap);
    const over = xs[m - 1] - (it.x + half);
    if (over > 0) for (let k = 0; k < m; k++) xs[k] -= over;
    sorted.forEach((ed, k) => portOut.set(ed.i + ':' + key, xs[k]));
  };
  for (const it of realList) {
    const outList = edges.filter((ed) => ed.a === it);
    const inList = edges.filter((ed) => ed.b === it);
    sidePorts(it, outList, (ed) => ed.chain[1].x, 'out');
    sidePorts(it, inList, (ed) => ed.chain[ed.chain.length - 2].x, 'in');
  }
  // A jog of a few units reads as a kink. Each edge keeps one x per vertical run (port, lane of each dummy, port).
  // Lanes within 8 units of the run before them join it. If the two ports differ by 8 units or less and the target has room
  // and no other port there, the target port moves onto the source port and the whole edge is straight. A port never leaves its node.
  const runX = new Map();
  {
    const SNAP = 8;
    const halfRoom = (it) => Math.max(2, it.cs * (it.shape === 'diamond' || ELLIPSE_SHAPES.has(it.shape) ? 0.3 : 0.4));
    const free = (list, key, ed, x) => !list.some((o) => o !== ed && Math.abs(portOut.get(o.i + ':' + key) - x) < 6);
    for (const ed of edges) {
      const xs = [portOut.get(ed.i + ':out'), ...ed.chain.slice(1, -1).map((c) => c.x), portOut.get(ed.i + ':in')];
      const last = xs.length - 1;
      const A = ed.chain[0], B = ed.chain[last];
      const lanes = xs.slice(1, last);
      const near = lanes.every((x) => Math.abs(x - xs[0]) <= SNAP && Math.abs(x - xs[last]) <= SNAP);
      const toTarget = near && Math.abs(xs[0] - xs[last]) <= SNAP && Math.abs(xs[0] - B.x) <= halfRoom(B) && free(edges.filter((o) => o.b === B), 'in', ed, xs[0]);
      const toSource = near && !toTarget && Math.abs(xs[0] - xs[last]) <= SNAP && Math.abs(xs[last] - A.x) <= halfRoom(A) && free(edges.filter((o) => o.a === A), 'out', ed, xs[last]);
      if (toTarget || toSource) {
        const x = toTarget ? xs[0] : xs[last];
        portOut.set(ed.i + ':in', x);
        portOut.set(ed.i + ':out', x);
        for (let i = 0; i <= last; i++) xs[i] = x;      } else {
        let cur = xs[0];
        for (let i = 1; i < last; i++) { if (Math.abs(xs[i] - cur) <= SNAP) xs[i] = cur; else cur = xs[i]; }
        cur = xs[last];
        for (let i = last - 1; i >= 1; i--) { if (xs[i] !== xs[0] && Math.abs(xs[i] - cur) <= SNAP) xs[i] = cur; else cur = xs[i]; }
      }
      void A; void lanes;
      runX.set(ed.i, xs);
    }
  }  const xOut = (ed, k) => runX.get(ed.i)[k];
  const xIn = (ed, k) => runX.get(ed.i)[k];
  // ---- jog tracks per gap
  const jogs = layers.map(() => []);
  for (const ed of edges) {
    for (let k = 0; k < ed.chain.length - 1; k++) {
      const xa = xOut(ed, k), xb = xIn(ed, k + 1);
      if (Math.abs(xa - xb) > 0.5) jogs[ed.chain[k].layer].push({ ed, k, xa, xb, lo: Math.min(xa, xb), hi: Math.max(xa, xb) });
    }
  }
  const jogY = new Map();
  jogs.forEach((list, l) => {
    if (!list.length) return;
    list.sort((p, q) => p.lo - q.lo || p.hi - q.hi);
    const tracks = [];
    for (const j of list) {
      let t = tracks.findIndex((end) => end < j.lo - 6);
      if (t < 0) { t = tracks.length; tracks.push(-Infinity); }
      tracks[t] = j.hi;
      j.track = t;
    }
    const T = tracks.length;
    const y0 = yTop[l] + H[l], y1 = yTop[l + 1];
    for (const j of list) jogY.set(j.ed.i + ':' + j.k, y0 + ((y1 - y0) * (j.track + 1)) / (T + 1));
  });

  // ---- transform
  const flipL = reversedLayers;
  const toFinal = (x, y) => {
    const yy = flipL ? totalLayerExtent - y : y;
    return horizontal ? [yy, x] : [x, yy];
  };

  const nodes = realList.map((it) => {
    const [cx, cy] = toFinal(it.x, it.y);
    return { id: it.id, shape: it.shape, lines: it.lines, label: it.node.label, classes: it.node.classes, style: it.node.style, x: cx - it.w / 2, y: cy - it.h / 2, w: it.w, h: it.h, tw: it.tw, th: it.th, layer: it.layer, cl: it.cl, _it: it };
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const edgeOut = [];
  for (const ed of edges) {
    const { chain } = ed;
    const A = chain[0], B = chain[chain.length - 1];
    const aSide = flipL ? -1 : 1;
    const pts = [];
    const yEdge = (it, x, down) => it.y + (down ? 1 : -1) * boundaryOffset(it.shape, x - it.x, it.cs / 2, it.ls / 2);
    const xs = xOut(ed, 0);
    pts.push([xs, yEdge(A, xs, true)]);
    for (let k = 0; k < chain.length - 1; k++) {
      const xa = xOut(ed, k), xb = xIn(ed, k + 1);
      if (Math.abs(xa - xb) > 0.5) { const yj = jogY.get(ed.i + ':' + k); pts.push([xa, yj], [xb, yj]); }
    }
    const xe = xIn(ed, chain.length - 1);
    pts.push([xe, yEdge(B, xe, false)]);
    void aSide;
    const fin = pts.map(([x, y]) => toFinal(x, y));
    let label = null;
    const ld = chain.find((c) => c.kind === 'dummy' && c.isLabel);
    if (ld) {
      const [cx, cy] = toFinal(runX.get(ed.i)[chain.indexOf(ld)], ld.y);
      const w = horizontal ? ld.ls : ld.cs, h = horizontal ? ld.cs : ld.ls;
      label = { lines: ed.lines, x: cx - w / 2, y: cy - h / 2, w, h };
    }
    // edge drawn from A to B in layered order; heads follow the original direction
    const startHead = ed.rev ? ed.e.head : ed.e.tail;
    const endHead = ed.rev ? ed.e.tail : ed.e.head;
    edgeOut.push({ from: ed.from.id, to: ed.to.id, kind: ed.e.kind, pts: fin, headStart: startHead, headEnd: endHead, label, i: ed.i });
  }

  // self loops (drawn on the cross-axis side)
  const loops = selfLoops.map((s) => {
    const n = nodeById.get(s.e.from);
    const horizontalLoop = horizontal;
    const r = 22;
    let pts, label = null;
    if (!horizontalLoop) {
      const x1 = n.x + n.w, yA = n.y + n.h * 0.3, yB = n.y + n.h * 0.7;
      pts = [[x1, yA], [x1 + r, yA], [x1 + r, yB], [x1, yB]];
      if (s.lines.length) label = { lines: s.lines, x: x1 + r + 4, y: n.y + n.h / 2 - s.lh / 2, w: s.lw, h: s.lh };
    } else {
      const y1 = n.y + n.h, xA = n.x + n.w * 0.3, xB = n.x + n.w * 0.7;
      pts = [[xA, y1], [xA, y1 + r], [xB, y1 + r], [xB, y1]];
      if (s.lines.length) label = { lines: s.lines, x: n.x + n.w / 2 - s.lw / 2, y: y1 + r + 2, w: s.lw, h: s.lh };
    }
    return { from: n.id, to: n.id, kind: s.e.kind, pts, headStart: s.e.tail, headEnd: s.e.head, label, i: s.i, self: true };
  });

  // ---- clusters: one outline per cluster, a rectilinear polygon through the border items of every layer it spans.
  // Every cluster is cut into the same layer bands, and in each band the extents of two clusters never meet, so outlines cannot overlap.
  const clusters = [];
  const lbox = new Map();
  const depthOf = (g) => { let d = 0; let p = g; while (p && p.parent) { d++; p = groupsById.get(p.parent); } return d; };
  const order = [...model.groups].sort((p, q) => depthOf(q) - depthOf(p));
  // Between layer l and l+1: below the padding of the clusters that end at l, above the padding of those that start at l+1.
  const bandEdge = (l) => yTop[l] + H[l] + padEnd[l] + gap0 / 2;
  for (const g of order) {
    const list = borderOf.get(g.id);
    if (!list) continue;
    const lmin1 = list[0].l, lmax1 = list[list.length - 1].l;
    let y0 = yTop[lmin1], y1 = yTop[lmax1] + H[lmax1];
    for (const c of model.groups) if (c.parent === g.id && lbox.has(c.id)) { y0 = Math.min(y0, lbox.get(c.id).y0); y1 = Math.max(y1, lbox.get(c.id).y1); }
    y0 -= clPad + (!horizontal && !reversedLayers ? titleH : 0);
    y1 += clPad + (!horizontal && reversedLayers ? titleH : 0);
    lbox.set(g.id, { y0, y1 });
    const lo = list.map((r) => r.L.x - r.L.cs / 2), hi = list.map((r) => r.R.x + r.R.cs / 2);
    // a title wider than the first band widens that band
    const titleW = measure(g.label, labelPx + 0.5, true) + 2 * 12;
    const firstTop = reversedLayers ? list.length - 1 : 0;
    if (!horizontal && hi[firstTop] - lo[firstTop] < titleW) { const d = (titleW - (hi[firstTop] - lo[firstTop])) / 2; lo[firstTop] -= d; hi[firstTop] += d; }
    const n = list.length;
    const edgeY = (k) => bandEdge(list[k].l);
    const right = [[hi[0], y0]];
    for (let k = 0; k < n - 1; k++) right.push([hi[k], edgeY(k)], [hi[k + 1], edgeY(k)]);
    right.push([hi[n - 1], y1]);
    const left = [[lo[n - 1], y1]];
    for (let k = n - 1; k > 0; k--) left.push([lo[k], edgeY(k - 1)], [lo[k - 1], edgeY(k - 1)]);
    left.push([lo[0], y0]);
    const poly = [...right, ...left].map(([x, y]) => toFinal(x, y));
    const rects = list.map((r, k) => {
      const ya = k === 0 ? y0 : edgeY(k - 1), yb = k === n - 1 ? y1 : edgeY(k);
      const [ax, ay] = toFinal(lo[k], ya), [bx, by] = toFinal(hi[k], yb);
      return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
    });
    const xs = rects.flatMap((r) => [r[0], r[2]]), ys = rects.flatMap((r) => [r[1], r[3]]);
    const bx0 = Math.min(...xs), by0 = Math.min(...ys);
    const k0t = reversedLayers ? n - 1 : 0;
    const titleAt = toFinal(lo[k0t], reversedLayers ? y1 : y0);
    clusters.push({ id: g.id, title: g.label, x: bx0, y: by0, w: Math.max(...xs) - bx0, h: Math.max(...ys) - by0, depth: depthOf(g), poly, rects, titleAt });
  }  clusters.sort((p, q) => p.depth - q.depth);
  // ---- normalise to a margin
  const margin = o.margin ?? 16;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y, w, h) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h); };
  for (const n of nodes) grow(n.x, n.y, n.w, n.h);
  for (const c of clusters) grow(c.x, c.y, c.w, c.h);
  for (const e of [...edgeOut, ...loops]) { for (const [x, y] of e.pts) grow(x - 1, y - 1, 2, 2); if (e.label) grow(e.label.x, e.label.y, e.label.w, e.label.h); }
  const dx = margin - minX, dy = margin - minY;
  for (const n of nodes) { n.x += dx; n.y += dy; delete n._it; }
  for (const c of clusters) { c.x += dx; c.y += dy; c.poly = c.poly.map(([x, y]) => [x + dx, y + dy]); c.rects = c.rects.map((r) => [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy]); c.titleAt = [c.titleAt[0] + dx, c.titleAt[1] + dy]; }
  for (const e of [...edgeOut, ...loops]) { e.pts = e.pts.map(([x, y]) => [x + dx, y + dy]); if (e.label) { e.label.x += dx; e.label.y += dy; } }
  const width = maxX - minX + 2 * margin, height = maxY - minY + 2 * margin;

  return {
    kind: 'flow', width, height, nodes, edges: [...edgeOut, ...loops], clusters,
    params: { dir, wrap, spacing: sp, seed, fontPx, labelPx },
    stats: { nodes: nodes.length, edges: edges.length + selfLoops.length, layers: layers.length, crossings: crossingCount },
  };
}












