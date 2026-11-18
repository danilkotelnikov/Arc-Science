// Tests for write-once 1M Library reader/builder and Platt calibration routing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LIBRARY_SCHEMA,
  DECISION_SCHEMA,
  ColdRawStore,
  buildWriteOnceCatalog,
  canonicalDigest,
  evaluateCalibrationPacket,
  extractQueryDateCues,
  fitPlatt2Fold,
  hashTokenU64,
  openLibraryCatalog,
  tokenizeBilingual,
} from '../lib/library-index.js';

test('1. hashTokenU64 matches RFC 7693 little-endian 64-bit blake2b for English and Russian tokens', () => {
  // Python: hexbytes = hashlib.blake2b(b"calibration", digest_size=8).digest() -> d6b98cf1a5b92152 -> LE uint64 0x5221b9a5f18cb9d6
  assert.equal(hashTokenU64('calibration'), 0x5221b9a5f18cb9d6n);
  const ruToks = tokenizeBilingual('Калибровка индекса, release 2026!');
  assert.deepEqual(ruToks, ['калибровка', 'индекса', 'release', '2026']);
  assert.notEqual(hashTokenU64(ruToks[0]), 0n);
});

test('2. Write-once build deduplicates by SHA-256 and id without re-tokenizing', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-lib-dedup-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const cold = new ColdRawStore();
  const records = [
    { id: 'c1', date_iso: '2026-01-10', topic: 'topic:bench', body: 'Platt threshold calibration note' },
    { id: 'c2', date_iso: '2026-01-11', topic: 'topic:bench', body: '  Platt threshold calibration note\r\n' },
    { id: 'c1', date_iso: '2026-01-10', topic: 'topic:bench', body: 'Duplicate id should skip' },
  ];
  const { manifest } = buildWriteOnceCatalog(tmpDir, records, { coldStore: cold });
  assert.equal(manifest.schema, LIBRARY_SCHEMA);
  assert.equal(manifest.n_total, 2);
  assert.equal(manifest.unique_sha256, 1);
  assert.equal(manifest.dedup_stats.new_tokenized, 1);
  assert.equal(manifest.dedup_stats.reused_by_sha256, 1);
  assert.equal(manifest.dedup_stats.skipped_by_id, 1);
});

test('3. Warm search guarantees rawBodyReads === 0 and locks out ColdRawStore', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-lib-warm-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const cold = new ColdRawStore();
  const { state } = buildWriteOnceCatalog(tmpDir, [
    { id: 'n1', date_iso: '2026-11-01', topic: 'topic:storage', body: 'Quotient graph memory reduction for viral capsids' },
    { id: 'n2', date_iso: '2026-11-02', topic: 'topic:parser', body: 'Sentence case grammar rules for desktop panels' },
  ], { coldStore: cold });
  assert.ok(state.newTokenized >= 2);
  cold.rawBodyReads = 0;
  cold.warmLocked = true;
  assert.throws(() => cold.readRawBody('n1'), /Warm query attempted cold raw-body read/);
  cold.rawBodyReads = 0;

  const lib = openLibraryCatalog(tmpDir, { coldStore: cold });
  t.after(() => lib.close());
  assert.equal(lib.hasDigestHex(canonicalDigest('Quotient graph memory reduction for viral capsids').toString('hex')), true);
  const res = lib.searchWarm('quotient graph viral capsids');
  assert.equal(res.rawBodyReads, 0);
  assert.equal(cold.rawBodyReads, 0);
  assert.equal(res.hits[0].id, 'n1');
  assert.equal(res.decision.schema, DECISION_SCHEMA);
  assert.equal(res.decision.warm_verified, true);
});

