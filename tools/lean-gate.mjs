// Deterministic Lean 4 gate (Road map 7.5, gate G3.1).
// Enforces comment-stripped banned-token checks, held-out SHA-256 amendment checks,
// completeness over all .lean files, -DwarningAsError=true -DautoImplicit=false compilation,
// and strict #print axioms whitelisting via WSL Lean 4.34.1.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ALLOWED_AXIOMS = new Set(['propext', 'Classical.choice', 'Quot.sound']);
export const BANNED_TOKENS = [
  'sorry',
  'admit',
  'native_decide',
  'axiom',
  'unsafe',
  'implemented_by',
  'extern',
  'sorryAx',
  'admitGoal',
  'ofReduceBool',
  'addDeclWithoutChecking',
];
const CORE_IMPORT_PREFIXES = new Set(['Init', 'Std', 'Lean']);

export function toWslPath(winOrPosixPath) {
  const resolved = path.resolve(winOrPosixPath);
  return resolved
    .replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`)
    .replace(/\\/g, '/');
}

export function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function stripLeanCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  let blockDepth = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i];
    const next = i + 1 < n ? src[i + 1] : '';

    if (blockDepth > 0) {
      if (ch === '/' && next === '-') {
        blockDepth += 1;
        out += '  ';
        i += 2;
      } else if (ch === '-' && next === '/') {
        blockDepth -= 1;
        out += '  ';
        i += 2;
      } else {
        out += ch === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }

    if (ch === '/' && next === '-') {
      blockDepth = 1;
      out += '  ';
      i += 2;
      continue;
    }

    if (ch === '-' && next === '-') {
      while (i < n && src[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }

    if (ch === 'r' && (i === 0 || !/[A-Za-z0-9_']/.test(src[i - 1]))) {
      let hashes = 0;
      while (i + 1 + hashes < n && src[i + 1 + hashes] === '#') hashes += 1;
      if (i + 1 + hashes < n && src[i + 1 + hashes] === '"') {
        out += ' '.repeat(hashes + 2);
        i += hashes + 2;
        const closeSeq = '"' + '#'.repeat(hashes);
        while (i < n) {
          if (src.startsWith(closeSeq, i)) {
            out += ' '.repeat(closeSeq.length);
            i += closeSeq.length;
            break;
          }
          out += src[i] === '\n' ? '\n' : ' ';
          i += 1;
        }
        continue;
      }
    }

    if (ch === '"') {
      out += ' ';
      i += 1;
      while (i < n) {
        const c = src[i];
        if (c === '\\' && i + 1 < n) {
          out += src[i + 1] === '\n' ? ' \n' : '  ';
          i += 2;
        } else if (c === '"') {
          out += ' ';
          i += 1;
          break;
        } else {
          out += c === '\n' ? '\n' : ' ';
          i += 1;
        }
      }
      continue;
    }

    // Character literal like 'a' or '\n' (careful not to confuse primed identifiers like x').
    if (ch === "'" && (i === 0 || !/[A-Za-z0-9_']/.test(src[i - 1]))) {
      const look = src.slice(i, i + 5);
      const charMatch = /^'(?:\\.|[^'\\\n])'/.exec(look);
      if (charMatch) {
        out += ' '.repeat(charMatch[0].length);
        i += charMatch[0].length;
        continue;
      }
    }

    out += ch;
    i += 1;
  }

  return out;
}

export function scanBannedTokens(strippedSrc) {
  const hits = [];
  const lines = strippedSrc.split(/\r?\n/);
  const re = new RegExp(`\\b(${BANNED_TOKENS.join('|')})\\b`, 'g');
  const unsafeOptRe = /\bset_option\s+(?:warningAsError|autoImplicit|debug\.skipKernelTC)\b/;
  const cmdRe = /#\s*(exit|eval|reduce)\b/;
  lines.forEach((rawLine, idx) => {
    const line = rawLine.replace(/^\s*(?:(?:public|meta)\s+)*import\s+[A-Za-z0-9_.]+/, '');
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      hits.push({ token: m[1], line: idx + 1 });
    }
    const optM = unsafeOptRe.exec(line);
    if (optM) hits.push({ token: optM[0], line: idx + 1 });
    const cmdM = cmdRe.exec(line);
    if (cmdM) hits.push({ token: `#${cmdM[1]}`, line: idx + 1 });
    if (/#\s*print\b/.test(line) && !/^\s*#\s*print\s+axioms\s+[A-Za-z0-9_.']+\s*$/.test(line)) {
      hits.push({ token: '#print', line: idx + 1 });
    }
  });
  return hits;
}

