#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCAN_DIRS = ['lib', 'plugins', 'scripts', 'tools'];
const R012_EXEMPT = new Set(['tools/build.mjs', 'tools/install.mjs']);
const SPAWN_APIS = new Set(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']);
const CALL_RE = /\b([A-Za-z_$][\w$]*)\s*\(/g;

const REGEX_PREFIX_CHARS = new Set(['\0', '(', '[', '{', ',', ';', ':', '!', '?', '&', '|', '=', '+', '-', '*', '/', '%', '^', '~', '<', '>']);
const REGEX_PREFIX_WORDS = new Set(['return', 'case', 'throw', 'in', 'of', 'typeof', 'void', 'delete', 'yield', 'await', 'new', 'else', 'do']);

function stripCommentsAndStrings(src, keepStrings = false) {
  const out = src.split('');
  const n = src.length;
  const blank = (i) => { if (src[i] !== '\n' && src[i] !== '\r') out[i] = ' '; };
  const blankLit = (i) => { if (!keepStrings) blank(i); };
  let mode = 'code';
  let q = '';
  let inClass = false;
  let prevNonSpace = '\0';
  let prevWord = '';
  const tplStack = [];
  for (let i = 0; i < n; i++) {
    const ch = src[i];
    const nx = src[i + 1];
    if (mode === 'line') {
      blank(i);
      if (ch === '\n') mode = 'code';
    } else if (mode === 'block') {
      blank(i);
      if (ch === '*' && nx === '/') { blank(i + 1); i += 1; mode = 'code'; }
    } else if (mode === 'str') {
      blankLit(i);
      if (ch === '\\') { if (i + 1 < n) { blankLit(i + 1); i += 1; } }
      else if (ch === q) { mode = 'code'; prevNonSpace = q; prevWord = ''; }
    } else if (mode === 'regex') {
      blankLit(i);
      if (ch === '\n' || ch === '\r') { mode = 'code'; inClass = false; prevNonSpace = '/'; prevWord = ''; }
      else if (ch === '\\') { if (i + 1 < n && src[i + 1] !== '\n' && src[i + 1] !== '\r') { blankLit(i + 1); i += 1; } }
      else if (ch === '[' && !inClass) inClass = true;
      else if (ch === ']' && inClass) inClass = false;
      else if (ch === '/' && !inClass) { mode = 'code'; prevNonSpace = ')'; prevWord = ''; }
    } else if (mode === 'tpl') {
      blankLit(i);
      if (ch === '\\') { if (i + 1 < n) { blankLit(i + 1); i += 1; } }
      else if (ch === '$' && nx === '{') { blankLit(i + 1); i += 1; tplStack.push(1); mode = 'code'; prevNonSpace = '{'; prevWord = ''; }
      else if (ch === '`') { mode = 'code'; prevNonSpace = '`'; prevWord = ''; }
    } else if (ch === '/' && nx === '/') {
      blank(i); blank(i + 1); i += 1; mode = 'line';
    } else if (ch === '/' && nx === '*') {
      blank(i); blank(i + 1); i += 1; mode = 'block';
    } else if (ch === '/' && (REGEX_PREFIX_CHARS.has(prevNonSpace) || REGEX_PREFIX_WORDS.has(prevWord))) {
      blankLit(i); inClass = false; mode = 'regex';
    } else if (ch === '\'' || ch === '"') {
      blankLit(i); q = ch; mode = 'str';
    } else if (ch === '`') {
      blankLit(i); mode = 'tpl';
    } else {
      if (tplStack.length > 0 && ch === '{') {
        tplStack[tplStack.length - 1] += 1;
      } else if (tplStack.length > 0 && ch === '}') {
        tplStack[tplStack.length - 1] -= 1;
        if (tplStack[tplStack.length - 1] === 0) { tplStack.pop(); blankLit(i); mode = 'tpl'; continue; }
      }
      if (!/\s/.test(ch)) {
        prevWord = /[A-Za-z0-9_$]/.test(ch) ? (/[A-Za-z0-9_$]/.test(src[i - 1] || '') ? prevWord + ch : ch) : '';
        prevNonSpace = ch;
      }
    }
  }
  return out.join('');
}

function findChildProcessBindings(src) {
  const namespaces = new Set();
  const localFns = new Set();
  const addNamedList = (body, sep) => {
    const sepRe = sep === ':' ? '\\s*:\\s*' : `\\s+${sep}\\s+`;
    for (const part of body.split(',')) {
      const m = new RegExp(`^\\s*(?:([A-Za-z_$][\\w$]*)|['"]([A-Za-z_$][\\w$]*)['"])(?:${sepRe}([A-Za-z_$][\\w$]*))?\\s*$`).exec(part);
      const api = m && (m[1] || m[2]);
      if (api && SPAWN_APIS.has(api)) localFns.add(m[3] || api);
    }
  };
  let m;
  const esNamed = /\bimport\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([^}]*)\}\s+from\s+['"](?:node:)?child_process['"]/g;
  while ((m = esNamed.exec(src)) !== null) {
    if (m[1]) namespaces.add(m[1]);
    addNamedList(m[2], 'as');
  }
  const cjsDestruct = /(?:const|let|var)\s+\{([^}]*)\}\s*=\s*require\s*\(\s*['"](?:node:)?child_process['"]\s*\)/g;
  while ((m = cjsDestruct.exec(src)) !== null) addNamedList(m[1], ':');
  const nsPatterns = [
    /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+['"](?:node:)?child_process['"]/g,
    /\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"](?:node:)?child_process['"]/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"](?:node:)?child_process['"]\s*\)/g,
  ];
  for (const re of nsPatterns) {
    while ((m = re.exec(src)) !== null) namespaces.add(m[1]);
  }
  return { namespaces, localFns };
}

