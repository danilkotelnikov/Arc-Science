import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Alert} from '@heroui/react/alert';
import {Button} from '@heroui/react/button';
import {Disclosure} from '@heroui/react/disclosure';
import {Table} from '@heroui/react/table';
import {Tooltip} from '@heroui/react/tooltip';
import {NATIVE_SESSION, apiFetch, checkedFetch, sessionLine, sessionState} from './http';
import {useI18n} from './i18n/index.jsx';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';
import {loginLine, probeLine, stateLabel, stateOf} from './readiness';
import {Block, Facts, Meta, PageHead, Status, useFirstEntry} from './ui.jsx';

const hostIpc = () => typeof window.ipc?.postMessage === 'function';

const messageOf = error => error?.message || String(error);
const isAuthError = error => /Request failed \((401|403)\)/.test(messageOf(error));
const words = value => typeof value === 'string' ? value.replace(/_/g, ' ') : value;
const short = id => String(id || '').slice(0, 12) + '…';
const flag = (value, t) => typeof value === 'boolean' ? t(value ? 'common.yes' : 'common.no') : value;
const found = (value, t) => value === true ? t('common.yes') : value === false ? t('common.no') : t('diagnostics.unknown');
const at = (seconds, {t, d}) => seconds > 0 ? d(seconds * 1000, {dateStyle: 'medium', timeStyle: 'short'}) : t('diagnostics.unknown_time');

function friendlyError(message, kind, t) {
  if (/Request failed \(503\)/.test(message)) return t(kind === 'readiness' ? 'diagnostics.error.readiness_unavailable' : 'diagnostics.error.checks_unavailable');
  // A 409 carries the service's own sentence (a blocked release, an unavailable renderer); it is shown, not replaced.
  const refused = /^Request failed \(409\)(?:: ([\s\S]*))?$/.exec(message);
  if (refused) return t('diagnostics.error.refused', {detail: refused[1] || t('diagnostics.no_detail')});
  if (/Request failed \(\d+\)/.test(message)) return t('diagnostics.error.request');
  if (/Failed to fetch|NetworkError|Load failed/.test(message)) return sessionLine('offline', t);
  if (/JSON|Unexpected token|Unexpected end/.test(message)) return t('diagnostics.error.unreadable');
  return message.replace(/\s+/g, ' ').trim();
}

// The card beside a failed connection check keeps one short line; the alert beside the button carries the instruction.
function protectedFailure(error) {
  if (isAuthError(error)) return {locked: true};
  return {available: false, reason: /Request failed \(503\)/.test(messageOf(error)) ? 'unavailable' : 'failed'};
}

function stateFor(report) {
  if (report === null) return 'not_tested';
  if (report?.locked) return 'blocked';
  if (report?.available === false) return 'failed';
  return 'ready';
}

// What /health says about who started the service, read beside what this page holds. The service only
// knows owned (ARC_HOST_SESSION from a desktop child) or standalone; "reused" is this page's inference.
function hostSessionOf(health, native, t) {
  const of = key => ({key, value: t('diagnostics.host.' + key), note: t('diagnostics.host.' + key + '_note')});
  if (!health || health.available === false) return of('unread');
  if (!health.host_session) return of('unreported');
  const mode = health.host_session.mode;
  if (mode === 'owned') return of(native ? 'owned' : 'reused');
  if (mode === 'standalone') return of('standalone');
  return {key: 'unknown', value: mode == null ? t('diagnostics.unknown') : String(mode), note: t('diagnostics.host.unknown_note')};
}

/** One record table: a HeroUI Table in the horizontal scroller, the first column naming each row. */
function Records({label, columns, children}) {
  return <div className="ar-table-scroll">
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={label}>
          <Table.Header>{columns.map((name, index) => <Table.Column key={name} isRowHeader={index === 0}>{name}</Table.Column>)}</Table.Header>
          <Table.Body>{children}</Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  </div>;
}

function StateMark({state}) {
  const i18n = useI18n();
  return <Status state={state}>{stateLabel(state, i18n)}</Status>;
}

function Card({title, state, attrs, children}) {
  return <article className="bp-panel ar-stack ar-stack--tight" data-state={state} {...attrs}>
    <div className="ar-row justify-between"><h3>{title}</h3><StateMark state={state}/></div>
    {children}
  </article>;
}

