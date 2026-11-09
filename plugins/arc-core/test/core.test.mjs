// arc-core 0.1.0 (2026-11-08): run with node --test test/core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createArcCoreServer,
  normalizeCandidateHash,
  apply,
} from '../lib/index.js';

test('1. shelf.search returns deterministic cards with required fields', () => {
  const srv = createArcCoreServer();
  const res = srv.shelf.search({});
  assert.equal(res.ok, true);
  assert.ok(Array.isArray(res));
  assert.ok(res.length >= 6);
  for (const card of res) {
    assert.deepEqual(Object.keys(card), ['id', 'name', 'domain', 'license', 'status']);
    assert.equal(typeof card.id, 'string');
    assert.equal(typeof card.name, 'string');
  }
});

test('2. shelf.search filters by domain deterministically', () => {
  const srv = createArcCoreServer();
  const res = srv.shelf.search({ domain: 'structure' });
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 'chimerax-struct');
  assert.equal(res[0].domain, 'structure');
});

test('3. shelf.search filters by query terms and respects limit', () => {
  const srv = createArcCoreServer();
  const qRes = srv.shelf.search({ query: 'molecullage' });
  assert.equal(qRes.length, 1);
  assert.equal(qRes[0].id, 'molecullage-core');
  const limRes = srv.shelf.search({ limit: 2 });
  assert.equal(limRes.length, 2);
});

test('4. shelf.search loads a custom shelf JSON file from disk', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-core-shelf-'));
  const shelfPath = path.join(tmpDir, 'shelf.json');
  fs.writeFileSync(
    shelfPath,
    JSON.stringify([
      { id: 'custom-one', name: 'Custom Shelf One', domain: 'cad', license: 'MIT', status: 'verified' },
    ]),
    'utf8'
  );
  const srv = createArcCoreServer({ shelfPath });
  const res = srv.shelf.search({ domain: 'cad' });
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 'custom-one');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('5. claim.record accepts a published claim with a valid DOI', () => {
  const srv = createArcCoreServer();
  const res = srv.claim.record({
    id: 'c-doi',
    text: 'AlphaFold predicts protein coordinates accurately.',
    level: 'published',
    doi: '10.1038/s41586-021-03819-2',
  });
  assert.equal(res.ok, true);
  assert.equal(res.claim.id, 'c-doi');
  assert.equal(res.claim.doi, '10.1038/s41586-021-03819-2');
});

test('6. claim.record accepts claims with PMID, arXiv or URL identifiers', () => {
  const srv = createArcCoreServer();
  const r1 = srv.claim.record({ text: 'Indexed clinical study.', level: 'published', pmid: 'PMID:34265844' });
  const r2 = srv.claim.record({ text: 'Harness recursion paper.', level: 'published', arxiv: 'arXiv:2610.14224' });
  const r3 = srv.claim.record({ text: 'Specification page.', level: 'published', url: 'https://example.org/spec' });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r3.ok, true);
  assert.equal(srv.claim.list().length, 3);
});

test('7. claim.record refuses a published claim without source identifier under R006', () => {
  const srv = createArcCoreServer();
  const res = srv.claim.record({
    id: 'c-bad',
    text: 'Unbacked literature claim.',
    level: 'published',
  });
  assert.equal(res.ok, false);
  assert.equal(res.rule, 'R006');
  assert.match(res.error, /source identifier/i);
});

test('8. claim.record refuses placeholder or malformed DOI under R006', () => {
  const srv = createArcCoreServer();
  const res1 = srv.claim.record({
    text: 'Claim with placeholder DOI.',
    level: 'published',
    doi: 'unverified',
  });
  const res2 = srv.claim.record({
    text: 'Claim with malformed DOI.',
    level: 'published',
    doi: 'not-a-doi',
  });
  assert.equal(res1.ok, false);
  assert.equal(res1.rule, 'R006');
  assert.equal(res2.ok, false);
  assert.equal(res2.rule, 'R006');
});

