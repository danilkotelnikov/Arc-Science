// One rule set for the brand text: the build rewrites with it and the test checks with it.
// A string is "dirty" when rewrite() would change it. Real DeepSeek model names stay (owner decision, 2026-11-01).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { swapPictures } from './whaleimg.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const allow = JSON.parse(fs.readFileSync(path.join(here, '..', 'test', 'ui-strings.allow.json'), 'utf8'));
const MODEL = allow.modelNames.map((s) => new RegExp(s, 'gi'));

// text before and after a word that makes it part of an identifier, path or address
const B = '(?<![\\w@./:\\\\-])';
const A = '(?![\\w@/\\\\-]|\\.\\w)';
// lowercase "dsh" is the product name in prose ("restart dsh", "the dsh web client", "powered by dsh");
// after a command word, or in front of a sub-command or a flag, it is the command and stays ("pnpm dsh plugin", "run dsh", "dsh --profile web")
// It is also code after a flag ("command -v dsh"), at the start of an indented line (help examples such as "  dsh web ..."), and before "?" or ":" (a type member: "readonly dsh?: string").
const DSH_BEFORE = '(?<=[ \\u00a0(\\[*])(?<!(?:\\b(?:pnpm|npx|npm|node|bun|sudo|run|then|use|exec|execute|launch|type|which|where|Get-Command)|[ \\u00a0]-\\w+|(?:^|[\\n\\u0001])[ \\u00a0]*)[ \\u00a0])';

