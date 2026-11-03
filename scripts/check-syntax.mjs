// Runs "node --check" on every .mjs and .cjs file of the repository. Exit 1 when one does not parse.
//   node scripts/check-syntax.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['.git', 'node_modules', '_work', 'pristine', 'build']);
let n = 0, bad = 0;
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); continue; }
    if (!/\.(mjs|cjs)$/.test(e.name)) continue;
    n++;
    const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
    if (r.status !== 0) { bad++; console.log(`FAIL ${path.relative(root, p)}\n${r.stderr}`); }
  }
};
walk(root);
console.log(`${n} files checked, ${bad} failed`);
process.exit(bad ? 1 : 0);
