import React from 'react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResearchWorkspace from './ResearchWorkspace';
import {SESSION_COPY} from './http';

const json = data => new Response(JSON.stringify(data), {headers: {'Content-Type': 'application/json'}});
const mission = {id: 'private-mission', request: {mode: 'demo'}, release: {policy_digest: 'p'.repeat(64), subject_digest: 's'.repeat(64), status: 'eligible_for_human_review', eligible_for_human_review: true, blocking_reasons: [], decided_at: 1, verification: null, checks: []}, state: {status: 'paused', round: 1, actions_used: 3, model_calls_used: 2, data_origin: 'fixture', branches: [], assessments: [], observations: [], events: [], visual_reports: [], artifacts: [], stop_reason: 'Private stop reason'}};
const report = {integrity: true, reproduction_passed: true, reproduced: 3, artifacts_reproduced: 2, evidence_graph_valid: true, scientific_validity_established: false, failures: []};
// GET /api/readiness as the shared contract shapes it; the server is the only authority on seat states.
const ROLES = [['planner', 'Planner'], ['reviewer', 'Reviewer (QA)'], ['falsifier', 'Falsifier'], ['vision', 'Vision'], ['prose', 'Prose']];
const facts = {provider: 'anthropic', model: 'claude-sonnet-4-5', effort: 'medium', auth: 'api_key', transport: 'api'};
const seat = (role, label, over = {}) => ({role, label, state: 'blocked', code: 'seat.unconfigured', facts: {...facts, provider: '', model: ''}, verification: {status: 'not_applicable'}, meaning: label + ' is not set.', next_action: 'Set a ' + label + ' seat in Settings.', source: 'settings revision abcdef012345', ...over});
const readinessOf = (live, seats = {}) => ({checked_at: 1, roles: ROLES.map(([role, label]) => ({role, label})), seats: Object.fromEntries(ROLES.map(([role, label]) => [role, seats[role] || seat(role, label)])), live_mission: live});
const blockedReadiness = readinessOf({state: 'blocked', code: 'live.blocked', blocking: ['planner'], meaning: 'A live mission cannot start.', next_action: 'Fix the blocked seats in Settings.'},
  {planner: seat('planner', 'Planner', {state: 'blocked', code: 'seat.credential_missing', facts, meaning: 'No API key is stored for the planner seat.', next_action: 'Store the anthropic API key in Settings → Connections.'})});
const untestedReadiness = readinessOf({state: 'not_tested', code: 'live.not_tested', blocking: [], meaning: 'Seats are set but not tested.', next_action: 'Probe the seats in Settings.'},
  {planner: seat('planner', 'Planner', {state: 'not_tested', code: 'seat.not_tested', facts, meaning: 'Set, never tested.', next_action: 'Run a probe.'})});
// GET /api/missions/preview and GET /api/missions/{mid}/grants as the slice 3 contract shapes them; the ledger is operational, never evidence.
const SEAT_DATA = 'mission goal, dataset points, prior observations and assessments', TOOL_DATA = 'tool arguments the planner chooses';
const preview = {settings_revision: 'rev-7', route_digest: 'd'.repeat(64),
  seats: [{role: 'planner', provider: 'anthropic', transport: 'api', model: 'claude-sonnet-4-5', effort: 'medium', destination: 'https://api.anthropic.com', destination_kind: 'seat', data_category: SEAT_DATA, purpose: 'planning, review and refutation'}],
  connectors: [{name: 'pubmed', kind: 'mcp', destination: 'npx pubmed-mcp', destination_kind: 'mcp', data_category: TOOL_DATA, purpose: 'consultation or tool call'}], public_reads: [],
  required_grants: [{destination: 'https://api.anthropic.com', destination_kind: 'seat', data_category: SEAT_DATA, purpose: 'planning, review and refutation', scope: 'mission'}, {destination: 'npx pubmed-mcp', destination_kind: 'mcp', data_category: TOOL_DATA, purpose: 'consultation or tool call', scope: 'mission'}]};
const GRANT = 'g'.repeat(32);
const ledger = {grants: [
  {id: GRANT, subject_kind: 'mission', subject_id: mission.id, destination: 'https://api.anthropic.com', destination_kind: 'seat', data_category: SEAT_DATA, purpose: 'planning, review and refutation', scope: 'mission', state: 'active', uses: 2, max_uses: null, last_used_at: 1700000000, revoked_at: null},
  {id: 'h'.repeat(32), subject_kind: 'mission', subject_id: mission.id, destination: 'npx pubmed-mcp', destination_kind: 'mcp', data_category: TOOL_DATA, purpose: 'consultation or tool call', scope: 'mission', state: 'revoked', uses: 0, max_uses: null, last_used_at: null, revoked_at: 1700000100},
], receipts: [
  {id: 'r1', grant_id: GRANT, mission_id: mission.id, destination: 'https://api.anthropic.com', destination_kind: 'seat', data_category: SEAT_DATA, at: 1700000000, outcome: 'ok', reason: '', request_digest: null, observation_id: 'obs-3', role: 'planner'},
  {id: 'r2', grant_id: null, mission_id: mission.id, destination: 'npx pubmed-mcp', destination_kind: 'mcp', data_category: TOOL_DATA, at: 1700000200, outcome: 'denied', reason: 'grant revoked', request_digest: 'q'.repeat(64), observation_id: null, role: null},
]};
const empty = {grants: [], receipts: []};
// GET /api/missions/{mid}/timeline and /claims as the slice 4 contract shapes them: the timeline is operational, the cards are derived on read.
const TIMELINE_NOTE = 'Operational record written by the service worker and operator routes; not scientific evidence. A row whose outcome is not recorded is in flight while the mission status is running; otherwise it was abandoned by a pause, a cancellation or a service exit.';
const noTimeline = {mission_id: mission.id, kind: 'operational', recorded: false, count: 0, rows: [], note: TIMELINE_NOTE};
const CLAIMS_NOTE = 'Claim cards are derived on read from the persisted claim scope, the recorded reconciliation, the evidence graph and the operational timeline; nothing here is validation.';
const UNCERTAINTY_NOTE = 'MSE values are errors on the exploratory validation split of the frozen dataset; no confidence interval or standard error is computed in this build.';
const noClaims = {mission_id: mission.id, source: 'derived', derivation_version: null, current_derivation_version: 'arc-claim-scope-3', basis_round: null, rule: null, evidence_graph: 'valid', uncertainty_note: UNCERTAINTY_NOTE, note: CLAIMS_NOTE, claims: []};
const timelineRow = (sequence, over) => ({id: 'op' + sequence, sequence, started_at: 1758463205100 + sequence * 10, finished_at: 1758463205105 + sequence * 10, operation: 'plan', role: 'planner', source: 'worker', round: 0, transport: 'fixture', model_requested: 'scripted-fixture-v1', model_observed: null, identity_verified: null, tool: null, action_id: null, branch_id: null, actor: null, receipt_id: null, outcome: 'ok', outcome_source: 'recorded', detail: '', ...over});
const timelineRows = [
  timelineRow(1, {operation: 'start', role: 'operator', source: 'operator', transport: null, model_requested: null, actor: 'operator:token', outcome: 'scheduled'}),
  timelineRow(2, {operation: 'plan', transport: 'cli', model_requested: 'claude-opus-5', model_observed: 'claude-opus-5', identity_verified: true, receipt_id: '5f0c' + 'a'.repeat(28)}),
  timelineRow(4, {operation: 'tool', role: 'tool', transport: null, model_requested: null, tool: 'polynomial_fit', action_id: 'fit-linear', branch_id: 'linear'}),
  timelineRow(6, {operation: 'reconcile', role: 'analyst', identity_verified: false, model_observed: 'scripted-fixture-v1', outcome: 'denied', receipt_id: '7a1e' + 'b'.repeat(28)}),
  timelineRow(8, {operation: 'plan', round: 1, finished_at: null, outcome: 'outcome_unknown', outcome_source: 'derived'}),
  timelineRow(9, {operation: 'interrupt', role: 'service', source: 'service', round: 1, transport: null, model_requested: null, outcome: 'interrupted', detail: 'Service exit noticed; the mission was running and is now paused (event mission_interrupted). Rows above without a recorded outcome were abandoned.'}),
];
const recordedTimeline = {...noTimeline, recorded: true, count: timelineRows.length, rows: timelineRows};
const exampleClaim = {claim_id: 'quadratic', branch_id: 'quadratic', title: 'Curved response', requested: 'The response requires a quadratic term.', status: 'unresolved',
  supported_scope: ['analyst: Low error on the exploratory split.', 'falsifier: Low error on the exploratory split. Adaptive reuse of this split prevents confirmatory interpretation.'], scope_qualifier: 'on the exploratory validation split of the frozen dataset; not independent data',
  uncertainties: [{reason: 'shared_identity', role: null, detail: 'Both roles ran as the same model identity (scripted-fixture-v1); separate invocations are not independent reviewers.', evidence_ids: []}],
  evidence: [{id: 'fit-quadratic', tool: 'polynomial_fit', tool_version: 'arc-numeric-2', method: 'polynomial_fit@arc-numeric-2', digest: '9c4e' + 'f'.repeat(60), status: 'ok', claim_eligible: true, replayable: true, counts_for_scope: true, source_kind: 'builtin', round: 1, started_at: 1758463205400, finished_at: 1758463205460, time_source: 'timeline', receipt_id: null, numeric_summary: {degree: 2, training_mse: 0.0016, validation_mse: 0.0014, n_train: 48, n_validation: 16, split: 'index_mod_4_zero_validation'}, endpoint: null, response_sha256: null},
    {id: 'shuffle-quadratic', tool: 'permutation_control', tool_version: 'arc-numeric-2', method: 'permutation_control@arc-numeric-2', digest: '1b2c' + 'e'.repeat(60), status: 'ok', claim_eligible: true, replayable: true, counts_for_scope: false, source_kind: 'builtin', round: 1, started_at: null, finished_at: null, time_source: 'none', receipt_id: null, numeric_summary: {permutations: 20, mean_shuffled_validation_mse: 0.9, minimum_shuffled_validation_mse: 0.4}, endpoint: null, response_sha256: null}],
  independence: {roles_present: ['analyst', 'falsifier'], roles: {analyst: {model: 'scripted-fixture-v1', round: 1, identity_verified: null, identity_source: null}, falsifier: {model: 'scripted-fixture-v1', round: 1, identity_verified: null, identity_source: null}}, independent: false, reasons: ['shared_identity']},
  findings: [{role: 'analyst', round: 1, model: 'scripted-fixture-v1', position: 'support', finding: 'Low error on the exploratory split.', next_test: 'Use independently acquired data before a scientific conclusion.', evidence_ids: ['fit-quadratic']}],
  alternatives: {parents: ['linear'], children: [], siblings: ['null-control'], conflicts: [{branch_id: 'quadratic', positions: ['support', 'challenge'], assessment_ids: ['a-3', 'a-4'], evidence_ids: ['fit-quadratic']}], conflicts_source: 'evidence_graph'},
  next_tests: [{role: 'analyst', round: 1, test: 'Use independently acquired data before a scientific conclusion.', evidence_ids: ['fit-quadratic']}],
  units: null, units_note: 'No units are recorded: mission points are bare x/y numbers (models.Point) and no tool in this build reports a unit.',
  stale_derivation: false, stale_reason: '', claim_scope_check: 'satisfied'};
