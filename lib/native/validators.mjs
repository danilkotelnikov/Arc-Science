// Phase 6 N8 Node bridge and golden-vector reference validators for the 6 Rust modules in native/arc-validators:
// 1. seal_guard       2. arc_hook       3. arc_rules
// 4. arc_scan         5. grants/anchored/net   6. vector_assets
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CRATE_DIR = path.join(ROOT, 'native', 'arc-validators');
const BIN_NAME = process.platform === 'win32' ? 'arc-validators.exe' : 'arc-validators';
const TARGET_RELEASE_BIN = path.join(ROOT, 'build', 'cargo-target', 'release', BIN_NAME);

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function newestCrateSourceMtimeMs() {
  const cargoToml = path.join(CRATE_DIR, 'Cargo.toml');
  if (!fs.existsSync(cargoToml)) return 0;
  let newest = fs.statSync(cargoToml).mtimeMs;
  const srcDir = path.join(CRATE_DIR, 'src');
  if (fs.existsSync(srcDir)) {
    for (const f of fs.readdirSync(srcDir)) {
      if (f.endsWith('.rs')) {
        const mt = fs.statSync(path.join(srcDir, f)).mtimeMs;
        if (mt > newest) newest = mt;
      }
    }
  }
  return newest;
}

/** Locate or build the native Rust arc-validators binary when cargo is available. */
export function resolveNativeValidatorBinary({ autoBuild = true } = {}) {
  const exists = fs.existsSync(TARGET_RELEASE_BIN);
  const needsRebuild = exists && newestCrateSourceMtimeMs() > fs.statSync(TARGET_RELEASE_BIN).mtimeMs;
  if (exists && !needsRebuild) return TARGET_RELEASE_BIN;
  if (!autoBuild || !fs.existsSync(path.join(CRATE_DIR, 'Cargo.toml'))) {
    return exists ? TARGET_RELEASE_BIN : null;
  }
  const probe = spawnSync('cargo', ['--version'], { encoding: 'utf8', windowsHide: true });
  if (probe.status !== 0) return exists ? TARGET_RELEASE_BIN : null;
  const build = spawnSync('cargo', ['build', '--release', '--quiet'], {
    cwd: CRATE_DIR,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (build.status === 0 && fs.existsSync(TARGET_RELEASE_BIN)) {
    return TARGET_RELEASE_BIN;
  }
  return exists ? TARGET_RELEASE_BIN : null;
}

/** Invoke the compiled Rust arc-validators CLI and parse its JSON stdout. */
export function runNativeValidatorCli(subcommand, args = [], stdinText = '') {
  const bin = resolveNativeValidatorBinary();
  if (!bin) {
    const err = new Error('ERR_NATIVE_BINARY_UNAVAILABLE');
    err.code = 'ERR_NATIVE_BINARY_UNAVAILABLE';
    throw err;
  }
  const res = spawnSync(bin, [subcommand, ...args.map(String)], {
    input: stdinText,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (res.status !== 0) {
    throw new Error(`arc-validators ${subcommand} exited with ${res.status}: ${res.stderr}`);
  }
  return JSON.parse(res.stdout.trim());
}

// ---- Reference JS validators (byte-identical golden contract with Rust) ----

export function checkSealGuard(targetPath, { isWrite = true, sealedPaths = [], expectedSha256 = null, content = null } = {}) {
  const unified = String(targetPath || '').replace(/\\/g, '/');
  if (unified.split('/').includes('..')) {
    return { allowed: false, code: 'ERR_SEAL_TRAVERSAL', detail: `path traversal refused: ${targetPath}` };
  }
  const norm = unified.trim().replace(/^\.\//, '').toLowerCase();
  const isSealed = sealedPaths.some((s) => {
    const ns = String(s).replace(/\\/g, '/').trim().replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
    return norm === ns || norm.startsWith(`${ns}/`);
  });
  if (isWrite && isSealed) {
    return { allowed: false, code: 'ERR_SEALED_WRITE_BLOCKED', detail: `sealed path cannot be modified without approval: ${targetPath}` };
  }
  if (expectedSha256 && content !== null) {
    const actual = sha256Hex(content);
    const cleanExp = String(expectedSha256).trim().replace(/^sha256:/, '').toLowerCase();
    if (actual !== cleanExp) {
      return { allowed: false, code: 'ERR_SEAL_DIGEST_MISMATCH', detail: `sealed digest mismatch for ${targetPath}`, actualSha256: actual };
    }
    return { allowed: true, code: 'OK', detail: 'sealed digest verified', actualSha256: actual };
  }
  return { allowed: true, code: 'OK', detail: 'seal guard passed' };
}

function stripAllowedSpans(raw) {
  const s = String(raw || '');
  let out = '';
  let i = 0;
  let inFence = false;
  while (i < s.length) {
    if (s.startsWith('```', i)) {
      inFence = !inFence;
      i += 3;
      continue;
    }
    if (inFence) {
      i += 1;
      continue;
    }
    if (s[i] === '`') {
      let tickLen = 0;
      while (i + tickLen < s.length && s[i + tickLen] === '`') tickLen += 1;
      let j = i + tickLen;
      let closedAt = -1;
      while (j < s.length && s[j] !== '\n' && s[j] !== '\r') {
        if (s[j] === '`') {
          let run = 0;
          while (j + run < s.length && s[j + run] === '`') run += 1;
          if (run === tickLen) {
            closedAt = j + run;
            break;
          }
          j += run;
          continue;
        }
        j += 1;
      }
      if (closedAt >= 0) {
        i = closedAt;
      } else {
        out += '`'.repeat(tickLen);
        i += tickLen;
      }
      continue;
    }
    if (s[i] === '"') {
      let j = i + 1;
      let closedAt = -1;
      while (j < s.length && s[j] !== '\n' && s[j] !== '\r') {
        if (s[j] === '\\') {
          j += 2;
          continue;
        }
        if (s[j] === '"') {
          closedAt = j + 1;
          break;
        }
        j += 1;
      }
      if (closedAt >= 0) {
        i = closedAt;
      } else {
        out += '"';
        i += 1;
      }
      continue;
    }
    if (s.startsWith('http://', i) || s.startsWith('https://', i)) {
      while (i < s.length && !/\s/.test(s[i])) i += 1;
      continue;
    }
    out += s[i];
    i += 1;
  }
  return out;
}

export function evaluateHook({ cammutRecalled = false, isSubstantiveEdit = false, replyText = '', enforceCammut = true, enforceEnglishGentle = true } = {}) {
  const violations = [];
  if (enforceCammut && isSubstantiveEdit && !cammutRecalled) {
    violations.push('CAMMUT_RECALL_REQUIRED');
  }
  if (enforceEnglishGentle && replyText) {
    const stripped = stripAllowedSpans(replyText);
    if (/[\u0400-\u04FF]/.test(stripped)) {
      violations.push('NON_ENGLISH_PROSE_OUTSIDE_CODE');
    }
    if (stripped.includes('!!!') || stripped.includes('YOU MUST OBEY')) {
      violations.push('HARSH_TONE_MARKER');
    }
  }
  return { allowed: violations.length === 0, violations };
}

const REFUSED_WORDS = [
  ['lever', 'age'].join(''),
  ['un', 'lock'].join(''),
  ['holis', 'tic'].join(''),
  ['seam', 'lessly'].join(''),
  ['paradigm ', 'shift'].join(''),
  ['game-', 'changer'].join(''),
  ['del', 've'].join(''),
  ['tapes', 'try'].join(''),
];

const SLIDE_VERBS = ['build', 'builds', 'unlock', 'transforms', 'drives', 'accelerates', 'discover', 'redefining', 'empower'];

export function lintProse(text, { slideMode = false } = {}) {
  const findings = [];
  const cleanText = String(text ?? '').replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/);
  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    const lineNo = idx + 1;

    for (const w of REFUSED_WORDS) {
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'i').test(lower)) {
        findings.push({ line: lineNo, rule: 'REFUSED_WORD' });
      }
    }
    if (
      (lower.includes('is not ') && lower.includes(', it is ')) ||
      (lower.includes('not a ') && lower.includes(', but ')) ||
      lower.includes(', not a ') ||
      lower.includes(', not an ')
    ) {
      findings.push({ line: lineNo, rule: 'CONTRAST_NOT_Y' });
    }
    if ((lower.includes('passes.') || lower.includes('done.') || lower.includes('clean.')) && lower.includes(' no ') && lower.includes(' yet.')) {
      findings.push({ line: lineNo, rule: 'CLIPPED_STATUS' });
    }
    if (slideMode && trimmed.startsWith('#')) {
      const header = trimmed.replace(/^#+/, '').trim();
      const hLow = header.toLowerCase();
      if (header.includes(',') || /\d/.test(header)) {
        findings.push({ line: lineNo, rule: 'SLOGAN_HEADER' });
      } else if (SLIDE_VERBS.some((v) => new RegExp(`(?<![a-z])${v}(?![a-z])`, 'i').test(hLow))) {
        findings.push({ line: lineNo, rule: 'SLOGAN_HEADER' });
      }
    }
  });
  return { ok: findings.length === 0, findings };
}

export function isBlueHex(hex6) {
  if (!/^[0-9a-fA-F]{6}$/.test(hex6)) return false;
  const r = parseInt(hex6.slice(0, 2), 16);
  const g = parseInt(hex6.slice(2, 4), 16);
  const b = parseInt(hex6.slice(4, 6), 16);
  return b - Math.max(r, g) >= 24;
}

export function evaluateGrant(mode, issuedMs, nowMs, revoked = false) {
  if (revoked || String(mode).toLowerCase() === 'revoke') {
    return { active: false, reason: 'revoked', expiresAtMs: issuedMs };
  }
  if (String(mode).toLowerCase() === 'single action') {
    return {
      active: nowMs === issuedMs,
      reason: nowMs === issuedMs ? 'single_action_valid' : 'single_action_consumed',
      expiresAtMs: issuedMs,
    };
  }
  if (String(mode).toLowerCase() === 'grant for 30 days') {
    const expiresAtMs = issuedMs + THIRTY_DAYS_MS;
    return {
      active: nowMs < expiresAtMs,
      reason: nowMs < expiresAtMs ? 'active_30d' : 'expired_30d',
      expiresAtMs,
    };
  }
  return { active: false, reason: 'unknown_mode', expiresAtMs: issuedMs };
}

export function anchoredEntryDigest(prevHash, seq, kind, canonicalPayload) {
  const payloadHex = sha256Hex(Buffer.from(String(canonicalPayload), 'utf8'));
  const preimage = `${prevHash}|${seq}|${kind}|${payloadHex}`;
  return `sha256:${sha256Hex(Buffer.from(preimage, 'utf8'))}`;
}

export function evaluateNetEndpoint(host, port, allowedHosts = []) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { allowed: false, reason: 'invalid_port' };
  }
  const clean = String(host ?? '').trim().toLowerCase();
  if (!clean || clean === '0.0.0.0' || clean === '::') {
    return { allowed: false, reason: 'wildcard_bind_forbidden' };
  }
  if (clean === '127.0.0.1' || clean === '::1') {
    return { allowed: true, reason: 'loopback' };
  }
  if (allowedHosts.some((h) => String(h).trim().toLowerCase() === clean)) {
    return { allowed: true, reason: 'allowlisted_host' };
  }
  return { allowed: false, reason: 'unapproved_host' };
}

