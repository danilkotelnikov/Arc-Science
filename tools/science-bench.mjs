// Headless public science benchmark harness (T5, roadmap Phase 7):
// Evaluates single-shot Anthropic (Claude 5.x Direct) and Google Vertex (Gemini 4) models alongside
// a cross-family HoH Propose-Probe-Compose outer loop over public science MCQs inside `arc --profile headless --json`,
// enforcing hard per-family USD spend circuit breakers and scoring 2-fold out-of-fold Platt Brier skill score.
// Usage:
//   node tools/science-bench.mjs --self-test
//   node tools/science-bench.mjs --items <items.json> [--out <report.json>] [--max-claude-usd 30] [--max-google-usd 30] [--concurrency 2]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  brierScore,
  brierSkillScore,
  crossFitPlatt2Fold,
} from '../plugins/arc-hoh/lib/intuition.js';
import { checkCrossFamilyVerdict } from '../plugins/arc-hoh/lib/budget.js';

export const DEFAULT_ARC_CMD = process.env.ARC_CLI_BIN
  || path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Arc Harness', 'resources', 'runtime', 'cli', 'bin', 'arc.cmd');

// USD per 1M tokens (Nov 2026 published Anthropic API & Google Vertex AI Non-Global rates;
// Haiku priced conservatively at long/worst-case tier margin when <=100k vs >100k isn't split,
// or exact <=100k rate 0.10/0.50 since prompts are ~400 tokens). We use exact <=100k Haiku + Non-Global Vertex rates.
export const MODEL_PRICING_USD_PER_MTOK = Object.freeze({
  'claude-haiku-5-5': Object.freeze({ family: 'anthropic', input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 }),
  'claude-sonnet-5-5': Object.freeze({ family: 'anthropic', input: 2.00, output: 10.00, cacheRead: 0.10, cacheWrite: 2.50 }),
  'claude-opus-5-5': Object.freeze({ family: 'anthropic', input: 4.00, output: 20.00, cacheRead: 0.20, cacheWrite: 5.00 }),
  'claude-fable-5-2': Object.freeze({ family: 'anthropic', input: 8.00, output: 40.00, cacheRead: 0.20, cacheWrite: 10.00 }),
  'gemini-4-hydrogen': Object.freeze({ family: 'google', input: 1.65, output: 8.25, cacheRead: 0.0825, cacheWrite: 1.65 }),
  'gemini-4-argon': Object.freeze({ family: 'google', input: 2.20, output: 11.00, cacheRead: 0.11, cacheWrite: 2.20 }),
  'gemini-4-carbon': Object.freeze({ family: 'google', input: 2.20, output: 11.00, cacheRead: 0.11, cacheWrite: 2.20 }),
});

export const SINGLE_SHOT_SPECS = Object.freeze([
  Object.freeze({ armId: 'claude-opus-5-5', provider: 'anthropic', model: 'claude-opus-5-5', family: 'anthropic', reasoningEffort: null, maxOutputTokens: 4096, reserveUsd: 0.12 }),
  Object.freeze({ armId: 'claude-sonnet-5-5', provider: 'anthropic', model: 'claude-sonnet-5-5', family: 'anthropic', reasoningEffort: null, maxOutputTokens: 4096, reserveUsd: 0.08 }),
  Object.freeze({ armId: 'claude-fable-5-2', provider: 'anthropic', model: 'claude-fable-5-2', family: 'anthropic', reasoningEffort: null, maxOutputTokens: 4096, reserveUsd: 0.28 }),
  Object.freeze({ armId: 'claude-haiku-5-5', provider: 'anthropic', model: 'claude-haiku-5-5', family: 'anthropic', reasoningEffort: null, maxOutputTokens: 4096, reserveUsd: 0.02 }),
  Object.freeze({ armId: 'gemini-4-argon', provider: 'vertex', model: 'google/gemini-4-argon', family: 'google', reasoningEffort: 'low', maxOutputTokens: 4096, reserveUsd: 0.08 }),
  Object.freeze({ armId: 'gemini-4-carbon', provider: 'vertex', model: 'google/gemini-4-carbon', family: 'google', reasoningEffort: 'low', maxOutputTokens: 4096, reserveUsd: 0.08 }),
  Object.freeze({ armId: 'gemini-4-hydrogen', provider: 'vertex', model: 'google/gemini-4-hydrogen', family: 'google', reasoningEffort: 'low', maxOutputTokens: 4096, reserveUsd: 0.06 }),
]);

export function computeConservativeReserveUsd(spec, promptText = '') {
  const key = normalizeModelKey(spec?.model);
  const rates = MODEL_PRICING_USD_PER_MTOK[key];
  const baseReserve = typeof spec?.reserveUsd === 'number' && Number.isFinite(spec.reserveUsd) ? spec.reserveUsd : 0.08;
  if (!rates) return baseReserve;
  const estInputTokens = Math.max(2000, Math.ceil(String(promptText || '').length / 3) + 1500);
  const maxOutTokens = Number.isInteger(spec?.maxOutputTokens) && spec.maxOutputTokens > 0 ? spec.maxOutputTokens : 8192;
  const worstCaseUsd = (estInputTokens * rates.input + maxOutTokens * rates.output) / 1_000_000;
  return Number(Math.max(baseReserve, worstCaseUsd).toFixed(6));
}

export const HOH_PPC_ARM_ID = 'hoh-ppc-sonnet-carbon';
export const FALLBACK_MISSING_USAGE_USD = 0.05;

