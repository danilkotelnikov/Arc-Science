// arc-hoh tree (2026-11-06): branch state, support score and the order of the next check (concept/tree-hoh.md, section 1).
// A tree is a pure fold over its recorded events, so a session replays to the same tree. Code decides from recorded numbers.
// The score is a heuristic until the caller names the checks that calibration measured.
// Limit: this module trusts the s, e and group of a register event. Harness code must write those events, and never a model.
// Events: { type: 'branch', id, hypothesis, criterion, prior }
//         { type: 'register', branch, id, s, e, cost, group?, decisive? }
//         { type: 'observe', id, branch, check, passed }
//         { type: 'state', branch, to, reason }
//         { type: 'operator', branch, directive: 'pursue'|'park'|'drop', reason }
export const STATES = Object.freeze(['sketched', 'probing', 'live', 'parked', 'refuted', 'merged', 'confirmed-limited']);
export const PRIOR_MIN = 0.35;
export const PRIOR_MAX = 0.65;
export const Q_MIN = 0.02;
export const DECISIVE_E = 0.95;

// The steps an agent may take. The operator may take any step, and code only refutes.
const NEXT = {
  sketched: ['probing', 'parked'], probing: ['live', 'parked'], live: ['parked', 'merged', 'confirmed-limited'],
  parked: ['probing', 'live'], refuted: [], merged: [], 'confirmed-limited': ['parked'],
};
export const ACTIVE = new Set(['probing', 'live']);

const logit = (q) => Math.log(q / (1 - q));
const expit = (x) => 1 / (1 + Math.exp(-x));
const clampPrior = (p) => (typeof p === 'number' && Number.isFinite(p) ? Math.min(PRIOR_MAX, Math.max(PRIOR_MIN, p)) : 0.5);
const logLr = (c, passed) => Math.log(passed ? c.s / (1 - c.e) : (1 - c.s) / c.e);
const groupOf = (c) => (c.group == null ? `check:${c.id}` : `group:${c.group}`);
const unit = (x) => typeof x === 'number' && x > 0 && x < 1;
const name = (x) => typeof x === 'string' && x !== '';

/** Each group of same-data checks moves the score once, by its strongest observation. */
function rescore(b, calibrated) {
  const best = new Map();
  for (const o of b.observations) {
    const c = b.checks[o.check], g = groupOf(c), lr = logLr(c, o.passed), old = best.get(g);
    // On a tie the failed result wins, so the order of the events does not change the score.
    if (!old || Math.abs(lr) > Math.abs(old.lr) || (Math.abs(lr) === Math.abs(old.lr) && lr < old.lr)) best.set(g, { lr, c });
  }
  b.q = expit(logit(b.prior) + [...best.values()].reduce((sum, x) => sum + x.lr, 0));
  const used = [...best.values()];
  b.score_kind = used.length > 0 && used.every((x) => calibrated.has(x.c.id)) ? 'probability' : 'heuristic';
}

const move = (b, to, by, reason) => { b.state = to; b.history.push({ to, by, reason }); };

function applyCode(b, passedDecisive) {
  const refute = passedDecisive ?? (b.q < Q_MIN ? `the score fell below ${Q_MIN}` : null);
  if (!refute || b.state === 'refuted' || b.state === 'merged') return;
  const warning = `held by the operator: ${refute}`;
  if (!b.pinned && !b.held) move(b, 'refuted', 'code', refute);
  else if (!b.warnings.includes(warning)) b.warnings.push(warning);
}

/** Fold the events into a tree: { branches, refused }. Refused events stay listed with their reason.
 *  `calibrated` holds the ids of the checks that calibration measured. It comes from the caller, never from an event. */
