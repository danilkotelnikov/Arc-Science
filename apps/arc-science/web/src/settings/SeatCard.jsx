import React, {memo} from 'react';
import {Button} from '@heroui/react/button';
import {Chip} from '@heroui/react/chip';
import {Link} from '@heroui/react/link';
import {useI18n} from '../i18n/index.jsx';
import {loginLine, probeLine, stateLabel, stateOf} from '../readiness';
import {Status} from '../ui.jsx';
import {CheckField, More, SelectField, TextInput} from './controls.jsx';
import {CLI_TOOL, CREDENTIAL_NAME, PROVIDER_NAMES, STORES, authLabel, effortName, effortSupport, modelEntry, providerLabel, roleLabel, signInModes, supportWord} from './model.js';

// Select keys for the two values a select cannot hold as themselves: no provider, and
// "a model id typed by hand".
const NONE = '__none__';
const CUSTOM = '__custom__';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One seat: the five controls, the server's readiness for the saved seat, and the
// draft-versus-saved difference as its own chip (never as a readiness state). Every
// callback goes through `act(kind, role, ...)`, which keeps one identity, so a card renders
// again only when its own seat, readiness or request state changes.
export const SeatCard = memo(function SeatCard({role, seat, saved, node, readinessError, catalog, catalogLoaded, readOnly, custom, profile = null, ipc, busy, consent, waiting, confirming, error, act}) {
  const i18n = useI18n();
  const {t} = i18n;
  const label = roleLabel(t, role);
  const aria = key => t('settings.aria.' + key, {role: label});
  const set = (key, value) => act('set', role, key, value);
  const setCustom = on => act('custom', role, on);
  const state = stateOf(node);
  const unsaved = !same(seat, saved);
  const entry = modelEntry(catalog, seat);
  const models = catalog.providers?.[seat.provider]?.models || [];
  const isCustom = custom || (seat.model !== '' && !entry);
  const support = effortSupport(catalog, seat, t);
  const modes = signInModes(catalog, seat.provider, t);
  const allModes = catalog.auth_modes?.[seat.provider] || [];
  const source = catalog.providers?.[seat.provider]?.source;
  const caps = entry?.capabilities || {};
  const meaning = node?.meaning || readinessError || (catalogLoaded ? t('settings.seat.no_readiness') : t('settings.readiness.not_loaded'));
  // What `ant auth status` reported (readiness carries it per provider and on Anthropic seats); never used for a call.
  const ant = profile || node?.facts?.console_profile || null;
  const modeSupport = mode => mode.mode !== 'console_profile' ? supportWord(t, mode.support)
    : ant?.detected ? t('settings.signin.ant_detected', {profile: ant.profile || t('settings.signin.unnamed')}) : t('settings.signin.ant_missing');
  const providers = [[NONE, t('settings.provider.none')], ...PROVIDER_NAMES.map(name => [name, providerLabel(catalog, name, t)]),
    ...(seat.provider && !PROVIDER_NAMES.includes(seat.provider) ? [[seat.provider, seat.provider]] : [])];
  const efforts = [...(support.allowed.includes(seat.effort) ? [] : [[seat.effort, t('settings.effort.not_accepted', {effort: effortName(t, seat.effort)})]]),
    ...support.allowed.map(effort => [effort, effortName(t, effort)])];
  const signIns = [...(modes.some(([value]) => value === seat.auth) ? [] : [[seat.auth, t('settings.signin.unsupported', {label: authLabel(catalog, seat.provider, seat.auth, t)})]]), ...modes];
  const facts = entry && [
    t('settings.model.in_catalog', {version: catalog.catalog_version}),
    caps.context_tokens ? t('settings.model.context', {tokens: Number(caps.context_tokens)}) : t('settings.model.context_unknown'),
    t('settings.model.vision', {answer: t(caps.vision ? 'common.yes' : 'common.no')}),
    caps.thinking ? t('settings.model.thinking', {mode: caps.thinking}) : t('settings.model.thinking_unknown'),
  ].join(', ');
  return (
    <article className="bp-panel ar-stack" aria-label={t('settings.seat.label', {role: label})} data-state={state}>
      <div className="ar-stack ar-stack--tight">
        <div className="ar-row">
          <h3>{label}</h3>
          <Status state={state}>{stateLabel(state, i18n)}</Status>
          {unsaved ? <Chip size="sm" color="accent">{t('settings.seat.unsaved')}</Chip> : null}
        </div>
        <p className="ar-note">{t('settings.role.' + role + '.note')}</p>
      </div>
      <div className="ar-board">
        <SelectField label={t('settings.field.provider')} ariaLabel={aria('provider')} value={seat.provider || NONE} options={providers} isDisabled={readOnly}
          onChange={value => set('provider', value === NONE ? '' : value)} />
        <div className="ar-stack ar-stack--tight">
          <SelectField label={t('settings.field.model')} ariaLabel={aria('model')} value={isCustom ? CUSTOM : seat.model || null} placeholder={t('settings.model.choose')}
            options={[...models.map(model => [model.id, model.label + ' (' + model.id + ')']), [CUSTOM, t('settings.model.custom')]]} isDisabled={readOnly}
            onChange={value => { if (value === CUSTOM) setCustom(true); else { setCustom(false); set('model', value); } }} />
          {isCustom ? <TextInput ariaLabel={aria('custom_model')} value={seat.model} isDisabled={readOnly} placeholder={t('settings.model.placeholder')} onChange={value => set('model', value)} /> : null}
          {seat.provider && !catalogLoaded ? <p className="ar-note">{t('settings.model.unchecked')}</p> : null}
          {entry ? <p className="ar-note">{facts}{source ? <>, <Link href={source} target="_blank" rel="noreferrer">{t('settings.model.source')}</Link></> : null}</p> : null}
          {catalogLoaded && !entry && seat.model ? <p className="ar-note">{t('settings.model.custom_note')}</p> : null}
        </div>
        <div className="ar-stack ar-stack--tight">
          <SelectField label={t('settings.field.effort')} ariaLabel={aria('effort')} value={seat.effort} options={efforts} isDisabled={readOnly || support.disabled}
            isInvalid={support.invalid && !support.transport} onChange={value => set('effort', value)} />
          {seat.provider && support.note && !support.transport ? <p className="ar-note">{support.note}</p> : null}
        </div>
        <div className="ar-stack ar-stack--tight">
          <SelectField label={t('settings.field.signin')} ariaLabel={aria('signin')} value={seat.auth} options={signIns} isDisabled={readOnly}
            isInvalid={Boolean(support.transport)} onChange={value => set('auth', value)} />
          {support.transport ? <p className="ar-note">{support.note}</p> : null}
        </div>
        <TextInput label={t('settings.field.credential')} ariaLabel={aria('credential')} value={seat.credential} isDisabled={readOnly || seat.auth !== 'api_key'}
          placeholder={seat.auth === 'api_key' ? t('settings.credential.placeholder') : t('settings.credential.cli_placeholder')} onChange={value => set('credential', value)} />
      </div>
      <div className="ar-stack ar-stack--tight">
        <p>{meaning}</p>
        {node?.next_action && state !== 'ready' ? <p>{t('settings.next', {action: node.next_action})}</p> : null}
        {unsaved ? <p className="ar-note">{t('settings.seat.draft_note')}</p> : null}
      </div>
      {seat.provider ? (
        <SeatAccess role={role} seat={seat} saved={saved} node={node} catalog={catalog} ipc={ipc} busy={busy} readOnly={readOnly} consent={consent} waiting={waiting}
          confirming={confirming} error={error} act={act} />
      ) : null}
      {allModes.length > 0 ? (
        <More title={t('settings.signin.methods')}>
          <ul>
            {allModes.map(mode => (
              <li key={mode.mode}>
                {mode.label}: {modeSupport(mode)}
                {mode.source ? <>, <Link href={mode.source} target="_blank" rel="noreferrer">{t('settings.signin.basis')}</Link></> : null}
              </li>
            ))}
          </ul>
        </More>
      ) : null}
    </article>
  );
});

