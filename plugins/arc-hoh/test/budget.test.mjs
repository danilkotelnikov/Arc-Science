// arc-hoh branch budgets (2026-11-07): run with  node --test test/budget.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, spent, limitsFor, closeStage } from '../lib/budget.js';
import { buildTree, nextCheck } from '../lib/tree.js';
import { mulberry } from '../lib/replay.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
const branch = (id, prior = 0.5) => ({ type: 'branch', id, hypothesis: `h ${id}`, criterion: `t ${id}`, prior });
const go = (b) => [{ type: 'state', branch: b, to: 'probing', reason: 'r' }, { type: 'state', branch: b, to: 'live', reason: 'r' }];
const check = (b, id, cost = 1, s = 0.7, e = 0.7) => ({ type: 'register', branch: b, id, s, e, cost });
const obs = (id, b, c, passed) => ({ type: 'observe', id, branch: b, check: c, passed });

test('the plan halves the branches and splits the budget evenly over the stages', () => {
  const p = plan(8, 240);
  assert.deepEqual(p.stages.map((s) => [s.branches, s.keep]), [[8, 4], [4, 2], [2, 1]]);
  for (const s of p.stages) near(s.branches * s.perBranch, 80);
  assert.deepEqual(plan(9, 90, 3).stages.map((s) => [s.branches, s.keep]), [[9, 3], [3, 1]]);
  assert.deepEqual(plan(5, 90).stages.map((s) => s.keep), [3, 2, 1]);
  assert.deepEqual(plan(1, 10).stages.map((s) => [s.branches, s.keep]), [[1, 1]]);
});

test('the plan never promises more than the budget, and survivors get more', () => {
  for (const [n, b, eta] of [[8, 240, 2], [7, 100, 2], [16, 1000, 2], [27, 500, 3], [5, 9, 4], [2, 1, 2]]) {
    const p = plan(n, b, eta);
    near(p.stages.reduce((sum, s) => sum + s.branches * s.perBranch, 0), b);
    assert.equal(p.stages.at(-1).keep, 1);
    for (let i = 1; i < p.stages.length; i++) assert.ok(p.stages[i].perBranch >= p.stages[i - 1].perBranch);
  }
});

test('a bad plan is refused', () => {
  assert.throws(() => plan(0, 10), /whole number/);
  assert.throws(() => plan(1.5, 10), /whole number/);
  assert.throws(() => plan(4, 0), /positive budget/);
  assert.throws(() => plan(4, Infinity), /positive budget/);
  assert.throws(() => plan(4, 10, 1), /eta/);
});

test('a branch spends what its observed checks cost', () => {
  const t = buildTree([branch('a'), check('a', 'c1', 3), check('a', 'c2', 5), obs('o', 'a', 'c1', true)]);
  assert.equal(spent(t, 'a'), 3);
  assert.equal(spent(t, 'nobody'), 0);
});

test('a check dearer than what the branch has left is not offered', () => {
  const events = [branch('a'), ...go('a'), check('a', 'dear', 5), check('a', 'cheap', 2, 0.6, 0.65)];
  const t = buildTree(events);
  assert.equal(nextCheck(t).check, 'cheap', 'value per cost');
  assert.equal(nextCheck(t, { limits: { a: 1 } }), null);
  assert.equal(nextCheck(t, { limits: { a: 2 } }).check, 'cheap');
  const after = buildTree([...events, obs('o', 'a', 'cheap', true)]);
  assert.equal(nextCheck(after, { limits: { a: 3 } }), null, '2 are spent, and 5 do not fit in the 1 left');
  assert.equal(nextCheck(after, { limits: {} }), null, 'a branch with no limit has no budget');
});

test('a branch gets what it has spent plus the share of this stage', () => {
  const p = plan(4, 80);
  const t = buildTree([...['a', 'b', 'c', 'd'].flatMap((id) => [branch(id), ...go(id)]), check('a', 'x', 7), obs('o', 'a', 'x', true)]);
  const first = limitsFor(t, p, 0, ['a', 'b', 'c', 'd']);
  near(first.a, 7 + 10);
  near(first.b, 10);
  const second = limitsFor(t, p, 1, ['a', 'b']);
  near(second.a, 7 + 20);
  assert.deepEqual(Object.keys(second), ['a', 'b']);
  assert.throws(() => limitsFor(t, plan(2, 10), 0, ['a', 'b', 'c']), /more branches/);
  assert.throws(() => limitsFor(t, p, 9, ['a']), /no stage/);
  assert.throws(() => closeStage(t, p, 9), /no stage/);
});

test('a stage keeps the best scores, ties to the smaller id, and parks the rest', () => {
  const events = [branch('a'), branch('b'), branch('c'), branch('d'), ...['a', 'b', 'c', 'd'].flatMap(go),
    check('a', 'x'), obs('o1', 'a', 'x', false), check('d', 'x'), obs('o2', 'd', 'x', true)];
  const p = plan(4, 80), t = buildTree(events);
  const { keep, events: parks } = closeStage(t, p, 0);
  assert.deepEqual(keep, ['d', 'b']);
  assert.deepEqual(parks.map((e) => e.branch).sort(), ['a', 'c']);
  const next = buildTree([...events, ...parks]);
  assert.deepEqual(next.refused, []);
  assert.equal(next.branches.a.state, 'parked');
  assert.match(next.branches.a.history.at(-1).reason, /stage 1/);
  assert.equal(next.branches.a.history.at(-1).by, 'agent');
});

