import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  INTUITION_OUTCOMES,
  routeIntuition,
  recordIntuitionOutcome,
  brierScore,
  calibrationReport,
  STAGE0_ROLE_TABLE,
  EXPLORATION_SHARES,
  routeTaskStage0,
  logPropensityDecision,
  evaluatePolicyIPS,
  enforceConsentNonEscalation,
  parseModelsTsv,
  checkTrainingManifest,
  fitPlattScaler,
  applyPlattScaler,
  crossFitPlatt2Fold,
  brierSkillScore,
  routeOptimalDecision,
  pairBuilderAndChecker,
  TAINT_LEVELS,
  joinTaint,
  decideExitAction,
  emitDecisionPacket,
  validateDecisionPacket,
} from '../lib/intuition.js';

const MODELS_TSV_PATH = process.env.ARC_MODELS_TSV || path.join(os.homedir(), 'arc-harness', 'shared', 'models.tsv');

test('existing System One intuition router and Brier calibration stay intact', () => {
  assert.equal(INTUITION_OUTCOMES.length, 5);
  const g1 = routeIntuition({ id: 'g1', priorProbability: 0.9, uncertainty: 0.1, cheapCheckAvailable: false });
  assert.equal(g1.outcome, 'answer_now');
  assert.equal(g1.permissionGranted, false);
  const badPerm = routeIntuition({ grantPermission: true });
  assert.equal(badPerm.ok, false);
  assert.equal(badPerm.rule, 'R009');
  const recs = recordIntuitionOutcome([g1], 'g1', 1);
  assert.equal(Number(brierScore(recs).toFixed(4)), 0.01);
  assert.equal(calibrationReport(recs).calibrated, true);
});

test('G8.2 Stage-0 role router classifies 20 tasks deterministically with zero escalation', () => {
  const tasks = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `l-${i}`, kind: 'lookup' })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `b-${i}`, kind: 'build' })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `p-${i}`, kind: 'plan' })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `f-${i}`, kind: 'lean' })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `c-${i}`, kind: 'check', builderFamily: 'google' })),
  ];
  assert.equal(tasks.length, 20);
  const routes = tasks.map((t) => routeTaskStage0(t));
  assert.ok(routes.every((r) => r.ok && r.permissionGranted === false && r.autoApplied === false));
  assert.equal(routes[0].route, STAGE0_ROLE_TABLE.T0.primary);
  assert.equal(routes[5].route, STAGE0_ROLE_TABLE.T1.primary);
  assert.equal(routes[10].route, STAGE0_ROLE_TABLE.T2.primary);
  assert.equal(routes[14].route, STAGE0_ROLE_TABLE.T3.primary);
  assert.equal(routes[17].family, 'anthropic');

  const refused = routeTaskStage0({ id: 'bad', kind: 'build', grantPermission: true });
  assert.equal(refused.ok, false);
  assert.equal(refused.state, 'fail_r009_escalation');

  const mixedCaseCheck = routeTaskStage0({ id: 'c-case', kind: 'check', builderFamily: 'Anthropic' });
  assert.equal(mixedCaseCheck.ok, true);
  assert.equal(mixedCaseCheck.family, 'google');
});

