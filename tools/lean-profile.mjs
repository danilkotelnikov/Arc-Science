// The lean profile: the bundle list of a profile keeps only brandtext/lean-profile.json "keep" and "add".
//   node tools/lean-profile.mjs status  [--home <dir>]
//   node tools/lean-profile.mjs apply   [--home <dir>]   (close the app first; the original list is saved in the kit)
//   node tools/lean-profile.mjs restore [--home <dir>]
// --home <dir> sets the data home with profiles/<name>/package.json; the default is ARC_HOME, then .arc in your home folder.
// Packages stay installed. Only the profile's bundle list changes, so a bundle comes back by one line.
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const hi = argv.indexOf('--home');
  const home = hi >= 0 ? path.resolve(argv[hi + 1]) : dataHome();
  const undo = fs.existsSync(undoFile) ? JSON.parse(fs.readFileSync(undoFile, 'utf8')) : {};
  const installed = (file) => (b) => fs.existsSync(path.join(path.dirname(file), 'node_modules', b));
  if (cmd === 'apply') for (const prof of ['web', 'desktop']) {
    const file = path.join(home, 'profiles', prof, 'package.json');
    if (fs.existsSync(file)) lean(fs.readFileSync(file, 'utf8'), installed(file)); // throws before any profile is written
  }
  for (const prof of ['web', 'desktop']) {
    const file = path.join(home, 'profiles', prof, 'package.json');
    if (!fs.existsSync(file)) { console.log(`${prof}: no profile at ${file}`); continue; }
    const text = fs.readFileSync(file, 'utf8');
    const now = JSON.parse(text)[field(JSON.parse(text))].profile.bundles;
    if (cmd === 'status') console.log(`${prof}: ${now.length} bundles${undo[prof] ? ' (lean, original list saved)' : ''}: ${now.join(', ')}`);
    else if (cmd === 'apply') {
      if (!undo[prof]) undo[prof] = now; // the first original list stays, a second apply never overwrites it
      fs.writeFileSync(file, lean(text, installed(file)));
      console.log(`${prof}: now ${spec.keep.length + spec.add.length} bundles`);
    } else if (cmd === 'restore') {
      if (!undo[prof]) { console.log(`${prof}: nothing saved to restore`); continue; }
      const j = JSON.parse(text);
      j[field(j)].profile.bundles = names(j, undo[prof]);
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      fs.writeFileSync(file, JSON.stringify(j, null, 2).replace(/\n/g, eol) + (/\n$/.test(text) ? eol : ''));
      delete undo[prof];
      console.log(`${prof}: original list of ${j[field(j)].profile.bundles.length} bundles is back`);
    } else { console.error('usage: lean-profile.mjs status|apply|restore [--home <dir>]'); process.exit(2); }
  }
  if ((cmd === 'apply' || cmd === 'restore') && hi < 0) fs.writeFileSync(undoFile, JSON.stringify(undo, null, 2) + '\n'); // only the real home keeps an undo list
}
