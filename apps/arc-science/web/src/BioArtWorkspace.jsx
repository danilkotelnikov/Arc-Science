import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Alert} from '@heroui/react/alert';
import {Button} from '@heroui/react/button';
import {Card} from '@heroui/react/card';
import {Checkbox} from '@heroui/react/checkbox';
import {Description} from '@heroui/react/description';
import {Disclosure} from '@heroui/react/disclosure';
import {EmptyState} from '@heroui/react/empty-state';
import {Input} from '@heroui/react/input';
import {Label} from '@heroui/react/label';
import {Link} from '@heroui/react/link';
import {ListBox} from '@heroui/react/list-box';
import {Select} from '@heroui/react/select';
import {Table} from '@heroui/react/table';
import {TextField} from '@heroui/react/textfield';
import {apiFetch, downloadResponse, sessionLine, sessionState} from './http';
import {useI18n} from './i18n/index.jsx';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';
import {GravityIcon} from './theme/gravity-icons.jsx';
import {Block, Facts, Kicker, PageHead, useFirstEntry} from './ui.jsx';

const formatOrder = ['SVG', 'PNG', 'AI', 'EPS'];
// NIH's own identifier, shown as NIH prints it; never translated or number-formatted.
const entryLabel = id => 'BIOART-' + String(id).padStart(6, '0');

function errorMessage(reason) {
  return reason?.message || String(reason || '');
}

function isOfflineError(message) {
  return /failed to fetch|networkerror|load failed/i.test(message);
}

function detailAfterStatus(message) {
  const match = message.match(/^Request failed \((\d+)\)(?::\s*)?(.*)$/);
  return match ? {status: Number(match[1]), detail: match[2] || ''} : null;
}

function isAuthError(reason) {
  const status = detailAfterStatus(errorMessage(reason))?.status;
  return status === 401 || status === 403;
}

function sanitizeBioArtDetail(detail, t) {
  return detail
    .replace(/;?\s*explicit\s+--allow-egress\s+required\.?/ig, '')
    .replace(/search\s+--search-html\s+with\s+an\s+operator-supplied\s+browser\s+DOM\s+snapshot/ig, t('bioart.error.snapshot'))
    .replace(/\s+/g, ' ')
    .trim();
}

function describeBioArtError(reason, scope, token, t) {
  const message = errorMessage(reason);
  const status = detailAfterStatus(message);
  if (/Operator token is required/i.test(message)) return sessionLine('locked', t);
  if (status?.status === 401 || status?.status === 403) return sessionLine(sessionState(token, true).id, t);
  if (isOfflineError(message)) return sessionLine('offline', t);
  if (status?.status === 409 && /Missing or stale cache/i.test(status.detail)) {
    return t(scope === 'fetch' ? 'bioart.error.cache_file' : 'bioart.error.cache_metadata');
  }
  if (status) {
    if (/schema drift/i.test(status.detail)) return t('bioart.error.schema');
    return sanitizeBioArtDetail(status.detail, t) || t('bioart.error.generic');
  }
  return sanitizeBioArtDetail(message, t) || t('bioart.error.generic');
}

const Problem = ({children}) => (
  <Alert status="danger" role="alert">
    <Alert.Indicator />
    <Alert.Content><Alert.Description>{children}</Alert.Description></Alert.Content>
  </Alert>
);

