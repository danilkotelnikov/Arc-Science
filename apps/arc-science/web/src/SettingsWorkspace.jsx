import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Accordion} from '@heroui/react/accordion';
import {Alert} from '@heroui/react/alert';
import {Button} from '@heroui/react/button';
import {NATIVE_SESSION, apiFetch, sessionState} from './http';
import {useI18n} from './i18n/index.jsx';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';
import {sentence, stateLabel, stateOf} from './readiness';
import {Block, Kicker, LanguageToggle, MotionToggle, PageHead, PaletteSelect, Status, useFirstEntry} from './ui.jsx';
import {CheckField, More, Note, StateCard, TextInput} from './settings/controls.jsx';
import {CREDENTIAL_WAIT_MS, FALLBACK_CATALOG, ROLES, changedPaths, describeSettingsError, hostIpc, roleLabel, seatIssue, sectionLabel, setPath, withPath} from './settings/model.js';
import {SeatCard} from './settings/SeatCard.jsx';
import {CheckReport, Connections, ListEditor, Permissions, Providers, ViewerFields} from './settings/sections.jsx';

// The settings document itself lives in settings/model.js (what a seat may hold and how a
// failure is named); this file holds the requests, their order and the page.
const OPEN_FIRST = ['models'];

export default function SettingsWorkspace({token, setToken, active = false, readiness = null, readinessError = null, refreshReadiness, onNavigate, appearance = null}) {
  const i18n = useI18n();
  const {t} = i18n;
  const [snapshot, setSnapshot] = useState(null), [draft, setDraft] = useState(null);
  // `notice` is a function of t, so a notice follows a language switch.
  const [error, setError] = useState(null), [notice, setNotice] = useState(null), [busy, setBusy] = useState(false);
  // Per role: probe consent (one tick per click, never remembered), the seat waiting on
  // the host's credential prompt, and the seat whose Remove asks for confirmation.
  const [consent, setConsent] = useState({}), [waiting, setWaiting] = useState(null), [confirming, setConfirming] = useState(null);
  const [checks, setChecks] = useState({}), [authExpired, setAuthExpired] = useState(false);
  // Roles whose model picker is on "Custom id…" although the typed id may be in the catalog.
  const [customRoles, setCustomRoles] = useState({});
  // The grant ledger as last read (null until the Permissions section asks), its filter, and
  // the grant whose Revoke is waiting for a reason.
  const [grants, setGrants] = useState(null), [grantFilter, setGrantFilter] = useState('all'), [revoking, setRevoking] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set(OPEN_FIRST));
  const credential = useRef(null), autoloaded = useRef(false), running = useRef(false), waitCancel = useRef(null), actions = useRef(null);
  const act = useCallback((kind, ...args) => actions.current[kind](...args), []);
  const entry = useFirstEntry('settings');
  const catalog = readiness?.catalog || FALLBACK_CATALOG, catalogLoaded = Boolean(readiness?.catalog);
  const say = render => setNotice(() => render);
  useLayoutEffect(() => {
    const controller = new AbortController(); credential.current = controller;
    setSnapshot(null); setDraft(null); setError(null); setNotice(null); setBusy(false); setConsent({}); setWaiting(null); setConfirming(null); setChecks({}); setAuthExpired(false); setCustomRoles({}); setGrants(null); setRevoking(null);
    setExpanded(new Set(OPEN_FIRST));
    autoloaded.current = false; running.current = false;
    return () => controller.abort();
  }, [token]);
  const read = useCallback(async (path, signal, method = 'GET', body) => {
    signal.throwIfAborted();
    const response = await apiFetch('/api' + path, {token, method, signal, headers: {'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
    const data = await response.json();
    signal.throwIfAborted();
    return data;
  }, [token]);
  // `label` (a function of t) names the action in the error card; `where` says which
  // control the card sits under; `recover` turns the failure into the card's one button.
  async function task(action, label, where = 'sidebar', recover) {
    // One request at a time. Buttons are disabled while busy; the ref also covers the
    // same tick, when the token field's focusout autoload precedes a click on Load settings.
    if (running.current) return;
    const signal = credential.current.signal;
    running.current = true; setBusy(true); setError(null); setNotice(null);
    try { await action(signal); }
    catch (e) {
      if (signal.aborted) return;
      // A rejected token is the one LockNotice in the error tone, not a card plus an alert.
      if (/Request failed \((401|403)\)/.test(e.message)) { setAuthExpired(true); return; }
      setError({...describeSettingsError(e), label, where, recover: recover?.(e) || null});
    }
    finally { if (!signal.aborted) { running.current = false; setBusy(false); } }
  }
  const errorAt = where => error?.where === where ? <StateCard state={error} /> : null;
  async function load(signal) {
    const snap = await read('/settings', signal);
    setSnapshot(snap); setDraft(structuredClone(snap.settings)); setCustomRoles({});
  }
  // main.jsx owns the readiness request and its error; this only asks (cached, idempotent).
  // {fresh: true} re-reads the CLI logins and the credential store instead of the 30 s cache.
  const askReadiness = options => Promise.resolve(refreshReadiness?.(options)).catch(() => {});
  const loadTask = () => { askReadiness(); return task(load, tr => tr('settings.action.load'), 'sidebar', () => ({labelKey: 'common.retry', run: loadTask})); };
  // The snapshot loads by itself on discrete events only: the workspace shown with a
  // session, the shell's desktop session arriving, and the header token field settling
  // (Tab, Enter or a click elsewhere) while Settings is shown. Never on a keystroke: a
  // half-typed token sends nothing and draws no rejection. Later visits keep whatever is
  // on screen (unsaved edits included); a new token resets and waits to settle again.
  const native = token === NATIVE_SESSION;
  const autoload = () => {
    if (!active || !token || snapshot || busy || autoloaded.current) return;
    autoloaded.current = true;
    loadTask();
  };
  useEffect(() => { autoload(); }, [active, native]);
  useEffect(() => {
    // Re-subscribed each render so the handler loads with the token on screen at that moment.
    if (!active) return undefined;
    const settled = event => { if (event.target?.id === 'operator-token' && (event.type === 'focusout' || event.key === 'Enter')) autoload(); };
    document.addEventListener('focusout', settled); document.addEventListener('keydown', settled);
    return () => { document.removeEventListener('focusout', settled); document.removeEventListener('keydown', settled); };
  });
  async function check(kind, signal) {
    // Cost-free and data-free: an MCP server lists its tools, an ACP agent answers initialize.
    const result = await read(kind === 'mcp' ? '/mcp/servers/check' : '/acp/agents/check', signal, 'POST');
    setChecks(current => ({...current, [kind]: result}));
  }
  async function probe(provider, role, signal) {
    // Explicit consent per click: one real call per distinct subject among the five seats
    // on that provider (CLI and API alike). The result is read back through readiness,
    // and the tick is spent whatever the outcome.
    try { await read('/providers/' + provider + '/probe', signal, 'POST', {spend_tokens: true}); }
    finally { if (!signal.aborted) setConsent(current => ({...current, [role]: false})); }
    askReadiness();
  }
  // The host shows the Windows prompt and stores or deletes the entry; the page only posts
  // the request and waits for the arc-credential answer for that name. The operator may
  // take minutes in the dialog, so the wait is long and Cancel waiting only stops waiting.
  function credentialRequest(kind, role, seat, signal) {
    const name = seat.credential;
    return new Promise((resolve, reject) => {
      const stop = () => { clearTimeout(timer); window.removeEventListener('arc-credential', answered); signal.removeEventListener('abort', aborted); waitCancel.current = null; setWaiting(null); };
      const aborted = () => { stop(); reject(new Error('aborted')); };
      // The host answers a refused message with kind and name null; while a request waits it is ours.
      const answered = event => { const detail = event.detail || {}; if ((detail.kind === kind && detail.name === name) || (detail.kind === null && detail.error)) { stop(); resolve({...detail, kind, name}); } };
      const timer = setTimeout(() => { stop(); reject(new Error(t('settings.credential.timeout'))); }, CREDENTIAL_WAIT_MS);
      window.addEventListener('arc-credential', answered); signal.addEventListener('abort', aborted);
      waitCancel.current = () => { stop(); resolve({kind, name, stopped: true}); };
      setWaiting(role);
      window.ipc.postMessage(JSON.stringify(kind === 'store-credential' ? {kind, name, provider: seat.provider} : {kind, name}));
    });
  }
  async function store(role, seat, signal) {
    const answer = await credentialRequest('store-credential', role, seat, signal);
    if (answer.error) throw new Error(answer.error);
    say(tr => answer.stopped ? tr('settings.notice.stopped') : answer.stored ? tr('settings.notice.stored', {name: seat.credential}) : tr('settings.notice.cancelled'));
    if (answer.stored) askReadiness({fresh: true});
  }
  async function remove(role, seat, signal) {
    setConfirming(null);
    const answer = await credentialRequest('remove-credential', role, seat, signal);
    if (answer.error) throw new Error(answer.error);
    say(tr => answer.stopped ? tr('settings.notice.stopped') : tr('settings.notice.removed', {name: seat.credential}));
    if (!answer.stopped) askReadiness({fresh: true});
  }
  // The ledger derives each grant's state, uses and last use; the page only lists them.
  // Settings consent (Connections) creates no grant, so nothing here comes from the draft.
  async function loadGrants(signal) {
    const data = await read('/grants', signal);
    setGrants(Array.isArray(data) ? data : data.grants || []);
  }
  const grantsTask = () => task(loadGrants, tr => tr('settings.action.load_grants'), 'grants', () => ({labelKey: 'common.retry', run: grantsTask}));
  async function revoke(grant, reason, signal) {
    // Append-only: the ledger records the event, and the grant's next use is refused.
    await read('/grants/' + grant.id + '/revoke', signal, 'POST', {reason});
    setRevoking(null);
    await loadGrants(signal);
    say(tr => tr('settings.notice.revoked', {destination: grant.destination}));
  }
  async function save(signal) {
    const snap = await read('/settings', signal, 'PUT', {settings: draft, if_revision: snapshot.revision});
    setSnapshot(snap); setDraft(structuredClone(snap.settings));
    askReadiness();
    const effects = Array.isArray(snap.effects) ? snap.effects : [];
    const bound = Number(snap.bound_missions) || 0;
    say(tr => [tr('settings.notice.saved', {rev: snap.revision.slice(0, 12)}),
      ...effects.map(effect => tr('settings.notice.applies', {section: sectionLabel(catalog, effect.section, tr), when: effect.applies})),
      ...new Set(effects.map(effect => effect.note).filter(Boolean)),
      snap.restart_note,
      bound > 0 ? tr('settings.notice.bound', {count: bound}) : ''
    ].filter(Boolean).join(' '));
  }
  // After a 409: the newer snapshot is loaded and only the paths this draft changed
  // (against the snapshot it was loaded from) are put back onto it, for review.
  async function rebase(signal) {
    const changes = changedPaths(snapshot.settings, draft);
    const snap = await read('/settings', signal);
    const next = structuredClone(snap.settings);
    for (const [path, value] of changes) setPath(next, path, value);
    setSnapshot(snap); setDraft(next);
    say(tr => tr('settings.notice.rebased', {rev: snap.revision.slice(0, 12)}));
  }
  const saveTask = () => task(save, tr => tr('settings.action.save'), 'sidebar', e => /Request failed \(409\)/.test(e.message) ? {labelKey: 'settings.rebase', run: () => task(rebase, tr => tr('settings.rebase'))} : null);
  const dirty = snapshot && draft && JSON.stringify(draft) !== JSON.stringify(snapshot.settings);
  const set = useCallback((path, value) => setDraft(current => withPath(current, path, value)), []);
  const readOnly = snapshot?.read_only === true;
  const seatIssues = draft ? ROLES.map(role => seatIssue(catalog, role, draft.seats[role], t)).filter(Boolean) : [];
  const revisionWords = snapshot ? t(readOnly ? 'settings.status.read_only' : dirty ? 'settings.status.unsaved' : 'settings.status.saved', {rev: snapshot.revision.slice(0, 12)}) : t('settings.status.not_loaded');
  const saveBlocker = !snapshot ? t('settings.blocker.not_loaded') : readOnly ? t('settings.blocker.read_only') : seatIssues.length > 0 ? t('settings.blocker.seats') : !dirty ? t('settings.blocker.clean') : '';
  const liveMission = readiness?.live_mission || null;
  const liveState = stateOf(liveMission);
  const ipc = native && hostIpc();
  const consoleProfile = readiness?.providers?.anthropic?.console_profile || null;
  // What a seat card or the permission list may ask for, read from this render when it asks.
  // `act` itself keeps one identity, so the memoised parts do not render again for keystrokes
  // elsewhere.
  actions.current = {
    set: (role, key, value) => set(['seats', role, key], value),
    custom: (role, on) => setCustomRoles(current => ({...current, [role]: on})),
    consent: (role, on) => setConsent(current => ({...current, [role]: on})),
    confirm: (role, on) => setConfirming(on ? role : null),
    cancelWait: () => waitCancel.current?.(),
    recheck: () => askReadiness({fresh: true}),
    // The host answers only in the desktop window; the seat is the one on screen now.
    store: role => { const seat = draft.seats[role]; task(signal => store(role, seat, signal), tr => tr('settings.action.store'), 'seat:' + role); },
    remove: role => { const seat = draft.seats[role]; task(signal => remove(role, seat, signal), tr => tr('settings.action.remove'), 'seat:' + role); },
    test: role => { const saved = snapshot.settings.seats[role]; task(signal => probe(saved.provider, role, signal), tr => tr('settings.action.test', {seat: roleLabel(tr, role)}), 'seat:' + role); },
    refreshGrants: () => grantsTask(),
    revoke: (grant, reason) => task(signal => revoke(grant, reason, signal), tr => tr('settings.action.revoke'), 'grants'),
  };
  // A section opens on its own; Permissions reads the ledger each time it opens.
  const onExpandedChange = keys => {
    const next = new Set(keys);
    if (next.has('permissions') && !expanded.has('permissions')) grantsTask();
    setExpanded(next);
  };
  const section = (id, body) => (
    <Accordion.Item key={id} id={id}>
      <Accordion.Heading level={2}>
        <Accordion.Trigger>
          <span className="ar-stack ar-stack--tight text-start">
            <span className="text-lg font-semibold text-foreground">{t('settings.' + id + '.title')}</span>
            <span className="ar-note font-normal">{t('settings.' + id + '.summary')}</span>
          </span>
          <Accordion.Indicator />
        </Accordion.Trigger>
      </Accordion.Heading>
      <Accordion.Panel aria-label={t('settings.' + id + '.title')}>
        {/* HeroUI mutes an accordion body; these panels are the page itself. */}
        <Accordion.Body className="ar-stack text-foreground">{body}</Accordion.Body>
      </Accordion.Panel>
    </Accordion.Item>
  );

  const sections = [];
  if (appearance) sections.push(section('appearance', <>
    <div className="ar-board">
      <div className="ar-stack ar-stack--tight">
        <Kicker>{t('header.palette')}</Kicker>
        <PaletteSelect palette={appearance.palette} onPalette={appearance.onPalette} showLabel={false} />
      </div>
      <div className="ar-stack ar-stack--tight">
        <Kicker>{t('motion.label')}</Kicker>
        <MotionToggle value={appearance.motion} onChange={appearance.onMotion} label={t('motion.label')} />
      </div>
      <div className="ar-stack ar-stack--tight">
        <Kicker>{t('header.language')}</Kicker>
        <LanguageToggle locale={appearance.locale} setLocale={appearance.setLocale} label={t('header.language')} />
      </div>
    </div>
    <p className="ar-note">{t('settings.appearance.note')}</p>
  </>));
  if (draft) sections.push(
    section('models', <>
      {seatIssues.length > 0 ? (
        <Alert status="warning" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t('settings.seats.issues')}</Alert.Title>
            <ul>{seatIssues.map(issue => <li key={issue.role}>{issue.message}</li>)}</ul>
          </Alert.Content>
        </Alert>
      ) : null}
      {!catalogLoaded ? <p className="ar-note">{readinessError ? t('settings.catalog.missing_error', {error: readinessError}) : t('settings.catalog.missing')}</p> : null}
      <div className="bp-panel ar-row" role="group" data-state={liveState} aria-label={t('settings.live.label')}>
        <Status state={liveState}>{stateLabel(liveState, i18n)}</Status>
        <p className="flex-1"><strong>{t('settings.live.kicker')}</strong> {sentence(liveMission?.meaning || readinessError || t('settings.readiness.not_loaded'))}{liveMission?.next_action ? ' ' + t('settings.next', {action: sentence(liveMission.next_action)}) : ''}</p>
        {onNavigate && liveState === 'ready' ? <Button variant="ghost" size="sm" onPress={() => onNavigate('research')}>{t('settings.live.open')}</Button> : null}
      </div>
      <div className="ar-stack">
        {ROLES.map(role => <SeatCard key={role} role={role} seat={draft.seats[role]} saved={snapshot.settings.seats[role]} node={readiness?.seats?.[role] || null}
          readinessError={readinessError} catalog={catalog} catalogLoaded={catalogLoaded} readOnly={readOnly} custom={Boolean(customRoles[role])} profile={consoleProfile}
          ipc={ipc} busy={busy} consent={Boolean(consent[role])} waiting={waiting === role} confirming={confirming === role} error={errorAt('seat:' + role)} act={act} />)}
      </div>
      <More title={t('settings.credentials.title')} level={3}>
        <p>{t('settings.credentials.api')} <code>arc-science credential --name {t('settings.access.terminal_name')}</code></p>
        <p>{t('settings.credentials.origin')}</p>
        <p>{t('settings.credentials.cli')}</p>
        <p>{t('settings.credentials.effort')}</p>
      </More>
    </>),
    section('connections', <>
      <Connections readiness={readiness} readinessError={readinessError} catalog={catalog} />
      <h3>{t('settings.mcp.title')}</h3>
      <ListEditor rows={draft.mcp_servers} readOnly={readOnly} kind="mcp" set={set} />
      <div className="ar-row">
        <Button variant="secondary" size="sm" isDisabled={busy || !snapshot} onPress={() => task(signal => check('mcp', signal), tr => tr('settings.action.check_mcp'), 'mcp')}>{t('settings.mcp.check')}</Button>
        <p className="ar-note">{t('settings.mcp.check_note')}</p>
      </div>
      {errorAt('mcp')}
      {checks.mcp ? <CheckReport kind="mcp" result={checks.mcp} /> : null}
      <Note hint={t('settings.mcp.consent_more')}>{t('settings.mcp.consent')}</Note>
      <h3>{t('settings.acp.title')}</h3>
      <ListEditor rows={draft.acp_agents} readOnly={readOnly} kind="acp" set={set} />
      <div className="ar-row">
        <Button variant="secondary" size="sm" isDisabled={busy || !snapshot} onPress={() => task(signal => check('acp', signal), tr => tr('settings.action.check_acp'), 'acp')}>{t('settings.acp.check')}</Button>
        <p className="ar-note">{t('settings.acp.check_note')}</p>
      </div>
      {errorAt('acp')}
      {checks.acp ? <CheckReport kind="acp" result={checks.acp} /> : null}
      <Note hint={t('settings.acp.consent_more')}>{t('settings.acp.consent')}</Note>
    </>),
    section('rendering', (
      <div className="ar-board">
        <TextInput label={t('settings.rendering.preset')} value={draft.blender.default_preset} isDisabled={readOnly} placeholder={t('settings.rendering.placeholder')}
          onChange={value => set(['blender', 'default_preset'], value)} />
      </div>
    )),
    section('viewer', <ViewerFields viewer={draft.viewer} readOnly={readOnly} set={set} />),
    section('advanced', <>
      <Providers providers={draft.providers} catalog={catalog} readOnly={readOnly} set={set} setDraft={setDraft} />
      <div className="ar-stack ar-stack--tight">
        <CheckField isSelected={draft.prose.detection} isDisabled={readOnly} onChange={on => set(['prose', 'detection'], on)}>{t('settings.advanced.detection')}</CheckField>
        <p className="ar-note">{t('settings.advanced.detection_note')}</p>
      </div>
    </>),
    section('permissions', (
      <Permissions grants={grants} filter={grantFilter} setFilter={setGrantFilter} revoking={revoking} setRevoking={setRevoking} busy={busy} error={errorAt('grants')} act={act} />
    )),
  );

  return (
    <div className="ar-stack" data-enter={entry}>
      <PageHead kicker={t('nav.settings')} title={t('settings.title')} lead={t('settings.lead')}>
        <Button variant="secondary" isDisabled={busy || !token} onPress={loadTask}>{snapshot ? t(dirty ? 'settings.reload_discard' : 'settings.reload') : t('settings.load')}</Button>
        <Button variant="primary" isDisabled={busy || !dirty || readOnly || seatIssues.length > 0} onPress={saveTask}>{t('common.save')}</Button>
      </PageHead>
      <Block className="ar-stack ar-stack--tight" aria-label={t('settings.file.label')}>
        <div className="ar-row" aria-live="polite">
          {snapshot ? <strong>{revisionWords}</strong> : <span className="text-muted">{revisionWords}</span>}
          {/* A long path has no break opportunity of its own; it wraps anywhere rather than widen the page. */}
          {snapshot ? <code className="min-w-0 [overflow-wrap:anywhere]">{snapshot.path.replace(/^\\\\\?\\/, '')}</code> : null}
        </div>
        {saveBlocker && token && !busy ? <p className="ar-note">{saveBlocker}</p> : null}
        <LockNotice card={sessionState(token, authExpired)} tone={authExpired ? 'error' : 'info'} onUnlock={() => focusTokenField(token, setToken)} unlockLabel={unlockLabel(token, t)} />
        {busy ? <p role="status">{t('settings.busy')}</p> : null}
        {errorAt('sidebar')}
        {notice ? <p role="status">{notice(t)}</p> : null}
      </Block>
      <section className="ar-stack" aria-label={t('settings.region')}>
        {!draft ? (
          <Block>
            {!token ? <p className="ar-lead">{t('settings.empty.no_token')}</p>
              : error || authExpired ? <p className="ar-lead">{t('settings.empty.failed')}</p>
              : busy ? <p role="status">{t('settings.empty.loading')}</p>
              : <p className="ar-lead">{t('settings.empty.waiting')}</p>}
          </Block>
        ) : null}
        {sections.length > 0 ? <Accordion allowsMultipleExpanded expandedKeys={expanded} onExpandedChange={onExpandedChange}>{sections}</Accordion> : null}
      </section>
    </div>
  );
}
