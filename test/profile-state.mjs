// Ties the evidence of a test run to one state of the data home (~/.dsh), which is outside git.
//   node test/profile-state.mjs
// 1. every file that brandtext/apply-profiles.mjs rewrote has the hash in the committed list brandtext/profile-state.json
// 2. the profile settings say what the slice decided (skill-badge off, the remote plugin off, no DeepSeek provider routes, Radium default model on the web profile)
// 3. the Visualize plugin keeps every style id as a key of its style table, and no style id carries an old brand word (the settings page shows the id)
// 4. the two helper plugins that looked for updates at the public registry and at GitHub no longer name either address
// 5. the theme plugin copies in both profiles are byte for byte the tested copy in local-plugins
// 6. a tree digest of everything the scans read (per profile, local plugins, the two settings files) is printed, so the evidence names the exact state
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataHome } from '../lib/testhome.mjs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = os.homedir();
const dsh = path.join(dataHome());
let bad = 0;
const check = (ok, label) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const read = (p) => { try { return fs.readFileSync(p); } catch { return null; } };

// 1. file hashes
const list = JSON.parse(fs.readFileSync(path.join(root, 'brandtext', 'profile-state.json'), 'utf8')).files;
let differ = 0, missing = 0;
for (const [rel, hash] of Object.entries(list)) {
  const file = rel.startsWith('~/') ? path.join(home, rel.slice(2)) : path.join(path.parse(home).root, rel);
  const buf = read(file);
  if (!buf) { missing++; continue; }
  if (sha(buf) !== hash) { differ++; if (differ <= 5) console.log('  differs: ' + rel); }
}
check(Object.keys(list).length > 500 && differ === 0 && missing === 0, `rewritten files match the committed list (${Object.keys(list).length} files, ${differ} differ, ${missing} missing)`);

// 2. profile settings
const cfg = {};
for (const prof of ['web', 'desktop']) {
  const y = fs.readFileSync(path.join(dsh, 'profiles', prof, 'cordis.patch.yml'), 'utf8');
  cfg[prof] = y;
  check(/- id: skill-badge\s*\n\s+name: [^\n]+\n\s+disabled: true/.test(y), `${prof}: the skill-badge row is disabled`);
  check(/- id: ds-harness-remote\s*\n\s+disabled: true/.test(y), `${prof}: the remote plugin row is disabled`);
  check(!/deepseek-official/.test(y), `${prof}: no deepseek-official route in the profile settings`);
}
check(/- id: agent-default-model[\s\S]{0,200}provider: radium\s*\n\s+model: hal-1\.0/.test(cfg.web), 'web: the default model is Radium HAL 1.0');

// 3. the Visualize plugin: every style id is a key of the style table; the settings page shows the id, so it carries no brand word
for (const prof of ['web', 'desktop']) {
  const viz = path.join(dsh, 'profiles', prof, 'node_modules', '@nagi-ovo', 'dsh-visualize', 'lib', 'index.js');
  const buf = read(viz);
  check(!!buf, `${prof}: the Visualize plugin is installed`);
  if (!buf) continue;
  const t = buf.toString('utf8');
  const ids = [...(/const STYLE_IDS = \[([^\]]*)\]/.exec(t)?.[1] ?? '').matchAll(/"([\w-]+)"/g)].map((m) => m[1]);
  const table = /const STYLES = \{([\s\S]*?)\n\};/.exec(t)?.[1] ?? '';
  const keys = [...table.matchAll(/^\t(?:"([\w-]+)"|([\w-]+)): \{/gm)].map((m) => m[1] ?? m[2]);
  const missingKeys = ids.filter((id) => !keys.includes(id));
  check(ids.length >= 3 && missingKeys.length === 0, `${prof} Visualize: every style id is a key of the style table (${ids.length} ids, missing: ${missingKeys.join(', ') || 'none'})`);
  check(!ids.some((id) => /whale|deepseek|dsh/i.test(id)), `${prof} Visualize: no style id carries an old brand word (${ids.join(', ')})`);
}