function NextAction({text}) {
  const {t} = useI18n();
  return <p><strong>{t('diagnostics.next')}</strong> {text}</p>;
}

// Every readiness node speaks its meaning; a node that is not ready also says what to do.
function Meaning({node}) {
  return <>
    {node.meaning && <p>{node.meaning}</p>}
    {stateOf(node) !== 'ready' && node.next_action && <NextAction text={node.next_action}/>}
  </>;
}

function ReadinessCard({title, node, placeholder, attrs, footer, children}) {
  if (!node) return <Card title={title} state="unknown" attrs={attrs}><p className="ar-note">{placeholder}</p></Card>;
  return <Card title={title} state={stateOf(node)} attrs={attrs}>{children}<Meaning node={node}/>{footer}</Card>;
}

// One diagnostics section as a card: the facts, then the service's meaning, then where it read them.
function SectionCard({name, title, section, placeholder, children}) {
  const i18n = useI18n();
  const footer = section && <Meta>{i18n.t('diagnostics.section_source', {source: section.source, at: at(section.checked_at, i18n)})}</Meta>;
  return <ReadinessCard title={title} node={section} placeholder={placeholder} attrs={{'data-section': name}} footer={footer}>{section && children}</ReadinessCard>;
}

// The readiness cell of a seat or connector row: the state mark, the service's meaning and, unless ready, its next action.
function NodeCell({node}) {
  const {t} = useI18n();
  const state = stateOf(node);
  return <div className="ar-stack ar-stack--tight">
    <span><StateMark state={state}/></span>
    {node?.meaning && <span>{node.meaning}</span>}
    {state !== 'ready' && node?.next_action && <span className="ar-note">{t('diagnostics.next')} {node.next_action}</span>}
  </div>;
}

function CheckLine({report, intro, t}) {
  if (!report) return <p className="ar-note">{intro}</p>;
  if (report.locked) return <p className="ar-note">{t('diagnostics.locked_line')}</p>;
  if (report.available === false) return <p className="ar-note">{t('diagnostics.check.' + report.reason)}</p>;
  return null;
}

const unavailableRow = (row, t) => t('diagnostics.check.row_unavailable', {error: row.error || t('diagnostics.check.row_failed')});

function McpReport({report}) {
  const {t} = useI18n();
  if (!report || report.locked || report.available === false) return <CheckLine report={report} intro={t('diagnostics.mcp.intro')} t={t}/>;
  const servers = report.servers || [];
  const toolName = tool => tool.offered === false
    ? t(tool.reason ? 'diagnostics.mcp.not_offered_reason' : 'diagnostics.mcp.not_offered', {name: tool.name, reason: tool.reason})
    : tool.name;
  return <>
    <Facts items={[[t('diagnostics.mcp.sdk'), report.sdk || t('diagnostics.unavailable')], [t('diagnostics.mcp.consented'), (report.consented || []).join(', ') || t('common.none')]]}/>
    {servers.length ? <Records label={t('diagnostics.mcp.table')} columns={[t('diagnostics.mcp.col.server'), t('diagnostics.mcp.col.tools')]}>
      {servers.map(server => <Table.Row key={server.server}>
        <Table.Cell>{server.server}</Table.Cell>
        <Table.Cell>{server.ok ? (server.tools || []).map(toolName).join(', ') || t('diagnostics.mcp.no_tools') : unavailableRow(server, t)}</Table.Cell>
      </Table.Row>)}
    </Records> : <p className="ar-note">{t('diagnostics.mcp.none')}</p>}
  </>;
}

function AcpReport({report}) {
  const {t} = useI18n();
  if (!report || report.locked || report.available === false) return <CheckLine report={report} intro={t('diagnostics.acp.intro')} t={t}/>;
  const agents = report.agents || [];
  return <>
    <Facts items={[[t('diagnostics.acp.protocol'), report.protocol_version || t('diagnostics.unavailable')], [t('diagnostics.acp.consented'), (report.consented || []).join(', ') || t('common.none')]]}/>
    {agents.length ? <Records label={t('diagnostics.acp.table')} columns={[t('diagnostics.acp.col.agent'), t('diagnostics.acp.col.info')]}>
      {agents.map(agent => <Table.Row key={agent.agent}>
        <Table.Cell>{agent.agent}</Table.Cell>
        <Table.Cell>{agent.ok ? [agent.agent_info?.name || t('diagnostics.acp.agent'), agent.agent_info?.version].filter(Boolean).join(' ') : unavailableRow(agent, t)}</Table.Cell>
      </Table.Row>)}
    </Records> : <p className="ar-note">{t('diagnostics.acp.none')}</p>}
  </>;
}

