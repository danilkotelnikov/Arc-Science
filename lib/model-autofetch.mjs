// Fill every model parameter a fetched row can carry.
//   test/model-autofetch.test.mjs proves this file, and tools/build.mjs writes these functions into the model
//   discovery module of the built archive, so the same source runs here and there.
//
// A gateway that lists its models usually lists an id and little else. The public catalogue of the gateway states the
// input modalities, the context window, the output ceiling and whether the model reasons. These functions read that
// catalogue and put the facts into the row the form adopts, so a person does not retype them.
//
// A fact the endpoint states wins over the catalogue, and a field neither states stays absent: absent is meaningful,
// because the model then keeps the route default.
//
// The wire spellings of the effort levels are the ones the Anthropic messages adapter sends (max_tokens, effort and
// budget_tokens); pi-ai sets anything else it needs to "high" or leaves it out.

/** The effort levels a reasoning model offers, in escalation order. `off` sends no effort at all. */
const EFFORT_WIRE = [
  ['off', null],
  ['low', 'low'],
  ['medium', 'medium'],
  ['high', 'high']
];

/** Words of a model id that read as one term, not as a word to capitalise. */
const TERMS = new Set(['ai', 'api', 'ernie', 'glm', 'gpt', 'hd', 'lfm', 'tts', 'vl']);

/**
 * A readable label for a model id. The id is what a gateway accepts, not what a person reads: "beam-1-0:free" reads
 * as "Beam 1.0" and "video-tts-hd" as "Video TTS HD". A free-tier marker is a fact about billing, so it is left out.
 * @param id - the id the endpoint lists.
 * @returns the label.
 */
export function prettyName(id) {
  const base = String(id).replace(/:\s*free$/i, '');
  const parts = base.split(/[-_/\s:]+/).filter((part) => part.length > 0);
  const words = parts.map((part) => {
    const lower = part.toLowerCase();
    if (TERMS.has(lower)) return lower.toUpperCase();
    const sized = part.match(/^(\d+(?:\.\d+)?)([a-z]+)$/);
    if (sized !== null) return sized[1] + sized[2].toUpperCase();
    // a size written inside a lettered token reads as one term, the way "a3b" is A3B
    if (/^[a-z]+\d+[a-z]+$/i.test(part)) return part.toUpperCase();
    if (/^v\d/i.test(part)) return 'v' + part.slice(1);
    if (/^\d/.test(part)) return part;
    return part[0].toUpperCase() + part.slice(1);
  });
  // two single digits in a row are one version, the way "3-5" is 3.5 and "1-0" is 1.0; a longer number stays a
  // number of its own, because "0731-1" is a build and its variant, not a decimal
  const joined = [];
  for (const word of words) {
    const before = joined[joined.length - 1];
    if (/^\d$/.test(word) && before !== undefined && /^\d$/.test(before)) joined[joined.length - 1] = before + '.' + word;
    else joined.push(word);
  }
  return joined.join(' ');
}

/** The effort levels {@link withCatalogueParameter} offers for a reasoning model. */
export function effortLevels() {
  return EFFORT_WIRE.map(([level]) => level);
}

/**
 * Read the `models` array of a published catalogue into a map keyed by model id.
 * A catalogue that states no models reads as an empty map, so the endpoint's own row stands unchanged.
 * @param body - the parsed catalogue document.
 * @returns the catalogue rows by id.
 */
export function readFileCatalogue(body) {
  const rows = new Map();
  const listed = body?.models;
  if (!Array.isArray(listed)) return rows;
  for (const raw of listed) {
    const id = rowWord(raw?.id);
    if (id !== undefined && !rows.has(id)) rows.set(id, raw);
  }
  return rows;
}

/** A positive integer field of a row, or `undefined` when absent or unusable. */
function rowCount(...candidates) {
  for (const candidate of candidates) if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) return candidate;
}

/** A non-empty string field of a row, or `undefined`. */
function rowWord(...candidates) {
  for (const candidate of candidates) if (typeof candidate === 'string' && candidate.length > 0) return candidate;
}

/**
 * The input modalities a listing or a catalogue states. A model that reads video also reads an image from a frame, and
 * the profile schema knows `text` and `image` only, so audio and video read as `image`.
 * @param stated - the stated list, when any.
 * @returns the declared list in a stable order, or `undefined` when nothing usable is stated.
 */
export function modalities(stated) {
  if (!Array.isArray(stated)) return undefined;
  const input = [];
  if (stated.includes('text')) input.push('text');
  if (stated.includes('image') || stated.includes('video')) input.push('image');
  return input.length > 0 ? input : undefined;
}

/**
 * The effort levels a model offers, or `undefined` when it does not reason.
 * @param capabilities - the catalogue's capability list.
 * @returns the level to wire-value map, or `undefined`.
 */
function effortsOf(capabilities) {
  if (!Array.isArray(capabilities) || !capabilities.includes('reasoning')) return undefined;
  return Object.fromEntries(EFFORT_WIRE);
}

/**
 * Offer the catalogue's facts to one fetched row. A fact the row already states stays as it is.
 * @param candidate - the row the endpoint listed.
 * @param stated - the catalogue row of the same id, when the catalogue has one.
 * @returns the row to adopt, carrying `input`, `contextWindow`, `maxTokens` and `reasoningEfforts` when known.
 */
export function withCatalogueParameter(candidate, stated) {
  const row = { ...candidate };
  const facts = stated === undefined ? {} : {
    input: modalities(stated.modalities?.input),
    contextWindow: rowCount(stated.context),
    maxTokens: rowCount(stated.maxOutput),
    reasoningEfforts: effortsOf(stated.capabilities)
  };
  if (Array.isArray(row.inputModalities) && row.inputModalities.length > 0) row.input = [...row.inputModalities];
  else if (facts.input !== undefined) row.input = facts.input;
  if (rowCount(row.contextWindow) === undefined && facts.contextWindow !== undefined) row.contextWindow = facts.contextWindow;
  if (rowCount(row.maxTokens) === undefined && facts.maxTokens !== undefined) row.maxTokens = facts.maxTokens;
  if (row.reasoningEfforts === undefined && facts.reasoningEfforts !== undefined) row.reasoningEfforts = facts.reasoningEfforts;
  // a name equal to the id is no name at all: it is what a gateway echoes when it publishes none
  const named = typeof row.name === 'string' && row.name.length > 0 && row.name !== row.id;
  if (!named && typeof row.id === 'string') {
    const statedName = stated?.name;
    row.name = typeof statedName === 'string' && statedName.length > 0 && statedName !== row.id ? statedName : prettyName(row.id);
  }
  return row;
}