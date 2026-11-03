// Read-only helper: print or list files inside an archive.
//   node tools/asar-cat.mjs <pristine|build> cat <path>
//   node tools/asar-cat.mjs <pristine|build> ls <regex>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAsar } from '../lib/asar.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [which, cmd, arg] = process.argv.slice(2);
const a = openAsar(path.join(root, which === 'build' ? 'build' : 'pristine', 'app.asar'));
if (cmd === 'cat') {
  const f = a.byPath.get(arg);
  if (!f) { console.error('no such file: ' + arg); process.exit(1); }
  process.stdout.write(a.read(f));
} else if (cmd === 'ls') {
  const re = new RegExp(arg, 'i');
  for (const f of a.files) if (re.test(f.path)) console.log(f.path, f.entry.size);
} else { console.error('usage: asar-cat.mjs <pristine|build> cat <path> | ls <regex>'); process.exit(2); }
