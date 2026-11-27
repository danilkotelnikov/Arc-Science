// Arc Harness copy pass (2026-11-09): one name and one writing style for the labels of Settings.
//
//   node copy/apply-copy.mjs --dry      list every match count, write nothing
//   node copy/apply-copy.mjs            write the changes into both profiles and the local plugin sources
//   node copy/apply-copy.mjs --restore  put the original files back
//
// The rules are in copy-map.json: file (relative to a plugin root), find (exact text, quotes included), replace, min (least
// matches, default 1), optional (a file or text that may be absent). A text that already holds the replacement counts as done,
// so the pass is safe to run again. Before the first write the original of each file is stored under copy/_originals.
// A file is replaced by temp file plus rename, so a file that is hard-linked into the package store gets a new inode.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.ARC_HOME || path.join(os.homedir(), '.arc');
const ORIG = path.join(HERE, '_originals');
const mode = process.argv.includes('--dry') ? 'dry' : process.argv.includes('--restore') ? 'restore' : 'write';
const load = (f) => (fs.existsSync(path.join(HERE, f)) ? JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8')) : { rules: [] });
// copy-map.json first (short labels), then copy-descriptions.json (long texts written by rewrite-descriptions.mjs)
const map = { rules: [...load('copy-map.json').rules, ...load('copy-descriptions.json').rules] };

/** Every root a rule file may live in: both profiles and the local plugin sources. */
const roots = [
  ['web', path.join(HOME, 'profiles', 'web', 'node_modules')],
  ['desktop', path.join(HOME, 'profiles', 'desktop', 'node_modules')],
  ['local', path.join(HOME, 'local-plugins')],
];

function atomicWrite(file, text) {
  const tmp = file + '.arc-tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

let failures = 0;
const byFile = new Map();
for (const r of map.rules) { if (!byFile.has(r.file)) byFile.set(r.file, []); byFile.get(r.file).push(r); }

for (const [rel, rules] of byFile) {
  for (const [label, root] of roots) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) { if (label !== 'local') console.log(`skip   ${label}/${rel} (absent)`); continue; }
    const keep = path.join(ORIG, label, rel);
    if (mode === 'restore') {
      if (fs.existsSync(keep)) { atomicWrite(file, fs.readFileSync(keep)); console.log(`restore ${label}/${rel}`); }
      continue;
    }
    let s = fs.readFileSync(file, 'utf8');
    const before = s;
    for (const r of rules) {
      const n = s.split(r.find).length - 1;
      const done = s.includes(r.replace) && n === 0;
      const min = r.min ?? 1;
      if (n === 0) {
        if (!done && !r.optional) { failures++; console.log(`FAIL   ${label}/${rel}: not found: ${r.find.slice(0, 80)}`); }
        else console.log(`ok     ${label}/${rel}: ${done ? 'already' : 'absent'}: ${r.find.slice(0, 60)}`);
        continue;
      }
      if (n < min) { failures++; console.log(`FAIL   ${label}/${rel}: ${n} < ${min}: ${r.find.slice(0, 80)}`); continue; }
      s = s.split(r.find).join(r.replace);
      console.log(`change ${label}/${rel}: ${n}x ${r.find.slice(0, 60)} -> ${r.replace.slice(0, 60)}`);
    }
    if (mode === 'write' && s !== before) {
      if (!fs.existsSync(keep)) { fs.mkdirSync(path.dirname(keep), { recursive: true }); fs.writeFileSync(keep, before); }
      atomicWrite(file, s);
    }
  }
}
console.log(failures ? `${failures} rule(s) failed` : 'all rules matched');
process.exit(failures ? 1 : 0);
