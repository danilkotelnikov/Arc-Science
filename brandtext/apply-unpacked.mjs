// Package metadata in the unpacked part of the installed app (the folders next to app.asar that the archive cannot hold).
//   node brandtext/apply-unpacked.mjs [--dry]     removes repository, homepage, bugs and funding links that name the old vendor
//   node brandtext/apply-unpacked.mjs --restore   puts the originals back
// Only package.json files change. Originals go to brandtext/_unpacked-originals/ (not in git).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rewritePackageJson } from '../lib/brandrules.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const unpacked = process.env.ARC_UNPACKED || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'DeepSeek Harness', 'resources', 'app.asar.unpacked');
const keep = path.join(here, '_unpacked-originals');
const args = process.argv.slice(2);

function* walk(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name === 'package.json') yield p;
  }
}

if (args.includes('--restore')) {
  let n = 0;
  for (const p of walk(keep)) {
    const rel = path.relative(keep, p);
    fs.copyFileSync(p, path.join(unpacked, rel));
    n++;
  }
  console.log(`restored ${n} files`);
  process.exit(0);
}

let n = 0;
for (const p of walk(unpacked)) {
  const before = fs.readFileSync(p, 'utf8');
  let after;
  try { after = rewritePackageJson(before); } catch { continue; }
  if (after === before) continue;
  n++;
  if (args.includes('--dry')) { console.log('would change', path.relative(unpacked, p)); continue; }
  const rel = path.relative(unpacked, p);
  const saved = path.join(keep, rel);
  if (!fs.existsSync(saved)) { fs.mkdirSync(path.dirname(saved), { recursive: true }); fs.copyFileSync(p, saved); }
  fs.writeFileSync(p + '.arc-tmp', after);
  fs.renameSync(p + '.arc-tmp', p);
}
console.log(`${args.includes('--dry') ? 'would change' : 'changed'} ${n} package.json files`);
