import React from 'react';
import {createRoot} from 'react-dom/client';
import {I18nProvider} from '../i18n/index.jsx';
import {DEFAULT_PALETTE, applyPalette, readStoredPalette} from '../theme/applyPalette.js';
import mockupEn from './strings.en.js';
import mockupRu from './strings.ru.js';
import Mockup from './Mockup.jsx';
import './mockup.css';

applyPalette(readStoredPalette() || DEFAULT_PALETTE);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <I18nProvider messages={{en: mockupEn, ru: mockupRu}}>
      <Mockup />
    </I18nProvider>,
  );
}
