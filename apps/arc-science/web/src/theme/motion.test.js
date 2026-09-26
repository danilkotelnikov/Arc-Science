import fs from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it, vi} from 'vitest';
import {DEFAULT_MOTION, applyMotion, crossFade, firstEntry, motionLevel, readStoredMotion, storeMotion} from './motion.js';

// jsdom replaces the global URL, so resolve from the file path string.
const HERE = dirname(fileURLToPath(import.meta.url));
// Every stylesheet of the workbench, wherever it sits under src.
const SRC = join(HERE, '..');
const FILES = fs.readdirSync(SRC, {recursive: true}).map(String).filter(name => name.endsWith('.css')).map(name => join(SRC, name));

/** Every declaration of a stylesheet with the preludes of the blocks around it. */
function declarations(file) {
  const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const stack = [];
  let text = '';
  const flush = () => {
    const decl = text.trim();
    text = '';
    const colon = decl.indexOf(':');
    if (colon > 0 && stack.length) {
      out.push({file: file.split(/[\\/]/).pop(), prop: decl.slice(0, colon).trim(), value: decl.slice(colon + 1).trim(), stack: [...stack]});
    }
  };
  for (const ch of css) {
    if (ch === '{') { stack.push(text.trim().replace(/\s+/g, ' ')); text = ''; }
    else if (ch === '}') { flush(); stack.pop(); }
    else if (ch === ';') flush();
    else text += ch;
  }
  return out;
}

const ALL = FILES.flatMap(declarations);
const selectorOf = d => [...d.stack].reverse().find(prelude => !prelude.startsWith('@')) || '';
const inKeyframes = d => d.stack.some(prelude => prelude.startsWith('@keyframes'));
const REDUCED_MEDIA = '@media (prefers-reduced-motion: reduce)';
const CONTEXTS = {
  media: d => d.stack.includes(REDUCED_MEDIA),
  reduced: d => !d.stack.includes(REDUCED_MEDIA) && selectorOf(d).startsWith(':root[data-motion="reduced"]'),
  off: d => selectorOf(d).startsWith(':root[data-motion="off"]'),
};
const isOverride = d => Object.values(CONTEXTS).some(test => test(d));
const clean = value => value.replace(/\s*!important$/, '').trim();

/** Splits on top-level commas, leaving var(..., ...) and cubic-bezier(...) whole. */
function splitList(list) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  return [...out, cur.trim()].filter(Boolean);
}

// What may move: transform and opacity (translate and scale are transform), colour on
// state changes, and box-shadow on small controls only (the primary button's offset).
const ALLOWED = new Set(['transform', 'translate', 'scale', 'rotate', 'opacity', 'color', 'background-color', 'border-color', 'box-shadow']);
const KEYFRAME_ALLOWED = new Set(['transform', 'translate', 'scale', 'rotate', 'opacity']);
const SMALL_CONTROL = /\.(button|slider__thumb|switch__thumb|checkbox__control|radio__control|chip)\b/;
// The one place an animation may repeat for ever: a real in-progress indicator.
const PROGRESS = /progress|spinner|busy/;
const TIME = /(^|[\s,(])-?(\d*\.)?\d+m?s\b/;

/** Properties a transition declaration animates. */
function transitioned(d) {
  if (d.prop === 'transition-property') return splitList(clean(d.value));
  if (d.prop !== 'transition') return [];
  if (clean(d.value) === 'none') return ['none'];
  // A shorthand item without a property name animates `all`.
  return splitList(clean(d.value)).map(item => item.split(/\s+/).find(token => /^[a-z-]+$/.test(token) && !/^(ease|linear|step)/.test(token)) || 'all');
}

describe('motion.css allowlist', () => {
  it('reads the workbench stylesheets, and all motion lives in motion.css', () => {
    expect(FILES.map(file => file.split(/[\\/]/).pop())).toEqual(expect.arrayContaining(['blockprint.css', 'motion.css', 'app.css', 'fonts.css']));
    const moving = ALL.filter(d => /^(transition|animation)/.test(d.prop) || inKeyframes(d));
    expect(moving.length).toBeGreaterThan(20);
    expect([...new Set(moving.map(d => d.file))]).toEqual(['motion.css']);
  });

  it('transitions only transform, opacity and colour, and box-shadow on small controls', () => {
    const bad = ALL.flatMap(d => transitioned(d).map(prop => ({prop, where: `${d.file} ${selectorOf(d)}`, d})))
      .filter(({prop, d}) => prop !== 'none' && (!ALLOWED.has(prop) || (prop === 'box-shadow' && !SMALL_CONTROL.test(selectorOf(d)))))
      .map(({prop, where}) => `${prop} in ${where}`);
    expect(bad).toEqual([]);
  });

  it('keyframes move only transform and opacity', () => {
    const bad = ALL.filter(d => inKeyframes(d) && !KEYFRAME_ALLOWED.has(d.prop)).map(d => `${d.prop} in ${d.stack.join(' > ')}`);
    expect(bad).toEqual([]);
  });

  it('repeats an animation for ever only on a progress indicator', () => {
    const bad = ALL.filter(d => /^animation(-iteration-count)?$/.test(d.prop) && /\binfinite\b/.test(d.value) && !PROGRESS.test(selectorOf(d)))
      .map(d => `${d.file} ${selectorOf(d)}`);
    expect(bad).toEqual([]);
  });

  it('times every transition and animation with a token, never a literal', () => {
    const timed = ALL.filter(d => !isOverride(d) && !inKeyframes(d)
      && /^(transition|transition-duration|transition-delay|animation|animation-duration|animation-delay|--tw-animation-duration)$/.test(d.prop));
    expect(timed.length).toBeGreaterThan(10);
    const bad = timed.filter(d => TIME.test(clean(d.value).replace(/var\([^)]*\)/g, '')) && !/^0m?s$/.test(clean(d.value)))
      .map(d => `${d.prop}: ${d.value} in ${selectorOf(d)}`);
    expect(bad).toEqual([]);
  });
});