function ErrorLine({text}) {
  return <Alert status="danger" role="alert">
    <Alert.Indicator/>
    <Alert.Content><Alert.Description>{text}</Alert.Description></Alert.Content>
  </Alert>;
}

/** A button with its longer explanation in a tooltip; the button keeps its own name. */
function Hinted({hint, children}) {
  return <Tooltip>
    {children}
    {/* HeroUI breaks tooltip text anywhere (break-all); a sentence wraps between words. */}
    <Tooltip.Content><p>{hint}</p></Tooltip.Content>
  </Tooltip>;
}

function SectionHead({id, title, note, children}) {
  return <div className="ar-stack ar-stack--tight">
    <h2 id={id}>{title}</h2>
    {note && <p className="ar-note">{note}</p>}
    {children}
  </div>;
}

export default function DiagnosticsWorkspace({token, setToken, active = true, readiness = null, readinessError = null, refreshReadiness, onNavigate}) {
  const i18n = useI18n();
  const {t, n} = i18n;
  const entry = useFirstEntry('diagnostics');
  const [health, setHealth] = useState(null);
  const [mcp, setMcp] = useState(null), [acp, setAcp] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null), [reportText, setReportText] = useState(''), [reportOpen, setReportOpen] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(null), [notice, setNotice] = useState(null);
  const credential = useRef(null);

  useLayoutEffect(() => {
    const controller = new AbortController();
    credential.current = controller;
    setMcp(null); setAcp(null); setDiagnostics(null); setReportText(''); setReportOpen(false); setError(null); setNotice(null); setBusy('');
    return () => controller.abort();
  }, [token]);

  // A rejected token or desktop session is announced by the unlock card, not by a second alert.
  const run = useCallback(async (kind, action) => {
    const signal = credential.current.signal;
    setBusy(kind); setError(null); setNotice(null);
    try { await action(signal); }
    catch (err) { if (!signal.aborted && !isAuthError(err)) setError({kind, message: messageOf(err)}); }
    finally { if (!signal.aborted) setBusy(''); }
  }, []);

  const loadHealth = useCallback(signal => run('health', async activeSignal => {
    setHealth(null);
    try {
      const response = await checkedFetch('/health', {signal: signal || activeSignal});
      setHealth(await response.json());
    }
    catch (error) {
      setHealth({available: false, status: 'unavailable'});
      throw error;
    }
  }), [run]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    loadHealth(controller.signal);
    return () => controller.abort();
  }, [active, loadHealth]);

  async function loadProtected(path, signal, setter) {
    if (!token) return setter({locked: true});
    try {
      const response = await apiFetch(path, {token, method: 'POST', signal});
      signal.throwIfAborted();
      setter(await response.json());
    }
    catch (error) {
      if (!signal.aborted) setter(protectedFailure(error));
      throw error;
    }
  }

  // A rejected session on any diagnostics call is recorded once, so the unlock card names it.
  async function diagnosticsCall(signal, action) {
    try { await action(); }
    catch (error) { if (!signal.aborted && isAuthError(error)) setDiagnostics({locked: true}); throw error; }
  }
  const readDiagnostics = signal => diagnosticsCall(signal, async () => {
    const response = await apiFetch('/api/diagnostics', {token, signal});
    signal.throwIfAborted();
    setDiagnostics(await response.json());
  });
  // The service redacts the report; the page copies its text verbatim and shows it when the clipboard cannot take it.
  const copyReport = signal => diagnosticsCall(signal, async () => {
    const response = await apiFetch('/api/diagnostics/report', {token, signal});
    const text = await response.text();
    signal.throwIfAborted();
    setReportText(text);
    try { await navigator.clipboard.writeText(text); setNotice({kind: 'report', key: 'diagnostics.report.copied'}); }
    catch { setReportOpen(true); setNotice({kind: 'report', key: 'diagnostics.report.manual'}); }
  });
  const retryRender = (id, signal) => diagnosticsCall(signal, async () => {
    const response = await apiFetch('/api/molecular/renders/' + id + '/retry', {token, method: 'POST', signal});
    const row = await response.json();
    signal.throwIfAborted();
    setNotice({kind: 'retry', key: 'diagnostics.retry.done', vars: {id: short(row.id)}});
    await readDiagnostics(signal);
  });

  const native = token === NATIVE_SESSION;
  const who = native ? 'native' : 'token';
  const rejected = !!token && (isAuthError(readinessError) || [mcp, acp, diagnostics].some(report => report?.locked));
  const hostSession = hostSessionOf(health, native, t);
  const lock = sessionState(token, rejected, {draft: false});
  const readingFailed = !!readinessError && !isAuthError(readinessError);
  const needsSession = t('diagnostics.needs_session');
  // A desktop session reads readiness on its own; a manual token reads it when asked.
  const placeholder = !token ? needsSession : busy === 'readiness' || (native && !readinessError) ? t('diagnostics.busy.readiness')
    : rejected ? t('diagnostics.readiness.rejected') : readingFailed ? t('diagnostics.readiness.failed') : t('diagnostics.readiness.unread');
  // A malformed answer is data, not a crash: missing nodes read as unknown.
  const session = readiness?.session || (readiness ? {state: 'unknown', meaning: t('diagnostics.session.undescribed')}
    : !token ? {state: 'blocked', meaning: t('diagnostics.session.none'), next_action: t('diagnostics.session.none_next')}
    : rejected ? {state: 'failed', meaning: t('diagnostics.session.rejected_' + who)}
    : readingFailed ? {state: 'unknown', meaning: t('diagnostics.session.unreadable_' + who), next_action: t('diagnostics.session.unreadable_next')}
    : {state: 'not_tested', meaning: t('diagnostics.session.unverified_' + who), next_action: native ? null : t('diagnostics.session.unverified_next')});
  const engine = readiness?.memory?.facts;
  const connectors = readiness ? [...(readiness.connectors?.mcp || []).map(row => ({kind: 'MCP', ...row})), ...(readiness.connectors?.acp || []).map(row => ({kind: 'ACP', ...row}))] : [];
  // The card's own state comes from the server summary; rows keep theirs beside them.
  const connectorNode = readiness && {state: stateOf(readiness.connectors), meaning: readiness.connectors?.meaning, next_action: readiness.connectors?.next_action};
  const sections = diagnostics?.locked || diagnostics?.available === false ? null : diagnostics;
  const diagnosticsPlaceholder = !token ? needsSession : busy === 'diagnostics' ? t('diagnostics.busy.diagnostics') : rejected ? t('diagnostics.readiness.rejected') : t('diagnostics.reads.unread');
  const serviceState = health ? (health.available === false ? 'failed' : health.status === 'ready' ? 'ready' : 'unknown') : 'not_tested';
  const value = v => v ?? t('diagnostics.unavailable');
  const count = v => typeof v === 'number' ? n(v) : value(v);
  // Host-only: the desktop shell opens its own redacted log; no fetch, no token, not a busy task.
  const openStartupLog = () => {
    window.ipc.postMessage(JSON.stringify({kind: 'open-startup-log'}));
    setNotice({kind: 'startup-log', key: 'diagnostics.startup.asked'});
  };

  const readinessText = readingFailed ? friendlyError(messageOf(readinessError), 'readiness', t) : null;
  const errorText = error ? friendlyError(error.message, error.kind, t) : null;
  const feedback = (...kinds) => <>
    {kinds.includes(busy) && <p role="status" className="ar-note">{t('diagnostics.busy.' + busy)}</p>}
    {notice && kinds.includes(notice.kind) && busy !== notice.kind && <p role="status">{t(notice.key, notice.vars)}</p>}
    {error && kinds.includes(error.kind) && <ErrorLine text={errorText}/>}
    {kinds.includes('readiness') && readingFailed && busy !== 'readiness' && readinessText !== errorText && <ErrorLine text={readinessText}/>}
  </>;
  const noSession = !token && <p className="ar-note">{needsSession}</p>;

  const storage = sections?.storage, renderer = sections?.renderer, pkg = sections?.package;
  const missions = storage?.missions;
  const verified = missions && t('diagnostics.integrity.verified_value', {verified: missions.verified, checked: missions.checked});
  const summary = [
    ['service', serviceState], ['session', stateOf(session)], ['settings', readiness ? stateOf(readiness.settings) : 'unknown'],
    ['seats', readiness ? stateOf(readiness.live_mission) : 'unknown'], ['connectors', connectorNode ? stateOf(connectorNode) : 'unknown'],
    ['renderer', readiness ? stateOf(readiness.renderer) : 'unknown'], ['memory', readiness ? stateOf(readiness.memory) : 'unknown'],
    ['storage', readiness ? stateOf(readiness.storage) : 'unknown'],
  ].map(([card, state]) => [t('diagnostics.card.' + card), <StateMark state={state}/>]);

  return <section className="ar-stack" aria-label={t('diagnostics.region')} data-enter={entry}>
    <PageHead kicker={t('diagnostics.kicker')} title={t('diagnostics.title')} lead={t('diagnostics.lead')}/>
    <LockNotice card={lock} tone={rejected ? 'error' : 'info'} onUnlock={() => focusTokenField(token, setToken)} unlockLabel={unlockLabel(token, t)}/>

    <Block className="ar-stack" aria-labelledby="diagnostics-status">
      <h2 id="diagnostics-status">{t('diagnostics.status.title')}</h2>
      <Facts items={summary}/>
      <div className="ar-row">
        <Button variant="secondary" isDisabled={!!busy} onPress={() => loadHealth()}>{t('diagnostics.action.refresh_service')}</Button>
        <Hinted hint={t('diagnostics.action.refresh_readiness_hint')}>
          <Button variant="primary" isDisabled={!!busy || !token} onPress={() => run('readiness', () => refreshReadiness?.())}>{t('diagnostics.action.refresh_readiness')}</Button>
        </Hinted>
        <Hinted hint={t('diagnostics.action.relogin_hint')}>
          <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => run('readiness', () => refreshReadiness?.({fresh: true}))}>{t('diagnostics.action.relogin')}</Button>
        </Hinted>
      </div>
      {noSession}
      {feedback('health', 'readiness')}
    </Block>

    <section className="ar-stack" aria-labelledby="diagnostics-service">
      <SectionHead id="diagnostics-service" title={t('diagnostics.service.heading')}/>
      <div className="ar-pair">
        <Card title={t('diagnostics.card.service')} state={serviceState} attrs={{'data-host-session': hostSession.key}}>
          {health?.available === false ? <>
            {/* This status is the page's own word for a failed read, not the service's. */}
            <Facts items={[[t('diagnostics.service.status'), t('diagnostics.service.status_unavailable')]]}/>
            <p>{t('diagnostics.service.failed')}</p>
          </> : health ? <>
            <Facts items={[
              [t('diagnostics.service.status'), value(health.status === 'ready' ? stateLabel('ready', i18n).toLowerCase() : words(health.status))],
              [t('diagnostics.service.deployment'), value(health.deployment)],
              [t('diagnostics.service.host_session'), hostSession.value],
            ]}/>
            <p className="ar-note">{t('diagnostics.source', {text: hostSession.note})}</p>
            <Disclosure>
              <Disclosure.Heading level={4}>
                <Button slot="trigger" variant="ghost" size="sm">{t('diagnostics.service.more')}<Disclosure.Indicator/></Button>
              </Disclosure.Heading>
              <Disclosure.Content>
                <Disclosure.Body className="ar-stack ar-stack--tight">
                  <Facts items={[
                    [t('diagnostics.service.version'), value(health.version)],
                    [t('diagnostics.service.engine'), engine?.protocol ? t('diagnostics.service.engine_value', {protocol: engine.protocol, sqlite: engine.sqlite}) : readiness ? t('diagnostics.unavailable') : t('diagnostics.service.not_loaded')],
                  ]}/>
                  <p className="ar-note">{t('diagnostics.service.limits')}</p>
                </Disclosure.Body>
              </Disclosure.Content>
            </Disclosure>
          </> : <p className="ar-note">{t('diagnostics.service.unread')}</p>}
          <p className="ar-note">{t('diagnostics.service.public_note')}</p>
        </Card>
        <Card title={t('diagnostics.card.session')} state={stateOf(session)}>
          {session.label && <p><strong>{session.label}</strong></p>}
          <Meaning node={session}/>
        </Card>
      </div>
    </section>

    <section className="ar-stack" aria-labelledby="diagnostics-readiness">
      <SectionHead id="diagnostics-readiness" title={t('diagnostics.readiness.heading')} note={t('diagnostics.readiness.note')}>
        {readiness?.checked_at > 0 && <Meta>{t('diagnostics.readiness.read_at', {at: at(readiness.checked_at, i18n)})}</Meta>}
      </SectionHead>
      <ReadinessCard title={t('diagnostics.card.seats')} node={readiness?.live_mission} placeholder={placeholder}>
        {readiness && <>
          <Records label={t('diagnostics.seats.table')} columns={[t('diagnostics.seats.col.seat'), t('diagnostics.seats.col.readiness'), t('diagnostics.seats.col.probe')]}>
            {(readiness.roles || []).map(role => {
              const node = readiness.seats?.[role.role];
              const login = loginLine(node, i18n);
              return <Table.Row key={role.role} data-state={stateOf(node)}>
                <Table.Cell>{role.label}</Table.Cell>
                <Table.Cell><NodeCell node={node}/></Table.Cell>
                <Table.Cell><div className="ar-stack ar-stack--tight"><span>{probeLine(node, i18n)}</span>{login && <span className="ar-note">{login}</span>}</div></Table.Cell>
              </Table.Row>;
            })}
          </Records>
          {onNavigate && <div><Button variant="secondary" size="sm" onPress={() => onNavigate('settings')}>{t('diagnostics.seats.open_settings')}</Button></div>}
        </>}
      </ReadinessCard>
      <ReadinessCard title={t('diagnostics.card.connectors')} node={connectorNode} placeholder={placeholder}>
        {readiness && <>
          {connectors.length > 0 && <Records label={t('diagnostics.connectors.table')} columns={[t('diagnostics.connectors.col.name'), t('diagnostics.connectors.col.kind'), t('diagnostics.connectors.col.readiness')]}>
            {connectors.map(row => <Table.Row key={row.kind + ' ' + row.name} data-state={stateOf(row)}>
              <Table.Cell>{row.name}</Table.Cell>
              <Table.Cell>{row.kind}</Table.Cell>
              <Table.Cell><NodeCell node={row}/></Table.Cell>
            </Table.Row>)}
          </Records>}
          <Facts items={[[t('diagnostics.connectors.mcp_sdk'), value(readiness.connectors?.mcp_sdk)], [t('diagnostics.connectors.acp_protocol'), value(readiness.connectors?.acp_protocol)]]}/>
        </>}
      </ReadinessCard>
      <div className="ar-pair">
        <ReadinessCard title={t('diagnostics.card.settings')} node={readiness?.settings} placeholder={placeholder}>
          {readiness && <Facts items={[
            [t('diagnostics.settings.revision'), value(readiness.settings?.revision?.slice(0, 12))],
            [t('diagnostics.settings.path'), value(readiness.settings?.path?.replace(/^\\\\\?\\/, ''))],
            [t('diagnostics.settings.read_only'), value(flag(readiness.settings?.read_only, t))],
          ]}/>}
        </ReadinessCard>
        <ReadinessCard title={t('diagnostics.card.renderer')} node={readiness?.renderer} placeholder={placeholder}>
          {readiness && <Facts items={[
            [t('diagnostics.renderer.configured'), value(flag(readiness.renderer?.facts?.configured, t))],
            [t('diagnostics.renderer.exists'), value(flag(readiness.renderer?.facts?.exists, t))],
            [t('diagnostics.renderer.preset'), value(readiness.renderer?.facts?.default_preset)],
          ]}/>}
        </ReadinessCard>
        <ReadinessCard title={t('diagnostics.card.memory')} node={readiness?.memory} placeholder={placeholder}>
          {engine && Object.keys(engine).length > 0 && <Facts items={Object.entries(engine).filter(([, v]) => typeof v !== 'object').map(([key, v]) => [words(key), flag(v, t)])}/>}
        </ReadinessCard>
        <ReadinessCard title={t('diagnostics.card.storage')} node={readiness?.storage} placeholder={placeholder}>
          {readiness && <Facts items={[
            [t('diagnostics.storage.missions_db'), value(flag(readiness.storage?.facts?.missions_db, t))],
            [t('diagnostics.storage.missions'), count(readiness.storage?.facts?.missions)],
          ]}/>}
        </ReadinessCard>
      </div>
    </section>

    <section className="ar-stack" aria-labelledby="diagnostics-reads">
      <SectionHead id="diagnostics-reads" title={t('diagnostics.reads.heading')} note={t('diagnostics.reads.note')}/>
      <div className="ar-row">
        <Hinted hint={t('diagnostics.action.read_hint')}>
          <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => run('diagnostics', readDiagnostics)}>{t('diagnostics.action.read')}</Button>
        </Hinted>
        <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => run('report', copyReport)}>{t('diagnostics.action.copy_report')}</Button>
      </div>
      {noSession}
      {feedback('diagnostics', 'report', 'retry')}
      {reportText !== '' && <Disclosure isExpanded={reportOpen} onExpandedChange={setReportOpen}>
        <Disclosure.Heading level={3}>
          <Button slot="trigger" variant="ghost" size="sm">{t('diagnostics.report.title')}<Disclosure.Indicator/></Button>
        </Disclosure.Heading>
        <Disclosure.Content>
          <Disclosure.Body><pre className="ar-code">{reportText}</pre></Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>}
      <SectionCard name="jobs" title={t('diagnostics.card.jobs')} section={sections?.jobs} placeholder={diagnosticsPlaceholder}>
        {sections?.jobs?.failed?.length > 0 ? <Records label={t('diagnostics.jobs.table')} columns={[t('diagnostics.jobs.col.file'), t('diagnostics.jobs.col.status'), t('diagnostics.jobs.col.error'), t('diagnostics.jobs.col.action')]}>
          {sections.jobs.failed.map(job => <Table.Row key={job.id}>
            <Table.Cell><div className="ar-stack ar-stack--tight"><span>{job.filename}</span><Meta>{short(job.id)}</Meta></div></Table.Cell>
            <Table.Cell>{words(job.status)}</Table.Cell>
            <Table.Cell>{job.error}</Table.Cell>
            <Table.Cell><div className="ar-stack ar-stack--tight">
              <span><Button size="sm" variant="secondary" isDisabled={!!busy || !job.retryable} data-job-id={job.id} onPress={() => run('retry', signal => retryRender(job.id, signal))}>{t('diagnostics.jobs.retry')}</Button></span>
              {!job.retryable && job.retry_note && <span className="ar-note">{job.retry_note}</span>}
            </div></Table.Cell>
          </Table.Row>)}
        </Records> : <p className="ar-note">{t('diagnostics.jobs.none')}</p>}
      </SectionCard>
      <div className="ar-pair">
        <SectionCard name="storage" title={t('diagnostics.card.storage_integrity')} section={storage} placeholder={diagnosticsPlaceholder}>
          <Facts items={[
            [t('diagnostics.integrity.verified'), value(missions && (missions.checked < missions.total ? t('diagnostics.integrity.newest', {value: verified, limit: missions.limit, total: missions.total}) : verified))],
            [t('diagnostics.integrity.sqlite'), value(storage?.sqlite && Object.entries(storage.sqlite).map(([name, result]) => name + ' ' + result).join(', '))],
            [t('diagnostics.integrity.capture'), value(storage?.memory_capture && [storage.memory_capture.status, t('diagnostics.integrity.pending', {count: storage.memory_capture.pending}), storage.memory_capture.last_error].filter(Boolean).join(', '))],
            missions?.broken?.length > 0 && [t('diagnostics.integrity.broken'), missions.broken.join(', ')],
          ]}/>
        </SectionCard>
        <SectionCard name="renderer" title={t('diagnostics.card.renderer_facts')} section={renderer} placeholder={diagnosticsPlaceholder}>
          <Facts items={[
            ...[['diagnostics.tools.blender', renderer?.blender_python], ['diagnostics.tools.svg', renderer?.svg_rasterizer]].map(([label, tool]) => [t(label), value(tool && t('diagnostics.tools.value', {configured: flag(!!tool.configured, t), found: found(tool.exists, t), executable: tool.executable || t('common.none')}))]),
            [t('diagnostics.probe.runtime'), value(renderer?.runtime_probe && (renderer.runtime_probe.checked
              ? t(renderer.runtime_probe.ok ? 'diagnostics.probe.passed' : 'diagnostics.probe.failed', {reason: renderer.runtime_probe.reason || t('diagnostics.no_detail')})
              : t('diagnostics.probe.not_run')))],
            [t('diagnostics.last_render'), value(renderer && (renderer.last_render
              ? t('diagnostics.last_render.value', {status: words(renderer.last_render.status), id: short(renderer.last_render.id), at: at(renderer.last_render.updated_at, i18n)})
              : t('common.none')))],
          ]}/>
        </SectionCard>
        <SectionCard name="package" title={t('diagnostics.card.package')} section={pkg} placeholder={diagnosticsPlaceholder}>
          <Facts items={[
            [t('diagnostics.package.version'), value(pkg?.version)],
            [t('diagnostics.package.python'), value(pkg?.python?.version)],
            [t('diagnostics.package.python_path'), value(pkg?.python?.executable)],
            [t('diagnostics.package.supervisor'), value(pkg?.supervisor && (pkg.supervisor.path
              ? (pkg.supervisor.configured ? pkg.supervisor.path : t('diagnostics.package.supervisor_missing', {path: pkg.supervisor.path}))
              : t('diagnostics.package.supervisor_unset')))],
            [t('diagnostics.package.revision'), value(pkg?.settings?.revision?.slice(0, 12))],
            [t('diagnostics.package.data_dir'), value(pkg?.data_dir)],
            [t('diagnostics.package.started'), value(pkg && at(pkg.started_at, i18n))],
          ]}/>
        </SectionCard>
        <SectionCard name="probes" title={t('diagnostics.card.probes')} section={sections?.probes} placeholder={diagnosticsPlaceholder}>
          {sections?.probes?.records?.length > 0 ? <Records label={t('diagnostics.probes.table')} columns={[t('diagnostics.probes.col.name'), t('diagnostics.probes.col.provider'), t('diagnostics.probes.col.result'), t('diagnostics.probes.col.at')]}>
            {sections.probes.records.map(record => <Table.Row key={record.name + record.at}>
              <Table.Cell>{record.name}</Table.Cell>
              <Table.Cell>{record.provider}</Table.Cell>
              <Table.Cell>{t('diagnostics.probes.result', {ok: record.ok, results: record.results})}</Table.Cell>
              <Table.Cell>{at(record.at, i18n)}</Table.Cell>
            </Table.Row>)}
          </Records> : <p className="ar-note">{t('diagnostics.probes.none')}</p>}
        </SectionCard>
      </div>
      {hostIpc() ? <div className="ar-stack ar-stack--tight">
        <div><Button variant="secondary" onPress={openStartupLog}>{t('diagnostics.startup.open')}</Button></div>
        <p className="ar-note">{t('diagnostics.startup.note')}</p>
        {feedback('startup-log')}
      </div> : <p className="ar-note">{t('diagnostics.startup.outside')}</p>}
    </section>

    <section className="ar-stack" aria-labelledby="diagnostics-checks">
      <SectionHead id="diagnostics-checks" title={t('diagnostics.checks.heading')} note={t('diagnostics.checks.note')}/>
      <div className="ar-row">
        <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => run('mcp', signal => loadProtected('/api/mcp/servers/check', signal, setMcp))}>{t('diagnostics.action.check_mcp')}</Button>
        <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => run('acp', signal => loadProtected('/api/acp/agents/check', signal, setAcp))}>{t('diagnostics.action.check_acp')}</Button>
      </div>
      {noSession}
      {feedback('mcp', 'acp')}
      <div className="ar-pair">
        <Card title={t('diagnostics.card.mcp')} state={stateFor(mcp)}><McpReport report={mcp}/></Card>
        <Card title={t('diagnostics.card.acp')} state={stateFor(acp)}><AcpReport report={acp}/></Card>
      </div>
    </section>
  </section>;
}
