import {expect, it} from 'vitest';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// jsdom replaces the global URL, so resolve the web root from the file path string.
const web = join(dirname(fileURLToPath(import.meta.url)), '../..');
// Every S0 path: UI sources, the typograph, logo SVGs and the Python logo tooling.
const ROOTS = [
  'src/i18n', 'src/theme', 'src/mockup', 'mockup.html', 'scripts/typograph-ru.mjs', 'public/logo-candidates',
  '../../../design/logo', '../../../scripts/make-icon.py', '../../../scripts/vectorize-logo.py',
  '../../../scripts/squircle.py', '../tests/test_squircle.py', '../THIRD_PARTY_NOTICES.md',
];
const TEXT = /\.(m?js|jsx|css|html|svg|json|md|py)$/;

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
