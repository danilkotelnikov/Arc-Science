// arc-hoh intuition (2026-11-09): System One fast router and Brier calibration (roadmap 3.3 & 5.2, Slice D2).
// Routes each prompt to one of five typed outcomes, logs probability guesses in [0, 1],
// enforces R009 (never grants permissions or overrides deterministic checks), and computes Brier score.
import { loss, voi } from './tree.js';
import { checkCrossFamilyVerdict } from './budget.js';

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

function normalizeFailClosedFlag(value) {
  return value === undefined || value === false ? false : true;
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


export const STAGE0_ROLE_TABLE = Object.freeze({
  T0: Object.freeze({ tier: 'T0', primary: 'gemini-4-hydrogen', fallback: 'claude-haiku-5-5', family: 'google', fallbackFamily: 'anthropic' }),
  T1: Object.freeze({ tier: 'T1', primary: 'gemini-4-argon', fallback: 'claude-sonnet-5-5', family: 'google', fallbackFamily: 'anthropic' }),
  T2: Object.freeze({ tier: 'T2', primary: 'gemini-4-carbon', fallback: 'claude-opus-5-5', family: 'google', fallbackFamily: 'anthropic' }),
  T3: Object.freeze({ tier: 'T3', primary: 'claude-fable-5-2', fallback: 'claude-opus-5-5', family: 'anthropic', fallbackFamily: 'anthropic' }),
  roles: Object.freeze({
    scout: Object.freeze({ role: 'scout', tier: 'T0', route: 'gemini-4-hydrogen', family: 'google' }),
    builder: Object.freeze({ role: 'builder', tier: 'T1', route: 'gemini-4-argon', family: 'google' }),
    lead: Object.freeze({ role: 'lead', tier: 'T2', route: 'gemini-4-carbon', family: 'google' }),
    framer: Object.freeze({ role: 'framer', tier: 'T2', route: 'gemini-4-carbon', family: 'google' }),
    'lean-prover': Object.freeze({ role: 'lean-prover', tier: 'T3', route: 'claude-fable-5-2', family: 'anthropic' }),
    checker: Object.freeze({ role: 'checker', tier: 'T1', route: 'claude-sonnet-5-5', family: 'anthropic' }),
    'red-team': Object.freeze({ role: 'red-team', tier: 'T3', route: 'claude-opus-5-5', family: 'anthropic' }),
    archivist: Object.freeze({ role: 'archivist', tier: 'T0', route: 'claude-haiku-5-5', family: 'anthropic' }),
  }),
});

export const EXPLORATION_SHARES = Object.freeze({
  cheap: 0.2,
  failed_check: 0.05,
  stop: 0,
  safety: 0,
});

const ESCALATION_KEYS = Object.freeze([
  'permissionGranted',
  'grantPermission',
  'bypassConsent',
  'bypassGate',
  'autoApplied',
  'autoApply',
  'overrideR006',
  'overrideR009',
  'raiseSpendCap',
  'spendApproved',
]);

/** Verify that a router or learned policy output never claims permissions or bypasses R009/R006 (G8.7). */
export function enforceConsentNonEscalation(decision) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    return { ok: false, state: 'fail_bad_decision', rule: 'R009', violations: ['missing decision object'] };
  }
  const violations = [];
  for (const key of ESCALATION_KEYS) {
    if (decision[key] === true) violations.push(`${key}=true`);
  }
  if (typeof decision.consentToken === 'string' && decision.consentToken.trim().length > 0) {
    violations.push('minted consentToken');
  }
  if (typeof decision.spendCapUsd === 'number' && decision.spendCapUsd > 0) {
    violations.push('unapproved spendCapUsd escalation');
  }
  return violations.length
    ? { ok: false, state: 'fail_r009_escalation', rule: 'R009', violations, permissionGranted: false }
    : { ok: true, state: 'pass', rule: 'R009', violations: [], permissionGranted: false };
}

/** Deterministic Stage-0 rule router over STAGE0_ROLE_TABLE (G8.2). Never grants permissions (R009). */
export function routeTaskStage0(task = {}) {
  const esc = enforceConsentNonEscalation(task);
  if (!esc.ok) {
    return { ok: false, state: 'fail_r009_escalation', rule: 'R009', permissionGranted: false, autoApplied: false, violations: esc.violations };
  }
  const taskId = typeof task.id === 'string' && task.id.trim() ? task.id.trim() : 'task-0';
  const requestedRole = typeof task.role === 'string' ? task.role.trim() : '';
  const kind = typeof task.kind === 'string' ? task.kind.trim() : 'build';

  let role = requestedRole && Object.hasOwn(STAGE0_ROLE_TABLE.roles, requestedRole) ? requestedRole : 'builder';
  if (!requestedRole) {
    if (kind === 'lookup' || kind === 'scan' || kind === 'archive') role = 'scout';
    else if (kind === 'plan' || kind === 'frame' || kind === 'orchestrate') role = 'lead';
    else if (kind === 'lean' || kind === 'proof' || kind === 'formal_math') role = 'lean-prover';
    else if (kind === 'audit' || kind === 'red_team') role = 'red-team';
    else if (kind === 'check' || kind === 'review') role = 'checker';
  }

  const builderFamily = typeof task.builderFamily === 'string' ? task.builderFamily.trim().toLowerCase() : '';
  let spec = STAGE0_ROLE_TABLE.roles[role];
  if (builderFamily && spec.family === builderFamily && (kind === 'check' || kind === 'review' || role === 'checker')) {
    role = builderFamily === 'anthropic' ? 'builder' : 'checker';
    spec = builderFamily === 'anthropic'
      ? { role: 'checker', tier: 'T1', route: STAGE0_ROLE_TABLE.T1.primary, family: 'google' }
      : STAGE0_ROLE_TABLE.roles.checker;
  }

  const out = {
    ok: true,
    taskId,
    role: spec.role,
    tier: spec.tier,
    route: spec.route,
    family: spec.family,
    reason: `stage0:${kind}`,
    permissionGranted: false,
    autoApplied: false,
  };
  return out;
}

