// arc-theme 0.4.0 (2026-11-01): checks the Arc Harness skin without a browser.
// Run: node test/theme.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../lib/client/index.js'), 'utf8');

let failures = 0;
const check = (ok, label) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
};

// Load the client file the way the browser does: a loader receives a factory.
let loaded;
const window = { __ModuleLoader__: { load: (m) => { loaded = m; } } };
const requires = { react: { createElement: () => null, useState: () => [null, () => {}], useEffect: () => {} } };
vm.runInNewContext(source, { window, document: {}, localStorage: {} });
const exp = loaded.factory((name) => requires[name] ?? {});

check(typeof exp.apply === 'function', 'client exports apply');
check(Array.isArray(exp.inject) && exp.inject.includes('theme'), 'client injects the theme service');
check(exp.SKINS && Object.keys(exp.SKINS).join() === 'arc' && exp.SKINS.arc.label === 'Arc Harness', 'one skin exists: Arc Harness (the v0 and Radium skins are gone)');

// The safety net: any picture or inline colour that is still blue is drawn in grey at run time.
check(typeof exp.isBlue === 'function', 'client exports isBlue (the safety net test for one colour)');
const NET_BLUE = [[0, 114, 245], [65, 118, 230], [90, 100, 255], [177, 151, 252], [5, 144, 157], [47, 111, 237], [74, 86, 153], [101, 142, 255]];
const NET_NOT = [[23, 23, 23], [143, 143, 143], [250, 249, 246], [88, 84, 73], [22, 163, 74], [220, 38, 38], [245, 158, 11], [255, 255, 255], [0, 0, 0], [235, 235, 238]];
check(NET_BLUE.every((c) => exp.isBlue?.(c) === true), 'isBlue: blues, indigos, violets and cyans are caught');
check(NET_NOT.every((c) => exp.isBlue?.(c) === false), 'isBlue: greys, warm greys, green, red and amber pass');
// reviewer 2026-10-31: near-neutral tints are not blue (slate-50, slate-100, tinted near-black), real blue-greys are
check([[248, 250, 252], [241, 245, 249], [10, 10, 15], [250, 250, 252]].every((c) => exp.isBlue?.(c) === false),
  'isBlue: near-white and near-black tints are not blue');
