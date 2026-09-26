import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.jsx';
import {I18nProvider} from './i18n/index.jsx';
import {applyPalette, readStoredPalette} from './theme/applyPalette.js';
import {applyMotion, readStoredMotion} from './theme/motion.js';
import './app.css';

// The stored palette and motion apply before the first paint.
applyPalette(readStoredPalette());
applyMotion(readStoredMotion());

const root = document.getElementById('root');
if (root) createRoot(root).render(<I18nProvider><App /></I18nProvider>);
