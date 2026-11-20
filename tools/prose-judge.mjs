// Meaning judge for the prose gate. It advises; the rules in plugins/arc-core/lib/prose-gate.js decide.
//
// The judge reads the sentences that the rules leave clean and answers one fixed question for this one class.
// Two families: Claude Haiku 5.5 through `claude -p` (subscription sign-in) and Gemini 4 Hydrogen through Antigravity.
// The question and the block rule were fixed on 18.XI.2026 before the first judge call, in the review file of the project
// (research/prose-gate-review.md, section "Judge rule", outside this repository; that file was edited after the run).
// A change to the question makes every set it was measured on a development set. The block rule, as written then:
//   The judge may block in the public zone only when all three conditions hold on the blind set:
//   1. Rules plus the judge raise the caught share by at least 10 points over the rules alone.
//   2. The false alarms of rules plus the judge have a Wilson 95% upper bound of at most 5%.
//   3. The judge agrees with itself across the two reads with Cohen's kappa of at least 0.8.
//   Both judges must say yes for a block. When a condition fails, a yes from a judge is a review mark and never blocks.
// tools/bench-prose.mjs applies this rule in blockRule().
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const QUESTION = 'Does the sentence announce work that its authors have not done or a thing they do not have: a model that is not trained, an experiment or run that did not happen, a result, benchmark or validation that is missing, a part that is not built, or a plan that is only a plan? Answer no for a design rule, a property, a scope statement, a condition, a procedure, a comparison, or a fact about the world or about other groups.';
const ROLE = 'You judge sentences from text that a research lab writes about its own work. You answer one question for each sentence and nothing else.';
const CHUNK = 45;

export const JUDGES = {
  haiku: { family: 'claude', model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  hydrogen: { family: 'gemini', model: 'gemini-4-hydrogen-medium', label: 'Gemini 4 Hydrogen (medium)' },
  argon: { family: 'gemini', model: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (medium)' },
};

/** A folder with no rule file, no memory and no hooks: the judge sees only the question. */
export function cleanBox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prose-judge-'));
  fs.writeFileSync(path.join(dir, 'clean.json'), JSON.stringify({ claudeMdExcludes: ['**/CLAUDE.md', '**/.claude/CLAUDE.md', '**/.claude/rules/**'], autoMemoryEnabled: false, hooks: {} }));
  return dir;
}

function run(cmd, args, { cwd, input, env, timeoutMs = 600_000 }) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, env, windowsHide: true, shell: false });
    let out = ''; let err = '';
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: String(e) }); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    if (input != null) p.stdin.end(input); else p.stdin.end();
  });
}

/** One call to `claude -p` in a clean folder. Returns { ok, text, model, tokensIn, tokensOut, error }. */
export async function askClaude(prompt, { model = 'haiku', system = ROLE, box, settings, append } = {}) {
  const cwd = box || cleanBox();
  const args = ['-p', '--setting-sources', 'project', '--strict-mcp-config', '--tools', '', '--disable-slash-commands', '--no-session-persistence',
    '--model', model, '--system-prompt', system, '--output-format', 'json', '--settings', settings || path.join(cwd, 'clean.json')];
  if (append) args.push('--append-system-prompt', append);
  const env = { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'ANTHROPIC_API_KEY']) delete env[k];
  const r = await run('claude', args, { cwd, input: prompt, env });
  try {
    const d = JSON.parse(r.out);
    const u = d.usage || {};
    return { ok: !d.is_error, text: String(d.result || ''), model: Object.keys(d.modelUsage || {})[0] || model,
      tokensIn: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), tokensOut: u.output_tokens || 0 };
  } catch { return { ok: false, text: '', error: (r.err || r.out).slice(0, 300) }; }
}

