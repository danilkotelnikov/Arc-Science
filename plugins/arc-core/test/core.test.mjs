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

test('19. apply registers all seven MCP tools on a host context', () => {
  const registered = [];
  const srv = apply({ tools: { register: (t) => registered.push(t.name) } });
  assert.deepEqual(registered, [
    'shelf.search',
    'claim.record',
    'gate.check',
    'toolpack.load',
    'memory.retain',
    'memory.recall',
    'prose.check',
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

test('25. apply registers ToolRuntime-compatible provider-safe schemas and undecorated JSON outputs on host runtime', () => {
  const defs = [];
  apply({
    tools: {
      register: (def) => defs.push(def),
      schemas: () => defs,
    },
  });
  assert.deepEqual(defs.map((d) => d.name), [
    'shelf_search',
    'claim_record',
    'gate_check',
    'toolpack_load',
    'memory_retain',
    'memory_recall',
    'prose_check',
  ]);
  const checkConcreteTypes = (node) => {
    if (!node || typeof node !== 'object') return;
    assert.equal('oneOf' in node, false);
    assert.equal('anyOf' in node, false);
    if ('description' in node || 'properties' in node || 'items' in node) assert.equal(typeof node.type, 'string');
    if (node.properties) Object.values(node.properties).forEach(checkConcreteTypes);
    if (node.items) checkConcreteTypes(node.items);
  };
  for (const def of defs) {
    assert.match(def.name, /^[a-zA-Z0-9_-]{1,64}$/);
    assert.equal(typeof def.description, 'string');
    assert.equal(def.parameters?.type, 'object');
    assert.equal(typeof def.output?.schema, 'object');
    assert.equal(typeof def.output?.render, 'function');
    checkConcreteTypes(def.parameters);
    checkConcreteTypes(def.output.schema);
  }
  const shelfDef = defs[0];
  const shelfRes = shelfDef.execute({ domain: '2d' });
  assert.equal(shelfRes.ok, true);
  assert.ok(shelfRes.count >= 1);
  assert.equal(Reflect.ownKeys(shelfRes.items).length, shelfRes.items.length + 1);
  const rendered = shelfDef.output.render({ domain: '2d' }, shelfRes);
  assert.equal(rendered[0].type, 'text');
  assert.equal(JSON.parse(rendered[0].text).count, shelfRes.count);
  const claimDef = defs[1];
  const claimRes = claimDef.execute({ text: 'Verified test claim', doi: '10.1000/test-claim' });
  assert.equal(claimRes.ok, true);
  assert.equal(claimRes.claim.doi, '10.1000/test-claim');
  const packDef = defs[3];
  assert.equal('scope' in packDef.parameters.properties, false);
  const forged = packDef.execute({ pack: 'inspect', target: '/etc/passwd', scope: { authorized: true, allowedRoots: ['/'] } });
  assert.equal(forged.ok, false);
  assert.equal(forged.rule, 'R009');
});

test('26. console live disk and gateway recall store redacts secrets and deduplicates refused lexicon', async () => {
  const tmpArc = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-live-test-'));
  const tmpMol = fs.mkdtempSync(path.join(os.tmpdir(), 'mol-live-test-'));
  try {
    fs.mkdirSync(path.join(tmpArc, 'hoh'), { recursive: true });
    fs.writeFileSync(path.join(tmpArc, 'hoh', 'ledger.jsonl'), JSON.stringify({ seq: 1, type: 'gate', caller: 'test', goal: 'Bearer sk-secret123456' }) + '\n', 'utf8');
    fs.writeFileSync(path.join(tmpArc, 'gateway-config.json'), JSON.stringify({ cammutRecall: true, anthropicPromptCaching: true, defaultReasoningEffort: 'none' }), 'utf8');
    fs.mkdirSync(path.join(tmpMol, 'studio', 'library', 'atlas', 'domains'), { recursive: true });
    fs.writeFileSync(path.join(tmpMol, 'studio', 'library', 'sources.json'), JSON.stringify({
      sources: [{ id: 'chx', name: 'ChimeraX', kind: 'app', section: 'structure', licenceClass: 'academic', use: 'render pdb' }],
    }), 'utf8');
    const lexPath = path.join(tmpArc, 'refused.en.txt');
    fs.writeFileSync(lexPath, 'leverage\nholistic\n', 'utf8');

    const refusedCheck = detectFormulaicProse('We leverage a holistic plan.', { lexiconPath: lexPath });
    assert.equal(refusedCheck.ok, false);
    assert.equal(refusedCheck.findings.length, 2);

    const mockFetch = async (url) => {
      if (String(url).endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok', version: '1.0.0', routes: ['/anthropic', '/vertex/v1'], cammut: true }), { status: 200 });
      }
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        result: { content: [{ type: 'text', text: JSON.stringify({ results: [{ id: 'm1', text: 'Verified note token sk-1234567890abcdef', context: 'cammut' }] }) }] },
      }), { status: 200 });
    };

    const { createResearchSessionStore, serveConsoleRoute } = await import('../lib/console.js');
    const liveStore = createResearchSessionStore({ arcHome: tmpArc, molecullageRoot: tmpMol, gatewayHost: '127.0.0.1:7424', fetch: mockFetch });
    const snap = await serveConsoleRoute('api/arc-core/console/state', {}, liveStore);
    assert.equal(snap.ok, true);
    assert.equal(snap.liveLedger.total, 1);
    assert.equal(snap.liveLedger.recent[0].goal.includes('sk-secret'), false);
    assert.equal(snap.memory.reachable, true);
    const mem = await serveConsoleRoute('api/arc-core/console/action', { kind: 'memory-search', query: 'Cammuteur' }, liveStore);
    assert.equal(mem.ok, true);
    assert.equal(mem.items[0].text.includes('sk-1234567890abcdef'), false);
    assert.equal(mem.items[0].text.includes('[redacted]'), true);
    const mol = await serveConsoleRoute('api/arc-core/console/action', { kind: 'molecullage-search', query: 'chimera' }, liveStore);
    assert.equal(mol.items.length, 1);
  } finally {
    fs.rmSync(tmpArc, { recursive: true, force: true });
    fs.rmSync(tmpMol, { recursive: true, force: true });
  }
});



// ---- prose gate (2026-11-18): text that speaks for the author never announces what the author has not done
import { check as proseGate, checkJson as proseGateJson, repair as proseRepair, verifyRewrite, SPEC as PROSE_SPEC, ALLOWED_HINT } from '../lib/prose-gate.js';
import { loadCases, scoreCases, HELDOUT } from '../../../tools/prose-gate.mjs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HELDOUT_PIN = '6b88563e8369ab8b';   // sha256 of the held-out lines (split, zone, label, text) as committed in 0d127fe
const BLIND3_PIN = 'cb1a950657559a2f';    // blind set 3 and the Russian blind set as committed in 1ee7ef7, before any rule saw them
const RU_BLIND_PIN = 'a62e11bed3f461ec';
const F102_BLIND_PIN = '241cf1181d6a9e8e';  // the probe set by GPT-OSS 120B for null results and other groups, written before the round-3 fix
// the second blind sets, by Gemini 4 Argon, as written on 18.XI.2026 before the two-band design (S049) was built
const GEMINI_PINS = ['43812fc23573f149', 'f6a9a2e49b814a07', '529969ba1e5c4c62'];

const MODEL_LIMIT = 'No model has been trained, no weights exist and no sample has been drawn. The manuscript reports no result.';

test('27. prose gate: every labelled case holds, in the fit, dev, dev2 and control splits', () => {
  const by = scoreCases(loadCases());
  assert.deepEqual(Object.keys(by).sort(), ['control', 'dev', 'dev2', 'dev3', 'fit']);
  for (const [split, s] of Object.entries(by)) assert.deepEqual(s.wrong, [], `${split}: ${s.wrong.join(' | ')}`);
  // Two bands (S049): an undercut counts when it blocks (tp) or is marked for a reader (mu); s.wrong already fails a fitted
  // undercut that is left clean and a clean case that blocks. The old bound "the review mark stays rare" is gone on purpose:
  // the mark band now holds every exception match, and the self-test prints its size.
  const seen = (s) => s.tp + s.mu;
  assert.ok(seen(by.fit) >= 5 && seen(by.dev) >= 20 && by.dev.tn >= 60 && seen(by.dev2) >= 28 && by.dev2.tn >= 60 && seen(by.dev3) >= 30 && by.dev3.tn >= 17, 'the case file lost cases');
});

test('28. prose gate: the original line is refused with its place, its sentence and an allowed sentence', () => {
  const line = 'Four research programmes. Each page states the problem, the method, the evidence and what has not been done.';
  const r = proseGate(line);
  assert.equal(r.ok, false);
  assert.equal(r.points, 3);
  assert.equal(r.findings.length, 1);
  assert.deepEqual([r.findings[0].rule, r.findings[0].span, r.findings[0].line], ['SELF_UNDERCUT', 'not been done', 1]);
  assert.equal(r.findings[0].sentence, 'Each page states the problem, the method, the evidence and what has not been done.', 'the refusal carries the sentence it saw');
  assert.equal(r.findings[0].allowed, 'Each page states the problem, the method and the evidence.');
  assert.equal(proseGate(r.findings[0].allowed).ok, true, 'the allowed sentence must pass the gate itself');
});

test('29. prose gate, other direction: a limit inside a limits zone passes, and a rewrite that claims the denied work fails', () => {
  assert.equal(proseGate(MODEL_LIMIT, { zone: 'limits' }).ok, true);
  assert.equal(proseGate(MODEL_LIMIT, { zone: 'public' }).ok, false);
  const md = '# Nimbus\nThe base model is specified.\n## Limits\nNo model has been trained.\n## Method\nNothing has been run.';
  assert.deepEqual(proseGate(md).findings.map((f) => f.line), [6], 'only the line outside the limits section is refused');
  const report = proseGate('Nothing has been run.', { zone: 'report' });
  assert.deepEqual([report.ok, report.findings[0].severity], [true, 'warn']);
  const over = proseGate('Nimbus is a trained generative model for antibody design.', { facts: MODEL_LIMIT });
  assert.deepEqual(over.findings.map((f) => [f.rule, f.span]), [['OVERCLAIM', 'trained']]);
  assert.equal(proseGate('The base model is specified and its training code is written.', { facts: MODEL_LIMIT }).ok, true);
});

test('30. prose gate: a repair is accepted only when it is clean, adds no number or name and claims nothing denied', () => {
  const status = 'Base model specified and its code written. Not trained.';
  const fixed = proseRepair(status);
  assert.deepEqual([fixed.text, fixed.changed, fixed.unresolved], ['Base model specified and its code written.', 1, 0]);
  assert.equal(verifyRewrite(status, fixed.text).ok, true);
  assert.deepEqual(verifyRewrite(status, 'Base model specified, code written and the model trained on public data.').reasons, ['OVERCLAIM: trained']);
  assert.deepEqual(verifyRewrite('Software release 1.0.0. No simulation outcome yet.', 'Software release 2.0.0.').reasons, ['new number: 2.0.0']);
  assert.deepEqual(verifyRewrite(status, 'Base model specified by Proteina and its code written.').reasons, ['new name: Proteina']);
  const hard = proseRepair('The code passes unit tests on a CPU, but the model has never been trained, so its cost is only derived.');
  assert.deepEqual([hard.changed, hard.unresolved], [0, 1], 'a sentence that needs a writer is left alone and counted');
  const plan = proseRepair('Review and plan only. No experiment or calculation has been run.');
  assert.deepEqual([plan.text, plan.unresolved], ['Review and plan only.', 1], '"plan only" goes to a writer (F095)');
  const all = proseRepair('Not trained. Nothing has been run.');
  assert.equal(all.text, 'Not trained. Nothing has been run.', 'a repair never empties a text');
  assert.ok(all.unresolved >= 1);
});

// gate.check measures every text it is sent. It does not read the candidate's files, so a caller that sends no text
// gets no prose check (F101); binding the texts to the candidate is a proposal.
test('31. gate.check measures the texts it is sent: a caller cannot report zero prose errors for a text that fails', () => {
  const srv = createArcCoreServer();
  const base = { candidateHash: 'a'.repeat(64), checks: [{ name: 'unit', passed: true }] };
  const dirty = srv.gate.check({ ...base, proseErrors: 0, texts: [{ id: 'status', text: 'Model built with random weights. Not trained.' }] });
  assert.deepEqual([dirty.ok, dirty.verdict, dirty.failedChecks], [false, 'unmet', ['prose:status']]);
  assert.equal(dirty.prose.points, 3);
  assert.equal(dirty.prose.findings[0].allowed, 'Remove this sentence. The sentence before it already states what exists.');
  // progress: a clean text with passing checks reaches acceptance, and so does a limit in its own zone
  const clean = srv.gate.check({ ...base, texts: [{ id: 'status', text: 'Model built with random weights.' }, { id: 'limits', text: '## Limits\nThe model has not been trained.' }] });
  assert.deepEqual([clean.ok, clean.verdict, clean.prose.points], [true, 'accepted', 0]);
  assert.equal(srv.gate.check({ ...base, texts: [{ id: 'empty', text: '' }] }).ok, false, 'a missing text blocks; it is never read as clean');
  assert.equal('prose' in srv.gate.check(base), false, 'old callers keep the old result shape');
});

test('32. prose.check returns a repair and verifies a rewrite; site facts are checked by key', () => {
  const srv = createArcCoreServer();
  const r = srv.callTool('prose.check', { text: 'Software release 1.0.0. No simulation outcome yet.', rewrite: 'Software release 1.0.0.' });
  assert.deepEqual([r.ok, r.repair.text, r.repair.unresolved, r.rewrite.ok], [false, 'Software release 1.0.0.', 0, true]);
  assert.deepEqual(r.repair.removed, [{ line: 1, sentence: 'No simulation outcome yet.' }], 'prose.check names every removed sentence');
  assert.equal(srv.callTool('prose.check', { text: '' }).ok, false);
  const site = proseGateJson({ home: { programmes_line: 'Each page states the problem and what has not been done.' }, projects: { a: { status: 'Design written.', limits: ['Nothing has been run.'] } } });
  assert.deepEqual(site.findings.map((f) => f.path), ['home.programmes_line']);
  assert.match(PROSE_SPEC, /\nwork_part\s+done built trained/);
});

test('33. prose gate on the held-out file: the first-run marks hold as a floor, and the file stays unfitted', () => {
  const h = scoreCases(loadCases(HELDOUT)).heldout;
  assert.equal(h.n, 78);
  // The held-out lines are pinned whole (split, zone, label and text): an edit makes a new split, never a quiet refit.
  const lines = loadCases(HELDOUT).map((c) => `${c.split}|${c.zone}|${c.expect}|${c.text}`).join('\n');
  assert.equal(createHash('sha256').update(lines).digest('hex').slice(0, 16), HELDOUT_PIN);
  assert.ok(h.tp + h.mu >= 21, `blocked ${h.tp} and marked ${h.mu} of 39; the first run caught 21`);   // S049: a marked undercut stays visible
  assert.ok(h.fp <= 2, `${h.fp} false alarms; the first run had 2`);
});

test('34. prose gate, F087: a word that opens a sentence or a label is no new name; a new name inside a sentence still is', () => {
  const before = 'Software release 1.0.0. No simulation outcome yet.';
  const labelled = 'Software release 1.0.0.\nLimits: the release is software.\nNext, these tools run here. Because of this, those runs are short.\n- Qualification follows.';
  assert.deepEqual(verifyRewrite(before, labelled).reasons.filter((r) => r.startsWith('new name')), [], 'Limits, Next, Because and Qualification open a sentence, a label or a list item');
  assert.deepEqual(verifyRewrite(before, 'Software release 1.0.0 runs on Windows.').reasons, ['new name: Windows'], 'a new name inside a sentence is refused');
  assert.deepEqual(verifyRewrite(before, 'Software release 1.0.0. GROMACS runs the steps.').reasons, ['new name: GROMACS'], 'an acronym that opens a sentence is a name');
  assert.deepEqual(verifyRewrite(before, 'Software release 1.0.0. Rosetta scores it, and Rosetta runs here.').reasons, ['new name: Rosetta'], 'a word that opens a sentence and stands capitalized inside one is a name');
});

test('35. prose gate, F088: a denial from the facts matches its object and its frame; in a rewrite it still blocks', () => {
  const cammut = 'The 934,161 distractor cards are synthetic. A real store of one million cards has not been measured.';
  for (const text of ['Measured on one million cards, most synthetic.', 'Hybrid search measured on one million test cards, Hit@5 0.743.']) {
    assert.deepEqual(proseGate(text, { facts: cammut }).findings, [], `the object is the store, not the cards: ${text}`);
  }
  assert.deepEqual(proseGate('A real store of one million cards was measured.', { facts: cammut }).findings.map((f) => [f.rule, f.span, f.severity]), [['OVERCLAIM', 'measured', 'review']], 'a claim on the denied object is marked for a reader');
  const rnav = 'The model has random weights and the domain training has not run.';
  assert.deepEqual(proseGate('Random weights; domain training still to run.', { facts: rnav }).findings.filter((f) => f.rule === 'OVERCLAIM'), [], 'an infinitive is no claim');
  assert.deepEqual(proseGate('Gates are fixed before any model is trained or evaluated.', { facts: MODEL_LIMIT }).findings.filter((f) => f.rule === 'OVERCLAIM'), [], 'a condition is no claim');
  assert.equal(proseGate('Nimbus is a trained generative model.', { facts: MODEL_LIMIT }).ok, true, 'from the facts alone the mark advises');
  const bench = 'No public benchmark has run.';
  assert.deepEqual(proseGate('The roadmap schedules a public benchmark run.', { facts: bench }).findings, [], 'a benchmark run is a noun');
  assert.deepEqual(proseGate('A public benchmark has run.', { facts: bench }).findings.map((f) => f.rule), ['OVERCLAIM']);
  const planned = 'The research session and the local rater are planned, not built.';
  assert.deepEqual(proseGate('Its gates and ledger are built.', { facts: planned }).findings, [], 'the subject of a denial stands in the clause before it');
  assert.deepEqual(proseGate('The local rater is built.', { facts: planned }).findings.map((f) => f.rule), ['OVERCLAIM']);
  assert.deepEqual(verifyRewrite('Model built with random weights. Not trained.', 'Model built with random weights and trained.').reasons, ['OVERCLAIM: trained'], 'in a rewrite the original denies it, so it blocks');
});

test('36. prose gate: a plain "Limits" label line over a list opens a limits zone; an inline label does not', () => {
  const page = 'Snöggo runs free-energy cycles.\n\nLimits:\n- Native qualification has not been run.\n- No simulation outcome yet.\n\nThe code is MIT.';
  assert.equal(proseGate(page).ok, true, 'the list under the label is a limits zone');
  assert.equal(proseGate('Snöggo runs free-energy cycles.\n**Limitations**\n- Nothing has been run.').ok, true, 'a bold label counts');
  assert.deepEqual(proseGate(`${page}\nNothing has been run.`).findings.map((f) => f.line), [8], 'the zone ends at the blank line');
  assert.equal(proseGate('Limits of 1.0.0:\n- Nothing has been run.').ok, true, 'a version number in the label');
  assert.equal(proseGate('Limits: the model is not trained.').ok, false, 'an inline label is no limits section');
  assert.equal(proseGate('Limits:\nThe model is not trained, and the page says so.').ok, false, 'a label over a plain sentence is no list');
  // F093: a short line with content is checked, list or not
  assert.equal(proseGate('Limits: not trained').ok, false, 'a short inline label is checked');
  assert.equal(proseGate('Limits: not trained\n- The code is written.').ok, false, 'a short inline label over a list is checked');
  assert.equal(proseGate('Limits:\n\n- Not trained.').ok, true, 'a blank line may stand between the label and its list');
});

test('37. prose gate, F091: cost stays near linear on long untrusted text', () => {
  const t0 = process.hrtime.bigint();
  proseGate('untrained '.repeat(4000));
  proseGate('No model has been trained. '.repeat(3000), { facts: 'No model has been trained.' });
  verifyRewrite('Model built. Not trained.', 'Word '.repeat(20000));
  proseGate('Fine.', { facts: `a${' '.repeat(50000)}b` });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms for about 200 KB`);
});

test('38. prose gate, F092: gate.check takes no zone from its caller; a limits zone comes from the text itself', () => {
  const srv = createArcCoreServer();
  const base = { candidateHash: 'a'.repeat(64), checks: [{ name: 'unit', passed: true }] };
  for (const zone of ['limits', 'report']) {
    const r = srv.gate.check({ ...base, texts: [{ id: 'status', zone, text: 'The model is not trained yet.' }] });
    assert.deepEqual([r.ok, r.verdict], [false, 'unmet'], `zone ${zone} from the caller lowers nothing`);
  }
  assert.equal(srv.gate.check({ ...base, texts: [{ id: 'page', text: 'The model is built.\n\nLimits:\n- The model is not trained yet.' }] }).ok, true);
});

test('39. prose gate, F094: ordinary prose with a negation or a status word is no undercut', () => {
  for (const s of ['Nothing is executed on a remote server.', 'No code is executed outside your machine.', 'No errors have been reported by users in two years of operation.',
    'The service has never crashed in production.', 'No patient has been harmed in the trial.', 'Mice lacking TNF developed severe colitis.',
    'Patients with early stage breast cancer were enrolled.', 'The untrained eye misses these artifacts.']) {
    assert.deepEqual(proseGate(s).findings.filter((f) => f.rule === 'SELF_UNDERCUT'), [], s);
  }
  for (const s of ['Nothing has been run.', 'No model has been trained.', 'No experiment was run.', 'The model is untrained.', 'Untrained.', 'An untrained model is released.',
    'We lack a benchmark.', 'The project is at an early stage.', 'The pipeline has never been tested.', 'The module is still lacking a test suite.']) {
    assert.equal(proseGate(s).ok, false, s);
  }
  // S049: a subject that is neither the author nor the project ("Linux and macOS", "real store") is marked for a reader
  for (const s of ['Tested on Windows 11 only, Linux and macOS untested.', 'Measured on one million cards; real store untested.']) {
    assert.deepEqual(proseGate(s).findings.map((f) => [f.rule, f.form]), [['UNSURE_ABSENCE', 'subject']], s);
  }
});

test('40. prose gate, F095: a rule repair deletes only a sentence that a rule reads with certainty', () => {
  for (const s of ['Arc runs locally. Nothing is executed on a remote server. Results stay on disk.', 'Mice lacking TNF died early. The effect was dose dependent.']) {
    assert.equal(proseRepair(s).text, s);
  }
  const caps = proseRepair('Results stay on disk. TNF not measured.');
  assert.deepEqual([caps.text, caps.unresolved], ['Results stay on disk. TNF not measured.', 0], 'S049: "TNF" is no subject of the author, so the sentence is a mark and stays for a reader');
  const name = proseRepair('Results stay on disk. Nimbus is not trained.');
  assert.deepEqual([name.text, name.unresolved], ['Results stay on disk. Nimbus is not trained.', 0], 'a project name alone is no core subject either');
  assert.equal(proseRepair('The module is built. We lack a benchmark.').text, 'The module is built. We lack a benchmark.', 'a lack is left to a writer');
});

test('41. prose gate, F096 and F097: every denial form feeds verifyRewrite, and only a real condition frame excuses a work word', () => {
  for (const [orig, rewrite] of [['The model is yet to be trained.', 'The model is trained.'], ['Model built. Untrained.', 'Model built and trained.'],
    ['The model needs to be trained.', 'The model is trained.'], ['Model built with random weights. Not trained.', 'Model built with random weights. If anything, it is trained.']]) {
    assert.deepEqual(verifyRewrite(orig, rewrite).reasons, ['OVERCLAIM: trained'], `${orig} -> ${rewrite}`);
  }
  assert.deepEqual(proseGate('Once trained, the model is frozen.', { facts: MODEL_LIMIT }).findings.filter((f) => f.rule === 'OVERCLAIM'), [], 'a condition right before the work word');
  assert.deepEqual(verifyRewrite('The workflow runs.', 'The workflow runs Flow.').reasons, ['new name: Flow'], 'a name inside a longer word of the original is still new');
  const untested = 'Tested on Windows 11. Linux and macOS commands are untested.';
  assert.deepEqual(proseGate('Tested on Windows 11, Linux and macOS next.', { facts: untested }).findings.filter((f) => f.rule === 'OVERCLAIM'), [], 'the denied object stands in another clause');
  assert.deepEqual(proseGate('The macOS commands are tested.', { facts: untested }).findings.map((f) => f.rule), ['OVERCLAIM']);
});

test('42. prose gate, Russian: its own split holds, a Russian limits heading opens a limits zone, and a writer gets a Russian hint', async () => {
  const { RU_CASES } = await import('../../../tools/prose-gate.mjs');
  assert.deepEqual(scoreCases(loadCases(RU_CASES)).ru.wrong, []);
  assert.equal(proseGate('Модель описана.\n\n## Ограничения\n- Модель пока не обучена.').ok, true);
  assert.equal(proseGate('Модель описана.\n\nОграничения:\n- Модель пока не обучена.').ok, true, 'a label over a list');
  const r = proseGate('Модель описана, код написан. Не обучена.');
  assert.deepEqual([r.ok, r.findings[0].span], [false, 'Не обучена']);
  assert.match(r.findings[0].allowed, /^Скажите, что есть/);
  assert.equal(proseRepair('Модель описана. Не обучена.').unresolved, 1, 'a Russian sentence goes to a writer');
});

test('43. memory.retain runs the prose gate: a note tagged voice:public is refused with place, sentence and allowed sentence; any other note is kept with a tag', () => {
  // The engine's own memory tool holds the contract that research/prose-gate-review.md proposes for the memory server (F101).
  const srv = createArcCoreServer();
  const tags = ['project:Nimbus', 'date:2026-11-18', 'source:test'];
  const page = srv.callTool('memory.retain', { text: 'Each page states the problem, the method, the evidence and what has not been done.', tags: [...tags, 'voice:public'] });
  assert.equal(page.ok, false);
  assert.deepEqual([page.prose.findings[0].span, page.prose.findings[0].allowed], ['not been done', 'Each page states the problem, the method and the evidence.']);
  const status = srv.callTool('memory.retain', { text: 'State of Nimbus: no model has been trained.', tags });
  assert.equal(status.ok, true, 'a status note to the owner may say what is not done');
  assert.ok(status.entry.tags.includes('prose:undercut'));
  assert.ok(!srv.callTool('memory.retain', { text: 'The base model is specified.', tags }).entry.tags.includes('prose:undercut'));
});

test('44. prose gate, F100: a Cyrillic letter or a Russian aside never hides an English undercut; a word of two scripts is marked', () => {
  const srv = createArcCoreServer();
  const base = { candidateHash: 'a'.repeat(64), checks: [{ name: 'unit', passed: true }] };
  for (const text of ['The model is not trаined.', 'The model is not trained аnd no benchmark was run.', 'The model is not trained (см. ниже).', 'The model has not been trained on the Пушкин corpus yet.']) {
    assert.equal(proseGate(text).findings.some((f) => f.rule === 'SELF_UNDERCUT'), true, text);
    assert.equal(srv.gate.check({ ...base, texts: [{ id: 't', text }] }).verdict, 'unmet', text);
  }
  assert.deepEqual(proseGate('The model is not trаined.').findings.map((f) => f.rule).sort(), ['MIXED_SCRIPT', 'SELF_UNDERCUT']);
  assert.equal(proseGate('Модель пока не обучена.').ok, false, 'Russian still takes its own rules');
  assert.equal(proseGate('Модель обучена на базе AlphaFold DB.').ok, true, 'a Latin name in a Russian sentence is no mixed word');
});

test('45. prose gate, F101: a promise in the present ("is never published") is a property; the status forms still count', () => {
  for (const s of ['Your data stays local and is never published.', 'The service reads your files and is never run as root.', 'The API has not changed since version 1.0.']) {
    assert.deepEqual(proseGate(s).findings.filter((f) => f.rule === 'SELF_UNDERCUT'), [], s);
    assert.equal(proseRepair(s).text, s);
  }
  for (const s of ['The model has never been trained.', 'The model is not trained.', 'The benchmark was never run.']) assert.equal(proseGate(s).ok, false, s);
  assert.equal(proseGate('Not trained.').findings[0].allowed, ALLOWED_HINT, 'a lone fragment has no sentence before it');
  assert.equal(proseRepair('## Nimbus\nNot trained.').text, '## Nimbus\nNot trained.', 'a repair never leaves a heading alone');
});

test('46. prose gate, F101: Russian null results and absent harms are no undercut', () => {
  for (const s of ['Результаты не подтвердили гипотезу.', 'По результатам проверки утечек нет.', 'Ошибок в результатах нет.', 'Нет сомнений, что результаты воспроизводимы.']) {
    assert.equal(proseGate(s).ok, true, s);
  }
  assert.equal(proseGate('Результатов пока нет.').ok, false);
});

test('47. prose gate, F101: only a heading that names the limits opens a limits zone', () => {
  for (const text of ['# Arc\n\n## API rate limits\n\nThe model is not trained.', '# Pushing the limits of antibody design\nNo model has been trained.']) {
    assert.equal(proseGate(text).ok, false, text);
  }
  // S049: "the solver" is in no core list, so outside a limits zone the sentence is a mark; inside one it would be silent
  assert.deepEqual(proseGate('# Boundary element solver\nThe solver has not been tested yet.').findings.map((f) => f.rule), ['UNSURE_ABSENCE']);
  for (const text of ['## Limits\nNo model has been trained.', '## Limits of release 1.0\n- Not trained.', '## Ограничения\n- Модель не обучена.']) assert.equal(proseGate(text).ok, true, text);
});

test('48. prose gate, F101: verifyRewrite reads denials in a limits zone, and long facts stay cheap', () => {
  for (const orig of ['Model built with random weights.\n\n## Limits\nThe model is not trained.', 'Model built with random weights.\n\nLimits:\n- Not trained.']) {
    assert.deepEqual(verifyRewrite(orig, 'Model built with random weights and trained.').reasons, ['OVERCLAIM: trained'], orig);
  }
  const facts = Array.from({ length: 2000 }, (_, k) => `Model${k} not trained.`).join(' ');
  const t0 = process.hrtime.bigint();
  proseGate('trained '.repeat(2000), { facts });
  proseGate('Fine.', { facts: `The engine${', not trained'.repeat(4000)}.` });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
});

test('49. prose gate, F101: checkJson reads a short fragment and a string with markup', () => {
  assert.equal(proseGateJson({ status: 'Not trained' }).ok, false);
  assert.equal(proseGateJson({ note: 'Model <b>not trained</b> yet.' }).ok, false);
});

test('50. blind files are pinned: an edit to blind3 or ru-blind makes a new split', async () => {
  const { BLIND3, RU_BLIND, F102_BLIND, BLIND4, F102_BLIND2, RU_BLIND2 } = await import('../../../tools/prose-gate.mjs');
  const pin = (file) => createHash('sha256').update(fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).join('\n')).digest('hex').slice(0, 16);
  assert.deepEqual([pin(BLIND3), pin(RU_BLIND), pin(F102_BLIND)], [BLIND3_PIN, RU_BLIND_PIN, F102_BLIND_PIN]);
  assert.deepEqual([pin(BLIND4), pin(F102_BLIND2), pin(RU_BLIND2)], GEMINI_PINS);
});

test('51. prose gate, F102: a null result passes, and no undercut repair removes a sentence without notice', async () => {
  const { rewriteFormulaicProse } = await import('../lib/console.js');
  const safety = 'The drug lowered blood pressure. No adverse events were reported.';
  assert.equal(proseGate(safety).ok, true);
  assert.deepEqual([proseRepair(safety).text, proseRepair(safety).removed], [safety, []]);
  // repair reports every sentence it removes, with its line
  const two = proseRepair('The model is built. Not trained.');
  assert.deepEqual([two.text, two.removed], ['The model is built.', [{ line: 1, sentence: 'Not trained.' }]]);
  const many = proseRepair('The model is built. Not trained.\nThe code is written. Nothing has been run.');
  assert.deepEqual(many.removed.map((r) => [r.line, r.sentence]), [[1, 'Not trained.'], [2, 'Nothing has been run.']]);
  assert.deepEqual(proseRepair('Not trained.').removed, [], 'a text is never emptied, so nothing is removed');
  // the console rewrite keeps a sentence that a rule would remove, and the detector marks it for the writer
  for (const text of ['Not trained.', 'The model is built. Not trained.', 'The model is built. Not trained. Nothing has been run.', safety]) {
    assert.equal(rewriteFormulaicProse(text), text, text);
  }
  assert.ok(detectFormulaicProse(rewriteFormulaicProse('The model is built. Not trained.')).findings.some((f) => f.kind === 'self-undercut'));
  // a shortened sentence is named too, and the console rewrite keeps it whole for its detector
  const tail = 'The pipeline covers data loading, preprocessing and what has not been tested.';
  assert.deepEqual(proseRepair(tail).cut, [{ line: 1, sentence: tail, now: 'The pipeline covers data loading and preprocessing.' }]);
  assert.equal(rewriteFormulaicProse(tail), tail);
  assert.ok(detectFormulaicProse(tail).findings.some((f) => f.kind === 'self-undercut'));
  // the repair command names every removed and shortened sentence on stderr
  const file = path.join(os.tmpdir(), `prose-repair-${process.pid}.md`);
  fs.writeFileSync(file, `The model is built. Not trained.\n${tail}\n`);
  const run = spawnSync(process.execPath, [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tools/prose-gate.mjs'), 'repair', file], { encoding: 'utf8', windowsHide: true });
  fs.rmSync(file, { force: true });
  assert.equal(run.status, 0);
  assert.match(run.stderr, /removed line 1: Not trained\./);
  assert.match(run.stderr, /shortened line 2: The pipeline covers/);
});

test('52. prose gate, review wf_8eef9a40-d73: a null noun as a modifier, or another group beside a first person, hides no undercut', () => {
  const marked = (s) => proseGate(s).findings.some((f) => f.rule === 'UNSURE_ABSENCE');
  for (const s of ['No toxicity assay has been run.', 'No interaction model has been trained.', 'No changes have been tested.',
    'Unlike earlier studies, our model has not been trained.', 'Our groups have not measured the binding affinity.']) {
    assert.equal(proseGate(s).ok, false, s);
  }
  for (const s of ['Adverse events were not reported.', 'No adverse events have been reported yet.', 'Other groups have not yet reported a structure.']) {
    assert.deepEqual([proseGate(s).ok, marked(s)], [true, true], s);
  }
  // review wf_0a53c0f4-d5b found these leaks; with two bands (S049) each one is a mark for a reader, never silently clean
  for (const s of ['The validation studies were not run.', 'Studies have never been run.', 'The two papers have not been published.', 'Toxicity was not measured.',
    'Off-target effects were not measured.', 'The authors have not validated the model.']) {
    assert.deepEqual([proseGate(s).ok, marked(s)], [true, true], s);
  }
  for (const s of ['Adverse events have not been reported.', 'No in vivo effects were measured.', 'We note that other groups have not measured the off-rate.']) {
    assert.deepEqual([proseGate(s).ok, marked(s)], [true, true], s);
  }
});

test('53. prose gate, two bands (S049): only the clear core blocks; a null result, other work, a property or an unclear subject is a mark', async () => {
  const band = (s) => { const f = proseGate(s).findings; return f.some((x) => x.rule === 'SELF_UNDERCUT') ? 'block' : f.some((x) => x.rule === 'UNSURE_ABSENCE') ? 'mark' : 'clean'; };
  // the three sentences of the scope
  assert.equal(band('No adverse events were reported.'), 'mark');
  assert.equal(band('Calls are not recorded.'), 'mark');
  assert.notEqual(band('We, like other groups, have not measured the off-rate.'), 'clean');
  // the clear core: a bare status fragment, the author or the project as the subject
  for (const s of ['Not trained.', 'Has not been run.', 'Our predictor reaches 85% accuracy, not yet benchmarked.', 'We have not run the benchmark.', 'The model is not trained.',
    'Each page states the problem, the method, the evidence and what has not been done.', 'The project is at an early stage.', 'Модель пока не обучена.', 'Мы ещё не сравнили модель с AlphaFold.']) {
    assert.equal(band(s), 'block', s);
  }
  // every exception match is a mark, with its reason
  for (const [s, why] of [['The service has never crashed in production.', 'null-result'], ['Other groups have not yet reported a structure.', 'other-group'],
    ['Your data stays local and is never published.', 'property'], ['Nothing is executed on a remote server.', 'property'],
    ['A claim that is not tested stays on the lowest rung.', 'restriction'], ['Toxicity was not measured.', 'subject'], ['Ошибок в результатах нет.', 'null-result']]) {
    assert.deepEqual(proseGate(s).findings.map((f) => [f.rule, f.severity, f.form]), [['UNSURE_ABSENCE', 'review', why]], s);
  }
  // a block hit wins over a mark it overlaps ("No model is trained" is a present-tense property, "no ... so far" a status
  // over the same words), a mark beside a block leaves the block, and twelve marks do not use up the cap of the blocks
  assert.equal(band('No model is trained so far.'), 'block');
  assert.equal(band('No adverse events were reported, and the model is not trained.'), 'block');
  assert.equal(band(`${'No adverse events were reported, '.repeat(14)}and the model is not trained.`), 'block');
  // no repair, console rewrite or verified rewrite removes a marked sentence
  const safety = 'The drug lowered blood pressure. No adverse events were reported.';
  assert.deepEqual([proseRepair(safety).text, proseRepair(safety).changed], [safety, 0]);
  const both = proseRepair('The model is built. Not trained, and no adverse events were reported.');
  assert.deepEqual([both.text, both.unresolved], ['The model is built. Not trained, and no adverse events were reported.', 1], 'a sentence with a block and a mark goes whole to a writer');
  const { rewriteFormulaicProse } = await import('../lib/console.js');
  // review wf_4ff83c09-a12: the phrase rules ("not X, but Y", "rather than") cut marked sentences; now they skip them
  for (const s of [safety, 'Other groups have not reported it so far, but we did.', 'Calls are not recorded rather than stored.']) assert.equal(rewriteFormulaicProse(s), s, s);
  assert.equal(rewriteFormulaicProse('The tool is not a toy, but a method.'), 'The tool is a method.', 'a clean sentence still gets the phrase rules');
  // a rewrite keeps the clause of an exception mark; it may fix a block in the same sentence, and it may drop a subject mark
  assert.deepEqual(verifyRewrite(safety, 'The drug lowered blood pressure.').reasons, ['removed marked sentence: No adverse events were reported.']);
  assert.deepEqual(verifyRewrite(safety, `${safety} Its effect lasted.`).reasons, []);
  assert.deepEqual(verifyRewrite('The model is built. Not trained, and no adverse events were reported.', 'The model is built. No adverse events were reported.').reasons, []);
  const semi = 'The drug lowered blood pressure. No adverse events were reported; not trained yet.';
  assert.deepEqual(verifyRewrite(semi, proseRepair(semi).text).reasons, [], 'the repair turns ";" into "." beside a held clause');
  for (const [orig, rewrite] of [['The gate runs. A claim that is not tested stays on the lowest rung.', 'The gate runs.'],
    ['The gate runs. The model is not trained until the split is frozen.', 'The gate runs.'], ['The app runs offline. Calls are not recorded.', 'The app runs offline.']]) {
    assert.equal(verifyRewrite(orig, rewrite).ok, false, `a procedure, a restriction or a property is held: ${orig}`);
  }
  assert.deepEqual(proseGate('Calls are not recorded.').findings.map((f) => f.form), ['property'], 'a present passive outside the core states a property');
  for (const x of ["The app runs offline. Calls aren't recorded.", 'The app runs offline. Calls aren’t recorded.']) assert.deepEqual(verifyRewrite(x, x).reasons, [], `a held clause with a contraction, kept word for word: ${x}`);
  assert.deepEqual(verifyRewrite('The model is built. Toxicity was not measured.', 'The model is built.').reasons, [], 'a mark for an unclear subject may be an undercut, so a writer may drop it');
  // a mark never blocks gate.check, and a status note gets no undercut tag for a mark
  const srv = createArcCoreServer();
  assert.equal(srv.gate.check({ candidateHash: 'a'.repeat(64), checks: [{ name: 'unit', passed: true }], texts: [{ id: 't', text: safety }] }).ok, true);
  assert.ok(!srv.callTool('memory.retain', { text: safety, tags: ['project:Nimbus', 'date:2026-11-18', 'source:test'] }).entry.tags.includes('prose:undercut'));
});

test('54. prose gate, review of PR 36: one long clause stays linear in English and Russian', () => {
  // Every hit walked back to its clause start, so 36,000 words of marked hits took 7 s (English) and 36 s (Russian).
  // The bound is loose: a slow runner passes, a quadratic scan does not.
  const started = Date.now();
  for (const text of [`The model ${'we have not run it if needed '.repeat(6000)}today.`, `The ${'cat has not run '.repeat(6000)}today.`, `Кот ${'пока не запущен '.repeat(6000)}сегодня.`]) {
    const r = proseGate(text);
    assert.ok(r.findings.length > 0 && r.findings.every((f) => f.severity === 'review'), text.slice(0, 40));
  }
  assert.ok(Date.now() - started < 3000, `three long clauses took ${Date.now() - started} ms`);
});

test('55. prose gate, review of PR 35: denials past the cap of 300 are reported, never dropped without notice', () => {
  const facts = `${Array.from({ length: 300 }, (_, k) => `Model${k} not trained.`).join('\n')}\nNimbus has not been benchmarked.`;
  const r = proseGate('Nimbus is built.', { facts });
  assert.deepEqual(r.findings.map((f) => [f.rule, f.severity]), [['FACTS_TRUNCATED', 'review']]);
  assert.ok(verifyRewrite('Nimbus is built.', 'Nimbus was benchmarked.', { facts }).reasons.some((x) => x.startsWith('FACTS_TRUNCATED')));
  // at the cap itself nothing is reported
  assert.deepEqual(proseGate('Nimbus is built.', { facts: Array.from({ length: 300 }, (_, k) => `Model${k} not trained.`).join('\n') }).findings, []);
});

test('56. prose gate, review of PR 35: accents, invisible characters, combining marks and Greek look-alikes split no word', () => {
  const blocks = (s) => proseGate(s).findings.some((f) => f.rule === 'SELF_UNDERCUT');
  for (const s of ['The model is nôt trained.', 'The model is no​t trained.', 'The model is nôt trained.', 'The model is nοt trained.',
    'The model is not tráined.', 'Модель пока не обу​чена.']) assert.ok(blocks(s), s);
  // Greek letters in science names are no MIXED_SCRIPT error, and a mark after a Cyrillic letter stays
  assert.deepEqual(proseGate('TNFα and IFNγ rose by 2 μM in Aβ42 cells.').findings, []);
  assert.deepEqual(proseGate('Исследователй проект работает.').findings, []);
  // a kept accented name is no new name in a rewrite
  assert.ok(!verifyRewrite('Snöggo runs free-energy cycles. Not trained.', 'Snöggo runs free-energy cycles.').reasons.some((r) => r.startsWith('new name')));
});

test('57. prose gate, review of PR 35: a one-word JSON value is read, so a status like "Untrained" blocks', () => {
  const r = proseGateJson({ status: 'Untrained', id: 'nimbus-1', href: 'https://example.org/a', title: 'Nimbus' });
  assert.deepEqual(r.findings.map((f) => [f.path, f.rule, f.severity]), [['status', 'SELF_UNDERCUT', 'error']]);
  assert.equal(proseGateJson({ limits: { status: 'Untrained' } }).ok, true);   // a limits key still opens its zone
});

test('58. prose gate, review of PR 35: a heading is read, and a hit there is a mark that repair never cuts', () => {
  assert.deepEqual(proseGate('# Nothing has been run.\nThe tool runs.').findings.map((f) => [f.line, f.rule, f.form]), [[1, 'UNSURE_ABSENCE', 'heading']]);
  assert.equal(proseGate('## Not yet supported\n- Linux').ok, true);
  assert.equal(proseGate('## Method ##\nNot trained.').ok, false);              // the body under a heading still blocks
  assert.equal(proseGate('## Limits ##\nNot trained.').ok, true);               // a closing run of # keeps a limits title
  const fix = proseRepair('# Nothing has been run.\nModel built. Not trained.');
  assert.equal(fix.text.split('\n')[0], '# Nothing has been run.');          // the heading line stays whole
  assert.ok(fix.unresolved >= 1);
});
