// Prose gate from the command line, for every agent and for scripts.
//
//   node tools/prose-gate.mjs check FILE... [--zone public|report|limits] [--facts FILE] [--json]
//   node tools/prose-gate.mjs screen DIR... [--json]        text that speaks for the author: README, pages, site facts
//   node tools/prose-gate.mjs repair FILE                   print the text with the undercuts that a rule can repair
//   node tools/prose-gate.mjs verify ORIGINAL REWRITE [--facts FILE]
//   node tools/prose-gate.mjs judge FILE... [--judge haiku|hydrogen]   rules, then a meaning judge on the sentences they leave clean
//   node tools/prose-gate.mjs --self-test                   the labelled cases, by split
//
// Exit code 1 when a check finds an error. The rules live in plugins/arc-core/lib/prose-gate.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, checkJson, repair, verifyRewrite } from '../plugins/arc-core/lib/prose-gate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASES = path.join(ROOT, 'plugins', 'arc-core', 'test', 'prose-gate.cases.txt');
export const HELDOUT = path.join(ROOT, 'plugins', 'arc-core', 'test', 'prose-gate.heldout.txt');
export const BLIND3 = path.join(ROOT, 'plugins', 'arc-core', 'test', 'prose-gate.blind3.txt');
export const RU_CASES = path.join(ROOT, 'plugins', 'arc-core', 'test', 'prose-gate.ru.cases.txt');
export const RU_BLIND = path.join(ROOT, 'plugins', 'arc-core', 'test', 'prose-gate.ru.blind.txt');
export const F102_BLIND = path.join(ROOT, 'plugins', 'arc-core', 'test', 'prose-gate.f102.blind.txt');
// the second blind sets, by Gemini 4 Argon (18.XI.2026): the same prompts, another writer
export const BLIND4 = path.join(ROOT, 'plugins', 'arc-core', 'test', 'prose-gate.blind4.txt');
export const F102_BLIND2 = path.join(ROOT, 'plugins', 'arc-core', 'test', 'prose-gate.f102.blind2.txt');
export const RU_BLIND2 = path.join(ROOT, 'plugins', 'arc-core', 'test', 'prose-gate.ru.blind2.txt');
const read = (f) => fs.readFileSync(f, 'utf8');

export function loadCases(file = CASES) {
  return read(file).split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => {
    const [split, zone, expect, ...rest] = l.split('|');
    return { split, zone, expect, text: rest.join('|') };
  });
}

export function scoreCases(cases) {
  const by = {};
  for (const c of cases) {
    const found = check(c.text, { zone: c.zone }).findings;
    const got = found.some((f) => f.rule === 'SELF_UNDERCUT') ? 'undercut' : found.some((f) => f.rule === 'UNSURE_ABSENCE') ? 'review' : 'clean';
    // tp: an undercut that blocks; mu: an undercut in the mark band (visible to a reader, not blocked); fn: an undercut left clean; mc: a clean case in the mark band
    const s = (by[c.split] ||= { n: 0, tp: 0, mu: 0, fp: 0, fn: 0, tn: 0, mc: 0, review: 0, wrong: [] });
    s.n += 1;
    if (got === 'review') s.review += 1;
    if (c.expect === 'review') { if (got !== 'review') s.wrong.push(`expected a review mark, got ${got}: ${c.text}`); continue; }
    if (c.expect === 'undercut' && got === 'undercut') s.tp += 1;
    else if (c.expect === 'undercut' && got === 'review') s.mu += 1;
    else if (c.expect === 'clean' && got !== 'undercut') { s.tn += 1; if (got === 'review') s.mc += 1; }
    else if (c.expect === 'clean') { s.fp += 1; s.wrong.push(`false alarm: ${c.text}`); } else { s.fn += 1; s.wrong.push(`missed: ${c.text}`); }
  }
  return by;
}

function fileCheck(file, { zone, facts }) {
  const raw = read(file);
  if (file.endsWith('.json')) {
    try { return checkJson(JSON.parse(raw), { zone, facts }); } catch { /* not JSON after all: check it as text */ }
  }
  const text = /\.html?$/i.test(file)
    ? raw.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (m) => '\n'.repeat((m.match(/\n/g) || []).length)).replace(/<[^>]+>/g, ' ')
    : raw;
  return check(text, { zone, facts });
}

// Text that speaks for the author. A build folder, a dependency folder and a file over 2 MB are skipped.
const VOICE = /(^|[\\/])(readme[^\\/]*\.md|index\.html?|site\.json|content\.json|abstract[^\\/]*\.(md|tex|txt)|pitch[^\\/]*\.md|about[^\\/]*\.(md|html))$/i;
const SKIP_DIR = /^(node_modules|\.git|dist|build|target|out|scratch|_scratch|pristine|__pycache__|\.venv|venv|site-packages|\.next|vendor|third_party)$/i;
function* voiceFiles(dir, depth = 0) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 5 && !SKIP_DIR.test(e.name) && !e.name.startsWith('.')) yield* voiceFiles(p, depth + 1); } else if (VOICE.test(p)) {
      try { if (fs.statSync(p).size <= 2_000_000) yield p; } catch { /* unreadable: skip */ }
    }
  }
}