test('9. claim.record accepts a measured claim with local evidence and dependsOn chain', () => {
  const srv = createArcCoreServer();
  const res = srv.claim.record({
    id: 'c-meas',
    text: 'Cold start finished in 42 ms.',
    level: 'measured',
    evidence: '_scratch/bench/start-v0.1.0.json',
    dependsOn: ['c-doi'],
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.claim.dependsOn, ['c-doi']);
});

test('10. gate.check normalizes optional leading sha256: prefix and accepts clean candidate', () => {
  const srv = createArcCoreServer();
  const h = 'a'.repeat(64);
  const r1 = srv.gate.check({
    candidateHash: `sha256:${h}`,
    checks: [{ id: 'unit', ok: true }, { id: 'syntax', exit: 0 }],
    proseErrors: 0,
  });
  const r2 = srv.gate.check({
    candidateHash: h,
    checks: [{ id: 'unit', ok: true }, { id: 'syntax', exit: 0 }],
    proseErrors: [],
  });
  assert.equal(r1.ok, true);
  assert.equal(r1.verdict, 'accepted');
  assert.equal(r1.candidateHash, h);
  assert.deepEqual(r1.failedChecks, []);
  assert.deepEqual(r1, r2);
  assert.equal(normalizeCandidateHash('SHA256:abc123'), 'abc123');
});

test('11. gate.check rejects when checks fail or proseErrors are present', () => {
  const srv = createArcCoreServer();
  const r = srv.gate.check({
    candidateHash: 'sha256:deadbeef',
    checks: [{ id: 'unit', ok: true }, { id: 'lint', ok: false }],
    proseErrors: 2,
  });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'unmet');
  assert.equal(r.candidateHash, 'deadbeef');
  assert.deepEqual(r.failedChecks, ['lint', 'proseErrors']);
});

test('12. gate.check rejects when candidateHash or checks are missing', () => {
  const srv = createArcCoreServer();
  const r = srv.gate.check({ candidateHash: 'sha256:', checks: [] });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'unmet');
  assert.deepEqual(r.failedChecks, ['candidateHash', 'checks']);
});

test('13. toolpack.load loads standard toolpacks (molecullage, bench, deploy)', () => {
  const srv = createArcCoreServer();
  for (const pack of ['molecullage', 'bench', 'deploy']) {
    const r = srv.toolpack.load({ pack });
    assert.equal(r.ok, true);
    assert.equal(r.pack, pack);
    assert.ok(Array.isArray(r.tools) && r.tools.length > 0);
  }
});

test('14. toolpack.load refuses inspect pack under R009 when scope is unauthorized', () => {
  const srv = createArcCoreServer();
  const root = path.resolve('/tmp/allowed');
  const r1 = srv.toolpack.load({ pack: 'inspect', target: path.join(root, 'app.asar') });
  const r2 = srv.toolpack.load({
    pack: 'inspect',
    target: path.join(root, 'app.asar'),
    scope: { authorized: false, allowedRoots: [root] },
  });
  assert.equal(r1.ok, false);
  assert.equal(r1.rule, 'R009');
  assert.equal(r1.error, 'Target is outside authorized scope');
  assert.equal(r2.ok, false);
  assert.equal(r2.rule, 'R009');
});

test('15. toolpack.load refuses inspect pack under R009 when target is outside allowedRoots', () => {
  const srv = createArcCoreServer();
  const root = path.resolve('/tmp/allowed');
  const outside = path.resolve('/tmp/other/secret.asar');
  const traversal = path.join(root, '..', 'other', 'secret.asar');
  const r1 = srv.toolpack.load({
    pack: 'inspect',
    target: outside,
    scope: { authorized: true, allowedRoots: [root] },
  });
  const r2 = srv.toolpack.load({
    pack: 'inspect',
    target: traversal,
    scope: { authorized: true, allowedRoots: [root] },
  });
  assert.equal(r1.ok, false);
  assert.equal(r1.rule, 'R009');
  assert.equal(r2.ok, false);
  assert.equal(r2.rule, 'R009');
});

test('16. toolpack.load allows inspect pack when scope is authorized and target is inside allowedRoots', () => {
  const srv = createArcCoreServer();
  const root = path.resolve('/tmp/allowed');
  const inside = path.join(root, 'sub', 'app.asar');
  const r = srv.toolpack.load({
    pack: 'inspect',
    target: inside,
    scope: { authorized: true, allowedRoots: [root] },
  });
  assert.equal(r.ok, true);
  assert.equal(r.pack, 'inspect');
  assert.equal(r.target, inside);
});

test('17. memory.retain enforces mandatory project, date and source tags', () => {
  const srv = createArcCoreServer();
  const bad1 = srv.memory.retain({ text: 'Note', tags: ['date:2026-11-08', 'source:antigravity'] });
  const bad2 = srv.memory.retain({ text: 'Note', tags: ['project:arc-harness', 'source:antigravity'] });
  const bad3 = srv.memory.retain({ text: 'Note', tags: ['project:arc-harness', 'date:2026-11-08'] });
  assert.equal(bad1.ok, false);
  assert.match(bad1.error, /project:<name>/);
  assert.equal(bad2.ok, false);
  assert.match(bad2.error, /date:YYYY-MM-DD/);
  assert.equal(bad3.ok, false);
  assert.match(bad3.error, /source:<agent>/);
});

