// Regression tests for single-dollar currency against KaTeX inline math in vendor-DcuzkuQH.js.
// The screenshot that started this: a pricing table rendered as
//   **1,000 * *(upto5k select), 1–2 yrs        and        No for 200; ** Yes ** for4,800+
// because "$1,000** (up to $" and "$200 ... for $" were read as inline math.
//
// Run: node --test test/katex-dollar.test.mjs
// Needs pristine/app.asar. The built archive is checked too when build/app.asar exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { openAsar } from '../lib/asar.mjs';
import { patchKatexDollar } from '../lib/katex-dollar-patch.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pristinePath = path.join(root, 'pristine', 'app.asar');
const builtPath = path.join(root, 'build', 'app.asar');

const VENDOR_PRISTINE = 'dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/vendor-DcuzkuQH.js';
const VENDOR_BUILT = 'arc/node_modules/@arc-harness/arc-web-frontend/dist/assets/vendor-DcuzkuQH.js';

const havePristine = fs.existsSync(pristinePath);

function collectMathNodes(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'inlineMath' || node.type === 'math') out.push({ type: node.type, value: node.value });
  if (Array.isArray(node.children)) for (const child of node.children) collectMathNodes(child, out);
  return out;
}

function collectText(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.value === 'string' && node.type !== 'inlineMath' && node.type !== 'math') out.push(node.value);
  if (Array.isArray(node.children)) for (const child of node.children) collectText(child, out);
  return out;
}

