// Install or roll back the Arc Harness build in the app folder.
//   node tools/install.mjs install      swap in build/app.asar, brand icons, switch the update feed off
//   node tools/install.mjs rollback     put every pristine file back
//   node tools/install.mjs status       say which one is installed
// The pristine files in pristine/ are never touched. A swap is a rename, so a running app keeps its open copy until it restarts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { arcText } from '../lib/arcnames.mjs';
import { makeArcCopy, homeRewrite } from '../lib/arcunpacked.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = process.env.ARC_RESOURCES || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness', 'resources');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const pristineSums = Object.fromEntries(fs.readFileSync(path.join(root, 'pristine', 'SHA256SUMS.txt'), 'utf8').trim().split('\n').map((l) => { const [h, n] = l.split(/\s+\*?/); return [n, h]; }));
const live = (n) => path.join(res, n);
const pristine = (n) => path.join(root, 'pristine', n);
const swap = (from, to) => { const tmp = to + '.arc-new'; fs.copyFileSync(from, tmp); fs.renameSync(tmp, to); };

// The build keeps its data in ~/.arc (or ARC_HOME). The first install makes a clean-room copy of the old ~/.dsh there
// (lib/arcunpacked.mjs: Arc names in settings, profiles, local plugins and skills; conversations, logs and keys byte for byte)
// and leaves ~/.dsh untouched, so a rollback finds the original data where the original app expects it.
// A ~/.arc without profiles (for example only the arc-hoh ledger) still gets the copy; the files already there win.
export function migrateHome(home = process.env.ARC_HOME?.trim() || path.join(os.homedir(), '.arc'), old = path.join(os.homedir(), '.dsh')) {
  if (fs.existsSync(path.join(home, 'profiles')) || !fs.existsSync(old)) return console.log('data folder:', home, fs.existsSync(home) ? '(already there)' : '(new)');
  const tmp = home + '.arc-new';
  if (fs.existsSync(tmp)) throw new Error('an unfinished copy is in the way: ' + tmp + '; look at it, then remove it');
  let st;
  try { st = makeArcCopy(old, tmp, { rewrite: homeRewrite(old), link: false }); }
  catch (err) { fs.rmSync(tmp, { recursive: true, force: true }); throw err; } // ~/.dsh stays as it was, and the next install can try again
  if (fs.existsSync(home)) {
    for (const e of fs.readdirSync(home)) fs.cpSync(path.join(home, e), path.join(tmp, e), { recursive: true, force: true });
    fs.rmSync(home, { recursive: true });
  }
  fs.renameSync(tmp, home);
  console.log(`data folder: ${old} copied to ${home} (${st.copied} files, ${st.rewritten} rewritten, ${st.renamed} names changed); ${old} stays as it was`);
  for (const l of st.skippedLinks) console.log('  not copied (a link):', l);
}

// The folder beside the archive: the original (with its dsh folder) moves into pristine/ (same drive, so a rename),
// and the Arc copy from the build (hard links and rewritten texts) takes its place.
function installUnpacked() {
  const liveU = live('app.asar.unpacked'), keep = pristine('app.asar.unpacked'), built = path.join(root, 'build', 'app.asar.unpacked');
  if (!fs.existsSync(path.join(built, 'arc'))) throw new Error('no build/app.asar.unpacked/arc; run tools/build.mjs first');
  if (fs.existsSync(path.join(liveU, 'dsh'))) {
    if (fs.existsSync(keep)) throw new Error('pristine/app.asar.unpacked exists already; look before installing');
    fs.renameSync(liveU, keep);
  } else if (fs.existsSync(liveU)) fs.rmSync(liveU, { recursive: true }); // an earlier Arc copy: links and rewritten texts
  makeArcCopy(built, liveU, { rewrite: () => false });
}

