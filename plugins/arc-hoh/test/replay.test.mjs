// arc-hoh replay gate (2026-11-06): run with  node --test test/replay.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { decideGate, ledgerFile, sha256 } from '../lib/gates.js';
import {
  alphaK, signTestP, pairedLowerBound, minDiscordantPairs, splitOf, heldoutSlice, TRAPS, runTraps, decide, runCases,
  evaluateAndRecord, freezeReplaySet, nextSlice, verifyReport, replayProblem, mulberry, MAX_B,
} from '../lib/replay.js';

const CLEAN = [{ id: 'clean', passed: false }];
const pairs = (pos, neg, same) => [...Array(pos).fill([0, 1]), ...Array(neg).fill([1, 0]), ...Array(same).fill([1, 1])];
const cases = (pos, neg, same) => pairs(pos, neg, same).map(([a, b], i) => ({ id: `c${i}`, m_old: a, m_new: b }));

/** n paired outcomes with a known true mean difference `delta`. */
function makeCases(n, discordant, delta, rng) {
  const gain = (discordant + delta) / 2, loss = (discordant - delta) / 2;
  return Array.from({ length: n }, (_, i) => {
    const u = rng();
    const pair = u < gain ? [0, 1] : u < gain + loss ? [1, 0] : rng() < 0.6 ? [1, 1] : [0, 0];
    return { id: `sim-${i}`, m_old: pair[0], m_new: pair[1] };
  });
}
function acceptanceRate(trials, n, discordant, delta, seed) {
  const rng = mulberry(seed);
  let accepted = 0;
  for (let t = 0; t < trials; t++) {
    const r = decide(makeCases(n, discordant, delta, rng), CLEAN, 1, { B: 500, seed: Math.floor(rng() * 2 ** 31) });
    if (r.accepted) accepted++;
  }
  return accepted / trials;
}

test('alpha spending sums to alpha and shrinks', () => {
  assert.ok(Math.abs(alphaK(0.05, 1) - 0.05 * 6 / Math.PI ** 2) < 1e-15);
  assert.ok(alphaK(0.05, 1) > alphaK(0.05, 2));
  let total = 0;
  for (let k = 1; k <= 200000; k++) total += alphaK(0.05, k);
  assert.ok(total <= 0.05 && total > 0.0499);
});

test('the sign test is exact and survives a long list', () => {
  const d = [...Array(8).fill(1), ...Array(2).fill(-1), ...Array(5).fill(0)];
  assert.ok(Math.abs(signTestP(d) - 56 / 1024) < 1e-12);
  assert.equal(signTestP([0, 0, 0]), 1);
  const long = signTestP([...Array(1300).fill(1), ...Array(1300).fill(-1)]);
  assert.ok(long > 0.5 && long < 0.51, String(long));
});

test('the pair count matches the Python method on three settings', () => {
  // Reference values from the rule in .devdb/replay/stats.py. The first n that stays above the power is
  // 169 here; the spec's "about 158" is the first n that touches it.
  assert.equal(minDiscordantPairs(0.2, 0.05, 0.8), 169);
  assert.equal(minDiscordantPairs(0.3, 0.05, 0.8), 76);
  assert.equal(minDiscordantPairs(0.2, 0.01, 0.9), 336);
});

test('the bootstrap lower bound is seeded and bounded', () => {
  assert.equal(pairedLowerBound(Array(50).fill(1), 0.05, 200, 1), 1);
  assert.equal(pairedLowerBound(Array(50).fill(0), 0.05, 200, 1), 0);
  const mixed = [...Array(20).fill(1), ...Array(20).fill(-1), ...Array(10).fill(0)];
  assert.ok(pairedLowerBound(mixed, 0.05, 500, 1) < 0);
  assert.equal(pairedLowerBound(mixed, 0.05, 500, 7), pairedLowerBound(mixed, 0.05, 500, 7));
  assert.notEqual(pairedLowerBound(mixed, 0.05, 500, 7), pairedLowerBound(mixed, 0.05, 500, 8));
});

