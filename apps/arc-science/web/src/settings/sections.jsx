import React, {memo, useState} from 'react';
import {Button} from '@heroui/react/button';
import {Table} from '@heroui/react/table';
import {useI18n} from '../i18n/index.jsx';
import {grantLabel, grantState, loginLine, probeLine} from '../readiness';
import {Facts} from '../ui.jsx';
import {CheckField, Note, SelectField, TextInput} from './controls.jsx';
import {PROVIDER_NAMES, ROLES, STORES, VIEWER, customEndpoint, originOf, providerLabel, roleLabel, viewerValue, withPath} from './model.js';

const storeLabel = (t, store) => STORES.includes(store) ? t('settings.store.' + store) : store;
const formatList = (t, items) => Array.isArray(items) && items.length ? items.join(', ') : t('common.none');

function DataTable({label, columns, rowHeader = 0, children}) {
  return (
    <div className="ar-table-scroll">
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={label}>
            <Table.Header>
              {columns.map((column, index) => <Table.Column key={column} isRowHeader={index === rowHeader}>{column}</Table.Column>)}
            </Table.Header>
            <Table.Body>{children}</Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}

// Both tables are readiness facts (the saved seats and the CLI logins as last read) and
// the verification per seat; nothing here is asked of the service.
export const Connections = memo(function Connections({readiness, readinessError, catalog}) {
  const i18n = useI18n();
  const {t} = i18n;
  const seats = readiness?.seats || null;
  if (!seats) return <p className="ar-note">{readinessError ? t('settings.conn.failed', {error: readinessError}) : t('settings.conn.waiting')}</p>;
  const rows = ROLES.map(role => [role, roleLabel(t, role), seats[role] || null]);
  const cli = rows.filter(([, , node]) => node?.facts?.transport === 'cli');
  const seatCells = facts => facts.inherits_from ? [<Table.Cell key="all" colSpan={4} className="text-muted">{t('settings.conn.inherits', {role: roleLabel(t, facts.inherits_from)})}</Table.Cell>]
    : !facts.provider ? [<Table.Cell key="all" colSpan={4} className="text-muted">{t('settings.conn.not_set')}</Table.Cell>]
    : [
      <Table.Cell key="provider">{providerLabel(catalog, facts.provider, t)}</Table.Cell>,
      <Table.Cell key="signin">{facts.transport === 'cli' ? t('settings.auth.cli') : facts.credential_store ? t('settings.conn.api_store', {store: storeLabel(t, facts.credential_store)}) : t('settings.auth.api_key')}</Table.Cell>,
      <Table.Cell key="model">{facts.model}</Table.Cell>,
      <Table.Cell key="effort">{facts.effort || t('settings.conn.effort_default')}</Table.Cell>,
    ];
  return (
    <>
      <DataTable label={t('settings.conn.seats')} columns={[t('settings.conn.col.seat'), t('settings.field.provider'), t('settings.field.signin'), t('settings.field.model'), t('settings.field.effort')]}>
        {rows.map(([role, label, node]) => (
          <Table.Row key={role} id={role}>
            <Table.Cell>{label}</Table.Cell>
            {seatCells(node?.facts || {})}
          </Table.Row>
        ))}
      </DataTable>
      {cli.length === 0 ? <p className="ar-note">{t('settings.conn.no_cli')}</p> : (
        <DataTable label={t('settings.conn.logins')} columns={[t('settings.conn.col.seat'), t('settings.conn.col.cli'), t('settings.conn.col.login'), t('settings.conn.col.probe')]}>
          {cli.map(([role, label, node]) => (
            <Table.Row key={role} id={role}>
              <Table.Cell>{label}</Table.Cell>
              <Table.Cell>{node.facts.executable || t('settings.conn.not_found')}</Table.Cell>
              <Table.Cell>{loginLine(node, i18n)}</Table.Cell>
              <Table.Cell>{probeLine(node, i18n)}</Table.Cell>
            </Table.Row>
          ))}
        </DataTable>
      )}
      <Note hint={t('settings.conn.signed_in_more')}>{t('settings.conn.signed_in')}</Note>
    </>
  );
});

/** What a connector check answered: cost-free and data-free, shown as the service reports it. */
export function CheckReport({kind, result}) {
  const {t} = useI18n();
  const mcp = kind === 'mcp';
  const items = mcp
    ? (result.servers || []).map(srv => [srv.server, srv.ok ? (srv.tools || []).map(tool => tool.name + (tool.offered ? '' : ' ' + t('settings.check.not_offered', {reason: tool.reason}))).join(', ') || t('settings.check.no_tools') : t('settings.check.failed', {error: srv.error})])
    : (result.agents || []).map(agent => [agent.agent, agent.ok
      ? [agent.agent_info?.name || t('settings.check.agent'), agent.agent_info?.version || ''].join(' ').trim() + (agent.auth_methods?.length ? ', ' + t('settings.check.auth', {methods: agent.auth_methods.join(', ')}) : '')
      : t('settings.check.failed', {error: agent.error})]);
  return (
    <div className="bp-panel ar-stack ar-stack--tight" role="group" aria-label={t(mcp ? 'settings.check.mcp_done' : 'settings.check.acp_done')}>
      <Facts items={[
        mcp ? [t('settings.check.sdk'), result.sdk || t('settings.check.not_installed')] : [t('settings.check.protocol'), result.protocol_version],
        [t(mcp ? 'settings.check.consented_servers' : 'settings.check.consented_agents'), formatList(t, result.consented)],
      ]} />
      <ul>{items.map(([name, text]) => <li key={name}><strong>{name}</strong>: {text}</li>)}</ul>
    </div>
  );
}

export const ListEditor = memo(function ListEditor({rows, readOnly, kind, set}) {
  const {t} = useI18n();
  const mcp = kind === 'mcp';
  const onChange = next => set([mcp ? 'mcp_servers' : 'acp_agents'], next);
  const blank = mcp ? {name: '', transport: 'stdio', command: '', args: [], url: '', consent: false, enabled: true} : {name: '', command: '', args: [], consent: false, enabled: true};
  const update = (index, patch) => onChange(rows.map((row, i) => i === index ? {...row, ...patch} : row));
  return (
    <div className="ar-stack">
      {rows.length === 0 ? <p className="ar-note">{t('settings.list.none')}</p> : null}
      {rows.map((row, i) => {
        const item = t(mcp ? 'settings.list.mcp_item' : 'settings.list.acp_item', {n: i + 1});
        const aria = key => t('settings.list.aria.' + key, {item});
        return (
          <div className="bp-panel ar-stack" key={i} role="group" aria-label={item}>
            <div className="ar-board">
              <TextInput label={t('settings.list.name')} ariaLabel={aria('name')} value={row.name} isDisabled={readOnly} onChange={value => update(i, {name: value})} />
              {mcp ? <SelectField label={t('settings.list.transport')} ariaLabel={aria('transport')} value={row.transport} isDisabled={readOnly}
                options={[['stdio', 'stdio'], ['http', 'http'], ...(['stdio', 'http'].includes(row.transport) ? [] : [[row.transport, row.transport]])]} onChange={value => update(i, {transport: value})} /> : null}
              {!mcp || row.transport === 'stdio' ? <TextInput label={t('settings.list.command')} ariaLabel={aria('command')} value={row.command} isDisabled={readOnly} onChange={value => update(i, {command: value})} /> : null}
              {mcp && row.transport === 'http' ? <TextInput label={t('settings.list.url')} ariaLabel={aria('url')} value={row.url} isDisabled={readOnly} onChange={value => update(i, {url: value})} /> : null}
              <TextInput label={t('settings.list.args')} ariaLabel={aria('args')} value={row.args.join(' ')} isDisabled={readOnly} placeholder={t('settings.list.args_placeholder')}
                onChange={value => update(i, {args: value.split(/\s+/).filter(Boolean)})} />
            </div>
            <div className="ar-row">
              <CheckField isSelected={row.enabled} isDisabled={readOnly} onChange={on => update(i, {enabled: on})}>{t('settings.list.enabled')}</CheckField>
              <CheckField isSelected={!!row.consent} isDisabled={readOnly} onChange={on => update(i, {consent: on})}>{t(mcp ? 'settings.list.consent_mcp' : 'settings.list.consent_acp')}</CheckField>
              <Button variant="ghost" size="sm" isDisabled={readOnly} onPress={() => onChange(rows.filter((_, j) => j !== i))}>{t('settings.list.remove')}</Button>
            </div>
          </div>
        );
      })}
      <div className="ar-row">
        <Button variant="secondary" size="sm" isDisabled={readOnly} onPress={() => onChange([...rows, blank])}>{t(mcp ? 'settings.list.add_mcp' : 'settings.list.add_acp')}</Button>
      </div>
    </div>
  );
});

/** The viewer defaults; a stored value outside the known ones stays selectable as it is. */
export const ViewerFields = memo(function ViewerFields({viewer, readOnly, set}) {
  const {t} = useI18n();
  return (
    <div className="ar-board">
      {Object.entries(VIEWER).map(([key, options]) => (
        <SelectField key={key} label={t('settings.viewer.' + key)} ariaLabel={t('settings.viewer.' + key + '.aria')} value={viewer[key]} isDisabled={readOnly}
          options={[...(options.includes(viewer[key]) ? [] : [viewer[key]]), ...options].map(option => [option, viewerValue(t, option)])} onChange={next => set(['viewer', key], next)} />
      ))}
    </div>
  );
});

// Endpoints, CLI commands and the OpenClaw agent, one panel per provider.
export const Providers = memo(function Providers({providers, catalog, readOnly, set, setDraft}) {
  const {t} = useI18n();
  // A confirmation was given for one origin; another origin has to be confirmed again.
  const setEndpoint = (name, value) => setDraft(current => {
    const before = current.providers[name].endpoint;
    const next = withPath(current, ['providers', name, 'endpoint'], value);
    return originOf(value) !== originOf(before) ? withPath(next, ['providers', name, 'custom_endpoint_confirmed'], false) : next;
  });
  return (
    <div className="ar-pair">
      {PROVIDER_NAMES.map(name => {
        const p = providers[name];
        const label = providerLabel(catalog, name, t);
        return (
          <div className="bp-panel ar-stack ar-stack--tight" key={name}>
            <h3>{label}</h3>
            <TextInput label={t('settings.provider.endpoint')} ariaLabel={t('settings.aria.endpoint', {provider: label})} value={p.endpoint} isDisabled={readOnly} onChange={value => setEndpoint(name, value)} />
            {customEndpoint(catalog, name, p.endpoint) ? (
              <>
                <CheckField ariaLabel={t('settings.aria.endpoint_confirmed', {provider: label})} isSelected={Boolean(p.custom_endpoint_confirmed)} isDisabled={readOnly}
                  onChange={on => set(['providers', name, 'custom_endpoint_confirmed'], on)}>{t('settings.provider.confirm')}</CheckField>
                <p className="ar-note">{t('settings.provider.off_origin', {origin: catalog.providers[name].official_origin})}</p>
              </>
            ) : null}
            {name === 'openclaw' ? (
              <>
                <TextInput label={t('settings.provider.agent')} ariaLabel={t('settings.aria.agent')} value={p.agent_id} isDisabled={readOnly} onChange={value => set(['providers', name, 'agent_id'], value)} />
                <CheckField isSelected={p.isolated} isDisabled={readOnly} onChange={on => set(['providers', name, 'isolated'], on)}>{t('settings.provider.isolated')}</CheckField>
              </>
            ) : <TextInput label={t('settings.provider.cli')} ariaLabel={t('settings.aria.cli', {provider: label})} value={p.cli} isDisabled={readOnly} onChange={value => set(['providers', name, 'cli'], value)} />}
          </div>
        );
      })}
    </div>
  );
});

// The reason stays in the form while it is typed; the ledger records it with the revoke.
function RevokeForm({grant, busy, onRevoke, onCancel}) {
  const {t} = useI18n();
  const [reason, setReason] = useState('');
  const title = t('settings.grants.revoke_title', {destination: grant.destination});
  return (
    <div className="bp-panel ar-stack ar-stack--tight" role="group" aria-label={title}>
      <p><strong>{title}</strong></p>
      <p className="ar-note">{t('settings.grants.revoke_note')}</p>
      <div className="ar-row items-end">
        <div className="min-w-64 flex-1">
          <TextInput label={t('settings.grants.reason')} ariaLabel={t('settings.grants.reason_aria', {destination: grant.destination})} value={reason}
            placeholder={t('settings.grants.reason_placeholder')} onChange={setReason} />
        </div>
        <Button variant="danger" aria-label={t('settings.grants.confirm_aria', {destination: grant.destination})} isDisabled={busy || !reason.trim()}
          onPress={() => onRevoke(grant, reason.trim())}>{t('settings.grants.revoke')}</Button>
        <Button variant="ghost" onPress={onCancel}>{t('settings.keep')}</Button>
      </div>
    </div>
  );
}

// The permission center: the ledger's grants (mission, request and persistent) with the state
// the ledger derived, a filter, and Revoke behind a recorded reason. Nothing here is consent:
// a connector ticked under Connections is eligible for a route, which is not a grant.
export const Permissions = memo(function Permissions({grants, filter, setFilter, revoking, setRevoking, busy, error, act}) {
  const i18n = useI18n();
  const {t, d, n} = i18n;
  const shown = (grants || []).filter(grant => filter === 'all' || grantState(grant) === filter);
  const target = revoking && (grants || []).find(grant => grant.id === revoking);
  const subject = grant => grant.subject_kind === 'mission' ? <>{t('settings.grants.mission')} <code>{grant.subject_id}</code></>
    : grant.subject_kind === 'request' ? t('settings.grants.request') : t('settings.grants.persistent');
  return (
    <>
      <Note hint={t('settings.grants.note_more')}>{t('settings.grants.note')}</Note>
      <div className="ar-row items-end">
        <div className="w-48">
          <SelectField label={t('settings.grants.show')} ariaLabel={t('settings.grants.show')} value={filter} onChange={setFilter}
            options={[['all', t('settings.grants.all')], ['active', t('grant.state.active')], ['revoked', t('grant.state.revoked')]]} />
        </div>
        <Button variant="secondary" isDisabled={busy} onPress={() => act('refreshGrants')}>{t('settings.grants.refresh')}</Button>
      </div>
      {error}
      {!grants ? <p className="ar-note">{t('settings.grants.unread')}</p>
        : grants.length === 0 ? <p className="ar-note">{t('settings.grants.empty')}</p>
        : shown.length === 0 ? <p className="ar-note">{t('settings.grants.none_' + filter)}</p>
        : (
          <DataTable label={t('settings.grants.table')} rowHeader={1} columns={['kind', 'destination', 'data', 'scope', 'state', 'uses', 'last', 'source', 'revoke'].map(key => t('settings.grants.col.' + key))}>
            {shown.map(grant => {
              const state = grantState(grant);
              return (
                <Table.Row key={grant.id} id={grant.id}>
                  <Table.Cell>{String(grant.destination_kind || '').replace(/_/g, ' ')}</Table.Cell>
                  <Table.Cell><code>{grant.destination}</code></Table.Cell>
                  <Table.Cell>{grant.data_category}</Table.Cell>
                  <Table.Cell>{grant.scope}</Table.Cell>
                  <Table.Cell><span className="ar-tag" data-tone={state === 'active' ? 'success' : undefined}>{grantLabel(state, i18n)}</span></Table.Cell>
                  <Table.Cell>{grant.max_uses ? t('settings.grants.uses_of', {uses: Number(grant.uses) || 0, max: grant.max_uses}) : n(Number(grant.uses) || 0)}</Table.Cell>
                  <Table.Cell>{grant.last_used_at > 0 ? d(grant.last_used_at * 1000, {dateStyle: 'medium', timeStyle: 'short'}) : t('common.never')}</Table.Cell>
                  <Table.Cell>{subject(grant)}</Table.Cell>
                  <Table.Cell>
                    <Button variant="ghost" size="sm" aria-label={t('settings.grants.revoke_aria', {destination: grant.destination})} isDisabled={busy || state !== 'active' || revoking === grant.id}
                      onPress={() => setRevoking(grant.id)}>{t('settings.grants.revoke')}</Button>
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </DataTable>
        )}
      {target ? <RevokeForm key={target.id} grant={target} busy={busy} onRevoke={(grant, reason) => act('revoke', grant, reason)} onCancel={() => setRevoking(null)} /> : null}
    </>
  );
});
