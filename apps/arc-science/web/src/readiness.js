// One word set for every readiness surface. The service is the only authority on a
// state; this module only names it, never recomputes it.
export const STATES = ['ready', 'not_tested', 'failed', 'blocked', 'unknown'];
export const STATE_LABEL = {ready: 'Ready', not_tested: 'Not tested', failed: 'Failed', blocked: 'Blocked', unknown: 'Unknown'};
// Release checks keep their API enum; only the word people read changes.
const RELEASE_WORD = {satisfied: 'passed', failed: 'failed', unknown: 'unverified', error: 'blocked', stale: 'stale', not_applicable: 'n/a'};

export const releaseWord = state => RELEASE_WORD[state] ?? String(state ?? 'unverified');

/** A meaning or next action as a sentence: the service writes them without a final stop. */
export const sentence = text => (text ? (/[.!?]$/.test(text) ? text : text + '.') : '');

/** The vocabulary state of a readiness node; anything missing or unrecognised is unknown. */
export const stateOf = node => STATES.includes(node?.state) ? node.state : 'unknown';

/** One line per seat: "<label>: <state> — <meaning>". */
export function seatSummary(seat) {
  const label = seat?.label || seat?.role || 'Seat';
  const meaning = seat?.meaning ? ' — ' + seat.meaning : '';
  return label + ': ' + STATE_LABEL[stateOf(seat)] + meaning;
}