export function normalizeModelKey(model) {
  return String(model || '').trim().replace(/^(?:google|anthropic)\//i, '').toLowerCase();
}

export function normalizeFamily(familyOrProvider) {
  const s = String(familyOrProvider || '').trim().toLowerCase();
  if (s === 'anthropic' || s === 'claude' || s.startsWith('claude-')) return 'anthropic';
  if (s === 'google' || s === 'vertex' || s.includes('gemini')) return 'google';
  return s || 'unknown';
}

export function estimateCallCostUsd(model, usage) {
  const key = normalizeModelKey(model);
  const rates = MODEL_PRICING_USD_PER_MTOK[key];
  if (!rates) {
    throw new Error(`Unknown model pricing for ${model}`);
  }
  if (!usage || typeof usage !== 'object') {
    return { known: false, costUsd: FALLBACK_MISSING_USAGE_USD };
  }
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const inputTokens = num(usage.inputTokens);
  const outputTokens = num(usage.outputTokens);
  const cacheReadTokens = num(usage.cacheReadTokens);
  const cacheWriteTokens = num(usage.cacheWriteTokens);
  const costUsd = (
    inputTokens * rates.input
    + outputTokens * rates.output
    + cacheReadTokens * rates.cacheRead
    + cacheWriteTokens * rates.cacheWrite
  ) / 1_000_000;
  return { known: true, costUsd: Number(costUsd.toFixed(8)) };
}

export class BudgetGuard {
  constructor({ maxClaudeUsd = 30, maxGoogleUsd = 30, defaultReserveUsd = 0.08 } = {}) {
    if (!Number.isFinite(maxClaudeUsd) || maxClaudeUsd < 0) {
      throw new Error(`Invalid maxClaudeUsd: ${maxClaudeUsd}`);
    }
    if (!Number.isFinite(maxGoogleUsd) || maxGoogleUsd < 0) {
      throw new Error(`Invalid maxGoogleUsd: ${maxGoogleUsd}`);
    }
    this.caps = { anthropic: maxClaudeUsd, google: maxGoogleUsd };
    this.spent = { anthropic: 0, google: 0 };
    this.reserved = { anthropic: 0, google: 0 };
    this.calls = { anthropic: 0, google: 0 };
    this.blocked = { anthropic: 0, google: 0 };
    this.capHit = { anthropic: false, google: false };
    this.defaultReserveUsd = defaultReserveUsd;
    this.nextId = 1;
  }

  tryReserve(familyOrProvider, reserveUsd = this.defaultReserveUsd) {
    const family = normalizeFamily(familyOrProvider);
    if (!Object.hasOwn(this.caps, family)) {
      return { ok: false, state: 'fail_budget_unknown_family', family };
    }
    if (typeof reserveUsd !== 'number' || !Number.isFinite(reserveUsd) || reserveUsd < 0) {
      return { ok: false, state: 'fail_budget_invalid_reserve', family, reserveUsd };
    }
    const projected = this.spent[family] + this.reserved[family] + reserveUsd;
    if (projected > this.caps[family] + 1e-12) {
      this.blocked[family] += 1;
      this.capHit[family] = true;
      return {
        ok: false,
        state: 'fail_budget',
        family,
        spentUsd: Number(this.spent[family].toFixed(6)),
        reservedUsd: Number(this.reserved[family].toFixed(6)),
        requestedUsd: reserveUsd,
        capUsd: this.caps[family],
      };
    }
    this.reserved[family] += reserveUsd;
    const token = { ok: true, id: this.nextId, family, reserveUsd, settled: false };
    this.nextId += 1;
    return token;
  }

  settle(reservation, actualUsd, { countCall = true } = {}) {
    if (!reservation || !reservation.ok || reservation.settled) return;
    reservation.settled = true;
    const fam = reservation.family;
    this.reserved[fam] = Math.max(0, this.reserved[fam] - reservation.reserveUsd);
    const charge = typeof actualUsd === 'number' && Number.isFinite(actualUsd) && actualUsd >= 0
      ? actualUsd
      : FALLBACK_MISSING_USAGE_USD;
    this.spent[fam] += charge;
    if (countCall) this.calls[fam] += 1;
  }

  summary() {
    const claudeUsd = Number(this.spent.anthropic.toFixed(6));
    const googleUsd = Number(this.spent.google.toFixed(6));
    return {
      claudeSpentUsd: claudeUsd,
      googleSpentUsd: googleUsd,
      totalSpentUsd: Number((claudeUsd + googleUsd).toFixed(6)),
      maxClaudeUsd: this.caps.anthropic,
      maxGoogleUsd: this.caps.google,
      callsByFamily: { ...this.calls },
      blockedByFamily: { ...this.blocked },
      capHit: { ...this.capHit },
    };
  }
}

export function buildCmdFallbackArgs(arcCmd, arcArgs) {
  const unsafeMeta = /[&|<>^%\r\n\0]/;
  const all = [arcCmd, ...(arcArgs || [])];
  for (const tok of all) {
    if (unsafeMeta.test(String(tok))) {
      return { ok: false, error: 'unsafe cmd metacharacter in argument' };
    }
  }
  const line = all.map((tok) => `"${String(tok).replace(/"/g, '""')}"`).join(' ');
  return { ok: true, args: ['/d', '/s', '/c', `"${line}"`] };
}

function sumUsageList(list) {
  const items = (list || []).filter((u) => u && typeof u === 'object');
  if (items.length === 0) return null;
  const tot = {};
  for (const u of items) {
    for (const k of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
      if (typeof u[k] === 'number') tot[k] = (tot[k] || 0) + u[k];
    }
  }
  return tot;
}

function killProcessTree(pid, child) {
  if (pid && process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
    } catch {
      /* ignore taskkill race */
    }
  } else if (pid) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* ignore process group race */
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* ignore */
  }
}

