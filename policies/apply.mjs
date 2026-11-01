// Arc Harness policy pack: writes plugin titles, descriptions, icons and policy documents.
//
//   node apply.mjs          write the files into both profiles and the two local plugin sources
//   node apply.mjs --dry    list what would change, write nothing
//
// It is safe to run again: a file whose content already matches is left alone.
// Before the first write it stores the original of every file it will touch in
// _originals.tar.xz (next to this script). Files are replaced by temp file plus rename, so a file
// that is hard-linked into the package store gets a new inode and the store copy stays intact.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HOME = os.homedir();
export const DSH = path.join(HOME, '.dsh');
export const PROFILES = ['web', 'desktop'];
const LOCAL = new Set(['dsh-hoh', 'dsh-theme-pair']);
const ARCHIVE = path.join(HERE, '_originals.tar.xz');

export const loadPolicies = () => JSON.parse(fs.readFileSync(path.join(HERE, 'policies.json'), 'utf8'));
export const iconText = (rec) => fs.readFileSync(path.join(HERE, rec.icon), 'utf8');

/** Plugin folders for one record: the local source (our two plugins) and every profile copy. */
export function targetsFor(rec) {
  const dirs = PROFILES.map((p) => path.join(DSH, 'profiles', p, 'node_modules', ...rec.id.split('/')));
  if (LOCAL.has(rec.id)) dirs.unshift(path.join(DSH, 'local-plugins', rec.id));
  return dirs.filter((d) => fs.existsSync(path.join(d, 'package.json')));
}

// ---- text generators -------------------------------------------------------------------------

const bullets = (a) => a.map((x) => `- ${x}`).join('\n');
const numbered = (a) => a.map((x, i) => `${i + 1}. ${x}`).join('\n');

export function renderDoc(rec) {
  return [
    `# ${rec.title}`,
    '',
    rec.description,
    '',
    '## Purpose',
    '',
    rec.purpose,
    '',
    '## Policy',
    '',
    bullets(rec.policy),
    '',
    '## Workflow',
    '',
    numbered(rec.workflow),
    '',
    '## Settings',
    '',
    bullets(rec.settings),
    '',
    '## Data it reads and writes',
    '',
    bullets(rec.data),
    '',
    '## Failure behavior',
    '',
    bullets(rec.failure),
    '',
    '## How to verify',
    '',
    numbered(rec.verify),
    '',
  ].join('\n');
}

export function renderReadme(rec, hasLicense) {
  const lines = [
    `# ${rec.title}`,
    '',
    rec.description,
    '',
    rec.purpose,
    '',
    'The full policy is in docs/policy.md. It covers the rules, the workflow, the settings, the data the plugin reads and writes, the failure behavior and the steps that verify it.',
    '',
  ];
  if (hasLicense) lines.push('The license is in the LICENSE file.', '');
  return lines.join('\n');
}

// ---- JSON patchers (pure: text in, text out) --------------------------------------------------

function parts(text) {
  const bom = text.startsWith('﻿');
  const body = bom ? text.slice(1) : text;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const m = body.match(/^([ \t]+)"/m);
  return { bom, body, eol, indent: m ? m[1] : '  ', tail: /\r?\n$/.test(body) ? eol : '' };
}
function dump(obj, p) {
  let s = JSON.stringify(obj, null, p.indent);
  if (p.eol === '\r\n') s = s.replace(/\n/g, '\r\n');
  return (p.bom ? '﻿' : '') + s + p.tail;
}

export function patchPackage(text) {
  const p = parts(text);
  const pkg = JSON.parse(p.body);
  const out = {};
  let placed = false;
  for (const [k, v] of Object.entries(pkg)) {
    if (k === 'icon') { out.icon = 'icon.svg'; placed = true; continue; }
    out[k] = v;
    if (!placed && !('icon' in pkg) && k === 'description') { out.icon = 'icon.svg'; placed = true; }
  }
  if (!placed) out.icon = 'icon.svg';

  const exp = out.exports;
  if (exp && typeof exp === 'object' && !Array.isArray(exp) && Object.keys(exp).every((k) => k.startsWith('.'))) {
    out.exports = { ...exp, './icon': './icon.svg', './locale/*.json': exp['./locale/*.json'] || './locale/*.json' };
  }
  if (Array.isArray(out.files)) {
    const f = [...out.files];
    if (!f.includes('icon.svg')) f.push('icon.svg');
    if (!f.some((x) => /^(\.\/)?locale(\/|$)/.test(x))) f.push('locale');
    if (!f.some((x) => /^(\.\/)?docs(\/|$)/.test(x))) f.push('docs/policy.md');
    out.files = f;
  }
  // Nothing outside icon, exports and files may change.
  for (const k of new Set([...Object.keys(pkg), ...Object.keys(out)])) {
    if (['icon', 'exports', 'files'].includes(k)) continue;
    if (JSON.stringify(pkg[k]) !== JSON.stringify(out[k])) throw new Error(`package.json key changed by mistake: ${k}`);
  }
  return dump(out, p);
}

export function patchLocale(text, rec) {
  const p = text == null ? { bom: false, eol: '\n', indent: '  ', tail: '\n' } : parts(text);
  const obj = text == null ? {} : JSON.parse(p.body);
  const old = obj.meta && typeof obj.meta === 'object' ? obj.meta : {};
  const meta = { title: rec.title, description: rec.description };
  for (const [k, v] of Object.entries(old)) if (k !== 'title' && k !== 'description') meta[k] = v;
  const out = 'meta' in obj ? { ...obj, meta } : { meta, ...obj };
  return dump(out, p);
}

// ---- file plan --------------------------------------------------------------------------------

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);

