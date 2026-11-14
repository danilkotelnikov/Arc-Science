import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UNIT_DIMS,
  quantity,
  addQuantities,
  mulQuantities,
  divQuantities,
  compareQuantities,
  renderTypedRecord,
  verifyRenderedProse,
  verifyClaimDag,
  verifySceneGraph,
  validateCheckerControls,
  countTrustedCheckerLoc,
} from '../lib/formal.js';
import { evaluateEvidenceEngine, buildGraph, verifyClaimDag as claimsVerifyDag } from '../lib/claims.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('G7.2 / G7.5: 9-dim SI+bit+usd unit algebra and typed prose drift detector', () => {
  assert.equal(UNIT_DIMS.length, 9);
  const a = quantity(500, 'bytes');
  const b = quantity(1000, 'bytes');
  const sum = addQuantities(a, b);
  assert.equal(sum.ok, true);
  assert.equal(sum.quantity.value, 1500);

  const sec = quantity(2, 's');
  assert.equal(addQuantities(a, sec).state, 'fail_unit_mismatch');
  assert.equal(compareQuantities(a, '<=', sec).state, 'fail_unit_mismatch');

  const rate = divQuantities(quantity(160, 'KB'), quantity(2, 's'));
  assert.equal(rate.ok, true);
  assert.equal(rate.quantity.value, 80);
  assert.equal(rate.quantity.dims[2], -1);
  assert.equal(rate.quantity.dims[7], 1);

  const prod = mulQuantities(quantity(100, 'KB'), quantity(0.06, 'usd/KB'), 'usd');
  assert.equal(prod.ok, true);
  assert.ok(Math.abs(prod.quantity.value - 6.0) < 1e-9);
  assert.equal(prod.quantity.dims[8], 1);
  assert.equal(prod.quantity.dims[7], 0);

  const rec = { subject: 'PR diff', comparator: '<=', value: 160000, unit: 'bytes', caveat: 'binary patches included' };
  const rendered = renderTypedRecord(rec);
  assert.equal(verifyRenderedProse(rec, rendered).state, 'pass');
  assert.equal(verifyRenderedProse(rec, 'PR diff >= 160000 bytes (caveat: binary patches included)').state, 'fail_text_drift');
  assert.equal(verifyRenderedProse(rec, 'PR diff <= 180000 bytes (caveat: binary patches included)').state, 'fail_text_drift');
  assert.equal(verifyRenderedProse(rec, 'PR diff <= 160000 bytes').state, 'fail_text_drift');
  assert.equal(verifyRenderedProse({ subject: 'Budget', value: 10, unit: 'usd' }, 'Budget <= 10 usd').state, 'pass');
  const sci = { subject: 'Drift', comparator: '<=', value: 1e-7, unit: 'm' };
  assert.equal(verifyRenderedProse(sci, renderTypedRecord(sci)).state, 'pass');
  assert.equal(verifyRenderedProse(sci, 'Drift <= 2e-7 m').state, 'fail_text_drift');
  assert.equal(addQuantities(quantity(10, 'mm', 'len'), quantity(10, 'm', 'len')).state, 'fail_unit_mismatch');
  assert.equal(
    compareQuantities(mulQuantities(quantity(10, 'mm', 'len'), quantity(1, '1'), 'len').quantity, '==', quantity(10, 'm', 'len')).state,
    'fail_unit_mismatch',
  );
  assert.equal(
    compareQuantities(divQuantities(quantity(10, 'mm'), quantity(2, 's'), 'm/s').quantity, '==', quantity(5, 'm/s')).state,
    'fail_unit_mismatch',
  );
  assert.equal(compareQuantities(prod.quantity, '==', quantity(6, 'usd')).state, 'pass');
});