function ProtectedPreview({receipt, request, token}) {
  const {t} = useI18n();
  const [url, setUrl] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    if (!receipt?.preview_eligible) return;
    const controller = new AbortController();
    let ownedUrl;
    setUrl(''); setError('');
    request(receipt.preview_url, 'GET', undefined, controller.signal).then(response => response.blob()).then(blob => {
      if (!controller.signal.aborted) { ownedUrl = URL.createObjectURL(blob); setUrl(ownedUrl); }
    }).catch(reason => { if (!controller.signal.aborted && reason.name !== 'AbortError') setError(describeBioArtError(reason, 'preview', token, t)); });
    return () => { controller.abort(); if (ownedUrl) URL.revokeObjectURL(ownedUrl); };
    // t is left out on purpose: a language switch must not refetch the preview.
  }, [receipt, request, token]);
  if (!receipt?.preview_eligible) return <p className="ar-note">{t('bioart.preview.download_only')}</p>;
  if (error) return <Problem>{t('bioart.preview.failed', {error})}</Problem>;
  if (!url) return <p role="status" className="ar-note">{t('bioart.preview.loading')}</p>;
  return <img className="bp-panel max-h-80 max-w-full self-start" src={url} alt={t('bioart.preview.alt', {title: receipt.title})} />;
}

/** Format and variant pickers; a HeroUI Select each, with the service's keys as ids. Items
 * are plain text: a Label inside an item would be copied into the trigger with the field
 * label's id. */
