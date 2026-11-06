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
const ACTIVE = new Set(['probing', 'live']);

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

const power = (c) => Math.abs(logLr(c, true)) + Math.abs(logLr(c, false));
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The next check over all active branches: the highest value per cost, ties to the smaller id. Null when none has value.
 *  ponytail: a full scan on every step. Use the lazy heap of the design when many branches run at once. */
export function nextCheck(tree, { cfp = 1, cfn = 1 } = {}) {
  let top = null;
  for (const id of Object.keys(tree.branches).sort(byId)) {
    const b = tree.branches[id];
    if (!ACTIVE.has(b.state)) continue;
    const usedChecks = new Set(b.observations.map((o) => o.check));
    const usedGroups = new Set(b.observations.map((o) => groupOf(b.checks[o.check])));
    const open = Object.values(b.checks).filter((c) => !usedChecks.has(c.id) && !usedGroups.has(groupOf(c))).sort((x, y) => byId(x.id, y.id));
    let rows = open.map((c) => ({ c, steps: 1, priority: voi(b.q, c, cfp, cfn) / c.cost }));
    if (open.length > 1 && rows.every((r) => r.priority === 0)) {
      const c = open.reduce((x, y) => (power(y) > power(x) ? y : x));
      const { value, cost } = twoStep(b.q, c, open.filter((o) => o !== c && groupOf(o) !== groupOf(c)), cfp, cfn);
      rows = [{ c, steps: 2, priority: value / cost }];
    }
    for (const r of rows) {
      if (r.priority > 0 && (!top || r.priority > top.priority)) top = { branch: id, check: r.c.id, priority: r.priority, steps: r.steps };
    }
  }
  return top;
}