/** Log a stochastic/bandit propensity record under spec 13.11 exploration caps (G8.3). */
export function logPropensityDecision({ contextId, candidates = [], baselineAction, chosenAction, loggingPropensity, seed, mode = 'cheap' } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { ok: false, state: 'fail_no_candidates', error: 'candidates must be a non-empty array' };
  }
  if (!Object.hasOwn(EXPLORATION_SHARES, mode)) {
    return { ok: false, state: 'fail_unknown_mode', error: `unknown exploration mode: ${mode}` };
  }
  const exploreShare = EXPLORATION_SHARES[mode];
  const base = baselineAction && candidates.includes(baselineAction) ? baselineAction : candidates[0];
  const k = candidates.length;
  let picked = base;
  let propensity = 1.0;
  if (exploreShare > 0) {
    if (chosenAction != null) {
      if (!candidates.includes(chosenAction)) {
        return { ok: false, state: 'fail_unknown_action', error: `chosenAction ${chosenAction} not in candidates` };
      }
      if (typeof loggingPropensity !== 'number' || !Number.isFinite(loggingPropensity) || loggingPropensity <= 0 || loggingPropensity > 1) {
        return { ok: false, state: 'fail_missing_propensity', error: 'external chosenAction requires loggingPropensity in (0, 1]' };
      }
      picked = chosenAction;
      propensity = loggingPropensity;
    } else {
      const rng = seed != null ? seededPrng(seed) : Math.random;
      picked = rng() < exploreShare ? candidates[Math.floor(rng() * k)] : base;
      const pickedCount = candidates.filter((c) => c === picked).length;
      propensity = (picked === base ? 1 - exploreShare : 0) + (exploreShare * pickedCount) / k;
    }
  }
  if (!(propensity > 0 && propensity <= 1)) {
    return { ok: false, state: 'fail_bad_propensity', error: 'propensity must lie in (0, 1]' };
  }
  return {
    ok: true,
    contextId: contextId ?? 'ctx-0',
    mode,
    exploreShare,
    exploring: exploreShare > 0 && picked !== base,
    baselineAction: base,
    action: picked,
    propensity,
    permissionGranted: false,
    autoApplied: false,
  };
}

function seededPrng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function meanOf(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

/** Counterfactual clipped self-normalized IPS policy evaluator with paired bootstrap & Holm step-down (G8.4-G8.6). */
export function evaluatePolicyIPS(rows, candidatePolicyFn, options = {}) {
  const {
    minRows = 200,
    minActionTries = 10,
    maxMeanTokens = Infinity,
    bootstrapIters = 500,
    alpha = 0.05,
    stepIndex = 1,
    totalTests = 1,
    rank = 1,
    seed = 42,
    clipRatio = 10,
  } = options;

  if (!Array.isArray(rows) || rows.length < minRows) {
    return { ok: false, state: 'blocked_rows', reason: 'row_floor_unmet', rowCount: Array.isArray(rows) ? rows.length : 0, minRows, autoApplied: false };
  }

  const actionCounts = Object.create(null);
  for (const r of rows) {
    if (!r || typeof r.action !== 'string') {
      return { ok: false, state: 'fail_bad_row', reason: 'missing action' };
    }
    if (typeof r.propensity !== 'number' || !Number.isFinite(r.propensity) || r.propensity <= 0 || r.propensity > 1) {
      return { ok: false, state: 'fail_bad_propensity', reason: 'propensity must lie in (0, 1]' };
    }
    actionCounts[r.action] = (actionCounts[r.action] || 0) + 1;
  }

  for (const [act, cnt] of Object.entries(actionCounts)) {
    if (cnt < minActionTries) {
      return { ok: false, state: 'blocked_rows', reason: 'action_floor_unmet', action: act, count: cnt, minActionTries, actionCounts, autoApplied: false };
    }
  }

  const weights = [];
  const rewards = [];
  const baselines = [];
  const tokenCosts = [];
  for (const r of rows) {
    const cand = candidatePolicyFn(r);
    if ((actionCounts[cand] || 0) < minActionTries) {
      return { ok: false, state: 'blocked_rows', reason: 'candidate_action_floor_unmet', action: cand, count: actionCounts[cand] || 0, minActionTries, actionCounts, autoApplied: false };
    }
    const match = cand === r.action;
    const w = match ? Math.min(clipRatio, 1 / r.propensity) : 0;
    weights.push(w);
    rewards.push(Number(r.reward ?? 0));
    baselines.push(Number(r.baselineReward ?? r.reward ?? 0));
    if (Number.isFinite(maxMeanTokens) && (r.candidateTokens == null && r.tokens == null || !Number.isFinite(Number(r.candidateTokens ?? r.tokens)))) {
      return { ok: false, state: 'blocked_rows', reason: 'missing_token_cost', autoApplied: false };
    }
    tokenCosts.push(Number(r.candidateTokens ?? r.tokens ?? 0));
  }

  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) {
    return { ok: false, state: 'blocked_rows', reason: 'zero_overlap_weight', autoApplied: false };
  }

  const ipsMean = weights.reduce((s, w, i) => s + w * rewards[i], 0) / weightSum;
  const baselineMean = meanOf(baselines);
  const diffPoint = ipsMean - baselineMean;
  const meanTokens = weights.reduce((s, w, i) => s + w * tokenCosts[i], 0) / weightSum;

  if (Number.isFinite(maxMeanTokens) && meanTokens > maxMeanTokens) {
    return {
      ok: false,
      state: 'fail_token_cap',
      ipsMean,
      baselineMean,
      diffPoint,
      meanTokens,
      maxMeanTokens,
      autoApplied: false,
    };
  }

  const effectiveTests = totalTests > 1 ? Math.max(1, totalTests - rank + 1) : Math.max(1, stepIndex);
  const adjustedAlpha = Math.max(1e-6, Math.min(0.5, alpha / effectiveTests));
  const rng = seededPrng(seed);
  const n = rows.length;
  const diffs = [];
  for (let b = 0; b < bootstrapIters; b++) {
    let bw = 0;
    let bwr = 0;
    let bBase = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rng() * n);
      bw += weights[idx];
      bwr += weights[idx] * rewards[idx];
      bBase += baselines[idx];
    }
    const bIps = bw > 0 ? bwr / bw : baselineMean;
    diffs.push(bIps - (bBase / n));
  }
  diffs.sort((a, b) => a - b);
  const loIdx = Math.max(0, Math.min(diffs.length - 1, Math.floor((adjustedAlpha / 2) * diffs.length)));
  const hiIdx = Math.max(0, Math.min(diffs.length - 1, Math.floor((1 - adjustedAlpha / 2) * diffs.length)));
  const ciLow = diffs[loIdx];
  const ciHigh = diffs[hiIdx];
  const passesGain = ciLow > 0;

  return {
    ok: passesGain,
    state: passesGain ? 'pass' : 'fail_no_gain',
    rowCount: n,
    actionCounts,
    ipsMean: Number(ipsMean.toFixed(6)),
    baselineMean: Number(baselineMean.toFixed(6)),
    diffPoint: Number(diffPoint.toFixed(6)),
    ci: [Number(ciLow.toFixed(6)), Number(ciHigh.toFixed(6))],
    adjustedAlpha: Number(adjustedAlpha.toFixed(6)),
    meanTokens: Number(meanTokens.toFixed(2)),
    autoApplied: false,
    permissionGranted: false,
  };
}

