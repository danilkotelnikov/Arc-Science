import React, {useEffect, useState} from 'react';
import {Accordion} from '@heroui/react/accordion';
import {Alert} from '@heroui/react/alert';
import {Button} from '@heroui/react/button';
import {Input} from '@heroui/react/input';
import {Table} from '@heroui/react/table';
import {Tabs} from '@heroui/react/tabs';
import {useI18n} from '../i18n/index.jsx';
import {grantLabel, grantState, releaseWord} from '../readiness';
import {Facts, Field} from '../ui.jsx';
import {ClaimScopeView} from './Claims.jsx';
import {EvidencePanel} from './Evidence.jsx';
import {CHECK_TONE, Problem, STAMP, Tag, roleName, term, words} from './common.jsx';

const TABS = ['overview', 'claims', 'evidence', 'activity', 'permissions', 'release'];

/** A dense record: HeroUI Table in a horizontal scroller, so a narrow window never scrolls the page. */
const Grid = ({label, columns, children}) => (
  <div className="ar-table-scroll">
    <Table><Table.ScrollContainer><Table.Content aria-label={label}>
      <Table.Header>{columns.map((column, i) => <Table.Column key={i} isRowHeader={i === 0}>{column}</Table.Column>)}</Table.Header>
      <Table.Body>{children}</Table.Body>
    </Table.Content></Table.ScrollContainer></Table>
  </div>
);