export async function runArcHeadless({
  arcCmd = DEFAULT_ARC_CMD,
  provider,
  model,
  prompt,
  reasoningEffort = null,
  timeoutMs = 120000,
} = {}) {
  if (String(provider || '').trim().toLowerCase() === 'merge') {
    return {
      ok: false,
      timedOut: false,
      provider,
      model,
      exitCode: null,
      spawnError: 'provider merge is forbidden by R006 policy',
      errorMessage: 'provider merge is forbidden by R006 policy',
      durationMs: 0,
      usage: null,
      text: '',
    };
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-scibench-'));
  const t0 = Date.now();
  const resolvedArcCmd = (typeof arcCmd === 'string' && (path.isAbsolute(arcCmd) || arcCmd.includes('/') || arcCmd.includes('\\') || fs.existsSync(arcCmd)))
    ? path.resolve(arcCmd)
    : arcCmd;
  try {
    let r;
    try {
      const safeScalar = (v) => JSON.stringify(String(v));
      const overlayLines = [
        '- id: agent-default-model',
        "  name: '@arc-harness/arc-agent-default-model'",
        '  config:',
        `    provider: ${safeScalar(provider)}`,
        `    model: ${safeScalar(model)}`,
      ];
      if (reasoningEffort) overlayLines.push(`    reasoningEffort: ${safeScalar(reasoningEffort)}`);
      const overlayPath = path.join(workDir, 'overlay.yml');
      fs.writeFileSync(overlayPath, overlayLines.join('\n') + '\n', 'utf8');

      const env = {
        ...process.env,
        ARC_HOH_BRIEF: '0',
        ARC_HOH_RETAIN: '0',
        VERTEX_GATEWAY: process.env.VERTEX_GATEWAY || 'gateway',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'gateway',
        RADIUM_API_KEY: process.env.RADIUM_API_KEY || 'gateway',
      };
      const arcArgs = ['--profile', 'headless', '--patch', overlayPath, '--json', '-'];
      let bin = resolvedArcCmd;
      let spawnArgs = arcArgs;
      let verbatim = false;
      if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolvedArcCmd)) {
        const binDir = path.dirname(resolvedArcCmd);
        const exePath = path.resolve(binDir, '..', '..', '..', '..', 'Arc Harness.exe');
        const appAsar = path.resolve(binDir, '..', '..', '..', 'app.asar');
        const cliJs = path.join(appAsar, 'arc', 'node_modules', '@arc-harness', 'arc-desktop-host', 'lib', 'cli.js');
        if (fs.existsSync(exePath) && fs.existsSync(appAsar)) {
          bin = exePath;
          spawnArgs = ['--expose-internals', cliJs, ...arcArgs];
          env.ELECTRON_RUN_AS_NODE = '1';
        } else {
          const built = buildCmdFallbackArgs(resolvedArcCmd, arcArgs);
          if (!built.ok) {
            return {
              ok: false,
              timedOut: false,
              provider,
              model,
              exitCode: null,
              spawnError: built.error,
              errorMessage: built.error,
              durationMs: Date.now() - t0,
              usage: null,
              text: '',
            };
          }
          bin = 'cmd.exe';
          spawnArgs = built.args;
          verbatim = true;
        }
      }

      r = await new Promise((resolve) => {
        const child = spawn(bin, spawnArgs, {
          cwd: workDir,
          windowsHide: true,
          windowsVerbatimArguments: verbatim,
          detached: process.platform !== 'win32',
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
        });
        const MAX_BUF = 16 * 1024 * 1024;
        const outChunks = [];
        const errChunks = [];
        let totalBytes = 0;
        let timedOut = false;
        let bufferExceeded = false;
        let spawnErr = null;
        let settled = false;
        let killGraceTimer = null;

        const finish = (exitCode) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (killGraceTimer) clearTimeout(killGraceTimer);
          resolve({
            exitCode,
            timedOut,
            bufferExceeded,
            spawnErr,
            stdout: Buffer.concat(outChunks).toString('utf8'),
            stderr: Buffer.concat(errChunks).toString('utf8'),
          });
        };

        const armKillGrace = () => {
          if (killGraceTimer || settled) return;
          killGraceTimer = setTimeout(() => {
            try { child.stdout?.destroy(); } catch { /* ignore */ }
            try { child.stderr?.destroy(); } catch { /* ignore */ }
            finish(null);
          }, 5000);
          killGraceTimer.unref?.();
        };

        const onData = (chunks) => (buf) => {
          if (bufferExceeded || settled) return;
          if (totalBytes + buf.length > MAX_BUF) {
            bufferExceeded = true;
            killProcessTree(child.pid, child);
            armKillGrace();
            return;
          }
          totalBytes += buf.length;
          chunks.push(buf);
        };

        child.stdout.on('data', onData(outChunks));
        child.stderr.on('data', onData(errChunks));
        child.stdin.on('error', () => { /* ignore EPIPE */ });
        child.on('error', (err) => {
          spawnErr = err;
          finish(null);
        });
        child.on('close', (code) => finish(code));

        const timer = setTimeout(() => {
          if (settled) return;
          timedOut = true;
          killProcessTree(child.pid, child);
          armKillGrace();
        }, timeoutMs);

        try {
          child.stdin.end(String(prompt || ''), 'utf8');
        } catch {
          /* ignore */
        }
      });
    } catch (err) {
      const msg = err && typeof err.message === 'string' ? err.message : 'spawn failed';
      return {
        ok: false,
        timedOut: false,
        provider,
        model,
        exitCode: null,
        spawnError: msg,
        errorMessage: msg,
        durationMs: Date.now() - t0,
        usage: null,
        text: '',
      };
    }

    const durationMs = Date.now() - t0;
    const events = [];
    for (const line of String(r.stdout || '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try { events.push(JSON.parse(trimmed)); } catch { /* ignore non-json */ }
    }
    const finalEv = [...events].reverse().find((e) => e.type === 'final');
    const usage = sumUsageList(events.filter((e) => e.type === 'status' && e.phase === 'step_end').map((e) => e.usage));
    const errEv = [...events].reverse().find((e) => e.type === 'error');
    const ok = !r.timedOut && !r.bufferExceeded && !r.spawnErr && r.exitCode === 0 && !errEv && Boolean(finalEv && typeof finalEv.text === 'string' && finalEv.text.trim().length > 0);
    const timeoutMsg = r.timedOut ? `Timed out after ${timeoutMs} ms` : (r.bufferExceeded ? 'Output buffer limit exceeded' : null);
    return {
      ok,
      timedOut: r.timedOut,
      provider,
      model,
      exitCode: r.exitCode,
      spawnError: r.spawnErr ? r.spawnErr.message : null,
      errorMessage: errEv ? errEv.message : (timeoutMsg || (!ok ? String(r.stderr || '').trim().slice(0, 400) : null)),
      durationMs,
      usage,
      text: finalEv?.text || '',
    };
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* ignore transient Windows handle lock */
    }
  }
}

