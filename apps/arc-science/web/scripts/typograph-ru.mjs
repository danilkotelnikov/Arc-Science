// Russian typograph for UI strings: «ёлочки» with nested „лапки“, a no-break
// space after one- and two-letter words, after a number or {placeholder} that
// precedes a word, before the particles же/ли/бы and before an em dash. The text
// inside {placeholders} is never touched. Idempotent.
// CLI: node scripts/typograph-ru.mjs <file.js> checks a flat `export default`
// dictionary and exits 1 when any string would change. With --fix it rewrites every
// one-line 'key': 'value' entry of the file in place instead, writing U+00A0 as  .
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const NBSP = '\u00A0';
const PARTICLE = /(?<=\S) (же|ли|бы)(?![\p{L}\p{N}-])/giu;
const SHORT_WORD = /(?<![\p{L}\p{N}-])(?!(?:же|ли|бы)(?![\p{L}\p{N}-]))([а-яё]{1,2}) /giu;
// A standalone digit group ('71', '0,5', '1.5') or a masked {placeholder}, then a word.
const NUMBER = /((?<![\p{L}\p{N}])\d+(?:[.,]\d+)*|[-]) (?=\p{L})/gu;
const OPENS_AFTER = /[\s([{«„—-]/u;

function quotes(s) {
  let depth = 0, out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '«' || c === '„') depth++;
    else if (c === '»' || c === '“') depth = Math.max(0, depth - 1);
    if (c !== '"') { out += c; continue; }
    if (i === 0 || OPENS_AFTER.test(s[i - 1])) out += depth++ % 2 ? '„' : '«';
    else { depth = Math.max(0, depth - 1); out += depth % 2 ? '“' : '»'; }
  }
  return out;
}

export function typographRu(s) {
  if (typeof s !== 'string') return s;
  // Swap each {placeholder} for one private-use character so no rule sees inside it.
  const slots = [];
  const masked = s.replace(/\{[^{}]*\}/g, m => String.fromCharCode(0xE000 + slots.push(m) - 1));
  const out = quotes(masked)
    .replace(/ — /g, NBSP + '— ')
    .replace(PARTICLE, NBSP + '$1')
    .replace(SHORT_WORD, '$1' + NBSP)
    .replace(NUMBER, '$1' + NBSP);
  return out.replace(/[\uE000-\uF8FF]/g, c => slots[c.charCodeAt(0) - 0xE000] ?? c);
}

export default typographRu;

const visible = s => JSON.stringify(s).replace(/\u00A0/g, '\\u00A0');

// A single-quoted JS literal for a value, with the no-break space written as an escape.
const literal = s => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/ /g, '\\u00A0') + "'";
const ENTRY = /^(\s*'[^'\n]+'\s*:\s*)('(?:[^'\\\n]|\\.)*')(,?\s*(?:\/\/.*)?)$/gm;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fix = process.argv.includes('--fix');
  const file = process.argv.slice(2).find(arg => arg !== '--fix');
  if (!file) { console.error('Usage: node scripts/typograph-ru.mjs [--fix] <file.js>'); process.exit(2); }
  if (fix) {
    let changed = 0;
    const text = readFileSync(file, 'utf8').replace(ENTRY, (all, head, quoted, tail) => {
      const value = Function('"use strict"; return ' + quoted)();
      const fixed = typographRu(value);
      if (fixed === value) return all;
      changed++;
      return head + literal(fixed) + tail;
    });
    writeFileSync(file, text);
    console.log(`${file}: ${changed} strings fixed`);
    process.exit(0);
  }
  const dict = (await import(pathToFileURL(resolve(file)).href)).default ?? {};
  let violations = 0;
  for (const [key, value] of Object.entries(dict)) {
    const fixed = typographRu(value);
    if (fixed === value) continue;
    violations++;
    console.log(`${key}: ${visible(value)} -> ${visible(fixed)}`);
  }
  process.exit(violations ? 1 : 0);
}