// Addresses of DeepSeek services become an address that can never resolve (the .invalid top-level name, RFC 2606),
// so no code path can reach them. Model ids such as deepseek/deepseek-r1 are not addresses and stay.
export const DEAD_HOST = 'arc-harness.invalid';
export const RULES = [
  { id: 'host', re: /(?<![\w.-])(?:[a-z0-9-]+\.)*deepseek(?:svc|cdn)?\.(?:com|ai|cn|org|net|io|dev|app|co)(?![\w-])/gi, to: DEAD_HOST },
  { id: 'host-repo', re: /(?<![\w@.-])github\.com\/deepseek-ai(?![\w-])/gi, to: 'github.invalid/arc-harness' },
  // the contact form of the old vendor and the relay of a third-party remote plugin (disabled in both profiles)
  { id: 'host-misc', re: /(?<![\w.-])(?:trtgsjkv6r\.feishu\.cn|(?:[a-z0-9-]+\.)*r2049\.cn)(?![\w-])/gi, to: DEAD_HOST },
  // names that set the address of a DeepSeek endpoint through the environment
  { id: 'env', re: /(?<![\w])DEEPSEEK_((?:[A-Z0-9]+_)*)BASE_URL(?![\w])/g, to: 'ARC_$1BASE_URL' },
  { id: 'env-platform', re: /(?<![\w])DSH_PLATFORM_ORIGIN(?![\w])/g, to: 'ARC_PLATFORM_ORIGIN' },
  { id: 'brand', re: /DeepSeek[  ]Harness/g, to: 'Arc Harness' },
  { id: 'brand-upper', re: /DEEPSEEK[  ]HARNESS/g, to: 'ARC HARNESS' },
  // a banner or heading in capitals: "DEEPSEEK STAYS THE BRAIN" (environment names such as DEEPSEEK_API_KEY have an underscore and stay)
  { id: 'deepseek-upper', prose: true, re: /(?<![\w@./:\\-])DEEPSEEK(?![\w@/\\-]|\.\w)/g, to: 'ARC HARNESS' },
  { id: 'deepseek', re: new RegExp(B + 'DeepSeek' + A, 'g'), to: 'Arc Harness' },
  { id: 'deepseek-lower', re: new RegExp(B + 'deepseek' + A + '(?=[ \\u00a0]+[a-z]+[ \\u00a0])', 'g'), to: 'Arc Harness' },
  { id: 'dsh', re: new RegExp(B + 'DSH' + A, 'g'), to: 'Arc Harness' },
  { id: 'dsh-prose', re: new RegExp(DSH_BEFORE + 'dsh(?![\\w@/\\\\:?-]|\\.\\w)(?![ \\u00a0]+(?:plugin\\b|serve\\b|profile[ \\u00a0]+(?:list|add|remove|new)|-))', 'g'), to: 'Arc Harness' },
  // a sentence that starts with the lowercase name ("dsh is different from the other harnesses"); a line that starts with a command stays
  { id: 'dsh-start', re: /(?<=^|[\n\u0001])dsh(?=[  ](?:is|are|was|were|will|can|cannot|refuses|has|have|does|supports|requires|runs|needs|uses|also|still|only|treats|CLI|core|app|SDK)\b)/gm, to: 'Arc Harness' },
  { id: 'whale-example', re: /dsh-plugin-whale-pet/g, to: 'arc-plugin-example' },
  { id: 'whale', re: new RegExp(B + 'Whale' + A, 'g'), to: 'Arc Harness', exceptNear: /\bNAVER\s*$/i },
  // "whale-blue" named the old brand colour; the colours are cream and brown now
  { id: 'whale-blue', re: /(?<![\w-])whale-blue(?![\w-])/g, to: 'cream-and-brown' },
  // lowercase "whale" in prose names the old logo; the new mark is the cube
  { id: 'whale-lower', prose: true, re: /(?<![\w-])whale(s?)(?![\w-])/g, to: 'cube$1' },
  // menu and error labels that start with the lowercase name ("Manage dsh Command", "dsh desktop host exited")
  { id: 'dsh-label', re: /(?<![\w@./:\\$-])dsh(?=[ \u00a0](?:Command|command|desktop host|desktop app|web authentication|inspector:))/g, to: 'Arc Harness' },
  // the user agent that every web request carries
  { id: 'ua', re: /(?<![\w@./:-])deepseek-harness\/(?=\d)/g, to: 'arc-harness/' },
  // next to a hyphen in a sentence: "powered-by-DSH", "DSH-specific", "DeepSeek-backed" (only in strings that hold a space, so header and id names stay)
  { id: 'dsh-hy', prose: true, re: /(?<![\w@./:\\])DSH(?![\w@\\]|\.\w)/g, to: 'Arc Harness' },
  { id: 'dsh-slash', prose: true, re: /(?<=[a-z]\/)DSH(?=[ \u00a0])/g, to: 'Arc Harness' },
  { id: 'deepseek-hy', prose: true, re: /(?<![\w@./:\\])DeepSeek(?![\w@\\]|\.\w)/g, to: 'Arc Harness' },
  // grammar after the rewrite: "a Arc Harness plugin" becomes "an Arc Harness plugin"
  // "Arc Harness (dsh)" names the product twice once the old name is gone
  { id: 'paren-dup', post: true, re: /Arc Harness \((?:dsh|Arc Harness)\)/g, to: 'Arc Harness' },
  // (a lower-case "a", or a capital "A" that starts a sentence; a label such as "Type A DeepSeek key" is left alone)
  { id: 'article', post: true, re: /(?<![\w-])a (Arc Harness)|(?:^|(?<=[.!?:][\s\u0001-\u0003]))A (Arc Harness)/gm, to: (m) => m.replace(/^(a|A) /, (s, a) => a + 'n ') },
];

// Replace model spans by placeholders so the rules cannot touch them
function mask(s) {
  const kept = [];
  let t = s;
  for (const re of MODEL) {
    t = t.replace(re, (m) => { kept.push(m); return `${kept.length - 1}`; });
  }
  return { t, kept };
}
function unmask(t, kept) {
  return t.replace(/(\d+)/g, (_, i) => kept[+i]);
}

export function rewrite(s) {
  if (!/deepseek|dsh|whale|feishu|r2049/i.test(s)) return s;
  const { t, kept } = mask(s);
  let out = t;
  const prose = /[\s\u0001-\u0003]/.test(s);
  for (const r of RULES) {
    if (r.post || (r.prose && !prose)) continue;
    if (!r.exceptNear) { out = out.replace(r.re, r.to); continue; }
    out = out.replace(r.re, (m, ...rest) => {
      const off = rest[rest.length - 2];
      if (typeof off === 'number' && r.exceptNear.test(out.slice(Math.max(0, off - 12), off))) return m;
      return r.to;
    });
  }
  for (const r of RULES) if (r.post) out = out.replace(r.re, r.to);
  return unmask(out, kept);
}

// the rule that would fire first, or null
export function classify(s) {
  if (!/deepseek|dsh|whale|feishu|r2049/i.test(s)) return null;
  const { t } = mask(s);
  const prose = /[\s\u0001-\u0003]/.test(s);
  for (const r of RULES) {
    if (r.post || (r.prose && !prose)) continue;
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(t))) {
      if (r.exceptNear && r.exceptNear.test(t.slice(Math.max(0, m.index - 12), m.index))) continue;
      return r.id;
    }
  }
  return null;
}