// Under a seat card: for an API credential, where the key goes (the host's prompt in the
// desktop window, a terminal elsewhere) and Remove; for a CLI login, the login as read and
// Re-check; for both, the consented Test seat and the last probe from readiness.
function SeatAccess({role, seat, saved, node, catalog, ipc, busy, readOnly, consent, waiting, confirming, error, act}) {
  const i18n = useI18n();
  const {t} = i18n;
  const aria = key => t('settings.aria.' + key, {role: roleLabel(t, role)});
  const provider = providerLabel(catalog, seat.provider, t);
  const facts = node?.facts || {};
  const named = CREDENTIAL_NAME.test(seat.credential || '');
  const asFile = facts.credential_store === 'file';
  const testBlocker = !same(seat, saved) ? t('settings.access.save_first_test') : !saved.provider ? t('settings.access.save_first') : !consent ? t('settings.access.tick') : '';
  const command = `arc-science credential --name ${seat.credential || t('settings.access.terminal_name')} --data ${t('settings.access.terminal_dir')}`;
  return (
    <div className="ar-stack ar-stack--tight" role="group" aria-label={aria('access')}>
      {seat.auth === 'cli' ? (
        <div className="ar-row">
          <p><strong>{loginLine(node, i18n) || t('settings.access.login_unknown')}.</strong> {t('settings.access.cli_hint', {tool: CLI_TOOL[seat.provider] || t('settings.access.the_cli')})}</p>
          <Button variant="secondary" size="sm" aria-label={aria('recheck')} isDisabled={busy} onPress={() => act('recheck', role)}>{t('settings.access.recheck')}</Button>
        </div>
      ) : (
        <>
          {facts.credential_store ? <p className="ar-note">{t('settings.access.stored', {ref: facts.credential_ref, store: STORES.includes(facts.credential_store) ? t('settings.store.' + facts.credential_store) : facts.credential_store})}</p> : null}
          {ipc ? (
            <>
              {waiting ? (
                <div className="ar-row">
                  <p role="status">{t('settings.access.waiting')}</p>
                  <Button variant="ghost" size="sm" onPress={() => act('cancelWait', role)}>{t('settings.access.cancel_wait')}</Button>
                </div>
              ) : confirming ? (
                <div className="ar-row" role="group" aria-label={aria('remove_confirm')}>
                  <p>{t('settings.access.remove_question', {name: seat.credential})}</p>
                  <Button variant="danger" size="sm" aria-label={aria('confirm_remove')} isDisabled={busy} onPress={() => act('remove', role)}>{t('settings.access.remove_yes')}</Button>
                  <Button variant="ghost" size="sm" onPress={() => act('confirm', role, false)}>{t('settings.keep')}</Button>
                </div>
              ) : (
                <div className="ar-row">
                  <Button variant="secondary" size="sm" aria-label={aria('store')} isDisabled={busy || readOnly || !named} onPress={() => act('store', role)}>{t('settings.access.store')}</Button>
                  <Button variant="ghost" size="sm" aria-label={aria('remove')} isDisabled={busy || readOnly || !named || asFile} onPress={() => act('confirm', role, true)}>{t('settings.access.remove')}</Button>
                </div>
              )}
              {!named ? <p className="ar-note">{t('settings.access.name_first')}</p> : null}
              {asFile ? <p className="ar-note">{t('settings.access.file_note')}</p> : null}
            </>
          ) : <p className="ar-note">{t('settings.access.terminal')} <code>{command}</code></p>}
        </>
      )}
      <div className="ar-row">
        <CheckField ariaLabel={aria('consent')} isSelected={consent} isDisabled={busy} onChange={on => act('consent', role, on)}>{t('settings.access.consent', {provider})}</CheckField>
        <Button variant="secondary" size="sm" aria-label={aria('test')} isDisabled={busy || Boolean(testBlocker)} onPress={() => act('test', role)}>{t('settings.access.test')}</Button>
      </div>
      {testBlocker ? <p className="ar-note">{testBlocker}</p> : null}
      <p className="ar-note">{probeLine(node, i18n)}</p>
      {error}
    </div>
  );
}
