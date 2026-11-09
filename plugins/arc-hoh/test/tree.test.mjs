// arc-hoh tree (2026-11-06): run with  node --test test/tree.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, loss, voi, nextCheck, Q_MIN } from '../lib/tree.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const branch = (id, prior = 0.5) => ({ type: 'branch', id, hypothesis: `h ${id}`, criterion: `t ${id}`, prior });
const check = (b, id, extra = {}) => ({ type: 'register', branch: b, id, s: 0.8, e: 0.9, cost: 1, ...extra });
const obs = (id, b, c, passed) => ({ type: 'observe', id, branch: b, check: c, passed });
const go = (b) => [{ type: 'state', branch: b, to: 'probing', reason: 'r' }, { type: 'state', branch: b, to: 'live', reason: 'r' }];

test('a pass and a fail move the score by the likelihood ratio', () => {
  near(buildTree([branch('a'), check('a', 'c1'), obs('o1', 'a', 'c1', true)]).branches.a.q, 8 / 9);
  near(buildTree([branch('a'), check('a', 'c1'), obs('o1', 'a', 'c1', false)]).branches.a.q, 2 / 11);
});

test('the prior of a model stays between 0.35 and 0.65', () => {
  assert.equal(buildTree([branch('a', 0.99)]).branches.a.q, 0.65);
  assert.equal(buildTree([branch('a', 0.01)]).branches.a.q, 0.35);
  assert.equal(buildTree([branch('a', 'very likely')]).branches.a.q, 0.5);
});

test('checks on the same data update once, by the strongest', () => {
  const t = buildTree([branch('a'), check('a', 'weak', { s: 0.6, e: 0.6, group: 'data1' }), check('a', 'strong', { group: 'data1' }),
    obs('o1', 'a', 'weak', true), obs('o2', 'a', 'strong', true)]);
  near(t.branches.a.q, 8 / 9);
});

test('a tie inside a data group does not depend on the order of the events', () => {
  const head = [branch('a'), check('a', 'p', { s: 0.8, e: 0.8, group: 'g' }), check('a', 'f', { s: 0.8, e: 0.8, group: 'g' })];
  const pass = obs('o1', 'a', 'p', true), fail = obs('o2', 'a', 'f', false);
  near(buildTree([...head, pass, fail]).branches.a.q, 0.2);
  near(buildTree([...head, fail, pass]).branches.a.q, 0.2);
});

test('a group name cannot collide with a check of the same name', () => {
  const t = buildTree([branch('a'), check('a', 'y'), check('a', 'x', { group: 'check:y' }), obs('o1', 'a', 'y', true), obs('o2', 'a', 'x', true)]);
  near(t.branches.a.q, 64 / 65);
});

test('built-in JavaScript names are plain ids, and a bad event is refused', () => {
  for (const w of ['constructor', 'toString', '__proto__']) {
    const t = buildTree([branch('a'), obs('o1', 'a', w, true), { type: 'state', branch: w, to: 'live', reason: 'r' }, check(w, 'c')]);
    assert.equal(t.branches.a.q, 0.5);
    assert.equal(t.refused.length, 3, w);
    const u = buildTree([branch(w), check(w, w), obs('o1', w, w, true)]);
    near(u.branches[w].q, 8 / 9);
  }
  const bad = buildTree([null, 7, { type: 'branch' }, { type: 'branch', id: 3 }, { type: 'dance', branch: 'a' }]);
  assert.deepEqual(Object.keys(bad.branches), []);
  assert.equal(bad.refused.length, 5);
});

test('one warning stands for one held refutation', () => {
  const events = [branch('a', 0.35), ...go('a'), { type: 'operator', branch: 'a', directive: 'pursue', reason: 'keep' }];
  for (let i = 0; i < 6; i++) events.push(check('a', `c${i}`), obs(`o${i}`, 'a', `c${i}`, false));
  assert.equal(buildTree(events).branches.a.warnings.length, 1);
});