describe('motion.css reduced-motion overrides', () => {
  // Motion tokens: the times on :root, and the lengths anything travels by.
  const rootTokens = ALL.filter(d => d.prop.startsWith('--') && selectorOf(d) === ':root' && !isOverride(d));
  const times = rootTokens.filter(d => /^\d+m?s$/.test(d.value)).map(d => d.prop);
  const travel = [...new Set(ALL.filter(d => !isOverride(d) && (/translate/.test(d.prop)))
    .flatMap(d => [...d.value.matchAll(/var\((--[\w-]+)\)/g)].map(m => m[1])))];
  const set = (context, prop) => ALL.filter(d => CONTEXTS[context](d) && d.prop === prop).map(d => clean(d.value));
  const ms = value => (value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000);

  it('finds the tokens', () => {
    expect(times).toEqual(expect.arrayContaining(['--bp-motion-press', '--bp-motion-state', '--bp-motion-panel', '--bp-motion-slide', '--bp-stagger']));
    expect(travel).toEqual(expect.arrayContaining(['--bp-rise', '--bp-slide']));
  });

  it.each(['media', 'reduced'])('%s: every time token is 100 ms or less and nothing travels', context => {
    for (const token of times) {
      const values = set(context, token);
      expect(values, token).not.toEqual([]);
      for (const value of values) expect(ms(value), `${token}: ${value}`).toBeLessThanOrEqual(100);
    }
    for (const token of travel) {
      const values = set(context, token);
      expect(values, token).not.toEqual([]);
      for (const value of values) expect(parseFloat(value), `${token}: ${value}`).toBe(0);
    }
  });

  it.each(['media', 'reduced'])('%s: HeroUI overlays only fade', context => {
    for (const prop of ['--tw-enter-translate-x', '--tw-enter-translate-y', '--tw-exit-translate-x', '--tw-exit-translate-y']) {
      expect(set(context, prop), prop).toEqual(['0px']);
    }
    for (const prop of ['--tw-enter-scale', '--tw-exit-scale']) expect(set(context, prop), prop).toEqual(['1']);
    expect(ms(set(context, '--tw-animation-duration')[0])).toBeLessThanOrEqual(100);
  });

  it('off: every time token is zero and nothing transitions or animates', () => {
    for (const token of times) expect(set('off', token).map(ms), token).toEqual([0]);
    expect(set('off', 'transition')).toEqual(['none']);
    expect(set('off', 'animation')).toEqual(['none']);
  });
});

describe('motion.js', () => {
  it('applies, stores and reads a mode, falling back to system', () => {
    const root = document.createElement('div');
    expect(applyMotion('reduced', root)).toBe('reduced');
    expect(root.dataset.motion).toBe('reduced');
    expect(motionLevel(root)).toBe('reduced');
    expect(applyMotion('bouncy', root)).toBe(DEFAULT_MOTION);
    storeMotion('off');
    expect(readStoredMotion()).toBe('off');
    localStorage.setItem('arc.ui.motion', 'bouncy');
    expect(readStoredMotion()).toBe(DEFAULT_MOTION);
    localStorage.removeItem('arc.ui.motion');
  });

  it('crossFade updates at once without the View Transitions API, then catches up', () => {
    const order = [];
    crossFade(() => order.push('update'), () => order.push('after'));
    expect(order).toEqual(['update', 'after']);
  });

  it('crossFade applies the update inside a view transition and catches up once it is ready', async () => {
    const order = [];
    let ready, finish;
    document.startViewTransition = vi.fn(callback => {
      // The root is named for the fade before the old state is captured.
      order.push(`named ${document.documentElement.dataset.crossFade === ''}`);
      callback();
      ready = Promise.resolve();
      return {ready, finished: new Promise(resolve => { finish = resolve; })};
    });
    try {
      crossFade(() => order.push('update'), () => order.push('after'));
      expect(order).toEqual(['named true', 'update']);
      await ready;
      expect(order).toEqual(['named true', 'update', 'after']);
      expect(document.documentElement.dataset.crossFade).toBe('');
      finish();
      await Promise.resolve();
      await Promise.resolve();
      expect(document.documentElement.dataset.crossFade).toBeUndefined();
      document.documentElement.dataset.motion = 'off';
      crossFade(() => order.push('instant'));
      expect(document.startViewTransition).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['named true', 'update', 'after', 'instant']);
    } finally {
      delete document.startViewTransition;
      delete document.documentElement.dataset.motion;
    }
  });

  it('firstEntry is true once per screen', () => {
    expect(firstEntry('test/screen')).toBe(true);
    expect(firstEntry('test/screen')).toBe(false);
  });
});
