import React, {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {Description} from '@heroui/react/description';
import {Disclosure} from '@heroui/react/disclosure';
import {EmptyState} from '@heroui/react/empty-state';
import {Form} from '@heroui/react/form';
import {Label} from '@heroui/react/label';
import {ListBox} from '@heroui/react/list-box';
import {NumberField} from '@heroui/react/number-field';
import {Radio} from '@heroui/react/radio';
import {RadioGroup} from '@heroui/react/radio-group';
import {TextArea} from '@heroui/react/textarea';
import {TextField} from '@heroui/react/textfield';
import {apiFetch, sessionLine, sessionState} from './http';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';
import {useI18n} from './i18n/index.jsx';
import {GravityIcon} from './theme/gravity-icons.jsx';
import {Block, Kicker, Meta, PageHead, useFirstEntry} from './ui.jsx';

// One stable app-level project groups every mission-session (mirrors capture.PROJECT).
const PROJECT = 'arc-science';
const DEFAULT_RANGE = {from: 0, to: 199};
const MODES = ['lexical', 'semantic', 'hybrid'];
const CAPTURE_TONE = {ready: 'success', degraded: 'warning'};
const TIME = {dateStyle: 'medium', timeStyle: 'short'};
const words = value => String(value ?? '').replace(/_/g, ' ');
// Sequence numbers, epochs and positions are identifiers: no digit grouping.
const plain = value => String(value);

function isAuthError(error) { return /Request failed \((401|403)\)/.test(error?.message || String(error)); }

/** The dictionary word for a service enum value (role, trust, mode), or the value itself. */
function enumWord(t, prefix, value) {
  const key = prefix + value;
  const text = t(key);
  return text === key ? words(value) : text;
}

function When({ms}) {
  const {d} = useI18n();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return <time className="bp-meta" dateTime={new Date(ms).toISOString()}>{d(ms, TIME)}</time>;
}

function ClampedText({text, limit, subject}) {
  const {t} = useI18n();
  const [open, setOpen] = useState(false);
  const long = text.length > limit;
  const label = t(open ? 'memory.text.less' : 'memory.text.more');
  return <div className="ar-stack ar-stack--tight">
    <p className="whitespace-pre-wrap">{open || !long ? text : text.slice(0, limit) + '…'}</p>
    {long && <div><Button variant="ghost" size="sm" aria-label={t('memory.text.toggle', {label, subject})} onPress={() => setOpen(o => !o)}>{label}</Button></div>}
  </div>;
}

function RecordCard({record, busy, locked, error, onDisable}) {
  const {t} = useI18n();
  const seq = plain(record.seq);
  return <article className="bp-panel ar-stack ar-stack--tight">
    <div className="ar-row">
      <h3>{t('memory.record.title', {role: enumWord(t, 'memory.role.', record.role), seq})}</h3>
      <Meta>{t('memory.record.epoch', {epoch: plain(record.compaction_epoch)})}</Meta>
      <When ms={record.wall_time_ms}/>
    </div>
    <ClampedText text={record.text || ''} limit={280} subject={t('memory.record.subject', {seq})}/>
    <Meta>{t('memory.record.provenance', {
      trust: enumWord(t, 'memory.trust.', record.trust),
      source: record.source_uri || t('common.none'),
      digest: record.content_digest.slice(0, 12),
    })}</Meta>
    <div className="ar-row">
      <Button variant="secondary" size="sm" isDisabled={busy || locked} aria-label={t('memory.record.remove_named', {seq})} onPress={() => onDisable(record.record_id)}>{t('memory.record.remove')}</Button>
    </div>
    {error && <p role="alert" className="ar-tag" data-tone="danger">{error}</p>}
  </article>;
}

function HitCard({hit, index}) {
  const {t, n} = useI18n();
  const {record} = hit;
  return <article className="bp-panel ar-stack ar-stack--tight">
    <div className="ar-row">
      <h3>{enumWord(t, 'memory.role.', record.role)}</h3>
      <Meta>{record.session_id}</Meta>
      <When ms={record.wall_time_ms}/>
    </div>
    <ClampedText text={record.text || ''} limit={400} subject={t('memory.hit.subject', {index: plain(index + 1)})}/>
    <Meta>{t('memory.hit.meta', {
      reason: enumWord(t, 'memory.mode.word.', hit.reason),
      score: n(hit.score, {minimumFractionDigits: 3, maximumFractionDigits: 3}),
      epoch: plain(record.compaction_epoch),
      trust: enumWord(t, 'memory.trust.', record.trust),
    })}</Meta>
  </article>;
}

/** A 0-or-more integer field for one end of the record range (the draft may be empty or invalid). */
function RangeField({label, value, isDisabled, onChange}) {
  return <NumberField
    value={value === '' ? NaN : Number(value)} onChange={next => onChange(Number.isNaN(next) ? '' : next)}
    minValue={0} maxValue={Number.MAX_SAFE_INTEGER} step={1} isRequired isDisabled={isDisabled}
    formatOptions={{useGrouping: false, maximumFractionDigits: 0}}>
    <Label>{label}</Label>
    <NumberField.Group><NumberField.Input/></NumberField.Group>
  </NumberField>;
}

export default function MemoryWorkspace({token, setToken}) {
  const {t} = useI18n();
  const enter = useFirstEntry('memory');
  const [sessions, setSessions] = useState(null), [session, setSession] = useState(null), [records, setRecords] = useState(null);
  const [query, setQuery] = useState(''), [mode, setMode] = useState('lexical'), [hits, setHits] = useState(null), [scope, setScope] = useState('all');
  // error = {at, text}: `at` is the control the alert sits beside ('load', 'search', 'sessions', 'paging', 'range' or a record_id).
  const [health, setHealth] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);
  const [notice, setNotice] = useState('');
  const [range, setRange] = useState(DEFAULT_RANGE), [rangeDraft, setRangeDraft] = useState(DEFAULT_RANGE);
  const credential = useRef(null);
  // Reset before paint, without remounting the focused token input. Every operation
  // owns this credential's signal, including the response-body decoding step.
  useLayoutEffect(() => {
    const controller = new AbortController(); credential.current = controller;
    setSessions(null); setSession(null); setRecords(null);
    setHits(null); setHealth(null); setError(null); setNotice(''); setBusy(false); setAuthExpired(false);
    setRange(DEFAULT_RANGE); setRangeDraft(DEFAULT_RANGE);
    return () => controller.abort();
  }, [token]);
  const request = useCallback(async (path, signal, method = 'GET', body) => {
    signal.throwIfAborted();
    const response = await apiFetch('/api/memory' + path, {
      token, method, signal, headers: {'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined,
    });
    signal.throwIfAborted();
    return response;
  }, [token]);
  async function read(path, signal, method, body) {
    const data = await (await request(path, signal, method, body)).json();
    signal.throwIfAborted();
    return data;
  }
  // A rejected token shows only the lock notice; every other failure gets an alert
  // beside the control that failed.
  function friendlyError(e) {
    const message = e?.message || String(e);
    if (/Failed to fetch|NetworkError|Load failed/.test(message)) return sessionLine('offline', t);
    return message;
  }
  async function task(action, at) {
    const signal = credential.current.signal;
    setBusy(true); setError(null); setNotice('');
    try {
      const card = sessionState(token, authExpired);
      if (card) throw new Error(sessionLine(card.id, t));
      await action(signal);
    }
    catch (e) { if (!signal.aborted) { if (isAuthError(e)) setAuthExpired(true); else setError({at: e.at || at, text: friendlyError(e)}); } }
    finally { if (!signal.aborted) setBusy(false); }
  }
  async function loadSessions(signal) {
    setHealth(null);
    setHealth(await read('/health', signal));
    setSessions(await read('/sessions?project=' + PROJECT, signal));
  }
  async function openSession(id, signal, requestedRange = DEFAULT_RANGE) {
    const from = Number(requestedRange.from), to = Number(requestedRange.to);
    if (!String(requestedRange.from).trim() || !String(requestedRange.to).trim() ||
        !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to - from >= 1000) {
      throw new Error(t('memory.range.invalid'));
    }
    setSession(id); setHits(null); setRecords(null); setRange({from, to}); setRangeDraft({from, to});
    setRecords(await read('/sessions/' + encodeURIComponent(id) + '?project=' + PROJECT + '&from_seq=' + from + '&to_seq=' + to, signal));
  }
  async function runSearch(signal) {
    if (!availableModes.includes(mode)) throw new Error(t('memory.mode.unavailable'));
    const searchSession = scope === 'selected' ? session : null;
    const rows = await read('/search', signal, 'POST', {project: PROJECT, query, mode, limit: 20, session: searchSession});
    setHits({rows, mode, session: searchSession});
  }
  async function disable(recordId, signal) {
    await request('/records/' + encodeURIComponent(recordId) + '/disable', signal, 'POST');
    setRecords(rows => rows?.filter(row => row.record_id !== recordId) ?? null); setHits(null);
    setNotice(t('memory.removed'));
    // The card is gone once removed, so a failed refresh reports beside the session list instead.
    try { await loadSessions(signal); if (session) await openSession(session, signal, range); }
    catch (e) { e.at = 'sessions'; throw e; }
  }
  const availableModes = health?.retrieval_modes ?? ['lexical'];
  const selectedSession = sessions?.find(row => row.session_id === session);
  const totalRecords = selectedSession?.record_count ?? 0;
  const rangeWidth = range.to - range.from + 1;
  const canAdvance = range.to < Number.MAX_SAFE_INTEGER &&
    (Number.isSafeInteger(selectedSession?.last_seq) ? range.to < selectedSession.last_seq : Boolean(selectedSession));
  const card = sessionState(token, authExpired);
  const locked = Boolean(card);
  const alertAt = at => error?.at === at ? <p role="alert" className="ar-tag" data-tone="danger">{error.text}</p> : null;
  const modeNote = !health ? null
    : availableModes.includes('semantic') || availableModes.includes('hybrid') || !availableModes.includes('lexical')
      ? t('memory.mode.available', {modes: availableModes.map(id => enumWord(t, 'memory.mode.word.', id)).join(', ') || t('common.none')})
      : t('memory.mode.lexical_only');
  const capture = health?.capture;
  const openAt = (id, requested) => task(signal => openSession(id, signal, requested), requested ? 'paging' : 'sessions');

  return <div className="ar-stack" data-enter={enter}>
    <PageHead kicker={t('memory.kicker')} title={t('memory.title')} lead={t('memory.lead')}/>
    <div className="ar-split">
      <aside className="ar-stack" aria-label={t('memory.sessions.heading')}>
        <Block className="ar-stack">
          <div className="ar-row justify-between">
            <h2>{t('memory.sessions.heading')}</h2>
            <Button variant="secondary" size="sm" isDisabled={busy || locked} onPress={() => task(loadSessions, 'load')}>
              <GravityIcon name="arrow-rotate-left"/>{t('memory.sessions.load')}
            </Button>
          </div>
          <LockNotice card={card} tone={authExpired ? 'error' : 'info'} onUnlock={() => focusTokenField(token, setToken)} unlockLabel={unlockLabel(token, t)} compact/>
          {alertAt('load')}
          {capture && <div role="status" className="ar-stack ar-stack--tight">
            <p className="ar-tag" data-tone={CAPTURE_TONE[capture.status]}>{t('memory.capture.line', {status: enumWord(t, 'memory.capture.status.', capture.status), count: capture.pending})}</p>
            {capture.last_error && <p className="ar-note">{t('memory.capture.last_error', {error: capture.last_error})}</p>}
            {capture.status === 'degraded' && <p className="ar-note">{t('memory.capture.degraded')}</p>}
            {capture.status === 'unconfigured' && <p className="ar-note">{t('memory.capture.unconfigured')}</p>}
          </div>}
          {sessions === null ? <p className="ar-note">{t(locked ? 'memory.sessions.locked' : 'memory.sessions.prompt')}</p>
            : sessions.length ? <ListBox
              aria-label={t('memory.sessions.heading')} selectionMode="single"
              selectedKeys={session === null ? [] : [session]}
              disabledKeys={busy || locked ? sessions.map(s => s.session_id) : []}
              // A press on the open session reports an empty selection: it reloads that session.
              onSelectionChange={keys => { const id = [...keys][0] ?? session; if (id != null) openAt(String(id)); }}>
              {sessions.map(s => <ListBox.Item key={s.session_id} id={s.session_id} textValue={s.session_id}>
                <div className="flex min-w-0 flex-col">
                  <Label className="break-all">{s.session_id}</Label>
                  <Description>{t('memory.session.meta', {count: s.record_count, from: plain(s.min_epoch), to: plain(s.max_epoch)})}</Description>
                </div>
                <ListBox.ItemIndicator/>
              </ListBox.Item>)}
            </ListBox>
              : <p>{t('memory.sessions.none')}</p>}
          {alertAt('sessions')}
        </Block>
      </aside>

      <div className="ar-stack">
        <Block className="ar-stack">
          <TextField value={query} onChange={setQuery} isDisabled={busy}>
            <Label>{t('memory.search.field')}</Label>
            <TextArea rows={2} placeholder={t('memory.search.placeholder')}/>
          </TextField>
          <RadioGroup value={mode} onChange={setMode} isDisabled={busy} orientation="horizontal">
            <Label className="basis-full">{t('memory.mode.label')}</Label>
            {MODES.map(id => <Radio key={id} value={id} isDisabled={!availableModes.includes(id)}>
              <Radio.Content><Radio.Control><Radio.Indicator/></Radio.Control>{t('memory.mode.option.' + id)}</Radio.Content>
            </Radio>)}
          </RadioGroup>
          {modeNote && <p className="ar-note">{modeNote}</p>}
          <RadioGroup value={scope} onChange={setScope} isDisabled={busy} orientation="horizontal">
            <Label className="basis-full">{t('memory.scope.label')}</Label>
            <Radio value="all"><Radio.Content><Radio.Control><Radio.Indicator/></Radio.Control>{t('memory.scope.all')}</Radio.Content></Radio>
            <Radio value="selected" isDisabled={!session}>
              <Radio.Content><Radio.Control><Radio.Indicator/></Radio.Control>{t(session ? 'memory.scope.selected' : 'memory.scope.selected_none')}</Radio.Content>
            </Radio>
          </RadioGroup>
          <div className="ar-row">
            <Button isDisabled={busy || locked || !query.trim() || !availableModes.includes(mode) || (scope === 'selected' && !session)} onPress={() => task(runSearch, 'search')}>
              <GravityIcon name="magnifier"/>{t('memory.search.run')}
            </Button>
          </div>
          {alertAt('search')}
        </Block>

        <section className="ar-stack" aria-label={t('memory.results')}>
          {notice && <p role="status" className="ar-tag" data-tone="success">{notice}</p>}
          {hits !== null ? <>
            <div className="ar-row justify-between">
              <div className="ar-stack ar-stack--tight">
                <Kicker>{t('memory.hits.scope', {
                  kind: enumWord(t, 'memory.search_kind.', hits.mode),
                  scope: hits.session ? t('memory.hits.session', {session: hits.session}) : t('memory.hits.all'),
                })}</Kicker>
                <h2>{t('memory.hits.heading')}</h2>
              </div>
              <Meta>{t('memory.hits.count', {count: hits.rows.length})}</Meta>
            </div>
            {hits.rows.length ? <div className="ar-list">{hits.rows.map((hit, i) => <HitCard key={i} hit={hit} index={i}/>)}</div>
              : <EmptyState className="bp-panel">{t('memory.hits.none')}</EmptyState>}
          </> : session !== null ? <>
            <div className="ar-row justify-between">
              <div className="ar-stack ar-stack--tight">
                <Kicker>{t('memory.records.session', {session})}</Kicker>
                <h2>{t('memory.records.heading')}</h2>
              </div>
              <Meta>{records === null ? t('memory.records.not_loaded') : t('memory.records.loaded', {count: records.length})}</Meta>
            </div>
            <p className="ar-note">{sessions === null
              ? t('memory.range.line_unknown', {from: plain(range.from), to: plain(range.to)})
              : t('memory.range.line', {from: plain(range.from), to: plain(range.to), count: totalRecords})}</p>
            <div className="ar-row">
              <Button variant="secondary" isDisabled={busy || locked || range.from === 0} onPress={() => {
                const from = Math.max(0, range.from - rangeWidth);
                openAt(session, {from, to: from + rangeWidth - 1});
              }}>{t('memory.records.previous')}</Button>
              <Button variant="secondary" isDisabled={busy || locked || !canAdvance} onPress={() => openAt(session, {
                from: range.to + 1, to: Math.min(Number.MAX_SAFE_INTEGER, range.to + rangeWidth),
              })}>{t('memory.records.next')}</Button>
            </div>
            {alertAt('paging')}
            <Disclosure>
              <Disclosure.Heading>
                <Button slot="trigger" variant="ghost" size="sm">{t('memory.range.heading')}<Disclosure.Indicator/></Button>
              </Disclosure.Heading>
              <Disclosure.Content>
                <Disclosure.Body>
                  <Form className="ar-stack" onSubmit={event => { event.preventDefault(); task(signal => openSession(session, signal, rangeDraft), 'range'); }}>
                    <div className="ar-row">
                      <RangeField label={t('memory.range.from')} value={rangeDraft.from} isDisabled={busy} onChange={from => setRangeDraft(draft => ({...draft, from}))}/>
                      <RangeField label={t('memory.range.to')} value={rangeDraft.to} isDisabled={busy} onChange={to => setRangeDraft(draft => ({...draft, to}))}/>
                    </div>
                    <p className="ar-note">{t('memory.range.note')}</p>
                    <p className="ar-note">{t('memory.range.budget')}</p>
                    <div className="ar-row"><Button type="submit" variant="secondary" isDisabled={busy || locked}>{t('memory.range.load')}</Button></div>
                    {alertAt('range')}
                  </Form>
                </Disclosure.Body>
              </Disclosure.Content>
            </Disclosure>
            <p className="ar-note">{t('memory.records.removal_note')}</p>
            {records === null ? <p role="status" className="ar-note">{t(busy ? 'memory.records.loading' : 'memory.records.empty')}</p>
              : <div className="ar-list">{records.map(r => <RecordCard key={r.record_id} record={r} busy={busy} locked={locked}
                error={error?.at === r.record_id ? error.text : null} onDisable={id => task(signal => disable(id, signal), id)}/>)}</div>}
          </> : <EmptyState className="bp-panel ar-stack ar-stack--tight">
            <h2>{t('memory.empty.title')}</h2>
            <p>{t('memory.empty.text')}</p>
          </EmptyState>}
        </section>
      </div>
    </div>
  </div>;
}
