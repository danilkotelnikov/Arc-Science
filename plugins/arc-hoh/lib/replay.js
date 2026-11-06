// arc-hoh replay gate (2026-11-06): decides whether a patch to the harness's own policy may go to the user.
// Cases are recorded runs that a runner scored 0 or 1 under the old policy and the patched one. Acceptance needs all of:
//   1. no trap passes: the real gate must refuse every known false pass;
//   2. no regression: the one-sided bootstrap lower bound of the mean paired difference is above -epsilon;
//   3. a gain: that same bound is above zero;
//   4. enough discordant pairs for the chosen effect and power.
// The level is spent as alpha_k = alpha * 6 / (pi^2 k^2) over all evaluations ever made, and each uses a held-out
// slice never used before. The result only opens the door to the user's approval, which stays separate and required.
// The case set is frozen once, and each evaluation must score exactly its next slice, so nobody picks cases by hand.
// The traps run on the gate the caller names as the patched one. This module cannot prove that gate comes from the diff.
// It also cannot check the 0 and 1 scores themselves: a runner that invents scores defeats it. The ledger has no key,
// so someone who rewrites the whole ledger and its reports, or deletes them, also defeats it.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkDigest, decideGate, ledgerRows, sha256, verifyLedger, withLedger } from './gates.js';

const SALT = 'arc-replay-1';
export const REPLAY_VERSION = 'replay-1';
export const DEFAULTS = Object.freeze({ alpha: 0.05, epsilon: 0.02, effect: 0.2, power: 0.8, B: 2000, seed: 0 });
// The bound needs at least TAIL resamples below it, or it stops tightening as k grows and the budget is not honoured.
// ponytail: past about k = 55 the resamples pass MAX_B and evaluation stops. Use an exact bound if that many patches are real.
export const MAX_B = 1000000;
const TAIL = 10;
const MIN_EFFECT = 0.05;
const MAX_PAIRS = 5000;

/** Significance spent on the k-th evaluation over all time. The series sums to alpha. */
export const alphaK = (alpha, k) => alpha * 6 / (Math.PI ** 2 * k * k);

// Binomial sums in log space, so that a long list does not underflow.
const logFact = [0];
const lf = (n) => { for (let i = logFact.length; i <= n; i++) logFact[i] = logFact[i - 1] + Math.log(i); return logFact[n]; };
const pmf = (n, i, p) => Math.exp(lf(n) - lf(i) - lf(n - i) + i * Math.log(p) + (n - i) * Math.log1p(-p));
function upperTail(n, c, p) {
  let sum = 0;
  for (let i = c; i <= n; i++) sum += pmf(n, i, p);
  return sum;
}

/** Exact one-sided sign test on the discordant pairs. It is supplementary evidence and never decides alone. */
export function signTestP(d) {
  const pos = d.filter((x) => x > 0).length, n = pos + d.filter((x) => x < 0).length;
  return n === 0 ? 1 : Math.min(1, upperTail(n, pos, 0.5));
}

/** A small seeded generator. Math.random has no seed, and sha256 per draw makes a simulation take minutes. */
export function mulberry(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One-sided lower bound (level 1 - alpha) of the mean of d, by the percentile bootstrap over cases. Seeded. */
export function pairedLowerBound(d, alpha, B = 2000, seed = 0) {
  const n = d.length, rng = mulberry(seed), means = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += d[Math.floor(rng() * n)];
    means[b] = sum / n;
  }
  means.sort();
  return means[Math.max(0, Math.floor(alpha * (B + 1)) - 1)];
}

function power(n, effect, alpha) {
  let c = n + 1, tail = 0;
  while (c > 0 && tail + pmf(n, c - 1, 0.5) <= alpha) { c--; tail += pmf(n, c, 0.5); }
  return upperTail(n, c, 0.5 + effect / 2);
}

const pairsMemo = new Map();
/** Fewest discordant pairs for the exact sign test to hold the power. Power saw-tooths with n, so the
 *  answer is the first n from which it stays above the target for the next 25 values. */
