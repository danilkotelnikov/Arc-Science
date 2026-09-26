import {renderHook} from '@testing-library/react';
import React from 'react';
import {describe, expect, it} from 'vitest';
import {I18nProvider, useI18n} from './i18n/index.jsx';
import {GRANT_STATES, STATES, grantLabel, grantState, localizeReadiness, loginLine, probeLine, releaseWord, seatSummary, stateLabel, stateOf} from './readiness';

const NB = ' ';
const russian = () => renderHook(() => useI18n(), {wrapper: ({children}) => <I18nProvider locale="ru">{children}</I18nProvider>}).result.current;

describe('readiness vocabulary', () => {
  it('names every state once and labels each of them in both languages', () => {
    expect(STATES).toEqual(['ready', 'not_tested', 'failed', 'blocked', 'unknown']);
    expect(STATES.map(state => stateLabel(state))).toEqual(['Ready', 'Not tested', 'Failed', 'Blocked', 'Unknown']);
    expect(stateLabel('not_tested', russian())).toBe(`Не${NB}проверено`);
    expect(stateLabel('something_new')).toBe('Unknown');
  });

  it('maps release-check enums to display words without touching the enum', () => {
    expect(['satisfied', 'failed', 'unknown', 'error', 'stale', 'not_applicable'].map(state => releaseWord(state))).toEqual(['passed', 'failed', 'unverified', 'blocked', 'stale', 'n/a']);
    expect(releaseWord('something_new')).toBe('something_new');
    expect(releaseWord(undefined)).toBe('unverified');
  });

  it('reads a node state safely', () => {
    expect(stateOf(null)).toBe('unknown');
    expect(stateOf(undefined)).toBe('unknown');
    expect(stateOf({state: 'ok'})).toBe('unknown');
    expect(stateOf({state: 'blocked'})).toBe('blocked');
  });

  it('names a grant state from the ledger and labels each of them', () => {
    expect(GRANT_STATES).toEqual(['active', 'revoked', 'expired', 'exhausted']);
    expect(GRANT_STATES.map(state => grantLabel(state))).toEqual(['Active', 'Revoked', 'Expired', 'Exhausted']);
    expect(grantState({state: 'revoked', revoked_at: 1})).toBe('revoked');
    expect(grantState({state: 'exhausted', uses: 1, max_uses: 1})).toBe('exhausted');
    // Nothing is recomputed from the fields: a missing or foreign state is unknown.
    expect(grantState({uses: 1, max_uses: 1})).toBe('unknown');
    expect(grantState({state: 'ok'})).toBe('unknown');
    expect(grantState(null)).toBe('unknown');
  });

  it('summarises a seat on one line', () => {
    expect(seatSummary({label: 'Planner', state: 'blocked', meaning: 'No provider is set.'})).toBe('Planner: Blocked — No provider is set.');
    expect(seatSummary({role: 'vision', state: 'ready'})).toBe('vision: Ready');
    expect(seatSummary(null)).toBe('Seat: Unknown');
  });

  it('reads a probe from the verification alone and says when there is none', () => {
    const at = 1_700_000_000, when = new Intl.DateTimeFormat('en', {dateStyle: 'medium', timeStyle: 'short'}).format(at * 1000);
    expect(probeLine({verification: {status: 'ok', checked_at: at, observed_model: 'claude-sonnet-5', identity_verified: true}})).toBe(`Last probe ${when}, answering model claude-sonnet-5, identity verified`);
    expect(probeLine({verification: {status: 'ok', checked_at: at, observed_model: null, identity_verified: false}})).toBe(`Last probe ${when}, answering model not reported, identity not verified`);
    expect(probeLine({verification: {status: 'failed', checked_at: at, error: 'HTTP 401 from the provider'}})).toBe('Probe failed: HTTP 401 from the provider');
    expect(probeLine({verification: {status: 'failed', checked_at: at}})).toBe('Probe failed: no detail');
    expect(probeLine({verification: {status: 'stale', checked_at: at}})).toBe(`Last probe ${when}, for an earlier configuration of this seat`);
    for (const seat of [{verification: {status: 'not_tested'}}, {verification: {status: 'not_applicable'}}, {}, null]) expect(probeLine(seat)).toBe('Never probed');
    expect(probeLine(null, russian())).toBe(`Ещё не${NB}проверялось`);
  });

  it('keeps the service sentences in English and reads them by code in Russian, falling back for an unknown code', () => {
    const reading = {
      seats: {
        planner: {role: 'planner', label: 'Planner', state: 'blocked', code: 'seat.unconfigured', facts: {}, meaning: 'No planner seat is set; a live mission cannot start', next_action: 'Set the provider and model for this seat in Settings'},
        reviewer: {role: 'reviewer', label: 'Reviewer (QA)', state: 'blocked', code: 'seat.credential_missing', facts: {credential_ref: 'qa-key'}, meaning: 'No credential is stored under the name qa-key', next_action: 'Store it with arc-science credential --name qa-key'},
        prose: {role: 'prose', label: 'Prose', state: 'unknown', code: 'seat.something_new', facts: {}, meaning: 'A sentence the page does not know', next_action: null},
      },
      live_mission: {state: 'blocked', code: 'live.blocked', blocking: ['planner'], meaning: 'A live mission cannot start: planner is blocked', next_action: 'Resolve each blocking seat above'},
      connectors: {state: 'not_tested', code: 'connectors.eligible', meaning: '1 of 2 connectors can be bound by a live mission; none is checked here', next_action: 'Run the connection checks in Diagnostics', mcp: [], acp: []},
    };
    expect(localizeReadiness(reading)).toBe(reading);
    const ru = localizeReadiness(reading, russian());
    expect(ru.seats.planner.label).toBe('Планировщик');
    expect(ru.seats.planner.meaning).toBe(`Модель планировщика не${NB}задана, задание с${NB}подключёнными моделями не${NB}может начаться`);
    expect(ru.seats.reviewer.next_action).toContain('arc-science credential --name qa-key');
    expect(ru.seats.prose.meaning).toBe('A sentence the page does not know');
    expect(ru.seats.prose.next_action).toBeNull();
    expect(ru.live_mission.meaning).toContain('Планировщик — заблокировано');
    expect(ru.connectors.meaning).toContain(`1${NB}из${NB}2`);
    expect(reading.seats.planner.meaning).toBe('No planner seat is set; a live mission cannot start');
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
