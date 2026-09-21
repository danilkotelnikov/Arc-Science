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

const probedAt = at => at > 0 ? new Date(at * 1000).toLocaleString() : 'unknown time';

/** A seat's verification on one line, the same under a Settings card and in Diagnostics. */
export function probeLine(seat) {
  const v = seat?.verification || {};
  if (v.status === 'ok') return 'Last probe ' + probedAt(v.checked_at) + ' · answering model ' + (v.observed_model || 'not reported') + ' · identity ' + (v.identity_verified ? 'verified' : 'not verified');
  if (v.status === 'failed') return 'Probe failed: ' + (v.error || 'no detail');
  if (v.status === 'stale') return 'Last probe ' + probedAt(v.checked_at) + ' · for an earlier configuration of this seat';
  return 'Never probed';
}

/** A CLI seat's login as readiness reports it (a fact, not a verification); null for an API seat. */
export function loginLine(seat) {
  const f = seat?.facts || {};
  if (f.transport !== 'cli') return null;
  return f.cli_logged_in ? 'Signed in via ' + (f.executable || 'the CLI') + (f.cli_auth_method ? ' (' + f.cli_auth_method + ')' : '') : 'Not signed in';
}
