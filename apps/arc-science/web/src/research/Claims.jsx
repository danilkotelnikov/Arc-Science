import React from 'react';
import {useI18n} from '../i18n/index.jsx';
import {releaseWord} from '../readiness';
import {CLAIM_TONE, Heading, MetaRow, Problem, STAMP, Tag, roleName, term} from './common.jsx';

// Requested claim -> evidence-supported scope -> remaining uncertainty -> next discriminating
// test, derived from the reconciliation at the stop. A narrower conclusion is a valid research
// output and nothing here is validation. The cards come from GET /claims; when that read fails,
// the persisted claim scope is shown as it is.

// The Observation.data fields a claim card reads out; the service copies them verbatim (claims.py NUMERIC_FIELDS).
const NUMERIC_LINES = [['validation_mse', 'research.claim.validation_mse'], ['mean_shuffled_validation_mse', 'research.claim.shuffled_mse'], ['n', 'research.claim.n']];

const Row = ({label, children}) => <div><dt>{label}</dt><dd>{children}</dd></div>;

const identityWord = (t, value) => t(value === true ? 'research.identity.verified' : value === false ? 'research.identity.unverified' : 'research.identity.unrecorded');

function ClaimHead({id, status}) {
  const {t} = useI18n();
  return <div className="ar-row justify-between"><h3>{id}</h3><Tag tone={CLAIM_TONE[status]}>{term(t, 'claim', status)}</Tag></div>;
}

// The rows every card shows, in this order; the scope, uncertainty and next-test rows read the same in the persisted view.
function Scope({supported_scope, scope_qualifier}) {
  const {t} = useI18n();
  if (!supported_scope.length) return <span className="ar-note">{t('research.claim.no_scope')}</span>;
  return <>{supported_scope.map((line, i) => <p key={i}>{line}</p>)}<p className="ar-note">{t('research.claim.qualifier', {qualifier: scope_qualifier})}</p></>;
}

function Uncertainty({uncertainties}) {
  const {t} = useI18n();
  if (!uncertainties.length) return <span className="ar-note">{t('research.claim.no_uncertainty')}</span>;
  return <ul>{uncertainties.map((u, i) => (
    <li key={i} data-reason={u.reason}>{term(t, 'reason', u.reason)}{u.role ? ' (' + roleName(t, u.role) + ')' : ''}: {u.detail}</li>
  ))}</ul>;
}

function NextTests({next_tests}) {
  const {t} = useI18n();
  if (!next_tests.length) return <span className="ar-note">{t('research.claim.no_next_test')}</span>;
  return <ul>{next_tests.map((test, i) => <li key={i}>{roleName(t, test.role)}: {test.test}</li>)}</ul>;
}