test('the split is the same as in the Python method, and balanced', () => {
  const py = ['dev', 'dev', 'dev', 'dev', 'dev', 'heldout', 'dev', 'heldout'];
  assert.deepEqual(py.map((_, i) => splitOf(`case-${i}`)), py);
  const ids = Array.from({ length: 1000 }, (_, i) => `case-${i}`);
  const held = ids.filter((i) => splitOf(i) === 'heldout');
  assert.ok(held.length > 400 && held.length < 600);
});

test('each patch gets a fresh held-out slice in the Python order', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `case-${i}`).filter((i) => splitOf(i) === 'heldout');
  assert.deepEqual(heldoutSlice(ids, 1, 4), ['case-17', 'case-7', 'case-18', 'case-25']);
  const all = Array.from({ length: 1000 }, (_, i) => `case-${i}`).filter((i) => splitOf(i) === 'heldout');
  const a = heldoutSlice(all, 1, 100), b = heldoutSlice(all, 2, 100);
  assert.equal(new Set([...a, ...b]).size, 200);
  assert.throws(() => heldoutSlice(all, 99, 100), /no fresh slice/);
});

test('the real gate rejects every trap', () => {
  assert.ok(TRAPS.length >= 9);
  assert.deepEqual(runTraps().filter((t) => t.passed).map((t) => t.id), []);
});

test('a trap fails for its own fault: the same call with no fault is accepted', () => {
  assert.deepEqual(runTraps([{ id: 'baseline' }]), [{ id: 'baseline', passed: true }]);
});

test('a gate that accepts everything is caught by the traps', () => {
  const got = runTraps(TRAPS, () => ({ verdict: 'accepted', reasons: [] }));
  assert.equal(got.filter((t) => t.passed).length, TRAPS.length);
});

test('the acceptance rule', () => {
  const clear = decide(cases(150, 20, 100), CLEAN, 1);
  assert.equal(clear.accepted, true, clear.reasons.join('; '));
  assert.ok(clear.lower > 0);
  const few = decide(cases(40, 0, 200), CLEAN, 1);
  assert.equal(few.accepted, false); assert.match(few.reasons.join(' '), /pairs/);
  const trap = decide(cases(150, 20, 100), [{ id: 't1', passed: true }], 1);
  assert.equal(trap.accepted, false); assert.match(trap.reasons.join(' '), /trap/);
  const none = decide(cases(150, 20, 100), [], 1);
  assert.equal(none.accepted, false); assert.match(none.reasons.join(' '), /trap set must run/);
  assert.equal(decide(cases(20, 150, 100), CLEAN, 1).accepted, false);
  const flat = decide(cases(90, 90, 100), CLEAN, 1);
  assert.equal(flat.accepted, false); assert.match(flat.reasons.join(' '), /gain/);
  const rows = cases(105, 60, 200);
  assert.ok(decide(rows, CLEAN, 1).lower >= decide(rows, CLEAN, 20).lower);
});

test('the bound keeps tightening as k grows, and evaluation stops when it cannot', () => {
  const rows = cases(150, 20, 100);
  const low = decide(rows, CLEAN, 7), lower = decide(rows, CLEAN, 20);
  assert.ok(lower.B > low.B && low.B > 2000);
  assert.ok(lower.lower < low.lower, `${lower.lower} is not below ${low.lower}`);
  const spent = decide(rows, CLEAN, 100);
  assert.equal(spent.accepted, false);
  assert.match(spent.reasons.join(' '), new RegExp(`more than ${MAX_B} resamples`));
});

test('settings that cannot finish are refused, not run', () => {
  for (const bad of [{ effect: 1 }, { effect: 0 }, { effect: NaN }, { effect: 1e-6 }, { power: 1 }, { alpha: 0 }, { alpha: 2 }, { B: 0 }, { B: 1e9 }, { epsilon: -1 }]) {
    const r = decide(cases(150, 20, 100), CLEAN, 1, bad);
    assert.equal(r.accepted, false, JSON.stringify(bad));
    assert.match(r.reasons.join(' '), /bad settings/);
  }
  assert.throws(() => minDiscordantPairs(1, 0.05, 0.8), /effect/);
  assert.throws(() => minDiscordantPairs(0.2, 0.05, 1), /power/);
});

