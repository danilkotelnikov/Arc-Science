// arc-hoh claim graph (2026-11-07): run with  node --test test/claims.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraph, applyEvent, buildGraph, snapshot, claimCard } from '../lib/claims.js';
import { mulberry } from '../lib/replay.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const node = (id, kind, extra = {}) => ({ type: 'node', id, kind, ...extra });
const claim = (id, extra) => node(id, 'claim', extra);
const evidence = (id, extra) => node(id, 'evidence', { level: 'measured', ...extra });
const source = (id, extra) => node(id, 'source', extra);
const link = (from, rel, to, lr) => ({ type: 'link', from, rel, to, ...(lr ? { lr } : {}) });
const q = (g, id) => g.nodes.get(id).q;

test('support and contradiction move the score by the likelihood ratio', () => {
  near(q(buildGraph([claim('c'), evidence('e'), link('e', 'supports', 'c', 4)]), 'c'), 0.8);
  near(q(buildGraph([claim('c'), evidence('e'), link('e', 'contradicts', 'c', 4)]), 'c'), 0.2);
  near(q(buildGraph([claim('c'), evidence('a'), evidence('b'), link('a', 'supports', 'c', 4), link('b', 'contradicts', 'c', 4)]), 'c'), 0.5);
  assert.equal(q(buildGraph([claim('c')]), 'c'), 0.5);
});

test('an event cannot write a score', () => {
  const g = buildGraph([claim('c', { q: 0.99, trust: 0.1 })]);
  assert.equal(q(g, 'c'), 0.5);
  assert.equal(g.nodes.get('c').trust, 1);
});

test('evidence on the same data counts once, by the strongest', () => {
  const g = buildGraph([claim('c'), evidence('a', { group: 'd' }), evidence('b', { group: 'd' }), link('a', 'supports', 'c', 2), link('b', 'supports', 'c', 4)]);
  near(q(g, 'c'), 0.8);
  const tie = (first, second) => buildGraph([claim('c'), evidence('a', { group: 'd' }), evidence('b', { group: 'd' }), first, second]);
  const up = link('a', 'supports', 'c', 4), down = link('b', 'contradicts', 'c', 4);
  near(q(tie(up, down), 'c'), 0.2);
  near(q(tie(down, up), 'c'), 0.2);
});

test('a retracted source takes its evidence out, and the claim falls back', () => {
  const events = [source('s'), evidence('e'), claim('c'), claim('other'), evidence('f'), link('e', 'depends_on', 's'), link('e', 'supports', 'c', 4), link('f', 'supports', 'other', 4)];
  const g = buildGraph(events);
  near(q(g, 'c'), 0.8);
  const before = q(g, 'other');
  const { touched } = applyEvent(g, { type: 'retract', id: 's', reason: 'retracted paper' });
  assert.deepEqual(touched.sort(), ['c', 'e', 's']);
  assert.equal(q(g, 'c'), 0.5);
  assert.equal(q(g, 'other'), before);
  assert.equal(g.nodes.get('e').trust, 0);
  assert.equal(g.nodes.get('s').status, 'retracted');
});

test('a new result touches only the nodes that depend on it', () => {
  const g = buildGraph([claim('a'), claim('b'), claim('far'), evidence('e1'), evidence('e2'), evidence('e3'), link('e1', 'supports', 'a', 4), link('b', 'depends_on', 'a'), link('e3', 'supports', 'far', 4), link('e2', 'supports', 'b', 4)]);
  assert.deepEqual(applyEvent(g, link('e1', 'supports', 'b', 2)).touched, [], 'b stays capped by a');
  assert.deepEqual(applyEvent(g, evidence('e4')).touched, ['e4']);
  assert.deepEqual(applyEvent(g, link('e4', 'supports', 'a', 4)).touched.sort(), ['a', 'b']);
  assert.deepEqual(applyEvent(g, { type: 'trust', id: 'e2', value: 0.5 }).touched.sort(), ['b', 'e2'], 'a and far lie upstream or apart');
});

test('an update stops where a value does not change', () => {
  const g = buildGraph([claim('a'), claim('b'), evidence('e'), evidence('x'), link('e', 'supports', 'a', 4), link('x', 'supports', 'b', 2), link('b', 'depends_on', 'a')]);
  near(q(g, 'b'), 2 / 3);
  const { touched } = applyEvent(g, { type: 'node', id: 'y', kind: 'evidence', level: 'measured' });
  assert.deepEqual(touched, ['y']);
  assert.deepEqual(applyEvent(g, link('y', 'supports', 'a', 2)).touched, ['a'], 'b stays capped by its own evidence');
});