test('G8.3 propensity logger enforces 0.2 cheap, 0.05 failed_check, and 0 stop shares', () => {
  assert.deepEqual(EXPLORATION_SHARES, { cheap: 0.2, failed_check: 0.05, stop: 0, safety: 0 });
  const cheap = logPropensityDecision({ contextId: 'c1', candidates: ['T0', 'T1'], baselineAction: 'T0', chosenAction: 'T1', loggingPropensity: 0.1, mode: 'cheap' });
  assert.equal(cheap.ok, true);
  assert.equal(cheap.exploring, true);
  assert.ok(Math.abs(cheap.propensity - 0.1) < 1e-6);

  const missingProp = logPropensityDecision({ contextId: 'c1b', candidates: ['T0', 'T1'], baselineAction: 'T0', chosenAction: 'T1', mode: 'cheap' });
  assert.equal(missingProp.state, 'fail_missing_propensity');

  const sampled = Array.from({ length: 1000 }, (_, i) => logPropensityDecision({ contextId: `s-${i}`, candidates: ['A', 'B'], baselineAction: 'A', seed: i + 1, mode: 'cheap' }));
  const bRate = sampled.filter((r) => r.action === 'B').length / sampled.length;
  assert.ok(bRate > 0.05 && bRate < 0.16, `expected ~0.10 exploration rate, got ${bRate}`);
  assert.ok(sampled.every((r) => Math.abs(r.propensity - (r.action === 'A' ? 0.9 : 0.1)) < 1e-9));

  const dupSampled = Array.from({ length: 300 }, (_, i) => logPropensityDecision({ contextId: `d-${i}`, candidates: ['A', 'B', 'B'], baselineAction: 'A', seed: i + 1, mode: 'cheap' }));
  assert.ok(dupSampled.some((r) => r.action === 'B'));
  assert.ok(dupSampled.filter((r) => r.action === 'B').every((r) => Math.abs(r.propensity - (0.2 * 2) / 3) < 1e-9));

  const tiny = logPropensityDecision({ contextId: 'tiny', candidates: ['T0', 'T1'], baselineAction: 'T0', chosenAction: 'T1', loggingPropensity: 1e-7, mode: 'cheap' });
  assert.equal(tiny.ok, true);
  assert.equal(tiny.propensity, 1e-7);

  const protoMode = logPropensityDecision({ candidates: ['T0'], mode: '__proto__' });
  assert.equal(protoMode.state, 'fail_unknown_mode');

  const failed = logPropensityDecision({ contextId: 'c2', candidates: ['T0', 'T1'], baselineAction: 'T0', chosenAction: 'T1', loggingPropensity: 0.025, mode: 'failed_check' });
  assert.ok(Math.abs(failed.propensity - 0.025) < 1e-6);

  const stopped = logPropensityDecision({ contextId: 'c3', candidates: ['T0', 'T1'], baselineAction: 'T0', chosenAction: 'T1', mode: 'stop' });
  assert.equal(stopped.action, 'T0');
  assert.equal(stopped.exploring, false);
  assert.equal(stopped.propensity, 1.0);

  const badMode = logPropensityDecision({ candidates: ['T0'], mode: 'reckless' });
  assert.equal(badMode.state, 'fail_unknown_mode');
  const protoRole = routeTaskStage0({ id: 't-proto', role: 'constructor' });
  assert.equal(protoRole.role, 'builder');
  assert.equal(typeof protoRole.route, 'string');
});

test('G8.4-G8.6 IPS evaluator enforces 200-row & 10-try floors, paired bootstrap, Holm alpha, and token caps', () => {
  const mkRows = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

  const tooFew = evaluatePolicyIPS(mkRows(199, (i) => ({ action: i % 2 ? 'A' : 'B', propensity: 0.5, reward: 1 })), () => 'A');
  assert.equal(tooFew.state, 'blocked_rows');
  assert.equal(tooFew.reason, 'row_floor_unmet');

  const rareAction = evaluatePolicyIPS(
    mkRows(205, (i) => ({ action: i < 5 ? 'RARE' : 'A', propensity: 0.5, reward: 1 })),
    () => 'A',
  );
  assert.equal(rareAction.state, 'blocked_rows');
  assert.equal(rareAction.reason, 'action_floor_unmet');

  const strongRows = mkRows(240, (i) => {
    const action = i % 3 === 0 ? 'B' : 'A';
    const propensity = action === 'A' ? 0.667 : 0.333;
    const reward = action === 'B' ? 0.92 : 0.45;
    return { action, propensity, reward, baselineReward: 0.48, candidateTokens: 1200 };
  });

  const win = evaluatePolicyIPS(strongRows, () => 'B', { maxMeanTokens: 2000, stepIndex: 1 });
  assert.equal(win.state, 'pass');
  assert.ok(win.ci[0] > 0);
  assert.equal(win.autoApplied, false);

  const overCap = evaluatePolicyIPS(strongRows, () => 'B', { maxMeanTokens: 800 });
  assert.equal(overCap.state, 'fail_token_cap');

  const rareCand = evaluatePolicyIPS(
    mkRows(210, (i) => ({ action: i % 2 ? 'B' : 'A', propensity: 0.5, reward: 1 })),
    (r) => (r.action === 'B' ? 'B' : 'UNSEEN'),
  );
  assert.equal(rareCand.state, 'blocked_rows');
  assert.equal(rareCand.reason, 'candidate_action_floor_unmet');

  const weightedRows = mkRows(210, (i) => ({
    action: i % 2 ? 'B' : 'A',
    propensity: 0.5,
    reward: i % 2 ? 0.9 : 0.4,
    baselineReward: 0.4,
    candidateTokens: i % 2 ? 1500 : 100,
  }));
  assert.equal(evaluatePolicyIPS(weightedRows, () => 'B', { maxMeanTokens: 1000 }).state, 'fail_token_cap');

  const holmStrict = evaluatePolicyIPS(strongRows, () => 'B', { totalTests: 5, rank: 1, alpha: 0.05 });
  assert.equal(holmStrict.adjustedAlpha, 0.01);

  const flatRows = mkRows(240, (i) => ({
    action: i % 2 ? 'B' : 'A',
    propensity: 0.5,
    reward: 0.5,
    baselineReward: 0.5,
    candidateTokens: 500,
  }));
  const noGain = evaluatePolicyIPS(flatRows, () => 'B');
  assert.equal(noGain.state, 'fail_no_gain');
});

