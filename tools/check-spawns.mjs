#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCAN_DIRS = ['lib', 'plugins', 'scripts', 'tools'];
const R012_EXEMPT = new Set(['tools/build.mjs', 'tools/install.mjs']);
const SPAWN_RE = /\b(spawnSync|spawn|execFileSync|execFile|execSync|exec)\s*\(/g;

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
  let inStr = null;
  let escaped = false;
  for (let i = startIdx; i < src.length && i < startIdx + 2000; i++) {
    const ch = src[i];
    if (escaped) { escaped = false; continue; }
    if (inStr) {
      if (ch === '\\') escaped = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { inStr = ch; continue; }
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
    SPAWN_RE.lastIndex = 0;
    let m;
    while ((m = SPAWN_RE.exec(src)) !== null) {
      const before = src.slice(Math.max(0, m.index - 24), m.index);
      if (/\bfunction\s+$/.test(before) || /\.\s*$/.test(before)) continue;
      checkedCalls += 1;
      const openIdx = src.indexOf('(', m.index);
      const callBody = extractCallSnippet(src, openIdx);
      const line = src.slice(0, m.index).split(/\r?\n/).length;
      if (R012_EXEMPT.has(rel)) {
        exempt.push({ file: rel, line, call: m[1], status: 'exempt_r012' });
        continue;
      }
      if (!/\bwindowsHide\s*:\s*true\b/.test(callBody)) {
        violations.push({ file: rel, line, call: m[1] });
      }
    }
  }

  const hideGoPath = path.join(rootDir, 'native', 'arc-gateway', 'hide_windows.go');
  const goHasHide = fs.existsSync(hideGoPath) && fs.readFileSync(hideGoPath, 'utf8').includes('CREATE_NO_WINDOW');
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
      path.join(tmp, 'native', 'arc-gateway', 'hide_windows.go'),
      'package main\nconst flag = "CREATE_NO_WINDOW"\n',
    );
    const passRes = auditWindowlessSpawns(tmp);
    assert.equal(passRes.state, 'pass');
    assert.equal(passRes.checkedCalls, 1);

    fs.writeFileSync(
      path.join(tmp, 'scripts', 'bad.mjs'),
      "import { spawnSync } from 'node:child_process';\nspawnSync('node', ['-v'], { encoding: 'utf8' });\n",
    );
    const failSpawn = auditWindowlessSpawns(tmp);
    assert.equal(failSpawn.state, 'fail_unhidden_spawn');
    assert.equal(failSpawn.violations[0].file, 'scripts/bad.mjs');

    fs.rmSync(path.join(tmp, 'scripts', 'bad.mjs'));
    fs.writeFileSync(path.join(tmp, 'native', 'arc-gateway', 'hide_windows.go'), 'package main\n');
    const failGo = auditWindowlessSpawns(tmp);
    assert.equal(failGo.state, 'fail_missing_create_no_window');

    console.log('check-spawns self-test: PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
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
