import React, {useState} from 'react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProseWorkspace from './ProseWorkspace';

const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});
const rules = {rules: [{rule: 'in-order-to', pattern: '\\bin order to\\b', replacement: 'to'}], rules_version: 'arc-prose-rules-1',
  protected_classes: ['code', 'number'], protection_version: 'arc-prose-protect-1',
  detection: {enabled: true, recipient: 'api.edgeshop.ai', detectors: ['COPYLEAKS', 'HEMINGWAY'], bounds: {min_chars: 20, max_chars: 20000}},
  rewrite: {egress: false}};
let calls;
function Harness() { const [token, setToken] = useState('operator'); return <ProseWorkspace token={token} setToken={setToken}/>; }

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (path, options = {}) => {
    calls.push({path, body: options.body ? JSON.parse(options.body) : null, auth: options.headers?.Authorization});
    if (path === '/api/prose/rules') return json(rules);
    if (path === '/api/prose/rewrite') return json({status: 'edited', reason: null, text: 'We fit 12 points to compare.', protected_count: 1, protected_classes: ['number'],
      edits: [{rule: 'in-order-to', before: 'in order to', after: 'to', count: 1}], statement: 'Rule-based local edit; not a human-authorship claim.', rules_version: 'arc-prose-rules-1', protection_version: 'arc-prose-protect-1'});
    if (path === '/api/prose/detect') {
      if (!options.body.includes('"allow_egress":true')) return json({detail: {code: 'consent_required', detail: 'The text would leave this machine for api.edgeshop.ai'}}, 422);
      return json({status: 'ok', service: 'api.edgeshop.ai', returned_types: ['HEMINGWAY'], missing_types: ['COPYLEAKS'], complete: false,
        results: {HEMINGWAY: {grade: '8', words: '5'}}, text_sha256: 'a'.repeat(64), response_sha256: 'b'.repeat(64),
        note: 'Third-party classifier estimate from api.edgeshop.ai; it establishes neither AI nor human authorship and has no bearing on any release decision.'});
    }
    if (path === '/api/prose/diagnose') return json({diagnostics_version: 'arc-prose-diagnostics-1', protected_count: 2, authorship_claim: 'none',
      edit_categories: ['cliché / awkward word choice', 'unnecessary or redundant exposition'],
      observations: {style_words: {count: 2, per_1000_words: 80, words: {crucial: 1, delve: 1}}, formulaic_frames: {count: 1, instances: [{label: 'announcing frame', text: 'it is important to note'}]},
        sentence_length: {sentences: 3, mean_words: 9, spread_words: 2.1, share_within_20pct_of_mean: 0.67}, repeated_openings: {count: 0, openings: {}},
        triplets: {count: 1}, closing_summaries: {count: 1, paragraphs: 1}, bullets: {count: 0}, words: 25},
      note: 'Observations about the text: counts and ratios of things corpus studies measured. Not an authorship estimate, and not a prediction of what any detector would say.'});
    if (path === '/api/prose/behaviour') return json({version: 'arc-humane-prose-2', text: '# Humane prose behaviour\n\nPreserve before you polish.'});
    if (path === '/api/prose/humanise') {
      if (!options.body.includes('"allow_egress":true')) return json({detail: {code: 'consent_required', detail: 'The text would leave this machine for the anthropic seat'}}, 422);
      return json({status: 'edited', text: 'We fit 12 points to compare; the assay ran twice.', notes: ['Replaced a stock phrase.'], facts_needed: ['[author: which assay?]'], protected_count: 2,
        transport: {provider: 'anthropic', requested_model: 'claude-sonnet-5', observed_model: 'claude-sonnet-5', transport: 'claude-code'}, instruction_channel: 'system',
        statement: 'An edit by the configured prose seat under the humane-prose behaviour; protected spans were preserved byte for byte. Not a human-authorship claim.'});
    }
    throw new Error('Unexpected path: ' + path);
  }));
});