// The command and skill files of the runtime: dsh.cmd becomes arc.cmd, old names in their texts move to Arc.
// Every original goes to pristine/runtime first; pristine/runtime-plan.json lists what changed, for the rollback.
const RT = ['runtime/cli', 'runtime/office-skills', 'runtime/bin'];
function installRuntime() {
  const planFile = pristine('runtime-plan.json');
  const plan = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, 'utf8')) : [];
  const done = new Set(plan.map((x) => x.rel));
  const files = [];
  for (const r of RT) if (fs.existsSync(live(r))) (function walk(rel) {
    for (const e of fs.readdirSync(live(rel), { withFileTypes: true })) { const p = rel + '/' + e.name; if (e.isDirectory()) walk(p); else files.push(p); }
  })(r);
  for (const rel of files) {
    if (done.has(rel)) continue;
    const buf = fs.readFileSync(live(rel));
    if (buf.includes(0)) continue; // a program, not a text
    const [t, n] = arcText(buf.toString('utf8'));
    const nn = arcText(rel)[0];
    if (!n && nn === rel) continue;
    fs.mkdirSync(path.dirname(pristine(rel)), { recursive: true });
    fs.copyFileSync(live(rel), pristine(rel));
    plan.push({ rel, nn });
    fs.writeFileSync(planFile, JSON.stringify(plan, null, 2)); // saved before the change, so a failed install can still roll back
    fs.mkdirSync(path.dirname(live(nn)), { recursive: true });
    fs.writeFileSync(live(nn), n ? t : buf);
    if (nn !== rel) fs.unlinkSync(live(rel));
  }
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
  return plan.length;
}
function rollbackRuntime() {
  const planFile = pristine('runtime-plan.json');
  if (!fs.existsSync(planFile)) return 0;
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  for (const { rel, nn } of plan) {
    if (nn !== rel && fs.existsSync(live(nn))) fs.unlinkSync(live(nn));
    fs.copyFileSync(pristine(rel), live(rel));
  }
  fs.unlinkSync(planFile);
  return plan.length;
}
function rollbackUnpacked() {
  const liveU = live('app.asar.unpacked'), keep = pristine('app.asar.unpacked');
  if (!fs.existsSync(keep)) return false;
  if (fs.existsSync(liveU)) fs.rmSync(liveU, { recursive: true }); // the Arc copy: links and rewritten texts
  fs.renameSync(keep, liveU);
  return true;
}

const cmd = path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url) ? process.argv[2] : null; // imported by a test: no command
if (cmd === 'status') {
  const now = sha(live('app.asar'));
  const build = fs.existsSync(path.join(root, 'build', 'app.asar')) ? sha(path.join(root, 'build', 'app.asar')) : null;
  console.log(now === pristineSums['app.asar'] ? 'installed: original DeepSeek Harness archive' : now === build ? 'installed: current Arc Harness build' : 'installed: an archive that matches neither the original nor the current build');
  console.log('update feed file present:', fs.existsSync(live('app-update.yml')));
} else if (cmd === 'install') {
  for (const n of Object.keys(pristineSums)) if (sha(pristine(n)) !== pristineSums[n]) throw new Error('pristine file changed: ' + n);
  const built = path.join(root, 'build', 'app.asar');
  if (!fs.existsSync(built)) throw new Error('no build/app.asar; run tools/build.mjs first');
  const now = sha(live('app.asar'));
  const known = new Set([pristineSums['app.asar'], sha(built)]);
  const prev = path.join(root, 'build', 'INSTALLED.sha');
  if (fs.existsSync(prev)) known.add(fs.readFileSync(prev, 'utf8').trim());
  if (!known.has(now)) throw new Error('the live app.asar is neither the original nor a known Arc build; stop and look');
  migrateHome(); // first: a failed copy must not leave a new app without its data
  swap(built, live('app.asar'));
  swap(path.join(root, 'brand', 'dist', 'icon.png'), live('icon.png'));
  swap(path.join(root, 'brand', 'dist', 'tray.ico'), live('tray.ico'));
  if (fs.existsSync(live('app-update.yml'))) fs.unlinkSync(live('app-update.yml')); // no update feed: the app checks that this file exists
  installUnpacked();
  const rt = installRuntime();
  fs.writeFileSync(prev, sha(live('app.asar')));
  console.log('installed Arc Harness build', sha(live('app.asar')).slice(0, 16), `(side folder with Arc names; ${rt} runtime files with Arc names)`);
} else if (cmd === 'rollback') {
  for (const n of Object.keys(pristineSums)) { swap(pristine(n), live(n)); }
  const u = rollbackUnpacked(), rt = rollbackRuntime();
  console.log('restored the original files:', Object.keys(pristineSums).join(', '), u ? '+ app.asar.unpacked' : '', rt ? `+ ${rt} runtime files` : '');
} else if (cmd !== null) {
  console.log('usage: node tools/install.mjs install | rollback | status');
  process.exit(2);
}