test('the operator keeps a branch that the stage would drop', () => {
  const events = [...['a', 'b'].flatMap((id) => [branch(id), ...go(id)]), check('a', 'x'), obs('o', 'a', 'x', false), { type: 'operator', branch: 'a', directive: 'pursue', reason: 'keep' }];
  const t = buildTree(events);
  const { keep, events: parks } = closeStage(t, plan(2, 10), 0);
  assert.deepEqual(keep, ['a']);
  assert.deepEqual(parks.map((e) => e.branch), ['b']);
  assert.deepEqual(buildTree([...events, ...parks]).refused, []);
});

test('pinned branches past the stage size stay live and get no new budget', () => {
  const pin = (id) => ({ type: 'operator', branch: id, directive: 'pursue', reason: 'keep' });
  const t = buildTree([...['a', 'b', 'c'].flatMap((id) => [branch(id), ...go(id), pin(id)])]);
  const p = plan(3, 30);
  const { keep, events } = closeStage(t, p, 1);
  assert.equal(events.length, 0);
  assert.equal(keep.length, p.stages[1].keep);
  const outside = ['a', 'b', 'c'].find((id) => !keep.includes(id));
  const more = buildTree([...['a', 'b', 'c'].flatMap((id) => [branch(id), ...go(id), pin(id), check(id, 'x')])]);
  const limits = limitsFor(more, p, 1, keep);
  assert.equal(limits[outside], undefined);
  const only = { [outside]: limits[keep[0]] };
  assert.ok(nextCheck(more, { limits: only }), 'it could run with a limit');
  assert.notEqual(nextCheck(more, { limits })?.branch, outside, 'with the plan it gets nothing');
});

test('a parked or refuted branch does not take a place', () => {
  const t = buildTree([...['a', 'b', 'c', 'd'].flatMap((id) => [branch(id), ...go(id)]), { type: 'state', branch: 'a', to: 'parked', reason: 'r' }, { type: 'operator', branch: 'b', directive: 'drop', reason: 'no' }]);
  const { keep, events } = closeStage(t, plan(4, 80), 0);
  assert.deepEqual(keep, ['c', 'd']);
  assert.deepEqual(events, []);
});

/** One mission with a known best branch. The check results come from the truth of each branch. */
function mission(seed, { n = 8, budget = 120 } = {}) {
  const rng = mulberry(seed), ids = Array.from({ length: n }, (_, i) => `b${i}`), best = ids[Math.floor(rng() * n)];
  const events = ids.flatMap((id) => [branch(id), ...go(id), ...Array.from({ length: 40 }, (_, c) => check(id, `c${c}`))]);
  const p = plan(n, budget);
  let live = ids, serial = 0, wasted = 0;
  const pulls = Object.fromEntries(ids.map((id) => [id, 0]));
  for (let stage = 0; stage < p.stages.length; stage++) {
    const limits = limitsFor(buildTree(events), p, stage, live);
    for (;;) {
      const tree = buildTree(events);
      const open = live.filter((id) => spent(tree, id) + 1 <= limits[id]);
      if (open.length === 0) break;
      const next = nextCheck(tree, { limits }) ?? { branch: open[0], check: Object.keys(tree.branches[open[0]].checks).find((c) => !tree.branches[open[0]].observations.some((o) => o.check === c)) };
      if (!next.check) { wasted++; break; }
      const right = rng() < 0.7;
      events.push(obs(`o${serial++}`, next.branch, next.check, next.branch === best ? right : !right));
      pulls[next.branch]++;
    }
    const closed = closeStage(buildTree(events), p, stage);
    events.push(...closed.events);
    live = closed.keep;
  }
  const tree = buildTree(events);
  return { best, winner: live[0], total: ids.reduce((sum, id) => sum + spent(tree, id), 0), pulls, wasted };
}

test('a recorded mission never spends past its budget, and weak branches stop early', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const m = mission(seed);
    assert.ok(m.total <= 120, `spent ${m.total}`);
    const most = Math.max(...Object.values(m.pulls));
    assert.equal(m.pulls[m.winner], most, 'the winner got the most checks');
    assert.ok(Math.min(...Object.values(m.pulls)) < most / 2, 'a dropped branch stopped early');
  }
});

test('rescuing a dropped branch cannot push spending past the budget', () => {
  const ids = Array.from({ length: 8 }, (_, i) => `b${i}`), budget = 120, p = plan(8, budget);
  const events = ids.flatMap((id) => [branch(id), ...go(id), ...Array.from({ length: 80 }, (_, c) => check(id, `c${c}`))]);
  const rng = mulberry(5);
  let live = ids, serial = 0;
  for (let stage = 0; stage < p.stages.length; stage++) {
    const limits = limitsFor(buildTree(events), p, stage, live);
    for (const id of live) {
      for (;;) {
        const tree = buildTree(events), b = tree.branches[id];
        if (spent(tree, id) + 1 > limits[id]) break;
        const next = Object.keys(b.checks).find((c) => !b.observations.some((o) => o.check === c));
        events.push(obs(`o${serial++}`, id, next, rng() < 0.5));
      }
    }
    const closed = closeStage(buildTree(events), p, stage);
    events.push(...closed.events);
    if (stage === 0) {
      const dropped = closed.events[0].branch;
      events.push({ type: 'operator', branch: dropped, directive: 'pursue', reason: 'keep it' });
    }
    live = closeStage(buildTree(events), p, stage).keep;
  }
  const tree = buildTree(events);
  assert.ok(ids.reduce((sum, id) => sum + spent(tree, id), 0) <= budget);
});

test('the true branch usually wins, far above chance', () => {
  let right = 0;
  const trials = 60;
  for (let seed = 100; seed < 100 + trials; seed++) {
    const m = mission(seed);
    if (m.winner === m.best) right++;
  }
  assert.ok(right / trials > 0.7, `found ${right} of ${trials}, and chance is one in eight`);
});
