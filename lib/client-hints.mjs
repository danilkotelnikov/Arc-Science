// Client identities a gateway may require before it answers at all.
//   test/client-hints.test.mjs proves these rules; tools/build.mjs writes them into the model adapter, so the same
//   source runs here and in the archive.
//
// Some gateways answer 401 "unauthorized client detected" to any caller that does not look like a known coding tool,
// even with a valid key. The same key works when the request carries the User-Agent of one of those tools. This module
// holds the identities to try, in order, and the test that tells that refusal from an ordinary bad key.
//
// The order is by how widely a gateway accepts the identity: OpenAI's CLI first, then OpenCode, then Roo Code. Only the
// User-Agent differs; a key, a protocol and a body never change. An identity that changes nothing is not sent.

/** The client identities to try, most widely accepted first. */
export const CLIENT_HINTS = [
  { id: 'codex', userAgent: 'codex_cli_rs/0.52.0 (Windows 10.0.22631; x64) terminal' },
  { id: 'opencode', userAgent: 'opencode/0.6.3' },
  { id: 'roo', userAgent: 'roo-code/3.28.0' }
];

/**
 * Tell a refusal of the caller apart from a refusal of the key. A gateway that rejects an unknown client says so in
 * the body; a bad key does not. The test stays narrow on purpose: a wide pattern would retry with another identity
 * where no identity can help.
 * @param status - the HTTP status.
 * @param body - the reply text.
 * @returns true when another client identity may be accepted.
 */
export function isClientRefusal(status, body) {
  if (status !== 401 && status !== 403) return false;
  return /unknown client|unauthorized client|client (?:is )?not allowed|unsupported client|forbidden client|客户端/i.test(String(body));
}

/**
 * The identities to try for one route, in order, with the first repeated at the end so a cached miss still retries.
 * @returns the hint list.
 */
export function hintOrder() {
  return [...CLIENT_HINTS];
}

/**
 * Read a `User-Agent` another identity would send, without touching the caller's headers.
 * @param hint - one client identity.
 * @returns a header set that carries that identity.
 */
export function hintHeaders(hint) {
  return { 'user-agent': hint.userAgent };
}