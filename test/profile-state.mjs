// Ties the evidence of a test run to one state of the data home (C:\Users\danil\.dsh), which is outside git.
//   node test/profile-state.mjs
// 1. every file that brandtext/apply-profiles.mjs rewrote has the hash in the committed list brandtext/profile-state.json
// 2. the profile settings say what the slice decided (skill-badge off, no DeepSeek provider routes in the model lists, Radium default model on the web profile)
// 3. the Visualize plugin keeps every style id as a key of its style table (a rewrite once turned the id into a name the table did not have)
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = os.homedir();
let bad = 0;
const check = (ok, label) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); };

// 1. file hashes
const list = JSON.parse(fs.readFileSync(path.join(root, 'brandtext', 'profile-state.json'), 'utf8')).files;
let differ = 0, missing = 0;
for (const [rel, hash] of Object.entries(list)) {
  const file = rel.startsWith('~/') ? path.join(home, rel.slice(2)) : path.join(path.parse(home).root, rel);
  let cur = null;
  try { cur = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { missing++; continue; }
  if (cur !== hash) { differ++; if (differ <= 5) console.log('  differs: ' + rel); }
}
check(Object.keys(list).length > 500 && differ === 0 && missing === 0, `rewritten files match the committed list (${Object.keys(list).length} files, ${differ} differ, ${missing} missing)`);

// 2. profile settings
for (const prof of ['web', 'desktop']) {
  const y = fs.readFileSync(path.join(home, '.dsh', 'profiles', prof, 'cordis.patch.yml'), 'utf8');
  const badge = /- id: skill-badge\s*\n\s+name: [^\n]+\n\s+disabled: true/.test(y);
  check(badge, `${prof}: the skill-badge row is disabled`);
  check(!/deepseek-official/.test(y), `${prof}: no deepseek-official route in the profile settings`);
}
const web = fs.readFileSync(path.join(home, '.dsh', 'profiles', 'web', 'cordis.patch.yml'), 'utf8');
check(/- id: agent-default-model[\s\S]{0,200}provider: radium\s*\n\s+model: hal-1\.0/.test(web), 'web: the default model is Radium HAL 1.0');

// 3. the Visualize plugin: every style id is a key of the style table
const viz = path.join(home, '.dsh', 'profiles', 'web', 'node_modules', '@nagi-ovo', 'dsh-visualize', 'lib', 'index.js');
if (fs.existsSync(viz)) {
  const t = fs.readFileSync(viz, 'utf8');
  const ids = [...(/const STYLE_IDS = \[([^\]]*)\]/.exec(t)?.[1] ?? '').matchAll(/"([\w-]+)"/g)].map((m) => m[1]);
  const table = /const STYLES = \{([\s\S]*?)\n\};/.exec(t)?.[1] ?? '';
  const keys = [...table.matchAll(/^\t(?:"([\w-]+)"|([\w-]+)): \{/gm)].map((m) => m[1] ?? m[2]);
  const missingKeys = ids.filter((id) => !keys.includes(id));
  check(ids.length >= 3 && missingKeys.length === 0, `Visualize: every style id is a key of the style table (${ids.length} ids, missing: ${missingKeys.join(', ') || 'none'})`);
}
process.exit(bad ? 1 : 0);
