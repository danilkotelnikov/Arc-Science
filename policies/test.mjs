// Checks for the policy pack. Run: node test.mjs
// Part 1 checks policies.json, the icons and the generated text. Part 2 checks the files on disk
// (it passes quietly for a plugin folder that apply.mjs has not reached yet only when --pre is given).
import fs from 'node:fs';
import path from 'node:path';
import { loadPolicies, iconText, renderDoc, renderReadme, targetsFor, patchLocale } from './apply.mjs';

const pre = process.argv.includes('--pre');
let failed = 0, passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log('FAIL ' + msg); } };

const BANNED = /\b(robust|seamless|leverag\w*|delve\w*|cutting-edge|game-changer|unlock\w*|holistic|synerg\w*|state-of-the-art|comprehensive)\b/i;
const URL_RE = /https?:\/\/|\bwww\.|\b[\w-]+\.(com|org|net|io|dev|ai|cloud|app|cn|so|ru|xyz|co)\b/i;
const CONTRAST = /,\s+not\s+|\bnot\s+(just|only|merely|simply)\b/i;
const VENDOR = /deepseek|\bdsh\b/i;
const MIDDLE_DOT = /[·•‧⋅]/;
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const sentences = (s) => s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
/** Text a reader sees. The xmlns attribute of an icon is the one allowed address and is removed first. */
const clean = (s) => s.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
const scanText = (label, text) => {
  const t = clean(text);
  ok(!URL_RE.test(t), `${label}: contains a URL or domain (${(t.match(URL_RE) || [])[0]})`);
  ok(!MIDDLE_DOT.test(t), `${label}: contains a middle dot or bullet character`);
  ok(!BANNED.test(t), `${label}: banned word (${(t.match(BANNED) || [])[0]})`);
  ok(!CONTRAST.test(t), `${label}: "X, not Y" style contrast (${(t.match(CONTRAST) || [])[0]})`);
};

