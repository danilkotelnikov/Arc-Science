export const NATIVE_SESSION = '__ARC_NATIVE_SESSION__';

// One voice for every locked, expired and offline state. Each workspace shows one
// card (title + text, dictionary keys session.<id>.*) beside the action it gates, and
// the same short alert line.
export const SESSION_CARDS = ['locked', 'expired', 'nativeExpired', 'offline'];

/** The card for the current state: no token, a rejected token, or a rejected desktop
 * session, as {id, draft}. Workspaces that hold unsent input say so; the others do not. */
export function sessionState(token, authExpired, {draft = true} = {}) {
  const id = !token ? 'locked' : authExpired ? (token === NATIVE_SESSION ? 'nativeExpired' : 'expired') : null;
  return id ? {id, draft} : null;
}

/** A card's title and text in the current language. */
export function sessionCopy(card, t) {
  const text = t(`session.${card.id}.text`);
  return {title: t(`session.${card.id}.title`), text: card.draft ? text + ' ' + t('session.draft') : text};
}

/** The one-line form of a card, for the alert beside a failed action. */
export const sessionLine = (id, t) => t(`session.${id}.title`) + '. ' + t(`session.${id}.text`);

function headerEntries(headers) {
  if (!headers) return [];
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return [...headers.entries()];
  if (Array.isArray(headers)) return headers;
  return Object.entries(headers);
}

function apiHeaders(headers, token) {
  const result = {};
  for (const [key, value] of headerEntries(headers)) {
    if (String(key).toLowerCase() !== 'authorization') result[key] = value;
  }
  if (token !== NATIVE_SESSION) result.Authorization = 'Bearer ' + token;
  return result;
}

function assertApiPath(path) {
  if (typeof path !== 'string' || (path !== '/api' && !path.startsWith('/api/'))) {
    throw new Error('Protected requests must use local /api paths.');
  }
}

async function checkedResponse(response) {
  if (!response.ok) {
    let detail = '';
    try { const data = await response.json(); detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || ''); } catch { /* HTTP status remains actionable. */ }
    throw new Error(`Request failed (${response.status})${detail ? ': ' + detail : ''}`);
  }
  return response;
}

export async function checkedFetch(path, options) {
  return checkedResponse(await fetch(path, options));
}

export async function apiFetch(path, {token, headers, fetcher = globalThis.fetch, check = true, ...options} = {}) {
  assertApiPath(path);
  if (!token) throw new Error('Operator token is required for protected requests.');
  const response = await fetcher(path, {...options, headers: apiHeaders(headers, token)});
  return check ? checkedResponse(response) : response;
}

export async function downloadResponse(response, filename) {
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