test('G3.5 / G7.3: Evidence DAG blocks machine-checked without strict pass receipt and stops escalation', () => {
  const passReceipts = {
    'r-ok': { state: 'pass', claimId: 'axiom1', theorem: 'ax_thm' },
    'r-replay': { state: 'pass', claimId: 'c1', theorem: 'thm1' },
    'r-unbound': { state: 'pass' },
    'r-partial': { state: 'pass_core_only', claimId: 'claim2', theorem: 'thm2' },
  };
  const okDag = verifyClaimDag(
    [
      { id: 'axiom1', level: 'machine-checked', deps: [], leanReceiptId: 'r-ok', theorem: 'ax_thm' },
      { id: 'claim1', level: 'measured', deps: ['axiom1'] },
    ],
    { leanReceipts: passReceipts },
  );
  assert.equal(okDag.state, 'pass');

  const unbound = verifyClaimDag(
    [{ id: 'c3', level: 'machine-checked', deps: [], leanReceiptId: 'r-unbound', theorem: 'thm3' }],
    { leanReceipts: passReceipts },
  );
  assert.equal(unbound.state, 'fail_receipt_mismatch');

  const noThm = verifyClaimDag(
    [{ id: 'axiom1', level: 'machine-checked', deps: [], leanReceiptId: 'r-ok' }],
    { leanReceipts: passReceipts },
  );
  assert.equal(noThm.state, 'fail_receipt_mismatch');

  const partial = verifyClaimDag(
    [{ id: 'claim2', level: 'machine-checked', deps: [], leanReceiptId: 'r-partial', theorem: 'thm2' }],
    { leanReceipts: passReceipts },
  );
  assert.equal(partial.state, 'fail_partial_receipt');

  const esc = verifyClaimDag(
    [
      { id: 'e1', level: 'simulated', deps: [] },
      { id: 'c1', level: 'measured', deps: ['e1'] },
    ],
    { leanReceipts: passReceipts },
  );
  assert.equal(esc.state, 'fail_level_escalation');

  const cyc = verifyClaimDag([
    { id: 'a', level: 'measured', deps: ['b'] },
    { id: 'b', level: 'measured', deps: ['a'] },
  ]);
  assert.equal(cyc.state, 'fail_cycle');

  const replay = verifyClaimDag(
    [
      { id: 'c1', level: 'machine-checked', deps: [], leanReceiptId: 'r-replay', theorem: 'thm1' },
      { id: 'c2', level: 'machine-checked', deps: [], leanReceiptId: 'r-replay', theorem: 'thm2' },
    ],
    { leanReceipts: passReceipts },
  );
  assert.equal(replay.state, 'fail_receipt_replay');

  // claims.js evaluateEvidenceEngine refuses unverified machine-checked support
  const g = buildGraph([
    { type: 'node', id: 'c', kind: 'claim', numbers: ['1'] },
    { type: 'node', id: 'e', kind: 'evidence', level: 'machine-checked', numbers: ['1'] },
    { type: 'link', from: 'e', rel: 'supports', to: 'c', lr: 8 },
  ]);
  const evRes = evaluateEvidenceEngine(g, 'c');
  assert.equal(evRes.ok, false);
  assert.deepEqual(evRes.unverifiedFormal, ['e']);

  const gOk = buildGraph([
    { type: 'node', id: 'c', kind: 'claim', numbers: ['1'] },
    { type: 'node', id: 'e', kind: 'evidence', level: 'machine-checked', leanReceipt: { state: 'pass' }, numbers: ['1'] },
    { type: 'link', from: 'e', rel: 'supports', to: 'c', lr: 8 },
  ]);
  const evOk = evaluateEvidenceEngine(gOk, 'c');
  assert.equal(evOk.ok, true);
  assert.deepEqual(evOk.unverifiedFormal, []);
  assert.equal(claimsVerifyDag, verifyClaimDag);
});

test('G7.4: Visual scene graph enforces Nature canvas mm dimensions, overlaps, and 6.5 pt type floor', () => {
  const validPanel = {
    widthMm: 178,
    heightMm: 120,
    boxes: [
      { id: 'panelA', xMm: 2, yMm: 2, wMm: 80, hMm: 50, fontPt: 7.0 },
      { id: 'panelB', xMm: 86, yMm: 2, wMm: 88, hMm: 50, fontPt: 6.5 },
    ],
  };
  assert.equal(verifySceneGraph(validPanel).state, 'pass');
  assert.equal(verifySceneGraph({ widthMm: 89, heightMm: 60, boxes: [{ id: 'a' }] }).state, 'fail_out_of_bounds');
  assert.equal(verifySceneGraph({ ...validPanel, widthMm: 150 }).state, 'fail_canvas_width');
  assert.equal(
    verifySceneGraph({ ...validPanel, boxes: [{ id: 'tiny', xMm: 2, yMm: 2, wMm: 20, hMm: 10, fontPt: 6.0 }] }).state,
    'fail_type_floor',
  );
  assert.equal(
    verifySceneGraph({
      ...validPanel,
      boxes: [
        { id: 'a', xMm: 0, yMm: 0, wMm: 50, hMm: 50 },
        { id: 'b', xMm: 40, yMm: 40, wMm: 30, hMm: 30 },
      ],
    }).state,
    'fail_box_overlap',
  );
});

test('G7.1 / G7.7: LG6 3-control runner and <= 300 LOC budget for formal.js', () => {
  const res = validateCheckerControls((panel) => verifySceneGraph(panel), {
    good: { widthMm: 89, heightMm: 60, boxes: [{ id: 'a', xMm: 1, yMm: 1, wMm: 40, hMm: 20, fontPt: 7 }] },
    bad: { widthMm: 89, heightMm: 60, boxes: [{ id: 'a', xMm: 1, yMm: 1, wMm: 20, hMm: 10, fontPt: 5 }] },
    vacuous: { widthMm: 100, heightMm: 60, boxes: [] },
    mutant: { widthMm: 89, heightMm: 60, boxes: [{ id: 'a', xMm: 80, yMm: 1, wMm: 20, hMm: 10 }] },
  });
  assert.equal(res.state, 'pass');

  const locReport = countTrustedCheckerLoc([path.join(PLUGIN_ROOT, 'lib', 'formal.js')]);
  assert.equal(locReport.state, 'pass');
  assert.ok(locReport.files[0].loc <= 300, `expected <= 300 LOC, got ${locReport.files[0].loc}`);
});
