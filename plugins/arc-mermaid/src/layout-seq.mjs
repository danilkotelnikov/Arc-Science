/**
 * Sequence diagram layout: participant columns sized by the labels that cross them, one row per item,
 * frames (loop, alt, opt, par ...) from the extent of what they hold, activation bars. Deterministic, no DOM.
 */
import { wrapLines } from './layout.mjs';

export function layoutSequence(model, o, measure) {
  const fontPx = o.fontPx || 13;
  const labelPx = fontPx - 1.5;
  const sp = o.spacing || 1;
  const lineH = Math.round(fontPx * 1.35);
  const labelLineH = Math.round(labelPx * 1.3);
  const wrap = o.wrap || 200;
  const idx = new Map(model.participants.map((p, i) => [p.id, i]));
  const n = model.participants.length;

  // ---- headers
  const heads = model.participants.map((p) => {
    const lines = wrapLines(p.label, 150, fontPx, measure, true);
    const tw = lines.reduce((m, l) => Math.max(m, measure(l, fontPx, true)), 0);
    return { id: p.id, kind: p.kind, lines, tw, w: Math.max(72, tw + 28), h: lines.length * lineH + 16 };
  });
  const headH = Math.max(...heads.map((h) => h.h));

  // ---- column gaps from the widest label that spans them
  const gap = [];
  for (let i = 0; i < n - 1; i++) gap[i] = (heads[i].w + heads[i + 1].w) / 2 + 22 * sp;
  const spans = [];
  const labelW = (text, px, max) => { const lines = wrapLines(text, max, px, measure); return lines.reduce((m, l) => Math.max(m, measure(l, px, false)), 0); };
  for (const it of model.items) {
    if (it.t === 'msg') {
      const a = idx.get(it.from), b = idx.get(it.to);
      const w = labelW((model.autonumber ? '00. ' : '') + it.label, labelPx, wrap) + 36;
      if (a === b) spans.push({ i: a, j: Math.min(a + 1, n - 1), need: Math.min(a + 1, n - 1) === a ? 0 : w + 30, self: true });
      else spans.push({ i: Math.min(a, b), j: Math.max(a, b), need: w });
    } else if (it.t === 'note') {
      const a = idx.get(it.a), b = it.b ? idx.get(it.b) : null;
      const w = labelW(it.label, labelPx, 170) + 20;
      if (it.where === 'over' && b !== null) spans.push({ i: Math.min(a, b), j: Math.max(a, b), need: w - 40 });
      else if (it.where === 'left of' && a > 0) spans.push({ i: a - 1, j: a, need: w + 30 + heads[a].w / 2 - heads[a - 1].w / 2 });
      else if (it.where === 'right of' && a < n - 1) spans.push({ i: a, j: a + 1, need: w + 30 + heads[a].w / 2 - heads[a + 1].w / 2 });
    }
  }
  spans.sort((p, q) => p.j - p.i - (q.j - q.i));
  for (const s of spans) {
    if (s.j <= s.i) continue;
    let cur = 0;
    for (let k = s.i; k < s.j; k++) cur += gap[k];
    if (cur < s.need) for (let k = s.i; k < s.j; k++) gap[k] += (s.need - cur) / (s.j - s.i);
  }
  const cx = [heads[0].w / 2];
  for (let i = 1; i < n; i++) cx[i] = cx[i - 1] + gap[i - 1];

  // ---- rows
  let y = headH + 26;
  const messages = [], notes = [], frames = [], activations = [];
  const openFrames = [];
  const active = new Map();
  const ext = (x0, x1) => { for (const f of openFrames) { f.x0 = Math.min(f.x0, x0); f.x1 = Math.max(f.x1, x1); } };
  let num = 0;
  for (const it of model.items) {
    if (it.t === 'msg') {
      const a = idx.get(it.from), b = idx.get(it.to);
      const prefix = model.autonumber ? `${++num}. ` : '';
      if (a === b) {
        const lines = wrapLines(prefix + it.label, wrap, labelPx, measure);
        const lw = lines.reduce((m, l) => Math.max(m, measure(l, labelPx, false)), 0) + 8;
        const lh = Math.max(lines.length * labelLineH + 4, 24);
        const x = cx[a] + (active.has(it.from) ? 4 : 0);
        const pts = [[x, y + 6], [x + 28, y + 6], [x + 28, y + 6 + lh], [x, y + 6 + lh]];
        messages.push({ pts, dash: it.dash, head: it.head, self: true, label: { lines, x: x + 34, y: y + 6 + lh / 2 - (lines.length * labelLineH) / 2, w: lw, h: lines.length * labelLineH, anchor: 'start' } });
        ext(x - 4, x + 34 + lw);
        y += lh + 18;
      } else {
        const dist = Math.abs(cx[b] - cx[a]);
        const lines = wrapLines(prefix + it.label, Math.max(dist - 24, 90), labelPx, measure);
        const lw = lines.reduce((m, l) => Math.max(m, measure(l, labelPx, false)), 0);
        const lh = lines.length * labelLineH;
        const dirn = b > a ? 1 : -1;
        const x0 = cx[a] + (active.has(it.from) ? 4 * dirn : 0), x1 = cx[b] - (active.has(it.to) ? 4 * dirn : 0);
        const ly = y + lh + 8;
        messages.push({ pts: [[x0, ly], [x1, ly]], dash: it.dash, head: it.head, label: { lines, x: (x0 + x1) / 2 - lw / 2, y: y + 2, w: lw, h: lh, anchor: 'middle' } });
        ext(Math.min(cx[a], cx[b]) - 4, Math.max(cx[a], cx[b]) + 4);
        y = ly + 16;
      }
    } else if (it.t === 'note') {
      const lines = wrapLines(it.label, 170, labelPx, measure);
      const tw = lines.reduce((m, l) => Math.max(m, measure(l, labelPx, false)), 0);
      const w = tw + 30, h = lines.length * labelLineH + 14;
      const a = idx.get(it.a), b = it.b ? idx.get(it.b) : null;
      let x;
      if (it.where === 'over') { const c = b !== null ? (cx[a] + cx[b]) / 2 : cx[a]; const span = b !== null ? Math.abs(cx[a] - cx[b]) + 40 : 0; const ww = Math.max(w, span); x = c - ww / 2; notes.push({ x, y, w: ww, h, lines }); ext(x, x + ww); }
      else if (it.where === 'left of') { x = cx[a] - 14 - w; notes.push({ x, y, w, h, lines }); ext(x, x + w); }
      else { x = cx[a] + 14; notes.push({ x, y, w, h, lines }); ext(x, x + w); }
      y += h + 14;
    } else if (it.t === 'open') {
      openFrames.push({ kind: it.kind, label: it.label, y0: y, x0: Infinity, x1: -Infinity, dividers: [], depth: openFrames.length });
      y += 26;
    } else if (it.t === 'divider') {
      const f = openFrames[openFrames.length - 1];
      f.dividers.push({ y: y + 2, label: it.label });
      y += 24;
    } else if (it.t === 'close') {
      const f = openFrames.pop();
      const lab = measure(`${f.kind} ${f.label ? '[' + f.label + ']' : ''}`, labelPx, true) + 56;
      if (f.x0 === Infinity) { f.x0 = cx[0] - 30; f.x1 = f.x0 + lab; }
      const x0 = f.x0 - 12, x1 = Math.max(f.x1 + 12, f.x0 - 12 + lab);
      const labW = (t) => (t ? measure(`[${t}]`, labelPx, false) + 8 : 0);
      frames.push({ kind: f.kind, label: f.label, x: x0, y: f.y0, w: x1 - x0, h: y + 2 - f.y0, depth: f.depth, tabW: measure(f.kind, labelPx, true) + 18, labelW: labW(f.label), dividers: f.dividers.map((d) => ({ ...d, labelW: labW(d.label) })) });
      ext(x0, x1);
      y += 14;
    } else if (it.t === 'activate') {
      active.set(it.who, [...(active.get(it.who) || []), y - 8]);
    } else if (it.t === 'deactivate') {
      const st = active.get(it.who);
      if (st && st.length) {
        const y0 = st.pop();
        activations.push({ cx: cx[idx.get(it.who)], y0, y1: y - 6, level: st.length });
        if (!st.length) active.delete(it.who);
      }
    }
  }
  for (const [who, st] of active) for (const y0 of st) activations.push({ cx: cx[idx.get(who)], y0, y1: y - 6, level: 0 });
  const bottom = y + 6;

  // ---- geometry
  const margin = o.margin ?? 16;
  let minX = Infinity, maxX = -Infinity;
  const take = (a, b) => { minX = Math.min(minX, a); maxX = Math.max(maxX, b); };
  heads.forEach((h, i) => take(cx[i] - h.w / 2, cx[i] + h.w / 2));
  for (const m of messages) { for (const [px] of m.pts) take(px, px); take(m.label.x, m.label.x + m.label.w); }
  for (const nn of notes) take(nn.x, nn.x + nn.w);
  for (const f of frames) take(f.x, f.x + f.w);
  const dx = margin - minX;
  const titleH = model.title ? lineH + 10 : 0;
  const dy = margin + titleH;
  const sh = (p) => [p[0] + dx, p[1] + dy];
  const out = {
    kind: 'sequence',
    width: maxX - minX + 2 * margin,
    height: bottom + 2 * margin + titleH,
    title: model.title ? { text: model.title, x: margin, y: margin + lineH * 0.8 } : null,
    participants: heads.map((h, i) => ({ id: h.id, kind: h.kind, lines: h.lines, x: cx[i] - h.w / 2 + dx, y: dy, w: h.w, h: headH, tw: h.tw, cx: cx[i] + dx })),
    lifelines: heads.map((h, i) => ({ x: cx[i] + dx, y0: dy + headH, y1: dy + bottom })),
    messages: messages.map((m) => ({ ...m, pts: m.pts.map(sh), label: { ...m.label, x: m.label.x + dx, y: m.label.y + dy } })),
    notes: notes.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })),
    frames: frames.map((f) => ({ ...f, x: f.x + dx, y: f.y + dy, dividers: f.dividers.map((d) => ({ ...d, y: d.y + dy })) })),
    activations: activations.map((a) => ({ ...a, cx: a.cx + dx, y0: a.y0 + dy, y1: a.y1 + dy })),
    params: { dir: 'TB', wrap, spacing: sp, seed: 0, fontPx, labelPx },
    stats: { nodes: n, edges: messages.length, layers: 0, crossings: 0 },
  };
  return out;
}