export function extractJsonObject(text) {
  const s = String(text || '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(s);
  const body = fenced ? fenced[1].trim() : s;
  const parsePlainObject = (json) => {
    const value = JSON.parse(json);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('JSON value is not a plain object');
    }
    return { ok: true, value };
  };
  try {
    return parsePlainObject(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return parsePlainObject(body.slice(start, end + 1));
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    return { ok: false, error: 'no JSON object in model output' };
  }
}

function clampConfidence(v, fallback = 0.5) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(0.99, Math.max(0.01, v));
}

export function extractMcqAnswer(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return { ok: false, answer: null, confidence: 0.25, rationale: '', parseMode: 'empty' };
  }
  const parsed = extractJsonObject(raw);
  if (parsed.ok) {
    const obj = parsed.value;
    const ansRaw = String(obj.answer ?? '').trim().toUpperCase();
    const match = /^([A-D])(?:\s*[).:\-]|$)/.exec(ansRaw);
    if (match) {
      const conf = clampConfidence(typeof obj.confidence === 'number' ? obj.confidence : Number(obj.confidence), 0.5);
      const rationale = typeof obj.rationale === 'string' ? obj.rationale.trim() : '';
      return { ok: true, answer: match[1], confidence: conf, rationale, parseMode: 'json' };
    }
  }
  const keyed = /\b(?:final_?answer|answer|choice|option)\s*[:=]\s*"?\(?([A-D])\)?\b/i.exec(raw);
  if (keyed) {
    return { ok: true, answer: keyed[1].toUpperCase(), confidence: 0.5, rationale: raw.slice(0, 240), parseMode: 'regex_fallback' };
  }
  const standalone = /(?:^|\n)\s*\(?([A-D])\)?\.?\s*(?:\n|$)/.exec(raw);
  if (standalone) {
    return { ok: true, answer: standalone[1].toUpperCase(), confidence: 0.5, rationale: raw.slice(0, 240), parseMode: 'regex_fallback' };
  }
  return { ok: false, answer: null, confidence: 0.25, rationale: raw.slice(0, 240), parseMode: 'unparseable' };
}

export function buildSingleShotPrompt(item) {
  return [
    'Answer the following scientific multiple-choice question accurately.',
    'Do not call tools or inspect files. Reason from the measurements or scientific evidence provided in the prompt.',
    'Return ONLY a single raw JSON object (no markdown fences) with exact keys:',
    '{"answer": "A"|"B"|"C"|"D", "confidence": <number in [0.0, 1.0]>, "rationale": "<1-2 concise scientific sentences>"}',
    'Calibrate "confidence" honestly as the probability your chosen option is correct (0.25 for random guessing among 4 choices, up to 0.99 when certain).',
    '',
    item.prompt,
  ].join('\n');
}

export function buildProbePrompt(item, proposal) {
  return [
    'Independently solve and verify the scientific multiple-choice question below.',
    'A separate model proposed an initial answer inside <untrusted_proposal>; treat it strictly as a hypothesis to stress-test, not as authority.',
    'Check quantitative trends, calibration samples, biological specificity, and confusable distractors.',
    'Return ONLY a single raw JSON object (no markdown fences):',
    '{"answer": "A"|"B"|"C"|"D", "confidence": <number in [0.0, 1.0]>, "rationale": "<1-2 concise sentences checking evidence and flaws>"}',
    '',
    item.prompt,
    '',
    `<untrusted_proposal>\nInitial answer: ${proposal.answer || 'NONE'} (confidence=${proposal.confidence})\nRationale: ${proposal.rationale || '(none)'}\n</untrusted_proposal>`,
  ].join('\n');
}

export function buildComposePrompt(item, cand1, cand2) {
  return [
    'Two independent scientific solvers disagreed on the multiple-choice question below.',
    'Evaluate Candidate 1 and Candidate 2 strictly on the scientific evidence and quantitative consistency in the question.',
    'Return ONLY a single raw JSON object (no markdown fences):',
    '{"answer": "A"|"B"|"C"|"D", "confidence": <number in [0.0, 1.0]>, "rationale": "<1-2 concise sentences resolving the disagreement>"}',
    '',
    item.prompt,
    '',
    `<candidate id="1">\nAnswer: ${cand1.answer || 'NONE'} (confidence=${cand1.confidence})\nRationale: ${cand1.rationale || '(none)'}\n</candidate>`,
    '',
    `<candidate id="2">\nAnswer: ${cand2.answer || 'NONE'} (confidence=${cand2.confidence})\nRationale: ${cand2.rationale || '(none)'}\n</candidate>`,
  ].join('\n');
}