check([[148, 163, 184], [100, 116, 139], [59, 130, 246]].every((c) => exp.isBlue?.(c) === true), 'isBlue: blue-greys and blues are caught');
// 0.3.0 (Argon review): blue literals inside stylesheet rules are rewritten to grey, for every state and shorthand
const lumGrey = (r, g, b) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
check(typeof exp.greyBlues === 'function', 'client exports greyBlues (rewrites blue colour literals in one CSS value)');
if (typeof exp.greyBlues === 'function') {
  const g1 = lumGrey(59, 130, 246).toString(16).padStart(2, '0');
  check(exp.greyBlues('1px solid #3b82f6') === `1px solid #${g1}${g1}${g1}`, 'greyBlues: a hex blue becomes the grey of the same lightness');
  const g2 = lumGrey(47, 111, 237);
  check(exp.greyBlues('rgba(47, 111, 237, 0.5)') === `rgba(${g2}, ${g2}, ${g2}, 0.5)`, 'greyBlues: rgba keeps its alpha');
  check(exp.greyBlues('#22c55e') === '#22c55e' && exp.greyBlues('rgb(250, 249, 246)') === 'rgb(250, 249, 246)'
    && exp.greyBlues('#dc2626') === '#dc2626', 'greyBlues: green, warm white and red stay');
  const gr = exp.greyBlues('linear-gradient(90deg, #3b82f6 0%, #ffffff 100%)');
  check(gr.includes('#ffffff') && !gr.includes('3b82f6'), 'greyBlues: only the blue stop of a gradient changes');
  const hs = exp.greyBlues('hsl(220 90% 56%)');
  check(!/hsl/.test(hs) && exp.greyBlues('hsl(0 0% 50%)') === 'hsl(0 0% 50%)', 'greyBlues: hsl blue changes, hsl grey stays');
  const du = exp.greyBlues("url(\"data:image/svg+xml;utf8,<svg fill='%233b82f6'/>\")");
  check(du.includes('%23' + g1 + g1 + g1) && !du.includes('3b82f6'), 'greyBlues: blue inside an svg data address changes');
  // Argon round 2 (B8, B9): named blues inside shorthands, gradients and color-mix
  const gn = (r, g, b) => lumGrey(r, g, b);
  const rb = exp.greyBlues('1px solid royalblue');
  check(rb === `1px solid rgb(${gn(65, 105, 225)}, ${gn(65, 105, 225)}, ${gn(65, 105, 225)})`, 'greyBlues: a named blue in a shorthand becomes grey');
  const gb = exp.greyBlues('linear-gradient(blue, white)');
  check(!/\bblue\b/.test(gb) && gb.includes('white'), 'greyBlues: a named blue in a gradient becomes grey, white stays');
  const cm = exp.greyBlues('color-mix(in srgb, blue 40%, white)');
  check(!/\bblue\b/.test(cm) && cm.includes('white'), 'greyBlues: a named blue in color-mix becomes grey');
  const cm2 = exp.greyBlues('color-mix(in srgb, #0066ff 50%, white)');
  check(!cm2.includes('0066ff') && cm2.includes('white'), 'greyBlues: a hex blue in color-mix becomes grey');
  check(exp.greyBlues('var(--color-blue-500)') === 'var(--color-blue-500)' && exp.greyBlues('url(images/blue.png)') === 'url(images/blue.png)'
    && exp.greyBlues('"blue sky"') === '"blue sky"' && exp.greyBlues('1px solid red') === '1px solid red', 'greyBlues: names inside var(), url(), quotes and other names stay');
  check(exp.greyBlues('url(#bad)') === 'url(#bad)', 'greyBlues: an id in url(#id) is not a colour');
  check(exp.greyBlues('none') === 'none' && exp.greyBlues('') === '' && exp.greyBlues('4px 8px') === '4px 8px', 'greyBlues: values without colour are untouched');
}
// Owner decision, 2026-10-31: eliminate point delimiters (the middle dot and bullets) from the interface text
check(typeof exp.fixDelimiters === 'function', 'client exports fixDelimiters');
if (typeof exp.fixDelimiters === 'function') {
  const fd = exp.fixDelimiters;
  check(fd('5m28s · 39 calls') === '5m28s, 39 calls', 'fixDelimiters: a middle dot between two items becomes a comma');
  check(fd('1 · Choose your chat model') === '1. Choose your chat model', 'fixDelimiters: a step number keeps a full stop');
  check(fd(' · ') === ', ' && fd('·') === ', ', 'fixDelimiters: a node that holds only the delimiter becomes a comma');
  check(fd('md · markdown') === 'md, markdown' && fd('Tasks · default-workspace') === 'Tasks, default-workspace', 'fixDelimiters: label pairs');
  check(fd('• Item') === 'Item' && fd('a • b • c') === 'a, b, c', 'fixDelimiters: bullets');
  check(fd('x · ') === 'x', 'fixDelimiters: a trailing delimiter is dropped');
  check(fd('Ca·H2O') === 'Ca·H2O' && fd('plain text') === 'plain text', 'fixDelimiters: no space around the dot means a formula, keep it');
  // Owner decision, 2026-10-31 (screenshot): "Deep diving for 3s ···" showed as "Deep diving for 3s,,"
  check(fd('Deep diving for 3s ···') === 'Deep diving for 3s…' && fd('···') === '…' && fd('Loading ··· done') === 'Loading… done',
    'fixDelimiters: a run of dots is a loading marker and becomes one ellipsis, never commas');
}
// Owner decision, 2026-10-31 (screenshot): the AI Review panel showed pale text on a white sheet because only its text colour followed the skin
const arRules = source.split('[data-arc-auto-review]{').slice(1).map((s) => s.split('}')[0]);
check(arRules.length === 1 && arRules.every((r) => ['--ar-fg', '--ar-muted', '--ar-bg', '--ar-border'].every((v) => r.includes(v + ':var(--dsw-alias-'))),
  'AI Review panel: the skin sets text, muted text, surface and border from its tokens');
