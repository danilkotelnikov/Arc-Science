// arc-hoh claim graph (2026-11-07): claims, evidence, sources and experiments with their links. The unit of Arc is the claim.
// Each event changes one part of the graph, and only the nodes downstream of that part are worked out again.
// Events: { type: 'node', id, kind, text?, level?, doi?, group?, rung?, numbers? }
//         { type: 'link', from, rel: 'supports'|'contradicts'|'depends_on', to, lr? }
//         { type: 'retract', id, reason }
//         { type: 'trust', id, value }   the source reliability step writes this
// A node has a trust from 0 to 1: its own trust, times the lowest trust of what it depends on. A claim also has a score q,
// which starts at 0.5. Each supporter moves the log-odds by trust * log(lr), and a claim never scores above a claim it depends on.
// Limit: this module trusts the lr of a link and the group of a node. Harness code must write those, and never a model.
// The score is a heuristic. No field of an event can make it a probability.
const expit = (x) => 1 / (1 + Math.exp(-x));
const KINDS = new Set(['claim', 'evidence', 'source', 'experiment']);
// The evidence levels of policy section 11, strongest first.
export const LEVELS = Object.freeze(['measured', 'published', 'simulated', 'architecture', 'target']);
const name = (x) => typeof x === 'string' && x !== '';

export const createGraph = () => ({ nodes: new Map(), feeds: new Map(), inputs: new Map(), refused: [] });

/** The nodes that feed this one, with the kind of link. */
const inputsOf = (g, id) => g.inputs.get(id) ?? [];

/** The inputs that count for a claim: one per data group, the strongest. Each has its weight w and its node. */
function counted(g, n) {
  const groups = new Map();
  for (const l of inputsOf(g, n.id)) {
    if (l.rel === 'depends_on') continue;
    const from = g.nodes.get(l.from);
    // The q of a claim already carries its trust, so trust counts once.
    const weight = from.kind === 'claim' ? Math.max(0, 2 * from.q - 1) : from.trust;
    const w = (l.rel === 'supports' ? 1 : -1) * weight * Math.log(l.lr);
    const key = from.group == null ? `node:${from.id}` : `group:${from.group}`;
    const old = groups.get(key);
    // On a tie the contradiction wins, so the order of the events does not change the score.
    if (!old || Math.abs(w) > Math.abs(old.w) || (Math.abs(w) === Math.abs(old.w) && w < old.w)) groups.set(key, { w, from });
  }
  return [...groups.values()];
}

function evaluate(g, n) {
  const deps = inputsOf(g, n.id).filter((l) => l.rel === 'depends_on').map((l) => g.nodes.get(l.from));
  const own = n.status === 'retracted' ? 0 : n.own;
  const trust = deps.reduce((t, d) => Math.min(t, d.trust), own);
  if (n.kind !== 'claim') return { trust, q: n.q };
  const sum = counted(g, n).reduce((a, x) => a + x.w, 0);
  const q = deps.filter((d) => d.kind === 'claim').reduce((v, d) => Math.min(v, d.q), expit(trust * sum));
  return { trust, q };
}

/** Everything downstream of `start`, in an order where each node comes after what feeds it. */
function downstream(g, start) {
  const seen = new Set([start]), order = [];
  const stack = [[start, (g.feeds.get(start) ?? new Set()).values()]];
  while (stack.length) {
    const [id, next] = stack[stack.length - 1];
    const step = next.next();
    if (step.done) { order.push(id); stack.pop(); }
    else if (!seen.has(step.value)) {
      seen.add(step.value);
      stack.push([step.value, (g.feeds.get(step.value) ?? new Set()).values()]);
    }
  }
  return order.reverse();
}

/** Work out `start` and what lies below it. A node whose inputs did not change is left alone and stays off the list. */
function update(g, start) {
  const changed = new Set();
  for (const id of downstream(g, start)) {
    const n = g.nodes.get(id);
    if (id !== start && !inputsOf(g, id).some((l) => changed.has(l.from))) continue;
    const { trust, q } = evaluate(g, n);
    if (trust !== n.trust || q !== n.q) {
      n.trust = trust; n.q = q;
      changed.add(id);
    }
  }
  return [...changed];
}

function checkNode(g, ev) {
  if (!name(ev.id)) return 'a node needs a text id';
  if (g.nodes.has(ev.id)) return 'this node already exists';
  if (!KINDS.has(ev.kind)) return `unknown kind: ${ev.kind}`;
  if (ev.kind === 'evidence') {
    if (!LEVELS.includes(ev.level)) return 'evidence needs a level: measured, published, simulated, architecture or target';
    if (ev.level === 'published' && !(name(ev.doi) && /^10\.\d{4,9}\/\S+$/.test(ev.doi))) return 'published evidence needs a DOI';
  } else if (ev.level !== undefined || ev.doi !== undefined) return 'only evidence has a level or a DOI';
  if (ev.group !== undefined && !name(ev.group)) return 'a group must be a text name';
  if (ev.numbers !== undefined && !(Array.isArray(ev.numbers) && ev.numbers.every(name))) return 'numbers must be a list of texts';
  return null;
}

