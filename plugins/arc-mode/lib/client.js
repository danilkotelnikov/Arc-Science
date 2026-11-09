/**
 * arc-mode 0.2.0 (2026-11-10): the browser half. The Advanced section of Settings: the Arc Harness mode switch,
 * the list of what the mode contains, and the measured results. Data: POST api/arc-mode/state (lib/index.js).
 * Colours come from currentColor and the app's own surfaces, so the page follows the paper theme in light and dark.
 */
window.__ModuleLoader__.load({ id: 'arc-mode', factory: (require) => {
  const React = require('react');
  const h = React.createElement;
  const NS = 'arc-mode';
  const en = {
    nav: 'Advanced',
    'mode.label': 'Arc Harness mode',
    'contents.title': 'What the mode contains',
    'contents.count': '{hooks} hooks, {skills} skills, {rules} rules file',
    'group.rules': 'Written rules',
    'group.hooks': 'Claude Code hooks',
    'group.skills': 'Claude Code skills',
    'scope.follows': 'Follows this switch',
    'scope.fixed': 'Runs in Claude Code and is not changed here',
    missing: 'Missing',
    'hooks.unread': 'Could not read the hook list.',
    'effect.title': 'Open benchmark results',
    'effect.none': 'Not measured',
    'private.title': 'Private results',
    'private.label': 'These are not open benchmarks, and the work differs per model, so the rows rank nothing.',
    'col.benchmark': 'Benchmark',
    'col.model': 'Model',
    'col.date': 'Date',
    'col.sample': 'Sample',
    'col.result': 'Result',
    dropped: '{n} rows left out because a field is missing.',
    'rules.missing': 'The rules file is missing, so the switch adds nothing.',
    loading: 'Loading…',
    'error.load': 'Could not read the mode state.',
    'error.save': 'Could not save the switch.',
  };

  const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Consolas, monospace';
  const line = '1px solid color-mix(in srgb, currentColor 14%, transparent)';
  const muted = { opacity: 0.65 };
  const codeStyle = { display: 'inline-block', maxWidth: '100%', boxSizing: 'border-box', fontFamily: MONO, fontSize: '0.86em', padding: '1px 6px', borderRadius: 6, border: line, background: 'color-mix(in srgb, currentColor 7%, transparent)', overflowWrap: 'anywhere' };

  const Code = ({ children }) => h('code', { style: codeStyle }, children);
  const Head = ({ children }) => h('h3', { style: { fontSize: 13, fontWeight: 600, margin: 0 } }, children);
  const Note = ({ children }) => h('p', { style: { ...muted, fontSize: 12, margin: '2px 0 0' } }, children);

  function Switch({ on, busy, label, onChange }) {
    return h('button', {
      type: 'button', role: 'switch', 'aria-checked': on, 'aria-label': label, disabled: busy, onClick: () => onChange(!on),
      style: { color: 'inherit', width: 36, height: 20, padding: 2, border: 0, borderRadius: 10, cursor: busy ? 'wait' : 'pointer', flex: 'none', display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start', background: on ? 'currentColor' : 'color-mix(in srgb, currentColor 20%, transparent)' },
    }, h('span', { style: { width: 16, height: 16, borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1, Canvas)' } }));
  }

  function Group({ title, scope, children }) {
    return h('section', { 'aria-label': title, style: { padding: '10px 0', borderTop: line } },
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } }, h(Head, null, title), h('span', { style: { ...muted, fontSize: 12 } }, scope)),
      h('div', { style: { marginTop: 6 } }, children));
  }

  function Contents({ inv, t }) {
    const scoped = t('scope.fixed');
    return h('details', { style: { border: line, borderRadius: 8, padding: '8px 12px' } },
      h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, t('contents.title'),
        h('span', { style: { ...muted, fontWeight: 400, marginLeft: 8, fontVariantNumeric: 'tabular-nums' } }, t('contents.count', { hooks: inv.hooks.length, skills: inv.skills.length, rules: inv.rules.installed ? 1 : 0 }))),
      h('div', { style: { marginTop: 8 } },
        h(Group, { title: t('group.rules'), scope: t('scope.follows') }, h(Code, null, inv.rules.file), inv.rules.installed ? null : h(Note, null, t('missing'))),
        h(Group, { title: t('group.hooks'), scope: scoped },
          inv.hooksRead ? null : h(Note, null, t('hooks.unread')),
          h('ul', { style: { margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 } }, inv.hooks.map((k) => h('li', { key: k.name, style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: '2px 0' } },
            h(Code, null, k.name), h(Code, null, k.file), k.installed ? null : h('span', { style: { fontWeight: 600 } }, t('missing')),
            k.events.map((e) => h(Code, { key: e }, e)))))),
        h(Group, { title: t('group.skills'), scope: scoped },
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', maxHeight: 220, overflowY: 'auto' } }, inv.skills.map((s) => h(Code, { key: s }, s))))));
  }

  function Table({ rows, t }) {
    const th = (key) => h('th', { key, scope: 'col', style: { ...muted, fontWeight: 400, textAlign: 'left', padding: '4px 12px 4px 0', whiteSpace: 'nowrap' } }, t('col.' + key));
    const td = (key, child) => h('td', { key, style: { padding: '4px 12px 4px 0', verticalAlign: 'top', borderTop: line } }, child);
    return h('div', { style: { overflowX: 'auto' } }, h('table', { style: { borderCollapse: 'collapse', width: '100%', fontSize: 13, fontVariantNumeric: 'tabular-nums' } },
      h('thead', null, h('tr', null, ['benchmark', 'model', 'date', 'sample', 'result'].map(th))),
      h('tbody', null, rows.map((r, i) => h('tr', { key: i }, td('b', r.benchmark), td('m', h(Code, null, r.model)), td('d', r.date), td('s', `${r.n} ${r.unit}`), td('r', r.value))))));
  }

  function Effect({ data, t }) {
    return h(React.Fragment, null,
      h('section', { 'aria-label': t('effect.title'), style: { display: 'grid', gap: 10 } },
        h(Head, null, t('effect.title')),
        data.open.map((b) => h('div', { key: b.name, style: { paddingTop: 8, borderTop: line } },
          h('div', { style: { display: 'flex', gap: 8, justifyContent: 'space-between' } }, h('a', { href: b.url, title: b.why, target: '_blank', rel: 'noreferrer', style: { color: 'inherit', fontWeight: 600 } }, b.name), b.rows.length ? null : h('span', { style: muted }, t('effect.none'))),
          b.rows.length ? h(Table, { rows: b.rows, t }) : null))),
      h('section', { 'aria-label': t('private.title'), style: { display: 'grid', gap: 6 } },
        h(Head, null, t('private.title')),
        h(Note, null, t('private.label')),
        data.private.rows.length ? h(Table, { rows: data.private.rows, t }) : h('span', { style: muted }, t('effect.none')),
        data.dropped ? h(Note, null, t('dropped', { n: data.dropped })) : null));
  }

  /** The page. Pure: every value arrives in props. */
  function View({ data, error, busy, onToggle, t }) {
    return h('div', { style: { display: 'grid', gap: 20, maxWidth: 720, fontSize: 13, lineHeight: 1.45 } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 } },
        h('span', { style: { fontWeight: 600 } }, t('mode.label')),
        data ? h(Switch, { on: data.on, busy, label: t('mode.label'), onChange: onToggle }) : null),
      !data && !error ? h('p', { style: { ...muted, margin: 0 } }, t('loading')) : null,
      error ? h('p', { role: 'alert', style: { margin: 0, fontWeight: 600 } }, t(error)) : null,
      data && data.on && !data.inventory.rules.installed ? h('p', { role: 'alert', style: { margin: 0, fontWeight: 600 } }, t('rules.missing')) : null,
      data ? h(Contents, { inv: data.inventory, t }) : null,
      data ? h(Effect, { data: data.effect, t }) : null);
  }

  function makeSection(t) {
    return function AdvancedSection() {
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const post = async (body, failure) => {
        setBusy(true);
        try {
          const r = await fetch('api/arc-mode/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
          const j = r.ok ? await r.json() : null;
          if (j && j.ok) { setData(j); setError(null); } else setError(failure);
        } catch { setError(failure); }
        setBusy(false);
      };
      React.useEffect(() => { post({}, 'error.load'); }, []);
      return h(View, { data, error, busy, t, onToggle: (on) => post({ on }, 'error.save') });
    };
  }

  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { en, zh: en }), 'arc-mode: dictionaries');
    const t = ctx.locale.bind(NS);
    const Section = makeSection(t);
    ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'advanced', order: 20, label: () => t('nav'), locale: NS }, Section));
  }

  return { name: 'arc-mode', inject: ['slots', 'locale'], apply, View, Code, en };
} });