async function main(argv) {
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const json = argv.includes('--json');
  const zone = flag('--zone') || 'public';
  const facts = flag('--facts') ? read(flag('--facts')) : '';
  const rest = argv.filter((a, i) => !a.startsWith('--') && !['--zone', '--facts', '--judge'].includes(argv[i - 1]));
  if (argv.includes('--self-test')) {
    const by = { ...scoreCases(loadCases()), ...scoreCases(loadCases(RU_CASES)) };
    let bad = 0;
    // Two bands: "blocked" counts the block band; "marked" counts the sentences a reader sees; "left clean" counts silent misses.
    const line = (name, s, note = '') => `${name}: ${s.n} cases; undercuts ${s.tp + s.mu + s.fn}: blocked ${s.tp}, marked ${s.mu}, left clean ${s.fn}; clean ${s.fp + s.tn}: blocked ${s.fp}, marked ${s.mc}${note}`;
    for (const [split, s] of Object.entries(by)) {
      console.log(line(split, s));
      for (const w of s.wrong) console.log(`  ${w}`);
      bad += s.wrong.length;
    }
    // The held-out and blind files report and never fail the run: the rules were not fitted to them.
    for (const [file, split] of [[HELDOUT, 'heldout'], [BLIND3, 'blind3'], [RU_BLIND, 'ru-blind'], [F102_BLIND, 'f102-blind'], [BLIND4, 'blind4'], [F102_BLIND2, 'f102-blind2'], [RU_BLIND2, 'ru-blind2']]) {
      console.log(line(split, scoreCases(loadCases(file))[split], ' (reported, not fitted)'));
    }
    const all = [...loadCases(), ...loadCases(HELDOUT)];
    const words = all.reduce((n, c) => n + c.text.split(/\s+/).length, 0);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 50; i += 1) for (const c of all) check(c.text, { zone: c.zone });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 50;
    console.log(`speed: ${all.length} texts, ${words} words in ${ms.toFixed(2)} ms (${(ms * 1000 / words).toFixed(2)} ms for 1,000 words)`);
    return bad ? 1 : 0;
  }
  const cmd = rest[0];
  if (cmd === 'check') {
    let errors = 0;
    const all = [];
    for (const f of rest.slice(1)) {
      const r = fileCheck(f, { zone, facts });
      for (const x of r.findings) { all.push({ file: f, ...x }); if (x.severity === 'error') errors += 1; }
      if (!json) for (const x of r.findings) console.log(`${f}:${x.line}${x.path ? ` ${x.path}` : ''}: ${x.severity} ${x.rule}: "${x.span}"\n    saw:     ${x.sentence}\n    allowed: ${x.allowed}`);
    }
    if (json) console.log(JSON.stringify({ ok: errors === 0, errors, findings: all }, null, 1));
    return errors ? 1 : 0;
  }
  if (cmd === 'screen') {
    const rows = [];
    for (const d of rest.slice(1)) for (const f of voiceFiles(d)) {
      let r;
      try { r = fileCheck(f, { zone: 'public', facts: '' }); } catch { continue; }
      const hits = r.findings.filter((x) => x.rule === 'SELF_UNDERCUT');
      rows.push({ root: d, file: f, words: r.words, hits: hits.length, findings: hits.map((x) => ({ line: x.line, path: x.path, span: x.span, sentence: x.sentence.slice(0, 200) })) });
    }
    if (json) console.log(JSON.stringify(rows, null, 1));
    else for (const r of rows.filter((x) => x.hits)) { console.log(`${r.file}: ${r.hits}`); for (const x of r.findings) console.log(`  ${x.line}${x.path ? ` ${x.path}` : ''}: ${x.sentence}`); }
    return 0;
  }
  if (cmd === 'judge') {
    // The meaning layer: one judge reads the public sentences that the rules leave clean. Its yes is a review mark for a
    // reader; the rules alone set the exit code (research/prose-gate-review.md, "Judge rule": the measured numbers decide).
    const { judge } = await import('./prose-judge.mjs');
    const { sentences } = await import('../plugins/arc-core/lib/prose-gate.js');
    const name = flag('--judge') || 'haiku';
    let errors = 0;
    const out = [];
    for (const f of rest.slice(1)) {
      const r = fileCheck(f, { zone, facts });
      errors += r.findings.filter((x) => x.severity === 'error').length;
      const open = sentences(read(f), { zone }).filter((s) => s.zone === 'public' && !s.undercut);
      const j = await judge(open.map((s) => s.sentence), name);
      open.forEach((s, i) => { if (j.answers[i] === true) out.push({ file: f, line: s.line, rule: 'JUDGE_REVIEW', severity: 'review', judge: j.model, sentence: s.sentence }); });
      out.push(...r.findings.map((x) => ({ file: f, ...x })));
    }
    if (json) console.log(JSON.stringify({ ok: errors === 0, errors, findings: out }, null, 1));
    else for (const x of out) console.log(`${x.file}:${x.line}: ${x.severity} ${x.rule}: ${x.sentence}`);
    return errors ? 1 : 0;
  }
  if (cmd === 'repair') {
    // the repaired text goes to stdout; every removed or shortened sentence is named on stderr, so no words go without notice
    const r = repair(read(rest[1]));
    process.stdout.write(r.text);
    for (const x of r.removed) process.stderr.write(`removed line ${x.line}: ${x.sentence}\n`);
    for (const x of r.cut) process.stderr.write(`shortened line ${x.line}: ${x.sentence} -> ${x.now}\n`);
    return 0;
  }
  if (cmd === 'verify') {
    const r = verifyRewrite(read(rest[1]), read(rest[2]), { facts, zone });
    console.log(JSON.stringify(r, null, 1));
    return r.ok ? 0 : 1;
  }
  console.error('usage: prose-gate.mjs check|screen|repair|verify ... | --self-test');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
