import fs from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';
import {PALETTES} from './palettes.js';
import {DEFAULT_PALETTE, applyPalette, readStoredPalette, storePalette} from './applyPalette.js';

const COLOR_KEYS = ['background', 'foreground', 'surface', 'surfaceSecondary', 'surfaceTertiary', 'overlay', 'muted',
  'default', 'defaultForeground', 'accent', 'accentForeground', 'accent2', 'accent2Foreground', 'success',
  'successForeground', 'warning', 'warningForeground', 'danger', 'dangerForeground', 'border', 'separator', 'focus',
  'fieldBackground', 'fieldForeground', 'ink', 'shadow', 'accentText', 'accent2Text'];

describe('palettes', () => {
  it('have unique ids and the default among them', () => {
    const ids = PALETTES.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_PALETTE);
  });

  it.each(PALETTES)('$id is complete', palette => {
    expect(palette.labelKey).toBe(`palette.${palette.id}`);
    expect(['light', 'dark']).toContain(palette.scheme);
    expect(Object.keys(palette.colors).sort()).toEqual([...COLOR_KEYS].sort());
    for (const value of Object.values(palette.colors)) expect(value).toMatch(/^#[0-9A-F]{6}$/);
    expect(palette.style.outline).toBeGreaterThan(0);
    expect(palette.style.offset).toBeGreaterThanOrEqual(0);
  });

  it('gives Kyoto thin outlines and no offset shadow', () => {
    expect(PALETTES.find(p => p.id === 'kyoto').style).toEqual({outline: 1.5, offset: 0});
  });

  it('never ship the middle dot character', () => {
    // jsdom replaces the global URL, so resolve from the file path string.
    const source = fs.readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'palettes.js'), 'utf8');
    expect(source.includes(String.fromCharCode(0xB7))).toBe(false);
  });
});

describe('applyPalette', () => {
  afterEach(() => localStorage.clear());

  it('sets scheme, palette id and theme variables on the root', () => {
    const root = document.createElement('div');
    expect(applyPalette('night-shift', root)).toBe('night-shift');
    expect(root.dataset.theme).toBe('dark');
    expect(root.dataset.palette).toBe('night-shift');
    const css = name => root.style.getPropertyValue(name);
    expect(css('--background')).toBe('#0B0B0B');
    expect(css('--accent-foreground')).toBe('#0B0B0B');
    expect(css('--field-border')).toBe('#FFB000');
    expect(css('--bp-offset')).toBe('4px');
    expect(css('--bp-accent2')).toBe('#FF7A1A');
    expect(css('--bp-accent-text')).toBe('#FFB000');
    expect(css('--bp-accent2-text')).toBe('#FF7A1A');
    expect(css('--bp-density-4')).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('switches cleanly and falls back to the default for unknown ids', () => {
    const root = document.createElement('div');
    applyPalette('kyoto', root);
    expect(root.style.getPropertyValue('--bp-outline')).toBe('1.5px');
    expect(root.style.getPropertyValue('--bp-offset')).toBe('0px');
    expect(applyPalette('no-such-palette', root)).toBe(DEFAULT_PALETTE);
    expect(root.dataset.theme).toBe('light');
    expect(root.style.getPropertyValue('--background')).toBe('#F7F5EF');
  });

  it('defaults to the document root', () => {
    applyPalette('dark-academy');
    expect(document.documentElement.dataset.palette).toBe('dark-academy');
    applyPalette(DEFAULT_PALETTE);
  });

  it('stores only known palettes', () => {
    expect(readStoredPalette()).toBe(DEFAULT_PALETTE);
    storePalette('riso-lab');
    expect(readStoredPalette()).toBe('riso-lab');
    localStorage.setItem('arc.ui.palette', 'bogus');
    expect(readStoredPalette()).toBe(DEFAULT_PALETTE);
  });
});
