// Second pass on the Arc Science skin (run after make-arc-skin.mjs; safe to run again).
// C2 layers: paper canvas #faf9f6, white cards, sidebar #f4f2ed, readable captions. Checks go into the plugin test.
//   node theme/tune-arc-skin.mjs            edits local-plugins/arc-theme and copies it into both profiles
import fs from 'node:fs';
import path from 'node:path';
import { dataHome } from '../lib/testhome.mjs';

const home = dataHome();
const plugin = path.join(home, 'local-plugins', 'arc-theme');
const file = path.join(plugin, 'lib', 'client', 'index.js');
let s = fs.readFileSync(file, 'utf8');

const TOKENS = [
  ['--dsw-alias-bg-base', '#faf9f6', '#171614'],
  ['--dsw-alias-bg-layer-1', '#ffffff', '#1f1e1b'],
  ['--dsw-alias-bg-layer-2', '#ffffff', '#272522'],
  ['--dsw-alias-bg-layer-3', '#ffffff', '#302e2a'],
  ['--dsw-specific-sidebar-fill', '#f4f2ed', '#1b1a18'],
  ['--dsw-specific-input-major', '#ffffff', '#272522'],
  ['--dsw-menu-surface-fill', '#fffffff2', '#272522f2'],
  ['--dsw-alias-menu-group-header-fill', '#faf9f6f2', '#1f1e1bf2'],
  ['--dsw-static-neutral-bluish-400', '#b5b0a3', '#a9a59b'], // the ramp keeps its order
  ['--dsw-alias-label-caption', '#767168', '#a9a59b'],
];

let changed = 0;
for (const [key, light, dark] of TOKENS) {
  const re = new RegExp('("' + key.replace(/[-/]/g, '\\$&') + '": \\{\\s*"light": ")[^"]*(",\\s*"dark": ")[^"]*(")');
  if (re.test(s)) {
    const next = s.replace(re, (_, a, b, c) => a + light + b + dark + c);
    if (next !== s) { s = next; changed++; }
  } else {
    const anchor = s.indexOf('"tokens": {');
    if (anchor < 0) throw new Error('tokens object not found');
    const at = anchor + '"tokens": {'.length;
    s = s.slice(0, at) + `\n        "${key}": { "light": "${light}", "dark": "${dark}" },` + s.slice(at);
    changed++;
  }
}
// the update badge of the context plugin (amber, off the palette, and it asks a registry): hidden
const RULES = ['html body .lc-ov-update{display:none !important}'];
for (const rule of RULES) {
  if (s.includes(rule)) continue;
  const at = s.indexOf('"scoped": [');
  if (at < 0) throw new Error('scoped rules not found');
  const ins = at + '"scoped": ['.length;
  s = s.slice(0, ins) + '\n        ' + JSON.stringify(rule) + ',' + s.slice(ins);
  changed++;
}
fs.writeFileSync(file, s);

// plugin test: the new layers
const tf = path.join(plugin, 'test', 'theme.test.mjs');
let t = fs.readFileSync(tf, 'utf8');
const MARK = 'the canvas is paper, cards are white';
if (!t.includes(MARK)) {
  const anchor = "  check(/arcTurn/.test(scoped)";
  const i = t.indexOf(anchor);
  if (i < 0) throw new Error('test anchor not found');
  t = t.slice(0, i) + `  check(tokens['--dsw-alias-bg-base'].light === '#faf9f6' && tokens['--dsw-alias-bg-layer-1'].light === '#ffffff' && tokens['--dsw-specific-sidebar-fill'].light === '#f4f2ed', \`\${id}: ${MARK}, the sidebar is #f4f2ed (the C2 layers)\`);
  check(tokens['--dsw-alias-bg-base'].dark === '#171614' && tokens['--dsw-specific-sidebar-fill'].dark === '#1b1a18', \`\${id}: the dark canvas and sidebar are the C2 dark set\`);
  { const cap = hex(tokens['--dsw-alias-label-caption'].light); const lumOf = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }; check((1.05) / (lumOf(cap) + 0.05) >= 4.5, \`\${id}: captions and placeholders have 4.5:1 contrast on white\`); }
` + t.slice(i);
  fs.writeFileSync(tf, t);
}

// copy into both profiles
const copy = ['lib/client/index.js', 'lib/index.js', 'package.json', 'README.md'];
for (const prof of ['web', 'desktop']) {
  const dest = path.join(home, 'profiles', prof, 'node_modules', 'arc-theme');
  for (const f of copy) {
    const from = path.join(plugin, f);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dest, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to + '.arc-tmp', fs.readFileSync(from));
    fs.renameSync(to + '.arc-tmp', to);
  }
}
console.log(`tuned ${changed} tokens; copied to both profiles`);
