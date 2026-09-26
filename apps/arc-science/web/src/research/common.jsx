import React from 'react';
import {Alert} from '@heroui/react/alert';
import {Button} from '@heroui/react/button';
import {Popover} from '@heroui/react/popover';
import en from '../i18n/en.js';
import {NATIVE_SESSION, sessionLine} from '../http';
import {GravityIcon} from '../theme/gravity-icons.jsx';

/** Enum values read as words: budget_exhausted -> budget exhausted. */
export const words = value => String(value ?? '').replace(/_/g, ' ');

/** A service enum in the interface language; a value this build has no word for is shown as it arrives. */
export const term = (t, group, value) => {
  const key = `research.${group}.${value}`;
  return Object.hasOwn(en, key) ? t(key) : words(value);
};

/** The analyst role is served by the Reviewer (QA) seat set in Settings; the other roles keep their names. */
export const roleName = (t, value) => term(t, 'role', value);

/** Recorded times: date and time to the second, in the interface language. */
export const STAMP = {dateStyle: 'medium', timeStyle: 'medium'};

const failedWith = (error, pattern) => pattern.test(error?.message || String(error));
export const isAuthError = error => failedWith(error, /Request failed \((401|403)\)/);
export const isConflict = error => failedWith(error, /Request failed \(409\)/);
export const isNotFound = error => failedWith(error, /Request failed \(404\)/);

/** One line for the alert beside the action that failed; the session lines come from http.js so every workspace reads the same. */
export function friendlyError(error, token, t) {
  const message = error?.message || String(error);
  if (isAuthError(error)) return sessionLine(token === NATIVE_SESSION ? 'nativeExpired' : 'expired', t);
  if (/Failed to fetch|NetworkError|Load failed/.test(message)) return sessionLine('offline', t);
  return message;
}

/** A failure stated where it happened. */
export const Problem = ({children, ...props}) => (
  <Alert status="danger" role="alert" className="bp-lock--compact" {...props}>
    <Alert.Indicator />
    <Alert.Content><Alert.Description>{children}</Alert.Description></Alert.Content>
  </Alert>
);

/** The longer explanation behind a short line, opened on demand. */
export const Hint = ({label, children}) => (
  <Popover>
    <Button variant="ghost" size="sm" isIconOnly aria-label={label}><GravityIcon name="circle-info" /></Button>
    <Popover.Content className="max-w-sm">
      <Popover.Dialog className="ar-stack ar-stack--tight">
        <Popover.Heading className="bp-kicker">{label}</Popover.Heading>
        <p>{children}</p>
      </Popover.Dialog>
    </Popover.Content>
  </Popover>
);

/** A heading with its hint beside it. */
export const Heading = ({level: H = 'h2', hint, hintLabel, children}) => (
  hint ? <div className="ar-row ar-row--tight"><H>{children}</H><Hint label={hintLabel}>{hint}</Hint></div> : <H>{children}</H>
);

/** Short facts on one line, apart by the row gap; the spaces keep them apart when read as text. */
export const MetaRow = ({items}) => (
  <p className="ar-row bp-meta">
    {items.filter(Boolean).map((item, index) => <React.Fragment key={index}>{index ? ' ' : null}<span>{item}</span></React.Fragment>)}
  </p>
);

// Tones of the square mark beside a service state (ar-tag). The words beside the mark carry the meaning.
export const MISSION_TONE = {completed: 'success', running: 'accent', paused: 'warning', budget_exhausted: 'warning', needs_input: 'warning', error: 'danger'};
export const CLAIM_TONE = {provisionally_supported: 'success', contradicted: 'danger', unresolved: 'warning'};
export const CHECK_TONE = {satisfied: 'success', failed: 'danger', error: 'danger', stale: 'warning'};
export const VERDICT_TONE = {adequate: 'success', issues: 'warning', rejected: 'danger', blocked: 'danger'};

export const Tag = ({tone, className = '', children, ...props}) => (
  <span className={`ar-tag ${className}`} data-tone={tone} {...props}>{children}</span>
);