test('a claim is not stronger than what it depends on', () => {
  const g = buildGraph([claim('base'), claim('top'), evidence('a'), evidence('b'), link('a', 'supports', 'base', 2), link('b', 'supports', 'top', 100), link('top', 'depends_on', 'base')]);
  near(q(g, 'top'), 2 / 3);
  applyEvent(g, { type: 'retract', id: 'a', reason: 'bad run' });
  assert.equal(q(g, 'base'), 0.5);
  assert.equal(q(g, 'top'), 0.5);
});

test('a claim that supports another passes on only what it has', () => {
  const g = buildGraph([claim('a'), claim('b'), link('a', 'supports', 'b', 100)]);
  assert.equal(q(g, 'b'), 0.5, 'an unsupported claim gives nothing');
  applyEvent(g, evidence('e'));
  applyEvent(g, link('e', 'contradicts', 'a', 4));
  assert.equal(q(g, 'b'), 0.5, 'a doubted claim gives nothing');
  const u = buildGraph([claim('a'), claim('b'), evidence('e'), link('a', 'supports', 'b', 16), link('e', 'supports', 'a', 3)]);
  near(q(u, 'a'), 0.75);
  near(q(u, 'b'), 0.8);
  const half = buildGraph([claim('a', {}), claim('b'), evidence('e'), link('e', 'supports', 'a', 9), link('a', 'supports', 'b', 16), { type: 'trust', id: 'a', value: 0.5 }]);
  near(q(half, 'a'), 0.75);
  near(q(half, 'b'), 0.8);
});

test('a lower trust counts for less, and 3.4 can set it', () => {
  const g = buildGraph([source('s'), evidence('e'), claim('c'), link('e', 'depends_on', 's'), link('e', 'supports', 'c', 16)]);
  near(q(g, 'c'), 16 / 17);
  applyEvent(g, { type: 'trust', id: 's', value: 0.5 });
  near(q(g, 'c'), 0.8);
  applyEvent(g, { type: 'trust', id: 's', value: 7 });
  near(q(g, 'c'), 0.8);
  assert.match(g.refused.at(-1).reason, /between 0 and 1/);
});

test('links that make no sense are refused', () => {
  const base = [claim('c'), claim('d'), evidence('e'), source('s'), node('x', 'experiment')];
  const bad = [
    [link('e', 'supports', 'nobody', 4), /no such node/], [link('nobody', 'supports', 'c', 4), /no such node/],
    [link('e', 'proves', 'c', 4), /unknown link/], [link('e', 'supports', 's', 4), /to a claim/], [link('s', 'supports', 'c', 4), /source/],
    [link('x', 'supports', 'c', 100), /experiment/], [link('x', 'contradicts', 'c', 100), /experiment/],
    [link('e', 'supports', 'c'), /above 1/], [link('e', 'supports', 'c', 1), /above 1/], [link('e', 'supports', 'c', 0.5), /above 1/],
    [link('e', 'supports', 'c', Infinity), /above 1/], [link('c', 'depends_on', 'c'), /itself/],
  ];
  for (const [ev, why] of bad) {
    const g = buildGraph([...base, ev]);
    assert.equal(g.refused.length, 1, JSON.stringify(ev));
    assert.match(g.refused[0].reason, why);
  }
});

test('one pair of nodes holds one support link, and a cycle is refused', () => {
  const twice = buildGraph([claim('c'), evidence('e'), link('e', 'supports', 'c', 4), link('e', 'supports', 'c', 4)]);
  near(q(twice, 'c'), 0.8);
  assert.match(twice.refused[0].reason, /already linked/);
  const both = buildGraph([claim('c'), evidence('e'), link('e', 'supports', 'c', 4), link('e', 'contradicts', 'c', 4)]);
  near(q(both, 'c'), 0.8);
  const loop = buildGraph([claim('a'), claim('b'), claim('c'), link('a', 'depends_on', 'b'), link('b', 'depends_on', 'c'), link('c', 'depends_on', 'a')]);
  assert.match(loop.refused[0].reason, /cycle/);
  const mixed = buildGraph([claim('a'), claim('b'), link('a', 'supports', 'b', 4), link('a', 'depends_on', 'b')]);
  assert.match(mixed.refused[0].reason, /cycle/);
});

test('nodes need a known kind and a real level', () => {
  const bad = [node('a', 'dream'), node('', 'claim'), node(3, 'claim'), evidence('b', { level: 'sure' }), node('c', 'evidence'), evidence('d', { level: 'published' }),
    evidence('d2', { level: 'published', doi: 'x' }), claim('e', { level: 'measured' }), node('f', 'experiment', { level: 'measured' }), source('g', { doi: '10.1000/x' }),
    evidence('h', { group: 1 }), claim('i', { numbers: 'KD 3' }), null, 7, { type: 'dance' }];
  const g = buildGraph(bad);
  assert.equal(g.nodes.size, 0);
  assert.equal(g.refused.length, bad.length);
  const dup = buildGraph([claim('a'), source('a')]);
  assert.equal(dup.nodes.get('a').kind, 'claim');
  assert.match(dup.refused[0].reason, /already exists/);
});

