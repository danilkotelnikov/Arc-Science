// Idempotent apply: archives originals once, removes non-English variants, copies English content over statically imported locale files,
// applies manual edits and cached translations with exact-position edits, then syntax-checks changed JS files.
// Usage: node apply.mjs [--dry] [--allow-missing]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { planProfile, decisionsFile, applyManualToText, manualEdits } from './plan.mjs';
import { renderFile } from './render.mjs';
import { loadCache, CJK_RE } from './gemini.mjs';
import { PROFILES, PROFILES_ROOT, pluginList, walkPkg } from './removals.mjs';

const DRY = process.argv.includes('--dry');
const ALLOW_MISSING = process.argv.includes('--allow-missing');
const PURGE = 'C:/Users/danil/ArcHarnessApp/purge';
const ORIG = `${PURGE}/_originals.tar.xz`;
const REMOVED = `${PURGE}/_removed.tar.xz`;
const cache = loadCache();
const log = (m) => console.log(m);
const rel2root = (abs) => path.relative(PROFILES_ROOT, abs).split(path.sep).join('/');

const missing = new Map(); const badUnits = [];
function trFor(f) {
  return (u) => {
    const t = cache[u.key];
    if (t === undefined) { missing.set(u.key, f.pkg + ':' + f.rel); return undefined; }
    if (u.type === 'tpl') {
      const want = (u.key.match(/\$\{E\d+\}/g) || []).sort().join(','); const got = (t.match(/\$\{E\d+\}/g) || []).sort().join(',');
      if (want !== got) { badUnits.push({ file: f.pkg + ':' + f.rel, key: u.key.slice(0, 80) }); return undefined; }
    }
    if (CJK_RE.test(t)) { badUnits.push({ file: f.pkg + ':' + f.rel, key: u.key.slice(0, 80), why: 'CJK in translation' }); return undefined; }
    return t;
  };
}

// ---- plan ----
const plans = PROFILES.map((p) => ({ profile: p, ...planProfile(p) }));
const writes = []; // {abs, rel, pkg, profile, text}
for (const pl of plans) {
  for (const f of pl.files) {
    const orig = fs.readFileSync(f.abs, 'utf8');
    let next = renderFile(f, trFor(f));
    next = applyManualToText(f.pkg, f.rel, next, manualEdits(), 'post').text; // edits that refer to the translated text
    if (next !== orig) writes.push({ abs: f.abs, rel: f.rel, pkg: f.pkg, profile: pl.profile, text: next });
  }
  for (const c of pl.copyList) {
    const src = `${c.root}/${c.from}`; const dst = `${c.root}/${c.rel}`;
    const text = fs.readFileSync(src, 'utf8');
    if (!fs.existsSync(dst) || fs.readFileSync(dst, 'utf8') !== text) writes.push({ abs: dst, rel: c.rel, pkg: c.pkg, profile: pl.profile, text, copied: true });
  }
}
// JSON fixture edit (aegis): the Chinese template surface is removed together with the template file.
for (const prof of PROFILES) {
  const abs = `${PROFILES_ROOT}/${prof}/node_modules/aegis/tests/e2e/fixtures/host-instruction-invariants.json`;
  if (!fs.existsSync(abs)) continue;
  const raw = fs.readFileSync(abs, 'utf8'); const j = JSON.parse(raw);
  const name = 'GLOBAL_USER_RULES_TEMPLATE.zh-CN.md';
  if ((j.requiredSurfaces || []).includes(name) || (j.surfaces || []).some((s) => s.path === name)) {
    j.requiredSurfaces = j.requiredSurfaces.filter((x) => x !== name); j.surfaces = j.surfaces.filter((s) => s.path !== name);
    writes.push({ abs, rel: 'tests/e2e/fixtures/host-instruction-invariants.json', pkg: 'aegis', profile: prof, text: JSON.stringify(j, null, 2) + '\n' });
  }
}
const removals = plans.flatMap((p) => p.removeList.filter((r) => fs.existsSync(`${r.root}/${r.rel}`)).map((r) => ({ ...r, abs: `${r.root}/${r.rel}` })));

log(`files to rewrite: ${writes.length}; files to remove: ${removals.length}; missing translations: ${missing.size}; unusable translations: ${badUnits.length}`);
if (missing.size && !ALLOW_MISSING) { log('MISSING (first 10):'); [...missing].slice(0, 10).forEach(([k, f]) => log('  ' + f + ' ' + JSON.stringify(k.slice(0, 80)))); process.exit(2); }
if (badUnits.length) badUnits.slice(0, 10).forEach((b) => log('BAD ' + JSON.stringify(b)));
if (DRY) { fs.writeFileSync(`${PURGE}/_apply-dry.json`, JSON.stringify({ writes: writes.map((w) => w.profile + ':' + w.pkg + ':' + w.rel), removals: removals.map((r) => r.profile + ':' + r.pkg + ':' + r.rel) }, null, 1)); process.exit(0); }

