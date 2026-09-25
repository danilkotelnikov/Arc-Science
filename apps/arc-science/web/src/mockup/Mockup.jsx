import React, {useCallback, useEffect, useState} from 'react';
import {Button} from '@heroui/react/button';
import {Chip} from '@heroui/react/chip';
import {ComboBox} from '@heroui/react/combo-box';
import {Header} from '@heroui/react/header';
import {Input} from '@heroui/react/input';
import {Kbd} from '@heroui/react/kbd';
import {Label} from '@heroui/react/label';
import {ListBox} from '@heroui/react/list-box';
import {Modal} from '@heroui/react/modal';
import {Select} from '@heroui/react/select';
import {Separator} from '@heroui/react/separator';
import {Tooltip} from '@heroui/react/tooltip';
import {useI18n} from '../i18n/index.jsx';
import {LanguageToggle} from './ui.jsx';
import {PALETTES} from '../theme/palettes.js';
import {applyPalette, readStoredPalette, storePalette} from '../theme/applyPalette.js';
import {GravityIcon} from '../theme/gravity-icons.jsx';
import {LOGO_INNER, LOGO_VIEWBOX, headerCandidate} from './logoAssets.js';
import {MISSIONS} from './fixtures.js';
import ResearchScreen from './screens/ResearchScreen.jsx';
import SettingsScreen from './screens/SettingsScreen.jsx';
import DiagnosticsScreen from './screens/DiagnosticsScreen.jsx';
import LatexScreen from './screens/LatexScreen.jsx';
import LogosScreen from './screens/LogosScreen.jsx';

export const SCREENS = ['research', 'settings', 'diagnostics', 'latex', 'logos'];

// Rail order: the four workspaces a session runs through, a rule, then the tools.
const RAIL = [
  {id: 'research', key: 'nav.research', icon: 'magnifier'},
  {id: 'memory', key: 'nav.memory', icon: 'database'},
  {id: 'molecules', key: 'nav.molecules', icon: 'molecule'},
  {id: 'bioart', key: 'nav.bioart', icon: 'picture'},
  {id: 'rule'},
  {id: 'prose', key: 'nav.prose', icon: 'text'},
  {id: 'latex', key: 'nav.latex', icon: 'file-code'},
  {id: 'settings', key: 'nav.settings', icon: 'gear'},
  {id: 'diagnostics', key: 'nav.diagnostics', icon: 'pulse'},
];

const ACTIONS = [
  {id: 'act-route', key: 'mk.search.action.new_route'},
  {id: 'act-approvals', key: 'mk.search.action.approvals'},
  {id: 'act-export', key: 'mk.search.action.export'},
];

// Below this width the rail hides its labels, and only then does a tooltip add anything.
const RAIL_COLLAPSED = '(max-width: 900px)';

