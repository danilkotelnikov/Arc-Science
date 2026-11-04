// The lean profile: the bundle list of a profile keeps only brandtext/lean-profile.json "keep" and "add".
//   node tools/lean-profile.mjs status  [--home <dir>]
//   node tools/lean-profile.mjs apply   [--home <dir>]   (close the app first; the original list is saved in the kit)
//   node tools/lean-profile.mjs restore [--home <dir>]
// --home <dir> sets the data home with profiles/<name>/package.json; the default is ARC_HOME, then .arc in your home folder.
// Packages stay installed. Only the profile's bundle list changes, so a bundle comes back by one line.
// The undo list keeps the original lists of each data home apart, under the resolved path of the home, so applying or restoring
// one home (~/.arc, an ARC_HOME, a --home) never reads or overwrites the saved list of another.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataHome } from '../lib/testhome.mjs';
import { arcText } from '../lib/arcnames.mjs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'brandtext', 'lean-profile.json'), 'utf8'));
const undoFile = path.join(root, 'brandtext', 'lean-profile.undo.json');

// A clean-room profile (~/.arc) keeps its list in the "arc" field with Arc names; an original one (~/.dsh) in "dsh".
const field = (j) => (j.arc ? 'arc' : 'dsh');
const names = (j, list) => (field(j) === 'arc' ? list.map((b) => arcText(b)[0]) : list);

/** The package.json text of a profile with the lean bundle list. Order of the kept bundles is the profile's own.
 *  has(name) says whether the package is installed: the app does not start when a listed package is missing. */
export function lean(text, has) {
  const j = JSON.parse(text);
  if (field(j) !== 'arc') throw new Error('this profile still has the original names: run the install first');
  const old = j[field(j)]?.profile?.bundles;
  if (!Array.isArray(old)) throw new Error('no arc.profile.bundles in the profile package.json');
  const keep = names(j, spec.keep), add = names(j, spec.add);
  const kept = old.filter((b) => keep.includes(b));
  for (const b of keep) if (!kept.includes(b)) throw new Error(`the profile has no bundle ${b}`);
  for (const b of add) {
    if (!has(b)) throw new Error(`the package ${b} is not installed: copy it into the profile's node_modules first`);
    if (!kept.includes(b)) kept.push(b);
  }
  j[field(j)].profile.bundles = kept;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return JSON.stringify(j, null, 2).replace(/\n/g, eol) + (/\n$/.test(text) ? eol : '');
}

const PROFILES = ['web', 'desktop'];
const COMMANDS = ['status', 'apply', 'restore'];

/** The key of a data home in the undo list: its resolved path (lower case on Windows, where paths ignore case). */
export function homeKey(home) {
  const abs = path.resolve(home);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/** The data home of a command line: --home <dir>, else ARC_HOME, else ~/.arc or ~/.dsh (dataHome of lib/testhome.mjs). Always resolved. */
export function resolveHome(argv, env = process.env, userHome = os.homedir()) {
  const hi = argv.indexOf('--home');
  return path.resolve(hi >= 0 ? argv[hi + 1] : dataHome(env, userHome));
}

/** The undo list as { [homeKey]: { web?: [...], desktop?: [...] } }. The file is { "homes": { ... } }.
 *  An old file without "homes" holds the flat lists { web, desktop } of the one home it was written for: they move to legacyHome,
 *  without replacing a list that home already has under "homes". */
export function readUndo(file, legacyHome) {
  const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const homes = raw.homes && typeof raw.homes === 'object' && !Array.isArray(raw.homes) ? { ...raw.homes } : {};
  const old = Object.fromEntries(PROFILES.filter((p) => Array.isArray(raw[p])).map((p) => [p, raw[p]]));
  if (Object.keys(old).length && legacyHome) {
    const k = homeKey(legacyHome);
    homes[k] = { ...old, ...homes[k] };
  }
  return homes;
}

/** Runs status, apply or restore on the profiles of one data home. Only the undo entry of that home is read or changed.
 *  undoFile: where the undo list lives (default: the kit's brandtext/lean-profile.undo.json).
 *  legacyHome: the home an old flat undo file belongs to (default: the home without ARC_HOME, the one the old tool wrote for). */
export function run(cmd, home, { undoFile: file = undoFile, legacyHome, log = console.log } = {}) {
  if (!COMMANDS.includes(cmd)) throw new Error('usage: lean-profile.mjs status|apply|restore [--home <dir>]');
  const undo = readUndo(file, legacyHome === undefined ? dataHome({}) : legacyHome);
  const key = homeKey(home);
  const saved = { ...undo[key] };
  const installed = (f) => (b) => fs.existsSync(path.join(path.dirname(f), 'node_modules', b));
  if (cmd === 'apply') for (const prof of PROFILES) {
    const f = path.join(home, 'profiles', prof, 'package.json');
    if (fs.existsSync(f)) lean(fs.readFileSync(f, 'utf8'), installed(f)); // throws before any profile is written
  }
  for (const prof of PROFILES) {
    const f = path.join(home, 'profiles', prof, 'package.json');
    if (!fs.existsSync(f)) { log(`${prof}: no profile at ${f}`); continue; }
    const text = fs.readFileSync(f, 'utf8');
    const now = JSON.parse(text)[field(JSON.parse(text))].profile.bundles;
    if (cmd === 'status') log(`${prof}: ${now.length} bundles${saved[prof] ? ' (lean, original list saved)' : ''}: ${now.join(', ')}`);
    else if (cmd === 'apply') {
      if (!saved[prof]) saved[prof] = now; // the first original list stays, a second apply never overwrites it
      fs.writeFileSync(f, lean(text, installed(f)));
      log(`${prof}: now ${spec.keep.length + spec.add.length} bundles`);
    } else {
      if (!saved[prof]) { log(`${prof}: nothing saved to restore`); continue; }
      const j = JSON.parse(text);
      j[field(j)].profile.bundles = names(j, saved[prof]);
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      fs.writeFileSync(f, JSON.stringify(j, null, 2).replace(/\n/g, eol) + (/\n$/.test(text) ? eol : ''));
      delete saved[prof];
      log(`${prof}: original list of ${j[field(j)].profile.bundles.length} bundles is back`);
    }
  }
  if (cmd === 'apply' || cmd === 'restore') {
    if (Object.keys(saved).length) undo[key] = saved; else delete undo[key]; // a fully restored home leaves the list
    fs.writeFileSync(file, JSON.stringify({ homes: undo }, null, 2) + '\n');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!COMMANDS.includes(cmd)) { console.error('usage: lean-profile.mjs status|apply|restore [--home <dir>]'); process.exit(2); }
  run(cmd, resolveHome(argv));
}
