// Headless Arc benchmark runner (Slice B2, roadmap 5.0):
// Runs benchmark tasks under a fixed token/cost budget, computes task pass rate and Brier calibration score.
// Usage:
//   node tools/bench-runner.mjs
//   node tools/bench-runner.mjs --self-test
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { routeIntuition, brierScore, calibrationReport } from '../plugins/arc-hoh/lib/intuition.js';
import { evaluateShelfRecallAt5, SHELF_BENCH_QUESTIONS } from '../plugins/arc-core/lib/shelf.js';
import { resolveToolpackSignal, SIGNAL_BENCH_PROMPTS } from '../plugins/arc-core/lib/workshop.js';

export const DEFAULT_BENCH_TASKS = Object.freeze([
  { id: 'task-1', prompt: 'Verify PDB 1MEL contact count in ChimeraX', cost: 2, priorProbability: 0.9, uncertainty: 0.1, actual: 1 },
  { id: 'task-2', prompt: 'Check OpenSCAD enclosure STEP tolerance', cost: 3, priorProbability: 0.8, uncertainty: 0.2, cheapCheckAvailable: true, actual: 1 },
  { id: 'task-3', prompt: 'Evaluate multi-branch hypothesis tree for off-target binding', cost: 5, priorProbability: 0.55, uncertainty: 0.6, actual: 1 },
  { id: 'task-4', prompt: 'Unverified speculative claim without source', cost: 2, priorProbability: 0.15, uncertainty: 0.8, canVerify: false, actual: 0 },
  { id: 'task-5', prompt: 'Deploy VPS memory server with host key check', cost: 3, priorProbability: 0.85, uncertainty: 0.15, needsOperator: true, actual: 1 },
]);

export function runBenchSuite({ tasks = DEFAULT_BENCH_TASKS, budgetLimit = 20 } = {}) {
  let spent = 0;
  const predictions = [];
  const taskResults = [];

  for (const t of tasks) {
    if (spent + t.cost > budgetLimit) {
      taskResults.push({ id: t.id, status: 'skipped-budget', cost: 0 });
      continue;
    }
    spent += t.cost;
    const routed = routeIntuition(t);
    predictions.push({ id: t.id, probability: routed.probability, actual: t.actual });
    taskResults.push({
      id: t.id,
      status: 'completed',
      cost: t.cost,
      outcome: routed.outcome,
      probability: routed.probability,
      actual: t.actual,
    });
  }

  const shelfBench = evaluateShelfRecallAt5(SHELF_BENCH_QUESTIONS);
  let signalHits = 0;
  for (const item of SIGNAL_BENCH_PROMPTS) {
    const res = resolveToolpackSignal(item.prompt);
    if (res && res.pack === item.expectedPack) signalHits++;
  }
  const signalAccuracy = SIGNAL_BENCH_PROMPTS.length > 0 ? signalHits / SIGNAL_BENCH_PROMPTS.length : 0;
  const cal = calibrationReport(predictions);

  return {
    ok: true,
    budgetLimit,
    budgetSpent: spent,
    completedCount: taskResults.filter((r) => r.status === 'completed').length,
    brier: brierScore(predictions),
    calibrated: cal.calibrated,
    shelfRecallAt5: shelfBench.recallAt5,
    signalAccuracy,
    taskResults,
  };
}

function runSelfTest() {
  const res = runBenchSuite({ budgetLimit: 20 });
  assert.equal(res.ok, true);
  assert.equal(res.completedCount, 5);
  assert.ok(res.budgetSpent <= 20);
  assert.ok(typeof res.brier === 'number' && res.brier < 0.15, `expected low Brier score, got ${res.brier}`);
  assert.equal(res.calibrated, true);
  assert.ok(res.shelfRecallAt5 >= 0.9, `expected shelf recall@5 >= 0.9, got ${res.shelfRecallAt5}`);
  assert.equal(res.signalAccuracy, 1, `expected signal accuracy 1.0, got ${res.signalAccuracy}`);

  const tight = runBenchSuite({ budgetLimit: 5 });
  assert.equal(tight.completedCount, 2);
  assert.equal(tight.budgetSpent, 5);
  console.log(`bench-runner self-test: PASS (brier=${res.brier.toFixed(4)}, recall@5=${res.shelfRecallAt5}, signal=${res.signalAccuracy})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
  } else {
    const out = runBenchSuite();
    console.log(JSON.stringify(out, null, 2));
  }
}
