import React, {useEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {Card} from '@heroui/react/card';
import {Chip} from '@heroui/react/chip';
import {Drawer} from '@heroui/react/drawer';
import {Label} from '@heroui/react/label';
import {ListBox} from '@heroui/react/list-box';
import {Meter} from '@heroui/react/meter';
import {Table} from '@heroui/react/table';
import {Tabs} from '@heroui/react/tabs';
import {useI18n} from '../../i18n/index.jsx';
import {GravityIcon} from '../../theme/gravity-icons.jsx';
import {Block, Density, Field, Kicker, LabelledTextArea, Meta, Status} from '../ui.jsx';
import {ACTIVITY, APPROVAL, CLAIMS, EVIDENCE, LADDER, LANES, MISSION, MISSIONS, OVERVIEW, RELEASE, ROUTES} from '../fixtures.js';

const TABS = ['overview', 'routes', 'claims', 'evidence', 'activity', 'approvals', 'release'];

function Overview() {
  const {t} = useI18n();
  return (
    <div className="bp-rule-cols">
      {OVERVIEW.map(column => (
        <div key={column.id}>
          <h2>{t(column.key)}</h2>
          <ul>{column.items.map(item => <li key={item}>{t(item)}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

function Routes() {
  const {t} = useI18n();
  return (
    <div className="mk-board">
      {LANES.map(lane => (
        <div key={lane} className="mk-stack">
          <p className={`mk-lane mk-lane--${lane}`}>{t(`mk.lane.${lane}`)}</p>
          {ROUTES.filter(route => route.lane === lane).map(route => (
            <Card key={route.id}>
              <Card.Header>
                <Card.Title>{t(`${route.key}.title`)}</Card.Title>
                <Card.Description>
                  <Density level={route.density} label={t('mk.density', {level: route.density})} />
                </Card.Description>
              </Card.Header>
              <Card.Content className="mk-stack">
                <Field label={t('mk.route.hypothesis')}>{t(`${route.key}.hypothesis`)}</Field>
                <Field label={t('mk.route.falsifier')}>{t(`${route.key}.falsifier`)}</Field>
                <Field label={t('mk.route.observation')}>{t(`${route.key}.observation`)}</Field>
                <Field label={t('mk.route.next')}>{t(`${route.key}.next`)}</Field>
                <Meta>{t('mk.route.basis')}: {t(`${route.key}.basis`)}</Meta>
              </Card.Content>
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}

function Ladder({rung}) {
  const {t} = useI18n();
  return (
    <div className="mk-stack">
      <Meter value={rung} maxValue={5} color="success" formatOptions={{style: 'decimal'}}>
        <Label>{t('mk.ladder')}</Label>
        <Meter.Output />
        <Meter.Track><Meter.Fill /></Meter.Track>
      </Meter>
      <div className="mk-ladder">
        {LADDER.map((name, index) => (
          <span key={name} className={index <= rung ? `bp-density-${Math.max(1, index)}` : 'bp-meta'}>
            {name} {t(`mk.ladder.l${index}`)}
          </span>
        ))}
      </div>
      <Meta>{t('mk.ladder.reached', {rung: LADDER[rung]})}</Meta>
    </div>
  );
}

function Claims() {
  const {t} = useI18n();
  return (
    <div className="mk-pair">
      {CLAIMS.map(claim => (
        <Card key={claim.id}>
          <Card.Header>
            <Card.Title>{t(`${claim.key}.title`)}</Card.Title>
            <Card.Description>
              <Chip className="mk-verdict" data-verdict={claim.verdict}>{t(`mk.verdict.${claim.verdict}`)}</Chip>
            </Card.Description>
          </Card.Header>
          <Card.Content className="mk-stack">
            <Field label={t('mk.claim.requested')}>{t(`${claim.key}.requested`)}</Field>
            <Field label={t('mk.claim.scope')}>{t(`${claim.key}.scope`)}</Field>
            <Field label={t('mk.claim.uncertainty')}>{t(`${claim.key}.uncertainty`)}</Field>
            <Field label={t('mk.claim.next')}>{t(`${claim.key}.next`)}</Field>
            <Ladder rung={claim.rung} />
            <Field label={t('mk.ladder.needs')}>{t(`${claim.key}.needs`)}</Field>
            <Density level={claim.density} label={t('mk.density', {level: claim.density})} />
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}

// An ISO date is stored, not shown: the cell prints it for the locale, on one line.
const RECORDED = {year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC'};

function Evidence() {
  const {t, d} = useI18n();
  const [openRow, setOpenRow] = useState(null);
  const row = EVIDENCE.find(item => item.id === openRow);
  const claimTitle = id => t(`${CLAIMS.find(claim => claim.id === id).key}.title`);
  return (
    <div className="mk-stack">
      <h2>{t('mk.evidence.heading')}</h2>
      <Meta>{t('mk.evidence.open')}</Meta>
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={t('mk.evidence.heading')} onRowAction={key => setOpenRow(String(key))}>
            <Table.Header>
              <Table.Column isRowHeader>{t('mk.evidence.col.observation')}</Table.Column>
              <Table.Column>{t('mk.evidence.col.source')}</Table.Column>
              <Table.Column>{t('mk.evidence.col.recorded')}</Table.Column>
              <Table.Column>{t('mk.evidence.col.claim')}</Table.Column>
              <Table.Column>{t('mk.evidence.col.density')}</Table.Column>
            </Table.Header>
            <Table.Body>
              {EVIDENCE.map(item => (
                <Table.Row key={item.id} id={item.id}>
                  <Table.Cell>
                    <span className="mk-row mk-row--tight">
                      <GravityIcon name="evidence" />
                      {t(`${item.key}.observation`)}
                    </span>
                  </Table.Cell>
                  <Table.Cell>{t(`${item.key}.source`)}</Table.Cell>
                  <Table.Cell>
                    <time className="mk-nowrap" dateTime={item.recorded}>{d(item.recorded, RECORDED)}</time>
                  </Table.Cell>
                  <Table.Cell>{claimTitle(item.claim)}</Table.Cell>
                  <Table.Cell><Density level={item.density} label={t('mk.density', {level: item.density})} /></Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <Drawer.Backdrop isOpen={!!row} onOpenChange={open => setOpenRow(open ? openRow : null)}>
        <Drawer.Content placement="right">
          <Drawer.Dialog>
            <Drawer.CloseTrigger />
            <Drawer.Header><Drawer.Heading>{t('mk.evidence.trace')}</Drawer.Heading></Drawer.Header>
            <Drawer.Body className="mk-stack">
              {row ? (
                <>
                  <Field label={t('mk.evidence.col.claim')}>{claimTitle(row.claim)}</Field>
                  <Field label={t('mk.evidence.col.observation')}>{t(`${row.key}.observation`)}</Field>
                  <Field label={t('mk.evidence.col.source')}>{t(`${row.key}.source`)}</Field>
                  <Field label={t('mk.evidence.trace')}>{t(`${row.key}.trace`)}</Field>
                  <Meta>{t('mk.evidence.trace.hint')}</Meta>
                </>
              ) : null}
            </Drawer.Body>
            <Drawer.Footer>
              <Button slot="close" variant="secondary">{t('common.close')}</Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </div>
  );
}

function Activity() {
  const {t} = useI18n();
  return (
    <div className="mk-stack">
      <h2>{t('mk.activity.heading')}</h2>
      <ul className="mk-stack">
        {ACTIVITY.map(item => (
          <li key={item.id}>
            {t(item.key)}
            {item.derived ? <Chip size="sm" variant="tertiary">{t('mk.activity.derived')}</Chip> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Approvals() {
  const {t} = useI18n();
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState(null);
  const blocking = APPROVAL.checks.filter(check => check.blocking);
  return (
    <div className="mk-stack">
      <h2>{t('mk.approvals.heading')}</h2>
      <Block variant="primary" className="mk-stack">
        <h3>{t(`${APPROVAL.key}.title`)}</h3>
        <Meta>{t('mk.approvals.waiting', {count: APPROVAL.waiting})}</Meta>
        <div className="mk-board">
          {['baseline', 'candidate', 'diff'].map(kind => (
            <figure key={kind} style={{margin: 0}}>
              <Kicker>{t(`mk.approvals.${kind}`)}</Kicker>
              <div className="mk-shot">{t('mk.approvals.placeholder')}</div>
            </figure>
          ))}
        </div>
        <Field label={t('mk.approvals.changed')}>{t(`${APPROVAL.key}.changed`)}</Field>

        <div className="mk-stack">
          <Kicker>{t('mk.approvals.checks')}</Kicker>
          <ul className="mk-stack">
            {APPROVAL.checks.map(check => (
              <li key={check.id} className="mk-row">
                <Status state={check.state}>{t(`state.${check.state}`)}</Status>
                <span>{t(check.key)}</span>
                {check.blocking ? <Chip color="danger" variant="soft">{t('mk.approvals.blocking')}</Chip> : null}
              </li>
            ))}
          </ul>
        </div>

        <Field label={t('mk.approvals.vlm')}>{t('mk.approvals.vlm.note')}</Field>

        <LabelledTextArea
          id="mk-reject-note"
          label={t('mk.approvals.reject_note')}
          className="h-24 w-full"
          value={note}
          onChange={event => setNote(event.target.value)}
        />
        <Meta>{t('mk.approvals.reject_hint')}</Meta>
        <div className="mk-row">
          <Button isDisabled={blocking.length > 0} onPress={() => setDecision('approve')}>{t('common.approve')}</Button>
          <Button variant="danger" isDisabled={note.trim() === ''} onPress={() => setDecision('reject')}>{t('common.reject')}</Button>
          {decision ? <Chip variant="soft">{t(decision === 'approve' ? 'common.approve' : 'common.reject')}</Chip> : null}
        </div>
      </Block>
    </div>
  );
}

function Release() {
  const {t} = useI18n();
  const short = RELEASE.claims.filter(claim => claim.reached < claim.required);
  return (
    <div className="mk-stack">
      <h2>{t('mk.release.heading')}</h2>
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={t('mk.release.heading')}>
            <Table.Header>
              <Table.Column isRowHeader>{t('mk.release.col.claim')}</Table.Column>
              <Table.Column>{t('mk.release.col.required')}</Table.Column>
              <Table.Column>{t('mk.release.col.reached')}</Table.Column>
            </Table.Header>
            <Table.Body>
              {RELEASE.claims.map(claim => (
                <Table.Row key={claim.id} id={claim.id}>
                  <Table.Cell>{t(`${claim.key}.title`)}</Table.Cell>
                  <Table.Cell>{LADDER[claim.required]}</Table.Cell>
                  <Table.Cell>
                    <Status state={claim.reached < claim.required ? 'blocked' : 'ready'}>{LADDER[claim.reached]}</Status>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <div className="mk-row">
        <Button isDisabled={short.length > 0}>
          <GravityIcon name="download" />
          {t('mk.release.export')}
        </Button>
      </div>
      {short.length > 0 ? <Meta>{t('mk.release.blocked')}</Meta> : null}
    </div>
  );
}

const PANELS = {overview: Overview, routes: Routes, claims: Claims, evidence: Evidence, activity: Activity, approvals: Approvals, release: Release};

export default function ResearchScreen({initialTab}) {
  const {t} = useI18n();
  const [tab, setTab] = useState(() => (TABS.includes(initialTab) ? initialTab : 'overview'));
  const [mission, setMission] = useState(MISSION.id);
  const current = MISSIONS.find(item => item.id === mission) || MISSION;
  // 'running' is shown only when the fixture carries a started operation.
  const state = current.id === MISSION.id && MISSION.startedOperation ? 'running' : current.state;
  const tabs = useRef(null);
  // A long Russian tab strip scrolls; keep the selected tab in view.
  useEffect(() => {
    tabs.current?.querySelector('.tabs__tab[data-selected="true"]')?.scrollIntoView?.({block: 'nearest', inline: 'nearest'});
  }, [tab]);

  return (
    <div className="mk-cockpit">
      <div className="mk-stack">
        <h2>{t('mk.missions.heading')}</h2>
        <ListBox
          aria-label={t('mk.missions.heading')}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[mission]}
          onSelectionChange={keys => { const next = [...keys][0]; if (next) setMission(String(next)); }}
        >
          {MISSIONS.map(item => (
            <ListBox.Item key={item.id} id={item.id} textValue={t(`${item.key}.title`)}>
              <Label>{t(`${item.key}.title`)}</Label>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </div>

      <div className="mk-stack">
        <Block variant="primary" className="mk-stack">
          <h1>{t(`${current.key}.title`)}</h1>
          <Field label={t('mk.mission.question')}>{t(`${current.key}.question`)}</Field>
          <div className="mk-row">
            <Chip color={state === 'done' ? 'success' : 'warning'} variant="soft">{t(`mk.mission.state.${state}`)}</Chip>
            <Meta>{t('mk.mission.round', {current: current.round[0], total: current.round[1]})}</Meta>
            <Meta>{t('count.claims', {count: current.claims})}</Meta>
            <Meta>{t('count.sources', {count: current.sources})}</Meta>
          </div>
        </Block>

        <Tabs ref={tabs} selectedKey={tab} onSelectionChange={key => setTab(String(key))}>
          <Tabs.ListContainer>
            <Tabs.List aria-label={t('mk.screen.research')}>
              {TABS.map(id => (
                <Tabs.Tab key={id} id={id}>
                  {t(`mk.tab.${id}`)}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
          {TABS.map(id => {
            const Panel = PANELS[id];
            return <Tabs.Panel key={id} id={id} className="pt-6"><Panel /></Tabs.Panel>;
          })}
        </Tabs>
      </div>
    </div>
  );
}
