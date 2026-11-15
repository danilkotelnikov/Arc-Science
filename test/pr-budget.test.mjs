import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_USD,
  USD_PER_KB,
  evaluateDiffBudget,
} from '../scripts/pr-budget.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('PR diff budget enforces $10/request Macroscope limit (~$0.06/KB)', () => {
  assert.equal(DEFAULT_MAX_BYTES, 160_000);
  assert.equal(DEFAULT_MAX_USD, 10.0);
  assert.equal(USD_PER_KB, 0.06);

  const ok = evaluateDiffBudget(159_999);
  assert.equal(ok.ok, true);
  assert.equal(ok.state, 'pass');
  assert.ok(ok.estimated_macroscope_usd <= 10.0);

  const overBytes = evaluateDiffBudget(160_001);
  assert.equal(overBytes.ok, false);
  assert.equal(overBytes.state, 'fail_pr_budget');

  const overUsd = evaluateDiffBudget(166_668);
  assert.equal(overUsd.ok, false);
  assert.equal(overUsd.state, 'fail_pr_budget');
  assert.ok(overUsd.estimated_macroscope_usd > 10.0);

  const bad = evaluateDiffBudget(-1);
  assert.equal(bad.ok, false);
  assert.equal(bad.state, 'fail_invalid_input');
});

test('pr-screen.yml and claude.yml wire budget gate and Fable 5.2 formal review', () => {
  const screen = fs.readFileSync(path.join(ROOT, '.github/workflows/pr-screen.yml'), 'utf8');
  const claude = fs.readFileSync(path.join(ROOT, '.github/workflows/claude.yml'), 'utf8');

  assert.match(screen, /^  budget:\r?\n/m);
  assert.match(screen, /scripts\/pr-budget\.mjs --pr "\$PR_NUMBER" --repo "\$REPO_FULL" --max-bytes 160000 --max-usd 10/);
  assert.match(screen, /^  formal:\r?\n/m);
  assert.match(screen, /--model claude-fable-5-2/);
  assert.match(screen, /needs:\s*\[budget,\s*argon\]/);
  assert.match(screen, /needs\.budget\.result == 'success'/);
  assert.match(claude, /scripts\/pr-budget\.mjs --pr "\$PR_NUMBER" --repo "\$REPO_FULL" --max-bytes 160000 --max-usd 10/);
});
