// A second, independent look at the text a person reads. It shares no code with lib/brandrules.mjs: its own string finder,
// its own patterns, its own allow list (test/independent.allow.json). If the build rules are too narrow, this scan finds what they missed.
//   node test/independent-scan.mjs [archive.asar]    (default build/app.asar)
//   node test/independent-scan.mjs --profiles        plugin packages and local plugins in ~/.dsh
//   add --list for every finding
// It checks itself first: known-bad samples must be found, and each kind of file must give at least the stated number of pieces.
// A scan that reads nothing must fail, not pass.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'independent.allow.json'), 'utf8'));
const args = process.argv.slice(2);

const MODELS = cfg.models.map((s) => new RegExp(s, 'g'));
const COMMANDS = cfg.commands.map((s) => new RegExp(s, 'g'));
const strip = (s) => { let t = s.replace(/https?:\/\/\S+/g, ' '); for (const re of [...MODELS, ...COMMANDS]) t = t.replace(re, ' '); return t; };

// what counts as a finding in one piece of text
const PATTERNS = [
  ['DeepSeek', /DeepSeek(?![A-Za-z])/],
  ['DEEPSEEK', /(?<![A-Za-z_])DEEPSEEK(?![A-Za-z_])/],
  ['DSH', /(?<![A-Za-z_])DSH(?![_A-Za-z])/],
  ['Whale', /(?<![A-Za-z0-9_])Whales?(?![A-Za-z0-9_])/], // a camel-case class name such as runningWhaleStill is not a word
  ['whale', /(?<![\w-])whales?(?![\w-])/],
  // lower case names stand alone only in prose (spaces around them, no hyphen, dot, slash, colon, at sign or underscore touching)
  ['dsh word', /(?<![\w@./:$-])dsh(?![\w@/:.-])/],
  ['deepseek word', /(?<![\w@./:$-])deepseek(?![\w@/:.-])/],
];
// addresses of DeepSeek services and of the old vendor, checked on the whole text, links included
const ADDRESS = /deepseek(?:svc|cdn)?\.(?:com|ai|cn|net|org|io|dev|app|co)(?![\w-])|deepseek-ai\.github\.io|github\.com\/deepseek-ai|trtgsjkv6r\.feishu\.cn|r2049\.cn/i;
export function findIn(text) {
  const t = strip(text);
  const out = [];
  if (ADDRESS.test(text)) out.push('address');
  for (const [id, re] of PATTERNS) if (re.test(t)) out.push(id);
  return out;
}

// Strings of a script. A small reader that skips comments, so the words of a comment are not taken for text a person reads.
// Plain strings end at the end of the line. A template string may span lines. A backslash outside a string skips the next character (regular expressions).
function* strings(text) {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (c === '\\') { i += 2; continue; }
    if (c === '/' && d === '/') { const e = text.indexOf('\n', i); if (e < 0) return; i = e + 1; continue; }
    if (c === '/' && d === '*') { const e = text.indexOf('*/', i + 2); if (e < 0) return; i = e + 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      if (text[j] === c) yield text.slice(i + 1, j);
      i = j + 1; continue;
    }
    if (c === '`') {
      let j = i + 1, depth = 0;
      while (j < n) {
        if (text[j] === '\\') { j += 2; continue; }
        if (depth === 0 && text[j] === '`') break;
        if (text[j] === '$' && text[j + 1] === '{') { depth++; j += 2; continue; }
        if (depth > 0 && text[j] === '}') depth--;
        j++;
      }
      yield text.slice(i + 1, j);
      i = j + 1; continue;
    }
    i++;
  }
}
function jsonValues(v, out) { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => jsonValues(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => jsonValues(x, out)); }

