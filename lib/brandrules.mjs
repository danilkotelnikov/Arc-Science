// One rule set for the brand text: the build rewrites with it and the test checks with it.
// A string is "dirty" when rewrite() would change it. Real DeepSeek model names stay (Danil, 2026-11-01).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const allow = JSON.parse(fs.readFileSync(path.join(here, '..', 'test', 'ui-strings.allow.json'), 'utf8'));
const MODEL = allow.modelNames.map((s) => new RegExp(s, 'gi'));

// text before and after a word that makes it part of an identifier, path or address
const B = '(?<![\\w@./:\\\\-])';
const A = '(?![\\w@/\\\\-]|\\.\\w)';
// lowercase "dsh" is a product name in prose after a determiner or a preposition ("the dsh web client");
// after a command word or at a line start it is the command and stays ("pnpm dsh plugin", "dsh --profile web")
const DSH_BEFORE = '(?<=\\b(?:[Tt]he|[Aa]n?|[Tt]his|[Tt]hat|[Yy]our|[Ii]ts|[Ee]ach|[Aa]ny|[Ee]very|[Aa]ll|[Oo]ther|[Aa]nother|[Ss]ame|[Nn]ew|current|running|by|on|for|in|of|with|and|or|between|from|to|as)[ \\u00a0])';

// Addresses of DeepSeek services become an address that can never resolve (the .invalid top-level name, RFC 2606),
// so no code path can reach them. Model ids such as deepseek/deepseek-r1 are not addresses and stay.
export const DEAD_HOST = 'arc-harness.invalid';
export const RULES = [
  { id: 'host', re: /(?<![\w.-])(?:[a-z0-9-]+\.)*deepseek(?:svc)?\.(?:com|ai|cn|org|net|io)(?![\w-])/gi, to: DEAD_HOST },
  { id: 'host-repo', re: /(?<![\w@.-])github\.com\/deepseek-ai(?![\w-])/gi, to: 'github.invalid/arc-harness' },
  // the contact form of the old vendor and the relay of a third-party remote plugin (disabled in both profiles)
  { id: 'host-misc', re: /(?<![\w.-])(?:trtgsjkv6r\.feishu\.cn|(?:[a-z0-9-]+\.)*r2049\.cn)(?![\w-])/gi, to: DEAD_HOST },
  // names that set the address of a DeepSeek endpoint through the environment
  { id: 'env', re: /(?<![\w])DEEPSEEK_((?:[A-Z0-9]+_)*)BASE_URL(?![\w])/g, to: 'ARC_$1BASE_URL' },
  { id: 'env-platform', re: /(?<![\w])DSH_PLATFORM_ORIGIN(?![\w])/g, to: 'ARC_PLATFORM_ORIGIN' },
  { id: 'brand', re: /DeepSeek[  ]Harness/g, to: 'Arc Harness' },
  { id: 'deepseek', re: new RegExp(B + 'DeepSeek' + A, 'g'), to: 'Arc Harness' },
  { id: 'deepseek-lower', re: new RegExp(B + 'deepseek' + A + '(?=[ \\u00a0]+[a-z]+[ \\u00a0])', 'g'), to: 'Arc Harness' },
  { id: 'dsh', re: new RegExp(B + 'DSH' + A, 'g'), to: 'Arc Harness' },
  { id: 'dsh-prose', re: new RegExp(DSH_BEFORE + 'dsh(?![\\w@/\\\\:.-])', 'g'), to: 'Arc Harness' },
  { id: 'whale-example', re: /dsh-plugin-whale-pet/g, to: 'arc-plugin-example' },
  { id: 'whale', re: new RegExp(B + 'Whale' + A, 'g'), to: 'Arc Harness', exceptNear: /NAVER[ ]*$/ },
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
  for (const r of RULES) {
    if (!r.exceptNear) { out = out.replace(r.re, r.to); continue; }
    out = out.replace(r.re, (m, ...rest) => {
      const off = rest[rest.length - 2];
      if (typeof off === 'number' && r.exceptNear.test(out.slice(Math.max(0, off - 12), off))) return m;
      return r.to;
    });
  }
  return unmask(out, kept);
}

// the rule that would fire first, or null
export function classify(s) {
  if (!/deepseek|dsh|whale|feishu|r2049/i.test(s)) return null;
  const { t } = mask(s);
  for (const r of RULES) {
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
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
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
        if (depth > 0 && ch === '}') { depth--; j++; if (depth === 0) segStart = j; continue; }
        j++;
      }
      if (depth === 0) yield { start: segStart, end: j };
      i = j + 1; prev = c; continue;
    }
    if (c === '/' && /[(,=:[!&|?{};]/.test(prev)) {
      let j = i + 1; let cls = false;
      while (j < n && src[j] !== '\n') { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j++; }
      i = j + 1; prev = '/'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
}

export function rewriteScript(src) {
  if (!/deepseek|dsh|whale|feishu|r2049/i.test(src)) return src;
  let out = '';
  let last = 0;
  for (const { start, end } of literalRanges(src)) {
    const raw = src.slice(start, end);
    if (!/deepseek|dsh|whale|feishu|r2049/i.test(raw)) continue;
    const next = rewrite(raw);
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
  const j = JSON.parse(raw);
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
export function rewriteFile(file, text) {
  const base = file.split(/[\\/]/).pop().toLowerCase();
  if (/\.(md|markdown)$/i.test(file)) return /^(license|licence|changelog|notice|third)/i.test(base) ? text : rewriteMarkdown(text);
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
