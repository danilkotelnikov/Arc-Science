// Checks the built archive against the pristine one: every changed JS file still parses, no whale outline or old
// product name is left in the changed code, and every file that did not change is byte-identical.
// Run: node test/build-check.mjs [build/app.asar] <scratch dir>
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openAsar } from '../lib/asar.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = openAsar(path.resolve(process.argv[2] || path.join(root, 'build', 'app.asar')));
const pristine = openAsar(path.join(root, 'pristine', 'app.asar'));
const tmp = fs.mkdtempSync(path.join(process.argv[3] || os.tmpdir(), 'arc-check-'));
let bad = 0;
const check = (ok, label) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); };

const changed = [];
let identical = 0;
for (const f of pristine.files) {
  if (f.entry.unpacked) continue;
  const g = built.byPath.get(f.path);
  if (!g) { changed.push({ path: f.path, removed: true }); continue; }
  if (f.entry.size === g.entry.size && pristine.read(f).equals(built.read(g))) identical++; else changed.push({ path: f.path, buf: built.read(g) });
}
const removedCount = changed.filter((c) => c.removed).length;
const pristinePaths = new Set(pristine.files.map((f) => f.path));
const addedPaths = built.files.filter((f) => !pristinePaths.has(f.path)).map((f) => f.path);
check(built.files.length === pristine.files.length - removedCount + addedPaths.length, `file count = pristine ${pristine.files.length} minus ${removedCount} removed documents plus ${addedPaths.length} added`);
check(addedPaths.every((p) => /\/locale\/en\.json$/.test(p)), 'the only added files are plugin-name locale files');
check(changed.filter((c) => c.removed).every((c) => /\.zh[^/]*\.md$|README\.i18n\.yaml$/.test(c.path)), 'only Chinese documents were removed');
check(changed.length > 0 && changed.length < 2000, `${changed.length} files changed or removed, ${identical} identical`);

let parsed = 0;
for (const c of changed) {
  if (!/\.(js|mjs|cjs)$/.test(c.path) || !c.buf) continue;
  const f = path.join(tmp, 'f' + parsed++ + '.mjs');
  fs.writeFileSync(f, c.buf);
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  check(r.status === 0, `parses: ${c.path.replace(/.*@deepseek-ai\//, '')}${r.status ? ' :: ' + r.stderr.split('\n').slice(0, 3).join(' | ') : ''}`);
}
for (const c of changed) {
  if (!c.buf || /desktop-runtime\.json$/.test(c.path)) continue;
  const s = c.buf.toString('utf8');
  if (/DeepSeek[  ]Harness/.test(s)) check(false, `old product name left in ${c.path}`);
  if (/M22\.9168 1\.43018/.test(s)) check(false, `whale outline left in ${c.path}`);
}
check(true, 'no old product name or whale outline in changed files');

const rt = JSON.parse(built.read(built.byPath.get('dsh/desktop-runtime.json')).toString('utf8'));
const byPath = new Map(rt.files.map((e) => [e.path, e]));
let stale = 0;
for (const c of changed) {
  if (!c.buf || !c.path.startsWith('dsh/') || /desktop-runtime\.json$/.test(c.path)) continue;
  const e = byPath.get(c.path.slice(4));
  if (e && e.bytes !== c.buf.length) stale++;
}
check(stale === 0, 'runtime manifest sizes match the changed files');
// every packed file under dsh/ that the manifest lists must match its listed hash (a same-length edit would show here)
let hashBad = 0, listed = 0;
for (const f of built.files) {
  if (f.entry.unpacked || !f.path.startsWith('dsh/') || f.path === 'dsh/desktop-runtime.json') continue;
  const e = byPath.get(f.path.slice(4));
  if (!e) continue;
  listed++;
  if (crypto.createHash('sha256').update(built.read(f)).digest('hex') !== e.sha256) hashBad++;
}
check(listed > 10000 && hashBad === 0, `runtime manifest hashes match the packed files (${listed} files compared, ${hashBad} differ)`);
const pj = JSON.parse(built.read(built.byPath.get('package.json')).toString('utf8'));
check(!('dshMandatoryUpdatePolicy' in pj), 'no remote update policy in the app manifest');

