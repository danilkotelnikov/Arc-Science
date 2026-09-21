import {describe, expect, it} from 'vitest';
import {STATES, STATE_LABEL, releaseWord, seatSummary, stateOf} from './readiness';

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
});
