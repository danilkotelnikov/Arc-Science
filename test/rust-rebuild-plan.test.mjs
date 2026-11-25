import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check as proseCheck } from '../plugins/arc-core/lib/prose-gate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_DOCS = [
  'docs/rust-rebuild/PLAN.md',
  'docs/hoh/index.md',
  'wiki/Clean-room-Rust-rebuild.md',
];

const TARGET_TRIPLES = [
  'x86_64-pc-windows-msvc',
  'aarch64-pc-windows-msvc',
  'x86_64-unknown-linux-musl',
  'aarch64-unknown-linux-musl',
  'aarch64-apple-darwin',
];

const CRATES = [
  'arc-validators',
  'arc-hoh-core',
  'arc-kit-mcp',
  'arc-gateway-rs',
  'arc-runtime',
  'arc-ui',
];

const CONSOLE_VIEWS = [
  'Research',
  'Memory',
  'Cammut',
  'Figures',
  'Prose',
  'Status',
];

const PHASES = [
  'Phase 0',
  'Phase 1',
  'Phase 1b',
  'Phase 2',
  'Phase 3',
  'Phase 4',
  'Phase 5',
  'Phase 6',
  'Phase 7',
];

test('rust rebuild docs exist and are non-empty', () => {
  for (const rel of REQUIRED_DOCS) {
    const full = path.join(ROOT, rel);
    assert.ok(fs.existsSync(full), `missing required file: ${rel}`);
    const content = fs.readFileSync(full, 'utf8').trim();
    assert.ok(content.length > 200, `file too short: ${rel}`);
  }
});

test('PLAN.md declares all 5 precompiled target triples', () => {
  const plan = fs.readFileSync(path.join(ROOT, 'docs/rust-rebuild/PLAN.md'), 'utf8');
  for (const triple of TARGET_TRIPLES) {
    assert.ok(plan.includes(triple), `PLAN.md missing target triple: ${triple}`);
  }
});

test('PLAN.md enforces zero-DSH dependency and clean-room rules', () => {
  const plan = fs.readFileSync(path.join(ROOT, 'docs/rust-rebuild/PLAN.md'), 'utf8');
  assert.ok(plan.includes('pristine/app.asar'), 'PLAN.md must reference pristine/app.asar retirement');
  assert.match(plan, /clean-room/i, 'PLAN.md must state clean-room rule');
  assert.match(plan, /zero/i, 'PLAN.md must state zero DSH dependency');
});

test('PLAN.md covers all 6 Rust crates, 6 Console views, and Phases 0-7', () => {
  const plan = fs.readFileSync(path.join(ROOT, 'docs/rust-rebuild/PLAN.md'), 'utf8');
  for (const crate of CRATES) {
    assert.ok(plan.includes(crate), `PLAN.md missing crate: ${crate}`);
  }
  for (const view of CONSOLE_VIEWS) {
    assert.ok(plan.includes(view), `PLAN.md missing Console view: ${view}`);
  }
  for (const phase of PHASES) {
    assert.ok(plan.includes(phase), `PLAN.md missing roadmap phase: ${phase}`);
  }
});

test('new rust rebuild docs pass prose-gate with zero errors', () => {
  for (const rel of REQUIRED_DOCS) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const result = proseCheck(text, { zone: 'public' });
    const errors = result.findings.filter((f) => f.severity === 'error');
    assert.deepEqual(
      errors,
      [],
      `prose-gate blocked ${rel}: ${errors.map((e) => `${e.rule} "${e.span}"`).join('; ')}`,
    );
  }
});