test('bad data is refused, not scored', () => {
  assert.equal(decide([], CLEAN, 1).accepted, false);
  assert.equal(decide([...cases(150, 20, 100), { id: 'c0', m_old: 0, m_new: 1 }], CLEAN, 1).accepted, false);
  const weird = cases(150, 20, 100); weird[0].m_new = true;
  assert.match(decide(weird, CLEAN, 1).reasons.join(' '), /bad data/);
  const text = cases(150, 20, 100); text[0].m_new = '1';
  assert.equal(decide(text, CLEAN, 1).accepted, false);
});

test('runCases scores each trace under both policies', () => {
  assert.deepEqual(runCases([{ id: 'a', v: 1 }], (t) => t.v - 1, (t) => t.v), [{ id: 'a', m_old: 0, m_new: 1 }]);
});

test('a null patch is accepted less often than alpha', () => {
  const rate = acceptanceRate(300, 500, 0.4, 0, 2026);
  assert.ok(rate < 0.05, `null rate ${rate}`);
});

test('a null patch with few discordant pairs and a harmful patch are never accepted', () => {
  assert.equal(acceptanceRate(100, 500, 0.1, 0, 5), 0);
  assert.equal(acceptanceRate(50, 500, 0.4, -0.1, 9), 0);
});

test('a good patch is usually accepted', () => {
  const rate = acceptanceRate(50, 500, 0.5, 0.2, 11);
  assert.ok(rate > 0.9, `power ${rate}`);
});

// Recording: the verdict goes to the hash-chained ledger, and the report file lies beside it.
const SIZE = 270;
const ids = Array.from({ length: 4000 }, (_, i) => `case-${i}`);
const home = async () => {
  const d = await mkdtemp(path.join(os.tmpdir(), 'arc-replay-'));
  return { d, file: ledgerFile({ ARC_HOME: d }) };
};
/** A home with a frozen case set. */
const ready = async () => {
  const h = await home();
  await freezeReplaySet(h.file, ids, SIZE);
  return h;
};
/** The next slice the gate asks for, scored with these counts. */
const scored = async (file, pos, neg, same) => {
  const want = pairs(pos, neg, same);
  assert.equal(want.length, SIZE);
  return (await nextSlice(file)).map((id, i) => ({ id, m_old: want[i][0], m_new: want[i][1] }));
};
const evaluate = (file, patch, diff, cases, gate = decideGate) => evaluateAndRecord(file, patch, diff, cases, gate);

test('a patch needs an accepted replay of its exact text', async () => {
  const { d, file } = await ready();
  assert.match(await replayProblem(file, 'P1', 'diff one'), /no replay evaluation/);
  const r = await evaluate(file, 'P1', 'diff one', await scored(file, 150, 20, 100));
  assert.equal(r.result.accepted, true, r.result.reasons.join('; '));
  assert.equal(await replayProblem(file, 'P1', 'diff one'), null);
  assert.match(await replayProblem(file, 'P1', 'diff two'), /no replay evaluation/);
  assert.match(await replayProblem(file, 'P2', 'diff one'), /no replay evaluation/);
  await rm(d, { recursive: true });
});

