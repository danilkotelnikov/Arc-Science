// Benchmark of the prose gate. Every run writes its raw outputs to tools/bench-prose.data.json; `report` recomputes
// every table from that file with the current rules and no model call.
//
//   node tools/bench-prose.mjs report                      the tables from the saved data (default; no model call)
//   node tools/bench-prose.mjs tasks SITE_JSON             freeze the writing tasks from the lab site facts
//   node tools/bench-prose.mjs arms [--rules FILE] [--reps 3] [--tasks a,b]   four arms with Claude Sonnet 5.5 (`claude -p`)
//   node tools/bench-prose.mjs repair                      one repair round for every refused output
//   node tools/bench-prose.mjs label                       Gemini 4 Argon labels every output, blind to the arm
//   node tools/bench-prose.mjs blind [--runs 2]            both judges on the blind set and the held-out file
//   node tools/bench-prose.mjs fill                        ask again for the sentences a failed judge call left open
//   node tools/bench-prose.mjs --self-test                 the statistics on known values
//
// Arms. A: no rules. B: the 128-item global rule file, as CLAUDE.md of the temporary folder. C: B and one rule line at
// the end of the system prompt. D: the rule line inside the rule file, in the writing section. B, C and D load the same
// snapshot through the same channel, and the input-token count shows that it loaded.
// Every model call runs in a temporary folder with no hooks, no memory and no tools. The subscription sign-in is used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { check, verifyRewrite } from '../plugins/arc-core/lib/prose-gate.js';
import { loadCases, HELDOUT } from './prose-gate.mjs';
import { askClaude, judge, labelTexts, JUDGES, QUESTION } from './prose-judge.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'tools', 'bench-prose.data.json');
const BLIND = path.join(ROOT, 'plugins', 'arc-core', 'test', 'prose-gate.blind3.txt');
const ROLE = 'You write short texts for the web page of a research lab.';
export const RULE_LINE = 'In text that speaks for the lab (a page, a README, a slide), state what exists and what comes next. Do not announce what has not been done. A limit stands in the limits section, beside the claim that it limits.';
const ANCHOR = '- Never write a bare verdict or a tacked-on negative';

// ---- statistics
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n; const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d; const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
export function kappa(a, b) {
  const pairs = a.map((x, i) => [x, b[i]]).filter(([x, y]) => x !== null && y !== null && x !== undefined && y !== undefined);
  const n = pairs.length; if (!n) return { kappa: null, n: 0 };
  const po = pairs.filter(([x, y]) => x === y).length / n;
  const pa = pairs.filter(([x]) => x).length / n; const pb = pairs.filter(([, y]) => y).length / n;
  const pe = pa * pb + (1 - pa) * (1 - pb);
  return { kappa: pe === 1 ? 1 : (po - pe) / (1 - pe), agree: po, n };
}
const lnFact = (n) => { let s = 0; for (let i = 2; i <= n; i += 1) s += Math.log(i); return s; };
/** Two-sided Fisher exact test of a 2x2 table [[a, b], [c, d]]. */
export function fisher(a, b, c, d) {
  const n = a + b + c + d; const r1 = a + b; const c1 = a + c;
  const p = (x) => Math.exp(lnFact(r1) + lnFact(n - r1) + lnFact(c1) + lnFact(n - c1) - lnFact(n) - lnFact(x) - lnFact(r1 - x) - lnFact(c1 - x) - lnFact(n - r1 - c1 + x));
  const p0 = p(a); let s = 0;
  for (let x = Math.max(0, r1 + c1 - n); x <= Math.min(r1, c1); x += 1) { const px = p(x); if (px <= p0 * (1 + 1e-9)) s += px; }
  return Math.min(1, s);
}
const pct = (k, n) => `${k} of ${n} (${n ? (k / n).toFixed(2) : '-'}, ${wilson(k, n).map((x) => x.toFixed(2)).join(' to ')})`;

// ---- data
const load = () => (fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA, 'utf8')) : {});
const save = (d) => fs.writeFileSync(DATA, `${JSON.stringify(d, null, 1)}\n`);
// Two commands may run at once (the judges and the arms): each one merges only its own fields into the file as it is now.
const merge = (patch) => { const d = { ...load(), ...patch }; save(d); return d; };
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const cleanOut = (s) => s.replace(/^\s*(STATUS|LEAD)\s*:\s*/gim, '').replace(/\*\*/g, '').trim();
const keyOf = (r) => `${r.arm}:${r.task}:${r.rep}`;