test('one observation counts once in the whole tree', () => {
  const t = buildTree([branch('a'), branch('b'), check('a', 'c1'), check('b', 'c2'), obs('o1', 'a', 'c1', true), obs('o1', 'b', 'c2', true)]);
  near(t.branches.a.q, 8 / 9);
  assert.equal(t.branches.b.q, 0.5);
  assert.match(t.refused[0].reason, /already counted/);
});

test('a check must be registered before its result', () => {
  const t = buildTree([branch('a'), obs('o1', 'a', 'late', true), check('a', 'late')]);
  assert.equal(t.branches.a.q, 0.5);
  assert.match(t.refused[0].reason, /not registered/);
});

test('a check with no information or an impossible number is refused', () => {
  const bad = [{ s: 0.5, e: 0.5 }, { s: 1, e: 0.9 }, { s: 0.8, e: 1 }, { s: 0, e: 0.9 }, { s: 'x', e: 0.9 }, { s: 0.8, e: 0.9, cost: 0 }];
  for (const b of bad) {
    const t = buildTree([branch('a'), check('a', 'c', b)]);
    assert.deepEqual(Object.keys(t.branches.a.checks), [], JSON.stringify(b));
    assert.equal(t.refused.length, 1);
  }
});

test('the score is a heuristic until every check it uses is calibrated', () => {
  assert.equal(buildTree([branch('a'), check('a', 'c'), obs('o', 'a', 'c', true)]).branches.a.score_kind, 'heuristic');
  assert.equal(buildTree([branch('a'), check('a', 'c', { calibrated: true }), obs('o', 'a', 'c', true)]).branches.a.score_kind, 'heuristic', 'an event cannot claim calibration');
  assert.equal(buildTree([branch('a'), check('a', 'c'), obs('o', 'a', 'c', true)], { calibrated: ['c'] }).branches.a.score_kind, 'probability');
  assert.equal(buildTree([branch('a')]).branches.a.score_kind, 'heuristic');
});

test('code refutes a branch on a failed decisive check', () => {
  const t = buildTree([branch('a'), ...go('a'), check('a', 'd', { decisive: true, s: 0.9, e: 0.95 }), obs('o', 'a', 'd', false)]);
  assert.equal(t.branches.a.state, 'refuted');
  assert.match(t.branches.a.history.at(-1).reason, /decisive/);
  assert.equal(t.branches.a.history.at(-1).by, 'code');
});

test('a decisive flag on a weak check does not refute', () => {
  const t = buildTree([branch('a'), ...go('a'), check('a', 'd', { decisive: true, s: 0.9, e: 0.9 }), obs('o', 'a', 'd', false)]);
  assert.equal(t.branches.a.state, 'live');
});

test('code refutes a branch when the score falls below the floor', () => {
  const events = [branch('a', 0.35), ...go('a')];
  for (let i = 0; i < 4; i++) events.push(check('a', `c${i}`), obs(`o${i}`, 'a', `c${i}`, false));
  const t = buildTree(events);
  assert.ok(t.branches.a.q < Q_MIN);
  assert.equal(t.branches.a.state, 'refuted');
});

test('the agent moves only along allowed steps, and nothing is deleted', () => {
  const t = buildTree([branch('a'), { type: 'state', branch: 'a', to: 'confirmed-limited', reason: 'r' }, { type: 'state', branch: 'a', to: 'nonsense', reason: 'r' }]);
  assert.equal(t.branches.a.state, 'sketched');
  assert.equal(t.refused.length, 2);
  const u = buildTree([branch('a'), ...go('a'), { type: 'state', branch: 'a', to: 'parked', reason: 'dull' }]);
  assert.deepEqual(u.branches.a.history.map((h) => h.to), ['sketched', 'probing', 'live', 'parked']);
});