test('4. Write-time supersession flips stale notes below current revisions while preserving explicit date pins', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-lib-sup-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const { manifest } = buildWriteOnceCatalog(tmpDir, [
    {
      id: 'policy-old',
      date_iso: '2024-03-15',
      topic: 'topic:pr-budget',
      body: 'Macroscope budget cap policy limit parameter alpha',
    },
    {
      id: 'policy-new',
      date_iso: '2026-11-15',
      topic: 'topic:pr-budget',
      supersedesId: 'policy-old',
      body: 'Macroscope budget policy latest rule ten dollars',
    },
  ]);
  assert.equal(manifest.supersession_edges >= 1, true);

  const lib = openLibraryCatalog(tmpDir);
  t.after(() => lib.close());
  const updateRes = lib.searchWarm('macroscope budget cap policy parameter');
  const oldPos = updateRes.hits.findIndex((h) => h.id === 'policy-old');
  const newPos = updateRes.hits.findIndex((h) => h.id === 'policy-new');
  assert.ok(newPos >= 0, 'latest revision surfaced');
  assert.ok(oldPos === -1 || newPos < oldPos, 'current revision outranks superseded note');

  const pinnedRes = lib.searchWarm('macroscope budget policy in 2024');
  assert.equal(pinnedRes.hits[0].id, 'policy-old');
});

test('5. 2-fold OOF Platt calibration and search_wider widening decision preserve hits monotonically', (t) => {
  const logits = [-2.5, -1.8, -1.1, -0.4, 0.5, 1.2, 1.9, 2.6, -2.0, -0.8, 0.9, 2.2];
  const labels = [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1];
  const cal = fitPlatt2Fold(logits, labels);
  assert.ok(cal.oofBrier < cal.baseBrier);
  assert.ok(cal.brierSkillScore > 0.3);

  const lowMargin = evaluateCalibrationPacket({ topScore: 1.0, secondScore: 0.9, stage1Count: 24 });
  assert.equal(lowMargin.search_wider, true);
  assert.equal(lowMargin.action, 'search_wider');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-lib-widen-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const cards = [];
  for (let i = 0; i < 12; i++) {
    cards.push({ id: `card-${i}`, date_iso: '2026-11-10', topic: `topic:w${i}`, body: `shared lattice keyword item ${i}` });
  }
  buildWriteOnceCatalog(tmpDir, cards);
  const lib = openLibraryCatalog(tmpDir);
  t.after(() => lib.close());
  const narrow = lib.searchWarm('shared lattice keyword', { topK: 4, stage1Limit: 4, widen: false });
  const wide = lib.searchWarm('shared lattice keyword', { topK: 4, stage1Limit: 4, widen: true });
  assert.ok(wide.hits.length >= narrow.hits.length);
  const wideSet = new Set(wide.hits.map((h) => h.id));
  for (const h of narrow.hits) assert.equal(wideSet.has(h.id), true);
});

test('6. Optional live Python library_catalog_real compatibility check (if ARC_TEST_LIBRARY_CATALOG is set)', () => {
  const catDir = process.env.ARC_TEST_LIBRARY_CATALOG;
  if (!catDir || !fs.existsSync(path.join(catDir, 'manifest.json'))) return;
  const cold = new ColdRawStore();
  cold.warmLocked = true;
  const lib = openLibraryCatalog(catDir, { coldStore: cold });
  try {
    const stats = lib.warmStats();
    assert.equal(stats.schema, LIBRARY_SCHEMA);
    assert.ok(stats.nReal >= 65839);
    const out = lib.searchWarm('calibration threshold platt', { topK: 10, stage1Limit: 120 });
    assert.equal(out.rawBodyReads, 0);
    assert.ok(out.hits.length > 0);
  } finally {
    lib.close();
  }
});

