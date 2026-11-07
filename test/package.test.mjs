// Tests of the stage step of tools/package.mjs on a fake install in a scratch folder.
//   node --test test/package.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stage, EXE } from '../tools/package.mjs';

function fakeInstall(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-pack-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const from = path.join(d, 'DeepSeek Harness');
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(from, rel)), { recursive: true }); fs.writeFileSync(path.join(from, rel), text); };
  put('DeepSeek Harness.exe', 'program');
  put('Uninstall DeepSeek Harness.exe', 'old uninstaller');
  put('elevate.exe', 'x');
  put('resources/app.asar', 'archive');
  put('resources/app-update.yml', 'feed');
  put('resources/runtime/cli/bin/arc.cmd', '"%~dp0..\\..\\..\\..\\DeepSeek Harness.exe" --expose-internals x %*\r\n');
  return { from, to: path.join(d, 'stage', 'Arc Harness') };
}

test('stage gives the program the Arc name and drops the old uninstaller and update feed', (t) => {
  const { from, to } = fakeInstall(t);
  const done = stage(from, to);
  assert.ok(fs.existsSync(path.join(to, EXE)));
  assert.ok(!fs.existsSync(path.join(to, 'DeepSeek Harness.exe')));
  assert.ok(!fs.existsSync(path.join(to, 'Uninstall DeepSeek Harness.exe')));
  assert.ok(!fs.existsSync(path.join(to, 'resources', 'app-update.yml')));
  assert.equal(fs.readFileSync(path.join(to, 'resources', 'app.asar'), 'utf8'), 'archive');
  assert.equal(fs.readFileSync(path.join(to, 'resources/runtime/cli/bin/arc.cmd'), 'utf8'), '"%~dp0..\\..\\..\\..\\Arc Harness.exe" --expose-internals x %*\r\n');
  assert.equal(done.length, 2);
});

test('stage leaves the source install as it was', (t) => {
  const { from, to } = fakeInstall(t);
  stage(from, to);
  assert.ok(fs.existsSync(path.join(from, 'DeepSeek Harness.exe')));
  assert.ok(fs.existsSync(path.join(from, 'resources', 'app-update.yml')));
});

test('stage refuses a folder with no app archive, and a stage that keeps an old name', (t) => {
  const { from, to } = fakeInstall(t);
  fs.rmSync(path.join(from, 'resources', 'app.asar'));
  assert.throws(() => stage(from, to), /no resources\/app.asar/);
  fs.writeFileSync(path.join(from, 'resources', 'app.asar'), 'archive');
  fs.writeFileSync(path.join(from, 'resources', 'deepseek-notes.txt'), 'x');
  assert.throws(() => stage(from, to), /old names left in the stage: resources.deepseek-notes.txt/);
});
