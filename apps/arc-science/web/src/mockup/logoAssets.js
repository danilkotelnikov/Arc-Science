import shared from '../../public/logo-candidates/index.json';

// BioRender-derived candidates stay on the operator's machine (index.local.json and
// their SVGs are git-ignored) until BioRender's licence is checked for logo use.
const LOCAL = import.meta.glob('/public/logo-candidates/index.local.json', {import: 'default', eager: true});
const candidates = [...shared, ...Object.values(LOCAL).flat()];

// An <img> never inherits the host page's color, so a currentColor mark loaded that
// way stays black on a dark row. Vite hands us the SVG text instead, and the screens
// inline it: once as a <symbol>, then one <use> per size, so 31 candidates cost one
// copy of each file rather than one per tile.
const RAW = import.meta.glob('/public/logo-candidates/*.svg', {query: '?raw', import: 'default', eager: true});

/** The markup inside the outer <svg>, with the comments and the shared title id dropped. */
const inner = text => String(text)
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<title[^>]*>[\s\S]*?<\/title>/g, '')
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .trim();

export const LOGO_CANDIDATES = candidates;
export const LOGO_SOURCES = ['snoggo', 'gpt-image', 'biorender', 'geometric'];
export const LOGO_VIEWBOX = '0 0 1024 1024';
export const LOGO_SYMBOL = id => `mk-logo-${id}`;

export const LOGO_INNER = Object.fromEntries(
  candidates.map(item => [item.id, inner(RAW[`/public/logo-candidates/${item.file}`] ?? '')]),
);

/**
 * The candidate to paint in the header for this palette scheme. Tile art carries its
 * own dark fills, which nearly vanish on a dark palette, so a dark scheme falls back
 * to the matching mark: it draws in currentColor and inherits the palette ink.
 */
export function headerCandidate(id, scheme) {
  const chosen = candidates.find(item => item.id === id) || candidates[0];
  if (scheme !== 'dark' || chosen.kind === 'mark') return chosen;
  const base = chosen.id.replace(/-tile(-ink)?$/, '');
  return candidates.find(item => item.kind === 'mark' && item.id.startsWith(base)) || chosen;
}
