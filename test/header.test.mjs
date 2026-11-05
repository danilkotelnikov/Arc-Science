// Check that docs/images/header.svg and docs/images/header-still.svg are safe
// and that README.md points to both.
//   node test/header.test.mjs

import { readFileSync } from 'node:fs';

let bad = 0;
const t = (label, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ' :: ' + detail}`); };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function read(path) {
  try {
    return readFileSync(new URL('../' + path, import.meta.url), 'utf-8');
  } catch (e) {
    return null;
  }
}

function noElement(content, tag) {
  // Match opening tags: <script ...>, <image ...>, <link ...>
  const re = new RegExp(`<${tag}[\\s>]`, 'gi');
  return !re.test(content);
}

function noURL(content) {
  // url(...) even with whitespace inside
  return !/url\s*\(/i.test(content);
}

function noAnimation(content) {
  // No @keyframes, no animation-* properties, no animation shorthand
  if (/@keyframes\s/i.test(content)) return false;
  if (/animation\s*:/i.test(content)) return false;
  if (/animation-name\s*:/i.test(content)) return false;
  if (/animation-duration\s*:/i.test(content)) return false;
  if (/animation-iteration-count\s*:/i.test(content)) return false;
  if (/animation-delay\s*:/i.test(content)) return false;
  if (/animation-direction\s*:/i.test(content)) return false;
  if (/animation-fill-mode\s*:/i.test(content)) return false;
  if (/animation-play-state\s*:/i.test(content)) return false;
  if (/animation-timing-function\s*:/i.test(content)) return false;
  return true;
}

function noInfiniteAnimation(content) {
  // animation-iteration-count: infinite
  if (/animation-iteration-count\s*:\s*infinite/i.test(content)) return false;
  // animation: ... infinite ...
  if (/animation\s*:\s*[^;{}]*\binfinite\b/i.test(content)) return false;
  return true;
}

function hasRef(content, path) {
  const quoted = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(quoted).test(content);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const headerSVG = read('docs/images/header.svg');
if (headerSVG === null) {
  t('header.svg exists', false, 'File not found');
} else {
  t('header.svg: no <script>',   noElement(headerSVG, 'script'),      'Found <script>');
  t('header.svg: no <image>',    noElement(headerSVG, 'image'),       'Found <image>');
  t('header.svg: no <link>',     noElement(headerSVG, 'link'),        'Found <link>');
  t('header.svg: no url()',      noURL(headerSVG),                    'Found url() reference');
  t('header.svg: no infinite animation', noInfiniteAnimation(headerSVG), 'Has infinite animation');
}

const stillSVG = read('docs/images/header-still.svg');
if (stillSVG === null) {
  t('header-still.svg exists', false, 'File not found');
} else {
  t('header-still.svg: no <script>',  noElement(stillSVG, 'script'),      'Found <script>');
  t('header-still.svg: no <image>',   noElement(stillSVG, 'image'),       'Found <image>');
  t('header-still.svg: no <link>',    noElement(stillSVG, 'link'),        'Found <link>');
  t('header-still.svg: no url()',     noURL(stillSVG),                    'Found url() reference');
  t('header-still.svg: no animation', noAnimation(stillSVG),              'Has animation');
}

const readme = read('README.md');
if (readme === null) {
  t('README.md exists', false, 'File not found');
} else {
  t('README.md references header.svg',       hasRef(readme, 'docs/images/header.svg'),       'Missing reference');
  t('README.md references header-still.svg', hasRef(readme, 'docs/images/header-still.svg'), 'Missing reference');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(bad ? 'FAILED' : 'ALL PASS');
process.exit(bad ? 1 : 0);
