import React from 'react';
import {useI18n} from '../../i18n/index.jsx';
import {Block, Meta, Status} from '../ui.jsx';
import {DIAGNOSTICS} from '../fixtures.js';

export default function DiagnosticsScreen() {
  const {t} = useI18n();
  return (
    <div className="mk-stack">
      <h1>{t('mk.screen.diagnostics')}</h1>
      <h2>{t('mk.diag.heading')}</h2>
      <ul className="mk-stack">
        {DIAGNOSTICS.map(item => (
          <li key={item.id}>
            <Block className="mk-stack">
              <div className="mk-row">
                <Status state={item.state}>{t(`state.${item.state}`)}</Status>
                <strong>{t(`${item.key}.title`)}</strong>
              </div>
              <Meta>{t('mk.diag.source')}: {t(`${item.key}.source`)}</Meta>
            </Block>
          </li>
        ))}
      </ul>
    </div>
  );
}