/** Writing tasks from the site facts: seven project cards and two home lines. Facts include the limits. */
function makeTasks(site) {
  const list = [];
  for (const id of site.order) {
    const p = site.projects[id];
    const status = (p.science || []).find((x) => x[0] === 'Status');
    const facts = [`Name: ${id}`, `What it is: ${p.row}`, status ? `State of the work: ${status[1]}` : `State of the work: ${p.status}`, `Limits: ${(p.limits || []).slice(0, 3).join(' ')}`].join('\n');
    list.push({ id, limits: (p.limits || []).join(' '), prompt: `${facts}\n\nWrite two things for this project's card on the lab's home page.\nSTATUS: one status line of at most 12 words.\nLEAD: a lead of two sentences.\nAnswer with exactly these two labelled lines and nothing else.` });
  }
  // The first home task hands over the tail: it lists "a list of limits" as a part of each page, and every output named
  // the limits in its last words (12 of 12 on 18.XI.2026). Whether that counts as the habit is the owner's call, so it stands
  // apart from the main table. home2 asks for the same line without handing over the parts.
  list.push({ id: 'home', handsTail: true, limits: '', prompt: 'The lab runs four research programmes. Each programme has its own page with these parts: Problem, Approach, Status, Why compute, and a list of limits.\n\nWrite the line that introduces the programmes on the home page: one or two sentences.\nAnswer with one line that starts with LEAD: and nothing else.' });
  list.push({ id: 'home2', limits: '', prompt: 'The lab runs four research programmes: generative design of antibody binders, free energy of point mutations in protein-ligand binding, co-folding of viral RNA inside capsids, and machine learning for rare-earth solvent extractants. Each programme has its own page.\n\nWrite the line that introduces the programmes on the home page: one or two sentences.\nAnswer with one line that starts with LEAD: and nothing else.' });
  return list;
}

