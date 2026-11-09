/**
 * The Molecullage gate. It scores a drawn scene against the rules of Molecullage qa/qa_fig.py and palette/check_palette.py:
 *   hard marks (a failure means the layout is not accepted): overlap, edge through a node, cluster holding a foreign node,
 *     text outside its shape, type floor (6.5 pt at 178 mm), text contrast (4.5);
 *   raster marks at strictness "normal" (ink, cells, band, blank): same algorithm as qa_fig.array_metrics, run on our own
 *     deterministic raster of the scene on white paper, so the same source gives the same marks on every machine;
 *   colour marks: worst-case CIEDE2000 over four vision types of the chromatic fills (11.5), hues (8);
 *   words (130), nested boxes (rule 40).
 * Pure functions, no DOM.
 */
import { contrast, minDE, isChromatic, lightness, parseHex } from './colour.mjs';
import { PRINT_THEME, resolveColour } from './scene.mjs';

export const LIMITS = { ink: [9.0, '>='], cells: [25.0, '<='], band: [4.0, '<='], blank: [6.0, '<='], type: [6.5, '>='] };
export const TOL = 0.06;
export const CV_WARN = 11.5;
export const MAX_HUES = 8;
export const WORDS_BUDGET = 130;
export const REFERENCE_WIDTH_MM = 178;
/** Share of a text box that counts as ink in the raster. Calibrated once against qa/audit_raster.py on the fixtures (test/reference.test.mjs). */
export const TEXT_INK_PERCENT = 15;
/** Height of the ink part of a text box (the box is a line height; glyphs fill about 0.6 of it). */
export const TEXT_BOX_HEIGHT = 0.6;
/** Anti-aliasing: a stroke darkens about half a pixel more than its geometric width on each side. */
export const STROKE_EXTRA_PX = 0.5;

// ---------------------------------------------------------------------------------------------
// Raster marks

const minChan = (hex) => { const c = parseHex(hex); return c ? Math.round(Math.min(...c) * 255) : 255; };

function primBox(p) {
  switch (p.t) {
    case 'rect': return [p.x, p.y, p.x + p.w, p.y + p.h];
    case 'ellipse': return [p.cx - p.rx, p.cy - p.ry, p.cx + p.rx, p.cy + p.ry];
    case 'poly': return [Math.min(...p.pts.map((q) => q[0])), Math.min(...p.pts.map((q) => q[1])), Math.max(...p.pts.map((q) => q[0])), Math.max(...p.pts.map((q) => q[1]))];
    case 'path': return p.rpts && p.rpts.length ? [Math.min(...p.rpts.map((q) => q[0])), Math.min(...p.rpts.map((q) => q[1])), Math.max(...p.rpts.map((q) => q[0])), Math.max(...p.rpts.map((q) => q[1]))] : null;
    default: return null;
  }
}

function fillPoly(buf, W, H, pts, val) {
  const ys = pts.map((q) => q[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.round(xs[k])), xb = Math.min(W, Math.round(xs[k + 1]));
      for (let x = xa; x < xb; x++) buf[y * W + x] = val;
    }
  }
}

function strokeLine(buf, W, H, pts, r, val, closed, dash) {
  const n = closed ? pts.length : pts.length - 1;
  let before = 0;
  const period = dash ? dash[0] + dash[1] : 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r - 1)), x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0]) + r + 1));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r - 1)), y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1]) + r + 1));
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1e-9;
    const len = Math.sqrt(l2);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = Math.max(0, Math.min(1, ((x + 0.5 - a[0]) * dx + (y + 0.5 - a[1]) * dy) / l2));
        const ex = a[0] + t * dx - (x + 0.5), ey = a[1] + t * dy - (y + 0.5);
        if (ex * ex + ey * ey > r * r) continue;
        if (dash && (before + t * len) % period >= dash[0]) continue;
        buf[y * W + x] = val;
      }
    }
    before += len;
  }
}
function roundedRect(x0, y0, x1, y1, r) {
  if (r < 1) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const pts = [];
  const corner = (cx, cy, a0) => { for (let i = 0; i <= 5; i++) { const a = a0 + (i / 5) * (Math.PI / 2); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  corner(x1 - r, y0 + r, -Math.PI / 2); corner(x1 - r, y1 - r, 0); corner(x0 + r, y1 - r, Math.PI / 2); corner(x0 + r, y0 + r, Math.PI);
  return pts;
}

const ellipsePts = (cx, cy, rx, ry, n = 48) => Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI)]);