/** The new text of each file we own in one plugin folder. */
export function filesFor(rec, dir) {
  const hasLicense = fs.existsSync(path.join(dir, 'LICENSE'));
  return {
    'package.json': (cur) => patchPackage(cur),
    'locale/en.json': (cur) => patchLocale(cur, rec),
    'icon.svg': () => iconText(rec),
    'docs/policy.md': () => renderDoc(rec),
    'README.md': () => renderReadme(rec, hasLicense),
  };
}

function plan(policies) {
  const rows = [];
  for (const rec of policies) {
    for (const dir of targetsFor(rec)) {
      for (const [name, make] of Object.entries(filesFor(rec, dir))) {
        const abs = path.join(dir, ...name.split('/'));
        const cur = read(abs);
        const next = make(cur);
        if (cur !== next) rows.push({ rec, abs, name, make, existed: cur !== null });
      }
    }
  }
  return rows;
}

function safeWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.arc-tmp`);
  fs.writeFileSync(tmp, text);
  try { fs.renameSync(tmp, file); } catch (err) { fs.rmSync(tmp, { force: true }); throw err; }
}

function archiveOriginals(rows) {
  const rel = (abs) => path.relative(HOME, abs).split(path.sep).join('/');
  const present = rows.filter((r) => r.existed).map((r) => rel(r.abs));
  const absent = rows.filter((r) => !r.existed).map((r) => rel(r.abs));
  const hashes = Object.fromEntries(present.map((r) => [r, crypto.createHash('sha256').update(fs.readFileSync(path.join(HOME, r))).digest('hex')]));
  const manifest = { created: new Date().toISOString(), root: 'home folder', present: hashes, absent };
  const py = [
    'import sys, json, tarfile, io, os',
    'cfg = json.load(sys.stdin)',
    "with tarfile.open(cfg['out'], 'w:xz') as tf:",
    "    for rel in cfg['present']:",
    "        tf.add(os.path.join(cfg['root'], rel), arcname=rel, recursive=False)",
    "    data = json.dumps(cfg['manifest'], indent=2).encode()",
    "    ti = tarfile.TarInfo('ORIGINALS.json'); ti.size = len(data)",
    '    tf.addfile(ti, io.BytesIO(data))',
    "with tarfile.open(cfg['out'], 'r:xz') as tf:",
    '    n = len(tf.getnames())',
    "assert n == len(cfg['present']) + 1, n",
    'print(n)',
  ].join('\n');
  const tmp = `${ARCHIVE}.part`;
  const r = spawnSync('python', ['-I', '-c', py], { input: JSON.stringify({ out: tmp, root: HOME, present, manifest }), encoding: 'utf8' });
  if (r.status !== 0) { fs.rmSync(tmp, { force: true }); throw new Error('archive failed: ' + (r.stderr || r.stdout)); }
  fs.renameSync(tmp, ARCHIVE);
  return { files: present.length, absent: absent.length };
}

export function main(argv = process.argv.slice(2)) {
  const dry = argv.includes('--dry');
  const policies = loadPolicies();
  const rows = plan(policies);
  if (rows.length === 0) { console.log('nothing to change: every file already matches'); return { written: 0 }; }
  if (dry) {
    for (const r of rows) console.log(`${r.existed ? 'change' : 'create'} ${r.abs}`);
    console.log(`${rows.length} file(s) would change`);
    return { written: 0 };
  }
  if (!fs.existsSync(ARCHIVE)) {
    const a = archiveOriginals(rows);
    console.log(`archived ${a.files} original file(s) (${a.absent} did not exist) in ${ARCHIVE}`);
  }
  let written = 0, linked = 0;
  for (const r of rows) {
    const cur = read(r.abs); // read again right before the edit
    const next = r.make(cur);
    if (cur === next) continue;
    if (cur !== null && fs.statSync(r.abs).nlink > 1) linked++;
    safeWrite(r.abs, next);
    written++;
  }
  console.log(`wrote ${written} file(s); ${linked} were hard-linked and got a new inode`);
  return { written };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
