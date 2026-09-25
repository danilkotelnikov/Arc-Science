import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import en from './en.js';
import ru from './ru.js';

export const SUPPORTED_LOCALES = [{id: 'en', label: 'English', short: 'EN'}, {id: 'ru', label: 'Русский', short: 'RU'}];
const BASE = {en, ru};
const STORAGE_KEY = 'arc.ui.locale';
const supported = id => SUPPORTED_LOCALES.some(locale => locale.id === id);
const has = (dict, key) => !!dict && Object.hasOwn(dict, key);
const warned = new Set();
const rules = {};
const pluralRules = locale => (rules[locale] ??= new Intl.PluralRules(locale));
const formats = {};
const numberFormat = locale => (formats[locale] ??= new Intl.NumberFormat(locale));

function initialLocale() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (supported(saved)) return saved;
  } catch { /* storage blocked: fall through to the browser language */ }
  return String(globalThis.navigator?.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

// Plural forms and interpolated numbers follow the dictionary that answers, so an
// English fallback for a Russian count still reads '1.5 items'. The plural form is
// picked on the raw number, never on its formatted text.
function resolve(dict, locale, key, count) {
  if (typeof count === 'number') {
    const form = key + '_' + pluralRules(locale).select(count);
    if (has(dict, form)) return dict[form];
    if (has(dict, key + '_other')) return dict[key + '_other'];
  }
  return has(dict, key) ? dict[key] : undefined;
}

function build(locale, dicts, setLocale) {
  const t = (key, vars) => {
    let lang = locale;
    let message = resolve(dicts[locale], locale, key, vars?.count);
    if (message === undefined) { lang = 'en'; message = resolve(dicts.en, 'en', key, vars?.count); }
    if (message === undefined) {
      if (import.meta.env?.DEV && !warned.has(key)) { warned.add(key); console.warn(`[i18n] missing key: ${key}`); }
      return key;
    }
    const text = value => (typeof value === 'number' ? numberFormat(lang).format(value) : String(value));
    return vars ? message.replace(/\{(\w+)\}/g, (all, name) => (Object.hasOwn(vars, name) ? text(vars[name]) : all)) : message;
  };
  const n = (number, opts) => new Intl.NumberFormat(locale, opts).format(number);
  const d = (date, opts) => new Intl.DateTimeFormat(locale, opts || {dateStyle: 'medium'}).format(date instanceof Date ? date : new Date(date));
  const rt = (value, unit) => new Intl.RelativeTimeFormat(locale, {numeric: 'auto'}).format(value, unit);
  return {locale, setLocale, t, n, d, rt};
}

// Outside a provider the shell still reads English instead of crashing.
const I18nContext = createContext(build('en', BASE, () => {}));

/** `locale` seeds the state; after mount `setLocale` owns it. `messages` = {en:{...}, ru:{...}} merged over the base dictionaries. */
export function I18nProvider({locale: seed, messages, children}) {
  const [locale, setState] = useState(() => (supported(seed) ? seed : initialLocale()));
  const setLocale = useCallback(next => {
    if (!supported(next)) return;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage blocked: keep the in-memory choice */ }
    document.documentElement.lang = next;
    setState(next);
  }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const value = useMemo(() => {
    const dicts = {en: {...en, ...messages?.en}, ru: {...ru, ...messages?.ru}};
    return build(locale, dicts, setLocale);
  }, [locale, messages, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
export const useT = () => useContext(I18nContext).t;
