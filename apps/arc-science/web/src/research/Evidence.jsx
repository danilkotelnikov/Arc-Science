import React, {useEffect, useState} from 'react';
import {Accordion} from '@heroui/react/accordion';
import {Button} from '@heroui/react/button';
import {downloadResponse} from '../http';
import {useI18n} from '../i18n/index.jsx';
import {GravityIcon} from '../theme/gravity-icons.jsx';
import {Problem, Tag, VERDICT_TONE, friendlyError, term, words} from './common.jsx';

function Artifact({missionId, artifact, request, token, release, superseded}) {
  const {t} = useI18n();
  const [url, setUrl] = useState('');
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [refused, setRefused] = useState('');
  useEffect(() => {
    const controller = new AbortController(); let ownedUrl;
    setUrl(''); setError(''); setRefused('');
    request(`/missions/${missionId}/artifacts/${artifact.digest}`, 'GET', undefined, controller.signal)
      .then(r => r.blob()).then(blob => { if (!controller.signal.aborted) { ownedUrl = URL.createObjectURL(blob); setUrl(ownedUrl); } })
      .catch(e => { if (!controller.signal.aborted && e.name !== 'AbortError') setError(friendlyError(e, token, t)); });
    return () => { controller.abort(); if (ownedUrl) URL.revokeObjectURL(ownedUrl); };
    // t is left out on purpose: a language switch must not fetch the image again.
  }, [missionId, artifact.digest, request, token, attempt]);
  // The file download goes through the ledger-gated route; the inline image above stays whatever it answers.
  async function download() {
    setRefused('');
    try {
      const response = await request(`/missions/${missionId}/artifacts/${artifact.digest}/download`, 'GET', undefined, new AbortController().signal);
      await downloadResponse(response, 'arc-' + missionId + '-' + artifact.digest.slice(0, 12) + '.png');
    } catch (e) { setRefused(friendlyError(e, token, t)); }
  }
  const caption = [
    t('research.artifact.caption', {observation: artifact.source_observation_id, digest: artifact.digest.slice(0, 12), preset: term(t, 'preset', artifact.preset || 'default')}),
    artifact.repair_of ? t('research.artifact.repair_of', {digest: artifact.repair_of.slice(0, 12)}) : '',
    superseded ? t('research.artifact.superseded') : '',
  ].filter(Boolean).join(', ');
  return (
    <figure className="bp-panel ar-stack ar-stack--tight" data-artifact={artifact.digest}>
      {url ? <>
        <img src={url} alt={t('research.artifact.alt', {observation: artifact.source_observation_id})} />
        {release?.eligible_for_human_review
          ? <Button className="self-start" size="sm" variant="secondary" onPress={download}><GravityIcon name="download" />{t('research.artifact.download')}</Button>
          : <p className="ar-note">{t('research.artifact.download_closed')}</p>}
        {refused ? <Problem>{t('research.artifact.refused', {error: refused})}</Problem> : null}
      </> : error ? <>
        <Problem>{t('research.artifact.failed', {error})}</Problem>
        <Button className="self-start" size="sm" variant="secondary" onPress={() => setAttempt(n => n + 1)}>{t('research.artifact.retry')}</Button>
        <p className="ar-note">{t('research.artifact.retry_note')}</p>
      </> : <p className="ar-note">{t('research.artifact.loading')}</p>}
      <figcaption className="bp-meta">{caption}</figcaption>
    </figure>
  );
}

function RepairCycles({repairs}) {
  // Each cycle re-rendered the reviewed images under a presentation preset and had them
  // reviewed again as a new candidate; the outcome is that fresh review's own verdict, or
  // the reason the cycle could not run. Nothing here is inferred.
  const {t} = useI18n();
  return (
    <section className="ar-stack ar-stack--tight" aria-label={t('research.repairs.title')}>
      <h2>{t('research.repairs.title')}</h2>
      {repairs.length ? (
        <ol className="ar-stack ar-stack--tight">
          {repairs.map((cycle, i) => (
            <li key={i} data-outcome={cycle.outcome} className="ar-stack ar-stack--tight">
              <p className="ar-row">
                <strong>{t('research.repairs.cycle', {cycle: cycle.cycle, round: cycle.round})}</strong>
                {' '}<span>{t('research.repairs.line', {preset: term(t, 'preset', cycle.preset), addressed: cycle.addressed.map(words).join(', ') || t('research.repairs.nothing')})}</span>
                {' '}<Tag tone={VERDICT_TONE[cycle.outcome]}>{t('research.repairs.verdict', {verdict: term(t, 'verdict', cycle.outcome)})}</Tag>
              </p>
              {cycle.reason ? <p className="ar-note">{cycle.reason}</p> : null}
            </li>
          ))}
        </ol>
      ) : <p className="ar-note">{t('research.repairs.none')}</p>}
    </section>
  );
}

/** The Evidence tab: the rendered figures, their reviews and repairs, and the raw tool observations. */
export function EvidencePanel({mission, state, request, token}) {
  const {t} = useI18n();
  return (
    <div className="ar-stack">
      <section className="ar-stack" aria-label={t('research.artifacts.title')}>
        <h2>{t('research.artifacts.title')}</h2>
        {state.artifacts.length ? (
          <div className="ar-pair">
            {state.artifacts.map(artifact => (
              <Artifact key={mission.id + artifact.digest} missionId={mission.id} artifact={artifact} request={request} token={token}
                release={mission.release} superseded={state.artifacts.some(a => a.repair_of === artifact.digest)} />
            ))}
          </div>
        ) : <p className="ar-note">{t('research.artifacts.none')}</p>}
      </section>
      <section className="ar-stack" aria-label={t('research.reviews.title')}>
        <h2>{t('research.reviews.title')}</h2>
        {state.visual_reports.length ? (
          <div className="ar-list">
            {state.visual_reports.map((report, i) => (
              <article className="bp-panel ar-stack ar-stack--tight" key={i} data-verdict={report.verdict}>
                <div className="ar-row justify-between">
                  <h3>{report.model}</h3>
                  <Tag tone={VERDICT_TONE[report.verdict]}>{term(t, 'verdict', report.verdict)}</Tag>
                </div>
                <p className="bp-meta">{t('research.reviews.round', {round: report.round})}</p>
                {report.findings.map((finding, j) => <p key={j}>{words(finding.category)}: {finding.detail}</p>)}
              </article>
            ))}
          </div>
        ) : <p className="ar-note">{t('research.reviews.none')}</p>}
      </section>
      <RepairCycles repairs={state.repairs || []} />
      <Accordion>
        <Accordion.Item id="observations">
          <Accordion.Heading>
            <Accordion.Trigger>{t('research.observations.title')}<Accordion.Indicator /></Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body>
              {state.observations.length ? (
                <Accordion allowsMultipleExpanded>
                  {state.observations.map(observation => (
                    <Accordion.Item key={observation.id} id={observation.id}>
                      <Accordion.Heading>
                        <Accordion.Trigger>{observation.id}, {observation.tool}, {term(t, 'observation', observation.status)}<Accordion.Indicator /></Accordion.Trigger>
                      </Accordion.Heading>
                      <Accordion.Panel>
                        <Accordion.Body><pre className="ar-code">{JSON.stringify(observation.data, null, 2)}</pre></Accordion.Body>
                      </Accordion.Panel>
                    </Accordion.Item>
                  ))}
                </Accordion>
              ) : <p className="ar-note">{t('research.observations.none')}</p>}
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </div>
  );
}
