import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  snapshotTreeHashes,
  computeDeltaDiff,
  recordDeltaRow,
  verifyDeltaPair,
} from '../lib/delta-ledger.js';

test('G1.4-G1.7 snapshotTreeHashes, delta diff, R012 protected hash guard, and tamper detection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-delta-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'protected.txt'), 'sealed-v1');
    fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'export const x = 1;\n');

    const pre = snapshotTreeHashes(dir);
    assert.equal(pre.fileCount, 2);

    fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'export const x = 2;\n');
    fs.writeFileSync(path.join(dir, 'src', 'extra.js'), 'export const y = 3;\n');
    const post = snapshotTreeHashes(dir);

    const diff = computeDeltaDiff(pre, post);
    assert.deepEqual(diff.added, ['src/extra.js']);
    assert.deepEqual(diff.modified, ['src/app.js']);
    assert.deepEqual(diff.removed, []);
    assert.equal(diff.unchangedCount, 1);

    const row = recordDeltaRow({
      id: 'delta-1',
      preSnapshot: pre,
      postSnapshot: post,
      protectedHashes: { 'protected.txt': pre.files['protected.txt'].sha256 },
    });
    assert.equal(row.state, 'pass');
    assert.equal(verifyDeltaPair(row, pre, post).state, 'pass');

    const tampered = { ...row, postTreeHash: '0'.repeat(64) };
    assert.equal(verifyDeltaPair(tampered, pre, post).state, 'fail_delta_tampered');

    const tamperedDiff = { ...row, diff: { ...row.diff, added: [] } };
    assert.equal(verifyDeltaPair(tamperedDiff, pre, post).state, 'fail_delta_tampered');

    const symPath = path.join(dir, 'src', 'link.js');
    try {
      fs.symlinkSync(path.join(dir, 'src', 'app.js'), symPath);
      assert.throws(() => snapshotTreeHashes(dir), /Unsupported symbolic link/);
      fs.rmSync(symPath, { force: true });
    } catch (err) {
      if (err?.code !== 'EPERM') throw err;
    }

    fs.writeFileSync(path.join(dir, 'protected.txt'), 'broken');
    const badPost = snapshotTreeHashes(dir);
    const blocked = recordDeltaRow({
      id: 'delta-2',
      preSnapshot: pre,
      postSnapshot: badPost,
      protectedHashes: { 'protected.txt': pre.files['protected.txt'].sha256 },
    });
    assert.equal(blocked.state, 'fail_protected_modified');
    assert.equal(blocked.rule, 'R012');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