test('built-in JavaScript names are plain ids', () => {
  for (const w of ['constructor', '__proto__', 'toString']) {
    const g = buildGraph([claim(w), evidence('e'), link('e', 'supports', w, 4)]);
    near(q(g, w), 0.8);
    assert.equal(buildGraph([link('e', 'supports', w, 4)]).refused.length, 1);
  }
});

test('a claim shows its evidence, its level and never more than it has', () => {
  const g = buildGraph([
    claim('c', { text: 'x binds y', rung: 'L1', numbers: ['KD 3 nM'] }), source('paper'), evidence('sim', { level: 'simulated' }),
    evidence('pub', { level: 'published', doi: '10.1000/xyz' }), evidence('anti', { level: 'measured' }),
    link('pub', 'depends_on', 'paper'), link('pub', 'supports', 'c', 4), link('sim', 'supports', 'c', 2), link('anti', 'contradicts', 'c', 1.5),
  ]);
  const card = claimCard(g, 'c');
  assert.equal(card.level, 'published');
  assert.deepEqual(card.supports, ['pub', 'sim']);
  assert.deepEqual(card.contradicts, ['anti']);
  assert.equal(card.rung, 'L1');
  assert.deepEqual(card.numbers, ['KD 3 nM']);
  applyEvent(g, { type: 'retract', id: 'paper', reason: 'retracted' });
  assert.equal(claimCard(g, 'c').level, 'simulated', 'a dead source no longer lifts the level');
  assert.equal(claimCard(buildGraph([claim('c')]), 'c').level, null);
  assert.equal(claimCard(g, 'nobody'), null);
  assert.equal(claimCard(g, 'sim'), null);
});

test('a claim that stands on nothing shows no level', () => {
  const base = [claim('c'), evidence('e'), link('e', 'supports', 'c', 2)];
  assert.equal(claimCard(buildGraph(base), 'c').level, 'measured');
  const level = (...more) => claimCard(buildGraph([...base, ...more]), 'c').level;
  assert.equal(level({ type: 'retract', id: 'c', reason: 'r' }), null);
  assert.equal(level({ type: 'trust', id: 'c', value: 0 }), null);
  assert.equal(level(source('s'), link('c', 'depends_on', 's'), { type: 'retract', id: 's', reason: 'r' }), null);
  assert.equal(level(evidence('anti'), link('anti', 'contradicts', 'c', 100)), null);
  const lost = buildGraph([claim('c'), evidence('weak', { level: 'measured', group: 'g' }), evidence('strong', { level: 'simulated', group: 'g' }), link('weak', 'supports', 'c', 2), link('strong', 'supports', 'c', 8)]);
  assert.equal(claimCard(lost, 'c').level, 'simulated', 'evidence that did not count lends no level');
  const borrowed = buildGraph([claim('a'), claim('c'), evidence('e'), link('e', 'supports', 'a', 8), link('a', 'supports', 'c', 8)]);
  assert.equal(claimCard(borrowed, 'c').level, null, 'a level does not pass through a claim');
});

test('the touched list holds only what changed', () => {
  const g = buildGraph([claim('c'), evidence('e'), evidence('dead'), { type: 'retract', id: 'dead', reason: 'r' }, link('e', 'supports', 'c', 4)]);
  assert.deepEqual(applyEvent(g, link('dead', 'supports', 'c', 4)).touched, []);
  assert.deepEqual(applyEvent(g, { type: 'trust', id: 'e', value: 1 }).touched, []);
  assert.deepEqual(applyEvent(g, { type: 'retract', id: 'dead', reason: 'again' }).touched, []);
});

test('a very long chain updates without a crash', () => {
  const events = [claim('n0')];
  for (let i = 1; i < 20000; i++) events.push(claim(`n${i}`), link(`n${i}`, 'depends_on', `n${i - 1}`));
  const g = buildGraph(events);
  assert.deepEqual(g.refused, []);
  assert.equal(applyEvent(g, { type: 'trust', id: 'n0', value: 0.5 }).touched.length, 20000);
  assert.equal(g.nodes.get('n19999').trust, 0.5);
});