function useCollapsedRail() {
  const [collapsed, setCollapsed] = useState(() => globalThis.matchMedia?.(RAIL_COLLAPSED).matches ?? false);
  useEffect(() => {
    const query = globalThis.matchMedia?.(RAIL_COLLAPSED);
    if (!query) return undefined;
    const onChange = () => setCollapsed(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return collapsed;
}

const viewFromHash = () => {
  const id = String(globalThis.location?.hash || '').replace(/^#\/?/, '').split('/')[0];
  return SCREENS.includes(id) || RAIL.some(item => item.id === id) ? id : null;
};

const tabFromHash = () => String(globalThis.location?.hash || '').replace(/^#\/?/, '').split('/')[1] || null;

function SearchModal({isOpen, onOpenChange}) {
  const {t} = useI18n();
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading>{t('mk.search.heading')}</Modal.Heading></Modal.Header>
          <Modal.Body>
            <ComboBox fullWidth menuTrigger="focus">
              <Label>{t('mk.search.field')}</Label>
              <ComboBox.InputGroup>
                <Input placeholder={t('mk.search.hint')} />
                <ComboBox.Trigger />
              </ComboBox.InputGroup>
              <ComboBox.Popover>
                <ListBox>
                  <ListBox.Section>
                    <Header>{t('mk.search.group.workspaces')}</Header>
                    {RAIL.filter(item => item.key).map(item => (
                      <ListBox.Item key={item.id} id={item.id} textValue={t(item.key)}>
                        <Label>{t(item.key)}</Label>
                      </ListBox.Item>
                    ))}
                  </ListBox.Section>
                  <ListBox.Section>
                    <Header>{t('mk.search.group.missions')}</Header>
                    {MISSIONS.map(mission => (
                      <ListBox.Item key={mission.id} id={mission.id} textValue={t(`${mission.key}.title`)}>
                        <Label>{t(`${mission.key}.title`)}</Label>
                      </ListBox.Item>
                    ))}
                  </ListBox.Section>
                  <ListBox.Section>
                    <Header>{t('mk.search.group.actions')}</Header>
                    {ACTIONS.map(action => (
                      <ListBox.Item key={action.id} id={action.id} textValue={t(action.key)}>
                        <Label>{t(action.key)}</Label>
                      </ListBox.Item>
                    ))}
                  </ListBox.Section>
                </ListBox>
              </ComboBox.Popover>
            </ComboBox>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function PaletteSelect({palette, onPalette}) {
  const {t} = useI18n();
  return (
    <Select className="min-w-[210px] w-max" value={palette} onChange={value => value && onPalette(String(value))}>
      <Label>{t('header.palette')}</Label>
      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
      <Select.Popover>
        <ListBox>
          {PALETTES.map(item => (
            <ListBox.Item key={item.id} id={item.id} textValue={t(item.labelKey)}>
              <Label>
                <span style={{display: 'inline-flex', gap: 2, marginInlineEnd: 8, verticalAlign: 'middle'}}>
                  {[item.colors.background, item.colors.accent, item.colors.accent2].map((hex, index) => (
                    <span key={`${index}-${hex}`} style={{width: 12, height: 12, background: hex, border: '1px solid currentColor', display: 'inline-block'}} />
                  ))}
                </span>
                {t(item.labelKey)}
              </Label>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function RailItem({item, isCurrent, collapsed, onSelect}) {
  const {t} = useI18n();
  const button = (
    <Button
      variant="ghost"
      className="bp-rail-item"
      aria-current={isCurrent ? 'page' : undefined}
      onPress={onSelect}
    >
      <GravityIcon name={item.icon} size={18} />
      <span className="mk-rail-label">{t(item.key)}</span>
    </Button>
  );
  // With the label visible the tooltip would only repeat it.
  if (!collapsed) return button;
  return (
    <Tooltip delay={300}>
      {button}
      <Tooltip.Content>{t(item.key)}</Tooltip.Content>
    </Tooltip>
  );
}

export default function Mockup({initialScreen}) {
  const {t, locale, setLocale} = useI18n();
  const [view, setView] = useState(() => initialScreen || viewFromHash() || 'research');
  const [tab, setTab] = useState(() => tabFromHash());
  const [palette, setPalette] = useState(() => readStoredPalette());
  const [logoId, setLogoId] = useState('snoggo-tile');
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onHash = () => { setView(viewFromHash() || 'research'); setTab(tabFromHash()); };
    globalThis.addEventListener?.('hashchange', onHash);
    return () => globalThis.removeEventListener?.('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onKey = event => {
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, []);

  const onPalette = useCallback(id => { setPalette(applyPalette(id)); storePalette(id); }, []);
  const collapsed = useCollapsedRail();

  const scheme = PALETTES.find(item => item.id === palette)?.scheme;
  const logo = headerCandidate(logoId, scheme);

  return (
    <div className="mk-shell">
      <header className="mk-header">
        <div className="mk-brand">
          <svg
            className="mk-brand-logo"
            width="28"
            height="28"
            viewBox={LOGO_VIEWBOX}
            aria-hidden="true"
            focusable="false"
            dangerouslySetInnerHTML={{__html: LOGO_INNER[logo.id]}}
          />
          <span>Arc Science</span>
          <span className="mk-hidden">{t('mk.logo.slot')}: {t(`mk.logo.${logo.id}`)}</span>
        </div>
        <Button variant="secondary" onPress={() => setSearchOpen(true)}>
          <GravityIcon name="magnifier" />
          {t('mk.search.open')}
          <Kbd><Kbd.Content>Ctrl</Kbd.Content><Kbd.Content>K</Kbd.Content></Kbd>
        </Button>
        <div className="mk-header-end">
          <LanguageToggle locale={locale} setLocale={setLocale} label={t('header.language')} />
          <PaletteSelect palette={palette} onPalette={onPalette} />
          <Select className="min-w-[210px] w-max" value={SCREENS.includes(view) ? view : null} onChange={value => value && setView(String(value))}>
            <Label>{t('mk.screen.label')}</Label>
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                {SCREENS.map(id => (
                  <ListBox.Item key={id} id={id} textValue={t(`mk.screen.${id}`)}>
                    <Label>{t(`mk.screen.${id}`)}</Label>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <Chip color="success" variant="soft">{t('header.session.native')}</Chip>
        </div>
      </header>

      <div className="mk-body">
        <nav className="mk-rail" aria-label={t('nav.label')}>
          {RAIL.map(item => item.id === 'rule' ? <Separator key="rule" className="my-2" /> : (
            <RailItem
              key={item.id}
              item={item}
              isCurrent={view === item.id}
              collapsed={collapsed}
              onSelect={() => setView(item.id)}
            />
          ))}
        </nav>

        <main className="mk-main">
          {/* The tab lives in the hash, so a hash change remounts the cockpit on that tab. */}
          {view === 'research' ? <ResearchScreen key={tab || 'overview'} initialTab={tab} /> : null}
          {view === 'settings' ? <SettingsScreen palette={palette} onPalette={onPalette} /> : null}
          {view === 'diagnostics' ? <DiagnosticsScreen /> : null}
          {view === 'latex' ? <LatexScreen /> : null}
          {view === 'logos' ? <LogosScreen logoId={logoId} onLogo={setLogoId} /> : null}
          {SCREENS.includes(view) ? null : (
            <section className="bp-panel">
              <h1>{t(`nav.${view}`)}</h1>
              <p>{t('mk.screen.placeholder')}</p>
            </section>
          )}
        </main>
      </div>

      <SearchModal isOpen={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
