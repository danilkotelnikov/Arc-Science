// arc-hoh branch budgets (2026-11-07): sequential halving (Karnin, Koren and Somekh, 2013; concept/tree-hoh.md, section 1).
// The budget is split evenly over about log(n) stages. After each stage the better branches stay, and each survivor gets
// a larger share. The paper proves its guarantee for rewards with one fixed distribution per branch. Our checks differ in
// strength and cost, so here the guarantee is a heuristic. Each stage can add only its own share, so total spending
// stays inside the budget whoever the operator keeps. A share a branch leaves unspent is not carried over.
import path from 'node:path';
import { ACTIVE } from './tree.js';

/** The stages for n branches. Each stage has { stage, branches, perBranch, keep }. */
export function plan(n, budget, eta = 2) {
  if (!Number.isInteger(n) || n < 1) throw new Error('the branch count must be a whole number from 1');
  if (!(typeof budget === 'number' && Number.isFinite(budget) && budget > 0)) throw new Error('a plan needs a positive budget');
  if (!Number.isInteger(eta) || eta < 2) throw new Error('eta must be a whole number from 2');
  const sizes = [n];
  while (sizes[sizes.length - 1] > 1) sizes.push(Math.ceil(sizes[sizes.length - 1] / eta));
  const count = Math.max(1, sizes.length - 1), share = budget / count;
  return {
    budget, eta,
    stages: Array.from({ length: count }, (_, i) => ({ stage: i, branches: sizes[i], perBranch: share / sizes[i], keep: sizes[Math.min(i + 1, sizes.length - 1)] })),
  };
}

/** What a branch has spent: the cost of its observed checks. */
export function spent(tree, id) {
  const b = tree.branches[id];
  return b ? b.observations.reduce((sum, o) => sum + b.checks[o.check].cost, 0) : 0;
}

function stageOf(p, stage) {
  if (!p.stages[stage]) throw new Error(`the plan has no stage ${stage}`);
  return p.stages[stage];
}

/** The spending limit of each kept branch at a stage: what it has spent plus this stage's share. A branch not listed has no
 *  budget. Call this once, at the start of a stage: a second call after spending would pay the share again. */
export function limitsFor(tree, p, stage, keep) {
  const { branches, perBranch } = stageOf(p, stage);
  if (keep.length > branches) throw new Error(`stage ${stage} pays for ${branches} branches, and ${keep.length} are listed: more branches than the plan holds`);
  return Object.fromEntries(keep.map((id) => [id, spent(tree, id) + perBranch]));
}

/** End a stage. Operator-kept branches fill the places first, then the best scores, ties to the smaller id. Returns the
 *  ids that stay and the events that park the rest. An operator-kept branch past the places stays live with no new budget. */
export function closeStage(tree, p, stage) {
  const { keep: places } = stageOf(p, stage);
  const active = Object.values(tree.branches).filter((b) => ACTIVE.has(b.state));
  const ranked = active.sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.q - x.q || (x.id < y.id ? -1 : 1));
  const keep = ranked.slice(0, places).map((b) => b.id);
  const events = ranked.slice(places).filter((b) => !b.pinned).map((b) => ({ type: 'state', branch: b.id, to: 'parked', reason: `dropped at stage ${stage + 1} of ${p.stages.length}, score ${b.q.toFixed(3)}` }));
  return { keep, events };
}


function normalizeFileKey(file) {
  if (typeof file !== 'string' || !file.trim()) return '';
  const raw = file.trim().replaceAll('\\', '/');
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) return '';
  const norm = path.posix.normalize(raw).replace(/^\.\//, '').toLowerCase();
  if (!norm || norm === '.' || norm === '..' || norm.startsWith('../')) return '';
  return norm;
}

/** Exclusive per-file write lease table and integrator-only commit guard (G2.5). */
export class FileLeaseTable {
  constructor() {
    this.leases = new Map();
  }