/** Min channel value per pixel (255 = white paper) of the scene drawn with the print theme. */
export function rasterise(scene, theme = PRINT_THEME, width = 900, maxPixels = 4e6) {
  // Slender drawings are drawn smaller so that the raster stays under the pixel budget; the marks are ratios.
  const W = Math.max(60, Math.floor(Math.min(width, Math.sqrt((maxPixels * scene.width) / scene.height))));
  const sc = W / scene.width;
  const H = Math.max(1, Math.ceil(scene.height * sc));
  const buf = new Uint8Array(W * H).fill(255);
  const S = (pts) => pts.map(([x, y]) => [x * sc, y * sc]);
  for (const p of scene.prims) {
    const fillHex = resolveColour(p.fill, theme), strokeHex = resolveColour(p.stroke, theme);
    const fv = fillHex ? minChan(fillHex) : null, sv = strokeHex ? minChan(strokeHex) : null;
    const r = Math.max(0.5, ((p.sw || 0) * sc) / 2) + STROKE_EXTRA_PX;
    const dash = p.dash ? p.dash.split(/\s+/).map((v) => parseFloat(v) * sc) : null;
    if (p.t === 'rect') {
      const x0 = p.x * sc, y0 = p.y * sc, x1 = (p.x + p.w) * sc, y1 = (p.y + p.h) * sc;
      const poly = roundedRect(x0, y0, x1, y1, Math.min((p.rx || 0) * sc, (x1 - x0) / 2, (y1 - y0) / 2));
      if (fv !== null) fillPoly(buf, W, H, poly, fv);
      if (sv !== null && p.sw) strokeLine(buf, W, H, poly, r, sv, true, dash);
    } else if (p.t === 'ellipse') {
      const pts = S(ellipsePts(p.cx, p.cy, p.rx, p.ry));
      if (fv !== null) fillPoly(buf, W, H, pts, fv);
      if (sv !== null && p.sw) strokeLine(buf, W, H, pts, r, sv, true, dash);
    } else if (p.t === 'poly') {
      const pts = S(p.pts);
      if (fv !== null) fillPoly(buf, W, H, pts, fv);
      if (sv !== null && p.sw) strokeLine(buf, W, H, pts, r, sv, true, dash);
    } else if (p.t === 'line') {
      if (sv !== null) strokeLine(buf, W, H, S(p.pts), r, sv, false, dash);
    } else if (p.t === 'path') {
      const pts = p.rpts && p.rpts.length ? S(p.rpts) : null;
      if (!pts) continue;
      if (fv !== null && p.role !== 'edge') fillPoly(buf, W, H, pts, fv);
      if (sv !== null) strokeLine(buf, W, H, pts, r, sv, !!p.closed || (p.role !== 'edge' && fv !== null), dash);
    } else if (p.t === 'text' && p.bbox) {
      const th = resolveColour(p.fill, theme);
      const v = th ? Math.min(60, minChan(th)) : 40;
      const fh = TEXT_BOX_HEIGHT;
      const bx = p.bbox.x, bw = p.bbox.w, by = p.bbox.y + (p.bbox.h * (1 - fh)) / 2, bh = p.bbox.h * fh;
      const x0 = Math.max(0, Math.floor(bx * sc)), x1 = Math.min(W, Math.ceil((bx + bw) * sc));
      const y0 = Math.max(0, Math.floor(by * sc)), y1 = Math.min(H, Math.ceil((by + bh) * sc));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if ((x * 7 + y * 13) % 100 < TEXT_INK_PERCENT) buf[y * W + x] = v;
    }
  }
  return { buf, W, H };
}

export function largestEmptyRect(empty, rows, cols) {
  const h = new Int32Array(cols);
  let best = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) h[c] = empty[r * cols + c] ? h[c] + 1 : 0;
    const stack = [];
    for (let i = 0; i <= cols; i++) {
      const v = i < cols ? h[i] : 0;
      let start = i;
      while (stack.length && stack[stack.length - 1][1] >= v) {
        const [s, hh] = stack.pop();
        best = Math.max(best, hh * (i - s));
        start = s;
      }
      stack.push([start, v]);
    }
  }
  return best;
}

