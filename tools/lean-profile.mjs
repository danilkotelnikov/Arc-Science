// The lean profile: the bundle list of a profile keeps only brandtext/lean-profile.json "keep" and "add".
//   node tools/lean-profile.mjs status  [--home <dir>]
//   node tools/lean-profile.mjs apply   [--home <dir>]   (close the app first; the original list is saved in the kit)
//   node tools/lean-profile.mjs restore [--home <dir>]
// --home <dir> sets the data home with profiles/<name>/package.json; the default is .dsh in your home folder.
// Packages stay installed. Only dsh.profile.bundles changes, so a bundle comes back by one line.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'brandtext', 'lean-profile.json'), 'utf8'));
const undoFile = path.join(root, 'brandtext', 'lean-profile.undo.json');

/** The package.json text of a profile with the lean bundle list. Order of the kept bundles is the profile's own. */
export function lean(text) {
  const j = JSON.parse(text);
  const old = j.dsh?.profile?.bundles;
  if (!Array.isArray(old)) throw new Error('no dsh.profile.bundles in the profile package.json');
  const kept = old.filter((b) => spec.keep.includes(b));
  for (const b of spec.keep) if (!kept.includes(b)) throw new Error(`the profile has no bundle ${b}`);
  for (const b of spec.add) if (!kept.includes(b)) kept.push(b);
  j.dsh.profile.bundles = kept;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return JSON.stringify(j, null, 2).replace(/\n/g, eol) + (/\n$/.test(text) ? eol : '');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const hi = argv.indexOf('--home');
  const home = hi >= 0 ? path.resolve(argv[hi + 1]) : path.join(os.homedir(), '.dsh');
  const undo = fs.existsSync(undoFile) ? JSON.parse(fs.readFileSync(undoFile, 'utf8')) : {};
  for (const prof of ['web', 'desktop']) {
    const file = path.join(home, 'profiles', prof, 'package.json');
    if (!fs.existsSync(file)) { console.log(`${prof}: no profile at ${file}`); continue; }
    const text = fs.readFileSync(file, 'utf8');
    const now = JSON.parse(text).dsh.profile.bundles;
    if (cmd === 'status') console.log(`${prof}: ${now.length} bundles${undo[prof] ? ' (lean, original list saved)' : ''}: ${now.join(', ')}`);
    else if (cmd === 'apply') {
      if (!undo[prof]) undo[prof] = now; // the first original list stays, a second apply never overwrites it
      fs.writeFileSync(file, lean(text));
      console.log(`${prof}: now ${spec.keep.length + spec.add.length} bundles`);
    } else if (cmd === 'restore') {
      if (!undo[prof]) { console.log(`${prof}: nothing saved to restore`); continue; }
      const j = JSON.parse(text);
      j.dsh.profile.bundles = undo[prof];
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      fs.writeFileSync(file, JSON.stringify(j, null, 2).replace(/\n/g, eol) + (/\n$/.test(text) ? eol : ''));
      delete undo[prof];
      console.log(`${prof}: original list of ${j.dsh.profile.bundles.length} bundles is back`);
    } else { console.error('usage: lean-profile.mjs status|apply|restore [--home <dir>]'); process.exit(2); }
  }
  if ((cmd === 'apply' || cmd === 'restore') && hi < 0) fs.writeFileSync(undoFile, JSON.stringify(undo, null, 2) + '\n'); // only the real home keeps an undo list
}
