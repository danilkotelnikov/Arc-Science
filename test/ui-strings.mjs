// Finds DeepSeek, DSH and Whale wording in the text a person can read.
//   node test/ui-strings.mjs [archive.asar]      scans the app archive (default build/app.asar)
//   node test/ui-strings.mjs --profiles          scans plugin packages of both profiles and local plugins
//   add --list to print every finding, --json <file> to write them
// The rules live in lib/brandrules.mjs. Real model names are allowed (test/ui-strings.allow.json).
// Module names, ids, paths and code are not text a person reads, so they are not flagged.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataHome } from '../lib/testhome.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allow, classify, dirtyMarkdownLines, literalRanges, markEscapes } from '../lib/brandrules.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function jsonValues(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) jsonValues(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) jsonValues(x, out);
}

// Which text of a file is user-facing, by file kind
export function surfaceOf(file, text) {
  const base = path.basename(file).toLowerCase();
  const out = [];
  if (/\.(md|markdown|ps1)$/i.test(file)) {
    if (/^(license|licence|changelog|notice|third)/i.test(base)) return out;
    out.push(...dirtyMarkdownLines(text));
  } else if (/\.(txt|html?|ya?ml)$/i.test(file)) {
    if (/LICENSES?\./i.test(base)) return out;
    for (const line of text.split(/\r?\n/)) if (line.trim() && !/<script/i.test(line) && !/^\s*#/.test(line)) out.push(line.trim());
  } else if (base === 'package.json') {
    try {
      const j = JSON.parse(text);
      for (const k of ['description', 'title', 'displayName', 'productName']) if (typeof j[k] === 'string') out.push(j[k]);
      if (Array.isArray(j.keywords)) out.push(...j.keywords.filter((x) => typeof x === 'string'));
    } catch { /* not JSON */ }
  } else if (/\.json$/i.test(file)) {
    if (/(^|[\\/])(locale|locales|i18n|lang|docs)[\\/]/i.test(file) || /(^|\/)(en|zh|ru)\.json$/i.test(file)) {
      try { jsonValues(JSON.parse(text), out); } catch { /* skip */ }
    }
  } else if (/\.(c|m)?js$/i.test(file)) {
    for (const { start, end } of literalRanges(text)) {
      if (end - start > 2 && end - start < 4000) out.push(markEscapes(text.slice(start, end)));
    }
  }
  return out;
}

export function scanFile(file, text) {
  const hits = [];
  for (const s of surfaceOf(file, text)) {
    const id = classify(s);
    if (id) hits.push({ file, rule: id, text: s.replace(/\s+/g, ' ').slice(0, 140) });
  }
  return hits;
}

// Every skip pattern needs a stated reason (allow.skipReasons) and the number of files it skipped is printed.
const READ = /\.(c|m)?js$|\.json$|\.md$|\.html?$|\.txt$|\.ya?ml$|\.ps1$/i;
const SKIP_COUNT = {};
function skipped(list, p) {
  for (const s of list) if (new RegExp(s).test(p)) { SKIP_COUNT[s] = (SKIP_COUNT[s] || 0) + 1; return true; }
  return false;
}
const FLOOR_FILES = 6000;   // about 65 % of the 9,200 files read today in each mode
const DEPTH = 12;

async function scanArchive(asarPath) {
  const { openAsar } = await import(pathToFileURL(path.join(root, 'lib', 'asar.mjs')).href);
  const a = openAsar(asarPath);
  const hits = [];
  let files = 0;
  for (const f of a.files) {
    if (f.entry.unpacked || f.entry.size > 6e6 || /\.map$/.test(f.path) || skipped(allow.archiveSkip, f.path)) continue;
    if (!READ.test(f.path)) continue;
    files++;
    hits.push(...scanFile(f.path, a.read(f).toString('utf8')));
  }
  return { files, hits };
}

function* walk(dir, depth = 0) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === '.pnpm' || e.name === '.bin' || e.name.startsWith('_archive')) continue; if (depth < DEPTH) yield* walk(p, depth + 1); }
    else yield p;
  }
}

function scanDirs(dirs) {
  const hits = [];
  let files = 0;
  const seen = new Set();
  for (const d of dirs) {
    for (const p of walk(d)) {
      const q = p.replace(/\\/g, '/');
      if (skipped(allow.profileSkip, q)) continue;
      if (!READ.test(p)) continue;
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.size > 12e6) continue;
      const key = st.ino ? `${st.dev}:${st.ino}` : p;
      if (seen.has(key)) continue;
      seen.add(key);
      files++;
      hits.push(...scanFile(p, fs.readFileSync(p, 'utf8')));
    }
  }
  return { files, hits };
}

function report(label, { files, hits }, args) {
  const per = new Map();
  for (const h of hits) per.set(h.rule, (per.get(h.rule) || 0) + 1);
  console.log(`${label}: ${files} files scanned, ${hits.length} findings` + (hits.length ? ' (' + [...per].map(([k, n]) => `${k} ${n}`).join(', ') + ')' : ''));
  const shown = args.includes('--list') ? hits : hits.slice(0, 25);
  for (const h of shown) console.log(`  [${h.rule}] ${h.file.replace(/^dsh\/node_modules\//, '')} :: ${h.text}`);
  if (!args.includes('--list') && hits.length > shown.length) console.log(`  ... ${hits.length - shown.length} more (use --list)`);
  const j = args.indexOf('--json');
  if (j >= 0) fs.writeFileSync(args[j + 1], JSON.stringify(hits, null, 1));
  return hits.length;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  let bad = 0;
  const reasons = allow.skipReasons || {};
  const noReason = [...allow.archiveSkip, ...allow.profileSkip].filter((s) => !reasons[s]);
  if (noReason.length) { console.error('SKIP LIST: no reason stated for ' + noReason.join(' ; ')); process.exit(3); }
  const hi = args.indexOf('--dsh-home');
  const fixture = hi >= 0;   // a test folder in place of the data home: the file floor does not apply
  if (args.includes('--profiles')) {
    const home = fixture ? args[hi + 1] : path.join(dataHome());
    const dirs = [path.join(home, 'local-plugins'), path.join(home, 'profiles', 'web', 'node_modules'), path.join(home, 'profiles', 'desktop', 'node_modules')];
    const res = scanDirs(dirs);
    // scripts of the data home that serve a page or open a dialog
    for (const f of [path.join(home, 'local-gateway.mjs')]) {
      try { res.files++; res.hits.push(...scanFile(f, fs.readFileSync(f, 'utf8'))); } catch { /* absent */ }
    }
    if (!fixture && res.files < FLOOR_FILES) { console.error(`profiles: only ${res.files} files scanned (floor ${FLOOR_FILES}); the data home is not where it should be`); process.exit(2); }
    bad += report('profiles', res, args);
  } else {
    const asar = args.find((a) => a.endsWith('.asar')) || path.join(root, 'build', 'app.asar');
    const res = await scanArchive(asar);
    if (res.files < FLOOR_FILES) { console.error(`archive: only ${res.files} files scanned (floor ${FLOOR_FILES}); the scan did not read what it should`); process.exit(2); }
    bad += report('archive ' + path.basename(asar), res, args);
  }
  console.log('skipped by pattern: ' + (Object.entries(SKIP_COUNT).map(([s, n]) => `${n} x ${s} (${String(reasons[s] || '').slice(0, 70)})`).join(' | ') || 'none'));
  process.exit(bad ? 1 : 0);
}