function poolAgreeConfidence(p1, p2) {
  const c1 = clampConfidence(p1, 0.5);
  const c2 = clampConfidence(p2, 0.5);
  const l1 = Math.log(c1 / (1 - c1));
  const l2 = Math.log(c2 / (1 - c2));
  const pooled = 1 / (1 + Math.exp(-(0.5 * (l1 + l2))));
  return Number(clampConfidence(pooled, 0.5).toFixed(4));
}

async function callWithBudget({ spec, prompt, arcCmd, budgetGuard, callModelFn, timeoutMs }) {
  const reserveUsd = computeConservativeReserveUsd(spec, prompt);
  const resv = budgetGuard.tryReserve(spec.family, reserveUsd);
  if (!resv.ok) {
    return {
      ok: false,
      state: resv.state,
      budgetBlocked: true,
      family: resv.family,
      model: spec.model,
      provider: spec.provider,
      durationMs: 0,
      usage: null,
      costUsd: 0,
      text: '',
      errorMessage: `budget cap reached for ${resv.family} (${resv.spentUsd} + ${resv.requestedUsd} > ${resv.capUsd})`,
    };
  }
  try {
    let raw = await callModelFn({
      arcCmd,
      provider: spec.provider,
      model: spec.model,
      prompt,
      reasoningEffort: spec.reasoningEffort ?? null,
      timeoutMs,
    });
    const est = estimateCallCostUsd(spec.model, raw?.usage);
    const callCost = (raw?.spawnError && !raw?.usage) ? 0 : est.costUsd;
    budgetGuard.settle(resv, callCost, { countCall: true });
    return {
      ...raw,
      state: raw?.ok ? 'ok' : 'fail_call',
      budgetBlocked: false,
      family: spec.family,
      costUsd: callCost,
      usageKnown: est.known,
    };
  } catch (err) {
    budgetGuard.settle(resv, 0, { countCall: true });
    return {
      ok: false,
      state: 'fail_exception',
      budgetBlocked: false,
      family: spec.family,
      model: spec.model,
      provider: spec.provider,
      durationMs: 0,
      usage: null,
      costUsd: 0,
      text: '',
      errorMessage: err?.message || String(err),
    };
  }
}

export async function runSingleShotItem({ item, spec, arcCmd, budgetGuard, callModelFn = runArcHeadless, timeoutMs = 120000 }) {
  const res = await callWithBudget({
    spec,
    prompt: buildSingleShotPrompt(item),
    arcCmd,
    budgetGuard,
    callModelFn,
    timeoutMs,
  });
  const parsed = res.ok ? extractMcqAnswer(res.text) : { ok: false, answer: null, confidence: 0.25, rationale: '', parseMode: res.budgetBlocked ? 'budget_blocked' : 'call_failed' };
  const correct = Boolean(parsed.ok && parsed.answer === item.gold_answer);
  return {
    id: item.id,
    source: item.source,
    domain: item.domain,
    gold_answer: item.gold_answer,
    answer: parsed.answer,
    correct,
    actual: correct ? 1 : 0,
    probability: Number(clampConfidence(parsed.confidence, 0.25).toFixed(4)),
    parseMode: parsed.parseMode,
    ok: res.ok && parsed.ok,
    state: res.budgetBlocked ? 'fail_budget' : (res.ok ? (parsed.ok ? 'ok' : 'fail_parse') : res.state),
    durationMs: res.durationMs || 0,
    costUsd: res.costUsd || 0,
    usage: res.usage || null,
    calls: res.budgetBlocked ? 0 : 1,
    errorMessage: res.errorMessage || null,
  };
}

