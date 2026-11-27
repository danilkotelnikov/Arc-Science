// The client-identity rules a gateway may demand before it answers.
//   node --test test/client-hints.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_HINTS, isClientRefusal, hintOrder, hintHeaders } from '../lib/client-hints.mjs';

test('a client refusal is told apart from a bad key', () => {
  assert.equal(isClientRefusal(401, '{"error":{"message":"unauthorized client detected, contact support"}}'), true);
  assert.equal(isClientRefusal(403, '{"error":{"message":"unknown client"}}'), true);
  assert.equal(isClientRefusal(401, '{"error":{"message":"invalid api key"}}'), false);
  assert.equal(isClientRefusal(429, '{"error":{"message":"unauthorized client"}}'), false);
  assert.equal(isClientRefusal(200, '{"data":[]}'), false);
});

test('the identities cover Codex, OpenCode and Roo Code', () => {
  const agents = CLIENT_HINTS.map((hint) => hint.userAgent.toLowerCase());
  assert.equal(agents.some((ua) => ua.startsWith('codex_cli_rs')), true);
  assert.equal(agents.some((ua) => ua.startsWith('opencode')), true);
  assert.equal(agents.some((ua) => ua.startsWith('roo-code')), true);
});

test('the order is stable and starts with the most accepted identity', () => {
  const order = hintOrder();
  assert.deepEqual(order.map((hint) => hint.id), ['codex', 'opencode', 'roo']);
  assert.deepEqual(hintHeaders(order[0]), { 'user-agent': order[0].userAgent });
});

test('no identity carries a key or another secret', () => {
  const text = JSON.stringify(CLIENT_HINTS);
  assert.equal(/authorization|api[-_]?key|bearer/i.test(text), false);
});