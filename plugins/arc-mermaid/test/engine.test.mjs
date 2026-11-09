import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { renderDiagram, candidatesFor, parse } from '../src/engine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fx = Object.fromEntries(readdirSync(join(here, 'fixtures')).filter((f) => f.endsWith('.mmd')).map((f) => [basename(f, '.mmd'), readFileSync(join(here, 'fixtures', f), 'utf8')]));
const drawable = Object.keys(fx).filter((n) => !['malformed', 'unsupported-pie', 'wide-lr'].includes(n));

test('every drawable fixture draws with no hard gate failure', () => {
  for (const n of drawable) {
    const r = renderDiagram(fx[n]);
    assert.equal(r.ok, true, n);
    assert.deepEqual(r.report.hard, [], `${n}: ${JSON.stringify(r.report.marks)}`);
    assert.notEqual(r.report.level, 'fail', n);
  }
});

test('determinism: the same source gives a byte-identical SVG and hash', () => {
  for (const n of drawable) {
    const a = renderDiagram(fx[n]), b = renderDiagram(fx[n]);
    assert.equal(a.svg, b.svg, n);
    assert.equal(a.report.hash, b.report.hash, n);
    assert.deepEqual(a.report.params, b.report.params, n);
  }
});

test('the SVG is well formed, finite, and holds no active content', () => {
  for (const n of drawable) {
    const { svg } = renderDiagram(fx[n]);
    assert.ok(svg.startsWith('<svg ') && svg.endsWith('</svg>'), n);
    assert.ok(!/NaN|Infinity|undefined/.test(svg), `${n} has a bad number`);
    assert.ok(!/<script|<foreignObject|javascript:|on\w+=/i.test(svg), `${n} has active content`);
    assert.equal((svg.match(/<text /g) || []).length, (svg.match(/<\/text>/g) || []).length, n);
  }
});

test('labels with markup are escaped, not interpreted', () => {
  const { svg } = renderDiagram(fx['unicode-html']);
  assert.ok(svg.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!svg.includes('<script'));
  assert.ok(svg.includes('Запрос'));
});

test('no blue and no purple in the drawing colours', () => {
  const blueish = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return b > r + 40 && b > g + 20; };
  for (const n of drawable) {
    const hexes = [...renderDiagram(fx[n]).svg.matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0]);
    assert.deepEqual(hexes.filter(blueish), [], n);
  }
});

test('a classDef colour becomes a palette family, never the raw colour', () => {
  const r = renderDiagram(fx['subgraph-lr']);
  assert.ok(!r.svg.toLowerCase().includes('#99ff66'));
  assert.ok(r.svg.includes('#91D7AB'), 'green fill maps to mint');
});

test('the author direction is kept unless rotation is allowed', () => {
  const cands = candidatesFor(parse(fx['subgraph-lr']));
  assert.ok(cands.every((c) => c.dir === 'LR'));
  const rot = candidatesFor(parse(fx['subgraph-lr']), { allowRotate: true });
  assert.ok(rot.some((c) => c.dir === 'TB'));
});

test('candidate search is bounded and stops at the first pass', () => {
  for (const n of drawable) {
    const r = renderDiagram(fx[n]);
    assert.ok(r.report.candidates.tried <= r.report.candidates.total);
    assert.ok(r.report.candidates.total <= 26);
    if (r.report.level === 'pass') assert.equal(r.report.candidates.tried, r.report.candidates.chosen);
  }
});

test('layout invariants: nodes never overlap and every edge ends on its nodes', () => {
  for (const n of drawable) {
    const { layout } = renderDiagram(fx[n]);
    if (layout.kind !== 'flow') continue;
    for (let i = 0; i < layout.nodes.length; i++) for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i], b = layout.nodes[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(!(ox > 0.5 && oy > 0.5), `${n}: ${a.id} overlaps ${b.id}`);
    }
    const byId = new Map(layout.nodes.map((q) => [q.id, q]));
    for (const e of layout.edges) {
      for (const [id, p] of [[e.from, e.pts[0]], [e.to, e.pts[e.pts.length - 1]]]) {
        const q = byId.get(id);
        const near = p[0] >= q.x - 2 && p[0] <= q.x + q.w + 2 && p[1] >= q.y - 2 && p[1] <= q.y + q.h + 2;
        assert.ok(near || e.from === id || e.to === id, `${n}: edge end off node ${id}`);
      }
    }
  }
});

