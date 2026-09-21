import {describe, expect, it} from 'vitest';
import {STATES, STATE_LABEL, loginLine, probeLine, releaseWord, seatSummary, stateOf} from './readiness';

describe('readiness vocabulary', () => {
  it('names every state once and labels each of them', () => {
    expect(STATES).toEqual(['ready', 'not_tested', 'failed', 'blocked', 'unknown']);
    expect(STATES.map(state => STATE_LABEL[state])).toEqual(['Ready', 'Not tested', 'Failed', 'Blocked', 'Unknown']);
  });

  it('maps release-check enums to display words without touching the enum', () => {
    expect(['satisfied', 'failed', 'unknown', 'error', 'stale', 'not_applicable'].map(releaseWord)).toEqual(['passed', 'failed', 'unverified', 'blocked', 'stale', 'n/a']);
    expect(releaseWord('something_new')).toBe('something_new');
    expect(releaseWord(undefined)).toBe('unverified');
  });

  it('reads a node state safely', () => {
    expect(stateOf(null)).toBe('unknown');
    expect(stateOf(undefined)).toBe('unknown');
    expect(stateOf({state: 'ok'})).toBe('unknown');
    expect(stateOf({state: 'blocked'})).toBe('blocked');
  });

  it('summarises a seat on one line', () => {
    expect(seatSummary({label: 'Planner', state: 'blocked', meaning: 'No provider is set.'})).toBe('Planner: Blocked — No provider is set.');
    expect(seatSummary({role: 'vision', state: 'ready'})).toBe('vision: Ready');
    expect(seatSummary(null)).toBe('Seat: Unknown');
  });

  it('reads a probe from the verification alone and says when there is none', () => {
    const at = 1_700_000_000, when = new Date(at * 1000).toLocaleString();
    expect(probeLine({verification: {status: 'ok', checked_at: at, observed_model: 'claude-sonnet-5', identity_verified: true}})).toBe('Last probe ' + when + ' · answering model claude-sonnet-5 · identity verified');
    expect(probeLine({verification: {status: 'ok', checked_at: at, observed_model: null, identity_verified: false}})).toBe('Last probe ' + when + ' · answering model not reported · identity not verified');
    expect(probeLine({verification: {status: 'failed', checked_at: at, error: 'HTTP 401 from the provider'}})).toBe('Probe failed: HTTP 401 from the provider');
    expect(probeLine({verification: {status: 'failed', checked_at: at}})).toBe('Probe failed: no detail');
    expect(probeLine({verification: {status: 'stale', checked_at: at}})).toBe('Last probe ' + when + ' · for an earlier configuration of this seat');
    expect(probeLine({verification: {status: 'not_tested'}})).toBe('Never probed');
    expect(probeLine({verification: {status: 'not_applicable'}})).toBe('Never probed');
    expect(probeLine({})).toBe('Never probed');
    expect(probeLine(null)).toBe('Never probed');
  });

  it('reports a CLI login as a fact and nothing for an API seat', () => {
    expect(loginLine({facts: {transport: 'cli', executable: 'claude.cmd', cli_logged_in: true, cli_auth_method: 'claude.ai'}})).toBe('Signed in via claude.cmd (claude.ai)');
    expect(loginLine({facts: {transport: 'cli', executable: 'codex', cli_logged_in: true, cli_auth_method: null}})).toBe('Signed in via codex');
    expect(loginLine({facts: {transport: 'cli', executable: 'gemini', cli_logged_in: false, cli_auth_method: 'none'}})).toBe('Not signed in');
    expect(loginLine({facts: {transport: 'cli', executable: null, cli_logged_in: null}})).toBe('Not signed in');
    expect(loginLine({facts: {transport: 'api', credential_ref: 'planner-key'}})).toBeNull();
    expect(loginLine({facts: {transport: null}})).toBeNull();
    expect(loginLine(null)).toBeNull();
  });
});