test('G8.7 R009 non-escalation guard blocks minted consent tokens and privilege flags', () => {
  assert.equal(enforceConsentNonEscalation({ route: 'T0', permissionGranted: false }).ok, true);
  assert.equal(enforceConsentNonEscalation({ route: 'T0', consentToken: 'abc-token' }).state, 'fail_r009_escalation');
  assert.equal(enforceConsentNonEscalation({ route: 'T0', bypassGate: true }).rule, 'R009');
  assert.equal(enforceConsentNonEscalation({ spendCapUsd: 25 }).state, 'fail_r009_escalation');
  assert.equal(enforceConsentNonEscalation({ spendCapUsd: 1000000, spendApproved: true }).state, 'fail_r009_escalation');
});

test('G8.1 & G8.8 training manifest checks models.tsv registry and rejects private sources on public bases', () => {
  const known = fs.existsSync(MODELS_TSV_PATH)
    ? parseModelsTsv(fs.readFileSync(MODELS_TSV_PATH, 'utf8'))
    : parseModelsTsv('RuModernBERT\tRuModernBERT-small\t2025\tapache-2.0\tcurrent\nQwen3-Reranker\tQwen3-Reranker-4B\t2025-06\tapache-2.0\tlegacy');

  const goodManifest = {
    student_public: true,
    base_model: 'RuModernBERT-small',
    base_private: false,
    teacher_model: 'Qwen3-Reranker-4B',
    teacher_private: false,
    data: [{ name: 'rubq_public', private: false }],
  };
  assert.equal(checkTrainingManifest(goodManifest, known).state, 'pass');

  const unknownModel = { ...goodManifest, teacher_model: 'MadeUp-Model-99B' };
  assert.equal(checkTrainingManifest(unknownModel, known).state, 'fail_unknown_model');

  const leakyManifest = {
    ...goodManifest,
    data: [{ name: 'bank_notes', private: true }],
  };
  assert.equal(checkTrainingManifest(leakyManifest, known).state, 'fail_private_manifest');
  assert.equal(checkTrainingManifest({ ...goodManifest, data: 'invalid' }, known).state, 'fail_private_manifest');
  assert.equal(checkTrainingManifest({ ...goodManifest, data: [] }, known).state, 'fail_private_manifest');
});

