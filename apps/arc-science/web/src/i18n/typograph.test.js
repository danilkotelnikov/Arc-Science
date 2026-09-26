import {describe, expect, it} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import typographRuDefault, {typographRu} from '../../scripts/typograph-ru.mjs';
import ru from './ru.js';

const NB = '\u00A0';
// jsdom replaces the global URL, so resolve paths from the file path string.
const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '../../scripts/typograph-ru.mjs');
// ru.js merges every area dictionary; the CLI check reads each file on its own.
const AREAS = ['research', 'memory', 'molecules', 'bioart', 'prose', 'settings', 'diagnostics'];
const DICTS = {'ru.js': [join(here, 'ru.js'), ru], ...Object.fromEntries(AREAS.map(area => [`${area}.ru.js`, [join(here, `${area}.ru.js`), {}]]))};

describe('typographRu', () => {
  it('exports the same function by name and by default', () => {
    expect(typographRuDefault).toBe(typographRu);
  });

  it('turns straight quotes into guillemets with nested low-high quotes', () => {
    expect(typographRu('Кнопка "Сохранить"')).toBe('Кнопка «Сохранить»');
    expect(typographRu('"Он сказал "да" вчера"')).toBe(`«Он${NB}сказал „да“ вчера»`);
    expect(typographRu('«Отчёт "черновик"»')).toBe('«Отчёт „черновик“»');
  });

  it('binds one- and two-letter words to the next word', () => {
    expect(typographRu('Файл в работе')).toBe(`Файл в${NB}работе`);
    expect(typographRu('и в дом')).toBe(`и${NB}в${NB}дом`);
    expect(typographRu('Не проверено')).toBe(`Не${NB}проверено`);
    expect(typographRu('Ответ по запросу из базы')).toBe(`Ответ по${NB}запросу из${NB}базы`);
  });

  it('binds the particles же, ли, бы to the previous word', () => {
    expect(typographRu('Можно ли это')).toBe(`Можно${NB}ли это`);
    expect(typographRu('Если бы знать')).toBe(`Если${NB}бы знать`);
    expect(typographRu('Тот же файл')).toBe(`Тот${NB}же файл`);
    expect(typographRu('Женя ли')).toBe(`Женя${NB}ли`);
  });

  it('puts a no-break space before an em dash', () => {
    expect(typographRu('Память — это база')).toBe(`Память${NB}— это база`);
  });

  it('binds a number or a placeholder to the following word', () => {
    expect(typographRu('около 71 градуса')).toBe(`около 71${NB}градуса`);
    expect(typographRu('на 0,5 миллиграмма и 1.5 грамма')).toBe(`на${NB}0,5${NB}миллиграмма и${NB}1.5${NB}грамма`);
    expect(typographRu('3 из 6')).toBe(`3${NB}из${NB}6`);
    expect(typographRu('256, 128 и 16 пикселей')).toBe(`256, 128${NB}и${NB}16${NB}пикселей`);
    expect(typographRu('{count} задание')).toBe(`{count}${NB}задание`);
    expect(typographRu('в {count} файлах')).toBe(`в${NB}{count}${NB}файлах`);
  });

  it('leaves digits inside words, placeholder text, hyphenated words, Latin and typeset text alone', () => {
    expect(typographRu('e1 и 1DQJ')).toBe(`e1 и${NB}1DQJ`);
    expect(typographRu('1DQJ связывает')).toBe('1DQJ связывает');
    expect(typographRu('Имя "{name}"')).toBe('Имя «{name}»');
    expect(typographRu('{a "b" c} и')).toBe(`{a "b" c}${NB}и`);
    expect(typographRu('из-за сбоя')).toBe('из-за сбоя');
    expect(typographRu('Arc is ready')).toBe('Arc is ready');
    const once = typographRu('"Можно ли" в работе — и всё');
    expect(typographRu(once)).toBe(once);
  });

  it.each(Object.entries(DICTS))('already holds for every string in %s', (name, [, dict]) => {
    const changed = Object.entries(dict).filter(([, value]) => typographRu(value) !== value).map(([key]) => key);
    expect(changed).toEqual([]);
  });
});

describe('typograph CLI', () => {
  it.each(Object.entries(DICTS))('passes %s', (name, [file]) => {
    const run = spawnSync(process.execPath, [script, file], {encoding: 'utf8'});
    expect(run.status, run.stdout + run.stderr).toBe(0);
  });

  it('prints violations and exits 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arc-typograph-'));
    try {
      const file = join(dir, 'bad.mjs');
      writeFileSync(file, "export default {'ok.key': 'Готово', 'bad.key': 'Файл в работе'};\n");
      const run = spawnSync(process.execPath, [script, file], {encoding: 'utf8'});
      expect(run.status).toBe(1);
      expect(run.stdout).toContain('bad.key');
      expect(run.stdout).not.toContain('ok.key');
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });
});
