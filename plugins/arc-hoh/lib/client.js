// arc-hoh 0.4.0 (2026-11-15): interactive Trace tab.
window.__ModuleLoader__.load({ id: 'arc-hoh', factory: (require) => {
  const React = require('react');
  const h = React.createElement;
  const NS = 'arc-hoh', TAB = 'arc-hoh-trace', POLL_MS = 5000;
  const en = {
    'tab.trace': 'Trace',
    'tab.guide': 'Inspect the HoH ledger, review verdicts, leave notes and reuse decisions in chat.',
    'ledger.title': 'HoH ledger', 'ledger.loading': 'Loading trace…', 'ledger.ok': 'Chain intact, {n} entries',
    'ledger.broken': 'Chain broken at entry {n}', 'ledger.empty': 'No entries yet. Agents record proposals, freezes and gates here.',
    'ledger.filteredEmpty': 'No entries match the active filter.', 'ledger.error': 'Could not read the ledger.',
    'type.propose': 'Proposal', 'type.freeze': 'Frozen', 'type.gate': 'Gate', 'type.decide': 'Decision', 'type.review': 'Review',
    'verdict.accepted': 'Accepted', 'verdict.rejected': 'Rejected', 'verdict.unmet': 'Unmet', 'verdict.blocked': 'Blocked',
    'verdict.exit-ready': 'Exit ready', 'verdict.hold': 'Hold', 'verdict.approve': 'Approve', 'verdict.revise': 'Revise',
    'filter.all': 'All', 'filter.decisions': 'Decisions', 'filter.blocked': 'Blocked', 'filter.needsReview': 'Needs review',
    'search.label': 'Filter trace entries', 'search.placeholder': 'Filter by goal, decision or comment',
    'comment.placeholder': 'Add review comment', 'comment.save': 'Save', 'comment.retain': 'Retain',
    'chat.use': 'Use in chat', 'chat.ready': 'Inserted into chat', 'chat.copied': 'Copied prompt',
    'chat.failed': 'Could not insert or copy prompt', 'review.owner': 'Owner verdict',
    'action.refresh': 'Refresh', 'action.paused': 'Polling paused',
    'cycle': 'cycle {n}', 'gate.ref': 'gate #{n}', 'brief.title': 'Memory brief',
    'brief.empty': 'No brief yet. Cammut sends one when reachable.',
  };

  const TEXT = '"Geist", system-ui, sans-serif', cm = (p) => `color-mix(in srgb, currentColor ${p}%, transparent)`;
  const muted = { opacity: 0.65 }, tabular = { fontVariantNumeric: 'tabular-nums' }, mutM = { ...muted, margin: 0 }, bold = { fontWeight: 600 };
  const line = `1px solid ${cm(14)}`, pill = { display: 'inline-block', padding: '1px 6px', borderRadius: 999, background: cm(10), fontSize: '0.9em' };
  const btnStyle = (a) => ({ fontFamily: TEXT, fontSize: 11, lineHeight: 1.35, padding: '3px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', color: 'currentColor', background: cm(a ? 20 : 8), fontWeight: a ? 600 : 400 });
  const inputStyle = { fontFamily: TEXT, fontSize: 12, lineHeight: 1.4, padding: '4px 6px', color: 'currentColor', background: cm(6), border: 'none', borderBottom: line, outline: 'none', flex: 1, minWidth: 0, boxSizing: 'border-box' };

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

  function cleanField(v, max = 140) { return String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }

  const rowWrap = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }, grid6 = { display: 'grid', gap: 6 }, h3St = { fontSize: 13, ...bold, margin: 0 }, st11 = { ...muted, fontSize: 11 }, mtab = { ...muted, ...tabular }, wrap = { overflowWrap: 'anywhere' }, anyWrap = { ...muted, ...wrap };
  const btn = (lbl, onClick, a = false, ex = {}) => h('button', { type: 'button', onClick, ...ex, style: { ...btnStyle(a), ...(ex.style || {}) } }, lbl);
  function pushToChatComposer(pt) {
    let copied = false, inserted = false, pendingCopy = null;
    const g = globalThis, D = g.document, T = g.HTMLTextAreaElement, N = g.navigator?.clipboard;
    const ev = (e) => { if (g.Event) e.dispatchEvent?.(new g.Event('input', { bubbles: true })); e.focus?.(); };
    try {
      const el = Array.from(D?.querySelectorAll?.('textarea, [contenteditable="true"]') || []).filter((e) => e && !e.disabled && !e.closest?.('[data-arc-plugin-pane="true"]') && e.getBoundingClientRect?.().width > 40 && e.getBoundingClientRect().height > 16).slice(-1)[0];
      if (el) {
        const cur = typeof el.value === 'string' ? el.value : (typeof el.textContent === 'string' ? el.textContent : ''), next = cur.trim() ? cur.replace(/\s+$/, '') + '\n\n' + pt : pt, isTa = (T && el instanceof T) || el.tagName === 'TEXTAREA';
        if (isTa || 'value' in el) {
          const s = isTa && T ? Object.getOwnPropertyDescriptor(T.prototype, 'value')?.set : null;
          if (s) s.call(el, next); else el.value = next; ev(el);
        } else {
          const lx = el.__lexicalEditor, cm = el.cmTile?.root?.view || el.cmView?.view || el.closest?.('.cm-editor')?.cmView?.view;
          if (lx?.parseEditorState && lx?.setEditorState) {
            const p0 = (l) => ({ children: l ? [{ detail: 0, format: 0, mode: 'normal', style: '', text: l, type: 'text', version: 1 }] : [], direction: null, format: '', indent: 0, type: 'paragraph', version: 1, textFormat: 0, textStyle: '' });
            const pv = lx.getEditorState?.()?.toJSON?.(), pc = pv?.root?.children, add = String(pt).split(/\n/).map(p0);
            const ch = Array.isArray(pc) && (String(el.textContent || '').trim() || pc.some((n) => n?.type !== 'paragraph' || n.children?.length > 0)) ? [...pc, p0(''), ...add] : add;
            lx.setEditorState(lx.parseEditorState(JSON.stringify({ root: pv?.root ? { ...pv.root, children: ch } : { children: ch, direction: null, format: '', indent: 0, type: 'root', version: 1 } }))); lx.focus?.();
          } else if (cm?.dispatch && cm.state?.doc) {
            const s = cm.state.doc.toString(), h0 = !!s.trim(), ins = h0 ? '\n\n' + pt : pt, f = h0 ? s.length : 0;
            cm.dispatch({ changes: { from: f, to: s.length, insert: ins }, selection: { anchor: f + ins.length } }); cm.focus?.();
          } else if (String(el.textContent || '').trim() && typeof el.append === 'function' && typeof D?.createElement === 'function') {
            el.append(D.createElement('br'), D.createElement('br'), pt); ev(el);
          } else { el.textContent = next; ev(el); }
        }
        inserted = true;
      }
    } catch {}
    if (!inserted) { try { if (typeof N?.writeText === 'function') pendingCopy = Promise.resolve(N.writeText(pt)).then(() => (copied = true, true), () => false); } catch { pendingCopy = null; } }
    return { copied, inserted, pendingCopy };
  }

  function buildItemPrompt(it, dn) {
    const p = [`Follow up on HoH ${cleanField(it.type, 24)} #${Number(it.seq) || 0}`, it.goal ? `goal ${JSON.stringify(cleanField(it.goal, 80))}` : '', it.decision?.id ? `decision ${cleanField(it.decision.id, 48)}` : '', it.reviewVerdict ? `owner verdict: ${cleanField(it.reviewVerdict, 24)}` : ''].filter(Boolean);
    const tail = [it.summary ? `Summary: ${JSON.stringify(cleanField(it.summary, 140))}` : '', dn && dn.trim() ? `Note: ${JSON.stringify(cleanField(dn, 160))}` : ''].filter(Boolean);
    return p.join(', ') + (tail.length ? '. ' + tail.join('. ') : '.');
  }
  function isBlockedItem(it) {
    if (it.reviewVerdict === 'hold') return true;
    if (it.type === 'decide' && it.decision) return it.decision.allowExit === false || it.decision.outcome === 'blocked';
    if (it.type === 'gate') { const r = String(it.summary || '').split(':')[0].trim().toLowerCase(); return r === 'blocked' || r === 'unmet' || r === 'rejected'; }
    return false;
  }
  const needsReviewItem = (it) => it.type !== 'review' && (!it.reviewVerdict || it.reviewVerdict === 'revise');
  function filterItems(items = [], filter = 'all', query = '') {
    const q = String(query || '').trim().toLowerCase();
    return items.filter((it) => {
      if ((filter === 'decisions' && it.type !== 'decide') || (filter === 'blocked' && !isBlockedItem(it)) || (filter === 'needs-review' && !needsReviewItem(it))) return false;
      if (!q) return true;
      const nt = Array.isArray(it.reviewNotes) ? it.reviewNotes.map((n) => n.note).join(' ') : '';
      const dt = it.decision ? [it.decision.id, it.decision.action, it.decision.outcome, it.decision.effectiveTaint].join(' ') : '';
      return [it.type, it.goal, it.summary, it.reviewVerdict, nt, dt].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }
  function Item({ it, t, onVerdict, onComment, onRetain, onUseInChat, commentDraft, onCommentDraftChange, onFocusChange, busy }) {
    const [ld, setLd] = React.useState(''), [cs, setCs] = React.useState(''), draft = commentDraft !== undefined ? commentDraft : ld, setDraft = onCommentDraftChange || setLd;
    const rawV = it.type === 'gate' ? String(it.summary).split(':')[0].trim() : '', d = it.type === 'decide' ? (it.decision || null) : null, decV = d ? (d.allowExit ? 'exit-ready' : 'hold') : '', revV = it.type === 'review' && it.review?.verdict ? it.review.verdict : '';
    const verdict = formatVerdict(rawV || decV || revV, t), chips = d ? [d.id, d.action, d.outcome, d.effectiveTaint].filter(Boolean) : [], passed = rawV === 'accepted' || decV === 'exit-ready' || revV === 'approve';
    const ov = it.reviewVerdict ? formatVerdict(it.reviewVerdict, t) : '', notes = Array.isArray(it.reviewNotes) ? it.reviewNotes : [];
    const triggerChat = async () => { const pr = buildItemPrompt(it, draft), r0 = onUseInChat ? onUseInChat(it, pr) : pushToChatComposer(pr), r = r0 && !r0.inserted && typeof r0.then === 'function' ? await r0 : r0; setCs(r?.inserted ? t('chat.ready') : (r?.copied === true || (r?.pendingCopy ? await r.pendingCopy : false) ? t('chat.copied') : t('chat.failed'))); };
    return h('li', { 'data-hoh-seq': String(it.seq), style: { padding: '10px 0', borderTop: line, listStyle: 'none', ...grid6 } },
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } },
        h('span', { style: bold }, t('type.' + it.type) || it.type), verdict ? h('span', { style: { ...bold, ...(passed ? {} : { textDecoration: 'underline' }) } }, verdict) : null,
        ov ? h('span', { 'data-hoh-owner-verdict': it.reviewVerdict, style: pill }, `${t('review.owner')}: ${ov}`) : null, h('span', { style: { ...mtab, marginLeft: 'auto', whiteSpace: 'nowrap' } }, when(it.ts))),
      h('div', { style: wrap },
        it.goal, it.cycle ? h('span', { style: mtab }, ' (' + t('cycle', { n: it.cycle }) + ')') : null,
        d && d.gateSeq !== undefined ? h('span', { style: mtab }, ' (' + t('gate.ref', { n: d.gateSeq }) + ')') : null),
      d && chips.length > 0 ? h('div', { 'data-hoh-decision-card': 'true', style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, chips.map((c, i) => h('span', { key: String(i), style: pill }, c))) : null,
      it.summary && it.type !== 'gate' && !d ? h('div', { style: anyWrap }, it.summary) : null,
      it.type === 'gate' && it.summary.includes(': ') ? h('div', { style: anyWrap }, it.summary.slice(it.summary.indexOf(': ') + 2)) : null,
      notes.length > 0 ? h('div', { 'data-hoh-review-notes': 'true', style: { display: 'grid', gap: 2 } }, notes.map((n) => h('div', { key: String(n.seq), style: { ...anyWrap, fontSize: 12 } }, `${n.caller || 'owner'}: ${n.note}`))) : null,
      it.type !== 'review' ? h('div', { style: { ...grid6, marginTop: 2 } },
        h('div', { style: { ...rowWrap, gap: 4 } },
          ['approve', 'revise', 'hold'].map((v) => btn(formatVerdict(v, t), () => onVerdict?.(it, v, draft), it.reviewVerdict === v, { key: v, disabled: Boolean(busy), 'data-hoh-verdict': v, 'aria-pressed': it.reviewVerdict === v })),
          btn(t('chat.use'), triggerChat, false, { 'data-hoh-use-chat': String(it.seq), style: { marginLeft: 'auto' } })),
        cs ? h('div', { 'data-hoh-chat-status': 'true', style: st11 }, cs) : null,
        h('form', { onSubmit: (e) => { e?.preventDefault?.(); if (onComment && draft && draft.trim()) onComment(it, draft); }, style: rowWrap },
          h('input', { type: 'text', 'aria-label': t('comment.placeholder'), 'data-hoh-comment-input': String(it.seq), placeholder: t('comment.placeholder'), value: draft || '', onFocus: () => onFocusChange?.(true), onBlur: () => onFocusChange?.(false), onChange: (e) => setDraft(e?.target ? e.target.value : ''), style: inputStyle }),
          h('button', { type: 'submit', disabled: Boolean(busy) || !(draft && draft.trim()), 'data-hoh-comment-save': String(it.seq), style: btnStyle(false) }, t('comment.save')),
          btn(t('comment.retain'), () => onRetain?.(it, draft), false, { disabled: Boolean(busy), 'data-hoh-retain': String(it.seq) }))) : null);
  }

  function makePane(t) {
    return function TracePane() {
      const [data, setData] = React.useState(null), [failed, setFailed] = React.useState(false), [filter, setFilter] = React.useState('all'), [query, setQuery] = React.useState('');
      const [drafts, setDrafts] = React.useState({}), [typingFocus, setTypingFocus] = React.useState(false), [busy, setBusy] = React.useState(false), [actionMsg, setActionMsg] = React.useState('');
      const paused = typingFocus || busy || Object.keys(drafts).some((k) => drafts[k] && drafts[k].trim() !== '');
      const load = async () => {
        try {
          const r = await fetch('api/arc-hoh/trace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), j = r.ok ? await r.json() : null;
          if (j && j.ok) { setData(j); setFailed(false); } else setFailed(true);
        } catch { setFailed(true); }
      };

      React.useEffect(() => { load(); }, []);
      React.useEffect(() => { if (paused) return undefined; const timer = setInterval(load, POLL_MS); return () => clearInterval(timer); }, [paused]);

      const sendAction = async (payload, clearSeq = null) => {
        const sub = clearSeq !== null ? (drafts[clearSeq] ?? '') : null;
        setBusy(true); setActionMsg('');
        try {
          const r = await fetch('api/arc-hoh/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }), j = await r.json().catch(() => null);
          if (r.ok && j && j.ok) {
            const part = (payload.action === 'retain' || payload.retain === true) && !j.retained;
            if (clearSeq !== null && !part) setDrafts((p) => ((p[clearSeq] ?? '') === sub ? { ...p, [clearSeq]: '' } : p));
            setActionMsg(part ? 'Saved locally; Cammut retain unavailable' : (j.retained ? 'Saved and retained' : 'Saved')); await load();
          } else setActionMsg((j && j.error) || 'Action failed');
        } catch { setActionMsg('Action failed'); } finally { setBusy(false); }
      };

      const loading = !data && !failed, chain = data ? (data.chain.ok ? t('ledger.ok', { n: data.chain.entries }) : t('ledger.broken', { n: data.chain.badAt })) : '', visible = data ? filterItems(data.items, filter, query) : [];
      const filters = [['all', t('filter.all')], ['decisions', t('filter.decisions')], ['blocked', t('filter.blocked')], ['needs-review', t('filter.needsReview')]];

      return h('div', { 'data-arc-plugin-pane': 'true', 'data-arc-hoh-trace': 'true', style: { padding: 12, fontSize: 13, lineHeight: 1.45, height: '100%', overflowY: 'auto', boxSizing: 'border-box', ...tabular } },
        h('section', { 'aria-label': t('ledger.title') },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
            h('h3', { style: h3St }, t('ledger.title')),
            btn(t('action.refresh'), load, false, { 'data-hoh-refresh': 'true', style: { marginLeft: 'auto' } })),
          loading ? h('p', { style: mutM }, t('ledger.loading')) : null,
          failed && !data ? h('p', { style: mutM }, t('ledger.error')) : null,
          data ? h('p', { style: { margin: '0 0 6px', ...tabular, ...(data.chain.ok ? muted : bold) } }, chain) : null,
          data ? h('div', { style: { ...grid6, marginBottom: 8 } },
            h('div', { role: 'tablist', 'aria-label': t('search.label'), style: { ...rowWrap, gap: 4 } },
              filters.map(([id, label]) => btn(label, () => setFilter(id), filter === id, { key: id, role: 'tab', 'aria-selected': filter === id, 'data-hoh-filter': id }))),
            h('input', { type: 'text', 'aria-label': t('search.label'), 'data-hoh-search': 'true', placeholder: t('search.placeholder'), value: query, onFocus: () => setTypingFocus(true), onBlur: () => setTypingFocus(false), onChange: (e) => setQuery(e?.target ? e.target.value : ''), style: inputStyle }),
            paused ? h('div', { 'data-hoh-polling-paused': 'true', style: st11 }, t('action.paused')) : null,
            actionMsg ? h('div', { 'data-hoh-action-status': 'true', style: st11 }, actionMsg) : null) : null,
          data && data.items.length === 0 ? h('p', { style: mutM }, t('ledger.empty')) : null,
          data && data.items.length > 0 && visible.length === 0 ? h('p', { style: mutM }, t('ledger.filteredEmpty')) : null,
          visible.length > 0 ? h('ul', { style: { margin: 0, padding: 0 } }, visible.map((it) => {
            const nt = (n) => (n && n.trim() ? { note: n.trim() } : {});
            return h(Item, {
              key: it.seq, it, t, busy, commentDraft: drafts[it.seq] ?? '', onCommentDraftChange: (v) => setDrafts((p) => ({ ...p, [it.seq]: v })), onFocusChange: setTypingFocus,
              onVerdict: (item, v, note) => sendAction({ action: 'verdict', targetSeq: item.seq, goal: item.goal, verdict: v, ...nt(note) }, note?.trim() ? item.seq : null),
              onComment: (item, note) => sendAction({ action: 'comment', targetSeq: item.seq, goal: item.goal, note }, item.seq),
              onRetain: (item, note) => sendAction({ action: 'retain', targetSeq: item.seq, goal: item.goal, ...(item.reviewVerdict ? { verdict: item.reviewVerdict } : {}), ...(note?.trim() ? nt(note) : { note: item.summary }) }, note?.trim() ? item.seq : null),
              onUseInChat: (_item, prompt) => pushToChatComposer(prompt),
            });
          })) : null),
        h('section', { 'aria-label': t('brief.title'), style: { marginTop: 16, paddingTop: 12, borderTop: line } },
          h('h3', { style: h3St }, t('brief.title')),
          loading ? h('p', { style: mutM }, t('ledger.loading')) : data && data.brief ? h('div', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, data.brief) : h('p', { style: mutM }, t('brief.empty'))));
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

  return { name: 'arc-hoh', inject: ['slots', 'locale'], apply, en, Item, makePane, filterItems, pushToChatComposer };
} });