export function extractImports(strippedSrc) {
  const imports = [];
  for (const line of strippedSrc.split(/\r?\n/)) {
    const m = /^\s*(?:(?:public|meta)\s+)*import\s+([A-Za-z0-9_.]+)/.exec(line);
    if (m) imports.push(m[1]);
  }
  return imports;
}

export function extractPublicTheorems(strippedSrc) {
  const decls = [];
  const stack = [];
  const nsPrefix = () =>
    stack
      .filter((s) => s.kind === 'ns')
      .flatMap((s) => s.parts);

  for (const rawLine of strippedSrc.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const nsMatch = /^(?:export\s+)?namespace\s+([A-Za-z0-9_.]+)/.exec(line);
    if (nsMatch) {
      stack.push({ kind: 'ns', parts: nsMatch[1].split('.') });
      continue;
    }
    if (/^section(?:\s+[A-Za-z0-9_.]+)?$/.test(line) || /^mutual$/.test(line)) {
      stack.push({ kind: 'sec', parts: [] });
      continue;
    }
    const endMatch = /^end(?:\s+([A-Za-z0-9_.]+))?$/.exec(line);
    if (endMatch && stack.length > 0) {
      if (!endMatch[1]) {
        stack.pop();
      } else {
        const endParts = endMatch[1].split('.');
        const top = stack[stack.length - 1];
        if (top.kind === 'ns' && endParts.length <= top.parts.length) {
          top.parts.splice(top.parts.length - endParts.length, endParts.length);
          if (top.parts.length === 0) stack.pop();
        } else {
          stack.pop();
        }
      }
      continue;
    }

    if (/^(?:@\[[^\]]*\]\s*)*private\s+/.test(line)) continue;

    const thmMatch = /^(?:@\[[^\]]*\]\s*)*(?:protected\s+|noncomputable\s+|unsafe\s+)*(?:theorem|lemma)\s+([A-Za-z_][A-Za-z0-9_'.]*)/.exec(line);
    if (thmMatch) {
      const prefix = nsPrefix();
      const full = [...prefix, thmMatch[1]].join('.');
      decls.push(full);
    }
  }
  return [...new Set(decls)];
}

export function findAllLeanFiles(targetPath) {
  const abs = path.resolve(targetPath);
  const st = fs.statSync(abs);
  if (st.isFile()) return [abs];
  const files = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.lake' || ent.name === '.git' || ent.name === 'node_modules') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith('.lean')) files.push(full);
    }
  }
  walk(abs);
  return files.sort();
}

