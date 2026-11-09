import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, ParseError, detect, cleanLabel } from '../src/parse.mjs';

test('flowchart: header, direction, shapes, links, labels', () => {
  const m = parse(`flowchart LR
    A[Rect] --> B(Round) -->|yes| C{Dec}
    C -- no --> D([Stad]) -.-> E[(Db)] ==> F((Circ))
    G{{Hex}} --- H[[Sub]] --o I[/Par/] --x J[\\Alt\\]`);
  assert.equal(m.type, 'flow');
  assert.equal(m.dir, 'LR');
  const shapes = Object.fromEntries([...m.nodes.values()].map((n) => [n.id, n.shape]));
  assert.deepEqual(shapes, { A: 'rect', B: 'round', C: 'diamond', D: 'stadium', E: 'cylinder', F: 'circle', G: 'hexagon', H: 'subroutine', I: 'parallelogram', J: 'parallelogramAlt' });
  const kinds = m.edges.map((e) => `${e.from}${e.kind}${e.head}${e.to}:${e.label}`);
  assert.deepEqual(kinds, ['AnormalarrowB:', 'BnormalarrowC:yes', 'CnormalarrowD:no', 'DdottedarrowE:', 'EthickarrowF:', 'GnormalnoneH:', 'HnormalcircleI:', 'InormalcrossJ:']);
});

test('flowchart: TD is TB, ampersand groups, chains, comments, semicolons', () => {
  const m = parse(`graph TD
    %% a comment
    a --> b & c --> d; d --> a`);
  assert.equal(m.dir, 'TB');
  assert.equal(m.edges.length, 5);
  assert.ok(m.edges.some((e) => e.from === 'c' && e.to === 'd'));
});

test('flowchart: quoted labels keep brackets, quotes and html entities', () => {
  const m = parse('flowchart TD\n A["x [y] (z) {w}"] --> B["He said #quot;hi#quot;<br/>next"]');
  assert.equal(m.nodes.get('A').label, 'x [y] (z) {w}');
  assert.equal(m.nodes.get('B').label, 'He said "hi"\nnext');
});

test('flowchart: subgraphs, nesting, direction, classDef, class, :::', () => {
  const m = parse(`flowchart TD
    subgraph outer [Outer box]
      direction LR
      a --> b
      subgraph inner
        c
      end
    end
    classDef hot fill:#f96,stroke:#333
    class a hot
    d:::hot --> a`);
  assert.deepEqual(m.groups.map((g) => [g.id, g.parent, g.members]), [['outer', null, ['a', 'b']], ['inner', 'outer', ['c']]]);
  assert.equal(m.groups[0].dir, 'LR');
  assert.equal(m.groups[0].label, 'Outer box');
  assert.deepEqual(m.nodes.get('a').classes, ['hot']);
  assert.deepEqual(m.nodes.get('d').classes, ['hot']);
  assert.equal(m.classDefs.hot.fill, '#f96');
});

test('state diagram', () => {
  const m = parse('stateDiagram-v2\n [*] --> Idle\n Idle --> Run : go\n state Run {\n  [*] --> A\n }\n Run --> [*]');
  assert.equal(m.isState, true);
  assert.ok(m.nodes.has('__start_') && m.nodes.has('__end_') && m.nodes.has('A'));
  assert.equal(m.edges.find((e) => e.label === 'go').from, 'Idle');
});

test('sequence diagram', () => {
  const m = parse(`sequenceDiagram
    autonumber
    participant A as Alice
    A->>B: hi
    B-->>A: yo
    Note over A,B: n
    loop each
      A->>+B: x
      B-->>-A: y
    end`);
  assert.equal(m.type, 'sequence');
  assert.equal(m.autonumber, true);
  assert.deepEqual(m.participants.map((p) => [p.id, p.label]), [['A', 'Alice'], ['B', 'B']]);
  assert.deepEqual(m.items.map((i) => i.t), ['msg', 'msg', 'note', 'open', 'msg', 'activate', 'msg', 'deactivate', 'close']);
});

test('unsupported types are reported, not guessed', () => {
  assert.deepEqual(parse('pie title x\n "a": 1'), { type: 'unsupported', kind: 'pie' });
  assert.deepEqual(parse('gantt\n title x'), { type: 'unsupported', kind: 'gantt' });
  assert.equal(parse('classDiagram\n A <|-- B').type, 'unsupported');
});

test('front matter and init directives are skipped', () => {
  const d = detect('---\ntitle: T\n---\n%%{init: {"theme":"dark"}}%%\nflowchart TD\n A-->B');
  assert.equal(d.kind, 'flowchart');
  assert.equal(d.title, 'T');
});

test('malformed source throws ParseError with the line number', () => {
  assert.throws(() => parse('flowchart TD\n A --> B\n B -?> C'), (e) => e instanceof ParseError && e.line === 3);
  assert.throws(() => parse('flowchart TD\n subgraph X\n A --> B'), (e) => e instanceof ParseError);
  assert.throws(() => parse('flowchart TD\n end'), (e) => e instanceof ParseError && e.line === 2);
  assert.throws(() => parse('sequenceDiagram\n loop x\n A->>B: y'), (e) => e instanceof ParseError);
});

test('cleanLabel never produces markup the renderer would trust', () => {
  assert.equal(cleanLabel('<script>x</script>'), '<script>x</script>');
  assert.equal(cleanLabel('<b>a</b><br>b'), 'a\nb');
});

