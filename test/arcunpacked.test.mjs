// The Arc copy of a folder keeps its privacy: a private folder or file stays private. Only POSIX has these modes.
//   node --test test/arcunpacked.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeArcCopy } from '../lib/arcunpacked.mjs';

const posix = { skip: process.platform === 'win32' && 'Windows has no POSIX modes' };
const mode = (p) => fs.statSync(p).mode & 0o777;

test('private folders and files stay private under a common umask', posix, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-copy-'));
  const old = process.umask(0o022);
  t.after(() => { process.umask(old); fs.rmSync(dir, { recursive: true, force: true }); });
  const src = path.join(dir, 'src'), dst = path.join(dir, 'dst');
  fs.mkdirSync(path.join(src, 'keys'), { recursive: true });
  fs.chmodSync(src, 0o700);
  fs.chmodSync(path.join(src, 'keys'), 0o700);
  fs.writeFileSync(path.join(src, 'keys', 'rewritten.json'), '{"home":".dsh"}');
  fs.writeFileSync(path.join(src, 'keys', 'copied.bin'), 'data');
  fs.chmodSync(path.join(src, 'keys', 'rewritten.json'), 0o600);
  fs.chmodSync(path.join(src, 'keys', 'copied.bin'), 0o600);
  const st = makeArcCopy(src, dst, { link: false });
  assert.equal(st.rewritten, 1, 'the text file went through the rewrite');
  assert.equal(mode(dst), 0o700, 'top folder');
  assert.equal(mode(path.join(dst, 'keys')), 0o700, 'inner folder');
  assert.equal(mode(path.join(dst, 'keys', 'rewritten.json')), 0o600, 'rewritten file');
  assert.equal(mode(path.join(dst, 'keys', 'copied.bin')), 0o600, 'copied file');
});

test('a read-only source folder can still be copied into', posix, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-copy-'));
  const src = path.join(dir, 'src'), dst = path.join(dir, 'dst');
  t.after(() => { fs.chmodSync(src, 0o700); fs.rmSync(dir, { recursive: true, force: true }); });
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'a.bin'), 'data');
  fs.chmodSync(src, 0o500);
  makeArcCopy(src, dst, { link: false });
  assert.equal(fs.readFileSync(path.join(dst, 'a.bin'), 'utf8'), 'data');
});