export function checkHeldoutSpecs({ targetRoot, heldoutPath, amendmentsPath }) {
  if (!heldoutPath) return { checked: false, ok: true, drift: [] };
  if (!fs.existsSync(heldoutPath)) {
    return { checked: true, ok: false, drift: [{ path: heldoutPath, reason: 'missing_manifest' }] };
  }
  const manifestFile = fs.statSync(heldoutPath).isDirectory()
    ? path.join(heldoutPath, 'heldout-manifest.json')
    : heldoutPath;
  if (!fs.existsSync(manifestFile)) {
    return { checked: true, ok: false, drift: [{ path: manifestFile, reason: 'missing_manifest' }] };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const entries = Array.isArray(manifest.files) ? manifest.files : Object.entries(manifest).map(([p, sha256]) => ({ path: p, sha256 }));
  const amendments = [];
  if (amendmentsPath && fs.existsSync(amendmentsPath)) {
    for (const line of fs.readFileSync(amendmentsPath, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      amendments.push(JSON.parse(line));
    }
  }

  const drift = [];
  for (const item of entries) {
    const filePath = path.isAbsolute(item.path) ? item.path : path.resolve(targetRoot, item.path);
    if (!fs.existsSync(filePath)) {
      drift.push({ path: item.path, reason: 'missing_spec_file' });
      continue;
    }
    const actual = sha256File(filePath).toLowerCase();
    const expected = String(item.sha256 || '').toLowerCase();
    if (actual === expected) continue;
    const normRel = item.path.replace(/\\/g, '/');
    const validAmend = amendments.find(
      (a) =>
        (a.path || '').replace(/\\/g, '/') === normRel &&
        String(a.old_sha256 || '').toLowerCase() === expected &&
        String(a.new_sha256 || '').toLowerCase() === actual &&
        typeof a.author === 'string' &&
        a.author.trim().length > 0 &&
        typeof a.reason === 'string' &&
        a.reason.trim().length > 0,
    );
    if (!validAmend) {
      drift.push({ path: item.path, expected, actual, reason: 'unrecorded_amendment' });
    }
  }
  return { checked: true, ok: drift.length === 0, drift };
}

let cachedLeanCmd = null;

export function resolveLeanRunner() {
  if (cachedLeanCmd) return cachedLeanCmd;
  if (process.env.LEAN_BIN) {
    if (process.platform === 'win32' && process.env.LEAN_BIN.startsWith('/')) {
      cachedLeanCmd = { mode: 'wsl', bin: process.env.LEAN_BIN };
      return cachedLeanCmd;
    }
    cachedLeanCmd = { mode: 'native', bin: process.env.LEAN_BIN };
    return cachedLeanCmd;
  }
  if (process.platform === 'win32') {
    const probe = spawnSync(
      'wsl',
      [
        '-d',
        'Ubuntu',
        '--',
        'bash',
        '-lc',
        'command -v lean || echo "$HOME/.elan/toolchains/leanprover--lean4---v4.34.1/bin/lean"',
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 15_000 },
    );
    const bin = (probe.stdout || '').trim().split(/\r?\n/)[0];
    if (probe.status === 0 && bin) {
      cachedLeanCmd = { mode: 'wsl', bin };
      return cachedLeanCmd;
    }
  }
  cachedLeanCmd = { mode: 'native', bin: 'lean' };
  return cachedLeanCmd;
}

export function invokeLean(args, { stdin, timeoutMs = 60_000 } = {}) {
  const runner = resolveLeanRunner();
  const fullArgs = ['-DwarningAsError=true', '-DautoImplicit=false', ...args];
  if (runner.mode === 'wsl') {
    return spawnSync('wsl', ['-d', 'Ubuntu', '--', runner.bin, ...fullArgs], {
      input: stdin,
      windowsHide: true,
      stdio: [stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: timeoutMs,
    });
  }
  return spawnSync(runner.bin, fullArgs, {
    input: stdin,
    windowsHide: true,
    stdio: [stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: timeoutMs,
  });
}

export function parseAxiomsOutput(stdout) {
  const results = [];
  const rawLines = stdout.split(/\r?\n/);
  const lines = [];
  for (const raw of rawLines) {
    const clean = raw.trim();
    if (!clean) continue;
    if (lines.length > 0 && !clean.startsWith("'") && lines[lines.length - 1].includes('[') && !lines[lines.length - 1].includes(']')) {
      lines[lines.length - 1] += ' ' + clean;
    } else {
      lines.push(clean);
    }
  }
  for (const clean of lines) {
    let m = /^'(.+?)'\s+depends on axioms:\s*\[([^\]]*)\]/.exec(clean);
    if (m) {
      const axioms = m[2]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      results.push({ decl: m[1], axioms });
      continue;
    }
    m = /^'(.+?)'\s+does not depend on any axioms/.exec(clean);
    if (m) {
      results.push({ decl: m[1], axioms: [] });
    }
  }
  return results;
}

function resolveModuleMap(allFiles, rootDir) {
  const byMod = new Map();
  for (const f of allFiles) {
    const rel = path.relative(rootDir, f).replace(/\.lean$/, '').split(path.sep).join('.');
    byMod.set(rel, f);
  }
  return byMod;
}

function hasBuiltLakePackages(rootDir) {
  const lakeLib = path.join(rootDir, '.lake', 'build', 'lib', 'lean');
  return fs.existsSync(lakeLib);
}

export function runLeanGate({
  target,
  only = [],
  heldout = null,
  amendments = null,
} = {}) {
  const absTarget = path.resolve(target);
  const st = fs.statSync(absTarget);
  const rootDir = st.isFile() ? path.dirname(absTarget) : absTarget;
  const allFiles = findAllLeanFiles(absTarget);

  const defaultHeldout = heldout || (fs.existsSync(path.join(rootDir, 'heldout-manifest.json')) ? path.join(rootDir, 'heldout-manifest.json') : null);
  const defaultAmendments = amendments || (fs.existsSync(path.join(rootDir, 'amendments.jsonl')) ? path.join(rootDir, 'amendments.jsonl') : null);

  const report = {
    gate: 'G3.1',
    target: absTarget,
    state: 'blocked_internal',
    checked_at: new Date().toISOString(),
    spec_check: null,
    skipped_core_files: [],
    uncompiled_external_files: [],
    token_failures: [],
    compile_failures: [],
    axiom_failures: [],
    compiled_files: [],
    audited_theorems: 0,
  };

  if (allFiles.length === 0) {
    report.state = 'fail_no_files';
    return report;
  }

  // 1. Held-out spec SHA-256 & amendments check
  const spec = checkHeldoutSpecs({
    targetRoot: rootDir,
    heldoutPath: defaultHeldout,
    amendmentsPath: defaultAmendments,
  });
  report.spec_check = spec;
  if (!spec.ok) {
    report.state = 'fail_spec_drift';
    return report;
  }

  // 2. Analyze imports, strip comments, and find banned tokens on EVERY file first
  const modMap = resolveModuleMap(allFiles, rootDir);
  const metaByFile = new Map();
  for (const f of allFiles) {
    const raw = fs.readFileSync(f, 'utf8');
    const stripped = stripLeanCommentsAndStrings(raw);
    const imports = extractImports(stripped);
    const tokenHits = scanBannedTokens(stripped);
    const theorems = extractPublicTheorems(stripped);
    metaByFile.set(f, { raw, stripped, imports, tokenHits, theorems });
    if (tokenHits.length > 0) {
      report.token_failures.push({
        file: path.relative(rootDir, f) || path.basename(f),
        hits: tokenHits,
      });
    }
  }

  // Determine transitive external dependencies (e.g. Mathlib when not prebuilt in .lake)
  const lakeBuilt = hasBuiltLakePackages(rootDir);
  const memoExt = new Map();
  function needsExternal(f, seen = new Set()) {
    if (memoExt.has(f)) return memoExt.get(f);
    if (seen.has(f)) return null;
    seen.add(f);
    const meta = metaByFile.get(f);
    for (const imp of meta.imports) {
      const top = imp.split('.')[0];
      if (CORE_IMPORT_PREFIXES.has(top)) continue;
      if (modMap.has(imp)) {
        const depReason = needsExternal(modMap.get(imp), seen);
        if (depReason) {
          memoExt.set(f, depReason);
          return depReason;
        }
        continue;
      }
      if (!lakeBuilt) {
        const reason = `external_import:${imp}`;
        memoExt.set(f, reason);
        return reason;
      }
    }
    memoExt.set(f, null);
    return null;
  }

  const onlySet = only.length > 0 ? new Set(only.map((p) => path.resolve(rootDir, p))) : null;
  const compilable = [];
  for (const f of allFiles) {
    const extReason = needsExternal(f);
    if (extReason) {
      report.uncompiled_external_files.push({
        file: path.relative(rootDir, f) || path.basename(f),
        reason: extReason,
      });
      continue;
    }
    if (onlySet && !onlySet.has(f)) {
      report.skipped_core_files.push(path.relative(rootDir, f) || path.basename(f));
      continue;
    }
    compilable.push(f);
  }

  if (report.skipped_core_files.length > 0) {
    report.state = 'fail_skipped_file';
    return report;
  }

  if (report.token_failures.length > 0) {
    report.state = 'fail_token';
    return report;
  }

  // 3. Compile every core-compilable file and audit #print axioms
  const runner = resolveLeanRunner();
  for (const f of compilable) {
    const meta = metaByFile.get(f);
    const relName = path.relative(rootDir, f) || path.basename(f);
    const fileArg = runner.mode === 'wsl' ? toWslPath(f) : f;
    const res = invokeLean([fileArg]);
    if (res.status !== 0) {
      report.compile_failures.push({
        file: relName,
        exit_code: res.status,
        output: `${res.stdout || ''}\n${res.stderr || ''}`.trim().slice(0, 2000),
      });
      continue;
    }

    const alreadyPrinted = parseAxiomsOutput(res.stdout || '');
    const printedSet = new Set(alreadyPrinted.map((x) => x.decl));
    const missingDecls = meta.theorems.filter((d) => !printedSet.has(d));
    let combinedAxioms = [...alreadyPrinted];

    if (missingDecls.length > 0) {
      // Only use --stdin when no sibling local imports exist; otherwise stage sibling harness briefly.
      const hasLocalImports = meta.imports.some((imp) => modMap.has(imp));
      const suffix = '\n' + missingDecls.map((d) => `#print axioms _root_.${d}`).join('\n') + '\n';
      let auditRes;
      if (!hasLocalImports) {
        auditRes = invokeLean(['--stdin'], { stdin: meta.raw + suffix });
      } else {
        const tmpHarness = path.join(path.dirname(f), `.lean_gate_audit_${process.pid}.lean`);
        try {
          fs.writeFileSync(tmpHarness, meta.raw + suffix, 'utf8');
          auditRes = invokeLean([runner.mode === 'wsl' ? toWslPath(tmpHarness) : tmpHarness]);
        } finally {
          if (fs.existsSync(tmpHarness)) fs.unlinkSync(tmpHarness);
        }
      }
      if (auditRes.status !== 0) {
        report.compile_failures.push({
          file: relName,
          stage: 'axiom_audit',
          exit_code: auditRes.status,
          output: `${auditRes.stdout || ''}\n${auditRes.stderr || ''}`.trim().slice(0, 2000),
        });
        continue;
      }
      combinedAxioms = parseAxiomsOutput(auditRes.stdout || '');
    }

    const auditedSet = new Set(combinedAxioms.map((x) => x.decl));
    const unaudited = meta.theorems.filter((d) => !auditedSet.has(d));
    if (unaudited.length > 0) {
      report.compile_failures.push({
        file: relName,
        stage: 'axiom_completeness',
        exit_code: res.status,
        output: `Missing #print axioms output for: ${unaudited.join(', ')}`,
      });
      continue;
    }

    const badAxioms = [];
    for (const entry of combinedAxioms) {
      const forbidden = entry.axioms.filter((ax) => !ALLOWED_AXIOMS.has(ax));
      if (forbidden.length > 0) {
        badAxioms.push({ decl: entry.decl, forbidden });
      }
    }
    report.audited_theorems += meta.theorems.length;
    if (badAxioms.length > 0) {
      report.axiom_failures.push({ file: relName, bad: badAxioms });
    } else {
      report.compiled_files.push(relName);
    }
  }

  if (report.compile_failures.length > 0) {
    report.state = 'fail_compile';
  } else if (report.axiom_failures.length > 0) {
    report.state = 'fail_axiom';
  } else if (report.compiled_files.length === 0 && report.uncompiled_external_files.length > 0) {
    report.state = 'blocked_external_package';
  } else if (report.uncompiled_external_files.length > 0) {
    report.state = 'pass_core_only';
  } else {
    report.state = 'pass';
  }

  return report;
}

export function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-gate-test-'));
  try {
    // 0. Passing control: comment mentions "sorry", theorem clean.
    const passDir = path.join(tmp, 'c0_pass');
    fs.mkdirSync(passDir);
    fs.writeFileSync(
      path.join(passDir, 'Good.lean'),
      `-- comment mentioning sorry axiom unsafe native_decide
namespace Good
theorem add_comm_nat (a b : Nat) : a + b = b + a := Nat.add_comm a b
end Good
`,
      'utf8',
    );
    const r0 = runLeanGate({ target: passDir });
    assert.equal(r0.state, 'pass', `expected pass, got ${r0.state}: ${JSON.stringify(r0)}`);
    assert.ok(r0.audited_theorems >= 1);

    // 1. Failing control: sorry
    const c1 = path.join(tmp, 'c1_sorry');
    fs.mkdirSync(c1);
    fs.writeFileSync(path.join(c1, 'Bad.lean'), 'theorem t : 1 = 2 := sorry\n', 'utf8');
    assert.equal(runLeanGate({ target: c1 }).state, 'fail_token');

    // 2. Failing control: native_decide
    const c2 = path.join(tmp, 'c2_native');
    fs.mkdirSync(c2);
    fs.writeFileSync(path.join(c2, 'Bad.lean'), 'theorem t : 1 + 1 = 2 := by native_decide\n', 'utf8');
    assert.equal(runLeanGate({ target: c2 }).state, 'fail_token');

    // 3. Failing control: custom axiom
    const c3 = path.join(tmp, 'c3_axiom');
    fs.mkdirSync(c3);
    fs.writeFileSync(path.join(c3, 'Bad.lean'), 'axiom cheat : False\ntheorem t : False := cheat\n', 'utf8');
    assert.equal(runLeanGate({ target: c3 }).state, 'fail_token');

    // 4. Failing control: unsafe / @[implemented_by] / @[extern]
    const c4 = path.join(tmp, 'c4_unsafe');
    fs.mkdirSync(c4);
    fs.writeFileSync(path.join(c4, 'Bad.lean'), 'unsafe def bad : Nat := 0\n', 'utf8');
    assert.equal(runLeanGate({ target: c4 }).state, 'fail_token');

    // 5. Failing control: autoImplicit / compile error under strict flags
    const c5 = path.join(tmp, 'c5_compile');
    fs.mkdirSync(c5);
    fs.writeFileSync(path.join(c5, 'Bad.lean'), 'theorem t : x = x := rfl\n', 'utf8');
    assert.equal(runLeanGate({ target: c5 }).state, 'fail_compile');

    // 6. Failing control: skipped sibling core file
    const c6 = path.join(tmp, 'c6_skip');
    fs.mkdirSync(c6);
    fs.writeFileSync(path.join(c6, 'A.lean'), 'theorem a : True := trivial\n', 'utf8');
    fs.writeFileSync(path.join(c6, 'B.lean'), 'theorem b : True := trivial\n', 'utf8');
    assert.equal(runLeanGate({ target: c6, only: ['A.lean'] }).state, 'fail_skipped_file');

    // 7. Failing control: held-out spec drift without amendment
    const c7 = path.join(tmp, 'c7_drift');
    fs.mkdirSync(c7);
    const specFile = path.join(c7, 'Spec.lean');
    fs.writeFileSync(specFile, 'theorem s : True := trivial\n', 'utf8');
    const h0 = sha256File(specFile);
    const manifest = path.join(c7, 'heldout-manifest.json');
    fs.writeFileSync(manifest, JSON.stringify({ files: [{ path: 'Spec.lean', sha256: h0 }] }), 'utf8');
    fs.writeFileSync(specFile, 'theorem s : 1 = 1 := rfl\n', 'utf8');
    assert.equal(runLeanGate({ target: c7, heldout: manifest }).state, 'fail_spec_drift');

    // Recorded amendment clears drift check and compiles cleanly
    const h1 = sha256File(specFile);
    const amend = path.join(c7, 'amendments.jsonl');
    fs.writeFileSync(
      amend,
      JSON.stringify({ path: 'Spec.lean', old_sha256: h0, new_sha256: h1, author: 'alice', reason: 'tightened spec' }) + '\n',
      'utf8',
    );
    assert.equal(runLeanGate({ target: c7, heldout: manifest, amendments: amend }).state, 'pass');

    // 8. Partial control: external Mathlib import produces pass_core_only, never pass
    const c8 = path.join(tmp, 'c8_partial');
    fs.mkdirSync(c8);
    fs.writeFileSync(path.join(c8, 'Core.lean'), 'theorem c : 1 = 1 := rfl\n', 'utf8');
    fs.writeFileSync(path.join(c8, 'Ext.lean'), 'import Mathlib.Data.Nat.Basic\ntheorem e : 1 = 1 := rfl\n', 'utf8');
    assert.equal(runLeanGate({ target: c8 }).state, 'pass_core_only');

    // 9. Soundness bypass controls (#exit, import-line tail, forged #print, raw string desync, missing --heldout)
    assert.ok(scanBannedTokens('#exit\ntheorem x : True := trivial\n').length > 0);
    assert.ok(scanBannedTokens('import Init axiom cheat : False\n').length > 0);
    assert.ok(scanBannedTokens('#print "\'x\' does not depend on any axioms"\n').length > 0);
    const rawStripped = stripLeanCommentsAndStrings('def s := r#"a\\"#\ntheorem b : False := sorry\n');
    assert.ok(scanBannedTokens(rawStripped).some((h) => h.token === 'sorry'));
    assert.equal(runLeanGate({ target: passDir, heldout: path.join(tmp, 'does-not-exist.json') }).state, 'fail_spec_drift');

    console.log('lean-gate self-test: PASS (1 passing + 9 security control groups verified)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes('--self-test')) {
    selfTest();
    process.exit(0);
  }
  const target = arg('--target') || '.';
  const onlyRaw = arg('--only');
  const only = onlyRaw ? onlyRaw.split(',').filter(Boolean) : [];
  const heldout = arg('--heldout') || null;
  const amendments = arg('--amendments') || null;
  const out = arg('--out') || null;

  const rep = runLeanGate({ target, only, heldout, amendments });
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(rep, null, 2) + '\n', 'utf8');
  }
  console.log(JSON.stringify(rep, null, 2));
  const okStates = new Set(['pass', 'pass_core_only']);
  if (!okStates.has(rep.state)) process.exit(1);
}