// ---- what the build promises, read from the built archive and compared with the pristine one
const brand = JSON.parse(fs.readFileSync(path.join(root, 'brand', 'dist', 'brand.json'), 'utf8'));
const DS = 'dsh/node_modules/@deepseek-ai/';
const get = (a, p) => { const f = a.byPath.get(p); return f ? a.read(f).toString('utf8') : null; };
// colour literals (6-digit hex, rgb, rgba) with a clearly blue hue
const blueColours = (css) => {
  const out = [];
  for (const m of css.matchAll(/#([0-9a-fA-F]{6})(?![0-9a-zA-Z])|rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/g)) {
    const [r, g, b] = (m[1] ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [m[2], m[3], m[4]].map(Number)).map((v) => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    if (!d) continue;
    const s = d / (l > 0.5 ? 2 - mx - mn : mx + mn);
    let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (s > 0.15 && h >= 190 && h <= 280) out.push(m[0]);
  }
  return out;
};

// (a) the welcome window
const wbOld = get(pristine, 'renderer/assets/welcome-brand.svg'), wbNew = get(built, 'renderer/assets/welcome-brand.svg');
const wbPaths = [...wbOld.matchAll(/\bd="([^"]{150,})"/g)].map((m) => m[1]);
check(wbNew !== null && wbNew !== wbOld, 'welcome wordmark differs from the pristine image');
check(wbNew.includes('class="ink"') && wbNew.includes(`d="${brand.leftAS}"`), 'welcome wordmark has the ink class and the AS left face');
check(wbPaths.length > 10 && wbPaths.every((d) => !wbNew.includes(d)), `welcome wordmark keeps none of the ${wbPaths.length} old whale and wordmark paths`);
const winCss = get(built, 'renderer/welcome.css'), tokCss = get(built, 'lib/welcome/welcome.css');
check(winCss.includes('--dsw-alias-brand-primary: #54453c;') && winCss.includes('--dsw-alias-brand-primary: #ede6d8;'), 'welcome window style: brand primary #54453c (light) and #ede6d8 (dark)');
check(blueColours(winCss).length === 0, 'welcome window style: no blue colour' + (blueColours(winCss).length ? ' :: ' + blueColours(winCss).join(' ') : ''));
check(/--dsw-alias-brand-primary: #54453c/.test(tokCss) && /--dsw-alias-brand-primary: #ede6d8/.test(tokCss), 'welcome token sheet: brand primary #54453c (light) and #ede6d8 (dark)');
check(!/rgb\(65, 118, 230\)/.test(tokCss) && !/deepseek/i.test(tokCss), 'welcome token sheet: no vendor blue, no vendor name in a variable');
check(!/--dsw-static-(?:blue|accent)-[\w-]+:\s*rgb\(/.test(tokCss), 'welcome token sheet: every blue and accent token is recolored');
check(blueColours(tokCss).length === 0, 'welcome token sheet: no blue colour' + (blueColours(tokCss).length ? ' :: ' + blueColours(tokCss).slice(0, 5).join(' ') : ''));
const mainJs = get(built, 'lib/main.js');
check(mainJs.includes('return false; // Arc Harness has no vendor sign-in') && !mainJs.includes('return !authentication.loggedIn && !authentication.hasApiKey;'), 'welcome gate patch in lib/main.js: startup skips the welcome window');
check(mainJs.includes('enabled = () => false') && !/existsSync\(join\(process\.resourcesPath, "app-update\.yml"\)\)/.test(mainJs), 'update coordinator is off by default and no longer asks for app-update.yml');

// (b) fingerprints of the old artwork: none may occur in any text file of the built archive
const prints = [...wbPaths, 'M22.9168 1.43018'];
const printHits = new Map();
let printFiles = 0;
for (const f of built.files) {
  if (f.entry.unpacked || !/\.(c|m)?js$|\.svg$|\.css$|\.html?$|\.json$/i.test(f.path)) continue;
  const s = built.read(f).toString('utf8');
  printFiles++;
  for (const p of prints) if (s.includes(p)) printHits.set(f.path, (printHits.get(f.path) || 0) + 1);
}
check(printHits.size === 0, `${prints.length} fingerprints of the old whale and wordmark occur in none of ${printFiles} text files` + (printHits.size ? ' :: ' + [...printHits.keys()].slice(0, 5).join(' | ') : ''));

// (c) what acceptance text A3 promises
const allJs = get(built, 'dsh/node_modules/@earendil-works/pi-ai/dist/providers/all.js');
check(allJs !== null && !/deepseekProvider|\.\/deepseek\.js/.test(allJs), 'provider registry no longer imports or calls the DeepSeek provider');
const rowOff = (yml, id) => {
  const start = yml.indexOf(`- id: ${id}\n`);
  if (start < 0) return false;
  const next = yml.indexOf('\n    - id:', start + 1);
  return /^\s+disabled:\s*true\s*$/m.test(yml.slice(start, next < 0 ? yml.length : next));
};
const baseYml = get(built, DS + 'dsh-base/cordis.patch.yml'), webYml = get(built, DS + 'dsh-web-app/cordis.patch.yml');
check(rowOff(baseYml, 'session-telemetry-otel') && rowOff(webYml, 'desktop-product-telemetry') && rowOff(webYml, 'product-analytics'), 'the three telemetry rows are disabled: true');
const CATALOG = ['dist/api/openai-completions.js', 'dist/providers/data/deepseek.json', 'dist/providers/deepseek.js'].map((p) => 'dsh/node_modules/@earendil-works/pi-ai/' + p);
const realHost = /deepseek\.(com|cn|ai)\b/i;
check(CATALOG.every((p) => realHost.test(get(pristine, p)) && !realHost.test(get(built, p)) && get(built, p).includes('arc-harness.invalid')), 'the three catalog files that carried DeepSeek addresses have none left');

// (d) the logo: the AS cube at every size
const bundle = get(built, DS + 'dsh-web-frontend/dist/assets/index-BXV-oxvX.js');
const gA = bundle.slice(bundle.indexOf('function gA('), bundle.indexOf('function vA('));
check(gA.length > 20 && gA.includes(JSON.stringify(brand.leftAS)) && !/e>32/.test(gA), 'logo mark gA returns the AS cube at every size (no size switch)');
for (const f of ['favicon.svg', 'favicon-dark.svg']) check(get(built, DS + 'dsh-web-frontend/dist/' + f).includes(`d="${brand.leftAS}"`), `${f} carries the AS left face`);
// the raster logo files (app icon, tray icon) and the SVG files of brand/dist match the committed hash list, so a plain-cube tile cannot slip in
{
  const sums = fs.readFileSync(path.join(root, 'brand', 'dist', 'SHA256SUMS.txt'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split(/\s+/));
  const off = sums.filter(([h, f]) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'brand', 'dist', f))).digest('hex') !== h).map(([, f]) => f);
  check(sums.length >= 7 && off.length === 0, `brand/dist files match brand/dist/SHA256SUMS.txt (${sums.length} files${off.length ? ', differ: ' + off.join(', ') : ''}); icon.png and tray.ico carry the AS cube`);
}

// (e) PowerShell help text of the sandbox ACL script says Arc Harness, not DSH
const ps1 = get(built, DS + 'dsh-sandbox-windows-acl/assets/diagnose-windows-sandbox-acl/scripts/diagnose-windows-sandbox-acl.ps1');
check(ps1 !== null && ps1 !== get(pristine, DS + 'dsh-sandbox-windows-acl/assets/diagnose-windows-sandbox-acl/scripts/diagnose-windows-sandbox-acl.ps1') && !/DSH/.test(ps1) && ps1.includes('Arc Harness'), 'sandbox ACL script: help text no longer says DSH');

// (f) the badge skill: image, Markdown, skill description and package texts carry no vendor logo, name, whale or old colour
const BD = DS + 'dsh-skill-badge/', BB = DS + 'dsh-experimental-badge-skill-bundle/';
const vendorWords = /deepseek|\bdsh\b|whale|4D6BFE/i;
const badgePng = built.byPath.get(BD + 'assets/dsh-badge.png');
check(badgePng && built.read(badgePng).equals(fs.readFileSync(path.join(root, 'brand', 'dist', 'icon.png'))), 'badge image is the cube tile (equals brand/dist/icon.png)');
const badgeMd = get(built, BD + 'assets/dsh-badge.md');
// the file name dsh-badge.png stays until the rename slices; every other word counts
check(badgeMd !== null && !vendorWords.test(badgeMd.split('dsh-badge.png').join('')) && /powered by Arc Harness/.test(badgeMd) && badgeMd.includes('26231F') && !/logo=/.test(badgeMd), 'badge Markdown says powered by Arc Harness, colour 26231F, no logo parameter, no vendor word');
const skillDesc = /description: "([^"\n]*)"/.exec(get(built, BD + 'lib/index.js'))?.[1] ?? '';
check(skillDesc.includes('Arc Harness') && !vendorWords.test(skillDesc), 'badge skill description in lib/index.js says Arc Harness');
const badgeTexts = [];
for (const d of [BD, BB]) {
  for (const l of ['en', 'zh']) badgeTexts.push(JSON.stringify(JSON.parse(get(built, `${d}locale/${l}.json`)).meta));
  badgeTexts.push(JSON.parse(get(built, d + 'package.json')).description);
}
check(badgeTexts.every((t) => t.includes('Arc Harness') && !vendorWords.test(t)), `badge locale titles and package descriptions say Arc Harness (${badgeTexts.length} texts)`);