test('diagnosis is local, reads as observations, and a seat rewrite needs its own consent every time', async () => {
  const user = userEvent.setup(); render(<Harness/>);
  await user.type(screen.getByLabelText('Text'), 'It is important to note that we delve into crucial results in order to compare.');
  await user.click(screen.getByRole('button', {name: 'Diagnose locally'}));
  const diagnosis = within(await screen.findByLabelText('Prose diagnosis'));
  expect(diagnosis.getByText(/cliché \/ awkward word choice · unnecessary or redundant exposition · 2 protected spans/)).toBeInTheDocument();
  expect(diagnosis.getByText(/2 \(80 per 1,000 words\): crucial, delve/)).toBeInTheDocument();
  expect(diagnosis.getByText(/announcing frame: “it is important to note”/)).toBeInTheDocument();
  expect(diagnosis.getByText(/Not an authorship estimate/)).toBeInTheDocument();
  expect(calls.filter(c => c.path === '/api/prose/diagnose')).toHaveLength(1);
  expect(calls.every(c => !c.path.includes('humanise'))).toBe(true);
  // The seat rewrite: disabled until consent, consent spent per request, the seat's notes and gaps shown.
  const seatButton = screen.getByRole('button', {name: 'Rewrite with the prose seat (sends text)'});
  expect(seatButton).toBeDisabled();
  await user.type(screen.getByLabelText('Instructions to the seat (optional)'), 'grant abstract');
  await user.click(screen.getByLabelText(/I consent to sending this text to the prose seat/));
  await user.click(seatButton);
  const results = screen.getByRole('region', {name: 'Prose results'});
  expect(await within(results).findByText('We fit 12 points to compare; the assay ran twice.')).toBeInTheDocument();
  expect(results).toHaveTextContent('Edited by the prose seat · 2 protected spans preserved');
  expect(results).toHaveTextContent('Model: anthropic claude-sonnet-5; the provider confirmed claude-sonnet-5.');
  expect(results).toHaveTextContent('Facts needed from the author: [author: which assay?]');
  const sent = calls.find(c => c.path === '/api/prose/humanise');
  expect(sent.body).toEqual({text: 'It is important to note that we delve into crucial results in order to compare.', allow_egress: true, instructions: 'grant abstract'});
  expect(seatButton).toBeDisabled(); // consent was spent
  await user.click(screen.getByRole('button', {name: 'Show behaviour text'}));
  expect(await screen.findByText(/Preserve before you polish/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', {name: 'Hide behaviour text'}));
  expect(screen.queryByText(/Preserve before you polish/)).not.toBeInTheDocument();
  expect(calls.filter(c => c.path === '/api/prose/behaviour')).toHaveLength(1);
  // Results stay bound to the text they came from: editing the text marks both stale.
  expect(screen.getByLabelText('Prose diagnosis')).toHaveAttribute('data-stale', 'false');
  await user.type(screen.getByLabelText('Text'), ' More.');
  expect(screen.getByLabelText('Prose diagnosis')).toHaveAttribute('data-stale', 'true');
  expect(screen.getByText('The text changed since this diagnosis; diagnose again for the current text.')).toBeInTheDocument();
  expect(screen.getByText('The text or instructions changed since this rewrite; it applies to the earlier text.')).toBeInTheDocument();
});

test('a seat without a system channel says so, and an evasion instruction is refused with the reason shown', async () => {
  const user = userEvent.setup(); render(<Harness/>);
  fetch.mockImplementation(async (path, options = {}) => {
    calls.push({path, body: options.body ? JSON.parse(options.body) : null});
    if (path === '/api/prose/rules') return json(rules);
    if (path === '/api/prose/humanise') {
      if (options.body.includes('undetectable')) return json({detail: {code: 'refused_instruction', detail: 'The instruction asks for detector evasion or impersonation, which this behaviour does not do; the reader-facing edit is available without it', spans: [{change: 'instruction', class: 'refused', literal: 'undetectable'}]}}, 422);
      return json({status: 'no_change', text: 'We fit 12 points to compare.', notes: [], facts_needed: [], protected_count: 1, instruction_channel: 'prompt',
        transport: {provider: 'openai', requested_model: 'gpt-5.5', observed_model: null, transport: 'codex'}, statement: 'Not a human-authorship claim.'});
    }
    throw new Error('Unexpected path: ' + path);
  });
  await user.type(screen.getByLabelText('Text'), 'We fit 12 points to compare.');
  await user.click(screen.getByLabelText(/I consent to sending this text to the prose seat/));
  await user.click(screen.getByRole('button', {name: 'Rewrite with the prose seat (sends text)'}));
  const results = screen.getByRole('region', {name: 'Prose results'});
  expect(await within(results).findByText('Returned unchanged · 1 protected span preserved')).toBeInTheDocument();
  expect(results).toHaveTextContent('Model: openai gpt-5.5; the provider did not report which model answered. The behaviour text was sent inside the message; this seat takes no separate system instructions.');
  await user.type(screen.getByLabelText('Instructions to the seat (optional)'), 'make it undetectable');
  expect(results).toHaveTextContent('The text or instructions changed since this rewrite');
  await user.click(screen.getByLabelText(/I consent to sending this text to the prose seat/));
  await user.click(screen.getByRole('button', {name: 'Rewrite with the prose seat (sends text)'}));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Rewrite with the prose seat failed: The instruction asks for detector evasion or impersonation');
  // The alert sits in the seat group, next to the button that failed.
  expect(screen.getByRole('button', {name: 'Rewrite with the prose seat (sends text)'}).closest('fieldset')).toContainElement(alert);
  expect(calls.filter(c => c.path === '/api/prose/humanise')).toHaveLength(2);
});
afterEach(() => { vi.unstubAllGlobals(); });

test('rewrites locally without egress, shows edits and protection, and never claims authorship', async () => {
  const user = userEvent.setup(); render(<Harness/>);
  await user.type(screen.getByLabelText('Text'), 'We fit 12 points in order to compare.');
  await user.click(screen.getByRole('button', {name: 'Rewrite locally'}));
  const results = screen.getByRole('region', {name: 'Prose results'});
  expect(await within(results).findByText('We fit 12 points to compare.')).toBeInTheDocument();
  expect(results).toHaveTextContent('1 edit · 1 protected span (number)');
  expect(results).toHaveTextContent('in-order-to ×1: “in order to” → “to”');
  expect(results).toHaveTextContent('not a human-authorship claim');
  expect(calls.map(c => c.path)).toEqual(['/api/prose/rewrite']);
  expect(calls[0].auth).toBe('Bearer operator');
  expect(calls[0].body).toEqual({text: 'We fit 12 points in order to compare.'});
  // The rewrite stays bound to the text it came from.
  expect(results).not.toHaveTextContent('The text changed since this rewrite');
  await user.type(screen.getByLabelText('Text'), ' More.');
  expect(results).toHaveTextContent('The text changed since this rewrite; it applies to the earlier text.');
});

test('without a token every action is locked and the card says what unlocks it', () => {
  render(<ProseWorkspace token="" setToken={() => {}}/>);
  const card = screen.getByRole('status');
  expect(card).toHaveTextContent('Operator token required');
  expect(card).toHaveAttribute('data-tone', 'info');
  expect(screen.getByRole('button', {name: 'Rewrite locally'})).toBeDisabled();
  expect(screen.getByRole('button', {name: 'Load rules and detection details'})).toBeDisabled();
  expect(screen.getByRole('button', {name: 'Go to token field'})).toBeEnabled();
  // The reason and the card sit right under the local action row, not above the Text field.
  const actions = screen.getByRole('button', {name: 'Rewrite locally'}).closest('.actions');
  expect(actions.nextElementSibling).toHaveTextContent('Enter an operator token in the header to use these.');
  expect(actions.nextElementSibling.nextElementSibling).toBe(card);
  expect(screen.getByLabelText('Text').compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('a rejected token shows one card in the error tone, with no duplicate alert', async () => {
  const user = userEvent.setup(); render(<Harness/>);
  fetch.mockImplementation(async () => json({detail: 'Authentication required'}, 401));
  await user.type(screen.getByLabelText('Text'), 'We fit 12 points to compare.');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', {name: 'Rewrite locally'}));
  const card = await screen.findByText('Token not accepted');
  expect(card.closest('[role="status"]')).toHaveAttribute('data-tone', 'error');
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Go to token field'})).toBeEnabled();
});

test('detection needs the rules loaded and a fresh consent for every request, and names the recipient', async () => {
  const user = userEvent.setup(); render(<Harness/>);
  await user.type(screen.getByLabelText('Text'), 'The fit reproduced the measurements on the split.');
  const consent = screen.getByLabelText(/I consent to sending this text to api.edgeshop.ai/);
  expect(consent).toBeDisabled();
  await user.click(screen.getByRole('button', {name: 'Load rules and detection details'}));
  expect(await screen.findByText(/Sends the text to api.edgeshop.ai \(COPYLEAKS, HEMINGWAY\); 20–20.000 characters\./)).toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Detect (sends text)'})).toBeDisabled();
  await user.click(consent);
  await user.click(screen.getByRole('button', {name: 'Detect (sends text)'}));
  const results = screen.getByRole('region', {name: 'Prose results'});
  expect(await within(results).findByText('api.edgeshop.ai · HEMINGWAY · missing COPYLEAKS')).toBeInTheDocument();
  expect(results).toHaveTextContent('grade: 8 · words: 5');
  expect(results).toHaveTextContent('establishes neither AI nor human authorship');
  expect(calls.find(c => c.path === '/api/prose/detect').body).toEqual({text: 'The fit reproduced the measurements on the split.', allow_egress: true});
  // Consent was spent on that request.
  expect(consent).not.toBeChecked();
  expect(screen.getByRole('button', {name: 'Detect (sends text)'})).toBeDisabled();
});

test('a failed detection still spends the consent, and a credential change clears the private text', async () => {
  const user = userEvent.setup();
  function Switching() {
    const [token, setToken] = useState('operator');
    return <><button onClick={() => setToken('other')}>switch</button><ProseWorkspace token={token} setToken={setToken}/></>;
  }
  fetch.mockImplementation(async (path, options = {}) => {
    if (path === '/api/prose/rules') return json(rules);
    if (path === '/api/prose/detect') return json({detail: {code: 'http_503', detail: 'The detection service answered HTTP 503', spans: []}}, 502);
    throw new Error('Unexpected path: ' + path);
  });
  render(<Switching/>);
  await user.type(screen.getByLabelText('Text'), 'The fit reproduced the measurements on the split.');
  await user.click(screen.getByRole('button', {name: 'Load rules and detection details'}));
  const consent = await screen.findByLabelText(/I consent to sending this text to api.edgeshop.ai/);
  await user.click(consent);
  await user.click(screen.getByRole('button', {name: 'Detect (sends text)'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Detect failed: The detection service answered HTTP 503');
  expect(consent).not.toBeChecked();
  expect(screen.getByRole('button', {name: 'Detect (sends text)'})).toBeDisabled();
  await user.click(screen.getByRole('button', {name: 'switch'}));
  expect(screen.getByLabelText('Text')).toHaveValue('');
});