// 4. no update check at the public registry or at GitHub: the two helper plugins (every script of their lib folder) and every
//    plugin-updater or update-check script of any package in the profile (the two @michengai plugins carry such scripts)
const REGISTRY = /registry\.npm(?:js\.org|mirror\.com)|api\.github\.com/;
for (const prof of ['web', 'desktop']) {
  const found = [];
  let updaters = 0;
  const walk = (d, depth, every) => {
    let e; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const x of e) {
      const p = path.join(d, x.name);
      if (x.isDirectory()) { if (x.name === '.pnpm' || depth > 12) continue; walk(p, depth + 1, every); continue; }
      const isUpdater = /^(?:plugin-updater|update-check)\.(?:c|m)?js$/.test(x.name);
      if (!(isUpdater || (every && /\.(c|m)?js$/.test(x.name)))) continue;
      if (isUpdater) updaters++;
      if (REGISTRY.test(fs.readFileSync(p, 'utf8'))) found.push(path.relative(dsh, p));
    }
  };
  const nm = path.join(dsh, 'profiles', prof, 'node_modules');
  walk(nm, 0, false);
  for (const pkg of ['dsh-context', 'dsh-vision-router']) walk(path.join(nm, pkg, 'lib'), 0, true);
  check(found.length === 0 && updaters >= 3, `${prof}: no update script and no helper plugin script names the public registry or GitHub (${updaters} updater scripts read)${found.length ? ': ' + found.slice(0, 3).join(', ') : ''}`);
}

// 4b. sentences a person reads: the manager plugins show no registry address in their update command, and the Vision Router
//     settings text names no provider id of the old vendor (the ids stay in the plugin code)
for (const prof of ['web', 'desktop']) {
  const nm = path.join(dsh, 'profiles', prof, 'node_modules');
  const managers = ['dsh-archive-manager', 'dsh-skills-manager'].map((n) => path.join(nm, '@michengai', n, 'lib', 'client.js'));
  const withRegistry = managers.filter((f) => /--registry=https?:\/\/registry\.npmjs\.org/.test(fs.readFileSync(f, 'utf8')));
  check(withRegistry.length === 0, `${prof}: the manager plugins' update command names no registry address${withRegistry.length ? ': ' + withRegistry.map((f) => path.basename(path.dirname(path.dirname(f)))).join(', ') : ''}`);
  const vr = fs.readFileSync(path.join(nm, 'dsh-vision-router', 'lib', 'client.js'), 'utf8');
  // sentences only: the code keeps ids such as 'deepseek-official' as plain strings (a route name, a provider group id)
  const ids = [/llm-deepseek/, /deepseek-official\/deepseek/, /(?:over|rebuilds|reconstructs) deepseek-official/].filter((re) => re.test(vr)).map(String);
  check(ids.length === 0, `${prof}: the Vision Router settings text names no provider id of the old vendor${ids.length ? ' (found ' + ids.join(', ') + ')' : ''}`);
}

