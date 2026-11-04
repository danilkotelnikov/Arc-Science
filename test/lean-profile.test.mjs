// Tests of the undo list of tools/lean-profile.mjs: each data home (ARC_HOME, --home, the default) keeps its own original lists.
//   node --test test/lean-profile.test.mjs
// Every home and the undo file live in a scratch folder; the kit's own brandtext/lean-profile.undo.json is never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, resolveHome, homeKey, readUndo } from '../tools/lean-profile.mjs';

const LEAN = ['@arc-harness/arc-base', '@arc-harness/arc-web-app', 'arc-theme', 'arc-hoh'];
const A = {
  web: ['@arc-harness/arc-base', 'arc-context', '@arc-harness/arc-web-app', 'aegis'],
  desktop: ['@arc-harness/arc-base', '@arc-harness/arc-web-app', 'arc-better-sidebar'],
};
const B = {
  web: ['arc-chat-import', '@arc-harness/arc-base', '@arc-harness/arc-web-app', '@liustack/modsearch', 'arc-vision-router'],
  desktop: ['@arc-harness/arc-web-app', '@arc-harness/arc-base', 'superpowers-arc'],
};

// A scratch folder with an undo file path and a maker of data homes whose profiles have the lean "add" packages installed.
function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-lean-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const makeHome = (name, lists) => {
    const home = path.join(dir, name);
    for (const [prof, bundles] of Object.entries(lists)) {
      const p = path.join(home, 'profiles', prof);
      for (const b of ['arc-theme', 'arc-hoh']) fs.mkdirSync(path.join(p, 'node_modules', b), { recursive: true });
      fs.writeFileSync(path.join(p, 'package.json'), JSON.stringify({ name: `profile-${prof}`, arc: { profile: { bundles } } }, null, 2) + '\n');
    }
    return home;
  };
  const lines = [];
  // legacyHome points at a folder no test uses, so an old flat file can never reach the homes under test by accident
  const opts = { undoFile: path.join(dir, 'lean-profile.undo.json'), legacyHome: path.join(dir, 'legacy-home'), log: (l) => lines.push(l) };
  return { dir, makeHome, opts, lines };
}
const bundles = (home, prof) => JSON.parse(fs.readFileSync(path.join(home, 'profiles', prof, 'package.json'), 'utf8')).arc.profile.bundles;
const undoOf = (opts) => JSON.parse(fs.readFileSync(opts.undoFile, 'utf8'));

test('resolveHome: --home, then ARC_HOME, always resolved', (t) => {
  const { dir } = scratch(t);
  const a = path.join(dir, 'a'), b = path.join(dir, 'b');
  assert.equal(resolveHome([], { ARC_HOME: a }), path.resolve(a), 'ARC_HOME selects the home');
  assert.equal(resolveHome(['status'], { ARC_HOME: ` ${a} ` }), path.resolve(a), 'ARC_HOME is trimmed');
  assert.equal(resolveHome(['status'], { ARC_HOME: path.relative(process.cwd(), a) || '.' }), path.resolve(a), 'a relative ARC_HOME is resolved');
  assert.equal(resolveHome(['apply', '--home', b], { ARC_HOME: a }), path.resolve(b), '--home wins over ARC_HOME');
  assert.equal(homeKey(path.join(a, '..', 'a')), homeKey(a), 'the key of a home does not depend on how the path is spelled');
});

test('two ARC_HOME homes keep their own original lists through apply and restore', (t) => {
  const { makeHome, opts } = scratch(t);
  const a = makeHome('a', A), b = makeHome('b', B);
  const homeA = resolveHome([], { ARC_HOME: a }), homeB = resolveHome([], { ARC_HOME: b });

  run('apply', homeA, opts);
  run('apply', homeB, opts);
  for (const p of ['web', 'desktop']) {
    assert.deepEqual(bundles(a, p).slice().sort(), LEAN.slice().sort(), `A ${p} is lean`);
    assert.deepEqual(bundles(b, p).slice().sort(), LEAN.slice().sort(), `B ${p} is lean`);
  }
  assert.deepEqual(undoOf(opts), { homes: { [homeKey(a)]: A, [homeKey(b)]: B } }, 'one entry per home, each with its own lists');

  run('restore', homeA, opts);
  assert.deepEqual(bundles(a, 'web'), A.web, 'A web is back');
  assert.deepEqual(bundles(a, 'desktop'), A.desktop, 'A desktop is back');
  assert.deepEqual(bundles(b, 'web').slice().sort(), LEAN.slice().sort(), 'restoring A leaves B lean');
  assert.deepEqual(undoOf(opts), { homes: { [homeKey(b)]: B } }, 'restoring A keeps the saved lists of B');

  run('restore', homeB, opts);
  assert.deepEqual(bundles(b, 'web'), B.web, 'B web gets its own list back, not the one of A');
  assert.deepEqual(bundles(b, 'desktop'), B.desktop, 'B desktop gets its own list back');
  assert.deepEqual(undoOf(opts), { homes: {} }, 'nothing is left to restore');
});

