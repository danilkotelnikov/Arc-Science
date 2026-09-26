import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {Chip} from '@heroui/react/chip';
import {ComboBox} from '@heroui/react/combo-box';
import {Input} from '@heroui/react/input';
import {Kbd} from '@heroui/react/kbd';
import {Label} from '@heroui/react/label';
import {ListBox} from '@heroui/react/list-box';
import {Modal} from '@heroui/react/modal';
import {Separator} from '@heroui/react/separator';
import {Tooltip} from '@heroui/react/tooltip';
import {I18nProvider as AriaLocale} from 'react-aria';
import BioArtWorkspace from './BioArtWorkspace';
import MolecularWorkspace from './MolecularWorkspace';
import ResearchWorkspace from './ResearchWorkspace';
import MemoryWorkspace from './MemoryWorkspace';
import ProseWorkspace from './ProseWorkspace';
import SettingsWorkspace from './SettingsWorkspace';
import DiagnosticsWorkspace from './DiagnosticsWorkspace';
import {Brand} from './brand/Brand.jsx';
import {NATIVE_SESSION, apiFetch} from './http';
import {localizeReadiness} from './readiness';
import {useI18n} from './i18n/index.jsx';
import {GravityIcon} from './theme/gravity-icons.jsx';
import {applyPalette, readStoredPalette, storePalette} from './theme/applyPalette.js';
import {applyMotion, crossFade, readStoredMotion, storeMotion} from './theme/motion.js';
import {LanguageToggle, PaletteSelect} from './ui.jsx';

// The native desktop shell reports finished downloads as `arc-download` window
// events (its WebView shows no download UI); browsers show their own instead.
export function DownloadNotice() {
  const {t} = useI18n();
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    let timer;
    const finished = event => {
      const {file, folder, success} = event.detail || {};
      clearTimeout(timer);
      const name = file || t('header.download.the_file');
      setNotice(success
        ? {tone: 'status', text: folder ? t('header.download.saved_in', {file: name, folder}) : t('header.download.saved', {file: name})}
        : {tone: 'alert', text: file ? t('header.download.failed_file', {file}) : t('header.download.failed')});
      timer = setTimeout(() => setNotice(null), 12000);
    };
    window.addEventListener('arc-download', finished);
    return () => { window.removeEventListener('arc-download', finished); clearTimeout(timer); };
  }, [t]);
  return notice ? <p role={notice.tone} className="ar-download" data-tone={notice.tone}>{notice.text}</p> : null;
}

// The rail: the four workspaces a session runs through, a rule, then the tools.
const RAIL = [
  {id: 'research', icon: 'magnifier'},
  {id: 'memory', icon: 'database'},
  {id: 'molecules', icon: 'molecule'},
  {id: 'bioart', icon: 'picture'},
  {id: 'rule'},
  {id: 'prose', icon: 'text'},
  {id: 'settings', icon: 'gear'},
  {id: 'diagnostics', icon: 'pulse'},
];
const WORKSPACES = RAIL.filter(item => item.icon);

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

const GoTo = memo(function GoTo({isOpen, onOpenChange, onGo}) {
  const {t} = useI18n();
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading>{t('header.search.heading')}</Modal.Heading></Modal.Header>
          <Modal.Body>
            <ComboBox fullWidth menuTrigger="focus" autoFocus onSelectionChange={id => { if (id) { onGo(String(id)); onOpenChange(false); } }}>
              <Label>{t('header.search.field')}</Label>
              <ComboBox.InputGroup>
                <Input placeholder={t('header.search.hint')} />
                <ComboBox.Trigger />
              </ComboBox.InputGroup>
              <ComboBox.Popover>
                <ListBox>
                  {WORKSPACES.map(item => (
                    <ListBox.Item key={item.id} id={item.id} textValue={t(`nav.${item.id}`)}>
                      <Label>{t(`nav.${item.id}`)}</Label>
                    </ListBox.Item>
                  ))}
                </ListBox>
              </ComboBox.Popover>
            </ComboBox>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
});

const RailItem = memo(function RailItem({item, isCurrent, collapsed, onSelect}) {
  const {t} = useI18n();
  const button = (
    <Button variant="ghost" className="bp-rail-item" data-rail={item.id} aria-current={isCurrent ? 'page' : undefined} onPress={() => onSelect(item.id)}>
      <GravityIcon name={item.icon} />
      <span className="ar-rail-label">{t(`nav.${item.id}`)}</span>
    </Button>
  );
  // With the label visible the tooltip would only repeat it.
  if (!collapsed) return button;
  return (
    <Tooltip delay={300}>
      {button}
      <Tooltip.Content>{t(`nav.${item.id}`)}</Tooltip.Content>
    </Tooltip>
  );
});

function SessionControl({token, setToken}) {
  const {t} = useI18n();
  if (token === NATIVE_SESSION) {
    return (
      <div className="ar-row ar-row--tight" role="status">
        <Chip color="success" variant="soft">{t('header.session.native')}</Chip>
        <Button variant="ghost" size="sm" onPress={() => setToken('')}>{t('header.session.use_token')}</Button>
      </div>
    );
  }
  return (
    <div className="ar-token">
      <Label htmlFor="operator-token">{t('header.session.token')}</Label>
      <Input id="operator-token" type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off"
        placeholder={t('header.session.token')} aria-describedby="operator-token-note" />
      <span id="operator-token-note" className="ar-hidden">{t('header.session.token_note')}</span>
    </div>
  );
}

