#!/usr/bin/env node
/**
 * Single source of truth for Arc Harness independent versioning.
 * Reads root VERSION and verifies (or with --write, synchronizes) every manifest,
 * plugin, native Go/Rust binary source, CITATION.cff, and README badge.
 *
 * Usage:
 *   node scripts/version-sync.mjs --check   (exit 0 if all match, 1 on drift)
 *   node scripts/version-sync.mjs --write   (sync every target file to VERSION)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function readArcVersion(repoRoot = root) {
  const raw = fs.readFileSync(path.join(repoRoot, 'VERSION'), 'utf8').trim();
  if (!SEMVER_RE.test(raw)) {
    throw new Error(`Invalid VERSION "${raw}" in ${path.join(repoRoot, 'VERSION')}`);
  }
  return raw;
}

const JSON_MANIFESTS = [
  'package.json',
  'plugins/arc-core/package.json',
  'plugins/arc-hoh/package.json',
  'plugins/arc-mermaid/package.json',
  'plugins/arc-mode/package.json',
  'plugins/arc-molecullage/package.json',
  'plugins/arc-theme/package.json',
  'plugins/arc-web-crawler/package.json',
];

const PATTERN_TARGETS = [
  {
    file: 'plugins/arc-core/lib/index.js',
    re: /(export const version = ')([^']+)(';)/,
    replace: (v) => `$1${v}$3`,
  },
  {
    file: 'plugins/arc-web-crawler/lib/index.js',
    re: /(export const version = ')([^']+)(';)/,
    replace: (v) => `$1${v}$3`,
  },
  {
    file: 'native/arc-gateway/main.go',
    re: /(const version = ")([^"]+)(")/,
    replace: (v) => `$1${v}$3`,
  },
  {
    file: 'native/arc-validators/Cargo.toml',
    re: /(^version\s*=\s*")([^"]+)(")/m,
    replace: (v) => `$1${v}$3`,
  },
  {
    file: 'CITATION.cff',
    re: /(^version:\s*)(\S+)/m,
    replace: (v) => `$1${v}`,
  },
  {
    file: 'README.md',
    re: /(release-)([0-9]+\.[0-9]+\.[0-9]+)(-54453c)/,
    replace: (v) => `$1${v}$3`,
  },
];

export function checkOrSyncVersions({ repoRoot = root, write = false } = {}) {
  const version = readArcVersion(repoRoot);
  const drifts = [];
  const updated = [];

  for (const rel of JSON_MANIFESTS) {
    const full = path.join(repoRoot, rel);
    const raw = fs.readFileSync(full, 'utf8');
    const obj = JSON.parse(raw);
    if (obj.version !== version) {
      if (write) {
        const next = raw.replace(/("version"\s*:\s*")([^"]+)(")/, `$1${version}$3`);
        fs.writeFileSync(full, next, 'utf8');
        updated.push(`${rel}: ${obj.version} -> ${version}`);
      } else {
        drifts.push(`${rel}: expected ${version}, found ${obj.version}`);
      }
    }
  }

  for (const t of PATTERN_TARGETS) {
    const full = path.join(repoRoot, t.file);
    const raw = fs.readFileSync(full, 'utf8');
    const m = t.re.exec(raw);
    if (!m) {
      drifts.push(`${t.file}: version pattern not found`);
      continue;
    }
    if (m[2] !== version) {
      if (write) {
        const next = raw.replace(t.re, t.replace(version));
        fs.writeFileSync(full, next, 'utf8');
        updated.push(`${t.file}: ${m[2]} -> ${version}`);
      } else {
        drifts.push(`${t.file}: expected ${version}, found ${m[2]}`);
      }
    }
  }

  return { ok: drifts.length === 0, version, drifts, updated };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes('--write');
  const res = checkOrSyncVersions({ write });
  if (write) {
    for (const line of res.updated) console.log('updated:', line);
    if (res.drifts.length > 0) {
      for (const d of res.drifts) console.error('FAIL:', d);
      process.exit(1);
    }
    console.log(`version-sync: all ${JSON_MANIFESTS.length + PATTERN_TARGETS.length} targets synced to Arc Harness ${res.version}`);
  } else {
    if (!res.ok) {
      for (const d of res.drifts) console.error('DRIFT:', d);
      process.exit(1);
    }
    console.log(`version-sync: PASS (all ${JSON_MANIFESTS.length + PATTERN_TARGETS.length} targets at Arc Harness ${res.version})`);
  }
}
