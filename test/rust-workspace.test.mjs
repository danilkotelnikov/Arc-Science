import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runToTempFile, arcBinaryPath, buildArcCli, testWorkspace } from '../tools/rust-dist.mjs';
import { sha256, checkDigest, hashFiles } from '../plugins/arc-hoh/lib/gates.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Rust workspace cargo test passes all crates including 524,288-state Change Tree proof', () => {
  const res = testWorkspace();
  assert.equal(res.error, null, `cargo spawn failed: ${res.error}`);
  assert.equal(res.status, 0, `cargo test failed:\n${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout + res.stderr, /exhaustive_524288_state_proof_of_p1_through_p10 \.\.\. ok/);
});

test('Compiled arc CLI reports version, zero-DSH, 5 targets, and passes selftest', () => {
  const built = buildArcCli({ release: false });
  assert.equal(built.status, 0, `cargo build arc-cli failed:\n${built.stderr}`);
  const bin = arcBinaryPath('debug');
  assert.ok(fs.existsSync(bin), `expected arc binary at ${bin}`);

  const ver = runToTempFile(bin, ['version'], repoRoot);
  assert.equal(ver.status, 0, ver.stderr);
  const verJson = JSON.parse(ver.stdout.trim());
  assert.equal(verJson.name, 'arc');
  assert.equal(verJson.version, '0.6.1');
  assert.equal(verJson.dsh_dependency, false);

  const tgts = runToTempFile(bin, ['targets'], repoRoot);
  assert.equal(tgts.status, 0, tgts.stderr);
  const tgtJson = JSON.parse(tgts.stdout.trim());
  assert.equal(tgtJson.length, 5);
  assert.deepEqual(
    tgtJson.map((t) => t.triple),
    [
      'x86_64-pc-windows-msvc',
      'aarch64-pc-windows-msvc',
      'x86_64-unknown-linux-musl',
      'aarch64-unknown-linux-musl',
      'aarch64-apple-darwin',
    ]
  );

  const self = runToTempFile(bin, ['selftest'], repoRoot);
  assert.equal(self.status, 0, self.stderr);
  const selfJson = JSON.parse(self.stdout.trim());
  assert.equal(selfJson.ok, true);
  assert.equal(selfJson.dsh_dependency, false);
  assert.equal(selfJson.targets, 5);
});

test('SHA-256, checkDigest, and candidate hash parity between JS gates.js and Rust arc CLI', async () => {
  const bin = arcBinaryPath('debug');
  assert.ok(fs.existsSync(bin), `expected arc binary at ${bin}`);

  // 1. Direct SHA-256 parity
  const sample = 'cargo test --manifest-path native/Cargo.toml';
  const rustSha = runToTempFile(bin, ['check-sha256', sample], repoRoot);
  assert.equal(rustSha.status, 0, rustSha.stderr);
  assert.equal(JSON.parse(rustSha.stdout.trim()).sha256, checkDigest(`  ${sample}  `));

  // 2. Candidate hashFiles parity over two temp files (testing arc_hoh_core::ledger::candidate_id_from_pairs)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-parity-'));
  try {
    const f1 = path.join(tmpDir, 'a.txt');
    const f2 = path.join(tmpDir, 'b.txt');
    fs.writeFileSync(f1, 'alpha\n', 'utf8');
    fs.writeFileSync(f2, 'beta\n', 'utf8');
    const jsRes = await hashFiles([f2, f1]);

    const rustCand = runToTempFile(bin, ['check-candidate', f2, f1], repoRoot);
    assert.equal(rustCand.status, 0, rustCand.stderr);
    const rustHash = JSON.parse(rustCand.stdout.trim()).candidate;
    assert.equal(rustHash, jsRes.candidate);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
