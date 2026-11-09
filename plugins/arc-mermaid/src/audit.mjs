/**
 * Audit of a drawn card, on the real DOM with the real font. It looks at the SVG the way the eye does:
 *   text-overlap     two pieces of text cover each other
 *   line-over-text   a line, lifeline or outline crosses text that no pill or fill protects
 *   text-outside     text leaves the shape it sits in, or leaves the drawing
 * The card runs it after every drawing and draws again with wider text boxes while it finds problems. The test harness runs the
 * same function, so what the tests accept is what the app accepts. Needs getBBox, so it only runs in a browser.
 */

const a_num = (v) => parseFloat(v);

function a_bboxOf(el) {
  const b = el.getBBox();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

const a_inter = (a, b, pad = 0) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) - pad) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) - pad);
const a_inside = (inner, outer, slack = 0) => inner.x >= outer.x - slack && inner.y >= outer.y - slack && inner.x + inner.w <= outer.x + outer.w + slack && inner.y + inner.h <= outer.y + outer.h + slack;
const a_hit = (p, r) => p[0] > r.x && p[0] < r.x + r.w && p[1] > r.y && p[1] < r.y + r.h;

/** Points along a stroked element, about every 3 units. */
function a_samples(el) {
  const tag = el.localName;
  const out = [];
  const walk = (pts) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
      for (let k = 0; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
  };
  if (tag === 'polyline' || tag === 'polygon') {
    const pts = el.getAttribute('points').trim().split(/\s+/).map((s) => s.split(',').map(Number));
    if (tag === 'polygon') pts.push(pts[0]);
    walk(pts);
  } else if (tag === 'path') {
    const len = el.getTotalLength();
    for (let d = 0; d <= len; d += 3) { const p = el.getPointAtLength(d); out.push([p.x, p.y]); }
  } else if (tag === 'rect') {
    const x = a_num(el.getAttribute('x')), y = a_num(el.getAttribute('y')), w = a_num(el.getAttribute('width')), h = a_num(el.getAttribute('height'));
    walk([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]);
  } else if (tag === 'ellipse') {
    const cx = a_num(el.getAttribute('cx')), cy = a_num(el.getAttribute('cy')), rx = a_num(el.getAttribute('rx')), ry = a_num(el.getAttribute('ry'));
    const pts = Array.from({ length: 64 }, (_, i) => [cx + rx * Math.cos((i / 64) * 2 * Math.PI), cy + ry * Math.sin((i / 64) * 2 * Math.PI)]);
    pts.push(pts[0]);
    walk(pts);
  }
  return out;
}

/** @returns {{kind: string, text: string, detail: string}[]} */
export function auditSvg(svg) {
  const issues = [];
  const all = [...svg.querySelectorAll('*')];
  const order = new Map(all.map((e, i) => [e, i]));
  const vb = svg.viewBox.baseVal;
  const view = { x: 0, y: 0, w: vb.width, h: vb.height };
  const label = (t) => [...t.querySelectorAll('tspan')].map((s) => s.textContent).join(' ').slice(0, 40);

  const texts = all.filter((e) => e.localName === 'text').map((el) => ({ el, i: order.get(el), b: a_bboxOf(el), name: label(el) }));
  // fills: shapes that hide what lies under them
  const fills = all.filter((e) => ['rect', 'polygon', 'ellipse', 'path'].includes(e.localName) && e.getAttribute('fill') && e.getAttribute('fill') !== 'none')
    .map((el) => ({ el, i: order.get(el), b: a_bboxOf(el) }));
  // strokes: lines, lifelines, outlines (no fill)
  const strokes = all.filter((e) => {
    if (!['polyline', 'path', 'rect', 'ellipse', 'polygon'].includes(e.localName)) return false;
    const fill = e.getAttribute('fill');
    return (fill === 'none' || e.localName === 'polyline') && e.getAttribute('stroke') && e.getAttribute('stroke') !== 'none';
  }).map((el) => ({ el, i: order.get(el), b: a_bboxOf(el), pts: null }));

  for (const t of texts) {
    if (!a_inside(t.b, view, 0.5)) issues.push({ kind: 'text-outside', text: t.name, detail: 'leaves the drawing' });
  }
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i].b, b = texts[j].b;
      const sa = { x: a.x + 1, y: a.y + 2, w: a.w - 2, h: a.h - 4 }, sb = { x: b.x + 1, y: b.y + 2, w: b.w - 2, h: b.h - 4 };
      if (sa.w > 0 && sb.w > 0 && a_inter(sa, sb) > 2) issues.push({ kind: 'text-overlap', text: texts[i].name, detail: `covers "${texts[j].name}"` });
    }
  }
  for (const t of texts) {
    const centre = [t.b.x + t.b.w / 2, t.b.y + t.b.h / 2];
    // the text lies in some filled shape but is wider or taller than it
    const holders = fills.filter((f) => f.i < t.i && a_hit(centre, f.b) && f.b.w * f.b.h < view.w * view.h * 0.6);
    if (holders.length && !holders.some((f) => a_inside(t.b, f.b, 1.2))) issues.push({ kind: 'text-outside', text: t.name, detail: 'wider or taller than its shape' });
    // a line crosses the text
    const box = { x: t.b.x + 1, y: t.b.y + 3, w: t.b.w - 2, h: t.b.h - 6 };
    if (box.w <= 0 || box.h <= 0) continue;
    for (const s of strokes) {
      // a straight line has a bbox of zero width or height, so test the boxes for contact, not for area
      if (s.b.x > box.x + box.w || s.b.x + s.b.w < box.x || s.b.y > box.y + box.h || s.b.y + s.b.h < box.y) continue;
      if (!s.pts) s.pts = a_samples(s.el);
      if (!s.pts.some((p) => a_hit(p, box))) continue;
      const covered = s.i < t.i && fills.some((f) => f.i > s.i && f.i < t.i && a_inside(t.b, f.b, 0.5));
      if (!covered) issues.push({ kind: 'line-over-text', text: t.name, detail: s.i > t.i ? 'a line is drawn on top of it' : 'a line runs under it with no pill' });
    }
  }
  return issues;
}


