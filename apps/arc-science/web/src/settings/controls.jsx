import React from 'react';
import {Alert} from '@heroui/react/alert';
import {Button} from '@heroui/react/button';
import {Checkbox} from '@heroui/react/checkbox';
import {Disclosure} from '@heroui/react/disclosure';
import {Input} from '@heroui/react/input';
import {Label} from '@heroui/react/label';
import {ListBox} from '@heroui/react/list-box';
import {Popover} from '@heroui/react/popover';
import {Select} from '@heroui/react/select';
import {TextField} from '@heroui/react/textfield';
import {useI18n} from '../i18n/index.jsx';
import {GravityIcon} from '../theme/gravity-icons.jsx';

// The few field shapes Settings repeats. `ariaLabel` names the control on its own
// ("Planner model"); `label` is the short visible word above it ("Model").

/** A select over [id, text] pairs. The value must be one of the ids, or null for the placeholder. */
export function SelectField({label, ariaLabel, value, options, onChange, placeholder, isDisabled, isInvalid}) {
  return (
    <Select aria-label={ariaLabel} value={value} placeholder={placeholder} isDisabled={isDisabled} isInvalid={isInvalid} fullWidth
      onChange={next => { if (next != null) onChange(String(next)); }}>
      {label ? <Label>{label}</Label> : null}
      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map(([id, text]) => (
            <ListBox.Item key={id} id={id} textValue={text}>{text}<ListBox.ItemIndicator /></ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function TextInput({label, ariaLabel, value, onChange, placeholder, isDisabled}) {
  return (
    <TextField aria-label={ariaLabel} value={value} onChange={onChange} isDisabled={isDisabled} fullWidth>
      {label ? <Label>{label}</Label> : null}
      <Input placeholder={placeholder} />
    </TextField>
  );
}

export function CheckField({ariaLabel, isSelected, onChange, isDisabled, children}) {
  return (
    <Checkbox aria-label={ariaLabel} isSelected={isSelected} onChange={onChange} isDisabled={isDisabled}>
      <Checkbox.Content>
        <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
        <Label>{children}</Label>
      </Checkbox.Content>
    </Checkbox>
  );
}

/** The longer explanation behind a short note, on request. */
export function Hint({children}) {
  const {t} = useI18n();
  return (
    <Popover>
      <Button variant="ghost" size="sm" isIconOnly aria-label={t('settings.more')}><GravityIcon name="circle-info" /></Button>
      <Popover.Content className="max-w-96">
        <Popover.Dialog><p>{children}</p></Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

/** A folded list or explanation under its title. */
export function More({title, level = 4, children}) {
  return (
    <Disclosure>
      <Disclosure.Heading level={level}>
        <Disclosure.Trigger className="ar-row ar-row--tight font-medium">{title}<Disclosure.Indicator /></Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content><Disclosure.Body className="ar-stack ar-stack--tight">{children}</Disclosure.Body></Disclosure.Content>
    </Disclosure>
  );
}

/** A short note, with its longer explanation behind a Hint when there is one. */
export const Note = ({hint, children}) => hint
  ? <div className="ar-row ar-row--tight"><p className="ar-note">{children}</p><Hint>{hint}</Hint></div>
  : <p className="ar-note">{children}</p>;

// One card per failure, beside the action that failed; its one button, when there is one,
// recovers (Retry, Reload and keep my edits).
export function StateCard({state}) {
  const {t} = useI18n();
  const {kind, detail} = state;
  const action = state.label?.(t) || t('settings.action.request');
  const copy = kind === 'unconfigured' ? [t('settings.error.unconfigured.title'), t('settings.error.unconfigured.text')]
    : kind === 'conflict' ? [t('settings.error.conflict.title'), t('settings.error.conflict.text')]
    : kind === 'invalid' ? [t('settings.error.invalid.title'), t('settings.error.invalid.text', {reason: detail || t('settings.error.no_reason')})]
    : kind === 'offline' ? [t('session.offline.title'), t('session.offline.text')]
    : [t('settings.error.failed.title'), detail ? t('settings.error.failed.detail', {action, detail}) : t('settings.error.failed.text', {action})];
  return (
    <Alert status={kind === 'conflict' || kind === 'unconfigured' ? 'warning' : 'danger'} role="alert">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{copy[0]}</Alert.Title>
        <Alert.Description>{copy[1]}</Alert.Description>
        {state.recover ? <Button className="mt-2 self-start" variant="secondary" size="sm" onPress={state.recover.run}>{t(state.recover.labelKey)}</Button> : null}
      </Alert.Content>
    </Alert>
  );
}