// Every piece carries its kind: md (lines of prose), pkg (description, title), json (all string values), js (quoted strings).
export function pieces(file, text) {
  const base = path.basename(file).toLowerCase();
  const out = [];
  if (/\.(md|markdown|txt|html?)$/i.test(file)) {
    if (!/^(license|licence|notice|changelog)/i.test(base)) for (const l of text.split(/\r?\n/)) { if (l.trim()) out.push({ kind: 'md', text: l }); }
  } else if (base === 'package.json') {
    try { const j = JSON.parse(text.replace(/^﻿/, '')); for (const k of ['description', 'title', 'displayName']) if (typeof j[k] === 'string') out.push({ kind: 'pkg', text: j[k] }); } catch { /* skip */ }
  } else if (/\.json$/i.test(file)) {
    if (!/package-lock\.json$|\.map$/i.test(base)) { try { const v = []; jsonValues(JSON.parse(text.replace(/^﻿/, '')), v); for (const x of v) out.push({ kind: 'json', text: x }); } catch { /* skip */ } }
  } else if (/\.(c|m)?js$/i.test(file)) {
    for (const x of strings(text)) out.push({ kind: 'js', text: x });
  }
  return out;
}

const SKIP = new RegExp(cfg.skipFiles.join('|'));
const TIER = new Set(['dsh word', 'deepseek word']); // names of the command and of providers: the rename slices (ARC-RENAME-2) handle them
const hits = [];
const tierHits = [];
const counts = { md: 0, pkg: 0, json: 0, js: 0 };
let files = 0;
export function check(kind, piece) {
  const ids = findIn(piece);
  // A script string without a space and a JSON value without a space is a name, an id or a path: only a bare brand word (a label) or an address counts there.
  if ((kind === 'js' || kind === 'json') && !/\s/.test(piece)) return ids.filter((id) => id === 'address' || /^(DeepSeek|DEEPSEEK|DSH|Whale)$/.test(piece));
  return ids;
}
function scan(file, text) {
  if (SKIP.test(file.replace(/\\/g, '/'))) return;
  files++;
  for (const p of pieces(file, text)) {
    counts[p.kind]++;
    for (const id of check(p.kind, p.text)) (TIER.has(id) ? tierHits : hits).push({ file, rule: id, text: p.text.replace(/\s+/g, ' ').slice(0, 130) });
  }
}

