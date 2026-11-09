// arc-hoh intuition (2026-11-09): System One fast router and Brier calibration (roadmap 3.3 & 5.2, Slice D2).
// Routes each prompt to one of five typed outcomes, logs probability guesses in [0, 1],
// enforces R009 (never grants permissions or overrides deterministic checks), and computes Brier score.

export const INTUITION_OUTCOMES = Object.freeze([
  'answer_now',
  'run_one_cheap_check',
  'open_tree_hoh',
  'ask_operator',
  'abstain',
]);

function clampProb(p) {
  if (typeof p !== 'number' || !Number.isFinite(p)) return 0.5;
  return Math.min(1, Math.max(0, p));
}

export function routeIntuition(input = {}) {
  if (input && input.grantPermission === true) {
    return {
      ok: false,
      rule: 'R009',
      permissionGranted: false,
      error: 'System One intuition router never grants permissions (R009)',
    };
  }

  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : 'guess-1';
  const probability = clampProb(input.priorProbability ?? input.probability ?? 0.5);
  const uncertainty = clampProb(input.uncertainty ?? 1 - Math.abs(2 * probability - 1));
  const cheapCheckAvailable = Boolean(input.cheapCheckAvailable);
  const needsOperator = Boolean(input.needsOperator);
  const canVerify = input.canVerify !== false;

  let outcome = 'open_tree_hoh';
  if (needsOperator) {
    outcome = 'ask_operator';
  } else if (!canVerify && probability < 0.25) {
    outcome = 'abstain';
  } else if (probability >= 0.85 && uncertainty <= 0.3 && !cheapCheckAvailable) {
    outcome = 'answer_now';
  } else if (cheapCheckAvailable && probability >= 0.4) {
    outcome = 'run_one_cheap_check';
  } else {
    outcome = 'open_tree_hoh';
  }

  return {
    ok: true,
    id,
    outcome,
    probability,
    uncertainty,
    permissionGranted: false,
    score_kind: 'heuristic_guess',
  };
}

export function recordIntuitionOutcome(records = [], id, actual) {
  const y = actual === true || actual === 1 ? 1 : 0;
  return records.map((r) => (r.id === id ? { ...r, actual: y } : { ...r }));
}

export function brierScore(records = []) {
  const resolved = records.filter(
    (r) => r && typeof r.probability === 'number' && (r.actual === 0 || r.actual === 1),
  );
  if (resolved.length === 0) return null;
  const sumSq = resolved.reduce((acc, r) => {
    const diff = r.probability - r.actual;
    return acc + diff * diff;
  }, 0);
  return sumSq / resolved.length;
}

export function calibrationReport(records = []) {
  const resolved = records.filter(
    (r) => r && typeof r.probability === 'number' && (r.actual === 0 || r.actual === 1),
  );
  const brier = brierScore(resolved);
  const bins = Array.from({ length: 5 }, (_, idx) => {
    const lo = idx * 0.2;
    const hi = idx === 4 ? 1.0001 : (idx + 1) * 0.2;
    const items = resolved.filter((r) => r.probability >= lo && r.probability < hi);
    const meanPred = items.length ? items.reduce((s, x) => s + x.probability, 0) / items.length : 0;
    const meanObs = items.length ? items.reduce((s, x) => s + x.actual, 0) / items.length : 0;
    return { range: [Number(lo.toFixed(1)), Number((idx + 1) * 0.2).toFixed(1)], count: items.length, meanPred, meanObs };
  });
  return {
    count: resolved.length,
    brier,
    calibrated: brier !== null && brier <= 0.25,
    bins,
  };
}
