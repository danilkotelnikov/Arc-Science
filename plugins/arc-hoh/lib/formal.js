// Card C7 Formalization Engine (Road map phase 7): Text typed units & prose drift,
// Evidence DAG level monotonicity + lean-gate receipt gating, mm visual scene-graph arithmetic,
// LG6 4-control validator, and trusted-checker LOC budget counter.
import fs from 'node:fs';

export const UNIT_DIMS = ['m', 'kg', 's', 'A', 'K', 'mol', 'cd', 'bit', 'usd'];
export const EVIDENCE_LEVELS = [
  'target',
  'architecture',
  'simulated',
  'published',
  'measured',
  'machine-checked',
];

const UNIT_PRESETS = {
  '1': [0, 0, 0, 0, 0, 0, 0, 0, 0],
  dimensionless: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  m: [1, 0, 0, 0, 0, 0, 0, 0, 0],
  mm: [1, 0, 0, 0, 0, 0, 0, 0, 0],
  kg: [0, 1, 0, 0, 0, 0, 0, 0, 0],
  s: [0, 0, 1, 0, 0, 0, 0, 0, 0],
  ms: [0, 0, 1, 0, 0, 0, 0, 0, 0],
  bit: [0, 0, 0, 0, 0, 0, 0, 1, 0],
  bytes: [0, 0, 0, 0, 0, 0, 0, 1, 0],
  KB: [0, 0, 0, 0, 0, 0, 0, 1, 0],
  usd: [0, 0, 0, 0, 0, 0, 0, 0, 1],
  USD: [0, 0, 0, 0, 0, 0, 0, 0, 1],
  'm/s': [1, 0, -1, 0, 0, 0, 0, 0, 0],
  'usd/KB': [0, 0, 0, 0, 0, 0, 0, -1, 1],
  'tokens/s': [0, 0, -1, 0, 0, 0, 0, 1, 0],
};

const UNIT_FACTORS = { mm: 1e-3, ms: 1e-3, bytes: 8, KB: 8000, 'usd/KB': 1 / 8000 };
function canonicalUnitId(dims, scale = 1) {
  return `${dims.join(',')}@${Number(scale.toPrecision(12))}`;
}

function resolveDims(unitSpec) {
  if (Array.isArray(unitSpec)) {
    if (unitSpec.length !== UNIT_DIMS.length || !unitSpec.every(Number.isInteger)) {
      throw new Error(`Invalid unit exponent vector; expected ${UNIT_DIMS.length} integers`);
    }
    return [...unitSpec];
  }
  if (typeof unitSpec === 'string' && UNIT_PRESETS[unitSpec]) {
    return [...UNIT_PRESETS[unitSpec]];
  }
  throw new Error(`Unknown unit specification: ${String(unitSpec)}`);
}

export function sameDims(a, b) {
  return a.length === UNIT_DIMS.length && b.length === UNIT_DIMS.length && a.every((v, i) => v === b[i]);
}

