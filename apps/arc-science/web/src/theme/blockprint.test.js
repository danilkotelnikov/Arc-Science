import fs from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

// jsdom replaces the global URL, so resolve from the file path string.
const css = fs.readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'blockprint.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function splitList(list) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  return [...out, cur.trim()];
}

const selectorsOf = declaration => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, , body]) => body.includes(declaration))
  .flatMap(([, prelude]) => splitList(prelude));

const RING = selectorsOf('outline: 3px solid var(--focus)');
const NO_RING = selectorsOf('outline: none');
// The no-ring rule comes later with equal specificity, so it wins where both match.
const ringed = el => RING.some(s => el.matches(s)) && !NO_RING.some(s => el.matches(s));

// Attached to the document, so the :root prefix of each selector matches.
function mount(html) {
  document.body.innerHTML = html;
  return selector => document.body.querySelector(selector);
}

describe('blockprint focus ring', () => {
  it('guards the bare data-focus-visible selector against focus-within containers', () => {
    const generic = RING.find(s => s.startsWith(':root :is(:focus-visible, [data-focus-visible="true"])'));
    expect(generic).toContain(':not(:has(:focus-visible, [data-focus-visible="true"]))');
  });

  it('never targets a React Aria container class', () => {
    const container = /(^|[\s>+~(,])(\.tabs|\.select|\.combo-box|\.date-picker|\.accordion__item|\.disclosure|\[role="group"\])(?![\w-])/;
    for (const selector of RING) {
      const subject = selector.split(/\s+(?![^(]*\))/).at(-1);
      expect(subject).not.toMatch(container);
    }
  });

  it('rings the control inside Tabs, Select and Group, not the container', () => {
    const $ = mount(`
      <div class="tabs" data-focus-visible="true"><div class="tabs__panel">
        <textarea id="note" data-focus-visible="true"></textarea></div></div>
      <div class="select" data-focus-visible="true">
        <button class="select__trigger" data-focus-visible="true"></button></div>
      <div role="group" class="combo-box__input-group" data-focus-visible="true">
        <input id="query" data-focus-visible="true"></div>`);
    expect(ringed($('.tabs'))).toBe(false);
    expect(ringed($('#note'))).toBe(true);
    expect(ringed($('.select'))).toBe(false);
    expect(ringed($('.select__trigger'))).toBe(true);
    expect(ringed($('[role="group"]'))).toBe(false);
    expect(ringed($('#query'))).toBe(true);
  });

  it('rings the visible control of hidden-input widgets and the whole field shell', () => {
    const $ = mount(`
      <div class="switch"><span class="switch__control"></span>
        <label class="switch__content" data-focus-visible="true"><span><input type="checkbox" data-focus-visible="true"></span></label></div>
      <div class="slider__thumb" data-focus-visible="true"><input type="range"></div>
      <div role="group" class="number-field__group" data-focus-visible="true">
        <input id="count" data-focus-visible="true"></div>`);
    expect(ringed($('.switch__control'))).toBe(true);
    expect(ringed($('.switch__content'))).toBe(false);
    expect(ringed($('.slider__thumb'))).toBe(true);
    expect(ringed($('.number-field__group'))).toBe(true);
    expect(ringed($('#count'))).toBe(false);
  });
});

describe('blockprint shadows', () => {
  it('keeps surfaces and overlays flat unless a primary class asks for the offset', () => {
    expect(css).toMatch(/--surface-shadow: none;/);
    expect(css).toMatch(/--overlay-shadow: none;/);
    const offset = selectorsOf('0 0 var(--bp-shadow)');
    expect(offset).toContain('.bp-block--primary');
    expect(offset).toContain('.button--primary');
    expect(offset).toContain('.modal__dialog');
    expect(offset).not.toContain('.bp-panel');
    expect(offset).not.toContain('.bp-block');
    expect(offset).not.toContain('.tooltip');
  });
});