// ---- policies.json -----------------------------------------------------------------------------
const policies = loadPolicies();
ok(Array.isArray(policies) && policies.length === 18, `18 policy records (got ${policies.length})`);
const titles = new Set(), ids = new Set(), icons = new Set();
const SMALL = new Set(['of', 'and', 'the']);
for (const r of policies) {
  const L = r.id;
  for (const k of ['id', 'title', 'description', 'icon', 'purpose']) ok(typeof r[k] === 'string' && r[k].trim() !== '', `${L}: ${k} is a non-empty string`);
  for (const k of ['policy', 'workflow', 'settings', 'data', 'failure', 'verify']) ok(Array.isArray(r[k]) && r[k].length > 0 && r[k].every((x) => typeof x === 'string' && x.trim()), `${L}: ${k} is a non-empty list of strings`);
  ok(!ids.has(r.id), `${L}: id is unique`); ids.add(r.id);

  // title
  const tw = r.title.split(/\s+/);
  ok(tw.length >= 2 && tw.length <= 3, `${L}: title has 2 or 3 words ("${r.title}")`);
  ok(tw.every((w) => SMALL.has(w) || /^[A-Z]/.test(w)), `${L}: title is Title Case ("${r.title}")`);
  ok(!titles.has(r.title.toLowerCase()), `${L}: title is unique`); titles.add(r.title.toLowerCase());
  if (r.title !== 'Harness of Harness') ok(!VENDOR.test(r.title) && !/\bharness\b/i.test(r.title), `${L}: title has no vendor word`);
  ok(!VENDOR.test(r.title.replace('Harness of Harness', '')), `${L}: title has no DeepSeek or DSH`);

  // description
  ok(r.description.length <= 140, `${L}: description is ${r.description.length} chars (max 140)`);
  ok(/[.]$/.test(r.description) && sentences(r.description).length === 1, `${L}: description is one sentence that ends with a period`);
  ok(!VENDOR.test(r.description), `${L}: description has no vendor word`);
  ok(!icons.has(r.icon), `${L}: icon file is unique`); icons.add(r.icon);

  // sentence length: workflow and verify steps are instructions (max 20 words); the rest max 25
  for (const s of [...r.workflow, ...r.verify]) for (const x of sentences(s)) ok(words(x) <= 20, `${L}: instruction over 20 words (${words(x)}): ${x}`);
  for (const k of ['purpose', 'policy', 'settings', 'data', 'failure']) for (const s of [].concat(r[k])) for (const x of sentences(s)) ok(words(x) <= 25, `${L}: ${k} sentence over 25 words (${words(x)}): ${x}`);

  // generated text
  scanText(`${L} policy.md`, renderDoc(r));
  scanText(`${L} README.md`, renderReadme(r, true));
  scanText(`${L} meta`, r.title + '\n' + r.description);
  ok(/^# /.test(renderDoc(r)) && ['## Purpose', '## Policy', '## Workflow', '## Settings', '## Data it reads and writes', '## Failure behavior', '## How to verify'].every((h) => renderDoc(r).includes(h)), `${L}: policy.md has all seven sections`);
  ok(renderReadme(r, false).includes('docs/policy.md'), `${L}: README points to docs/policy.md`);
  JSON.parse(patchLocale(null, r));
  ok(true, `${L}: locale json parses`);

  // icon
  const svg = iconText(r);
  const label = `${L} icon`;
  ok(Buffer.byteLength(svg) < 256 * 1024, `${label}: under 256 KiB`);
  scanText(label, svg);
  checkIcon(label, svg);
}

function checkIcon(label, svg) {
  const rootM = svg.match(/^<svg ([^>]*)>\s*/);
  ok(!!rootM && /<\/svg>\s*$/.test(svg), `${label}: has an svg root`);
  if (!rootM) return;
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([a-zA-Z-:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const root = attrs(rootM[1]);
  const wantRoot = { xmlns: 'http://www.w3.org/2000/svg', 'data-arc-icon': '1', viewBox: '0 0 24 24', width: '24', height: '24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  ok(JSON.stringify(Object.keys(root).sort()) === JSON.stringify(Object.keys(wantRoot).sort()), `${label}: root attributes are exactly the allowed set`);
  for (const [k, v] of Object.entries(wantRoot)) ok(root[k] === v, `${label}: root ${k}="${v}"`);
  // The one style rule lets an icon that an image tag shows follow the light or dark scheme.
  // It sets the color that currentColor reads. It holds no color value of its own.
  const STYLE = '<style>svg[data-arc-icon]{color-scheme:light dark;color:CanvasText}</style>';
  ok(svg.includes(STYLE), `${label}: has the scheme style rule`);
  const body = svg.slice(rootM[0].length).replace(/<\/svg>\s*$/, '').replace(STYLE, '');
  const tags = [...body.matchAll(/<([a-zA-Z]+)\s([^>]*?)\/>/g)];
  ok(tags.length > 0, `${label}: has shapes`);
  ok(body.replace(/<([a-zA-Z]+)\s([^>]*?)\/>/g, '').trim() === '', `${label}: only self-closing shape tags`);
  const ALLOWED = { path: ['d', 'fill', 'stroke'], circle: ['cx', 'cy', 'r', 'fill', 'stroke'], rect: ['x', 'y', 'width', 'height', 'rx', 'fill', 'stroke'], line: ['x1', 'y1', 'x2', 'y2'] };
  const half = (n) => Number.isFinite(n) && Math.abs(n * 2 - Math.round(n * 2)) < 1e-9;
  const inBox = (n) => n >= 2.5 && n <= 21.5;
  for (const [, tag, a] of tags) {
    ok(tag in ALLOWED, `${label}: element <${tag}> is allowed`);
    const at = attrs(a);
    for (const k of Object.keys(at)) ok((ALLOWED[tag] || []).includes(k), `${label}: <${tag}> attribute ${k} is allowed`);
    for (const k of ['fill', 'stroke']) if (k in at) ok(['currentColor', 'none'].includes(at[k]), `${label}: ${k} is currentColor or none`);
    if (tag === 'circle') {
      const [cx, cy, r] = ['cx', 'cy', 'r'].map((k) => Number(at[k]));
      ok([cx, cy, r].every(half), `${label}: circle numbers sit on the half-pixel grid`);
      ok(inBox(cx - r) && inBox(cx + r) && inBox(cy - r) && inBox(cy + r), `${label}: circle stays inside the 2.5 to 21.5 box`);
    } else if (tag === 'rect') {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(at[k]));
      ok([x, y, w, h, Number(at.rx || 0)].every(half), `${label}: rect numbers sit on the half-pixel grid`);
      ok(inBox(x) && inBox(y) && inBox(x + w) && inBox(y + h), `${label}: rect stays inside the box`);
    } else if (tag === 'path') {
      const d = at.d || '';
      ok(/^[MLHVCSAZ0-9 .,\-]+$/.test(d), `${label}: path uses absolute commands only`);
      const toks = d.match(/[MLHVCSAZ]|-?\d+(?:\.\d+)?/g) || [];
      let cmd = null, args = [], bad = 0, off = 0;
      const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, A: 7, Z: 0 };
      const flush = () => {
        if (cmd === 'A') { const [rx, ry, , , , x, y] = args; if (![rx, ry, x, y].every(half)) bad++; if (!inBox(x) || !inBox(y)) off++; }
        else if (cmd === 'H') { if (!half(args[0])) bad++; if (!inBox(args[0])) off++; }
        else if (cmd === 'V') { if (!half(args[0])) bad++; if (!inBox(args[0])) off++; }
        else if (cmd && cmd !== 'Z') for (let i = 0; i < args.length; i += 2) { if (!half(args[i]) || !half(args[i + 1])) bad++; if (!inBox(args[i]) || !inBox(args[i + 1])) off++; }
      };
      for (const t of toks) {
        if (/^[A-Z]$/.test(t)) { cmd = t; args = []; if (t === 'Z') { cmd = 'Z'; } continue; }
        args.push(Number(t));
        if (args.length === arity[cmd]) { flush(); args = []; }
      }
      ok(bad === 0, `${label}: path numbers sit on the half-pixel grid (${bad} off)`);
      ok(off === 0, `${label}: path stays inside the 2.5 to 21.5 box (${off} outside)`);
    }
  }
}

// ---- files on disk -----------------------------------------------------------------------------
let seen = 0;
for (const r of policies) {
  for (const dir of targetsFor(r)) {
    seen++;
    const at = (f) => path.join(dir, ...f.split('/'));
    const L = `${r.id} @ ${dir.includes('local-plugins') ? 'local source' : dir.includes('\\web\\') || dir.includes('/web/') ? 'web' : 'desktop'}`;
    const exists = fs.existsSync(at('docs/policy.md'));
    if (!exists && pre) continue;
    ok(exists, `${L}: docs/policy.md exists`);
    if (!exists) continue;
    const lic = fs.existsSync(at('LICENSE'));
    ok(fs.readFileSync(at('docs/policy.md'), 'utf8') === renderDoc(r), `${L}: docs/policy.md matches the record`);
    ok(fs.readFileSync(at('README.md'), 'utf8') === renderReadme(r, lic), `${L}: README.md matches the record`);
    ok(fs.readFileSync(at('icon.svg'), 'utf8') === iconText(r), `${L}: icon.svg matches the record`);
    let loc, pkg;
    try { loc = JSON.parse(fs.readFileSync(at('locale/en.json'), 'utf8')); } catch (e) { ok(false, `${L}: locale/en.json parses (${e.message})`); }
    try { pkg = JSON.parse(fs.readFileSync(at('package.json'), 'utf8')); } catch (e) { ok(false, `${L}: package.json parses (${e.message})`); }
    if (loc) ok(loc.meta && loc.meta.title === r.title && loc.meta.description === r.description, `${L}: locale meta matches`);
    if (pkg) {
      ok(pkg.icon === 'icon.svg', `${L}: package.json icon is icon.svg`);
      if (pkg.exports && typeof pkg.exports === 'object') {
        ok(pkg.exports['./locale/*.json'] === './locale/*.json', `${L}: exports has the locale entry`);
        ok(pkg.exports['./icon'] === './icon.svg', `${L}: exports has the icon entry`);
      }
      if (Array.isArray(pkg.files)) ok(pkg.files.includes('icon.svg') && pkg.files.some((x) => x.startsWith('locale')) && pkg.files.some((x) => x.startsWith('docs')), `${L}: files lists icon, locale and docs`);
    }
    for (const f of ['docs/policy.md', 'README.md']) scanText(`${L} ${f}`, fs.readFileSync(at(f), 'utf8'));
    scanText(`${L} locale meta`, JSON.stringify(loc && loc.meta));
  }
}
ok(seen >= 36, `found ${seen} plugin folders (expect 38 with both profiles and the two local sources)`);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