test('7. Token-boundary date cues, lock guards, cycle/topic:general exclusion, close guards, and fd cleanup', (t) => {
  const noMonth = extractQueryDateCues('maybe summary');
  assert.equal(noMonth.monthsNamed.size, 0);
  const cues = extractQueryDateCues('maybe summary march 14.XI.2026');
  assert.equal(cues.monthsNamed.has(3), true);
  assert.equal(cues.monthsNamed.has(11), true);
  assert.equal(cues.years.has(2026), true);

  const cold = new ColdRawStore();
  cold.lockWarm({ resetCounter: true });
  assert.throws(() => cold.put('x', 'blocked'), /warm-locked/);
  const inner = new ColdRawStore();
  assert.equal(inner.withWarmLock((s) => s.warmLocked), true);
  assert.equal(inner.warmLocked, false);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-lib-reg-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const { manifest } = buildWriteOnceCatalog(tmpDir, [
    { id: 'gen-1', date_iso: '2024-01-01', topic: 'topic:general', body: 'general note alpha protocol' },
    { id: 'gen-2', date_iso: '2026-01-01', topic: 'topic:general', body: 'general note beta protocol' },
    { id: 'ch-a', date_iso: '2024-02-01', topic: 'topic:calib', body: 'calib chain alpha rule detail' },
    { id: 'ch-b', date_iso: '2025-02-01', topic: 'topic:calib', body: 'calib chain beta rule' },
    { id: 'ch-c', date_iso: '2026-02-01', topic: 'topic:calib', body: 'calib chain current rule' },
  ]);
  assert.equal(manifest.supersession_edges, 2);

  const lib = openLibraryCatalog(tmpDir);
  const res = lib.searchWarm('calib chain alpha rule detail');
  const posC = res.hits.findIndex((h) => h.id === 'ch-c');
  const posB = res.hits.findIndex((h) => h.id === 'ch-b');
  const posA = res.hits.findIndex((h) => h.id === 'ch-a');
  assert.equal(posC, 0);
  assert.ok(posB === -1 || posC < posB);
  assert.ok(posA === -1 || posC < posA);

  lib.close();
  assert.throws(() => lib.warmStats(), /Catalog already closed/);
  assert.throws(() => lib.hasDigestHex('00'.repeat(32)), /Catalog already closed/);
  assert.throws(() => lib.searchWarm('calib'), /Catalog already closed/);

  // Malformed .npy header must throw and close all opened descriptors so directory removal succeeds on Windows
  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-lib-badnpy-'));
  fs.cpSync(tmpDir, badDir, { recursive: true });
  const badHeader = "{'descr': '<i4', 'fortran_order': True, 'shape': (5,), }";
  const pad = ' '.repeat((16 - ((10 + badHeader.length + 1) % 16)) % 16);
  const pre = Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 0x01, 0x00, 0, 0]);
  pre.writeUInt16LE(badHeader.length + pad.length + 1, 8);
  fs.writeFileSync(path.join(badDir, 'meta', 'date_yyyymmdd.npy'), Buffer.concat([pre, Buffer.from(`${badHeader}${pad}\n`, 'latin1'), Buffer.alloc(20)]));
  assert.throws(() => openLibraryCatalog(badDir), /Fortran-order/);
  fs.rmSync(badDir, { recursive: true, force: true });

  // Regression: distinct-title duplicate body, equal-date sibling supersession, O(n) root chain, and month-specific pinOldDate
  const regDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-lib-fix-'));
  t.after(() => fs.rmSync(regDir, { recursive: true, force: true }));
  const sharedBody = 'shared experimental assay body';
  const { manifest: m2 } = buildWriteOnceCatalog(regDir, [
    { id: 'dup-1', title: 'AlphaTitleOne', date_iso: '2025-01-10', topic: 'topic:dup', body: sharedBody },
    { id: 'dup-2', title: 'ZetaTitleTwo', date_iso: '2025-02-10', topic: 'topic:dup', body: sharedBody },
    { id: 'sib-a', date_iso: '2024-02-05', topic: 'topic:sib', body: 'qxzfebruaryrule protocol' },
    { id: 'sib-b', date_iso: '2024-02-05', topic: 'topic:sib', body: 'qxzfebruaryrule checklist' },
    { id: 'sib-nov', date_iso: '2024-11-05', topic: 'topic:sib', body: 'qxzfebruaryrule november' },
    { id: 'sib-cur', date_iso: '2026-03-01', topic: 'topic:sib', body: 'qxzfebruaryrule current' },
  ]);
  assert.equal(m2.dedup_stats.reused_by_sha256, 1);
  assert.equal(m2.supersession_edges, 4);
  const lib2 = openLibraryCatalog(regDir);
  t.after(() => lib2.close());
  assert.ok(lib2.searchWarm('ZetaTitleTwo').hits.some((h) => h.id === 'dup-2'));
  const febHits = lib2.searchWarm('February 2024 qxzfebruaryrule').hits.map((h) => h.id);
  assert.ok(febHits.indexOf('sib-a') < febHits.indexOf('sib-cur'));
  assert.ok(febHits.indexOf('sib-b') < febHits.indexOf('sib-cur'));
  assert.ok(febHits.indexOf('sib-cur') < febHits.indexOf('sib-nov'));
});