function checkLink(g, ev) {
  const from = g.nodes.get(ev.from), to = g.nodes.get(ev.to);
  if (!from || !to) return 'no such node';
  if (ev.from === ev.to) return 'a node cannot link to itself';
  if (ev.rel !== 'supports' && ev.rel !== 'contradicts' && ev.rel !== 'depends_on') return `unknown link: ${ev.rel}`;
  if (ev.rel !== 'depends_on') {
    if (to.kind !== 'claim') return 'support and contradiction go to a claim';
    if (from.kind === 'source' || from.kind === 'experiment') return 'a source or an experiment reaches a claim through its evidence';
    if (!(typeof ev.lr === 'number' && Number.isFinite(ev.lr) && ev.lr > 1)) return 'a link needs an lr above 1, or it says nothing';
  }
  const [up, down] = ev.rel === 'depends_on' ? [ev.to, ev.from] : [ev.from, ev.to];
  if (inputsOf(g, ev.to).some((l) => l.from === ev.from && l.rel !== 'depends_on') && ev.rel !== 'depends_on') return 'these nodes are already linked';
  if (inputsOf(g, down).some((l) => l.from === up && l.rel === ev.rel)) return 'these nodes are already linked';
  if (downstream(g, down).includes(up)) return 'this link would close a cycle';
  return null;
}

/** Apply one event. Returns the ids that were worked out again and changed. A refused event stays listed with its reason. */
export function applyEvent(g, ev) {
  const refuse = (reason) => { g.refused.push({ event: ev, reason }); return { touched: [] }; };
  if (!ev || typeof ev !== 'object') return refuse('an event must be an object');
  if (ev.type === 'node') {
    const problem = checkNode(g, ev);
    if (problem) return refuse(problem);
    const n = { id: ev.id, kind: ev.kind, text: ev.text, level: ev.level, doi: ev.doi, group: ev.group, rung: ev.rung, numbers: ev.numbers ?? [], status: 'open', own: 1, trust: 1, q: 0.5 };
    g.nodes.set(ev.id, n);
    return { touched: [ev.id] };
  }
  if (ev.type === 'link') {
    const problem = checkLink(g, ev);
    if (problem) return refuse(problem);
    const [up, down] = ev.rel === 'depends_on' ? [ev.to, ev.from] : [ev.from, ev.to];
    if (!g.feeds.has(up)) g.feeds.set(up, new Set());
    g.feeds.get(up).add(down);
    if (!g.inputs.has(down)) g.inputs.set(down, []);
    g.inputs.get(down).push({ from: up, rel: ev.rel, lr: ev.lr });
    return { touched: update(g, down) };
  }
  const n = g.nodes.get(ev.id);
  if (ev.type === 'retract') {
    if (!n) return refuse('no such node');
    const fresh = n.status !== 'retracted';
    n.status = 'retracted'; n.reason = ev.reason ?? '';
    const touched = update(g, ev.id);
    return { touched: fresh && !touched.includes(ev.id) ? [ev.id, ...touched] : touched };
  }
  if (ev.type === 'trust') {
    if (!n) return refuse('no such node');
    if (!(typeof ev.value === 'number' && ev.value >= 0 && ev.value <= 1)) return refuse('trust must lie between 0 and 1');
    n.own = ev.value;
    return { touched: update(g, ev.id) };
  }
  return refuse('unknown event');
}

export function buildGraph(events) {
  const g = createGraph();
  for (const ev of events) applyEvent(g, ev);
  return g;
}

/** A plain view of each node's values, for comparison. */
export const snapshot = (g) => Object.fromEntries([...g.nodes].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, n]) => [id, { kind: n.kind, status: n.status, trust: n.trust, q: n.q }]));

/** What a claim carries. Its level is the strongest level of the evidence that counts for it. A claim that stands on
 *  nothing has no level, so it never shows more than it has. */
export function claimCard(g, id) {
  const n = g.nodes.get(id);
  if (!n || n.kind !== 'claim') return null;
  const links = inputsOf(g, id), ids = (rel) => links.filter((l) => l.rel === rel).map((l) => l.from).sort();
  const standing = n.status !== 'retracted' && n.trust > 0 && n.q > 0.5;
  const live = standing ? counted(g, n).filter((x) => x.w > 0 && x.from.level) : [];
  const level = LEVELS.find((l) => live.some((x) => x.from.level === l)) ?? null;
  return { id, text: n.text, q: n.q, score_kind: 'heuristic', trust: n.trust, status: n.status, level, rung: n.rung ?? null, numbers: n.numbers, supports: ids('supports'), contradicts: ids('contradicts'), depends_on: ids('depends_on') };
}

