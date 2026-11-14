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
  if (!decision || typeof decision !== 'object') {
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

  let spec = STAGE0_ROLE_TABLE.roles[role];
  if (task.builderFamily && spec.family === task.builderFamily && (kind === 'check' || kind === 'review' || role === 'checker')) {
    role = task.builderFamily === 'anthropic' ? 'builder' : 'checker';
    spec = task.builderFamily === 'anthropic'
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
  if (!(mode in EXPLORATION_SHARES)) {
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
      propensity = picked === base ? (1 - exploreShare) + (exploreShare / k) : exploreShare / k;
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
    propensity: Number(propensity.toFixed(6)),
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