// Load the vendor bundle from source text. The module touches `document` at load time.
async function loadVendor(code) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-katex-test-'));
  const file = path.join(tmp, 'vendor.mjs');
  fs.writeFileSync(file, code);
  const hadDoc = 'document' in globalThis;
  const prevDoc = globalThis.document;
  if (!hadDoc) globalThis.document = { compatMode: 'CSS1Compat', createElement: () => ({ innerHTML: '', textContent: '' }) };
  try {
    const mod = await import(pathToFileURL(file).href);
    return {
      mod,
      parse(md) {
        return mod.f(md, { extensions: [mod.g(), mod.m()], mdastExtensions: [mod.r(), mod.v()] });
      },
      cleanup() {
        if (!hadDoc) delete globalThis.document;
        else globalThis.document = prevDoc;
        fs.rmSync(tmp, { recursive: true, force: true });
      },
    };
  } catch (err) {
    if (!hadDoc) delete globalThis.document;
    else globalThis.document = prevDoc;
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

function vendorText(asarPath, entry) {
  const a = openAsar(asarPath);
  const f = a.byPath.get(entry);
  assert.ok(f, `missing ${entry} in ${asarPath}`);
  return a.read(f).toString('utf8');
}

// The two rows of the pricing table in the screenshot, and the neighbours that must keep working.
const CURRENCY_CASES = [
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

const MATH_CASES = [
  ['Inline $x^2 + y^2 = z^2$ here.', [{ type: 'inlineMath', value: 'x^2 + y^2 = z^2' }]],
  ['Negative $-5$ and $-10.5$.', [{ type: 'inlineMath', value: '-10.5' }, { type: 'inlineMath', value: '-5' }]],
  ['Bold **$x^2$** and parens ($\\alpha + \\beta$).', [{ type: 'inlineMath', value: '\\alpha + \\beta' }, { type: 'inlineMath', value: 'x^2' }]],
  ['Scientific $10^6$ and $0 < x < 1$ and $a * b * c$.', [{ type: 'inlineMath', value: '10^6' }, { type: 'inlineMath', value: '0 < x < 1' }, { type: 'inlineMath', value: 'a * b * c' }]],
  ['Inline double $$ x + y $$ works.', [{ type: 'inlineMath', value: 'x + y' }]],
  ['Block:\n\n$$\nE = mc^2\n$$\n', [{ type: 'math', value: 'E = mc^2' }]],
];

function checkMath(vendor, label) {
  for (const md of CURRENCY_CASES) {
    assert.deepEqual(collectMathNodes(vendor.parse(md)), [], `${label}: unexpected math parsed for currency case: ${md}`);
  }

  const table = [
    '| Tier | Notes |',
    '|---|---|',
    '| **$1,000** (up to $5k select), 1–2 yrs | Not strictly enforced at Founders |',
    '| $200 starter (90 days) | **No** for $200; **Yes** for $4,800+ |',
  ].join('\n');
  const tree = vendor.parse(table);
  assert.deepEqual(collectMathNodes(tree), [], `${label}: the pricing table became math`);
  const text = collectText(tree).join(' ');
  for (const literal of ['$1,000', '$5k', '$200', '$4,800+']) assert.ok(text.includes(literal), `${label}: lost ${literal}`);
  assert.ok(!text.includes('**'), `${label}: Markdown emphasis left literal: ${text}`);

  const mixed = vendor.parse('The grant is $1,000 ($x$ per unit), or **$1,000** and **$y$** where $z = a + b$.');
  assert.deepEqual(collectMathNodes(mixed), [
    { type: 'inlineMath', value: 'x' },
    { type: 'inlineMath', value: 'y' },
    { type: 'inlineMath', value: 'z = a + b' },
  ], `${label}: currency and real math in one line`);

  const mixedDouble = vendor.parse('The fee is $100 and $$x^2$$ is the formula, or $100, $$a+b$$, and $y$.');
  assert.deepEqual(collectMathNodes(mixedDouble), [
    { type: 'inlineMath', value: 'x^2' },
    { type: 'inlineMath', value: 'a+b' },
    { type: 'inlineMath', value: 'y' },
  ], `${label}: currency and display math in one line`);

  for (const [md, expected] of MATH_CASES) {
    const actual = collectMathNodes(vendor.parse(md)).sort((a, b) => a.value.localeCompare(b.value));
    const expSorted = [...expected].sort((a, b) => a.value.localeCompare(b.value));
    assert.deepEqual(actual, expSorted, `${label}: math mismatch for: ${md}`);
    for (const m of actual) {
      const html = vendor.mod.k.renderToString(m.value, { displayMode: m.type === 'math', throwOnError: true });
      assert.ok(html.includes('katex'), `${label}: KaTeX failed to render: ${m.value}`);
    }
  }
}

test('the patch replaces the tokenizer once in the pristine vendor bundle', { skip: !havePristine && 'pristine/app.asar is not in this checkout' }, () => {
  const code = vendorText(pristinePath, VENDOR_PRISTINE);
  const patched = patchKatexDollar(code);
  assert.notEqual(patched, code);
  assert.throws(() => patchKatexDollar(patched), /expected 1 match, found 0/);
});

test('the unpatched vendor bundle turns the pricing table into math', { skip: !havePristine && 'pristine/app.asar is not in this checkout' }, async () => {
  const vendor = await loadVendor(vendorText(pristinePath, VENDOR_PRISTINE));
  try {
    const tree = vendor.parse('| **$1,000** (up to $5k select), 1–2 yrs | **No** for $200; **Yes** for $4,800+ |');
    assert.ok(collectMathNodes(tree).length > 0, 'the guard case must fail without the patch, or the test proves nothing');
    assert.ok(collectText(tree).join(' ').includes('**'), 'literal ** without the patch');
  } finally {
    vendor.cleanup();
  }
});

test('the patched vendor bundle keeps currency plain and still renders real math', { skip: !havePristine && 'pristine/app.asar is not in this checkout' }, async () => {
  const vendor = await loadVendor(patchKatexDollar(vendorText(pristinePath, VENDOR_PRISTINE)));
  try {
    checkMath(vendor, 'pristine+patch');
  } finally {
    vendor.cleanup();
  }
});

test('the built archive carries the patch', { skip: !fs.existsSync(builtPath) && 'build/app.asar is not in this checkout' }, async () => {
  const vendor = await loadVendor(vendorText(builtPath, VENDOR_BUILT));
  try {
    checkMath(vendor, 'build');
  } finally {
    vendor.cleanup();
  }
});