function Choice({label, value, onChange, isDisabled, disabledKeys, items}) {
  return (
    <Select value={value} onChange={next => next != null && onChange(String(next))} isDisabled={isDisabled} disabledKeys={disabledKeys} fullWidth>
      <Label>{label}</Label>
      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
      <Select.Popover>
        <ListBox>
          {items.map(([id, text]) => (
            <ListBox.Item key={id} id={id} textValue={text}>
              {text}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function Consent({label, isSelected, onChange, isDisabled}) {
  return (
    <Checkbox isSelected={isSelected} onChange={onChange} isDisabled={isDisabled}>
      <Checkbox.Content>
        <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
        {label}
      </Checkbox.Content>
    </Checkbox>
  );
}

export default function BioArtWorkspace({token, setToken}) {
  const {t} = useI18n();
  const enter = useFirstEntry('bioart');
  const [query, setQuery] = useState('antibody'), [metadataEgress, setMetadataEgress] = useState(false), [fetchEgress, setFetchEgress] = useState(false);
  const [entryId, setEntryId] = useState('');
  const [hits, setHits] = useState(null), [entry, setEntry] = useState(null), [receipt, setReceipt] = useState(null), [imported, setImported] = useState(null);
  const [format, setFormat] = useState('SVG'), [representation, setRepresentation] = useState('auto');
  // scope = which action the busy line and the error belong to, so both render next to that action.
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [scope, setScope] = useState('metadata');
  // A rejected token is session state, shown once by the shared lock notice, not as an action error.
  const [authExpired, setAuthExpired] = useState(false);
  useEffect(() => { setAuthExpired(false); }, [token]);
  const request = useCallback((path, method = 'POST', body, signal) => apiFetch(path.startsWith('/api/') ? path : '/api/bioart' + path, {token, method, signal, headers: {'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined}), [token]);
  async function task(action, {consent = false, clearConsent, scope: where = 'action'} = {}) {
    if (clearConsent) clearConsent(false);
    setScope(where); setBusy(true); setError('');
    try { await action(consent); setAuthExpired(false); }
    catch (reason) { if (isAuthError(reason)) setAuthExpired(true); else setError(describeBioArtError(reason, where, token, t)); }
    finally { setBusy(false); }
  }
  const feedback = where => scope === where && <>
    {busy && <p role="status" className="ar-note">{t('bioart.busy')}</p>}
    {error && <Problem>{error}</Problem>}
  </>;
  async function search(consent) {
    const data = await (await request('/search', 'POST', {query, allow_egress: consent})).json();
    setHits(data.hits); setEntry(null); setReceipt(null); setImported(null); setFetchEgress(false);
  }
  async function inspect(entryId, consent) {
    const data = await (await request('/inspect', 'POST', {entry_id: entryId, allow_egress: consent})).json();
    setEntry(data); setFormat(formatOrder.find(candidate => data.representations.some(item => candidate in item.files)) || 'SVG'); setRepresentation('auto'); setReceipt(null); setImported(null); setFetchEgress(false);
  }
  async function fetchSource(consent) {
    const body = {entry_id: entry.entry_id, format, allow_egress: consent};
    if (representation !== 'auto') body.representation_id = Number(representation);
    setReceipt(await (await request('/fetch', 'POST', body)).json()); setImported(null);
  }
  async function importSource() {
    setImported(await (await request('/import', 'POST', {receipt_id: receipt.receipt_id})).json());
  }
  async function downloadSource() {
    const response = await request(receipt.download_url, 'GET');
    await downloadResponse(response, `bioart-${receipt.entry_id}.${receipt.format.toLowerCase()}`);
  }
  const lookup = id => task(consent => inspect(id, consent), {consent: metadataEgress, clearConsent: setMetadataEgress, scope: 'metadata'});
  const formats = useMemo(() => entry ? formatOrder.filter(candidate => entry.representations.some(item => candidate in item.files)) : [], [entry]);
  const validEntryId = /^[0-9]+$/.test(entryId.trim()) && Number.isSafeInteger(Number(entryId)) && Number(entryId) > 0;
  const nihSearchUrl = 'https://bioart.niaid.nih.gov/discover?' + new URLSearchParams({q: query.trim(), sort: 'relevance'});
  const resetFetch = () => { setReceipt(null); setImported(null); setFetchEgress(false); };

  return (
    <div className="flex min-w-0 flex-col gap-6" data-enter={enter} aria-busy={busy}>
      <PageHead kicker={t('bioart.kicker')} title={t('bioart.title')} lead={t('bioart.lead')} />

      <aside className="bp-block bp-block--primary ar-stack" aria-label={t('bioart.search.landmark')}>
        <h2>{t('bioart.search.heading')}</h2>
        <div className="ar-pair">
          <div className="ar-stack ar-stack--tight">
            <TextField value={query} onChange={setQuery} isDisabled={busy} fullWidth>
              <Label>{t('bioart.search.query')}</Label>
              <Input />
              <Description>{t('bioart.search.query_help')}</Description>
            </TextField>
            <div className="ar-row">
              <Button variant="primary" isDisabled={busy || !token || !query.trim()} onPress={() => task(search, {consent: metadataEgress, clearConsent: setMetadataEgress, scope: 'metadata'})}>
                <GravityIcon name="magnifier" />{t('bioart.search.submit')}
              </Button>
            </div>
          </div>
          <div className="ar-stack ar-stack--tight">
            <TextField value={entryId} onChange={setEntryId} isDisabled={busy} isInvalid={entryId.trim() !== '' && !validEntryId} validationBehavior="aria" fullWidth>
              <Label>{t('bioart.search.entry_id')}</Label>
              <Input inputMode="numeric" />
              <Description>{t('bioart.search.entry_id_help')}</Description>
            </TextField>
            <div className="ar-row">
              <Button variant="secondary" isDisabled={busy || !token || !validEntryId} onPress={() => lookup(Number(entryId))}>
                {t('bioart.search.inspect')}
              </Button>
            </div>
          </div>
        </div>
        <Consent label={t('bioart.search.consent')} isSelected={metadataEgress} onChange={setMetadataEgress} isDisabled={busy} />
        <LockNotice card={sessionState(token, authExpired)} tone={authExpired ? 'error' : 'info'} onUnlock={() => focusTokenField(token, setToken)} unlockLabel={unlockLabel(token, t)} />
        {feedback('metadata')}
        <p className="ar-note">
          {t('bioart.search.live')}{' '}
          <Link href={nihSearchUrl} target="_blank" rel="noreferrer">{t('bioart.search.open_nih')}<Link.Icon /></Link>
        </p>
        <Disclosure>
          <Disclosure.Heading>
            <Button slot="trigger" variant="ghost" size="sm">
              <GravityIcon name="circle-info" />{t('bioart.search.how')}<Disclosure.Indicator />
            </Button>
          </Disclosure.Heading>
          <Disclosure.Content>
            <Disclosure.Body className="ar-stack ar-stack--tight">
              <p>{t('bioart.search.how.cache')}</p>
              <p>{t('bioart.search.how.once')}</p>
              <p>{t('bioart.search.how.cached')}</p>
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
      </aside>

      <section className="ar-stack" aria-labelledby="bioart-results-heading">
        <h2 id="bioart-results-heading">{t('bioart.results.heading')}</h2>
        {hits === null ? <p className="ar-note">{t('bioart.results.none')}</p> : hits.length ? (
          <div className="ar-board">
            {hits.map(hit => (
              <Card key={hit.entry_id}>
                <Card.Header>
                  <Card.Title>{hit.title}</Card.Title>
                  <Card.Description>{entryLabel(hit.entry_id)}</Card.Description>
                </Card.Header>
                <Card.Footer>
                  <Button variant="secondary" size="sm" isDisabled={busy || !token} onPress={() => lookup(hit.entry_id)}
                    aria-label={t('bioart.results.inspect_named', {title: hit.title, id: entryLabel(hit.entry_id)})}>
                    {t('bioart.results.inspect')}<GravityIcon name="arrow-right" />
                  </Button>
                </Card.Footer>
              </Card>
            ))}
          </div>
        ) : <p>{t('bioart.results.empty')}</p>}
      </section>

      <section className="ar-stack" aria-label={t('bioart.entry.landmark')}>
        {!entry ? (
          <EmptyState className="bp-panel ar-stack ar-stack--tight">
            <GravityIcon name="picture" size={24} />
            <h2>{t('bioart.entry.empty')}</h2>
            <p className="ar-note">{t('bioart.entry.empty_hint')}</p>
          </EmptyState>
        ) : <>
          <Block className="ar-stack">
            <div className="ar-page-head">
              <div className="ar-stack ar-stack--tight">
                <Kicker>{entryLabel(entry.entry_id)}</Kicker>
                <h2>{entry.title}</h2>
                <Link href={entry.source_url} target="_blank" rel="noreferrer">{t('bioart.entry.source')}<Link.Icon /></Link>
              </div>
              <span className="ar-tag" data-tone={receipt ? 'accent' : undefined}>
                {receipt ? t('bioart.entry.verified', {format: receipt.format, variant: String(receipt.representation_id)}) : t('bioart.entry.not_fetched')}
              </span>
            </div>
            <Facts items={[
              [t('bioart.entry.license'), entry.license],
              [t('bioart.entry.credit'), entry.credit],
              [t('bioart.entry.creator'), entry.creator],
              [t('bioart.entry.collection'), entry.collection],
              [t('bioart.entry.citation'), entry.citation],
            ]} />
          </Block>

          <Block className="ar-stack" aria-labelledby="bioart-fetch-heading">
            <h2 id="bioart-fetch-heading">{t('bioart.fetch.heading')}</h2>
            <div className="ar-pair">
              <div className="ar-stack ar-stack--tight">
                <Choice label={t('bioart.fetch.format')} value={format} isDisabled={busy}
                  onChange={next => { setFormat(next); setRepresentation('auto'); resetFetch(); }}
                  items={formats.map(item => [item, item])} />
                {formats.length === 0 && <p className="ar-note">{t('bioart.fetch.no_files')}</p>}
              </div>
              <Choice label={t('bioart.fetch.variant')} value={representation} isDisabled={busy}
                onChange={next => { setRepresentation(next); resetFetch(); }}
                disabledKeys={entry.representations.filter(item => !(format in item.files)).map(item => String(item.group_id))}
                items={[
                  ['auto', t('bioart.fetch.auto', {format})],
                  ...entry.representations.map(item => [String(item.group_id), format in item.files ? item.caption : t('bioart.fetch.missing_format', {caption: item.caption, format})]),
                ]} />
            </div>
            <p className="ar-note">{t('bioart.fetch.auto_note')}</p>
            <Consent label={t('bioart.fetch.consent')} isSelected={fetchEgress} onChange={setFetchEgress} isDisabled={busy} />
            <div className="ar-row">
              <Button variant="secondary" isDisabled={busy || !formats.includes(format)} onPress={() => task(fetchSource, {consent: fetchEgress, clearConsent: setFetchEgress, scope: 'fetch'})}>
                <GravityIcon name="download" />{t('bioart.fetch.submit', {format})}
              </Button>
            </div>
            {feedback('fetch')}
            <h3 id="bioart-variants-heading">{t('bioart.variants.heading')}</h3>
            <div className="ar-table-scroll">
              <Table>
                <Table.ScrollContainer>
                  <Table.Content aria-labelledby="bioart-variants-heading">
                    <Table.Header>
                      <Table.Column isRowHeader>{t('bioart.variants.caption')}</Table.Column>
                      <Table.Column>{t('bioart.variants.variant')}</Table.Column>
                      <Table.Column>{t('bioart.variants.formats')}</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {entry.representations.map(item => (
                        <Table.Row key={item.group_id} id={String(item.group_id)}>
                          <Table.Cell>{item.caption}</Table.Cell>
                          <Table.Cell>{String(item.group_id)}</Table.Cell>
                          <Table.Cell>{Object.keys(item.files).join(', ')}</Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            </div>
          </Block>

          {receipt && (
            <Block className="ar-stack" aria-label={t('bioart.receipt.landmark')}>
              <div className="ar-stack ar-stack--tight">
                <h2 className="ar-row ar-row--tight"><GravityIcon name="shield-check" />{t('bioart.receipt.heading')}</h2>
                <p className="bp-meta">{t('bioart.receipt.line', {caption: receipt.caption, file: String(receipt.file_id), format: receipt.format})}</p>
              </div>
              <div className="ar-pair">
                <ProtectedPreview receipt={receipt} request={request} token={token} />
                <Facts items={[
                  [t('bioart.receipt.sha'), <code>{receipt.sha256}</code>],
                  [t('bioart.receipt.page_sha'), <code>{receipt.source_page_sha256}</code>],
                  [t('bioart.receipt.size'), t('bioart.receipt.bytes', {count: receipt.size})],
                  [t('bioart.receipt.id'), <code>{receipt.receipt_id}</code>],
                ]} />
              </div>
              <div className="ar-stack ar-stack--tight">
                <p className="ar-note">{t('bioart.receipt.rights')}</p>
                <p className="ar-note">{t('bioart.receipt.rights_review')}</p>
                <p className="ar-note">{t('bioart.receipt.validity')}</p>
              </div>
              <div className="ar-row">
                <Button variant="secondary" isDisabled={busy} onPress={() => task(downloadSource)}>
                  <GravityIcon name="download" />{t('bioart.receipt.download')}
                </Button>
                <Button variant="secondary" isDisabled={busy || !receipt.import_eligible} onPress={() => task(importSource)}>
                  <GravityIcon name="upload" />{receipt.import_eligible ? t('bioart.receipt.import') : t('bioart.receipt.import_unavailable', {format: receipt.format})}
                </Button>
              </div>
              {(receipt.limitation || !receipt.import_eligible) && (
                <p className="ar-note">{receipt.limitation || t(receipt.format === 'SVG' ? 'bioart.receipt.svg_blocked' : 'bioart.receipt.svg_only')}</p>
              )}
              {feedback('action')}
              {imported && (
                <div className="ar-stack ar-stack--tight" role="status">
                  <strong>{t('bioart.receipt.imported', {id: imported.asset_id})}</strong>
                  <p>{t('bioart.receipt.manifest')} <code>{imported.asset_manifest}</code></p>
                </div>
              )}
            </Block>
          )}
        </>}
      </section>
    </div>
  );
}
