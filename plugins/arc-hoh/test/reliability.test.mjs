// arc-hoh source reliability (2026-11-07): run with  node --test test/reliability.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate, trustEvents } from '../lib/reliability.js';
import { applyEvent, buildGraph } from '../lib/claims.js';
import { mulberry } from '../lib/replay.js';

const near = (a, b, eps, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} is not within ${eps} of ${b}`);

/** Votes on items with a known truth. Each source has a known sensitivity and specificity. */
function simulate(sources, items, seed, rate = 0.5) {
  const rng = mulberry(seed), truth = {}, votes = [];
  for (let i = 0; i < items; i++) {
    const item = `i${i}`;
    truth[item] = rng() < rate ? 1 : 0;
    for (const [id, se, sp] of sources) {
      const right = rng() < (truth[item] ? se : sp);
      votes.push({ item, source: id, label: right ? truth[item] : 1 - truth[item] });
    }
  }
  return { truth, votes };
}
const accuracy = (posterior, truth) => {
  const ids = Object.keys(truth);
  return ids.filter((i) => (posterior[i] > 0.5 ? 1 : 0) === truth[i]).length / ids.length;
};
const majority = (votes) => {
  const sum = {}, n = {};
  for (const v of votes) { sum[v.item] = (sum[v.item] ?? 0) + v.label; n[v.item] = (n[v.item] ?? 0) + 1; }
  return Object.fromEntries(Object.keys(sum).map((i) => [i, sum[i] / n[i]]));
};

const SOURCES = [['good1', 0.95, 0.9], ['good2', 0.9, 0.95], ['fair1', 0.8, 0.75], ['fair2', 0.75, 0.8], ['weak', 0.6, 0.6], ['noise', 0.5, 0.5], ['yes-man', 1, 0]];

test('known reliabilities are recovered from votes alone', () => {
  const { votes } = simulate(SOURCES, 2000, 2026);
  const r = estimate(votes);
  for (const [id, se, sp] of SOURCES) {
    near(r.sources[id].sensitivity, se, 0.05, `${id} sensitivity`);
    near(r.sources[id].specificity, sp, 0.05, `${id} specificity`);
    near(r.sources[id].trust, se + sp - 1, 0.07, `${id} trust`);
  }
});

test('the order of trust follows the true order', () => {
  const r = estimate(simulate(SOURCES, 2000, 7).votes);
  const t = (id) => r.sources[id].trust;
  assert.ok(t('good1') > t('fair1') && t('good2') > t('fair2'));
  assert.ok(t('fair1') > t('weak') && t('fair2') > t('weak'));
  assert.ok(t('weak') > t('noise'));
});

test('a source that says yes to everything, and pure noise, earn almost no trust', () => {
  const r = estimate(simulate(SOURCES, 2000, 11).votes);
  assert.ok(r.sources['yes-man'].trust < 0.05, String(r.sources['yes-man'].trust));
  assert.ok(r.sources.noise.trust < 0.07, String(r.sources.noise.trust));
});

test('weighing sources beats a plain majority', () => {
  const crowd = [['a', 0.95, 0.95], ['b', 0.6, 0.6], ['c', 0.6, 0.6], ['d', 0.6, 0.6], ['e', 0.6, 0.6]];
  let ours = 0, plain = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const { truth, votes } = simulate(crowd, 1000, seed);
    ours += accuracy(estimate(votes).items, truth);
    plain += accuracy(majority(votes), truth);
  }
  assert.ok(ours > plain + 0.02 * 5, `${ours / 5} against ${plain / 5}`);
});

test('gate verdicts anchor the labels when most sources are wrong', () => {
  const crowd = [['liar1', 0.15, 0.15], ['liar2', 0.2, 0.2], ['liar3', 0.15, 0.2], ['honest1', 0.9, 0.9], ['honest2', 0.85, 0.9]];
  const { truth, votes } = simulate(crowd, 1000, 3);
  const gold = Object.fromEntries(Object.keys(truth).slice(0, 60).map((i) => [i, truth[i]]));
  const r = estimate(votes, { gold });
  assert.ok(r.sources.honest1.trust > 0.6, String(r.sources.honest1.trust));
  assert.equal(r.sources.liar1.trust, 0, 'worse than chance counts as nothing, never as a reversed signal');
  // As good as the honest sources alone, about 0.89. Reading liars in reverse would score higher, and we refuse to.
  assert.ok(accuracy(r.items, truth) > 0.85);
  for (const [i, v] of Object.entries(gold)) assert.equal(r.items[i], v, 'a verdict stays as it is');
});

test('the result is the same for any order of the votes', () => {
  const { votes } = simulate(SOURCES.slice(0, 4), 100, 5);
  const rng = mulberry(9);
  const shuffled = votes.map((v) => [rng(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  assert.deepEqual(estimate(shuffled), estimate(votes));
});

test('bad votes are refused and listed', () => {
  const r = estimate([
    { item: 'a', source: 's', label: 1 }, { item: 'a', source: 's', label: 0 }, { item: 'b', source: 's', label: 2 },
    { item: 3, source: 's', label: 1 }, { item: 'b', source: '', label: 1 }, null, 'x', { item: 'c', source: 'constructor', label: 1 },
  ], { gold: { a: 5 } });
  assert.equal(r.refused.length, 7);
  assert.deepEqual(Object.keys(r.sources).sort(), ['constructor', 's']);
  assert.deepEqual(estimate([]).sources, {});
});

test('it stops at the iteration limit and says so', () => {
  const { votes } = simulate(SOURCES, 100, 1);
  assert.equal(estimate(votes, { iterations: 1 }).converged, false);
  assert.equal(estimate(votes).converged, true);
});

test('a source with few votes keeps its trust', () => {
  const votes = [];
  for (let i = 0; i < 30; i++) votes.push({ item: `i${i}`, source: 'many', label: i % 2 }, { item: `i${i}`, source: 'many2', label: i % 2 });
  votes.push({ item: 'i0', source: 'few', label: 0 });
  const events = trustEvents(estimate(votes), { minVotes: 10 });
  assert.deepEqual(events.map((e) => e.id).sort(), ['many', 'many2']);
  for (const e of events) assert.equal(e.type, 'trust');
});

test('a crowd that always agrees earns no trust, because nothing tests it', () => {
  const votes = [];
  for (let i = 0; i < 30; i++) for (const source of ['x', 'y', 'z']) votes.push({ item: `i${i}`, source, label: 1 });
  assert.deepEqual(trustEvents(estimate(votes)), []);
  const gold = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`i${i}`, i % 2]));
  const tested = trustEvents(estimate(votes, { gold }));
  assert.deepEqual(tested.map((e) => e.id).sort(), ['x', 'y', 'z'], 'verdicts on both sides do test it');
  for (const e of tested) assert.ok(e.value < 0.1, 'a yes-man');
});

test('a rate never reaches 0 or 1', () => {
  const votes = Array.from({ length: 8 }, (_, i) => ({ item: `i${i}`, source: 'a', label: i % 2 }));
  const gold = Object.fromEntries(votes.map((v) => [v.item, v.label]));
  const s = estimate(votes, { gold }).sources.a;
  assert.ok(s.sensitivity < 1 && s.specificity < 1);
  near(s.sensitivity, 5 / 6, 1e-9);
});

test('the vote of a source below chance moves nothing', () => {
  const votes = [], gold = {};
  for (let i = 0; i < 40; i++) { votes.push({ item: `g${i}`, source: 'liar', label: 1 - i % 2 }, { item: `g${i}`, source: 'other', label: i % 2 }); gold[`g${i}`] = i % 2; }
  votes.push({ item: 'only-liar', source: 'liar', label: 1 });
  near(estimate(votes, { gold }).items['only-liar'], 0.5, 0.05);
});

test('a duplicate vote gives the same result in any order', () => {
  const base = Array.from({ length: 36 }, (_, i) => ({ item: `i${i % 12}`, source: `s${i % 3}`, label: i % 2 }));
  const extra = { item: 'i0', source: 's0', label: base[0].label ? 0 : 1 };
  assert.deepEqual(estimate([extra, ...base]).items, estimate([...base, extra]).items);
  assert.deepEqual(estimate([{ item: 'a', source: 's', label: 1 }], { gold: null }).refused, []);
});

test('an unreliable source counts for less in the claim graph', () => {
  const { votes } = simulate([['strong', 0.95, 0.95], ['shaky', 0.55, 0.5], ['third', 0.9, 0.9]], 500, 4);
  const g = buildGraph([{ type: 'node', id: 'c', kind: 'claim' }, { type: 'node', id: 'shaky', kind: 'source' }, { type: 'node', id: 'strong', kind: 'source' },
    { type: 'node', id: 'e1', kind: 'evidence', level: 'published', doi: '10.1000/a' }, { type: 'link', from: 'e1', rel: 'depends_on', to: 'shaky' },
    { type: 'link', from: 'e1', rel: 'supports', to: 'c', lr: 100 }, { type: 'node', id: 'other', kind: 'claim' },
    { type: 'node', id: 'e2', kind: 'evidence', level: 'published', doi: '10.1000/b' }, { type: 'link', from: 'e2', rel: 'depends_on', to: 'strong' },
    { type: 'link', from: 'e2', rel: 'supports', to: 'other', lr: 100 }]);
  const before = g.nodes.get('c').q;
  for (const e of trustEvents(estimate(votes)).filter((x) => g.nodes.has(x.id))) applyEvent(g, e);
  assert.ok(g.nodes.get('c').q < before - 0.2, 'the shaky source lost its weight');
  assert.ok(g.nodes.get('other').q > g.nodes.get('c').q);
  assert.deepEqual(g.refused, []);
});