// (g) the account onboarding screenshots are gone
const acct = DS + 'dsh-client-ui-settings-account/lib/client.js';
check((get(pristine, acct).match(/data:image\/webp;base64,/g) || []).length === 8 && !/data:image\/webp/.test(get(built, acct)) && get(built, acct).includes('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), 'account onboarding client: all 8 webp screenshots replaced by the 1x1 GIF');

// (h) no vendor or whale wording in the text of any SVG file (text between > and <, titles and descriptions included)
const svgWords = /deepseek|\bdsh\b|whale/i;
const svgBad = [];
let svgCount = 0;
for (const f of built.files) {
  if (f.entry.unpacked || !/\.svg$/i.test(f.path)) continue;
  svgCount++;
  for (const m of built.read(f).toString('utf8').matchAll(/>([^<>]+)</g)) if (svgWords.test(m[1])) svgBad.push(`${f.path.replace(/.*@deepseek-ai\//, '')} :: ${m[1].trim().slice(0, 50)}`);
}
check(svgCount > 100 && svgBad.length === 0, `no DeepSeek, DSH or Whale text in ${svgCount} SVG files` + (svgBad.length ? ' :: ' + svgBad.slice(0, 5).join(' | ') : ''));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? 'FAILED' : 'ALL PASS');
process.exit(bad ? 1 : 0);
