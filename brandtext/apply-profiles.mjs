// Brand text in the plugin packages of both profiles and the local plugins.
//   node brandtext/apply-profiles.mjs [--dry]     writes the rewrite; originals go to brandtext/_originals.tar.xz
//   node brandtext/apply-profiles.mjs --restore   puts the originals back
// Same rules and same surfaces as the app archive (lib/brandrules.mjs, test/ui-strings.mjs --profiles).
// A changed file is written next to the old one and renamed over it, so hard links into the package store stay untouched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allow, rewriteFile, DEAD_HOST } from '../lib/brandrules.mjs';
import { recolorSvg } from '../lib/iconcolor.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const home = path.join(os.homedir(), '.dsh');
const dirs = [path.join(home, 'local-plugins'), path.join(home, 'profiles', 'web', 'node_modules'), path.join(home, 'profiles', 'desktop', 'node_modules')];
const skip = new RegExp(allow.profileSkip.join('|'));
const archive = path.join(here, '_originals.tar.xz');
const stage = path.join(here, '_stage');
const norm = (p) => p.replace(/\\/g, '/');

function* walk(dir, depth = 0) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === '.pnpm' || e.name === '.bin' || e.name.startsWith('_archive')) continue; if (depth < 6) yield* walk(p, depth + 1); }
    else yield p;
  }
}

const args = process.argv.slice(2);

if (args.includes('--restore')) {
  if (!fs.existsSync(archive)) { console.error('no archive: ' + archive); process.exit(1); }
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const r = spawnSync('tar', ['--force-local', '-xJf', archive, '-C', stage], { encoding: 'utf8' });
  if (r.status) { console.error(r.stderr); process.exit(1); }
  let n = 0;
  for (const rel of JSON.parse(fs.readFileSync(path.join(stage, 'list.json'), 'utf8'))) {
    const target = path.join(path.parse(os.homedir()).root, rel);
    const tmp = target + '.arc-tmp';
    fs.copyFileSync(path.join(stage, 'files', rel), tmp);
    fs.renameSync(tmp, target);
    n++;
  }
  fs.rmSync(stage, { recursive: true, force: true });
  console.log(`restored ${n} files`);
  process.exit(0);
}

const changed = [];
let scanned = 0;
for (const d of dirs) {
  for (const p of walk(d)) {
    if (skip.test(norm(p)) || !/\.(c|m)?js$|\.json$|\.md$|\.html?$|\.txt$|\.svg$|\.ya?ml$|\.(c|m)?tsx?$/i.test(p)) continue;
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.size > 6e6) continue;
    scanned++;
    const before = fs.readFileSync(p, 'utf8');
    let after = /\.svg$/i.test(p) ? recolorSvg(before) : rewriteFile(p, before);
    // two plugins look for a newer version at the public npm registry on every start; that check is off
    if (/dsh-(context|vision-router)[\\/]lib[\\/].*\.js$/.test(p)) after = after.replace(/registry\.npm(?:js\.org|mirror\.com)/g, DEAD_HOST);
    if (after !== before) changed.push({ p, after, links: st.nlink });
  }
}
console.log(`scanned ${scanned} files, ${changed.length} change`);
if (args.includes('--dry')) process.exit(0);
if (!changed.length) process.exit(0);

// keep the originals; an older archive keeps its entries (the first original of a file is the true one)
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
let rels = [];
if (fs.existsSync(archive)) {
  const x = spawnSync('tar', ['--force-local', '-xJf', norm(archive), '-C', norm(stage)], { encoding: 'utf8' });
  if (x.status) { console.error(x.stderr); process.exit(1); }
  rels = JSON.parse(fs.readFileSync(path.join(stage, 'list.json'), 'utf8'));
}
const have = new Set(rels);
for (const c of changed) {
  const rel = norm(path.relative(path.parse(c.p).root, c.p));
  if (have.has(rel)) continue;
  rels.push(rel);
  const dest = path.join(stage, 'files', rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(c.p, dest);
}
fs.writeFileSync(path.join(stage, 'list.json'), JSON.stringify(rels));
fs.rmSync(archive, { force: true });
const t = spawnSync('tar', ['--force-local', '-cJf', norm(archive), '-C', norm(stage), 'list.json', 'files'], { encoding: 'utf8' });
if (t.status) { console.error(t.stderr); process.exit(1); }
fs.rmSync(stage, { recursive: true, force: true });

let n = 0;
for (const c of changed) {
  const tmp = c.p + '.arc-tmp';
  fs.writeFileSync(tmp, c.after);
  fs.renameSync(tmp, c.p);
  n++;
}
console.log(`wrote ${n} files; originals in ${archive}`);