// ---- archives (kept in one tar.xz each; merged when new files appear) ----
function ensureArchive(archive, absFiles) {
  const rels = absFiles.map(rel2root);
  let have = new Set();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-arc-'));
  if (fs.existsSync(archive)) {
    const l = spawnSync('tar', ['--force-local', '-tJf', archive], { encoding: 'utf8', maxBuffer: 1 << 28 });
    have = new Set(l.stdout.split('\n').filter(Boolean));
    const need = rels.filter((r) => !have.has(r));
    if (!need.length) return 0;
    // merge: extract old, add new originals (still unmodified on disk), recompress
    const x = spawnSync('tar', ['--force-local', '-xJf', archive, '-C', tmp], { encoding: 'utf8' }); if (x.status !== 0) throw new Error('tar extract failed ' + x.stderr);
    for (const r of need) { const d = path.join(tmp, r); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(PROFILES_ROOT, r), d); }
    const all = [...have, ...need];
    const list = path.join(tmp, '..', 'purge-list-' + Date.now() + '.txt'); fs.writeFileSync(list, all.join('\n'));
    const c = spawnSync('tar', ['--force-local', '-cJf', archive + '.new', '-C', tmp, '-T', list], { encoding: 'utf8' }); if (c.status !== 0) throw new Error('tar create failed ' + c.stderr);
    fs.renameSync(archive + '.new', archive); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(list, { force: true });
    return need.length;
  }
  const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, rels.join('\n'));
  const c = spawnSync('tar', ['--force-local', '-cJf', archive, '-C', PROFILES_ROOT, '-T', list], { encoding: 'utf8' }); if (c.status !== 0) throw new Error('tar create failed ' + c.stderr);
  fs.rmSync(tmp, { recursive: true, force: true });
  return rels.length;
}
const origTargets = [...new Set(writes.filter((w) => fs.existsSync(w.abs)).map((w) => w.abs))];
const nOrig = origTargets.length ? ensureArchive(ORIG, origTargets) : 0;
const nRem = removals.length ? ensureArchive(REMOVED, removals.map((r) => r.abs)) : 0;
log(`archived originals: ${nOrig}; archived removed: ${nRem}`);

// ---- write (temp + rename so hard links to the pnpm store stay untouched) ----
let written = 0; const writeFail = [];
for (const w of writes) {
  const tmpf = w.abs + '.purge-tmp';
  try { fs.writeFileSync(tmpf, w.text); fs.renameSync(tmpf, w.abs); written++; } catch (e) { writeFail.push(w.profile + ':' + w.pkg + ':' + w.rel + ' ' + e.code); try { fs.unlinkSync(tmpf); } catch {} }
}
let removed = 0;
for (const r of removals) { try { fs.unlinkSync(r.abs); removed++; } catch (e) { writeFail.push('remove ' + r.profile + ':' + r.pkg + ':' + r.rel + ' ' + e.code); } }
if (writeFail.length) { log('WRITE FAILURES: ' + writeFail.length); writeFail.forEach((x) => log('  ' + x)); }
log(`written ${written}, removed ${removed}`);

// ---- syntax checks ----
const tmpd = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-chk-'));
const syntaxFail = [];
for (const w of writes) {
  const ext = path.extname(w.rel).toLowerCase();
  let ok = true;
  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    ok = false;
    for (const e of ['.mjs', '.cjs']) { const p = path.join(tmpd, 'chk' + e); fs.writeFileSync(p, w.text); if (spawnSync('node', ['--check', p], { encoding: 'utf8' }).status === 0) { ok = true; break; } }
  } else if (ext === '.json') { try { JSON.parse(w.text); } catch { ok = false; } }
  else if (ext === '.py') { const p = path.join(tmpd, 'chk.py'); fs.writeFileSync(p, w.text); ok = spawnSync('python', ['-m', 'py_compile', p], { encoding: 'utf8' }).status === 0; }
  else if (ext === '.sh') { const p = path.join(tmpd, 'chk.sh'); fs.writeFileSync(p, w.text); ok = spawnSync('bash', ['-n', p], { encoding: 'utf8' }).status === 0; }
  if (!ok) syntaxFail.push(w.profile + ':' + w.pkg + ':' + w.rel);
}
fs.rmSync(tmpd, { recursive: true, force: true });
log(`syntax failures: ${syntaxFail.length}`); syntaxFail.forEach((s) => log('  ' + s));
// ---- post fixup: a script that lost its shebang to the comment rewrite gets it back ----
let shebangFixed = 0;
for (const prof of PROFILES) for (const pkg of pluginList(prof)) {
  const root = `${PROFILES_ROOT}/${prof}/node_modules/${pkg}`;
  for (const rel of walkPkg(root)) {
    if (!/.(sh|py|ps1|mjs|js)$/.test(rel)) continue;
    const abs = `${root}/${rel}`; const t = fs.readFileSync(abs, 'utf8');
    if (t.startsWith('# !/')) { const tmpf = abs + '.purge-tmp'; fs.writeFileSync(tmpf, '#!/' + t.slice(4)); fs.renameSync(tmpf, abs); shebangFixed++; }
  }
}
log(`shebang lines restored: ${shebangFixed}`);
fs.writeFileSync(`${PURGE}/apply-report.json`, JSON.stringify({ date: new Date().toISOString(), written, removed, writeFail, shebangFixed, archivedOriginals: nOrig, archivedRemoved: nRem, syntaxFail, badUnits, missing: [...missing].map(([k, f]) => ({ file: f, key: k.slice(0, 80) })), manual: plans.flatMap((p) => p.manualStatus.map((m) => ({ profile: p.profile, pkg: m.pkg, rel: m.rel, status: m.status, note: m.e.note }))) }, null, 1));