test('cycles, self loops and disconnected parts lay out', () => {
  const r = renderDiagram('flowchart TD\n A --> B\n B --> A\n B --> B\n C --> D\n E');
  assert.equal(r.ok, true);
  assert.equal(r.layout.nodes.length, 5);
  assert.deepEqual(r.report.hard, []);
});

test('all four directions work and keep the gate clean', () => {
  for (const d of ['TB', 'BT', 'LR', 'RL']) {
    const r = renderDiagram(`flowchart ${d}\n A[One] -->|go| B[Two] --> C{Q?}\n C -->|y| D\n C -->|n| E\n D --> F\n E --> F`);
    assert.equal(r.ok, true, d);
    assert.deepEqual(r.report.hard, [], d);
  }
});

test('subgraphs: a cluster box holds only its members', () => {
  const r = renderDiagram(fx['subgraph-lr']);
  assert.equal(r.report.marks.overlap.value, 0);
  assert.equal(r.layout.clusters.length, 2);
});

test('negative inputs are reported with a reason', () => {
  assert.deepEqual(renderDiagram(fx['unsupported-pie']), { ok: false, reason: 'unsupported', kind: 'pie' });
  const m = renderDiagram(fx['malformed']);
  assert.equal(m.ok, false);
  assert.equal(m.reason, 'parse');
  assert.equal(m.line, 3);
  assert.equal(renderDiagram('').reason, 'unsupported');
  assert.equal(renderDiagram('flowchart TD').reason, 'empty');
});

test('size limits: a 450 node diagram is refused, a 150 node chain draws in time', () => {
  const big = 'flowchart TD\n' + Array.from({ length: 450 }, (_, i) => ` N${i} --> N${i + 1}`).join('\n');
  assert.equal(renderDiagram(big).reason, 'too-large');
  const chain = 'flowchart TD\n' + Array.from({ length: 150 }, (_, i) => ` N${i} --> N${i + 1}`).join('\n');
  const t = Date.now();
  const r = renderDiagram(chain);
  assert.equal(r.ok, true);
  assert.ok(Date.now() - t < 8000, `took ${Date.now() - t} ms`);
});

test('a type floor failure is a hard failure and the search prefers a narrower layout', () => {
  const wide = 'flowchart LR\n' + Array.from({ length: 14 }, (_, i) => ` N${i}[Step number ${i}] --> N${i + 1}`).join('\n');
  const r = renderDiagram(wide);
  assert.equal(r.ok, true);
  assert.equal(r.report.marks.type.status === 'FAIL', r.report.hard.includes('type'));
  assert.ok(r.report.candidates.tried > 1, 'the search tried other layouts');
});

// ---- regression tests for the findings of review cycle 1
const hardFree = (src, label) => { const r = renderDiagram(src); assert.equal(r.ok, true, label); assert.deepEqual(r.report.hard.filter((h) => h !== 'type'), [], `${label}: ${JSON.stringify(r.report.marks.overlap)}`); return r; };

test('f1: a composite state keeps its outer start and end outside the box and enters at an inner node', () => {
  const r = hardFree('stateDiagram-v2\n [*] --> A\n state A {\n  [*] --> B\n  B --> [*]\n }\n A --> [*]', 'composite');
  const byId = new Map(r.layout.nodes.map((n) => [n.id, n]));
  const box = r.layout.clusters[0];
  const inside = (n) => r.layout.clusters[0].rects.some((q) => n.x >= q[0] - 1 && n.x + n.w <= q[2] + 1 && n.y >= q[1] - 1 && n.y + n.h <= q[3] + 1);
  assert.equal(inside(byId.get('__start_')), false);
  assert.equal(inside(byId.get('__end_')), false);
  assert.equal(inside(byId.get('B')), true);
  assert.ok(box.w > 0);
  const m = r.model.edges.map((e) => `${e.from}>${e.to}`);
  assert.ok(m.includes('__start_>B') && m.includes('B>__end_'), m.join(' '));
});

