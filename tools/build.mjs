// Build the Arc Harness app archive from the pristine DeepSeek Harness archive.
//   node tools/build.mjs [out.asar]      default out: build/app.asar
// Every patch asserts how many places it changed, so a different upstream build fails loudly instead of half-applying.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openAsar, writeAsar } from '../lib/asar.mjs';

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
// mark: the plain cube up to 32 px, the AS cube above; name: live text in Geist 600 (no artwork)
{
  const p = DS + 'dsh-web-frontend/dist/assets/index-BXV-oxvX.js';
  let s = text(p);
  const mark = `function gA({size:e=24,className:t}){return e>32?${cubeCode('d.jsx', 'd.jsxs', 'e', 't', 'as')}:${cubeCode('d.jsx', 'd.jsxs', 'e', 't', 'plain')}}`;
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

// ---- patch 2: the running indicator in the chat client (animated mask and still icon): the plain cube
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

// ---- keep the runtime manifest honest: new size and hash for every changed file under dsh/
{
  const mp = 'dsh/desktop-runtime.json';
  const m = JSON.parse(text(mp));
  const byPath = new Map(m.files.map((e) => [e.path, e]));
  let n = 0, gone = 0;
  const removed = new Set();
  for (const [p, buf] of overrides) {
    if (!p.startsWith('dsh/') || p === mp) continue;
    const e = byPath.get(p.slice(4));
    if (!e) continue;
    if (buf === null) { removed.add(e.path); gone++; continue; }
    e.bytes = buf.length; e.sha256 = crypto.createHash('sha256').update(buf).digest('hex'); n++;
  }
  m.files = m.files.filter((e) => !removed.has(e.path));
  put(mp, JSON.stringify(m));
  report.push(`runtime manifest: ${n} entries updated, ${gone} removed`);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
const info = writeAsar(src, out, overrides);
const sha = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
fs.writeFileSync(path.join(path.dirname(out), 'BUILD.json'), JSON.stringify({ built: new Date().toISOString(), source: 'pristine/app.asar', changedFiles: overrides.size, report, sha256: sha, ...info }, null, 2));
console.log(report.map((r) => '- ' + r).join('\n'));
console.log(`changed files: ${overrides.size}; archive: ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB) sha256 ${sha.slice(0, 16)}`);