/** One temporary folder per arm. A excludes every rule file; B, C and D carry the snapshot as the folder's CLAUDE.md. */
function armBoxes(rules) {
  const at = rules.indexOf(ANCHOR);
  if (at < 0) throw new Error(`the rule file has no line that starts with "${ANCHOR}"`);
  const nl = rules.indexOf('\n', at);
  const end = nl < 0 ? rules.length : nl + 1;
  const withLine = `${rules.slice(0, end)}${nl < 0 ? '\n' : ''}- ${RULE_LINE}\n${rules.slice(end)}`;
  const box = (name, claudeMd, excludes) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bench-prose-${name}-`));
    if (claudeMd) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claudeMd);
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ claudeMdExcludes: excludes, autoMemoryEnabled: false, hooks: {} }));
    return dir;
  };
  const home = ['**/.claude/CLAUDE.md', '**/.claude/rules/**'];
  return {
    A: { dir: box('A', '', ['**/CLAUDE.md', ...home]) },
    B: { dir: box('B', rules, home) },
    C: { dir: box('C', rules, home), append: RULE_LINE },
    D: { dir: box('D', withLine, home) },
  };
}

async function pool(jobs, width = 2) {
  const results = new Array(jobs.length); let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < jobs.length) { const i = next; next += 1; results[i] = await jobs[i](); process.stderr.write('.'); }
  }));
  process.stderr.write('\n');
  return results;
}

const call = (box, prompt, model = 'sonnet') => askClaude(prompt, { model, system: ROLE, box: box.dir, settings: path.join(box.dir, 'settings.json'), append: box.append });

// ---- tables
function gateRow(text, limits) {
  const g = check(text, { facts: limits });
  return { undercut: g.findings.filter((f) => f.rule === 'SELF_UNDERCUT').length, overclaim: g.findings.filter((f) => f.rule === 'OVERCLAIM').length, points: g.points, words: g.words, findings: g.findings };
}

function blindTable(name, cases, runs) {
  const labels = cases.map((c) => c.expect === 'undercut');
  const rules = cases.map((c) => check(c.text, { zone: c.zone }).findings.some((f) => f.rule === 'SELF_UNDERCUT'));
  const pos = labels.filter(Boolean).length; const neg = labels.length - pos;
  const score = (pred) => ({ tp: pred.filter((p, i) => p && labels[i]).length, fp: pred.filter((p, i) => p && !labels[i]).length });
  const lines = [`${name}: ${cases.length} sentences, ${pos} undercut and ${neg} clean by the writer's labels`];
  const row = (title, pred) => { const s = score(pred); lines.push(`  ${title.padEnd(34)} caught ${pct(s.tp, pos)}   false alarms ${pct(s.fp, neg)}`); return s; };
  const out = { rules: row('rules alone', rules) };
  const first = {};
  for (const j of Object.keys(JUDGES)) {
    const rs = (runs || []).filter((r) => r.judge === j && r.set === name);
    if (!rs.length) continue;
    const a = rs[0].answers;
    first[j] = a;
    const missing = a.filter((x) => x === null).length;
    out.missing = (out.missing || 0) + missing;
    out[j] = row(`rules + ${JUDGES[j].label}`, rules.map((r, i) => r || a[i] === true));
    row(`${JUDGES[j].label} alone`, a.map((x) => x === true));
    const agree = kappa(a, labels);
    const self = rs.length > 1 ? kappa(rs[0].answers, rs[1].answers) : { kappa: null, n: 0 };
    out[j].kappaLabels = agree.kappa; out[j].selfKappa = self.kappa;
    lines.push(`  ${''.padEnd(34)} agreement with labels ${(agree.agree ?? 0).toFixed(2)}, kappa ${agree.kappa?.toFixed(2)}; with itself over ${rs.length} reads kappa ${self.kappa === null ? '-' : self.kappa.toFixed(2)}; no answer ${missing}`);
  }
  const js = Object.keys(first);
  if (js.length >= 2) {
    out.both = row(`rules + both judges agree`, rules.map((r, i) => r || js.every((j) => first[j][i] === true)));
    const k = kappa(first[js[0]], first[js[1]]);
    lines.push(`  ${''.padEnd(34)} judges agree with each other: kappa ${k.kappa?.toFixed(2)} over ${k.n}`);
  }
  // An undercut with no negation word ("Training is scheduled for the spring") is also the gate's allowed form, "what comes
  // next"; the writer of the set was told to label it an undercut. Each kind is shown apart so the conflict stays visible.
  const NEG = /\b(?:not|no|never|nothing|none|without|only|cannot|neither|nor|yet|still|lack\w*|absen\w*|missing|pending|un\w+(?:ed|en))\b|n't/i;
  for (const [title, keep] of [['undercut with a negation word', (c) => NEG.test(c.text)], ['undercut with no negation word', (c) => !NEG.test(c.text)]]) {
    const idx = cases.map((c, i) => (labels[i] && keep(c) ? i : -1)).filter((i) => i >= 0);
    const caught = (pred) => idx.filter((i) => pred(i)).length;
    const parts = [`rules ${caught((i) => rules[i])}`];
    for (const j of js) parts.push(`rules + ${j} ${caught((i) => rules[i] || first[j][i] === true)}`);
    lines.push(`  ${title}: ${idx.length} sentences; caught by ${parts.join(', ')}`);
  }
  return { lines, out, pos, neg };
}

/** The rule fixed before the measurement (research/prose-gate-review.md): may a judge block in the public zone? */
function blockRule(t) {
  if (!t.out.both) return 'not measured';
  const gain = (t.out.both.tp - t.out.rules.tp) / t.pos;
  const upper = wilson(t.out.both.fp, t.neg)[1];
  const selfOk = Object.keys(JUDGES).filter((j) => t.out[j]).every((j) => (t.out[j].selfKappa ?? 0) >= 0.8);
  // A missing answer may hide a false alarm, so the bound is not trusted while any answer in the set is missing.
  const complete = !t.out.missing;
  const ok = gain >= 0.10 && upper <= 0.05 && selfOk && complete;
  return `${ok ? 'may block' : 'review mark only'} (no missing judge answer: ${complete}; gain ${(gain * 100).toFixed(1)} points >= 10: ${gain >= 0.1}; false-alarm upper bound ${(upper * 100).toFixed(1)}% <= 5%: ${upper <= 0.05}; self-agreement kappa >= 0.8 for each judge: ${selfOk})`;
}