export function buildTree(events, { calibrated = [] } = {}) {
  const measured = new Set(calibrated);
  const branches = Object.create(null), refused = [], seen = new Set();
  const refuse = (event, reason) => { refused.push({ event, reason }); };
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') { refuse(ev, 'an event must be an object'); continue; }
    if (ev.type === 'branch') {
      if (!name(ev.id)) { refuse(ev, 'a branch needs a text id'); continue; }
      if (branches[ev.id]) { refuse(ev, 'this branch already exists'); continue; }
      const prior = clampPrior(ev.prior);
      branches[ev.id] = {
        id: ev.id, parent: ev.parent ?? null, hypothesis: ev.hypothesis, criterion: ev.criterion, prior, q: prior, score_kind: 'heuristic',
        state: 'sketched', history: [{ to: 'sketched', by: 'agent', reason: 'proposed' }], checks: Object.create(null), observations: [], warnings: [], pinned: false, held: false,
      };
      continue;
    }
    const b = branches[ev.branch];
    if (!b) { refuse(ev, 'no such branch'); continue; }
    if (ev.type === 'register') {
      if (!name(ev.id)) refuse(ev, 'a check needs a text id');
      else if (!unit(ev.s) || !unit(ev.e) || !(ev.s + ev.e > 1)) refuse(ev, 'a check needs s and e between 0 and 1, and s + e above 1, or it says nothing');
      else if (!(typeof ev.cost === 'number' && ev.cost > 0)) refuse(ev, 'a check needs a positive cost');
      else if (b.checks[ev.id]) refuse(ev, 'this check is already registered');
      else b.checks[ev.id] = { id: ev.id, s: ev.s, e: ev.e, cost: ev.cost, group: ev.group, decisive: ev.decisive === true };
    } else if (ev.type === 'observe') {
      const c = b.checks[ev.check];
      if (!c) refuse(ev, 'this check was not registered before its result');
      else if (!name(ev.id)) refuse(ev, 'an observation needs a text id');
      else if (seen.has(ev.id)) refuse(ev, 'this observation is already counted in the tree');
      else if (typeof ev.passed !== 'boolean') refuse(ev, 'a result must be true or false');
      else {
        seen.add(ev.id);
        b.observations.push({ id: ev.id, check: ev.check, passed: ev.passed });
        rescore(b, measured);
        applyCode(b, c.decisive && !ev.passed && c.e >= DECISIVE_E ? `decisive check ${c.id} failed` : null);
      }
    } else if (ev.type === 'state') {
      if (!NEXT[b.state]?.includes(ev.to)) refuse(ev, `no step from ${b.state} to ${ev.to}`);
      else if (b.pinned && ev.to === 'parked') refuse(ev, 'the operator keeps this branch');
      else if (b.held) refuse(ev, 'the operator holds this branch');
      else if (ev.to === 'confirmed-limited' && !(b.q >= 0.5 && b.observations.some((o) => o.passed && b.checks[o.check].decisive))) refuse(ev, 'confirmed-limited needs a passed decisive check and a score of at least 0.5');
      else move(b, ev.to, 'agent', ev.reason ?? '');
    } else if (ev.type === 'operator') {
      if (ev.directive === 'pursue') { b.pinned = true; b.held = false; move(b, 'live', 'operator', ev.reason ?? ''); }
      else if (ev.directive === 'park') { b.pinned = false; b.held = true; move(b, 'parked', 'operator', ev.reason ?? ''); }
      else if (ev.directive === 'drop') { b.pinned = false; b.held = true; move(b, 'refuted', 'operator', ev.reason ?? ''); }
      else refuse(ev, 'unknown directive');
    } else refuse(ev, 'unknown event');
  }
  return { branches, refused };
}

/** The cost of the better choice at q: keep a wrong branch (cfp) or lose a right one (cfn). */
export const loss = (q, cfp = 1, cfn = 1) => Math.min(cfp * (1 - q), cfn * q);

const after = (q, c) => {
  const pass = c.s * q + (1 - c.e) * (1 - q);
  return { pass, plus: (c.s * q) / pass, minus: ((1 - c.s) * q) / (1 - pass) };
};

/** One-step value of information. Rounding must not make it negative, and a tiny rest counts as zero. */
export function voi(q, c, cfp = 1, cfn = 1) {
  const { pass, plus, minus } = after(q, c);
  const v = loss(q, cfp, cfn) - pass * loss(plus, cfp, cfn) - (1 - pass) * loss(minus, cfp, cfn);
  return v > 1e-12 ? v : 0;
}

/** Two-step value of c, then the best other check after each result, with its cost. */
function twoStep(q, c, others, cfp, cfn) {
  const { pass, plus, minus } = after(q, c);
  const bestAfter = (r) => others.reduce((a, o) => {
    const rate = voi(r, o, cfp, cfn) / o.cost;
    return rate > a.rate ? { rate, v: voi(r, o, cfp, cfn), cost: o.cost } : a;
  }, { rate: 0, v: 0, cost: 0 });
  const a = bestAfter(plus), b = bestAfter(minus);
  const value = loss(q, cfp, cfn) - pass * (loss(plus, cfp, cfn) - a.v) - (1 - pass) * (loss(minus, cfp, cfn) - b.v);
  return { value: value > 1e-12 ? value : 0, cost: c.cost + pass * a.cost + (1 - pass) * b.cost };
}

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The next check over all active branches: the highest value per cost, ties to the smaller id. Null when none has value.
 *  ponytail: a full scan on every step. Use the lazy heap of the design when many branches run at once. */
