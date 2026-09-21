import React from 'react';
import {Button} from '@heroui/react/button';
import {NATIVE_SESSION} from './http';

// One lock notice for every workspace: the same surface, the same words (from
// SESSION_COPY via sessionState) and the same way to the header token field. `tone`
// is "info" for a missing token and "error" for a rejected one.
export function LockNotice({card, tone = 'info', onUnlock, unlockLabel = 'Go to token field', compact = false}) {
  if (!card) return null;
  return <div className={'unlock-card ' + tone + (compact ? ' compact' : '')} data-tone={tone} role="status">
    <strong>{card.title}</strong>
    <p>{card.text}</p>
    {onUnlock && <Button variant="secondary" size="sm" onPress={onUnlock}>{unlockLabel}</Button>}
  </div>;
}

/** Focus the header token field; a native session first hands over to the manual token. */
export function focusTokenField(token, setToken) {
  if (token === NATIVE_SESSION && setToken) setToken('');
  setTimeout(() => document.getElementById('operator-token')?.focus(), 0);
}

/** The button label that fits the current session kind. */
export function unlockLabel(token) {
  return token === NATIVE_SESSION ? 'Use operator token' : 'Go to token field';
}
