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

function stripCommentsAndStrings(src) {
  const out = [...src];
  const n = src.length;
  const blank = (i) => { if (src[i] !== '\n' && src[i] !== '\r') out[i] = ' '; };
  let mode = 'code';
  let q = '';
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
      blank(i);
      if (ch === '\\') { if (i + 1 < n) { blank(i + 1); i += 1; } }
      else if (ch === q) mode = 'code';
    } else if (ch === '/' && nx === '/') {
      blank(i); blank(i + 1); i += 1; mode = 'line';
    } else if (ch === '/' && nx === '*') {
      blank(i); blank(i + 1); i += 1; mode = 'block';
    } else if (ch === '\'' || ch === '"' || ch === '`') {
      blank(i); q = ch; mode = 'str';
    }
  }
  return out.join('');
}

function findChildProcessBindings(src) {
  const namespaces = new Set();
  const localFns = new Set();
  const addNamedList = (body, sep) => {
    for (const part of body.split(',')) {
      const m = new RegExp(`^\\s*([A-Za-z_$][\\w$]*)(?:\\s+${sep}\\s+([A-Za-z_$][\\w$]*))?\\s*$`).exec(part);
      if (m && SPAWN_APIS.has(m[1])) localFns.add(m[2] || m[1]);
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

function extractCallSnippet(src, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < src.length && i < startIdx + 2000; i++) {
    const ch = src[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth <= 0) return src.slice(startIdx, i + 1);
    }
  }
  return src.slice(startIdx, startIdx + 600);
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
    const { namespaces, localFns } = findChildProcessBindings(src);
    const codeOnly = stripCommentsAndStrings(src);
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(codeOnly)) !== null) {
      const fnName = m[1];
      const before = codeOnly.slice(Math.max(0, m.index - 64), m.index);
      const beforeRaw = src.slice(Math.max(0, m.index - 64), m.index);
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
      const callBody = extractCallSnippet(codeOnly, openIdx);
      const line = src.slice(0, m.index).split(/\r?\n/).length;
      if (R012_EXEMPT.has(rel)) {
        exempt.push({ file: rel, line, call: fnName, status: 'exempt_r012' });
        continue;
      }
      if (!/[,{]\s*windowsHide\s*:\s*true\b/.test(callBody)) {
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
      "import { spawnSync } from 'node:child_process';\nspawnSync('node', ['-v'], { encoding: 'utf8', windowsHide: true });\n",
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