const exampleClaims = {...noClaims, derivation_version: 'arc-claim-scope-3', basis_round: 2, rule: 'A narrower conclusion is a valid research output. Nothing above is scientific validation.', claims: [exampleClaim]};
const conflict = detail => new Response(JSON.stringify({detail}), {status: 409, headers: {'Content-Type': 'application/json'}});
const renderLive = (readiness, extra = {}) => {
  const refreshReadiness = vi.fn(async () => {}), onNavigate = vi.fn();
  const view = render(<ResearchWorkspace token="operator" setToken={vi.fn()} readiness={readiness} readinessError={null} refreshReadiness={refreshReadiness} onNavigate={onNavigate} {...extra}/>);
  return {...view, refreshReadiness, onNavigate};
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (path, options = {}) => {
    if (path === '/api/missions') return json(options.method === 'POST' ? mission : [{id: mission.id, status: 'paused', goal: 'Private saved question', mode: 'demo'}]);
    if (path.startsWith('/api/missions/preview')) return json(preview);
    if (path.endsWith('/grants')) return json(empty);
    if (path.endsWith('/timeline')) return json(noTimeline);
    if (path.endsWith('/claims')) return json(noClaims);
    if (path.endsWith('/verify')) return json(report);
    if (path.endsWith('/capsule')) return new Response('private archive');
    return json(mission);
  }));
  URL.createObjectURL = vi.fn(() => 'blob:private-artifact'); URL.revokeObjectURL = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function openMission(user) {
  await user.click(screen.getByRole('button', {name: 'Load missions'}));
  await user.click(await screen.findByRole('button', {name: /(paused|running) · Private saved question/}));
  await screen.findByText('Selected mission: private-mission');
}

