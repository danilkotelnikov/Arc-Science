// Positive control for the scans. The same scans that must find nothing in build/app.asar must find a lot in the pristine archive.
//   node test/positive-control.mjs [pristine archive]    (default pristine/app.asar)
// A scan that reads nothing, or that skips what it should read, finds nothing in both archives. This test fails for that case.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pristine = path.resolve(process.argv[2] || path.join(root, 'pristine', 'app.asar'));
if (!fs.existsSync(pristine)) { console.error('no pristine archive: ' + pristine); process.exit(2); }
let bad = 0;
const check = (ok, label) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const run = (script, ...a) => { const r = spawnSync(process.execPath, [path.join(root, 'test', script), ...a], { encoding: 'utf8', maxBuffer: 1 << 28 }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; };

// independent scan: findings by kind, and addresses
{
  const r = run('independent-scan.mjs', pristine);
  const n = Number(/(\d+) findings/.exec(r.out)?.[1] ?? -1);
  const per = JSON.parse(/findings (\{[^}]*\})/.exec(r.out)?.[1] ?? '{}');
  check(r.status === 1 && n >= 500, `independent scan finds the old wording in the pristine archive (${n} findings, floor 500)`);
  check((per.DeepSeek ?? 0) >= 100 && (per.DSH ?? 0) >= 50 && (per.address ?? 0) >= 10, `independent scan sees all three brand words and addresses (${JSON.stringify(per)})`);
}
// shared-rule scan of the build
{
  const r = run('ui-strings.mjs', pristine);
  const n = Number(/(\d+) findings/.exec(r.out)?.[1] ?? -1);
  check(r.status === 1 && n >= 500, `ui-strings finds the old wording in the pristine archive (${n} findings, floor 500)`);
}
// network census
{
  const r = run('no-deepseek-net.mjs', '--archive', pristine);
  const n = Number(/(\d+) static findings/.exec(r.out)?.[1] ?? -1);
  check(r.status === 1 && n >= 100, `network census finds DeepSeek addresses in the pristine archive (${n} findings, floor 100)`);
}
console.log(bad ? 'FAIL' : 'ALL PASS');
process.exit(bad ? 1 : 0);
