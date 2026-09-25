import {describe, expect, it} from 'vitest';
import {contrastRatio, mixHex, parseHex, relativeLuminance} from './contrast.js';
import {PALETTES} from './palettes.js';
import {paletteVars} from './applyPalette.js';

describe('contrast maths', () => {
  it('parses short and long hex', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('2F5B7A')).toEqual([47, 91, 122]);
    expect(() => parseHex('red')).toThrow();
  });

  it('matches the WCAG reference points', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBe(1);
    expect(contrastRatio('#000', '#fff')).toBe(21);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#fff', '#000')).toBe(contrastRatio('#000', '#fff'));
  });

  it('mixes like color-mix in srgb', () => {
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mixHex('#102030', '#102030', 0.3)).toBe('#102030');
  });
});

// [text or UI colour, surface, minimum ratio]
const TEXT = 4.5, UI = 3;
const PAIRS = [
  ['foreground', 'background', TEXT], ['foreground', 'surface', TEXT],
  ['foreground', 'surfaceSecondary', TEXT], ['foreground', 'surfaceTertiary', TEXT], ['foreground', 'overlay', TEXT],
  ['defaultForeground', 'default', TEXT], ['fieldForeground', 'fieldBackground', TEXT],
  ['accentForeground', 'accent', TEXT], ['accent2Foreground', 'accent2', TEXT],
  ['successForeground', 'success', TEXT], ['warningForeground', 'warning', TEXT], ['dangerForeground', 'danger', TEXT],
  ['muted', 'background', TEXT], ['muted', 'surface', TEXT], ['muted', 'overlay', TEXT], ['muted', 'fieldBackground', TEXT],
  // HeroUI sets field errors, required marks and destructive menu items in --danger.
  ['danger', 'background', TEXT], ['danger', 'surface', TEXT], ['danger', 'overlay', TEXT],
  ['ink', 'background', UI], ['ink', 'surface', UI], ['ink', 'fieldBackground', UI],
  ['focus', 'background', UI], ['focus', 'surface', UI],
  // Coloured text (LaTeX tokens, hues named in prose) uses the text tones, never the fills.
  ...['accentText', 'accent2Text'].flatMap(fg => ['background', 'surface', 'fieldBackground'].map(bg => [fg, bg, TEXT])),
  // Fills and indicators on the page: switch on-state, slider thumb and fill, meter and progress
  // fills (tracks are hollow, so a fill sits on the page colour), the rail's current item, status blocks.
  ...['accent', 'accent2', 'success', 'warning', 'danger'].flatMap(fill => ['background', 'surface'].map(bg => [fill, bg, UI])),
];

describe.each(PALETTES)('palette $id', ({colors: c, ...palette}) => {
  it.each(PAIRS)('%s on %s reaches %s:1', (fg, bg, min) => {
    expect(contrastRatio(c[fg], c[bg])).toBeGreaterThanOrEqual(min);
  });

  it('keeps foreground readable on every density tint', () => {
    const vars = paletteVars({colors: c, ...palette});
    for (const n of [1, 2, 3, 4]) expect(contrastRatio(c.foreground, vars[`--bp-density-${n}`])).toBeGreaterThanOrEqual(TEXT);
  });

  it('keeps foreground readable on soft status tints', () => {
    // HeroUI soft fills are 15-20% of the hue over the surface; soft text is ink here.
    for (const hue of ['accent', 'success', 'warning', 'danger']) {
      for (const bg of ['background', 'surface', 'overlay']) {
        expect(contrastRatio(c.foreground, mixHex(c[bg], c[hue], 0.2))).toBeGreaterThanOrEqual(TEXT);
      }
    }
  });

  it('tells the selected toggle from the unselected one', () => {
    // Selected: foreground fill with background text (tested below). Unselected: transparent over
    // background or surface, default on hover.
    for (const bg of ['background', 'surface', 'default']) expect(contrastRatio(c.foreground, c[bg])).toBeGreaterThanOrEqual(UI);
  });

  it('reads inverted status labels', () => {
    expect(contrastRatio(c.background, c.foreground)).toBeGreaterThanOrEqual(TEXT);
    expect(contrastRatio(c.background, c.muted)).toBeGreaterThanOrEqual(TEXT);
  });

  it('draws focus in a colour distinct from the offset shadow and outline', () => {
    expect(c.focus).not.toBe(c.shadow);
    expect(c.focus).not.toBe(c.ink);
  });
});
