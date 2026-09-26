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

// The service writes every readiness sentence in English beside a stable code. English
// shows the service's own words; another language reads the sentence for that code from the
// dictionaries (node.*), filled from the node's facts, and keeps the service's words for a
// code or a fact it does not know. Nothing about a state is recomputed here.
const tail = (text, prefix) => (typeof text === 'string' && text.startsWith(prefix) ? text.slice(prefix.length) : null);

function nodeText(node, i18n) {
  const {t} = i18n, f = node.facts || {}, T = (key, vars) => t('node.' + key, vars);
  const role = name => t('settings.role.' + name);
  const settingsNext = T('settings.unavailable.next');
  switch (node.code) {
    case 'session.native': case 'session.token': case 'settings.available': case 'live.verified': case 'memory.available':
      return {meaning: T(node.code)};
    case 'settings.unavailable': case 'settings.read_only': case 'live.not_tested': case 'connector.disabled':
    case 'connector.not_consented': case 'connectors.none': case 'connectors.none_eligible': case 'renderer.configured': case 'memory.unavailable':
      return {meaning: T(node.code), next: T(node.code + '.next')};
    case 'seat.inherits': return f.inherits_from ? {meaning: T(node.code, {parent: role(f.inherits_from)}), next: T(node.code + '.next')} : null;
    case 'seat.unconfigured':
      return {meaning: T(node.code + '.' + (['planner', 'vision', 'prose'].includes(node.role) ? node.role : 'default')), next: T(node.code + '.next')};
    case 'seat.transport_not_accepted': return {meaning: T(node.code + (f.transport === 'cli' ? '.cli' : '.openclaw')), next: T(node.code + '.next')};
    case 'seat.model_missing': case 'seat.cli_missing': case 'seat.cli_not_signed_in':
      return f.provider ? {meaning: T(node.code, {provider: f.provider}), next: T(node.code + '.next', {provider: f.provider})} : null;
    case 'seat.endpoint_unconfirmed':
      return f.provider && f.endpoint ? {meaning: T(node.code, {provider: f.provider, endpoint: f.endpoint}), next: T(node.code + '.next')} : null;
    case 'seat.credential_store_unavailable': {
      const detail = tail(node.meaning, `The credential store could not be read for ${f.credential_ref}: `);
      return detail !== null ? {meaning: T(node.code, {ref: f.credential_ref, detail}), next: T(node.code + '.next')} : null;
    }
    case 'seat.credential_missing':
      return f.credential_ref ? {meaning: T(node.code, {ref: f.credential_ref}), next: T(node.code + '.next', {ref: f.credential_ref})} : null;
    case 'seat.effort_not_accepted': {
      const list = tail(node.next_action, 'Choose one of ');
      return {meaning: T(node.code, {effort: f.effort, model: f.model, provider: f.provider, transport: f.transport}),
        next: list !== null ? T(node.code + '.choose', {list}) : T(node.code + '.default')};
    }
    case 'seat.verified':
      return {meaning: f.transport === 'cli' ? T(node.code + '.cli', {model: f.model, effort: f.effort}) : T(node.code + '.api', {model: f.model, effort: f.effort, endpoint: f.endpoint})};
    case 'seat.probe_failed': {
      const error = tail(node.meaning, 'The last probe failed: ');
      return error !== null ? {meaning: T(node.code, {error}), next: T(node.code + '.next')} : null;
    }
    case 'seat.custom_model': return {meaning: T(node.code, {model: f.model, catalog: f.catalog_version}), next: T(node.code + '.next')};
    case 'seat.probe_stale': return {meaning: T(node.code + (f.transport === 'cli' ? '.cli' : '.api')), next: T(node.code + '.next')};
    case 'seat.not_tested': return {meaning: T(node.code), next: T(node.code + '.next')};
    case 'seat.unknown': case 'live.unknown': return {meaning: T(node.code), next: settingsNext};
    case 'live.blocked': {
      const pairs = [...String(tail(node.meaning, 'A live mission cannot start: ') ?? '').matchAll(/(\w+) is (\w+)/g)];
      return pairs.length ? {meaning: T(node.code, {list: pairs.map(([, r, s]) => role(r) + ' — ' + stateLabel(s, i18n).toLowerCase()).join(', ')}), next: T(node.code + '.next')} : null;
    }
    case 'live.failed': return {meaning: T(node.code, {list: (node.blocking || []).map(role).join(', ')}), next: T(node.code + '.next')};
    case 'connector.eligible': return {meaning: T(node.code), next: T(node.code + ('transport' in node ? '.next_mcp' : '.next_acp'))};
    case 'connectors.eligible': {
      const counts = String(node.meaning || '').match(/^(\d+) of (\d+) /);
      return counts ? {meaning: T(node.code, {eligible: Number(counts[1]), total: Number(counts[2])}), next: T(node.code + '.next')} : null;
    }
    case 'renderer.not_configured': return {meaning: T(node.code + (f.configured ? '.missing' : '.none')), next: T(node.code + '.next')};
    case 'memory.not_checked': {
      const error = tail(node.meaning, 'The memory worker did not answer: ');
      return error !== null ? {meaning: T(node.code + '.error', {error}), next: T(node.code + '.error_next')} : {meaning: T(node.code), next: T(node.code + '.next')};
    }
    case 'storage.present': return {meaning: T(node.code, {missions: f.missions ?? 0}), next: T('storage.next')};
    case 'storage.missing': return {meaning: T(node.code), next: T('storage.next')};
    default: return null;
  }
}

function localized(node, i18n) {
  if (!node || typeof node !== 'object') return node;
  const text = nodeText(node, i18n);
  const label = node.role && node.label ? {label: i18n.t('settings.role.' + node.role)}
    : node.kind && node.label ? {label: i18n.t(node.kind === 'native' ? 'header.session.native' : 'header.session.token')} : {};
  if (!text) return {...node, ...label};
  return {...node, ...label, meaning: text.meaning, next_action: node.next_action ? (text.next ?? node.next_action) : node.next_action};
}

/** The readiness reading with its sentences in the reader's language; English is returned as it came. */
export function localizeReadiness(readiness, i18n = ENGLISH) {
  if (!readiness || i18n.locale === 'en') return readiness;
  const seats = Object.fromEntries(Object.entries(readiness.seats || {}).map(([name, seat]) => [name, localized(seat, i18n)]));
  const connectors = readiness.connectors && {...localized(readiness.connectors, i18n),
    mcp: (readiness.connectors.mcp || []).map(row => localized(row, i18n)), acp: (readiness.connectors.acp || []).map(row => localized(row, i18n))};
  return {...readiness, seats, connectors, session: localized(readiness.session, i18n), settings: localized(readiness.settings, i18n),
    live_mission: localized(readiness.live_mission, i18n), renderer: localized(readiness.renderer, i18n),
    memory: localized(readiness.memory, i18n), storage: localized(readiness.storage, i18n)};
}

/** A CLI seat's login as readiness reports it (a fact, not a verification); null for an API seat. */
export function loginLine(seat, {t} = ENGLISH) {
  const f = seat?.facts || {};
  if (f.transport !== 'cli') return null;
  if (!f.cli_logged_in) return t('login.signed_out');
  const cli = f.executable || t('login.the_cli');
  return f.cli_auth_method ? t('login.signed_in_method', {cli, method: f.cli_auth_method}) : t('login.signed_in', {cli});
}