function walkJsFiles(rootDir, relDir, out) {
  const absDir = path.join(rootDir, relDir);
  if (!fs.existsSync(absDir)) return;
  for (const ent of fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'build' || ent.name === 'target') continue;
    const rel = `${relDir}/${ent.name}`.replaceAll('\\', '/');
    if (ent.isDirectory()) {
      walkJsFiles(rootDir, rel, out);
    } else if (ent.isFile() && /\.(mjs|js|cjs)$/.test(ent.name) && rel !== 'tools/check-spawns.mjs') {
      out.push(rel);
    }
  }
}

function findCallEnd(src, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < src.length; i++) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')' && --depth <= 0) return i;
  }
  return -1;
}

function splitTop(s, from, to) {
  const out = [];
  let p = 0, b = 0, k = 0, start = from;
  for (let i = from; i < to; i++) {
    const c = s[i];
    if (c === '(') p++; else if (c === ')') p--;
    else if (c === '{') b++; else if (c === '}') b--;
    else if (c === '[') k++; else if (c === ']') k--;
    else if (c === ',' && p === 0 && b === 0 && k === 0) { out.push([start, i]); start = i + 1; }
  }
  out.push([start, to]);
  return out;
}

function topColon(s, from, to) {
  let p = 0, b = 0, k = 0;
  for (let i = from; i < to; i++) {
    const c = s[i];
    if (c === '(') p++; else if (c === ')') p--;
    else if (c === '{') b++; else if (c === '}') b--;
    else if (c === '[') k++; else if (c === ']') k--;
    else if (c === ':' && p === 0 && b === 0 && k === 0) return i;
  }
  return -1;
}