test('a report verifies whatever order the cases came in', async () => {
  const { d, file } = await ready();
  for (const [i, seed] of [11, 22, 33, 44, 55].entries()) {
    const rng = mulberry(seed);
    const rows = (await scored(file, 130, 50, 90)).map((c) => [rng(), c]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const r = await evaluate(file, `P${i}`, `diff ${i}`, rows);
    assert.equal((await verifyReport(r.file)).ok, true, `order ${seed}`);
  }
  await rm(d, { recursive: true });
});

test('a rejected evaluation does not open the door', async () => {
  const { d, file } = await ready();
  const r = await evaluate(file, 'P1', 'diff', await scored(file, 90, 90, 90));
  assert.equal(r.result.accepted, false);
  assert.match(await replayProblem(file, 'P1', 'diff'), /not accepted/);
  await rm(d, { recursive: true });
});

test('the traps run on the gate of the patch, and a caller must name that gate', async () => {
  const { d, file } = await ready();
  const rows = await scored(file, 150, 20, 100);
  await assert.rejects(() => evaluateAndRecord(file, 'P1', 'diff', rows), /candidate gate/);
  const weak = (input, context) => ({ ...decideGate(input, context), verdict: 'accepted' });
  const r = await evaluate(file, 'P1', 'diff', rows, weak);
  assert.equal(r.result.accepted, false);
  assert.equal(r.result.traps_passed.length, TRAPS.length);
  assert.match(await replayProblem(file, 'P1', 'diff'), /not accepted/);
  await rm(d, { recursive: true });
});

test('a gate that answers later is refused, and the call spends nothing', async () => {
  const { d, file } = await ready();
  const rows = await scored(file, 150, 20, 100);
  const later = async (input, context) => ({ ...decideGate(input, context), verdict: 'accepted' });
  await assert.rejects(() => evaluate(file, 'P1', 'diff', rows, later), /answer at once/);
  assert.throws(() => runTraps(TRAPS, later), /answer at once/);
  assert.equal((await evaluate(file, 'P1', 'diff', rows)).k, 1);
  await rm(d, { recursive: true });
});

test('a stored report with settings that cannot finish fails at once', async () => {
  const { d, file } = await ready();
  const r = await evaluate(file, 'P1', 'diff', await scored(file, 150, 20, 100));
  const { digest, ...body } = JSON.parse(await readFile(r.file, 'utf8'));
  const forged = { ...body, params: { ...body.params, effect: 1 } };
  await writeFile(r.file, JSON.stringify({ ...forged, digest: sha256(JSON.stringify(forged)) }));
  assert.equal((await verifyReport(r.file)).ok, false);
  await rm(d, { recursive: true });
});

test('the case set is frozen once, before any scoring', async () => {
  const { d, file } = await home();
  await assert.rejects(() => nextSlice(file), /no frozen replay set/);
  await assert.rejects(() => evaluate(file, 'P1', 'diff', [{ id: ids.find((i) => splitOf(i) === 'heldout'), m_old: 0, m_new: 1 }]), /no frozen replay set/);
  await assert.rejects(() => freezeReplaySet(file, ids, 0), /whole number/);
  await assert.rejects(() => freezeReplaySet(file, ['case-5'], 270), /no full slice/);
  await assert.rejects(() => freezeReplaySet(file, ['a', 'a', 7], 1), /unique text ids/);
  const frozen = await freezeReplaySet(file, ids, SIZE);
  assert.equal(frozen.size, SIZE);
  assert.ok(frozen.slices >= 7);
  await assert.rejects(() => freezeReplaySet(file, ids, 10), /already frozen/);
  await rm(d, { recursive: true });
});

test('only the exact next slice is scored, so cases cannot be picked by hand', async () => {
  const { d, file } = await ready();
  const rows = await scored(file, 150, 20, 100);
  const spare = heldoutSlice(ids.filter((i) => splitOf(i) === 'heldout'), SIZE + 1, 1)[0];
  await assert.rejects(() => evaluate(file, 'P1', 'diff', rows.slice(1)), /exactly the next slice/);
  await assert.rejects(() => evaluate(file, 'P1', 'diff', [{ ...rows[0], id: spare }, ...rows.slice(1)]), /exactly the next slice/);
  assert.equal((await evaluate(file, 'P1', 'diff', rows)).k, 1, 'a refused call spends nothing');
  await assert.rejects(() => evaluate(file, 'P2', 'other', rows), /exactly the next slice/);
  assert.notDeepEqual((await nextSlice(file)).sort(), rows.map((r) => r.id).sort());
  await rm(d, { recursive: true });
});

test('dev cases and bad ids are refused', async () => {
  const { d, file } = await ready();
  const rows = await scored(file, 150, 20, 100);
  const devId = ids.find((i) => splitOf(i) === 'dev');
  await assert.rejects(() => evaluate(file, 'P1', 'diff', [{ ...rows[0], id: devId }, ...rows.slice(1)]), /held-out cases only/);
  await assert.rejects(() => evaluate(file, 'P1', 'diff', [{ m_old: 0, m_new: 1 }, ...rows]), /held-out cases only/);
  await assert.rejects(() => evaluate(file, 'P1', 'diff', []), /bad data/);
  await assert.rejects(() => evaluate(file, 'P1', 'diff', 'abc'), /bad data/);
  await assert.rejects(() => evaluate(file, 'P1', 'diff', [{ ...rows[0], m_new: true }]), /bad data/);
  await rm(d, { recursive: true });
});

test('every evaluation counts toward k, also a failed one, and parallel calls share the lock', async () => {
  const { d, file } = await ready();
  const a = await evaluate(file, 'P1', 'diff', await scored(file, 90, 90, 90));
  const b = await evaluate(file, 'P1', 'diff', await scored(file, 90, 90, 90));
  assert.deepEqual([a.k, b.k], [1, 2]);
  const rows = await scored(file, 90, 90, 90);
  const other = file.replaceAll('\\', '/');
  const spelled = await Promise.allSettled([evaluate(file, 'P1', 'diff', rows), evaluate(other, 'P1', 'diff', rows)]);
  assert.equal(spelled.filter((r) => r.status === 'fulfilled').length, 1, 'two spellings of one path share the lock');
  await rm(d, { recursive: true });
});

test('an edited report fails, and the door closes', async () => {
  const { d, file } = await ready();
  const r = await evaluate(file, 'P1', 'diff', await scored(file, 150, 20, 100));
  assert.equal((await verifyReport(r.file)).ok, true);
  const data = JSON.parse(await readFile(r.file, 'utf8'));
  const original = JSON.stringify(data);
  data.cases[0].m_new = 1 - data.cases[0].m_new;
  await writeFile(r.file, JSON.stringify(data));
  assert.equal((await verifyReport(r.file)).ok, false);
  assert.match(await replayProblem(file, 'P1', 'diff'), /failed verification/);
  await writeFile(r.file, original);
  assert.equal(await replayProblem(file, 'P1', 'diff'), null);
  await rm(r.file);
  assert.match(await replayProblem(file, 'P1', 'diff'), /failed verification/);
  await rm(d, { recursive: true });
});

test('a report with a fresh digest still fails against its own cases and the ledger', async () => {
  const { d, file } = await ready();
  const r = await evaluate(file, 'P1', 'diff', await scored(file, 150, 20, 100));
  const seal = ({ digest, ...body }) => ({ ...body, digest: sha256(JSON.stringify(body)) });
  const data = JSON.parse(await readFile(r.file, 'utf8'));
  const flipped = structuredClone(data);
  for (const c of flipped.cases) c.m_new = c.m_old;
  await writeFile(r.file, JSON.stringify(seal(flipped)));
  assert.match((await verifyReport(r.file)).reason, /stored decision differs/);
  await writeFile(r.file, JSON.stringify(seal({ ...data, note: 'another report' })));
  assert.equal((await verifyReport(r.file)).ok, true);
  assert.match(await replayProblem(file, 'P1', 'diff'), /not the one that was recorded/);
  await writeFile(r.file, 'null');
  assert.equal((await verifyReport(r.file)).ok, false);
  await rm(d, { recursive: true });
});

test('a broken ledger stops the evaluation, so k cannot go back', async () => {
  const { d, file } = await ready();
  await evaluate(file, 'P1', 'diff', await scored(file, 90, 90, 90));
  const rows = await scored(file, 90, 90, 90);
  await appendFile(file, 'not json\n');
  await assert.rejects(() => evaluate(file, 'P1', 'diff', rows), /ledger is broken/);
  await assert.rejects(() => nextSlice(file), /ledger is broken/);
  await rm(d, { recursive: true });
});
