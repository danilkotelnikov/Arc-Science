/**
 * arc-hoh 0.3.0 (2026-11-03): the browser half. A Trace tab in the right sidebar shows the HoH ledger
 * (proposals, freezes and gate verdicts, newest first, with the chain check) and the Cammut brief.
 * Data: POST api/arc-hoh/trace (lib/index.js), polled every 5 seconds while the tab is shown. Read only.
 */
window.__ModuleLoader__.load({ id: 'arc-hoh', factory: (require) => {
  const React = require('react');
  const h = React.createElement;
  const NS = 'arc-hoh', TAB = 'arc-hoh-trace', POLL_MS = 5000;
  const en = {
    'tab.trace': 'Trace',
    'tab.guide': 'See the proposals, frozen candidates and gate verdicts of the HoH cycle, and the memory brief the agent reads.',
    'ledger.title': 'HoH ledger',
    'ledger.loading': 'Loading trace…',
    'ledger.ok': 'Chain intact, {n} entries',
    'ledger.broken': 'Chain broken at entry {n}',
    'ledger.empty': 'No entries yet. An entry appears when an agent proposes, freezes or gates a task.',
    'ledger.error': 'Could not read the ledger.',
    'type.propose': 'Proposal', 'type.freeze': 'Frozen', 'type.gate': 'Gate',
    'verdict.accepted': 'Accepted', 'verdict.rejected': 'Rejected', 'verdict.unmet': 'Unmet', 'verdict.blocked': 'Blocked',
    'cycle': 'cycle {n}',
    'brief.title': 'Memory brief',
    'brief.empty': 'No brief yet. Cammut sends one when it is reachable.',
  };

  const muted = { opacity: 0.65 };
  const tabular = { fontVariantNumeric: 'tabular-nums' };
  const line = '1px solid color-mix(in srgb, currentColor 14%, transparent)';

  function Icon({ size = 16 }) {
    return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': true },
      h('circle', { cx: 4, cy: 3.5, r: 1.5 }), h('circle', { cx: 4, cy: 12.5, r: 1.5 }), h('circle', { cx: 12, cy: 8, r: 1.5 }),
      h('path', { d: 'M4 5v6M5.3 4.3l5.4 2.9M5.3 11.7l5.4-2.9' }));
  }

  function when(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }

  function formatVerdict(raw, t) {
    if (!raw) return '';
    const key = 'verdict.' + raw.toLowerCase();
    const translated = t(key);
    if (translated && translated !== key) return translated;
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  function Item({ it, t }) {
    const rawVerdict = it.type === 'gate' ? String(it.summary).split(':')[0].trim() : '';
    const verdict = formatVerdict(rawVerdict, t);
    return h('li', { style: { padding: '10px 0', borderTop: line, listStyle: 'none', display: 'grid', gap: 4 } },
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
        h('span', { style: { fontWeight: 600 } }, t('type.' + it.type) || it.type),
        verdict ? h('span', { style: { fontWeight: 600, ...(rawVerdict === 'accepted' ? {} : { textDecoration: 'underline' }) } }, verdict) : null,
        h('span', { style: { ...muted, ...tabular, marginLeft: 'auto', whiteSpace: 'nowrap' } }, when(it.ts))),
      h('div', { style: { overflowWrap: 'anywhere' } }, it.goal, it.cycle ? h('span', { style: { ...muted, ...tabular } }, ' (' + t('cycle', { n: it.cycle }) + ')') : null),
      it.summary && it.type !== 'gate' ? h('div', { style: { ...muted, overflowWrap: 'anywhere' } }, it.summary) : null,
      it.type === 'gate' && it.summary.includes(': ') ? h('div', { style: { ...muted, overflowWrap: 'anywhere' } }, it.summary.slice(it.summary.indexOf(': ') + 2)) : null);
  }

  function makePane(t) {
    return function TracePane() {
      const [data, setData] = React.useState(null);
      const [failed, setFailed] = React.useState(false);
      React.useEffect(() => {
        let live = true;
        const load = async () => {
          try {
            const r = await fetch('api/arc-hoh/trace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
            const j = r.ok ? await r.json() : null;
            if (!live) return;
            if (j && j.ok) { setData(j); setFailed(false); } else setFailed(true);
          } catch { if (live) setFailed(true); }
        };
        load();
        const timer = setInterval(load, POLL_MS);
        return () => { live = false; clearInterval(timer); };
      }, []);
      const loading = !data && !failed;
      const head = (text) => h('h3', { style: { fontSize: 13, fontWeight: 600, margin: '0 0 6px' } }, text);
      const chain = data ? (data.chain.ok ? t('ledger.ok', { n: data.chain.entries }) : t('ledger.broken', { n: data.chain.badAt })) : '';
      return h('div', { style: { padding: 12, fontSize: 13, lineHeight: 1.45, height: '100%', overflowY: 'auto', boxSizing: 'border-box', fontVariantNumeric: 'tabular-nums' } },
        h('section', { 'aria-label': t('ledger.title') },
          head(t('ledger.title')),
          loading ? h('p', { style: { ...muted, margin: 0 } }, t('ledger.loading')) : null,
          failed && !data ? h('p', { style: { ...muted, margin: 0 } }, t('ledger.error')) : null,
          data ? h('p', { style: { margin: '0 0 6px', ...tabular, ...(data.chain.ok ? muted : { fontWeight: 600 }) } }, chain) : null,
          data && data.items.length === 0 ? h('p', { style: { ...muted, margin: 0 } }, t('ledger.empty')) : null,
          data && data.items.length ? h('ul', { style: { margin: 0, padding: 0 } }, data.items.map((it) => h(Item, { key: it.seq, it, t }))) : null),
        h('section', { 'aria-label': t('brief.title'), style: { marginTop: 16, paddingTop: 12, borderTop: line } },
          head(t('brief.title')),
          loading ? h('p', { style: { ...muted, margin: 0 } }, t('ledger.loading')) : data && data.brief ? h('div', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, data.brief) : h('p', { style: { ...muted, margin: 0 } }, t('brief.empty'))));
    };
  }

  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { en, zh: en }), 'arc-hoh: dictionaries');
    const t = ctx.locale.bind(NS);
    const Pane = makePane(t);
    const Title = () => h(React.Fragment, null, h(Icon, { size: 16 }), h('span', null, t('tab.trace')));
    ctx.inject(['sidebarRightTabs'], (c) => {
      const off = [];
      const keep = (f) => { if (typeof f === 'function') off.push(f); };
      const tabs = c.sidebarRightTabs;
      if (!tabs || typeof tabs.register !== 'function') return;
      try {
        keep(tabs.register({ id: TAB, kind: TAB, title: () => t('tab.trace'), guide: [{ order: 30, title: () => t('tab.trace'), description: () => t('tab.guide'), icon: Icon }] }));
        keep(c.slots.inject('sidebar.right.pane.tab', () => c.slots.register({ name: 'sidebar.right.pane.tab', key: TAB, locale: NS }, Pane)));
        keep(c.slots.inject('sidebar.right.pane.tab.title', () => c.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB }, Title)));
      } catch { for (const f of off) f(); return; }
      return () => { for (const f of off) f(); };
    });
  }

  return { name: 'arc-hoh', inject: ['slots', 'locale'], apply };
} });
