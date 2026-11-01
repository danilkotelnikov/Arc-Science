// Proves the writer: an unchanged repack must equal the original byte for byte, and an override must change only its own file.
// Run: node test/asar-roundtrip.mjs <pristine app.asar> <scratch dir>
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { openAsar, writeAsar } from '../lib/asar.mjs';

const [src, scratch] = process.argv.slice(2);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let bad = 0;
const check = (ok, label) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); };

const a = openAsar(src);
const same = path.join(scratch, 'roundtrip-same.asar');
writeAsar(a, same);
check(sha(same) === sha(src), 'unchanged repack is byte-identical to the original');

const target = a.files.find((f) => /dsh-client-ui-chat\/lib\/client\.js$/.test(f.path)).path;
const orig = a.read(a.byPath.get(target));
const edited = Buffer.from(orig.toString('utf8').replace('"Deep diving"', '"Deep diving!"'), 'utf8');
const changed = path.join(scratch, 'roundtrip-edit.asar');
writeAsar(a, changed, new Map([[target, edited]]));
const b = openAsar(changed);
check(b.read(b.byPath.get(target)).equals(edited), 'the edited file reads back as written');
let others = 0, differ = 0;
for (const f of a.files) {
  if (f.entry.unpacked || f.path === target) continue;
  others++;
  if (!a.read(f).equals(b.read(b.byPath.get(f.path)))) differ++;
}
check(differ === 0, `all ${others} other packed files are unchanged`);
check(a.files.length === b.files.length, 'file count is unchanged');
a.close(); b.close();
fs.rmSync(same); fs.rmSync(changed);
console.log(bad ? 'FAILED' : 'ALL PASS');
process.exit(bad ? 1 : 0);
