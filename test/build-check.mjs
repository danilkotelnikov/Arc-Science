// Checks the built archive against the pristine one: every changed JS file still parses, no whale outline or old
// product name is left in the changed code, and every file that did not change is byte-identical.
// Run: node test/build-check.mjs [build/app.asar] <scratch dir>
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
check(built.files.length === pristine.files.length - removedCount, `file count = pristine ${pristine.files.length} minus ${removedCount} removed documents`);
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
const pj = JSON.parse(built.read(built.byPath.get('package.json')).toString('utf8'));
check(!('dshMandatoryUpdatePolicy' in pj), 'no remote update policy in the app manifest');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? 'FAILED' : 'ALL PASS');
process.exit(bad ? 1 : 0);