export function nextCheck(tree, { cfp = 1, cfn = 1, limits } = {}) {
  let top = null;
  for (const id of Object.keys(tree.branches).sort(byId)) {
    const b = tree.branches[id];
    if (!ACTIVE.has(b.state)) continue;
    const usedChecks = new Set(b.observations.map((o) => o.check));
    const usedGroups = new Set(b.observations.map((o) => groupOf(b.checks[o.check])));
    // With limits, a branch that is not listed has no budget, and a check must fit in what is left: cost <= limit - spent.
    const left = limits ? (limits[id] ?? 0) - b.observations.reduce((sum, o) => sum + b.checks[o.check].cost, 0) : Infinity;
    const open = Object.values(b.checks).filter((c) => !usedChecks.has(c.id) && !usedGroups.has(groupOf(c)) && c.cost <= left).sort((x, y) => byId(x.id, y.id));
    let rows = open.map((c) => ({ c, steps: 1, priority: voi(b.q, c, cfp, cfn) / c.cost }));
    if (open.length > 1 && rows.every((r) => r.priority === 0)) {
      // The spec names the strongest check, but a weaker pair can flip the decision when the strongest cannot.
      rows = open.map((c) => {
        const { value, cost } = twoStep(b.q, c, open.filter((o) => o !== c && groupOf(o) !== groupOf(c) && o.cost <= left - c.cost), cfp, cfn);
        return { c, steps: 2, priority: value / cost };
      });
    }
    for (const r of rows) {
      if (r.priority > 0 && (!top || r.priority > top.priority)) top = { branch: id, check: r.c.id, priority: r.priority, steps: r.steps };
    }
  }
  return top;
}

// Slice D1 (2026-11-09): DEC-xxxx decision records and 13-state resumable task graph with hash-chained ledger.
import crypto from 'node:crypto';

export const TASK_STATES = Object.freeze([
  'Planned',
  'Running',
  'Checkpointed',
  'Waiting',
  'Parked',
  'Paused',
  'Branching',
  'Merged',
  'Rework',
  'Failed',
  'Asked',
  'Cancelled',
  'Done',
]);

const DEC_ID_RE = /^DEC-\d{4,}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

export function validateDecisionRecord(rec) {
  const errors = [];
  if (!rec || typeof rec !== 'object') return { ok: false, errors: ['Decision record must be an object'] };
  if (typeof rec.id !== 'string' || !DEC_ID_RE.test(rec.id)) errors.push('id must match DEC-xxxx');
  if (typeof rec.title !== 'string' || !rec.title.trim()) errors.push('title is required');
  if (typeof rec.decision !== 'string' || !rec.decision.trim()) errors.push('decision is required');
  if (typeof rec.rationale !== 'string' || !rec.rationale.trim()) errors.push('rationale is required');
  if (!Array.isArray(rec.alternatives) || rec.alternatives.length === 0) errors.push('alternatives must be a non-empty array');
  if (typeof rec.date !== 'string' || !ISO_DATE_RE.test(rec.date)) errors.push('date must be an ISO date string');
  return { ok: errors.length === 0, errors };
}

export function createDecisionRecord(input = {}) {
  const rec = {
    id: input.id ?? 'DEC-0001',
    title: String(input.title ?? '').trim(),
    decision: String(input.decision ?? '').trim(),
    rationale: String(input.rationale ?? '').trim(),
    alternatives: Array.isArray(input.alternatives) ? [...input.alternatives] : [],
    evidence: Array.isArray(input.evidence) ? [...input.evidence] : [],
    date: input.date ?? new Date().toISOString().slice(0, 10),
  };
  const check = validateDecisionRecord(rec);
  if (!check.ok) {
    throw new Error(`Invalid decision record: ${check.errors.join('; ')}`);
  }
  return Object.freeze(rec);
}