test('confirmed-limited needs a passed decisive check', () => {
  const up = { type: 'state', branch: 'a', to: 'confirmed-limited', reason: 'survived' };
  assert.equal(buildTree([branch('a'), ...go('a'), up]).branches.a.state, 'live');
  const t = buildTree([branch('a'), ...go('a'), check('a', 'd', { decisive: true, e: 0.95 }), obs('o', 'a', 'd', true), up]);
  assert.equal(t.branches.a.state, 'confirmed-limited');
  const low = buildTree([branch('a', 0.35), ...go('a'), check('a', 'x', { s: 0.9, e: 0.9 }), obs('o1', 'a', 'x', false), check('a', 'd', { decisive: true, s: 0.6, e: 0.95 }), obs('o2', 'a', 'd', true), up]);
  assert.equal(low.branches.a.state, 'live', 'a low score cannot be confirmed');
});

test('the operator is stronger than the agent and than code', () => {
  const drop = buildTree([branch('a'), ...go('a'), { type: 'operator', branch: 'a', directive: 'drop', reason: 'no' }, { type: 'state', branch: 'a', to: 'live', reason: 'r' }]);
  assert.equal(drop.branches.a.state, 'refuted');
  assert.equal(drop.branches.a.history.at(-1).by, 'operator');
  const park = buildTree([branch('a'), ...go('a'), { type: 'operator', branch: 'a', directive: 'park', reason: 'wait' }, { type: 'state', branch: 'a', to: 'live', reason: 'r' }]);
  assert.equal(park.branches.a.state, 'parked');
  assert.match(park.refused[0].reason, /operator holds/);
  const parked = buildTree([branch('a'), ...go('a'), { type: 'operator', branch: 'a', directive: 'park', reason: 'wait' },
    check('a', 'd', { decisive: true, s: 0.9, e: 0.95 }), obs('o', 'a', 'd', false)]);
  assert.equal(parked.branches.a.state, 'parked', 'code does not refute a branch the operator parked');
  const pursue = buildTree([branch('a'), ...go('a'), { type: 'operator', branch: 'a', directive: 'pursue', reason: 'keep' },
    check('a', 'd', { decisive: true, s: 0.9, e: 0.95 }), obs('o', 'a', 'd', false), { type: 'state', branch: 'a', to: 'parked', reason: 'agent' }]);
  assert.equal(pursue.branches.a.state, 'live');
  assert.match(pursue.branches.a.warnings[0], /held by the operator/);
  const back = buildTree([branch('a'), { type: 'operator', branch: 'a', directive: 'drop', reason: 'no' }, { type: 'operator', branch: 'a', directive: 'pursue', reason: 'yes' }]);
  assert.equal(back.branches.a.state, 'live');
});

test('a refuted branch keeps its score history and leaves the choice', () => {
  const t = buildTree([branch('a'), ...go('a'), check('a', 'd', { decisive: true, s: 0.9, e: 0.95 }), check('a', 'x'), obs('o', 'a', 'd', false)]);
  assert.equal(nextCheck(t), null);
  assert.equal(t.branches.a.observations.length, 1);
});

test('value of information matches a sum by hand', () => {
  near(loss(0.5, 1, 1), 0.5);
  near(loss(0.2, 1, 3), 0.6);
  near(voi(0.5, { s: 0.8, e: 0.9 }), 0.35);
  assert.equal(voi(0.05, { s: 0.6, e: 0.6 }), 0);
});

test('a check that cannot flip the decision alone gets a two-step value', () => {
  const t = buildTree([branch('a', 0.35), ...go('a'), check('a', 'x', { s: 0.6, e: 0.7 }), obs('o1', 'a', 'x', false),
    check('a', 'w1', { s: 0.7, e: 0.7 }), check('a', 'w2', { s: 0.7, e: 0.7 })]);
  assert.equal(voi(t.branches.a.q, { s: 0.7, e: 0.7 }), 0);
  const next = nextCheck(t);
  assert.equal(next.steps, 2);
  assert.ok(next.priority > 0);
});