/** Parse shared/models.tsv into a lowercase Set of canonical model names and aliases. */
export function parseModelsTsv(tsvText = '') {
  const known = new Set();
  for (const rawLine of String(tsvText).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const cols = line.split('\t');
    if (cols[0]) known.add(cols[0].trim().toLowerCase());
    if (cols[1]) {
      for (const alias of cols[1].split('|')) {
        if (alias.trim()) known.add(alias.trim().toLowerCase());
      }
    }
  }
  return known;
}

/** Validate training manifest against models.tsv (G8.1) and public-source isolation (G8.8). */
export function checkTrainingManifest(manifest, knownModelsSet) {
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, state: 'fail_bad_manifest', errors: ['manifest object is required'] };
  }
  const normalized = new Set(Array.from(knownModelsSet || [], (m) => String(m).trim().toLowerCase()));
  const modelRefs = [];
  if (manifest.base_model) modelRefs.push(manifest.base_model);
  if (manifest.teacher_model) modelRefs.push(manifest.teacher_model);
  if (Array.isArray(manifest.models)) modelRefs.push(...manifest.models);

  const unknownModels = [];
  for (const m of modelRefs) {
    if (!normalized.has(String(m).trim().toLowerCase())) unknownModels.push(m);
  }
  if (unknownModels.length) {
    return { ok: false, state: 'fail_unknown_model', unknownModels };
  }

  const isPublicStudent = manifest.student_public !== false;
  if (isPublicStudent) {
    if (manifest.base_private !== false || manifest.teacher_private !== false) {
      return { ok: false, state: 'fail_private_manifest', reason: 'base_private and teacher_private must be false' };
    }
    if (!Array.isArray(manifest.data) || manifest.data.length === 0) {
      return { ok: false, state: 'fail_private_manifest', reason: 'data must be a non-empty array' };
    }
    const badSources = manifest.data.filter((d) => !d || d.private !== false);
    if (badSources.length) {
      return { ok: false, state: 'fail_private_manifest', reason: 'private data source in public student manifest', badSources };
    }
  }

  return { ok: true, state: 'pass', checkedModels: modelRefs.length };
}

const PLATT_EPS = 1e-6;

function probToLogit(p) {
  const c = Math.min(1 - PLATT_EPS, Math.max(PLATT_EPS, clampProb(p)));
  return Math.log(c / (1 - c));
}

