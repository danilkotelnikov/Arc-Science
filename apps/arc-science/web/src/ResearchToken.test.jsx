import React from 'react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {act, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResearchWorkspace from './ResearchWorkspace';

const json = data => new Response(JSON.stringify(data), {headers: {'Content-Type': 'application/json'}});
const mission = {id: 'private-mission', release: {policy_digest: 'p'.repeat(64), subject_digest: 's'.repeat(64), status: 'eligible_for_human_review', eligible_for_human_review: true, blocking_reasons: [], decided_at: 1, verification: null, checks: []}, state: {status: 'paused', round: 1, actions_used: 3, model_calls_used: 2, data_origin: 'fixture', branches: [], assessments: [], observations: [], events: [], visual_reports: [], artifacts: [], stop_reason: 'Private stop reason'}};
const report = {integrity: true, reproduction_passed: true, reproduced: 3, artifacts_reproduced: 2, evidence_graph_valid: true, scientific_validity_established: false, failures: []};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (path, options = {}) => {
    if (path === '/api/missions') return json(options.method === 'POST' ? mission : [{id: mission.id, status: 'paused', goal: 'Private saved question'}]);
    if (path.endsWith('/verify')) return json(report);
    if (path.endsWith('/capsule')) return new Response('private archive');
    return json(mission);
  }));
  URL.createObjectURL = vi.fn(() => 'blob:private-artifact'); URL.revokeObjectURL = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function openMission(user) {
  await user.click(screen.getByRole('button', {name: 'Load missions'}));
  await user.click(await screen.findByRole('button', {name: 'paused · Private saved question'}));
  await screen.findByText('Selected mission: private-mission');
}

test('token changes clear the mission, report, private inputs and reset consent', async () => {
  const user = userEvent.setup(); const setToken = vi.fn();
  const {rerender} = render(<ResearchWorkspace token="old-token" setToken={setToken}/>);
  await openMission(user);
  await user.clear(screen.getByLabelText('Research goal'));
  await user.type(screen.getByLabelText('Research goal'), 'Unpublished question');
  await user.click(screen.getByLabelText(/Permit sending/));
  await user.click(screen.getByLabelText(/Require configured visual review/));
  await user.click(screen.getByRole('button', {name: 'Verify and recompute'}));
  await screen.findByText(/3 computations/);
  rerender(<ResearchWorkspace token="new-token" setToken={setToken}/>);
  expect(screen.queryByText('Selected mission: private-mission')).not.toBeInTheDocument();
  expect(screen.queryByText('Private stop reason')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {name: 'paused · Private saved question'})).not.toBeInTheDocument();
  expect(screen.queryByText(/3 computations/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Research goal')).not.toHaveValue('Unpublished question');
  expect(screen.getByLabelText(/Permit sending/)).not.toBeChecked();
  expect(screen.getByLabelText(/Require configured visual review/)).not.toBeChecked();
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
  await user.click(screen.getByRole('button', {name: 'Export replay capsule'}));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  rerender(<ResearchWorkspace token="" setToken={setToken}/>);
  await act(async () => finish(new Blob(['private archive'])));
  expect(click).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test('verification summarizes evidence without expanding the full JSON report', async () => {
  const user = userEvent.setup(); render(<ResearchWorkspace token="operator" setToken={vi.fn()}/>);
  await openMission(user);
  await user.click(screen.getByRole('button', {name: 'Verify and recompute'}));
  expect(await screen.findByText(/3 computations/)).toHaveTextContent('2 artifacts');
  expect(screen.getByText(/Scientific validity is not established/)).toBeVisible();
  const details = screen.getByText('Verification details').closest('details');
  expect(details).not.toHaveAttribute('open');
  await user.click(screen.getByText('Verification details'));
  expect(details).toHaveAttribute('open');
  expect(screen.getByText(/"reproduction_passed": true/)).toBeVisible();
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