test('the two-step value looks at every open check, not only the strongest', () => {
  const t = buildTree([branch('a', 0.35), ...go('a'), check('a', 'x', { s: 0.6, e: 0.7 }), obs('o1', 'a', 'x', false),
    check('a', 'strong', { s: 0.99, e: 0.2, group: 'g' }), check('a', 'w1', { s: 0.7, e: 0.7, group: 'g' }), check('a', 'w2', { s: 0.7, e: 0.7 })]);
  const next = nextCheck(t);
  assert.ok(next, 'w1 and then w2 can still flip the decision');
  assert.equal(next.steps, 2);
  assert.notEqual(next.check, 'strong');
});

test('the next check is the best value per cost, and ties go to the smaller id', () => {
  const t = buildTree([branch('b'), branch('a'), ...go('a'), ...go('b'), check('b', 'c1'), check('a', 'c1'), check('a', 'dear', { cost: 100 })]);
  assert.deepEqual([nextCheck(t).branch, nextCheck(t).check], ['a', 'c1']);
  const u = buildTree([branch('a'), ...go('a'), check('a', 'dear', { cost: 100 }), check('a', 'cheap', { cost: 1, s: 0.7, e: 0.8 })]);
  assert.equal(nextCheck(u).check, 'cheap');
});

test('a used check or a used data group is not offered again', () => {
  const t = buildTree([branch('a'), ...go('a'), check('a', 'c1', { group: 'g' }), check('a', 'c2', { group: 'g', s: 0.99, e: 0.99 }), check('a', 'c3', { s: 0.9, e: 0.95 }), obs('o', 'a', 'c1', true)]);
  assert.equal(nextCheck(t).check, 'c3', 'c2 is stronger, and its data group is used');
  const u = buildTree([branch('a', 0.35), ...go('a'), check('a', 'c1', { s: 0.9, e: 0.9 }), check('a', 'weak', { s: 0.7, e: 0.7 }), obs('o', 'a', 'c1', true)]);
  assert.equal(nextCheck(u), null, 'c1 still has value, and it has already run');
});

test('the costs of a wrong keep and a wrong drop change the order', () => {
  const t = buildTree([branch('a', 0.35), branch('b', 0.65), ...go('a'), ...go('b'), check('a', 'c'), check('b', 'c')]);
  assert.equal(nextCheck(t, { cfp: 1, cfn: 3 }).branch, 'a');
  assert.equal(nextCheck(t, { cfp: 3, cfn: 1 }).branch, 'b');
});

// A recorded session: one mission with three branches, as the event log stores it.
const session = [
  branch('linear', 0.6), branch('quadratic', 0.5), branch('null-control', 0.4),
  ...go('linear'), ...go('quadratic'), ...go('null-control'),
  check('linear', 'fit', { s: 0.8, e: 0.7, cost: 2 }), check('linear', 'holdout', { s: 0.85, e: 0.96, decisive: true, cost: 5, group: 'split' }),
  check('quadratic', 'fit', { s: 0.8, e: 0.7, cost: 2 }), check('quadratic', 'holdout', { s: 0.85, e: 0.96, decisive: true, cost: 5, group: 'split' }),
  check('null-control', 'shuffle', { s: 0.9, e: 0.8, cost: 1 }),
  obs('fit-linear', 'linear', 'fit', true), obs('holdout-linear', 'linear', 'holdout', false),
  obs('shuffle-control', 'null-control', 'shuffle', false),
  obs('fit-quadratic', 'quadratic', 'fit', true), obs('holdout-quadratic', 'quadratic', 'holdout', true),
  { type: 'state', branch: 'quadratic', to: 'confirmed-limited', reason: 'survived the hold-out' },
];

test('a recorded session replays to the same tree', () => {
  const t = buildTree(session);
  assert.deepEqual(Object.fromEntries(Object.entries(t.branches).map(([id, b]) => [id, b.state])),
    { linear: 'refuted', quadratic: 'confirmed-limited', 'null-control': 'live' });
  assert.ok(t.branches.quadratic.q > 0.95);
  assert.equal(t.branches.quadratic.score_kind, 'heuristic');
  assert.deepEqual(t.refused, []);
  assert.deepEqual(buildTree(session), t);
  assert.equal(JSON.stringify(buildTree(JSON.parse(JSON.stringify(session)))), JSON.stringify(t));
});