function sigmoid(z) {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Fit L2-regularized Platt logistic scaler q = sigmoid(a * logit(p) + b) via damped Newton steps. */
export function fitPlattScaler(records = [], options = {}) {
  const l2 = typeof options.l2 === 'number' && options.l2 > 0 ? options.l2 : 0.05;
  const resolved = (records || []).filter(
    (r) => r && typeof r.probability === 'number' && Number.isFinite(r.probability) && (r.actual === 0 || r.actual === 1),
  );
  const posCount = resolved.filter((r) => r.actual === 1).length;
  const negCount = resolved.length - posCount;
  if (resolved.length === 0 || posCount < 1 || negCount < 1) {
    return { a: 1, b: 0, count: resolved.length, posCount, negCount, l2, converged: false, usable: false };
  }
  const maxIter = Number.isInteger(options.maxIter) && options.maxIter > 0 ? options.maxIter : 40;
  let a = 1;
  let b = 0;
  let converged = false;

  for (let iter = 0; iter < maxIter; iter += 1) {
    let gA = l2 * (a - 1);
    let gB = l2 * b;
    let hAA = l2;
    let hBB = l2;
    let hAB = 0;
    for (const r of resolved) {
      const z = probToLogit(r.probability);
      const q = sigmoid(a * z + b);
      const w = Math.max(1e-9, q * (1 - q));
      const err = q - r.actual;
      gA += err * z;
      gB += err;
      hAA += w * z * z;
      hBB += w;
      hAB += w * z;
    }
    const det = hAA * hBB - hAB * hAB;
    if (!(det > 1e-12)) break;
    const dA = (hBB * gA - hAB * gB) / det;
    const dB = (hAA * gB - hAB * gA) / det;
    const stepScale = Math.min(1, 2 / Math.max(1e-9, Math.hypot(dA, dB)));
    a -= stepScale * dA;
    b -= stepScale * dB;
    if (Math.hypot(stepScale * dA, stepScale * dB) < 1e-6) {
      converged = true;
      break;
    }
  }
  if (!(a > 0) || !Number.isFinite(a) || !Number.isFinite(b)) {
    return { a: 1, b: 0, count: resolved.length, posCount, negCount, l2, converged: false, usable: false };
  }
  return {
    a,
    b,
    count: resolved.length,
    posCount,
    negCount,
    l2,
    converged,
    usable: false,
  };
}

/** Apply a fitted Platt scaler to a raw probability in [0, 1]. */
export function applyPlattScaler(probability, scaler = { a: 1, b: 0 }) {
  const a = scaler && typeof scaler.a === 'number' && Number.isFinite(scaler.a) && scaler.a > 0 ? scaler.a : 1;
  const b = scaler && typeof scaler.b === 'number' && Number.isFinite(scaler.b) ? scaler.b : 0;
  return clampProb(sigmoid(a * probToLogit(probability) + b));
}

/** Compute Brier Skill Score (1 - Brier / Brier_ref) against sample climatology base rate. */
export function brierSkillScore(records = []) {
  const resolved = (records || []).filter(
    (r) => r && typeof r.probability === 'number' && Number.isFinite(r.probability) && (r.actual === 0 || r.actual === 1),
  );
  if (resolved.length === 0) return null;
  const brier = brierScore(resolved);
  const baseRate = resolved.reduce((acc, r) => acc + r.actual, 0) / resolved.length;
  const refBrier = baseRate * (1 - baseRate);
  if (refBrier <= 1e-12) return null;
  return 1 - brier / refBrier;
}

/** Fit 2-fold stratified out-of-fold Platt scalers to score calibration honestly without in-sample optimism. */
export function crossFitPlatt2Fold(records = [], options = {}) {
  const resolved = (records || []).filter(
    (r) => r && typeof r.probability === 'number' && Number.isFinite(r.probability) && (r.actual === 0 || r.actual === 1),
  );
  const rawBrier = brierScore(resolved);
  const rawBss = brierSkillScore(resolved);
  const posCount = resolved.filter((r) => r.actual === 1).length;
  const negCount = resolved.length - posCount;
  const l2 = typeof options.l2 === 'number' && options.l2 > 0 ? options.l2 : 0.05;
  if (resolved.length < 4 || posCount < 2 || negCount < 2) {
    const scaler = { a: 1, b: 0, count: resolved.length, posCount, negCount, l2, converged: false, usable: false };
    return {
      ok: true,
      count: resolved.length,
      rawBrier,
      oofBrier: null,
      rawBss,
      bss: null,
      scaler,
      foldScalers: [],
      allConverged: false,
      usable: false,
      predictions: [],
    };
  }
  // Stratify folds within each outcome class so small interleaved samples avoid single-class folds.
  const foldOf = new Array(resolved.length);
  let posSeen = 0;
  let negSeen = 0;
  for (let i = 0; i < resolved.length; i += 1) {
    if (resolved[i].actual === 1) {
      foldOf[i] = posSeen % 2;
      posSeen += 1;
    } else {
      foldOf[i] = negSeen % 2;
      negSeen += 1;
    }
  }
  const fold0Train = resolved.filter((_, idx) => foldOf[idx] === 1);
  const fold1Train = resolved.filter((_, idx) => foldOf[idx] === 0);
  const scalerEven = fitPlattScaler(fold0Train, options);
  const scalerOdd = fitPlattScaler(fold1Train, options);
  const fullScaler = fitPlattScaler(resolved, options);
  const predictions = resolved.map((r, idx) => {
    const fold = foldOf[idx];
    const scaler = fold === 0 ? scalerEven : scalerOdd;
    return {
      ...r,
      rawProbability: r.probability,
      probability: applyPlattScaler(r.probability, scaler),
      fold,
    };
  });
  const allConverged = scalerEven.converged && scalerOdd.converged && fullScaler.converged;
  const oofBrier = brierScore(predictions);
  const improvesOof = typeof oofBrier === 'number' && typeof rawBrier === 'number' && oofBrier < rawBrier;
  const usable = allConverged && resolved.length >= 20 && posCount >= 2 && negCount >= 2 && improvesOof;
  return {
    ok: true,
    count: resolved.length,
    rawBrier,
    oofBrier,
    rawBss,
    bss: brierSkillScore(predictions),
    improvesOof,
    scaler: { ...fullScaler, oofBrier, rawBrier, improvesOof, usable },
    foldScalers: [scalerEven, scalerOdd],
    allConverged,
    usable,
    predictions,
  };
}

/**
 * Bayes-optimal decision router maximizing net VOI and scale-invariant positive-action loss (spec 13.15).
 * Check costs must use the same loss units as cfp and cfn; positiveLoss and check cost are normalized by
 * 0.5 * (cfp + cfn) before thresholding so uniform scaling of (cfp, cfn, cost) preserves routing outcomes,
 * alongside a weight-independent minimum probability floor.
 */
export function routeOptimalDecision(input = {}) {
  const esc = enforceConsentNonEscalation(input);
  if (!esc.ok) {
    return { ok: false, state: esc.state, rule: 'R009', permissionGranted: false, autoApplied: false, violations: esc.violations };
  }
  const inp = input;
  const id = typeof inp.id === 'string' && inp.id.trim() ? inp.id.trim() : 'dec-1';
  const rawProbability = clampProb(inp.priorProbability ?? inp.probability ?? 0.5);
  const minPlatt = Number.isInteger(inp.minPlattSamples) && inp.minPlattSamples > 0 ? inp.minPlattSamples : 20;
  const scaler = inp.plattScaler;
  const scalerUsable = Boolean(
    scaler
    && typeof scaler === 'object'
    && scaler.converged === true
    && scaler.usable === true
    && Number.isInteger(scaler.count) && scaler.count >= minPlatt
    && Number.isInteger(scaler.posCount) && scaler.posCount >= 2
    && Number.isInteger(scaler.negCount) && scaler.negCount >= 2,
  );
  const q = scalerUsable ? applyPlattScaler(rawProbability, scaler) : rawProbability;
  const cfp = typeof inp.cfp === 'number' && Number.isFinite(inp.cfp) && inp.cfp > 0 ? inp.cfp : 1;
  const cfn = typeof inp.cfn === 'number' && Number.isFinite(inp.cfn) && inp.cfn > 0 ? inp.cfn : 1;
  const lossScale = 0.5 * (cfp + cfn);
  const baseLoss = loss(q, cfp, cfn);
  const positiveLoss = cfp * (1 - q);
  const normalizedPositiveLoss = positiveLoss / lossScale;
  const answerCutoff = cfp / (cfp + cfn);
  const canVerify = inp.canVerify !== false;
  const needsOperator = normalizeFailClosedFlag(inp.needsOperator) || normalizeFailClosedFlag(inp.requiresHumanYes);
  const cheapCostThreshold = typeof inp.cheapCostThreshold === 'number' && Number.isFinite(inp.cheapCostThreshold) && inp.cheapCostThreshold > 0 ? inp.cheapCostThreshold : 0.2;
  const answerLossThreshold = typeof inp.answerLossThreshold === 'number' && Number.isFinite(inp.answerLossThreshold) && inp.answerLossThreshold > 0 ? inp.answerLossThreshold : 0.15;
  const minAnswerProbability = typeof inp.minAnswerProbability === 'number' && Number.isFinite(inp.minAnswerProbability) && inp.minAnswerProbability >= 0 && inp.minAnswerProbability <= 1
    ? inp.minAnswerProbability
    : 0.5;

  const rawChecks = canVerify && Array.isArray(inp.checks) ? inp.checks : [];
  const scoredChecks = rawChecks
    .filter((c) => c && typeof c.s === 'number' && Number.isFinite(c.s) && typeof c.e === 'number' && Number.isFinite(c.e) && c.s > 0 && c.s <= 1 && c.e > 0 && c.e <= 1 && c.s + c.e > 1 && typeof c.cost === 'number' && Number.isFinite(c.cost) && c.cost > 0)
    .map((c) => {
      const expectedVoi = voi(q, c, cfp, cfn);
      const netValue = expectedVoi - c.cost;
      const voiPerCost = expectedVoi / c.cost;
      return {
        id: String(c.id || 'check'),
        s: c.s,
        e: c.e,
        cost: c.cost,
        decisive: c.decisive === true,
        expectedVoi,
        netValue,
        voiPerCost,
      };
    })
    .sort((x, y) => (y.netValue - x.netValue) || (y.voiPerCost - x.voiPerCost) || (x.cost - y.cost));

  const bestCheck = scoredChecks[0] || null;
  const normalizedBestCost = bestCheck ? bestCheck.cost / lossScale : 0;
  let outcome = canVerify ? 'open_tree_hoh' : 'abstain';
  let reason = canVerify ? 'expected_risk_exceeds_direct_act' : 'unverifiable_risk_exceeds_threshold';

  if (needsOperator) {
    outcome = 'ask_operator';
    reason = 'operator_approval_required';
  } else if (bestCheck && bestCheck.netValue > 0) {
    outcome = normalizedBestCost <= cheapCostThreshold ? 'run_one_cheap_check' : 'open_tree_hoh';
    reason = normalizedBestCost <= cheapCostThreshold ? 'positive_net_voi_cheap_check' : 'positive_net_voi_tree_check';
  } else if (normalizedPositiveLoss <= answerLossThreshold && (1 - q) <= answerLossThreshold && q >= Math.max(answerCutoff, minAnswerProbability)) {
    outcome = 'answer_now';
    reason = 'calibrated_loss_below_threshold';
  } else if (!canVerify || q < Math.min(0.25, answerCutoff)) {
    outcome = 'abstain';
    reason = !canVerify ? 'unverifiable_risk_exceeds_threshold' : 'no_positive_voi_check_low_prob';
  }

  return {
    ok: true,
    id,
    outcome,
    reason,
    rawProbability,
    calibratedProbability: q,
    scalerApplied: scalerUsable,
    baseLoss,
    positiveLoss,
    bestCheck,
    scoredChecks,
    expectedVoi: bestCheck ? bestCheck.expectedVoi : 0,
    netValue: bestCheck ? bestCheck.netValue : 0,
    voiPerCost: bestCheck ? bestCheck.voiPerCost : 0,
    permissionGranted: false,
    autoApplied: false,
  };
}

const ROUTE_SPECS = Object.freeze([
  Object.freeze({ route: 'gemini-4-hydrogen', family: 'google', tier: 'T0', tierRank: 0, cost: 1, formal: false, legacy: false }),
  Object.freeze({ route: 'claude-haiku-5-5', family: 'anthropic', tier: 'T0', tierRank: 0, cost: 1.5, formal: false, legacy: false }),
  Object.freeze({ route: 'gemini-4-argon', family: 'google', tier: 'T1', tierRank: 1, cost: 3, formal: false, legacy: false }),
  Object.freeze({ route: 'claude-sonnet-5-5', family: 'anthropic', tier: 'T1', tierRank: 1, cost: 4, formal: false, legacy: false }),
  Object.freeze({ route: 'gemini-4-carbon', family: 'google', tier: 'T2', tierRank: 2, cost: 8, formal: true, legacy: false }),
  Object.freeze({ route: 'claude-opus-5-5', family: 'anthropic', tier: 'T2', tierRank: 2, cost: 10, formal: true, legacy: false }),
  Object.freeze({ route: 'claude-fable-5-2', family: 'anthropic', tier: 'T3', tierRank: 3, cost: 12, formal: true, legacy: false }),
  Object.freeze({ route: 'gemini-3.8-flash', family: 'google', tier: 'T0', tierRank: 0, cost: 0.8, formal: false, legacy: true, year: 2026, legacyReason: '2026 legacy fallback' }),
]);

const TIER_RANK = Object.freeze({ T0: 0, T1: 1, T2: 2, T3: 3 });

/** Pick lowest-cost builder and cross-family checker satisfying capability and R006 isolation. */
export function pairBuilderAndChecker(input = {}) {
  const esc = enforceConsentNonEscalation(input);
  if (!esc.ok) {
    return { ok: false, state: esc.state, rule: 'R009', permissionGranted: false, autoApplied: false, violations: esc.violations };
  }
  if (input.minTier !== undefined && (typeof input.minTier !== 'string' || !Object.hasOwn(TIER_RANK, input.minTier))) {
    return { ok: false, state: 'fail_unknown_tier', tier: input.minTier };
  }
  if (input.minCheckerTier !== undefined && (typeof input.minCheckerTier !== 'string' || !Object.hasOwn(TIER_RANK, input.minCheckerTier))) {
    return { ok: false, state: 'fail_unknown_tier', tier: input.minCheckerTier };
  }
  const minBuilderRank = input.minTier !== undefined ? TIER_RANK[input.minTier] : (input.needsFormal ? 2 : 1);
  const minCheckerRank = input.minCheckerTier !== undefined ? TIER_RANK[input.minCheckerTier] : (input.needsFormal ? 2 : 1);
  const allowLegacy = input.allowLegacy === true;
  const needsFormal = Boolean(input.needsFormal);

  const eligible = (spec, minRank, reqFormal) =>
    spec.tierRank >= minRank && (!reqFormal || spec.formal) && (allowLegacy || !spec.legacy);

  const hasExplicitBuilder = typeof input.builderRoute === 'string' && input.builderRoute.trim().length > 0;
  let builders;
  if (hasExplicitBuilder) {
    const requested = ROUTE_SPECS.find((s) => s.route === input.builderRoute.trim());
    if (!requested) return { ok: false, state: 'fail_unknown_builder_route', route: input.builderRoute };
    if (!eligible(requested, minBuilderRank, needsFormal)) {
      return { ok: false, state: 'fail_builder_capability', route: requested.route };
    }
    builders = [requested];
  } else {
    builders = ROUTE_SPECS.filter((s) => eligible(s, minBuilderRank, needsFormal));
  }
  if (builders.length === 0) return { ok: false, state: 'fail_no_builder' };

  const hasExplicitChecker = typeof input.checkerRoute === 'string' && input.checkerRoute.trim().length > 0;
  let checkers;
  if (hasExplicitChecker) {
    const requested = ROUTE_SPECS.find((s) => s.route === input.checkerRoute.trim());
    if (!requested) return { ok: false, state: 'fail_unknown_checker_route', route: input.checkerRoute };
    if (!eligible(requested, minCheckerRank, needsFormal)) {
      return { ok: false, state: 'fail_checker_capability', route: requested.route };
    }
    checkers = [requested];
  } else {
    checkers = ROUTE_SPECS.filter((s) => eligible(s, minCheckerRank, needsFormal));
  }

  const pairs = [];
  for (const b of builders) {
    for (const c of checkers) {
      if (b.family !== c.family) pairs.push({ builder: b, checker: c, totalCost: b.cost + c.cost });
    }
  }
  pairs.sort((p1, p2) => (p1.totalCost - p2.totalCost) || (p1.builder.cost - p2.builder.cost) || (p1.checker.cost - p2.checker.cost));

  let builder = null;
  let checker = null;
  if (pairs.length > 0) {
    builder = pairs[0].builder;
    checker = pairs[0].checker;
  } else if (hasExplicitBuilder && hasExplicitChecker) {
    builder = builders[0];
    checker = checkers[0];
  } else {
    return { ok: false, state: 'fail_no_cross_family_checker' };
  }

  if (builder.family === checker.family) {
    return {
      ok: false,
      state: 'fail_same_family_verdict',
      rule: 'R006',
      builder,
      checker,
      reason: 'builder and checker must belong to different model families',
      permissionGranted: false,
      autoApplied: false,
    };
  }

  const crossFamilyCheck = checkCrossFamilyVerdict({
    builderFamily: builder.family,
    checkerFamily: checker.family,
    builderId: input.builderId || `builder:${builder.route}`,
    checkerId: input.checkerId || `checker:${checker.route}`,
    verdict: 'paired',
  });
  if (!crossFamilyCheck.ok) {
    return {
      ok: false,
      state: crossFamilyCheck.state,
      rule: crossFamilyCheck.rule,
      builder,
      checker,
      crossFamilyCheck,
      permissionGranted: false,
      autoApplied: false,
    };
  }

  return {
    ok: true,
    state: 'pass',
    builder: { ...builder },
    checker: { ...checker },
    crossFamilyCheck,
    estimatedRelativeCost: builder.cost + checker.cost,
    permissionGranted: false,
    autoApplied: false,
  };
}

export const TAINT_LEVELS = Object.freeze(['clean', 'tool_output', 'untrusted_web', 'secret_risk']);

function resolveKnownRouteSpec(route) {
  if (typeof route !== 'string') return null;
  const trimmed = route.trim();
  if (!trimmed) return null;
  return ROUTE_SPECS.find((s) => s.route === trimmed) || null;
}

function normalizeFamilyName(family) {
  return typeof family === 'string' ? family.trim().toLowerCase() : '';
}

function isVerifiedCrossFamilyPair(pair, opts = {}) {
  if (!pair || typeof pair !== 'object' || Array.isArray(pair)) return false;
  if (pair.ok !== true || pair.crossFamilyCheck?.ok !== true) return false;
  const bSpec = resolveKnownRouteSpec(pair.builder?.route);
  const cSpec = resolveKnownRouteSpec(pair.checker?.route);
  if (!bSpec || !cSpec || bSpec.family === cSpec.family) return false;
  if (normalizeFamilyName(pair.builder?.family) !== bSpec.family) return false;
  if (normalizeFamilyName(pair.checker?.family) !== cSpec.family) return false;
  if (normalizeFamilyName(pair.crossFamilyCheck?.builderFamily) !== bSpec.family) return false;
  if (normalizeFamilyName(pair.crossFamilyCheck?.checkerFamily) !== cSpec.family) return false;
  if (pair.builder?.formal !== undefined && pair.builder.formal !== bSpec.formal) return false;
  if (pair.checker?.formal !== undefined && pair.checker.formal !== cSpec.formal) return false;
  if (pair.builder?.tierRank !== undefined && pair.builder.tierRank !== bSpec.tierRank) return false;
  if (pair.checker?.tierRank !== undefined && pair.checker.tierRank !== cSpec.tierRank) return false;
  const rederived = pairBuilderAndChecker({
    builderRoute: bSpec.route,
    checkerRoute: cSpec.route,
    ...(opts.minTier !== undefined ? { minTier: opts.minTier } : {}),
    ...(opts.minCheckerTier !== undefined ? { minCheckerTier: opts.minCheckerTier } : {}),
    ...(opts.needsFormal !== undefined ? { needsFormal: Boolean(opts.needsFormal) } : {}),
    ...(opts.allowLegacy === true ? { allowLegacy: true } : {}),
    ...(typeof pair.crossFamilyCheck?.builderId === 'string' && pair.crossFamilyCheck.builderId ? { builderId: pair.crossFamilyCheck.builderId } : {}),
    ...(typeof pair.crossFamilyCheck?.checkerId === 'string' && pair.crossFamilyCheck.checkerId ? { checkerId: pair.crossFamilyCheck.checkerId } : {}),
  });
  return rederived.ok === true;
}

/** Least upper bound (supremum) on the information-flow taint lattice; empty or unknown/null entries fail closed to secret_risk. */
export function joinTaint(...levels) {
  if (levels.length === 0) return 'secret_risk';
  let maxRank = 0;
  for (const lvl of levels) {
    if (typeof lvl !== 'string') return 'secret_risk';
    const idx = TAINT_LEVELS.indexOf(lvl.trim());
    if (idx < 0) return 'secret_risk';
    if (idx > maxRank) maxRank = idx;
  }
  return TAINT_LEVELS[maxRank];
}

/** Deterministic exit guard: refuses tainted, secret-risk, operator-gated, or uncited exits. */
export function decideExitAction(input = {}) {
  const esc = enforceConsentNonEscalation(input);
  if (!esc.ok) {
    return { ok: false, action: 'block_escalation', rule: 'R009', effectiveTaint: 'secret_risk', allowExit: false, reason: esc.violations.join('; ') };
  }
  const hasSecret = normalizeFailClosedFlag(input.hasSecret);
  const operatorRequired = normalizeFailClosedFlag(input.needsOperator) || normalizeFailClosedFlag(input.requiresHumanYes);
  const hasScalarTaint = Object.hasOwn(input, 'taint') && input.taint !== undefined;
  const hasTaintsProp = Object.hasOwn(input, 'taints') && input.taints !== undefined;
  const badTaints = hasTaintsProp && !Array.isArray(input.taints);
  const levels = [
    ...(hasScalarTaint ? [input.taint] : []),
    ...(Array.isArray(input.taints) ? input.taints : []),
  ];
  const effectiveTaint = (hasSecret || badTaints) ? 'secret_risk' : joinTaint(...levels);
  const citationCount = Array.isArray(input.citations)
    ? input.citations.filter((c) => typeof c === 'string' && c.trim().length > 0).length
    : 0;
  const checksPassed = input.checksPassed === true;
  const crossFamilyVerified = input.crossFamilyVerified === true;
  const hasPair = input.pair !== undefined && input.pair !== null;
  const pairValid = isVerifiedCrossFamilyPair(input.pair, {
    minTier: input.minTier,
    minCheckerTier: input.minCheckerTier,
    needsFormal: input.needsFormal,
    allowLegacy: input.allowLegacy,
  });

  if (effectiveTaint === 'secret_risk') {
    return { ok: false, action: 'block_secret', effectiveTaint, allowExit: false, reason: 'secret_risk taint blocks exit' };
  }
  if (operatorRequired) {
    return { ok: false, action: 'ask_operator', effectiveTaint, allowExit: false, reason: 'operator approval required (needs_yes)' };
  }
  if (hasPair && !pairValid) {
    return {
      ok: false,
      action: 'block_pairing',
      effectiveTaint,
      allowExit: false,
      reason: (typeof input.pair?.reason === 'string' && input.pair.reason)
        || (typeof input.pair?.state === 'string' && input.pair.state)
        || 'builder/checker pairing failed',
    };
  }
  if (effectiveTaint === 'untrusted_web' && !(crossFamilyVerified && pairValid)) {
    return {
      ok: false,
      action: 'block_tainted',
      effectiveTaint,
      allowExit: false,
      reason: 'untrusted_web requires cross-family verification and valid cross-family pair',
    };
  }
  if (!checksPassed || !(citationCount >= 1)) {
    return { ok: false, action: 'block_unverified', effectiveTaint, allowExit: false, reason: 'exit requires passing checks and >= 1 verified citation' };
  }
  return { ok: true, action: 'emit_decision', effectiveTaint, allowExit: true, reason: 'exit guards satisfied' };
}

/** Build and self-validate a cammut.decision/0 packet with VOI routing and taint-guarded exit control. */
export function emitDecisionPacket(input = {}) {
  const esc = enforceConsentNonEscalation(input);
  if (!esc.ok) {
    return { ok: false, state: esc.state, rule: 'R009', violations: esc.violations, permissionGranted: false };
  }
  const citations = Array.isArray(input.citations)
    ? input.citations.filter((c) => typeof c === 'string' && c.trim().length > 0).map((c) => c.trim())
    : [];
  const hasSecret = normalizeFailClosedFlag(input.hasSecret);
  const needsOperator = normalizeFailClosedFlag(input.needsOperator) || normalizeFailClosedFlag(input.requiresHumanYes);
  const hasPair = input.pair != null;
  const pairValid = hasPair ? isVerifiedCrossFamilyPair(input.pair, {
    minTier: input.minTier,
    minCheckerTier: input.minCheckerTier,
    needsFormal: input.needsFormal,
    allowLegacy: input.allowLegacy,
  }) : true;
  const exitGuard = decideExitAction({
    ...(Object.hasOwn(input, 'taint') ? { taint: input.taint } : {}),
    ...(Object.hasOwn(input, 'taints') ? { taints: input.taints } : {}),
    hasSecret,
    requiresHumanYes: needsOperator,
    needsOperator,
    citations,
    checksPassed: input.checksPassed === true,
    crossFamilyVerified: input.crossFamilyVerified === true,
    pair: input.pair,
    minTier: input.minTier,
    minCheckerTier: input.minCheckerTier,
    needsFormal: input.needsFormal,
    allowLegacy: input.allowLegacy,
  });
  const crossFamilyOk = input.crossFamilyVerified === true && hasPair && pairValid;
  const routing = routeOptimalDecision({ ...input, needsOperator, requiresHumanYes: needsOperator });
  let outcome = routing.ok ? routing.outcome : 'abstain';
  let action = exitGuard.action;
  let allowExit = exitGuard.allowExit;
  let reason = exitGuard.reason;
  if (!allowExit) {
    if (outcome === 'answer_now') {
      outcome = action === 'ask_operator' ? 'ask_operator' : 'abstain';
    }
  } else if (outcome !== 'answer_now') {
    allowExit = false;
    action = outcome === 'ask_operator' ? 'ask_operator' : (outcome === 'abstain' ? 'block_uncertainty' : outcome);
    reason = routing.reason || 'routing outcome requires action before exit';
  }
  const pairOkOut = hasPair && pairValid;
  const route = pairOkOut
    ? (resolveKnownRouteSpec(input.pair.builder.route)?.route || null)
    : (pairValid ? (resolveKnownRouteSpec(input.route)?.route || null) : null);
  const checkerRoute = pairOkOut
    ? (resolveKnownRouteSpec(input.pair.checker.route)?.route || null)
    : (pairValid ? (resolveKnownRouteSpec(input.checkerRoute)?.route || null) : null);
  let packet = {
    schema: 'cammut.decision/0',
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : 'DEC-0001',
    goal: typeof input.goal === 'string' && input.goal.trim() ? input.goal.trim() : 'unspecified',
    action,
    allowExit,
    effectiveTaint: exitGuard.effectiveTaint,
    reason,
    outcome,
    calibratedProbability: routing.ok ? routing.calibratedProbability : clampProb(input.probability ?? 0.5),
    expectedVoi: routing.ok ? routing.expectedVoi : 0,
    netValue: routing.ok ? routing.netValue : 0,
    route,
    checkerRoute,
    requiresHumanYes: needsOperator,
    pairOk: pairOkOut,
    citations,
    checkEvidence: {
      ok: input.checksPassed === true,
      crossFamilyOk,
      summary: typeof input.checkSummary === 'string' ? input.checkSummary.slice(0, 240) : '',
    },
    permissionGranted: false,
    autoApplied: false,
    issuedAt: input.issuedAt || new Date().toISOString(),
  };
  const validation = validateDecisionPacket(packet);
  if (!validation.ok || !pairValid) {
    packet = {
      ...packet,
      allowExit: false,
      action: !pairValid ? 'block_pairing' : 'block_invalid_packet',
      outcome: packet.outcome === 'answer_now' ? 'abstain' : packet.outcome,
      route: pairValid ? packet.route : null,
      checkerRoute: pairValid ? packet.checkerRoute : null,
      pairOk: pairOkOut,
      reason: validation.errors.join('; ') || packet.reason || 'invalid decision packet',
    };
  }
  return { ok: validation.ok && pairValid, packet, exitGuard, routing, validation };
}

/** Validate a cammut.decision/0 packet against schema, R009, taint lattice, and exit invariants. */
export function validateDecisionPacket(packet) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
    return { ok: false, errors: ['decision packet must be an object'] };
  }
  const errors = [];
  if (packet.schema !== 'cammut.decision/0') errors.push('schema must equal cammut.decision/0');
  if (typeof packet.id !== 'string' || !packet.id.trim()) errors.push('id must be a non-empty string');
  if (typeof packet.goal !== 'string' || !packet.goal.trim()) errors.push('goal must be a non-empty string');
  if (typeof packet.action !== 'string' || !packet.action.trim()) errors.push('action must be a non-empty string');
  if (!INTUITION_OUTCOMES.includes(packet.outcome)) errors.push('outcome must be a supported routing outcome');
  if (typeof packet.allowExit !== 'boolean') errors.push('allowExit must be a boolean');
  if (typeof packet.requiresHumanYes !== 'boolean') errors.push('requiresHumanYes must be a boolean');
  if (typeof packet.pairOk !== 'boolean') errors.push('pairOk must be a boolean');
  if (packet.permissionGranted !== false) errors.push('permissionGranted must be false');
  if (packet.autoApplied !== false) errors.push('autoApplied must be false');
  if (!TAINT_LEVELS.includes(packet.effectiveTaint)) errors.push('effectiveTaint must belong to TAINT_LEVELS');
  if (typeof packet.calibratedProbability !== 'number' || !Number.isFinite(packet.calibratedProbability) || packet.calibratedProbability < 0 || packet.calibratedProbability > 1) {
    errors.push('calibratedProbability must lie in [0, 1]');
  }
  if (typeof packet.expectedVoi !== 'number' || !Number.isFinite(packet.expectedVoi)) {
    errors.push('expectedVoi must be a finite number');
  }
  if (typeof packet.netValue !== 'number' || !Number.isFinite(packet.netValue)) {
    errors.push('netValue must be a finite number');
  }
  const validCitations = Array.isArray(packet.citations)
    && packet.citations.every((c) => typeof c === 'string' && c.trim().length > 0);
  if (!validCitations) errors.push('citations must be an array of non-empty strings');
  const esc = enforceConsentNonEscalation(packet);
  if (!esc.ok) errors.push(...esc.violations);

  const bSpec = packet.route != null ? resolveKnownRouteSpec(packet.route) : null;
  const cSpec = packet.checkerRoute != null ? resolveKnownRouteSpec(packet.checkerRoute) : null;
  if (packet.route != null && !bSpec) errors.push('route must match a known model route');
  if (packet.checkerRoute != null && !cSpec) errors.push('checkerRoute must match a known model route');
  if (bSpec && cSpec && bSpec.family === cSpec.family) {
    errors.push('route and checkerRoute must belong to distinct model families');
  }
  if (packet.checkEvidence?.crossFamilyOk === true) {
    if (packet.pairOk !== true || !bSpec || !cSpec || bSpec.family === cSpec.family) {
      errors.push('crossFamilyOk requires pairOk=true and known routes from distinct model families');
    }
  }

  if (typeof packet.allowExit === 'boolean') {
    if ((packet.allowExit === true) !== (packet.action === 'emit_decision')) {
      errors.push('allowExit=true must match action=emit_decision biconditionally');
    }
    if (packet.allowExit === true) {
      if (packet.outcome !== 'answer_now') errors.push('allowExit=true requires outcome=answer_now');
      if (packet.requiresHumanYes !== false) errors.push('allowExit=true requires requiresHumanYes=false');
      if (packet.effectiveTaint === 'secret_risk') errors.push('allowExit=true forbidden under secret_risk');
      if (!validCitations || packet.citations.length < 1) errors.push('allowExit=true requires >= 1 valid citation');
      if (!packet.checkEvidence || packet.checkEvidence.ok !== true) errors.push('allowExit=true requires passing checkEvidence');
      if (packet.effectiveTaint === 'untrusted_web') {
        if (packet.pairOk !== true) errors.push('allowExit=true under untrusted_web requires pairOk=true');
        if (packet.checkEvidence?.crossFamilyOk !== true) {
          errors.push('allowExit=true under untrusted_web requires crossFamilyOk');
        }
        if (!bSpec || !cSpec || bSpec.family === cSpec.family) {
          errors.push('allowExit=true under untrusted_web requires known routes from distinct model families');
        }
      }
      if (packet.pairOk === true && (!bSpec || !cSpec || bSpec.family === cSpec.family)) {
        errors.push('allowExit=true with pairOk=true requires known routes from distinct model families');
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
