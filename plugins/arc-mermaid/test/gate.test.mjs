import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { de2000, lab, lin, parseHex, minDE, contrast, seen, isChromatic } from '../src/colour.mjs';
import { largestEmptyRect, arrayMetrics, rasterise, gate, TEXT_INK_PERCENT } from '../src/gate.mjs';
import { renderDiagram } from '../src/engine.mjs';
import { PRINT_THEME } from '../src/scene.mjs';

const here = dirname(fileURLToPath(import.meta.url));

test('CIEDE2000 reproduces the Sharma, Wu and Dalal test pairs', () => {
  const cases = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, -1, 2], [50, 0, 0], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  ];
  for (const [a, b, want] of cases) assert.ok(Math.abs(de2000(a, b) - want) < 1e-3, `${a} vs ${b}: ${de2000(a, b)} not ${want}`);
});

test('colour vision: the core six palette colours stay at the documented distance (tokens.base.json: 11.5)', () => {
  const core = ['#91D7AB', '#E16F6B', '#9B51E1', '#FBB153', '#1D397B', '#F1C3DD'];
  const d = minDE(core);
  assert.ok(Math.abs(d.value - 11.5) < 0.15, `${d.value} ${d.kind} ${d.pair}`);
  assert.equal(d.kind, 'tritan');
  assert.deepEqual([...d.pair].sort(), ['#F1C3DD', '#FBB153']);
});

test('the four colours the renderer uses are far enough apart for every vision type', () => {
  const d = minDE(['#91D7AB', '#E16F6B', '#FBB153', '#F1C3DD']);
  assert.ok(d.value >= 11.5 - 0.15, `${d.value}`);
});

test('WCAG contrast and chroma helpers', () => {
  assert.ok(Math.abs(contrast('#000000', '#FFFFFF') - 21) < 1e-9);
  assert.ok(contrast('#0A0A0A', '#FFEDD1') > 15);
  assert.equal(isChromatic('#FFEDD1'), true);
  assert.equal(isChromatic('#777777'), false);
  assert.deepEqual(seen('#808080', 'normal').map((x) => Math.abs(Math.round(x))), [54, 0, 0]);
  assert.ok(lab(lin(parseHex('#FFFFFF')))[0] > 99.9);
});

test('largest empty rectangle (histogram method)', () => {
  const g = (rows) => { const h = rows.length, w = rows[0].length; return [Uint8Array.from(rows.flatMap((r) => [...r].map((c) => (c === '.' ? 1 : 0)))), h, w]; };
  assert.equal(largestEmptyRect(...g(['....', '....'])), 8);
  assert.equal(largestEmptyRect(...g(['.#..', '.#..', '....'])), 6);
  assert.equal(largestEmptyRect(...g(['####', '####'])), 0);
  assert.equal(largestEmptyRect(...g(['#.#', '...', '#.#'])), 3);
});

test('array metrics on synthetic pictures follow qa_fig.array_metrics', () => {
  const W = 600, H = 480;
  const white = arrayMetrics({ buf: new Uint8Array(W * H).fill(255), W, H });
  assert.deepEqual([white.ink, white.cells, white.band, white.blank], [0, 100, 100, 100]);
  const black = arrayMetrics({ buf: new Uint8Array(W * H).fill(0), W, H });
  assert.deepEqual([black.ink, black.cells, black.band, black.blank], [100, 0, 0, 0]);
  const half = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W; x++) half[y * W + x] = 0;
  const m = arrayMetrics({ buf: half, W, H });
  assert.ok(Math.abs(m.ink - 50) < 1e-9 && Math.abs(m.cells - 50) < 1e-9 && Math.abs(m.band - 50) < 1e-9 && Math.abs(m.blank - 50) < 1e-9, JSON.stringify(m));
});

test('the gate fails a drawing that is too wide for the type floor, and passes the same drawing narrower', () => {
  const r = renderDiagram('flowchart TD\n A[One] --> B[Two]');
  const wideScene = { ...r.scene, width: r.scene.width * 40 };
  const wide = gate(r.model, r.layout, wideScene, { raster: false });
  assert.equal(wide.marks.type.status, 'FAIL');
  assert.ok(wide.hard.includes('type'));
  assert.equal(gate(r.model, r.layout, r.scene, { raster: false }).marks.type.status, 'ok');
});

test('the gate fails overlapping nodes', () => {
  const r = renderDiagram('flowchart TD\n A[One] --> B[Two]');
  const nodes = r.layout.nodes.map((n, i) => ({ ...n, y: r.layout.nodes[0].y, x: r.layout.nodes[0].x + i }));
  const layout = { ...r.layout, nodes };
  const scene = { ...r.scene, prims: r.scene.prims.map((p) => (p.role === 'node' && p.id === 'B' ? { ...p, x: nodes[0].x, y: nodes[0].y } : p)) };
  const g = gate(r.model, layout, scene, { raster: false });
  assert.ok(g.hard.includes('overlap'), JSON.stringify(g.marks.overlap));
});

test('the gate fails weak text contrast on the live theme', () => {
  const r = renderDiagram('flowchart TD\n A[One] --> B[Two]');
  const g = gate(r.model, r.layout, r.scene, { raster: false, live: { ...PRINT_THEME, edgeText: '#EEEEEE', labelBg: '#FFFFFF', bg: '#FFFFFF', clusterText: '#EEEEEE' } });
  const hasLabelText = r.scene.prims.some((p) => p.role === 'edge-label');
  assert.equal(g.marks.contrast.status === 'FAIL', hasLabelText);
  const r2 = renderDiagram('flowchart TD\n A[One] -->|go| B[Two]');
  const g2 = gate(r2.model, r2.layout, r2.scene, { raster: false, live: { ...PRINT_THEME, edgeText: '#EEEEEE' } });
  assert.equal(g2.marks.contrast.status, 'FAIL');
});

test('the raster is deterministic', () => {
  const r = renderDiagram(readFileSync(join(here, 'fixtures', 'prompt-flow.mmd'), 'utf8'));
  const a = rasterise(r.scene, PRINT_THEME, 900), b = rasterise(r.scene, PRINT_THEME, 900);
  assert.deepEqual(Buffer.from(a.buf), Buffer.from(b.buf));
  assert.equal(TEXT_INK_PERCENT, 15);
});



