// The model autofetch fills every parameter a model row can carry.
//   node --test test/model-autofetch.test.mjs
// The resolver is checked here on its own, then inside the built archive by build-check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileCatalogue, withCatalogueParameter, effortLevels, prettyName } from '../lib/model-autofetch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'models.json'), 'utf8'));
const catalogue = readFileCatalogue(fixture);
const entry = (id) => catalogue.get(id);

test('a text-only model keeps text input and gets no reasoning levels', () => {
  const row = withCatalogueParameter({ id: 'text-only-model', name: 'Text Only' }, entry('text-only-model'));
  assert.deepEqual(row.input, ['text']);
  assert.equal(row.reasoningEfforts, undefined);
  assert.equal(row.contextWindow, 131072);
  assert.equal(row.maxTokens, 16384);
});

test('a model that reads images gets image input', () => {
  const row = withCatalogueParameter({ id: 'vision-model' }, entry('vision-model'));
  assert.deepEqual(row.input, ['text', 'image']);
});

test('a model that reads video only keeps the modalities the profile schema accepts', () => {
  const row = withCatalogueParameter({ id: 'video-model' }, entry('video-model'));
  assert.deepEqual(row.input, ['text', 'image']);
});

test('a reasoning model offers four levels that map to the wire values', () => {
  const row = withCatalogueParameter({ id: 'vision-model' }, entry('vision-model'));
  assert.deepEqual(Object.keys(row.reasoningEfforts), ['off', 'low', 'medium', 'high']);
  assert.equal(row.reasoningEfforts.off, null);
  assert.equal(row.reasoningEfforts.low, 'low');
  assert.equal(row.reasoningEfforts.medium, 'medium');
  assert.equal(row.reasoningEfforts.high, 'high');
  assert.ok(effortLevels().every((level) => level in row.reasoningEfforts));
});

test('the endpoint number wins over the catalogue', () => {
  const row = withCatalogueParameter({ id: 'vision-model', contextWindow: 500000 }, entry('vision-model'));
  assert.equal(row.contextWindow, 500000);
});

test('api aliases stay out of a row whose schema has no alias field', () => {
  // the catalogue names two aliases and states no output ceiling, so the row gets no alias and no maxTokens
  const row = withCatalogueParameter({ id: 'alias-model' }, entry('alias-model'));
  assert.deepEqual(Object.keys(row).sort(), ['contextWindow', 'id', 'input', 'name']);
  assert.equal(row.name, 'Aliased');
});

test('the resolver names no gateway and no vendor', () => {
  const text = fs.readFileSync(path.join(here, '..', 'lib', 'model-autofetch.mjs'), 'utf8');
  assert.equal(/oneaiapikey|one ai/i.test(text), false);
});

test('a name equal to the id is replaced by the catalogue name', () => {
  const row = withCatalogueParameter({ id: 'vision-model', name: 'vision-model' }, entry('vision-model'));
  assert.equal(row.name, 'Vision');
});

test('an id with no catalogue row reads as words', () => {
  assert.equal(prettyName('code-files'), 'Code Files');
  assert.equal(prettyName('video-tts-hd'), 'Video TTS HD');
  assert.equal(prettyName('web-fetch'), 'Web Fetch');
  assert.equal(prettyName('auto:best'), 'Auto Best');
  assert.equal(prettyName('flint-v1.0-2:free'), 'Flint v1.0 2');
  assert.equal(prettyName('nemotron-3-nano-omni-30b-a3b-reasoning'), 'Nemotron 3 Nano Omni 30B A3B Reasoning');
});

test('a readable name the endpoint supplied stays', () => {
  const row = withCatalogueParameter({ id: 'vision-model', name: 'Vision Pro' }, entry('vision-model'));
  assert.equal(row.name, 'Vision Pro');
});

test('a free tier marker is not part of the label', () => {
  assert.equal(prettyName('beam-1-0:free'), 'Beam 1.0');
  assert.equal(prettyName('z-ai-glm-5.3:free'), 'Z AI GLM 5.3');
});