import React from 'react';
import {Button} from '@heroui/react/button';
import {Checkbox} from '@heroui/react/checkbox';
import {Description} from '@heroui/react/description';
import {Table} from '@heroui/react/table';
import {useI18n} from '../i18n/index.jsx';
import {sentence, stateLabel, stateOf} from '../readiness';
import {Status} from '../ui.jsx';
import {Problem, friendlyError, roleName} from './common.jsx';

/** The seats a blocked live mission waits on, as GET /api/readiness names them; nothing here is recomputed. */
export const blockingSeats = readiness => (readiness?.live_mission?.blocking || []).map(role => readiness.seats?.[role]).filter(Boolean);
export const seatAction = seat => seat.label + ' — ' + sentence(seat.next_action || seat.meaning);

export function LiveRoute({readiness, error, locked, onNavigate, onCheck, token}) {
  const i18n = useI18n(), {t} = i18n;
  let body;
  if (locked) body = <p className="ar-note">{t('research.live.locked')}</p>;
  else if (error) body = <><Problem>{friendlyError(error, token, t)}</Problem><Button className="self-start" variant="secondary" size="sm" onPress={onCheck}>{t('research.live.check_again')}</Button></>;
  else if (!readiness) body = <><p role="status" className="ar-note">{t('research.live.unread')}</p><Button className="self-start" variant="secondary" size="sm" onPress={onCheck}>{t('research.live.check')}</Button></>;
  else {
    const seats = (readiness.roles || []).map(r => readiness.seats?.[r.role]).filter(seat => seat?.facts?.provider);
    const live = readiness.live_mission, liveState = stateOf(live), blocking = blockingSeats(readiness);
    body = <>
      {seats.length ? (
        <ul className="ar-stack ar-stack--tight">
          {seats.map(seat => (
            <li key={seat.role} className="ar-row" data-state={seat.state}>
              <strong>{seat.label}</strong>{' '}
              <span>{seat.facts.provider}</span>{' '}
              <span className="bp-meta">{seat.facts.model || t('research.live.no_model')}</span>{' '}
              <span>{seat.facts.effort || t('research.live.default_effort')}</span>{' '}
              <Status state={stateOf(seat)}>{stateLabel(stateOf(seat), i18n)}</Status>
            </li>
          ))}
        </ul>
      ) : <p className="ar-note">{t('research.live.no_seat')}</p>}
      {liveState === 'blocked' ? <>
        <p role="status">{sentence(live.meaning)}{blocking.length ? ' ' + t('research.live.blocked_by', {seats: blocking.map(seatAction).join(' ')}) : live.next_action ? ' ' + sentence(live.next_action) : ''}</p>
        <Button className="self-start" variant="secondary" size="sm" onPress={() => onNavigate?.('settings')}>{t('research.live.open_settings')}</Button>
      </> : liveState === 'not_tested' ? <p className="ar-note">{t('research.live.not_tested')}</p>
        : <p className="ar-note">{stateLabel(liveState, i18n)} — {sentence(live?.meaning || t('research.live.undetermined'))}{liveState !== 'ready' && live?.next_action ? ' ' + sentence(live.next_action) : ''}</p>}
    </>;
  }
  return <section className="bp-panel ar-stack ar-stack--tight" aria-label={t('research.live.title')}><h3>{t('research.live.title')}</h3>{body}</section>;
}

/** The destinations a live mission would send data to, as GET /api/missions/preview lists them; the grants posted at start are the preview's own required_grants. */
const routeRows = (preview, t) => [
  ...(preview.seats || []).map(seat => ({...seat, name: t('research.route.seat_name', {role: roleName(t, seat.role), provider: seat.provider, model: seat.model || t('research.live.no_model')})})),
  ...(preview.connectors || []),
  ...(preview.public_reads || []).map(read => ({...read, name: t('research.route.public_read'), purpose: read.purpose || t('research.route.planner_query')})),
  ...(preview.biorender ? [{name: 'BioRender', ...preview.biorender}] : []),
];

export function RouteGrants({preview, error, blocked, locked, approved, onApprove, onRetry}) {
  const {t} = useI18n();
  let body;
  if (locked) body = <p className="ar-note">{t('research.route.locked')}</p>;
  else if (blocked) body = <p className="ar-note">{t('research.route.blocked')}</p>;
  else if (error) body = <><Problem>{error}</Problem><Button className="self-start" variant="secondary" size="sm" onPress={onRetry}>{t('research.route.preview_again')}</Button></>;
  else if (!preview) body = <p role="status" className="ar-note">{t('research.route.reading')}</p>;
  else {
    const rows = routeRows(preview, t);
    body = <>
      <div className="ar-table-scroll">
        <Table><Table.ScrollContainer><Table.Content aria-label={t('research.route.table')}>
          <Table.Header>
            <Table.Column>{t('research.route.col.kind')}</Table.Column>
            <Table.Column isRowHeader>{t('research.route.col.name')}</Table.Column>
            <Table.Column>{t('research.route.col.destination')}</Table.Column>
            <Table.Column>{t('research.route.col.data')}</Table.Column>
            <Table.Column>{t('research.route.col.purpose')}</Table.Column>
          </Table.Header>
          <Table.Body>
            {rows.map((row, i) => (
              <Table.Row key={i} id={String(i)}>
                <Table.Cell>{row.destination_kind}</Table.Cell><Table.Cell>{row.name}</Table.Cell><Table.Cell>{row.destination}</Table.Cell>
                <Table.Cell>{row.data_category}</Table.Cell><Table.Cell>{row.purpose}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content></Table.ScrollContainer></Table>
      </div>
      <p className="bp-meta">{t('research.route.digest', {digest: preview.route_digest.slice(0, 12), revision: preview.settings_revision})}</p>
      <p className="ar-note">{t('research.route.consent_note')}</p>
      <Checkbox isSelected={approved} onChange={onApprove}>
        <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{t('research.route.approve')}</Checkbox.Content>
        <Description>{t('research.route.approve_note')}</Description>
      </Checkbox>
    </>;
  }
  return <section className="bp-panel ar-stack ar-stack--tight" aria-label={t('research.route.title')}><h3>{t('research.route.title')}</h3>{body}</section>;
}
