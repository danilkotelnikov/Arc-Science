import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BudgetGuard,
  HOH_PPC_ARM_ID,
  estimateCallCostUsd,
  extractMcqAnswer,
  runArcHeadless,
  runHohPpcItem,
  runScienceBench,
} from '../tools/science-bench.mjs';

test('estimateCallCostUsd computes Anthropic and Google Vertex token spend accurately', () => {
  const sonnet = estimateCallCostUsd('claude-sonnet-5-5', {
    inputTokens: 500,
    outputTokens: 250,
    cacheReadTokens: 1000,
    cacheWriteTokens: 0,
  });
  assert.equal(sonnet.known, true);
  // 500*2 + 250*10 + 1000*0.10 = 1000 + 2500 + 100 = 3600 -> $0.0036
  assert.ok(Math.abs(sonnet.costUsd - 0.0036) < 1e-9);

  const argon = estimateCallCostUsd('google/gemini-4-argon', {
    inputTokens: 1000,
    outputTokens: 500,
  });
  assert.equal(argon.known, true);
  // 1000*2.20 + 500*11.00 = 2200 + 5500 = 7700 -> $0.0077
  assert.ok(Math.abs(argon.costUsd - 0.0077) < 1e-9);
});

test('BudgetGuard enforces independent per-family hard caps and fail_budget control', () => {
  const guard = new BudgetGuard({ maxClaudeUsd: 1.0, maxGoogleUsd: 0.5 });
  const c1 = guard.tryReserve('anthropic', 0.4);
  const c2 = guard.tryReserve('anthropic', 0.4);
  assert.equal(c1.ok && c2.ok, true);
  const cOver = guard.tryReserve('anthropic', 0.25);
  assert.equal(cOver.ok, false);
  assert.equal(cOver.state, 'fail_budget');

  guard.settle(c1, 0.2);
  guard.settle(c2, 0.2);
  const c3 = guard.tryReserve('anthropic', 0.5);
  assert.equal(c3.ok, true);
  guard.settle(c3, 0.3);

  const sum = guard.summary();
  assert.ok(Math.abs(sum.claudeSpentUsd - 0.7) < 1e-6);
  assert.equal(sum.blockedByFamily.anthropic, 1);
  assert.equal(sum.capHit.anthropic, true);
  assert.equal(sum.capHit.google, false);
});

test('runArcHeadless rejects provider merge under R006 without spawning', async () => {
  const r = await runArcHeadless({ provider: 'merge', model: 'anthropic/claude-haiku-5-5', prompt: 'hi' });
  assert.equal(r.ok, false);
  assert.match(r.errorMessage, /merge.*forbidden|R006/i);
});

test('extractMcqAnswer parses JSON, prefixed choice labels, and regex fallback', () => {
  const j = extractMcqAnswer('{"answer":"A","confidence":0.91,"rationale":"clear slope"}');
  assert.equal(j.ok, true);
  assert.equal(j.answer, 'A');
  assert.equal(j.confidence, 0.91);

  const prefixed = extractMcqAnswer('{"answer":"C) Naive B cells","confidence":0.77}');
  assert.equal(prefixed.ok, true);
  assert.equal(prefixed.answer, 'C');

  const fb = extractMcqAnswer('After checking stoichiometry.\nAnswer: D');
  assert.equal(fb.ok, true);
  assert.equal(fb.answer, 'D');
  assert.equal(fb.parseMode, 'regex_fallback');
});

