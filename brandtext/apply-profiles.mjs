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
import { recolorSvg, recolorBlueAttrsInScript, replaceVendorBlue, recolorBlueHues, HUE_PROFILE } from '../lib/iconcolor.mjs';
import { swapPicture } from '../lib/whaleimg.mjs';

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
    if (e.isDirectory()) { if (e.name === '.pnpm' || e.name === '.bin' || e.name.startsWith('_archive')) continue; if (depth < 12) yield* walk(p, depth + 1); }
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
  let n = 0, changedSince = 0;
  // A file whose hash differs from the committed list was edited after the rewrite: it is left alone unless --force is given,
  // so a restore never wipes newer work. A path with .. is refused: the list is read from an archive.
  let known = {};
  try { known = JSON.parse(fs.readFileSync(path.join(here, 'profile-state.json'), 'utf8')).files || {}; } catch { /* no list yet */ }
  const force = args.includes('--force');
  const drive = path.parse(os.homedir()).root;
  for (const rel of JSON.parse(fs.readFileSync(path.join(stage, 'list.json'), 'utf8'))) {
    if (rel.split('/').includes('..') || path.isAbsolute(rel)) { console.error('refused an unsafe path in the originals list: ' + rel); process.exit(1); }
    const target = path.join(drive, rel);
    const expected = known[rel.replace(/^Users\/[^/]+\//, '~/')];
    if (expected && !force) {
      let cur = null; try { cur = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'); } catch { /* absent: restore it */ }
      if (cur && cur !== expected) { changedSince++; console.log('changed after the rewrite, left alone: ' + rel); continue; }
    }
    const tmp = target + '.arc-tmp';
    fs.copyFileSync(path.join(stage, 'files', rel), tmp);
    fs.renameSync(tmp, target);
    n++;
  }
  fs.rmSync(stage, { recursive: true, force: true });
  console.log(`restored ${n} files` + (changedSince ? `, ${changedSince} left alone because they changed after the rewrite (use --force to overwrite them)` : ''));
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
// Files that stay as they were. dsh-hoh is a plugin of the owner that sends a retrieval query to Cammut at run time; the old
// wording of the query ranks the stored notes, so rewriting it would change what the plugin finds (QA finding, 2026-11-01).
const KEEP = /[\\/]dsh-hoh[\\/]lib[\\/]index\.js$|[\\/]local-plugins[\\/]dsh-english[\\/]/;   // (the second part: a translation tool of this kit with old file copies)
// The Visualize plugin names its first style "whale" in its code (STYLE_IDS, the style table, locale keys) and shows the id on its
// settings page. The id is renamed to "cube" everywhere in the three runtime files at once, so the id and the table keys still agree.
const VISUALIZE_FILES = /@nagi-ovo[\\/]dsh-visualize[\\/]lib[\\/](?:index\.js|client\.js|index\.d\.ts)$/;
const renameStyleId = (text) => text
  .replace(/"whale"/g, '"cube"')
  .replace(/"style\.whale(\.desc)?"/g, (m, d) => `"style.cube${d || ''}"`)
  .replace(/^(\s*)whale: \{/gm, '$1cube: {');
// Sentences whose meaning the mechanical rewrite would change are written by hand. Each pair is "text after the rewrite" and "the sentence".
// The script stops if a text is not found, so a later change of the rules cannot leave a wrong sentence behind.
const FIXES = [
  [/dsh-context[\\/]lib[\\/]client\.js$/, [
    ['Arc Harness list price on models.dev is off-peak;', 'DeepSeek model list prices on models.dev are off-peak rates;'],
    ['Arc Harness’s models.dev rates are its off-peak rates;', 'DeepSeek model rates on models.dev are off-peak rates;'],
    ["Arc Harness's official image-size conversion", "the official DeepSeek model image-size conversion"],
  ]],
  // the version badge on the side card shows the package name in capitals; the package id stays
  [/dsh-better-sidebar[\\/]lib[\\/]client\.js$/, [['children: "DSH-better-sidebar"', 'children: "better-sidebar"']]],
  [/dsh-vision-router[\\/]lib[\\/]official-deepseek-catalog\.js$/, [['the official Arc Harness catalog', 'the official DeepSeek model catalog']]],
  [/dsh-vision-router[\\/]index\.js$/, [['the official Arc Harness catalog is not available', 'the official DeepSeek model catalog is not available']]],
  [/@nagi-ovo[\\/]dsh-visualize[\\/]lib[\\/](?:index|client)\.js$/, [['"Arc Harness · Arc Harness (default)"', '"Arc Harness (default)"']]],
  // Vision Router settings text named the vendor's provider ids in sentences a person reads; the ids stay in the code (QA round 3)
  [/dsh-vision-router[\\/]lib[\\/]client\.js$/, [
    ['for example deepseek-official/deepseek-v4-pro', 'for example my-provider/my-model'],
    ['e.g. deepseek-official/deepseek-v4-pro', 'e.g. my-provider/my-model'],
    ['inputModalities: [text, image] in llm-deepseek and reload', 'inputModalities: [text, image] in the built-in model provider and reload'],
    ['llm-deepseek inputModalities: [text, image]', 'the built-in model provider inputModalities: [text, image]'],
    ['no longer takes over or rebuilds deepseek-official, nor does it require you to disable llm-deepseek.', 'no longer takes over or rebuilds the built-in model provider, nor does it require you to disable it.'],
    ['Please re-enable llm-deepseek, then process', 'Please re-enable the built-in model provider, then process'],
    ['never takes over or reconstructs deepseek-official, nor ', 'never takes over or reconstructs the built-in model provider, nor '],
    ["'asks you to disable llm-deepseek. Custom routes", "'asks you to disable it. Custom routes"],
    ['Re-enable llm-deepseek, then use', 'Re-enable the built-in model provider, then use'],
  ]],
  // Context Insights: the chart categories used the blue, indigo, violet and purple of a Tailwind palette and a golden-angle hue over
  // the whole colour wheel. They become four distinct warm colours and a warm-only hue range, so categories stay apart without blue.
  [/dsh-context[\\/]lib[\\/]client\.js$/, [
    ['--color-blue-500:oklch(62.3% .214 259.815)', '--color-blue-500:oklch(62% .11 78)'],
    ['--color-indigo-500:oklch(58.5% .233 277.117)', '--color-indigo-500:oklch(52% .12 55)'],
    ['--color-violet-500:oklch(60.6% .25 292.717)', '--color-violet-500:oklch(58% .09 128)'],
    ['--color-purple-500:oklch(62.7% .265 303.9)', '--color-purple-500:oklch(58% .13 8)'],
    ['--color-slate-400:oklch(70.4% .04 256.788)', '--color-slate-400:oklch(70.4% .02 80)'],
    // member and subagent colours: the golden-angle spread is kept (neighbours stay apart) and scaled into the warm range 8 to 152
    // degrees; the lightness also steps with the index so that three members never share one colour
    ['hsl(${Math.round(e*137.508)%360} 58% 52%)', 'hsl(${(Math.round(e*137.508)%360)*0.4+8} 42% ${42+(e%3)*7}%)'],
  ]],
  // Visualize: the selected-option border, the focus outline and the primary theme colour were blue (the chart series palettes stay)
  [/@nagi-ovo[\\/]dsh-visualize[\\/]lib[\\/]client\.js$/, [
    ['#2f6fed', '#54453c'],
    ['"primary": ld("#0072b2", "#58b6ed")', '"primary": ld("#54453c", "#d8d3c8")'],
    ['"primary": ld("#2d71b7", "#74c0fc")', '"primary": ld("#54453c", "#d8d3c8")'],
    // the fallbacks of the primary colour (used when the host token is empty)
    ['rgb(65 118 230)', 'rgb(84 69 60)'],
    ['rgb(110 150 240)', 'rgb(216 211 200)'],
  ]],
  // the command shown for a manual plugin update named the public npm registry
  [/@michengai[\\/]dsh-archive-manager[\\/]lib[\\/]client\.js$/, [['add ${r}@${i} --registry=https://registry.npmjs.org/', 'add ${r}@${i}']]],
  [/@michengai[\\/]dsh-skills-manager[\\/]lib[\\/]client\.js$/, [['add ${t}@${d} --registry=https://registry.npmjs.org/', 'add ${t}@${d}']]],
];
const consider = (p) => {
  // PNG pictures that hold the whale are found by their bytes (brand/pictures.json) and replaced by cube pictures
  if (/\.png$/i.test(p) && !skip.test(norm(p)) && !KEEP.test(p)) {
    let st; try { st = fs.statSync(p); } catch { return; }
    if (st.size > 12e6) return;
    const rep = swapPicture(fs.readFileSync(p));
    if (rep) changed.push({ p, after: rep });
    return;
  }
  if (skip.test(norm(p)) || KEEP.test(p) || !/\.(c|m)?js$|\.json$|\.md$|\.html?$|\.css$|\.txt$|\.svg$|\.ya?ml$|\.ps1$|\.(c|m)?tsx?$/i.test(p)) return;
  let st; try { st = fs.statSync(p); } catch { return; }
  if (st.size > 12e6) return;   // (profile packages carry bundled libraries of 7 MB that also hold the plugin's own descriptions)
  scanned++;
  const before = fs.readFileSync(p, 'utf8');
  let after = /\.svg$/i.test(p) ? recolorSvg(rewriteFile(p, before)) : rewriteFile(p, before);
  if (VISUALIZE_FILES.test(p)) after = renameStyleId(after);
  // inline SVG icons in plugin scripts: blue and purple fills become ink, as in the app archive
  if (/\.(c|m)?js$/i.test(p)) after = recolorBlueAttrsInScript(after);
  // the vendor's brand blue as a literal (CSS fallbacks, outlines) becomes the Arc Harness primary
  if (/\.(c|m)?js$|\.css$|\.html?$|\.json$/i.test(p)) after = replaceVendorBlue(after);
  // hand-written replacements first: they give chart categories distinct warm colours, which a grey recolor would merge
  for (const [re, pairs] of FIXES) if (re.test(p)) for (const [from, to] of pairs) { if (!after.includes(from)) { if (after.includes(to)) continue; console.error(`FIX not found in ${p}: ${from}`); process.exit(1); } after = after.split(from).join(to); }
  // every other blue and violet colour in the code of the plugins that draw their own screens (by hue; libraries stay)
  if (HUE_PROFILE.test(p) && /\.(c|m)?js$|\.css$|\.html?$|\.svg$/i.test(p)) after = recolorBlueHues(after);
  // plugins that look for a newer version at the public npm registry and at GitHub (the two helper plugins, and every plugin-updater or
  // update-check script): those checks are off. Installing a plugin by name stays a user action.
  if (/dsh-(context|vision-router)[\\/]lib[\\/].*\.js$|[\\/](?:plugin-updater|update-check)\.js$/.test(p)) {
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
