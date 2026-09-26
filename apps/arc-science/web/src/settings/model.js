// Settings are owned by the native supervisor: the service reads a snapshot with a
// revision and forwards the whole edited document back with that revision, so a
// concurrent change is refused instead of overwritten. Nothing here holds a key:
// seats name a credential (a Windows Credential Manager entry or a file) or the
// operator's own CLI login. Storing one never crosses this page: the desktop host is
// asked over IPC, shows the Windows prompt itself and answers with an arc-credential
// event that carries stored/cancelled/error and never the secret.
// Readiness (which seat can run) and the catalog (which providers, models, efforts and
// sign-in methods exist) arrive through props from GET /api/readiness; nothing here
// recomputes them. The fallback below only names the providers while that is unloaded.
// Every function that words something takes `t` from useI18n().
export const ROLES = ['planner', 'reviewer', 'falsifier', 'vision', 'prose'];
export const PROVIDER_NAMES = ['anthropic', 'openai', 'gemini', 'openclaw'];
export const CLI_TOOL = {anthropic: 'Claude Code', openai: 'Codex', gemini: 'Gemini CLI'};
export const STORES = ['file', 'credential_manager'];
// The host validates the same shape; checking here only saves a pointless round trip.
export const CREDENTIAL_NAME = /^[A-Za-z0-9._-]{1,80}$/;
export const CREDENTIAL_WAIT_MS = 5 * 60 * 1000;
export const hostIpc = () => typeof window.ipc?.postMessage === 'function';
export const originOf = url => { try { return new URL(url).origin; } catch { return null; } };
// An endpoint off the catalog's official origin; OpenClaw has none, so it is never custom.
export const customEndpoint = (catalog, name, endpoint) => { const official = catalog.providers?.[name]?.official_origin; return Boolean(official && endpoint && originOf(endpoint) !== official); };
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export const FALLBACK_CATALOG = {catalog_version: null, efforts: EFFORTS, efforts_by_transport: null,
  providers: {anthropic: {label: 'Anthropic', models: []}, openai: {label: 'OpenAI', models: []}, gemini: {label: 'Gemini', models: []}, openclaw: {label: 'OpenClaw', models: []}}, auth_modes: {}};
const FALLBACK_AUTH = ['api_key', 'cli'];
const DEFAULT_EFFORT = 'medium';
export const VIEWER = {representation: ['cartoon', 'surface', 'ball_and_stick', 'sticks', 'spacefill', 'backbone'],
  colouring: ['chain', 'element', 'residue', 'secondary_structure', 'bfactor', 'uniform'],
  assembly: ['asymmetric_unit', 'assembly_1', 'assembly_2'], background: ['white', 'black', 'transparent']};
const VIEWER_VALUES = new Set(Object.values(VIEWER).flat());
const SECTIONS = ['mcp_servers', 'acp_agents', 'prose', 'blender', 'viewer'];
// Support words the catalog uses; anything else is shown as it arrives.
const SUPPORT = {supported: 'supported', unavailable: 'unavailable', 'detected only': 'detected_only', 'not in this build': 'not_in_build'};

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const roleLabel = (t, role) => ROLES.includes(role) ? t('settings.role.' + role) : role;
const transportFor = seat => seat.auth === 'cli' ? 'cli' : 'api';
export const providerLabel = (catalog, provider, t) => catalog.providers?.[provider]?.label || provider || t('settings.field.provider');
const fallbackAuth = (t, auth) => FALLBACK_AUTH.includes(auth) ? t('settings.auth.' + auth) : auth;
export const authLabel = (catalog, provider, auth, t) => catalog.auth_modes?.[provider]?.find(mode => mode.mode === auth)?.label || fallbackAuth(t, auth);
export const modelEntry = (catalog, seat) => (catalog.providers?.[seat.provider]?.models || []).find(model => model.id === seat.model) || null;
// Sign-in options are the catalog's supported modes; a stored mode outside them stays
// selectable (marked) so the value on screen is the stored one until the operator changes it.
export const signInModes = (catalog, provider, t) => catalog.auth_modes?.[provider]?.filter(mode => mode.support === 'supported').map(mode => [mode.mode, mode.label]) || FALLBACK_AUTH.map(auth => [auth, fallbackAuth(t, auth)]);
export const effortName = (t, effort) => EFFORTS.includes(effort) ? t('settings.effort.' + effort) : String(effort);
export const supportWord = (t, support) => SUPPORT[support] ? t('settings.support.' + SUPPORT[support]) : support;
export const viewerValue = (t, value) => VIEWER_VALUES.has(value) ? t('settings.viewer.value.' + value) : String(value).charAt(0).toUpperCase() + String(value).slice(1).replace(/_/g, ' ');
const list = (t, efforts) => efforts.map(effort => effortName(t, effort)).join(', ');