function hasEffectiveWindowsHide(fnName, codeOnly, codeWithStrings, openIdx) {
  const closeIdx = findCallEnd(codeOnly, openIdx);
  if (closeIdx < 0) return false;
  const args = splitTop(codeOnly, openIdx + 1, closeIdx);
  if (args.length < 2) return false;
  const optRange = (fnName === 'exec' || fnName === 'execSync') ? args[1]
    : (codeOnly.slice(args[1][0], args[1][1]).trim().startsWith('{') ? args[1] : args[2]);
  if (!optRange) return false;
  const optTrim = codeOnly.slice(optRange[0], optRange[1]).trim();
  if (!optTrim.startsWith('{') || !optTrim.endsWith('}')) return false;
  const bStart = codeOnly.indexOf('{', optRange[0]);
  const bEnd = codeOnly.lastIndexOf('}', optRange[1] - 1);
  let effective = false;
  for (const [ps, pe] of splitTop(codeOnly, bStart + 1, bEnd)) {
    const clean = codeOnly.slice(ps, pe).trim();
    if (!clean) continue;
    if (clean.startsWith('...') || clean.startsWith('[')) { effective = false; continue; }
    const colon = topColon(codeOnly, ps, pe);
    if (colon < 0) {
      if (/\bwindowsHide\b/.test(codeWithStrings.slice(ps, pe))) effective = false;
      continue;
    }
    const key = codeWithStrings.slice(ps, colon).trim();
    if (key === 'windowsHide' || key === "'windowsHide'" || key === '"windowsHide"') {
      effective = codeOnly.slice(colon + 1, pe).trim() === 'true';
    }
  }
  return effective;
}