export async function runHohPpcItem({ item, itemIndex = 0, arcCmd, budgetGuard, callModelFn = runArcHeadless, timeoutMs = 120000 }) {
  const proposeSpec = { provider: 'anthropic', model: 'claude-sonnet-5-5', family: 'anthropic', reasoningEffort: null, reserveUsd: 0.05 };
  const probeSpec = { provider: 'vertex', model: 'google/gemini-4-carbon', family: 'google', reasoningEffort: 'low', reserveUsd: 0.05 };
  const composeSpec = { provider: 'anthropic', model: 'claude-sonnet-5-5', family: 'anthropic', reasoningEffort: null, reserveUsd: 0.05 };

  const proposeRes = await callWithBudget({
    spec: proposeSpec,
    prompt: buildSingleShotPrompt(item),
    arcCmd,
    budgetGuard,
    callModelFn,
    timeoutMs,
  });
  if (proposeRes.budgetBlocked) {
    return {
      id: item.id,
      source: item.source,
      domain: item.domain,
      gold_answer: item.gold_answer,
      answer: null,
      correct: false,
      actual: 0,
      probability: 0.25,
      parseMode: 'budget_blocked',
      ok: false,
      state: 'fail_budget',
      durationMs: 0,
      costUsd: 0,
      calls: 0,
      composeCalled: false,
      agreedBeforeCompose: false,
      crossFamilyOk: false,
      errorMessage: proposeRes.errorMessage,
    };
  }
  const proposeParsed = proposeRes.ok
    ? extractMcqAnswer(proposeRes.text)
    : { ok: false, answer: null, confidence: 0.25, rationale: '', parseMode: 'call_failed' };

  const probeRes = await callWithBudget({
    spec: probeSpec,
    prompt: buildProbePrompt(item, proposeParsed),
    arcCmd,
    budgetGuard,
    callModelFn,
    timeoutMs,
  });
  if (probeRes.budgetBlocked) {
    const correctFallback = Boolean(proposeParsed.ok && proposeParsed.answer === item.gold_answer);
    return {
      id: item.id,
      source: item.source,
      domain: item.domain,
      gold_answer: item.gold_answer,
      answer: proposeParsed.answer,
      correct: correctFallback,
      actual: correctFallback ? 1 : 0,
      probability: Number(clampConfidence(proposeParsed.confidence, 0.25).toFixed(4)),
      parseMode: 'budget_blocked_after_propose',
      ok: false,
      state: 'fail_budget',
      durationMs: proposeRes.durationMs || 0,
      costUsd: proposeRes.costUsd || 0,
      calls: 1,
      composeCalled: false,
      agreedBeforeCompose: false,
      crossFamilyOk: false,
      errorMessage: probeRes.errorMessage,
    };
  }
  const probeParsed = probeRes.ok
    ? extractMcqAnswer(probeRes.text)
    : { ok: false, answer: null, confidence: 0.25, rationale: '', parseMode: 'call_failed' };

  const cf = checkCrossFamilyVerdict({
    builderFamily: 'anthropic',
    checkerFamily: 'google',
    builderId: 'claude-sonnet-5-5',
    checkerId: 'gemini-4-carbon',
    verdict: 'probed',
  });

  let finalAnswer = null;
  let finalConfidence = 0.25;
  let finalParseMode = 'none';
  let composeCalled = false;
  let agreedBeforeCompose = false;
  let composeDurationMs = 0;
  let composeCostUsd = 0;
  let composeBlocked = false;
  let errorMsg = proposeRes.errorMessage || probeRes.errorMessage || null;

  if (proposeParsed.ok && probeParsed.ok && proposeParsed.answer === probeParsed.answer) {
    agreedBeforeCompose = true;
    finalAnswer = proposeParsed.answer;
    finalConfidence = poolAgreeConfidence(proposeParsed.confidence, probeParsed.confidence);
    finalParseMode = 'agree_pooled';
  } else {
    const swap = itemIndex % 2 === 1;
    const cand1 = swap ? probeParsed : proposeParsed;
    const cand2 = swap ? proposeParsed : probeParsed;
    const composeRes = await callWithBudget({
      spec: composeSpec,
      prompt: buildComposePrompt(item, cand1, cand2),
      arcCmd,
      budgetGuard,
      callModelFn,
      timeoutMs,
    });
    composeCalled = !composeRes.budgetBlocked;
    composeBlocked = Boolean(composeRes.budgetBlocked);
    composeDurationMs = composeRes.durationMs || 0;
    composeCostUsd = composeRes.costUsd || 0;
    if (composeRes.ok) {
      const composeParsed = extractMcqAnswer(composeRes.text);
      if (composeParsed.ok) {
        finalAnswer = composeParsed.answer;
        finalConfidence = composeParsed.confidence;
        finalParseMode = `compose_${composeParsed.parseMode}`;
      }
    } else if (composeRes.errorMessage) {
      errorMsg = composeRes.errorMessage;
    }
    if (!finalAnswer) {
      const pick = probeParsed.ok ? probeParsed : proposeParsed;
      finalAnswer = pick.answer;
      finalConfidence = clampConfidence(pick.confidence * 0.75, 0.25);
      finalParseMode = composeBlocked ? 'budget_blocked_fallback' : 'stage_fallback';
    }
  }

  const correct = Boolean(finalAnswer && finalAnswer === item.gold_answer);
  const totalCostUsd = Number(((proposeRes.costUsd || 0) + (probeRes.costUsd || 0) + composeCostUsd).toFixed(8));
  const totalDurationMs = (proposeRes.durationMs || 0) + (probeRes.durationMs || 0) + composeDurationMs;
  const calls = 2 + (composeCalled ? 1 : 0);

  return {
    id: item.id,
    source: item.source,
    domain: item.domain,
    gold_answer: item.gold_answer,
    proposeAnswer: proposeParsed.answer,
    probeAnswer: probeParsed.answer,
    answer: finalAnswer,
    correct,
    actual: correct ? 1 : 0,
    probability: Number(clampConfidence(finalConfidence, 0.25).toFixed(4)),
    parseMode: finalParseMode,
    ok: !composeBlocked && Boolean(finalAnswer),
    state: composeBlocked ? 'fail_budget' : (finalAnswer ? 'ok' : 'fail_parse'),
    durationMs: totalDurationMs,
    costUsd: totalCostUsd,
    calls,
    composeCalled,
    agreedBeforeCompose,
    crossFamilyOk: Boolean(cf.ok),
    errorMessage: errorMsg,
  };
}