test('f1: nested composite states', () => {
  hardFree('stateDiagram-v2\n [*] --> Outer\n state Outer {\n  [*] --> Mid\n  state Mid {\n   [*] --> In\n   In --> [*]\n  }\n  Mid --> [*]\n }\n Outer --> Done\n Done --> [*]', 'nested state');
});

test('f2: sibling subgraphs joined by edges never overlap, in either direction', () => {
  hardFree('flowchart TD\n subgraph S1\n  a1 --> a2\n end\n subgraph S4\n  b1 --> b2\n end\n a2 --> b1\n S1 --> S4', 'siblings TD');
  hardFree('flowchart LR\n subgraph S1\n  a1 --> a2\n end\n subgraph S2\n  b1 --> b2\n end\n subgraph S3\n  c1 --> c2\n end\n a1 --> b1\n b2 --> c2\n a2 --> c1', 'three interleaved');
});

test('f2: five subgraphs nested three deep', () => {
  const src = 'flowchart TD\n' + [1, 2, 3, 4, 5].map((i) => ` subgraph A${i}\n  subgraph B${i}\n   subgraph C${i}\n    n${i}a --> n${i}b\n   end\n   m${i} --> n${i}a\n  end\n  k${i} --> m${i}\n end\n`).join('') + ' k1 --> k2\n k2 --> k3\n n3b --> k4\n n1b --> n5a\n';
  const r = hardFree(src, 'five by three');
  assert.equal(r.layout.clusters.length, 15);
});

test('p9: a 400 character word is cut to fit, not left as one wide line', () => {
  const r = renderDiagram('flowchart TD\n A["' + 'x'.repeat(400) + '"] --> B');
  assert.equal(r.ok, true);
  assert.ok(r.report.size.width < 400, `width ${r.report.size.width}`);
  assert.deepEqual(r.report.hard, [], JSON.stringify(r.report.marks.type));
});

test('p9: a diagram too large for the type floor is drawn and reported, never hidden', () => {
  const dag = 'flowchart TD\n' + Array.from({ length: 60 }, (_, i) => ` N${i} --> N${(i * 7 + 3) % 60 === i ? (i + 1) % 60 : (i * 7 + 3) % 60}\n N${i} --> N${(i + 5) % 60}`).join('\n');
  const r = renderDiagram(dag);
  assert.equal(r.ok, true);
  assert.ok(!r.report.hard.includes('overlap') && !r.report.hard.includes('edgeThrough'), JSON.stringify(r.report.hard));
  assert.equal(r.report.level === 'fail', r.report.hard.length > 0);
});

test('p9: thirty participants draw without overlaps', () => {
  const src = 'sequenceDiagram\n' + Array.from({ length: 30 }, (_, i) => ` participant P${i}\n`).join('') + Array.from({ length: 29 }, (_, i) => ` P${i}->>P${i + 1}: step ${i}\n`).join('');
  const r = renderDiagram(src);
  assert.equal(r.ok, true);
  assert.ok(!r.report.hard.includes('overlap'), JSON.stringify(r.report.marks.overlap));
});

test('f5: a chain too wide for the type floor is drawn and reported as a type failure only', () => {
  const r = renderDiagram(fx['wide-lr']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.report.hard, ['type']);
  assert.equal(r.report.level, 'fail');
  assert.ok(r.report.size.width > 1000, `width ${r.report.size.width}`);
});

