import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_EXCLUDE = new Set(['.git', 'node_modules', 'build', 'target', '.venv']);

function walkSortedFiles(rootDir, currentDir, excludeSet, out) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const ent of entries) {
    if (excludeSet.has(ent.name)) continue;
    const abs = path.join(currentDir, ent.name);
    if (ent.isDirectory()) {
      walkSortedFiles(rootDir, abs, excludeSet, out);
    } else if (ent.isFile()) {
      const rel = path.relative(rootDir, abs).replaceAll('\\', '/');
      out.push({ rel, abs });
    }
  }
}

/** Deterministic SHA-256 snapshot of all non-excluded files under rootDir (G1.4). */
export function snapshotTreeHashes(rootDir, { exclude } = {}) {
  if (typeof rootDir !== 'string' || !fs.existsSync(rootDir)) {
    throw new Error(`snapshotTreeHashes: rootDir does not exist: ${rootDir}`);
  }
  const excludeSet = new Set(exclude || DEFAULT_EXCLUDE);
  const items = [];
  walkSortedFiles(rootDir, rootDir, excludeSet, items);
  items.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const files = Object.create(null);
  const treeHasher = crypto.createHash('sha256');
  for (const { rel, abs } of items) {
    const buf = fs.readFileSync(abs);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    files[rel] = { sha256, bytes: buf.length };
    treeHasher.update(`${rel}:${sha256}\n`);
  }
  return {
    rootDir,
    fileCount: items.length,
    treeHash: treeHasher.digest('hex'),
    files,
    capturedAt: new Date().toISOString(),
  };
}

/** Compute exact added, modified, and removed relative paths between two snapshots (G1.5). */
export function computeDeltaDiff(preSnapshot, postSnapshot) {
  const preFiles = preSnapshot?.files || {};
  const postFiles = postSnapshot?.files || {};
  const added = [];
  const modified = [];
  const removed = [];
  let unchangedCount = 0;

  for (const key of Object.keys(postFiles).sort()) {
    if (!(key in preFiles)) added.push(key);
    else if (preFiles[key].sha256 !== postFiles[key].sha256) modified.push(key);
    else unchangedCount += 1;
  }
  for (const key of Object.keys(preFiles).sort()) {
    if (!(key in postFiles)) removed.push(key);
  }
  return { added, modified, removed, unchangedCount };
}

/** Record a pre/post tree delta row and guard R012 protected file hashes (G1.6). */
export function recordDeltaRow({ id, preSnapshot, postSnapshot, protectedHashes = {} } = {}) {
  if (!id || !preSnapshot?.treeHash || !postSnapshot?.treeHash) {
    return { ok: false, state: 'fail_bad_delta_args', error: 'id, preSnapshot, and postSnapshot are required' };
  }
  const diff = computeDeltaDiff(preSnapshot, postSnapshot);
  const modifiedProtected = [];
  for (const [relRaw, expectedSha] of Object.entries(protectedHashes || {})) {
    const rel = relRaw.replaceAll('\\', '/');
    const actual = postSnapshot.files?.[rel]?.sha256 || null;
    if (actual !== expectedSha) modifiedProtected.push({ file: rel, expected: expectedSha, actual });
  }
  if (modifiedProtected.length > 0) {
    return {
      ok: false,
      state: 'fail_protected_modified',
      rule: 'R012',
      id,
      modifiedProtected,
      preTreeHash: preSnapshot.treeHash,
      postTreeHash: postSnapshot.treeHash,
      diff,
    };
  }
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify({ id, preTreeHash: preSnapshot.treeHash, postTreeHash: postSnapshot.treeHash, diff }))
    .digest('hex');
  return {
    ok: true,
    state: 'pass',
    id,
    recordedAt: new Date().toISOString(),
    preTreeHash: preSnapshot.treeHash,
    postTreeHash: postSnapshot.treeHash,
    diff,
    digest,
  };
}

/** Verify a recorded delta row against recomputed pre and post snapshots (G1.7). */
export function verifyDeltaPair(row, preSnapshot, postSnapshot) {
  if (!row || !preSnapshot || !postSnapshot) {
    return { ok: false, state: 'fail_missing_delta_inputs' };
  }
  if (row.preTreeHash !== preSnapshot.treeHash || row.postTreeHash !== postSnapshot.treeHash) {
    return { ok: false, state: 'fail_delta_tampered', reason: 'tree hash mismatch' };
  }
  const recomputedDiff = computeDeltaDiff(preSnapshot, postSnapshot);
  const recomputedDigest = crypto
    .createHash('sha256')
    .update(JSON.stringify({ id: row.id, preTreeHash: row.preTreeHash, postTreeHash: row.postTreeHash, diff: recomputedDiff }))
    .digest('hex');
  if (recomputedDigest !== row.digest) {
    return { ok: false, state: 'fail_delta_tampered', reason: 'row digest mismatch' };
  }
  return { ok: true, state: 'pass', id: row.id, diff: recomputedDiff };
}