export default function App() {
  const i18n = useI18n();
  const {t, locale, setLocale} = i18n;
  const fromLocation = () => window.location.pathname === '/diagnostics' ? 'diagnostics' : window.history.state?.arcWorkspace || 'research';
  const [workspace, setWorkspace] = useState(fromLocation);
  const [token, setToken] = useState('');
  const [palette, setPalette] = useState(() => readStoredPalette());
  const [motion, setMotion] = useState(() => readStoredMotion());
  const [goToOpen, setGoToOpen] = useState(false);
  const collapsed = useCollapsedRail();

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/session/status', {signal: controller.signal}).then(response => {
      if (response.ok && !controller.signal.aborted) setToken(current => current || NATIVE_SESSION);
    }).catch(() => { /* The ordinary browser and an offline service keep manual unlock. */ });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const restored = () => setWorkspace(fromLocation());
    window.addEventListener('popstate', restored);
    return () => window.removeEventListener('popstate', restored);
  }, []);
  useEffect(() => {
    const onKey = event => {
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'k') { event.preventDefault(); setGoToOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Readiness is read once per session: on its own for a desktop session, on a
  // workspace's request for a manual token. Concurrent requests share one fetch per
  // options; a token change discards the previous answer and any request still in
  // flight. {fresh:true} makes the service re-read CLI logins and the credential store
  // instead of its 30 s cache: it never joins a cached read in flight (that one is
  // dropped), while a cached read arriving during a fresh one joins it.
  const [readiness, setReadiness] = useState(null), [readinessError, setReadinessError] = useState(null);
  const pending = useRef(null);
  const refreshReadiness = useCallback(({fresh = false} = {}) => {
    if (!token) return Promise.resolve(null);
    const path = '/api/readiness' + (fresh ? '?fresh=1' : '');
    if (pending.current?.token === token && (pending.current.path === path || !fresh)) return pending.current.promise;
    pending.current?.controller.abort();
    const controller = new AbortController();
    const promise = apiFetch(path, {token, signal: controller.signal}).then(response => response.json()).then(data => {
      if (controller.signal.aborted) return null;
      setReadiness(data); setReadinessError(null); return data;
    }).catch(error => {
      if (controller.signal.aborted) return null;
      setReadiness(null); setReadinessError(error?.message || String(error)); return null;
    }).finally(() => { if (pending.current?.controller === controller) pending.current = null; });
    pending.current = {token, path, controller, promise};
    return promise;
  }, [token]);
  useEffect(() => {
    if (pending.current && pending.current.token !== token) { pending.current.controller.abort(); pending.current = null; }
    setReadiness(null); setReadinessError(null);
    if (token === NATIVE_SESSION) refreshReadiness();
  }, [token, refreshReadiness]);
  useEffect(() => () => pending.current?.controller.abort(), []);

  const navigate = useCallback(next => {
    const path = next === 'diagnostics' ? '/diagnostics' : '/';
    if (next !== window.history.state?.arcWorkspace || window.location.pathname !== path) window.history.pushState({arcWorkspace: next}, '', path);
    setWorkspace(next);
  }, []);

  // A palette change repaints the whole page, so it cross-fades (motion.js).
  const onPalette = useCallback(id => { storePalette(id); crossFade(() => applyPalette(id), () => setPalette(id)); }, []);
  const onMotion = useCallback(id => { setMotion(applyMotion(id)); storeMotion(id); }, []);
  const appearance = {palette, onPalette, motion, onMotion, locale, setLocale};
  // The service writes readiness in English; every workspace reads it in the chosen language.
  const shownReadiness = useMemo(() => localizeReadiness(readiness, i18n), [readiness, i18n]);
  const shared = {token, setToken, readiness: shownReadiness, readinessError, refreshReadiness, onNavigate: navigate};

  // React Aria formats numbers and dates in HeroUI fields by its own locale; it follows the toggle.
  return (
    <AriaLocale locale={locale === 'ru' ? 'ru-RU' : 'en-US'}>
    <div className="ar-shell">
      <header className="ar-header">
        <Brand />
        <Button variant="secondary" onPress={() => setGoToOpen(true)}>
          <GravityIcon name="magnifier" />
          {t('header.search')}
          <Kbd><Kbd.Content>Ctrl</Kbd.Content><Kbd.Content>K</Kbd.Content></Kbd>
        </Button>
        <DownloadNotice />
        <div className="ar-header-end">
          <LanguageToggle locale={locale} setLocale={setLocale} label={t('header.language')} />
          <PaletteSelect palette={palette} onPalette={onPalette} showLabel={false} />
          <SessionControl token={token} setToken={setToken} />
        </div>
      </header>
      <div className="ar-body">
        <nav className="ar-rail" aria-label={t('nav.label')}>
          {RAIL.map(item => item.id === 'rule' ? <Separator key="rule" /> : (
            <RailItem key={item.id} item={item} isCurrent={workspace === item.id} collapsed={collapsed} onSelect={navigate} />
          ))}
        </nav>
        <main className="ar-main">
          {/* Every workspace stays mounted: credentials, drafts and selections stay in memory. */}
          <div hidden={workspace !== 'research'}><ResearchWorkspace {...shared} /></div>
          <div hidden={workspace !== 'memory'}><MemoryWorkspace {...shared} /></div>
          <div hidden={workspace !== 'molecules'}><MolecularWorkspace {...shared} /></div>
          <div hidden={workspace !== 'bioart'}><BioArtWorkspace {...shared} /></div>
          <div hidden={workspace !== 'prose'}><ProseWorkspace {...shared} /></div>
          <div hidden={workspace !== 'settings'}><SettingsWorkspace {...shared} active={workspace === 'settings'} appearance={appearance} /></div>
          <div hidden={workspace !== 'diagnostics'}><DiagnosticsWorkspace {...shared} active={workspace === 'diagnostics'} /></div>
        </main>
      </div>
      <GoTo isOpen={goToOpen} onOpenChange={setGoToOpen} onGo={navigate} />
    </div>
    </AriaLocale>
  );
}
