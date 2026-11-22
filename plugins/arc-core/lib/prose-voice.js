// Which files speak for the author, and which text is no prose. One copy for the gate's command line (tools/prose-gate.mjs)
// and the HoH accept gate (arc-hoh); arc-harness tools/lint_prose.py keeps a Python copy of VOICE.
// The list follows the voice rule of the house rules: every slide, caption, README, proposal and talk (D-20261122-50).
export const VOICE = /(^|[\\/])(readme([^\\/]*\.(md|markdown|rst|txt|adoc|org))?|index\.html?|site\.json|content\.json|abstract[^\\/]*\.(md|tex|txt|html?)|(pitch|proposal|talk)[^\\/]*\.(md|txt|html?)|captions?[^\\/]*\.(md|txt|html?)|about[^\\/]*\.(md|html)|(slides?|decks?|deck_src)[\\/][^\\/]+\.(html?|md|markdown|txt))$/i;
// Folders read relative to the project root: code dependencies, tests and fixtures hold no author voice.
export const NOT_PROSE = /(^|[\\/])(node_modules|test|tests|fixtures?|__fixtures__|testdata)[\\/]/i;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—' };
/** The visible text of an HTML page: scripts and styles keep their line count, tags become spaces, entities become characters. */
export const visibleText = (raw) => raw
  .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return NAMED[e.toLowerCase()] ?? m;
  });
