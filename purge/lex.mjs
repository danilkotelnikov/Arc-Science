// Minimal JS/TS lexer: finds comments, strings, template literals and regex literals with exact positions.
// It does not build an AST. It is used only to locate text that may contain Chinese.

const KW_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'instanceof', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'of', 'extends']);
const isIdStart = (c) => /[A-Za-z_$\u0080-￿]/.test(c);
const isIdPart = (c) => /[A-Za-z0-9_$\u0080-￿]/.test(c);

export function lexJs(src) {
  const segs = []; // {type, start, end, ...}
  let i = 0;
  const n = src.length;
  // stack of template expression brace depths
  function lexRegion(stopAtBrace) {
    let depth = 0;
    let last = { t: 'start', v: '' }; // last significant token
    const regexAllowed = () => {
      if (last.t === 'start') return true;
      if (last.t === 'num' || last.t === 'str' || last.t === 'tpl' || last.t === 'regex') return false;
      if (last.t === 'name') return KW_BEFORE_REGEX.has(last.v);
      if (last.t === 'punct') return !(last.v === ')' || last.v === ']' || last.v === '}' && false);
      return true;
    };
    while (i < n) {
      const c = src[i];
      // whitespace
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ' ' || c === '﻿' || c === ' ' || c === ' ') { i++; continue; }
      // comments
      if (c === '/' && src[i + 1] === '/') {
        const s = i; while (i < n && src[i] !== '\n') i++;
        segs.push({ type: 'linecomment', start: s, end: i }); continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        const s = i; const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2;
        segs.push({ type: 'blockcomment', start: s, end: i }); continue;
      }
      if (c === '#' && i === 0 && src[1] === '!') { while (i < n && src[i] !== '\n') i++; continue; }
      // strings
      if (c === '"' || c === "'") {
        const s = i; i++;
        while (i < n && src[i] !== c) {
          if (src[i] === '\\') i += 2; else if (src[i] === '\n') break; else i++;
        }
        i++; // closing quote
        segs.push({ type: 'string', start: s, end: i, quote: c });
        last = { t: 'str', v: '' }; continue;
      }
      // template
      if (c === '`') {
        const s = i; i++;
        const quasis = []; const exprs = []; let qs = i;
        while (i < n && src[i] !== '`') {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '$' && src[i + 1] === '{') {
            quasis.push([qs, i]); i += 2;
            const es = i;
            lexRegion(true); // consumes up to and including the closing }
            exprs.push([es, i - 1]);
            qs = i; continue;
          }
          i++;
        }
        quasis.push([qs, i]);
        i++; // closing backtick
        segs.push({ type: 'template', start: s, end: i, quasis, exprs });
        last = { t: 'tpl', v: '' }; continue;
      }
      // numbers
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        i++; while (i < n && /[0-9A-Za-z_.]/.test(src[i])) { if ((src[i] === 'e' || src[i] === 'E') && (src[i + 1] === '+' || src[i + 1] === '-')) i++; i++; }
        last = { t: 'num', v: '' }; continue;
      }
      // identifiers
      if (isIdStart(c) || c === '\\') {
        const s = i; i++; while (i < n && isIdPart(src[i])) i++;
        last = { t: 'name', v: src.slice(s, i) }; continue;
      }
      // braces
      if (c === '{') { depth++; i++; last = { t: 'punct', v: '{' }; continue; }
      if (c === '}') {
        if (stopAtBrace && depth === 0) { i++; return; }
        depth--; i++; last = { t: 'punct', v: '}' }; continue;
      }
      // regex or division
      if (c === '/') {
        if (regexAllowed()) {
          const s = i; i++; let inClass = false;
          while (i < n) {
            const d = src[i];
            if (d === '\\') { i += 2; continue; }
            if (d === '\n') break;
            if (inClass) { if (d === ']') inClass = false; }
            else if (d === '[') inClass = true;
            else if (d === '/') break;
            i++;
          }
          i++; while (i < n && /[a-z]/i.test(src[i])) i++;
          segs.push({ type: 'regex', start: s, end: i });
          last = { t: 'regex', v: '' }; continue;
        }
        i++; last = { t: 'punct', v: '/' }; continue;
      }
      // other punctuation
      i++;
      last = { t: 'punct', v: c };
    }
  }
  lexRegion(false);
  return segs;
}
