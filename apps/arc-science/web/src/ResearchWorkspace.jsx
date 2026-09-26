import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Accordion} from '@heroui/react/accordion';
import {Button} from '@heroui/react/button';
import {Checkbox} from '@heroui/react/checkbox';
import {Chip} from '@heroui/react/chip';
import {Description} from '@heroui/react/description';
import {EmptyState} from '@heroui/react/empty-state';
import {Input} from '@heroui/react/input';
import {Label} from '@heroui/react/label';
import {ListBox} from '@heroui/react/list-box';
import {NumberField} from '@heroui/react/number-field';
import {Select} from '@heroui/react/select';
import {TextArea} from '@heroui/react/textarea';
import {TextField} from '@heroui/react/textfield';
import {Tooltip} from '@heroui/react/tooltip';
import {NATIVE_SESSION, apiFetch, downloadResponse, sessionState} from './http';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';
import {useI18n} from './i18n/index.jsx';
import {stateLabel, stateOf} from './readiness';
import {GravityIcon} from './theme/gravity-icons.jsx';
import {Block, Facts, PageHead, useFirstEntry} from './ui.jsx';
import {Hint, MISSION_TONE, Problem, Tag, friendlyError, isAuthError, isConflict, isNotFound, term} from './research/common.jsx';
import {MissionTabs} from './research/Mission.jsx';
import {LiveRoute, RouteGrants, blockingSeats, seatAction} from './research/Route.jsx';
import './research/research.css';

const MAX_ROUNDS = 12;
const clampRounds = value => Math.min(MAX_ROUNDS, Math.max(1, Math.round(Number(value)) || 1));
// The note of a retry is part of the declared change the service records; it stays in English whatever the interface language.
const RETRY_NOTE = 'Retry after error: ';

// Reopen: the browser keeps only the selected mission's id (never the token); it is restored once per page load.
const STORED = 'arc.research.mission';
const readStored = () => { try { return localStorage.getItem(STORED) || null; } catch { return null; } };
const store = id => { try { if (id) localStorage.setItem(STORED, id); else localStorage.removeItem(STORED); } catch { /* no storage: nothing to restore next time */ } };

