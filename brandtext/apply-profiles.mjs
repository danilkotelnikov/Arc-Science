// Brand text in the plugin packages of both profiles, the local plugins and a few scripts of the data home.
//   node brandtext/apply-profiles.mjs [--dry]     writes the rewrite; originals go to brandtext/_originals.tar.xz
//   node brandtext/apply-profiles.mjs --restore   puts the originals back
// Same rules and same surfaces as the app archive (lib/brandrules.mjs, test/ui-strings.mjs --profiles).
// A changed file is written next to the old one and renamed over it, so hard links into the package store stay untouched.
// tar runs inside this folder with relative names only, so it works with the Git tar and with the Windows tar.
import crypto from 'node:crypto';
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
// scripts of the data home that show text on a page or in a dialog
const extraFiles = [path.join(home, 'local-gateway.mjs')];
const skip = new RegExp(allow.profileSkip.join('|'));
const ARCHIVE = '_originals.tar.xz';
const STAGE = '_stage';
const archive = path.join(here, ARCHIVE);
const stage = path.join(here, STAGE);
const norm = (p) => p.replace(/\\/g, '/');
const tar = (...a) => spawnSync('tar', a, { cwd: here, encoding: 'utf8' });

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
  const r = tar('-xJf', ARCHIVE, '-C', STAGE);
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

// --manifest: write brandtext/profile-state.json, the sha256 of every file this script has rewritten (read from the originals list),
// so the state of the data home that a test run saw can be tied to one committed list (test/profile-state.mjs checks it)
if (args.includes('--manifest')) {
  if (!fs.existsSync(archive)) { console.error('no archive: ' + archive); process.exit(1); }
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const r = tar('-xJf', ARCHIVE, '-C', STAGE);
  if (r.status) { console.error(r.stderr); process.exit(1); }
  const files = {};
  for (const rel of JSON.parse(fs.readFileSync(path.join(stage, 'list.json'), 'utf8'))) {
    const target = path.join(path.parse(os.homedir()).root, rel);
    try { files[rel.replace(/^Users\/[^/]+\//, '~/')] = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'); } catch { files[rel] = null; }
  }
  fs.rmSync(stage, { recursive: true, force: true });
  fs.writeFileSync(path.join(here, 'profile-state.json'), JSON.stringify({ note: 'sha256 of the files rewritten by brandtext/apply-profiles.mjs; paths start at the user home (~)', files }, null, 1) + '\n');
  console.log('manifest: ' + Object.keys(files).length + ' files');
  process.exit(0);
}

const changed = [];
let scanned = 0;
const consider = (p) => {
  if (skip.test(norm(p)) || !/\.(c|m)?js$|\.json$|\.md$|\.html?$|\.txt$|\.svg$|\.ya?ml$|\.(c|m)?tsx?$/i.test(p)) return;
  let st; try { st = fs.statSync(p); } catch { return; }
  if (st.size > 6e6) return;
  scanned++;
  const before = fs.readFileSync(p, 'utf8');
  let after = /\.svg$/i.test(p) ? recolorSvg(before) : rewriteFile(p, before);
  // two plugins look for a newer version at the public npm registry and at GitHub on every start; those checks are off
  if (/dsh-(context|vision-router)[\\/]lib[\\/].*\.js$/.test(p)) {
    after = after.replace(/registry\.npm(?:js\.org|mirror\.com)|api\.github\.com/g, DEAD_HOST);
    // a fetch to the dead name would still send a CONNECT to the system proxy; a local port that refuses at once sends nothing out
    after = after.replace(/https:\/\/arc-harness\.invalid/g, 'http://127.0.0.1:9');
  }
  // the update check of the vision router does not run at all
  if (/dsh-vision-router[\\/]lib[\\/]update-check\.js$/.test(p)) after = after.replace("if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable')", "throw new Error('update checks are off in Arc Harness')");
  if (after !== before) changed.push({ p, after });
};
for (const d of dirs) for (const p of walk(d)) consider(p);
for (const p of extraFiles) consider(p);
console.log(`scanned ${scanned} files, ${changed.length} change`);
if (scanned < 1000) { console.error('too few files scanned: the data home is not where it should be'); process.exit(2); }
if (args.includes('--dry')) process.exit(0);
if (!changed.length) process.exit(0);

// keep the originals; an older archive keeps its entries (the first original of a file is the true one)
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
let rels = [];
if (fs.existsSync(archive)) {
  const x = tar('-xJf', ARCHIVE, '-C', STAGE);
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
// the new archive gets a temporary name; the old one is replaced only after tar succeeded
const t = tar('-cJf', 'new-' + ARCHIVE, '-C', STAGE, 'list.json', 'files');
if (t.status) { console.error(t.stderr); process.exit(1); }
fs.renameSync(path.join(here, 'new-' + ARCHIVE), archive);
fs.rmSync(stage, { recursive: true, force: true });

let n = 0;
for (const c of changed) {
  const tmp = c.p + '.arc-tmp';
  fs.writeFileSync(tmp, c.after);
  fs.renameSync(tmp, c.p);
  n++;
}
console.log(`wrote ${n} files; originals in ${archive}`);
