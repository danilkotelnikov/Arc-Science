import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storeReport, reportsDir } from '../lib/index.js';

const png = 'data:image/png;base64,' + Buffer.from('not really a png but base64').toString('base64');

test('host: a report is stored as latest.json, latest.png and a numbered pair', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-reports-'));
  const r = storeReport({ report: { hash: 'a1b2c3d4', level: 'warn', audit: [] }, png }, dir);
  assert.equal(r.ok, true);
  assert.match(r.file, /^r-\d{8}T\d{6}-a1b2c3d4$/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8')).level, 'warn');
  assert.equal(readFileSync(join(dir, 'latest.png'), 'utf8'), 'not really a png but base64');
  assert.ok(existsSync(join(dir, `${r.file}.png`)));
});

test('host: only the latest 12 reports are kept, and bad input is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-reports-'));
  for (let i = 0; i < 20; i++) { storeReport({ report: { hash: String(i).padStart(8, '0') }, png }, dir); }
  const numbered = readdirSync(dir).filter((f) => /^r-.*\.json$/.test(f));
  assert.ok(numbered.length <= 12, `${numbered.length} kept`);
  assert.equal(storeReport({}, dir).ok, false);
  assert.equal(storeReport({ report: { hash: '../../x' }, png: 'data:text/html;base64,AAAA' }, dir).file.endsWith('nohash'), true);
  assert.ok(!readdirSync(dir).some((f) => f.includes('..')));
});

test('host: the reports go under the Arc home folder', () => {
  assert.equal(reportsDir({ ARC_HOME: 'C:\\x\\.arc' }).replace(/\\/g, '/'), 'C:/x/.arc/arc-mermaid/reports');
});