export default function ResearchWorkspace({token, setToken, readiness = null, readinessError = null, refreshReadiness, onNavigate}) {
  const i18n = useI18n(), {t, n} = i18n;
  // Callbacks and effects read the current words through this ref, so a language switch never re-runs a request.
  const tRef = useRef(t); tRef.current = t;
  const entry = useFirstEntry('research');
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState('demo'), [egress, setEgress] = useState(false), [vision, setVision] = useState(false), [rounds, setRounds] = useState(5), [points, setPoints] = useState('');
  const [mission, setMission] = useState(null), [missions, setMissions] = useState(null), [verification, setVerification] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  // A start, resume or retry the service accepted (202) keeps the mission polled until its persisted
  // status leaves paused or error (30 s at most): a live worker connects its connectors before its
  // first commit, so the row read right after the 202 can still say paused.
  const [scheduled, setScheduled] = useState(null);
  const accepted = id => setScheduled({id, until: Date.now() + 30000});
  // The route preview (GET /api/missions/preview) and the operator's approval of it; the ledger of the selected mission.
  const [preview, setPreview] = useState(null), [previewError, setPreviewError] = useState(''), [previewEpoch, setPreviewEpoch] = useState(0), [approved, setApproved] = useState(false), [routeConflict, setRouteConflict] = useState(false);
  const [grants, setGrants] = useState(null), [grantsError, setGrantsError] = useState('');
  // The operational timeline and the derived claim cards of the selected mission, each read beside it.
  const [timeline, setTimeline] = useState(null), [timelineError, setTimelineError] = useState('');
  const [claims, setClaims] = useState(null), [claimsError, setClaimsError] = useState('');
  const [retryReason, setRetryReason] = useState('');
  // Which action the alert or progress line belongs to: 'start', 'list' or 'results'.
  const [slot, setSlot] = useState('results');
  const [authExpired, setAuthExpired] = useState(false);
  const selected = useRef(null), generation = useRef(0), credential = useRef(null), lastToken = useRef(token), validatedToken = useRef(''), authExpiredRef = useRef(false), results = useRef(null);
  const pending = useRef(readStored());
  useEffect(() => { authExpiredRef.current = authExpired; }, [authExpired]);
  const clearSide = () => { setGrants(null); setGrantsError(''); setTimeline(null); setTimelineError(''); setClaims(null); setClaimsError(''); setRetryReason(''); };
  // Token edits invalidate loaded protected data immediately. Draft text survives
  // initial unlock and expired-token recovery; switching away from a proven,
  // still-valid credential clears the mission draft because it may belong to
  // another operator identity.
  useLayoutEffect(() => {
    const previous = lastToken.current;
    const provenSwitch = previous && token && previous !== token && validatedToken.current === previous && !authExpiredRef.current;
    const controller = new AbortController(); credential.current = controller;
    generation.current++; selected.current = null;
    setMission(null); setMissions(null); setVerification(null); setError(''); setBusy(false); setAuthExpired(false);
    setPreview(null); setPreviewError(''); setApproved(false); setRouteConflict(false); clearSide();
    if (token && previous !== token) { setEgress(false); setVision(false); }
    if (provenSwitch) { setGoal(''); setPoints(''); }
    lastToken.current = token;
    return () => controller.abort();
  }, [token]);
  const request = useCallback(async (path, method = 'GET', body, signal) => {
    signal.throwIfAborted();
    const response = await apiFetch('/api' + path, {token, method, signal, headers: {'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
    signal.throwIfAborted();
    if (token) validatedToken.current = token;
    return response;
  }, [token]);
  const read = useCallback(async (path, signal, method = 'GET', body) => {
    const data = await (await request(path, method, body, signal)).json();
    signal.throwIfAborted(); return data;
  }, [request]);
  async function task(action, where = 'results') {
    const signal = credential.current.signal;
    setSlot(where); setBusy(true); setError(''); setRouteConflict(false);
    try {
      // A missing or rejected token is stated once, by the LockNotice beside Create and start.
      if (sessionState(token, authExpired)) return;
      await action(signal);
    } catch (e) { if (!signal.aborted) { if (isAuthError(e)) setAuthExpired(true); else setError(friendlyError(e, token, t)); } } finally { if (!signal.aborted) setBusy(false); }
  }
  const notice = where => where !== slot ? null : error ? <Problem>{error}</Problem> : busy ? <p role="status" className="ar-note">{t('research.busy')}</p> : null;
  const refresh = useCallback(async (id, signal) => {
    const epoch = generation.current;
    const row = await read('/missions/' + id, signal);
    const current = () => epoch === generation.current && selected.current === id && !signal.aborted;
    // The ledger, the timeline and the claim cards are read beside the mission on every refresh (selection, each poll,
    // after an action), each guarded on its own: a failed or unshaped answer is stated in its section and never blocks the mission.
    // They land before the mission row does: a status change ends the poll and aborts its signal, so the final
    // poll's sections (the claim cards exist only once the mission has stopped) must already be in place.
    const beside = async (path, shaped, set, setSectionError, unshaped) => {
      try { const data = await read('/missions/' + id + path, signal); if (!current()) return; if (shaped(data)) { set(data); setSectionError(''); } else { set(null); setSectionError(unshaped ? tRef.current(unshaped) : ''); } }
      catch (e) { if (isAuthError(e) || signal.aborted) throw e; if (current()) setSectionError(friendlyError(e, token, tRef.current)); }
    };
    await beside('/grants', () => true, setGrants, setGrantsError, '');
    await beside('/timeline', data => Array.isArray(data?.rows), setTimeline, setTimelineError, 'research.timeline.unshaped');
    await beside('/claims', data => Array.isArray(data?.claims), setClaims, setClaimsError, 'research.claims.unshaped');
    if (current()) setMission(row);
    return row;
  }, [read, token]);
  async function select(id, signal) { generation.current++; selected.current = id; setMission(null); setVerification(null); clearSide(); store(id); await refresh(id, signal); }
  useEffect(() => {
    if (!mission) return;
    const awaited = scheduled?.id === mission.id && ['paused', 'error'].includes(mission.state.status) && Date.now() < scheduled.until;
    if (scheduled?.id === mission.id && !awaited) setScheduled(null);
    if (!['ready', 'running'].includes(mission.state.status) && !awaited) return;
    const controller = new AbortController(); let timer;
    const owner = credential.current;
    const abort = () => controller.abort(); owner.signal.addEventListener('abort', abort, {once: true});
    async function poll() { try { await refresh(mission.id, controller.signal); } catch (e) { if (!controller.signal.aborted && e.name !== 'AbortError') { setSlot('results'); if (isAuthError(e)) { setAuthExpired(true); controller.abort(); return; } setError(friendlyError(e, token, tRef.current)); } } if (!controller.signal.aborted) timer = setTimeout(poll, 1000); }
    timer = setTimeout(poll, 1000);
    return () => { controller.abort(); clearTimeout(timer); owner.signal.removeEventListener('abort', abort); };
  }, [mission?.id, mission?.state.status, refresh, token, scheduled]);
  function parsePoints() {
    if (!points.trim()) return null;
    try { return JSON.parse(points); } catch (e) { throw new Error(t('research.points.invalid', {error: e.message})); }
  }
  // A live mission's first start carries the approved route digest and the grants the preview asked for; an offline one sends no body.
  const startBody = () => mode === 'live' && approved && preview ? {approved_route_digest: preview.route_digest, grants: preview.required_grants} : undefined;
  async function startMission(id, body, signal) {
    try { await request('/missions/' + id + '/start', 'POST', body, signal); }
    catch (e) { if (isConflict(e)) setRouteConflict(true); throw e; }
    accepted(id);
    await refresh(id, signal);
  }
  async function start(signal) {
    const parsed = parsePoints();
    const body = startBody();
    const row = await read('/missions', signal, 'POST', {goal, mode, max_rounds: clampRounds(rounds), allow_egress: egress, vision_review: vision, points: parsed});
    generation.current++; selected.current = row.id; setMission(row); setVerification(null); clearSide(); store(row.id);
    // The composer stays as it is (your draft stays in this window); the result is brought into view.
    results.current?.scrollIntoView?.({block: 'start'});
    await startMission(row.id, body, signal);
  }
  function reviewRoute() { setRouteConflict(false); setError(''); setApproved(false); setPreviewEpoch(value => value + 1); }
  async function exportCapsule(signal) {
    const response = await request('/missions/' + mission.id + '/capsule', 'GET', undefined, signal);
    await downloadResponse({blob: async () => {
      const blob = await response.blob(); signal.throwIfAborted(); return blob;
    }}, 'arc-' + mission.id + '.zip');
  }
  const state = mission?.state;
  const locked = !token || authExpired;
  const card = sessionState(token, authExpired);
  // Reopen: once per page load, when the session is unlocked, the stored mission id is selected again; a token
  // switch afterwards clears the selection as always and does not restore. A mission that is gone drops the key.
  // An attempt cut short (the token still being typed, or rejected) is not the one attempt: the next unlock retries.
  // Never on a keystroke: like Settings, a manual token counts once it has settled (Tab, Enter or a click
  // elsewhere) or has already been accepted by a protected read; the desktop session needs no settling.
  const settledToken = useRef(token), [settleTick, setSettleTick] = useState(0);
  useEffect(() => {
    const settle = event => { if (event.target?.id === 'operator-token' && (event.type === 'focusout' || event.key === 'Enter')) { settledToken.current = event.target.value; setSettleTick(value => value + 1); } };
    document.addEventListener('focusout', settle); document.addEventListener('keydown', settle);
    return () => { document.removeEventListener('focusout', settle); document.removeEventListener('keydown', settle); };
  }, []);
  useEffect(() => {
    if (locked || !pending.current) return;
    if (token !== NATIVE_SESSION && validatedToken.current !== token && settledToken.current !== token) return;
    // Not a task: the restore is a read that must not disable the action buttons, or the click that
    // settled the token (Load missions, Create and start) would land on a disabled control and be lost.
    const id = pending.current, signal = credential.current.signal;
    (async () => {
      try { await select(id, signal); pending.current = null; }
      catch (e) {
        if (signal.aborted) return;
        if (isAuthError(e)) { setAuthExpired(true); return; }
        pending.current = null; setSlot('results');
        if (!isNotFound(e)) { setError(friendlyError(e, token, tRef.current)); return; }
        store(null); selected.current = null; setError(tRef.current('research.reopen.gone', {id}));
      }
    })();
  }, [locked, token, settleTick]);
  // Live mode reads the seats from GET /api/readiness; App.jsx shares one read, so repeats are free.
  // The read is tied to selecting Live, not to the token: a token typed afterwards resets the reading
  // (App.jsx), and until Check seats is pressed the seats count as not read, which blocks the start.
  const checkSeats = () => Promise.resolve(refreshReadiness?.()).catch(() => { /* readinessError carries the reason */ });
  useEffect(() => { if (mode === 'live' && !locked) checkSeats(); }, [mode, locked]);
  // The service refuses a live mission without consent at creation, and refuses one whose seats are blocked
  // or unread; each is stated beside Create and start instead of being sent.
  const consentMissing = mode === 'live' && !egress;
  const liveBlocked = mode === 'live' && (!readiness || stateOf(readiness?.live_mission) === 'blocked');
  // The route preview is read once the seats are read and not blocked, and again when the visual-review flag, the
  // readiness reading or a 409 review changes it; every fresh preview needs a fresh approval.
  useEffect(() => {
    if (mode !== 'live' || locked || liveBlocked) return;
    const controller = new AbortController();
    const owner = credential.current, abort = () => controller.abort(); owner.signal.addEventListener('abort', abort, {once: true});
    setPreview(null); setPreviewError(''); setApproved(false);
    // An answer without the digest and the grant requests cannot be approved or posted; it is shown as an error line, never rendered as a route.
    read('/missions/preview?vision_review=' + (vision ? 1 : 0), controller.signal).then(data => { if (controller.signal.aborted) return; if (typeof data?.route_digest === 'string' && Array.isArray(data.required_grants)) setPreview(data); else setPreviewError(tRef.current('research.route.unshaped')); })
      .catch(e => { if (controller.signal.aborted) return; if (isAuthError(e)) setAuthExpired(true); else setPreviewError(friendlyError(e, token, tRef.current)); });
    return () => { controller.abort(); owner.signal.removeEventListener('abort', abort); };
  }, [mode, locked, liveBlocked, vision, readiness, previewEpoch, read, token]);
  const approvalMissing = mode === 'live' && !liveBlocked && !(approved && preview);
  const modeNote = mode === 'demo' ? t('research.note.demo')
    : liveBlocked && !readiness ? t('research.note.unread')
      : liveBlocked ? t('research.note.blocked', {reason: blockingSeats(readiness).map(seatAction).join(' ') || readiness.live_mission.next_action || readiness.live_mission.meaning})
        : !egress ? t('research.note.consent') : approvalMissing ? t('research.note.approve') : t('research.note.ready');
  const summary = mode === 'demo' ? t('research.settings.summary_demo')
    : [t('research.settings.summary_live'), t(egress ? 'research.settings.summary_permitted' : 'research.settings.summary_refused'),
      readiness ? t('research.settings.summary_seats', {state: stateLabel(stateOf(readiness.live_mission), i18n)}) : null].filter(Boolean).join(', ');
  const status = state?.status;
  const resumeLabel = status === 'paused' ? 'research.actions.resume_paused' : status === 'ready' ? 'research.actions.start' : 'research.actions.resume';

  return (
    <div className="ar-stack research" data-enter={entry}>
      <PageHead kicker={t('research.kicker')} title={t('research.title')} lead={t('research.lead')} />

      <Block variant="primary" className="ar-stack" aria-label={t('research.composer.label')}>
        <TextField fullWidth value={goal} onChange={setGoal}>
          <div className="ar-row justify-between">
            <Label>{t('research.goal.label')}</Label>
            <Tooltip delay={300}>
              <Button variant="ghost" size="sm" onPress={() => setGoal(t('research.goal.example'))}>{t('research.goal.use_example')}</Button>
              <Tooltip.Content>{t('research.goal.example_note')}</Tooltip.Content>
            </Tooltip>
          </div>
          <TextArea rows={4} />
        </TextField>
        <div className="ar-stack ar-stack--tight">
          <Button variant="primary" className="self-start" isDisabled={busy || locked || !goal.trim() || consentMissing || liveBlocked || approvalMissing} onPress={() => task(start, 'start')}>
            <GravityIcon name="play" />{t('research.create')}
          </Button>
          {notice('start')}
          {routeConflict && slot === 'start' && error ? <Button className="self-start" variant="secondary" size="sm" onPress={reviewRoute}>{t('research.review_route')}</Button> : null}
          {card ? <LockNotice card={card} tone={authExpired ? 'error' : 'info'} onUnlock={() => focusTokenField(token, setToken)} unlockLabel={unlockLabel(token, t)} compact />
            : <p className="ar-note">{goal.trim() ? modeNote : t('research.goal.needed')}</p>}
        </div>
        <Accordion>
          <Accordion.Item id="settings">
            <Accordion.Heading>
              <Accordion.Trigger>
                <span className="ar-row"><span className="font-semibold">{t('research.settings.title')}</span><span className="ar-note">{summary}</span></span>
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="ar-stack">
                <div className="ar-row items-end">
                  <Select className="min-w-[300px]" value={mode} onChange={value => value && setMode(String(value))}>
                    <Label>{t('research.settings.mode')}</Label>
                    <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {['demo', 'live'].map(id => (
                          <ListBox.Item key={id} id={id} textValue={t('research.settings.mode_' + id)}>
                            <Label>{t('research.settings.mode_' + id)}</Label>
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                  <NumberField className="w-40" value={rounds} onChange={setRounds} minValue={1} maxValue={MAX_ROUNDS}>
                    <Label>{t('research.settings.rounds', {max: MAX_ROUNDS})}</Label>
                    <NumberField.Group><NumberField.Input /></NumberField.Group>
                  </NumberField>
                </div>
                {mode === 'live' ? <LiveRoute readiness={readiness} error={readinessError} locked={locked} onNavigate={onNavigate} onCheck={checkSeats} token={token} /> : null}
                {mode === 'live' ? <RouteGrants preview={preview} error={previewError} blocked={liveBlocked} locked={locked} approved={approved} onApprove={setApproved} onRetry={reviewRoute} /> : null}
                <Checkbox isSelected={egress} onChange={setEgress}>
                  <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{t('research.settings.egress')}</Checkbox.Content>
                  <Description>{t('research.settings.egress_note')}</Description>
                </Checkbox>
                <Checkbox isSelected={vision} onChange={setVision}>
                  <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{t('research.settings.vision')}</Checkbox.Content>
                </Checkbox>
                <TextField fullWidth value={points} onChange={setPoints}>
                  <div className="ar-row ar-row--tight">
                    <Label>{t('research.points.label')}</Label>
                    <Hint label={t('research.points.hint_label')}>{t('research.points.hint')}</Hint>
                  </div>
                  <TextArea rows={4} className="font-mono" />
                  <Description>{t('research.points.note')}</Description>
                </TextField>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Block>

      <div className="ar-split">
        <aside className="ar-stack research-saved" aria-label={t('research.saved.title')}>
          <div className="ar-row justify-between">
            <h2>{t('research.saved.title')}</h2>
            <Button variant="secondary" size="sm" isDisabled={busy || locked} onPress={() => task(async signal => setMissions(await read('/missions', signal)), 'list')}>{t('research.saved.load')}</Button>
          </div>
          {notice('list')}
          {missions === null ? <p className="ar-note">{t(locked ? 'research.saved.locked' : 'research.saved.idle')}</p>
            : missions.length ? (
              <ListBox aria-label={t('research.saved.list')} selectionMode="none" disabledKeys={busy || locked ? missions.map(row => row.id) : []}
                onAction={key => task(signal => select(String(key), signal), 'list')}>
                {missions.map(row => (
                  <ListBox.Item key={row.id} id={row.id} textValue={row.goal} data-current={row.id === mission?.id ? 'true' : undefined}>
                    <Label className="line-clamp-2">{row.goal}</Label>
                    <Description className="ar-row">
                      <Tag tone={MISSION_TONE[row.status]}>{term(t, 'status', row.status)}</Tag>
                      {row.mode ? <>{' '}<span>{term(t, 'mode', row.mode)}</span></> : null}
                    </Description>
                  </ListBox.Item>
                ))}
              </ListBox>
            ) : <p className="ar-note">{t('research.saved.empty')}</p>}
        </aside>

        <section className="ar-stack" aria-label={t('research.results.title')} ref={results}>
          {!state ? <>
            {notice('results')}
            <EmptyState className="bp-panel ar-stack ar-stack--tight">
              <h2>{t('research.results.empty_title')}</h2>
              <p>{t('research.results.empty_text')}</p>
            </EmptyState>
          </> : <>
            <Block className="ar-stack" aria-label={t('research.mission.label')}>
              <div className="ar-stack ar-stack--tight">
                <p className="bp-meta" data-mission-id={mission.id}>{t('research.mission.selected', {id: mission.id})}</p>
                <h2>{t('research.mission.title')}</h2>
                {mission.request?.goal ? <p>{mission.request.goal}</p> : null}
              </div>
              <div className="ar-row">
                <Tag className="status-label" tone={MISSION_TONE[status]}>{term(t, 'status', status)}</Tag>
                {mission.request?.mode ? <Chip size="sm" variant="tertiary">{term(t, 'mode', mission.request.mode)}</Chip> : null}
                {mission.release ? <Tag tone={mission.release.eligible_for_human_review ? 'success' : 'warning'}>{t('research.mission.release', {status: term(t, 'release', mission.release.status)})}</Tag> : null}
              </div>
              <Facts items={[
                [t('research.mission.round'), n(state.round)],
                [t('research.mission.actions'), n(state.actions_used)],
                [t('research.mission.model_calls'), n(state.model_calls_used)],
                [t('research.mission.origin'), term(t, 'origin', state.data_origin)],
              ]} />
              <div className="ar-row">
                <Button variant="secondary" isDisabled={busy || locked} onPress={() => task(async signal => { setVerification(await (await request('/missions/' + mission.id + '/verify', 'POST', undefined, signal)).json()); await refresh(mission.id, signal); })}>
                  <GravityIcon name="shield-check" />{t('research.actions.verify')}
                </Button>
                <Button variant="secondary" isDisabled={busy || locked || !mission.release?.eligible_for_human_review} onPress={() => task(exportCapsule)}>
                  <GravityIcon name="download" />{t('research.actions.export')}
                </Button>
                <Button variant="secondary" isDisabled={busy || locked || !['ready', 'paused'].includes(status) || (status === 'ready' && mission.request?.mode === 'live' && !startBody())}
                  onPress={() => task(signal => startMission(mission.id, status === 'ready' ? startBody() : undefined, signal))}>{t(resumeLabel)}</Button>
                <Button variant="secondary" isDisabled={busy || locked || status !== 'running'} onPress={() => task(async signal => { await request('/missions/' + mission.id + '/pause', 'POST', undefined, signal); await refresh(mission.id, signal); })}>
                  {t('research.actions.pause')}
                </Button>
                {status === 'error' ? (
                  <span className="ar-row ar-row--tight">
                    <Input aria-label={t('research.actions.retry_reason')} placeholder={t('research.actions.retry_placeholder')} value={retryReason} onChange={e => setRetryReason(e.target.value)} />
                    <Button variant="secondary" isDisabled={busy || locked || !retryReason.trim()} onPress={() => task(async signal => {
                      await request('/missions/' + mission.id + '/changes', 'POST', {kind: 'resume', declared_effects: ['analysis', 'claim'], note: RETRY_NOTE + retryReason.trim()}, signal);
                      setRetryReason(''); accepted(mission.id); await refresh(mission.id, signal);
                    })}>{t('research.actions.retry')}</Button>
                  </span>
                ) : null}
                <Button variant="danger" isDisabled={busy || locked || !['ready', 'running', 'paused'].includes(status)} onPress={() => task(async signal => { await request('/missions/' + mission.id + '/cancel', 'POST', undefined, signal); await refresh(mission.id, signal); })}>
                  {t('research.actions.cancel')}
                </Button>
              </div>
              {!mission.release?.eligible_for_human_review ? <p className="ar-note">{t('research.actions.export_closed')}</p> : null}
              {status === 'ready' && mission.request?.mode === 'live' && !startBody() ? <p className="ar-note">{t('research.actions.start_closed')}</p> : null}
              {status === 'error' ? <p className="ar-note">{t('research.actions.retry_note')}</p> : null}
              {notice('results')}
              {routeConflict && slot === 'results' && error ? <Button className="self-start" variant="secondary" size="sm" onPress={reviewRoute}>{t('research.review_route')}</Button> : null}
            </Block>
            <MissionTabs mission={mission} state={state} grants={grants} grantsError={grantsError} timeline={timeline} timelineError={timelineError}
              claims={claims} claimsError={claimsError} verification={verification} request={request} token={token} busy={busy} locked={locked}
              onRevoke={(id, reason) => task(async signal => { await request('/grants/' + id + '/revoke', 'POST', {reason}, signal); await refresh(mission.id, signal); })} />
          </>}
        </section>
      </div>
    </div>
  );
}