// The judge answers are joined to the cases by position, so each run keeps the hash of its case file (review F101).
const BLIND_SETS = () => ({ blind3: loadCases(BLIND), heldout: loadCases(HELDOUT) });
const casesSha = (cases) => sha(cases.map((c) => `${c.split}|${c.zone}|${c.expect}|${c.text}`).join('\n'));
function staleSets(d) {
  if (!d.blind) return [];
  const now = Object.fromEntries(Object.entries(BLIND_SETS()).map(([k, v]) => [k, casesSha(v)]));
  return Object.keys(now).filter((k) => (d.blind.caseSha || {})[k] !== now[k]);
}

function report(d) {
  const out = [];
  for (const s of staleSets(d)) out.push(`STALE: the saved judge answers for ${s} belong to another version of its case file; run the blind command again.`);
  if (d.blind) {
    for (const [name, cases] of [['blind3', loadCases(BLIND)], ['heldout', loadCases(HELDOUT)]]) {
      const t = blindTable(name, cases, d.blind.runs);
      out.push(...t.lines);
      if (name === 'blind3') out.push(`  judge in the public zone: ${blockRule(t)}`);
    }
    out.push('');
  }
  if (d.arms?.length) {
    const T = Object.fromEntries(d.tasks.map((t) => [t.id, t]));
    const all = d.arms.filter((r) => r.ok && T[r.task]).map((r) => ({ ...r, ...gateRow(r.text, T[r.task].limits), label: d.labels?.byKey?.[keyOf(r)] ?? null }));
    const rows = all.filter((r) => !T[r.task].handsTail);
    const main = d.tasks.filter((t) => !t.handsTail && all.some((r) => r.task === t.id));
    out.push(`Arms: ${main.length} tasks x ${d.reps} repeats (${main.map((t) => t.id).join(', ')}), builder ${[...new Set(rows.map((r) => r.model))].join(', ')}; rule file sha ${d.rulesSha}`);
    out.push(`  ${'arm'.padEnd(5)}${'n'.padStart(4)}  ${'undercut by the check (lower bound)'.padEnd(40)}${'undercut by the Gemini label'.padEnd(40)}input tokens`);
    const by = {};
    for (const arm of ['A', 'B', 'C', 'D']) {
      const a = rows.filter((r) => r.arm === arm);
      if (!a.length) continue;
      const k = a.filter((r) => r.undercut).length; const lab = a.filter((r) => r.label !== null); const kl = lab.filter((r) => r.label).length;
      by[arm] = { n: a.length, k, kl, nl: lab.length };
      out.push(`  ${arm.padEnd(5)}${String(a.length).padStart(4)}  ${pct(k, a.length).padEnd(40)}${(lab.length ? pct(kl, lab.length) : '-').padEnd(40)}${Math.round(a.reduce((n, r) => n + (r.tokensIn || 0), 0) / a.length)}`);
    }
    for (const [x, y] of [['A', 'B'], ['B', 'C'], ['B', 'D'], ['C', 'D']]) {
      if (by[x] && by[y]) out.push(`  ${x} vs ${y}: Fisher exact p = ${fisher(by[x].k, by[x].n - by[x].k, by[y].k, by[y].n - by[y].k).toPrecision(2)} by the check; ${by[x].nl && by[y].nl ? fisher(by[x].kl, by[x].nl - by[x].kl, by[y].kl, by[y].nl - by[y].kl).toPrecision(2) : '-'} by the label`);
    }
    const both = rows.filter((r) => r.label !== null);
    if (both.length) {
      const kk = kappa(both.map((r) => r.undercut > 0), both.map((r) => r.label));
      out.push(`  check against label: agree ${kk.agree.toFixed(2)}, kappa ${kk.kappa?.toFixed(2)}; label yes and check clean ${both.filter((r) => r.label && !r.undercut).length}; check hit and label no ${both.filter((r) => !r.label && r.undercut).length}`);
      // The label question counts "a plan that is only a plan"; the gate's allowed sentence says "state what comes next".
      const NEXT = /\b(?:next|to follow|follows?|will|planned|scheduled|upcoming)\b/i;
      const split = both.filter((r) => r.label && !r.undercut);
      out.push(`  of those ${split.length}: ${split.filter((r) => NEXT.test(r.text)).length} state a next step, the form the gate allows; ${split.filter((r) => !NEXT.test(r.text)).length} do not`);
      for (const arm of ['A', 'B', 'C', 'D']) {
        const a = both.filter((r) => r.arm === arm);
        if (a.length) out.push(`    ${arm}: label yes, when a check-clean next step counts as allowed: ${a.filter((r) => r.label && !(NEXT.test(r.text) && !r.undercut)).length} of ${a.length}`);
      }
    }
    out.push('  per task, outputs with an undercut by the check (of 3 repeats):');
    for (const t of main) out.push(`    ${t.id.padEnd(14)}${['A', 'B', 'C', 'D'].map((arm) => `${arm} ${rows.filter((r) => r.arm === arm && r.task === t.id && r.undercut).length}`).join('  ')}`);
    for (const t of d.tasks.filter((x) => x.handsTail)) {
      const h = all.filter((r) => r.task === t.id);
      if (!h.length) continue;
      const names = (r) => /\blimit(?:s|ations?)?\b/i.test(r.text);
      out.push(`  task ${t.id} (its prompt lists "a list of limits"; outside the main table): by the check ${['A', 'B', 'C', 'D'].map((arm) => `${arm} ${h.filter((r) => r.arm === arm && r.undercut).length}`).join(', ')}; texts that name the limits ${['A', 'B', 'C', 'D'].map((arm) => `${arm} ${h.filter((r) => r.arm === arm && names(r)).length}/${h.filter((r) => r.arm === arm).length}`).join(', ')}`);
    }
    out.push(`  OVERCLAIM marks (review, from the facts): ${rows.filter((r) => r.overclaim).length} of ${rows.length} outputs`);
    if (d.repairs?.length) {
      out.push('Repair round (one call with place, sentence and allowed sentence; verifyRewrite decides):');
      for (const arm of ['A', 'B', 'C', 'D']) {
        const a = d.repairs.filter((r) => r.arm === arm && r.ok !== false);
        if (!a.length) continue;
        const v = a.map((r) => verifyRewrite(r.before, r.after, { facts: T[r.task].limits }));
        const lost = a.filter((r) => !check(r.after, { facts: T[r.task].limits }).findings.some((f) => f.rule === 'SELF_UNDERCUT')).length;
        out.push(`  ${arm}: refused ${a.length}; undercut gone ${lost}; accepted by the verifier ${v.filter((x) => x.ok).length}`);
      }
    }
    const words = rows.reduce((n, r) => n + r.words, 0);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 20; i += 1) for (const r of rows) check(r.text, { facts: T[r.task].limits });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
    out.push(`Speed: ${rows.length} outputs, ${words} words in ${ms.toFixed(2)} ms (${((ms * 1000) / words).toFixed(2)} ms for 1,000 words)`);
  }
  return out.join('\n');
}

