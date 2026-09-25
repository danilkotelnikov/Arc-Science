import {PALETTES} from './palettes.js';
import {mixHex} from './contrast.js';

export const DEFAULT_PALETTE = 'arc-paper';
const STORAGE_KEY = 'arc.ui.palette';
// Verification density 1..4 tints the surface from muted towards success; 5 is solid success.
const DENSITY = [['muted', 0.12], ['success', 0.16], ['success', 0.26], ['success', 0.36]];

const find = id => PALETTES.find(p => p.id === id);

/** CSS custom properties for one palette: HeroUI theme variables plus the Blockprint set. */
export function paletteVars({colors: c, style}) {
  const vars = {
    '--background': c.background, '--foreground': c.foreground,
    '--surface': c.surface, '--surface-foreground': c.foreground,
    '--surface-secondary': c.surfaceSecondary, '--surface-tertiary': c.surfaceTertiary,
    '--overlay': c.overlay, '--overlay-foreground': c.foreground,
    '--muted': c.muted, '--default': c.default, '--default-foreground': c.defaultForeground,
    '--accent': c.accent, '--accent-foreground': c.accentForeground,
    '--success': c.success, '--success-foreground': c.successForeground,
    '--warning': c.warning, '--warning-foreground': c.warningForeground,
    '--danger': c.danger, '--danger-foreground': c.dangerForeground,
    '--border': c.border, '--separator': c.separator, '--focus': c.focus,
    '--field-background': c.fieldBackground, '--field-foreground': c.fieldForeground, '--field-border': c.ink,
    '--bp-ink': c.ink, '--bp-shadow': c.shadow,
    '--bp-outline': `${style.outline}px`, '--bp-offset': `${style.offset}px`,
    '--bp-accent2': c.accent2, '--bp-accent2-foreground': c.accent2Foreground,
    '--bp-accent-text': c.accentText, '--bp-accent2-text': c.accent2Text,
  };
  DENSITY.forEach(([key, t], i) => { vars[`--bp-density-${i + 1}`] = mixHex(c.surface, c[key], t); });
  return vars;
}

/** Applies a palette to `root`; an unknown id falls back to DEFAULT_PALETTE. Returns the applied id. */
export function applyPalette(id, root = document.documentElement) {
  const palette = find(id) || find(DEFAULT_PALETTE);
  root.dataset.theme = palette.scheme;
  root.dataset.palette = palette.id;
  for (const [name, value] of Object.entries(paletteVars(palette))) root.style.setProperty(name, value);
  return palette.id;
}

export function readStoredPalette() {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    if (find(id)) return id;
  } catch { /* storage blocked: use the default */ }
  return DEFAULT_PALETTE;
}

export function storePalette(id) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* storage blocked: keep the in-memory choice */ }
}
