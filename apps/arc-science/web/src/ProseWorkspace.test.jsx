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
    throw new Error('Unexpected path: ' + path);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

test('rewrites locally without egress, shows edits and protection, and never claims authorship', async () => {
  const user = userEvent.setup(); render(<Harness/>);
  await user.type(screen.getByLabelText('Text'), 'We fit 12 points in order to compare.');
  await user.click(screen.getByRole('button', {name: 'Rewrite locally'}));
  const results = screen.getByRole('region', {name: 'Prose results'});
  expect(await within(results).findByText('We fit 12 points to compare.')).toBeInTheDocument();
  expect(results).toHaveTextContent('1 edits · 1 protected spans (number)');
  expect(results).toHaveTextContent('in-order-to ×1: “in order to” → “to”');
  expect(results).toHaveTextContent('not a human-authorship claim');
  expect(calls.map(c => c.path)).toEqual(['/api/prose/rewrite']);
  expect(calls[0].auth).toBe('Bearer operator');
  expect(calls[0].body).toEqual({text: 'We fit 12 points in order to compare.'});
});

test('detection needs the rules loaded and a fresh consent for every request, and names the recipient', async () => {
  const user = userEvent.setup(); render(<Harness/>);
  await user.type(screen.getByLabelText('Text'), 'The fit reproduced the measurements on the split.');
  const consent = screen.getByLabelText(/I consent to sending this text to api.edgeshop.ai/);
  expect(consent).toBeDisabled();
  await user.click(screen.getByRole('button', {name: 'Show rules and detection terms'}));
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
