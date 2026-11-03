// Install or roll back the Arc Harness build in the app folder.
//   node tools/install.mjs install      swap in build/app.asar, brand icons, switch the update feed off
//   node tools/install.mjs rollback     put every pristine file back
//   node tools/install.mjs status       say which one is installed
// The pristine files in pristine/ are never touched. A swap is a rename, so a running app keeps its open copy until it restarts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = process.env.ARC_RESOURCES || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness', 'resources');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const pristineSums = Object.fromEntries(fs.readFileSync(path.join(root, 'pristine', 'SHA256SUMS.txt'), 'utf8').trim().split('\n').map((l) => { const [h, n] = l.split(/\s+\*?/); return [n, h]; }));
const live = (n) => path.join(res, n);
const pristine = (n) => path.join(root, 'pristine', n);
const swap = (from, to) => { const tmp = to + '.arc-new'; fs.copyFileSync(from, tmp); fs.renameSync(tmp, to); };

const cmd = process.argv[2];
if (cmd === 'status') {
  const now = sha(live('app.asar'));
  const build = fs.existsSync(path.join(root, 'build', 'app.asar')) ? sha(path.join(root, 'build', 'app.asar')) : null;
  console.log(now === pristineSums['app.asar'] ? 'installed: original DeepSeek Harness archive' : now === build ? 'installed: current Arc Harness build' : 'installed: an archive that matches neither the original nor the current build');
  console.log('update feed file present:', fs.existsSync(live('app-update.yml')));
} else if (cmd === 'install') {
  for (const n of Object.keys(pristineSums)) if (sha(pristine(n)) !== pristineSums[n]) throw new Error('pristine file changed: ' + n);
  const built = path.join(root, 'build', 'app.asar');
  if (!fs.existsSync(built)) throw new Error('no build/app.asar; run tools/build.mjs first');
  const now = sha(live('app.asar'));
  const known = new Set([pristineSums['app.asar'], sha(built)]);
  const prev = path.join(root, 'build', 'INSTALLED.sha');
  if (fs.existsSync(prev)) known.add(fs.readFileSync(prev, 'utf8').trim());
  if (!known.has(now)) throw new Error('the live app.asar is neither the original nor a known Arc build; stop and look');
  swap(built, live('app.asar'));
  swap(path.join(root, 'brand', 'dist', 'icon.png'), live('icon.png'));
  swap(path.join(root, 'brand', 'dist', 'tray.ico'), live('tray.ico'));
  if (fs.existsSync(live('app-update.yml'))) fs.unlinkSync(live('app-update.yml')); // no update feed: the app checks that this file exists
  fs.writeFileSync(prev, sha(live('app.asar')));
  console.log('installed Arc Harness build', sha(live('app.asar')).slice(0, 16));
} else if (cmd === 'rollback') {
  for (const n of Object.keys(pristineSums)) { swap(pristine(n), live(n)); }
  console.log('restored the original files:', Object.keys(pristineSums).join(', '));
} else {
  console.log('usage: node tools/install.mjs install | rollback | status');
  process.exit(2);
}