test('a second apply of one home overwrites neither its own nor another home\'s original list', (t) => {
  const { makeHome, opts } = scratch(t);
  const a = makeHome('a', A), b = makeHome('b', B);
  run('apply', resolveHome([], { ARC_HOME: a }), opts);
  run('apply', resolveHome([], { ARC_HOME: b }), opts);
  run('apply', resolveHome([], { ARC_HOME: a }), opts);
  run('apply', resolveHome([], { ARC_HOME: b }), opts);
  assert.deepEqual(undoOf(opts), { homes: { [homeKey(a)]: A, [homeKey(b)]: B } });
  run('restore', resolveHome([], { ARC_HOME: b }), opts);
  run('restore', resolveHome([], { ARC_HOME: a }), opts);
  assert.deepEqual(bundles(a, 'web'), A.web);
  assert.deepEqual(bundles(b, 'web'), B.web);
});

test('restore of a home with nothing saved changes nothing and keeps the other homes', (t) => {
  const { makeHome, opts, lines } = scratch(t);
  const a = makeHome('a', A), b = makeHome('b', B);
  run('apply', resolveHome([], { ARC_HOME: a }), opts);
  lines.length = 0;
  run('restore', resolveHome([], { ARC_HOME: b }), opts);
  assert.deepEqual(lines, ['web: nothing saved to restore', 'desktop: nothing saved to restore']);
  assert.deepEqual(bundles(b, 'web'), B.web, 'B is not given the list of A');
  assert.deepEqual(undoOf(opts), { homes: { [homeKey(a)]: A } }, 'the saved lists of A stay');
  lines.length = 0;
  run('status', resolveHome([], { ARC_HOME: a }), opts);
  assert.match(lines[0], /^web: 4 bundles \(lean, original list saved\)/);
  lines.length = 0;
  run('status', resolveHome([], { ARC_HOME: b }), opts);
  assert.doesNotMatch(lines.join('\n'), /original list saved/, 'status of B does not see the list of A');
});

test('ARC_HOME and --home naming the same folder share one entry', (t) => {
  const { makeHome, opts } = scratch(t);
  const a = makeHome('a', A);
  run('apply', resolveHome([], { ARC_HOME: path.join(a, '..', 'a') }), opts);
  run('restore', resolveHome(['restore', '--home', a], {}), opts);
  assert.deepEqual(bundles(a, 'web'), A.web);
  assert.deepEqual(bundles(a, 'desktop'), A.desktop);
  assert.deepEqual(undoOf(opts), { homes: {} });
});

test('a failed apply writes neither profiles nor the undo list', (t) => {
  const { makeHome, opts } = scratch(t);
  const a = makeHome('a', A);
  fs.rmSync(path.join(a, 'profiles', 'desktop', 'node_modules', 'arc-hoh'), { recursive: true });
  assert.throws(() => run('apply', resolveHome([], { ARC_HOME: a }), opts), /arc-hoh is not installed/);
  assert.deepEqual(bundles(a, 'web'), A.web);
  assert.equal(fs.existsSync(opts.undoFile), false);
});

test('an old flat undo file belongs to the legacy home only and moves under "homes"', (t) => {
  const { makeHome, opts } = scratch(t);
  const a = makeHome('a', A), b = makeHome('b', B);
  const legacy = { ...opts, legacyHome: a };
  run('apply', resolveHome([], { ARC_HOME: a }), opts); // A's profiles are lean, its originals are saved
  fs.writeFileSync(opts.undoFile, JSON.stringify({ web: A.web, desktop: A.desktop }, null, 2) + '\n'); // as the old tool wrote it

  assert.deepEqual(readUndo(opts.undoFile, a), { [homeKey(a)]: A });
  run('restore', resolveHome([], { ARC_HOME: b }), legacy);
  assert.deepEqual(bundles(b, 'web'), B.web, 'another home does not get the old lists');
  assert.deepEqual(undoOf(opts), { homes: { [homeKey(a)]: A } }, 'the old lists are kept under the legacy home');

  run('restore', resolveHome([], { ARC_HOME: a }), legacy);
  assert.deepEqual(bundles(a, 'web'), A.web);
  assert.deepEqual(bundles(a, 'desktop'), A.desktop);
  assert.deepEqual(undoOf(opts), { homes: {} });
});
