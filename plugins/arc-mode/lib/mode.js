// arc-mode 0.1.0 (2026-11-07): the mode store, the list of what is installed, and the measured results. No arc imports here, so node can test it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = (v, fallback) => (v && v.trim()) || fallback;

export function homes(env = process.env, home = os.homedir()) {
  return {
    home,
    arc: dir(env.ARC_HOME, path.join(home, '.arc')),
    claude: dir(env.CLAUDE_CONFIG_DIR, path.join(home, '.claude')),
    harness: dir(env.ARC_HARNESS, path.join(home, 'arc-harness')),
  };
}

const modeFile = (h) => path.join(h.arc, 'arc-mode', 'mode.json');

/** Off when the file is missing or unreadable, so a broken file never adds rules to a prompt. */
export function readMode(h) {
  try { return JSON.parse(fs.readFileSync(modeFile(h), 'utf8')).on === true; } catch { return false; }
}

export function writeMode(h, on) {
  const f = modeFile(h);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.new', JSON.stringify({ on }) + '\n');
  fs.renameSync(f + '.new', f);
}

const rulesFile = (h) => path.join(h.harness, 'shared', 'rules', 'common.md');

/** The text for the system prompt: the written rules while the mode is on, and nothing while it is off. */
export function promptText(h) {
  if (!readMode(h)) return '';
  try { return fs.readFileSync(rulesFile(h), 'utf8'); } catch { return ''; }
}

const SCRIPT = /"([^"]+\.(?:mjs|cjs|js|py))"|(\S+\.(?:mjs|cjs|js|py))(?=\s|$)/;

/** The script of a hook command, or null for an inline command. */
export function hookScript(command) {
  const m = String(command).match(SCRIPT);
  return m ? m[1] || m[2] : null;
}

/**
 * What the mode contains, read from disk on every call. Only names, events and home-relative paths leave this
 * function: the settings file can hold other values, so its raw commands and fields never reach the browser.
 */
export function inventory(h) {
  const tilde = (f) => {
    const rel = path.relative(h.home, f);
    return rel.startsWith('..') || path.isAbsolute(rel) ? path.basename(f) : '~/' + rel.split(path.sep).join('/');
  };
  const hooks = new Map();
  let hooksRead = true;
  try {
    const conf = JSON.parse(fs.readFileSync(path.join(h.claude, 'settings.json'), 'utf8'));
    for (const [event, groups] of Object.entries(conf.hooks ?? {})) {
      for (const hook of groups.flatMap((g) => g.hooks ?? [])) {
        const f = hookScript(hook.command ?? '');
        if (!f) continue;
        const name = path.basename(f).replace(/\.\w+$/, '');
        const row = hooks.get(name) ?? { name, file: tilde(f), installed: fs.existsSync(f), events: [] };
        if (!row.events.includes(event)) row.events.push(event);
        hooks.set(name, row);
      }
    }
  } catch { hooksRead = false; }
  let skills = [];
  try { skills = fs.readdirSync(path.join(h.claude, 'skills')).filter((n) => !n.startsWith('.')).sort(); } catch { /* no skills folder */ }
  return {
    rules: { file: 'shared/rules/common.md', installed: fs.existsSync(rulesFile(h)) },
    hooks: [...hooks.values()].sort((a, b) => a.name.localeCompare(b.name)),
    skills,
    hooksRead,
  };
}

// The open benchmarks of the owner's reply of 2026-11-07. A row appears here only from bench/open-results.jsonl.
export const OPEN_BENCHMARKS = [
  { name: 'Terminal-Bench 4.0', url: 'https://www.tbench.ai/', why: 'Tests the whole agent on terminal tasks, so the harness counts.' },
  { name: 'Autonomous Science Bench 0.1', url: 'https://arxiv.org/abs/2610.18449', why: 'Tests the choice of experiments under a budget, the work Arc Harness is for.' },
  { name: 'BAISBench', url: 'https://arxiv.org/abs/2505.08341', why: 'Tests biology data work. It is older than the evidence window, so it is background.' },
];

/** A number may show only with its benchmark, model, date and sample size. */
export const measured = (r) => ['benchmark', 'model', 'unit', 'value'].every((k) => r?.[k] !== undefined && r[k] !== null && r[k] !== '') && /^\d{4}-\d{2}-\d{2}/.test(r?.date) && Number.isInteger(r?.n) && r.n > 0;

function jsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).flatMap((l) => {
      try { return [JSON.parse(l)]; } catch { return [null]; }
    });
  } catch { return []; }
}

/** The private bench: one row per bench version, model, effort, arm and runner. Every run counts, and the arms are not subtracted. */
function benchRows(h) {
  const by = new Map();
  for (const r of jsonl(path.join(h.harness, 'bench', 'results.jsonl'))) {
    if (!r?.task) continue;
    const key = [r.bench, r.model, r.effort ?? '', r.harness, r.runner ?? 'cli'].join('|');
    const row = by.get(key) ?? { benchmark: `Private bench ${r.bench}, arm ${r.harness}, runner ${r.runner ?? 'cli'}`, model: r.effort ? `${r.model} ${r.effort}` : r.model, date: '', n: 0, passed: 0, unit: 'runs' };
    row.n += 1;
    row.passed += r.pass === true ? 1 : 0;
    if (String(r.at).slice(0, 10) > row.date) row.date = String(r.at).slice(0, 10);
    by.set(key, row);
  }
  return [...by.values()].map(({ passed, ...row }) => ({ ...row, value: `${passed} of ${row.n} passed` }));
}

function baseline(h) {
  try {
    const rows = JSON.parse(fs.readFileSync(path.join(h.harness, 'bench', 'baseline.json'), 'utf8'));
    return Array.isArray(rows) ? rows : [null];
  } catch { return []; }
}

/** Measured rows only, with the private ones kept apart. A row with a missing field is counted and left out. */
export function effect(h) {
  const openRows = jsonl(path.join(h.harness, 'bench', 'open-results.jsonl'));
  const privateRows = [...benchRows(h), ...baseline(h)];
  const named = new Set(OPEN_BENCHMARKS.map((b) => b.name));
  return {
    open: OPEN_BENCHMARKS.map((b) => ({ ...b, rows: openRows.filter((r) => measured(r) && r.benchmark === b.name) })),
    private: { rows: privateRows.filter(measured) },
    dropped: openRows.filter((r) => !measured(r) || !named.has(r.benchmark)).length + privateRows.filter((r) => !measured(r)).length,
  };
}

/** The route: a boolean "on" sets the mode, and any other body only reads. */
export async function serve(request, h) {
  const body = await request.json().catch(() => ({}));
  if (typeof body?.on === 'boolean') writeMode(h, body.on);
  return { ok: true, on: readMode(h), inventory: inventory(h), effect: effect(h) };
}
