import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FileLeaseTable,
  checkCrossFamilyVerdict,
  enforceSubagentCall,
} from '../lib/budget.js';

const ROLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../roles');

test('G2.4 eight crew role skill files exist with expected route headers', () => {
  const expectedRoles = ['lead', 'framer', 'scout', 'builder', 'lean-prover', 'checker', 'red-team', 'archivist'];
  for (const r of expectedRoles) {
    const text = fs.readFileSync(path.join(ROLES_DIR, `${r}.md`), 'utf8');
    assert.ok(text.includes(`role: ${r}`), `missing role header in ${r}.md`);
    assert.ok(text.includes('route: '), `missing route header in ${r}.md`);
  }
});

test('G2.5 exclusive file lease blocks concurrent writer and enforces integrator-only commits', () => {
  const table = new FileLeaseTable();
  const first = table.acquire('plugins/arc-hoh/lib/claims.js', 'builder', 'agent-a');
  assert.equal(first.ok, true);

  const conflict = table.acquire('plugins\\arc-hoh\\lib\\claims.js', 'builder', 'agent-b');
  assert.equal(conflict.ok, false);
  assert.equal(conflict.state, 'fail_lease_conflict');

  const badRelease = table.release('plugins/arc-hoh/lib/claims.js', 'agent-b');
  assert.equal(badRelease.state, 'fail_not_holder');

  assert.equal(table.release('plugins/arc-hoh/lib/claims.js', 'agent-a').ok, true);
  assert.equal(table.acquire('plugins/arc-hoh/lib/claims.js', 'builder', 'agent-b').ok, true);

  assert.equal(table.acquire('./plugins/arc-hoh/lib/claims.js', 'builder', 'agent-c').state, 'fail_lease_conflict');
  assert.equal(table.acquire('plugins/arc-hoh/../arc-hoh/lib/claims.js', 'builder', 'agent-c').state, 'fail_lease_conflict');
  assert.equal(table.acquire('../outside.js', 'builder', 'agent-c').state, 'fail_bad_lease_args');
  assert.equal(table.acquire('/abs/claims.js', 'builder', 'agent-c').state, 'fail_bad_lease_args');

  assert.equal(table.acquire('plugins/arc-hoh/lib/ws.js', 'builder', '  agent-ws  ').ok, true);
  assert.equal(table.acquire('plugins/arc-hoh/lib/ws.js', 'builder', 'agent-ws').ok, true);
  assert.equal(table.release('plugins/arc-hoh/lib/ws.js', ' agent-ws ').released, true);

  assert.equal(table.assertIntegratorCommit('integrator').state, 'pass');
  assert.equal(table.assertIntegratorCommit('builder').state, 'fail_non_integrator_commit');
});

test('G2.6 cross-family verdict check refuses self-review and same-family verification', () => {
  const pass = checkCrossFamilyVerdict({
    builderFamily: 'google',
    checkerFamily: 'anthropic',
    builderId: 'builder-1',
    checkerId: 'checker-1',
    verdict: 'pass',
  });
  assert.equal(pass.state, 'pass');

  const sameFamily = checkCrossFamilyVerdict({
    builderFamily: 'google',
    checkerFamily: 'Google',
    builderId: 'builder-1',
    checkerId: 'checker-2',
  });
  assert.equal(sameFamily.state, 'fail_same_family_verdict');

  const selfReview = checkCrossFamilyVerdict({
    builderFamily: 'google',
    checkerFamily: 'anthropic',
    builderId: 'agent-1',
    checkerId: 'agent-1',
  });
  assert.equal(selfReview.state, 'fail_self_review');
});

test('G2.7 subagent calls require explicit positive maxTokens and record token accounting rows', () => {
  const missingLimit = enforceSubagentCall({ role: 'scout', route: 'gemini-4-hydrogen', usage: { inputTokens: 100 } });
  assert.equal(missingLimit.state, 'fail_missing_max_tokens');

  const overOutput = enforceSubagentCall({ role: 'builder', route: 'gemini-4-argon', maxTokens: 100, usage: { inputTokens: 500, outputTokens: 120 } });
  assert.equal(overOutput.state, 'fail_over_max_tokens');

  const valid = enforceSubagentCall({
    role: 'lean-prover',
    route: 'claude-fable-5-2',
    maxTokens: 4000,
    usage: { inputTokens: 1200, outputTokens: 850, cachedTokens: 900 },
  });
  assert.equal(valid.state, 'pass');
  assert.equal(valid.row.totalTokens, 2050);
  assert.equal(valid.row.cachedTokens, 900);
});