// ---- self-check: known-bad samples must be found, known-good samples must pass -----------------------------------
function selfCheck() {
  const bad = [];
  const expect = (label, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${label}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };
  const ids = (f, t) => pieces(f, t).flatMap((p) => check(p.kind, p.text));
  expect('js sentence', ids('a/x.js', 'const a = "Powered by DeepSeek today";'), ['DeepSeek']);
  expect('js short label', ids('a/x.js', 'const a = "DSH";'), ['DSH']);
  expect('js long string', ids('a/x.js', `const a = "${'word '.repeat(150)}Whale mascot";`), ['Whale']);
  expect('js one-word brand label', ids('a/x.js', "const a = 'DeepSeek';"), ['DeepSeek']);
  expect('js address in a link', ids('a/x.js', 'const a = "see https://platform.deepseek.dev/docs for help";'), ['address']);
  expect('js repo link', ids('a/x.js', 'const a = "https://github.com/deepseek-ai/thing";'), ['address']);
  expect('js id stays', ids('a/x.js', 'const a = "dsh-web-app"; const b = "whale";'), []);
  expect('js class name stays', ids('a/x.js', 'const c = "runningWhaleAnimated"; const d = "DeepSeek-Harness-MIT.txt";'), []);
  expect('css class name inside a long string', ids('a/x.js', 'const css = ".V4vHZW_runningWhaleAnimated{display:none} .b{color:red}";'), []);
  expect('js comment is not text', ids('a/x.js', '// the DeepSeek note\n/** About DSH and its Whale */ const a = 1; /\\//.test(b); const e = "fine text here";'), []);
  expect('js string after a comment', ids('a/x.js', '/* DSH */ const a = "Say DeepSeek twice";'), ['DeepSeek']);
  expect('js template string', ids('a/x.js', 'const a = `About ${x} the Whale`;'), ['Whale']);
  expect('js model name stays', ids('a/x.js', 'const a = "Use DeepSeek V4 Pro for this";'), []);
  expect('package.json description', ids('a/package.json', '{"description":"The DeepSeek harness"}'), ['DeepSeek']);
  expect('json string value', ids('a/en.json', '{"k":"Open the Whale menu"}'), ['Whale']);
  expect('json in a folder named i18n', ids('a/i18n/strings.json', '{"k":"About DSH"}'), ['DSH']);
  expect('md line', ids('a/x.md', 'first\n\nAbout DeepSeek\n'), ['DeepSeek']);
  expect('md license skipped', ids('a/LICENSE.md', 'DeepSeek\n'), []);
  return bad;
}
// each kind of file must give a minimum number of pieces, or the scan read the wrong things (floors for the full archive and for the profiles)
const FLOOR = { archive: { md: 2000, pkg: 200, json: 20000, js: 100000 }, profiles: { md: 2000, pkg: 200, json: 20000, js: 100000 } };

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const bad = selfCheck();
  if (bad.length) { for (const b of bad) console.error('SELF-CHECK FAIL ' + b); process.exit(3); }
  const profiles = args.includes('--profiles');
  if (profiles) {
    const h = path.join(os.homedir(), '.dsh');
    const walk = function* (d, depth = 0) { let e; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const x of e) { const p = path.join(d, x.name); if (x.isDirectory()) { if (x.name === '.pnpm' || x.name === '.bin' || x.name.startsWith('_archive')) continue; if (depth < 6) yield* walk(p, depth + 1); } else yield p; } };
    for (const d of [path.join(h, 'local-plugins'), path.join(h, 'profiles', 'web', 'node_modules'), path.join(h, 'profiles', 'desktop', 'node_modules')]) {
      for (const p of walk(d)) { if (!/\.(c|m)?js$|\.json$|\.md$|\.html?$|\.txt$/i.test(p)) continue; let st; try { st = fs.statSync(p); } catch { continue; } if (st.size > 6e6) continue; scan(p, fs.readFileSync(p, 'utf8')); }
    }
    try { scan(path.join(h, 'local-gateway.mjs'), fs.readFileSync(path.join(h, 'local-gateway.mjs'), 'utf8')); } catch { /* absent */ }
  } else {
    const { openAsar } = await import(pathToFileURL(path.join(root, 'lib', 'asar.mjs')).href);
    const asar = args.find((a) => a.endsWith('.asar')) || path.join(root, 'build', 'app.asar');
    const a = openAsar(asar);
    for (const f of a.files) {
      if (f.entry.unpacked || f.entry.size > 6e6 || !/\.(c|m)?js$|\.json$|\.md$|\.html?$|\.txt$/i.test(f.path)) continue;
      scan(f.path, a.read(f).toString('utf8'));
    }
  }
  if (files < 1000) { console.error(`only ${files} files scanned`); process.exit(2); }
  const floor = FLOOR[profiles ? 'profiles' : 'archive'];
  const low = Object.keys(floor).filter((k) => counts[k] < floor[k]);
  const per = {};
  for (const h of hits) per[h.rule] = (per[h.rule] || 0) + 1;
  console.log(`independent scan: ${files} files, pieces ${JSON.stringify(counts)}, ${hits.length} findings ${JSON.stringify(per)}; lower case names of the command and providers (rename slices): ${tierHits.length}`);
  if (low.length) console.error(`FAIL too few pieces of kind ${low.join(', ')} (floors ${JSON.stringify(floor)}): the scan did not read what it should`);
  for (const h of (args.includes('--list') ? hits : hits.slice(0, 40))) console.log(`  [${h.rule}] ${h.file.replace(/^dsh\/node_modules\//, '')} :: ${h.text}`);
  const j = args.indexOf('--json'); if (j >= 0) fs.writeFileSync(args[j + 1], JSON.stringify(hits, null, 1));
  process.exit(hits.length || low.length ? 1 : 0);
}