function ClaimCard({claim, derivationVersion}) {
  // Every field is the service's derivation from persisted records (GET /claims, source 'derived'):
  // the status is the persisted claim scope's, never a model's own word; times come from the
  // operational timeline or are stated as not recorded.
  const i18n = useI18n(), {t, d} = i18n;
  const {independence: ind, alternatives: alt} = claim;
  const ids = list => list.length ? list.join(', ') : t('common.none');
  const numeric = summary => NUMERIC_LINES.filter(([key]) => summary?.[key] !== undefined).map(([key, label]) => t(label) + ' ' + summary[key]);
  return (
    <article className="bp-panel ar-stack" data-status={claim.status} data-stale={String(!!claim.stale_derivation)}>
      <ClaimHead id={claim.claim_id} status={claim.status} />
      <dl className="research-dl">
        <Row label={t('research.claim.requested')}>{claim.requested}</Row>
        <Row label={t('research.claim.scope')}><Scope {...claim} /></Row>
        <Row label={t('research.claim.uncertainty')}><Uncertainty {...claim} /></Row>
        <Row label={t('research.claim.evidence')}>
          {claim.evidence.length ? (
            <ul className="ar-stack ar-stack--tight">
              {claim.evidence.map(e => (
                <li key={e.id} data-evidence-id={e.id}>
                  <p><strong>{e.id}</strong> <span className="bp-meta">{e.method}</span></p>
                  {' '}
                  <MetaRow items={[
                    t('research.claim.digest', {digest: e.digest.slice(0, 12)}),
                    term(t, 'observation', e.status),
                    !e.counts_for_scope && t('research.claim.not_counted'),
                    e.started_at === null || e.started_at === undefined ? t('research.claim.no_time') : t('research.claim.started', {at: d(e.started_at, STAMP)}),
                    t('research.claim.receipt', {receipt: e.receipt_id?.slice(0, 12) || t('common.none')}),
                    ...numeric(e.numeric_summary),
                  ]} />
                </li>
              ))}
            </ul>
          ) : <span className="ar-note">{t('research.claim.no_evidence')}</span>}
        </Row>
        <Row label={t('research.claim.independence')}>
          <p>{t('research.claim.independent', {answer: t(ind.independent ? 'common.yes' : 'common.no')})}</p>
          {Object.entries(ind.roles).map(([name, seat]) => (
            <p key={name}>{t('research.claim.role_model', {role: roleName(t, name), model: seat.model, identity: identityWord(t, seat.identity_verified)})}</p>
          ))}
          {ind.reasons.length ? <p className="ar-note">{ind.reasons.map(reason => term(t, 'reason', reason)).join(', ')}</p> : null}
        </Row>
        <Row label={t('research.claim.findings')}>
          {claim.findings.length
            ? <ul>{claim.findings.map((f, i) => <li key={i}>{roleName(t, f.role)}, {term(t, 'position', f.position)}: {f.finding}</li>)}</ul>
            : <span className="ar-note">{t('research.claim.no_finding')}</span>}
        </Row>
        <Row label={t('research.claim.alternatives')}>
          <p>{t('research.claim.relatives', {parents: ids(alt.parents), siblings: ids(alt.siblings), children: ids(alt.children)})}</p>
          {alt.conflicts_source === 'unavailable'
            ? <p className="ar-note">{t('research.claim.conflicts_unavailable')}</p>
            : alt.conflicts.map((c, i) => <p key={i}>{t('research.claim.conflict', {ids: ids(c.assessment_ids || [])})}</p>)}
        </Row>
        <Row label={t('research.claim.next_test')}><NextTests {...claim} /></Row>
        <Row label={t('research.claim.units')}>{claim.units_note}</Row>
        <Row label={t('research.claim.derivation')}>
          <p>{derivationVersion || t('research.claim.no_derivation')}, {t('research.claim.check', {state: releaseWord(claim.claim_scope_check, i18n)})}</p>
          {claim.stale_derivation ? <p><strong>{t('research.claim.stale', {reason: claim.stale_reason})}</strong></p> : null}
        </Row>
      </dl>
    </article>
  );
}

export function ClaimScopeView({scope, claims, claimsError}) {
  const {t} = useI18n();
  const cards = !claimsError && claims?.claims?.length ? claims : null;
  return (
    <section className="ar-stack" aria-label={t('research.claims.title')}>
      <Heading hint={t('research.claims.roles')} hintLabel={t('research.claims.roles_label')}>{t('research.claims.title')}</Heading>
      <p className="ar-note">{t('research.claims.lead')}</p>
      {claimsError ? <Problem>{claimsError}</Problem> : null}
      {cards ? <>
        <p className="ar-note">{t('research.claims.basis', {round: cards.basis_round})} {cards.rule}</p>
        <div className="ar-list">{cards.claims.map(claim => <ClaimCard key={claim.claim_id} claim={claim} derivationVersion={cards.derivation_version} />)}</div>
        <p className="ar-note">{cards.uncertainty_note} {cards.note}</p>
      </> : scope ? <>
        <p className="ar-note">{t('research.claims.basis', {round: scope.basis_round})}</p>
        <div className="ar-list">
          {scope.branches.map(branch => (
            <article className="bp-panel ar-stack" key={branch.branch_id} data-status={branch.status}>
              <ClaimHead id={branch.branch_id} status={branch.status} />
              <dl className="research-dl">
                <Row label={t('research.claim.requested')}>{branch.requested}</Row>
                <Row label={t('research.claim.scope')}><Scope {...branch} /></Row>
                <Row label={t('research.claim.uncertainty')}><Uncertainty {...branch} /></Row>
                <Row label={t('research.claim.next_test')}><NextTests {...branch} /></Row>
              </dl>
            </article>
          ))}
        </div>
      </> : <p className="ar-note">{claims?.note || t('research.claims.none')}</p>}
    </section>
  );
}
