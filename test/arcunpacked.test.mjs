// The Arc copy of a folder keeps its privacy: a private folder or file stays private. Only POSIX has these modes.
//   node --test test/arcunpacked.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeArcCopy } from '../lib/arcunpacked.mjs';
import { migrateHome } from '../tools/install.mjs';

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

test('a copy into its own source stops before it writes anything', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-copy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, 'src');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'a.bin'), 'data');
  assert.throws(() => makeArcCopy(src, path.join(src, 'inner.arc-new'), { link: false }), /inside its source/);
  assert.throws(() => makeArcCopy(src, path.join(src, 'x', 'y'), { link: false }), /inside its source/);
  assert.deepEqual(fs.readdirSync(src), ['a.bin'], 'nothing was written');
  assert.equal(makeArcCopy(src, path.join(dir, 'src-copy'), { link: false }).copied, 1, 'a sibling with a similar name is fine');
});

test('a file that cannot be linked is copied, as on another drive', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-copy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, 'src'), dst = path.join(dir, 'dst');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'a.bin'), 'data');
  t.mock.method(fs, 'linkSync', () => { throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' }); });
  const st = makeArcCopy(src, dst);
  assert.deepEqual([st.linked, st.copied], [0, 1]);
  assert.equal(fs.readFileSync(path.join(dst, 'a.bin'), 'utf8'), 'data');
});

test('a text file that is not UTF-8 keeps its bytes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-copy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, 'src'), dst = path.join(dir, 'dst');
  fs.mkdirSync(src);
  const latin = Buffer.from([0x64, 0x73, 0x68, 0x2d, 0x68, 0x6f, 0x68, 0x20, 0xe9]); // "dsh-hoh " and a Latin-1 letter
  fs.writeFileSync(path.join(src, 'note.md'), latin);
  fs.writeFileSync(path.join(src, 'bom.md'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('dsh-hoh')]));
  makeArcCopy(src, dst, { link: false });
  assert.deepEqual(fs.readFileSync(path.join(dst, 'note.md')), latin);
  assert.deepEqual(fs.readFileSync(path.join(dst, 'bom.md')), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('arc-hoh')]), 'a valid file is rewritten and keeps its byte order mark');
});

test('a failed data copy leaves nothing behind, so the next install can try again', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-copy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const old = path.join(dir, '.dsh'), home = path.join(dir, '.arc');
  for (const n of ['dsh-theme-pair', 'arc-theme']) fs.mkdirSync(path.join(old, 'profiles', 'web', 'node_modules', n), { recursive: true });
  assert.throws(() => migrateHome(home, old), /target collision/);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['.dsh'], 'no partial copy and no ~/.arc');
});

test('the install copies the data before it replaces the app', () => {
  const s = fs.readFileSync(new URL('../tools/install.mjs', import.meta.url), 'utf8');
  const copy = s.search(/^  migrateHome\(\);/m);
  assert.ok(copy > 0 && copy < s.indexOf("swap(built, live('app.asar'))"));
});
