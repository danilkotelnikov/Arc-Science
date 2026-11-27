// Regression tests for single-dollar currency vs KaTeX inlineMath parsing in vendor-DcuzkuQH.js.
// Run: node --test test/katex-dollar.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { openAsar } from '../lib/asar.mjs';
import { patchKatexDollar } from '../lib/katex-dollar-patch.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builtPath = path.join(root, 'build', 'app.asar');
const pristinePath = path.join(root, 'pristine', 'app.asar');

const VENDOR_PRISTINE = 'dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/vendor-DcuzkuQH.js';
const VENDOR_BUILT = 'arc/node_modules/@arc-harness/arc-web-frontend/dist/assets/vendor-DcuzkuQH.js';

function collectMathNodes(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'inlineMath' || node.type === 'math') {
    out.push({ type: node.type, value: node.value });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectMathNodes(child, out);
  }
  return out;
}

function collectText(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.value === 'string' && node.type !== 'inlineMath' && node.type !== 'math') {
    out.push(node.value);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectText(child, out);
  }
  return out;
}

async function loadBundledVendor(asarPath, entryPath) {
  const a = openAsar(asarPath);
  const f = a.byPath.get(entryPath);
  assert.ok(f, `missing ${entryPath} in ${asarPath}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-katex-test-'));
  const file = path.join(tmp, 'vendor.mjs');
  fs.writeFileSync(file, a.read(f));
  const hadDoc = 'document' in globalThis;
  const prevDoc = globalThis.document;
  if (!hadDoc) {
    globalThis.document = {
      compatMode: 'CSS1Compat',
      createElement: () => ({ innerHTML: '', textContent: '' }),
    };
  }
  try {
    const mod = await import(pathToFileURL(file).href);
    return {
      mod,
      cleanup: () => {
        if (!hadDoc) delete globalThis.document;
        else globalThis.document = prevDoc;
        fs.rmSync(tmp, { recursive: true, force: true });
      },
      parse(md) {
        return mod.f(md, {
          extensions: [mod.g(), mod.m()],
          mdastExtensions: [mod.r(), mod.v()],
        });
      },
    };
  } catch (err) {
    if (!hadDoc) delete globalThis.document;
    else globalThis.document = prevDoc;
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

test('patchKatexDollar patches pristine vendor-DcuzkuQH.js cleanly once', () => {
  const a = openAsar(pristinePath);
  const code = a.read(a.byPath.get(VENDOR_PRISTINE)).toString('utf8');
  const patched = patchKatexDollar(code);
  assert.notEqual(patched, code);
  assert.throws(() => patchKatexDollar(patched), /expected 1 match, found 0/);
});

test('built app.asar vendor bundle renders real math while keeping currency plain', async () => {
  assert.ok(fs.existsSync(builtPath), 'build/app.asar must exist before running this test');
  const ctx = await loadBundledVendor(builtPath, VENDOR_BUILT);
  try {
    const currencyCases = [
      '|**$1,000** (up to $5k select), 1–2 yrs|Not strictly enforced at Founders|',
      '|$200 starter (90 days)|**No** for $200; **Yes** for $4,800+|',
      'Range: $100-$200 or $100–$200 or $100/$200.',
      '($50) and ($100) per month.',
      'US$50 and CA$100 are both accepted.',
      'Total: $100 + $200 = $300.',
      'I paid $ 100 and got $ 200 back.',
      'Line one $100\nand line two $200.',
      'The fee is $100, and $200 later.',
      'From $0.50 to $1.25 per 1k tokens.',
      'Price: $10k–$20k or **$200**; **$4,800+**.',
    ];
    for (const md of currencyCases) {
      const tree = ctx.parse(md);
      const math = collectMathNodes(tree);
      assert.deepEqual(math, [], `unexpected math parsed for currency case: ${md}`);
    }

    // Verify table cells in the screenshot keep strong nodes and literal "$"
    const row1 = ctx.parse('| Tier | Notes |\n|---|---|\n| **$1,000** (up to $5k select), 1–2 yrs | Not strictly enforced at Founders |\n| $200 starter (90 days) | **No** for $200; **Yes** for $4,800+ |');
    assert.deepEqual(collectMathNodes(row1), []);
    const row1Text = collectText(row1).join(' ');
    assert.ok(row1Text.includes('$1,000'), 'keeps $1,000');
    assert.ok(row1Text.includes('$5k'), 'keeps $5k');
    assert.ok(row1Text.includes('$200'), 'keeps $200');
    assert.ok(row1Text.includes('$4,800+'), 'keeps $4,800+');

    // Mixed currency + genuine inline math in the same paragraph
    const mixed = ctx.parse('The grant is $1,000 ($x$ per unit), or **$1,000** and **$y$** where $z = a + b$.');
    assert.deepEqual(
      collectMathNodes(mixed),
      [
        { type: 'inlineMath', value: 'x' },
        { type: 'inlineMath', value: 'y' },
        { type: 'inlineMath', value: 'z = a + b' },
      ],
    );

    const mixedDouble = ctx.parse('The fee is $100 and $$x^2$$ is the formula, or $100, $$a+b$$, and $y$.');
    assert.deepEqual(
      collectMathNodes(mixedDouble),
      [
        { type: 'inlineMath', value: 'x^2' },
        { type: 'inlineMath', value: 'a+b' },
        { type: 'inlineMath', value: 'y' },
      ],
    );

    // Real single-dollar and double-dollar math still works and compiles in KaTeX
    const mathCases = [
      ['Inline $x^2 + y^2 = z^2$ here.', [{ type: 'inlineMath', value: 'x^2 + y^2 = z^2' }]],
      ['Negative $-5$ and $-10.5$.', [{ type: 'inlineMath', value: '-10.5' }, { type: 'inlineMath', value: '-5' }]],
      ['Bold **$x^2$** and parens ($\\alpha + \\beta$).', [{ type: 'inlineMath', value: '\\alpha + \\beta' }, { type: 'inlineMath', value: 'x^2' }]],
      ['Scientific $10^6$ and $0 < x < 1$ and $a * b * c$.', [{ type: 'inlineMath', value: '10^6' }, { type: 'inlineMath', value: '0 < x < 1' }, { type: 'inlineMath', value: 'a * b * c' }]],
      ['Inline double $$ x + y $$ works.', [{ type: 'inlineMath', value: 'x + y' }]],
      ['Block:\n\n$$\nE = mc^2\n$$\n', [{ type: 'math', value: 'E = mc^2' }]],
    ];
    for (const [md, expected] of mathCases) {
      const actual = collectMathNodes(ctx.parse(md)).sort((a, b) => a.value.localeCompare(b.value));
      const expSorted = [...expected].sort((a, b) => a.value.localeCompare(b.value));
      assert.deepEqual(actual, expSorted, `math mismatch for: ${md}`);
      for (const m of actual) {
        const html = ctx.mod.k.renderToString(m.value, { displayMode: m.type === 'math', throwOnError: true });
        assert.ok(html.includes('katex'), `KaTeX failed to render: ${m.value}`);
      }
    }
  } finally {
    ctx.cleanup();
  }
});
