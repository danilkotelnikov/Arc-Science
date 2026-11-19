/**
 * arc-core 0.1.0 (2026-11-09): Unified C2 console panel (Phase 1b.2-1b.3 & Phase 4.1-4.8).
 * Workspaces: Research, Memory, Molecullage, Prose.
 * Connectors: Servers, Keys, Apps, Audit, Updates; plus Settings.
 * Research session: 3-pane layout (Map, Claims, Evidence) + Release view,
 * Decision map (Pursue, Park, Drop, Request a test), validation ladder L1-L4
 * (with L5/L6 operator switches off by default), and 30-day consent dialog.
 */
window.__ModuleLoader__.load({ id: "arc-core", factory: (require) => {
  const React = require("react");
  const h = React.createElement;
  const NS = "arc-core", TAB = "arc-core-console";

  const WORKSPACES = ["Research", "Memory", "Molecullage", "Prose"];
  const CONNECTORS = ["Servers", "Keys", "Apps", "Audit", "Updates"];
  const SEATS = ["Planner", "Reviewer", "Falsifier", "Vision", "Prose"];
  const RESEARCH_VIEWS = ["Map", "Claims", "Evidence", "Release"];
  const DECISION_ACTIONS = ["Pursue", "Park", "Drop", "Request a test"];
  const CONSENT_MODES = ["Single action", "Grant for 30 days", "Revoke"];
  const THEMES = [
    { id: "arc", label: "Arc Harness" },
    { id: "v0", label: "Black and white" },
    { id: "radium", label: "Radium" },
  ];

  const en = {
    "tab.title": "Arc console",
    "tab.guide": "Unified console for Research, Memory, Molecullage, Prose, connectors and Settings.",
    "state.loading": "Loading console…",
    "state.error": "Could not read the console state.",
    "nav.workspaces": "Workspaces",
    "nav.connectors": "Connectors",
    "nav.settings": "Settings",
    "research.panes": "Research session",
    "research.seats": "Active seats",
    "research.map": "Map",
    "research.claims": "Claims",
    "research.evidence": "Evidence",
    "research.release": "Release",
    "research.decisions": "Decision map",
    "research.ladder": "Validation ladder",
    "research.ledger": "Live session ledger",
    "connector.servers": "Connector servers",
    "connector.keys": "Connector keys",
    "connector.apps": "Connector apps",
    "connector.audit": "Connector audit",
    "connector.updates": "Updates",
    "updates.installed": "Installed",
    "updates.latest": "Latest",
    "updates.mode": "Update mode",
    "updates.off": "Off",
    "updates.notify": "Notify",
    "updates.auto": "Auto",
    "updates.check": "Check now",
    "updates.install": "Update now",
    "updates.rollback": "Roll back",
    "updates.notes": "Release notes",
    "updates.progress": "Update progress",
    "updates.hint.mode": "Off never looks for updates. Notify looks and tells you here. Auto also installs them. A manual check and a manual update work in every mode.",
    "updates.hint.scope": "An update replaces the Arc plugins and the gateway and validator programs. Your data, keys and conversations stay where they are. The app itself is not changed.",
    "updates.hint.checksum": "The checksum file comes from the same release as the download. It proves the download is complete, not who built it.",
    "updates.hint.rollback": "Roll back puts the previous plugins and programs back. Auto mode then skips the version you rolled back from.",
    "updates.hint.restart": "Updated programs start with the next launch. Arc Harness never closes itself.",
    "updates.status.unknown": "Not checked yet.",
    "updates.status.current": "You are up to date.",
    "updates.status.ready": "Version {v} is ready to install.",
    "updates.status.nokit": "Version {v} has no installable kit yet.",
    "updates.status.restart": "Restart Arc Harness to finish the update.",
    "updates.why.install": "Update now needs a newer release with an installable kit.",
    "updates.why.busy": "An update is running.",
    "consent.title": "Connector consent",
    "consent.prompt": "Choose access duration for {appId}",
    "memory.title": "Shared memory gateway",
    "memory.recall": "Recall",
    "molecullage.title": "Molecullage studio shelf",
    "molecullage.filter": "Filter sources",
    "prose.title": "Plain prose check",
    "prose.clean": "Clean plain prose",
    "prose.flagged": "Formulaic phrasing detected",
    "prose.rewrite": "Rewrite locally",
    "prose.apply": "Check text",
    "action.refresh": "Refresh",
    "note.title": "Owner notes",
    "note.placeholder": "Add an owner note or constraint",
    "note.save": "Save note",
    "note.retain": "Save and retain",
    "verdict.approve": "Approve",
    "verdict.revise": "Revise",
    "verdict.hold": "Hold",
    "chat.use": "Use in chat",
    "chat.ready": "Prompt ready in composer",
    "chat.copied": "Prompt copied",
    "chat.failed": "Could not insert or copy prompt",
    "molecullage.pin": "Pin",
    "molecullage.pinned": "Pinned",
    "settings.title": "Console settings",
    "settings.theme": "Active theme",
    "settings.switches": "Operator switches",
  };

  const TEXT_FONT = "var(--arc-font-family-text-default, \"Geist\", system-ui, sans-serif)";
  const MONO_FONT = "var(--arc-font-family-code-default, \"Geist Mono\", ui-monospace, monospace)";
  const HAIRLINE = "1px solid var(--dsw-alias-line-divider, color-mix(in srgb, currentColor 14%, transparent))";
  const SURFACE = "var(--dsw-alias-bg-base, transparent)";
  const INK = "var(--dsw-alias-label-primary, currentColor)";
  const RADIUS = "var(--dsw-radius-sm, 8px)";
  const num = { fontVariantNumeric: "tabular-nums" };
  const muted = { opacity: 0.68 };

  const btnStyle = (active) => ({
    fontFamily: TEXT_FONT,
    fontSize: 12,
    lineHeight: 1.35,
    padding: "4px 10px",
    borderRadius: RADIUS,
    border: "none",
    cursor: "pointer",
    color: active ? "var(--dsw-alias-bg-base, currentColor)" : INK,
    background: active
      ? "var(--dsw-alias-button-info-fill, color-mix(in srgb, currentColor 88%, transparent))"
      : "color-mix(in srgb, currentColor 8%, transparent)",
    fontWeight: active ? 600 : 400,
  });

  const tagStyle = {
    fontFamily: MONO_FONT,
    fontSize: 11,
    padding: "1px 6px",
    borderRadius: RADIUS,
    background: "color-mix(in srgb, currentColor 8%, transparent)",
    ...num,
  };

  const inputStyle = {
    fontFamily: TEXT_FONT,
    fontSize: 12,
    lineHeight: 1.4,
    padding: "5px 8px",
    color: INK,
    background: "color-mix(in srgb, currentColor 6%, transparent)",
    border: "none",
    borderBottom: HAIRLINE,
    borderRadius: 0,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  function Icon({ size = 16 }) {
    return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true },
      h("circle", { cx: 12, cy: 12, r: 8.5 }),
      h("path", { d: "M12 3.5v17M3.5 12h17" }));
  }

  function pushToChatComposer(pt, setFb, t) {
    const text = String(pt || "").trim(), g = globalThis, D = g.document, N = g.navigator?.clipboard;
    if (!text) return false;
    let cp = null, ins = false;
    try { if (typeof N?.writeText === "function") cp = Promise.resolve(N.writeText(text)).then(() => true, () => false); } catch {}
    try {
      const elig = Array.from(D?.querySelectorAll?.("textarea, [contenteditable=\"true\"]") || []).filter((e) => e && !e.disabled && !e.readOnly && !e.closest?.("[data-arc-plugin-pane=\"true\"]"));
      const el = elig.find((e) => e.offsetParent !== null) || elig[0];
      if (el) {
        const app = (c) => (String(c || "").trim() ? String(c).replace(/\s+$/, "") + "\n\n" + text : text);
        if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
          const ctor = el.tagName === "INPUT" ? g.HTMLInputElement : g.HTMLTextAreaElement, s = ctor ? Object.getOwnPropertyDescriptor(ctor.prototype, "value")?.set : null, next = app(el.value);
          if (s) s.call(el, next); else el.value = next;
          if (g.Event) el.dispatchEvent?.(new g.Event("input", { bubbles: true })); el.focus?.(); ins = true;
        } else if (el.isContentEditable || el.getAttribute?.("contenteditable") === "true") {
          const lx = el.__lexicalEditor, cm = el.cmTile?.root?.view || el.cmView?.view || el.closest?.(".cm-editor")?.cmView?.view;
          if (lx?.parseEditorState && lx?.setEditorState) {
            const p0 = (l) => ({ children: l ? [{ detail: 0, format: 0, mode: "normal", style: "", text: l, type: "text", version: 1 }] : [], direction: null, format: "", indent: 0, type: "paragraph", version: 1, textFormat: 0, textStyle: "" });
            const pv = lx.getEditorState?.()?.toJSON?.(), pc = pv?.root?.children, add = text.split(/\n/).map(p0);
            const ch = Array.isArray(pc) && (String(el.textContent || "").trim() || pc.some((n) => n?.type !== "paragraph" || n.children?.length > 0)) ? [...pc, p0(""), ...add] : add;
            lx.setEditorState(lx.parseEditorState(JSON.stringify({ root: pv?.root ? { ...pv.root, children: ch } : { children: ch, direction: null, format: "", indent: 0, type: "root", version: 1 } }))); lx.focus?.();
          } else if (cm?.dispatch && cm.state?.doc) {
            const s = cm.state.doc.toString(), h0 = !!s.trim(), add = h0 ? "\n\n" + text : text, f = h0 ? s.length : 0;
            cm.dispatch({ changes: { from: f, to: s.length, insert: add }, selection: { anchor: f + add.length } }); cm.focus?.();
          } else {
            if (String(el.textContent || "").trim() && typeof el.append === "function" && typeof D?.createElement === "function") el.append(D.createElement("br"), D.createElement("br"), text);
            else el.textContent = app(el.textContent);
            if (g.Event) el.dispatchEvent?.(new g.Event("input", { bubbles: true })); el.focus?.();
          }
          ins = true;
        }
      }
    } catch { ins = false; }
    if (typeof setFb === "function") {
      if (ins) setFb(t("chat.ready")); else if (cp) cp.then((ok) => setFb(ok ? t("chat.copied") : t("chat.failed"))); else setFb(t("chat.failed"));
    }
    return ins;
  }

  function ConsentDialog({ pendingConsent, onConsent, onClose, t }) {
    if (!pendingConsent) return null;
    const scopesText = (pendingConsent.scopes || []).join(", ") || "read";
    return h("div", {
      role: "dialog",
      "aria-modal": true,
      "aria-label": t("consent.title"),
      "data-arc-consent-dialog": "true",
      style: {
        padding: "12px 0",
        borderTop: HAIRLINE,
        borderBottom: HAIRLINE,
        display: "grid",
        gap: 8,
      },
    },
      h("div", { style: { fontWeight: 600, fontSize: 13 } }, t("consent.title")),
      h("p", { style: { margin: 0, ...muted } }, t("consent.prompt", { appId: pendingConsent.appId })),
      h("div", { style: { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" } },
        h("span", { style: muted }, "Scopes:"),
        h("code", { style: tagStyle }, scopesText),
        h("span", { style: { ...muted, ...num } }, "Window: 30 days")),
      h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
        CONSENT_MODES.map((mode) =>
          h("button", {
            key: mode,
            type: "button",
            "data-consent-mode": mode,
            onClick: () => onConsent && onConsent({ appId: pendingConsent.appId, scopes: pendingConsent.scopes || ["read"], mode }),
            style: btnStyle(mode === "Grant for 30 days"),
          }, mode)),
        onClose ? h("button", { type: "button", onClick: onClose, style: btnStyle(false) }, "Close") : null));
  }

  // ---- Updates connector: plugins and native programs, from GitHub releases (arc-core/lib/updater.js)
  const UPDATE_PHASES = ["downloading", "verifying", "staging", "installing", "testing", "done"];
  const UPDATE_PHASE_LABEL = { downloading: "Download", verifying: "Verify", staging: "Stage", installing: "Install", testing: "Test", done: "Done" };
  const UPDATE_MODES = ["off", "notify", "auto"];
  const UPDATE_CSS = ".arc-upd button:focus-visible,.arc-upd summary:focus-visible{outline:2px solid currentColor;outline-offset:2px}" +
    ".arc-upd button:disabled{opacity:.5;cursor:not-allowed}.arc-upd pre{white-space:pre-wrap;margin:0;font-family:inherit}";
  // the C2 primary pair (dark brown on paper, cream on the dark canvas) from the theme tokens
  const upBtn = (active) => ({
    ...btnStyle(false),
    ...(active ? { background: "var(--dsw-alias-brand-primary-new-colorprimary-new-color, currentColor)", color: "var(--dsw-alias-bg-base, Canvas)", fontWeight: 600 } : {}),
  });
  const clampLine = (s, n = 90) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

  function Hint({ label, text }) {
    const [open, setOpen] = React.useState(false);
    return h("span", { style: { position: "relative", display: "inline-block" } },
      h("button", {
        type: "button", "aria-label": label, "aria-expanded": open, "data-hint": "true",
        onClick: () => setOpen(!open),
        style: { ...btnStyle(false), padding: "0 6px", borderRadius: "50%", fontSize: 11, lineHeight: "16px" },
      }, "?"),
      open ? h("span", { role: "note", style: { position: "absolute", left: 0, top: "calc(100% + 4px)", zIndex: 5, width: 260, padding: "8px 10px", fontSize: 12, lineHeight: 1.45, background: SURFACE, color: INK, border: HAIRLINE, borderRadius: RADIUS, boxShadow: "0 2px 10px color-mix(in srgb, currentColor 18%, transparent)" } }, text) : null);
  }

  function updateStatus(u, error, t) {
    if (error) return error;
    if (u.phase === "failed" || u.phase === "rolled-back") return u.message || "";
    if (u.busy && u.message) return u.message;
    if (u.restartNeeded) return t("updates.status.restart");
    if (!u.latest) return u.message || t("updates.status.unknown");
    if (u.available && u.installable) return t("updates.status.ready", { v: u.latest });
    if (u.available) return t("updates.status.nokit", { v: u.latest });
    return t("updates.status.current");
  }

  function UpdatesView({ info, error, pending, onAction, t }) {
    const u = info || { installed: "", latest: null, available: false, installable: false, mode: "notify", phase: "idle", busy: false, hasBackup: false, notes: "" };
    const busy = Boolean(u.busy || pending);
    const canInstall = Boolean(u.available && u.installable && !busy);
    const canRollback = Boolean(u.hasBackup && !busy);
    const status = updateStatus(u, error, t);
    const idx = UPDATE_PHASES.indexOf(u.phase);
    const showSteps = idx >= 0 || u.busy;
    const why = busy ? t("updates.why.busy") : !canInstall && !u.available ? t("updates.why.install") : "";
    const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
    return h("section", { className: "arc-upd", "aria-label": t("connector.updates"), "data-connector-view": "Updates", style: { display: "grid", gap: 12, fontFamily: TEXT_FONT, fontSize: 13, color: INK } },
      h("style", null, UPDATE_CSS),
      h("div", { style: { ...row, justifyContent: "space-between" } },
        h("h3", { style: { fontSize: 13, fontWeight: 600, margin: 0 } }, t("connector.updates")),
        h("span", { style: row }, h(Hint, { label: "About what an update replaces", text: t("updates.hint.scope") }), h(Hint, { label: "About the checksum", text: t("updates.hint.checksum") }))),
      h("div", { style: row, "data-updates-versions": "true" },
        h("span", { style: muted }, `${t("updates.installed")}:`), h("code", { style: tagStyle }, u.installed || "unknown"),
        h("span", { style: muted }, `${t("updates.latest")}:`), h("code", { style: tagStyle }, u.latest || "not checked")),
      h("div", { style: row, ...(u.restartNeeded ? { "data-updates-restart": "true" } : {}) },
        h("p", { role: "status", "data-updates-status": "true", title: status, style: { margin: 0, fontSize: 12, opacity: 0.85, fontWeight: u.restartNeeded ? 600 : 400 } }, clampLine(status)),
        u.restartNeeded ? h(Hint, { label: "About restarting", text: t("updates.hint.restart") }) : null),
      h("div", { style: row, role: "group", "aria-label": t("updates.mode") },
        h("span", { style: muted }, `${t("updates.mode")}:`),
        UPDATE_MODES.map((m) => h("button", { key: m, type: "button", "data-update-mode": m, "aria-pressed": u.mode === m, onClick: () => onAction && onAction({ kind: "mode", mode: m }), style: upBtn(u.mode === m) }, t(`updates.${m}`))),
        h(Hint, { label: "About update modes", text: t("updates.hint.mode") })),
      h("div", { style: row },
        h("button", { type: "button", "data-update-check": "true", disabled: busy, onClick: () => onAction && onAction({ kind: "check" }), style: btnStyle(false) }, t("updates.check")),
        h("button", { type: "button", "data-update-install": "true", disabled: !canInstall, onClick: () => onAction && onAction({ kind: "install" }), style: upBtn(canInstall) }, t("updates.install")),
        h("button", { type: "button", "data-update-rollback": "true", disabled: !canRollback, onClick: () => onAction && onAction({ kind: "rollback" }), style: btnStyle(false) }, t("updates.rollback")),
        h(Hint, { label: "About rolling back", text: t("updates.hint.rollback") })),
      why ? h("p", { "data-updates-why": "true", style: { margin: 0, fontSize: 12, opacity: 0.68 } }, clampLine(why)) : null,
      showSteps
        ? h("div", { "data-updates-progress": "true", style: { display: "grid", gap: 6 } },
            h("div", { role: "progressbar", "aria-label": t("updates.progress"), "aria-valuemin": 0, "aria-valuemax": UPDATE_PHASES.length, "aria-valuenow": Math.max(idx + 1, 0), style: { height: 4, borderRadius: 2, background: "color-mix(in srgb, currentColor 14%, transparent)", overflow: "hidden" } },
              h("div", { style: { height: "100%", width: `${Math.round(((Math.max(idx, -1) + 1) / UPDATE_PHASES.length) * 100)}%`, background: "var(--dsw-alias-brand-primary-new-colorprimary-new-color, currentColor)" } })),
            h("ol", { style: { display: "flex", gap: 10, flexWrap: "wrap", margin: 0, padding: 0, listStyle: "none", fontSize: 12 } },
              UPDATE_PHASES.map((ph, i) => h("li", { key: ph, "aria-current": i === idx ? "step" : undefined, style: { fontWeight: i === idx ? 600 : 400, opacity: i <= idx ? 1 : 0.68 } }, UPDATE_PHASE_LABEL[ph]))))
        : null,
      u.notes ? h("details", { "data-updates-notes": "true", style: { borderTop: HAIRLINE, paddingTop: 8 } }, h("summary", { style: { cursor: "pointer", fontWeight: 600, fontSize: 12 } }, t("updates.notes")), h("pre", { style: { marginTop: 6, fontSize: 12, opacity: 0.85 } }, u.notes)) : null);
  }

  function UpdatesPanel({ t }) {
    const [info, setInfo] = React.useState(null);
    const [error, setError] = React.useState("");
    const [pending, setPending] = React.useState(false);
    const post = async (route, body) => {
      const r = await fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
      return r.json().catch(() => null);
    };
    const load = async () => {
      try { const j = await post("api/arc-core/update/state"); if (j && j.ok) { setInfo(j); setError(""); } else setError((j && j.error) || "Could not read the update state."); } catch { setError("Could not read the update state."); }
    };
    const act = async (payload) => {
      setError(""); setPending(true);
      try { const j = await post("api/arc-core/update/action", payload); if (!j || j.ok === false) setError((j && j.error) || "The action failed."); } catch { setError("The action failed."); }
      setPending(false);
      await load();
    };
    const busy = Boolean(info && info.busy);
    React.useEffect(() => {
      load();
      const id = setInterval(load, busy ? 1200 : 15000);
      return () => clearInterval(id);
    }, [busy]);
    return h(UpdatesView, { info, error, pending, onAction: act, t });
  }

  function ConnectorView({ connector, detail, onOpenConsent, t }) {
    if (connector === "Updates") return h(UpdatesPanel, { t });
    const rows = (detail && detail[connector]) || [];
    const titleKey = `connector.${String(connector || "servers").toLowerCase()}`;
    return h("section", {
      "aria-label": t(titleKey),
      "data-connector-view": connector,
      style: { display: "grid", gap: 10 },
    },
      h("h3", { style: { fontSize: 13, fontWeight: 600, margin: 0 } }, t(titleKey)),
      h("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 } },
        rows.map((item) =>
          h("li", { key: item.id, style: { paddingTop: 8, borderTop: HAIRLINE, display: "grid", gap: 4 } },
            connector === "Servers"
              ? h(React.Fragment, null,
                  h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" } },
                    h("span", { style: { fontWeight: 600 } }, item.label),
                    h("code", { style: tagStyle }, item.endpoint)),
                  h("span", { style: { ...muted, fontSize: 12 } }, item.status))
              : null,
            connector === "Keys"
              ? h(React.Fragment, null,
                  h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" } },
                    h("span", { style: { fontWeight: 600 } }, item.label),
                    h("code", { style: tagStyle }, item.ref)),
                  h("span", { style: { ...muted, fontSize: 12 } }, item.status))
              : null,
            connector === "Apps"
              ? h(React.Fragment, null,
                  h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" } },
                    h("span", { style: { fontWeight: 600 } }, item.label),
                    h("code", { style: tagStyle }, `Active grants: ${item.grants}`)),
                  h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" } },
                    h("span", { style: { ...muted, fontSize: 12 } }, `Scopes: ${(item.scopes || []).join(", ")}`),
                    onOpenConsent
                      ? h("button", {
                          type: "button",
                          "data-connector-consent": item.id,
                          onClick: () => onOpenConsent({ appId: `${item.id}-connector`, scopes: item.scopes || ["read"] }),
                          style: btnStyle(false),
                        }, "Review access")
                      : null))
              : null,
            connector === "Audit"
              ? h(React.Fragment, null,
                  h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" } },
                    h("span", { style: { fontWeight: 600 } }, item.summary),
                    h("code", { style: tagStyle }, item.kind)),
                  h("span", { style: { ...muted, ...num, fontSize: 12 } }, `Recorded at ${item.atMs}`))
              : null))));
  }

  function ResearchWorkspace({
    data,
    activeView,
    onSelectView,
    onDecision,
    onAddNote,
    onAnnotateVerdict,
    onUseInChat,
    t,
  }) {
    const [noteDraft, setNoteDraft] = React.useState("");
    const [noteTarget, setNoteTarget] = React.useState("");
    const safeNote = noteDraft || "";
    const safeTarget = noteTarget || "session";
    const branches = (data && data.tree && data.tree.branches) || [];
    const claims = (data && data.claims && data.claims.items) || [];
    const evidence = (data && data.evidence && data.evidence.items) || [];
    const ladder = (data && data.head && data.head.ladderRungs) || [];
    const seats = (data && data.head && data.head.seatAssignments) || SEATS.map((seat) => ({ seat, role: "" }));
    const release = data && data.release;
    const verdicts = (data && data.verdicts) || {};
    const notes = (data && data.notes && data.notes.items) || [];
    const REVIEW_VERDICTS = [{ value: "Approve", label: t("verdict.approve") }, { value: "Revise", label: t("verdict.revise") }, { value: "Hold", label: t("verdict.hold") }];
    const mkBtn = (label, onClick, active = false, extra = {}) => h("button", { type: "button", onClick, style: btnStyle(active), ...extra }, label);
    const didSucceed = (res) => res !== false && res != null && (typeof res !== "object" || res.ok !== false);
    const rowWrap = { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" };
    const submitNote = async (retain) => {
      const txt = safeNote.trim();
      if (!txt || !onAddNote) return;
      const sub = safeNote;
      try { const res = await onAddNote({ targetType: safeTarget === "session" ? "session" : "branch", targetId: safeTarget, text: txt, retain }); if (didSucceed(res)) setNoteDraft((c) => (c === sub ? "" : c)); } catch {}
    };

    return h("section", { "aria-label": t("research.panes"), style: { display: "grid", gap: 12 } },
      h("div", { "data-research-seats": "true", "aria-label": t("research.seats"), style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline" } },
        h("span", { style: { ...muted, fontSize: 12 } }, `${t("research.seats")}:`),
        seats.map((entry) => h("code", { key: entry.seat, "data-seat": entry.seat, style: tagStyle }, entry.seat))),

      h("div", { role: "tablist", "aria-label": "Research views", style: { display: "flex", gap: 6, flexWrap: "wrap", paddingBottom: 8, borderBottom: HAIRLINE } },
        RESEARCH_VIEWS.map((view) => mkBtn(view, () => onSelectView && onSelectView(view), activeView === view, { key: view, role: "tab", "aria-selected": activeView === view, "data-research-view": view }))),

      activeView === "Release" && release
        ? h("div", { "data-pane": "Release", style: { paddingTop: 4, display: "grid", gap: 6 } },
            h("div", { style: { fontWeight: 600 } }, "Release gate"),
            h("div", { style: num }, `Verdict: ${release.verdict}, candidate: ${release.candidateHash}, nested boxes: ${release.nestedBoxes}`),
            h("div", { style: muted }, release.proseOk ? "Prose check clean" : "Prose check has findings"),
            verdicts["release:candidate"] ? h("div", { style: { fontSize: 12 } }, `Owner verdict: ${verdicts["release:candidate"].verdict}`) : null,
            h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
              onAnnotateVerdict ? REVIEW_VERDICTS.map((rv) => mkBtn(rv.label, () => onAnnotateVerdict({ targetType: "release", targetId: "candidate", verdict: rv.value }), verdicts["release:candidate"] && verdicts["release:candidate"].verdict === rv.value, { key: rv.value, "data-verdict-action": rv.value, "data-target-id": "candidate" })) : null,
              onUseInChat ? mkBtn(t("chat.use"), () => onUseInChat(`Review release gate (${release.verdict}, candidate ${release.candidateHash}, nested boxes ${release.nestedBoxes})`), false, { "data-use-chat": "release" }) : null))
        : h("div", { "data-research-three-pane": "true", style: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16, alignItems: "start" } },
            h("div", { "data-pane": "Map", style: { display: "grid", gap: 8 } },
              h("h3", { style: { fontSize: 13, fontWeight: 600, margin: 0 } }, t("research.map")),
              h("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 } },
                branches.map((b) => {
                  const branchReview = verdicts[`branch:${b.id}`];
                  return h("li", { key: b.id, "data-branch": b.id, style: { paddingTop: 8, borderTop: HAIRLINE, display: "grid", gap: 6 } },
                    h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" } },
                      h("span", { style: { fontWeight: 600 } }, b.title),
                      h("code", { style: tagStyle }, b.rung)),
                    h("div", { style: { ...muted, ...num, fontSize: 12 } },
                      `Support: ${b.supportLogLR}, value per cost: ${b.voiPerCost}, selected: ${b.decision}${branchReview ? `, owner: ${branchReview.verdict}` : ""}`),
                    h("div", { "aria-label": t("research.decisions"), style: { display: "flex", gap: 4, flexWrap: "wrap" } },
                      DECISION_ACTIONS.map((act) => mkBtn(act, () => onDecision && onDecision({ branchId: b.id, action: act }), b.decision === act, { key: act, "data-decision-action": act, "data-branch-id": b.id }))),
                    h("div", { style: { display: "flex", gap: 4, flexWrap: "wrap" } },
                      onAnnotateVerdict ? REVIEW_VERDICTS.map((rv) => mkBtn(rv.label, () => onAnnotateVerdict({ targetType: "branch", targetId: b.id, verdict: rv.value }), Boolean(branchReview && branchReview.verdict === rv.value), { key: rv.value, "data-verdict-action": rv.value, "data-branch-id": b.id })) : null,
                      onUseInChat ? mkBtn(t("chat.use"), () => onUseInChat(`Branch "${b.title}" (${b.id}, rung ${b.rung}, decision ${b.decision}, support ${b.supportLogLR})`), false, { "data-use-chat": `branch:${b.id}` }) : null));
                }))),

            h("div", { "data-pane": "Claims", style: { paddingLeft: 12, borderLeft: HAIRLINE, display: "grid", gap: 8 } },
              h("h3", { style: { fontSize: 13, fontWeight: 600, margin: 0 } }, t("research.claims")),
              h("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 } },
                claims.map((c) =>
                  h("li", { key: c.id, style: { paddingTop: 8, borderTop: HAIRLINE, display: "grid", gap: 4 } },
                    h("span", null, c.text),
                    h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline" } },
                      h("code", { style: tagStyle }, c.level),
                      h("code", { style: tagStyle }, c.rung),
                      h("span", { style: { ...muted, fontSize: 12 } }, c.source),
                      onUseInChat ? mkBtn(t("chat.use"), () => onUseInChat(`Claim [${c.level}, ${c.rung}]: ${c.text} (source: ${c.source})`), false, { "data-use-chat": `claim:${c.id}` }) : null))))),

            h("div", { "data-pane": "Evidence", style: { paddingLeft: 12, borderLeft: HAIRLINE, display: "grid", gap: 8 } },
              h("h3", { style: { fontSize: 13, fontWeight: 600, margin: 0 } }, t("research.evidence")),
              h("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 } },
                evidence.map((ev) =>
                  h("li", { key: ev.id, style: { paddingTop: 8, borderTop: HAIRLINE, display: "grid", gap: 4 } },
                    h("span", { style: { fontWeight: 600 } }, ev.ref),
                    h("span", { style: { ...muted, ...num, fontSize: 12 } }, `${ev.kind}, verified ${ev.verified}`)))),
              h("div", { style: { paddingTop: 8, borderTop: HAIRLINE, display: "grid", gap: 4 } },
                h("div", { style: { fontWeight: 600, fontSize: 12 } }, t("research.ladder")),
                h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
                  ladder.filter((r) => r.active).map((r) => h("code", { key: r.id, style: tagStyle }, `${r.id} ${r.label}`)))))),

      h("div", { "data-console-notes": "true", style: { paddingTop: 8, borderTop: HAIRLINE, display: "grid", gap: 6 } },
        h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" } },
          h("span", { style: { fontWeight: 600, fontSize: 12 } }, t("note.title")), h("code", { style: tagStyle }, `${notes.length} notes`)),
        onAddNote ? h("form", { onSubmit: (e) => { e?.preventDefault?.(); submitNote(false); }, style: rowWrap },
          h("select", { "aria-label": "Note target", "data-console-note-target": "true", value: safeTarget, onChange: (e) => setNoteTarget(e.target.value), style: { ...inputStyle, width: "auto" } },
            h("option", { value: "session" }, "session"), branches.map((b) => h("option", { key: b.id, value: b.id }, b.id))),
          h("input", { type: "text", "aria-label": t("note.title"), "data-console-note-input": "true", placeholder: t("note.placeholder"), value: safeNote, onChange: (e) => setNoteDraft(e.target.value), style: { ...inputStyle, flex: 1, minWidth: 160 } }),
          h("button", { type: "submit", "data-console-note-save": "true", style: btnStyle(true) }, t("note.save")),
          mkBtn(t("note.retain"), () => submitNote(true), false, { "data-console-note-retain": "true" })) : null,
        notes.length > 0 ? h("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 4 } },
          notes.slice(-5).reverse().map((n) => h("li", { key: n.id, style: { ...rowWrap, alignItems: "baseline", fontSize: 12 } },
            h("code", { style: tagStyle }, n.targetId || "session"), n.verdict ? h("code", { style: tagStyle }, n.verdict) : null, h("span", null, n.text)))) : null),

      data && data.liveLedger && data.liveLedger.available
        ? h("div", { "data-live-ledger": "true", style: { paddingTop: 8, borderTop: HAIRLINE, display: "grid", gap: 6 } },
            h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" } },
              h("span", { style: { fontWeight: 600, fontSize: 12 } }, t("research.ledger")),
              h("code", { style: tagStyle }, `${data.liveLedger.total} entries`)),
            h("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 4 } },
              (data.liveLedger.recent || []).slice(-3).map((ev, idx) =>
                h("li", { key: `${ev.seq ?? idx}`, style: { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 12 } },
                  h("code", { style: tagStyle }, ev.type),
                  h("span", { style: muted }, ev.caller),
                  h("span", null, ev.goal)))))
        : null);
  }

  function View({
    data,
    failed,
    actionError = "",
    skin = "arc",
    pendingConsent = null,
    onSelectWorkspace,
    onSelectResearchView,
    onSelectConnector,
    onToggleSettings,
    onDecision,
    onAddNote,
    onAnnotateVerdict,
    onPinSource,
    onUseInChat,
    onConsent,
    onCloseConsent,
    onOpenConsent,
    onProseChange,
    onProseRewrite,
    onToggleSwitch,
    onSearchMemory,
    onSearchMolecullage,
    onRefresh,
    t,
  }) {
    const [memoryDraft, setMemoryDraft] = React.useState("");
    const [molecullageDraft, setMolecullageDraft] = React.useState("");
    const [proseDraft, setProseDraft] = React.useState(null);
    const [chatStatus, setChatStatus] = React.useState("");
    const safeMemoryDraft = memoryDraft || "";
    const safeMolecullageDraft = molecullageDraft || "";
    const handleUseInChat = (promptText) => {
      pushToChatComposer(promptText, setChatStatus, t);
      if (typeof onUseInChat === "function") onUseInChat(promptText);
    };
    const head = data && data.head;
    const activeWorkspace = (head && head.activeWorkspace) || "Research";
    const activeView = (head && head.activeResearchView) || "Map";
    const activeConnector = (head && head.activeConnector) || "Servers";
    const activePaneMode = (head && head.activePaneMode) || "workspace";
    const settingsOpen = Boolean(head && head.settingsOpen);
    const inConnectorMode = !settingsOpen && activePaneMode === "connector";
    const inWorkspaceMode = !settingsOpen && !inConnectorMode;
    const themeEntry = THEMES.find((x) => x.id === skin) || THEMES[0];

    return h("div", {
      "data-arc-console": "c2",
      "data-arc-plugin-pane": "true",
      "data-arc-skin": themeEntry.id,
      style: {
        padding: 14,
        fontFamily: TEXT_FONT,
        fontSize: 13,
        lineHeight: 1.45,
        color: INK,
        background: SURFACE,
        height: "100%",
        boxSizing: "border-box",
        display: "grid",
        gap: 14,
        alignContent: "start",
      },
    },
      !data && !failed ? h("p", { style: { ...muted, margin: 0 } }, t("state.loading")) : null,
      failed && !data ? h("p", { role: "alert", style: { ...muted, margin: 0 } }, t("state.error")) : null,

      data ? h("header", { style: { display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", paddingBottom: 10, borderBottom: HAIRLINE } },
        h("nav", { "aria-label": t("nav.workspaces"), style: { display: "flex", gap: 6, flexWrap: "wrap" } },
          WORKSPACES.map((ws) => {
            const isActive = inWorkspaceMode && activeWorkspace === ws;
            return h("button", {
              key: ws,
              type: "button",
              "data-workspace": ws,
              "aria-pressed": isActive,
              onClick: () => onSelectWorkspace && onSelectWorkspace(ws),
              style: btnStyle(isActive),
            }, ws);
          })),
        h("div", { "aria-label": t("nav.connectors"), style: { display: "flex", gap: 6, flexWrap: "wrap" } },
          CONNECTORS.map((conn) => {
            const isActive = inConnectorMode && activeConnector === conn;
            return h("button", {
              key: conn,
              type: "button",
              "data-connector": conn,
              "aria-pressed": isActive,
              onClick: () => onSelectConnector && onSelectConnector(conn),
              style: btnStyle(isActive),
            }, conn === "Updates" && data.update && data.update.available && data.update.latest ? `Updates (${data.update.latest})` : conn);
          }),
          h("button", {
            type: "button",
            "data-settings-toggle": "true",
            "aria-pressed": settingsOpen,
            onClick: () => onToggleSettings && onToggleSettings(!settingsOpen),
            style: btnStyle(settingsOpen),
          }, t("nav.settings")),
          onRefresh
            ? h("button", {
                type: "button",
                "data-refresh-console": "true",
                onClick: () => onRefresh(),
                style: btnStyle(false),
              }, t("action.refresh"))
            : null)) : null,

      h(ConsentDialog, { pendingConsent, onConsent, onClose: onCloseConsent, t }),

      chatStatus ? h("div", { "data-chat-status": "true", style: { ...muted, fontSize: 12 } }, chatStatus) : null,
      actionError ? h("p", { role: "alert", "data-console-action-error": "true", style: { ...muted, margin: 0, fontSize: 12 } }, actionError) : null,

      data && settingsOpen
        ? h("section", { "aria-label": t("settings.title"), style: { display: "grid", gap: 10 } },
            h("h3", { style: { fontSize: 13, fontWeight: 600, margin: 0 } }, t("settings.title")),
            h("div", { style: { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" } },
              h("span", { style: muted }, `${t("settings.theme")}:`),
              h("span", { style: { fontWeight: 600 } }, themeEntry.label)),
            h("div", { style: { paddingTop: 8, borderTop: HAIRLINE, display: "grid", gap: 6 } },
              h("div", { style: { fontWeight: 600, fontSize: 12 } }, t("settings.switches")),
              ((head && head.ladderRungs) || []).filter((r) => r.id === "L5" || r.id === "L6").map((r) =>
                h("div", { key: r.id, style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 } },
                  h("span", null, `${r.id} ${r.label}`),
                  h("button", {
                    type: "button",
                    "data-operator-switch": r.id,
                    "aria-pressed": r.active,
                    onClick: () => onToggleSwitch && onToggleSwitch(r.id, !r.active),
                    style: btnStyle(r.active),
                  }, r.active ? "On" : "Off")))))
        : null,

      data && inConnectorMode
        ? h(ConnectorView, {
            connector: activeConnector,
            detail: data.connectorsDetail,
            onOpenConsent,
            t,
          })
        : null,

      data && inWorkspaceMode && activeWorkspace === "Research"
        ? h(ResearchWorkspace, {
            data,
            activeView,
            onSelectView: onSelectResearchView,
            onDecision,
            onAddNote,
            onAnnotateVerdict,
            onUseInChat: handleUseInChat,
            t,
          })
        : null,

      data && inWorkspaceMode && activeWorkspace === "Memory"
        ? h("section", { "aria-label": t("memory.title"), style: { display: "grid", gap: 8 } },
            h("h3", { style: { fontSize: 13, fontWeight: 600, margin: 0 } }, t("memory.title")),
            h("div", { style: num }, `Loopback gateway: ${data.memory.gateway}, status: ${data.memory.reachable ? "online" : "offline"}`),
            (data.memory.routes || []).length > 0
              ? h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
                  data.memory.routes.map((r) => h("code", { key: r, style: tagStyle }, r)))
              : null,
            h("div", { style: muted }, `Policy labels: ${data.memory.labels.join(", ")}`),
            onSearchMemory
              ? h("form", {
                  onSubmit: (e) => {
                    if (e && typeof e.preventDefault === "function") e.preventDefault();
                    onSearchMemory(safeMemoryDraft || "Cammuteur-R1");
                  },
                  style: { display: "flex", gap: 8, alignItems: "center" },
                },
                  h("input", {
                    type: "text",
                    "aria-label": "Shared memory query",
                    "data-memory-query": "true",
                    placeholder: "Search shared memory notes",
                    value: safeMemoryDraft,
                    onChange: (e) => setMemoryDraft(e.target.value),
                    style: { ...inputStyle, flex: 1 },
                  }),
                  h("button", { type: "submit", "data-memory-recall": "true", style: btnStyle(true) }, t("memory.recall")))
              : null,
            data.memory.error ? h("div", { style: { ...muted, fontSize: 12 } }, data.memory.error) : null,
            (data.memory.results || []).length > 0
              ? h("ul", { "data-memory-results": "true", style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 } },
                  data.memory.results.map((item, idx) =>
                    h("li", { key: item.id || idx, style: { paddingTop: 6, borderTop: HAIRLINE, display: "grid", gap: 4 } },
                      h("code", { style: tagStyle }, item.context || "memory"),
                      h("span", { style: { fontSize: 12 } }, item.text),
                      h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
                        h("button", {
                          type: "button",
                          "data-use-chat": `memory:${item.id || idx}`,
                          onClick: () => handleUseInChat(`Shared memory [${item.context || "memory"}]: ${item.text}`),
                          style: btnStyle(false),
                        }, t("chat.use"))))))
              : null)
        : null,

      data && inWorkspaceMode && activeWorkspace === "Molecullage"
        ? (() => {
            const pins = data.molecullage?.pins || [], pinnedSet = new Set(pins.map((p) => p.id)), rowWrap = { display: "flex", gap: 6, flexWrap: "wrap" };
            return h("section", { "aria-label": t("molecullage.title"), style: { display: "grid", gap: 8 } },
              h("h3", { style: { fontSize: 13, fontWeight: 600, margin: 0 } }, t("molecullage.title")),
              h("div", { style: num }, `${data.molecullage.sources} verified sources across ${data.molecullage.domains} domains, nested boxes: ${data.molecullage.nestedBoxes}`),
              pins.length > 0 ? h("div", { "data-molecullage-pins": "true", style: { ...rowWrap, alignItems: "center" } },
                h("span", { style: { ...muted, ...num, fontSize: 12 } }, `${t("molecullage.pinned")}: ${pins.length}`),
                pins.slice(0, 6).map((p) => h("code", { key: p.id, style: tagStyle }, p.name || p.id))) : null,
              onSearchMolecullage ? h("form", { onSubmit: (e) => { e?.preventDefault?.(); onSearchMolecullage(safeMolecullageDraft); }, style: { display: "flex", gap: 8, alignItems: "center" } },
                h("input", { type: "text", "aria-label": "Molecullage source filter", "data-molecullage-query": "true", placeholder: "Filter studio library by name, kind or licence", value: safeMolecullageDraft, onChange: (e) => setMolecullageDraft(e.target.value), style: { ...inputStyle, flex: 1 } }),
                h("button", { type: "submit", "data-molecullage-filter": "true", style: btnStyle(true) }, t("molecullage.filter"))) : null,
              (data.molecullage.items || []).length > 0 ? h("ul", { "data-molecullage-items": "true", style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 } },
                data.molecullage.items.slice(0, 8).map((src) => {
                  const k = src.id || src.name, isPinned = pinnedSet.has(k);
                  return h("li", { key: k, style: { paddingTop: 6, borderTop: HAIRLINE, display: "grid", gap: 4 } },
                    h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" } },
                      h("span", { style: { fontWeight: 600 } }, src.name), h("code", { style: tagStyle }, src.licenceClass || src.kind)),
                    src.use ? h("span", { style: { ...muted, fontSize: 12 } }, src.use) : null,
                    h("div", { style: rowWrap },
                      onPinSource ? h("button", { type: "button", "data-molecullage-pin": k, "aria-pressed": isPinned, onClick: () => onPinSource({ source: src }), style: btnStyle(isPinned) }, isPinned ? t("molecullage.pinned") : t("molecullage.pin")) : null,
                      h("button", { type: "button", "data-use-chat": `molecullage:${k}`, onClick: () => handleUseInChat(`Use Molecullage source "${src.name}" (${src.section || "library"}, licence: ${src.licenceClass || src.kind}${src.doi ? `, ${src.doi}` : ""}${src.url ? `, ${src.url}` : ""})`), style: btnStyle(false) }, t("chat.use"))));
                })) : null);
          })()
        : null,

      data && inWorkspaceMode && activeWorkspace === "Prose"
        ? h("section", { "aria-label": t("prose.title"), style: { display: "grid", gap: 8 } },
            h("h3", { style: { fontSize: 13, fontWeight: 600, margin: 0 } }, t("prose.title")),
            h("p", { style: { margin: 0, fontFamily: MONO_FONT, fontSize: 12 } }, data.prose.text),
            h("div", { style: { fontWeight: 600 } }, data.prose.report.ok ? t("prose.clean") : t("prose.flagged")),
            data.prose.report.findings.length > 0
              ? h("ul", { style: { margin: 0, padding: 0, listStyle: "none" } },
                  data.prose.report.findings.map((f, idx) =>
                    h("li", { key: idx, style: { paddingTop: 4, borderTop: HAIRLINE } }, `${f.kind}: ${f.match}`)))
              : null,
            onProseChange
              ? h("textarea", {
                  rows: 2,
                  "aria-label": "Prose draft input",
                  "data-prose-input": "true",
                  value: proseDraft !== null ? proseDraft : data.prose.text,
                  onChange: (e) => setProseDraft(e.target.value),
                  style: inputStyle,
                })
              : null,
            h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
              onProseChange
                ? h("button", {
                    type: "button",
                    "data-prose-apply": "true",
                    onClick: async () => {
                      const nextText = proseDraft !== null ? proseDraft : data.prose.text;
                      const ok = await onProseChange(nextText);
                      if (ok !== false) setProseDraft((cur) => (cur === nextText ? null : cur));
                    },
                    style: btnStyle(true),
                  }, t("prose.apply"))
                : null,
              onProseRewrite
                ? h("button", {
                    type: "button",
                    "data-prose-rewrite": "true",
                    onClick: async () => {
                      const nextText = proseDraft !== null ? proseDraft : data.prose.text;
                      const ok = await onProseRewrite(nextText);
                      if (ok !== false) setProseDraft((cur) => (cur === nextText ? null : cur));
                    },
                    style: btnStyle(false),
                  }, t("prose.rewrite"))
                : null,
              onProseChange
                ? h("button", {
                    type: "button",
                    onClick: async () => {
                      const sample = "The wax bath holds 40 to 41 C for a 42 minute simulated window.";
                      const ok = await onProseChange(sample);
                      if (ok !== false) setProseDraft(null);
                    },
                    style: btnStyle(false),
                  }, "Check sample sentence")
                : null,
              h("button", {
                type: "button",
                "data-use-chat": "prose",
                onClick: () => handleUseInChat(`Use verified prose draft: ${proseDraft !== null ? proseDraft : data.prose.text}`),
                style: btnStyle(false),
              }, t("chat.use"))))
        : null,

      data && !settingsOpen
        ? h("footer", { style: { paddingTop: 10, borderTop: HAIRLINE, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" } },
            h("span", { style: { ...muted, ...num, fontSize: 12 } },
              `Connector view: ${activeConnector}, active 30-day grants: ${(data.consents || []).length}`),
            onOpenConsent
              ? h("button", {
                  type: "button",
                  "data-open-consent": "true",
                  onClick: () => onOpenConsent({ appId: `${activeConnector.toLowerCase()}-connector`, scopes: ["read", "verify"] }),
                  style: btnStyle(false),
                }, "Review access")
              : null)
        : null);
  }

  function makePane(t) {
    return function ArcConsolePane() {
      const [data, setData] = React.useState(null);
      const [failed, setFailed] = React.useState(false);
      const [actionError, setActionError] = React.useState("");
      const [pendingConsent, setPendingConsent] = React.useState(null);

      const refresh = async () => {
        try {
          const r = await fetch("api/arc-core/console/state", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          const j = r.ok ? await r.json() : null;
          if (j && j.ok) {
            setData(j);
            setFailed(false);
          } else {
            setFailed(true);
          }
        } catch {
          setFailed(true);
        }
      };

      const dispatch = async (payload) => {
        try {
          const r = await fetch("api/arc-core/console/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }), j = await r.json().catch(() => null);
          if (!r.ok || !j || j.ok === false) { const err = (j && j.error) || "Action failed"; setActionError(err); setFailed(true); return j || { ok: false, error: err }; }
          setActionError(""); setFailed(false); await refresh(); return j;
        } catch { setActionError("Action failed"); setFailed(true); return { ok: false, error: "Action failed" }; }
      };

      React.useEffect(() => {
        refresh();
      }, []);

      const skin =
        typeof document !== "undefined" && document.documentElement && typeof document.documentElement.getAttribute === "function"
          ? document.documentElement.getAttribute("data-arc-skin") || "arc"
          : "arc";

      return h(View, {
        data,
        failed,
        actionError,
        skin,
        pendingConsent,
        t,
        onSelectWorkspace: (workspace) => dispatch({ kind: "workspace", workspace }),
        onSelectResearchView: (view) => dispatch({ kind: "research-view", view }),
        onSelectConnector: (connector) => dispatch({ kind: "connector", connector }),
        onToggleSettings: (open) => dispatch({ kind: "settings", open }),
        onDecision: ({ branchId, action }) => dispatch({ kind: "decision", branchId, action }),
        onAddNote: (req) => dispatch({ kind: "note", ...req }),
        onAnnotateVerdict: (req) => dispatch({ kind: "verdict", ...req }),
        onPinSource: (req) => dispatch({ kind: "molecullage-pin", ...req }),
        onOpenConsent: (req) => setPendingConsent(req),
        onCloseConsent: () => setPendingConsent(null),
        onConsent: async (req) => {
          await dispatch({ kind: "consent", ...req });
          setPendingConsent(null);
        },
        onProseChange: async (text) => (await dispatch({ kind: "prose", text }))?.ok !== false,
        onProseRewrite: async (text) => (await dispatch({ kind: "prose-rewrite", ...(typeof text === "string" ? { text } : {}) }))?.ok !== false,
        onToggleSwitch: (rungId, enabled) => dispatch({ kind: "operator-switch", rungId, enabled }),
        onSearchMemory: (query) => dispatch({ kind: "memory-search", query }),
        onSearchMolecullage: (query) => dispatch({ kind: "molecullage-search", query }),
        onRefresh: () => dispatch({ kind: "refresh" }),
      });
    };
  }

  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { en, zh: en }), "arc-core: dictionaries");
    const t = ctx.locale.bind(NS);
    const Pane = makePane(t);
    const Title = () => h(React.Fragment, null, h(Icon, { size: 16 }), h("span", null, t("tab.title")));
    ctx.inject(["sidebarRightTabs"], (c) => {
      const off = [];
      const keep = (f) => { if (typeof f === "function") off.push(f); };
      const tabs = c.sidebarRightTabs;
      if (!tabs || typeof tabs.register !== "function") return;
      try {
        keep(tabs.register({
          id: TAB,
          kind: TAB,
          title: () => t("tab.title"),
          guide: [{ order: 25, title: () => t("tab.title"), description: () => t("tab.guide"), icon: Icon }],
        }));
        keep(c.slots.inject("sidebar.right.pane.tab", () => c.slots.register({ name: "sidebar.right.pane.tab", key: TAB, locale: NS }, Pane)));
        keep(c.slots.inject("sidebar.right.pane.tab.title", () => c.slots.register({ name: "sidebar.right.pane.tab.title", key: TAB }, Title)));
      } catch {
        for (const f of off) f();
        return;
      }
      return () => { for (const f of off) f(); };
    });
  }

  return {
    name: "arc-core",
    inject: ["slots", "locale"],
    apply,
    View,
    ConsentDialog,
    ConnectorView,
    UpdatesView,
    ResearchWorkspace,
    WORKSPACES,
    CONNECTORS,
    SEATS,
    RESEARCH_VIEWS,
    DECISION_ACTIONS,
    CONSENT_MODES,
    THEMES,
    en,
    pushToChatComposer,
  };
} });