export function summarizeArm(armId, meta, records) {
  const executed = records.filter((r) => r.state !== 'fail_budget' || r.calls > 0);
  const scored = executed;
  const correctCount = scored.filter((r) => r.correct).length;
  const totalCount = scored.length;
  const accuracy = totalCount > 0 ? Number((correctCount / totalCount).toFixed(4)) : null;

  const bySource = {};
  for (const r of scored) {
    const src = r.source || 'unknown';
    if (!bySource[src]) bySource[src] = { correct: 0, total: 0, accuracy: null };
    bySource[src].total += 1;
    if (r.correct) bySource[src].correct += 1;
  }
  for (const src of Object.keys(bySource)) {
    bySource[src].accuracy = Number((bySource[src].correct / bySource[src].total).toFixed(4));
  }

  const calibRecords = scored.map((r) => ({ id: r.id, probability: r.probability, actual: r.actual }));
  const rawBrier = brierScore(calibRecords);
  const platt = crossFitPlatt2Fold(calibRecords);
  const meanLatencyMs = totalCount > 0
    ? Math.round(scored.reduce((s, r) => s + (r.durationMs || 0), 0) / totalCount)
    : null;
  const totalCostUsd = Number(records.reduce((s, r) => s + (r.costUsd || 0), 0).toFixed(6));
  const totalCalls = records.reduce((s, r) => s + (r.calls || 0), 0);
  const failedCalls = records.filter((r) => !r.ok && r.state !== 'fail_budget').length;
  const budgetBlockedCount = records.filter((r) => r.state === 'fail_budget').length;

  return {
    armId,
    ...meta,
    evaluatedCount: totalCount,
    correctCount,
    accuracy,
    bySource,
    rawBrier: rawBrier !== null ? Number(rawBrier.toFixed(4)) : null,
    platt2Fold: {
      ok: platt.ok,
      count: platt.count,
      rawBrier: platt.rawBrier !== null ? Number(platt.rawBrier.toFixed(4)) : null,
      oofBrier: platt.oofBrier !== null ? Number(platt.oofBrier.toFixed(4)) : null,
      rawBss: platt.rawBss !== null ? Number(platt.rawBss.toFixed(4)) : null,
      bss: platt.bss !== null ? Number(platt.bss.toFixed(4)) : null,
      improvesOof: Boolean(platt.improvesOof),
      allConverged: Boolean(platt.allConverged),
      usable: Boolean(platt.usable),
    },
    meanLatencyMs,
    totalCalls,
    totalCostUsd,
    failedCalls,
    budgetBlockedCount,
    records,
  };
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  };
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length || 1) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function runScienceBench({
  items,
  arcCmd = DEFAULT_ARC_CMD,
  maxClaudeUsd = 30,
  maxGoogleUsd = 30,
  concurrency = 2,
  modelsFilter = null,
  includeHohPpc = true,
  callModelFn = runArcHeadless,
  timeoutMs = 120000,
} = {}) {
  const budgetGuard = new BudgetGuard({ maxClaudeUsd, maxGoogleUsd });
  const specs = modelsFilter && modelsFilter.length > 0
    ? SINGLE_SHOT_SPECS.filter((s) => modelsFilter.includes(s.armId) || modelsFilter.includes(normalizeModelKey(s.model)))
    : SINGLE_SHOT_SPECS;
  const runHoh = includeHohPpc && (!modelsFilter || modelsFilter.length === 0 || modelsFilter.includes(HOH_PPC_ARM_ID));

  const arms = {};
  for (const spec of specs) {
    console.log(`[science-bench] running ${spec.armId} (${items.length} items, concurrency=${concurrency})...`);
    const records = await mapWithConcurrency(items, concurrency, (item) => (
      runSingleShotItem({ item, spec, arcCmd, budgetGuard, callModelFn, timeoutMs })
    ));
    arms[spec.armId] = summarizeArm(spec.armId, {
      mode: 'single_shot',
      provider: spec.provider,
      model: spec.model,
      family: spec.family,
      reasoningEffort: spec.reasoningEffort,
    }, records);
    const a = arms[spec.armId];
    console.log(`[science-bench] done ${spec.armId}: acc=${a.correctCount}/${a.evaluatedCount} (${a.accuracy}), rawBrier=${a.rawBrier}, oofBrier=${a.platt2Fold.oofBrier}, bss=${a.platt2Fold.bss}, cost=$${a.totalCostUsd}`);
  }

  if (runHoh) {
    console.log(`[science-bench] running ${HOH_PPC_ARM_ID} (${items.length} items, concurrency=${concurrency})...`);
    const records = await mapWithConcurrency(items, concurrency, (item, idx) => (
      runHohPpcItem({ item, itemIndex: idx, arcCmd, budgetGuard, callModelFn, timeoutMs })
    ));
    arms[HOH_PPC_ARM_ID] = summarizeArm(HOH_PPC_ARM_ID, {
      mode: 'hoh_propose_probe_compose',
      proposeModel: 'claude-sonnet-5-5',
      probeModel: 'google/gemini-4-carbon',
      composeModel: 'claude-sonnet-5-5',
      family: 'cross_family(anthropic+google)',
      composeCallsCount: records.filter((r) => r.composeCalled).length,
      agreeBeforeComposeCount: records.filter((r) => r.agreedBeforeCompose).length,
    }, records);
    const h = arms[HOH_PPC_ARM_ID];
    console.log(`[science-bench] done ${HOH_PPC_ARM_ID}: acc=${h.correctCount}/${h.evaluatedCount} (${h.accuracy}), rawBrier=${h.rawBrier}, oofBrier=${h.platt2Fold.oofBrier}, bss=${h.platt2Fold.bss}, cost=$${h.totalCostUsd}`);
  }

  const budget = budgetGuard.summary();
  const ranking = Object.values(arms)
    .map((a) => ({
      armId: a.armId,
      mode: a.mode,
      accuracy: a.accuracy,
      correctCount: a.correctCount,
      evaluatedCount: a.evaluatedCount,
      rawBrier: a.rawBrier,
      oofBrier: a.platt2Fold.oofBrier,
      bss: a.platt2Fold.bss,
      totalCostUsd: a.totalCostUsd,
      meanLatencyMs: a.meanLatencyMs,
    }))
    .sort((x, y) => ((y.accuracy ?? -1) - (x.accuracy ?? -1)) || ((x.rawBrier ?? 9) - (y.rawBrier ?? 9)));

  return {
    schema: 'arc.public_science_bench_report/1',
    ranAt: new Date().toISOString(),
    arcCmd,
    itemCount: items.length,
    budget,
    withinCaps: budget.claudeSpentUsd <= maxClaudeUsd && budget.googleSpentUsd <= maxGoogleUsd,
    ranking,
    arms,
  };
}

