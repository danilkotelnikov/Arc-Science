#!/usr/bin/env node
/**
 * tools/measure-start.mjs (0.1.0, 2026-11-08)
 * Measures cold and warm command startup latency, working-set RAM and
 * repository/archive disk footprint across N runs.
 *   node tools/measure-start.mjs [--runs 5] [--out _scratch/bench/start-v0.1.0.json]
 *   node tools/measure-start.mjs --self-test
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const DEFAULT_OUT = path.join(root, '_scratch', 'bench', 'start-v0.1.0.json');

function round2(n) {
  return Math.round(n * 100) / 100;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return round2(sorted[mid]);
  return round2((sorted[mid - 1] + sorted[mid]) / 2);
}

function percentile95(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return round2(sorted[idx]);
}

function folderBytes(targetPath, depth = 0) {
  if (depth > 6 || !fs.existsSync(targetPath)) return 0;
  let st;
  try {
    st = fs.statSync(targetPath);
  } catch {
    return 0;
  }
  if (st.isFile()) return st.size;
  if (!st.isDirectory()) return 0;
  let total = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(targetPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    total += folderBytes(path.join(targetPath, entry.name), depth + 1);
  }
  return total;
}

function measureDiskMb(baseDir = root) {
  const asarPath = path.join(baseDir, 'build', 'app.asar');
  let bytes = 0;
  if (fs.existsSync(asarPath)) {
    bytes += folderBytes(asarPath);
  }
  for (const dir of ['plugins', 'lib', 'tools', 'theme']) {
    bytes += folderBytes(path.join(baseDir, dir));
  }
  if (bytes === 0) {
    bytes = fs.statSync(fileURLToPath(import.meta.url)).size;
  }
  return Math.max(0.01, round2(bytes / (1024 * 1024)));
}

export function measureStart({
  runs = 5,
  cmd = process.execPath,
  args = ['-e', 'process.stdout.write(JSON.stringify({rss:process.memoryUsage().rss}))'],
  outPath = null,
} = {}) {
  const count = Number.isInteger(runs) && runs > 0 ? runs : 5;
  const samplesMs = [];
  const rssSamples = [];

  for (let i = 0; i < count; i++) {
    const t0 = performance.now();
    const res = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
    const elapsed = round2(Math.max(0.01, performance.now() - t0));
    samplesMs.push(elapsed);
    let rss = 0;
    if (res && typeof res.stdout === 'string' && res.stdout.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(res.stdout.trim());
        if (typeof parsed.rss === 'number' && parsed.rss > 0) rss = parsed.rss;
      } catch {
        // fallback to parent rss below
      }
    }
    if (!rss) rss = process.memoryUsage().rss;
    rssSamples.push(round2(rss / (1024 * 1024)));
  }

  const report = {
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    runs: count,
    coldMs: samplesMs[0],
    medianMs: median(samplesMs),
    p95Ms: percentile95(samplesMs),
    ramMb: median(rssSamples),
    diskMb: measureDiskMb(root),
    samplesMs,
  };

  if (typeof outPath === 'string' && outPath.trim()) {
    const target = path.resolve(outPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }

  return report;
}

function parseCliArgs(argv) {
  let runs = 5;
  let outPath = DEFAULT_OUT;
  let selfTest = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--self-test') {
      selfTest = true;
    } else if (a === '--runs' && argv[i + 1]) {
      runs = Number.parseInt(argv[++i], 10) || 5;
    } else if (a === '--out' && argv[i + 1]) {
      outPath = path.resolve(argv[++i]);
    }
  }
  return { runs, outPath, selfTest };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { runs, outPath, selfTest } = parseCliArgs(process.argv.slice(2));
  if (selfTest) {
    const report = measureStart({ runs: 2, outPath });
    assert.equal(report.runs, 2, 'runs must equal 2 in self-test');
    assert.equal(typeof report.medianMs, 'number');
    assert.ok(report.medianMs > 0, 'medianMs must be positive');
    assert.equal(typeof report.p95Ms, 'number');
    assert.ok(report.p95Ms >= report.medianMs, 'p95Ms must be >= medianMs');
    assert.equal(typeof report.ramMb, 'number');
    assert.ok(report.ramMb > 0, 'ramMb must be positive');
    assert.equal(typeof report.diskMb, 'number');
    assert.ok(report.diskMb > 0, 'diskMb must be positive');
    assert.ok(fs.existsSync(outPath), 'report file must be written');
    const saved = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    for (const key of ['runs', 'medianMs', 'p95Ms', 'ramMb', 'diskMb']) {
      assert.equal(saved[key], report[key], `saved ${key} matches report`);
    }
    console.log(`measure-start self-test PASS: runs=${report.runs} medianMs=${report.medianMs} p95Ms=${report.p95Ms} ramMb=${report.ramMb} diskMb=${report.diskMb}`);
  } else {
    const report = measureStart({ runs, outPath });
    console.log(JSON.stringify(report));
  }
}
