#!/usr/bin/env node
/**
 * Clean-room Rust workspace build & distribution helper.
 * Uses temp-file stdio redirection (never pipes) and windowsHide: true for Windows sandbox safety.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, 'native', 'Cargo.toml');
const targetDir = path.join(repoRoot, 'build', 'cargo-target');

export function runToTempFile(cmd, args, cwd = repoRoot) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-rust-dist-'));
  const outPath = path.join(dir, 'stdout.txt');
  const errPath = path.join(dir, 'stderr.txt');
  const outFd = fs.openSync(outPath, 'w');
  const errFd = fs.openSync(errPath, 'w');
  try {
    const res = spawnSync(cmd, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', outFd, errFd],
    });
    fs.closeSync(outFd);
    fs.closeSync(errFd);
    const stdout = fs.readFileSync(outPath, 'utf8');
    const stderr = fs.readFileSync(errPath, 'utf8');
    return { status: res.status ?? 1, error: res.error || null, stdout, stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function arcBinaryPath(profile = 'debug') {
  const exe = process.platform === 'win32' ? 'arc.exe' : 'arc';
  return path.join(targetDir, profile, exe);
}

export function buildArcCli({ release = false } = {}) {
  const args = ['build', '--manifest-path', manifestPath, '--target-dir', targetDir, '-p', 'arc-cli'];
  if (release) args.push('--release');
  return runToTempFile('cargo', args, repoRoot);
}

export function testWorkspace() {
  return runToTempFile('cargo', ['test', '--manifest-path', manifestPath, '--target-dir', targetDir], repoRoot);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = process.argv[2] || '--check';
  if (flag === '--build' || flag === '--build-release') {
    const res = buildArcCli({ release: flag === '--build-release' });
    process.stdout.write(res.stdout);
    process.stderr.write(res.stderr);
    process.exit(res.status);
  } else if (flag === '--list-targets') {
    const built = buildArcCli({ release: false });
    if (built.status !== 0) {
      process.stderr.write(built.stderr);
      process.exit(built.status);
    }
    const res = runToTempFile(arcBinaryPath('debug'), ['targets'], repoRoot);
    process.stdout.write(res.stdout);
    process.stderr.write(res.stderr);
    process.exit(res.status);
  } else {
    const res = testWorkspace();
    process.stdout.write(res.stdout);
    process.stderr.write(res.stderr);
    process.exit(res.status);
  }
}