test('building a tree leaves its events unchanged', () => {
  const copy = JSON.stringify(session);
  buildTree(session);
  assert.equal(JSON.stringify(session), copy);
});

import {
  TASK_STATES,
  createDecisionRecord,
  validateDecisionRecord,
  createTaskGraph,
  checkpointRun,
  resumeRun,
} from '../lib/tree.js';
import {
  INTUITION_OUTCOMES,
  routeIntuition,
  recordIntuitionOutcome,
  brierScore,
  calibrationReport,
} from '../lib/intuition.js';

test('Slice D1: DEC-xxxx decision record validates schema and rejects missing fields', () => {
  const rec = createDecisionRecord({
    id: 'DEC-0042',
    title: 'Use Sequential Halving eta=3',
    decision: 'Prune hypothesis branches with eta=3',
    rationale: 'Balances exploration and compute budget',
    alternatives: ['eta=2', 'no pruning'],
    evidence: ['concept/tree-hoh.md'],
    date: '2026-11-09',
  });
  assert.equal(rec.id, 'DEC-0042');
  assert.equal(validateDecisionRecord(rec).ok, true);
  assert.equal(validateDecisionRecord({ id: 'BAD-1' }).ok, false);
});

test('Slice D1: 13-state task graph checkpoints and resumes with intact ledger hash chain', () => {
  assert.equal(TASK_STATES.length, 13);
  const g = createTaskGraph();
  g.addTask({ id: 't1', title: 'Probe branch A', state: 'Planned' });
  g.transition('t1', 'Running', 'start probe');
  g.recordDecision({
    id: 'DEC-0001',
    title: 'Initial probe',
    decision: 'Run fast check first',
    rationale: 'Highest VOI per cost',
    alternatives: ['Full simulation'],
    date: '2026-11-09',
  });
  const ckpt = checkpointRun(g, { reason: 'operator pause' });
  assert.equal(g.getTask('t1').state, 'Checkpointed');
  const resumed = resumeRun(ckpt);
  assert.equal(resumed.getTask('t1').state, 'Running');
  assert.equal(resumed.verifyLedger().ok, true);
  resumed.transition('t1', 'Done', 'verified');
  assert.equal(resumed.getTask('t1').state, 'Done');
});

test('Slice D2: System One intuition router enforces R009 and computes Brier calibration', () => {
  assert.equal(INTUITION_OUTCOMES.length, 5);
  const denied = routeIntuition({ id: 'g0', grantPermission: true });
  assert.equal(denied.ok, false);
  assert.equal(denied.rule, 'R009');
  assert.equal(denied.permissionGranted, false);

  const g1 = routeIntuition({ id: 'g1', priorProbability: 0.9, uncertainty: 0.1 });
  const g2 = routeIntuition({ id: 'g2', priorProbability: 0.7, cheapCheckAvailable: true });
  const g3 = routeIntuition({ id: 'g3', priorProbability: 0.5, uncertainty: 0.7 });
  const g4 = routeIntuition({ id: 'g4', priorProbability: 0.8, needsOperator: true });
  const g5 = routeIntuition({ id: 'g5', priorProbability: 0.1, canVerify: false });
  assert.equal(g1.outcome, 'answer_now');
  assert.equal(g2.outcome, 'run_one_cheap_check');
  assert.equal(g3.outcome, 'open_tree_hoh');
  assert.equal(g4.outcome, 'ask_operator');
  assert.equal(g5.outcome, 'abstain');

  let log = [g1, g5];
  log = recordIntuitionOutcome(log, 'g1', 1);
  log = recordIntuitionOutcome(log, 'g5', 0);
  near(brierScore(log), 0.01);
  assert.equal(calibrationReport(log).calibrated, true);
});