  acquire(file, role, agentId) {
    const key = normalizeFileKey(file);
    const id = typeof agentId === 'string' ? agentId.trim() : '';
    if (!key || typeof role !== 'string' || !role.trim() || !id) {
      return { ok: false, state: 'fail_bad_lease_args', error: 'file, role, and agentId are required' };
    }
    const existing = this.leases.get(key);
    if (existing && existing.agentId !== id) {
      return { ok: false, state: 'fail_lease_conflict', file: key, holder: existing };
    }
    const lease = { file: key, role: role.trim(), agentId: id, acquiredAt: new Date().toISOString() };
    this.leases.set(key, lease);
    return { ok: true, state: 'pass', lease };
  }

  release(file, agentId) {
    const key = normalizeFileKey(file);
    const id = typeof agentId === 'string' ? agentId.trim() : '';
    if (!key || !id) {
      return { ok: false, state: 'fail_bad_lease_args', error: 'file and agentId are required' };
    }
    const existing = this.leases.get(key);
    if (!existing) return { ok: true, state: 'pass', released: false };
    if (existing.agentId !== id) {
      return { ok: false, state: 'fail_not_holder', file: key, holder: existing.agentId };
    }
    this.leases.delete(key);
    return { ok: true, state: 'pass', released: true };
  }

  holderOf(file) {
    return this.leases.get(normalizeFileKey(file)) || null;
  }

  assertIntegratorCommit(role) {
    const clean = typeof role === 'string' ? role.trim().toLowerCase() : '';
    if (clean !== 'integrator') {
      return { ok: false, state: 'fail_non_integrator_commit', rule: 'LG-crew-commit', role: clean || null };
    }
    return { ok: true, state: 'pass', role: 'integrator' };
  }
}

/** Enforce cross-family builder/checker separation and prohibit self-review under R006 (G2.6). */
export function checkCrossFamilyVerdict({ builderFamily, checkerFamily, builderId, checkerId, verdict } = {}) {
  const bFam = typeof builderFamily === 'string' ? builderFamily.trim().toLowerCase() : '';
  const cFam = typeof checkerFamily === 'string' ? checkerFamily.trim().toLowerCase() : '';
  const bId = typeof builderId === 'string' ? builderId.trim() : '';
  const cId = typeof checkerId === 'string' ? checkerId.trim() : '';

  if (!bFam || !cFam || !bId || !cId) {
    return { ok: false, state: 'fail_missing_provenance', rule: 'R006' };
  }
  if (bId === cId) {
    return { ok: false, state: 'fail_self_review', rule: 'R006', builderId: bId, checkerId: cId };
  }
  if (bFam === cFam) {
    return { ok: false, state: 'fail_same_family_verdict', rule: 'R006', builderFamily: bFam, checkerFamily: cFam };
  }
  return {
    ok: true,
    state: 'pass',
    rule: 'R006',
    builderFamily: bFam,
    checkerFamily: cFam,
    builderId: bId,
    checkerId: cId,
    verdict: verdict ?? 'verified',
  };
}

/** Validate explicit maxTokens limit and record role/route token accounting row (G2.7). */
export function enforceSubagentCall({ role, route, maxTokens, usage = {} } = {}) {
  if (typeof role !== 'string' || !role.trim() || typeof route !== 'string' || !route.trim()) {
    return { ok: false, state: 'fail_bad_subagent_meta', error: 'role and route are required' };
  }
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    return { ok: false, state: 'fail_missing_max_tokens', error: 'every subagent call requires a positive integer maxTokens limit' };
  }
  const inputTokens = Number(usage.inputTokens ?? 0);
  const outputTokens = Number(usage.outputTokens ?? 0);
  const cachedTokens = Number(usage.cachedTokens ?? 0);
  if (![inputTokens, outputTokens, cachedTokens].every((v) => Number.isFinite(v) && v >= 0)) {
    return { ok: false, state: 'fail_invalid_usage', error: 'token counts must be non-negative numbers' };
  }
  if (outputTokens > maxTokens) {
    return { ok: false, state: 'fail_over_max_tokens', outputTokens, maxTokens };
  }
  return {
    ok: true,
    state: 'pass',
    row: {
      role: role.trim(),
      route: route.trim(),
      maxTokens,
      inputTokens,
      outputTokens,
      cachedTokens,
      totalTokens: inputTokens + outputTokens,
      recordedAt: new Date().toISOString(),
    },
  };
}
