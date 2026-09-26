import {ENGLISH} from './i18n/index.jsx';

// One word set for every readiness surface. The service is the only authority on a
// state; this module only names it, never recomputes it. Every function takes the
// i18n value of useI18n() and answers in English without one.
export const STATES = ['ready', 'not_tested', 'failed', 'blocked', 'unknown'];

/** The vocabulary state of a readiness node; anything missing or unrecognised is unknown. */
export const stateOf = node => STATES.includes(node?.state) ? node.state : 'unknown';
export const stateLabel = (state, {t} = ENGLISH) => t('readiness.state.' + (STATES.includes(state) ? state : 'unknown'));

// Release checks keep their API enum; only the word people read changes.
const RELEASE_STATES = ['satisfied', 'failed', 'unknown', 'error', 'stale', 'not_applicable'];
export const releaseWord = (state, {t} = ENGLISH) =>
  RELEASE_STATES.includes(state) ? t('release.word.' + state) : state == null ? t('release.word.unknown') : String(state);

/** A meaning or next action as a sentence: the service writes them without a final stop. */
export const sentence = text => (text ? (/[.!?]$/.test(text) ? text : text + '.') : '');

// A grant's state is derived by the ledger (revoked, expired or used up beats active); the
// page names it the same way in Settings, the mission view and the route preview.
export const GRANT_STATES = ['active', 'revoked', 'expired', 'exhausted'];
export const grantState = grant => GRANT_STATES.includes(grant?.state) ? grant.state : 'unknown';
export const grantLabel = (state, {t} = ENGLISH) => t('grant.state.' + (GRANT_STATES.includes(state) ? state : 'unknown'));

/** One line per seat: "<label>: <state> — <meaning>". */
export function seatSummary(seat, i18n = ENGLISH) {
  const label = seat?.label || seat?.role || i18n.t('readiness.seat');
  const meaning = seat?.meaning ? ' — ' + seat.meaning : '';
  return label + ': ' + stateLabel(stateOf(seat), i18n) + meaning;
}

const probedAt = (at, {t, d}) => at > 0 ? d(at * 1000, {dateStyle: 'medium', timeStyle: 'short'}) : t('probe.time_unknown');

/** A seat's verification on one line, the same under a Settings card and in Diagnostics. */
export function probeLine(seat, i18n = ENGLISH) {
  const {t} = i18n, v = seat?.verification || {};
  if (v.status === 'ok') {
    return t('probe.ok', {at: probedAt(v.checked_at, i18n), model: v.observed_model || t('probe.model_unreported'),
      identity: t(v.identity_verified ? 'probe.identity_verified' : 'probe.identity_unverified')});
  }
  if (v.status === 'failed') return t('probe.failed', {error: v.error || t('probe.no_detail')});
  if (v.status === 'stale') return t('probe.stale', {at: probedAt(v.checked_at, i18n)});
  return t('probe.never');
}

/** A CLI seat's login as readiness reports it (a fact, not a verification); null for an API seat. */
export function loginLine(seat, {t} = ENGLISH) {
  const f = seat?.facts || {};
  if (f.transport !== 'cli') return null;
  if (!f.cli_logged_in) return t('login.signed_out');
  const cli = f.executable || t('login.the_cli');
  return f.cli_auth_method ? t('login.signed_in_method', {cli, method: f.cli_auth_method}) : t('login.signed_in', {cli});
}