export function minDiscordantPairs(effect = 0.2, alpha = 0.05, target = 0.8) {
  // The search below ends only inside these ranges: a certain gain or a tiny one never settles.
  if (!(effect >= MIN_EFFECT && effect < 1)) throw new Error(`the effect must lie from ${MIN_EFFECT} to below 1`);
  if (!(target > 0 && target < 1)) throw new Error('the power must lie between 0 and 1');
  if (!(alpha > 0 && alpha < 1)) throw new Error('alpha must lie between 0 and 1');
  const key = `${effect}|${alpha}|${target}`;
  if (pairsMemo.has(key)) return pairsMemo.get(key);
  let n = 1, run = 0;
  for (let m = 1; run < 25; m++) {
    if (m > MAX_PAIRS) throw new Error(`these settings need more than ${MAX_PAIRS} discordant pairs`);
    if (power(m, effect, alpha) >= target) { if (run++ === 0) n = m; } else run = 0;
  }
  pairsMemo.set(key, n);
  return n;
}

/** 'dev' or 'heldout', fixed by the id alone. Dev cases may be used while building a patch. */
export const splitOf = (id) => (parseInt(sha256(`${SALT}\0${id}`).slice(0, 8), 16) % 2 ? 'heldout' : 'dev');

/** The k-th block of `size` held-out ids, in a fixed hash order. Blocks never overlap. */
export function heldoutSlice(ids, k, size) {
  const order = (id) => sha256(`${SALT}-order\0${id}`);
  const sorted = ids.map((id) => [order(id), id]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((r) => r[1]);
  const block = sorted.slice((k - 1) * size, k * size);
  if (block.length < size) throw new Error(`the held-out set has no fresh slice number ${k} of ${size} cases`);
  return block;
}

const row = (extra = {}) => ({ id: 'A1', command: 'npm test', exit: 0, excerpt: 'ok 12', ...extra });
/** Known false passes. The gate must refuse each one. Each entry overrides one part of an otherwise good gate call. */
export const TRAPS = Object.freeze([
  { id: 'T01-forged-passed-flag', why: 'A row claims passed while its exit code is 1.', checks: [row({ exit: 1, passed: true })] },
  { id: 'T02-empty-acceptance-list', why: 'A gate call with no check proves nothing.', checks: [] },
  { id: 'T03-swapped-command', why: 'The row belongs to an easier command than the proposal lists.', checks: [row({ command: 'true' })] },
  { id: 'T04-timeout-with-zero-exit', why: 'A check that timed out is not a pass, whatever exit code it left.', checks: [row({ timed_out: true })] },
  { id: 'T05-duplicate-with-a-failure', why: 'Two rows for one check, and the second failed.', checks: [row(), row({ exit: 2 })] },
  { id: 'T06-boolean-exit-code', why: 'A boolean is not the integer exit code zero.', checks: [row({ exit: false })] },
  { id: 'T07-planned-check-never-ran', why: 'The proposed check has no row, and another check passed in its place.', checks: [row({ id: 'other', command: 'echo ok' })] },
  { id: 'T08-string-exit-code', why: 'The string "0" is not the integer 0.', checks: [row({ exit: '0' })] },
  { id: 'T09-kept-behaviour-broken', why: 'A check that guards earlier behaviour failed.', preservation: [{ id: 'baseline-1', ok: false }] },
]);

/** Run each trap through the gate. `passed` is true when the gate wrongly accepts it. */
export function runTraps(traps = TRAPS, gate = decideGate) {
  return traps.map(({ id, why, ...parts }) => {
    const input = {
      candidate: 'c', cycle: 1, builder: 'a', reviewer: 'b', checks: [row()], probes: [{ id: 'p', description: 'empty input', result: 'pass' }],
      preservation: [{ id: 'k', ok: true }], findings: [], requirements: [{ id: 'r', state: 'verified' }], ...parts,
    };
    const context = { freeze: { candidate: 'c', caller: 'lead' }, propose: { seq: 1, checks: ['npm test'], digests: [checkDigest('npm test')] }, fileCheck: { ok: true }, caller: 'reviewer' };
    const got = gate(input, context);
    if (typeof got?.then === 'function') {
      got.then(undefined, () => {});
      throw new Error('a gate must answer at once: a promise has no verdict to read');
    }
    return { id, passed: got.verdict === 'accepted' };
  });
}

function valid(cases) {
  if (!Array.isArray(cases) || cases.length === 0 || !cases.every((c) => c && typeof c === 'object')) return false;
  const ids = cases.map((c) => c.id);
  if (!ids.every((i) => typeof i === 'string') || new Set(ids).size !== ids.length) return false;
  return cases.every((c) => [c.m_old, c.m_new].every((m) => m === 0 || m === 1));
}

/** The acceptance rule. Pure, so a stored report can be decided again. */
export function decide(cases, traps, k, params = {}) {
  const p = { ...DEFAULTS, ...params }, reasons = [];
  const out = { accepted: false, k, alpha_k: alphaK(p.alpha, k), reasons };
  const sane = p.effect >= MIN_EFFECT && p.effect < 1 && p.alpha > 0 && p.alpha < 1 && p.power > 0 && p.power < 1
    && p.epsilon >= 0 && Number.isInteger(p.B) && p.B >= 1 && p.B <= MAX_B;
  if (!sane) {
    reasons.push('bad settings: effect, alpha, power, epsilon or B lies outside its range');
    return out;
  }
  if (!valid(cases)) {
    reasons.push('bad data: cases must be non-empty, have unique string ids and scores that are the integers 0 or 1');
    return out;
  }
  const d = cases.map((c) => c.m_new - c.m_old);
  let needed;
  try { needed = minDiscordantPairs(p.effect, p.alpha, p.power); } catch (err) {
    reasons.push(`bad settings: ${err.message}`);
    return out;
  }
  const B = Math.max(p.B, Math.ceil(TAIL / out.alpha_k));
  if (B > MAX_B) {
    reasons.push(`error budget: level ${out.alpha_k} at k=${k} needs more than ${MAX_B} resamples`);
    return out;
  }
  const lower = pairedLowerBound(d, out.alpha_k, B, p.seed);
  const passed = traps.filter((t) => t.passed !== false).map((t) => t.id);
  const discordant = d.filter(Boolean).length;
  Object.assign(out, {
    n: d.length, mean: d.reduce((a, b) => a + b, 0) / d.length, lower, B, n_discordant: discordant, pairs_needed: needed,
    sign_p: signTestP(d), traps: traps.length, traps_passed: passed,
  });
  if (traps.length === 0) reasons.push('no trap results: the trap set must run');
  if (passed.length) reasons.push(`trap passed the gate: ${passed.join(', ')}`);
  if (!(lower > -p.epsilon)) reasons.push(`regression: lower bound ${lower.toFixed(4)} is not above -${p.epsilon}`);
  if (!(lower > 0)) reasons.push(`no gain: lower bound ${lower.toFixed(4)} is not above zero`);
  if (discordant < needed) reasons.push(`too few discordant pairs: ${discordant} of the ${needed} needed`);
  out.accepted = reasons.length === 0;
  return out;
}

/** The replay harness: score each recorded trace under both policies (functions that return 0 or 1). */
export const runCases = (traces, oldPolicy, newPolicy) => traces.map((t) => ({ id: t.id, m_old: oldPolicy(t), m_new: newPolicy(t) }));

const digestOf = ({ digest, ...body }) => sha256(JSON.stringify(body));
const reportsDir = (ledger) => path.join(path.dirname(ledger), 'replay');

async function replayState(ledger) {
  const chain = await verifyLedger(ledger);
  if (!chain.ok) throw new Error(`the ledger is broken at entry ${chain.badAt}: k and the used slices cannot be trusted`);
  const rows = await ledgerRows(ledger);
  return { set: rows.find((r) => r.type === 'replay-set') ?? null, earlier: rows.filter((r) => r.type === 'replay-eval') };
}

const sliceOf = ({ set, earlier }) => {
  if (!set) throw new Error('no frozen replay set: call freezeReplaySet before any scoring');
  return heldoutSlice(set.ids, earlier.length + 1, set.size);
};

/** Fix the case set and the slice size once, before anyone scores a case. Only held-out ids are kept. */
export function freezeReplaySet(ledger, ids, size) {
  return withLedger(ledger, async (append) => {
    if (!Array.isArray(ids) || !ids.every((i) => typeof i === 'string' && i !== '') || new Set(ids).size !== ids.length) throw new Error('a replay set needs unique text ids');
    if (!Number.isInteger(size) || size < 1) throw new Error('the slice size must be a whole number from 1');
    const kept = ids.filter((i) => splitOf(i) === 'heldout');
    const slices = Math.floor(kept.length / size);
    if (slices < 1) throw new Error(`the set has no full slice of ${size} held-out cases`);
    if ((await replayState(ledger)).set) throw new Error('the replay set is already frozen');
    await append({ type: 'replay-set', goal: 'replay-set', ids: kept, size });
    return { size, slices };
  });
}

/** The ids the next evaluation must score. */
export const nextSlice = async (ledger) => sliceOf(await replayState(ledger));

/** Score a patch on a fresh held-out slice, store a hashed report and log it. Every evaluation counts toward k,
 *  accepted or not, so a failed attempt still spends significance. The settings are fixed: a caller cannot loosen them.
 *  `gate` is the accept gate with the patch applied, so that the traps test the patched rules. */
export function evaluateAndRecord(ledger, patch, diff, cases, gate) {
  // ponytail: one lock per process, like the rest of the ledger. Two processes on one ledger would need a file lock.
  return withLedger(ledger, async (append) => {
    if (typeof gate !== 'function') throw new Error('name the candidate gate: the traps must run on the patched rules');
    const ids = (Array.isArray(cases) ? cases : []).map((c) => c && c.id);
    if (ids.some((i) => typeof i !== 'string' || splitOf(i) !== 'heldout')) throw new Error('acceptance uses held-out cases only; dev cases are for building the patch');
    if (!valid(cases)) throw new Error('bad data: cases must be non-empty, have unique string ids and scores that are the integers 0 or 1');
    const state = await replayState(ledger);
    const expected = sliceOf(state);
    if (JSON.stringify([...ids].sort()) !== JSON.stringify([...expected].sort())) throw new Error('an evaluation must score exactly the next slice of the frozen set');
    const k = state.earlier.length + 1, traps = runTraps(TRAPS, gate);
    // The seeded bound depends on the order, so the report stores the order the decision used.
    const sorted = [...cases].sort((a, b) => (a.id < b.id ? -1 : 1));
    const report = {
      version: REPLAY_VERSION, patch, patch_digest: sha256(diff), k, params: { ...DEFAULTS },
      cases: sorted, traps, result: decide(sorted, traps, k),
    };
    report.digest = digestOf(report);
    const name = `replay-k${k}-${report.digest.slice(0, 12)}.json`;
    await mkdir(reportsDir(ledger), { recursive: true });
    const file = path.join(reportsDir(ledger), name);
    await writeFile(file, JSON.stringify(report, null, 1));
    await append({
      type: 'replay-eval', goal: patch, patch_digest: report.patch_digest, k, report_digest: report.digest,
      file: name, accepted: report.result.accepted, slice_ids: [...ids].sort(),
    });
    return { ...report, file };
  });
}

/** Decide a stored report again from its own cases and traps. Any edit makes this fail. */
export async function verifyReport(file) {
  let report;
  try { report = JSON.parse(await readFile(file, 'utf8')); } catch (err) { return { ok: false, reason: `unreadable: ${err.message}` }; }
  if (!report || typeof report !== 'object') return { ok: false, reason: 'unreadable: not a report' };
  if (report.digest !== digestOf(report)) return { ok: false, reason: 'digest mismatch' };
  if (JSON.stringify(decide(report.cases, report.traps, report.k, report.params)) !== JSON.stringify(report.result)) {
    return { ok: false, reason: 'stored decision differs from the one recomputed from the cases' };
  }
  return { ok: true, report };
}

/** Why a patch may not go to approval, or null: it needs an accepted, verified replay of this exact text. */
export async function replayProblem(ledger, patch, diff) {
  const digest = sha256(diff);
  const mine = (await replayState(ledger)).earlier.filter((e) => e.goal === patch && e.patch_digest === digest);
  if (mine.length === 0) return `no replay evaluation of the current ${patch}`;
  const last = mine[mine.length - 1];
  if (!last.accepted) return `the latest replay evaluation of ${patch} was not accepted (k=${last.k})`;
  const check = await verifyReport(path.join(reportsDir(ledger), last.file));
  if (!check.ok) return `the replay report for ${patch} failed verification: ${check.reason}`;
  if (check.report.digest !== last.report_digest || check.report.patch_digest !== digest) return `the replay report for ${patch} is not the one that was recorded`;
  return null;
}