// Slice C1 (2026-11-09): Toolpack evidence adapter and Evidence Engine (validation ladder L1-L3, roadmap 3.2 & 4.6).
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

export function recordToolpackEvidence(g, record = {}) {
  if (!record || typeof record !== 'object') {
    return { ok: false, error: 'Evidence record must be an object', touched: [] };
  }
  const {
    id,
    claimId,
    toolpack,
    source,
    date,
    level = 'measured',
    doi,
    lr = 4,
    rel = 'supports',
    numbers = [],
    group,
  } = record;

  if (!name(id)) return { ok: false, error: 'Evidence record requires a non-empty id', touched: [] };
  if (!name(claimId) || !g.nodes.has(claimId)) return { ok: false, error: 'Target claim node does not exist', touched: [] };
  if (!name(toolpack)) return { ok: false, error: 'Evidence record requires a toolpack name', touched: [] };
  if (!name(source)) return { ok: false, error: 'Evidence record requires a source identifier', touched: [] };
  if (typeof date !== 'string' || !ISO_DATE_PREFIX.test(date)) {
    return { ok: false, error: 'Evidence record requires an ISO date (YYYY-MM-DD)', touched: [] };
  }

  const srcNodeId = `src:${source}`;
  const touchedSet = new Set();

  if (!g.nodes.has(srcNodeId)) {
    const rSrc = applyEvent(g, { type: 'node', id: srcNodeId, kind: 'source', text: `${source} (${date})` });
    for (const t of rSrc.touched) touchedSet.add(t);
  }

  const evNode = {
    type: 'node',
    id,
    kind: 'evidence',
    text: `${toolpack}: ${source} @ ${date}`,
    level,
    ...(level === 'published' && doi ? { doi } : {}),
    ...(group ? { group } : {}),
    numbers: Array.isArray(numbers) ? numbers : [],
  };
  const rEv = applyEvent(g, evNode);
  if (rEv.touched.length === 0 && g.refused.length > 0) {
    return { ok: false, error: g.refused.at(-1).reason, touched: [] };
  }
  for (const t of rEv.touched) touchedSet.add(t);

  const rDep = applyEvent(g, { type: 'link', from: id, rel: 'depends_on', to: srcNodeId });
  for (const t of rDep.touched) touchedSet.add(t);

  const rLink = applyEvent(g, { type: 'link', from: id, rel, to: claimId, lr });
  for (const t of rLink.touched) touchedSet.add(t);

  return { ok: true, id, sourceId: srcNodeId, touched: [...touchedSet].sort() };
}

export function evaluateEvidenceEngine(g, claimId, opts = {}) {
  const card = claimCard(g, claimId);
  if (!card) return { ok: false, error: `Unknown claim: ${String(claimId)}` };

  const links = inputsOf(g, claimId);
  const supportNodes = links
    .filter((l) => l.rel === 'supports')
    .map((l) => g.nodes.get(l.from))
    .filter(Boolean);

  const retractedSources = [];
  for (const evNode of supportNodes) {
    if (evNode.status === 'retracted') retractedSources.push(evNode.id);
    for (const dep of inputsOf(g, evNode.id)) {
      const up = g.nodes.get(dep.from);
      if (up && up.status === 'retracted') retractedSources.push(up.id);
    }
  }

  const activeSupports = supportNodes.filter((n) => n.status !== 'retracted' && n.trust > 0);
  const passedL1 = activeSupports.length > 0 && retractedSources.length === 0 && card.q > 0.5;

  const evidenceNumbers = new Set();
  for (const evNode of activeSupports) {
    for (const num of evNode.numbers ?? []) evidenceNumbers.add(num);
  }
  const untracedNumbers = (card.numbers ?? []).filter((num) => !evidenceNumbers.has(num));
  const falsifier = typeof opts.falsifier === 'string' && opts.falsifier.trim() ? opts.falsifier.trim() : null;
  const passedL2 = passedL1 && untracedNumbers.length === 0 && falsifier !== null;

  const nullModel = opts.nullModel && typeof opts.nullModel === 'object' ? opts.nullModel : null;
  const passedL3 = Boolean(passedL2 && nullModel && nullModel.passed === true);

  const rungReached = passedL3 ? 'L3' : passedL2 ? 'L2' : passedL1 ? 'L1' : 'L0';
  return {
    ok: passedL1,
    id: claimId,
    rungReached,
    passedL1,
    passedL2,
    passedL3,
    retractedSources,
    untracedNumbers,
    falsifier,
    nullModel,
  };
}

