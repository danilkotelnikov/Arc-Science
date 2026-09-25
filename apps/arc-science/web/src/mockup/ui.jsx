import React from 'react';
import {Label} from '@heroui/react/label';
import {TextArea} from '@heroui/react/textarea';
import {ToggleButton} from '@heroui/react/toggle-button';
import {ToggleButtonGroup} from '@heroui/react/toggle-button-group';
import {SUPPORTED_LOCALES} from '../i18n/index.jsx';

// Small Blockprint wrappers shared by the prototype screens. Class names come from
// blockprint.css; nothing here restyles a HeroUI component.

/** The offset shadow is reserved for primary blocks; everything else is a plain panel. */
export const Block = ({variant, className = '', children, ...props}) => (
  <section className={`${variant === 'primary' ? 'bp-block bp-block--primary' : 'bp-panel'} ${className}`} {...props}>
    {children}
  </section>
);

export const Kicker = ({children}) => <p className="bp-kicker">{children}</p>;

export const Meta = ({children}) => <p className="bp-meta">{children}</p>;

export const Status = ({state, children}) => (
  <span className="bp-status" data-state={state}>{children}</span>
);

/** Density 1..5 as a tinted cell; the number and the hidden label carry the meaning. */
export const Density = ({level, label}) => (
  <span className={`bp-density-${level}`} style={{display: 'inline-block', padding: '2px 10px', fontWeight: 600}}>
    {level}<span className="mk-hidden"> {label}</span>
  </span>
);

/** A textarea with a label that stays visible once the field has text in it. */
export const LabelledTextArea = ({id, label, ...props}) => (
  <div className="mk-stack">
    <Label htmlFor={id}>{label}</Label>
    <TextArea id={id} {...props} />
  </div>
);

/** EN / RU. The accessible name is the visible text; lang tags how it is read out. */
export const LanguageToggle = ({locale, setLocale, label}) => (
  <ToggleButtonGroup
    selectionMode="single"
    disallowEmptySelection
    selectedKeys={[locale]}
    onSelectionChange={keys => { const next = [...keys][0]; if (next) setLocale(String(next)); }}
    aria-label={label}
  >
    {SUPPORTED_LOCALES.map((item, index) => (
      <ToggleButton key={item.id} id={item.id} lang={item.id}>
        {index > 0 ? <ToggleButtonGroup.Separator /> : null}
        {item.short}
      </ToggleButton>
    ))}
  </ToggleButtonGroup>
);

/** One labelled line inside a card: a kicker over its value. */
export const Field = ({label, children}) => (
  <div>
    <Kicker>{label}</Kicker>
    <p>{children}</p>
  </div>
);