// 4c. colours a person sees in two plugins that the hue recolor alone could not decide: the Context Insights chart categories (a
//     Tailwind blue, indigo, violet and purple, and a hue that walks the whole wheel) and the Visualize interface colours; and the
//     bundled terminal keeps its ANSI blue (the hue recolor must not touch vendored libraries)
for (const prof of ['web', 'desktop']) {
  const nm = path.join(dsh, 'profiles', prof, 'node_modules');
  const ctx = fs.readFileSync(path.join(nm, 'dsh-context', 'lib', 'client.js'), 'utf8');
  // every oklch colour token of the file whose hue is blue or violet (215 to 335) with some chroma
  const blueTokens = [...ctx.matchAll(/--color-([a-z]+-\d+):oklch\(\s*[\d.]+%?\s+([\d.]+)\s+([\d.]+)/g)].filter((m) => +m[2] >= 0.035 && +m[3] >= 215 && +m[3] <= 335).map((m) => m[1]);
  check(blueTokens.length === 0, `${prof}: Context Insights has no oklch colour token in blue or violet${blueTokens.length ? ' (' + blueTokens.join(', ') + ')' : ''}`);
  // the member colour: the golden-angle spread scaled into the warm range, with a lightness step (distinct neighbours, no blue)
  check(ctx.includes('(Math.round(e*137.508)%360)*0.4+8') && ctx.includes('${42+(e%3)*7}%') && !ctx.includes('%360} 58% 52%'), `${prof}: Context Insights member colours use the warm scaled spread with a lightness step`);
  const viz = fs.readFileSync(path.join(nm, '@nagi-ovo', 'dsh-visualize', 'lib', 'client.js'), 'utf8');
  check(!/#2f6fed/i.test(viz) && !/"primary": ld\("#(?:0072b2|2d71b7)"/.test(viz) && !viz.includes('rgb(65 118 230)') && !viz.includes('rgb(110 150 240)'), `${prof}: Visualize interface colours (selected option, focus outline, primary colour and its fallbacks) are not blue`);
  const term = fs.readFileSync(path.join(nm, 'dsh-better-sidebar', 'lib', 'client-terminal.js'), 'utf8');
  check(/#3465a4/i.test(term), `${prof}: the bundled terminal keeps its ANSI blue (vendored libraries are not recolored)`);
}

// 5. the theme plugin copies equal the tested copy
{
  const src = path.join(dsh, 'local-plugins', 'arc-theme', 'lib');
  const files = [];
  const walk = (d) => { for (const x of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, x.name); if (x.isDirectory()) walk(p); else files.push(path.relative(src, p)); } };
  walk(src);
  for (const prof of ['web', 'desktop']) {
    const dst = path.join(dsh, 'profiles', prof, 'node_modules', 'arc-theme', 'lib');
    const off = files.filter((f) => { const a = read(path.join(src, f)), b = read(path.join(dst, f)); return !a || !b || sha(a) !== sha(b); });
    check(files.length > 0 && off.length === 0, `${prof}: the theme plugin copy equals the tested copy (${files.length} files${off.length ? ', differ: ' + off.slice(0, 3).join(', ') : ''})`);
  }
}

// 6. tree digests of what the scans read
const READ = /\.(c|m)?jsx?$|\.json$|\.md$|\.html?$|\.txt$|\.svg$|\.css$|\.ya?ml$|\.ps1$/i;
function digest(dir) {
  const rows = [];
  const walk = (d, depth) => {
    let e; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const x of e) {
      const p = path.join(d, x.name);
      if (x.isDirectory()) { if (x.name === '.pnpm' || x.name === '.bin' || x.name.startsWith('_archive')) continue; if (depth < 12) walk(p, depth + 1); }
      else if (READ.test(x.name)) { try { if (fs.statSync(p).size > 6e6) continue; rows.push(path.relative(dir, p).replace(/\\/g, '/') + '\0' + sha(fs.readFileSync(p))); } catch { /* skip */ } }
    }
  };
  walk(dir, 0);
  rows.sort();
  return { n: rows.length, hash: sha(rows.join('\n')) };
}
for (const [name, dir] of [['web', path.join(dsh, 'profiles', 'web', 'node_modules')], ['desktop', path.join(dsh, 'profiles', 'desktop', 'node_modules')], ['local-plugins', path.join(dsh, 'local-plugins')]]) {
  const d = digest(dir);
  check(d.n > 50, `tree digest ${name}: ${d.hash.slice(0, 16)} (${d.n} files)`);
}
for (const prof of ['web', 'desktop']) console.log(`     settings ${prof}: ${sha(Buffer.from(cfg[prof])).slice(0, 16)}`);
process.exit(bad ? 1 : 0);
