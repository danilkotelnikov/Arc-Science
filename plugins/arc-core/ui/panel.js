/**
 * arc-core 0.1.0 (2026-11-09): Unified C2 console panel (Phase 1b.2-1b.3 & Phase 4.1-4.8).
 * Workspaces: Research, Memory, Molecullage, Prose.
 * Connectors: Servers, Keys, Apps, Audit, Cammut, Updates; plus Settings.
 * Research session: 3-pane layout (Map, Claims, Evidence) + Release view,
 * Decision map (Pursue, Park, Drop, Request a test), validation ladder L1-L4
 * (with L5/L6 operator switches off by default), and 30-day consent dialog.
 */
window.__ModuleLoader__.load({ id: "arc-core", factory: (require) => {
  const React = require("react");
  const h = React.createElement;
  const NS = "arc-core", TAB = "arc-core-console";

  const WORKSPACES = ["Research", "Memory", "Molecullage", "Prose"];
  const CONNECTORS = ["Servers", "Keys", "Apps", "Audit", "Cammut", "Updates"];
  const SEATS = ["Planner", "Reviewer", "Falsifier", "Vision", "Prose"];
  const RESEARCH_VIEWS = ["Map", "Claims", "Evidence", "Release"];
  const DECISION_ACTIONS = ["Pursue", "Park", "Drop", "Request a test"];
  const CONSENT_MODES = ["Single action", "Grant for 30 days", "Revoke"];
  const THEMES = [
    { id: "arc", label: "Arc Harness" },
    { id: "v0", label: "Black and white" },
    { id: "radium", label: "Radium" },
  ];
  // Top controls (road map 1b.4, 2026-11-20): one tab list of five (the workspaces and one entry for all connectors) and the
  // console settings button, so at most six. Connectors open a second row built from CONNECTORS.
  const TOP_TABS = [...WORKSPACES, "Connectors"];

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
    "connector.cammut": "Cammut",
    "cammut.tab.servers": "Servers",
    "cammut.tab.tools": "Tools",
    "cammut.tab.observer": "Observer",
    "cammut.tab.parts": "Parts",
    "cammut.loading": "Loading Cammut state…",
    "cammut.gateway.on": "Gateway {host} is running.",
    "cammut.gateway.off": "Gateway {host} does not answer.",
    "cammut.servers.address": "Server address",
    "cammut.servers.keyname": "Key name, optional",
    "cammut.servers.add": "Add server",
    "cammut.servers.remove": "Remove",
    "cammut.servers.last": "The last server stays.",
    "cammut.servers.builtin": "Built-in store on this computer",
    "cammut.servers.legacy": "Owner key file",
    "cammut.servers.keyset": "Key set",
    "cammut.servers.keymissing": "Key missing",
    "cammut.servers.nokey": "No key",
    "cammut.tools.query": "Search tools by word",
    "cammut.tools.search": "Search",
    "cammut.tools.details": "Show details",
    "cammut.tools.args": "Arguments as an object",
    "cammut.tools.run": "Run",
    "cammut.tools.confirm": "Confirm",
    "cammut.tools.typename": "Type the tool name",
    "cammut.tools.result": "Result",
    "cammut.observer.source": "Source",
    "cammut.observer.view": "View",
    "cammut.observer.query": "Filter or question",
    "cammut.observer.show": "Show",
    "cammut.observer.readonly": "Read only",
    "cammut.observer.cammut": "Cammut server",
    "cammut.observer.builtin": "Built-in store",
    "cammut.observer.empty": "Nothing to show.",
    "cammut.parts.reload": "Reload",
    "cammut.parts.rollback": "Roll back",
    "cammut.hint.servers": "Arc Harness asks these Cammut servers in order and tries the next one only when a connection fails. A key is never typed here. Enter the key in the gateway settings page and write only its name below.",
    "cammut.hint.keyname": "A key name points to a key kept in the gateway credential file. A server without a key name receives no key at all, and never the owner key file.",
    "cammut.hint.tools": "This runner calls the Hindsight tools of the connected Cammut server. Reading runs at once. Changing memory asks you to confirm. Deleting asks you to type the tool name.",
    "cammut.hint.observer": "The observer only reads. It cannot add, change or delete anything. A connection holds one memory bank, so there is one bank to browse.",
    "cammut.hint.parts": "A part is a piece of Arc Harness that can be replaced while the app runs. Reload loads the file on disk and tests it first. If the test fails, the old version keeps working. This tab itself needs a page reload.",
    "settings.title": "Console settings",
    "settings.theme": "Active theme",
    "settings.switches": "Operator switches",
    "view.servers": "Servers",
    "view.keys": "Keys",
    "view.apps": "Apps",
    "view.audit": "Audit",
    "nav.console": "Console sections",
    "nav.console.settings": "Console settings",
    "action.again": "Check again",
    "action.retry": "Try again",
    "consent.review": "Review access",
    "hint.detail": "Technical detail",
    "hint.code": "The reported cause is {code}. Use this word when you look for the fault.",
    "status.grants": "Active 30-day grants: {n}",
    "state.on": "On",
    "state.off": "Off",
    "state.unset": "Not set up yet",
    "empty.servers": "No servers yet.",
    "empty.keys": "No keys yet.",
    "empty.apps": "No apps yet.",
    "empty.audit": "No events yet.",
    "empty.audit.hint": "Decisions, notes and access changes that you make in the console appear here.",
    "empty.addons": "No add-ons installed.",
    "empty.addons.hint": "An add-on appears here after the installer copies it into the local plugins folder.",
    "settings.nav.memory": "Memory",
    "settings.nav.connectors": "Connectors",
    "settings.nav.keys": "Keys",
    "settings.nav.addons": "Add-ons",
    "settings.nav.updates": "Updates",
    "settings.memory.gateway": "Gateway address",
    "settings.memory.recall": "Memory recall",
    "settings.memory.labels": "Policy labels",
    "settings.memory.hint": "Arc Harness reaches shared memory through the local gateway on this computer. Recall adds matching notes to a request. The gateway settings file holds this switch.",
    "settings.connectors.hint": "Servers are the local programs that Arc Harness talks to. Apps are tool packs. An app works only inside the access that you grant, for one action or for 30 days.",
    "settings.keys.hint": "Arc Harness shows where each key is kept and never its value. Keys stay in files on this computer and in the system key store. No key is typed on this page.",
    "settings.addons.hint": "Add-ons are the Arc plugins installed on this computer. The list is for reference. The installer and the updater change it.",
    "settings.about": "About this page",
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
    color: active ? "var(--dsw-alias-bg-base, Canvas)" : INK,
    background: active
      ? "var(--dsw-alias-brand-primary-new-colorprimary-new-color, currentColor)"
      : "color-mix(in srgb, currentColor 8%, transparent)",
    fontWeight: active ? 600 : 400,
  });

  // a top-level tab: plain text, the selected one carries a rule under it
  const tabStyle = (active) => ({
    fontFamily: TEXT_FONT,
    fontSize: 13,
    lineHeight: 1.35,
    minHeight: 28,
    padding: "4px 2px",
    border: "none",
    borderBottom: active ? "2px solid currentColor" : "2px solid transparent",
    borderRadius: 0,
    background: "transparent",
    cursor: "pointer",
    color: INK,
    fontWeight: active ? 600 : 400,
    opacity: active ? 1 : 0.72,
  });
  const iconBtnStyle = (active) => ({ ...btnStyle(active), display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 28, minHeight: 28, padding: 0 });
  const rowWrapStyle = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
  const titleRowStyle = { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" };
  const h3Style = { fontSize: 13, fontWeight: 600, margin: 0 };
  // one visible focus ring for every control of the console and of its Settings pages; hover lifts a resting tab
  const CONSOLE_CSS = ":is([data-arc-console],[data-arc-settings]) :is(button,input,select,textarea,summary):focus-visible{outline:2px solid currentColor !important;outline-offset:2px}" +
    ":is([data-arc-console],[data-arc-settings]) button:disabled{opacity:.5;cursor:not-allowed}" +
    "[data-arc-console] [role=tab]:hover{opacity:1 !important}";
  const oneLine = (s, n = 90) => (String(s ?? "").length > n ? String(s).slice(0, n - 1) + "\u2026" : String(s ?? ""));
  // dates follow the language of the app page, never the language of the system
  const uiLang = () => (typeof document !== "undefined" && document.documentElement && document.documentElement.lang) || "en";
  const fmtWhen = (ms) => { const d = new Date(Number(ms)); return Number(ms) > 0 && Number.isFinite(d.getTime()) ? d.toLocaleString(uiLang(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : ""; };
  // arrow keys move focus along a tab list and wrap; Enter or Space selects, because a selection calls the server
  const onTabKeys = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: "first", End: "last" }[e.key];
    if (!step) return;
    const tabs = Array.from(e.currentTarget.querySelectorAll("[role=tab]"));
    if (!tabs.length) return;
    const at = tabs.indexOf(e.target);
    const next = step === "first" ? 0 : step === "last" ? tabs.length - 1 : (Math.max(at, 0) + step + tabs.length) % tabs.length;
    tabs[next].focus();
    e.preventDefault();
  };

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

  function SettingsIcon({ size = 16 }) {
    return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", "aria-hidden": true },
      h("path", { d: "M4 6h9M19 6h1M4 12h1M11 12h9M4 18h7M17 18h3" }),
      h("circle", { cx: 16, cy: 6, r: 2 }), h("circle", { cx: 8, cy: 12, r: 2 }), h("circle", { cx: 14, cy: 18, r: 2 }));
  }

  // the state of a row as a mark in the text colour: filled is fine, a ring needs attention, a small mark is not checked
  function StatusDot({ state }) {
    const look = state === "ok" ? { background: "currentColor" }
      : state === "attention" ? { boxShadow: "inset 0 0 0 2px currentColor" }
      : { background: "currentColor", transform: "scale(0.5)" };
    return h("span", { "data-state": state || "idle", "aria-hidden": true, style: { display: "inline-block", width: 8, height: 8, borderRadius: "50%", flex: "none", ...look } });
  }

  // helper text lives here (R005). Escape, or focus that leaves the hint, closes it. A click inside the note keeps it open.
  // align "row" or "row-end" hangs the note under the nearest positioned row (at its start or end), so it stays inside a narrow pane wherever the button wraps.
  function InfoHint({ label, text, align = "start" }) {
    const [open, setOpen] = React.useState(false);
    const noteId = `arc-hint-${Array.from(String(text)).reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1000003, 7)}`;
    return h("span", {
      style: { position: align.startsWith("row") ? "static" : "relative", display: "inline-flex" },
      onBlur: (e) => { if (!e.currentTarget?.contains?.(e.relatedTarget)) setOpen(false); },
      // Escape closes an open hint only; it must not also close the dialog that holds the page
      onKeyDown: (e) => {
        if (e.key !== "Escape" || !open) return;
        e.stopPropagation?.(); e.nativeEvent?.stopImmediatePropagation?.();
        setOpen(false);
        e.currentTarget?.querySelector?.("button")?.focus?.();
      },
    },
      h("button", {
        type: "button", "aria-label": label, "aria-expanded": open, "aria-describedby": open ? noteId : undefined, "data-hint": "true",
        onClick: () => setOpen(!open),
        style: { ...iconBtnStyle(false), minWidth: 24, minHeight: 24, borderRadius: "50%", fontSize: 12, lineHeight: 1 },
      }, "?"),
      open ? h("span", { role: "note", id: noteId, tabIndex: -1, style: { position: "absolute", top: "calc(100% + 4px)", [align.endsWith("end") ? "right" : "left"]: 0, zIndex: 5, width: "min(260px, 70vw)", padding: "8px 10px", fontSize: 12, lineHeight: 1.45, fontWeight: 400, background: "var(--dsw-alias-bg-layer-1, Canvas)", color: INK, border: HAIRLINE, borderRadius: RADIUS, boxShadow: "0 2px 10px color-mix(in srgb, currentColor 18%, transparent)" } }, text) : null);
  }

  function EmptyState({ id, text, hint, t }) {
    return h("div", { "data-empty-state": id, style: { ...rowWrapStyle, paddingTop: 8, borderTop: HAIRLINE } },
      h("span", { style: { ...muted, fontSize: 12 } }, text),
      hint ? h(InfoHint, { label: t("settings.about"), text: hint }) : null);
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
    ".arc-upd button:disabled{opacity:.5;cursor:not-allowed}.arc-upd pre{white-space:pre-wrap;margin:0;font-family:inherit}" +
    ".arc-upd ::selection{background:color-mix(in srgb,currentColor 24%,transparent)}";
  // the C2 primary pair (dark brown on paper, cream on the dark canvas) from the theme tokens
  const upBtn = (active) => ({
    ...btnStyle(false),
    ...(active ? { background: "var(--dsw-alias-brand-primary-new-colorprimary-new-color, currentColor)", color: "var(--dsw-alias-bg-base, Canvas)", fontWeight: 600 } : {}),
  });
  const clampLine = (s, n = 90) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

  // the Updates view uses the console's hint: a 24 px target, Escape closes it, the note stays inside a narrow pane
  const Hint = (props) => h(InfoHint, { align: "row", ...props });

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
    const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", position: "relative" };
    return h("section", { className: "arc-upd", "aria-label": t("connector.updates"), "data-connector-view": "Updates", style: { display: "grid", gap: 12, fontFamily: TEXT_FONT, fontSize: 13, color: INK } },
      h("style", null, UPDATE_CSS),
      h("div", { style: { ...row, justifyContent: "space-between" } },
        h("h3", { style: { fontSize: 13, fontWeight: 600, margin: 0 } }, t("connector.updates")),
        h("span", { style: { ...row, position: "static" } }, h(Hint, { label: "About what an update replaces", align: "row-end", text: t("updates.hint.scope") }), h(Hint, { label: "About the checksum", align: "row-end", text: t("updates.hint.checksum") }))),
      h("div", { style: row, "data-updates-versions": "true" },
        h("span", { style: muted }, `${t("updates.installed")}:`), h("code", { style: tagStyle }, u.installed || "unknown"),
        h("span", { style: muted }, `${t("updates.latest")}:`), h("code", { style: tagStyle }, u.latest || "not checked")),
      h("div", { style: { ...row, flexWrap: "nowrap", minHeight: 20 }, ...(u.restartNeeded ? { "data-updates-restart": "true" } : {}) },
        h("p", { role: "status", "data-updates-status": "true", title: status, style: { margin: 0, fontSize: 12, opacity: 0.85, fontWeight: u.restartNeeded ? 600 : 400, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, clampLine(status)),
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
      u.notes ? h("details", { "data-updates-notes": "true", style: { borderTop: HAIRLINE, paddingTop: 8 } }, h("summary", { style: { cursor: "pointer", fontWeight: 600, fontSize: 12, padding: "4px 0" } }, t("updates.notes")), h("pre", { style: { marginTop: 6, fontSize: 12, opacity: 0.85 } }, u.notes)) : null);
  }

  function UpdatesPanel({ t }) {
    const [info, setInfo] = React.useState(null);
    const [error, setError] = React.useState("");
    const [actionError, setActionError] = React.useState(""); // an action's refusal stays until the next action; a state refresh must not wipe it
    const [pending, setPending] = React.useState(false);
    const post = async (route, body) => {
      const r = await fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
      return r.json().catch(() => null);
    };
    const load = async () => {
      try { const j = await post("api/arc-core/update/state"); if (j && j.ok) { setInfo(j); setError(""); } else setError((j && j.error) || "Could not read the update state."); } catch { setError("Could not read the update state."); }
    };
    const act = async (payload) => {
      setActionError(""); setPending(true);
      try { const j = await post("api/arc-core/update/action", payload); if (!j || j.ok === false) setActionError((j && j.error) || "The action failed."); } catch { setActionError("The action failed."); }
      setPending(false);
      await load();
    };
    const busy = Boolean(info && info.busy);
    React.useEffect(() => {
      load();
      const id = setInterval(load, busy ? 1200 : 15000);
      return () => clearInterval(id);
    }, [busy]);
    return h(UpdatesView, { info, error: actionError || error, pending, onAction: act, t });
  }

  function ConnectorView({ connector, detail, onOpenConsent, onRefresh, grants, heading = true, t }) {
    if (connector === "Updates") return h(UpdatesPanel, { t });
    if (connector === "Cammut") return h(CammutPane, { t });
    const rows = (detail && detail[connector]) || [];
    const key = String(connector || "servers").toLowerCase();
    const titleKey = `view.${key}`;
    const nameRow = (item, name, tag) => h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" } },
      h("span", { style: { ...rowWrapStyle, fontWeight: 600 } }, item.state ? h(StatusDot, { state: item.state }) : null, h("span", { title: String(name) }, oneLine(name, 64))),
      tag ? h("code", { style: tagStyle }, tag) : null);
    return h("section", {
      "aria-label": t(titleKey),
      "data-connector-view": connector,
      style: { display: "grid", gap: 10 },
    },
      !heading ? null : h("div", { style: titleRowStyle },
        h("h3", { style: h3Style }, t(titleKey)),
        h("span", { style: rowWrapStyle },
          connector === "Apps" && typeof grants === "number" ? h("span", { style: { ...muted, ...num, fontSize: 12 } }, t("status.grants", { n: grants })) : null,
          onRefresh ? h("button", { type: "button", "data-refresh-console": "true", onClick: () => onRefresh(), style: btnStyle(false) }, t("action.refresh")) : null)),
      rows.length === 0
        ? h(EmptyState, { id: connector, text: t(`empty.${key}`), hint: connector === "Audit" ? t("empty.audit.hint") : "", t })
        : h("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 } },
            rows.map((item) =>
              h("li", { key: item.id, style: { paddingTop: 8, borderTop: HAIRLINE, display: "grid", gap: 4 } },
                connector === "Servers" || connector === "Keys"
                  ? h(React.Fragment, null,
                      nameRow(item, item.label, connector === "Servers" ? item.endpoint : item.ref),
                      h("div", { style: rowWrapStyle },
                        h("span", { role: "status", title: String(item.status || ""), style: { ...muted, fontSize: 12 } }, oneLine(item.status)),
                        item.action === "refresh" && onRefresh
                          ? h("button", { type: "button", "data-row-action": item.id, onClick: () => onRefresh(), style: btnStyle(false) }, t("action.again"))
                          : null,
                        item.code ? h(InfoHint, { label: t("hint.detail"), text: t("hint.code", { code: item.code }), align: "end" }) : null))
                  : null,
                connector === "Apps"
                  ? h(React.Fragment, null,
                      nameRow(item, item.label, `Active grants: ${item.grants}`),
                      h("div", { style: { ...rowWrapStyle, justifyContent: "space-between" } },
                        h("span", { title: (item.scopes || []).join(", "), style: { ...muted, fontSize: 12 } }, oneLine(`Scopes: ${(item.scopes || []).join(", ")}`, 60)),
                        onOpenConsent
                          ? h("button", {
                              type: "button",
                              "data-connector-consent": item.id,
                              onClick: () => onOpenConsent({ appId: `${item.id}-connector`, scopes: item.scopes || ["read"] }),
                              style: btnStyle(false),
                            }, t("consent.review"))
                          : null))
                  : null,
                connector === "Audit"
                  ? h(React.Fragment, null,
                      nameRow(item, item.summary, item.kind),
                      h("span", { style: { ...muted, ...num, fontSize: 12 } }, `Recorded ${fmtWhen(item.atMs)}`))
                  : null))));
  }

  // one section of the Settings dialog. Pure: every value arrives in props. It reuses the console views.
  function SettingsSectionView({ section, data, failed, actionError = "", pendingConsent = null, onRefresh, onOpenConsent, onConsent, onCloseConsent, t }) {
    const navKey = `settings.nav.${String(section || "").replace("-", "")}`;
    const frame = (...children) => h("div", {
      "data-arc-settings": section,
      "data-arc-plugin-pane": "true",
      style: { display: "grid", gap: 16, maxWidth: 720, fontFamily: TEXT_FONT, fontSize: 13, lineHeight: 1.45, color: INK },
    }, h("style", null, CONSOLE_CSS), ...children);
    const title = (hintKey) => h("div", { style: rowWrapStyle },
      h("h3", { style: { ...h3Style, fontSize: 14 } }, t(navKey)), hintKey ? h(InfoHint, { label: t("settings.about"), text: t(hintKey) }) : null);
    if (!data) {
      return frame(title(""),
        failed
          ? h("div", { style: rowWrapStyle }, h("span", { role: "alert" }, t("state.error")),
              onRefresh ? h("button", { type: "button", "data-console-retry": "true", onClick: () => onRefresh(), style: btnStyle(false) }, t("action.retry")) : null)
          : h("p", { style: { ...muted, margin: 0 } }, t("state.loading")));
    }
    const alert = actionError ? h("p", { role: "alert", style: { margin: 0, fontSize: 12 } }, oneLine(actionError)) : null;
    const line = (label, value) => h("div", { style: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", paddingTop: 8, borderTop: HAIRLINE } },
      h("span", null, label), value);
    if (section === "memory") {
      const m = data.memory || {};
      return frame(title("settings.memory.hint"), alert,
        h("div", { style: rowWrapStyle },
          h(StatusDot, { state: m.state }),
          h("span", { role: "status", title: String(m.status || "") }, oneLine(m.status)),
          onRefresh ? h("button", { type: "button", "data-refresh-console": "true", "data-row-action": "memory", onClick: () => onRefresh(), style: btnStyle(false) }, m.action === "refresh" ? t("action.again") : t("action.refresh")) : null,
          m.code ? h(InfoHint, { label: t("hint.detail"), text: t("hint.code", { code: m.code }) }) : null),
        line(t("settings.memory.gateway"), h("code", { style: tagStyle }, m.gateway)),
        line(t("settings.memory.recall"), h("span", { style: { fontWeight: 600 } }, m.configured === false ? t("state.unset") : m.recall ? t("state.on") : t("state.off"))),
        line(t("settings.memory.labels"), h("span", { style: rowWrapStyle }, (m.labels || []).map((l) => h("code", { key: l, style: tagStyle }, l)))),
        CONNECTORS.includes("Cammut") ? h(ConnectorView, { connector: "Cammut", t }) : null);
    }
    if (section === "connectors") {
      return frame(title("settings.connectors.hint"), alert,
        h(ConsentDialog, { pendingConsent, onConsent, onClose: onCloseConsent, t }),
        h(ConnectorView, { connector: "Servers", detail: data.connectorsDetail, onRefresh, t }),
        h(ConnectorView, { connector: "Apps", detail: data.connectorsDetail, onOpenConsent, grants: (data.consents || []).length, t }));
    }
    if (section === "keys") {
      return frame(title("settings.keys.hint"), alert, h(ConnectorView, { connector: "Keys", detail: data.connectorsDetail, heading: false, t }));
    }
    if (section === "add-ons") {
      const items = (data.addons && data.addons.items) || [];
      return frame(title("settings.addons.hint"),
        items.length === 0
          ? h(EmptyState, { id: "add-ons", text: t("empty.addons"), hint: t("empty.addons.hint"), t })
          : h("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 } },
              items.map((a) => h("li", { key: a.id, "data-addon": a.id, style: { paddingTop: 8, borderTop: HAIRLINE, display: "grid", gap: 2 } },
                h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" } },
                  h("span", { style: { fontWeight: 600 } }, a.id),
                  a.version ? h("code", { style: tagStyle }, a.version) : null),
                a.description ? h("span", { title: a.description, style: { ...muted, fontSize: 12 } }, oneLine(a.description)) : null))));
    }
    // a section that is one connector view of its own, such as Updates
    const own = CONNECTORS.find((c) => c.toLowerCase() === section);
    return frame(own ? h(ConnectorView, { connector: own, detail: data.connectorsDetail, onRefresh, t }) : title(""));
  }


  // ---- Cammut connector (S051): servers, tools, observer, parts. Pure CammutView plus a fetching CammutPane.
  const CAM_TABS = ["servers", "tools", "observer", "parts"];
  const CAM_VIEWS = ["memories", "tags", "documents", "recall", "models", "directives", "operations"];
  // The look of the Cammut sign-in page (Cammut-edge web/src/pages/Login.tsx, 21.XI.2026): turning AS cube, accent
  // primary button, outlined secondary buttons and inputs. Colours come only from the theme tokens, so all three themes hold.
  const CAM_CSS = ".arc-cam button:focus-visible,.arc-cam summary:focus-visible,.arc-cam input:focus-visible,.arc-cam select:focus-visible,.arc-cam textarea:focus-visible{outline:2px solid currentColor;outline-offset:2px}" +
    ".arc-cam button:disabled{opacity:.5;cursor:not-allowed}.arc-cam pre{white-space:pre-wrap;margin:0;font-family:inherit;max-height:260px;overflow:auto}" +
    ".arc-cam button:not(:disabled):hover{opacity:.88}.arc-cam{animation:arc-cam-rise .5s cubic-bezier(.05,.7,.1,1) both}" +
    ".arc-cam-cube{position:relative;display:block;flex:none;animation:arc-cam-turn .62s ease-in-out both}" +
    ".arc-cam-cube svg{position:absolute;inset:0;width:100%;height:100%;fill:currentColor}" +
    ".arc-cam-cube .fr{animation:arc-cam-hide .62s both}.arc-cam-cube .fl{animation:arc-cam-show .62s both}" +
    "@keyframes arc-cam-turn{0%{transform:scaleX(1)}45%{transform:scaleX(.03)}80%{transform:translateY(3px) scaleX(1)}100%{transform:none}}" +
    "@keyframes arc-cam-hide{0%,44.9%{opacity:1}45%,100%{opacity:0}}@keyframes arc-cam-show{0%,44.9%{opacity:0}45%,100%{opacity:1}}" +
    "@keyframes arc-cam-rise{0%{opacity:0;transform:translateY(12px)}100%{opacity:1;transform:none}}" +
    "@media (prefers-reduced-motion:reduce){.arc-cam,.arc-cam-cube,.arc-cam-cube .fl,.arc-cam-cube .fr{animation:none}.arc-cam-cube .fr{opacity:0}}";
  const CAM_LINE = "1px solid var(--dsw-alias-line-divider, color-mix(in srgb, currentColor 22%, transparent))";
  // The theme accent, pulled 35% toward the text colour, so the page colour on it reads at 4.5:1 or more in every theme and mode.
  const CAM_FILL = "color-mix(in srgb, var(--dsw-alias-button-info-fill, CanvasText) 65%, var(--dsw-alias-label-primary, CanvasText))";
  const camBtn = (active) => ({
    fontFamily: TEXT_FONT,
    fontSize: 13,
    lineHeight: 1,
    minHeight: 32,
    padding: "0 14px",
    borderRadius: 8,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    ...(active
      ? { border: `1px solid ${CAM_FILL}`, background: CAM_FILL, color: "var(--dsw-alias-bg-base, Canvas)", fontWeight: 600 }
      : { border: CAM_LINE, background: SURFACE, color: INK, fontWeight: 500 }),
  });
  const camTab = (active) => ({ ...camBtn(false), ...(active ? { fontWeight: 600, background: "color-mix(in srgb, currentColor 10%, transparent)", border: "1px solid color-mix(in srgb, currentColor 55%, transparent)" } : {}) });
  const camInput = { ...inputStyle, fontSize: 13, padding: "7px 10px", minHeight: 32, border: CAM_LINE, borderRadius: 8, background: SURFACE };
  const CAM_TOP = "M128.00 18.80L220.15 72.00L128.00 125.20L35.85 72.00Z";
  const CAM_LEFT = "M33.43 76.20L125.58 129.40L125.58 235.80L33.43 182.60Z";
  const CAM_RIGHT = "M130.42 129.40L222.57 76.20L222.57 182.60L130.42 235.80Z";
  const CAM_L_LETTERS = "M43.61 161.18L54.83 115.85L65.30 121.90L76.51 180.17L67.54 174.99L64.92 161.40L55.20 155.78L52.59 166.36ZM60.06 136.14L63.05 151.68L57.07 148.23ZM82.49 131.83L109.41 147.37L115.39 157.73L115.39 161.18L91.47 147.37L91.47 157.73L115.39 171.54L115.39 202.62L88.47 187.08L82.49 176.72L82.49 173.27L106.42 187.08L106.42 176.72L82.49 162.91Z";
  const CAM_R_LETTERS = "M140.61 202.62L151.82 144.34L162.29 138.30L173.51 183.63L164.53 188.81L161.92 178.23L152.20 183.84L149.58 197.44ZM157.06 158.59L160.05 170.68L154.07 174.13ZM179.49 128.37L206.40 112.83L212.39 116.29L212.39 119.74L188.46 133.55L188.46 143.91L212.39 130.10L212.39 161.18L185.47 176.72L179.49 173.27L179.49 169.81L203.41 156.00L203.41 145.64L179.49 159.45Z";
  // The AS cube turns once, from the letters on the right face to the letters on the left face, as on the sign-in page.
  function CamCube({ size = 40 }) {
    return h("span", { className: "arc-cam-cube", "data-cammut-cube": "true", role: "img", "aria-label": "Arc Science", style: { width: size, height: size, color: INK } },
      h("svg", { className: "fl", viewBox: "0 0 256 256", "aria-hidden": "true" }, h("path", { fillRule: "evenodd", d: CAM_TOP + CAM_LEFT + CAM_L_LETTERS + CAM_RIGHT })),
      h("svg", { className: "fr", viewBox: "0 0 256 256", "aria-hidden": "true" }, h("path", { fillRule: "evenodd", d: CAM_TOP + CAM_LEFT + CAM_RIGHT + CAM_R_LETTERS })));
  }
  const camClamp = (s, n = 90) => (String(s ?? "").length > n ? String(s).slice(0, n - 1) + "…" : String(s ?? ""));
  const camRow = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };

  // the console hint (InfoHint): a 24 px target, Escape closes it, the note stays inside a narrow pane
  const CamHint = (props) => h(InfoHint, { align: "row", ...props });


  function CamServers({ info, busy, onAction, t }) {
    const [url, setUrl] = React.useState("");
    const [keyName, setKeyName] = React.useState("");
    const servers = info.servers || [];
    const can = Boolean(info.canManage) && !busy;
    const onlyOne = servers.length <= 1;
    return h("div", { style: { display: "grid", gap: 10 } },
      h("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 } },
        servers.map((sv) => h("li", { key: sv.url, "data-cammut-server": sv.url, style: { paddingTop: 8, borderTop: HAIRLINE, display: "grid", gap: 4 } },
          h("div", { style: { ...camRow, justifyContent: "space-between" } },
            h("code", { style: tagStyle }, sv.url),
            h("button", { type: "button", "data-cammut-remove": sv.url, disabled: !can || onlyOne, onClick: () => onAction && onAction({ kind: "server-remove", url: sv.url }), style: camBtn(false) }, t("cammut.servers.remove"))),
          h("div", { style: { ...camRow, fontSize: 12 } },
            h("span", { style: muted }, camClamp(sv.status)),
            sv.keyRef ? h("code", { style: tagStyle }, sv.keyRef) : null,
            h("span", { style: muted }, sv.ownKey ? (sv.keyRef ? (sv.keySet ? t("cammut.servers.keyset") : t("cammut.servers.keymissing")) : t("cammut.servers.nokey")) : (sv.legacyAuth ? t("cammut.servers.legacy") : ""))))),
        info.builtin && info.builtin.available ? h("li", { key: "builtin", style: { paddingTop: 8, borderTop: HAIRLINE } }, h("span", { style: muted }, t("cammut.servers.builtin"))) : null),
      servers.length <= 1 && info.canManage ? h("p", { style: { margin: 0, fontSize: 12, ...muted } }, t("cammut.servers.last")) : null,
      h("form", { onSubmit: (e) => { e?.preventDefault?.(); }, style: camRow },
        h("input", { type: "text", "aria-label": t("cammut.servers.address"), "data-cammut-url": "true", placeholder: "https://memory.example.org", value: url, onChange: (e) => setUrl(e.target.value), style: { ...camInput, flex: "1 1 100%" } }),
        h("input", { type: "text", "aria-label": t("cammut.servers.keyname"), "data-cammut-key": "true", placeholder: t("cammut.servers.keyname"), value: keyName, onChange: (e) => setKeyName(e.target.value), style: { ...camInput, flex: 1, minWidth: 120 } }),
        h("button", { type: "submit", "data-cammut-add": "true", disabled: !can || !url.trim(), onClick: () => onAction && onAction({ kind: "server-add", url: url.trim(), keyRef: keyName.trim() }), style: camBtn(true) }, t("cammut.servers.add")),
        h(CamHint, { label: "About keys", text: t("cammut.hint.keyname") })));
  }

  function CamTools({ tools, onAction, t }) {
    const st = tools || {};
    const [query, setQuery] = React.useState("");
    const [args, setArgs] = React.useState("{}");
    const [typed, setTyped] = React.useState("");
    const tool = st.tool || "";
    const run = st.run || null;
    const parse = () => { try { const v = JSON.parse(args || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; } };
    const parsed = parse();
    const go = (confirm) => onAction && onAction({ kind: "tool-run", tool, arguments: parsed || {}, ...(confirm !== undefined ? { confirm } : {}) });
    return h("div", { style: { display: "grid", gap: 10 } },
      h("form", { onSubmit: (e) => { e?.preventDefault?.(); }, style: camRow },
        h("input", { type: "text", "aria-label": t("cammut.tools.query"), "data-cammut-tool-query": "true", placeholder: t("cammut.tools.query"), value: query, onChange: (e) => setQuery(e.target.value), style: { ...camInput, flex: 1, minWidth: 160 } }),
        h("button", { type: "submit", "data-cammut-tool-search": "true", disabled: !query.trim(), onClick: () => onAction && onAction({ kind: "tool-search", query: query.trim() }), style: camBtn(true) }, t("cammut.tools.search")),
        h(CamHint, { label: "About the tool runner", text: t("cammut.hint.tools") })),
      h("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 } },
        (st.list || []).map((x) => h("li", { key: x.tool, "data-cammut-tool": x.tool, style: { ...camRow, paddingTop: 6, borderTop: HAIRLINE } },
          h("button", { type: "button", "aria-pressed": tool === x.tool, onClick: () => onAction && onAction({ kind: "tool-pick", tool: x.tool }), style: camTab(tool === x.tool) }, x.tool.replace("hindsight/", "")),
          h("code", { "data-cammut-class": x.class, style: tagStyle }, x.class),
          h("span", { style: { ...muted, fontSize: 12 } }, camClamp(x.description))))),
      tool ? h("div", { style: { display: "grid", gap: 6 } },
        h("div", { style: camRow }, h("code", { style: tagStyle }, tool),
          h("button", { type: "button", onClick: () => onAction && onAction({ kind: "tool-describe", tool }), style: camBtn(false) }, t("cammut.tools.details"))),
        h("textarea", { rows: 3, "aria-label": t("cammut.tools.args"), "data-cammut-args": "true", value: args, onChange: (e) => setArgs(e.target.value), style: { ...camInput, fontFamily: MONO_FONT } }),
        h("div", { style: camRow },
          h("button", { type: "button", "data-cammut-run": "true", disabled: !parsed, onClick: () => go(), style: camBtn(true) }, t("cammut.tools.run")),
          run && run.needs === "confirm" ? h("button", { type: "button", "data-cammut-confirm": "true", onClick: () => go(true), style: camBtn(false) }, t("cammut.tools.confirm")) : null,
          run && run.needs === "confirm-tool" ? h(React.Fragment, null,
            h("input", { type: "text", "aria-label": t("cammut.tools.typename"), "data-cammut-confirm-tool": "true", placeholder: t("cammut.tools.typename"), value: typed, onChange: (e) => setTyped(e.target.value), style: { ...camInput, flex: "1 1 160px" } }),
            h("button", { type: "button", "data-cammut-confirm": "true", disabled: typed !== tool, onClick: () => go(tool), style: camBtn(false) }, t("cammut.tools.confirm"))) : null),
        run && run.error ? h("p", { role: "status", style: { margin: 0, fontSize: 12, opacity: 0.85 } }, camClamp(run.error)) : null,
        run && run.ok && run.data !== undefined ? h("details", { open: true, "data-cammut-result": "true" }, h("summary", { style: { cursor: "pointer", fontSize: 12, fontWeight: 600 } }, t("cammut.tools.result")), h("pre", { style: { fontSize: 12 } }, JSON.stringify(run.data, null, 2).slice(0, 4000))) : null,
        st.described ? h("details", { "data-cammut-described": "true" }, h("summary", { style: { cursor: "pointer", fontSize: 12, fontWeight: 600 } }, t("cammut.tools.details")), h("pre", { style: { fontSize: 12 } }, JSON.stringify(st.described, null, 2).slice(0, 4000))) : null) : null);
  }

  function CamObserver({ observer, onAction, t }) {
    const [source, setSource] = React.useState("cammut");
    const [view, setView] = React.useState("memories");
    const [q, setQ] = React.useState("");
    const data = observer && observer.ok ? observer.data : null;
    const list = data ? (Array.isArray(data.items) ? data.items : Array.isArray(data.results) ? data.results : null) : null;
    return h("div", { style: { display: "grid", gap: 10 } },
      h("div", { style: camRow },
        h("code", { "data-cammut-readonly": "true", style: tagStyle }, t("cammut.observer.readonly")),
        h(CamHint, { label: "About the observer", text: t("cammut.hint.observer") })),
      h("form", { onSubmit: (e) => { e?.preventDefault?.(); }, style: camRow },
        h("select", { "aria-label": t("cammut.observer.source"), "data-cammut-source": "true", value: source, onChange: (e) => setSource(e.target.value), style: { ...camInput, width: "auto" } },
          h("option", { value: "cammut" }, t("cammut.observer.cammut")), h("option", { value: "builtin" }, t("cammut.observer.builtin"))),
        h("select", { "aria-label": t("cammut.observer.view"), "data-cammut-view": "true", value: view, onChange: (e) => setView(e.target.value), style: { ...camInput, width: "auto" } },
          CAM_VIEWS.map((v) => h("option", { key: v, value: v }, v))),
        h("input", { type: "text", "aria-label": t("cammut.observer.query"), "data-cammut-observe-q": "true", placeholder: t("cammut.observer.query"), value: q, onChange: (e) => setQ(e.target.value), style: { ...camInput, flex: 1, minWidth: 140 } }),
        h("button", { type: "submit", "data-cammut-show": "true", onClick: () => onAction && onAction({ kind: "observe", source, view, q: q.trim() }), style: camBtn(true) }, t("cammut.observer.show"))),
      observer && observer.ok === false ? h("p", { role: "status", style: { margin: 0, fontSize: 12, opacity: 0.85 } }, camClamp(observer.error)) : null,
      list ? (list.length === 0 ? h("p", { style: { margin: 0, fontSize: 12, ...muted } }, t("cammut.observer.empty"))
        : h("ul", { "data-cammut-items": "true", style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 } },
          list.slice(0, 50).map((it, i) => h("li", { key: it.id || it.tag || i, style: { paddingTop: 6, borderTop: HAIRLINE, display: "grid", gap: 4 } },
            h("span", { style: { fontSize: 12 } }, camClamp(it.text || it.name || it.tag || it.summary || it.id || JSON.stringify(it))),
            Array.isArray(it.tags) && it.tags.length ? h("span", { style: camRow }, it.tags.slice(0, 6).map((tg) => h("code", { key: tg, style: tagStyle }, tg))) : null))))
        : data ? h("pre", { style: { fontSize: 12 } }, JSON.stringify(data, null, 2).slice(0, 4000)) : null);
  }

  function CamParts({ info, onAction, t }) {
    return h("div", { style: { display: "grid", gap: 8 } },
      h("div", { style: camRow }, h(CamHint, { label: "About parts", text: t("cammut.hint.parts") })),
      h("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 } },
        (info.components || []).map((c) => h("li", { key: c.name, style: { paddingTop: 8, borderTop: HAIRLINE, display: "grid", gap: 4 } },
          h("div", { style: { ...camRow, justifyContent: "space-between" } },
            h("span", { style: camRow }, h("code", { style: tagStyle }, c.name), h("span", { style: { ...muted, fontSize: 12 } }, `${c.state}, version ${c.generation}`)),
            h("span", { style: camRow },
              h("button", { type: "button", "data-cammut-reload": c.name, onClick: () => onAction && onAction({ kind: "component-reload", name: c.name }), style: camBtn(false) }, t("cammut.parts.reload")),
              h("button", { type: "button", "data-cammut-rollback": c.name, disabled: !c.canRollback, onClick: () => onAction && onAction({ kind: "component-rollback", name: c.name }), style: camBtn(false) }, t("cammut.parts.rollback")))),
          c.error ? h("p", { style: { margin: 0, fontSize: 12, ...muted } }, camClamp(c.error)) : null))));
  }

  function CammutView({ info, error = "", busy = false, tab = "servers", onTab, observer = null, tools = null, onAction, t }) {
    const status = error || (info ? (info.gateway.reachable ? t("cammut.gateway.on", { host: info.gateway.host }) : t("cammut.gateway.off", { host: info.gateway.host })) : t("cammut.loading"));
    const why = info && !info.canManage ? info.manageReason : "";
    return h("section", { className: "arc-cam", "aria-label": t("connector.cammut"), "data-connector-view": "Cammut", style: { display: "grid", gap: 14, fontFamily: TEXT_FONT, fontSize: 13, lineHeight: 1.5, color: INK } },
      h("style", null, CAM_CSS),
      h("div", { "data-cammut-head": "true", style: { display: "flex", gap: 12, alignItems: "center" } },
        h(CamCube, { size: 40 }),
        h("div", { style: { display: "grid", gap: 2, minWidth: 0, flex: 1 } },
          h("div", { style: { ...camRow, justifyContent: "space-between" } },
            h("h3", { style: { fontSize: 19, lineHeight: 1.25, fontWeight: 600, letterSpacing: "-0.02em", margin: 0 } }, t("connector.cammut")),
            h(CamHint, { label: "About Cammut servers", text: t("cammut.hint.servers") })),
          h("p", { role: "status", "data-cammut-status": "true", title: status, style: { margin: 0, fontSize: 12, ...muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, camClamp(status)))),
      why ? h("p", { "data-cammut-why": "true", style: { margin: 0, fontSize: 12, ...muted } }, camClamp(why)) : null,
      info ? h("div", { role: "tablist", "aria-label": t("connector.cammut"), style: { ...camRow, paddingBottom: 8, borderBottom: HAIRLINE } },
        CAM_TABS.map((k) => h("button", { key: k, type: "button", role: "tab", "aria-selected": tab === k, "data-cammut-tab": k, onClick: () => onTab && onTab(k), style: camTab(tab === k) }, t(`cammut.tab.${k}`)))) : null,
      info && tab === "servers" ? h(CamServers, { info, busy, onAction, t }) : null,
      info && tab === "tools" ? h(CamTools, { tools, onAction, t }) : null,
      info && tab === "observer" ? h(CamObserver, { observer, onAction, t }) : null,
      info && tab === "parts" ? h(CamParts, { info, onAction, t }) : null);
  }

  function CammutPane({ t }) {
    const [info, setInfo] = React.useState(null);
    const [error, setError] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [tab, setTab] = React.useState("servers");
    const [observer, setObserver] = React.useState(null);
    const [tools, setTools] = React.useState({ list: [], tool: "", run: null, described: null });
    const post = async (route, body) => {
      const r = await fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
      return r.json().catch(() => null);
    };
    const load = async () => {
      try { const j = await post("api/arc-core/cammut/state"); if (j && j.ok) { setInfo(j); setError(""); } else setError((j && j.error) || "Could not read the Cammut state."); } catch { setError("Could not read the Cammut state."); }
    };
    const act = async (p) => {
      if (p.kind === "tool-pick") { setTools((s) => ({ ...s, tool: p.tool, run: null, described: null })); return; }
      setError(""); setBusy(true);
      try {
        const j = await post("api/arc-core/cammut/action", p);
        if (p.kind === "observe") setObserver(j);
        else if (p.kind === "tool-search") { if (j && j.ok) setTools((s) => ({ ...s, list: j.tools || [] })); else setError((j && j.error) || "Search failed."); }
        else if (p.kind === "tool-describe") setTools((s) => ({ ...s, described: j && j.ok ? j.data : null }));
        else if (p.kind === "tool-run") setTools((s) => ({ ...s, run: j }));
        else if (!j || j.ok === false) setError((j && j.error) || "The action failed.");
        if (p.kind.startsWith("server-") || p.kind.startsWith("component-")) await load();
      } catch { setError("The action failed."); }
      setBusy(false);
    };
    React.useEffect(() => { load(); }, []);
    return h(CammutView, { info, error, busy, tab, onTab: setTab, observer, tools, onAction: act, t });
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
    const activeTop = settingsOpen ? "" : inConnectorMode ? "Connectors" : activeWorkspace;
    const connectorLabel = (conn) => (conn === "Updates" && data && data.update && data.update.available && data.update.latest ? `Updates (${data.update.latest})` : conn);

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
      h("style", null, CONSOLE_CSS),
      !data && !failed ? h("p", { style: { ...muted, margin: 0 } }, t("state.loading")) : null,
      failed && !data ? h("div", { style: rowWrapStyle },
        h("span", { role: "alert" }, t("state.error")),
        onRefresh ? h("button", { type: "button", "data-console-retry": "true", onClick: () => onRefresh(), style: btnStyle(false) }, t("action.retry")) : null) : null,

      data ? h("header", { style: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-end", borderBottom: HAIRLINE } },
        h("div", { role: "tablist", "aria-label": t("nav.console"), "data-console-tabs": "primary", onKeyDown: onTabKeys, style: { display: "flex", columnGap: 14, rowGap: 2, flexWrap: "wrap" } },
          TOP_TABS.map((name, i) => {
            const isWorkspace = WORKSPACES.includes(name);
            const isActive = name === activeTop;
            return h("button", {
              key: name,
              type: "button",
              role: "tab",
              id: `arc-tab-${name}`,
              "aria-selected": isActive,
              "aria-controls": "arc-console-panel",
              tabIndex: isActive || (!activeTop && i === 0) ? 0 : -1,
              "data-top-control": name,
              ...(isWorkspace ? { "data-workspace": name } : { "data-connector-group": "true" }),
              onClick: () => (isWorkspace ? onSelectWorkspace && onSelectWorkspace(name) : onSelectConnector && onSelectConnector(activeConnector)),
              style: tabStyle(isActive),
            }, isWorkspace ? name : t("nav.connectors"));
          })),
        h("button", {
          type: "button",
          id: "arc-tab-Settings",
          "data-top-control": "Settings",
          "data-settings-toggle": "true",
          "aria-label": t("nav.console.settings"),
          title: t("nav.console.settings"),
          "aria-pressed": settingsOpen,
          onClick: () => onToggleSettings && onToggleSettings(!settingsOpen),
          style: { ...iconBtnStyle(settingsOpen), marginBottom: 4 },
        }, h(SettingsIcon, null))) : null,

      h("div", { role: data ? (activeTop ? "tabpanel" : "region") : undefined, id: "arc-console-panel", "aria-labelledby": data ? `arc-tab-${activeTop || "Settings"}` : undefined, style: { display: "grid", gap: 14, alignContent: "start" } },

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
                    role: "switch",
                    "data-operator-switch": r.id,
                    "aria-checked": Boolean(r.active),
                    "aria-label": `${r.id} ${r.label}`,
                    onClick: () => onToggleSwitch && onToggleSwitch(r.id, !r.active),
                    style: btnStyle(r.active),
                  }, r.active ? t("state.on") : t("state.off"))))))
        : null,

      data && inConnectorMode
        ? h(React.Fragment, null,
            h("div", { role: "tablist", "aria-label": t("nav.connectors"), "data-console-tabs": "connectors", onKeyDown: onTabKeys, style: { display: "flex", gap: 6, flexWrap: "wrap" } },
              CONNECTORS.map((conn, i) => {
                const isActive = activeConnector === conn;
                return h("button", {
                  key: conn,
                  type: "button",
                  role: "tab",
                  id: `arc-subtab-${conn}`,
                  "aria-selected": isActive,
                  "aria-controls": "arc-console-subpanel",
                  tabIndex: isActive || (!CONNECTORS.includes(activeConnector) && i === 0) ? 0 : -1,
                  "data-connector": conn,
                  onClick: () => onSelectConnector && onSelectConnector(conn),
                  style: btnStyle(isActive),
                }, connectorLabel(conn));
              })),
            h("div", { role: "tabpanel", id: "arc-console-subpanel", "aria-labelledby": `arc-subtab-${activeConnector}` },
              h(ConnectorView, {
                connector: activeConnector,
                detail: data.connectorsDetail,
                onOpenConsent,
                onRefresh,
                grants: (data.consents || []).length,
                t,
              })))
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
            h("div", { "data-memory-status": "true", style: rowWrapStyle },
              h(StatusDot, { state: data.memory.state }),
              h("span", { role: "status", title: String(data.memory.status || "") }, oneLine(data.memory.status || (data.memory.reachable ? "Running." : "No answer."))),
              h("code", { style: tagStyle }, data.memory.gateway),
              data.memory.action === "refresh" && onRefresh ? h("button", { type: "button", "data-row-action": "memory", onClick: () => onRefresh(), style: btnStyle(false) }, t("action.again")) : null),
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

      ));
  }

  const consoleViews = new Set(); // the refresh function of every mounted pane or Settings page
  function useConsole() {
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
          setActionError(""); setFailed(false); await refresh();
          for (const other of consoleViews) if (other !== refresh) other();
          return j;
        } catch { setActionError("Action failed"); setFailed(true); return { ok: false, error: "Action failed" }; }
      };

      React.useEffect(() => {
        refresh();
        consoleViews.add(refresh);
        return () => { consoleViews.delete(refresh); };
      }, []);

      return { data, failed, actionError, pendingConsent, setPendingConsent, dispatch };
  }

  function makePane(t) {
    return function ArcConsolePane() {
      const { data, failed, actionError, pendingConsent, setPendingConsent, dispatch } = useConsole();
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

  const SETTINGS_SECTIONS = [
    { id: "memory", order: 11 },
    { id: "connectors", order: 12 },
    { id: "keys", order: 13 },
    { id: "add-ons", order: 14 },
    { id: "updates", order: 15, connector: "Updates" }, // drawn only when the Updates connector view exists
  ];

  function makeSettingsSection(section, t) {
    return function ArcSettingsSection() {
      const { data, failed, actionError, pendingConsent, setPendingConsent, dispatch } = useConsole();
      return h(SettingsSectionView, {
        section, data, failed, actionError, pendingConsent, t,
        onRefresh: () => dispatch({ kind: "refresh" }),
        onOpenConsent: (req) => setPendingConsent(req),
        onCloseConsent: () => setPendingConsent(null),
        onConsent: async (req) => { await dispatch({ kind: "consent", ...req }); setPendingConsent(null); },
      });
    };
  }

  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { en, zh: en }), "arc-core: dictionaries");
    const t = ctx.locale.bind(NS);
    if (ctx.slots && typeof ctx.slots.inject === "function") {
      for (const sec of SETTINGS_SECTIONS.filter((x) => !x.connector || CONNECTORS.includes(x.connector))) {
        const Section = makeSettingsSection(sec.id, t);
        ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: sec.id, order: sec.order, label: () => t(`settings.nav.${sec.id.replace("-", "")}`), locale: NS }, Section));
      }
    }
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
    CammutView,
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
    SettingsSectionView,
    SETTINGS_SECTIONS,
    InfoHint,
    StatusDot,
  };
} });