test('2-fold stratified Platt calibration and Brier Skill Score improve overconfident forecasts', () => {
  const overconfident = [
    { probability: 0.95, actual: 1 },
    { probability: 0.95, actual: 1 },
    { probability: 0.95, actual: 1 },
    { probability: 0.95, actual: 0 },
    { probability: 0.95, actual: 0 },
    { probability: 0.95, actual: 0 },
    { probability: 0.15, actual: 0 },
    { probability: 0.15, actual: 0 },
    { probability: 0.15, actual: 0 },
    { probability: 0.15, actual: 1 },
    { probability: 0.15, actual: 1 },
    { probability: 0.15, actual: 1 },
  ];
  const emptyScaler = fitPlattScaler([], { l2: 0.25 });
  assert.equal(emptyScaler.l2, 0.25);

  const inverted = [
    { probability: 0.9, actual: 0 },
    { probability: 0.9, actual: 0 },
    { probability: 0.1, actual: 1 },
    { probability: 0.1, actual: 1 },
  ];
  assert.equal(fitPlattScaler(inverted).a, 1);

  const scaler = fitPlattScaler(overconfident);
  assert.ok(scaler.count === 12 && scaler.a < 1 && scaler.a > 0);
  const adjusted = applyPlattScaler(0.95, scaler);
  assert.ok(adjusted < 0.95 && adjusted > 0.4);

  const cv = crossFitPlatt2Fold(overconfident);
  assert.equal(cv.ok, true);
  assert.equal(cv.allConverged, true);
  assert.equal(cv.predictions.length, 12);
  assert.ok(cv.oofBrier < cv.rawBrier - 0.05, `expected clear oofBrier (${cv.oofBrier}) improvement over rawBrier (${cv.rawBrier})`);
  assert.ok(brierSkillScore([{ probability: 0.9, actual: 1 }, { probability: 0.1, actual: 0 }]) > 0.9);
  assert.equal(brierSkillScore([{ probability: 0.5, actual: 1 }]), null);
  assert.equal(crossFitPlatt2Fold([{ probability: 0.9, actual: 1 }, { probability: 0.1, actual: 0 }]).oofBrier, null);
});