test('18. memory.retain and memory.recall persist and read back notes accurately', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-core-mem-'));
  const storePath = path.join(tmpDir, 'memory.json');
  const srv1 = createArcCoreServer({ storePath });
  const ret = srv1.memory.retain({
    text: 'Arc Kit Wave 1 verified on disk.',
    context: 'D-20261108-07 T4',
    tags: ['project:arc-harness', 'date:2026-11-08', 'source:antigravity', 'topic:arc-kit'],
  });
  assert.equal(ret.ok, true);
  const srv2 = createArcCoreServer({ storePath });
  const rec = srv2.memory.recall({
    query: 'Wave 1 verified',
    tags: ['project:arc-harness', 'topic:arc-kit'],
    budget: 'mid',
  });
  assert.equal(rec.ok, true);
  assert.equal(rec.count, 1);
  assert.equal(rec.items[0].text, 'Arc Kit Wave 1 verified on disk.');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('19. apply registers all six MCP tools on a host context', () => {
  const registered = [];
  const srv = apply({ tools: { register: (t) => registered.push(t.name) } });
  assert.deepEqual(registered, [
    'shelf.search',
    'claim.record',
    'gate.check',
    'toolpack.load',
    'memory.retain',
    'memory.recall',
  ]);
  assert.equal(srv.callTool('shelf.search', { domain: '2d' })[0].id, 'molecullage-core');
});

import {
  createMemoryPolicyStore,
  createCammutClientProfile,
  planMemoryDeploy,
  runMemoryDeploy,
  rollbackMemoryDeploy,
  evaluateShelfRecallAt5,
  checkShelfFreshness,
  resolveToolpackSignal,
  SIGNAL_BENCH_PROMPTS,
  inspectArchivePatchPoints,
  proposeUpdateLoop,
  verifyUpdateChannel,
  createConsentGrant,
  detectFormulaicProse,
  createC2ConsoleState,
} from '../lib/index.js';

test('20. Slices M1/M2: 5-label note policy, R007 secret rejection, near-twin supersede, rule toggle, and fail-open Cammut breaker', () => {
  const store = createMemoryPolicyStore();
  const sec = store.retainNote({ text: 'Token ' + 'sk-' + '1234567890abcdef123456' });
  assert.equal(sec.ok, false);
  assert.equal(sec.rule, 'R007');

  const n1 = store.retainNote({
    id: 'n1',
    text: 'Molecullage Studio uses twelve lens roles across journal and cinematic.',
    labels: { type: 'fact', scope: 'project', status: 'active', evidence: 'verified', sensitivity: 'internal' },
  });
  const n2 = store.retainNote({
    id: 'n2',
    text: 'Molecullage Studio uses twelve lens roles across journal and cinematic lenses.',
    labels: { type: 'fact', scope: 'project', status: 'active', evidence: 'verified', sensitivity: 'internal' },
  });
  assert.equal(n1.ok, true);
  assert.equal(n2.ok, true);
  assert.equal(n2.supersededId, 'n1');
  const active = store.recallNotes({ query: 'twelve lens roles' });
  assert.equal(active.length, 1);
  assert.equal(active[0].id, 'n2');

  store.retainNote({
    id: 'r1',
    text: 'Always verify Crossref DOI before setting checked date.',
    labels: { type: 'rule', scope: 'global', status: 'active', evidence: 'verified', sensitivity: 'public' },
  });
  store.toggleMemoryRule('r1', false);
  assert.equal(store.recallNotes({ type: 'rule' }).length, 0);
  store.toggleMemoryRule('r1', true);
  assert.equal(store.recallNotes({ type: 'rule' }).length, 1);

  const cammut = createCammutClientProfile({ maxFailures: 2, cooldownMs: 5000 });
  assert.equal(cammut.canCall(1000), true);
  cammut.recordFailure(1000);
  const f2 = cammut.recordFailure(1001);
  assert.equal(f2.circuitOpen, true);
  assert.equal(f2.failOpen, true);
  assert.equal(cammut.canCall(2000), false);
  assert.equal(cammut.canCall(7000), true);
});

test('21. Slices V1/V2: VPS memory deploy enforces TOFU fingerprint, 127.0.0.1 bindings, R007 password modal, idempotence, and rollback', () => {
  const badPw = planMemoryDeploy({
    hostFingerprint: 'SHA256:abcdef0123456789abcdef0123456789abcdef01234',
    passwordInWebview: true,
  });
  assert.equal(badPw.ok, false);
  assert.equal(badPw.rule, 'R007');

  const plan = planMemoryDeploy({
    hostFingerprint: 'SHA256:abcdef0123456789abcdef0123456789abcdef01234',
  });
  assert.equal(plan.ok, true);
  assert.ok(Object.values(plan.bindings).every((b) => b.startsWith('127.0.0.1:')));

  const run1 = runMemoryDeploy({ ...plan, version: '1.1.0' }, { deployedVersion: '1.0.0', history: [] });
  assert.equal(run1.ok, true);
  assert.equal(run1.idempotent, false);
  const run2 = runMemoryDeploy({ ...plan, version: '1.1.0' }, run1.state);
  assert.equal(run2.idempotent, true);
  const rolled = rollbackMemoryDeploy(run2.state);
  assert.equal(rolled.restoredVersion, '1.0.0');
});

test('22. Slices S1/S2: Shelf Recall@5 benchmark passes on 20 labelled questions and freshness watcher does not mutate pins', () => {
  const bench = evaluateShelfRecallAt5();
  assert.equal(bench.total, 20);
  assert.equal(bench.passed, true);
  assert.ok(bench.recallAt5 >= 0.9);

  const pins = { 'molecullage-studio': '1.2.0', 'language-docs': '2026.10' };
  const fresh = checkShelfFreshness(pins, { 'molecullage-studio': '1.2.0', 'language-docs': '2026.11' });
  assert.equal(fresh.mutatedPins, false);
  assert.equal(pins['language-docs'], '2026.10');
  assert.equal(fresh.updates.length, 1);
  assert.equal(fresh.updates[0].packId, 'language-docs');
});

test('23. Slices W1/W2: Workshop signal router matches all 10 signal prompts and archive inspector enforces R009', () => {
  for (const item of SIGNAL_BENCH_PROMPTS) {
    const res = resolveToolpackSignal(item.prompt);
    assert.ok(res, item.prompt);
    assert.equal(res.pack, item.expectedPack, item.prompt);
  }

  const root = path.resolve('/tmp/allowed-archive');
  const inside = path.join(root, 'app.asar');
  const denied = inspectArchivePatchPoints({
    target: inside,
    scope: { authorized: false, allowedRoots: [root] },
    archiveEntries: ['out/vs/workbench/workbench.desktop.main.js', 'product.json'],
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.rule, 'R009');

  const allowed = inspectArchivePatchPoints({
    target: inside,
    scope: { authorized: true, allowedRoots: [root] },
    archiveEntries: ['out/vs/workbench/workbench.desktop.main.js', 'product.json'],
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.patchPoints.length, 2);
});

test('24. Slices U1/U2 and Phase 1b/4: proposal-only update loops, signed update channel, 30-day consent grant, C2 console, and prose detector', () => {
  const prop = proposeUpdateLoop({ loop: 'policy-review', summary: 'Tighten citation check' });
  assert.equal(prop.ok, true);
  assert.equal(prop.autoApplied, false);
  assert.equal(prop.requiresOperatorApproval, true);

  assert.equal(verifyUpdateChannel({ channel: 'stable', signatureValid: false }).ok, false);
  const upd = verifyUpdateChannel({ channel: 'stable', signatureValid: true });
  assert.equal(upd.ok, true);
  assert.ok(upd.preservedUserState.includes('config.json'));

  const grant = createConsentGrant({ appId: 'github-connector', scopes: ['repo:read'], grantedAtMs: 1000, ttlDays: 30 });
  assert.equal(grant.isValid(2000), true);
  assert.equal(grant.isValid(1000 + 31 * 86400 * 1000), false);
  grant.revoke();
  assert.equal(grant.isValid(2000), false);

  const c2 = createC2ConsoleState();
  assert.deepEqual(c2.workspaces, ['Research', 'Memory', 'Molecullage', 'Prose']);
  assert.deepEqual(c2.seats, ['Planner', 'Reviewer', 'Falsifier', 'Vision', 'Prose']);

  const badProse = detectFormulaicProse('This is not a toy, but a revolution that we delve into.');
  assert.equal(badProse.ok, false);
  assert.equal(badProse.findings.length, 2);
  assert.equal(detectFormulaicProse('The camera starts outside the tube.').ok, true);
});

