import React from 'react';
import {afterEach, describe, expect, it} from 'vitest';
import {render, screen, within} from '@testing-library/react';
import {I18nProvider} from '../i18n/index.jsx';
import baseEn from '../i18n/en.js';
import en from './strings.en.js';
import ru from './strings.ru.js';
import {LOGO_CANDIDATES, LOGO_INNER, headerCandidate} from './logoAssets.js';
import Mockup, {SCREENS} from './Mockup.jsx';

// The banned middle dot, built from its code point so this file stays clean of it.
const MIDDLE_DOT = String.fromCharCode(0xB7);

/** The cockpit tab lives in the hash, and only the open tab renders a panel. */
const openTab = tab => { globalThis.location.hash = `#/research/${tab}`; };
afterEach(() => { globalThis.location.hash = ''; });

const show = (initialScreen, locale) => render(
  <I18nProvider locale={locale} messages={{en, ru}}>
    <Mockup initialScreen={initialScreen} />
  </I18nProvider>,
);

describe('prototype dictionaries', () => {
  it('has the same keys in both locales', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries({...en, ...ru})) expect(value.trim(), key).not.toBe('');
  });

  it('names every logo candidate in both locales', () => {
    for (const candidate of LOGO_CANDIDATES) {
      expect(en[`mk.logo.${candidate.id}`], candidate.id).toBeTruthy();
      expect(ru[`mk.logo.${candidate.id}`], candidate.id).toBeTruthy();
    }
  });
});

describe.each(['en', 'ru'])('screens in %s', locale => {
  const heading = key => (locale === 'en' ? en[key] : ru[key]);

  it.each(SCREENS)('renders the %s screen with its heading and no middle dot', screenId => {
    show(screenId, locale);
    const key = screenId === 'research' ? 'mk.missions.heading' : `mk.screen.${screenId}`;
    expect(screen.getAllByText(heading(key)).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain(MIDDLE_DOT);
  });
});

describe('research cockpit', () => {
  it('opens the tab named in the hash and never reports a mission as running', () => {
    render(
      <I18nProvider locale="en" messages={{en, ru}}>
        <Mockup initialScreen="research" />
      </I18nProvider>,
    );
    expect(screen.getByRole('tab', {name: en['mk.tab.claims']})).toBeInTheDocument();
    expect(screen.getByText(en['mk.mission.state.active'])).toBeInTheDocument();
    expect(screen.queryByText(en['mk.mission.state.running'])).toBeNull();
  });

  it('gives the reject note a label that survives typing', () => {
    openTab('approvals');
    show('research', 'en');
    expect(screen.getByLabelText(en['mk.approvals.reject_note']).tagName).toBe('TEXTAREA');
  });

  it('formats the recorded dates for the locale instead of printing the raw ISO date', () => {
    openTab('evidence');
    show('research', 'ru');
    const cell = screen.getByText('18.09.2026');
    expect(cell.tagName).toBe('TIME');
    expect(cell).toHaveAttribute('dateTime', '2026-09-18');
    expect(screen.queryByText('2026-09-18')).toBeNull();
  });
});

describe('shell', () => {
  it('marks the open workspace with aria-current rather than a pressed toggle', () => {
    show('research', 'en');
    const rail = screen.getByRole('navigation', {name: baseEn['nav.label']});
    const current = within(rail).getByRole('button', {current: 'page'});
    expect(current).toHaveTextContent(baseEn['nav.research']);
    expect(within(rail).queryAllByRole('button', {pressed: true})).toHaveLength(0);
  });

  it('names the language buttons with the text they show', () => {
    show('research', 'ru');
    const ruButton = screen.getAllByRole('radio', {name: 'RU'})[0];
    expect(ruButton).toHaveAttribute('lang', 'ru');
    expect(screen.getAllByRole('radio', {name: 'EN'})[0]).toHaveAttribute('lang', 'en');
  });

  it('draws the header logo inline, so a mark can take the palette ink', () => {
    const {container} = show('research', 'en');
    const logo = container.querySelector('.mk-brand-logo');
    expect(logo.innerHTML.length).toBeGreaterThan(0);
  });
});

describe('logo sheet', () => {
  it('shows every candidate from the catalogue, grouped by source', () => {
    const {container} = show('logos', 'en');
    expect(container.querySelectorAll('.mk-logo-defs symbol')).toHaveLength(LOGO_CANDIDATES.length);
    for (const source of new Set(LOGO_CANDIDATES.map(item => item.source))) {
      expect(screen.getByRole('heading', {name: en[`mk.logos.group.${source}`]})).toBeInTheDocument();
    }
    expect(screen.getByText(LOGO_CANDIDATES[0].notes)).toBeInTheDocument();
  });

  it('inlines the marks and paints the dark row white, so currentColor is not black', () => {
    const {container} = show('logos', 'en');
    const mark = LOGO_CANDIDATES.find(item => item.kind === 'mark');
    expect(LOGO_INNER[mark.id]).toContain('currentColor');
    const darkRow = container.querySelector('.mk-on-dark');
    expect(darkRow).toHaveStyle({color: '#FFFFFF'});
    expect(darkRow.querySelectorAll('use')).toHaveLength(4);
    expect(container.querySelector('.mk-logo-row img')).toBeNull();
  });
});

describe('header logo', () => {
  it('keeps a dark palette off the dark tile art by using the matching mark', () => {
    expect(headerCandidate('snoggo-tile', 'dark').id).toBe('snoggo-mark-mono');
    expect(headerCandidate('gpt-01-tile', 'dark').id).toBe('gpt-01-mark');
    expect(headerCandidate('arc-a-tile-ink', 'dark').id).toBe('arc-a-mark');
    expect(headerCandidate('snoggo-tile', 'light').id).toBe('snoggo-tile');
  });
});