export function quantity(value, unitSpec, label = null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Quantity value must be finite number, got ${String(value)}`);
  }
  const dims = resolveDims(unitSpec);
  const unitScale = typeof unitSpec === 'string' ? (UNIT_FACTORS[unitSpec] ?? 1) : 1;
  const unitId = canonicalUnitId(dims, unitScale);
  const unitLabel = label || (typeof unitSpec === 'string' ? unitSpec : dims.join(','));
  return { value, dims, unitScale, unitId, unitLabel };
}

export function addQuantities(a, b) {
  const canonicalMismatch = a.unitId && b.unitId && a.unitId !== b.unitId;
  if (!sameDims(a.dims, b.dims) || a.unitLabel !== b.unitLabel || canonicalMismatch) {
    return { ok: false, state: 'fail_unit_mismatch', detail: `cannot add ${a.unitLabel} and ${b.unitLabel}` };
  }
  const unitScale = a.unitScale ?? 1;
  return { ok: true, state: 'pass', quantity: { value: a.value + b.value, dims: [...a.dims], unitScale, unitId: a.unitId || canonicalUnitId(a.dims, unitScale), unitLabel: a.unitLabel } };
}

export function mulQuantities(a, b, label = `${a.unitLabel}*${b.unitLabel}`) {
  const dims = a.dims.map((v, i) => v + b.dims[i]);
  const unitScale = (a.unitScale ?? 1) * (b.unitScale ?? 1);
  return { ok: true, state: 'pass', quantity: { value: a.value * b.value, dims, unitScale, unitId: canonicalUnitId(dims, unitScale), unitLabel: label } };
}

export function divQuantities(a, b, label = `${a.unitLabel}/${b.unitLabel}`) {
  if (b.value === 0) return { ok: false, state: 'fail_div_zero', detail: 'divisor value is zero' };
  const dims = a.dims.map((v, i) => v - b.dims[i]);
  const unitScale = (a.unitScale ?? 1) / (b.unitScale ?? 1);
  return { ok: true, state: 'pass', quantity: { value: a.value / b.value, dims, unitScale, unitId: canonicalUnitId(dims, unitScale), unitLabel: label } };
}

export function compareQuantities(a, op, b) {
  const canonicalMismatch = a.unitId && b.unitId && a.unitId !== b.unitId;
  if (!sameDims(a.dims, b.dims) || a.unitLabel !== b.unitLabel || canonicalMismatch) {
    return { ok: false, state: 'fail_unit_mismatch', detail: `cannot compare ${a.unitLabel} and ${b.unitLabel}` };
  }
  const ops = {
    '<': a.value < b.value,
    '<=': a.value <= b.value,
    '==': a.value === b.value,
    '!=': a.value !== b.value,
    '>=': a.value >= b.value,
    '>': a.value > b.value,
  };
  if (!(op in ops)) return { ok: false, state: 'fail_invalid_op', detail: `unsupported op: ${op}` };
  return { ok: ops[op], state: ops[op] ? 'pass' : 'fail_comparison' };
}

export function renderTypedRecord(rec) {
  const { subject, comparator = '<=', value, unit, caveat = '' } = rec;
  if (!subject || typeof value !== 'number' || !Number.isFinite(value) || !unit) {
    throw new Error('Typed record requires subject, finite value, and unit');
  }
  const base = `${subject} ${comparator} ${value} ${unit}`;
  return caveat ? `${base} (caveat: ${caveat})` : base;
}

export function verifyRenderedProse(rec, proseText) {
  const comparator = rec.comparator ?? '<=';
  const expected = renderTypedRecord(rec);
  const text = String(proseText || '');
  const escapedSub = rec.subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedUnit = rec.unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${escapedSub}\\s+(<=|>=|==|!=|<|>)\\s+([-+]?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)\\s+${escapedUnit}(?![A-Za-z0-9_])`).exec(text);
  if (!m) {
    return { ok: false, state: 'fail_text_drift', expected, detail: 'missing subject/comparator/value/unit tuple' };
  }
  if (m[1] !== comparator) {
    return { ok: false, state: 'fail_text_drift', expected, detail: `comparator drifted: ${m[1]} vs ${comparator}` };
  }
  const tol = Math.abs(rec.value) > 0 && Math.abs(rec.value) < 1e-6 ? Math.abs(rec.value) * 1e-6 : 1e-9;
  if (Math.abs(Number(m[2]) - rec.value) > tol) {
    return { ok: false, state: 'fail_text_drift', expected, detail: `value drifted: ${m[2]} vs ${rec.value}` };
  }
  if (rec.caveat && !text.includes(rec.caveat)) {
    return { ok: false, state: 'fail_text_drift', expected, detail: 'required caveat omitted' };
  }
  return { ok: true, state: 'pass', rendered: expected };
}

function levelRank(level) {
  const idx = EVIDENCE_LEVELS.indexOf(level);
  if (idx < 0) throw new Error(`Unknown evidence level: ${String(level)}`);
  return idx;
}

