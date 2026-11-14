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
  assert.ok(sampled.every((r) => r.propensity === (r.action === 'A' ? 0.9 : 0.1)));

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