// --- string literals of a script, with their source positions ---
export function* literalRanges(src) {
  let i = 0;
  const n = src.length;
  let prev = '';
  let word = '';
  const AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'else', 'do', 'void', 'delete', 'throw', 'yield', 'await', 'new', 'instanceof']);
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (/[A-Za-z_$]/.test(c)) { const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 64)); word = m[0]; prev = 'a'; i += m[0].length; continue; }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j += 2; else j++; }
      if (src[j] === c) yield { start: i + 1, end: j };
      i = j + 1; prev = c; continue;
    }
    if (c === '`') {
      let j = i + 1;
      let depth = 0;
      let segStart = j;
      while (j < n) {
        const ch = src[j];
        if (depth === 0 && ch === '`') break;
        if (ch === '\\') { j += 2; continue; }
        if (ch === '$' && src[j + 1] === '{') { if (depth === 0) yield { start: segStart, end: j }; depth++; j += 2; continue; }
        if (depth > 0 && (ch === '"' || ch === "'")) {
          let k = j + 1;
          while (k < n && src[k] !== ch && src[k] !== '\n') { if (src[k] === '\\') k += 2; else k++; }
          if (src[k] === ch) { yield { start: j + 1, end: k }; j = k + 1; continue; }
        }
        if (depth > 0 && ch === '}') { depth--; j++; if (depth === 0) segStart = j; continue; }
        j++;
      }
      if (depth === 0) yield { start: segStart, end: j };
      i = j + 1; prev = c; continue;
    }
    if (c === '/' && (/[(,=:[!&|?{};]/.test(prev) || (prev === 'a' && AFTER_WORD.has(word)))) {
      let j = i + 1; let cls = false;
      while (j < n && src[j] !== '\n') { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j++; }
      i = j + 1; prev = '/'; continue;
    }
    if (!/\s/.test(c)) { prev = c; word = ''; }
    i++;
  }
}

// In raw script text a newline is the two characters backslash and n. A name right after it starts a word, so the escape
// becomes a one-character stand-in while the rules run and is restored afterwards.
// A \uXXXX or \xXX escape is one character that is not a letter: the digits become private-use stand-ins (each digit keeps its own case, so the text comes back byte for byte).
const hexIn = (h) => [...h].map((c) => String.fromCharCode(0xE300 + c.charCodeAt(0))).join('');
const hexOut = (h) => [...h].map((c) => String.fromCharCode(c.charCodeAt(0) - 0xE300)).join('');
export const markEscapes = (s) => s.replace(/\\n/g, '\u0001').replace(/\\t/g, '\u0002').replace(/\\r/g, '\u0003')
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => '\u0004' + hexIn(h)).replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => '\u0005' + hexIn(h));
export const restoreEscapes = (s) => s.replace(/\u0001/g, '\\n').replace(/\u0002/g, '\\t').replace(/\u0003/g, '\\r')
  .replace(/\u0004([\uE330-\uE366]{4})/g, (_, h) => '\\u' + hexOut(h)).replace(/\u0005([\uE330-\uE366]{2})/g, (_, h) => '\\x' + hexOut(h));

// True when the word also appears in the script outside quotes as a property name or a member access.
export function usedAsName(src, word) {
  const w = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?<![\\w"\'`$])' + w + '(?=\\s*:)|\\.' + w + '(?![\\w])').test(src);
}

export function rewriteScript(src) {
  if (!/deepseek|dsh|whale|feishu|r2049/i.test(src)) return src;
  let out = '';
  let last = 0;
  for (const { start, end } of literalRanges(src)) {
    const raw = src.slice(start, end);
    if (!/deepseek|dsh|whale|feishu|r2049/i.test(raw)) continue;
    const next = restoreEscapes(rewrite(markEscapes(raw)));
    if (/^[A-Za-z][\w]*$/.test(raw) && next !== raw && usedAsName(src, raw)) continue;
    if (next !== raw) { out += src.slice(last, start) + next; last = end; }
  }
  return out + src.slice(last);
}

// Markdown: prose and code samples both change, because fenced blocks often hold prompt text the model reads.
// Identifiers, paths and addresses are protected by the word boundaries of the rules.
export function rewriteMarkdown(text) {
  return rewrite(text);
}

export function dirtyMarkdownLines(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) if (line.trim() && classify(line)) out.push(line.trim());
  return out;
}