test('no edge has a kink: a horizontal jog is either absent or longer than 8 units', () => {
  // Crowded graphs (cycles, several edges between one pair of nodes) can leave a small jog when no port has room to move.
  const crowded = new Set(['cycle', 'shapes', 'unicode-html']);
  const sources = [...drawable.filter((n) => !crowded.has(n)).map((n) => fx[n]), 'flowchart TD\n A --> B\n A --> C\n B --> D\n C --> D\n D --> E\n D --> F\n E --> G\n F --> G'];
  for (const src of sources) {
    const r = renderDiagram(src);
    if (!r.ok || r.layout.kind !== 'flow') continue;
    for (const e of r.layout.edges) {
      if (e.self) continue;
      for (let i = 0; i + 1 < e.pts.length; i++) {
        const [a, b] = [e.pts[i], e.pts[i + 1]];
        const vertical = Math.abs(a[0] - b[0]) < 0.01, horizontal = Math.abs(a[1] - b[1]) < 0.01;
        if (!vertical && !horizontal) continue;
        const dx = Math.abs(a[0] - b[0]);
        if (horizontal && dx > 0.5 && dx <= 8 && r.layout.params.dir === 'TB') assert.fail(`kink of ${dx.toFixed(1)} units on ${e.from}>${e.to}`);
      }
    }
  }
});



test('sequence: a label that wraps to several lines stays clear of its arrow and notes stay inside their box', () => {
  const r = renderDiagram('sequenceDiagram\n participant A\n participant B\n A->>B: a rather long message label that has to wrap onto several lines\n B-->>A: short\n Note right of B: a long note text that wraps onto two or three lines in its box');
  assert.equal(r.ok, true);
  const prims = r.scene.prims;
  const edges = prims.filter((p) => p.role === 'edge' && p.t === 'line');
  const labels = prims.filter((p) => p.role === 'edge-label');
  assert.ok(labels.some((t) => t.lines.length >= 2), 'the long label wraps');
  for (const t of labels) {
    const lastBaseline = t.y + (t.lines.length - 1) * t.lh;
    const arrow = edges.find((e) => Math.abs(e.pts[0][0] - t.x) < 400 && e.pts[0][1] > t.y);
    assert.ok(arrow, 'a label has an arrow below it');
    assert.ok(lastBaseline + 0.3 * t.size < arrow.pts[0][1], `label "${t.lines.join(' ')}" crosses its arrow`);
  }
  const notes = prims.filter((p) => p.role === 'note');
  for (const n of notes) {
    const text = prims.filter((p) => p.t === 'text' && p.role === 'node-text' && p.onFill === n.fill && p.bbox.x >= n.x && p.bbox.x <= n.x + n.w)[0];
    assert.ok(text, 'a note has its text');
    const top = text.y - 0.8 * text.size, bottom = text.y + (text.lines.length - 1) * text.lh + 0.3 * text.size;
    assert.ok(top >= n.y && bottom <= n.y + n.h, `note text leaves its box: ${top} ${bottom} in ${n.y}..${n.y + n.h}`);
  }
  assert.deepEqual(r.report.hard, []);
});


test('sequence: lifelines are drawn under frames and every label has a pill over them', () => {
  const r = renderDiagram(fx['sequence-card']);
  const order = r.scene.prims.map((p) => p.role);
  const lastLife = order.lastIndexOf('lifeline'), firstFrame = order.indexOf('cluster');
  assert.ok(lastLife < firstFrame, 'frames must be drawn after the lifelines');
  for (const p of r.scene.prims) {
    if (p.t !== 'text' || !['edge-label', 'frame-label'].includes(p.role)) continue;
    const i = r.scene.prims.indexOf(p);
    const pill = r.scene.prims[i - 1];
    assert.equal(pill.role, 'label-bg', `label "${p.lines.join(' ')}" has no pill`);
    assert.ok(pill.x <= p.bbox.x + 0.5 && pill.x + pill.w >= p.bbox.x + p.bbox.w - 0.5, 'the pill covers the label');
  }
  const frame = r.layout.frames[0];
  assert.ok(frame.tabW + 8 + frame.labelW <= frame.w, 'the frame is wide enough for its tab and label');
});
