// Extracts translatable units (comments, strings, templates, md blocks, script lines) with exact positions, and renders translations back.
import { lexJs } from './lex.mjs';
import { CJK_RE } from './gemini.mjs';

const has = (s) => CJK_RE.test(s);
export const extOf = (rel) => { const m = /\.([A-Za-z0-9]+)$/.exec(rel); return m ? m[1].toLowerCase() : ''; };

// ---------- helpers ----------
function lineStartOf(text, pos) { return text.lastIndexOf('\n', pos - 1) + 1; }
function standalone(text, seg) { const ls = lineStartOf(text, seg.start); return /^[ \t]*$/.test(text.slice(ls, seg.start)); }
function indentOf(text, pos) { const ls = lineStartOf(text, pos); const m = /^[ \t]*/.exec(text.slice(ls, pos)); return m ? m[0] : ''; }

export function ctxClass(src, s) {
  if (s.type === 'regex') return 'regex';
  const before = src.slice(Math.max(0, s.start - 40), s.start);
  const after = src.slice(s.end, s.end + 20);
  if (/\.(includes|indexOf|lastIndexOf|startsWith|endsWith|test|match|matchAll|search|split|replace|replaceAll|localeCompare|has|get|add|delete|exec)\(\s*$/.test(before)) return 'call';
  if (/(===?|!==?)\s*$/.test(before) || /^\s*(===?|!==?)/.test(after)) return 'compare';
  if (/\bcase\s*$/.test(before)) return 'case';
  if (/\[\s*$/.test(before) && /^\s*\]/.test(after)) return 'index';
  if (/^\s*,\s*['"`]/.test(after) && /\[\s*$/.test(before)) return 'pairkey';
  if (/RegExp\(\s*$/.test(before)) return 'regexsrc';
  if (/^\s*:(?!:)/.test(after) && /[{,]\s*$/.test(before)) return 'key';
  return 'text';
}

// ---------- JS family ----------
const CODE_LIKE = /\bfunction\b|=>|\bvar\s+\w|\bconst\s+\w|\blet\s+\w|\breturn\b/;
const CODE_LIKE_STR = /\bfunction\b|=>|\bh\(|\btx\(|\bvar\s+\w|\bconst\s+\w|\breturn\b/;
const REGEXISH = /\(\?[:=!<]|\\[sdwSDW]\b|\[\^/;

function collectJs(text, src, segs, offset, units, rel, nested = false) {
  // group line comments
  let k = 0;
  while (k < segs.length) {
    const s = segs[k];
    if (s.type === 'linecomment') {
      let grp = [s]; let j = k + 1;
      if (standalone(src, s)) {
        while (j < segs.length && segs[j].type === 'linecomment' && standalone(src, segs[j]) && /^[ \t]*\r?\n[ \t]*$/.test(src.slice(grp[grp.length - 1].end, segs[j].start))) { grp.push(segs[j]); j++; }
      }
      const a = grp[0].start + offset, b = grp[grp.length - 1].end + offset;
      const raw = text.slice(a, b);
      if (has(raw)) {
        const indent = indentOf(text, a);
        const lines = grp.map((g) => text.slice(g.start + offset, g.end + offset).replace(/\r$/, ''));
        const keyLines = lines.map((l) => l.replace(/^\/\/+[ \t]?/, ''));
        units.push({ type: 'cmt', style: 'line', start: a, end: b, kind: 'comment', key: keyLines.join('\n'), indent, ctx: 'text', crlf: raw.includes('\r\n') });
      }
      k = j; continue;
    }
    if (s.type === 'blockcomment') {
      const a = s.start + offset, b = s.end + offset; const raw = text.slice(a, b);
      if (has(raw)) {
        const open = /^\/\*+!?/.exec(raw)[0];
        const inner = raw.slice(open.length, raw.length - 2);
        const rawLines = inner.split('\n').map((l) => l.replace(/\r$/, ''));
        const multi = rawLines.length > 1;
        const keyLines = multi ? rawLines.map((l, i) => (i === 0 ? l.trim() : l.replace(/^[ \t]*\*?[ \t]?/, '').replace(/[ \t]+$/, ''))) : [inner.trim()];
        // the last line of a multi-line comment is usually only whitespace before */
        units.push({ type: 'cmt', style: 'block', open, start: a, end: b, kind: 'comment', key: keyLines.join('\n'), indent: indentOf(text, a), multi, ctx: 'text', crlf: raw.includes('\r\n') });
      }
      k++; continue;
    }
    if (s.type === 'string') {
      const a = s.start + offset, b = s.end + offset; const raw = text.slice(a, b);
      if (has(raw)) {
        const ctx = ctxClass(src, s);
        const inner = raw.slice(1, -1);
        if (CODE_LIKE_STR.test(inner) && /['"]/.test(inner) && !inner.includes('\\')) {
          // a string that holds a piece of code: translate the Chinese string literals inside it one by one (keeps anchors in step with the code they patch)
          collectJs(text, inner, lexJs(inner), a + 1, units, rel, true);
        } else units.push({ type: 'str', start: a, end: b, quote: s.quote, kind: 'string', key: inner, ctx, nested });
      }
      k++; continue;
    }
    if (s.type === 'regex') {
      const a = s.start + offset, b = s.end + offset; const raw = text.slice(a, b);
      if (has(raw)) units.push({ type: 'regex', start: a, end: b, kind: 'regex', key: raw, ctx: 'regex' });
      k++; continue;
    }
    if (s.type === 'template') {
      const a = s.start + offset, b = s.end + offset; const raw = text.slice(a, b);
      if (has(raw)) {
        // body without expressions
        const qs0 = s.quasis[0][0], qe = s.quasis[s.quasis.length - 1][1];
        let body = ''; let pos = qs0;
        s.exprs.forEach(([es, ee], i) => { body += src.slice(pos, s.quasis[i][1]); body += ' '.repeat(ee + 1 - s.quasis[i][1]); pos = ee + 1; });
        body += src.slice(pos, qe);
        const before = src.slice(Math.max(0, s.start - 14), s.start);
        const tagged = /String\.raw\s*$/.test(before);
        const bodyHasCjk = has(body);
        if (CODE_LIKE.test(body) && bodyHasCjk) {
          // embedded program: lex the body and collect nested strings/comments
          const segs2 = lexJs(body);
          collectJs(text, body, segs2, offset + qs0, units, rel, true);
          // expressions inside the template are already found by the outer lexer (segs list), nothing else to do
        } else if (bodyHasCjk) {
          const ctxT = (/RegExp\(\s*$/.test(src.slice(Math.max(0, s.start - 20), s.start)) || (tagged && REGEXISH.test(body)) || REGEXISH.test(body)) ? 'regexsrc' : 'text';
          let key = ''; const exprSrc = [];
          s.quasis.forEach(([qa, qb], i) => { key += src.slice(qa, qb); if (i < s.exprs.length) { exprSrc.push([s.exprs[i][0] + offset, s.exprs[i][1] + offset]); key += '${E' + (i + 1) + '}'; } });
          units.push({ type: 'tpl', start: a, end: b, kind: 'template', key, exprs: exprSrc, qs: s.quasis.map(([x, y]) => [x + offset, y + offset]), ctx: ctxT, children: [] });
        }
        // else: CJK only inside expressions -> nested segments are separate units
      }
      k++; continue;
    }
    k++;
  }
}

export function extractJs(text, rel) {
  const units = [];
  const segs = lexJs(text);
  collectJs(text, text, segs, 0, units, rel);
  // nesting: units fully inside an expression of a tpl unit become its children
  const tpls = units.filter((u) => u.type === 'tpl');
  const roots = [];
  for (const u of units) {
    let parent = null;
    for (const t of tpls) { if (t !== u && u.start >= t.start && u.end <= t.end && t.exprs.some(([x, y]) => u.start >= x && u.end <= y)) { if (!parent || (t.end - t.start) < (parent.end - parent.start)) parent = t; } }
    if (parent) { parent.children.push(u); u.parent = parent; } else roots.push(u);
  }
  // dedupe identical ranges (embedded + outer detection)
  const seen = new Set(); const out = [];
  for (const u of roots) { const id = u.start + ':' + u.end; if (seen.has(id)) continue; seen.add(id); out.push(u); }
  return { units: out, all: units };
}

// ---------- markdown / text ----------
const MD_SWITCHER = /^\s*(English\s*[|·]\s*)?\[[^\]]*\]\([^)]*(zh-CN|\.zh\.|\.zh\)|_ZH|README\.ru|README-zh|README-es|README-hi|README-pt)[^)]*\)\s*$/;
export function extractMd(text) {
  const units = []; const removals = [];
  const lines = text.split('\n'); let off = 0; let i = 0; const n = lines.length;
  const offs = []; for (const l of lines) { offs.push(off); off += l.length + 1; }
  // language switcher lines
  for (let li = 0; li < n; li++) if (MD_SWITCHER.test(lines[li]) && has(lines[li])) {
    let end = offs[li] + lines[li].length + 1;
    if (li + 1 < n && lines[li + 1].trim() === '' && (li === 0 || lines[li - 1].trim() === '')) end += lines[li + 1].length + 1;
    removals.push({ type: 'delline', start: offs[li], end: Math.min(end, text.length) });
  }
  const delSet = new Set(removals.map((r) => r.start));
  while (i < n) {
    if (lines[i].trim() === '' || delSet.has(offs[i])) { i++; continue; }
    let j = i; let chars = 0;
    while (j < n && lines[j].trim() !== '' && !delSet.has(offs[j]) && chars < 3500) { chars += lines[j].length + 1; j++; }
    const a = offs[i], b = offs[j - 1] + lines[j - 1].length - (lines[j - 1].endsWith('\r') ? 1 : 0);
    const blockText = text.slice(a, b);
    if (has(blockText)) units.push({ type: 'md', start: a, end: b, kind: 'md', key: blockText.replace(/\r\n/g, '\n').replace(/\r$/, ''), crlf: blockText.includes('\r\n'), ctx: 'text' });
    i = j;
  }
  return { units, removals };
}

// ---------- scripts (sh, ps1, py, yml) ----------
export function lexScript(text, lang) {
  const segs = []; let i = 0; const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '#' && !(i === 0 && text[1] === '!')) {
      const prev = text[i - 1];
      if (lang === 'py' || i === 0 || /[\s;|&(]/.test(prev)) { const s = i; while (i < n && text[i] !== '\n') i++; segs.push({ type: 'linecomment', start: s, end: i }); continue; }
    }
    if (lang === 'py' && (text.startsWith('"""', i) || text.startsWith("'''", i))) {
      const q = text.substr(i, 3); let j = i + 3; while (j < n && !text.startsWith(q, j)) { if (text[j] === '\\') j++; j++; }
      segs.push({ type: 'string', start: i, end: Math.min(n, j + 3), quote: q }); i = j + 3; continue;
    }
    if (c === '"' || c === "'") {
      const s = i; i++;
      if (lang === 'sh' && c === "'") { while (i < n && text[i] !== "'") i++; }
      else if (lang === 'ps1' && c === "'") { while (i < n) { if (text[i] === "'") { if (text[i + 1] === "'") { i += 2; continue; } break; } i++; } }
      else { while (i < n && text[i] !== c) { if (text[i] === '\\' && lang !== 'ps1') i += 2; else if (text[i] === '`' && lang === 'ps1') i += 2; else if (lang === 'py' && text[i] === '\n') break; else i++; } }
      i++;
      segs.push({ type: 'string', start: s, end: i, quote: c }); continue;
    }
    i++;
  }
  return segs;
}

export function extractScript(text, lang) {
  const segs = lexScript(text, lang); const units = [];
  const covered = []; // ranges handled
  let k = 0;
  while (k < segs.length) {
    const s = segs[k];
    if (s.type === 'linecomment') {
      let grp = [s]; let j = k + 1;
      if (standalone(text, s)) while (j < segs.length && segs[j].type === 'linecomment' && standalone(text, segs[j]) && /^[ \t]*\r?\n[ \t]*$/.test(text.slice(grp[grp.length - 1].end, segs[j].start))) { grp.push(segs[j]); j++; }
      const a = grp[0].start, b = grp[grp.length - 1].end; const raw = text.slice(a, b);
      covered.push([a, b]);
      if (has(raw)) {
        const lines = grp.map((g) => text.slice(g.start, g.end).replace(/\r$/, ''));
        units.push({ type: 'cmt', style: 'hash', start: a, end: b, kind: 'comment', key: lines.map((l) => l.replace(/^#+[ \t]?/, '')).join('\n'), indent: indentOf(text, a), ctx: 'text', crlf: raw.includes('\r\n') });
      }
      k = j; continue;
    }
    if (s.type === 'string') {
      const a = s.start, b = s.end; const raw = text.slice(a, b); covered.push([a, b]);
      if (has(raw)) { const ql = s.quote.length; units.push({ type: 'str', start: a, end: b, quote: s.quote, qlen: ql, kind: 'string', key: raw.slice(ql, raw.length - ql), ctx: 'text', lang }); }
    }
    k++;
  }
  // bare CJK outside strings/comments: whole-line units
  const lines = text.split('\n'); let off = 0;
  for (const l of lines) {
    const a = off, b = off + l.length; off += l.length + 1;
    if (!has(l)) continue;
    const m = /[　-〿㐀-鿿＀-￯]/.exec(l);
    const pos = a + m.index;
    if (covered.some(([x, y]) => pos >= x && pos < y)) continue;
    units.push({ type: 'line', start: a, end: b, kind: 'line', key: l.replace(/\r$/, ''), ctx: 'text', crlf: l.endsWith('\r') });
  }
  units.sort((x, y) => x.start - y.start);
  return { units };
}

// ---------- CSS ----------
export function extractCss(text) {
  const units = []; const re = /\/\*[\s\S]*?\*\//g; let m;
  while ((m = re.exec(text))) {
    if (!has(m[0])) continue;
    const raw = m[0]; const inner = raw.slice(2, -2); const lines = inner.split('\n');
    const keyLines = lines.map((l, i) => (i === 0 ? l.trim() : l.replace(/^[ \t]*\*?[ \t]?/, '').replace(/[ \t]+$/, '')));
    units.push({ type: 'cmt', style: 'block', open: '/*', start: m.index, end: m.index + raw.length, kind: 'comment', key: keyLines.join('\n'), indent: indentOf(text, m.index), multi: lines.length > 1, ctx: 'text', crlf: false, css: true });
  }
  // CJK outside comments (font names etc.)
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length));
  const re2 = /[^\n]*[　-〿㐀-鿿＀-￯][^\n]*/g;
  while ((m = re2.exec(stripped))) units.push({ type: 'line', start: m.index, end: m.index + m[0].length, kind: 'line', key: m[0], ctx: 'text', crlf: false });
  return { units };
}

// ---------- XML / HTML / SVG text nodes and attribute values ----------
export function extractXml(text) {
  const units = []; let m;
  const reText = />([^<>]*[　-〿㐀-鿿＀-￯][^<>]*)</g;
  while ((m = reText.exec(text))) units.push({ type: 'xml', start: m.index + 1, end: m.index + 1 + m[1].length, kind: 'text', key: m[1], ctx: 'text', crlf: false });
  const reAttr = /(\s[\w:-]+=)"([^"]*[　-〿㐀-鿿＀-￯][^"]*)"/g;
  while ((m = reAttr.exec(text))) units.push({ type: 'xml', start: m.index + m[1].length + 1, end: m.index + m[1].length + 1 + m[2].length, kind: 'string', key: m[2], ctx: 'text', crlf: false, quote: '"' });
  units.sort((x, y) => x.start - y.start);
  return { units };
}

// ---------- dispatcher ----------
export function extractAny(rel, text) {
  const e = extOf(rel);
  if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'].includes(e)) return extractJs(text, rel);
  if (e === 'md' || e === 'txt') return extractMd(text);
  if (e === 'sh') return extractScript(text, 'sh');
  if (e === 'yml' || e === 'yaml') return extractScript(text, 'sh');
  if (e === 'ps1') return extractScript(text, 'ps1');
  if (e === 'py') return extractScript(text, 'py');
  if (e === 'css') return extractCss(text);
  if (e === 'svg' || e === 'html' || e === 'htm' || e === 'xml') return extractXml(text);
  return { units: [], unsupported: true };
}

// ---------- rendering ----------
function escQuote(out, q) {
  // escape unescaped occurrences of q (single character quotes only)
  if (q.length !== 1) return out;
  let r = ''; for (let i = 0; i < out.length; i++) { const c = out[i]; if (c === '\\') { r += c + (out[i + 1] ?? ''); i++; } else if (c === q) r += '\\' + c; else r += c; }
  return r;
}

export function renderUnit(text, u, tr) {
  const nl = u.crlf ? '\r\n' : '\n';
  switch (u.type) {
    case 'str': {
      const ql = u.qlen || 1;
      let out = tr;
      if (u.nested) { // quotes the source did not contain would end the inner string of the embedded code
        if (!u.key.includes("'")) out = out.replace(/'/g, '’');
        if (!u.key.includes('"')) out = out.replace(/"/g, '”');
      }
      out = escQuote(out, u.quote.length === 1 ? u.quote : '');
      if (u.lang === 'sh' && u.quote === '"') out = out.replace(/(?<!\\)`/g, '\\`');
      return u.quote + out + u.quote;
    }
    case 'xml': return tr;
    case 'delline': return '';
    case 'md': return tr.split('\n').join(nl);
    case 'line': return tr.split('\n').join(nl);
    case 'tpl': {
      let out = tr.replace(/(?<!\\)`/g, '\\`');
      out = out.replace(/\$\{E(\d+)\}/g, (_, d) => {
        const i = Number(d) - 1; const [x, y] = u.exprs[i];
        return '${' + renderRange(text, x, y, u.children.filter((c) => c.start >= x && c.end <= y)) + '}';
      });
      let r = ''; r = '`' + out + '`';
      return r;
    }
    case 'cmt': {
      const lines = tr.split('\n');
      if (u.style === 'line') return lines.map((l, i) => (i === 0 ? '' : u.indent) + (l === '' ? '//' : '// ' + l)).join(nl);
      if (u.style === 'hash') return lines.map((l, i) => (i === 0 ? '' : u.indent) + (l === '' ? '#' : '# ' + l)).join(nl);
      // block
      const safe = lines.map((l) => l.replace(/\*\//g, '* /'));
      if (!u.multi || safe.length === 1) return u.open + ' ' + safe.join(' ').trim() + ' */';
      const first = safe[0]; const last = safe[safe.length - 1];
      let r = u.open + (first ? ' ' + first : '');
      for (let i = 1; i < safe.length - 1; i++) r += nl + u.indent + ' *' + (safe[i] ? ' ' + safe[i] : '');
      r += nl + u.indent + ' *' + (last ? ' ' + last + ' */' : '/');
      return r;
    }
    default: throw new Error('cannot render ' + u.type);
  }
}

export function renderRange(text, a, b, units) {
  // units: edits (each with .tr and .start/.end) within [a,b]
  const list = units.filter((u) => u.tr !== undefined).sort((x, y) => x.start - y.start);
  let out = ''; let pos = a;
  for (const u of list) { if (u.start < pos) continue; out += text.slice(pos, u.start) + renderUnit(text, u, u.tr); pos = u.end; }
  return out + text.slice(pos, b);
}
