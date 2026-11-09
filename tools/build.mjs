// Build the Arc Harness app archive from the pristine DeepSeek Harness archive.
//   node tools/build.mjs [out.asar]      default out: build/app.asar
// Every patch asserts how many places it changed, so a different upstream build fails loudly instead of half-applying.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openAsar, writeAsar } from '../lib/asar.mjs';
import { allow, rewriteFile, rewriteHosts } from '../lib/brandrules.mjs';
import { recolorSvg, recolorBlueAttrsInScript, recolorBlueTokens, replaceVendorBlue, recolorBlueHues, HUE_ARCHIVE } from '../lib/iconcolor.mjs';
import { swapPicture } from '../lib/whaleimg.mjs';
import { arcText, LEFT } from '../lib/arcnames.mjs';
import { makeArcCopy } from '../lib/arcunpacked.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'build', 'app.asar'));
const brand = JSON.parse(fs.readFileSync(path.join(root, 'brand', 'dist', 'brand.json'), 'utf8'));
const dist = (f) => fs.readFileSync(path.join(root, 'brand', 'dist', f));
const src = openAsar(path.join(root, 'pristine', 'app.asar'));

const DS = 'dsh/node_modules/@deepseek-ai/';
const overrides = new Map();
const report = [];
const text = (p) => { const f = src.byPath.get(p); if (!f) throw new Error('missing in archive: ' + p); return (overrides.get(p) ?? src.read(f)).toString('utf8'); };
const put = (p, s) => overrides.set(p, Buffer.isBuffer(s) ? s : Buffer.from(s, 'utf8'));
const must = (cond, msg) => { if (!cond) throw new Error('patch failed: ' + msg); };
const lit = (s) => JSON.stringify(s); // JS string literal
// a changed module must still parse: node --check on the text, written to a throwaway folder beside the output
function mustParse(code, what) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const dir = fs.mkdtempSync(path.join(path.dirname(out), 'parse-'));
  try {
    const f = path.join(dir, 'm.mjs');
    fs.writeFileSync(f, code);
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    must(r.status === 0, `${what} no longer parses :: ${(r.stderr || '').split('\n').slice(0, 3).join(' | ')}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// replace one `function name(...) {...}` by brace matching; returns [newSource, oldLength]
function replaceFunction(code, name, replacement) {
  const start = code.indexOf(`function ${name}(`);
  must(start >= 0 && code.indexOf(`function ${name}(`, start + 1) < 0, `function ${name} must exist exactly once`);
  let i = code.indexOf('{', code.indexOf(')', start));
  let depth = 0, inStr = null;
  for (; i < code.length; i++) {
    const c = code[i];
    if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) { i++; break; }
  }
  return code.slice(0, start) + replacement + code.slice(i);
}
const replaceOnce = (code, find, repl, what) => {
  const n = code.split(find).length - 1;
  must(n === 1, `${what}: expected 1 match, found ${n}`);
  return code.replace(find, () => repl);
};

// ---- colour: the AS cube is one colour, #0A0A0A on light pages and white on dark pages
const FILL = 'light-dark(#0A0A0A,#FFFFFF)';
// code for one cube as a React element; J and JS are the jsx and jsxs call expressions of the target module
const cubeCode = (J, JS, size, cls, face, style) => {
  const [left, right] = face === 'right' ? [brand.rightFaceLeft, brand.rightFaceRight] : face === 'plain' ? [brand.leftPlain, brand.right] : [brand.leftAS, brand.right];
  const path = (d) => `${J}("path",{d:${lit(d)},fillRule:"evenodd",style:{fill:${lit(FILL)}}})`;
  return `${JS}("svg",{width:${size},height:${size},className:${cls},viewBox:${lit(brand.view)},fill:"none","aria-hidden":"true"${style ? ',style:' + style : ''},children:[${path(brand.top)},${path(left)},${path(right)}]})`;
};
const NAME_STYLE = '{fontFamily:"Geist, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",fontWeight:600,fontSize:e*.72+"px",lineHeight:1,letterSpacing:"-.01em",whiteSpace:"nowrap"}';

// ---- patch 1: the shared logo components in the web frontend bundle
// mark: the AS cube at every size (letters on the left face); name: live text in Geist 600 (no artwork)
{
  const p = DS + 'dsh-web-frontend/dist/assets/index-BXV-oxvX.js';
  let s = text(p);
  const mark = `function gA({size:e=24,className:t}){return ${cubeCode('d.jsx', 'd.jsxs', 'e', 't', 'as')}}`;
  const name = `function vA({size:e=24,className:t,includeMark:r=!0}){const n=d.jsx("span",{className:r?void 0:t,style:${NAME_STYLE},children:"Arc Harness"});return r?d.jsxs("span",{className:t,style:{display:"inline-flex",alignItems:"center",gap:e*.3+"px"},children:[gA({size:e}),n]}):n}`;
  s = replaceFunction(s, 'gA', mark);
  s = replaceFunction(s, 'vA', name);
  const whale = s.match(/\bIs=\{width:[\d.]+,height:[\d.]+\},I_="[^"]*"/g);
  must(whale && whale.length === 1, 'whale outline constant');
  const uses = (s.match(/\bI_\b/g) || []).length;
  must(uses === 2, `old whale constant I_ must only be defined and exported after the swap (uses ${uses})`);
  s = s.replace(whale[0], () => `Is={width:256,height:256},I_=${lit(brand.top)}`);
  put(p, s);
  report.push('logo components: AS cube mark and live-text name replace the whale and its wordmark');
}

// ---- patch 1b: the hero of an empty session: a large AS cube that turns to its other face on hover (was a whale that swims)
{
  const p = DS + 'dsh-client-ui-conversation/lib/client.js';
  let s = text(p);
  const J = '(0, react_jsx_runtime.jsx)', JS = '(0, react_jsx_runtime.jsxs)';
  // the face is picked at run time: letters on the left face, or on the right face after a hover
  const asLeft = cubeCode(J, JS, '88', 'HeroShell_module_css_default.fish', 'as');
  const asRight = cubeCode(J, JS, '88', 'HeroShell_module_css_default.fish', 'right');
  const hero2 = `function HeroFish({ hovering }) { const [face, setFace] = (0, react.useState)(0); (0, react.useEffect)(() => { if (hovering) setFace((f) => 1 - f); }, [hovering]); return (0, react_jsx_runtime.jsx)("span", { key: face, style: { display: "inline-flex", animation: face === 1 ? "arcTurn .62s ease-in-out" : "none" }, children: face === 1 ? ${asRight} : ${asLeft} }); }`;
  s = replaceFunction(s, 'HeroFish', hero2);
  const swim = /const HERO_SWIM_(UP|DOWN)_PATH = "[^"]*";/g;
  must((s.match(swim) || []).length === 2, 'whale swim paths');
  s = s.replace(swim, (m, d) => `const HERO_SWIM_${d}_PATH = "";`);
  put(p, s);
  report.push('hero of an empty session: large AS cube that turns on hover; whale swim paths removed');
}

// ---- patch 1c: the account onboarding screenshots (whale, old wordmark, account details) become a 1x1 transparent GIF
// The plugin row is off but listed on the Plugins page. Runs before the brand text pass so that pass never reads the image data.
{
  const p = DS + 'dsh-client-ui-settings-account/lib/client.js';
  const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const re = /data:image\/webp;base64,[A-Za-z0-9+/=]+/g;
  let s = text(p);
  const n = (s.match(re) || []).length;
  must(n === 8, `account onboarding images: expected 8 webp data URIs, found ${n}`);
  s = s.replace(re, () => PIXEL);
  must(!/data:image\/webp/.test(s), 'account onboarding images: a webp data URI is left');
  mustParse(s, p);
  put(p, s);
  report.push(`account onboarding: ${n} embedded screenshots replaced by a 1x1 transparent GIF`);
}

// ---- patch 2: the running indicator in the chat client (animated mask and still icon): the plain cube
// This is the one place that keeps the plain cube: it is a moving indicator, not the logo.
{
  const p = DS + 'dsh-client-ui-chat/lib/client.js';
  let s = text(p);
  const maskRe = /mask:url\(data:image\/png;base64,[A-Za-z0-9+/=]+\) 50%\/100% 100% no-repeat alpha\}/g;
  must((s.match(maskRe) || []).length === 1, 'running whale mask');
  const one = brand.top + brand.leftPlain + brand.right;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${brand.view}'><path fill-rule='evenodd' d='${one}'/></svg>`;
  const uri = 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
  s = s.replace(maskRe, () => `mask:url(${uri}) 50%/100% 100% no-repeat alpha;animation:arcRunning 1.6s ease-in-out infinite}@keyframes arcRunning{0%,100%{opacity:.35;transform:scale(.9)}50%{opacity:1;transform:scale(1)}}`);
  const defRe = /const REST_PATH = "[^"]*";/;
  must(defRe.test(s), 'REST_PATH definition');
  s = s.replace(defRe, () => `const REST_PATH = ${lit(one)};`);
  const stillRe = /viewBox: "0 0 16 16",\s*fill: "none",\s*children: \(0, react_jsx_runtime\.jsx\)\("path", \{\s*d: REST_PATH,\s*stroke: "currentColor",\s*strokeWidth: 1\s*\}\)/g;
  must((s.match(stillRe) || []).length === 1, 'still icon');
  s = s.replace(stillRe, () => `viewBox: ${lit(brand.view)}, fill: "none", children: (0, react_jsx_runtime.jsx)("path", { d: REST_PATH, fill: "currentColor", fillRule: "evenodd" })`);
  put(p, s);
  report.push('running indicator: the plain cube, animated mask and still icon');
}

// ---- patch 3: product name in every visible string
{
  const NAME = /DeepSeek[  ]Harness/g;
  const skip = /(^|\/)(package\.json|desktop-runtime\.json|LICENSE[^/]*|NOTICE[^/]*)$|\.md$|\.d\.ts$|\.map$|\/licenses\//;
  const wanted = (p) => (/\.(js|mjs|cjs|json|html|css|webmanifest|yaml|yml)$/.test(p)
    && (p.startsWith(DS) || p.startsWith('lib/') || p.startsWith('renderer/'))
    && !/node_modules\/(?!@deepseek-ai\/)/.test(p.replace(DS, '')));
  let files = 0, hits = 0;
  for (const f of src.files) {
    if (f.entry.unpacked || f.entry.size > 12e6 || skip.test(f.path) || !wanted(f.path)) continue;
    const s = text(f.path);
    const n = (s.match(NAME) || []).length;
    if (!n) continue;
    put(f.path, s.replace(NAME, 'Arc Harness'));
    files++; hits += n;
  }
  report.push(`product name: ${hits} places in ${files} files now say Arc Harness`);
  // visible sentences that name the old vendor; each must match somewhere or the build stops
  const PHRASES = [
    ['Stopped because you signed out of DeepSeek.', 'Stopped because you signed out.'],
    ['Sign in to DeepSeek and ensure the request destination supports account authentication.', 'Sign in and ensure the request destination supports account authentication.'],
    ['"DeepSeek Account"', '"Account"'],
    ['Configure the official DeepSeek provider to start building.', 'Configure a model provider to start building.'],
    ['Help improve DeepSeek models and products.', 'Help improve models and products.'],
    ['Set up the DeepSeek search provider.', 'Set up the web search provider.'],
    ["Off by default: search runs through DeepSeek Messages. For the new Web Search API's features and pricing, see the", "Off by default: search runs through the model provider. For the Web Search API's features and pricing, see the"],
    ['only conversations using a DeepSeek Account model can search', 'only conversations using an account model can search'],
    ['Configure your DeepSeek account or Official API provider', 'Configure your account or API provider'],
    ['Configure official DeepSeek models to start using Harness', 'Configure a model provider to start using Arc Harness'],
    ['"Into the Unknown"', '"What would you like to investigate?"'],
  ];
  const phraseHits = new Map(PHRASES.map(([a]) => [a, 0]));
  for (const f of src.files) {
    if (f.entry.unpacked || f.entry.size > 12e6 || skip.test(f.path) || !wanted(f.path)) continue;
    let s = text(f.path), changed = false;
    for (const [from, to] of PHRASES) {
      if (!s.includes(from)) continue;
      phraseHits.set(from, phraseHits.get(from) + s.split(from).length - 1);
      s = s.split(from).join(to); changed = true;
    }
    if (changed) put(f.path, s);
  }
  for (const [k, n] of phraseHits) must(n > 0, `phrase not found: ${k.slice(0, 60)}`);
  report.push(`vendor sentences: ${PHRASES.length} phrases rewritten`);
  // plugin installs use the public npm registry only (the app falls back to a Chinese mirror otherwise)
  let mirror = 0;
  for (const f of src.files) {
    if (f.entry.unpacked || f.entry.size > 12e6 || skip.test(f.path) || !wanted(f.path)) continue;
    const s = text(f.path);
    if (!s.includes('registry.npmmirror.com')) continue;
    mirror += s.split('registry.npmmirror.com').length - 1;
    put(f.path, s.split('registry.npmmirror.com').join('registry.npmjs.org'));
  }
  must(mirror > 0, 'npm mirror address');
  report.push(`npm mirror: ${mirror} addresses point to the public registry`);
  // the app manifest: no remote update policy, own names
  const pj = JSON.parse(text('package.json'));
  delete pj.dshMandatoryUpdatePolicy;
  pj.description = 'Arc Harness desktop shell';
  put('package.json', JSON.stringify(pj, null, 2) + '\n');
  report.push('app manifest: remote mandatory-update policy removed');
}

// ---- patch 3c: package metadata of the app's own packages: no repository, homepage, bugs or funding links; product name in descriptions
{
  let n = 0, desc = 0;
  for (const f of src.files) {
    if (f.entry.unpacked || !/^dsh\/node_modules\/@deepseek-ai\/[^/]+\/package\.json$/.test(f.path)) continue;
    const raw = text(f.path);
    const j = JSON.parse(raw);
    let changed = false;
    for (const k of ['repository', 'homepage', 'bugs', 'funding']) if (k in j) { delete j[k]; changed = true; }
    if (typeof j.description === 'string' && /DeepSeek[  ]Harness/.test(j.description)) { j.description = j.description.replace(/DeepSeek[  ]Harness/g, 'Arc Harness'); changed = true; desc++; }
    if (!changed) continue;
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const indent = /^(\t| +)"/m.exec(raw)?.[1] ?? '  ';
    put(f.path, JSON.stringify(j, null, indent).replace(/\n/g, eol) + (/\n$/.test(raw) ? eol : ''));
    n++;
  }
  must(n > 100, 'package metadata of the app packages');
  report.push(`package metadata: source links removed in ${n} app packages, ${desc} descriptions renamed`);
}

// ---- patch 4: web manifest and favicons
{
  const base = DS + 'dsh-web-frontend/dist/';
  const wm = JSON.parse(text(base + 'manifest.webmanifest'));
  wm.name = 'Arc Harness'; wm.short_name = 'Arc Harness';
  put(base + 'manifest.webmanifest', JSON.stringify(wm, null, 2) + '\n');
  put(base + 'favicon.svg', dist('favicon.svg'));
  put(base + 'favicon-dark.svg', dist('favicon-dark.svg'));
  report.push('web manifest and both favicons replaced');
}

// ---- patch 5: drop the Chinese material of the app itself
// Inline dictionaries come in pairs (English first, Chinese second, same keys). Each Chinese value becomes its English
// twin, found by the nearest line that has the same key. Chinese locale files become copies of the English file.
{
  const CJK = /[　-〿㐀-鿿＀-￯]/;
  const LINE = /^(\s*)((?:"[^"\\\n]+"|'[^'\\\n]+'|[A-Za-z_$][\w$]*)\s*:\s*)("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')(\s*,?\s*)$/;
  const keyOf = (k) => k.replace(/\s*:\s*$/, '').replace(/^["']|["']$/g, '');
  let folded = 0, filesFolded = 0, residualFiles = 0, residualRuns = 0, localeFiles = 0, docFiles = 0;
  for (const f of src.files) {
    if (f.entry.unpacked || f.entry.size > 12e6) continue;
    const p = f.path;
    if (/\/locale\/zh[^/]*\.json$/.test(p)) {
      const enPath = p.replace(/zh[^/]*\.json$/, 'en.json');
      if (src.byPath.has(enPath)) { put(p, text(enPath)); localeFiles++; }
      continue;
    }
    if (/(^|\/)(README(\.[a-z-]+)?\.zh[^/]*\.md|README\.zh\.md|README\.i18n\.yaml|[^/]*\.zh\.md)$/.test(p)) { overrides.set(p, null); docFiles++; continue; }
    const inScope = (p.startsWith(DS) && /\/lib\/.*\.(js|mjs|cjs)$/.test(p) && !/\/lib\/devtools\//.test(p)) || /^lib\/[^/]*\.(js|cjs)$/.test(p) || /^lib\/welcome\/[^/]*\.js$/.test(p);
    if (!inScope) continue;
    const code = text(p);
    if (!CJK.test(code)) continue;
    const lines = code.split('\n');
    const english = new Map(); // key -> [line numbers with a non-Chinese value]
    lines.forEach((l, i) => { const m = LINE.exec(l); if (m && !CJK.test(m[3])) { const k = keyOf(m[2]); (english.get(k) || english.set(k, []).get(k)).push(i); } });
    let n = 0;
    lines.forEach((l, i) => {
      const m = LINE.exec(l);
      if (!m || !CJK.test(m[3])) return;
      const list = english.get(keyOf(m[2]));
      if (!list) return;
      const j = list.reduce((best, x) => (Math.abs(x - i) < Math.abs(best - i) ? x : best), list[0]);
      lines[i] = m[1] + m[2] + LINE.exec(lines[j])[3] + m[4];
      n++;
    });
    // arrays of strings under one key ("key: [", one string per line, "],"): fold item by item
    const ARR_OPEN = /^\s*((?:"[^"\\\n]+"|'[^'\\\n]+'|[A-Za-z_$][\w$]*))\s*:\s*\[\s*$/;
    const ITEM = /^(\s*)("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')(\s*,?\s*)$/;
    const arrays = [];
    for (let i = 0; i < lines.length; i++) {
      const o = ARR_OPEN.exec(lines[i]);
      if (!o) continue;
      const items = [];
      let j = i + 1;
      for (; j < lines.length && ITEM.test(lines[j]); j++) items.push(j);
      if (j < lines.length && /^\s*\](?:\.join\([^)]*\))?,?\s*$/.test(lines[j]) && items.length) arrays.push({ key: keyOf(o[1] + ':'), at: i, items });
    }
    for (const z of arrays) {
      if (!z.items.some((x) => CJK.test(lines[x]))) continue;
      const twins = arrays.filter((e) => e.key === z.key && !e.items.some((x) => CJK.test(lines[x])));
      if (!twins.length) continue;
      const t = twins.reduce((best, e) => (Math.abs(e.at - z.at) < Math.abs(best.at - z.at) ? e : best), twins[0]);
      z.items.forEach((x, k) => { if (k < t.items.length && CJK.test(lines[x])) { const m = ITEM.exec(lines[x]); lines[x] = m[1] + ITEM.exec(lines[t.items[k]])[2] + m[3]; n++; } });
    }
    const next = lines.join('\n');
    const left = (next.match(/[㐀-鿿]+/g) || []).length;
    if (n) { put(p, next); folded += n; filesFolded++; }
    if (left) { residualFiles++; residualRuns += left; }
  }
  report.push(`Chinese: ${folded} dictionary values folded into English in ${filesFolded} files; ${localeFiles} zh locale files replaced; ${docFiles} zh documents removed; leftover Chinese runs: ${residualRuns} in ${residualFiles} files (code comments or one-sided keys)`);
}

// ---- patch 6: brand text in every user-facing string
// lib/brandrules.mjs holds the rules and test/ui-strings.mjs reads the same surfaces. Real model names and the
// third-party provider catalog stay (test/ui-strings.allow.json). Module names, ids and paths do not change.
{
  const skip = new RegExp(allow.archiveSkip.join('|'));
  let files = 0;
  for (const f of src.files) {
    if (f.entry.unpacked || f.entry.size > 6e6 || /\.map$/.test(f.path) || skip.test(f.path)) continue;
    if (overrides.has(f.path) && overrides.get(f.path) === null) continue;
    if (!/\.(c|m)?js$|\.json$|\.md$|\.html?$|\.txt$|\.ya?ml$|\.(c|m)?tsx?$|\.ps1$|\.svg$/i.test(f.path)) continue;
    const before = text(f.path);
    const after = rewriteFile(f.path, before);
    if (after !== before) { put(f.path, after); files++; }
  }
  must(files > 100, 'brand text rewrite touched too few files: ' + files);
  report.push(`brand text: ${files} files rewritten (DeepSeek, DSH and Whale wording in prose and strings)`);
}

// ---- patch 8: icons in ink and warm grey, no blue or purple (plugin icons, inline icon sets, upload illustration)
{
  const skip = new RegExp(allow.archiveSkip.join('|'));
  let svgs = 0, scripts = 0;
  for (const f of src.files) {
    if (f.entry.unpacked || f.entry.size > 6e6 || skip.test(f.path)) continue;
    if (overrides.has(f.path) && overrides.get(f.path) === null) continue;
    const isSvg = /\.svg$/i.test(f.path);
    const isJs = /\.(c|m)?js$/i.test(f.path) && (f.path.startsWith(DS) || f.path.startsWith('lib/'));
    if (!isSvg && !isJs) continue;
    const before = text(f.path);
    const after = isSvg ? recolorSvg(before) : recolorBlueAttrsInScript(before);
    if (after === before) continue;
    put(f.path, after);
    if (isSvg) svgs++; else scripts++;
  }
  must(svgs > 5 && scripts >= 2, `icon recolor touched svg ${svgs} and script ${scripts} files`);
  report.push(`icons: ${svgs} SVG files and ${scripts} scripts lose their blue and purple fills`);
}

// ---- patch 8a: the vendor's brand blue written as a literal (CSS fallbacks, outlines, link colours) becomes the Arc Harness primary
{
  const skip = new RegExp(allow.archiveSkip.join('|'));
  let n = 0;
  for (const f of src.files) {
    if (f.entry.unpacked || f.entry.size > 6e6 || skip.test(f.path)) continue;
    if (overrides.has(f.path) && overrides.get(f.path) === null) continue;
    if (!/\.(c|m)?js$|\.css$|\.html?$|\.json$/i.test(f.path)) continue;
    const before = text(f.path);
    if (!/#4d6bfe/i.test(before)) continue;
    put(f.path, replaceVendorBlue(before));
    n++;
  }
  report.push(`brand blue: ${n} files had the vendor's blue as a literal; it is now the Arc Harness primary`);
}

// ---- patch 8c: every blue and violet colour (hex, rgb, rgba) in the code of the app's own screens, by hue (lib/iconcolor.mjs)
{
  let n = 0;
  for (const f of src.files) {
    if (f.entry.unpacked || f.entry.size > 6e6 || !HUE_ARCHIVE.test(f.path)) continue;
    if (overrides.has(f.path) && overrides.get(f.path) === null) continue;
    if (!/\.(c|m)?js$|\.css$|\.html?$/i.test(f.path)) continue;
    const before = text(f.path);
    const after = recolorBlueHues(before);
    if (after !== before) { put(f.path, after); n++; }
  }
  must(n >= 4, `blue hue recolor touched too few files: ${n}`);
  report.push(`blue hues: ${n} files of the app's own screens lose their blue and violet colours by hue`);
}

// ---- patch 8d: the spreadsheet viewer (a FortuneSheet bundle) paints its own interface in blue and violet: the cell selection box,
// the copy range, the resize handle, the filter buttons, the option tabs, the primary button hover, the link hover. These become the
// Arc Harness primary; the toolbar icon fill (a dark blue-grey) becomes ink. The chart palettes and colour pickers inside the
// bundle are colours of the user's own data and stay; test/build-check.mjs lists them and fails on any other blue.
{
  const p = DS + 'dsh-client-ui-sidebar-documentpreview/lib/client.excel.js';
  const before = text(p);
  const after = before
    .replace(/#0188fb|#018ffb|#12a5ff|#5292f7|#4d90fe|#0050d0|#897bff|#8c89fe|#726ef[0-9a-f]|#5391ff|#2674fb/gi, '#54453c')
    .replace(/#00f(?![0-9a-fA-F])/gi, '#54453c')   // the underlined "All - Clear - Inverse" links of the filter menu
    .replace(/#394259/gi, '#26231f');
  must(after !== before && !/#0188fb|#018ffb|#12a5ff|#5292f7|#4d90fe|#0050d0|#897bff|#8c89fe|#726ef[0-9a-f]|#5391ff|#2674fb|#394259|#00f(?![0-9a-fA-F])/i.test(after), 'spreadsheet viewer interface colours were not found');
  put(p, after);
  report.push('spreadsheet viewer: its blue and violet interface colours (selection box, handles, filter buttons) are the Arc Harness primary');
}

// ---- patch 8b: PNG files that hold the whale (found by their bytes, brand/pictures.json). Pictures inside scripts (data URIs, inline
// SVG marks, the plugin manager's previews, the blue subagent icons) are swapped by patch 6 through lib/brandrules.mjs.
{
  let png = 0;
  for (const f of src.files) {
    if (f.entry.unpacked || !/\.png$/i.test(f.path)) continue;
    if (overrides.has(f.path) && overrides.get(f.path) === null) continue;
    const rep = swapPicture(overrides.get(f.path) ?? src.read(f));
    if (rep) { put(f.path, rep); png++; }
  }
  must(png >= 1, 'no whale PNG file found in the archive: the picture list and the archive disagree');
  report.push(`pictures: ${png} PNG file(s) with the whale replaced by cube pictures`);
}

// ---- patch 9: no connection to DeepSeek services
// Patch 6 already turns every DeepSeek address into an address that cannot resolve. This patch removes the rest of the paths:
// the provider catalog entry, the telemetry and analytics rows, and the names of the dormant DeepSeek-only plugins.
{
  // (a) the third-party catalog no longer registers the direct DeepSeek provider
  const ALL = 'dsh/node_modules/@earendil-works/pi-ai/dist/providers/all.js';
  const allJs = text(ALL);
  const imp = 'import { deepseekProvider } from "./deepseek.js";\n';
  const call = '        deepseekProvider(),\n';
  must(allJs.split(imp).length === 2 && allJs.split(call).length === 2, 'pi-ai registers the DeepSeek provider once');
  put(ALL, allJs.replace(imp, '').replace(call, ''));
  // (b) addresses inside the catalog files too (model and provider names there stay)
  let catalog = 0;
  for (const f of src.files) {
    if (f.entry.unpacked || f.entry.size > 6e6 || !f.path.includes('/@earendil-works/pi-ai/') || !/\.(c|m)?js$|\.json$/.test(f.path)) continue;
    const before = text(f.path);
    const after = rewriteHosts(before);
    if (after !== before) { put(f.path, after); catalog++; }
  }
  // (c) telemetry and analytics rows are off: the feedback exporter, the desktop product analytics and its browser half
  const disableRow = (yml, id) => {
    const start = yml.indexOf(`- id: ${id}\n`);
    must(start >= 0, 'row not found: ' + id);
    const next = yml.indexOf('\n    - id:', start + 1);
    const end = next < 0 ? yml.length : next;
    let block = yml.slice(start, end);
    if (/^\s+disabled:.*$/m.test(block)) block = block.replace(/^(\s+)disabled:.*$/m, '$1disabled: true');
    else block = block.replace(/(\n\s+name:.*)/, '$1\n      disabled: true');
    return yml.slice(0, start) + block + yml.slice(end);
  };
  const BASE = DS + 'dsh-base/cordis.patch.yml', WEB = DS + 'dsh-web-app/cordis.patch.yml';
  put(BASE, disableRow(text(BASE), 'session-telemetry-otel'));
  let web = text(WEB);
  web = disableRow(web, 'desktop-product-telemetry');
  web = disableRow(web, 'product-analytics');
  put(WEB, web);
  // (d) plain names for the dormant DeepSeek-only plugins and Sentence-case titles for all built-in plugins
  const TITLES = {
    'dsh-llm-deepseek-api-key': 'Direct API-key route', 'dsh-llm-deepseek-account': 'Account route', 'dsh-deepseek-account-platform': 'Account platform',
    'dsh-deepseek-llm-api-extensions': 'Model API extensions', 'dsh-session-log-deepseek': 'Session log add-on', 'dsh-plugin-package-inventory-deepseek': 'Package inventory add-on',
    'dsh-web-search-deepseek': 'Provider web search', 'dsh-web-deepseek-api': 'Search and fetch API', 'dsh-client-ui-settings-account': 'Account settings',
    'dsh-client-ui-settings-session-log': 'Session log settings', 'dsh-client-ui-settings-web-search': 'Web search settings',
  };
  for (const [pkg, title] of Object.entries(TITLES)) {
    for (const loc of ['en', 'zh']) {
      const p = `${DS}${pkg}/locale/${loc}.json`;
      if (!src.byPath.has(p) || overrides.get(p) === null) { must(loc !== 'en', 'locale file missing: ' + p); continue; }
      const j = JSON.parse(text(p));
      j.meta = { ...(j.meta || {}), title };
      put(p, JSON.stringify(j, null, 2) + '\n');
    }
  }
  const ACRONYMS = {
    api: 'API',
    cli: 'CLI',
    ui: 'UI',
    mcp: 'MCP',
    html: 'HTML',
    json: 'JSON',
    powershell: 'PowerShell',
    pwsh: 'PowerShell',
    bash: 'Bash',
  };
  const slugToSentence = (s) =>
    s
      .split('-')
      .map((w, i) => ACRONYMS[w] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(' ');
  let slugTitles = 0;
  for (const f of src.files) {
    if (f.entry.unpacked || overrides.get(f.path) === null) continue;
    if (!/^dsh\/node_modules\/(?:@[^/]+\/)?[^/]+\/locale\/(?:en|zh)\.json$/.test(f.path)) continue;
    const j = JSON.parse(text(f.path));
    let dirty = false;
    if (typeof j.meta?.title === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(j.meta.title)) {
      j.meta.title = slugToSentence(j.meta.title);
      slugTitles++;
      dirty = true;
    }
    if (!j.presetStandardName) {
      j.presetStandardName = 'Standard';
      dirty = true;
    }
    if (dirty) put(f.path, JSON.stringify(j, null, 2) + '\n');
  }
  // the 1017 label plugin has no locale file: add one so the Plugins page does not show its package name
  put(`${DS}dsh-client-ui-deepseek-model-label-1017/locale/en.json`, JSON.stringify({ meta: { title: 'Model label badge' }, presetStandardName: 'Standard' }, null, 2) + '\n');
  report.push(`DeepSeek services: provider unregistered, ${catalog} catalog files with dead addresses, 3 telemetry rows off, ${Object.keys(TITLES).length + 1} plugin names plain, ${slugTitles} built-in plugin slug titles formatted`);
}

// ---- patch 10: the welcome window
// The welcome window is the old vendor's sign-in and API-key entry (whale wordmark, cool blue-grey palette, a Sign in button that
// leads to the account flow). Arc Harness takes its models from the providers in the profile, so startup goes straight to the
// workspace. The window assets also get the cube mark and the C2 palette, in case a build brings the window back.
{
  const MAIN = 'lib/main.js';
  const gate = 'return !authentication.loggedIn && !authentication.hasApiKey;';
  const mainJs = text(MAIN);
  must(mainJs.split(gate).length === 2, 'the welcome gate appears once in lib/main.js');
  put(MAIN, mainJs.replace(gate, 'return false; // Arc Harness has no vendor sign-in; models come from the profile providers'));
  // the wordmark: the AS cube and the live name, same layout box (472 x 40) as the old image
  const cube = `<g transform="translate(0 2) scale(0.1406)" class="ink" fill-rule="evenodd"><path d="${brand.top}"/><path d="${brand.leftAS}"/><path d="${brand.right}"/></g>`;
  const svg = `<svg width="472" height="40" viewBox="0 0 472 40" fill="none" xmlns="http://www.w3.org/2000/svg">
<style>
  :root { --dsw-alias-label-primary: #26231f; }
  @media (prefers-color-scheme: dark) { :root { --dsw-alias-label-primary: #faf9f6; } }
  .ink { fill: var(--dsw-alias-label-primary); }
</style>
${cube}
<text x="44" y="29" font-family="Geist, 'Segoe UI', system-ui, sans-serif" font-size="26" font-weight="600" letter-spacing="-0.3" class="ink">Arc Harness</text>
</svg>
`;
  put('renderer/assets/welcome-brand.svg', svg);
  // the palette: cool blue-grey values become the warm C2 values
  const PALETTE = [['#0f1115', '#26231f'], ['#61666b', '#645e55'], ['#81858c', '#75736c'], ['#43454a', '#6a574b'], ['#f1f3f5', '#f5f3ee'], ['#adb2b8', '#8a8478'],
    ['#f9fafb', '#faf9f6'], ['#cfd3d6', '#d5d1c8'], ['#353638', '#2f2c28'], ['#ebeef2', '#ece9e2']];
  // One pass over the hex colours: a colour of the table becomes its warm twin, any other saturated hex goes through the icon
  // recolor. Nothing is recolored twice, because the recolor turns the warm paper tones (#faf9f6, #f5f3ee, #ece9e2) into grey.
  // The brand colours are written after the pass, and every replacement must find its text.
  const warm = new Map(PALETTE), seen = new Map(PALETTE.map(([a]) => [a, 0]));
  const recolorHex = (css) => css.replace(/#[0-9a-fA-F]{6}(?![0-9a-zA-Z])/g, (m) => {
    const k = m.toLowerCase();
    if (!warm.has(k)) return recolorSvg(m);
    seen.set(k, seen.get(k) + 1);
    return warm.get(k);
  });
  const LIGHT = '#54453c', DARK = '#ede6d8'; // brand primary on light and on dark
  // window styles of the app: hex palette, then the brand primary (light) and a dark block that also beats the token sheet's dark selector
  let win = recolorHex(text('renderer/welcome.css'));
  for (const [k, n] of seen) must(n > 0, 'welcome palette colour not found in renderer/welcome.css: ' + k);
  win = replaceOnce(win, '--dsw-alias-brand-primary: var(--dsw-alias-label-primary);', `--dsw-alias-brand-primary: ${LIGHT};`, 'renderer/welcome.css brand primary');
  const darkBlock = /@media \(prefers-color-scheme: dark\)\s*\{\s*body\s*\{/g;
  must((win.match(darkBlock) || []).length === 1, 'renderer/welcome.css dark block');
  win = win.replace(darkBlock, () => `@media (prefers-color-scheme: dark) {\n  body,\n  body[data-ds-dark-theme] {\n    --dsw-alias-brand-primary: ${DARK};`);
  put('renderer/welcome.css', win);
  // token sheet of the welcome window: brand primary, the blue tokens and the vendor name in their variable names
  let tok = text('lib/welcome/welcome.css');
  tok = replaceOnce(tok, '--dsw-alias-brand-primary: var(--dsw-static-neutral-bluish-1000)', `--dsw-alias-brand-primary: ${LIGHT}`, 'welcome tokens brand primary (light)');
  tok = replaceOnce(tok, '--dsw-alias-brand-primary: var(--dsw-static-neutral-bluish-50)', `--dsw-alias-brand-primary: ${DARK}`, 'welcome tokens brand primary (dark)');
  tok = replaceOnce(tok, '-new-colorprimary-new-color: rgb(65, 118, 230)', `-new-colorprimary-new-color: ${LIGHT}`, 'welcome tokens new brand colour (light)');
  tok = replaceOnce(tok, '-new-colorprimary-new-color: var(--dsw-static-deepseek-450)', `-new-colorprimary-new-color: ${DARK}`, 'welcome tokens new brand colour (dark)');
  tok = recolorBlueTokens(tok);
  must(tok.includes('rgba(38, 49, 72,'), 'welcome tokens: navy hover tints expected'); // the three interactive hover and active fills
  tok = tok.split('rgba(38, 49, 72,').join('rgba(38, 35, 31,');
  must(tok.includes('rgba(248, 249, 250,'), 'welcome tokens: cool white menu fills expected');
  tok = tok.split('rgba(248, 249, 250,').join('rgba(250, 249, 246,');
  must(!/rgb\(65, 118, 230\)/.test(tok), 'welcome tokens still hold the vendor blue');
  must(tok.includes('--dsw-static-deepseek-450:'), 'welcome tokens: vendor blue token expected before the rename');
  tok = tok.split('--dsw-static-deepseek-').join('--dsw-static-accent-');
  must(!/deepseek/i.test(tok), 'welcome tokens still name the old vendor');
  put('lib/welcome/welcome.css', tok);
  report.push('welcome window: startup skips it, window styles and token sheet in the C2 palette with brand primary #54453c / #ede6d8, blue tokens recolored, the whale wordmark replaced by the AS cube and the live name');
}

// ---- patch 7: the first-run appearance is Light, the cream look of the Cammut console; Dark and System stay selectable
{
  let n = 0;
  for (const f of ['lib/client.js', 'lib/index.js']) {
    const p = DS + 'dsh-client-ui-theme/' + f;
    const s = text(p);
    const from = 'const DEFAULT_PREFERENCE = "system";';
    if (!s.includes(from)) continue;
    must(s.split(from).length === 2, 'theme default appears once in ' + f);
    put(p, s.replace(from, 'const DEFAULT_PREFERENCE = "light";'));
    n++;
  }
  must(n === 2, 'theme default found in client and index: ' + n);
  report.push('appearance: first-run default is Light (Dark and System stay selectable)');
}

// ---- patch 11: the update coordinator never runs
// Its default "enabled" switch is on whenever resources/app-update.yml exists, and the original file points at the old vendor's
// download server. tools/install.mjs deletes that file, but the build must not depend on it: the default is now off.
{
  const MAIN = 'lib/main.js';
  const on = 'enabled = () => app.isPackaged && existsSync(join(process.resourcesPath, "app-update.yml"))';
  put(MAIN, replaceOnce(text(MAIN), on, 'enabled = () => false', 'update coordinator default switch'));
  report.push('updates: the update coordinator is off by default, whatever files sit next to the app');
}

// ---- patch 12: the badge skill (its plugin row is off, the files stay loadable)
// File names and the code path stay. The badge image is the app icon tile; the Markdown, the skill description and the
// package texts say "powered by Arc Harness", with no vendor logo parameter and the Arc Harness ink colour.
{
  const B = DS + 'dsh-skill-badge/', BB = DS + 'dsh-experimental-badge-skill-bundle/';
  const TITLE = 'Arc Harness badge', DESC = 'Provide the official “powered by Arc Harness” badge skill.';
  const SKILL = 'Add the official “powered by Arc Harness” badge to documents, pull requests, merge requests, and other content produced with Arc Harness. Use whenever creating a pull request or merge request. Also use when the user asks for an Arc Harness badge, powered-by-Arc-Harness attribution, or a reusable badge asset or snippet.';
  const BADGE = 'https://img.shields.io/badge/powered_by-Arc_Harness-26231F?style=flat-square';
  const MD = `# Arc Harness Badge

Add the “powered by Arc Harness” badge without recreating or restyling it.

## Assets

- Local PNG: [\`dsh-badge.png\`](dsh-badge.png), the Arc Harness cube tile, 1024×1024 source image; render at 20×20
- Shields.io image URL: \`${BADGE}\`

## Markdown

Use this image in Markdown:

\`\`\`markdown
![powered by Arc Harness](${BADGE})
\`\`\`

## Usage rules

- For GitHub or GitLab Markdown, use the Shields.io URL.
- For systems that import remote images unreliably, upload \`dsh-badge.png\` from this skill directory instead of generating another badge.
- Keep the image square: render it at 20×20 or larger, never stretched.
- Place the badge at the end of the attributed document or section unless the user specifies another position.
- Do not substitute another color, logo, or label.
`;
  const setJson = (p, fn) => {
    must(src.byPath.has(p), 'badge package file missing: ' + p);
    const raw = text(p), j = JSON.parse(raw);
    fn(j);
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const indent = /^(\t| +)"/m.exec(raw)?.[1] ?? '  ';
    put(p, JSON.stringify(j, null, indent).replace(/\n/g, eol) + (/\n$/.test(raw) ? eol : ''));
  };
  must(src.byPath.has(B + 'assets/dsh-badge.png') && src.byPath.has(B + 'assets/dsh-badge.md'), 'badge assets exist');
  put(B + 'assets/dsh-badge.png', dist('icon.png'));
  put(B + 'assets/dsh-badge.md', MD);
  const idx = text(B + 'lib/index.js');
  const descRe = /description: "Add the official [^"\n]*",/g;
  must((idx.match(descRe) || []).length === 1, 'badge skill description line in lib/index.js');
  const idxNew = idx.replace(descRe, () => `description: ${lit(SKILL)},`);
  mustParse(idxNew, B + 'lib/index.js');
  put(B + 'lib/index.js', idxNew);
  for (const loc of ['en', 'zh']) {
    setJson(`${B}locale/${loc}.json`, (j) => { j.meta = { ...(j.meta || {}), title: TITLE, description: DESC }; });
    setJson(`${BB}locale/${loc}.json`, (j) => { j.meta = { ...(j.meta || {}), title: 'Arc Harness badge skill', description: 'Let agents add a “powered by Arc Harness” badge to documents, pull requests, and other outputs.' }; });
  }
  setJson(B + 'package.json', (j) => { j.description = 'Bundled Arc Harness badge skill provider'; });
  setJson(BB + 'package.json', (j) => { j.description = 'Let agents add a “powered by Arc Harness” badge to documents, pull requests, and other outputs.'; });
  report.push('badge skill: cube tile image, Markdown, description and package texts say Arc Harness (no vendor logo, ink colour 26231F)');
}

// ---- patch 13: the running label. "Deep diving" was a DeepSeek Harness feature name; v0 and Vercel say "Thinking",
// with the elapsed time after it. The three dots in the original are middle dots, which the product copy does not use.
{
  const p = DS + 'dsh-client-ui-chat/lib/client.js';
  let s = text(p);
  const a = '"chat.deepDiving": "Deep diving"', b = '"chat.deepDivingFor": "Deep diving for {duration} ···"';
  must(s.split(a).length === 3, 'running label: expected 2 plain entries, found ' + (s.split(a).length - 1));
  must(s.split(b).length === 3, 'running label: expected 2 timed entries, found ' + (s.split(b).length - 1));
  s = s.split(a).join('"chat.deepDiving": "Thinking"').split(b).join('"chat.deepDivingFor": "Thinking for {duration}"');
  mustParse(s, p);
  put(p, s);
  const rp = DS + 'dsh-client-ui-chat/README.md';
  const r = text(rp);
  must(r.split('“Deep diving”').length === 2, 'running label: README mention');
  put(rp, r.replace('“Deep diving”', '“Thinking”'));
  report.push('running label: "Thinking" and "Thinking for 2s" (was "Deep diving", with middle dots)');
}

// ---- patch 14: the lean core. Built-in plugins stay built in and show no page in Settings. The browser roster of the web bundle (which the desktop app serves as well) loses the screens that
// have no place in a v0 style harness: the Plugins page and its Built-in plugins settings, Automation tasks, trajectories,
// skills, accounts, the subagent settings, and the mode picker with its Agent presets page. The host halves stay, so the agent
// still works. A row is switched off by one `disabled: true` line, so a screen comes back by deleting that line.
{
  const p = DS + 'dsh-web-app/cordis.patch.yml';
  let s = text(p);
  const OFF = ['ui-plugin-manager', 'ui-settings-account', 'ui-schedule', 'ui-trajectory', 'ui-skill', 'ui-settings-subagent', 'ui-agent-preset', 'entry-customization', 'ui-settings-plugins', 'ui-settings-plugin-inventory'];
  for (const id of OFF) {
    const re = new RegExp(`(\\n {4}- id: ${id}\\r?\\n {6}name: [^\\r\\n]+(\\r?\\n))(?! {6}disabled:)`);
    must(re.test(s), `lean core: row ${id} not found, or it is disabled already`);
    s = s.replace(re, (m, a, eol) => a + '      disabled: true' + eol);
  }
  put(p, s);
  report.push(`lean core: ${OFF.length} browser rows switched off (${OFF.join(', ')})`);
}

// ---- patch 15: the "Show coding view" row of General settings. It switched on trajectories, code diffs and every Agent preset,
// and the lean core has none of those screens. The row's slot registration goes; the setting itself keeps its default (off).
{
  const p = DS + 'dsh-client-ui-settings-general/lib/client.js';
  const s = text(p);
  const re = /ctx\.slots\.inject\("settings\.general\.item", \(\) => ctx\.slots\.register\(\{\s*name: "settings\.general\.item",\s*id: "developer-tools",[\s\S]*?\}, DeveloperToolsRow\)\);\s*/g;
  const n = (s.match(re) || []).length;
  must(n === 1, 'coding view row: expected 1 registration, found ' + n);
  const out = s.replace(re, '');
  mustParse(out, p);
  put(p, out);
  report.push('coding view row: removed from General settings');
}

// ---- patch 15b: preserve Google thought_signature across multi-turn and parallel tool calls in pi-ai openai-completions
{
  const p = 'dsh/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js';
  let s = text(p);
  const streamFind = `                            const name = toolCall.function?.name ?? toolCall.custom?.name;\n                            if (!block.name && name) {\n                                block.name = name;\n                            }`;
  const streamRepl = `${streamFind}\n                            const googleSig = toolCall.extra_content?.google?.thought_signature;\n                            if (typeof googleSig === "string" && googleSig.length > 0) {\n                                block.thoughtSignature = googleSig;\n                            }`;
  s = replaceOnce(s, streamFind, streamRepl, 'pi-ai openai-completions stream thought_signature capture');

  const convFind = `            if (toolCalls.length > 0) {\n                assistantMsg.tool_calls = toolCalls.map((tc) => {\n                    const customInputProperty = options?.grammarToolInputProperties?.get(tc.name);\n                    if (customInputProperty !== undefined) {\n                        return {\n                            id: tc.id,\n                            type: "custom",\n                            custom: {\n                                name: tc.name,\n                                input: sanitizeSurrogates(getGrammarToolInput(tc.name, tc.arguments, customInputProperty)),\n                            },\n                        };\n                    }\n                    return {\n                        id: tc.id,\n                        type: "function",\n                        function: {\n                            name: tc.name,\n                            arguments: JSON.stringify(tc.arguments),\n                        },\n                    };\n                });\n            }`;
  const convRepl = `            if (toolCalls.length > 0) {\n                const isGoogleTarget = model.provider === "vertex" || model.provider === "google" || model.provider === "google-vertex" || /^(google\\/|gemini)/i.test(model.id || "");\n                assistantMsg.tool_calls = toolCalls.map((tc, tcIndex) => {\n                    const hasRawGoogleSig = typeof tc.thoughtSignature === "string" && tc.thoughtSignature.length > 0 && !parseLegacyEncryptedReasoningDetail(tc.thoughtSignature);\n                    const googleSig = hasRawGoogleSig ? tc.thoughtSignature : (tcIndex === 0 && isGoogleTarget ? "skip_thought_signature_validator" : undefined);\n                    const extra = googleSig ? { extra_content: { google: { thought_signature: googleSig } } } : {};\n                    const customInputProperty = options?.grammarToolInputProperties?.get(tc.name);\n                    if (customInputProperty !== undefined) {\n                        return {\n                            id: tc.id,\n                            type: "custom",\n                            custom: {\n                                name: tc.name,\n                                input: sanitizeSurrogates(getGrammarToolInput(tc.name, tc.arguments, customInputProperty)),\n                            },\n                            ...extra,\n                        };\n                    }\n                    return {\n                        id: tc.id,\n                        type: "function",\n                        function: {\n                            name: tc.name,\n                            arguments: JSON.stringify(tc.arguments),\n                        },\n                        ...extra,\n                    };\n                });\n            }`;
  s = replaceOnce(s, convFind, convRepl, 'pi-ai openai-completions convertMessages thought_signature replay');
  mustParse(s, p);
  put(p, s);
  report.push('pi-ai openai-completions: Google thought_signature captured on stream and replayed on tool_calls');
}

// ---- patch 15c: show the desktop window immediately on launch and play a choreographed skippable intro animation
{
  const MAIN = 'lib/main.js';
  const navFind = '\t\tstartup ??= (async () => {\n\t\t\tawait navigateMain(applicationUrl);\n\t\t\tawait backend.start(async () => {';
  const navRepl = '\t\tstartup ??= (async () => {\n\t\t\tawait navigateMain(applicationUrl);\n\t\t\tif (mainWindow && !mainWindow.isDestroyed() && !quitting) mainWindow.show();\n\t\t\tawait backend.start(async () => {';
  put(MAIN, replaceOnce(text(MAIN), navFind, navRepl, 'main window immediate show on startup'));

  const p = DS + 'dsh-web-frontend/dist/assets/index-BXV-oxvX.js';
  let s = text(p);
  const introCss = [
    '._boot_u7vgf_3[data-dsh-boot]{--as-bg:#faf9f6;--as-bg-glow:#f4f2ed;--as-surface:#f4f2ed;--as-chip:#ece9e2;--as-border:#e6e2da;--as-border-strong:#d2cdc2;--as-ink:#26231f;--as-cube:#0a0a0a;--as-accent:#54453c;--as-sand:#a89272;--as-muted:#645e55;position:fixed;inset:0;z-index:99999;display:grid;place-items:center;overflow:hidden;user-select:none;background:radial-gradient(circle at 50% 42%,var(--as-bg-glow) 0%,var(--as-bg) 70%);color:var(--as-ink);font-family:"Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;transition:opacity 220ms cubic-bezier(0.22,1,0.36,1),transform 220ms cubic-bezier(0.22,1,0.36,1)}',
    'body[data-ds-dark-theme] ._boot_u7vgf_3[data-dsh-boot]{--as-bg:#171614;--as-bg-glow:#1f1e1b;--as-surface:#1f1e1b;--as-chip:#272521;--as-border:#2e2b26;--as-border-strong:#3c3935;--as-ink:#f0eee9;--as-cube:#ffffff;--as-accent:#ede6d8;--as-sand:#a89272;--as-muted:#a39d93}',
    '._boot_u7vgf_3[data-dsh-boot][data-exiting="true"]{opacity:0;transform:scale(1.018);pointer-events:none}',
    '.as-intro-grid{position:absolute;inset:0;background-image:radial-gradient(var(--as-border-strong) 1px,transparent 1px);background-size:24px 24px;background-position:center center;opacity:0;transform:scale(1.06);animation:asGridIn 1400ms cubic-bezier(0.16,1,0.3,1) 40ms forwards;pointer-events:none}',
    '.as-intro-axis-h,.as-intro-axis-v{position:absolute;background:var(--as-border);pointer-events:none}',
    '.as-intro-axis-h{left:0;right:0;top:50%;height:1px;transform:scaleX(0);animation:asAxisX 1250ms cubic-bezier(0.16,1,0.3,1) 80ms forwards}',
    '.as-intro-axis-v{top:0;bottom:0;left:50%;width:1px;transform:scaleY(0);animation:asAxisY 1250ms cubic-bezier(0.16,1,0.3,1) 80ms forwards}',
    '._boot_u7vgf_3[data-dsh-boot] ._card_u7vgf_24{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:0;max-width:560px;width:calc(100% - 48px);padding:36px 32px 28px;text-align:center}',
    '.as-intro-emblem{position:relative;width:148px;height:148px;display:grid;place-items:center;margin-bottom:22px}',
    '.as-intro-orbit{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}',
    '.as-orbit-dash{stroke:var(--as-border-strong);stroke-width:1.2;stroke-dasharray:4 6;fill:none;transform-origin:128px 128px;opacity:0;animation:asOrbitSpin 18s linear infinite,asFadeIn 900ms cubic-bezier(0.16,1,0.3,1) 120ms forwards}',
    '.as-orbit-arc{stroke:var(--as-sand);stroke-width:1.6;stroke-linecap:round;fill:none;stroke-dasharray:1000;stroke-dashoffset:1000;transform-origin:128px 128px;transform:rotate(-90deg);animation:asStrokeDraw 1450ms cubic-bezier(0.16,1,0.3,1) 160ms forwards}',
    '.as-orbit-pulse{stroke:var(--as-sand);stroke-width:1.8;fill:none;opacity:0;transform-origin:128px 128px}',
    '.as-orbit-pulse[data-pulse="1"]{animation:asPulseWave 920ms cubic-bezier(0.16,1,0.3,1) forwards}',
    '.as-cube-stage{position:relative;width:92px;height:92px;display:grid;place-items:center;transform:translateY(16px) scale(0.86);opacity:0;animation:asCubeRise 1100ms cubic-bezier(0.16,1,0.3,1) 60ms forwards}',
    '.as-cube-wire,.as-cube-solid{position:absolute;inset:0;width:100%;height:100%;overflow:visible}',
    '.as-cube-wire path{fill:none;stroke:var(--as-accent);stroke-width:3.6;stroke-linejoin:round;stroke-linecap:round;stroke-dasharray:1000;stroke-dashoffset:1000;animation:asStrokeDraw 1150ms cubic-bezier(0.22,1,0.36,1) var(--as-d,0ms) forwards}',
    '.as-cube-solid{opacity:0;transform-origin:50% 50%;animation:asSolidFade 620ms cubic-bezier(0.22,1,0.36,1) 920ms forwards}',
    '.as-cube-solid path{fill:var(--as-cube);fill-rule:evenodd}',
    '.as-cube-solid[data-turn="1"]{opacity:1;animation:asCubeTurn 680ms cubic-bezier(0.34,1.56,0.64,1) forwards}',
    '.as-eyebrow-mask{overflow:hidden;margin-bottom:12px}',
    '.as-eyebrow{display:inline-flex;align-items:center;gap:8px;padding:4px 12px;border-radius:999px;background:var(--as-surface);border:1px solid var(--as-border-strong);font-family:"Geist Mono",ui-monospace,Consolas,monospace;font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--as-muted);transform:translateY(120%);opacity:0;animation:asSlideUp 680ms cubic-bezier(0.16,1,0.3,1) 1450ms forwards}',
    '.as-eyebrow-dot{width:6px;height:6px;border-radius:50%;background:var(--as-accent);animation:asDotPulse 1800ms ease-in-out infinite}',
    '._boot_u7vgf_3[data-dsh-boot] ._wordmark_u7vgf_31{display:inline-flex;flex-wrap:wrap;justify-content:center;font-size:38px;line-height:1.12;font-weight:600;letter-spacing:-0.025em;color:var(--as-ink);margin:0 0 10px}',
    '.as-char{display:inline-block;overflow:hidden;vertical-align:bottom;padding-bottom:2px}',
    '.as-char-in{display:inline-block;transform:translateY(115%) rotateZ(5deg);opacity:0;transform-origin:left bottom;animation:asCharIn 720ms cubic-bezier(0.16,1,0.3,1) var(--as-cd,1650ms) forwards}',
    '.as-tagline{font-size:14px;line-height:1.5;color:var(--as-muted);max-width:430px;margin:0 0 18px;opacity:0;transform:translateY(10px);animation:asSlideUp 700ms cubic-bezier(0.16,1,0.3,1) 2250ms forwards}',
    '.as-pills{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-bottom:26px}',
    '.as-pill{padding:4px 10px;border-radius:6px;background:var(--as-chip);border:1px solid var(--as-border);font-family:"Geist Mono",ui-monospace,Consolas,monospace;font-size:11px;color:var(--as-ink);opacity:0;transform:translateY(10px) scale(0.94);animation:asPillIn 580ms cubic-bezier(0.34,1.56,0.64,1) var(--as-pd,2550ms) forwards}',
    '.as-footer{display:flex;flex-direction:column;align-items:center;gap:12px;width:100%;max-width:340px;opacity:0;transform:translateY(8px);animation:asSlideUp 620ms cubic-bezier(0.16,1,0.3,1) 950ms forwards}',
    '.as-prog-track{position:relative;width:100%;height:3px;border-radius:999px;background:var(--as-border);overflow:hidden}',
    '.as-prog-bar{position:absolute;inset:0;background:var(--as-accent);transform-origin:left center;transform:scaleX(0.04);transition:transform 100ms linear}',
    '.as-meta-row{display:flex;align-items:center;justify-content:space-between;width:100%;gap:12px}',
    '.as-status-left{display:inline-flex;align-items:center;gap:8px;min-width:0}',
    '._boot_u7vgf_3[data-dsh-boot] ._hint_u7vgf_39{font-family:"Geist Mono",ui-monospace,Consolas,monospace;font-size:11.5px;line-height:16px;color:var(--as-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.as-skip-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:8px;background:var(--as-surface);border:1px solid var(--as-border-strong);color:var(--as-ink);font-size:12px;font-weight:500;line-height:16px;cursor:pointer;transition:transform 140ms ease,background-color 140ms ease}',
    '.as-skip-btn:hover{background:var(--as-chip);transform:translateY(-1px)}',
    '.as-skip-btn:active{transform:translateY(0) scale(0.98)}',
    '.as-skip-kbd{padding:1px 5px;border-radius:4px;background:var(--as-chip);border:1px solid var(--as-border-strong);font-family:"Geist Mono",ui-monospace,Consolas,monospace;font-size:10px;color:var(--as-muted)}',
    '@keyframes asGridIn{to{opacity:0.55;transform:scale(1)}}',
    '@keyframes asAxisX{to{transform:scaleX(1)}}',
    '@keyframes asAxisY{to{transform:scaleY(1)}}',
    '@keyframes asOrbitSpin{to{transform:rotate(360deg)}}',
    '@keyframes asFadeIn{to{opacity:1}}',
    '@keyframes asStrokeDraw{to{stroke-dashoffset:0}}',
    '@keyframes asCubeRise{to{opacity:1;transform:translateY(0) scale(1)}}',
    '@keyframes asSolidFade{to{opacity:1}}',
    '@keyframes asCubeTurn{0%{transform:scaleX(1) scaleY(1) translateY(0)}44%{transform:scaleX(0.03) scaleY(1.06) translateY(-4px)}76%{transform:scaleX(1.07) scaleY(0.97) translateY(1px)}100%{transform:scaleX(1) scaleY(1) translateY(0)}}',
    '@keyframes asPulseWave{0%{opacity:0.75;transform:scale(0.74)}100%{opacity:0;transform:scale(1.42)}}',
    '@keyframes asSlideUp{to{opacity:1;transform:translateY(0)}}',
    '@keyframes asCharIn{to{opacity:1;transform:translateY(0) rotateZ(0deg)}}',
    '@keyframes asPillIn{to{opacity:1;transform:translateY(0) scale(1)}}',
    '@keyframes asDotPulse{0%,100%{opacity:0.45;transform:scale(0.88)}50%{opacity:1;transform:scale(1.12)}}',
    '@media (prefers-reduced-motion:reduce){.as-intro-grid,.as-intro-axis-h,.as-intro-axis-v,.as-orbit-dash,.as-orbit-arc,.as-cube-stage,.as-cube-wire path,.as-cube-solid,.as-eyebrow,.as-char-in,.as-tagline,.as-pill,.as-footer,.as-eyebrow-dot{animation-duration:1ms !important;animation-delay:0ms !important}}',
  ].join('\n');

  const oldZz = `var zZ=class{root;card;wordmark;spinner;hint;states=new Map;active=new Set;total=0;failure;constructor(e){this.root=Yn(Kn.boot),this.root.dataset.dshBoot="",this.card=Yn(Kn.card),this.wordmark=Yn(Kn.wordmark,"HARNESS"),this.spinner=Yn(Kn.spinner),this.spinner.dataset.dshBootSpinner="",this.hint=Yn(Kn.hint,"Loading plugins…"),this.card.append(this.wordmark,this.spinner,this.hint),this.root.append(this.card),e.append(this.root),this.updateProgress()}setTotal(e){this.total=e,this.updateProgress()}setState(e,t){this.states.set(e,t),t==="active"&&this.active.add(e),this.updateProgress(),this.render()}fail(e){this.failure=e,this.render()}dispose(){this.root.remove()}render(){const e=[...this.states].filter(([,r])=>r==="failed").map(([r])=>r);if(this.failure===void 0&&e.length===0){this.spinner.parentElement!==this.card&&this.card.replaceChildren(this.wordmark,this.spinner,this.hint);return}const t=Yn(Kn.failed);t.append(Yn(Kn.failedTitle,"Failed to load plugins"));for(const r of e)t.append(Yn(Kn.failedItem,r));this.failure!==void 0&&t.append(Yn(Kn.failedItem,this.failure)),this.card.replaceChildren(this.wordmark,t)}updateProgress(){const e=this.total===0?0:Math.min(this.active.size/this.total,1);this.spinner.style.setProperty("--dsh-boot-arc",\`\${String(Math.round(72+e*216))}deg\`)}};`;

  const newZz = `var zZ=class{root;card;wordmark;spinner;hint;progBar;solidSvg;pulseCircle;states=new Map;active=new Set;total=0;failure;startTime=performance.now();minDurationMs=7400;skipped=!1;disposed=!1;timers=[];rafId=0;skipWaiters=[];keyHandler;constructor(e){globalThis.__AS_INTRO_ACTIVE__=!0;const doc=e.ownerDocument||document;if(!doc.getElementById("as-intro-style")){const st=doc.createElement("style");st.id="as-intro-style";st.textContent=${lit(introCss)};doc.head.append(st)}this.root=Yn(Kn.boot);this.root.dataset.dshBoot="";const grid=Yn("as-intro-grid"),axH=Yn("as-intro-axis-h"),axV=Yn("as-intro-axis-v");this.card=Yn(Kn.card);const ns="http://www.w3.org/2000/svg";const emblem=Yn("as-intro-emblem");const orbit=doc.createElementNS(ns,"svg");orbit.setAttribute("viewBox","0 0 256 256");orbit.setAttribute("class","as-intro-orbit");const cDash=doc.createElementNS(ns,"circle");cDash.setAttribute("cx","128");cDash.setAttribute("cy","128");cDash.setAttribute("r","118");cDash.setAttribute("class","as-orbit-dash");const cArc=doc.createElementNS(ns,"circle");cArc.setAttribute("cx","128");cArc.setAttribute("cy","128");cArc.setAttribute("r","102");cArc.setAttribute("pathLength","1000");cArc.setAttribute("class","as-orbit-arc");this.pulseCircle=doc.createElementNS(ns,"circle");this.pulseCircle.setAttribute("cx","128");this.pulseCircle.setAttribute("cy","128");this.pulseCircle.setAttribute("r","90");this.pulseCircle.setAttribute("class","as-orbit-pulse");orbit.append(cDash,cArc,this.pulseCircle);const cubeStage=Yn("as-cube-stage");const wire=doc.createElementNS(ns,"svg");wire.setAttribute("viewBox",${lit(brand.view)});wire.setAttribute("class","as-cube-wire");[${lit(brand.top)},${lit(brand.leftPlain)},${lit(brand.rightFaceRight)}].forEach((d,idx)=>{const pt=doc.createElementNS(ns,"path");pt.setAttribute("d",d);pt.setAttribute("pathLength","1000");pt.style.setProperty("--as-d",idx*130+"ms");wire.append(pt)});this.solidSvg=doc.createElementNS(ns,"svg");this.solidSvg.setAttribute("viewBox",${lit(brand.view)});this.solidSvg.setAttribute("class","as-cube-solid");this.setCubeFace("right");cubeStage.append(wire,this.solidSvg);emblem.append(orbit,cubeStage);const eyeMask=Yn("as-eyebrow-mask"),eye=Yn("as-eyebrow"),eyeDot=Yn("as-eyebrow-dot"),eyeTxt=doc.createElement("span");eyeTxt.textContent="INDEPENDENT VERIFICATION";eye.append(eyeDot,eyeTxt);eyeMask.append(eye);this.wordmark=Yn(Kn.wordmark);const titleStr="Arc Harness";for(let i=0;i<titleStr.length;i++){const ch=titleStr[i],outer=doc.createElement("span"),inner=doc.createElement("span");outer.className="as-char";inner.className="as-char-in";inner.textContent=ch===" "?"\\u00a0":ch;inner.style.setProperty("--as-cd",1650+i*38+"ms");outer.append(inner);this.wordmark.append(outer)}const tagline=Yn("as-tagline","Plan, freeze, and verify work with shared memory and model routing.");const pills=Yn("as-pills");["Google Vertex AI","Local Gateway","Cammut Memory","Accept Gate"].forEach((lbl,idx)=>{const pl=Yn("as-pill",lbl);pl.style.setProperty("--as-pd",2500+idx*95+"ms");pills.append(pl)});const footer=Yn("as-footer"),track=Yn("as-prog-track");this.progBar=Yn("as-prog-bar");track.append(this.progBar);const metaRow=Yn("as-meta-row"),leftRow=Yn("as-status-left");this.spinner=Yn(Kn.spinner);this.spinner.dataset.dshBootSpinner="";this.hint=Yn(Kn.hint,"Loading plugins…");leftRow.append(this.spinner,this.hint);const skipBtn=Yn("as-skip-btn");skipBtn.setAttribute("role","button");skipBtn.setAttribute("tabindex","0");skipBtn.setAttribute("aria-label","Skip intro");const skipLbl=doc.createElement("span");skipLbl.textContent="Skip intro";const skipKbd=Yn("as-skip-kbd","Esc");skipBtn.append(skipLbl,skipKbd);skipBtn.addEventListener("click",()=>this.skip());skipBtn.addEventListener("keydown",(ev)=>{if(ev.key==="Enter"||ev.key===" "||ev.key==="Escape"){ev.preventDefault();this.skip()}});metaRow.append(leftRow,skipBtn);footer.append(track,metaRow);this.card.append(emblem,eyeMask,this.wordmark,tagline,pills,footer);this.root.append(grid,axH,axV,this.card);(doc.body||e).append(this.root);this.keyHandler=(ev)=>{if(ev.key==="Escape"||ev.key===" "||ev.key==="Enter"){this.skip()}};window.addEventListener("keydown",this.keyHandler,{capture:!0});this.timers.push(setTimeout(()=>this.turnCube("as"),1650),setTimeout(()=>this.turnCube("right"),4450),setTimeout(()=>this.turnCube("as"),5750));const tick=()=>{if(this.disposed)return;const elapsed=performance.now()-this.startTime;const tRatio=Math.min(elapsed/this.minDurationMs,1);const pRatio=this.total===0?0.2:Math.min(this.active.size/this.total,1);const combined=Math.max(0.04,Math.min(1,tRatio*0.78+pRatio*0.22));if(this.progBar)this.progBar.style.transform=\`scaleX(\${combined.toFixed(3)})\`;if(tRatio<1||pRatio<1)this.rafId=requestAnimationFrame(tick)};this.rafId=requestAnimationFrame(tick);this.updateProgress()}setCubeFace(mode){if(!this.solidSvg)return;const ns="http://www.w3.org/2000/svg";const faces=mode==="right"?[${lit(brand.top)},${lit(brand.rightFaceLeft)},${lit(brand.rightFaceRight)}]:[${lit(brand.top)},${lit(brand.leftAS)},${lit(brand.right)}];this.solidSvg.replaceChildren(...faces.map((d)=>{const p=document.createElementNS(ns,"path");p.setAttribute("d",d);return p}))}turnCube(targetFace){if(this.disposed||!this.solidSvg)return;this.solidSvg.removeAttribute("data-turn");void this.solidSvg.offsetWidth;this.solidSvg.setAttribute("data-turn","1");if(this.pulseCircle){this.pulseCircle.removeAttribute("data-pulse");void this.pulseCircle.offsetWidth;this.pulseCircle.setAttribute("data-pulse","1")}this.timers.push(setTimeout(()=>{if(!this.disposed)this.setCubeFace(targetFace)},300))}skip(){if(this.skipped)return;this.skipped=!0;while(this.skipWaiters.length){const r=this.skipWaiters.pop();r()}}async waitUntilReady(){if(this.hint&&!this.failure)this.hint.textContent="Starting workbench…";if(this.skipped||this.failure!==void 0)return;const rem=Math.max(0,this.minDurationMs-(performance.now()-this.startTime));if(rem<=0)return;await new Promise((res)=>{const t=setTimeout(res,rem);this.timers.push(t);this.skipWaiters.push(()=>{clearTimeout(t);res()})})}async finish(){if(this.disposed||this.failure!==void 0)return;if(this.progBar)this.progBar.style.transform="scaleX(1)";this.root.setAttribute("data-exiting","true");const ms=this.skipped?110:220;await new Promise((r)=>setTimeout(r,ms));this.dispose()}setTotal(e){this.total=e,this.updateProgress()}setState(e,t){this.states.set(e,t),t==="active"&&this.active.add(e),this.updateProgress(),this.render()}fail(e){this.failure=e,this.skip(),this.render()}dispose(){if(this.disposed)return;this.disposed=!0;if(this.keyHandler)window.removeEventListener("keydown",this.keyHandler,{capture:!0});if(this.rafId)cancelAnimationFrame(this.rafId);for(const t of this.timers)clearTimeout(t);this.timers.length=0;this.root.remove()}render(){const e=[...this.states].filter(([,r])=>r==="failed").map(([r])=>r);if(this.failure===void 0&&e.length===0)return;const t=Yn(Kn.failed);t.append(Yn(Kn.failedTitle,"Failed to load plugins"));for(const r of e)t.append(Yn(Kn.failedItem,r));this.failure!==void 0&&t.append(Yn(Kn.failedItem,this.failure)),this.card.replaceChildren(this.wordmark,t)}updateProgress(){const e=this.total===0?0:Math.min(this.active.size/this.total,1);this.spinner.style.setProperty("--dsh-boot-arc",\`\${String(Math.round(72+e*216))}deg\`);if(this.hint&&!this.failure&&this.total>0)this.hint.textContent=this.active.size>=this.total?"Workbench ready":\`Loading plugins (\${this.active.size}/\${this.total})…\`}};`;

  s = replaceOnce(s, oldZz, newZz, 'choreographed intro zZ class in dsh-web-frontend');
  const rzFind = 'this.stopDragRecall=TZ({document:this.container.ownerDocument}),await EZ(s,this.container)';
  const rzRepl = 'this.stopDragRecall=TZ({document:this.container.ownerDocument}),await this.page.waitUntilReady(),await EZ(s,this.container),await this.page.finish()';
  s = replaceOnce(s, rzFind, rzRepl, 'RZ.run waitUntilReady and finish hook');
  mustParse(s, p);
  put(p, s);
  report.push('intro animation: GSAP-style choreographed AS cube and kinetic type intro (7.4s default, skippable via Skip intro or Esc/Space/Enter); window shows immediately on launch');
}

// ---- patch 16: the data folder is ~/.arc (was ~/.dsh), its variable ARC_HOME (was DSH_HOME), project skills in .arc/skills
{
  // a path segment only: after a quote, slash, tilde or space ("~/.dsh", ".dsh/skills", ".dsh-mkdir-"); never a property such as manifest?.dsh?.bundle
  const DOT = /(?<=[\s'"`/\\~(])\.dsh(?![\w])/g, ENV = /(?<![\w])DSH_HOME(?![\w])/g;
  let files = 0, n = 0;
  for (const f of src.files) {
    if (f.entry.unpacked || overrides.get(f.path) === null || !/\.(js|cjs|mjs|json|ya?ml|md)$/.test(f.path)) continue;
    const s = text(f.path);
    if (!/(?<=[\s'"`/\\~(])\.dsh(?![\w])|DSH_HOME/.test(s)) continue;
    const out = s.replace(DOT, () => (n++, '.arc')).replace(ENV, () => (n++, 'ARC_HOME'));
    if (/\.(m?js|cjs)$/.test(f.path)) mustParse(out, f.path);
    put(f.path, out);
    files++;
  }
  const home = text(DS + 'dsh-home-paths/lib/index.js');
  must(home.includes('const DSH_HOME_DIR_NAME = ".arc";') && home.includes('const DSH_HOME_ENV = "ARC_HOME";'), 'data folder constants in dsh-home-paths');
  must(text('lib/main.js').includes('const DSH_HOME_DIR_NAME = ".arc";'), 'data folder constant in the desktop main process');
  must(!/\?\.arc\?\./.test(text(DS + 'dsh-app-boot/lib/index.js')), 'the dsh manifest field stays');
  // DSH_HOME was refused in .env files by its DSH_ prefix; ARC_HOME needs its own entry
  const bp = DS + 'dsh-app-boot/lib/index.js';
  put(bp, replaceOnce(text(bp), 'const BOOTSTRAP_NAMES = new Set([\n\t"PATH",', 'const BOOTSTRAP_NAMES = new Set([\n\t"ARC_HOME",\n\t"PATH",', 'ARC_HOME in the bootstrap-only names'));
  report.push(`data folder: ~/.arc and ARC_HOME (${n} places in ${files} files)`);
}

// ---- patch 17: clean room. Every internal name of the original moves to Arc (lib/arcnames.mjs): package names
// (@deepseek-ai/dsh-x -> @arc-harness/arc-x), the runtime folder (dsh/ -> arc/), code names, the "dsh" package.json field,
// the command and link names. File paths are renamed when the archive is written; the files kept beside the archive
// (app.asar.unpacked) get the same names in build/app.asar.unpacked, made of hard links and rewritten texts.
const TEXTFILE = /\.(m?js|cjs|json|ya?ml|md|txt|css|html|svg|ts|map|sh|cmd|ps1|py|toml|xml|lock|c|h)$|(^|\/)[^./]+$/i;
const unpackedNew = new Map(); // new path under arc/ -> rewritten buffer of an unpacked text file
{
  let files = 0, n = 0, clash = 0;
  for (const f of src.files) {
    if (f.entry.unpacked || overrides.get(f.path) === null || !TEXTFILE.test(f.path)) continue;
    const s = overrides.has(f.path) ? overrides.get(f.path).toString('utf8') : src.read(f).toString('utf8');
    const [t, k] = arcText(s);
    if (!k) continue;
    // a new name may not already exist in the same file with another meaning (arcFoo next to dshFoo)
    const had = new Set(s.match(/[\w$-]*(?:arc|Arc|ARC)[\w$-]*/g) || []);
    for (const w of new Set(s.match(/[\w$-]*(?:dsh|Dsh|DSH)[\w$-]*/g) || [])) { if (/^(?:dsh|Dsh|DSH)$/.test(w)) continue; const nw = arcText(w)[0]; if (nw !== w && had.has(nw)) { clash++; if (clash < 6) console.log(`name clash in ${f.path}: ${w} -> ${nw}`); } }
    put(f.path, t);
    files++; n += k;
  }
  must(clash === 0, `${clash} renamed names already exist in the same file`);
  const resources = process.env.ARC_RESOURCES || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness', 'resources');
  const unpackedSrc = [path.join(root, 'pristine', 'app.asar.unpacked'), path.join(resources, 'app.asar.unpacked')].find((d) => fs.existsSync(path.join(d, 'dsh')));
  must(unpackedSrc, 'the original app.asar.unpacked (with its dsh folder) was not found');
  const ud = out + '.unpacked';
  if (fs.existsSync(ud)) {
    if (fs.lstatSync(ud).isSymbolicLink()) fs.rmdirSync(ud); // a junction left by a test: remove the link only
    else fs.rmSync(ud, { recursive: true }); // our own earlier copy: hard links and rewritten texts
  }
  const st = makeArcCopy(unpackedSrc, ud, { rewrite: (p) => /[\\/]@deepseek-ai[\\/]/.test(p) });
  (function walk(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), p);
      else if (fs.statSync(path.join(d, e.name)).nlink === 1) unpackedNew.set(p, fs.readFileSync(path.join(d, e.name)));
    }
  })(ud, '');
  report.push(`clean room: ${n} internal names in ${files} files move to Arc; side folder ${st.linked} files linked, ${st.rewritten} rewritten, ${st.renamed} names changed`);
}

// ---- keep the runtime manifest honest: new size and hash for every changed file under dsh/ (named arc/ in the written archive)
{
  const mp = 'dsh/desktop-runtime.json';
  const m = JSON.parse(text(mp));
  const byPath = new Map(m.files.map((e) => [e.path, e]));
  let n = 0, gone = 0;
  const removed = new Set();
  const rel = (p) => arcText(p)[0].slice(4);
  const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
  for (const [p, buf] of overrides) {
    if (!p.startsWith('dsh/') || p === mp) continue;
    const e = byPath.get(rel(p));
    if (!e) {
      // a file this build adds: it gets its own manifest entry
      if (buf !== null) { const ne = { path: rel(p), bytes: buf.length, sha256: sha256(buf), executable: false }; m.files.push(ne); byPath.set(ne.path, ne); n++; }
      continue;
    }
    if (buf === null) { removed.add(e.path); gone++; continue; }
    e.bytes = buf.length; e.sha256 = sha256(buf); n++;
  }
  for (const [p, buf] of unpackedNew) {
    const e = byPath.get(p.slice(4));
    must(e, 'manifest entry of a rewritten unpacked file: ' + p);
    e.bytes = buf.length; e.sha256 = sha256(buf); n++;
  }
  m.files = m.files.filter((e) => !removed.has(e.path));
  put(mp, JSON.stringify(m));
  report.push(`runtime manifest: ${n} entries updated, ${gone} removed`);
}

// ---- clean-room check: no old name is left in any text file of the written archive (base64 data excepted)
{
  let left = 0;
  for (const f of src.files) {
    if (f.entry.unpacked || overrides.get(f.path) === null || !TEXTFILE.test(f.path)) continue;
    const s = overrides.has(f.path) ? overrides.get(f.path).toString('utf8') : src.read(f).toString('utf8');
    const skip = [...s.matchAll(/[A-Za-z0-9+/=_-]{120,}/g)].filter((r) => /[+=]/.test(r[0])).map((r) => [r.index, r.index + r[0].length]);
    for (const m of s.matchAll(LEFT)) if (!skip.some(([x, y]) => m.index >= x && m.index < y)) { left++; if (left < 6) console.log('left:', f.path, s.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, ' ')); }
  }
  must(left === 0, `${left} old names left in the archive text`);
  report.push('clean room: 0 old names left in the archive text');
}

fs.mkdirSync(path.dirname(out), { recursive: true });
const info = writeAsar(src, out, overrides, (seg) => arcText(seg)[0]);
const sha = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
fs.writeFileSync(path.join(path.dirname(out), 'BUILD.json'), JSON.stringify({ built: new Date().toISOString(), source: 'pristine/app.asar', changedFiles: overrides.size, report, sha256: sha, ...info }, null, 2));
console.log(report.map((r) => '- ' + r).join('\n'));
console.log(`changed files: ${overrides.size}; archive: ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB) sha256 ${sha.slice(0, 16)}`);