test('switching away from a validated credential clears private drafts and consent', async () => {
  const user = userEvent.setup(); const setToken = vi.fn();
  const {rerender} = render(<ResearchWorkspace token="old-token" setToken={setToken}/>);
  await openMission(user);
  await user.clear(screen.getByLabelText('Research goal'));
  await user.type(screen.getByLabelText('Research goal'), 'Unpublished question');
  await user.click(screen.getByText('Execution settings'));
  fireEvent.change(screen.getByLabelText('Measurement JSON'), {target: {value: '{"x":[1],"y":[2]}' }});
  await user.click(screen.getByLabelText(/Permit sending/));
  await user.click(screen.getByLabelText(/Require configured visual review/));
  await user.click(screen.getByRole('button', {name: 'Replay and verify'}));
  await screen.findByText(/3 computations/);
  rerender(<ResearchWorkspace token="new-token" setToken={setToken}/>);
  expect(screen.queryByText('Selected mission: private-mission')).not.toBeInTheDocument();
  expect(screen.queryByText(/Private stop reason/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {name: /Private saved question/})).not.toBeInTheDocument();
  expect(screen.queryByText(/3 computations/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Research goal')).toHaveValue('');
  await user.click(screen.getByText('Execution settings'));
  expect(screen.getByLabelText('Measurement JSON')).toHaveValue('');
  expect(screen.getByLabelText(/Permit sending/)).not.toBeChecked();
  expect(screen.getByLabelText(/Require configured visual review/)).not.toBeChecked();
});

test('initial unlock preserves the draft but resets explicit egress consent', async () => {
  const user = userEvent.setup();
  const {rerender} = render(<ResearchWorkspace token="" setToken={vi.fn()}/>);
  await user.type(screen.getByLabelText('Research goal'), 'Draft before unlock');
  await user.click(screen.getByText('Execution settings'));
  await user.click(screen.getByLabelText(/Permit sending/));
  await user.click(screen.getByLabelText(/Require configured visual review/));

  rerender(<ResearchWorkspace token="candidate-token" setToken={vi.fn()}/>);

  expect(screen.getByLabelText('Research goal')).toHaveValue('Draft before unlock');
  expect(screen.getByLabelText(/Permit sending/)).not.toBeChecked();
  expect(screen.getByLabelText(/Require configured visual review/)).not.toBeChecked();
});

test('expired credential recovery preserves the draft while resetting consent', async () => {
  const user = userEvent.setup(); const setToken = vi.fn();
  const {rerender} = render(<ResearchWorkspace token="old-token" setToken={setToken}/>);
  await openMission(user);
  await user.clear(screen.getByLabelText('Research goal'));
  await user.type(screen.getByLabelText('Research goal'), 'Draft after expiry');
  await user.click(screen.getByText('Execution settings'));
  await user.click(screen.getByLabelText(/Permit sending/));
  fetch.mockImplementationOnce(async () => new Response(JSON.stringify({detail: 'expired'}), {status: 401, headers: {'Content-Type': 'application/json'}}));

  await user.click(screen.getByRole('button', {name: 'Replay and verify'}));
  // The rejected token is stated once, by the lock notice in its error tone; no separate alert repeats it.
  expect((await screen.findByText(SESSION_COPY.expired.title)).closest('[role="status"]')).toHaveAttribute('data-tone', 'error');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  rerender(<ResearchWorkspace token="replacement-token" setToken={setToken}/>);

  expect(screen.getByLabelText('Research goal')).toHaveValue('Draft after expiry');
  expect(screen.getByLabelText(/Permit sending/)).not.toBeChecked();
});

test('an old mission-list body cannot restore private content after a token change', async () => {
  let finish;
  fetch.mockImplementationOnce(async () => ({ok: true, json: () => new Promise(resolve => { finish = resolve; })}));
  const user = userEvent.setup(); const setToken = vi.fn();
  const {rerender} = render(<ResearchWorkspace token="old-token" setToken={setToken}/>);
  await user.click(screen.getByRole('button', {name: 'Load missions'}));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  const signal = fetch.mock.calls[0][1].signal;
  rerender(<ResearchWorkspace token="new-token" setToken={setToken}/>);
  expect(signal.aborted).toBe(true);
  await act(async () => finish([{id: mission.id, status: 'paused', goal: 'Private saved question'}]));
  expect(screen.queryByText(/Private saved question/)).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Load missions'})).not.toBeDisabled();
});

test('a stale create response cannot start the mission with the previous token', async () => {
  let finish;
  fetch.mockImplementationOnce(async () => ({ok: true, json: () => new Promise(resolve => { finish = resolve; })}));
  const user = userEvent.setup(); const setToken = vi.fn();
  const {rerender} = render(<ResearchWorkspace token="old-token" setToken={setToken}/>);
  await user.type(screen.getByLabelText('Research goal'), 'Draft mission');
  await user.click(screen.getByRole('button', {name: 'Create and start'}));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  rerender(<ResearchWorkspace token="new-token" setToken={setToken}/>);
  await act(async () => finish(mission));
  expect(fetch.mock.calls.some(([path]) => path.endsWith('/start'))).toBe(false);
  expect(screen.queryByText('Selected mission: private-mission')).not.toBeInTheDocument();
});

test('an in-flight capsule cannot download after the token is removed', async () => {
  const user = userEvent.setup(); const setToken = vi.fn();
  const {rerender} = render(<ResearchWorkspace token="old-token" setToken={setToken}/>);
  await openMission(user);
  let finish;
  fetch.mockImplementationOnce(async () => ({ok: true, blob: () => new Promise(resolve => { finish = resolve; })}));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await user.click(screen.getByRole('button', {name: 'Export replay archive (.zip)'}));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  rerender(<ResearchWorkspace token="" setToken={setToken}/>);
  await act(async () => finish(new Blob(['private archive'])));
  expect(click).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test('verification summarizes evidence without expanding the full JSON report', async () => {
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  await user.click(screen.getByRole('button', {name: 'Replay and verify'}));
  expect(await screen.findByText(/3 computations/)).toHaveTextContent('2 artifacts');
  expect(screen.getByText(/Scientific validity is not established/)).toBeVisible();
  const details = screen.getByText('Verification details').closest('details');
  expect(details).not.toHaveAttribute('open');
  await user.click(screen.getByText('Verification details'));
  expect(details).toHaveAttribute('open');
  expect(screen.getByText(/"reproduction_passed": true/)).toBeVisible();
});

test('secondary research traces are collapsed by default and readable on demand', async () => {
  const richMission = structuredClone(mission);
  richMission.state.assessments = [{role: 'analyst', branch_id: 'linear', position: 'challenge', finding: 'Residuals remain structured.', evidence_ids: ['fit-linear'], model: 'fixture'}];
  richMission.state.observations = [{id: 'obs-1', tool: 'fit_model', status: 'ok', data: {rmse: 0.42}}];
  richMission.state.events = [{round: 1, kind: 'decision', detail: 'Opened nonlinear route.'}];
  fetch.mockImplementation(async path => path === '/api/missions' ? json([{id: richMission.id, status: 'paused', goal: 'Private saved question'}]) : json(richMission));
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);

  await openMission(user);
  const reconciliation = screen.getByText(/^Reconciliation \(/).closest('details');
  const evidence = screen.getByText('Execution evidence').closest('details');
  const events = screen.getByText(/^Event history \(/).closest('details');

  expect(reconciliation).not.toHaveAttribute('open');
  expect(evidence).not.toHaveAttribute('open');
  expect(events).not.toHaveAttribute('open');
  expect(screen.getByText('Release decision: Eligible for human review')).toBeVisible();
  expect(screen.getByRole('region', {name: 'Claim scope'})).toBeVisible();

  await user.click(screen.getByText(/^Reconciliation \(/));
  expect(reconciliation).toHaveAttribute('open');
  expect(screen.getByText('Residuals remain structured.')).toBeVisible();
  await user.click(screen.getByText('Execution evidence'));
  await user.click(screen.getByText('obs-1 · fit_model · ok'));
  expect(screen.getByText(/"rmse": 0.42/)).toBeVisible();
  await user.click(screen.getByText(/^Event history \(/));
  expect(screen.getByText('[1] decision: Opened nonlinear route.')).toBeVisible();
});

test('locked and expired research states preserve the draft goal without raw 401 text', async () => {
  const user = userEvent.setup();
  const rendered = render(<ResearchWorkspace token="" setToken={vi.fn()}/>);
  await user.type(screen.getByLabelText('Research goal'), 'Draft assay question');
  expect(screen.getByRole('button', {name: 'Create and start'})).toBeDisabled();
  expect(screen.getByRole('button', {name: 'Load missions'})).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent(SESSION_COPY.locked.title);
  expect(screen.getByRole('status')).toHaveTextContent(SESSION_COPY.locked.text);
  expect(fetch).not.toHaveBeenCalled();

  fetch.mockImplementationOnce(async () => new Response(JSON.stringify({detail: 'bad token'}), {status: 401, headers: {'Content-Type': 'application/json'}}));
  rendered.rerender(<ResearchWorkspace token="expired-token" setToken={vi.fn()}/>);
  expect(screen.getByLabelText('Research goal')).toHaveValue('Draft assay question');
  await user.click(screen.getByRole('button', {name: 'Load missions'}));
  // One lock notice in its error tone beside Create and start; the Saved missions pane keeps only its own short line.
  const notice = await screen.findByRole('status');
  expect(notice).toHaveTextContent(SESSION_COPY.expired.title);
  expect(notice).toHaveAttribute('data-tone', 'error');
  expect(screen.getAllByText(SESSION_COPY.expired.title)).toHaveLength(1);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText(/Request failed \(401\)/)).not.toBeInTheDocument();
  const saved = screen.getByRole('complementary', {name: 'Saved missions'});
  expect(saved).toHaveTextContent('Enter an operator token to load saved missions.');
  expect(saved).not.toHaveTextContent(SESSION_COPY.expired.title);
  expect(screen.getByLabelText('Research goal')).toHaveValue('Draft assay question');
  expect(screen.getByRole('button', {name: 'Load missions'})).toBeDisabled();
  await user.click(screen.getByRole('button', {name: 'Go to token field'}));
});

test('expired background polling gates controls and stops repeat polling', async () => {
  const original = fetch.getMockImplementation();
  let firstMissionRead = true;
  fetch.mockImplementation(async (path, options = {}) => {
    if (path === '/api/missions') return json([{id: mission.id, status: 'running', goal: 'Private saved question'}]);
    if (path === '/api/missions/' + mission.id) {
      if (firstMissionRead) {
        firstMissionRead = false;
        return json({...mission, state: {...mission.state, status: 'running'}});
      }
      return new Response(JSON.stringify({detail: 'expired'}), {status: 401, headers: {'Content-Type': 'application/json'}});
    }
    return original(path, options);
  });
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  expect(await screen.findByText('running')).toBeInTheDocument();
  expect((await screen.findByText(SESSION_COPY.expired.title, {}, {timeout: 2500})).closest('[role="status"]')).toHaveAttribute('data-tone', 'error');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText(/Request failed \(401\)/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Replay and verify'})).toBeDisabled();
  expect(screen.getByRole('button', {name: 'Cancel'})).toBeDisabled();
  const missionReadsAfterExpiry = () => fetch.mock.calls.filter(([path]) => path === '/api/missions/' + mission.id).length;
  const afterExpiry = missionReadsAfterExpiry();
  await new Promise(resolve => setTimeout(resolve, 1200));
  expect(missionReadsAfterExpiry()).toBe(afterExpiry);
});

test('offline research errors keep service recovery copy separate from auth expiry', async () => {
  fetch.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await user.click(screen.getByRole('button', {name: 'Load missions'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(SESSION_COPY.offline.title);
  expect(screen.getByRole('alert')).not.toHaveTextContent(SESSION_COPY.expired.title);
  expect(screen.getByRole('button', {name: 'Load missions'})).not.toBeDisabled();
});

test('token removal revokes the loaded artifact and rejects an unfinished artifact body', async () => {
  const original = fetch.getMockImplementation();
  let finish;
  const readyDigest = 'a'.repeat(64), pendingDigest = 'b'.repeat(64);
  fetch.mockImplementation(async (path, options) => {
    if (path === '/api/missions/' + mission.id) return json({...mission, state: {...mission.state, artifacts: [
      {digest: readyDigest, source_observation_id: 'ready-observation'},
      {digest: pendingDigest, source_observation_id: 'pending-observation'},
    ]}});
    if (path.endsWith('/artifacts/' + readyDigest)) return new Response('ready artifact');
    if (path.endsWith('/artifacts/' + pendingDigest)) return {ok: true, blob: () => new Promise(resolve => { finish = resolve; })};
    return original(path, options);
  });
  const user = userEvent.setup(); const setToken = vi.fn();
  const {rerender} = render(<React.StrictMode><ResearchWorkspace token="old-token" setToken={setToken}/></React.StrictMode>);
  await openMission(user);
  await screen.findByRole('img', {name: 'Artifact from ready-observation'});
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  rerender(<React.StrictMode><ResearchWorkspace token="" setToken={setToken}/></React.StrictMode>);
  expect(screen.queryByRole('img', {name: 'Artifact from ready-observation'})).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-artifact');
  const callsBefore = URL.createObjectURL.mock.calls.length;
  await act(async () => finish(new Blob(['private unfinished artifact'])));
  expect(URL.createObjectURL).toHaveBeenCalledTimes(callsBefore);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

test('invalid measurement JSON is reported beside Create and start before any request, and the round limit is clamped', async () => {
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await user.type(screen.getByLabelText('Research goal'), 'Clamp and parse');
  await user.click(screen.getByText('Execution settings'));
  fireEvent.change(screen.getByLabelText(/Round limit/), {target: {value: '40'}});
  fireEvent.change(screen.getByLabelText('Measurement JSON'), {target: {value: '{"x":[1],'}});
  await user.click(screen.getByRole('button', {name: 'Create and start'}));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Measurement JSON is not valid JSON');
  expect(alert.previousElementSibling).toBe(screen.getByRole('button', {name: 'Create and start'}));
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Measurement JSON'), {target: {value: '{"x":[1],"y":[2]}'}});
  await user.click(screen.getByRole('button', {name: 'Create and start'}));
  await screen.findByText('Selected mission: private-mission');
  const sent = fetch.mock.calls.find(([path, options]) => path === '/api/missions' && options.method === 'POST');
  expect(JSON.parse(sent[1].body)).toMatchObject({max_rounds: 12, points: {x: [1], y: [2]}});
  // An offline mission's start carries no route approval; its ledger is read and says so.
  expect(fetch.mock.calls.find(([path]) => path.endsWith('/start'))[1].body).toBeUndefined();
  expect(fetch.mock.calls.some(([path]) => path.startsWith('/api/missions/preview'))).toBe(false);
  expect(await screen.findByRole('region', {name: 'Grants and receipts'})).toHaveTextContent('No grants. An offline fixture makes no external calls');
});

test('a live mission without consent cannot be created, and the mode note beside Create and start says why', async () => {
  // Seats read and configured (not tested): consent is then the only thing in the way.
  const user = userEvent.setup(); renderLive(readinessOf({state: 'not_tested', code: 'live.not_tested', blocking: [], meaning: 'The seats are configured; not every one is verified', next_action: null}));
  await user.type(screen.getByLabelText('Research goal'), 'Live question');
  const button = screen.getByRole('button', {name: 'Create and start'});
  expect(button).toBeEnabled();
  await user.click(screen.getByText('Execution settings'));
  await user.selectOptions(screen.getByLabelText('Model source'), 'live');
  expect(button).toBeDisabled();
  expect(button.parentElement).toHaveTextContent('A live mission is refused until you tick the consent box');
  await user.click(screen.getByLabelText(/Permit sending/));
  expect(button).toBeDisabled();
  expect(button.parentElement).toHaveTextContent('Tick Approve route under Execution settings');
  await user.click(await screen.findByLabelText('Approve route'));
  expect(button).toBeEnabled();
  expect(button.parentElement).toHaveTextContent("This mission's goal and data will be sent to them.");
  // Only the passive route preview was read; nothing was created or started.
  expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/missions/preview?vision_review=0']);
});

test('Create and start brings the results into view and keeps the composer as it is', async () => {
  const scrollIntoView = vi.fn(); Element.prototype.scrollIntoView = scrollIntoView;
  try {
    const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
    await user.type(screen.getByLabelText('Research goal'), 'Scroll question');
    await user.click(screen.getByRole('button', {name: 'Create and start'}));
    await screen.findByText('Selected mission: private-mission');
    expect(scrollIntoView).toHaveBeenCalledWith({block: 'start'});
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('region', {name: 'Research results'}));
    expect(screen.getByLabelText('Research goal')).toHaveValue('Scroll question');
  } finally { delete Element.prototype.scrollIntoView; }
});

test('live mode with blocked seats disables Create and start, names the seat and offers Settings', async () => {
  const user = userEvent.setup(); const {refreshReadiness, onNavigate} = renderLive(blockedReadiness);
  await user.type(screen.getByLabelText('Research goal'), 'Live question');
  await user.click(screen.getByText('Execution settings'));
  expect(refreshReadiness).not.toHaveBeenCalled();
  expect(screen.queryByRole('region', {name: 'Live route'})).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Model source'), 'live');
  await user.click(screen.getByLabelText(/Permit sending/));
  expect(refreshReadiness).toHaveBeenCalledTimes(1);
  const button = screen.getByRole('button', {name: 'Create and start'});
  expect(button).toBeDisabled();
  expect(button.parentElement).toHaveTextContent('Live models are blocked. Planner — Store the anthropic API key in Settings → Connections.');
  const route = screen.getByRole('region', {name: 'Live route'});
  expect(route).toHaveTextContent('Planner · anthropic · claude-sonnet-4-5 · medium · Blocked');
  expect(route).not.toHaveTextContent('Vision');
  expect(within(route).getByRole('status')).toHaveTextContent('Blocked by: Planner — Store the anthropic API key in Settings → Connections.');
  await user.click(within(route).getByRole('button', {name: 'Open Settings'}));
  expect(onNavigate).toHaveBeenCalledWith('settings');
  expect(fetch).not.toHaveBeenCalled();
});

test('seats that are set but not tested keep Create and start enabled and point to the probe', async () => {
  const user = userEvent.setup(); renderLive(untestedReadiness);
  await user.type(screen.getByLabelText('Research goal'), 'Live question');
  await user.click(screen.getByText('Execution settings'));
  await user.selectOptions(screen.getByLabelText('Model source'), 'live');
  await user.click(screen.getByLabelText(/Permit sending/));
  const route = screen.getByRole('region', {name: 'Live route'});
  expect(route).toHaveTextContent('Planner · anthropic · claude-sonnet-4-5 · medium · Not tested');
  expect(route).toHaveTextContent('Seats are configured but not tested; a probe is available in Settings → Connections.');
  expect(within(route).queryByRole('button', {name: 'Open Settings'})).not.toBeInTheDocument();
  await user.click(await screen.findByLabelText('Approve route'));
  expect(screen.getByRole('button', {name: 'Create and start'})).toBeEnabled();
  expect(screen.getByText('Execution settings').parentElement).toHaveTextContent('seats: Not tested');
});

test('the live route says when seats are still being read or could not be read', async () => {
  const user = userEvent.setup(); const {rerender, refreshReadiness, onNavigate} = renderLive(null);
  await user.type(screen.getByLabelText('Research goal'), 'Live question');
  await user.click(screen.getByText('Execution settings'));
  await user.selectOptions(screen.getByLabelText('Model source'), 'live');
  const route = screen.getByRole('region', {name: 'Live route'});
  expect(within(route).getByRole('status')).toHaveTextContent('Seats not read yet.');
  // Unread seats block the start rather than letting the composer send a request the panel meant to prevent.
  expect(screen.getByRole('button', {name: 'Create and start'})).toBeDisabled();
  expect(refreshReadiness).toHaveBeenCalledTimes(1);
  await user.click(within(route).getByRole('button', {name: 'Check seats'}));
  expect(refreshReadiness).toHaveBeenCalledTimes(2);
  rerender(<ResearchWorkspace token="operator" setToken={vi.fn()} readiness={null} readinessError="Readiness could not be read: the service is not reachable." refreshReadiness={refreshReadiness} onNavigate={onNavigate}/>);
  expect(within(route).getByRole('alert')).toHaveTextContent('Readiness could not be read');
  expect(fetch).not.toHaveBeenCalled();
});

test('the offline fixture ignores seat readiness and never asks for it', async () => {
  const user = userEvent.setup(); const {refreshReadiness} = renderLive(blockedReadiness);
  await user.type(screen.getByLabelText('Research goal'), 'Offline question');
  expect(screen.getByRole('button', {name: 'Create and start'})).toBeEnabled();
  await user.click(screen.getByText('Execution settings'));
  expect(screen.getByRole('option', {name: 'Offline fixture (scripted roles; nothing is sent)'}).selected).toBe(true);
  expect(screen.queryByRole('region', {name: 'Live route'})).not.toBeInTheDocument();
  expect(screen.queryByRole('region', {name: 'Route and grants'})).not.toBeInTheDocument();
  expect(refreshReadiness).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test('the mission overview and the saved list show the model source from the mission request', async () => {
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  const heading = screen.getByRole('heading', {name: 'Mission overview'}).closest('.results-heading');
  expect(heading).toHaveTextContent('paused');
  expect(heading).toHaveTextContent('Offline fixture');
  expect(screen.getByRole('button', {name: 'paused · Private saved question · Offline fixture'})).toBeInTheDocument();
});

test('release checks read in the shared readiness words', async () => {
  const checked = structuredClone(mission);
  checked.request.mode = 'live';
  checked.release = {...checked.release, status: 'blocked', eligible_for_human_review: false, blocking_reasons: ['replay_integrity:unknown'], checks: [{name: 'replay_integrity', state: 'unknown', reason: 'Not verified yet.'}, {name: 'visual_review', state: 'not_applicable', reason: 'No review requested.'}]};
  fetch.mockImplementation(async path => path === '/api/missions' ? json([{id: checked.id, status: 'paused', goal: 'Private saved question'}]) : json(checked));
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  const ledger = screen.getByRole('region', {name: 'Release decision'});
  expect(ledger).toHaveTextContent('replay integrity · unverified — Not verified yet.');
  expect(ledger).toHaveTextContent('visual review · n/a — No review requested.');
  expect(ledger).not.toHaveTextContent('not applicable');
  expect(screen.getByRole('heading', {name: 'Mission overview'}).closest('.results-heading')).toHaveTextContent('Live models');
});

async function liveComposer(user) {
  await user.type(screen.getByLabelText('Research goal'), 'Live question');
  await user.click(screen.getByText('Execution settings'));
  await user.selectOptions(screen.getByLabelText('Model source'), 'live');
  await user.click(screen.getByLabelText(/Permit sending/));
  return screen.getByRole('region', {name: 'Route and grants'});
}
const previewReads = () => fetch.mock.calls.filter(([path]) => path.startsWith('/api/missions/preview')).length;

test('live mode previews the route, gates Create and start on Approve route, and starts with the digest and grants', async () => {
  const user = userEvent.setup(); renderLive(untestedReadiness);
  const panel = await liveComposer(user);
  const rows = (await within(panel).findAllByRole('row')).slice(1);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('seat');
  expect(rows[0]).toHaveTextContent('planner · anthropic claude-sonnet-4-5');
  expect(rows[0]).toHaveTextContent('https://api.anthropic.com');
  expect(rows[0]).toHaveTextContent(SEAT_DATA);
  expect(rows[0]).toHaveTextContent('planning, review and refutation');
  expect(rows[1]).toHaveTextContent('mcp');
  expect(rows[1]).toHaveTextContent('pubmed');
  expect(rows[1]).toHaveTextContent('npx pubmed-mcp');
  expect(panel).toHaveTextContent('Route digest dddddddddddd · settings revision rev-7');
  expect(panel).toHaveTextContent('Settings consent only makes a destination eligible');
  const button = screen.getByRole('button', {name: 'Create and start'});
  expect(button).toBeDisabled();
  const approve = within(panel).getByLabelText('Approve route');
  expect(approve).not.toBeChecked();
  await user.click(approve);
  expect(button).toBeEnabled();
  await user.click(button);
  await screen.findByText('Selected mission: private-mission');
  const started = fetch.mock.calls.find(([path]) => path.endsWith('/start'));
  expect(started[1].method).toBe('POST');
  expect(JSON.parse(started[1].body)).toEqual({approved_route_digest: 'd'.repeat(64), grants: preview.required_grants});
  // The ledger of the new mission is read beside it.
  expect(fetch.mock.calls.some(([path]) => path === '/api/missions/private-mission/grants')).toBe(true);
});

test('the visual-review flag re-reads the preview and drops the earlier approval', async () => {
  const user = userEvent.setup(); renderLive(untestedReadiness);
  const panel = await liveComposer(user);
  await user.click(await within(panel).findByLabelText('Approve route'));
  expect(previewReads()).toBe(1);
  await user.click(screen.getByLabelText(/Require configured visual review/));
  await waitFor(() => expect(previewReads()).toBe(2));
  expect(fetch.mock.calls.at(-1)[0]).toBe('/api/missions/preview?vision_review=1');
  expect(await within(panel).findByLabelText('Approve route')).not.toBeChecked();
  expect(screen.getByRole('button', {name: 'Create and start'})).toBeDisabled();
});

test('a 409 from start is shown beside the button and Review the route again re-reads the preview and unticks', async () => {
  const original = fetch.getMockImplementation();
  fetch.mockImplementation(async (path, options = {}) => path.endsWith('/start') ? conflict('The route changed since it was previewed; review it again') : original(path, options));
  const user = userEvent.setup(); renderLive(untestedReadiness);
  const panel = await liveComposer(user);
  await user.click(await within(panel).findByLabelText('Approve route'));
  const button = screen.getByRole('button', {name: 'Create and start'});
  await user.click(button);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('The route changed since it was previewed; review it again');
  expect(alert.previousElementSibling).toBe(button);
  const review = screen.getByRole('button', {name: 'Review the route again'});
  expect(review).toBe(alert.nextElementSibling);
  expect(previewReads()).toBe(1);
  await user.click(review);
  await waitFor(() => expect(previewReads()).toBe(2));
  expect(await within(panel).findByLabelText('Approve route')).not.toBeChecked();
  expect(screen.queryByRole('button', {name: 'Review the route again'})).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(button).toBeDisabled();
  // The created mission stays selected; its Start waits for an approved route.
  expect(screen.getByText('Selected mission: private-mission')).toBeVisible();
});

test('a preview without a route digest is an error line with a retry, never a route to approve', async () => {
  const original = fetch.getMockImplementation();
  fetch.mockImplementation(async (path, options = {}) => path.startsWith('/api/missions/preview') ? json({id: 'not-a-preview'}) : original(path, options));
  const user = userEvent.setup(); renderLive(untestedReadiness);
  const panel = await liveComposer(user);
  expect(await within(panel).findByRole('alert')).toHaveTextContent('The route preview did not include a route digest');
  expect(within(panel).queryByLabelText('Approve route')).not.toBeInTheDocument();
  expect(within(panel).queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Create and start'})).toBeDisabled();
  // The retry reads the preview again; a well-formed answer then renders the route.
  fetch.mockImplementation(original);
  await user.click(within(panel).getByRole('button', {name: 'Preview the route again'}));
  expect(await within(panel).findByLabelText('Approve route')).not.toBeChecked();
  expect(previewReads()).toBe(2);
});

test('the mission view lists grants and receipts, and Revoke posts the reason then re-reads the ledger', async () => {
  const original = fetch.getMockImplementation();
  const revoked = [];
  fetch.mockImplementation(async (path, options = {}) => {
    if (path.endsWith('/revoke')) { revoked.push([path, options.method, JSON.parse(options.body)]); return json({seq: 3, grant_id: GRANT, kind: 'revoked', at: 1700000300, detail: 'Operator changed course'}); }
    if (path.endsWith('/grants')) return json(revoked.length ? {...ledger, grants: [{...ledger.grants[0], state: 'revoked', revoked_at: 1700000300}, ledger.grants[1]], receipts_truncated: true} : ledger);
    return original(path, options);
  });
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  const section = await screen.findByRole('region', {name: 'Grants and receipts'});
  expect(section).toHaveTextContent('not scientific evidence');
  const [grantsTable, receiptsTable] = await within(section).findAllByRole('table');
  const grantRows = within(grantsTable).getAllByRole('row').slice(1);
  expect(grantRows).toHaveLength(2);
  expect(grantRows[0]).toHaveTextContent('https://api.anthropic.com');
  expect(grantRows[0]).toHaveTextContent('seat');
  expect(grantRows[0]).toHaveTextContent(SEAT_DATA);
  expect(grantRows[0]).toHaveTextContent('mission');
  expect(grantRows[0]).toHaveTextContent('Active');
  expect(grantRows[0]).toHaveTextContent(new Date(1700000000 * 1000).toLocaleString());
  expect(grantRows[0]).toHaveAttribute('data-state', 'active');
  expect(grantRows[1]).toHaveTextContent('Revoked');
  expect(grantRows[1]).toHaveTextContent('never');
  expect(within(grantRows[1]).queryByRole('button')).not.toBeInTheDocument();
  const receiptRows = within(receiptsTable).getAllByRole('row').slice(1);
  expect(receiptRows).toHaveLength(2);
  expect(receiptRows[0]).toHaveTextContent('ok');
  expect(receiptRows[0]).toHaveTextContent('obs-3');
  expect(receiptRows[1]).toHaveTextContent('denied');
  expect(receiptRows[1]).toHaveTextContent('grant revoked');
  expect(section).not.toHaveTextContent('q'.repeat(64));
  await user.type(within(grantRows[0]).getByLabelText('Revoke reason'), 'Operator changed course');
  await user.click(within(grantRows[0]).getByRole('button', {name: 'Revoke grant https://api.anthropic.com'}));
  await waitFor(() => expect(revoked).toEqual([['/api/grants/' + GRANT + '/revoke', 'POST', {reason: 'Operator changed course'}]]));
  await waitFor(() => expect(within(section).queryByRole('button', {name: /^Revoke grant/})).not.toBeInTheDocument());
  expect(within(within(section).getAllByRole('table')[0]).getAllByRole('row')[1]).toHaveTextContent('Revoked');
  expect(section).toHaveTextContent('Only the newest 2 receipts are shown');
});

test('a ledger that cannot be read is stated in its own section and leaves the mission usable', async () => {
  const original = fetch.getMockImplementation();
  fetch.mockImplementation(async (path, options = {}) => path.endsWith('/grants') ? new Response(JSON.stringify({detail: 'Not Found'}), {status: 404, headers: {'Content-Type': 'application/json'}}) : original(path, options));
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  const section = await screen.findByRole('region', {name: 'Grants and receipts'});
  expect(await within(section).findByRole('alert')).toHaveTextContent('Grants could not be read: Request failed (404): Not Found');
  expect(screen.getByText(/Private stop reason/)).toBeVisible();
  expect(screen.getByRole('button', {name: 'Replay and verify'})).toBeEnabled();
});

// Slice 4: the operational timeline, the interruption banner, pause and retry, reopen, and the derived claim cards.
const withMission = (over, extra = {}) => {
  const original = fetch.getMockImplementation();
  const row = {...mission, ...extra, state: {...mission.state, ...over}};
  fetch.mockImplementation(async (path, options = {}) => path === '/api/missions/' + mission.id ? json(row) : original(path, options));
  return row;
};

test('the timeline table shows every recorded row from its own fields and never calls a row running', async () => {
  withMission({status: 'running'});
  const inner = fetch.getMockImplementation();
  fetch.mockImplementation(async (path, options = {}) => path.endsWith('/timeline') ? json(recordedTimeline) : inner(path, options));
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  const section = await screen.findByRole('region', {name: 'Timeline'});
  expect(section).toHaveTextContent(TIMELINE_NOTE);
  const rows = within(await within(section).findByRole('table')).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(6);
  expect(rows.map(row => row.getAttribute('data-operation'))).toEqual(['start', 'plan', 'tool', 'reconcile', 'plan', 'interrupt']);
  expect(rows.map(row => row.getAttribute('data-outcome-source'))).toEqual(['recorded', 'recorded', 'recorded', 'recorded', 'derived', 'recorded']);
  expect(rows[0]).toHaveAttribute('data-role', 'operator');
  expect(rows[0]).toHaveTextContent('operator:token');
  expect(rows[0]).toHaveTextContent('scheduled');
  expect(rows[0]).toHaveTextContent(new Date(timelineRows[0].started_at).toLocaleString());
  expect(rows[1]).toHaveTextContent('claude-opus-5 → claude-opus-5');
  expect(rows[1]).toHaveTextContent('verified');
  expect(rows[1]).toHaveTextContent('5f0caaaaaaaa');
  expect(rows[2]).toHaveTextContent('polynomial_fit · fit-linear');
  expect(rows[2]).toHaveTextContent('linear');
  expect(rows[2]).toHaveTextContent('not recorded');
  expect(rows[3]).toHaveTextContent('Reviewer (QA)');
  expect(rows[3]).toHaveTextContent('not verified');
  expect(rows[3]).toHaveAttribute('data-outcome', 'denied');
  expect(rows[4]).toHaveAttribute('data-outcome', 'outcome_unknown');
  expect(rows[4]).toHaveTextContent('no outcome recorded');
  expect(rows[4]).not.toHaveTextContent('outcome_unknown');
  expect(rows[4].children[2]).toHaveTextContent('—');
  expect(rows[5]).toHaveTextContent('Rows above without a recorded outcome were abandoned.');
  // No Outcome cell says a row is running (the service's own detail texts may use the word about the mission): that state is the persisted status alone.
  expect(rows.map(row => row.children[9].textContent)).toEqual(['scheduled', 'ok', 'ok', 'denied', 'no outcome recorded', 'interrupted']);
  expect(document.querySelector('.status-label')).toHaveTextContent('running');
});

test('a mission without a timeline says so and points at the persisted event history', async () => {
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  const section = await screen.findByRole('region', {name: 'Timeline'});
  await waitFor(() => expect(section).toHaveTextContent('No timeline was recorded for this mission: it ran before the timeline existed, or it has not started. The event history below is the persisted record.'));
  expect(within(section).queryByRole('table')).not.toBeInTheDocument();
  expect(document.querySelector('.status-label')).toHaveTextContent('paused');
});

test('Pause is offered only while the persisted status is running and posts the pause', async () => {
  const posts = [];
  const original = fetch.getMockImplementation();
  let status = 'running';
  fetch.mockImplementation(async (path, options = {}) => {
    if (path === '/api/missions/' + mission.id + '/pause') { posts.push(options.method); status = 'paused'; return json({...mission, state: {...mission.state, status}}); }
    if (path === '/api/missions/' + mission.id) return json({...mission, state: {...mission.state, status, events: status === 'paused' ? [{kind: 'mission_paused', round: 1, detail: 'Paused by operator:token at 2026-09-21T14:03:05Z; resume explicitly.'}] : []}});
    return original(path, options);
  });
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  const pause = screen.getByRole('button', {name: 'Pause'});
  expect(pause).toBeEnabled();
  expect(screen.getByRole('button', {name: /^Resume/})).toBeDisabled();
  expect(screen.queryByRole('button', {name: 'Retry after error'})).not.toBeInTheDocument();
  await user.click(pause);
  await waitFor(() => expect(posts).toEqual(['POST']));
  expect(await screen.findByText('paused', {selector: '.status-label'})).toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Pause'})).toBeDisabled();
  expect(screen.getByRole('button', {name: 'Resume (recorded as an analysis and claim change)'})).toBeEnabled();
  const banner = screen.getByText(/^Paused: Paused by operator:token at 2026-09-21T14:03:05Z; resume explicitly\. Resume continues it as a declared change\.$/);
  expect(banner).toHaveAttribute('role', 'status');
  expect(banner).toHaveAttribute('data-event', 'mission_paused');
  expect(screen.getByRole('button', {name: 'Cancel'})).toBeEnabled();
});

test('Retry after error is offered only for an errored mission, needs a reason and declares the change with the note prefix', async () => {
  const posts = [];
  const original = fetch.getMockImplementation();
  let status = 'error';
  fetch.mockImplementation(async (path, options = {}) => {
    if (path === '/api/missions/' + mission.id + '/changes') { posts.push([options.method, JSON.parse(options.body)]); status = 'running'; return json({id: 'c'.repeat(32), status: 'scheduled'}, {status: 202}); }
    if (path === '/api/missions/' + mission.id) return json({...mission, state: {...mission.state, status, stop_reason: 'Service execution failed'}});
    return original(path, options);
  });
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await user.click(screen.getByRole('button', {name: 'Load missions'}));
  await user.click(await screen.findByRole('button', {name: /paused · Private saved question/}));
  await screen.findByText('Selected mission: private-mission');
  const retry = screen.getByRole('button', {name: 'Retry after error'});
  expect(retry).toBeDisabled();
  expect(screen.getByRole('button', {name: 'Pause'})).toBeDisabled();
  expect(screen.getByRole('button', {name: /^Resume/})).toBeDisabled();
  expect(screen.getByRole('button', {name: 'Cancel'})).toBeDisabled();
  expect(screen.getByText(/may call the planner again/)).toBeInTheDocument();
  await user.type(screen.getByLabelText('Retry reason'), '  the planner CLI was signed in again ');
  expect(retry).toBeEnabled();
  await user.click(retry);
  await waitFor(() => expect(posts).toEqual([['POST', {kind: 'resume', declared_effects: ['analysis', 'claim'], note: 'Retry after error: the planner CLI was signed in again'}]]));
  expect(await screen.findByText('running', {selector: '.status-label'})).toBeInTheDocument();
  expect(screen.queryByRole('button', {name: 'Retry after error'})).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Pause'})).toBeEnabled();
});

test('an accepted Resume keeps polling until the persisted status leaves paused', async () => {
  // The service answers 202 before the worker's first commit (a live worker connects its connectors
  // first), so the row read right after the 202 still says paused; the view must not stop there.
  const original = fetch.getMockImplementation();
  let started = false, readsAfterStart = 0;
  fetch.mockImplementation(async (path, options = {}) => {
    if (path === '/api/missions/' + mission.id + '/start') { started = true; return json({id: mission.id, status: 'scheduled'}); }
    if (path === '/api/missions/' + mission.id && started) { readsAfterStart++; return json({...mission, state: {...mission.state, status: readsAfterStart >= 3 ? 'running' : 'paused'}}); }
    return original(path, options);
  });
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  await user.click(screen.getByRole('button', {name: 'Resume (recorded as an analysis and claim change)'}));
  expect(await screen.findByText('running', {}, {timeout: 4000})).toBeInTheDocument();
  expect(readsAfterStart).toBeGreaterThanOrEqual(3);
});

test('a 409 from Pause is shown in the results notice', async () => {
  const original = fetch.getMockImplementation();
  fetch.mockImplementation(async (path, options = {}) => path.endsWith('/pause') ? conflict('Only a running mission can be paused; this one is ready') : path === '/api/missions/' + mission.id ? json({...mission, state: {...mission.state, status: 'running'}}) : original(path, options));
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  await user.click(screen.getByRole('button', {name: 'Pause'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Only a running mission can be paused; this one is ready');
});

test('an interrupted mission shows the banner from its last persisted event', async () => {
  withMission({events: [{kind: 'mission_stopped', round: 0, detail: 'earlier'}, {kind: 'mission_interrupted', round: 1, detail: 'Service restarted; evidence retained. Resume explicitly.'}]});
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  const banner = screen.getByText(/^Interrupted: the service exited/);
  expect(banner).toHaveAttribute('role', 'status');
  expect(banner).toHaveAttribute('data-event', 'mission_interrupted');
  expect(banner).toHaveTextContent('Interrupted: the service exited while this mission was running (persisted event mission_interrupted, round 1). Evidence is retained. Resume continues it as a declared change; timeline rows without a recorded outcome were abandoned by the exit.');
  expect(screen.getByRole('button', {name: 'Resume (recorded as an analysis and claim change)'})).toBeEnabled();
});

test('no banner when the last event is neither an interruption nor a pause', async () => {
  withMission({events: [{kind: 'mission_interrupted', round: 1, detail: 'Service restarted; evidence retained. Resume explicitly.'}, {kind: 'change_declared', round: 1, detail: 'resume'}]});
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  expect(screen.queryByText(/^Interrupted:/)).not.toBeInTheDocument();
  expect(screen.queryByText(/^Paused:/)).not.toBeInTheDocument();
});

test('the route card reads the bound route from the seats_bound event and counts the grants', async () => {
  const summary = {planner: 'anthropic:cli:claude-opus-5:default:planner', reviewer: 'anthropic:api:claude-sonnet-4-5:medium:anthropic-key', mcp_servers: ['pubmed']};
  withMission({events: [{kind: 'seats_bound', round: 0, detail: 'sha256:' + 'c'.repeat(64) + ' ' + JSON.stringify(summary)}]}, {request: {mode: 'live'}});
  const inner = fetch.getMockImplementation();
  fetch.mockImplementation(async (path, options = {}) => path.endsWith('/grants') ? json(ledger) : inner(path, options));
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  const route = await screen.findByRole('region', {name: 'Mission route'});
  expect(route).toHaveTextContent('planner · anthropic:cli:claude-opus-5:default:planner');
  expect(route).toHaveTextContent('reviewer · anthropic:api:claude-sonnet-4-5:medium:anthropic-key');
  expect(route).toHaveTextContent('mcp_servers · pubmed');
  expect(route).toHaveTextContent('Route digest cccccccccccc… · bound at round 0 (event seats_bound)');
  await waitFor(() => expect(route).toHaveTextContent('Grants: 1 active · 1 revoked (see Grants and receipts)'));
  expect(route).not.toHaveTextContent('Offline fixture');
});

test('the route card of an offline mission says no route was bound; an unstarted live one says it binds at the first start', async () => {
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  expect(screen.getByRole('region', {name: 'Mission route'})).toHaveTextContent('Offline fixture: scripted roles (scripted-fixture-v1); no route was bound and no grant exists.');
  withMission({status: 'ready'}, {request: {mode: 'live'}});
  const live = userEvent.setup(); const {unmount} = render(<ResearchWorkspace token="operator-live" setToken={vi.fn()}/>);
  await live.click(screen.getAllByRole('button', {name: 'Load missions'})[1]);
  await live.click((await screen.findAllByRole('button', {name: /paused · Private saved question/}))[1]);
  await waitFor(() => expect(screen.getAllByRole('region', {name: 'Mission route'})[1]).toHaveTextContent('No route bound yet: a live mission binds its route (event seats_bound) at its first start.'));
  unmount();
});

test('reopen restores the stored mission once the session is unlocked and stores only its id', async () => {
  localStorage.setItem('arc.research.mission', 'private-mission');
  const user = userEvent.setup(); const setToken = vi.fn();
  const {rerender} = render(<ResearchWorkspace token="operator" setToken={setToken}/>);
  expect(await screen.findByText('Selected mission: private-mission')).toBeVisible();
  expect(fetch.mock.calls.map(([path]) => path)).toContain('/api/missions/private-mission');
  expect(fetch.mock.calls.some(([path]) => path === '/api/missions')).toBe(false);
  expect(fetch.mock.calls.every(([path, options]) => !path.includes('operator') && options.headers.Authorization === 'Bearer operator')).toBe(true);
  expect(Object.keys(localStorage)).toEqual(['arc.research.mission']);
  expect(localStorage.getItem('arc.research.mission')).toBe('private-mission');
  expect(Object.values(localStorage).some(value => String(value).includes('operator'))).toBe(false);
  expect(sessionStorage.length).toBe(0);
  // A token switch clears the selection as always and does not restore it again.
  fetch.mockClear();
  rerender(<ResearchWorkspace token="another-operator" setToken={setToken}/>);
  expect(screen.queryByText('Selected mission: private-mission')).not.toBeInTheDocument();
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(fetch.mock.calls.some(([path]) => path === '/api/missions/private-mission')).toBe(false);
  expect(localStorage.getItem('arc.research.mission')).toBe('private-mission');
  // Selecting a mission again stores its id; nothing else.
  await user.click(screen.getByRole('button', {name: 'Load missions'}));
  await user.click(await screen.findByRole('button', {name: /paused · Private saved question/}));
  await screen.findByText('Selected mission: private-mission');
  expect(Object.keys(localStorage)).toEqual(['arc.research.mission']);
});

test('reopen never fires on a keystroke: a typed token restores once it settles', async () => {
  localStorage.setItem('arc.research.mission', 'private-mission');
  const user = userEvent.setup();
  // The workspace mounts locked; the header field is typed into afterwards, as in the app.
  function Shell() {
    const [token, setToken] = React.useState('');
    return <><input id="operator-token" aria-label="Operator token" value={token} onChange={e => setToken(e.target.value)}/><ResearchWorkspace token={token} setToken={setToken}/></>;
  }
  render(<Shell/>);
  await user.type(screen.getByLabelText('Operator token'), 'operator');
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(fetch.mock.calls.some(([path]) => String(path).startsWith('/api/missions'))).toBe(false);
  expect(screen.getByText('No mission selected.')).toBeVisible();
  await user.keyboard('{Enter}');
  expect(await screen.findByText('Selected mission: private-mission')).toBeVisible();
  expect(fetch.mock.calls.filter(([path]) => path === '/api/missions/private-mission')).toHaveLength(1);
});

test('reopen waits for the token and a mission that is gone drops the key', async () => {
  localStorage.setItem('arc.research.mission', 'gone-mission');
  const original = fetch.getMockImplementation();
  fetch.mockImplementation(async (path, options = {}) => path === '/api/missions/gone-mission' ? new Response(JSON.stringify({detail: 'Not Found'}), {status: 404, headers: {'Content-Type': 'application/json'}}) : original(path, options));
  const user = userEvent.setup();
  function Shell() {
    const [token, setToken] = React.useState('');
    return <><input id="operator-token" aria-label="Operator token" value={token} onChange={e => setToken(e.target.value)}/><ResearchWorkspace token={token} setToken={setToken}/></>;
  }
  render(<Shell/>);
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByText('No mission selected.')).toBeVisible();
  await user.type(screen.getByLabelText('Operator token'), 'operator{Enter}');
  expect(await screen.findByRole('alert')).toHaveTextContent('The last mission (gone-mission) is no longer stored.');
  expect(localStorage.getItem('arc.research.mission')).toBeNull();
  expect(screen.getByText('No mission selected.')).toBeVisible();
  expect(screen.getByRole('button', {name: 'Load missions'})).toBeEnabled();
});

test('Create and start stores the new mission id for reopening', async () => {
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await user.type(screen.getByLabelText('Research goal'), 'Stored question');
  await user.click(screen.getByRole('button', {name: 'Create and start'}));
  await screen.findByText('Selected mission: private-mission');
  expect(Object.keys(localStorage)).toEqual(['arc.research.mission']);
  expect(localStorage.getItem('arc.research.mission')).toBe('private-mission');
});

const CLAIM_ROWS = ['Requested claim', 'Evidence-supported scope', 'Remaining uncertainty', 'Evidence', 'Independence', 'Findings', 'Alternatives', 'Next discriminating test', 'Units', 'Derivation'];

test('claim cards are rendered from the derived claims answer with every row in order', async () => {
  const original = fetch.getMockImplementation();
  fetch.mockImplementation(async (path, options = {}) => path.endsWith('/claims') ? json(exampleClaims) : original(path, options));
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  const scope = screen.getByRole('region', {name: 'Claim scope'});
  const card = await within(scope).findByRole('article');
  expect(card).toHaveAttribute('data-status', 'unresolved');
  expect(card).toHaveAttribute('data-stale', 'false');
  expect(within(card).getAllByRole('term').map(dt => dt.textContent)).toEqual(CLAIM_ROWS);
  expect(card).toHaveTextContent('quadratic · Unresolved');
  expect(card).toHaveTextContent('Scope: on the exploratory validation split of the frozen dataset; not independent data.');
  expect(card).toHaveTextContent('shared identity: Both roles ran as the same model identity (scripted-fixture-v1)');
  const evidence = within(card).getAllByRole('listitem').filter(li => li.hasAttribute('data-evidence-id'));
  expect(evidence.map(li => li.getAttribute('data-evidence-id'))).toEqual(['fit-quadratic', 'shuffle-quadratic']);
  expect(evidence[0]).toHaveTextContent('fit-quadratic · polynomial_fit@arc-numeric-2 · digest 9c4effffffff… · ok · started ' + new Date(1758463205400).toLocaleString() + ' · receipt none · validation MSE 0.0014');
  expect(evidence[0]).not.toHaveTextContent('not counted for scope');
  expect(evidence[1]).toHaveTextContent('· not counted for scope · started no time recorded · receipt none · mean shuffled MSE 0.9');
  expect(card).toHaveTextContent('Independent reviewers: no');
  expect(card).toHaveTextContent('Reviewer (QA): scripted-fixture-v1 · identity not recorded');
  expect(card).toHaveTextContent('falsifier: scripted-fixture-v1 · identity not recorded');
  expect(card).toHaveTextContent('Reviewer (QA) · support: Low error on the exploratory split.');
  expect(card).toHaveTextContent('parents linear; siblings null-control; children none');
  expect(card).toHaveTextContent('Conflict: support and challenge both recorded (assessments a-3, a-4)');
  expect(card).toHaveTextContent('Reviewer (QA): Use independently acquired data before a scientific conclusion.');
  expect(card).toHaveTextContent('No units are recorded: mission points are bare x/y numbers');
  expect(card).toHaveTextContent('arc-claim-scope-3 · release check claim scope: passed');
  expect(card).not.toHaveTextContent('Stale:');
  expect(scope).toHaveTextContent('Worked out at round 2; provisional support is exploratory, never validation.');
  expect(scope).toHaveTextContent(UNCERTAINTY_NOTE);
  expect(scope).toHaveTextContent(CLAIMS_NOTE);
  expect(within(scope).queryByRole('alert')).not.toBeInTheDocument();
});

test('the poll that sees the mission stop also lands its claim cards and timeline, without reselecting', async () => {
  // The claim scope exists only once the mission has stopped: the final poll's side reads must not be lost
  // when the status change ends the polling (the poll's abort signal is shared by those reads).
  const original = fetch.getMockImplementation();
  let missionReads = 0;
  fetch.mockImplementation(async (path, options = {}) => {
    if (path === '/api/missions') return json([{id: mission.id, status: 'running', goal: 'Private saved question'}]);
    if (path === '/api/missions/' + mission.id) { missionReads++; return json({...mission, state: {...mission.state, status: missionReads === 1 ? 'running' : 'completed', claim_scope: missionReads === 1 ? null : mission.state.claim_scope}}); }
    // The side reads take real time in a browser; here a tick, so React's commit and effect cleanup run first.
    if (path.endsWith('/claims')) { await new Promise(resolve => setTimeout(resolve, 30)); return json(missionReads === 1 ? noClaims : exampleClaims); }
    if (path.endsWith('/timeline')) { await new Promise(resolve => setTimeout(resolve, 30)); return json(missionReads === 1 ? noTimeline : recordedTimeline); }
    return original(path, options);
  });
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  expect(await screen.findByText('running')).toBeInTheDocument();
  expect(await screen.findByText('completed', {}, {timeout: 3000})).toBeInTheDocument();
  const scope = screen.getByRole('region', {name: 'Claim scope'});
  const card = await within(scope).findByRole('article');
  expect(card).toHaveAttribute('data-stale', 'false');
  expect(within(card).getAllByRole('term').map(dt => dt.textContent)).toEqual(CLAIM_ROWS);
  expect(within(screen.getByRole('region', {name: 'Timeline'})).getAllByRole('row')).toHaveLength(timelineRows.length + 1);
  const polls = () => fetch.mock.calls.filter(([path]) => path === '/api/missions/' + mission.id).length;
  const settled = polls();
  await new Promise(resolve => setTimeout(resolve, 1300));
  expect(polls()).toBe(settled);
});

test('a stale derivation is marked on the card and conflicts unavailable are said so', async () => {
  const stale = {...exampleClaims, evidence_graph: 'unavailable', claims: [{...exampleClaim, stale_derivation: true, stale_reason: 'Claim scope was derived under an earlier rule (arc-claim-scope-2); re-derive it.', claim_scope_check: 'stale', alternatives: {...exampleClaim.alternatives, conflicts: [], conflicts_source: 'unavailable'}}]};
  const original = fetch.getMockImplementation();
  fetch.mockImplementation(async (path, options = {}) => path.endsWith('/claims') ? json(stale) : original(path, options));
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  const card = await within(screen.getByRole('region', {name: 'Claim scope'})).findByRole('article');
  expect(card).toHaveAttribute('data-stale', 'true');
  expect(card).toHaveTextContent('release check claim scope: stale · Stale: Claim scope was derived under an earlier rule (arc-claim-scope-2); re-derive it.');
  expect(card).toHaveTextContent('conflicts unavailable');
  expect(card).not.toHaveTextContent('Conflict: support');
});

test('when the claims read fails the persisted claim scope is shown as before, with the alert', async () => {
  const persisted = {derivation_version: 'arc-claim-scope-3', basis_round: 1, counts: {}, rule: 'r', branches: [{branch_id: 'linear', requested: 'A linear curve adequately describes the fixture.', status: 'contradicted', supported_scope: [], scope_qualifier: '', uncertainties: [{reason: 'challenged', role: 'falsifier', detail: 'The linear fit leaves substantial residual error.', evidence_ids: ['fit-linear']}], next_tests: [{role: 'falsifier', round: 0, test: 'Compare a nonlinear alternative.', evidence_ids: ['fit-linear']}], evidence_ids: ['fit-linear']}]};
  withMission({claim_scope: persisted});
  const inner = fetch.getMockImplementation();
  fetch.mockImplementation(async (path, options = {}) => path.endsWith('/claims') ? new Response(JSON.stringify({detail: 'Not Found'}), {status: 404, headers: {'Content-Type': 'application/json'}}) : inner(path, options));
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  const scope = screen.getByRole('region', {name: 'Claim scope'});
  expect(await within(scope).findByRole('alert')).toHaveTextContent('Request failed (404): Not Found');
  const card = within(scope).getByRole('article');
  expect(card).toHaveAttribute('data-status', 'contradicted');
  expect(card).toHaveTextContent('No supported scope; the requested claim stands only as a hypothesis.');
  expect(card).toHaveTextContent('challenged (falsifier): The linear fit leaves substantial residual error.');
  expect(card).toHaveTextContent(/Next discriminating test\s*falsifier: Compare a nonlinear alternative\./);
  expect(within(card).queryByText('Evidence')).not.toBeInTheDocument();
  expect(scope).toHaveTextContent('Worked out at round 1; provisional support is exploratory, never validation.');
  expect(screen.getByRole('button', {name: 'Replay and verify'})).toBeEnabled();
});

test('unshaped timeline and claims answers are stated in their sections and leave the mission usable', async () => {
  const original = fetch.getMockImplementation();
  fetch.mockImplementation(async (path, options = {}) => path.endsWith('/timeline') ? json({unexpected: true}) : path.endsWith('/claims') ? json({claims: 'nope'}) : original(path, options));
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  expect(await within(screen.getByRole('region', {name: 'Timeline'})).findByRole('alert')).toHaveTextContent('The timeline answer had no rows list; the service may be out of date.');
  expect(await within(screen.getByRole('region', {name: 'Claim scope'})).findByRole('alert')).toHaveTextContent('The claims answer had no claims list; the service may be out of date.');
  expect(screen.getByText(/Private stop reason/)).toBeVisible();
  expect(screen.getByRole('button', {name: 'Replay and verify'})).toBeEnabled();
  expect(screen.getByRole('region', {name: 'Claim scope'})).toHaveTextContent('Claim scope is worked out when the mission stops. Nothing yet.');
});
