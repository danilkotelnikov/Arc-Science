import React from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {act, renderHook} from '@testing-library/react';
import {I18nProvider, SUPPORTED_LOCALES, useI18n, useT} from './index.jsx';
import en from './en.js';
import ru from './ru.js';

const NB = ' ';
const hook = (props = {}) =>renderHook(() => useI18n(), {wrapper: ({children}) => <I18nProvider {...props}>{children}</I18nProvider>});

beforeEach(() => { localStorage.clear(); document.documentElement.lang = ''; });
afterEach(() => vi.restoreAllMocks());

describe('dictionaries', () => {
  it('lists the supported locales', () => {
    expect(SUPPORTED_LOCALES).toEqual([{id: 'en', label: 'English', short: 'EN'}, {id: 'ru', label: 'Русский', short: 'RU'}]);
  });

  it('has every English key in Russian, with all four Russian plural forms', () => {
    const missing = Object.keys(en).filter(key => !Object.hasOwn(ru, key));
    expect(missing).toEqual([]);
    const plurals = [...new Set(Object.keys(en).filter(key => key.endsWith('_one')).map(key => key.slice(0, -4)))];
    expect(plurals).toEqual(['count.missions', 'count.claims', 'count.sources']);
    for (const base of plurals) {
      expect(Object.hasOwn(en, base + '_other'), base).toBe(true);
      for (const form of ['one', 'few', 'many', 'other']) expect(Object.hasOwn(ru, `${base}_${form}`), `${base}_${form}`).toBe(true);
    }
    for (const dict of [en, ru]) for (const [key, value] of Object.entries(dict)) expect(value.trim(), key).not.toBe('');
  });
});

describe('t', () => {
  it('interpolates named values and leaves unknown placeholders alone', () => {
    const {result} = hook({locale: 'en', messages: {en: {'test.greet': 'Hello, {name}. {rest}'}}});
    expect(result.current.t('test.greet', {name: 'Ada'})).toBe('Hello, Ada. {rest}');
    expect(result.current.t('nav.research')).toBe('Research');
  });

  it('picks Russian plural forms for 1, 2, 5, 11, 21 and 22', () => {
    const {result} = hook({locale: 'ru'});
    expect([1, 2, 5, 11, 21, 22].map(count => result.current.t('count.missions', {count}))).toEqual([
      '1 задание', '2 задания', '5 заданий', '11 заданий', '21 задание', '22 задания',
    ].map(text => text.replace(' ', NB)));
    expect(result.current.t('count.sources', {count: 1.5})).toBe(`1,5${NB}источника`);
  });

  it('picks English plural forms for 1 and 2', () => {
    const {result} = hook({locale: 'en'});
    expect(result.current.t('count.claims', {count: 1})).toBe('1 claim');
    expect(result.current.t('count.claims', {count: 2})).toBe('2 claims');
  });

  it('falls back to English with English plural rules, then to the key with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const {result} = hook({locale: 'ru', messages: {en: {'test.only_en': 'English only', 'test.items_one': '{count} item', 'test.items_other': '{count} items'}}});
    expect(result.current.t('test.only_en')).toBe('English only');
    expect(result.current.t('test.items', {count: 21})).toBe('21 items');
    expect(result.current.t('test.absent_key')).toBe('test.absent_key');
    expect(result.current.t('test.absent_key')).toBe('test.absent_key');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('test.absent_key');
  });

  it('formats interpolated numbers for the locale and picks the plural on the raw number', () => {
    const value = {'test.value': '[{v}]'};
    const ruHook = hook({locale: 'ru', messages: {ru: value}}).result.current;
    expect([7, 1.5, 1234567, '1.5'].map(v => ruHook.t('test.value', {v}))).toEqual(['[7]', '[1,5]', `[1${NB}234${NB}567]`, '[1.5]']);
    expect(ruHook.t('count.sources', {count: 1000})).toBe(`1${NB}000${NB}источников`);
    expect(ruHook.t('count.sources', {count: 1001})).toBe(`1${NB}001${NB}источник`);
    expect(ruHook.t('count.sources', {count: 1234})).toBe(`1${NB}234${NB}источника`);
    const enHook = hook({locale: 'en', messages: {en: value}}).result.current;
    expect([7, 1.5, 1234567, '1.5'].map(v => enHook.t('test.value', {v}))).toEqual(['[7]', '[1.5]', '[1,234,567]', '[1.5]']);
    expect(enHook.t('count.sources', {count: 1})).toBe('1 source');
    expect(enHook.t('count.sources', {count: 1.5})).toBe('1.5 sources');
    expect(enHook.t('count.sources', {count: 1000})).toBe('1,000 sources');
  });

  it('formats numbers in an English fallback the English way', () => {
    const {result} = hook({locale: 'ru', messages: {en: {'test.items_one': '{count} item', 'test.items_other': '{count} items'}}});
    expect(result.current.t('test.items', {count: 1.5})).toBe('1.5 items');
    expect(result.current.t('test.items', {count: 1234})).toBe('1,234 items');
  });

  it('uses a plain key when a count has no plural forms', () => {
    const {result} = hook({locale: 'ru', messages: {ru: {'test.plain': 'Всего: {count}'}}});
    expect(result.current.t('test.plain', {count: 3})).toBe('Всего: 3');
  });

  it('answers in English outside a provider', () => {
    const {result} = renderHook(() => useT());
    expect(result.current('common.save')).toBe('Save');
  });
});

describe('locale state', () => {
  it('starts from storage, then the browser language', () => {
    localStorage.setItem('arc.ui.locale', 'ru');
    expect(hook().result.current.locale).toBe('ru');
    localStorage.clear();
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU');
    expect(hook().result.current.locale).toBe('ru');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
    expect(hook().result.current.locale).toBe('en');
  });

  it('survives blocked storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const {result} = hook({locale: 'en'});
    act(() => result.current.setLocale('ru'));
    expect(result.current.locale).toBe('ru');
  });

  it('setLocale persists, sets the document language and ignores unknown locales', () => {
    const {result} = hook({locale: 'en'});
    expect(document.documentElement.lang).toBe('en');
    act(() => result.current.setLocale('ru'));
    expect(result.current.locale).toBe('ru');
    expect(localStorage.getItem('arc.ui.locale')).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
    expect(result.current.t('nav.settings')).toBe('Настройки');
    act(() => result.current.setLocale('fr'));
    expect(result.current.locale).toBe('ru');
  });
});

describe('formatters', () => {
  const noonUtc = new Date(Date.UTC(2026, 8, 25, 12));

  it('format in Russian, grouping digits with U+00A0', () => {
    const {result} = hook({locale: 'ru'});
    expect(result.current.n(1234567)).toBe('1\u00A0234\u00A0567');
    expect(result.current.n(0.5, {style: 'percent'})).toBe('50\u00A0%');
    expect(result.current.d(noonUtc)).toBe('25 сент. 2026 г.');
    expect(result.current.rt(-1, 'day')).toBe('вчера');
  });

  it('format in English', () => {
    const {result} = hook({locale: 'en'});
    expect(result.current.n(1234567)).toBe('1,234,567');
    expect(result.current.d(noonUtc.toISOString())).toBe('Sep 25, 2026');
    expect(result.current.d(noonUtc, {year: 'numeric', timeZone: 'UTC'})).toBe('2026');
    expect(result.current.rt(1, 'day')).toBe('tomorrow');
  });
});