test('routeOptimalDecision maximizes net VOI, respects asymmetric loss, and blocks checks when canVerify=false', () => {
  const highUnc = routeOptimalDecision({
    id: 'd-voi',
    probability: 0.55,
    checks: [
      { id: 'slow', s: 0.9, e: 0.9, cost: 0.25 },
      { id: 'fast', s: 0.9, e: 0.9, cost: 0.05 },
      { id: 'tiny-high-ratio', s: 0.55, e: 0.55, cost: 0.001 },
    ],
  });
  assert.equal(highUnc.ok, true);
  assert.equal(highUnc.outcome, 'run_one_cheap_check');
  assert.equal(highUnc.bestCheck.id, 'fast');
  assert.ok(highUnc.netValue > 0.2);

  const sure = routeOptimalDecision({ id: 'd-sure', probability: 0.95, checks: [{ id: 'pricey', s: 0.8, e: 0.8, cost: 0.4 }] });
  assert.equal(sure.outcome, 'answer_now');

  const asym = routeOptimalDecision({ id: 'd-asym', probability: 0.6, cfp: 1, cfn: 0.1 });
  assert.notEqual(asym.outcome, 'answer_now');

  const noVerify = routeOptimalDecision({ id: 'd-noverify', probability: 0.6, canVerify: false, checks: [{ id: 'fast', s: 0.9, e: 0.9, cost: 0.05 }] });
  assert.equal(noVerify.bestCheck, null);
  assert.equal(noVerify.outcome, 'abstain');

  const blocked = routeOptimalDecision({ grantPermission: true, probability: 0.95 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.rule, 'R009');

  assert.equal(routeOptimalDecision({ probability: 0.95, requiresHumanYes: true }).outcome, 'ask_operator');
  assert.equal(routeOptimalDecision({ probability: 0.95, needsOperator: 'true' }).outcome, 'ask_operator');

  const tinyPlatt = fitPlattScaler([{ probability: 0.5, actual: 1 }, { probability: 0.5, actual: 0 }]);
  assert.equal(tinyPlatt.usable, false);
  const ignoredTiny = routeOptimalDecision({ probability: 0.5, plattScaler: { ...tinyPlatt, b: 2.5, converged: true } });
  assert.equal(ignoredTiny.scalerApplied, false);
  assert.equal(ignoredTiny.calibratedProbability, 0.5);
  assert.notEqual(ignoredTiny.outcome, 'answer_now');

  const overconfident12 = [
    { probability: 0.95, actual: 1 },
    { probability: 0.95, actual: 1 },
    { probability: 0.95, actual: 1 },
    { probability: 0.95, actual: 0 },
    { probability: 0.95, actual: 0 },
    { probability: 0.95, actual: 0 },
    { probability: 0.15, actual: 0 },
    { probability: 0.15, actual: 0 },
    { probability: 0.15, actual: 0 },
    { probability: 0.15, actual: 1 },
    { probability: 0.15, actual: 1 },
    { probability: 0.15, actual: 1 },
  ];
  const overconfident24 = [...overconfident12, ...overconfident12];
  const wellCalibrated24 = Array.from({ length: 24 }, (_, idx) => {
    if (idx < 12) return { probability: 0.75, actual: idx < 9 ? 1 : 0 };
    return { probability: 0.25, actual: idx < 21 ? 0 : 1 };
  });
  const weakCv = crossFitPlatt2Fold(wellCalibrated24);
  assert.equal(weakCv.improvesOof, false);
  assert.equal(weakCv.usable, false);
  assert.equal(weakCv.scaler.usable, false);
  assert.equal(routeOptimalDecision({ probability: 0.95, plattScaler: weakCv.scaler }).scalerApplied, false);

  const largeCv = crossFitPlatt2Fold(overconfident24);
  assert.equal(largeCv.improvesOof, true);
  assert.equal(largeCv.usable, true);
  assert.equal(largeCv.scaler.usable, true);
  const usedLarge = routeOptimalDecision({ probability: 0.95, plattScaler: largeCv.scaler });
  assert.equal(usedLarge.scalerApplied, true);

  // Uniform scaling of (cfp, cfn, check.cost) preserves routing and asymmetric weights cannot bypass the probability floor.
  assert.notEqual(routeOptimalDecision({ id: 'coin-small', probability: 0.5, cfp: 0.1, cfn: 0.1 }).outcome, 'answer_now');
  assert.equal(routeOptimalDecision({ id: 'sure-large', probability: 0.95, cfp: 10, cfn: 10 }).outcome, 'answer_now');
  assert.notEqual(routeOptimalDecision({ id: 'asym-low-q', probability: 0.05, cfp: 1, cfn: 20 }).outcome, 'answer_now');
  assert.notEqual(routeOptimalDecision({ id: 'asym-mid-q', probability: 0.6, cfp: 1, cfn: 20 }).outcome, 'answer_now');
  assert.equal(routeOptimalDecision({ id: 'asym-below-cutoff', probability: 0.04, cfp: 1, cfn: 20 }).outcome, 'abstain');
  assert.equal(routeOptimalDecision({
    id: 'cheap-unit',
    probability: 0.55,
    cfp: 1,
    cfn: 1,
    checks: [{ id: 'c', s: 0.9, e: 0.9, cost: 0.1 }],
  }).outcome, 'run_one_cheap_check');
  assert.equal(routeOptimalDecision({
    id: 'cheap-scaled',
    probability: 0.55,
    cfp: 10,
    cfn: 10,
    checks: [{ id: 'c', s: 0.9, e: 0.9, cost: 1.0 }],
  }).outcome, 'run_one_cheap_check');
});

test('pairBuilderAndChecker enforces cross-family pairing, strict tiers/capabilities, and R006 failures', () => {
  const t1 = pairBuilderAndChecker({ minTier: 'T1' });
  assert.equal(t1.ok, true);
  assert.equal(t1.builder.route, 'gemini-4-argon');
  assert.equal(t1.checker.route, 'claude-sonnet-5-5');

  const formal = pairBuilderAndChecker({ needsFormal: true, minTier: 'T3' });
  assert.equal(formal.ok, true);
  assert.equal(formal.builder.route, 'claude-fable-5-2');
  assert.equal(formal.checker.route, 'gemini-4-carbon');

  const checkerOnly = pairBuilderAndChecker({ checkerRoute: 'gemini-4-carbon' });
  assert.equal(checkerOnly.ok, true);
  assert.equal(checkerOnly.builder.route, 'claude-sonnet-5-5');
  assert.equal(checkerOnly.checker.route, 'gemini-4-carbon');

  const jointMin = pairBuilderAndChecker({ minTier: 'T1', minCheckerTier: 'T2' });
  assert.equal(jointMin.ok, true);
  assert.equal(jointMin.builder.route, 'claude-sonnet-5-5');
  assert.equal(jointMin.checker.route, 'gemini-4-carbon');
  assert.equal(jointMin.estimatedRelativeCost, 12);

  assert.equal(pairBuilderAndChecker({ needsFormal: true, minTier: 'T3', minCheckerTier: 'T3' }).state, 'fail_no_cross_family_checker');
  assert.equal(pairBuilderAndChecker({ builderRoute: 'gemini-4-carbon', checkerRoute: 'claude-haiku-5-5', needsFormal: true }).state, 'fail_checker_capability');
  assert.equal(pairBuilderAndChecker({ minTier: 't3' }).state, 'fail_unknown_tier');

  const sameFamily = pairBuilderAndChecker({ builderRoute: 'claude-sonnet-5-5', checkerRoute: 'claude-opus-5-5', verdict: 'planned' });
  assert.equal(sameFamily.ok, false);
  assert.equal(sameFamily.state, 'fail_same_family_verdict');

  const selfReview = pairBuilderAndChecker({ builderRoute: 'claude-sonnet-5-5', checkerRoute: 'gemini-4-argon', builderId: 'a1', checkerId: 'a1' });
  assert.equal(selfReview.ok, false);
  assert.equal(selfReview.state, 'fail_self_review');
});

test('taint lattice, exit guard, and cammut.decision/0 packet enforce strict fail-closed invariants', () => {
  assert.deepEqual(TAINT_LEVELS, ['clean', 'tool_output', 'untrusted_web', 'secret_risk']);
  assert.equal(joinTaint('clean', 'tool_output'), 'tool_output');
  assert.equal(joinTaint('tool_output', 'untrusted_web'), 'untrusted_web');
  assert.equal(joinTaint('clean', 'unknown_source'), 'secret_risk');
  assert.equal(joinTaint('clean', null), 'secret_risk');
  assert.equal(joinTaint(), 'secret_risk');

  const okRes = emitDecisionPacket({
    id: 'DEC-100',
    goal: 'verify-patch',
    probability: 0.9,
    taint: 'tool_output',
    citations: ['file:plugins/arc-hoh/lib/intuition.js'],
    checksPassed: true,
    crossFamilyVerified: true,
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.packet.schema, 'cammut.decision/0');
  assert.equal(okRes.packet.allowExit, true);
  assert.equal(okRes.packet.action, 'emit_decision');

  const secretJoin = decideExitAction({ taint: 'secret_risk', taints: ['clean'], citations: ['file:ok.js'], checksPassed: true });
  assert.equal(secretJoin.effectiveTaint, 'secret_risk');
  assert.equal(secretJoin.allowExit, false);

  const webEmptyArray = decideExitAction({ taint: 'untrusted_web', taints: [], citations: ['url:a'], checksPassed: true, crossFamilyVerified: false });
  assert.equal(webEmptyArray.effectiveTaint, 'untrusted_web');
  assert.equal(webEmptyArray.action, 'block_tainted');

  assert.equal(decideExitAction({ citations: ['file:ok.js'], checksPassed: true }).effectiveTaint, 'secret_risk');
  assert.equal(decideExitAction({ taint: 'clean', citations: [''], checksPassed: true }).action, 'block_unverified');

  const secretRes = emitDecisionPacket({
    id: 'DEC-101',
    goal: 'leak-check',
    taints: ['clean', 'secret_risk'],
    citations: ['file:ok.js'],
    checksPassed: true,
  });
  assert.equal(secretRes.ok, true);
  assert.equal(secretRes.packet.allowExit, false);
  assert.equal(secretRes.packet.action, 'block_secret');

  const pairAlone = emitDecisionPacket({
    id: 'DEC-102',
    goal: 'web-no-verify',
    probability: 0.9,
    taint: 'untrusted_web',
    citations: ['url:a'],
    checksPassed: true,
    pair: pairBuilderAndChecker({ minTier: 'T1' }),
  });
  assert.equal(pairAlone.packet.allowExit, false);
  assert.equal(pairAlone.packet.action, 'block_tainted');

  const opGated = emitDecisionPacket({
    id: 'DEC-103',
    goal: 'needs-op',
    probability: 0.95,
    taint: 'clean',
    citations: ['file:ok.js'],
    checksPassed: true,
    needsOperator: true,
  });
  assert.equal(opGated.packet.allowExit, false);
  assert.equal(opGated.packet.action, 'ask_operator');
  assert.equal(opGated.packet.outcome, 'ask_operator');

  assert.equal(validateDecisionPacket({ ...okRes.packet, effectiveTaint: 'secret_risk', allowExit: true }).ok, false);
  assert.equal(validateDecisionPacket({ ...okRes.packet, allowExit: 'true' }).ok, false);
  assert.equal(validateDecisionPacket({ ...okRes.packet, allowExit: false }).ok, false);
  assert.equal(validateDecisionPacket({ ...okRes.packet, citations: [''] }).ok, false);
  assert.equal(validateDecisionPacket({ ...okRes.packet, permissionGranted: true }).ok, false);
  assert.equal(validateDecisionPacket({ ...okRes.packet, outcome: 'bogus_outcome' }).ok, false);
  assert.equal(validateDecisionPacket({ ...okRes.packet, netValue: Number.NaN }).ok, false);
  assert.equal(validateDecisionPacket({ ...okRes.packet, outcome: 'ask_operator' }).ok, false);

  assert.equal(decideExitAction({ taint: 'clean', taints: 'untrusted_web', citations: ['file:ok.js'], checksPassed: true }).effectiveTaint, 'secret_risk');
  assert.equal(decideExitAction({ taint: 'clean', hasSecret: 1, citations: ['file:ok.js'], checksPassed: true }).action, 'block_secret');
  assert.equal(decideExitAction({ taint: 'clean', needsOperator: 'true', citations: ['file:ok.js'], checksPassed: true }).action, 'ask_operator');
  assert.equal(decideExitAction({ taint: 'clean', pair: {}, citations: ['file:ok.js'], checksPassed: true }).action, 'block_pairing');

  const badPairPkt = emitDecisionPacket({
    id: 'DEC-104',
    goal: 'malformed-pair',
    probability: 0.95,
    taint: 'clean',
    citations: ['file:ok.js'],
    checksPassed: true,
    pair: {},
  });
  assert.equal(badPairPkt.ok, false);
  assert.equal(badPairPkt.packet.allowExit, false);
  assert.equal(badPairPkt.packet.action, 'block_pairing');

  const nonAnswerDeferred = emitDecisionPacket({
    id: 'DEC-105',
    goal: 'defer-check',
    probability: 0.6,
    checks: [{ id: 'c1', s: 0.9, e: 0.9, cost: 0.05 }],
    taint: 'clean',
    citations: ['file:ok.js'],
    checksPassed: true,
  });
  assert.equal(nonAnswerDeferred.ok, true);
  assert.equal(nonAnswerDeferred.packet.allowExit, false);
  assert.equal(nonAnswerDeferred.packet.outcome, 'run_one_cheap_check');
  assert.equal(nonAnswerDeferred.packet.action, 'run_one_cheap_check');

  const webWithPair = emitDecisionPacket({
    id: 'DEC-106',
    goal: 'web-verified',
    probability: 0.95,
    taint: 'untrusted_web',
    citations: ['url:a'],
    checksPassed: true,
    crossFamilyVerified: true,
    pair: pairBuilderAndChecker({ minTier: 'T1' }),
  });
  assert.equal(webWithPair.ok, true);
  assert.equal(webWithPair.packet.allowExit, true);
  assert.equal(webWithPair.packet.checkEvidence.crossFamilyOk, true);

  const webNoPair = emitDecisionPacket({
    id: 'DEC-107',
    goal: 'web-missing-pair',
    probability: 0.95,
    taint: 'untrusted_web',
    citations: ['url:a'],
    checksPassed: true,
    crossFamilyVerified: true,
  });
  assert.equal(webNoPair.ok, true);
  assert.equal(webNoPair.packet.allowExit, false);
  assert.equal(webNoPair.packet.action, 'block_tainted');

  const webForgedSameFam = emitDecisionPacket({
    id: 'DEC-108',
    goal: 'web-forged-pair',
    probability: 0.95,
    taint: 'untrusted_web',
    citations: ['url:a'],
    checksPassed: true,
    crossFamilyVerified: true,
    pair: {
      ok: true,
      crossFamilyCheck: { ok: true },
      builder: { family: 'google', route: 'gemini-4-argon' },
      checker: { family: 'google', route: 'gemini-4-carbon' },
    },
  });
  assert.equal(webForgedSameFam.ok, false);
  assert.equal(webForgedSameFam.packet.allowExit, false);
  assert.equal(webForgedSameFam.packet.action, 'block_pairing');

  assert.equal(validateDecisionPacket({ ...webWithPair.packet, requiresHumanYes: undefined }).ok, false);
  assert.equal(validateDecisionPacket({ ...webWithPair.packet, pairOk: undefined }).ok, false);
  assert.equal(validateDecisionPacket({ ...webWithPair.packet, requiresHumanYes: true }).ok, false);
  assert.equal(validateDecisionPacket({ ...webWithPair.packet, pairOk: false }).ok, false);
  assert.equal(validateDecisionPacket({ ...webWithPair.packet, checkerRoute: webWithPair.packet.route }).ok, false);

  // Mislabeled family tags on real same-family routes must fail closed, including case/whitespace variants.
  const spoofedFam = emitDecisionPacket({
    id: 'DEC-109',
    goal: 'web-spoofed-family-label',
    probability: 0.95,
    taint: 'untrusted_web',
    citations: ['url:a'],
    checksPassed: true,
    crossFamilyVerified: true,
    pair: {
      ok: true,
      crossFamilyCheck: { ok: true, builderFamily: 'a', checkerFamily: 'b' },
      builder: { family: 'a', route: 'claude-opus-5-5' },
      checker: { family: 'b', route: 'claude-fable-5-2' },
    },
  });
  assert.equal(spoofedFam.ok, false);
  assert.equal(spoofedFam.packet.allowExit, false);
  assert.equal(spoofedFam.packet.action, 'block_pairing');
  assert.equal(spoofedFam.packet.outcome, 'abstain');

  // Mutating returned pair objects must not corrupt future ROUTE_SPECS lookups.
  const cleanPair = pairBuilderAndChecker({ minTier: 'T1' });
  cleanPair.checker.family = 'mutated';
  const freshPair = pairBuilderAndChecker({ minTier: 'T1' });
  assert.equal(freshPair.ok, true);
  assert.equal(freshPair.checker.family, 'anthropic');

  // Forged T0/legacy or non-formal pairs must be rejected by both decideExitAction and emitDecisionPacket.
  const forgedLegacyPair = {
    ok: true,
    crossFamilyCheck: { ok: true, builderFamily: 'anthropic', checkerFamily: 'google' },
    builder: { route: 'claude-haiku-5-5', family: 'anthropic', tierRank: 0, formal: false },
    checker: { route: 'gemini-3.8-flash', family: 'google', tierRank: 0, formal: false },
  };
  assert.equal(decideExitAction({
    taint: 'untrusted_web',
    citations: ['url:a'],
    checksPassed: true,
    crossFamilyVerified: true,
    pair: forgedLegacyPair,
  }).action, 'block_pairing');
  const legacyRes = emitDecisionPacket({
    id: 'DEC-110',
    goal: 'web-legacy-forged',
    probability: 0.95,
    taint: 'untrusted_web',
    citations: ['url:a'],
    checksPassed: true,
    crossFamilyVerified: true,
    pair: forgedLegacyPair,
  });
  assert.equal(legacyRes.ok, false);
  assert.equal(legacyRes.packet.allowExit, false);
  assert.equal(legacyRes.packet.action, 'block_pairing');

  const nonFormalRes = emitDecisionPacket({
    id: 'DEC-111',
    goal: 'web-nonformal-pair',
    probability: 0.95,
    needsFormal: true,
    taint: 'untrusted_web',
    citations: ['url:a'],
    checksPassed: true,
    crossFamilyVerified: true,
    pair: pairBuilderAndChecker({ minTier: 'T1' }),
  });
  assert.equal(nonFormalRes.ok, false);
  assert.equal(nonFormalRes.packet.allowExit, false);
  assert.equal(nonFormalRes.packet.action, 'block_pairing');
});
