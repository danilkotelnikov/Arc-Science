#!/usr/bin/env node
/**
 * Build the self-contained Arc Harness release bundle for GitHub Releases:
 *   build/release/Arc-Harness-Kit-<version>-win-x64.zip
 *   build/release/SHA256SUMS.txt
 *
 * Includes:
 * - VERSION, LICENSE, NOTICE.md, THIRD_PARTY_LICENSES/, CHANGELOG.md, README.md, install.cmd
 * - All 7 built-in Arc plugins (arc-core, arc-hoh, arc-mermaid, arc-mode, arc-molecullage, arc-theme, arc-web-crawler)
 * - Compiled native/arc-gateway binary (arc-gateway.exe) when Go is installed
 * - Compiled native/arc-validators binary (arc-validators.exe) when Cargo is installed
 * - Build kit scripts (tools/, lib/, brand/, brandtext/, theme/, policies/, scripts/, installer/)
 * - Release manifest (RELEASE-MANIFEST.json) with Arc Harness version, git commit, and file SHA-256 digests
 *
 * Usage:
 *   node tools/release-bundle.mjs [--out <dir>] [--skip-native]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readArcVersion } from '../scripts/version-sync.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function runCmd(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${r.error?.message || r.stderr || `exit ${r.status}`}`);
  }
  return r.stdout.trim();
}

function copyIfExists(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (p) => {
      const base = path.basename(p);
      return base !== 'node_modules' && base !== '__pycache__' && base !== 'target' && !base.endsWith('.pyc');
    },
  });
  return true;
}

export function buildReleaseBundle({ repoRoot = root, outDir, skipNative = false } = {}) {
  const version = readArcVersion(repoRoot);
  const targetDir = path.resolve(outDir || path.join(repoRoot, 'build', 'release'));
  const bundleName = `Arc-Harness-Kit-${version}-win-x64`;
  const stageDir = path.join(targetDir, bundleName);
  const zipPath = path.join(targetDir, `${bundleName}.zip`);
  const sumsPath = path.join(targetDir, 'SHA256SUMS.txt');

  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  const topFiles = [
    'VERSION', 'package.json', 'README.md', 'CHANGELOG.md', 'CITATION.cff',
    'LICENSE', 'NOTICE.md', 'SECURITY.md', 'install.cmd',
  ];
  for (const f of topFiles) {
    copyIfExists(path.join(repoRoot, f), path.join(stageDir, f));
  }

  const dirs = [
    'THIRD_PARTY_LICENSES',
    'plugins',
    'tools',
    'lib',
    'scripts',
    'brand',
    'brandtext',
    'theme',
    'policies',
    'installer',
  ];
  for (const d of dirs) {
    copyIfExists(path.join(repoRoot, d), path.join(stageDir, d));
  }

  const binaries = [];
  if (!skipNative) {
    const binDir = path.join(stageDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    const gwSrc = path.join(repoRoot, 'native', 'arc-gateway');
    if (fs.existsSync(path.join(gwSrc, 'main.go'))) {
      const gwOut = path.join(binDir, process.platform === 'win32' ? 'arc-gateway.exe' : 'arc-gateway');
      runCmd('go', ['build', '-trimpath', '-o', gwOut, '.'], gwSrc);
      binaries.push({ name: path.basename(gwOut), bytes: fs.statSync(gwOut).size, sha256: sha256File(gwOut) });
    }

    const valSrc = path.join(repoRoot, 'native', 'arc-validators');
    if (fs.existsSync(path.join(valSrc, 'Cargo.toml'))) {
      runCmd('cargo', ['build', '--release', '--manifest-path', path.join(valSrc, 'Cargo.toml')], repoRoot);
      const exeName = process.platform === 'win32' ? 'arc-validators.exe' : 'arc-validators';
      const builtVal = path.join(valSrc, 'target', 'release', exeName);
      if (fs.existsSync(builtVal)) {
        const valOut = path.join(binDir, exeName);
        fs.copyFileSync(builtVal, valOut);
        binaries.push({ name: exeName, bytes: fs.statSync(valOut).size, sha256: sha256File(valOut) });
      }
    }
  }

  let gitCommit = 'unknown';
  try {
    gitCommit = runCmd('git', ['rev-parse', 'HEAD'], repoRoot);
  } catch {
    // ignore outside git
  }

  const plugins = fs.readdirSync(path.join(stageDir, 'plugins')).filter((n) =>
    fs.statSync(path.join(stageDir, 'plugins', n)).isDirectory(),
  ).sort();

  const manifest = {
    product: 'Arc Harness',
    version,
    builtAt: new Date().toISOString(),
    gitCommit,
    plugins,
    binaries,
  };
  fs.writeFileSync(path.join(stageDir, 'RELEASE-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  fs.rmSync(zipPath, { force: true });
  if (process.platform === 'win32') {
    runCmd('tar', ['-a', '-cf', zipPath, '-C', targetDir, bundleName], targetDir);
  } else {
    runCmd('zip', ['-rq', zipPath, bundleName], targetDir);
  }

  const zipSha = sha256File(zipPath);
  const sumLines = [`${zipSha}  ${path.basename(zipPath)}`];
  for (const b of binaries) {
    sumLines.push(`${b.sha256}  bin/${b.name}`);
  }
  fs.writeFileSync(sumsPath, sumLines.join('\n') + '\n', 'utf8');

  return { version, zipPath, sumsPath, zipSha, zipBytes: fs.statSync(zipPath).size, plugins, binaries };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const skipNative = process.argv.includes('--skip-native');
  const res = buildReleaseBundle({ outDir: arg('--out'), skipNative });
  console.log(JSON.stringify(res, null, 2));
}
