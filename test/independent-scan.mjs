// A second, independent look at the text a person reads. It shares no code with lib/brandrules.mjs: its own string finder,
// its own patterns, its own allow list (test/independent.allow.json). If the build rules are too narrow, this scan finds what they missed.
//   node test/independent-scan.mjs [archive.asar]    (default build/app.asar)
//   node test/independent-scan.mjs --profiles        plugin packages and local plugins in ~/.dsh
//   add --list for every finding
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
  ['Whale', /Whale/],
  ['whale', /(?<![\w-])whales?(?![\w-])/],
  // lower case names stand alone only in prose (spaces around them, no hyphen, dot, slash, colon, at sign or underscore touching)
  ['dsh word', /(?<![\w@./:$-])dsh(?![\w@/:.-])/],
  ['deepseek word', /(?<![\w@./:$-])deepseek(?![\w@/:.-])/],
];
export function findIn(text) {
  const t = strip(text);
  const out = [];
  if (/deepseek(?:svc)?\.(?:com|ai|cn)/i.test(text)) out.push('address'); // on the whole text, links included
  for (const [id, re] of PATTERNS) if (re.test(t)) out.push(id);
  return out;
}

// quoted strings of a script: a plain pattern, no lexer (it may take a few comment words too, which is fine for a second opinion)
const QUOTED = /"((?:[^"\\\n]|\\.){4,400})"|'((?:[^'\\\n]|\\.){4,400})'|`((?:[^`\\]|\\.){4,400})`/g;
function* strings(text) { let m; QUOTED.lastIndex = 0; while ((m = QUOTED.exec(text))) yield m[1] ?? m[2] ?? m[3]; }
function jsonValues(v, out) { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => jsonValues(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => jsonValues(x, out)); }

export function pieces(file, text) {
  const base = path.basename(file).toLowerCase();
  const out = [];
  if (/\.(md|markdown|txt|html?)$/i.test(file) && !/^(license|licence|notice|changelog)/i.test(base)) for (const l of text.split(/\r?\n/)) if (l.trim()) out.push(l);
  else if (base === 'package.json') { try { const j = JSON.parse(text.replace(/^﻿/, '')); for (const k of ['description', 'title', 'displayName']) if (typeof j[k] === 'string') out.push(j[k]); } catch { /* skip */ } }
  else if (/\.json$/i.test(file) && /(^|[\\/])(locale|locales|docs)[\\/]/i.test(file)) { try { const v = []; jsonValues(JSON.parse(text), v); for (const x of v) out.push(x); } catch { /* skip */ } }
  else if (/\.(c|m)?js$/i.test(file)) for (const x of strings(text)) out.push(x);
  return out;
}

const SKIP = new RegExp(cfg.skipFiles.join('|'));
const TIER = new Set(['dsh word', 'deepseek word']); // names of the command and of providers: the rename slices (ARC-RENAME-2) handle them
const hits = [];
const tierHits = [];
let files = 0;
function scan(file, text) {
  if (SKIP.test(file.replace(/\\/g, '/'))) return;
  files++;
  for (const piece of pieces(file, text)) {
    // identifiers in JS code are not prose: a piece without a space and without capital letters is a name, an id or a path
    if (/\.(c|m)?js$/i.test(file) && !/\s/.test(piece)) continue;
    for (const id of findIn(piece)) (TIER.has(id) ? tierHits : hits).push({ file, rule: id, text: piece.replace(/\s+/g, ' ').slice(0, 130) });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (args.includes('--profiles')) {
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
  const per = {};
  for (const h of hits) per[h.rule] = (per[h.rule] || 0) + 1;
  console.log(`independent scan: ${files} files, ${hits.length} findings ${JSON.stringify(per)}; lower case names of the command and providers (rename slices): ${tierHits.length}`);
  for (const h of (args.includes('--list') ? hits : hits.slice(0, 40))) console.log(`  [${h.rule}] ${h.file.replace(/^dsh\/node_modules\//, '')} :: ${h.text}`);
  const j = args.indexOf('--json'); if (j >= 0) fs.writeFileSync(args[j + 1], JSON.stringify(hits, null, 1));
  process.exit(hits.length ? 1 : 0);
}