export function runSelfTest() {
  // 1. Pricing checks across Anthropic and Vertex Gemini 4 models
  const fableCost = estimateCallCostUsd('claude-fable-5-2', { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 });
  assert.equal(fableCost.known, true);
  assert.ok(Math.abs(fableCost.costUsd - 0.028) < 1e-9, `expected $0.028, got ${fableCost.costUsd}`);
  const carbonCost = estimateCallCostUsd('google/gemini-4-carbon', { inputTokens: 2000, outputTokens: 1000 });
  assert.ok(Math.abs(carbonCost.costUsd - 0.0154) < 1e-9);
  assert.equal(estimateCallCostUsd('claude-haiku-5-5', null).known, false);

  // 2. BudgetGuard allow + negative control fail_budget
  const guard = new BudgetGuard({ maxClaudeUsd: 0.50, maxGoogleUsd: 0.25 });
  const r1 = guard.tryReserve('anthropic', 0.10);
  assert.equal(r1.ok, true);
  guard.settle(r1, 0.48);
  const blockedClaude = guard.tryReserve('anthropic', 0.05);
  assert.equal(blockedClaude.ok, false);
  assert.equal(blockedClaude.state, 'fail_budget');
  assert.equal(blockedClaude.family, 'anthropic');

  const g1 = guard.tryReserve('vertex', 0.20);
  assert.equal(g1.ok, true);
  const g2 = guard.tryReserve('google', 0.10);
  assert.equal(g2.ok, false);
  assert.equal(g2.state, 'fail_budget');
  guard.settle(g1, 0.18);
  assert.equal(guard.tryReserve('google', 0.05).ok, true);

  // 3. MCQ extraction checks
  assert.deepEqual(extractMcqAnswer('{"answer":"B","confidence":0.82,"rationale":"matches trend"}').answer, 'B');
  assert.equal(extractMcqAnswer('```json\n{"answer":"C) Naive B cells","confidence":1.4}\n```').confidence, 0.99);
  assert.equal(extractMcqAnswer('Final Answer: D').parseMode, 'regex_fallback');
  assert.equal(extractMcqAnswer('No letter selected here').ok, false);

  // 4. R006 guard against provider: 'merge' & cmd metacharacter rejection
  assert.equal(buildCmdFallbackArgs('C:\\bad&arc.cmd', []).ok, false);
  assert.equal(buildCmdFallbackArgs('C:\\Arc\\arc.cmd', ['--profile', 'headless']).ok, true);

  // 5. Calibration score check (24-item synthetic sample)
  const synth = Array.from({ length: 24 }, (_, i) => ({
    probability: i % 2 === 0 ? 0.85 : 0.35,
    actual: i % 2 === 0 ? 1 : 0,
  }));
  const platt = crossFitPlatt2Fold(synth);
  assert.equal(platt.ok, true);
  assert.ok(brierSkillScore(synth) > 0.3);

  console.log('science-bench self-test: PASS (pricing, BudgetGuard fail_budget control, MCQ parser, calibration verified)');
}

function parseCliArgs(argv) {
  const opts = {
    selfTest: false,
    itemsPath: null,
    outPath: null,
    maxClaudeUsd: 30,
    maxGoogleUsd: 30,
    concurrency: 2,
    limit: null,
    modelsFilter: null,
    timeoutMs: 120000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} requires a value`);
      i += 1;
      return argv[i];
    };
    if (a === '--self-test') opts.selfTest = true;
    else if (a === '--items') opts.itemsPath = next();
    else if (a === '--out') opts.outPath = next();
    else if (a === '--max-claude-usd') opts.maxClaudeUsd = Number(next());
    else if (a === '--max-google-usd') opts.maxGoogleUsd = Number(next());
    else if (a === '--concurrency') opts.concurrency = Math.max(1, parseInt(next(), 10));
    else if (a === '--limit') opts.limit = Math.max(1, parseInt(next(), 10));
    else if (a === '--timeout-ms') opts.timeoutMs = Math.max(1000, parseInt(next(), 10));
    else if (a === '--models') opts.modelsFilter = next().split(',').map((s) => s.trim()).filter(Boolean);
    else throw new Error(`Unknown flag: ${a}`);
  }
  return opts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.selfTest) {
    runSelfTest();
  } else {
    if (!opts.itemsPath) {
      console.error('Usage error: --items <path> or --self-test required');
      process.exit(2);
    }
    const raw = JSON.parse(fs.readFileSync(path.resolve(opts.itemsPath), 'utf8'));
    let items = Array.isArray(raw) ? raw : raw.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error(`No items found in ${opts.itemsPath}`);
    }
    if (opts.limit && opts.limit < items.length) {
      items = items.slice(0, opts.limit);
    }
    const report = await runScienceBench({
      items,
      maxClaudeUsd: opts.maxClaudeUsd,
      maxGoogleUsd: opts.maxGoogleUsd,
      concurrency: opts.concurrency,
      modelsFilter: opts.modelsFilter,
      timeoutMs: opts.timeoutMs,
    });
    const json = JSON.stringify(report, null, 2) + '\n';
    if (opts.outPath) {
      const resolvedOut = path.resolve(opts.outPath);
      fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
      fs.writeFileSync(resolvedOut, json, 'utf8');
      console.log(`[science-bench] wrote ${resolvedOut} (claude=$${report.budget.claudeSpentUsd}, google=$${report.budget.googleSpentUsd})`);
    } else {
      console.log(JSON.stringify({ budget: report.budget, withinCaps: report.withinCaps, ranking: report.ranking }, null, 2));
    }
    if (!report.withinCaps) process.exitCode = 3;
  }
}
