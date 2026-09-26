import React, {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react/button';
import {Checkbox} from '@heroui/react/checkbox';
import {Description} from '@heroui/react/description';
import {Disclosure} from '@heroui/react/disclosure';
import {EmptyState} from '@heroui/react/empty-state';
import {Fieldset} from '@heroui/react/fieldset';
import {Input} from '@heroui/react/input';
import {Label} from '@heroui/react/label';
import {Popover} from '@heroui/react/popover';
import {Table} from '@heroui/react/table';
import {TextArea} from '@heroui/react/textarea';
import {TextField} from '@heroui/react/textfield';
import {apiFetch, sessionLine, sessionState} from './http';
import {LockNotice, focusTokenField, unlockLabel} from './LockNotice';
import {useI18n} from './i18n/index.jsx';
import {GravityIcon} from './theme/gravity-icons.jsx';
import {Block, Facts, Kicker, PageHead, useFirstEntry} from './ui.jsx';

// Prose control: a rule-based local rewrite that never touches scientific content, and
// third-party AI-detection that needs consent on every request because the text leaves
// this machine. Nothing here is an authorship or validity claim, and neither result has
// any bearing on a release decision.

// Each action reports under its own group: what is running, or what failed and why.
// Its name and running line are prose.action.<id>.name / .doing.
const GROUP = {rewrite: 'local', diagnose: 'local', rules: 'local', seat: 'seat', behaviour: 'seat', detect: 'detect'};
const MAX_CHARS = 20000;
const LEGEND = 'text-[18px] leading-6 font-semibold';

function failure(t, name, e) {
  if (e instanceof TypeError) return t('prose.failed.offline', {name, reason: sessionLine('offline', t)});
  const m = /^Request failed \((\d+)\)(?:: (.*))?$/s.exec(e.message);
  if (!m) return t('prose.failed.detail', {name, detail: e.message});
  let detail = m[2] || '';
  // The prose service answers {code, detail, spans}; http.js stringifies it, so unwrap the sentence.
  if (detail.startsWith('{')) { try { detail = JSON.parse(detail).detail || detail; } catch { /* keep the raw text */ } }
  return detail ? t('prose.failed.detail', {name, detail}) : t('prose.failed.http', {name, status: m[1]});
}

/** A short explanation behind an info button, for text too long to sit under a control. */
function About({label, heading, text}) {
  // The Button is the trigger itself: Popover.Trigger would wrap it in a second role="button".
  return <Popover>
    <Button variant="ghost" size="sm" isIconOnly aria-label={label}><GravityIcon name="circle-info"/></Button>
    <Popover.Content>
      <Popover.Dialog>
        <Popover.Heading>{heading}</Popover.Heading>
        <p>{text}</p>
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}

function Consent({isSelected, isDisabled, onChange, children}) {
  const {t} = useI18n();
  return <Checkbox isSelected={isSelected} isDisabled={isDisabled} onChange={onChange}>
    <Checkbox.Content><Checkbox.Control><Checkbox.Indicator/></Checkbox.Control>{children}</Checkbox.Content>
    <Description>{t('prose.consent.clears')}</Description>
  </Checkbox>;
}

/** Service text as it arrived, line breaks kept. */
function Output({kind, children}) {
  const {t} = useI18n();
  return <div className="ar-stack ar-stack--tight">
    <Kicker>{t('prose.output')}</Kicker>
    <div className="whitespace-pre-wrap" data-output={kind}>{children}</div>
  </div>;
}

function StaleNote({children}) { return <p role="status" className="ar-tag" data-tone="warning">{children}</p>; }

function Grid({label, columns, rows}) {
  return <div className="ar-table-scroll">
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={label}>
          <Table.Header>
            {columns.map((column, index) => <Table.Column key={column} isRowHeader={index === 0}>{column}</Table.Column>)}
          </Table.Header>
          <Table.Body>
            {rows.map(([id, ...cells]) => <Table.Row key={id} id={id}>
              {cells.map((cell, index) => <Table.Cell key={index}>{cell}</Table.Cell>)}
            </Table.Row>)}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  </div>;
}

export default function ProseWorkspace({token, setToken}) {
  const {t, n} = useI18n();
  const enter = useFirstEntry('prose');
  const [text, setText] = useState(''), [rules, setRules] = useState(null);
  const [rewritten, setRewritten] = useState(null), [receipt, setReceipt] = useState(null);
  const [consent, setConsent] = useState(false), [error, setError] = useState(null), [busy, setBusy] = useState(null);
  // Humane prose: local diagnostics (nothing leaves), and a rewrite by the operator's own
  // prose seat under the behaviour text, with its own consent because the text leaves.
  const [diagnosis, setDiagnosis] = useState(null), [humane, setHumane] = useState(null), [seatConsent, setSeatConsent] = useState(false);
  const [instructions, setInstructions] = useState(''), [behaviour, setBehaviour] = useState(null), [authExpired, setAuthExpired] = useState(false);
  const credential = useRef(null);
  useLayoutEffect(() => {
    const controller = new AbortController(); credential.current = controller;
    setText(''); setRules(null); setRewritten(null); setReceipt(null); setConsent(false); setError(null); setBusy(null); setAuthExpired(false);
    setDiagnosis(null); setHumane(null); setSeatConsent(false); setInstructions(''); setBehaviour(null);
    return () => controller.abort();
  }, [token]);
  const read = useCallback(async (path, signal, method = 'GET', body) => {
    signal.throwIfAborted();
    const response = await apiFetch('/api/prose' + path, {
      token, method, signal, headers: {'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    signal.throwIfAborted();
    return data;
  }, [token]);
  async function task(action, id, vars) {
    const signal = credential.current.signal;
    setBusy({id, group: GROUP[id], vars}); setError(null);
    try { await action(signal); }
    catch (e) {
      if (signal.aborted) return;
      // A rejected token is one card in the error tone, not a card plus an alert.
      if (/Request failed \((401|403)\)/.test(e.message)) { setAuthExpired(true); return; }
      setError({group: GROUP[id], text: failure(t, t(`prose.action.${id}.name`), e)});
    }
    finally { if (!signal.aborted) setBusy(null); }
  }
  async function loadRules(signal) { setRules(await read('/rules', signal)); }
  async function rewrite(signal) { setRewritten({...await read('/rewrite', signal, 'POST', {text}), source: text}); }
  async function detect(signal) {
    // Consent is spent on this one request, whatever its outcome; the next one asks again.
    const granted = consent; setConsent(false);
    setReceipt({...await read('/detect', signal, 'POST', {text, allow_egress: granted}), source: text});
  }
  async function diagnose(signal) { setDiagnosis({...await read('/diagnose', signal, 'POST', {text}), source: text}); }
  async function humanise(signal) {
    const granted = seatConsent; setSeatConsent(false);
    setHumane({...await read('/humanise', signal, 'POST', {text, allow_egress: granted, instructions}), source: text, source_instructions: instructions});
  }
  async function loadBehaviour(signal) { setBehaviour(behaviour ? null : await read('/behaviour', signal)); }
  // A result is shown for the text it came from; once the text changes it is stale and says so.
  const stale = result => result && result.source !== text;
  const diagnosisStale = stale(diagnosis), rewrittenStale = stale(rewritten), receiptStale = stale(receipt);
  const humaneStale = humane && (humane.source !== text || humane.source_instructions !== instructions);
  const detection = rules?.detection, minChars = detection?.bounds?.min_chars ?? 20;
  const feedback = group => busy?.group === group ? <p role="status" className="ar-tag" data-tone="accent">{t(`prose.action.${busy.id}.doing`, busy.vars)}</p>
    : error?.group === group ? <p role="alert" className="ar-tag" data-tone="danger">{error.text}</p> : null;
  const quote = value => t('prose.quote', {text: value});
  const none = t('common.none');
  // Entering a token clears this workspace's text, so the lock card makes no draft promise.
  const card = sessionState(token, authExpired, {draft: false});
  const empty = !rewritten && !diagnosis && !humane && !behaviour && !receipt && !rules;

  return <div className="ar-stack" data-enter={enter}>
    <PageHead kicker={t('prose.kicker')} title={t('prose.title')} lead={t('prose.lead')}>
      <Popover>
        <Button variant="ghost" size="sm"><GravityIcon name="shield-check"/>{t('prose.protected.trigger')}</Button>
        <Popover.Content>
          <Popover.Dialog>
            <Popover.Heading>{t('prose.protected.heading')}</Popover.Heading>
            <p>{t('prose.protected.text')}</p>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </PageHead>
    <div className="ar-pair items-start">
      <div className="ar-stack">
        <Block className="ar-stack">
          <TextField value={text} onChange={setText} isDisabled={!!busy} maxLength={MAX_CHARS}>
            <Label>{t('prose.text.label')}</Label>
            <TextArea rows={10}/>
          </TextField>
          <p className="ar-note">{t('prose.text.count', {length: text.length, max: MAX_CHARS})}</p>
          <div className="ar-row">
            <Button isDisabled={!!busy || !token || !text.trim()} onPress={() => task(rewrite, 'rewrite')}>{t('prose.local.rewrite')}</Button>
            <Button variant="secondary" isDisabled={!!busy || !token || !text.trim()} onPress={() => task(diagnose, 'diagnose')}>{t('prose.local.diagnose')}</Button>
            <Button variant="secondary" isDisabled={!!busy || !token} onPress={() => task(loadRules, 'rules')}>{t(rules ? 'prose.local.reload' : 'prose.local.rules')}</Button>
          </div>
          {!token && <p className="ar-note">{t('prose.local.token')}</p>}
          <LockNotice card={card} tone={authExpired ? 'error' : 'info'} onUnlock={() => focusTokenField(token, setToken)} unlockLabel={unlockLabel(token, t)}/>
          {rules && <p className="ar-note">{t('prose.local.rules_loaded')}</p>}
          {feedback('local')}
        </Block>

        <Block>
          <Fieldset className="gap-4">
            <Fieldset.Legend className={LEGEND}>{t('prose.seat.legend')}</Fieldset.Legend>
            <div className="ar-row ar-row--tight justify-between">
              <p className="ar-note">{t('prose.seat.note')}</p>
              <About label={t('prose.seat.about')} heading={t('prose.seat.about')} text={t('prose.seat.about_text')}/>
            </div>
            <TextField value={instructions} onChange={setInstructions} isDisabled={!!busy} maxLength={2000}>
              <Label>{t('prose.seat.instructions')}</Label>
              <Input placeholder={t('prose.seat.placeholder')}/>
            </TextField>
            <Consent isSelected={seatConsent} isDisabled={!!busy} onChange={setSeatConsent}>{t('prose.seat.consent')}</Consent>
            <p className="ar-note">{t('prose.seat.refusal')}</p>
            <div className="ar-row">
              <Button variant="secondary" isDisabled={!!busy || !token || !seatConsent || !text.trim()} onPress={() => task(humanise, 'seat')}>{t('prose.seat.send')}</Button>
              <Button variant="ghost" size="sm" isDisabled={!!busy || !token} onPress={() => task(loadBehaviour, 'behaviour')}>{t(behaviour ? 'prose.seat.hide' : 'prose.seat.show')}</Button>
            </div>
            {feedback('seat')}
          </Fieldset>
        </Block>

        <Block>
          <Fieldset className="gap-4">
            <Fieldset.Legend className={LEGEND}>{t('prose.detect.legend')}</Fieldset.Legend>
            <p className="ar-note">{detection
              ? (detection.enabled
                ? t('prose.detect.sends', {recipient: detection.recipient, detectors: detection.detectors.join(', '), min: detection.bounds.min_chars, max: detection.bounds.max_chars})
                : t('prose.detect.off'))
              : t('prose.detect.load_first')}</p>
            {detection?.enabled && <p className="ar-note">{t('prose.detect.unlocks', {min: minChars})}</p>}
            <Consent isSelected={consent} isDisabled={!!busy || !detection?.enabled} onChange={setConsent}>
              {t('prose.detect.consent', {recipient: detection?.recipient || 'api.edgeshop.ai'})}
            </Consent>
            <div className="ar-row">
              <Button variant="secondary" isDisabled={!!busy || !token || !consent || text.trim().length < minChars}
                onPress={() => task(detect, 'detect', {recipient: detection.recipient})}>{t('prose.detect.send')}</Button>
            </div>
            {feedback('detect')}
          </Fieldset>
        </Block>
      </div>

      <section className="ar-stack" aria-label={t('prose.results')}>
        {empty && <EmptyState className="bp-panel">{t('prose.results.empty')}</EmptyState>}

        {rewritten && <Block className="ar-stack" data-status={rewritten.status} data-stale={String(!!rewrittenStale)}>
          <h2>{t('prose.rewrite.heading')}</h2>
          {rewrittenStale && <StaleNote>{t('prose.rewrite.stale')}</StaleNote>}
          <h3>{[
            rewritten.status === 'edited' ? t('prose.rewrite.edits', {count: rewritten.edits.reduce((sum, e) => sum + e.count, 0)}) : t('prose.rewrite.no_change'),
            rewritten.reason ? rewritten.reason.replace(/_/g, ' ') : null,
            t('prose.rewrite.protected', {count: rewritten.protected_count, classes: rewritten.protected_classes.join(', ') || none}),
          ].filter(Boolean).join(', ')}</h3>
          <Output kind="local">{rewritten.text}</Output>
          {rewritten.edits.length > 0 && <Grid label={t('prose.edits.label')}
            columns={[t('prose.edits.rule'), t('prose.edits.count'), t('prose.edits.before'), t('prose.edits.after')]}
            rows={rewritten.edits.map(e => [e.rule, <code>{e.rule}</code>, n(e.count), quote(e.before), e.after ? quote(e.after) : t('prose.edits.removed')])}/>}
          <p className="ar-note">{rewritten.statement} {t('prose.rewrite.versions', {rules: rewritten.rules_version, protection: rewritten.protection_version})}</p>
        </Block>}

        {diagnosis && <Block className="ar-stack" aria-label={t('prose.diagnosis.label')} data-stale={String(!!diagnosisStale)}>
          <h2>{t('prose.diagnosis.heading')}</h2>
          {diagnosisStale && <StaleNote>{t('prose.diagnosis.stale')}</StaleNote>}
          <div className="ar-stack ar-stack--tight">
            <Kicker>{t('prose.diagnosis.categories')}</Kicker>
            {diagnosis.edit_categories.length
              ? <ul className="list-disc ps-5">{diagnosis.edit_categories.map(category => <li key={category}>{category}</li>)}</ul>
              : <p>{t('prose.diagnosis.no_category')}</p>}
          </div>
          <Facts items={[
            [t('prose.diagnosis.protected'), n(diagnosis.protected_count)],
            [t('prose.diagnosis.style_words'), (() => {
              const style = diagnosis.observations.style_words;
              const list = Object.entries(style.words).map(([word, count]) => word + (count > 1 ? ' ×' + n(count) : '')).join(', ');
              return t('prose.diagnosis.style_words_value', {count: style.count, rate: style.per_1000_words}) + (list ? ': ' + list : '');
            })()],
            [t('prose.diagnosis.frames'), diagnosis.observations.formulaic_frames.count
              ? <ul className="ar-stack ar-stack--tight">{diagnosis.observations.formulaic_frames.instances.map((frame, index) =>
                <li key={index}>{t('prose.diagnosis.frame', {label: frame.label, text: quote(frame.text.trim())})}</li>)}</ul>
              : none],
            [t('prose.diagnosis.sentence_length'), t('prose.diagnosis.sentences', {
              count: diagnosis.observations.sentence_length.sentences,
              mean: diagnosis.observations.sentence_length.mean_words,
              spread: diagnosis.observations.sentence_length.spread_words,
              share: n(diagnosis.observations.sentence_length.share_within_20pct_of_mean, {style: 'percent', maximumFractionDigits: 0}),
            })],
            [t('prose.diagnosis.openings'), Object.keys(diagnosis.observations.repeated_openings.openings).length
              ? Object.entries(diagnosis.observations.repeated_openings.openings).map(([opening, count]) => quote(opening) + ' ×' + n(count)).join(', ')
              : none],
            [t('prose.diagnosis.triplets'), n(diagnosis.observations.triplets.count)],
            [t('prose.diagnosis.closing'), t('prose.diagnosis.of', {count: diagnosis.observations.closing_summaries.count, total: diagnosis.observations.closing_summaries.paragraphs})],
            [t('prose.diagnosis.bullets'), n(diagnosis.observations.bullets.count)],
          ]}/>
          <p className="ar-note">{diagnosis.note}</p>
        </Block>}

        {humane && <Block className="ar-stack" data-status={humane.status} data-stale={String(!!humaneStale)}>
          <h2>{t('prose.seat.legend')}</h2>
          {humaneStale && <StaleNote>{t('prose.seat.stale')}</StaleNote>}
          <h3>{t(humane.status === 'edited' ? 'prose.seat.edited' : 'prose.seat.unchanged', {count: humane.protected_count})}</h3>
          <Output kind="seat">{humane.text}</Output>
          {humane.notes.length > 0 && <ul className="list-disc ps-5">{humane.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>}
          {humane.facts_needed.length > 0 && <p className="ar-note">{t('prose.seat.facts_needed', {facts: humane.facts_needed.join('; ')})}</p>}
          {(humane.transport || humane.instruction_channel === 'prompt') && <p className="ar-note">{[
            humane.transport && t(humane.transport.observed_model ? 'prose.seat.model_confirmed' : 'prose.seat.model_unreported', {
              provider: humane.transport.provider, model: humane.transport.requested_model, observed: humane.transport.observed_model,
            }),
            humane.instruction_channel === 'prompt' && t('prose.seat.prompt_channel'),
          ].filter(Boolean).join(' ')}</p>}
          <p className="ar-note">{humane.statement}</p>
        </Block>}

        {behaviour && <Block className="ar-stack">
          <h2>{t('prose.behaviour.heading', {version: behaviour.version})}</h2>
          <pre className="ar-code">{behaviour.text}</pre>
        </Block>}

        {receipt && <Block className="ar-stack" data-complete={String(receipt.complete)} data-stale={String(!!receiptStale)}>
          <h2>{t('prose.receipt.heading')}</h2>
          {receiptStale && <StaleNote>{t('prose.receipt.stale')}</StaleNote>}
          <Facts items={[
            [t('prose.receipt.service'), receipt.service],
            [t('prose.receipt.answered'), receipt.returned_types.join(', ') || t('prose.receipt.none_answered')],
            receipt.missing_types.length ? [t('prose.receipt.missing'), receipt.missing_types.join(', ')] : null,
            ...Object.entries(receipt.results).map(([type, result]) => [type, Object.entries(result).map(([k, v]) => `${k}: ${v}`).join(', ') || '—']),
            [t('prose.receipt.text_sha'), <code className="break-all">{receipt.text_sha256}</code>],
            [t('prose.receipt.response_sha'), <code className="break-all">{receipt.response_sha256}</code>],
          ]}/>
          <p className="ar-note">{receipt.note}</p>
        </Block>}

        {rules && <Block>
          <Disclosure>
            <Disclosure.Heading>
              <Button slot="trigger" variant="ghost">{t('prose.rules.heading', {rules: rules.rules.length, classes: rules.protected_classes.length})}<Disclosure.Indicator/></Button>
            </Disclosure.Heading>
            <Disclosure.Content>
              <Disclosure.Body className="ar-stack">
                <Grid label={t('prose.rules.label')}
                  columns={[t('prose.rules.rule'), t('prose.rules.pattern'), t('prose.rules.replacement')]}
                  rows={rules.rules.map(r => [r.rule, <code>{r.rule}</code>, <code className="break-all">{r.pattern}</code>, r.replacement ? quote(r.replacement) : t('prose.edits.removed')])}/>
                <p className="ar-note">{t('prose.rules.protected', {classes: rules.protected_classes.join(', ')})}</p>
              </Disclosure.Body>
            </Disclosure.Content>
          </Disclosure>
        </Block>}
      </section>
    </div>
  </div>;
}
