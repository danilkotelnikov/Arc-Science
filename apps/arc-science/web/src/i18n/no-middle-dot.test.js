import {expect, it} from 'vitest';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// jsdom replaces the global URL, so resolve the web root from the file path string.
const web = join(dirname(fileURLToPath(import.meta.url)), '../..');
// Every UI source: the workbench, its scripts and public files, the logo and its tooling.
const ROOTS = [
  'src', 'index.html', 'scripts', 'public', 'e2e', '../../../design/logo', '../../../scripts/build-logo.py',
  '../../../scripts/make-icon.py', '../../../scripts/squircle.py', '../THIRD_PARTY_NOTICES.md',
];
const TEXT = /\.(m?js|jsx|css|html|svg|json|md|py|txt)$/;

function files(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return TEXT.test(path) ? [path] : [];
  return readdirSync(path, {recursive: true}).map(name => join(path, String(name))).filter(file => TEXT.test(file) && statSync(file).isFile());
}

it('keeps the middle dot out of UI sources', () => {
  expect(ROOTS.filter(root => !existsSync(join(web, root)))).toEqual([]);
  const checked = ROOTS.flatMap(root => files(join(web, root)));
  expect(checked.length).toBeGreaterThan(0);
  const offenders = checked.filter(file => readFileSync(file, 'utf8').includes('\u00B7'));
  expect(offenders).toEqual([]);
});
