// arc-molecullage 0.2.0 (2026-11-15): interactive Molecullage tab.
window.__ModuleLoader__.load({ id: "arc-molecullage", factory: (require) => {
  const React = require("react");
  const h = React.createElement;
  const NS = "arc-molecullage", TAB = "arc-molecullage-workspace", POLL_MS = 8000;
  const en = {
    "tab.title": "Molecullage",
    "tab.guide": "Run the five-gate checklist, filter verified sources, pin references, save figure notes and push pipeline prompts to chat.",
    "state.loading": "Loading Molecullage workspace…", "state.error": "Could not read the Molecullage workspace state.",
    "gates.title": "Anti-overplating gate", "gates.summary": "{rules} rules, nested boxes: {nestedBoxes}",
    "gates.pass": "Accepted", "gates.fail": "Rejected", "gates.run": "Run checks", "gates.reset": "Reset",
    "atlas.title": "Shelf and eight-domain atlas", "atlas.summary": "{sources} verified sources across {domains} domains",
    "atlas.filter": "Filter sources", "atlas.placeholder": "Filter verified sources by name, kind or domain",
    "atlas.all": "All", "atlas.pin": "Pin", "atlas.pinned": "Pinned", "atlas.unpin": "Unpin",
    "atlas.pinsTitle": "Pinned references", "atlas.useSource": "Use source in chat",
    "pipeline.title": "3D structure and figure pipeline", "pipeline.ready": "Ready",
    "notes.title": "Figure notes", "notes.placeholder": "Add figure note or review comment",
    "notes.doiPlaceholder": "Optional DOI or source id", "notes.save": "Save note", "notes.retain": "Save and retain", "notes.remove": "Remove",
    "chat.use": "Use in chat", "chat.ready": "Inserted into chat", "chat.copied": "Copied prompt", "chat.failed": "Could not insert or copy prompt",
    "action.refresh": "Refresh", "action.paused": "Polling paused while typing",
  };

  const MONO = "\"Geist Mono\", ui-monospace, SFMono-Regular, Consolas, monospace";
  const TEXT = "\"Geist\", system-ui, sans-serif";
  const cm = (p) => `color-mix(in srgb, currentColor ${p}%, transparent)`;
  const muted = { opacity: 0.65 }, num = { fontVariantNumeric: "tabular-nums" }, line = `1px solid ${cm(14)}`;
  const codeStyle = { display: "inline-block", maxWidth: "100%", boxSizing: "border-box", fontFamily: MONO, fontSize: "0.86em", padding: "1px 6px", borderRadius: 6, border: "none", background: cm(7), overflowWrap: "anywhere" };
  const inputStyle = { fontFamily: TEXT, fontSize: 12, lineHeight: 1.4, padding: "5px 8px", color: "currentColor", background: cm(6), border: "none", borderBottom: line, outline: "none", flex: 1, minWidth: 0, boxSizing: "border-box" };
  const filterBtnStyle = { fontFamily: TEXT, fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer", color: "currentColor", background: cm(10), fontWeight: 600 };
  const btnStyle = (a) => ({ fontFamily: TEXT, fontSize: 11, lineHeight: 1.35, padding: "3px 8px", borderRadius: 6, border: "none", cursor: "pointer", color: "currentColor", background: cm(a ? 20 : 8), fontWeight: a ? 600 : 400 });
  const bold = { fontWeight: 600 }, mutM = { ...muted, margin: 0 }, liSt = { paddingTop: 6, borderTop: line, display: "grid", gap: 4 };

  const Code = ({ children }) => h("code", { style: codeStyle }, children);
  const Head = ({ children }) => h("h3", { style: { fontSize: 13, fontWeight: 600, margin: "0 0 6px" } }, children);

  const STG = [
    { id: "chimerax", label: "Structure", tool: "render_structure" },
    { id: "build", label: "Layout", tool: "build_figure" },
    { id: "blender", label: "Blender", tool: "execute_blender_code" },
    { id: "qa", label: "Qa", tool: "qa_figure" },
    { id: "blind-read", label: "Blind read", tool: "blind_read" },
  ];
  const LOC_MSG = "Saved locally; Cammut retain unavailable";
  const cl = (v, max = 140) => String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

  function Icon({ size = 16 }) {
    return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true },
      h("polygon", { points: "12 3 20 7.5 20 16.5 12 21 4 16.5 4 7.5" }),
      h("circle", { cx: 12, cy: 12, r: 2.5 }),
      h("path", { d: "M12 3v6.5M20 16.5l-5.6-3.2M4 16.5l5.6-3.2" }));
  }

  function pushToChatComposer(pt) {
    let copied = false, inserted = false, pendingCopy = null;
    const g = globalThis, D = g.document, T = g.HTMLTextAreaElement, N = g.navigator?.clipboard;
    const ev = (e) => { if (g.Event) e.dispatchEvent?.(new g.Event("input", { bubbles: true })); e.focus?.(); };
    try {
      const el = Array.from(D?.querySelectorAll?.("textarea, [contenteditable=\"true\"]") || []).filter((e) => e && !e.disabled && !e.closest?.("[data-arc-plugin-pane=\"true\"]") && e.getBoundingClientRect?.().width > 40 && e.getBoundingClientRect().height > 16).slice(-1)[0];
      if (el) {
        const cur = typeof el.value === "string" ? el.value : (typeof el.textContent === "string" ? el.textContent : ""), next = cur.trim() ? cur.replace(/\s+$/, "") + "\n\n" + pt : pt, isTa = (T && el instanceof T) || el.tagName === "TEXTAREA";
        if (isTa || "value" in el) {
          const s = isTa && T ? Object.getOwnPropertyDescriptor(T.prototype, "value")?.set : null;
          if (s) s.call(el, next); else el.value = next; ev(el);
        } else {
          const lx = el.__lexicalEditor, cm = el.cmTile?.root?.view || el.cmView?.view || el.closest?.(".cm-editor")?.cmView?.view;
          if (lx?.parseEditorState && lx?.setEditorState) {
            const p0 = (l) => ({ children: l ? [{ detail: 0, format: 0, mode: "normal", style: "", text: l, type: "text", version: 1 }] : [], direction: null, format: "", indent: 0, type: "paragraph", version: 1, textFormat: 0, textStyle: "" });
            const pv = lx.getEditorState?.()?.toJSON?.(), pc = pv?.root?.children, add = String(pt).split(/\n/).map(p0);
            const ch = Array.isArray(pc) && (String(el.textContent || "").trim() || pc.some((n) => n?.type !== "paragraph" || n.children?.length > 0)) ? [...pc, p0(""), ...add] : add;
            lx.setEditorState(lx.parseEditorState(JSON.stringify({ root: pv?.root ? { ...pv.root, children: ch } : { children: ch, direction: null, format: "", indent: 0, type: "root", version: 1 } }))); lx.focus?.();
          } else if (cm?.dispatch && cm.state?.doc) {
            const s = cm.state.doc.toString(), h0 = !!s.trim(), ins = h0 ? "\n\n" + pt : pt, f = h0 ? s.length : 0;
            cm.dispatch({ changes: { from: f, to: s.length, insert: ins }, selection: { anchor: f + ins.length } }); cm.focus?.();
          } else if (String(el.textContent || "").trim() && typeof el.append === "function" && typeof D?.createElement === "function") {
            el.append(D.createElement("br"), D.createElement("br"), pt); ev(el);
          } else { el.textContent = next; ev(el); }
        }
        inserted = true;
      }
    } catch {}
    if (!inserted) { try { if (typeof N?.writeText === "function") pendingCopy = Promise.resolve(N.writeText(pt)).then(() => (copied = true, true), () => false); } catch { pendingCopy = null; } }
    return { copied, inserted, pendingCopy };
  }

  const SP = {
    chimerax: (c) => `Run render_structure with flat lighting, dark silhouette, chain tints and interface inset (${c}).`,
    blender: (c) => `Run execute_blender_code with transparent background and studio lighting (${c}).`,
    build: (c) => `Build figure via build_figure with Helvetica/Arial live text (${c}).`,
    qa: (c) => `Run full qa_figure across all 56 rules and report checks (${c}).`,
    "blind-read": (c) => `Run three-question blind_read on the PNG and log notes (${c}).`,
  };
  function buildStagePrompt(sa, data, activeDomain) {
    const sp = data?.figureSpec || {}, ol = (a) => (Array.isArray(a) ? a : []).filter((x) => x && typeof x === "object");
    const pinList = ol(data?.pins).slice(0, 4).map((p) => cl(p.doi || p.name || p.id, 64)).filter(Boolean).join(", "), note = cl(ol(data?.notes)[0]?.text, 160), dom = cl(activeDomain, 48);
    const ctx = `canvas ${Number(sp.canvasWidthMm) || 178} mm, min font ${Number(sp.minFontPt) || 6.5} pt, nestedBoxes ${Number(sp.nestedBoxes ?? 0) || 0}${dom ? `, domain ${dom}` : ""}${pinList ? `, refs [${pinList}]` : ""}`;
    return (SP[sa.id] || SP["blind-read"])(ctx) + (note ? ` Note: ${JSON.stringify(note)}` : "");
  }
  const bsp = (s) => {
    const r = [s.doi ? `DOI ${cl(s.doi, 80)}` : "", cl(s.url, 120)].filter(Boolean).join(", "), u = cl(s.use, 160);
    return `Use verified Molecullage source ${JSON.stringify(cl(s.name, 80))} (${cl(s.kind || "source", 32)}, licence ${cl(s.licenceClass || "check", 32)}${r ? `, ${r}` : ""}) for figure grounding${u ? `: ${JSON.stringify(u)}` : "."}`;
  };

  function View({ data, failed, actionError = "", activeDomain = "", onFilter, onSelectDomain, onAction, onRefresh, onUseInChat, onFocusChange, onDraftChange, paused = false, busy = false, t }) {
    const [qd, setQd] = React.useState(""), [nd, setNd] = React.useState(""), [dd, setDd] = React.useState(""), [sd, setSd] = React.useState(null), [cs, setCs] = React.useState("");
    const safeNd = nd || "", safeDd = dd || "", gate = data?.antiOverplating, atlas = data?.atlas, pipe = data?.pipeline, ol = (a) => (Array.isArray(a) ? a : []).filter((x) => x && typeof x === "object");
    const matched = ol(data?.matchedSources).slice(0, 8), pins = ol(data?.pins), notes = ol(data?.notes), pinIds = new Set(pins.map((p) => p.id)), sp = sd || data?.figureSpec || { nestedBoxes: 0, minFontPt: 6.5, canvasWidthMm: 178, grounded: true, realStructure: true, blenderStudio: true };
    const emit = async (p) => { const r0 = onUseInChat ? onUseInChat(p) : pushToChatComposer(p), r = r0 && !r0.inserted && typeof r0.then === "function" ? await r0 : r0; setCs(r?.inserted ? t("chat.ready") : (r?.copied === true || (r?.pendingCopy ? await r.pendingCopy : false) ? t("chat.copied") : t("chat.failed"))); };
    const okR = (r) => r !== false && r != null && (typeof r !== "object" || r.ok !== false);
    const subNote = async (action) => {
      if (!safeNd.trim() || !onAction) return;
      const sn = safeNd, sdo = safeDd;
      try {
        const res = await onAction({ action, text: sn.trim(), ...(sdo.trim() ? { doi: sdo.trim() } : {}) });
        if (okR(res) && (action !== "retain" || res?.retained !== false)) { setNd((c) => (c === sn ? "" : c)); setDd((c) => (c === sdo ? "" : c)); onDraftChange?.(false); }
        else if (okR(res) && action === "retain" && res?.retained === false) setCs(LOC_MSG);
      } catch {}
    };
    const upd = (set, oth) => (v) => { set(v); onDraftChange?.(!!((v && v.trim()) || (oth && oth.trim()))); };
    const secSt = { paddingTop: 12, borderTop: line }, setSp = (k, v) => setSd({ ...sp, [k]: v }), g6 = { display: "grid", gap: 6 }, ul0 = { margin: 0, padding: 0, listStyle: "none" };
    const rw = { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }, ug = { ...ul0, ...g6 }, ml = { marginLeft: "auto" }, fp = onFocusChange ? { onFocus: () => onFocusChange(true), onBlur: () => onFocusChange(false) } : {};
    const btn = (lbl, onClick, active = false, ex = {}) => h("button", { type: "button", onClick, ...ex, style: { ...btnStyle(active), ...(ex.style || {}) } }, lbl);
    const ti = (ar, at, ph, v, f) => h("input", { type: "text", "aria-label": ar, [at]: "true", placeholder: ph, value: v, ...fp, onChange: (e) => f(e?.target?.value ?? ""), style: inputStyle });
    const nf = (lbl, ar, at, v, min, max, step, f) => h("label", { style: { fontSize: 12, display: "flex", gap: 4, alignItems: "center" } },
      h("span", null, lbl), h("input", { type: "number", min, ...(max ? { max } : {}), step, "aria-label": ar, [at]: "true", value: v, ...fp, onChange: (e) => f(Number(e.target.value)), style: { ...inputStyle, width: 56, flex: "none" } }));

    return h("div", { "data-arc-plugin-pane": "true", "data-arc-molecullage": "true", style: { padding: 12, fontSize: 13, lineHeight: 1.45, height: "100%", overflowY: "auto", boxSizing: "border-box", display: "grid", gap: 16, alignContent: "start" } },
      !data && !failed ? h("p", { style: mutM }, t("state.loading")) : null,
      failed && !data ? h("p", { role: "alert", style: mutM }, t("state.error")) : null,
      cs || paused || actionError ? h("div", { style: { ...rw, gap: 8, fontSize: 11, ...muted } },
        cs ? h("span", { "data-molecullage-chat-status": "true" }, cs) : null,
        actionError ? h("span", { role: "alert", "data-molecullage-action-error": "true" }, actionError) : null,
        paused ? h("span", { "data-molecullage-polling-paused": "true" }, t("action.paused")) : null,
        onRefresh ? btn(t("action.refresh"), onRefresh, false, { style: ml }) : null) : null,
      gate ? h("section", { "aria-label": t("gates.title") },
        h(Head, null, t("gates.title")),
        h("p", { style: { ...muted, ...num, margin: "0 0 6px" } }, t("gates.summary", { rules: gate.rules, nestedBoxes: gate.nestedBoxes })),
        h("ul", { style: ul0 }, gate.gates.map((g) => h("li", { key: g.id, style: { padding: "6px 0", borderTop: line, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" } }, h("span", null, g.label), h("span", { style: { ...bold, ...(g.ok ? {} : { textDecoration: "underline" }) } }, g.ok ? t("gates.pass") : t("gates.fail"))))),
        onAction ? h("div", { "data-molecullage-checklist": "true", style: { ...g6, marginTop: 8, paddingTop: 8, borderTop: line } },
          h("div", { style: { ...rw, gap: 8 } },
            nf("Nested boxes", "Nested boxes count", "data-molecullage-nested-input", sp.nestedBoxes ?? 0, 0, null, 1, (n) => { const v = Math.max(0, n || 0); setSd({ ...sp, nestedBoxes: v, overplate: v }); }),
            nf("Min pt", "Minimum font point size", "data-molecullage-font-input", sp.minFontPt ?? 6.5, 4, 24, 0.5, (n) => setSp("minFontPt", n || 6.5)),
            [178, 89].map((mm) => btn(`${mm} mm`, () => setSp("canvasWidthMm", mm), sp.canvasWidthMm === mm, { key: String(mm), "data-molecullage-width": String(mm), "aria-pressed": sp.canvasWidthMm === mm }))),
          h("div", { style: rw },
            [["grounded", "DOI grounded"], ["realStructure", "ChimeraX 3D"], ["blenderStudio", "Blender studio"]].map(([k, lbl]) => btn(lbl, () => setSp(k, !sp[k]), !!sp[k], { key: k, "data-molecullage-toggle": k, "aria-pressed": !!sp[k] })),
            btn(t("gates.run"), async () => { const s = sp, r = await onAction({ action: "check", figureSpec: s }); if (okR(r)) setSd((d) => (d === s ? null : d)); }, true, { disabled: !!busy, "data-molecullage-run-checks": "true", style: ml }),
            btn(t("gates.reset"), async () => { const r = await onAction({ action: "check", reset: true }); if (okR(r)) setSd(null); }, false, { disabled: !!busy, "data-molecullage-reset-checks": "true" }))) : null) : null,
      atlas ? h("section", { "aria-label": t("atlas.title"), style: secSt },
        h(Head, null, t("atlas.title")),
        h("p", { style: { ...muted, ...num, margin: "0 0 6px" } }, t("atlas.summary", { sources: atlas.sources, domains: atlas.domainsCount })),
        onSelectDomain ? h("div", { "data-molecullage-domain-chips": "true", style: { ...rw, gap: 4, marginBottom: 8 } },
          btn(t("atlas.all"), () => onSelectDomain(""), !activeDomain, { "data-molecullage-domain": "", "aria-pressed": !activeDomain }),
          atlas.domains.map((d) => btn(d.label, () => onSelectDomain(activeDomain === d.id ? "" : d.id), activeDomain === d.id, { key: d.id, "data-molecullage-domain": d.id, "aria-pressed": activeDomain === d.id }))) : null,
        h("ul", { style: ug }, atlas.domains.map((d) => h("li", { key: d.id, style: { ...rw, alignItems: "baseline" } }, h("span", { style: { ...bold, minWidth: 110 } }, d.label), d.tools.map((tool) => h(Code, { key: tool }, tool))))),
        onFilter ? h("form", { onSubmit: (e) => { e?.preventDefault?.(); onFilter(qd || "", activeDomain); }, style: { display: "flex", gap: 8, alignItems: "center", marginTop: 10 } },
          ti(t("atlas.filter"), "data-molecullage-filter", t("atlas.placeholder"), qd || "", setQd),
          h("button", { type: "submit", style: filterBtnStyle }, t("atlas.filter"))) : null,
        matched.length > 0 ? h("ul", { "data-molecullage-matches": "true", style: { ...ug, margin: "8px 0 0" } },
          matched.map((s) => {
            const k = s.id || s.name, pin = pinIds.has(k);
            return h("li", { key: k, style: liSt },
              h("div", { style: { ...rw, justifyContent: "space-between", gap: 8, alignItems: "baseline" } }, h("span", { style: bold }, s.name), h(Code, null, s.licenceClass || s.kind)),
              s.use ? h("span", { style: { ...muted, fontSize: 12 } }, s.use) : null,
              h("div", { style: rw },
                onAction ? btn(pin ? t("atlas.pinned") : t("atlas.pin"), () => onAction({ action: "toggle-pin", source: s }), pin, { disabled: !!busy, "data-molecullage-pin": k, "aria-pressed": pin }) : null,
                btn(t("atlas.useSource"), () => emit(bsp(s)), false, { "data-molecullage-use-source": k })));
          })) : null,
        pins.length > 0 ? h("div", { "data-molecullage-pins": "true", style: { marginTop: 10, paddingTop: 8, borderTop: line, ...g6 } },
          h("div", { style: { ...bold, fontSize: 12 } }, t("atlas.pinsTitle")),
          h("ul", { style: { ...ug, gap: 4 } }, pins.map((p) => h("li", { key: p.id, style: { ...rw, fontSize: 12 } },
            h("span", { style: bold }, p.name), p.doi ? h(Code, null, p.doi) : null,
            btn(t("chat.use"), () => emit(bsp(p)), false, { style: ml }),
            onAction ? btn(t("atlas.unpin"), () => onAction({ action: "unpin", sourceId: p.id })) : null)))) : null) : null,
      pipe ? h("section", { "aria-label": t("pipeline.title"), style: secSt },
        h(Head, null, t("pipeline.title")),
        h("div", { "data-molecullage-pipeline-actions": "true", style: { ...rw, marginBottom: 8 } },
          STG.map((sa) => btn(sa.label, () => emit(buildStagePrompt(sa, data, activeDomain)), false, { key: sa.id, "data-molecullage-stage-prompt": sa.id }))),
        h("ul", { style: ul0 }, pipe.stages.map((s) => h("li", { key: s.id, style: { ...rw, padding: "6px 0", borderTop: line, justifyContent: "space-between", gap: 8, alignItems: "baseline" } },
          h("span", null, s.label), h(Code, null, s.tool), h("span", { style: { ...muted, ...ml } }, t("pipeline.ready")))))) : null,
      data ? h("section", { "aria-label": t("notes.title"), style: { ...secSt, display: "grid", gap: 8 } },
        h(Head, null, t("notes.title")),
        onAction ? h("form", { onSubmit: (e) => { e?.preventDefault?.(); subNote("note"); }, style: g6 },
          ti(t("notes.placeholder"), "data-molecullage-note-input", t("notes.placeholder"), safeNd, upd(setNd, safeDd)),
          h("div", { style: rw },
            ti(t("notes.doiPlaceholder"), "data-molecullage-doi-input", t("notes.doiPlaceholder"), safeDd, upd(setDd, safeNd)),
            h("button", { type: "submit", disabled: !!busy || !safeNd.trim(), "data-molecullage-note-save": "true", style: btnStyle(true) }, t("notes.save")),
            btn(t("notes.retain"), () => subNote("retain"), false, { disabled: !!busy || !safeNd.trim(), "data-molecullage-note-retain": "true" }))) : null,
        notes.length > 0 ? h("ul", { "data-molecullage-notes": "true", style: ug },
          notes.slice(0, 8).map((n) => h("li", { key: n.id, style: liSt },
            h("div", { style: { overflowWrap: "anywhere" } }, n.text),
            h("div", { style: rw },
              n.doi ? h(Code, null, n.doi) : null,
              btn(t("chat.use"), () => emit(`Molecullage figure note${n.doi ? ` (${cl(n.doi, 80)})` : ""}: ${JSON.stringify(cl(n.text, 200))}`), false, { style: ml }),
              onAction ? btn(t("notes.remove"), () => onAction({ action: "delete-note", id: n.id })) : null)))) : null) : null);
  }

  function makePane(t) {
    return function MolecullagePane() {
      const [data, setData] = React.useState(null), [failed, setFailed] = React.useState(false), [actionError, setActionError] = React.useState("");
      const [query, setQuery] = React.useState(""), [domain, setDomain] = React.useState(""), [typingFocus, setTypingFocus] = React.useState(false), [hasDraft, setHasDraft] = React.useState(false), [busy, setBusy] = React.useState(false);
      const reqRef = React.useState(() => ({ current: 0 }))[0], paused = typingFocus || hasDraft || busy;
      const post = (u, b) => fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
      const load = async (q = query, d = domain) => {
        const req = ++reqRef.current;
        try {
          const p = {}; if (q) p.query = q; if (d) p.domain = d;
          const r = await post("api/arc-molecullage/state", p), j = r.ok ? await r.json() : null;
          if (req !== reqRef.current) return;
          if (j && j.ok) { setData(j); setFailed(false); } else setFailed(true);
        } catch { if (req === reqRef.current) setFailed(true); }
      };
      const dispatchAction = async (payload) => {
        reqRef.current += 1; setBusy(true); setActionError("");
        try {
          const r = await post("api/arc-molecullage/action", payload), j = r ? await r.json().catch(() => null) : null;
          if (r && r.ok && j && j.ok !== false) { if (payload?.action === "retain" && j.retained === false) setActionError(LOC_MSG); await load(query, domain); return j; }
          const err = (j && j.error) || "Action failed"; setActionError(err); return j || { ok: false, error: err };
        } catch { setActionError("Action failed"); return { ok: false, error: "Action failed" }; } finally { setBusy(false); }
      };
      React.useEffect(() => { let live = true; (async () => { if (live) await load("", ""); })(); return () => { live = false; }; }, []);
      React.useEffect(() => { if (paused) return undefined; const timer = setInterval(() => { load(query, domain); }, POLL_MS); return () => clearInterval(timer); }, [paused, query, domain]);
      return h(View, { data, failed, actionError, activeDomain: domain, paused, busy, onFilter: (q, d = domain) => { setQuery(q); load(q, d); }, onSelectDomain: (d) => { setDomain(d); load(query, d); }, onAction: dispatchAction, onRefresh: () => load(query, domain), onUseInChat: pushToChatComposer, onFocusChange: setTypingFocus, onDraftChange: setHasDraft, t });
    };
  }

  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { en, zh: en }), "arc-molecullage: dictionaries");
    const t = ctx.locale.bind(NS);
    const Pane = makePane(t);
    const Title = () => h(React.Fragment, null, h(Icon, { size: 16 }), h("span", null, t("tab.title")));
    ctx.inject(["sidebarRightTabs"], (c) => {
      const off = [];
      const keep = (f) => { if (typeof f === "function") off.push(f); };
      const tabs = c.sidebarRightTabs;
      if (!tabs || typeof tabs.register !== "function") return;
      try {
        keep(tabs.register({ id: TAB, kind: TAB, title: () => t("tab.title"), guide: [{ order: 35, title: () => t("tab.title"), description: () => t("tab.guide"), icon: Icon }] }));
        keep(c.slots.inject("sidebar.right.pane.tab", () => c.slots.register({ name: "sidebar.right.pane.tab", key: TAB, locale: NS }, Pane)));
        keep(c.slots.inject("sidebar.right.pane.tab.title", () => c.slots.register({ name: "sidebar.right.pane.tab.title", key: TAB }, Title)));
      } catch {
        for (const f of off) f();
        return;
      }
      return () => { for (const f of off) f(); };
    });
  }

  return { name: "arc-molecullage", inject: ["slots", "locale"], apply, View, Code, en, makePane, pushToChatComposer, buildStagePrompt };
} });