// Leaf paths whose value differs between `base` and `next`. Arrays are leaves (a list is
// replaced whole), so an edited connector list re-applies as that list.
export function changedPaths(base, next, path = []) {
  if (isObject(base) && isObject(next)) return Object.keys(next).flatMap(key => changedPaths(base[key], next[key], [...path, key]));
  return JSON.stringify(base) === JSON.stringify(next) ? [] : [[path, next]];
}

export function setPath(target, path, value) {
  let cursor = target;
  for (const key of path.slice(0, -1)) cursor = cursor[key] = isObject(cursor[key]) ? cursor[key] : {};
  cursor[path[path.length - 1]] = value;
}

/** setPath without mutation: copies only the objects along the path, so untouched seats keep their identity. */
export function withPath(target, [key, ...rest], value) {
  return {...target, [key]: rest.length ? withPath(isObject(target?.[key]) ? target[key] : {}, rest, value) : value};
}

// A failure as a kind and the service's detail; the card words it (StateCard). A missing
// or rejected token is not a card: the LockNotice says it.
export function describeSettingsError(error) {
  const message = error?.message || String(error || '');
  const detail = message.replace(/^Request failed \(\d+\):?\s*/, '').replace(/\.$/, '');
  if (message.includes('Request failed (503)') && message.toLowerCase().includes('settings file')) return {kind: 'unconfigured', detail};
  if (message.includes('Request failed (409)')) return {kind: 'conflict', detail};
  if (message.includes('Request failed (422)')) return {kind: 'invalid', detail};
  if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('Load failed')) return {kind: 'offline', detail};
  return {kind: 'error', detail};
}

// The efforts a seat may store: the transport's list intersected with the model's when
// the model is in the catalog. `transport` marks a sign-in the provider has no transport
// for (the sign-in, not the effort, is what to change). Nothing is coerced: an effort
// outside `allowed` stays on screen, marked, until the operator picks one.
export function effortSupport(catalog, seat, t) {
  const all = catalog.efforts || EFFORTS;
  if (!seat.provider) return {allowed: all, disabled: false, invalid: false, note: ''};
  if (!catalog.efforts_by_transport) return {allowed: all, disabled: false, invalid: false, note: t('settings.effort.unchecked')};
  const table = catalog.efforts_by_transport[seat.provider + ':' + transportFor(seat)];
  if (table === undefined) {
    const options = signInModes(catalog, seat.provider, t).map(([, label]) => label).join(' ' + t('settings.or') + ' ');
    return {allowed: all, disabled: false, invalid: true, transport: true, note: t('settings.effort.no_transport', {
      provider: providerLabel(catalog, seat.provider, t), signin: authLabel(catalog, seat.provider, seat.auth, t), options: options || t('settings.effort.another_signin')})};
  }
  const entry = modelEntry(catalog, seat);
  const allowed = entry && Array.isArray(entry.efforts) ? table.filter(effort => entry.efforts.includes(effort)) : table;
  if (allowed.length === 0) return {allowed: [DEFAULT_EFFORT], disabled: seat.effort === DEFAULT_EFFORT, invalid: seat.effort !== DEFAULT_EFFORT,
    note: seat.effort === DEFAULT_EFFORT ? t('settings.effort.none') : t('settings.effort.none_invalid', {effort: effortName(t, seat.effort), fallback: effortName(t, DEFAULT_EFFORT)})};
  const invalid = !allowed.includes(seat.effort);
  return {allowed, disabled: false, invalid, note: invalid ? t('settings.effort.invalid', {effort: effortName(t, seat.effort), allowed: list(t, allowed)}) : t('settings.effort.accepted', {allowed: list(t, allowed)})};
}

export function seatIssue(catalog, role, seat, t) {
  const label = roleLabel(t, role);
  if (!seat.provider) return null;
  if (!seat.model) return {role, message: t('settings.issue.model', {role: label})};
  if (seat.auth === 'api_key' && !seat.credential) return {role, message: t('settings.issue.credential', {role: label})};
  const support = effortSupport(catalog, seat, t);
  if (support.invalid) return {role, message: t('settings.issue.effort', {role: label, note: support.note})};
  return null;
}

// A save effect's section ('seats.planner', 'providers.openai', 'blender', ...) in words.
export function sectionLabel(catalog, section, t) {
  const [group, name] = String(section).split('.');
  if (group === 'seats' && name) return t('settings.section.seat', {role: roleLabel(t, name)});
  if (group === 'providers' && name) return t('settings.section.provider', {provider: providerLabel(catalog, name, t)});
  return SECTIONS.includes(section) ? t('settings.section.' + section) : String(section).replace(/_/g, ' ');
}
