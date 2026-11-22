// The prose gate on a frozen candidate (D-20261122-50). The accept gate reads the frozen files itself, so a reviewer
// cannot send a result. Text that speaks for the author (arc-core lib/prose-voice.js) is read in the public zone, where an
// error blocks; every other text file is read as a report, so its findings are marks. Code, tests and fixtures are skipped.
// A voice file that git reports as changed next to the frozen files, but that the freeze left out, is read as well.
// The rules live in arc-core; the release bundle keeps the plugins side by side.
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const TEXT = /\.(md|markdown|rst|txt|tex|html?)$/i;
let engine;
const loadEngine = () => (engine ??= Promise.all([import('../../arc-core/lib/prose-gate.js'), import('../../arc-core/lib/prose-voice.js')])
  .then(([gate, voice]) => ({ ...gate, ...voice }), () => null));

/** The project root of a file: the nearest folder with .git, else null. */
function gitRoot(file) {
  let d = path.dirname(path.resolve(file));
  for (let i = 0; i < 40; i += 1) {
    if (existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
  return null;
}
/** The folder that holds every path. */
function commonDir(paths) {
  const parts = paths.map((p) => path.dirname(path.resolve(p)).split(path.sep));
  const out = [];
  for (let i = 0; parts.every((p) => i < p.length && p[i].toLowerCase() === parts[0][i].toLowerCase()); i += 1) out.push(parts[0][i]);
  return out.join(path.sep) || path.sep;
}
const same = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

/** Changed or new voice files in the git projects of the frozen files that the freeze does not hold. */
function unfrozenVoice(paths, { VOICE, NOT_PROSE }) {
  const frozen = new Set(paths.map(same));
  const out = [];
  for (const root of new Set(paths.map(gitRoot).filter(Boolean))) {
    // A git failure (missing, timeout, output over the buffer) throws: proseOfFiles then returns null and the gate stays unmet.
    const listed = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 256 * 1024 * 1024 });
    for (const entry of listed.split('\0')) {
      const rel = entry.slice(3);
      if (entry.length < 4 || entry[0] === 'D' || entry[1] === 'D' || !VOICE.test(rel) || NOT_PROSE.test(rel)) continue;
      const file = path.join(root, rel);
      if (!frozen.has(same(file)) && existsSync(file)) out.push(file);
    }
  }
  return out;
}

/**
 * Run the prose gate on the frozen paths. Returns { files: [{file, zone, frozen, blocks, marks}], blocks: [{file, line, rule, span,
 * sentence, frozen}], marks } or null when the engine cannot load or a file cannot be read: the gate then stays unmet,
 * because a check that did not run is no pass. `gate` replaces the engine in tests.
 */
export async function proseOfFiles(paths, gate) {
  if (gate === undefined) gate = await loadEngine();
  if (!gate || typeof gate.check !== 'function' || typeof gate.checkJson !== 'function' || !gate.VOICE) return null;
  const list = Array.isArray(paths) ? paths : [];
  const files = [], blocks = [];
  let marks = 0;
  const read = async (file, zone, frozen) => {
    const raw = await readFile(file, 'utf8');
    let r = null;
    if (/\.json$/i.test(file)) { try { r = gate.checkJson(JSON.parse(raw), { zone }); } catch { r = null; } }
    r ??= gate.check(/\.html?$/i.test(file) ? gate.visibleText(raw) : raw, { zone });
    const own = r.findings.filter((f) => f.severity === 'error');
    for (const f of own) blocks.push({ file, line: f.line, rule: f.rule, span: f.span, sentence: f.sentence, frozen });
    marks += r.findings.length - own.length;
    files.push({ file, zone, frozen, blocks: own.length, marks: r.findings.length - own.length });
  };
  try {
    const base = new Map(list.map((p) => [p, gitRoot(p) ?? commonDir(list)]));
    for (const file of list) {
      const rel = path.relative(base.get(file), path.resolve(file));
      const voice = gate.VOICE.test(path.resolve(file));
      if (gate.NOT_PROSE.test(rel) || !(voice || TEXT.test(file))) continue;
      await read(file, voice ? 'public' : 'report', true);
    }
    // A changed voice file the freeze left out is read too, and only a real block in it counts: a clean edit by
    // someone else in a shared checkout never stops this work.
    for (const file of unfrozenVoice(list, gate)) await read(file, 'public', false);
    return { files, blocks, marks };
  } catch {
    return null;
  }
}

/** The gate reasons for a prose result: one per block, the first five by place and the rest as a count. */
export function proseReasons(prose, clip) {
  if (!prose) return ['the prose gate did not run on the frozen files: the engine (arc-core) or a file could not be read'];
  const out = prose.blocks.slice(0, 5).map((b) => `prose gate: ${path.basename(b.file)}:${b.line} ${b.rule}${b.frozen === false ? ' (changed, not frozen)' : ''}: "${clip(b.sentence, 120)}"`);
  if (prose.blocks.length > 5) out.push(`prose gate: ${prose.blocks.length - 5} more block(s)`);
  return out;
}
