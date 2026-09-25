import React from 'react';
import {Button} from '@heroui/react/button';
import {Chip} from '@heroui/react/chip';
import {useI18n} from '../../i18n/index.jsx';
import {Block, Meta} from '../ui.jsx';
import {LOGO_CANDIDATES, LOGO_INNER, LOGO_SOURCES, LOGO_SYMBOL, LOGO_VIEWBOX} from '../logoAssets.js';

const SIZES = [256, 64, 32, 16];
const TONES = [{id: 'light', color: '#111111'}, {id: 'dark', color: '#FFFFFF'}];

/** One background row. The colour is set here, so a currentColor mark takes it. */
function Row({candidate, tone}) {
  const {t} = useI18n();
  const name = t(`mk.logo.${candidate.id}`);
  return (
    <div className={`mk-logo-row mk-on-${tone.id}`} style={{color: tone.color}}>
      <span className="mk-hidden">{t(`mk.logos.${tone.id}`)}</span>
      {SIZES.map((size, index) => (
        <svg
          key={size}
          width={size}
          height={size}
          viewBox={LOGO_VIEWBOX}
          role={index === 0 ? 'img' : undefined}
          aria-label={index === 0 ? name : undefined}
          aria-hidden={index === 0 ? undefined : 'true'}
          focusable="false"
        >
          <use href={`#${LOGO_SYMBOL(candidate.id)}`} />
        </svg>
      ))}
    </div>
  );
}

export default function LogosScreen({logoId, onLogo}) {
  const {t} = useI18n();
  return (
    <div className="mk-stack">
      <h1>{t('mk.logos.heading')}</h1>
      <Meta>{t('mk.logos.sizes')}</Meta>

      {/* Each candidate is inlined once here; the tiles above reference it. */}
      <svg className="mk-logo-defs" aria-hidden="true" focusable="false">
        <defs>
          {LOGO_CANDIDATES.map(candidate => (
            <symbol
              key={candidate.id}
              id={LOGO_SYMBOL(candidate.id)}
              viewBox={LOGO_VIEWBOX}
              dangerouslySetInnerHTML={{__html: LOGO_INNER[candidate.id]}}
            />
          ))}
        </defs>
      </svg>

      {LOGO_SOURCES.map(source => (
        <section key={source} className="mk-stack">
          <h2>{t(`mk.logos.group.${source}`)}</h2>
          <div className="mk-logo-grid">
            {LOGO_CANDIDATES.filter(candidate => candidate.source === source).map(candidate => (
              <Block key={candidate.id} className="mk-stack">
                <h3>{t(`mk.logo.${candidate.id}`)}</h3>
                <Row candidate={candidate} tone={TONES[0]} />
                <Row candidate={candidate} tone={TONES[1]} />
                {/* Provenance from index.json, kept in the words the catalogue uses. */}
                <p className="mk-note">{candidate.notes}</p>
                <div className="mk-row">
                  <Button
                    variant={logoId === candidate.id ? 'primary' : 'secondary'}
                    onPress={() => onLogo(candidate.id)}
                  >
                    {t('mk.logos.use')}
                  </Button>
                  {logoId === candidate.id ? <Chip color="success" variant="soft">{t('mk.logos.in_use')}</Chip> : null}
                </div>
              </Block>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