/** Check all JS child_process spawn sites (with explicit R012 exemptions) and Go CREATE_NO_WINDOW (G6.4/G6.6). */
export function auditWindowlessSpawns(rootDir) {
  const files = [];
  for (const d of SCAN_DIRS) walkJsFiles(rootDir, d, files);

  const violations = [];
  const exempt = [];
  let checkedCalls = 0;

  for (const rel of files) {
    const src = fs.readFileSync(path.join(rootDir, rel), 'utf8');
    if (!src.includes('child_process')) continue;
    const codeOnly = stripCommentsAndStrings(src);
    const codeWithStrings = stripCommentsAndStrings(src, true);
    const { namespaces, localFns } = findChildProcessBindings(codeWithStrings);
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(codeOnly)) !== null) {
      const fnName = m[1];
      const before = codeOnly.slice(Math.max(0, m.index - 64), m.index);
      const beforeRaw = codeWithStrings.slice(Math.max(0, m.index - 64), m.index);
      if (/\bfunction\s+$/.test(before)) continue;
      const memberMatch = /([A-Za-z_$][\w$]*)\.\s*$/.exec(before);
      const inlineRequire = /\brequire\s*\(\s*['"](?:node:)?child_process['"]\s*\)\.\s*$/.test(beforeRaw);
      if (memberMatch) {
        if (!SPAWN_APIS.has(fnName) || !namespaces.has(memberMatch[1])) continue;
      } else if (inlineRequire) {
        if (!SPAWN_APIS.has(fnName)) continue;
      } else if (/\.\s*$/.test(before) || !localFns.has(fnName)) {
        continue;
      }
      checkedCalls += 1;
      const openIdx = codeOnly.indexOf('(', m.index);
      const line = src.slice(0, m.index).split(/\r?\n/).length;
      if (R012_EXEMPT.has(rel)) {
        exempt.push({ file: rel, line, call: fnName, status: 'exempt_r012' });
        continue;
      }
      if (!hasEffectiveWindowsHide(fnName, codeOnly, codeWithStrings, openIdx)) {
        violations.push({ file: rel, line, call: fnName });
      }
    }
  }

  const hideGoPath = path.join(rootDir, 'native', 'arc-gateway', 'hide_windows.go');
  const goCode = fs.existsSync(hideGoPath) ? stripCommentsAndStrings(fs.readFileSync(hideGoPath, 'utf8')) : '';
  const goHasHide = /SysProcAttr\s*\{[\s\S]*\bCreationFlags\s*:\s*(?:0x0*8000000\b|[\w.]*CREATE_NO_WINDOW\b)/.test(goCode);
  if (!goHasHide) {
    return {
      ok: false,
      state: 'fail_missing_create_no_window',
      checkedCalls,
      exempt,
      violations,
      goHasHide,
    };
  }
  if (violations.length > 0) {
    return {
      ok: false,
      state: 'fail_unhidden_spawn',
      checkedCalls,
      exempt,
      violations,
      goHasHide,
    };
  }
  return {
    ok: true,
    state: 'pass',
    checkedCalls,
    exempt,
    violations: [],
    goHasHide,
  };
}

function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-spawn-test-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'native', 'arc-gateway'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'scripts', 'good.mjs'),
      "import { /* c */ spawnSync } from 'node:child_process';\nspawnSync('node', ['-v'], { ...{}, encoding: 'utf8', 'windowsHide': true });\n",
    );
    fs.writeFileSync(
      path.join(tmp, 'scripts', 'good-ns.mjs'),
      "import * as cp from 'node:child_process';\nconst reMatch = /a/.exec('a');\ncp.spawn('node', ['-v'], { encoding: 'utf8', windowsHide: true });\n",
    );
    fs.writeFileSync(
      path.join(tmp, 'native', 'arc-gateway', 'hide_windows.go'),
      'package main\nfunc hide(c *Cmd) { c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} }\n',
    );
    const passRes = auditWindowlessSpawns(tmp);
    assert.equal(passRes.state, 'pass');
    assert.equal(passRes.checkedCalls, 2);

    fs.writeFileSync(
      path.join(tmp, 'scripts', 'bad-alias.mjs'),
      "import { spawnSync as launch } from 'node:child_process';\nlaunch('node', ['-v'], { encoding: 'utf8' }); // windowsHide: true\n",
    );
    const failAlias = auditWindowlessSpawns(tmp);
    assert.equal(failAlias.state, 'fail_unhidden_spawn');
    assert.equal(failAlias.violations[0].file, 'scripts/bad-alias.mjs');
    fs.rmSync(path.join(tmp, 'scripts', 'bad-alias.mjs'));

    fs.writeFileSync(
      path.join(tmp, 'scripts', 'bad-ns.mjs'),
      "import cp from 'node:child_process';\ncp.spawn('node', ['-v'], { encoding: 'utf8', note: 'windowsHide: true' });\n",
    );
    const failNs = auditWindowlessSpawns(tmp);
    assert.equal(failNs.state, 'fail_unhidden_spawn');
    assert.equal(failNs.violations[0].file, 'scripts/bad-ns.mjs');
    fs.rmSync(path.join(tmp, 'scripts', 'bad-ns.mjs'));

    fs.writeFileSync(
      path.join(tmp, 'scripts', 'bad-tpl-unicode.mjs'),
      "import { execSync } from 'node:child_process';\nconst tag = '\u{1F680}';\nconst msg = `v: ${execSync('node -v', { encoding: 'utf8' })}`;\n",
    );
    const failTpl = auditWindowlessSpawns(tmp);
    assert.equal(failTpl.state, 'fail_unhidden_spawn');
    assert.equal(failTpl.violations[0].file, 'scripts/bad-tpl-unicode.mjs');
    fs.rmSync(path.join(tmp, 'scripts', 'bad-tpl-unicode.mjs'));

    fs.writeFileSync(
      path.join(tmp, 'scripts', 'bad-regex-env.cjs'),
      "const { spawn: launch } = require('node:child_process');\nconst re = /don't/;\nlaunch('node', ['-v'], { env: { windowsHide: true } });\nlaunch('node', ['-v'], { windowsHide: true, ...{} });\nlaunch('node', ['-v'], { windowsHide: true, windowsHide: false });\n",
    );
    const failRegexEnv = auditWindowlessSpawns(tmp);
    assert.equal(failRegexEnv.state, 'fail_unhidden_spawn');
    assert.equal(failRegexEnv.violations.length, 3);
    fs.rmSync(path.join(tmp, 'scripts', 'bad-regex-env.cjs'));

    fs.writeFileSync(
      path.join(tmp, 'native', 'arc-gateway', 'hide_windows.go'),
      'package main\n// c.SysProcAttr = &syscall.SysProcAttr{CreationFlags: CREATE_NO_WINDOW}\n',
    );
    const failGo = auditWindowlessSpawns(tmp);
    assert.equal(failGo.state, 'fail_missing_create_no_window');

    console.log('check-spawns self-test: PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
  } else {
    const idx = process.argv.indexOf('--root');
    const rootDir = idx > 0 ? path.resolve(process.argv[idx + 1]) : process.cwd();
    const res = auditWindowlessSpawns(rootDir);
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }
}
