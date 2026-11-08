// arc-hoh source reliability (2026-11-07): how far to trust each source, from its votes and the gate verdicts.
// This is the two-class Dawid-Skene method (Dawid and Skene, 1979, Applied Statistics 28: 20-28). Each source has a
// sensitivity and a specificity, and each item has an unknown true label. The loop estimates both in turn.
// Gate verdicts are known labels. They stay fixed, and they anchor the meaning of yes and no. Without them, a crowd of
// mostly wrong sources looks right, because the method can only compare the sources with each other.
// The method assumes that sources err independently once the true label is known. Sources that copy each other look
// better than they are.
const expit = (x) => 1 / (1 + Math.exp(-x));
const name = (x) => typeof x === 'string' && x !== '';
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ordered = (m) => Object.fromEntries([...m].sort(([a], [b]) => byId(a, b)));

function clean(votes, gold) {
  const refused = [], seen = new Set(), kept = [], known = new Map();
  // Sorted first, so that a duplicate keeps the same vote in any input order.
  const key = (v) => (v && typeof v === 'object' ? JSON.stringify([String(v.item), String(v.source), String(v.label)]) : '');
  for (const ev of [...(Array.isArray(votes) ? votes : [])].sort((a, b) => byId(key(a), key(b)))) {
    if (!ev || typeof ev !== 'object' || !name(ev.item) || !name(ev.source)) refused.push({ event: ev, reason: 'a vote needs a text item and a text source' });
    else if (ev.label !== 0 && ev.label !== 1) refused.push({ event: ev, reason: 'a label must be 0 or 1' });
    else if (seen.has(JSON.stringify([ev.source, ev.item]))) refused.push({ event: ev, reason: 'this source already voted on this item' });
    else { seen.add(JSON.stringify([ev.source, ev.item])); kept.push(ev); }
  }
  for (const [item, label] of Object.entries(gold ?? {})) {
    if (label === 0 || label === 1) known.set(item, label);
    else refused.push({ event: { item, label }, reason: 'a verdict must be 0 or 1' });
  }
  kept.sort((a, b) => byId(a.item, b.item) || byId(a.source, b.source));
  return { kept, known, refused };
}

/** Rates from the current labels, with one pseudo-count each way so that a rate never reaches 0 or 1. */
function rates(kept, q) {
  const n = new Map();
  for (const { item, source, label } of kept) {
    const p = q.get(item);
    if (p === undefined) continue;
    const r = n.get(source) ?? { hit: 0, pos: 0, rej: 0, neg: 0 };
    r.pos += p; r.hit += p * label;
    r.neg += 1 - p; r.rej += (1 - p) * (1 - label);
    n.set(source, r);
  }
  return new Map([...n].map(([s, r]) => [s, { sensitivity: (r.hit + 1) / (r.pos + 2), specificity: (r.rej + 1) / (r.neg + 2), positives: r.pos, negatives: r.neg }]));
}

/** Estimate each source and each item. Returns { sources, items, refused, converged, iterations }. */
export function estimate(votes, { gold = {}, iterations = 200, tol = 1e-6 } = {}) {
  const { kept, known, refused } = clean(votes, gold);
  const items = [...new Set(kept.map((v) => v.item))], voters = [...new Set(kept.map((v) => v.source))];
  const q = new Map(known);
  if (known.size === 0) {
    // With no verdicts, the plain majority is the starting point.
    const sum = new Map(), n = new Map();
    for (const { item, label } of kept) { sum.set(item, (sum.get(item) ?? 0) + label); n.set(item, (n.get(item) ?? 0) + 1); }
    for (const i of items) q.set(i, sum.get(i) / n.get(i));
  }
  let converged = false, used = 0;
  for (let round = 0; round < iterations && !converged; round++) {
    used = round + 1;
    const r = rates(kept, q);
    const labels = [...q.values()], pi = (labels.reduce((a, b) => a + b, 0) + 1) / (labels.length + 2);
    const score = new Map(items.map((i) => [i, Math.log(pi / (1 - pi))]));
    for (const { item, source, label } of kept) {
      const { sensitivity: se, specificity: sp } = r.get(source) ?? { sensitivity: 0.5, specificity: 0.5 };
      // A source below chance says nothing here: its votes are never read in reverse.
      if (se + sp > 1) score.set(item, score.get(item) + Math.log(label ? se / (1 - sp) : (1 - se) / sp));
    }
    let move = round === 0 && known.size > 0 ? 1 : 0;
    for (const i of items) {
      if (known.has(i)) continue;
      const next = expit(score.get(i));
      move = Math.max(move, Math.abs(next - (q.get(i) ?? next)));
      q.set(i, next);
    }
    converged = move < tol;
  }
  const r = rates(kept, q), count = new Map();
  for (const { source } of kept) count.set(source, (count.get(source) ?? 0) + 1);
  const sources = new Map(voters.map((s) => {
    const { sensitivity, specificity, positives = 0, negatives = 0 } = r.get(s) ?? { sensitivity: 0.5, specificity: 0.5 };
    // A source below chance earns nothing.
    return [s, { votes: count.get(s), positives, negatives, sensitivity, specificity, trust: Math.max(0, sensitivity + specificity - 1) }];
  }));
  return { sources: ordered(sources), items: ordered(new Map(items.map((i) => [i, q.get(i)]))), refused, converged, iterations: used };
}

/** Trust events for the claim graph. A source with few votes keeps the trust it has. So does a source seen on one side
 *  only: a crowd that always agrees looks the same as a crowd that always says yes. */
export const trustEvents = (result, { minVotes = 10, minSide = 5 } = {}) => Object.entries(result.sources)
  .filter(([, s]) => s.votes >= minVotes && s.positives >= minSide && s.negatives >= minSide).map(([id, s]) => ({ type: 'trust', id, value: s.trust }));