check(typeof exp.blueCss === 'function' && exp.blueCss('rgb(47, 111, 237)') === true && exp.blueCss('rgb(143, 143, 143)') === false
  && exp.blueCss('rgba(47, 111, 237, 0)') === false && exp.blueCss('none') === false, 'blueCss reads a computed colour string, ignores none and transparent');

// Colour helpers
const hex = (s) => {
  const m = /^#([0-9a-f]{6})$/i.exec(s);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = ([r, g, b]) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Owner decision, 2026-10-31: no blue anywhere. A colour is blue when its hue lies in 180..265
// degrees and it is not a plain grey (saturation above 0.10). Alpha is ignored.
const hsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const hexAny = (s) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const isBlue = (rgb) => { const [h, s] = hsl(rgb); return h >= 180 && h <= 265 && s > 0.10; };

// Tokens the app ships in a blue, violet or blue-grey hue (read from the running app, 2026-10-31).
const BLUE_BASE = [
  ...['50', '50p', '75', '100', '300', '400', '450', '500', '600', '800', '900', '950'].map((s) => `--dsw-static-blue-${s}`),
  ...['50', '100', '200', '300', '400', '450', '500', '600', '700-delete', '800', '900'].map((s) => `--dsw-static-deepseek-${s}`),
  '--dsw-alias-brand-primary-new-colorprimary-new-color', '--dsw-alias-onboarding-accent',
  '--dsw-alias-bg-mask-drop', '--dsw-menu-surface-fill', '--dsw-alias-menu-group-header-fill',
  '--dsw-gradient-onboarding-violet-stops', '--dsw-gradient-onboarding-blue-stops', '--dsw-gradient-onboarding-cyan-stops',
  '--dsw-linear-think-select',
  '--color-blue-500', '--color-indigo-500', '--color-violet-500', '--color-slate-400',
  '--shiki-token-constant', '--shiki-token-function', '--shiki-token-link', '--shiki-token-comment', '--shiki-token-punctuation',
];

// Roles of the app's grey steps (from the app's own token sheet):
// light: base 00, primary 1000, secondary 700, tertiary 600
// dark : base 950, primary 50,   secondary 300, tertiary 400
const ROLES = {
  light: { base: '00', primary: '1000', secondary: '700', tertiary: '600' },
  dark: { base: '950', primary: '50', secondary: '300', tertiary: '400' },
};
const MIN = { primary: 12, secondary: 6, tertiary: 4.5 }; // C2's own muted text #645e55 on white is 6.4:1

for (const [id, skin] of Object.entries(exp.SKINS ?? {})) {
  const tokens = skin.tokens;
  const names = Object.keys(tokens);
  check(names.length > 20, `${id}: has ${names.length} tokens`);
  check(names.every((n) => /^--(dsw|arc|shiki|color)-/.test(n)), `${id}: every token name is an app variable`);
  check(names.every((n) => typeof tokens[n].light === 'string' && typeof tokens[n].dark === 'string'),
    `${id}: every token has a light and a dark value`);
  const missing = BLUE_BASE.filter((n) => !(n in tokens));
  check(missing.length === 0, `${id}: every blue base token is overridden (${missing.length} missing${missing.length ? ': ' + missing.join(' ') : ''})`);
  // a token value may hold several colours (gradient stops), so read every hex colour in it
  const blues = names.flatMap((n) => ['light', 'dark'].flatMap((m) =>
    (tokens[n][m].match(/#[0-9a-f]{6}(?:[0-9a-f]{2})?\b/gi) ?? []).map((c) => [n, m, hexAny(c)])))
    .filter(([, , c]) => c && isBlue(c)).map(([n, m]) => `${n}/${m}`);
  check(blues.length === 0, `${id}: no blue token value (${blues.length} found${blues.length ? ': ' + blues.slice(0, 6).join(' ') : ''})`);
  const scoped = [].concat(skin.scoped ?? []).join('\n');
  check(/json-tree-number/.test(scoped) && /file-type-violet/.test(scoped) && /meter-tint/.test(scoped),
    `${id}: scoped rules cover json-tree, file-type-violet and meter-tint`);
  check(/_cardIcon[^{]*\{[^}]*grayscale\(1\)/.test(scoped), `${id}: plugin card icons are drawn in grey`);
  // plugin screens that set their own colours (reasoning slider, Visualize, auto-review, body text)
  check(/\.re-effort\{[^}]*grayscale\(1\)/.test(scoped), `${id}: the reasoning slider is drawn in grey`);
  check(/\.arcviz-option\[data-selected="true"\]\{[^}]*border-color:var\(--dsw-alias-label-primary\)/.test(scoped)
    && /arcviz-select:focus-visible[^{]*\{[^}]*outline-color:var\(--dsw-alias-label-primary\)/.test(scoped),
    `${id}: Visualize selection and focus use the ink colour`);
  check(/html body\{color:var\(--dsw-alias-label-primary\)\}/.test(scoped) && /--ar-fg:var\(--dsw-alias-label-primary\)/.test(scoped),
    `${id}: body text and the auto-review text use the ink colour`);
  check(/\[data-arc-gray\]\{[^}]*grayscale\(1\)/.test(scoped), `${id}: the safety net rule draws marked elements in grey`);
  check(/\.arcviz-button\{[^}]*background:var\(--dsw-alias-label-primary\)/.test(scoped), `${id}: Visualize buttons use the ink colour`);
  const scopedBlue = (scoped.match(/#[0-9a-f]{6}(?:[0-9a-f]{2})?\b/gi) ?? []).filter((c) => isBlue(hexAny(c)));
  check(scopedBlue.length === 0, `${id}: no blue colour in the scoped rules (${scopedBlue.length} found)`);
  // the C2 look: cards 10 px, controls 8 px, Geist type, a dark-brown primary button, cream paper
  check(tokens['--dsw-radius-md'].light === '10px' && tokens['--dsw-radius-sm'].light === '8px', `${id}: cards are 10 px and controls 8 px`);
  check(!/border-radius:\s*0\s*!important/.test(scoped), `${id}: no rule squares the corners`);
  check(/^"Geist"/.test(tokens['--arc-font-family-text-default'].light) && /^"Geist Mono"/.test(tokens['--arc-font-family-code-default'].light), `${id}: text is Geist and code is Geist Mono`);
  check(/@font-face\{font-family:Geist;/.test(scoped) && /@font-face\{font-family:Geist Mono;/.test(scoped), `${id}: Geist and Geist Mono are embedded`);
  check(tokens['--dsw-alias-button-info-fill'].light === '#54453c', `${id}: the send button is the C2 dark brown on paper`);
  check(hex(tokens['--dsw-static-neutral-bluish-50'].light).join() === '250,249,246', `${id}: the light page is the C2 paper #faf9f6`);
  check(tokens['--dsw-alias-bg-base'].light === '#faf9f6' && tokens['--dsw-alias-bg-layer-1'].light === '#ffffff' && tokens['--dsw-specific-sidebar-fill'].light === '#f4f2ed', `${id}: the canvas is paper, cards are white, the sidebar is #f4f2ed (the C2 layers)`);
  check(tokens['--dsw-alias-bg-base'].dark === '#171614' && tokens['--dsw-specific-sidebar-fill'].dark === '#1b1a18', `${id}: the dark canvas and sidebar are the C2 dark set`);
  { const cap = hex(tokens['--dsw-alias-label-caption'].light); const lumOf = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }; check((1.05) / (lumOf(cap) + 0.05) >= 4.5, `${id}: captions and placeholders have 4.5:1 contrast on white`); }
  check(/arcTurn/.test(scoped), `${id}: the cube turn animation exists`);
  for (const mode of ['light', 'dark']) {
    const r = ROLES[mode];
    const pick = (step) => hex(tokens[`--dsw-static-neutral-bluish-${step}`]?.[mode] ?? '');
    const base = pick(r.base);
    check(base !== null, `${id}/${mode}: base surface is a hex colour`);
    for (const role of ['primary', 'secondary', 'tertiary']) {
      const fg = pick(r[role]);
      const ratio = fg && base ? contrast(fg, base) : 0;
      check(ratio >= MIN[role], `${id}/${mode}: ${role} text contrast ${ratio.toFixed(1)} >= ${MIN[role]}`);
    }
  }
  // the send button keeps a hard-coded white icon, so its fill must hold white (graphic contrast 3:1)
  for (const mode of ['light', 'dark']) {
    const fill = hex(tokens['--dsw-alias-button-info-fill']?.[mode] ?? '');
    const ratio = fill ? contrast(fill, [255, 255, 255]) : 0;
    check(ratio >= 3, `${id}/${mode}: send button fill holds a white icon (${ratio.toFixed(1)} >= 3)`);
  }
  // grey ramp must keep its order: light mode steps go from light to dark
  const order = ['00', '50', '60', '75', '100', '150', '200', '300', '400', '500', '600', '700', '750', '800', '850', '875', '900', '950'];
  const ls = order.map((s) => lum(hex(tokens[`--dsw-static-neutral-bluish-${s}`].light)));
  check(ls.every((v, i) => i === 0 || v <= ls[i - 1] + 1e-9), `${id}/light: grey ramp never gets lighter going down`);
  const ds = order.map((s) => lum(hex(tokens[`--dsw-static-neutral-bluish-${s}`].dark)));
  check(ds.every((v, i) => i === 0 || v <= ds[i - 1] + 1e-9), `${id}/dark: grey ramp never gets lighter going down`);
}


// ---- motion and icons (2026-11-03) ------------------------------------------------------------
{
  const skin = (exp.SKINS ?? {}).arc;
  const css = [].concat(skin.scoped ?? []).join(String.fromCharCode(10));
  const kfs = [...css.matchAll(/@keyframes\s+(arc\w+)\{((?:[^{}]|\{[^{}]*\})*)\}/g)].filter((m) => m[1] !== 'arcTurn');
  check(kfs.length >= 6, `motion: ${kfs.length} new keyframes`);
  const OK = new Set(['transform', 'opacity']);
  for (const [, name, body] of kfs) {
    const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    check(props.length > 0 && props.every((p) => OK.has(p)), `motion: ${name} animates only transform and opacity`);
  }
  const reduced = (css.match(/@media \(prefers-reduced-motion:reduce\)\{([^@]*)\}\}/g) ?? []).join('');
  const rules = [...css.matchAll(/(?:^|\})([^{}@]+)\{animation:(arc\w+) \d+ms /gm)];
  check(rules.length >= 8, `motion: ${rules.length} animated rules`);
  for (const [, sel, name] of rules) {
    check(sel.split(',').every((s) => reduced.includes(s.trim())), `motion: reduced-motion covers ${name} on ${sel.slice(0, 40)}`);
  }
  check(/animation:none !important/.test(reduced) && /button:not\(:disabled\):active/.test(reduced), 'motion: reduced-motion turns off animation and the button press');
  for (const m of css.matchAll(/animation:arc\w+ (\d+)ms/g)) check(+m[1] >= 120 && +m[1] <= 320, `motion: duration ${m[1]} ms is within 120 to 320`);
  check(!/(?:transition|animation)[^;{}]*(width|height|top|left|margin|box-shadow|filter)/.test(css.replace(/@font-face[^}]*\}/g, '')), 'motion: no layout property is animated or transitioned');
}
{
  const { readdirSync, existsSync } = await import('node:fs');
  const roots = ['../..', '../../../profiles/web/node_modules', '../../../profiles/desktop/node_modules'].map((r) => join(here, r));
  const INK = /^(none|currentcolor|canvastext|#111111|#faf9f6|#a09d93)$/i;
  let n = 0;
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root)) {
      if (!/^(arc-|arc-|superpowers-arc|arc-harness-remote)/.test(d)) continue;
      const f = join(root, d, 'icon.svg');
      if (!existsSync(f)) continue;
      const svg = readFileSync(f, 'utf8');
      n += 1;
      const colours = [...svg.matchAll(/(?:fill|stroke|color)\s*[=:]\s*"?([^";}\s]+)/g)].map((m) => m[1]);
      const bad = colours.filter((c) => !INK.test(c));
      check(bad.length === 0 && /stroke-width="1\.5"/.test(svg) && /viewBox="0 0 24 24"/.test(svg) && !svg.includes(String.fromCharCode(183)), `icon ${d}: ink colours only, 24 grid, stroke 1.5${bad.length ? ' (bad: ' + bad.join(' ') + ')' : ''}`);
    }
  }
  check(n >= 1, `icons: ${n} icon.svg files checked`);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