export function verifyClaimDag(nodes, { leanReceipts = {} } = {}) {
  const map = new Map();
  for (const n of nodes) {
    if (!n || !n.id) return { ok: false, state: 'fail_invalid_node', detail: 'node missing id' };
    if (map.has(n.id)) return { ok: false, state: 'fail_duplicate_node', detail: n.id };
    map.set(n.id, n);
  }
  const visiting = new Set();
  const visited = new Set();
  function checkCycle(id) {
    if (visited.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    const node = map.get(id);
    for (const depId of node.deps || []) {
      if (!map.has(depId)) throw Object.assign(new Error(`missing dep ${depId}`), { state: 'fail_missing_dep' });
      if (checkCycle(depId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  try {
    for (const id of map.keys()) {
      if (checkCycle(id)) return { ok: false, state: 'fail_cycle', detail: id };
    }
  } catch (err) {
    return { ok: false, state: err.state || 'fail_missing_dep', detail: err.message };
  }

  const usedReceipts = new Map();
  for (const node of nodes) {
    const rank = levelRank(node.level);
    if (node.level === 'machine-checked') {
      const receipt = node.leanReceiptId ? leanReceipts[node.leanReceiptId] : null;
      if (!receipt || receipt.state !== 'pass') {
        const state = receipt && receipt.state === 'pass_core_only' ? 'fail_partial_receipt' : 'fail_unverified_formal';
        return { ok: false, state, detail: `${node.id} lacks strict pass receipt` };
      }
      const multiClaims = Array.isArray(receipt.claimIds) ? receipt.claimIds : null;
      if (!multiClaims && node.leanReceiptId) {
        const prev = usedReceipts.get(node.leanReceiptId);
        if (prev && prev !== node.id) {
          return { ok: false, state: 'fail_receipt_replay', detail: `receipt ${node.leanReceiptId} already bound to ${prev}` };
        }
        usedReceipts.set(node.leanReceiptId, node.id);
      }
      const claimBound = multiClaims ? multiClaims.includes(node.id) : receipt.claimId === node.id;
      if (!claimBound) {
        return { ok: false, state: 'fail_receipt_mismatch', detail: `receipt ${node.leanReceiptId} is not bound to ${node.id}` };
      }
      const allowedThms = Array.isArray(receipt.theorems) ? receipt.theorems : receipt.theorem ? [receipt.theorem] : null;
      if (!node.theorem || !allowedThms || !allowedThms.includes(node.theorem)) {
        return { ok: false, state: 'fail_receipt_mismatch', detail: `receipt ${node.leanReceiptId} does not cover ${node.theorem}` };
      }
    }
    for (const depId of node.deps || []) {
      const dep = map.get(depId);
      if (rank > levelRank(dep.level)) {
        return { ok: false, state: 'fail_level_escalation', detail: `${node.id} (${node.level}) > dep ${depId} (${dep.level})` };
      }
    }
  }
  return { ok: true, state: 'pass', checked: nodes.length };
}

export function verifySceneGraph(panel) {
  const { widthMm, heightMm, boxes = [] } = panel || {};
  if (widthMm !== 178 && widthMm !== 89) {
    return { ok: false, state: 'fail_canvas_width', detail: `widthMm must be 178 or 89, got ${String(widthMm)}` };
  }
  if (typeof heightMm !== 'number' || !Number.isFinite(heightMm) || heightMm <= 0) {
    return { ok: false, state: 'fail_canvas_height', detail: `invalid heightMm: ${String(heightMm)}` };
  }
  for (const b of boxes) {
    if (!b || ['xMm', 'yMm', 'wMm', 'hMm'].some((k) => typeof b[k] !== 'number' || !Number.isFinite(b[k]))) {
      return { ok: false, state: 'fail_out_of_bounds', detail: `${b?.id || 'box'} has invalid geometry` };
    }
    if (b.fontPt !== undefined && (typeof b.fontPt !== 'number' || !Number.isFinite(b.fontPt) || b.fontPt < 6.5)) {
      return { ok: false, state: 'fail_type_floor', detail: `${b.id} fontPt ${b.fontPt} < 6.5` };
    }
    if (b.wMm <= 0 || b.hMm <= 0 || b.xMm < 0 || b.yMm < 0 || b.xMm + b.wMm > widthMm + 1e-9 || b.yMm + b.hMm > heightMm + 1e-9) {
      return { ok: false, state: 'fail_out_of_bounds', detail: `${b.id} outside ${widthMm}x${heightMm}mm canvas` };
    }
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if ((a.layer ?? 0) !== (b.layer ?? 0)) continue;
      const separated = a.xMm + a.wMm <= b.xMm || b.xMm + b.wMm <= a.xMm || a.yMm + a.hMm <= b.yMm || b.yMm + b.hMm <= a.yMm;
      if (!separated) {
        return { ok: false, state: 'fail_box_overlap', detail: `${a.id} overlaps ${b.id}` };
      }
    }
  }
  return { ok: true, state: 'pass', boxes: boxes.length };
}

export function validateCheckerControls(checkerFn, { good, bad, vacuous, mutant }) {
  const results = {
    good: checkerFn(good),
    bad: checkerFn(bad),
    vacuous: checkerFn(vacuous),
    mutant: checkerFn(mutant),
  };
  const ok = Boolean(results.good?.ok === true && results.bad?.ok === false && results.vacuous?.ok === false && results.mutant?.ok === false);
  return { ok, state: ok ? 'pass' : 'fail_lg6_controls', results };
}

export function countTrustedCheckerLoc(filePaths, { maxLocPerFile = 300 } = {}) {
  const counts = [];
  let over = false;
  for (const fp of filePaths) {
    const src = fs.readFileSync(fp, 'utf8');
    const loc = src
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('--')).length;
    if (loc > maxLocPerFile) over = true;
    counts.push({ file: fp, loc, within_budget: loc <= maxLocPerFile });
  }
  return { ok: !over, state: over ? 'fail_loc_budget' : 'pass', max_loc_per_file: maxLocPerFile, files: counts };
}
