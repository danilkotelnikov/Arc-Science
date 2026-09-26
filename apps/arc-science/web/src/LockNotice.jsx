import React from 'react';
import {Alert} from '@heroui/react/alert';
import {Button} from '@heroui/react/button';
import {NATIVE_SESSION, sessionCopy} from './http';
import {useI18n} from './i18n/index.jsx';

// One lock notice for every workspace: the same surface, the same words (the card from
// sessionState, read through the dictionaries) and the same way to the header token
// field. `tone` is "info" for a missing token and "error" for a rejected one.
export function LockNotice({card, tone = 'info', onUnlock, unlockLabel, compact = false}) {
  const {t} = useI18n();
  if (!card) return null;
  const {title, text} = sessionCopy(card, t);
  return (
    <Alert status={tone === 'error' ? 'danger' : 'default'} role="status" data-tone={tone} className={'bp-lock' + (compact ? ' bp-lock--compact' : '')}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        <Alert.Description>{text}</Alert.Description>
        {onUnlock ? <Button className="bp-lock-action" variant="secondary" size="sm" onPress={onUnlock}>{unlockLabel || t('session.unlock.token')}</Button> : null}
      </Alert.Content>
    </Alert>
  );
}

/** Focus the header token field; a native session first hands over to the manual token. */
export function focusTokenField(token, setToken) {
  if (token === NATIVE_SESSION && setToken) setToken('');
  setTimeout(() => document.getElementById('operator-token')?.focus(), 0);
}

/** The button label that fits the current session kind. */
export function unlockLabel(token, t) {
  return t(token === NATIVE_SESSION ? 'session.unlock.native' : 'session.unlock.token');
}