test('runHohPpcItem runs 2 calls on agreement, 3 calls on disagreement, and halts cleanly on fail_budget', async () => {
  const item = { id: 'x-1', source: 'BaisBench', domain: 'bio', gold_answer: 'B', prompt: 'Q?' };
  const calls = [];
  const agreeMock = async ({ provider, model }) => {
    calls.push(`${provider}:${model}`);
    return {
      ok: true,
      durationMs: 10,
      usage: { inputTokens: 100, outputTokens: 50 },
      text: '{"answer":"B","confidence":0.8,"rationale":"supported"}',
    };
  };
  const guardAgree = new BudgetGuard({ maxClaudeUsd: 5, maxGoogleUsd: 5 });
  const resAgree = await runHohPpcItem({ item, itemIndex: 0, budgetGuard: guardAgree, callModelFn: agreeMock });
  assert.equal(resAgree.ok, true);
  assert.equal(resAgree.correct, true);
  assert.equal(resAgree.calls, 2);
  assert.equal(resAgree.composeCalled, false);
  assert.equal(resAgree.agreedBeforeCompose, true);
  assert.equal(resAgree.crossFamilyOk, true);
  assert.deepEqual(calls, ['anthropic:claude-sonnet-5-5', 'vertex:google/gemini-4-carbon']);

  const disCalls = [];
  const disMock = async ({ provider, model }) => {
    disCalls.push(`${provider}:${model}`);
    if (provider === 'vertex') {
      return { ok: true, durationMs: 12, usage: { inputTokens: 120, outputTokens: 60 }, text: '{"answer":"B","confidence":0.9,"rationale":"g"}' };
    }
    if (disCalls.length === 1) {
      return { ok: true, durationMs: 11, usage: { inputTokens: 100, outputTokens: 50 }, text: '{"answer":"A","confidence":0.6,"rationale":"p"}' };
    }
    return { ok: true, durationMs: 13, usage: { inputTokens: 200, outputTokens: 70 }, text: '{"answer":"B","confidence":0.85,"rationale":"resolved"}' };
  };
  const guardDis = new BudgetGuard({ maxClaudeUsd: 5, maxGoogleUsd: 5 });
  const resDis = await runHohPpcItem({ item, itemIndex: 1, budgetGuard: guardDis, callModelFn: disMock });
  assert.equal(resDis.calls, 3);
  assert.equal(resDis.composeCalled, true);
  assert.equal(resDis.answer, 'B');
  assert.equal(resDis.correct, true);

  // Tight cap triggers fail_budget before Probe
  const tightGuard = new BudgetGuard({ maxClaudeUsd: 5, maxGoogleUsd: 0.01 });
  const resTight = await runHohPpcItem({ item, itemIndex: 0, budgetGuard: tightGuard, callModelFn: disMock });
  assert.equal(resTight.state, 'fail_budget');
});

test('runScienceBench aggregates single-shot and HoH PPC metrics with 2-fold Platt calibration', async () => {
  const items = Array.from({ length: 24 }, (_, idx) => ({
    id: `it-${idx}`,
    source: idx < 12 ? 'EperLuo/BaisBench' : 'Yibo-Wen/as-bench',
    domain: idx < 12 ? 'biology' : 'materials',
    gold_answer: ['A', 'B', 'C', 'D'][idx % 4],
    prompt: `Question ${idx}`,
  }));
  const mockFn = async ({ model }) => {
    const idxMatch = /Question (\d+)/;
    void idxMatch;
    return { ok: true, durationMs: 5, usage: { inputTokens: 100, outputTokens: 40 }, text: '{"answer":"A","confidence":0.75,"rationale":"test"}' };
  };
  const rep = await runScienceBench({
    items,
    maxClaudeUsd: 1,
    maxGoogleUsd: 1,
    concurrency: 2,
    modelsFilter: ['claude-haiku-5-5', 'gemini-4-hydrogen', HOH_PPC_ARM_ID],
    callModelFn: async ({ prompt }) => {
      const m = /Question (\d+)/.exec(prompt);
      const idx = m ? Number(m[1]) : 0;
      const gold = ['A', 'B', 'C', 'D'][idx % 4];
      const pred = idx < 18 ? gold : (gold === 'A' ? 'B' : 'A');
      const conf = idx < 18 ? 0.9 : 0.6;
      return { ok: true, durationMs: 5, usage: { inputTokens: 100, outputTokens: 40 }, text: JSON.stringify({ answer: pred, confidence: conf, rationale: 'ok' }) };
    },
  });
  assert.equal(rep.withinCaps, true);
  assert.equal(rep.arms['claude-haiku-5-5'].correctCount, 18);
  assert.equal(rep.arms['gemini-4-hydrogen'].accuracy, 0.75);
  assert.equal(rep.arms[HOH_PPC_ARM_ID].platt2Fold.usable, true);
  assert.ok(rep.arms[HOH_PPC_ARM_ID].platt2Fold.oofBrier < rep.arms[HOH_PPC_ARM_ID].rawBrier);
});