test('a recorded mission replays to the same graph', () => {
  const mission = [
    claim('slope', { text: 'y rises with x' }), claim('curve', { text: 'the rise bends' }), claim('forecast', { text: 'the forecast holds' }),
    source('dataset'), node('fit-linear', 'experiment'), node('fit-quadratic', 'experiment'), node('shuffle', 'experiment'),
    evidence('r-linear'), evidence('r-quadratic'), evidence('r-shuffle'),
    link('fit-linear', 'depends_on', 'dataset'), link('fit-quadratic', 'depends_on', 'dataset'), link('shuffle', 'depends_on', 'dataset'),
    link('r-linear', 'depends_on', 'fit-linear'), link('r-quadratic', 'depends_on', 'fit-quadratic'), link('r-shuffle', 'depends_on', 'shuffle'),
    link('r-linear', 'supports', 'slope', 8), link('r-quadratic', 'supports', 'curve', 8), link('r-shuffle', 'contradicts', 'curve', 2),
    link('forecast', 'depends_on', 'curve'), link('forecast', 'depends_on', 'slope'), link('r-quadratic', 'supports', 'forecast', 64),
  ];
  const g = buildGraph(mission);
  assert.deepEqual(g.refused, []);
  near(q(g, 'slope'), 8 / 9);
  near(q(g, 'curve'), 0.8);
  near(q(g, 'forecast'), 0.8);
  assert.deepEqual(snapshot(buildGraph(JSON.parse(JSON.stringify(mission)))), snapshot(g));
  const { touched } = applyEvent(g, { type: 'retract', id: 'shuffle', reason: 'bad seed' });
  assert.deepEqual([...touched].sort(), ['curve', 'forecast', 'r-shuffle', 'shuffle']);
  near(q(g, 'curve'), 8 / 9);
});

// A second, plain calculation from the graph's links. It shares no code with claims.js.
function fresh(g) {
  const memo = new Map();
  const value = (id) => {
    if (memo.has(id)) return memo.get(id);
    const n = g.nodes.get(id), links = g.inputs.get(id) ?? [];
    const deps = links.filter((l) => l.rel === 'depends_on').map((l) => ({ ...value(l.from), kind: g.nodes.get(l.from).kind }));
    let trust = n.status === 'retracted' ? 0 : n.own;
    for (const d of deps) trust = Math.min(trust, d.trust);
    let score = 0.5;
    if (n.kind === 'claim') {
      const best = {};
      for (const l of links.filter((x) => x.rel !== 'depends_on')) {
        const v = value(l.from), other = g.nodes.get(l.from);
        const size = (other.kind === 'claim' ? Math.max(0, 2 * v.q - 1) : v.trust) * Math.log(l.lr) * (l.rel === 'supports' ? 1 : -1);
        const key = other.group ? `g ${other.group}` : `n ${l.from}`;
        if (best[key] === undefined || Math.abs(size) > Math.abs(best[key]) || (Math.abs(size) === Math.abs(best[key]) && size < best[key])) best[key] = size;
      }
      score = 1 / (1 + Math.exp(-trust * Object.values(best).reduce((x, y) => x + y, 0)));
      for (const d of deps) if (d.kind === 'claim') score = Math.min(score, d.q);
    }
    memo.set(id, { trust, q: score });
    return memo.get(id);
  };
  return Object.fromEntries([...g.nodes.keys()].map((id) => [id, value(id)]));
}

function below(g, start) {
  const seen = new Set([start]), todo = [start];
  while (todo.length) for (const next of g.feeds.get(todo.pop()) ?? []) if (!seen.has(next)) { seen.add(next); todo.push(next); }
  return seen;
}

test('each step of a random session matches a separate calculation, and changes only what lies below', () => {
  const rng = mulberry(2026);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  for (let round = 0; round < 40; round++) {
    const ids = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const g = createGraph();
    for (let step = 0; step < 150; step++) {
      const u = rng();
      let ev;
      if (u < 0.3) {
        const id = pick(ids), kind = pick(['claim', 'claim', 'evidence', 'source', 'experiment']);
        ev = { type: 'node', id, kind, ...(kind === 'evidence' ? { level: 'measured', group: pick([undefined, 'g1', 'g2']) } : {}) };
      } else if (u < 0.75) ev = link(pick(ids), pick(['supports', 'contradicts', 'depends_on']), pick(ids), pick([2, 4, 16]));
      else if (u < 0.9) ev = { type: 'trust', id: pick(ids), value: pick([0, 0.25, 0.5, 1]) };
      else ev = { type: 'retract', id: pick(ids), reason: 'r' };
      const before = snapshot(g);
      const { touched } = applyEvent(g, ev);
      const after = snapshot(g), plain = fresh(g);
      for (const [id, v] of Object.entries(after)) {
        near(v.trust, plain[id].trust, 1e-12);
        near(v.q, plain[id].q, 1e-12);
        if (!touched.includes(id) && before[id]) assert.deepEqual(v, before[id], `${id} changed outside the touched list`);
      }
      const root = ev.type === 'link' ? (ev.rel === 'depends_on' ? ev.from : ev.to) : ev.id;
      if (touched.length) for (const id of touched) assert.ok(below(g, root).has(id), `${id} is not below ${root}`);
    }
  }
});
