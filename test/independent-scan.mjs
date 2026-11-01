// A second, independent look at the text a person reads. It shares no code with lib/brandrules.mjs: its own string finder,
// its own patterns, its own allow list (test/independent.allow.json). If the build rules are too narrow, this scan finds what they missed.
//   node test/independent-scan.mjs [archive.asar]    (default build/app.asar)
//   node test/independent-scan.mjs --profiles        plugin packages and local plugins in ~/.dsh (or --dsh-home <folder>)
//   add --list for every finding, --tier for the names that wait for the rename slices, --skips for the files not read and why
// It checks itself first: known-bad samples must be found, and each kind of file must give at least the stated number of pieces.
// A scan that reads nothing must fail, not pass. Files it does not read are counted by reason; a big file that carries the old names is a finding.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'independent.allow.json'), 'utf8'));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const MODELS = cfg.models.map((s) => new RegExp(s, 'g'));
const COMMANDS = cfg.commands.map((s) => new RegExp(s, 'g'));
// a link ends at a space, a quote, an angle bracket, a closing bracket or a backtick, so text stuck to a link stays visible
const strip = (s) => { let t = s.replace(/https?:\/\/[^\s"'<>)\]`]+/g, ' '); for (const re of [...MODELS, ...COMMANDS]) t = t.replace(re, ' '); return t; };

// what counts as a finding in one piece of text
const PATTERNS = [
  ['DeepSeek', /(?<![A-Za-z])(?:DeepSeek|Deepseek|deepSeek|DEEPSEEK|Deep[ -]Seek)(?![A-Za-z_])/],
  ['DSH', /(?<![A-Za-z_])DSH(?![_A-Za-z])/],   // "Dsh" in code (a .NET namespace) is an identifier; a bare label "Dsh" is caught by BRANDWORD
  ['Whale', /(?<![A-Za-z0-9_])(?:Whales?|WHALES?)(?![A-Za-z0-9_])/], // a camel-case class name such as runningWhaleStill is not a word
  ['whale', /(?<![A-Za-z0-9_])whales?(?![A-Za-z0-9_])/],           // also "whale-blue"; an id such as dsh-plugin-whale-pet is rewritten by the build
  // lower case "dsh" in prose: spaces or plain punctuation around it. In code spans, quotes and command lines it is the command and waits for the rename slices.
  ['dsh word', /(?<![\w@./:$`'"\\-])dsh(?![\w@/:?`'"\\-]|\.\w)/],   // a full stop after the word ends a sentence; ".cmd" or ".exe" does not
  ['dsh code', /(?<![\w@./:$-])dsh(?![\w@/:?-]|\.\w)/],
  ['deepseek word', /(?<![\w@./:$-])deepseek(?![\w@/:.-])/],
  ['env name', /(?<![A-Za-z])DEEPSEEK_[A-Z0-9_]+/],
];
// names that are not text for a person: they stay until the rename slices (ARC-RENAME-2) and are counted, not hidden
export const TIER = new Set(['dsh code', 'deepseek word', 'env name']);
// addresses of DeepSeek services and of the old vendor, checked on the whole text, links included
const TLD = '(?:com|net|org|io|ai|cn|dev|app|co|cc|xyz|site|cloud|tech|me|info|us|eu|ru|jp|kr|so|sh|to|ly|gg|im|tv)';
const ADDRESS = new RegExp(`(?<![\\w/-])(?:[a-z0-9-]+\\.)*[a-z0-9-]*deepseek[a-z0-9-]*\\.${TLD}(?![\\w-])|deepseek-ai\\.github\\.io|github\\.com\\/deepseek-ai|trtgsjkv6r\\.feishu\\.cn|r2049\\.cn`, 'i');
export function findIn(text) {
  const t = strip(text);
  const out = [];
  if (ADDRESS.test(text)) out.push('address');
  for (const [id, re] of PATTERNS) if (re.test(t)) out.push(id);
  // the strict prose pattern wins over the code pattern for the same text
  return out.includes('dsh word') ? out.filter((id) => id !== 'dsh code') : out;
}

// \uXXXX and \xXX escapes in a script string are read as the characters they stand for
const decode = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

// Strings of a script. A small reader that skips comments and regular expression literals, so the words of a comment are not taken for
// text a person reads and a quote inside a regular expression does not open a string. Plain strings end at the end of the line.
// A template string may span lines. A slash after one of ( , = : [ ! & | ? { } ; or after a keyword starts a regular expression.
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'else', 'do', 'void', 'delete', 'throw', 'yield', 'await', 'new', 'instanceof']);
function* strings(text) {
  const n = text.length;
  let i = 0, prev = '', word = '';
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (/[A-Za-z_$]/.test(c)) { let j = i + 1; while (j < n && /[\w$]/.test(text[j])) j++; word = text.slice(i, j); prev = 'a'; i = j; continue; }
    if (c === '\\') { i += 2; continue; }
    if (c === '/' && d === '/') { const e = text.indexOf('\n', i); if (e < 0) return; i = e + 1; continue; }
    if (c === '/' && d === '*') { const e = text.indexOf('*/', i + 2); if (e < 0) return; i = e + 2; continue; }
    if (c === '/' && (prev === '' || /[(,=:[!&|?{};]/.test(prev) || (prev === 'a' && REGEX_AFTER_WORD.has(word)))) {
      let j = i + 1, cls = false;
      while (j < n && text[j] !== '\n') { if (text[j] === '\\') j++; else if (text[j] === '[') cls = true; else if (text[j] === ']') cls = false; else if (text[j] === '/' && !cls) break; j++; }
      i = j + 1; prev = '/'; word = ''; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      if (text[j] === c) yield text.slice(i + 1, j);
      i = j + 1; prev = c; word = ''; continue;
    }
    if (c === '`') {
      let j = i + 1, depth = 0;
      while (j < n) {
        const ch = text[j];
        if (ch === '\\') { j += 2; continue; }
        if (depth === 0 && ch === '`') break;
        if (ch === '$' && text[j + 1] === '{') { depth++; j += 2; continue; }
        if (depth > 0 && (ch === '"' || ch === "'")) { let k = j + 1; while (k < n && text[k] !== ch && text[k] !== '\n') k += text[k] === '\\' ? 2 : 1; if (text[k] === ch) { j = k + 1; continue; } }
        if (depth > 0 && ch === '}') depth--;
        j++;
      }
      yield text.slice(i + 1, j);
      i = j + 1; prev = '`'; word = ''; continue;
    }
    if (!/\s/.test(c)) { prev = c; word = ''; }
    i++;
  }
}
function jsonValues(v, out) { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => jsonValues(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => jsonValues(x, out)); }

// Every piece carries its kind: text (lines of prose, markup, settings), json (all string values), js (quoted strings of a script),
// css (the strings after "content:"). Sources in TypeScript and type declarations are not read: the app runs the built scripts.
const TEXT_FILE = /\.(md|markdown|txt|html?|svg|ya?ml|ps1)$/i;
const CODE_FILE = /\.(c|m)?jsx?$/i;
export function pieces(file, text) {
  const base = path.basename(file).toLowerCase();
  const out = [];
  if (TEXT_FILE.test(file)) {
    if (!/^(license|licence|notice|changelog)/i.test(base)) for (const l of text.split(/\r?\n/)) { if (l.trim()) out.push({ kind: 'text', text: l }); }
  } else if (/\.css$/i.test(file)) {
    for (const m of text.matchAll(/content\s*:\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)')/g)) out.push({ kind: 'css', text: m[1] ?? m[2] });
  } else if (/\.json$/i.test(file)) {
    if (!/package-lock\.json$|\.map$/i.test(base)) { try { const v = []; jsonValues(JSON.parse(text.replace(/^\uFEFF/, '')), v); for (const x of v) out.push({ kind: 'json', text: x }); } catch { /* skip */ } }
  } else if (CODE_FILE.test(file) && !/\.d\.[cm]?ts$/i.test(file)) {
    for (const x of strings(text)) out.push({ kind: 'js', text: decode(x) });
  }
  return out;
}

const SKIP_PATTERNS = cfg.skipFiles.map((s) => [s, new RegExp(s)]);
const hits = [];
const tierHits = [];
const counts = { text: 0, css: 0, json: 0, js: 0 };
const skipped = { allow: 0, unpacked: 0, big: 0 };
const skipBy = {};
let files = 0;
// a name, an id or a path: letters, digits and _ . $ @ / \ - only
const IDENT = /^[A-Za-z0-9_.$@/\\-]+$/;
const BRANDWORD = /^(DeepSeek|Deepseek|DEEPSEEK|DSH|Dsh|Whales?|WHALES?)$/;
export function check(kind, piece) {
  const ids = findIn(piece);
  // A script string or JSON value that is one name, id or path: only a bare brand word (a label) or an address counts there.
  // Text with CJK characters, punctuation or markup next to the word is not a name and gets the full check.
  if ((kind === 'js' || kind === 'json') && IDENT.test(piece)) return ids.filter((id) => id === 'address' || BRANDWORD.test(piece));
  return ids;
}
const READ = /\.(c|m)?jsx?$|\.json$|\.md$|\.html?$|\.txt$|\.svg$|\.css$|\.ya?ml$|\.ps1$/i;
const BIG = 12e6;
// A file that is too big to read string by string still must not carry the old names: the word patterns run over its whole text.
function bigFile(file, buf) {
  skipped.big++;
  const t = buf.toString('utf8');
  const ids = [];
  if (ADDRESS.test(t)) ids.push('address');
  for (const [id, re] of PATTERNS) if (!TIER.has(id) && id !== 'dsh word' && re.test(t)) ids.push(id);
  if (ids.length && !(cfg.bigFiles || []).some((x) => file.replace(/\\/g, '/').includes(x))) hits.push({ file, rule: 'big file: ' + ids.join('+'), text: buf.length + ' bytes; read it by hand or list it in bigFiles' });
}
function scan(file, text) {
  const norm = file.replace(/\\/g, '/');
  for (const [src, re] of SKIP_PATTERNS) if (re.test(norm)) { skipped.allow++; skipBy[src] = (skipBy[src] || 0) + 1; return; }
  files++;
  for (const p of pieces(file, text)) {
    counts[p.kind]++;
    for (const id of check(p.kind, p.text)) (TIER.has(id) ? tierHits : hits).push({ file, rule: id, text: p.text.replace(/\s+/g, ' ').slice(0, 130) });
  }
}

// ---- self-check: known-bad samples must be found, known-good samples must pass -----------------------------------
function selfCheck() {
  const bad = [];
  const expect = (label, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${label}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };
  const ids = (f, t) => pieces(f, t).flatMap((p) => check(p.kind, p.text));
  const BS = '\\';
  expect('js sentence', ids('a/x.js', 'const a = "Powered by DeepSeek today";'), ['DeepSeek']);
  expect('js short label', ids('a/x.js', 'const a = "DSH";'), ['DSH']);
  expect('js long string', ids('a/x.js', `const a = "${'word '.repeat(150)}Whale mascot";`), ['Whale']);
  expect('js one-word brand label', ids('a/x.js', "const a = 'DeepSeek';"), ['DeepSeek']);
  expect('js label with punctuation', ids('a/x.js', 'const a = "DeepSeek:";'), ['DeepSeek']);
  expect('js label with CJK text', ids('a/x.js', 'const a = "\u6B22\u8FCE\u4F7F\u7528DeepSeek";'), ['DeepSeek']);
  expect('js mixed case label', ids('a/x.js', 'const a = "Use Deepseek or DEEPSEEK now";'), ['DeepSeek']);
  expect('js plural label', ids('a/x.js', 'const a = "Whales";'), ['Whale']);
  expect('js escaped name', ids('a/x.js', `const a = "${BS}u0044eepSeek rocks";`), ['DeepSeek']);
  expect('js address in a link', ids('a/x.js', 'const a = "see https://platform.deepseek.dev/docs for help";'), ['address']);
  expect('js address with a hyphen', ids('a/x.js', 'const a = "https://api.deepseek-ai.com/v1";'), ['address']);
  expect('js repo link', ids('a/x.js', 'const a = "https://github.com/deepseek-ai/thing";'), ['address']);
  expect('js id stays', ids('a/x.js', 'const a = "dsh-web-app"; const b = "whale";'), []);
  expect('js class name stays', ids('a/x.js', 'const c = "runningWhaleAnimated"; const d = "DeepSeek-Harness-MIT.txt";'), []);
  expect('css class name inside a long string', ids('a/x.js', 'const css = ".V4vHZW_runningWhaleAnimated{display:none} .b{color:red}";'), []);
  expect('js comment is not text', ids('a/x.js', `// the DeepSeek note\n/** About DSH and its Whale */ const a = 1; /${BS}${BS}//.test(b); const e = "fine text here";`), []);
  expect('js string after a comment', ids('a/x.js', '/* DSH */ const a = "Say DeepSeek twice";'), ['DeepSeek']);
  expect('js regex with a backtick', ids('a/x.js', 'const r = /`/; const s = "Say DeepSeek twice";'), ['DeepSeek']);
  expect('js regex with a quote', ids('a/x.js', `const r = /["']+/g; const s = "Say DeepSeek twice";`), ['DeepSeek']);
  expect('js division is not a regex', ids('a/x.js', 'const q = a / b; const s = "Say DeepSeek twice"; const t = c / d;'), ['DeepSeek']);
  expect('js template string', ids('a/x.js', 'const a = `About ${x} the Whale`;'), ['Whale']);
  expect('js string inside a template expression', ids('a/x.js', "const a = `# ${x ? x.title : 'DSH Session'}`;"), ['DSH']);
  expect('js brace inside a template string', ids('a/x.js', "const a = `${'}'} and ${y} Whale`;"), ['Whale']);
  expect('js model name stays', ids('a/x.js', 'const a = "Use DeepSeek V4 Pro for this";'), []);
  expect('js env name is tier', ids('a/x.js', 'const a = "Set DEEPSEEK_API_KEY first";'), ['env name']);
  expect('prose dsh fails', ids('a/x.js', 'const a = "Matches dsh interface";'), ['dsh word']);
  expect('prose dsh in a sentence fails', ids('a/x.js', 'const a = "Let agents add a powered by dsh badge";'), ['dsh word']);
  expect('dsh at the end of a sentence fails', ids('a/x.js', 'const a = "Please retry or restart dsh.";'), ['dsh word']);
  expect('dsh type member is code', ids('a/x.js', 'const a = "interface E { readonly dsh?: string }";'), []);
  expect('dsh in a shell lookup is code', ids('a/x.js', 'const a = "printf x; command -v dsh; printf y";'), []);
  expect('dsh help example is code', ids('a/x.js', 'const a = "  dsh rescue --from-default-profile web";'), []);
  expect('dsh in a code span is tier', ids('a/x.md', 'Run the `dsh` launcher'), ['dsh code']);
  expect('dsh command line is allowed', ids('a/x.md', 'Run dsh plugin add foo'), []);
  expect('whale-blue fails', ids('a/x.md', 'its whale-blue palette'), ['whale']);
  expect('package.json description', ids('a/package.json', '{"description":"The DeepSeek harness"}'), ['DeepSeek']);
  expect('package.json nested field', ids('a/package.json', '{"contributes":{"title":"About DeepSeek"}}'), ['DeepSeek']);
  expect('package.json name stays', ids('a/package.json', '{"name":"@deepseek-ai/dsh-web-app"}'), []);
  expect('json string value', ids('a/en.json', '{"k":"Open the Whale menu"}'), ['Whale']);
  expect('json in a folder named i18n', ids('a/i18n/strings.json', '{"k":"About DSH"}'), ['DSH']);
  expect('md line', ids('a/x.md', 'first\n\nAbout DeepSeek\n'), ['DeepSeek']);
  expect('html text stuck to a link', ids('a/x.html', `<a href='https://x.com'>DeepSeek</a>`), ['DeepSeek']);
  expect('svg text', ids('a/x.svg', '<svg><text>Whale</text></svg>'), ['Whale']);
  expect('yaml value', ids('a/x.yml', 'title: About DeepSeek'), ['DeepSeek']);
  expect('powershell help text', ids('a/x.ps1', '.SYNOPSIS Diagnose the DSH sandbox'), ['DSH']);
  expect('css content string', ids('a/x.css', '.a::before { content: "DeepSeek" }'), ['DeepSeek']);
  expect('css class name only', ids('a/x.css', '.runningWhale { color: red }'), []);
  expect('md license skipped', ids('a/LICENSE.md', 'DeepSeek\n'), []);
  return bad;
}
// Each kind of file must give a minimum number of pieces (about 70 % of what was measured), or the scan read the wrong things.
const FLOOR = { archive: { text: 50000, css: 10, json: 45000, js: 380000 }, profiles: { text: 150000, css: 10, json: 50000, js: 3000000 } };
const DEPTH = 12;

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const bad = selfCheck();
  if (bad.length) { for (const b of bad) console.error('SELF-CHECK FAIL ' + b); process.exit(3); }
  const missing = cfg.skipFiles.filter((s) => !(cfg.skipReasons || {})[s]);
  if (missing.length) { console.error('SKIP LIST: no reason stated for ' + missing.join(' ; ')); process.exit(3); }
  const profiles = args.includes('--profiles');
  const fixture = !!opt('--dsh-home');   // a test folder in place of ~/.dsh: the floors do not apply
  if (profiles) {
    const h = opt('--dsh-home') || path.join(os.homedir(), '.dsh');
    const walk = function* (d, depth = 0) { let e; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const x of e) { const p = path.join(d, x.name); if (x.isDirectory()) { if (x.name === '.pnpm' || x.name === '.bin' || x.name.startsWith('_archive')) continue; if (depth < DEPTH) yield* walk(p, depth + 1); } else yield p; } };
    for (const d of [path.join(h, 'local-plugins'), path.join(h, 'profiles', 'web', 'node_modules'), path.join(h, 'profiles', 'desktop', 'node_modules')]) {
      for (const p of walk(d)) { if (!READ.test(p)) continue; let st; try { st = fs.statSync(p); } catch { continue; } const buf = fs.readFileSync(p); if (st.size > BIG) { bigFile(p, buf); continue; } scan(p, buf.toString('utf8')); }
    }
    try { scan(path.join(h, 'local-gateway.mjs'), fs.readFileSync(path.join(h, 'local-gateway.mjs'), 'utf8')); } catch { /* absent */ }
  } else {
    const { openAsar } = await import(pathToFileURL(path.join(root, 'lib', 'asar.mjs')).href);
    const asar = args.find((a) => a.endsWith('.asar')) || path.join(root, 'build', 'app.asar');
    const a = openAsar(asar);
    for (const f of a.files) {
      if (!READ.test(f.path)) continue;
      if (f.entry.unpacked) { skipped.unpacked++; continue; }
      const buf = a.read(f);
      if (f.entry.size > BIG) { bigFile(f.path, buf); continue; }
      scan(f.path, buf.toString('utf8'));
    }
  }
  if (!fixture && files < 1000) { console.error(`only ${files} files scanned`); process.exit(2); }
  const floor = FLOOR[profiles ? 'profiles' : 'archive'];
  const low = fixture ? [] : Object.keys(floor).filter((k) => counts[k] < floor[k]);
  const per = {};
  for (const h of hits) per[h.rule] = (per[h.rule] || 0) + 1;
  console.log(`independent scan: ${files} files, pieces ${JSON.stringify(counts)}, not read ${JSON.stringify(skipped)}, ${hits.length} findings ${JSON.stringify(per)}; names that wait for the rename slices (code spans, env names, provider ids): ${tierHits.length}`);
  if (low.length) console.error(`FAIL too few pieces of kind ${low.join(', ')} (floors ${JSON.stringify(floor)}): the scan did not read what it should`);
  for (const h of (args.includes('--list') ? hits : hits.slice(0, 40))) console.log(`  [${h.rule}] ${h.file.replace(/^dsh\/node_modules\//, '')} :: ${h.text}`);
  if (args.includes('--tier')) for (const h of tierHits) console.log(`  (tier) [${h.rule}] ${h.file.replace(/^dsh\/node_modules\//, '')} :: ${h.text}`);
  if (args.includes('--skips')) for (const [s, n] of Object.entries(skipBy)) console.log(`  skipped ${String(n).padStart(5)}  ${s}`);
  const j = args.indexOf('--json'); if (j >= 0) fs.writeFileSync(args[j + 1], JSON.stringify(hits, null, 1));
  process.exit(hits.length || low.length ? 1 : 0);
}