/** The last persisted event decides the banner: an interruption or a pause is shown from the event itself, nothing is inferred. */
function Interruption({events}) {
  const {t} = useI18n();
  const last = events[events.length - 1];
  const kind = last?.kind === 'mission_interrupted' ? 'interrupted' : last?.kind === 'mission_paused' ? 'paused' : null;
  if (!kind) return null;
  return (
    <Alert status="warning" role="status" data-event={last.kind}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{t(`research.${kind}.title`)}</Alert.Title>
        <Alert.Description>{t(`research.${kind}.text`, {round: last.round, detail: last.detail})}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

function Overview({state}) {
  const {t} = useI18n();
  return (
    <div className="ar-stack">
      {state.stop_reason ? <div role="status"><p className="bp-kicker">{t('research.overview.stop_reason')}</p><p>{state.stop_reason}</p></div> : null}
      <Interruption events={state.events} />
      <section className="ar-stack" aria-label={t('research.branches.title')}>
        <h2>{t('research.branches.title')}</h2>
        {state.branches.length ? (
          <div className="ar-pair">
            {state.branches.map(branch => (
              <article key={branch.id} className="bp-panel ar-stack ar-stack--tight" data-branch={branch.id} data-focus={String(state.focus === branch.id)}>
                <div className="ar-row justify-between">
                  <h3>{branch.title}</h3>
                  {state.focus === branch.id ? <Tag tone="accent">{t('research.branches.focus')}</Tag> : null}
                </div>
                <Field label={t('research.branches.hypothesis')}>{branch.hypothesis}</Field>
                <Field label={t('research.branches.falsifier')}>{branch.falsifier}</Field>
                <p className="bp-meta">{t('research.branches.opened', {round: branch.created_round, parents: branch.parents.join(', ') || t('research.branches.root')})}</p>
              </article>
            ))}
          </div>
        ) : <p className="ar-note">{t('research.branches.none')}</p>}
      </section>
    </div>
  );
}

function Timeline({timeline, error}) {
  // Operational record (GET /timeline), never evidence: one row per operation with its recorded
  // outcome; a row without a finished row reads 'no outcome recorded' and nothing here says a
  // mission is running; that word comes from the persisted status alone.
  const {t, d, n} = useI18n();
  const at = ms => ms === null || ms === undefined ? '—' : d(ms, STAMP);
  const identity = value => t(value === true ? 'research.identity.verified' : value === false ? 'research.identity.unverified' : 'research.identity.unrecorded');
  let body;
  if (error) body = <Problem>{error}</Problem>;
  else if (!timeline) body = <p className="ar-note">{t('research.timeline.unread')}</p>;
  else if (!timeline.recorded || !timeline.rows.length) body = <p className="ar-note">{t('research.timeline.none')}</p>;
  else body = (
    <Grid label={t('research.timeline.title')} columns={['#', 'started', 'finished', 'operation', 'role', 'model', 'identity', 'tool', 'branch', 'outcome', 'receipt', 'actor'].map((c, i) => i ? t('research.timeline.col.' + c) : c)}>
      {timeline.rows.map(row => (
        <Table.Row key={row.id} id={row.id} data-operation={row.operation} data-role={row.role} data-outcome={row.outcome} data-outcome-source={row.outcome_source}>
          <Table.Cell>{n(row.sequence)}</Table.Cell>
          <Table.Cell><span className="ar-nowrap">{at(row.started_at)}</span></Table.Cell>
          <Table.Cell><span className="ar-nowrap">{at(row.finished_at)}</span></Table.Cell>
          <Table.Cell>{term(t, 'operation', row.operation)}</Table.Cell>
          <Table.Cell>{roleName(t, row.role)}</Table.Cell>
          <Table.Cell>{row.model_requested ? row.model_requested + (row.model_observed ? ' → ' + row.model_observed : '') : '—'}</Table.Cell>
          <Table.Cell>{identity(row.identity_verified)}</Table.Cell>
          <Table.Cell>{row.tool ? row.tool + ' / ' + row.action_id : '—'}</Table.Cell>
          <Table.Cell>{row.branch_id || '—'}</Table.Cell>
          <Table.Cell>{row.outcome === 'outcome_unknown' ? t('research.timeline.no_outcome') : term(t, 'outcome', row.outcome)}</Table.Cell>
          <Table.Cell>{row.receipt_id ? row.receipt_id.slice(0, 12) : t('common.none')}</Table.Cell>
          <Table.Cell>{row.actor}{row.actor && row.detail ? <br /> : null}{row.detail}</Table.Cell>
        </Table.Row>
      ))}
    </Grid>
  );
  return (
    <section className="ar-stack ar-stack--tight" aria-label={t('research.timeline.title')}>
      <h2>{t('research.timeline.title')}</h2>
      <p className="ar-note">{timeline?.note || t('research.timeline.note')}</p>
      {body}
    </section>
  );
}

function Changes({changes, obligations}) {
  // Every operator change on the mission: what was declared, what the server derived, and the
  // state of each obligation as the release ledger reads it now.
  const i18n = useI18n(), {t} = i18n;
  const effects = list => list.map(effect => term(t, 'effect', effect)).join(', ') || t('common.none');
  return (
    <section className="ar-stack ar-stack--tight" aria-label={t('research.changes.title')}>
      <h2>{t('research.changes.title')}</h2>
      <p className="ar-note">{t('research.changes.lead')}</p>
      {changes.length ? (
        <ol className="ar-list">
          {changes.map(change => (
            <li key={change.id} data-kind={change.kind} className="bp-panel ar-stack ar-stack--tight">
              <h3>{t('research.changes.item', {kind: term(t, 'change', change.kind), round: change.round})}</h3>
              <Facts items={[
                [t('research.changes.declared'), effects(change.declared_effects)],
                [t('research.changes.derived'), effects(change.derived_effects)],
              ]} />
              <div className="ar-stack ar-stack--tight">
                <p className="bp-kicker">{t('research.changes.required')}</p>
                <p className="ar-row">
                  {(obligations?.[change.id] || change.required_checks.map(check => ({check, state: 'unknown'}))).map((o, i) => (
                    <React.Fragment key={o.check}>{i ? ' ' : null}<Tag tone={CHECK_TONE[o.state]} data-state={o.state}>{term(t, 'obligation', o.check)}: {releaseWord(o.state, i18n)}</Tag></React.Fragment>
                  ))}
                </p>
              </div>
              {change.note ? <p className="ar-note">{change.note}</p> : null}
            </li>
          ))}
        </ol>
      ) : <p className="ar-note">{t('research.changes.none')}</p>}
    </section>
  );
}

function Traces({state}) {
  // Secondary traces, collapsed until asked for: the raw role reconciliation and the persisted events.
  const {t} = useI18n();
  const assessments = state.assessments, events = state.events;
  const titled = (key, total, shown) => t(total > shown ? `${key}_last` : key, {count: total, shown});
  return (
    <Accordion allowsMultipleExpanded>
      <Accordion.Item id="reconciliation">
        <Accordion.Heading>
          <Accordion.Trigger>{titled('research.reconciliation.title', assessments.length, 12)}<Accordion.Indicator /></Accordion.Trigger>
        </Accordion.Heading>
        <Accordion.Panel>
          <Accordion.Body className="ar-list">
            {assessments.slice(-12).map((assessment, i) => (
              <article className="ar-stack ar-stack--tight" key={i} data-position={assessment.position}>
                <p className="ar-row">
                  <strong>{roleName(t, assessment.role)}</strong>{' '}<span className="bp-meta">{assessment.branch_id}</span>{' '}
                  <Tag tone={assessment.position === 'challenge' ? 'warning' : assessment.position === 'support' ? 'success' : undefined}>{term(t, 'position', assessment.position)}</Tag>
                </p>
                <p>{assessment.finding}</p>
                <p className="bp-meta">{t('research.reconciliation.meta', {evidence: assessment.evidence_ids.join(', ') || t('common.none'), model: assessment.model})}</p>
              </article>
            ))}
          </Accordion.Body>
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item id="events">
        <Accordion.Heading>
          <Accordion.Trigger>{titled('research.events.title', events.length, 15)}<Accordion.Indicator /></Accordion.Trigger>
        </Accordion.Heading>
        <Accordion.Panel>
          <Accordion.Body>
            <ul className="ar-stack ar-stack--tight">
              {events.slice(-15).reverse().map((event, i) => <li key={i} className="ar-note">[{event.round}] {words(event.kind)}: {event.detail}</li>)}
            </ul>
          </Accordion.Body>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

/** The route bound at the first start, read from the seats_bound event (`sha256:<digest> <json summary>`) and the mission's grants; nothing is recomputed. */
function MissionRoute({state, mode, grants}) {
  const {t} = useI18n();
  const bound = [...state.events].reverse().find(e => e.kind === 'seats_bound');
  let body;
  if (!bound) body = <p className="ar-note">{t(mode === 'live' ? 'research.mission_route.unbound' : 'research.mission_route.offline')}</p>;
  else {
    let summary = null; try { summary = JSON.parse(bound.detail.slice(72)); } catch { summary = null; }
    const counts = {}; for (const grant of grants?.grants || []) counts[grantState(grant)] = (counts[grantState(grant)] || 0) + 1;
    body = <>
      {summary && typeof summary === 'object'
        ? <Facts items={Object.entries(summary).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)])} />
        : <p>{bound.detail}</p>}
      <p className="bp-meta">{t('research.mission_route.bound', {digest: bound.detail.slice(7, 19), round: bound.round})}</p>
      <p className="ar-note">{t('research.mission_route.grants', {active: counts.active || 0, revoked: counts.revoked || 0})}</p>
    </>;
  }
  return <section className="ar-stack ar-stack--tight" aria-label={t('research.mission_route.title')}><h2>{t('research.mission_route.label')}</h2>{body}</section>;
}

function GrantsLedger({ledger, error, busy, locked, onRevoke}) {
  // Operational record, never evidence: which destinations this mission may send data to
  // (grants) and each attempted dispatch (receipts). Revoking refuses the mission's next call.
  const i18n = useI18n(), {t, d, n} = i18n;
  const when = at => at > 0 ? d(at * 1000, STAMP) : t('common.never');
  const [reasons, setReasons] = useState({});
  const grants = ledger?.grants || [], receipts = ledger?.receipts || [];
  let body;
  if (error) body = <Problem>{t('research.grants.failed', {error})}</Problem>;
  else if (!ledger) body = <p className="ar-note">{t('research.grants.unread')}</p>;
  else body = <>
    {grants.length ? (
      <Grid label={t('research.grants.table')} columns={['destination', 'kind', 'data', 'scope', 'state', 'uses', 'last_use'].map(c => t('research.grants.col.' + c)).concat(<span className="ar-hidden">{t('research.grants.revoke')}</span>)}>
        {grants.map(grant => (
          <Table.Row key={grant.id} id={grant.id} data-state={grantState(grant)}>
            <Table.Cell>{grant.destination}</Table.Cell>
            <Table.Cell>{grant.destination_kind}</Table.Cell>
            <Table.Cell>{grant.data_category}</Table.Cell>
            <Table.Cell>{grant.scope}</Table.Cell>
            <Table.Cell>{grantLabel(grantState(grant), i18n)}{grant.revoked_at ? ' ' + when(grant.revoked_at) : ''}</Table.Cell>
            <Table.Cell>{grant.max_uses ? t('research.grants.uses_of', {uses: grant.uses, max: grant.max_uses}) : n(grant.uses)}</Table.Cell>
            <Table.Cell>{when(grant.last_used_at)}</Table.Cell>
            <Table.Cell>
              {grantState(grant) === 'active' ? (
                <span className="ar-row ar-row--tight">
                  <Input aria-label={t('research.grants.reason')} placeholder={t('research.grants.reason_placeholder')} value={reasons[grant.id] || ''}
                    onChange={e => setReasons({...reasons, [grant.id]: e.target.value})} />
                  <Button variant="danger" size="sm" aria-label={t('research.grants.revoke_named', {destination: grant.destination})} isDisabled={busy || locked}
                    onPress={() => onRevoke(grant.id, reasons[grant.id] || '')}>{t('research.grants.revoke')}</Button>
                </span>
              ) : null}
            </Table.Cell>
          </Table.Row>
        ))}
      </Grid>
    ) : <p className="ar-note">{t('research.grants.none')}</p>}
    <h3>{t('research.receipts.title')}</h3>
    {receipts.length ? (
      <Grid label={t('research.receipts.title')} columns={['time', 'destination', 'data', 'outcome', 'reason', 'observation'].map(c => t('research.receipts.col.' + c))}>
        {receipts.map(receipt => (
          <Table.Row key={receipt.id} id={receipt.id} data-outcome={receipt.outcome}>
            <Table.Cell><span className="ar-nowrap">{when(receipt.at)}</span></Table.Cell>
            <Table.Cell>{receipt.destination}</Table.Cell>
            <Table.Cell>{receipt.data_category}</Table.Cell>
            <Table.Cell>{term(t, 'outcome', receipt.outcome)}</Table.Cell>
            <Table.Cell>{receipt.reason}</Table.Cell>
            <Table.Cell>{receipt.observation_id || ''}</Table.Cell>
          </Table.Row>
        ))}
      </Grid>
    ) : <p className="ar-note">{t('research.receipts.none')}</p>}
    {ledger.receipts_truncated ? <p className="ar-note">{t('research.receipts.truncated', {count: receipts.length})}</p> : null}
  </>;
  return (
    <section className="ar-stack ar-stack--tight" aria-label={t('research.grants.title')}>
      <h2>{t('research.grants.title')}</h2>
      <p className="ar-note">{t('research.grants.lead')}</p>
      <p className="ar-note">{t('research.grants.revoke_note')}</p>
      {body}
    </section>
  );
}

const MEANING = {eligible_for_human_review: 'research.release.meaning_eligible', blocked: 'research.release.meaning_blocked'};
function ReleaseLedger({release}) {
  // The current decision, defined where it appears; states follow release.py (BLOCKING = failed,
  // unknown, error, stale) and are named with releaseWord.
  const i18n = useI18n(), {t} = i18n;
  if (!release) return null;
  return (
    <section className="ar-stack ar-stack--tight" aria-label={t('research.release.title')}>
      <h2>{t('research.release.heading', {status: term(t, 'release', release.status)})}</h2>
      <p className="ar-note">{t(MEANING[release.status] || 'research.release.not_validated')}</p>
      <Grid label={t('research.release.checks')} columns={['check', 'state', 'reason'].map(c => t('research.release.col.' + c))}>
        {release.checks.map(check => (
          <Table.Row key={check.name} id={check.name} data-state={check.state}>
            <Table.Cell>{term(t, 'check', check.name)}</Table.Cell>
            <Table.Cell><Tag tone={CHECK_TONE[check.state]}>{releaseWord(check.state, i18n)}</Tag></Table.Cell>
            <Table.Cell>{check.reason}</Table.Cell>
          </Table.Row>
        ))}
      </Grid>
      {release.blocking_reasons.length > 0 ? <p role="status">{t('research.release.blocked_by', {reasons: release.blocking_reasons.map(words).join(', ')})}</p> : null}
    </section>
  );
}

function VerificationReport({report}) {
  const {t} = useI18n();
  const outcome = value => t(value === true ? 'research.verify.passed' : value === false ? 'research.verify.failed' : 'research.verify.unreported');
  const count = (value, noun) => value === null || value === undefined ? t(`research.verify.${noun}_unreported`) : t(`research.verify.${noun}`, {count: value});
  return (
    <section className="ar-stack ar-stack--tight" aria-label={t('research.verify.title')}>
      <h2>{t('research.verify.heading', {outcome: outcome(report.reproduction_passed)})}</h2>
      <Facts items={[
        [t('research.verify.integrity'), outcome(report.integrity)],
        [t('research.verify.graph'), outcome(report.evidence_graph_valid)],
        [t('research.verify.recomputed'), count(report.reproduced, 'computations') + ', ' + count(report.artifacts_reproduced, 'artifacts')],
      ]} />
      <p className="ar-note">{t('research.verify.validity')}</p>
      {report.failures?.length > 0 ? <Problem>{t('research.verify.failures', {count: report.failures.length})}</Problem> : null}
      <Accordion>
        <Accordion.Item id="details">
          <Accordion.Heading><Accordion.Trigger>{t('research.verify.details')}<Accordion.Indicator /></Accordion.Trigger></Accordion.Heading>
          <Accordion.Panel><Accordion.Body><pre className="ar-code">{JSON.stringify(report, null, 2)}</pre></Accordion.Body></Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </section>
  );
}

/** The selected mission's record, one tab per question; every panel stays mounted, so images, drafts and open sections survive a tab change. */
export function MissionTabs({mission, state, grants, grantsError, timeline, timelineError, claims, claimsError, verification, request, token, busy, locked, onRevoke}) {
  const {t} = useI18n();
  const [tab, setTab] = useState('overview');
  // A fresh replay report opens its tab: its failure alert must not arrive in a hidden panel.
  useEffect(() => { if (verification) setTab('release'); }, [verification]);
  const panel = (id, children) => <Tabs.Panel key={id} id={id} className="px-0" shouldForceMount hidden={tab !== id}>{children}</Tabs.Panel>;
  return (
    <Tabs selectedKey={tab} onSelectionChange={key => setTab(String(key))}>
      <Tabs.ListContainer>
        <Tabs.List aria-label={t('research.tabs.label')}>
          {TABS.map(id => <Tabs.Tab key={id} id={id}>{t('research.tabs.' + id)}<Tabs.Indicator /></Tabs.Tab>)}
        </Tabs.List>
      </Tabs.ListContainer>
      {panel('overview', <Overview state={state} />)}
      {panel('claims', <ClaimScopeView scope={state.claim_scope} claims={claims} claimsError={claimsError} />)}
      {panel('evidence', <EvidencePanel mission={mission} state={state} request={request} token={token} />)}
      {panel('activity', <div className="ar-stack">
        <Timeline timeline={timeline} error={timelineError} />
        <Changes changes={state.changes || []} obligations={mission.change_obligations} />
        <Traces state={state} />
      </div>)}
      {panel('permissions', <div className="ar-stack">
        <MissionRoute state={state} mode={mission.request?.mode} grants={grants} />
        <GrantsLedger ledger={grants} error={grantsError} busy={busy} locked={locked} onRevoke={onRevoke} />
      </div>)}
      {panel('release', <div className="ar-stack">
        <ReleaseLedger release={mission.release} />
        {verification ? <VerificationReport report={verification} /> : <p className="ar-note">{t('research.verify.none')}</p>}
      </div>)}
    </Tabs>
  );
}