// JSON text: every word is inside a string, so the raw text can be rewritten
export function rewriteJsonText(text) {
  return rewrite(text);
}

// package.json: only the descriptive fields change (names, keys and dependency ranges stay)
export function rewritePackageJson(raw) {
  let j;
  try { j = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { return raw; }
  let changed = false;
  for (const k of ['description', 'title', 'displayName', 'productName']) {
    if (typeof j[k] === 'string') { const n = rewrite(j[k]); if (n !== j[k]) { j[k] = n; changed = true; } }
  }
  if (Array.isArray(j.keywords)) {
    j.keywords = j.keywords.map((x) => { if (typeof x !== 'string') return x; const n = rewrite(x); if (n !== x) changed = true; return n; });
  }
  // links to the repository, home page, issue tracker or funding page of the old vendor
  for (const k of ['repository', 'homepage', 'bugs', 'funding']) {
    if (k in j && /deepseek/i.test(JSON.stringify(j[k]))) { delete j[k]; changed = true; }
  }
  if (!changed) return raw;
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const indent = /^(\t| +)"/m.exec(raw)?.[1] ?? '  ';
  return JSON.stringify(j, null, indent).replace(/\n/g, eol) + (/\n$/.test(raw) ? eol : '');
}

// One entry point for the build and for the profile plugins: the same surfaces the test reads
// SVG pictures: the text between tags (labels, title and desc) and the text attributes; paths and ids stay
export function rewriteSvg(text) {
  if (!/deepseek|dsh|whale/i.test(text)) return text;
  return text
    .replace(/>([^<>]+)</g, (m, t) => '>' + rewrite(t) + '<')
    .replace(/<!--([\s\S]*?)-->/g, (m, c) => '<!--' + rewrite(c) + '-->')
    // any attribute value that is a sentence (has a space): aria-label, data-node-label, title, alt, data-detail
    .replace(/(=")([^"]*\s[^"]*)"/g, (m, eq, v) => eq + rewrite(v) + '"');
}

export function rewriteFile(file, text) {
  return swapPictures(file, rewriteFileText(file, text));   // pictures that hold the whale or the blue (lib/whaleimg.mjs)
}

function rewriteFileText(file, text) {
  const base = file.split(/[\\/]/).pop().toLowerCase();
  if (/\.svg$/i.test(file)) return rewriteSvg(text);
  if (/\.(md|markdown|ps1)$/i.test(file)) return /^(license|licence|changelog|notice|third)/i.test(base) ? text : rewriteMarkdown(text);
  if (/\.(txt|html?|ya?ml)$/i.test(file)) {
    if (/LICENSES?\./i.test(base)) return text;
    return text.split('\n').map((l) => (/<script/i.test(l) ? l : rewrite(l))).join('\n');
  }
  if (base === 'package.json') return rewritePackageJson(text);
  if (/\.json$/i.test(file)) {
    return (/(^|[\\/])(locale|locales|i18n|lang|docs)[\\/]/i.test(file) || /(^|\/)(en|zh|ru)\.json$/i.test(file)) ? rewriteJsonText(text) : text;
  }
  if (/\.(c|m)?js$/i.test(file)) return rewriteIdentifiers(rewriteScript(text));
  if (/\.(c|m)?tsx?$/i.test(file)) return rewriteIdentifiers(text); // sources and type files: addresses and environment names only
  return text;
}

// Addresses and environment names also sit outside string literals (in comments and as constant names):
// those rules run over the whole script text. Their patterns cannot match ordinary code.
export function rewriteIdentifiers(text) {
  if (!/deepseek|feishu|r2049|DSH_PLATFORM_ORIGIN/i.test(text)) return text;
  let out = text;
  for (const r of RULES) if (r.id.startsWith('host') || r.id.startsWith('env')) out = out.replace(r.re, r.to);
  return out;
}

// Only the address rules (used for the third-party provider catalog, where model and provider names stay)
export function rewriteHosts(text) {
  if (!/deepseek|feishu|r2049/i.test(text)) return text;
  let out = text;
  for (const r of RULES) if (r.id.startsWith('host')) out = out.replace(r.re, r.to);
  return out;
}