function hashStep(prevHash, payload) {
  return crypto.createHash('sha256').update(`${prevHash}|${JSON.stringify(payload)}`).digest('hex');
}

export function verifyTaskLedger(ledger = []) {
  let prev = '0'.repeat(64);
  for (let i = 0; i < ledger.length; i++) {
    const entry = ledger[i];
    if (!entry || entry.prevHash !== prev) return { ok: false, brokenAt: i };
    const expected = hashStep(prev, { seq: entry.seq, taskId: entry.taskId, from: entry.from, to: entry.to, reason: entry.reason });
    if (entry.hash !== expected) return { ok: false, brokenAt: i };
    prev = entry.hash;
  }
  return { ok: true, headHash: prev, length: ledger.length };
}

export function createTaskGraph(initial = {}) {
  const tasks = new Map();
  const decisions = new Map();
  const ledger = Array.isArray(initial.ledger) ? structuredClone(initial.ledger) : [];

  if (Array.isArray(initial.tasks)) {
    for (const t of initial.tasks) {
      tasks.set(t.id, structuredClone(t));
    }
  }
  if (Array.isArray(initial.decisions)) {
    for (const d of initial.decisions) {
      decisions.set(d.id, createDecisionRecord(d));
    }
  }

  function appendLedger(taskId, from, to, reason = '') {
    const prevHash = ledger.length > 0 ? ledger[ledger.length - 1].hash : '0'.repeat(64);
    const seq = ledger.length + 1;
    const payload = { seq, taskId, from, to, reason };
    const hash = hashStep(prevHash, payload);
    const entry = { ...payload, prevHash, hash };
    ledger.push(entry);
    return entry;
  }

  function addTask({ id, title, state = 'Planned', parent = null }) {
    if (!name(id)) throw new Error('Task needs a non-empty id');
    if (!TASK_STATES.includes(state)) throw new Error(`Unknown task state: ${state}`);
    if (tasks.has(id)) throw new Error(`Task already exists: ${id}`);
    const task = { id, title: String(title ?? id), state, parent, history: [{ to: state, reason: 'created' }] };
    tasks.set(id, task);
    appendLedger(id, null, state, 'created');
    return structuredClone(task);
  }

  function transition(id, to, reason = '') {
    const task = tasks.get(id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    if (!TASK_STATES.includes(to)) throw new Error(`Unknown task state: ${to}`);
    const from = task.state;
    task.state = to;
    task.history.push({ from, to, reason });
    appendLedger(id, from, to, reason);
    return structuredClone(task);
  }

  function recordDecision(input) {
    const rec = createDecisionRecord(input);
    decisions.set(rec.id, rec);
    return rec;
  }

  function snapshot() {
    return {
      tasks: [...tasks.values()].map((t) => structuredClone(t)),
      decisions: [...decisions.values()].map((d) => structuredClone(d)),
      ledger: structuredClone(ledger),
    };
  }

  return {
    addTask,
    transition,
    recordDecision,
    getTask: (id) => (tasks.has(id) ? structuredClone(tasks.get(id)) : null),
    getDecision: (id) => decisions.get(id) ?? null,
    snapshot,
    verifyLedger: () => verifyTaskLedger(ledger),
  };
}

export function checkpointRun(graph, meta = {}) {
  const snap = graph.snapshot();
  for (const t of snap.tasks) {
    if (t.state === 'Running') {
      graph.transition(t.id, 'Checkpointed', meta.reason ?? 'checkpoint');
    }
  }
  const updated = graph.snapshot();
  const verification = verifyTaskLedger(updated.ledger);
  if (!verification.ok) {
    throw new Error(`Cannot checkpoint broken ledger at index ${verification.brokenAt}`);
  }
  return {
    version: 1,
    createdAt: meta.createdAt ?? new Date().toISOString(),
    headHash: verification.headHash,
    state: updated,
  };
}

export function resumeRun(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object' || !checkpoint.state) {
    throw new Error('Invalid checkpoint payload');
  }
  const verification = verifyTaskLedger(checkpoint.state.ledger);
  if (!verification.ok || verification.headHash !== checkpoint.headHash) {
    throw new Error('Checkpoint ledger hash chain verification failed');
  }
  const graph = createTaskGraph(checkpoint.state);
  for (const t of checkpoint.state.tasks) {
    if (t.state === 'Checkpointed') {
      graph.transition(t.id, 'Running', 'resumed');
    }
  }
  return graph;
}