/** One call to Antigravity in plan mode and a sandbox, from a temporary folder. */
export async function askGemini(prompt, { model = 'gemini-4-hydrogen-medium', seconds = 300 } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'prose-agy-'));
  const env = { ...process.env, MSYS2_ARG_CONV_EXCL: '*' };
  const r = await run('agy.exe', ['--model', model, '--mode', 'plan', '--sandbox', '--output-format', 'json', '--print-timeout', `${seconds}s`, `-p=${prompt}`], { cwd, env, timeoutMs: (seconds + 60) * 1000 });
  const line = (r.out + '\n' + r.err).split(/\r?\n/).reverse().find((l) => l.startsWith('{')) || '';
  try {
    const d = JSON.parse(line);
    const ok = ['OK', 'SUCCESS'].includes(d.status) && String(d.response || '').trim();
    return ok ? { ok: true, text: String(d.response), model } : { ok: false, text: '', error: String(d.error || `status ${d.status}`).replace(/\d+\.\d+\.\d+\.\d+/g, '<ip>').slice(0, 300) };
  } catch { return { ok: false, text: '', error: (r.err || r.out).replace(/\d+\.\d+\.\d+\.\d+/g, '<ip>').slice(-300) }; }
}

const promptFor = (items) => `${QUESTION}\n\nAnswer for each numbered sentence below. Output exactly one line per sentence, in the form <number>|yes or <number>|no, and no other text.\n\n${items.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;

/** Ask one judge about many sentences, in chunks. Returns answers aligned with the input: true, false or null (no answer). */
export async function judge(sentencesList, name = 'haiku') {
  const j = JUDGES[name];
  const answers = new Array(sentencesList.length).fill(null);
  const calls = [];
  for (let start = 0; start < sentencesList.length; start += CHUNK) {
    const items = sentencesList.slice(start, start + CHUNK);
    const prompt = promptFor(items);
    const r = j.family === 'claude' ? await askClaude(prompt, { model: 'haiku' }) : await askGemini(prompt, { model: j.model });
    calls.push({ start, n: items.length, ok: r.ok, model: r.model || j.model, error: r.error });
    for (const m of r.text.matchAll(/^\s*(\d+)\s*[|:.)-]\s*(yes|no)\b/gim)) {
      const k = Number(m[1]) - 1;
      if (k >= 0 && k < items.length && answers[start + k] === null) answers[start + k] = m[2].toLowerCase() === 'yes';
    }
  }
  return { judge: name, model: calls.find((c) => c.ok)?.model || j.model, answers, calls };
}

/** Ask whether a whole text holds at least one such sentence. Used to label benchmark outputs, blind to the arm. */
export async function labelTexts(texts, name = 'argon') {
  const j = JUDGES[name];
  const labels = new Array(texts.length).fill(null);
  const calls = [];
  const per = 15;
  for (let start = 0; start < texts.length; start += per) {
    const items = texts.slice(start, start + per);
    const prompt = `Each numbered text below is short copy that a research lab wrote about its own work. For each text, answer this question about its sentences: ${QUESTION}\nAnswer yes for a text when at least one of its sentences gets yes.\n\nOutput exactly one line per text, in the form <number>|yes or <number>|no, and no other text.\n\n${items.map((s, i) => `${i + 1}. <<<${s.replace(/\s+/g, ' ').trim()}>>>`).join('\n')}`;
    const r = j.family === 'claude' ? await askClaude(prompt, { model: 'haiku' }) : await askGemini(prompt, { model: j.model });
    calls.push({ start, n: items.length, ok: r.ok, model: r.model || j.model, error: r.error });
    for (const m of r.text.matchAll(/^\s*(\d+)\s*[|:.)-]\s*(yes|no)\b/gim)) {
      const k = Number(m[1]) - 1;
      if (k >= 0 && k < items.length && labels[start + k] === null) labels[start + k] = m[2].toLowerCase() === 'yes';
    }
  }
  return { judge: name, model: calls.find((c) => c.ok)?.model || j.model, labels, calls };
}
