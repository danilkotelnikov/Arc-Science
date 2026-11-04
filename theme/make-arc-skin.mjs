// Turns arc-theme into the single Arc Harness skin (the C2 look of the Cammut and Arc Harness console).
//   node theme/make-arc-skin.mjs
// Source of the values: the Cammut and Arc Harness UI preview C2 of 2026-10-23 (tokens, Geist).
// The v0 and Radium skins, the Style picker and the square-corner rules are removed. The old plugin is archived first.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataHome } from '../lib/testhome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const plugin = path.join(dataHome(), 'local-plugins', 'arc-theme');
const file = path.join(plugin, 'lib/client/index.js');
const src = fs.readFileSync(file, 'utf8');
const geist = fs.readFileSync(path.join(here, '..', 'brand', 'dist', 'geist.css'), 'utf8').trim();

if (!/var SKINS = \{\s*"v0"/.test(src)) { console.log('already converted: no v0 skin in the plugin'); process.exit(0); }

// 1. archive the old plugin once
const archive = path.join(here, '_legacy-skins-20261101.tar.xz');
if (!fs.existsSync(archive)) {
  const r = spawnSync('tar', ['--force-local', '-cJf', archive, '-C', path.dirname(plugin), 'arc-theme'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('archive failed: ' + r.stderr);
}

// 2. read the Radium skin (a warm paper palette) and re-map it to the C2 values
let loaded;
vm.runInNewContext(src, { window: { __ModuleLoader__: { load: (m) => { loaded = m; } } }, document: {}, localStorage: {} });
const exp = loaded.factory(() => ({ createElement: () => null, useState: () => [null, () => {}], useEffect: () => {} }));
const radium = JSON.parse(JSON.stringify(exp.SKINS.radium));
const T = radium.tokens;
const set = (k, light, dark) => { T[k] = { light, dark: dark ?? light }; };
const ramp = (n, light, dark) => set(`--dsw-static-neutral-bluish-${n}`, light, dark);

// light: paper #faf9f6, surface #fff, surface 2 #f5f3ee, sidebar #f4f2ed, border #e6e2da, strong border #d2cdc2, text #26231f
ramp('00', '#ffffff', '#ffffff'); ramp('50', '#faf9f6', '#faf9f6'); ramp('60', '#f5f3ee', '#faf9f6'); ramp('75', '#f4f2ed', '#faf9f6');
ramp('100', '#ece9e2', '#e8e4db'); ramp('150', '#e6e2da', '#d5d1c8'); ramp('200', '#dedad0', '#c9c5ba'); ramp('300', '#d2cdc2', '#b5b1a6');
ramp('400', '#b5b0a3', '#a9a59b'); ramp('600', '#75736c', '#75736c'); ramp('700', '#645e55', '#5a5854'); ramp('750', '#4b463f', '#47443e'); ramp('800', '#3a362f', '#3c3935');
ramp('850', '#2f2b26', '#272522'); ramp('875', '#2a2723', '#1f1e1b'); ramp('900', '#26231f', '#1b1a18'); ramp('950', '#26231f', '#171614'); ramp('1000', '#26231f', '#171614');
// brand primary: dark brown button, cream button on dark
set('--dsw-alias-brand-primary-new-colorprimary-new-color', '#54453c', '#ede6d8');
const brand = { 50: ['#faf9f6', '#1b1a18'], 100: ['#f5f3ee', '#1f1e1b'], 200: ['#ece9e2', '#272522'], 300: ['#d8d3c8', '#3c3935'], 400: ['#8a7567', '#ede6d8'], 450: ['#6a574b', '#cfcbc3'],
  500: ['#54453c', '#ede6d8'], 600: ['#6a574b', '#ffffff'], 700: ['#4b463f', '#a9a59b'], 800: ['#4b463f', '#272522'], 900: ['#26231f', '#1f1e1b'] };
for (const [n, [l, d]] of Object.entries(brand)) set(n === '700' ? '--dsw-static-deepseek-700-delete' : `--dsw-static-deepseek-${n}`, l, d);
set('--dsw-alias-onboarding-accent', '#54453c', '#ede6d8');
// the send button keeps a hard-coded white arrow, so its fill stays brown in dark mode too (a cream fill would hide the arrow)
set('--dsw-alias-button-info-fill', '#54453c', '#6a574b'); set('--dsw-alias-button-info-hover', '#6a574b', '#7d6a5c');
// borders and hover washes follow the C2 text colour
set('--dsw-alias-border-l1', '#26231f0d', '#ffffff0d'); set('--dsw-alias-border-l2', '#26231f1a', '#ffffff1a'); set('--dsw-alias-border-l2-darkmode-thin', '#26231f1a', '#ffffff0d');
set('--dsw-alias-border-l3', '#26231f29', '#ffffff26'); set('--dsw-alias-border-l4', '#26231f40', '#ffffff33');
set('--dsw-alias-interactive-bg-hover', '#26231f0f', '#f0eee912'); set('--dsw-alias-interactive-bg-active', '#26231f1a', '#ffffff1f'); set('--dsw-alias-interactive-bg-hover-accent', '#26231f24', '#ffffff29');
// shapes and type: cards 10 px, controls 8 px, Geist
for (const [k, v] of Object.entries({ xs: '4px', sm: '8px', md: '10px', lg: '12px', xl: '16px', panel: '20px' })) set(`--dsw-radius-${k}`, v);
set('--dsh-font-family-text-default', '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif');
set('--dsh-font-family-code-default', '"Geist Mono", ui-monospace, "Cascadia Mono", Consolas, monospace');

// scoped rules: keep the colour fixes, drop the square-corner rules, add Geist, the cube turn and the paper hero
const keep = radium.scoped.filter((r) => !/data-dsh-skin="radium"/.test(r));
const extra = [
  geist,
  '@keyframes arcTurn{0%{transform:scaleX(.03)}70%{transform:scaleX(1.04)}100%{transform:scaleX(1)}}',
  '@media (prefers-reduced-motion:reduce){[style*="arcTurn"]{animation:none !important}}',
  'html body{font-family:var(--dsh-font-family-text-default)}',
  'html body [class*="_headline"][class*="WOwLGG"]{flex-direction:column !important;gap:16px !important;text-align:center}',
  'html body [class*="WOwLGG_titleGroup"]{font-size:32px !important;line-height:1.15 !important;font-weight:600 !important;letter-spacing:-.02em !important}',
  'html body [class*="WOwLGG_previewBadge"]{display:none !important}',
];
const arc = { label: 'Arc Harness', tokens: T, scoped: [...keep, ...extra] };

// 3. rewrite the plugin source
const literalStart = src.indexOf('var SKINS = {');
const literalEnd = src.indexOf('    function readSkin()');
if (literalStart < 0 || literalEnd < 0) throw new Error('SKINS literal not found');
let out = src.slice(0, literalStart) + 'var SKINS = ' + JSON.stringify({ arc }, null, 2).replace(/\n/g, '\n    ') + ';\n\n' + src.slice(literalEnd);
const swap = (re, to, what) => { if (!re.test(out)) throw new Error('not found: ' + what); out = out.replace(re, () => to); };
swap(/function readSkin\(\) \{[\s\S]*?\n    \}\n    function writeSkin/, 'function readSkin() {\n      return "arc";\n    }\n    function writeSkin', 'readSkin');
swap(/var current = "v0";/, 'var current = "arc";', 'current');
swap(/    function StyleRow\(\) \{[\s\S]*?\n    \}\n\n    \/\/ Custom properties/, '    // Custom properties', 'StyleRow');
swap(/      var en = \{ "row\.title": "Style" \};\n[\s\S]*?\n      ctx\.slots\.inject\("settings\.general\.item"[\s\S]*?\n      \}\);\n/, '', 'style row registration');
swap(/ \* Client half:[\s\S]*?the font stacks fall back to system fonts when they are not installed\.\n/, ` * Client half: the Arc Harness paper theme for the web UI (the C2 look of the Cammut and Arc Harness console).
 * One token layer on the app's own theme service (ctx.theme.overrideTokens), so light, dark and system modes keep
 * working: cream paper #faf9f6, a dark-brown primary button #54453c, rounded corners (10 px cards, 8 px controls)
 * and Geist (embedded, SIL OFL 1.1). No blue is left (owner decision, 2026-10-31). The v0 and Radium skins are gone.
`, 'header comment');
swap(/arc-theme 0\.3\.2/g, 'arc-theme 0.4.0', 'version comment');
fs.writeFileSync(file, out);

// 4. version
for (const f of ['lib/index.js', 'README.md', 'test/theme.test.mjs']) {
  const p = path.join(plugin, f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/arc-theme 0\.3\.2/g, 'arc-theme 0.4.0'));
}
// 5. the checks: one skin, the C2 values
{
  const tf = path.join(plugin, 'test/theme.test.mjs');
  let t = fs.readFileSync(tf, 'utf8');
  const rep = (from, to, what) => { if (!t.includes(from)) throw new Error('test text not found: ' + what); t = t.replace(from, () => to); };
  rep("check(exp.SKINS && exp.SKINS.v0 && exp.SKINS.radium, 'two skins exist: v0 and radium');",
    "check(exp.SKINS && Object.keys(exp.SKINS).join() === 'arc' && exp.SKINS.arc.label === 'Arc Harness', 'one skin exists: Arc Harness (the v0 and Radium skins are gone)');", 'skins check');
  rep("check(arRules.length === 2 && arRules.every(", "check(arRules.length === 1 && arRules.every(", 'review rules count');
  rep("'AI Review panel: both skins set text, muted text, surface and border from the skin tokens'", "'AI Review panel: the skin sets text, muted text, surface and border from its tokens'", 'review label');
  rep("const MIN = { primary: 12, secondary: 7, tertiary: 4.5 };", "const MIN = { primary: 12, secondary: 6, tertiary: 4.5 }; // C2's own muted text #645e55 on white is 6.4:1", 'min contrast');
  const a = t.indexOf("  if (id === 'radium') {");
  const b = t.indexOf("  for (const mode of ['light', 'dark']) {\n    const r = ROLES[mode];");
  if (a < 0 || b < 0) throw new Error('radium test block not found');
  t = t.slice(0, a) + `  // the C2 look: cards 10 px, controls 8 px, Geist type, a dark-brown primary button, cream paper
  check(tokens['--dsw-radius-md'].light === '10px' && tokens['--dsw-radius-sm'].light === '8px', \`\${id}: cards are 10 px and controls 8 px\`);
  check(!/border-radius:\\s*0\\s*!important/.test(scoped), \`\${id}: no rule squares the corners\`);
  check(/^"Geist"/.test(tokens['--dsh-font-family-text-default'].light) && /^"Geist Mono"/.test(tokens['--dsh-font-family-code-default'].light), \`\${id}: text is Geist and code is Geist Mono\`);
  check(/@font-face\\{font-family:Geist;/.test(scoped) && /@font-face\\{font-family:Geist Mono;/.test(scoped), \`\${id}: Geist and Geist Mono are embedded\`);
  check(tokens['--dsw-alias-button-info-fill'].light === '#54453c', \`\${id}: the send button is the C2 dark brown on paper\`);
  check(hex(tokens['--dsw-static-neutral-bluish-50'].light).join() === '250,249,246', \`\${id}: the light page is the C2 paper #faf9f6\`);
  check(/arcTurn/.test(scoped), \`\${id}: the cube turn animation exists\`);
` + t.slice(b);
  const c = t.indexOf("  if (id === 'v0') {");
  const d = t.indexOf('  // grey ramp must keep its order');
  if (c < 0 || d < 0) throw new Error('v0 test block not found');
  t = t.slice(0, c) + t.slice(d);
  t = t.replace('checks the two skins without a browser', 'checks the Arc Harness skin without a browser');
  fs.writeFileSync(tf, t);
}
const pj = JSON.parse(fs.readFileSync(path.join(plugin, 'package.json'), 'utf8'));
pj.version = '0.4.0';
pj.description = 'The Arc Harness paper theme: cream surfaces, a dark-brown primary button, Geist type, rounded corners.';
fs.writeFileSync(path.join(plugin, 'package.json'), JSON.stringify(pj, null, 2) + '\n');
console.log('done: one skin (arc), tokens', Object.keys(T).length, 'scoped rules', arc.scoped.length);
