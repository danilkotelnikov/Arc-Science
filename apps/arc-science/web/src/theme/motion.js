import {flushSync} from 'react-dom';

// Motion preference for the Blockprint workbench, stored like the palette. 'system'
// follows prefers-reduced-motion, 'reduced' keeps opacity-only fades of at most 100 ms
// whatever the system says, 'off' stops every transition. applyMotion() puts the mode on
// <html data-motion>, and motion.css reads it from there.

export const MOTION_MODES = ['system', 'reduced', 'off'];
export const DEFAULT_MOTION = 'system';
const STORAGE_KEY = 'arc.ui.motion';

/** Applies a mode to `root`; an unknown mode falls back to DEFAULT_MOTION. Returns the applied mode. */
export function applyMotion(mode, root = document.documentElement) {
  const next = MOTION_MODES.includes(mode) ? mode : DEFAULT_MOTION;
  root.dataset.motion = next;
  return next;
}

export function readStoredMotion() {
  try {
    const mode = localStorage.getItem(STORAGE_KEY);
    if (MOTION_MODES.includes(mode)) return mode;
  } catch { /* storage blocked: use the default */ }
  return DEFAULT_MOTION;
}

export function storeMotion(mode) {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* storage blocked: keep the in-memory choice */ }
}

/** The motion actually in force: 'full', 'reduced' or 'off'. */
export function motionLevel(root = globalThis.document?.documentElement) {
  const mode = root?.dataset.motion;
  if (mode === 'off' || mode === 'reduced') return mode;
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';
}

// Cross-fades in flight: a new one skips the one before, which must not unname the root.
let running = 0;

/**
 * Runs an update that repaints the page (palette, font) as a cross-fade through the View
 * Transitions API, or at once where the API is missing or motion is off.
 * `update` runs inside the transition callback, under flushSync so a React update commits
 * there and is what gets captured; the page stays frozen while it runs, so it must be
 * cheap: setting custom properties is, mounting a screen is not. `after` runs once the new state is captured and the fade has started: the new
 * view is live, so a React re-render that only follows a DOM change (a Select's label
 * after applyPalette) belongs there, out of the frozen frames.
 * HeroUI takes the root out of view transitions (view-transition-name: none), which leaves
 * nothing to fade; <html data-cross-fade> names it again for as long as a cross-fade runs.
 */
export function crossFade(update, after) {
  const doc = globalThis.document;
  if (typeof doc?.startViewTransition !== 'function' || motionLevel() === 'off') {
    update();
    after?.();
    return;
  }
  const root = doc.documentElement;
  running++;
  root.dataset.crossFade = '';
  const transition = doc.startViewTransition(() => flushSync(update));
  if (after) transition.ready.then(after, after);
  transition.finished.finally(() => {
    running--;
    if (!running) delete root.dataset.crossFade;
  });
}

// Screens that have played their entry stagger in this page session.
const entered = new Set();

/** True only the first time a screen mounts in this session: the entry stagger plays once. */
export function firstEntry(id) {
  if (entered.has(id)) return false;
  entered.add(id);
  return true;
}