/** qa_fig.array_metrics on a min-channel buffer: ink, cells, band, blank (all in percent). */
export function arrayMetrics({ buf, W, H }) {
  let dark = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] < 235) dark++;
  const gh = Math.floor(H / 12), gw = Math.floor(W / 20);
  let occupied = 0;
  for (let ci = 0; ci < 12; ci++) {
    for (let cj = 0; cj < 20; cj++) {
      let s = 0;
      for (let y = ci * gh; y < (ci + 1) * gh; y++) for (let x = cj * gw; x < (cj + 1) * gw; x++) if (buf[y * W + x] < 235) s++;
      if (s / (gh * gw) >= 0.01) occupied++;
    }
  }
  let run = 0, band = 0;
  for (let y = 0; y < H; y++) {
    let any = false;
    for (let x = 0; x < W; x++) if (buf[y * W + x] < 235) { any = true; break; }
    run = any ? 0 : run + 1;
    band = Math.max(band, run);
  }
  const tile = Math.max(Math.floor(W / 60), 1);
  const th = Math.floor(H / tile), tw = Math.floor(W / tile);
  const empty = new Uint8Array(th * tw);
  for (let ti = 0; ti < th; ti++) {
    for (let tj = 0; tj < tw; tj++) {
      let s = 0;
      for (let y = ti * tile; y < (ti + 1) * tile; y++) for (let x = tj * tile; x < (tj + 1) * tile; x++) if (buf[y * W + x] < 248) s++;
      empty[ti * tw + tj] = s / (tile * tile) >= 0.01 ? 0 : 1;
    }
  }
  return {
    ink: (100 * dark) / buf.length,
    cells: 100 * (1 - occupied / (12 * 20)),
    band: (100 * band) / H,
    blank: th * tw ? (100 * largestEmptyRect(empty, th, tw)) / (th * tw) : 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Geometry

const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
const shrink = (b, d) => [b[0] + d, b[1] + d, b[2] - d, b[3] - d];

function segHitsBox(a, b, box) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - box[0]], [dx, box[2] - a[0]], [-dy, a[1] - box[1]], [dy, box[3] - a[1]]]) {
    if (p === 0) { if (q < 0) return false; } else {
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

function textFits(n, tw, th) {
  const { w, h, shape } = n;
  if (!n.lines.length) return true;
  const a = w / 2, b = h / 2;
  switch (shape) {
    case 'diamond': return tw / 2 / a + th / 2 / b <= 1.0001;
    case 'circle': case 'doublecircle': return (tw / 2 / a) ** 2 + (th / 2 / b) ** 2 <= 1.0001;
    default: return tw <= w - 10 && th <= h - 6;
  }
}

/**
 * Score a scene.
 * @param model parsed model, @param layout its layout, @param scene its scene
 * @param o { live: hex map of the current theme (optional), raster: false to skip the raster marks }
 */
export function gate(model, layout, scene, o = {}) {
  const marks = {};
  const hard = [];
  const warn = [];
  const live = o.live || PRINT_THEME;

  // ---- geometry
  const boxes = scene.prims.filter((p) => (p.role === 'node' || p.role === 'mark') && p.id && p.id !== 'tab' && p.id !== 'activation').map((p) => ({ id: p.id, b: primBox(p), role: p.role })).filter((x) => x.b);
  let overlap = 0, edgeThrough = 0, clusterForeign = 0;
  if (scene.kind === 'flow') {
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxes[i].id !== boxes[j].id && inter(shrink(boxes[i].b, 0.5), shrink(boxes[j].b, 0.5)) > 0) overlap++;
    const labels = scene.prims.filter((p) => p.role === 'label-bg');
    for (const l of labels) {
      const lb = [l.x, l.y, l.x + l.w, l.y + l.h];
      for (const nb of boxes) if (inter(lb, nb.b) > 0.5) overlap++;
    }
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j];
      if (inter([a.x, a.y, a.x + a.w, a.y + a.h], [b.x, b.y, b.x + b.w, b.y + b.h]) > 0.5) overlap++;
    }
    const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
    for (const p of scene.prims) {
      if (p.role !== 'edge' || !p.rpts) continue;
      const pts = p.rpts;
      for (const nb of boxes) {
        if (nb.id === p.from || nb.id === p.to) continue;
        const bb = shrink(nb.b, 1);
        let hit = false;
        for (let k = 0; k + 1 < pts.length && !hit; k++) hit = segHitsBox(pts[k], pts[k + 1], bb);
        if (hit) edgeThrough++;
      }
    }
    for (const c of layout.clusters) {
      for (const n of layout.nodes) {
        if (n.cl.includes(c.id)) continue;
        const nb = [n.x, n.y, n.x + n.w, n.y + n.h];
        if (c.rects.some((r) => inter(r, nb) > 0.5)) clusterForeign++;
      }
      for (const c2 of layout.clusters) {
        if (c2.id <= c.id) continue;
        const nested = layout.nodes.some((n) => n.cl.includes(c.id) && n.cl.includes(c2.id)) || layout.clusters.some((x) => false);
        if (nested) continue;
        if (c.rects.some((r) => c2.rects.some((r2) => inter(r, r2) > 0.5))) clusterForeign++;
      }
    }    void nodeById;
  }
  const textBoxes = scene.prims.filter((p) => p.t === 'text' && p.bbox).map((p) => ({ b: [p.bbox.x, p.bbox.y, p.bbox.x + p.bbox.w, p.bbox.y + p.bbox.h], id: p.id, role: p.role }));
  let textOverlap = 0;
  for (let i = 0; i < textBoxes.length; i++) for (let j = i + 1; j < textBoxes.length; j++) if (inter(shrink(textBoxes[i].b, 1), shrink(textBoxes[j].b, 1)) > 0) textOverlap++;
  marks.overlap = { value: overlap + clusterForeign + textOverlap, detail: { nodes: overlap, clusterForeign, text: textOverlap }, status: overlap + clusterForeign + textOverlap === 0 ? 'ok' : 'FAIL', reason: '' };
  if (marks.overlap.status !== 'ok') { marks.overlap.reason = `${overlap} box overlaps, ${clusterForeign} foreign nodes inside a cluster, ${textOverlap} text collisions`; hard.push('overlap'); }
  if (scene.kind === 'flow') {
    marks.edgeThrough = { value: edgeThrough, status: edgeThrough === 0 ? 'ok' : 'FAIL', reason: edgeThrough ? `${edgeThrough} edges cross a node they do not join` : '' };
    if (edgeThrough) hard.push('edgeThrough');
    const bad = layout.nodes.filter((n) => !textFits(n, n.tw, n.th));
    marks.textFit = { value: bad.length, status: bad.length === 0 ? 'ok' : 'FAIL', reason: bad.length ? `text leaves its shape in ${bad.map((b) => b.id).join(', ')}` : '' };
    if (bad.length) hard.push('textFit');
  }

  // ---- type floor
  const sizes = scene.prims.filter((p) => p.t === 'text').map((p) => p.size);
  const minPx = sizes.length ? Math.min(...sizes) : 13;
  const pt = (minPx / scene.width) * REFERENCE_WIDTH_MM * (72 / 25.4);
  marks.type = { value: Math.round(pt * 100) / 100, limit: LIMITS.type[0], op: '>=', status: pt >= LIMITS.type[0] - TOL ? 'ok' : 'FAIL', reason: '' };
  if (marks.type.status !== 'ok') { marks.type.reason = `smallest text prints at ${pt.toFixed(1)} pt on a 178 mm figure, limit ${LIMITS.type[0]} pt (the drawing is ${Math.round(scene.width)} units wide)`; hard.push('type'); }

  // ---- contrast
  let worst = Infinity, worstWhere = '';
  for (const p of scene.prims) {
    if (p.t !== 'text') continue;
    const fg = resolveColour(p.fill, live);
    const bg = p.onFill || (p.role === 'edge-label' ? resolveColour('labelBg', live) : resolveColour('bg', live));
    if (!fg || !bg) continue;
    const c = contrast(fg, bg);
    if (c < worst) { worst = c; worstWhere = p.role; }
  }
  if (worst === Infinity) worst = 21;
  marks.contrast = { value: Math.round(worst * 10) / 10, limit: 4.5, op: '>=', status: worst >= 4.5 ? 'ok' : 'FAIL', reason: worst >= 4.5 ? '' : `text contrast ${worst.toFixed(1)} in ${worstWhere}` };
  if (marks.contrast.status !== 'ok') hard.push('contrast');

  // ---- raster marks (print theme on white paper)
  if (o.raster !== false) {
    const m = arrayMetrics(rasterise(scene, PRINT_THEME, 900));
    for (const k of ['ink', 'cells', 'band', 'blank']) {
      const [lim, op] = LIMITS[k];
      const ok = op === '>=' ? m[k] >= lim - TOL : m[k] <= lim;
      marks[k] = { value: Math.round(m[k] * 100) / 100, limit: lim, op, status: ok ? 'ok' : 'warn', reason: ok ? '' : `${k} ${m[k].toFixed(1)}% is ${op === '>=' ? 'below' : 'above'} ${lim}%` };
      if (!ok) warn.push(k);
    }
  }

  // ---- colour
  const fills = [...new Set(scene.fills.map((f) => f.fill))];
  const chroma = fills.filter(isChromatic);
  const marksHex = chroma.filter((h) => lightness(h) <= 85);
  if (marksHex.length >= 2) {
    const d = minDE(marksHex);
    const ok = d.value >= CV_WARN - 1e-6;
    marks.colour = { value: Math.round(d.value * 10) / 10, limit: CV_WARN, op: '>=', vision: d.kind, pair: d.pair, status: ok ? 'ok' : 'warn', reason: ok ? '' : `two fills differ by ${d.value.toFixed(1)} for ${d.kind} vision, limit ${CV_WARN}` };
    if (!ok) warn.push('colour');
  } else marks.colour = { value: null, status: 'ok', reason: 'fewer than two chromatic fills', limit: CV_WARN };
  marks.hues = { value: chroma.length, limit: MAX_HUES, op: '<=', status: chroma.length <= MAX_HUES ? 'ok' : 'warn', reason: chroma.length <= MAX_HUES ? '' : `${chroma.length} hues` };
  if (marks.hues.status !== 'ok') warn.push('hues');

  // ---- words and nested boxes
  marks.words = { value: scene.words, limit: WORDS_BUDGET, op: '<=', status: scene.words <= WORDS_BUDGET ? 'ok' : 'warn', reason: scene.words <= WORDS_BUDGET ? '' : `${scene.words} words, schematic budget ${WORDS_BUDGET}` };
  if (marks.words.status !== 'ok') warn.push('words');
  if (scene.kind === 'flow') {
    const nested = layout.nodes.filter((n) => n.cl.length).length + layout.clusters.filter((c) => c.depth > 0).length;
    marks.overplate = { value: nested, limit: 0, op: '<=', status: nested === 0 ? 'ok' : 'warn', reason: nested ? `${nested} boxes sit inside a subgraph box (rule 40)` : '' };
    if (nested) warn.push('overplate');
  }

  const level = hard.length ? 'fail' : warn.length ? 'warn' : 'pass';
  const exceed = (k) => { const m = marks[k]; if (!m || m.status === 'ok' || m.value == null) return 0; return Math.min(3, Math.abs(m.value - m.limit) / Math.max(m.limit, 1)); };
  const crossings = layout.stats ? layout.stats.crossings : 0;
  const score = hard.length * 1000 + (marks.overlap.value + (marks.edgeThrough ? marks.edgeThrough.value : 0)) * 50 +
    10 * (exceed('ink') + exceed('cells') + exceed('band') + exceed('blank')) + (marks.colour.status === 'warn' ? 5 : 0) + (marks.words.status === 'warn' ? 2 : 0) +
    (marks.overplate && marks.overplate.status === 'warn' ? 1 : 0) + crossings * 3 + (marks.type.status === 'FAIL' ? exceed2(marks.type) : 0);
  return { level, hard, warn, marks, score: Math.round(score * 100) / 100 };
}

function exceed2(t) { return Math.min(500, (t.limit - t.value) * 50); }














