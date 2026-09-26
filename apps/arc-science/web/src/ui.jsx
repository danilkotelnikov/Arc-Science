import React, {useState} from 'react';
import {Label} from '@heroui/react/label';
import {ListBox} from '@heroui/react/list-box';
import {Select} from '@heroui/react/select';
import {ToggleButton} from '@heroui/react/toggle-button';
import {ToggleButtonGroup} from '@heroui/react/toggle-button-group';
import {SUPPORTED_LOCALES, useI18n} from './i18n/index.jsx';
import {MOTION_MODES, firstEntry} from './theme/motion.js';
import {PALETTES} from './theme/palettes.js';

// Small Blockprint wrappers shared by every workspace. Class names come from
// blockprint.css and app.css; nothing here restyles a HeroUI component.

/** The offset shadow is reserved for primary blocks; everything else is a plain panel. */
export const Block = ({variant, className = '', children, ...props}) => (
  <section className={`${variant === 'primary' ? 'bp-block bp-block--primary' : 'bp-panel'} ${className}`} {...props}>
    {children}
  </section>
);

/** A workspace's opening lines: kicker, title and one short lead. */
export const PageHead = ({kicker, title, lead, children}) => (
  <header className="ar-page-head">
    <div className="ar-stack ar-stack--tight">
      {kicker ? <p className="bp-kicker">{kicker}</p> : null}
      <h1>{title}</h1>
      {lead ? <p className="ar-lead">{lead}</p> : null}
    </div>
    {children ? <div className="ar-row">{children}</div> : null}
  </header>
);

export const Kicker = ({children}) => <p className="bp-kicker">{children}</p>;

export const Meta = ({children}) => <p className="bp-meta">{children}</p>;

/** A state mark and its words; the words are an element of their own so text-box can trim them. */
export const Status = ({state, children}) => (
  <span className="bp-status" data-state={state}><span className="bp-label">{children}</span></span>
);

/**
 * data-enter for a workspace root: set only the first time that workspace mounts in this
 * session, so its block lists play the entry stagger once (motion.css).
 */
export function useFirstEntry(id) {
  const [first] = useState(() => firstEntry(id));
  return first ? '' : undefined;
}

/** One labelled line inside a card: a kicker over its value. */
export const Field = ({label, children}) => (
  <div>
    <p className="bp-kicker">{label}</p>
    <div>{children}</div>
  </div>
);

/** A list of label and value pairs: the reading form of a record. */
export const Facts = ({items}) => (
  <dl className="ar-facts">
    {items.filter(Boolean).map(([label, value], index) => (
      <div key={index}><dt>{label}</dt><dd>{value}</dd></div>
    ))}
  </dl>
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

/** System / Reduced / Off, stored like the palette (motion.js). */
export const MotionToggle = ({value, onChange, label}) => {
  const {t} = useI18n();
  return (
    <ToggleButtonGroup
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={keys => { const next = [...keys][0]; if (next) onChange(String(next)); }}
      aria-label={label}
    >
      {MOTION_MODES.map((mode, index) => (
        <ToggleButton key={mode} id={mode}>
          {index > 0 ? <ToggleButtonGroup.Separator /> : null}
          {t(`motion.${mode}`)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
};

/** The palette picker, in the header (label hidden) and in Settings. Each name has its three swatches. */
export function PaletteSelect({palette, onPalette, showLabel = true}) {
  const {t} = useI18n();
  return (
    <Select className="ar-palette" value={palette} onChange={value => value && onPalette(String(value))} aria-label={showLabel ? undefined : t('header.palette')}>
      {showLabel ? <Label>{t('header.palette')}</Label> : null}
      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
      <Select.Popover>
        <ListBox>
          {PALETTES.map(item => (
            <ListBox.Item key={item.id} id={item.id} textValue={t(item.labelKey)}>
              {/* Plain content, not a Label: Select copies the chosen item into its trigger. */}
              <span>
                <span className="ar-swatches" aria-hidden="true">
                  {[item.colors.background, item.colors.accent, item.colors.accent2].map((hex, index) => (
                    <span key={`${index}-${hex}`} style={{background: hex}} />
                  ))}
                </span>
                {t(item.labelKey)}
              </span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
