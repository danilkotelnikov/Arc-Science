#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REQUIRED_GATE_FIELDS = Object.freeze([
  'id',
  'claim',
  'command',
  'pass_when',
  'control_bad',
  'evidence',
  'spend_cap_usd',
  'attempts_max',
  'needs_yes',
]);

export function parseModelsRegistry(tsvPath) {
  const known = new Set();
  const raw = fs.readFileSync(tsvPath, 'utf8');
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#')) continue;
    const cols = line.split('\t');
    if (cols[0]) known.add(cols[0].trim().toLowerCase());
    if (cols[1]) {
      for (const alias of cols[1].split('|')) {
        if (alias.trim()) known.add(alias.trim().toLowerCase());
      }
    }
  }
  return known;
}

function parseSimpleYamlBlock(block) {
  const out = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith('\'') && val.endsWith('\''))) {
      val = val.slice(1, -1);
    }
    if (val.startsWith('[') && val.endsWith(']')) {
      out[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    } else {
      out[key] = val;
    }
  }
  return out;
}

export function extractPlanStructures(markdown) {
  const blocks = [];
  const fenceRe = /```ya?ml\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = fenceRe.exec(markdown)) !== null) {
    blocks.push(parseSimpleYamlBlock(m[1]));
  }
  const slices = blocks.filter((b) => 'slice' in b && !('id' in b && String(b.id).startsWith('G')));
  const gates = blocks.filter((b) => 'id' in b && ('claim' in b || 'command' in b || 'needs_yes' in b));
  const budgetBlock = blocks.find((b) => 'fresh_input_tokens' in b || 'output_tokens' in b || 'spend_usd' in b) || null;
  const modelsBlock = blocks.find((b) => Array.isArray(b.models) || typeof b.models === 'string') || null;
  return { slices, gates, budgetBlock, modelsBlock };
}

export function evaluatePlanGates({ planPath, modelsPath, lockedGates = {}, lintScriptPath }) {
  const markdown = fs.readFileSync(planPath, 'utf8');
  const { slices, gates, budgetBlock, modelsBlock } = extractPlanStructures(markdown);
  const results = {};

  // P1: Every gate row has all 9 required fields non-empty, and every slice has >=1 gate row
  const p1Errors = [];
  if (gates.length === 0) p1Errors.push('no gate rows found');
  for (const g of gates) {
    for (const f of REQUIRED_GATE_FIELDS) {
      const v = g[f];
      if (v === undefined || v === null || String(v).trim() === '') {
        p1Errors.push(`gate ${g.id || '?'} missing field ${f}`);
      }
    }
  }
  results.P1 = p1Errors.length === 0 ? { state: 'pass', gateCount: gates.length } : { state: 'fail_P1', errors: p1Errors };

  // P2: Locked build gate texts remain unchanged
  const p2Errors = [];
  for (const [gid, expectedClaim] of Object.entries(lockedGates || {})) {
    const found = gates.find((g) => g.id === gid);
    if (!found) p2Errors.push(`missing locked gate ${gid}`);
    else if (String(found.claim).trim() !== String(expectedClaim).trim()) {
      p2Errors.push(`softened or modified gate ${gid}`);
    }
  }
  results.P2 = p2Errors.length === 0 ? { state: 'pass' } : { state: 'fail_P2', errors: p2Errors };

  // P3: Every slice names a roadmap step or NEW with a reason
  const p3Errors = [];
  if (slices.length === 0) p3Errors.push('no slice metadata blocks found');
  for (const s of slices) {
    const step = String(s.roadmap_step || '').trim();
    const reason = String(s.new_reason || '').trim();
    const hasStep = /^(\d+\.\d+|phase\s+\d+|S\d+|NEW)$/i.test(step);
    if (!hasStep) p3Errors.push(`slice ${s.slice || '?'} missing roadmap_step`);
    if (step.toUpperCase() === 'NEW' && !reason) p3Errors.push(`slice ${s.slice || '?'} uses NEW without new_reason`);
  }
  results.P3 = p3Errors.length === 0 ? { state: 'pass', sliceCount: slices.length } : { state: 'fail_P3', errors: p3Errors };

  // P4: lint_prose.py --technical reports no error
  const linter = lintScriptPath || path.join(os.homedir(), 'arc-harness', 'tools', 'lint_prose.py');
  let p4Res = { state: 'blocked_no_linter' };
  if (fs.existsSync(linter)) {
    const lr = spawnSync('py', ['-3', '-I', linter, '--technical', planPath], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
    });
    const combined = `${lr.stdout || ''}\n${lr.stderr || ''}`.trim();
    p4Res = lr.status === 0 && !/\berror\b/i.test(combined)
      ? { state: 'pass', output: combined }
      : { state: 'fail_P4', status: lr.status, output: combined };
  }
  results.P4 = p4Res;

  // P5: Every named model has a row in models.tsv
  const known = parseModelsRegistry(modelsPath);
  const listedModels = [];
  if (modelsBlock && Array.isArray(modelsBlock.models)) listedModels.push(...modelsBlock.models);
  for (const s of slices) {
    if (s.model) listedModels.push(s.model);
  }
  const unknownModels = listedModels.filter((m) => !known.has(String(m).trim().toLowerCase()));
  results.P5 = listedModels.length > 0 && unknownModels.length === 0
    ? { state: 'pass', checked: listedModels.length }
    : { state: 'fail_P5', unknownModels };

  // P6: Token and spend caps stay inside budget
  const p6Errors = [];
  if (!budgetBlock) {
    p6Errors.push('missing budget YAML block');
  } else {
    const inTok = Number(budgetBlock.fresh_input_tokens ?? 0);
    const outTok = Number(budgetBlock.output_tokens ?? 0);
    const inCap = Number(budgetBlock.input_cap ?? 120000);
    const outCap = Number(budgetBlock.output_cap ?? 12000);
    const spend = Number(budgetBlock.spend_usd ?? 0);
    const spendCap = budgetBlock.spend_cap_usd === 'ask' ? Infinity : Number(budgetBlock.spend_cap_usd ?? 0);
    if (!(inTok <= inCap)) p6Errors.push(`input_tokens ${inTok} > ${inCap}`);
    if (!(outTok <= outCap)) p6Errors.push(`output_tokens ${outTok} > ${outCap}`);
    if (!(spend <= spendCap)) p6Errors.push(`spend_usd ${spend} > ${spendCap}`);
  }
  results.P6 = p6Errors.length === 0 ? { state: 'pass' } : { state: 'fail_budget', errors: p6Errors };

  const ok = Object.values(results).every((r) => r.state === 'pass');
  return { ok, state: ok ? 'pass' : 'fail', results };
}

function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-plan-gates-'));
  try {
    const modelsPath = path.join(tmp, 'models.tsv');
    fs.writeFileSync(modelsPath, 'Claude-Fable-5.2\tclaude-fable-5-2\t2026-11\tprop\tcurrent\nGemini-4-Argon\tgemini-4-argon\t2026\tprop\tcurrent\n');

    const linterPath = path.join(tmp, 'mock_lint.py');
    fs.writeFileSync(linterPath, 'import sys\ntxt=open(sys.argv[2], encoding="utf8").read()\nif "BADWORD" in txt:\n  print("error BADWORD")\n  sys.exit(1)\n');

    const basePlan = [
      '# Sample Plan',
      '',
      '```yaml',
      'models: [claude-fable-5-2, gemini-4-argon]',
      'fresh_input_tokens: 40000',
      'output_tokens: 4000',
      'spend_usd: 0',
      'spend_cap_usd: ask',
      '```',
      '',
      '```yaml',
      'slice: C3.1',
      'roadmap_step: 7.4',
      'model: claude-fable-5-2',
      '```',
      '',
      '```yaml',
      'id: G3.1',
      'claim: Lean gate rejects sorry and native_decide.',
      'command: node tools/lean-gate.mjs --self-test',
      'pass_when: exit 0 and state equals pass',
      'control_bad: sorry theorem returns fail_banned_token',
      'evidence: preflight/lean-gate.json',
      'spend_cap_usd: 0',
      'attempts_max: 3',
      'needs_yes: none',
      '```',
      '',
    ].join('\n');

    const writePlan = (name, text) => {
      const p = path.join(tmp, name);
      fs.writeFileSync(p, text);
      return p;
    };

    const pGood = writePlan('good.md', basePlan);
    const rGood = evaluatePlanGates({ planPath: pGood, modelsPath, lockedGates: { 'G3.1': 'Lean gate rejects sorry and native_decide.' }, lintScriptPath: linterPath });
    assert.equal(rGood.ok, true, JSON.stringify(rGood));

    const rBadP1 = evaluatePlanGates({ planPath: writePlan('p1.md', basePlan.replace('control_bad: sorry theorem returns fail_banned_token\n', '')), modelsPath, lintScriptPath: linterPath });
    assert.equal(rBadP1.results.P1.state, 'fail_P1');

    const rBadP2 = evaluatePlanGates({ planPath: writePlan('p2.md', basePlan.replace('Lean gate rejects sorry and native_decide.', 'Lean gate runs quickly.')), modelsPath, lockedGates: { 'G3.1': 'Lean gate rejects sorry and native_decide.' }, lintScriptPath: linterPath });
    assert.equal(rBadP2.results.P2.state, 'fail_P2');

    const rBadP3 = evaluatePlanGates({ planPath: writePlan('p3.md', basePlan.replace('roadmap_step: 7.4', 'roadmap_step: NEW')), modelsPath, lintScriptPath: linterPath });
    assert.equal(rBadP3.results.P3.state, 'fail_P3');

    const rBadP4 = evaluatePlanGates({ planPath: writePlan('p4.md', `${basePlan}\nBADWORD here.\n`), modelsPath, lintScriptPath: linterPath });
    assert.equal(rBadP4.results.P4.state, 'fail_P4');

    const rBadP5 = evaluatePlanGates({ planPath: writePlan('p5.md', basePlan.replace('claude-fable-5-2', 'FakeModel-99B')), modelsPath, lintScriptPath: linterPath });
    assert.equal(rBadP5.results.P5.state, 'fail_P5');

    const rBadP6 = evaluatePlanGates({ planPath: writePlan('p6.md', basePlan.replace('fresh_input_tokens: 40000', 'fresh_input_tokens: 250000')), modelsPath, lintScriptPath: linterPath });
    assert.equal(rBadP6.results.P6.state, 'fail_budget');

    console.log('plan-gates self-test: PASS (1 pass + 6 controls verified)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
  } else {
    const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
    const planPath = path.resolve(arg('--plan') || '');
    const modelsPath = path.resolve(arg('--models') || path.join(os.homedir(), 'arc-harness', 'shared', 'models.tsv'));
    const res = evaluatePlanGates({ planPath, modelsPath });
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }
}