// ---- commands
async function main(argv) {
  const cmd = argv.find((a) => !a.startsWith('--')) || 'report';
  const flag = (n, dflt) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : dflt; };
  if (argv.includes('--self-test')) {
    // Known values: Wilson bounds of 0/24, 21/24, 21/39; kappa 0.5; Fisher two-sided p 0.4614 and 3.68e-8 (scipy agrees).
    const near = (x, y) => Math.abs(x - y) < 0.005;
    const ok = near(wilson(0, 24)[1], 0.14) && near(wilson(21, 24)[0], 0.69) && near(wilson(21, 39)[0], 0.39) && near(kappa([true, true, false, false], [true, false, false, false]).kappa, 0.5)
      && Math.abs(fisher(21, 3, 18, 6) - 0.4614) < 0.001 && Math.abs(fisher(18, 6, 0, 24) / 3.68e-8 - 1) < 0.01;
    console.log(ok ? 'bench-prose self-test: wilson, kappa and fisher hold on known values' : 'bench-prose self-test FAILED: statistics');
    if (!ok) return 1;
    // The saved data must hold every part, and the judge answers must belong to the case files as they are now.
    if (!fs.existsSync(DATA)) { console.log('bench-prose self-test FAILED: no saved data'); return 1; }
    const d = load();
    const missing = ['tasks', 'arms', 'labels', 'repairs', 'blind'].filter((k) => !d[k]);
    const stale = staleSets(d);
    if (missing.length || stale.length) { console.log(`bench-prose self-test FAILED: missing ${missing.join(', ') || 'nothing'}; stale ${stale.join(', ') || 'nothing'}`); return 1; }
    console.log(report(d));
    return 0;
  }
  const d = load();
  if (cmd === 'report') { if (!fs.existsSync(DATA)) { console.error('no saved data: run the arms or the blind command first'); return 2; } console.log(report(d)); return 0; }
  if (cmd === 'tasks') { const tasks = makeTasks(JSON.parse(fs.readFileSync(argv[argv.indexOf('tasks') + 1], 'utf8'))); merge({ tasks }); console.log(`${tasks.length} tasks frozen`); return 0; }
  if (cmd === 'arms') {
    const rules = fs.readFileSync(flag('--rules', path.join(os.homedir(), '.claude', 'CLAUDE.md')), 'utf8');
    const reps = Number(flag('--reps', 3));
    const boxes = armBoxes(rules);
    // --tasks a,b runs only those tasks and keeps the saved rows of every other task; the rule file must be the same one
    const only = flag('--tasks') ? new Set(flag('--tasks').split(',')) : null;
    if (only && d.rulesSha && d.rulesSha !== sha(rules)) { console.error(`the saved arms used rule file ${d.rulesSha}; this one is ${sha(rules)}`); return 2; }
    if (only && d.reps && d.reps !== reps) { console.error(`the saved arms have ${d.reps} repeats; --tasks with --reps ${reps} would mix them`); return 2; }
    const jobs = [];
    for (const arm of ['A', 'B', 'C', 'D']) for (const t of d.tasks.filter((x) => !only || only.has(x.id))) for (let rep = 1; rep <= reps; rep += 1) {
      jobs.push(async () => { const r = await call(boxes[arm], t.prompt); return { arm, task: t.id, rep, ok: r.ok, error: r.error, model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, text: cleanOut(r.text), at: new Date().toISOString() }; });
    }
    const fresh = await pool(jobs, Number(flag('--width', 2)));
    const arms = only ? [...(load().arms || []).filter((r) => !only.has(r.task)), ...fresh] : fresh;
    // A label belongs to the text it was given for: drop the labels of every key that this run rewrote.
    const rewritten = new Set(fresh.map(keyOf));
    const saved = load().labels;
    const labels = saved ? { labels: { ...saved, byKey: Object.fromEntries(Object.entries(saved.byKey || {}).filter(([k]) => !rewritten.has(k))) } } : {};
    // A repair was made from the old text of its key: drop those too.
    const repairs = (load().repairs || []).filter((r) => !rewritten.has(keyOf(r)));
    console.log(report(merge({ reps, rulesSha: sha(rules), ruleLine: RULE_LINE, ranAt: only ? d.ranAt : new Date().toISOString(), arms, repairs, ...labels }))); return 0;
  }
  if (cmd === 'repair') {
    const T = Object.fromEntries(d.tasks.map((t) => [t.id, t]));
    const boxes = armBoxes(fs.readFileSync(flag('--rules', path.join(os.homedir(), '.claude', 'CLAUDE.md')), 'utf8'));
    const bad = d.arms.filter((r) => r.ok && check(r.text, { facts: T[r.task].limits }).findings.some((f) => f.severity === 'error'));
    const repairs = await pool(bad.map((r) => async () => {
      const list = check(r.text, { facts: T[r.task].limits }).findings.filter((f) => f.severity === 'error').map((f) => `- place: "${f.span}"\n  the check saw: ${f.sentence}\n  allowed: ${f.allowed}`).join('\n');
      const out = await call(boxes[r.arm], `A check refused the text below. The page speaks for the lab, so a sentence that announces what has not been done is refused there.\n\nText:\n${r.text}\n\nFindings:\n${list}\n\nRewrite the whole text. Keep every fact, number and name. Add no claim. Answer with the rewritten text only.`);
      return { arm: r.arm, task: r.task, rep: r.rep, ok: out.ok, model: out.model, before: r.text, after: cleanOut(out.text) };
    }), Number(flag('--width', 2)));
    console.log(report(merge({ repairs }))); return 0;
  }
  if (cmd === 'label') {
    // Only outputs with no label yet are sent, in a fixed shuffle that hides the arm.
    const have = d.labels?.byKey || {};
    const rows = d.arms.filter((r) => r.ok && (have[keyOf(r)] === undefined || have[keyOf(r)] === null));
    const order = rows.map((r) => ({ r, k: sha(keyOf(r) + d.ranAt) })).sort((x, y) => (x.k < y.k ? -1 : 1)).map((x) => x.r);
    const want = flag('--judge', d.labels?.judge || 'argon');
    if (d.labels?.judge && want !== d.labels.judge && Object.values(have).some((v) => v !== null && v !== undefined)) { console.error(`the saved labels come from judge ${d.labels.judge}; --judge ${want} would mix judges`); return 2; }
    const res = await labelTexts(order.map((r) => r.text), want);
    // arms may have rewritten a key while the judge ran: keep a label only if its text is still the one that was sent.
    const now = Object.fromEntries((load().arms || []).map((r) => [keyOf(r), r.text]));
    const byKey = { ...(load().labels?.byKey || {}), ...Object.fromEntries(order.map((r, i) => [r, res.labels[i]]).filter(([r]) => now[keyOf(r)] === r.text).map(([r, l]) => [keyOf(r), l])) };
    const calls = [...(d.labels?.calls || []), ...res.calls];
    console.log(report(merge({ labels: { judge: res.judge, model: res.model, question: QUESTION, calls, byKey } }))); return 0;
  }
  if (cmd === 'fill') {
    // Ask a judge again for the sentences that a failed call left without an answer; the other answers stay as they are.
    const sets = { blind3: loadCases(BLIND), heldout: loadCases(HELDOUT) };
    const stale = staleSets(d);
    if (stale.length) { console.error(`the saved judge answers for ${stale.join(', ')} belong to another version of its case file; run the blind command again`); return 2; }
    const started = d.blind.ranAt;
    const runs = load().blind.runs;
    for (const r of runs) {
      const miss = r.answers.map((a, i) => (a === null ? i : -1)).filter((i) => i >= 0);
      if (!miss.length) continue;
      const again = await judge(miss.map((i) => sets[r.set][i].text), r.judge);
      miss.forEach((i, k) => { r.answers[i] = again.answers[k]; });
      r.calls = [...r.calls, ...again.calls.map((c) => ({ ...c, fill: true }))];
      process.stderr.write(`${r.judge} run ${r.run} ${r.set}: asked again for ${miss.length}, still without answer ${r.answers.filter((x) => x === null).length}\n`);
    }
    // A blind run that ended during these calls has new answers and a new hash; writing the old runs back would overwrite them.
    if (load().blind.ranAt !== started) { console.error('a blind run finished while fill was asking; nothing was written, run fill again'); return 2; }
    console.log(report(merge({ blind: { ...load().blind, runs } }))); return 0;
  }
  if (cmd === 'blind') {
    const runsN = Number(flag('--runs', 2));
    const sets = { blind3: loadCases(BLIND), heldout: loadCases(HELDOUT) };
    const runs = [];
    for (const j of (flag('--judges', 'haiku,hydrogen')).split(',')) for (let k = 1; k <= runsN; k += 1) for (const [set, cases] of Object.entries(sets)) {
      const r = await judge(cases.map((c) => c.text), j);
      runs.push({ set, judge: j, run: k, model: r.model, calls: r.calls, answers: r.answers });
      process.stderr.write(`${j} run ${k} ${set}: ${r.answers.filter((x) => x === null).length} without answer\n`);
    }
    const caseSha = Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, casesSha(v)]));
    console.log(report(merge({ blind: { question: QUESTION, ranAt: new Date().toISOString(), caseSha, runs } }))); return 0;
  }
  console.error('usage: bench-prose.mjs report|tasks|arms|repair|label|blind | --self-test');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