export function validateSvg(svgText) {
  const trimmed = String(svgText ?? '').trim();
  const lower = trimmed.toLowerCase();
  const errors = [];
  if (!lower.includes('<svg') || !lower.includes('</svg>')) errors.push('MISSING_SVG_ROOT');
  if (!trimmed.includes('viewBox="0 0 24 24"') && !trimmed.includes("viewBox='0 0 24 24'")) errors.push('INVALID_VIEWBOX_24');
  if (!trimmed.includes('stroke-width="1.5"') && !trimmed.includes("stroke-width='1.5'") && !trimmed.includes('strokeWidth="1.5"')) {
    errors.push('MISSING_STROKE_WIDTH_1_5');
  }
  if (lower.includes('<script') || lower.includes('javascript:')) errors.push('FORBIDDEN_SCRIPT');
  if (lower.includes('<foreignobject')) errors.push('FORBIDDEN_FOREIGN_OBJECT');
  if (/\bon(?:load|click|error|mouseover|focus)=/i.test(lower)) errors.push('FORBIDDEN_EVENT_HANDLER');
  if (lower.includes('url(http://') || lower.includes('url(https://') || lower.includes('xlink:href="http')) errors.push('FORBIDDEN_EXTERNAL_URL');
  const hexMatches = trimmed.match(/#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?(?![0-9a-fA-F])/g) ?? [];
  if (hexMatches.some((h) => isBlueHex(h.slice(1, 7)))) errors.push('FORBIDDEN_BLUE_COLOR');
  return { valid: errors.length === 0, errors };
}
