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
    "cammut.hint.tools": "This runner calls the Hindsight tools of the Cammut server, or of the built-in store on this computer. Pick the source first. Reading runs at once. Adding or changing memory asks you to confirm. Every other tool counts as a delete and asks you to type the tool name. To save a note in the built-in store, pick it, search, and run retain.",
    "cammut.hint.observer": "The observer only reads. It cannot add, change or delete anything. A connection holds one memory bank, so there is one bank to browse.",
    "cammut.hint.parts": "A part is a piece of Arc Harness that can be replaced while the app runs. Reload loads the file on disk and tests it first. If the test fails, the old version keeps working. This tab itself needs a page reload.",
    "settings.title": "Console settings",
    "settings.theme": "Active theme",
    "settings.switches": "Operator switches",
    "view.servers": "Servers",
    "view.keys": "Keys",
    "view.apps": "Apps",
    "view.audit": "Audit",
    "view.cammut": "Cammut",
    "nav.console": "Console sections",
    "nav.connectors.update": "Connectors, version {v} is available",
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
    "empty.cammut": "Cammut is not set up yet.",
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
    "settings.connectors.hint": "Servers are the local programs that Arc Harness talks to. The Access page lists the apps and what each may use.",
    "settings.keys.hint": "Arc Harness shows where each key is kept and never its value. Keys stay in files on this computer and in the system key store. No key is typed on this page.",
    "settings.addons.hint": "Add-ons are the Arc plugins installed on this computer. The list is for reference. The installer and the updater change it.",
    "settings.about": "About this page",
    "settings.nav.access": "Access",
    "access.sub": "The grants each app holds, where keys are kept, and what was recorded.",
    "access.views": "Parts of the Access page",
    "access.tab.apps": "Apps",
    "access.tab.keys": "Keys",
    "access.tab.activity": "Activity",
    "access.until": "Until {date}",
    "access.none": "No access",
    "access.end": "End access",
    "access.end.title": "End access for {app}?",
    "access.end.conseq": "The grant for {app} ends now. The app can ask again.",
    "access.end.label": "End access for {app}",
    "access.cancel": "Cancel",
    "access.close": "Close",
    "access.key.hint": "A key never shows here. This page lists where each one is kept.",
    "access.empty.apps": "No app has asked for access yet.",
    "access.empty.keys": "No key is listed yet.",
    "access.empty.activity": "Nothing was recorded yet.",
    "access.loading": "Loading…",
    "upd.sub": "The version of the Arc parts on this computer, and how new ones arrive.",
    "upd.parts": "Arc add-ons and programs",
    "upd.ver.unknown": "Installed version unknown",
    "upd.ver.1": "Installed {i}",
    "upd.ver.2": "Installed {i}, newest {n}",
    "upd.ver.3": "Installed {i}, newest {n}, checked {date}",
    "upd.s.unchecked": "Not checked yet",
    "upd.s.norelease": "No release found",
    "upd.s.checking": "Checking",
    "upd.s.needs": "Needs update",
    "upd.s.nokit": "No installable files yet",
    "upd.s.current": "Up to date",
    "upd.s.restart": "Restart to finish",
    "upd.s.broken": "Not complete",
    "upd.phase.downloading": "Downloading",
    "upd.phase.verifying": "Checking the files",
    "upd.phase.staging": "Unpacking",
    "upd.phase.installing": "Installing",
    "upd.phase.testing": "Testing",
    "upd.detail": "The whole message",
    "upd.left.label": "Programs that were not replaced",
    "upd.left": "Not found on this computer, so not replaced: {names}.",
    "upd.earlier": "Version before the last update",
    "upd.back.hint": "Roll back puts the earlier add-ons and programs back. Install it then skips the version you left.",
    "upd.back.title": "Roll back to {v}?",
    "upd.back.conseq": "Version {v} returns after a restart. Your settings and notes stay.",
    "upd.earlier.unknown": "Version unknown",
    "upd.back.title.any": "Roll back to the earlier version?",
    "upd.back.conseq.any": "The earlier version returns after a restart. Your settings and notes stay.",
    "upd.notes": "What changed in {v}",
    "upd.mode": "When a new version appears",
    "upd.mode.off": "Do nothing",
    "upd.mode.notify": "Tell me",
    "upd.mode.auto": "Install it",
    "upd.mode.hint": "Do nothing never looks for new versions. Tell me looks and shows them here. Install it also installs them. Check now and Update now work with every choice.",
    "upd.auto.title": "Install new versions without asking?",
    "upd.auto.conseq": "A new version then installs by itself and works after the next start of the app.",
    "upd.auto.go": "Install without asking",
    "upd.skip": "Skips {v} after a failure or a roll back.",
    "upd.chan": "Channel",
    "upd.chan.release": "Release",
    "upd.chan.beta": "Beta",
    "upd.chan.alpha": "Alpha",
    "upd.chan.release.sub": "Tested versions.",
    "upd.chan.beta.sub": "The next version, for a try before its release.",
    "upd.chan.alpha.sub": "The earliest versions. A version can break.",
    "upd.chan.hint": "Release has tested versions. Beta also has the next version, for a try before its release. Alpha also has the earliest versions, which can break.",
    "upd.alpha.title": "Switch to Alpha?",
    "upd.alpha.conseq": "Alpha versions are the earliest and can break. You can switch back.",
    "upd.alpha.conseq.auto": "Alpha versions are the earliest and can break. They then install by themselves.",
    "upd.alpha.go": "Switch to Alpha",
    "upd.s.ahead": "Newer than {channel}",
    "upd.goback": "Go back to {v}",
    "upd.goback.title": "Go back to {v}?",
    "upd.goback.go": "Go back",
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
  function InfoHint({ label, text, align = "start", glyph = "?" }) {
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
      }, glyph),
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

  // ---- kit (S053, console rewrite): the parts of the approved prototype, in the sizes of the host app.
  // Own line icons on a 16 px grid. Colours come from the host theme, so each theme keeps its own look: no fixed colour,
  // and a state that needs attention shows as a ring, the way StatusDot does.
  const ICONS = Object.assign({ gear: '<circle cx="8" cy="8" r="2"/><path d="M8 1.6l1.1 1.5 1.8-.4.6 1.8 1.8.6-.4 1.8L14.4 8l-1.5 1.1.4 1.8-1.8.6-.6 1.8-1.8-.4L8 14.4l-1.1-1.5-1.8.4-.6-1.8-1.8-.6.4-1.8L1.6 8l1.5-1.1-.4-1.8 1.8-.6.6-1.8 1.8.4z"/>', data: '<ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>', down: '<path d="M4.5 6.25 8 9.75l3.5-3.5"/>', check: '<path d="M3.5 8.5 6.5 11.5 12.5 4.5"/>', plus: '<path d="M8 3v10M3 8h10"/>', more: '<circle cx="3.5" cy="8" r=".6"/><circle cx="8" cy="8" r=".6"/><circle cx="12.5" cy="8" r=".6"/>', warn: '<path d="M8 2.2 14.3 13H1.7z"/><path d="M8 6.5v3M8 11.3v.2"/>', close: '<path d="M4 4l8 8M12 4l-8 8"/>', ask: '<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/><path d="M8 5.5v3M6.5 7h3"/>', back: '<path d="M9.75 4.5 6.25 8l3.5 3.5"/>', info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.6M8 5.2v.2"/>', out: '<path d="M6 4h6v6M12 4 4.5 11.5"/>', console: '<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M5 7l2 1.5L5 10M8.5 10h2.5"/>', trace: '<circle cx="4" cy="4" r="1.5"/><circle cx="12" cy="8" r="1.5"/><circle cx="4" cy="12" r="1.5"/><path d="M5.5 4H9a1.5 1.5 0 0 1 1.5 1.5v1M5.5 12H9a1.5 1.5 0 0 0 1.5-1.5v-1"/>', figure: '<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M4.5 10.5 7 7.5l2 2 2.5-3.5"/>' }, { link: '<path d="M6.6 9.4a2.5 2.5 0 0 0 3.5 0l2.3-2.3a2.5 2.5 0 0 0-3.5-3.5l-.7.7"/><path d="M9.4 6.6a2.5 2.5 0 0 0-3.5 0L3.6 8.9a2.5 2.5 0 0 0 3.5 3.5l.7-.7"/>', shield: '<path d="M8 1.8 13 3.6v4.1c0 3-2 5.3-5 6.5-3-1.2-5-3.5-5-6.5V3.6z"/><path d="M5.8 8l1.6 1.6 2.9-3.2"/>', layers: '<path d="M8 2 14 5 8 8 2 5z"/><path d="M2 8l6 3 6-3M2 11l6 3 6-3"/>', blocks: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><path d="M11.25 9.2v4.1M9.2 11.25h4.1"/>', update: '<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.6 2.2v2.6H11"/>', sliders: '<path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7"/><circle cx="11" cy="4.5" r="1.5"/><circle cx="5" cy="11.5" r="1.5"/>', flask: '<path d="M6.2 2h3.6M6.8 2v4.2L3.2 12.4A1.2 1.2 0 0 0 4.3 14h7.4a1.2 1.2 0 0 0 1.1-1.6L9.2 6.2V2"/><path d="M5 10.5h6"/>', prose: '<path d="M2.5 4h11M2.5 7.5h7M2.5 11h4"/><path d="M9.5 11.2l1.6 1.6 2.9-3.3"/>', pulse: '<path d="M1.5 8.5h3l1.5-4 3 8 1.8-4h3.7"/>', chip: '<rect x="4" y="4" width="8" height="8" rx="1.5"/><path d="M6.5 1.8V4M9.5 1.8V4M6.5 12v2.2M9.5 12v2.2M1.8 6.5H4M1.8 9.5H4M12 6.5h2.2M12 9.5h2.2"/>', plug: '<path d="M6 1.8v3M10 1.8v3M4 4.8h8v2.7a4 4 0 0 1-8 0z"/><path d="M8 11.5v2.7"/>', remote: '<rect x="2" y="2.8" width="12" height="8.4" rx="1.5"/><path d="M5.5 13.5h5M8 11.2v2.3"/>', play: '<path d="M5 3.2v9.6l8-4.8z"/>', pencil: '<path d="M3 13l.6-2.8L10.9 3l2.1 2.1-7.2 7.3z"/><path d="M9.5 4.4l2.1 2.1"/>', trash: '<path d="M3 4.5h10M6.2 4.5V3h3.6v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v3.8M9.2 7v3.8"/>', lines: '<path d="M3 4h10M3 8h10M3 12h6"/>', pin: '<path d="M9.5 2.2 13.8 6.5l-2 .6-2.2 2.2.3 2.6-1 1-6-6 1-1 2.6.3 2.2-2.2z"/><path d="M5.6 10.4 2.5 13.5"/>', up: '<path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"/>', arrowdown: '<path d="M8 3.5v9M4.5 9 8 12.5 11.5 9"/>', top: '<path d="M3.5 3h9M8 13V6.2M4.8 9.2 8 6l3.2 3.2"/>', undo: '<path d="M3 6.5h6.5a3.5 3.5 0 0 1 0 7H6"/><path d="M5.8 3.7 3 6.5l2.8 2.8"/>', pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>', gateway: '<circle cx="3.5" cy="8" r="1.5"/><circle cx="12.5" cy="4" r="1.5"/><circle cx="12.5" cy="12" r="1.5"/><path d="M5 8h2.5l3.6-3.4M7.5 8l3.6 3.4"/>', search: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 13.5 13.5"/>', sort: '<path d="M4.5 3v10M2.5 11l2 2 2-2M9 4h4.5M9 8h3M9 12h1.5"/>', cloud: '<path d="M4.6 12.5a3 3 0 0 1-.4-6 4 4 0 0 1 7.7-.6 3.3 3.3 0 0 1-.4 6.6z"/>', copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V4a1.5 1.5 0 0 1 1.5-1.5H11"/>', cube: '<path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z"/><path d="M2.5 5 8 8.2 13.5 5M8 8.2v6"/>', app: '<rect x="2.5" y="2.5" width="11" height="11" rx="3"/><circle cx="8" cy="8" r="2"/>', eye: '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>', clip: '<path d="M12.6 7.4 7.5 12.5a3 3 0 0 1-4.2-4.2l5.4-5.4a2 2 0 0 1 2.8 2.8L6.2 11a1 1 0 0 1-1.4-1.4l4.6-4.6"/>', download: '<path d="M8 2.5v7M5 6.8l3 3 3-3M3 13h10"/>', theme: '<circle cx="8" cy="8" r="6"/><path d="M8 2v12M8 5h4.8M8 8h6M8 11h4.8"/>', flow: '<rect x="2" y="2.5" width="5" height="3.5" rx="1"/><rect x="9" y="10" width="5" height="3.5" rx="1"/><path d="M4.5 6v3.8a2 2 0 0 0 2 2H9"/>', globe: '<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2.2 2 2.2 10 0 12M8 2c-2.2 2-2.2 10 0 12"/>', sidebar: '<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M6 3v10"/>', forward: '<path d="M3 4.2v7.6L8.2 8zM8.8 4.2v7.6L14 8z"/>', flag: '<path d="M3.5 14V2.5M3.5 3h8l-1.6 2.6L11.5 8.2h-8"/>', stop: '<circle cx="8" cy="8" r="6"/><path d="M3.8 3.8l8.4 8.4"/>' });
  const KIT_CSS = [
    "{--ak-label:var(--dsw-alias-label-primary,currentColor);--ak-label-2:color-mix(in srgb,var(--ak-label) 76%,transparent);--ak-label-3:color-mix(in srgb,var(--ak-label) 66%,transparent);--ak-line-2:color-mix(in srgb,var(--ak-label) 10%,transparent);--ak-line-3:color-mix(in srgb,var(--ak-label) 16%,transparent);--ak-hover:color-mix(in srgb,var(--ak-label) 6%,transparent);--ak-pressed:color-mix(in srgb,var(--ak-label) 10%,transparent);--ak-layer:var(--dsw-alias-bg-layer-1,Canvas);--ak-on-primary:var(--dsw-alias-bg-base,Canvas);--ak-brown:var(--dsw-alias-brand-primary-new-colorprimary-new-color,currentColor);max-width:720px;font-family:" + TEXT_FONT + ";font-size:14px;line-height:22px;color:var(--ak-label)}",
    " .ak-ic{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}",
    " button:focus-visible{outline:2px solid currentColor;outline-offset:2px}",
    " .mono{font-family:" + MONO_FONT + ";font-size:12px}",
    " .ak-title{display:grid;grid-template-columns:1fr auto;gap:4px 12px;align-items:center;margin-bottom:12px}",
    " .ak-title h1{grid-column:1;grid-row:1;margin:0;font-size:16px;line-height:24px;font-weight:500}",
    " .ak-title p{grid-column:1/-1;grid-row:2;margin:0;font-size:14px;line-height:22px;color:var(--ak-label-3)}",
    " .ak-title .acts{grid-column:2;grid-row:1;display:flex;gap:8px;justify-content:flex-end}",
    " .ak-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:0;border-radius:10px;background:transparent;font:inherit;font-size:14px;line-height:22px;color:var(--ak-label);white-space:nowrap;flex:none;cursor:pointer}",
    " .ak-btn:hover{background:var(--ak-hover)}",
    " .ak-btn:active{background:var(--ak-pressed)}",
    " .ak-btn.primary{background:var(--ak-label);color:var(--ak-on-primary)}",
    " .ak-btn.primary:hover{opacity:.86}",
    " .ak-btn.primary:focus-visible{outline-color:var(--ak-label)}",
    " .ak-btn.outline{border:.5px solid var(--ak-line-3)}",
    " .ak-btn.sm{height:28px;padding:0 10px;border-radius:8px;font-size:12px;line-height:18px}",
    " .ak-btn.icon{width:28px;height:28px;padding:0;border-radius:8px}",
    " .ak-btn:disabled{opacity:.4;cursor:not-allowed}",
    " .ak-seg{display:inline-flex;gap:2px;padding:4px;border-radius:10px;background:var(--ak-hover)}",
    " .ak-seg button{height:28px;padding:0 16px;border:0;border-radius:8px;background:transparent;font:inherit;font-size:13px;line-height:20px;font-weight:500;color:var(--ak-label-2);white-space:nowrap;cursor:pointer}",
    " .ak-seg button[aria-selected=true]{background:var(--ak-layer);color:var(--ak-label);box-shadow:0 0 0 .5px var(--ak-line-3),0 4px 16px color-mix(in srgb,var(--ak-label) 4%,transparent)}",
    " .ak-seg button[aria-pressed=true]{background:var(--ak-layer);color:var(--ak-label);box-shadow:0 0 0 .5px var(--ak-line-3),0 4px 16px color-mix(in srgb,var(--ak-label) 4%,transparent)}",
    " .ak-seg button:disabled{opacity:.4;cursor:not-allowed}",
    " .ak-rows{margin-top:8px}",
    " .ak-row{display:flex;gap:12px 16px;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:.5px solid var(--ak-line-2)}",
    " .ak-rows>.ak-row:last-child{border-bottom:0}",
    " .ak-row .text{flex:1;min-width:0}",
    " .ak-row .name{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:14px;line-height:22px;overflow-wrap:anywhere}",
    " .ak-row .sub{margin-top:2px;font-size:12px;line-height:18px;color:var(--ak-label-3);overflow-wrap:anywhere}",
    " .ak-row .end{display:flex;gap:12px;align-items:center;flex:none}",
    " .ak-chips{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}",
    " .ak-chip{font-size:12px;line-height:18px;padding:1px 8px;border-radius:6px;background:var(--ak-hover);color:var(--ak-label-2)}",
    " .ak-status{display:inline-flex;align-items:center;gap:6px;font-size:13px;line-height:20px;color:var(--ak-label-2);white-space:nowrap}",
    " .ak-dot{width:8px;height:8px;border-radius:50%;background:var(--ak-line-3);flex:none}",
    " .ak-dot.on{background:var(--ak-brown)}",
    " .ak-dot.warn{background:transparent;box-shadow:inset 0 0 0 2px var(--ak-label-2)}",
    " .ak-empty{margin:0;padding:14px 0;font-size:13px;line-height:20px;color:var(--ak-label-3)}",
    " .ak-alert{margin:0 0 8px;font-size:13px;line-height:20px}",
    " .ak-notice{color:var(--ak-label-2)}",
    " .ak-mask{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:color-mix(in srgb,var(--ak-on-primary) 64%,transparent)}",
    " .ak-modal{width:min(420px,calc(100vw - 32px));border-radius:20px;background:var(--ak-layer);box-shadow:0 0 0 .5px var(--ak-line-3),0 3px 8px color-mix(in srgb,var(--ak-label) 6%,transparent),0 0 20px color-mix(in srgb,var(--ak-label) 8%,transparent)}",
    " .ak-modal header{display:flex;justify-content:space-between;align-items:center;padding:22px 14px 12px 24px}",
    " .ak-modal h2{margin:0;font-size:16px;line-height:24px;font-weight:500}",
    " .ak-conseq{margin:0;padding:8px 24px 0;font-size:13px;line-height:20px;color:var(--ak-label-2)}",
    " .ak-modal footer{display:flex;justify-content:flex-end;gap:8px;padding:20px 24px 24px}",
    " .ak-pick{position:relative;display:inline-flex}",
    " .ak-dd{display:inline-flex;align-items:center;justify-content:space-between;gap:10px;height:36px;padding:0 10px 0 14px;border:0;border-radius:10px;background:var(--ak-hover);font:inherit;font-size:14px;line-height:22px;color:var(--ak-label);white-space:nowrap;cursor:pointer}",
    " .ak-dd:hover{background:var(--ak-pressed)}",
    " .ak-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:5;display:grid;min-width:100%;padding:4px;border-radius:10px;background:var(--ak-layer);box-shadow:0 0 0 .5px var(--ak-line-3),0 4px 16px color-mix(in srgb,var(--ak-label) 8%,transparent)}",
    " .ak-menu button{display:flex;align-items:center;justify-content:space-between;gap:12px;height:32px;padding:0 10px;border:0;border-radius:6px;background:transparent;font:inherit;font-size:14px;line-height:22px;color:var(--ak-label);white-space:nowrap;cursor:pointer}",
    " .ak-menu button:hover,[data-arc-kit] .ak-menu button:focus-visible{background:var(--ak-hover)}",
    " .ak-need{display:inline-flex;align-items:center;gap:4px;font-size:13px;line-height:20px;font-weight:500;white-space:nowrap}",
    " .ak-meter{width:96px;height:4px;border-radius:2px;background:var(--ak-line-3);overflow:hidden;flex:none}",
    " .ak-meter i{display:block;height:100%;background:var(--ak-brown)}",
    " .ak-fold{margin-left:-10px}",
    " .ak-notes{margin:8px 0 0;max-height:240px;overflow:auto;font-size:13px;line-height:20px;color:var(--ak-label-2);white-space:pre-wrap;overflow-wrap:anywhere}",
  ].map((rule) => "[data-arc-kit]" + rule).join("");

  function Ic({ n, size = 16 }) {
    return h("svg", { className: "ak-ic", width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": true, "data-ic": n, dangerouslySetInnerHTML: { __html: ICONS[n] || "" } });
  }
  function KBtn({ look = "", small = false, icon = "", label, aria = "", onClick, disabled = false, autoFocus = false }) {
    return h("button", { type: "button", className: ["ak-btn", look, small ? "sm" : ""].filter(Boolean).join(" "), "aria-label": aria || undefined, onClick, disabled, autoFocus }, icon ? h(Ic, { n: icon }) : null, label);
  }
  // a switch between the views of one page: arrow keys move the focus, a click or Enter selects
  // With `pressed`, the same look is a choice of one setting: a group of pressed buttons, no tabs. The choice that is already
  // set sends nothing.
  function Seg({ label, value, options, onChange, pressed = false, disabled = false }) {
    if (pressed) {
      return h("div", { className: "ak-seg", role: "group", "aria-label": label },
        options.map(([id, text]) => h("button", { key: id, type: "button", "aria-pressed": value === id, "data-seg": id, disabled, onClick: (e) => { if (value !== id && onChange) onChange(id, e && e.currentTarget); } }, text)));
    }
    return h("div", { className: "ak-seg", role: "tablist", "aria-label": label, onKeyDown: onTabKeys },
      options.map(([id, text]) => h("button", { key: id, type: "button", role: "tab", id: `ak-tab-${id}`, "aria-selected": value === id, tabIndex: value === id ? 0 : -1, "data-seg": id, onClick: () => onChange && onChange(id) }, text)));
  }
  function KStatus({ text, dot }) {
    return h("span", { className: "ak-status" }, dot === undefined ? null : h("span", { className: `ak-dot ${dot}`.trim(), "aria-hidden": true }), text);
  }
  function KRow({ kind, id, name, mono = false, tail = null, sub = "", chips = [], end = null }) {
    return h("div", { className: "ak-row", "data-row": kind, "data-id": id },
      h("div", { className: "text" },
        h("div", { className: mono ? "name mono" : "name" }, name, tail),
        chips.length ? h("div", { className: "ak-chips" }, chips.map((c, i) => h("span", { key: `${i}-${c}`, className: "ak-chip" }, c))) : null,
        sub ? h("div", { className: "sub" }, sub) : null),
      h("div", { className: "end" }, end));
  }
  // a question before an action that takes something away. Escape closes it and must not close the Settings dialog behind it.
  function Confirm({ title, text, action, onConfirm, onClose, t }) {
    const id = "ak-confirm-title";
    const keys = (e) => {
      if (e.key === "Escape") { e.stopPropagation?.(); e.nativeEvent?.stopImmediatePropagation?.(); if (onClose) onClose(); return; }
      if (e.key !== "Tab") return;
      const f = Array.from(e.currentTarget.querySelectorAll("button:not([disabled])"));
      const at = f.indexOf(e.currentTarget.ownerDocument.activeElement);
      if (!f.length) return;
      if (e.shiftKey && at <= 0) { f[f.length - 1].focus(); e.preventDefault(); } else if (!e.shiftKey && (at < 0 || at === f.length - 1)) { f[0].focus(); e.preventDefault(); }
    };
    return h("div", { className: "ak-mask", onMouseDown: (e) => { if (e.target === e.currentTarget && onClose) onClose(); } },
      h("div", { className: "ak-modal", role: "dialog", "aria-modal": true, "aria-labelledby": id, "aria-describedby": `${id}-text`, tabIndex: -1, onKeyDown: keys },
        h("header", null, h("h2", { id }, title),
          h("button", { type: "button", className: "ak-btn icon", "aria-label": t("access.close"), onClick: onClose }, h(Ic, { n: "close" }))),
        h("p", { className: "ak-conseq", id: `${id}-text` }, text),
        h("footer", null,
          h(KBtn, { look: "outline", label: t("access.cancel"), onClick: onClose, autoFocus: true }),
          h(KBtn, { look: "primary", label: action, onClick: onConfirm }))));
  }

  // a choice of one value from a short list. Escape closes the open list only, so the Settings dialog behind it stays.
  // Arrow keys open the list and move in it; focus that leaves the control closes it.
  function Pick({ label, value, options, onChange }) {
    const [open, setOpen] = React.useState(false);
    const now = options.find(([id]) => id === value);
    const keys = (e) => {
      if (e.key === "Escape") {
        if (!open) return;
        e.stopPropagation?.(); e.nativeEvent?.stopImmediatePropagation?.();
        setOpen(false);
        e.currentTarget?.querySelector?.("button")?.focus?.();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault?.();
      if (!open) { setOpen(true); return; }
      const list = Array.from(e.currentTarget?.querySelectorAll?.("[role=option]") || []);
      const at = list.indexOf(e.currentTarget?.ownerDocument?.activeElement);
      const to = e.key === "ArrowDown" ? (at + 1) % list.length : (at <= 0 ? list.length : at) - 1;
      list[to]?.focus?.();
    };
    const choose = (id, e) => {
      const trigger = e?.currentTarget?.closest?.(".ak-pick")?.querySelector?.("button") || null;
      trigger?.focus?.();
      setOpen(false);
      if (id !== value && onChange) onChange(id, trigger);
    };
    return h("span", { className: "ak-pick", onKeyDown: keys, onBlur: (e) => { if (!e.currentTarget?.contains?.(e.relatedTarget)) setOpen(false); } },
      h("button", { type: "button", className: "ak-dd", "aria-haspopup": "listbox", "aria-expanded": open, "aria-label": `${label}: ${now ? now[1] : ""}`, onClick: () => setOpen(!open) }, now ? now[1] : "", h(Ic, { n: "down" })),
      open ? h("div", { className: "ak-menu", role: "listbox", "aria-label": label },
        options.map(([id, text]) => h("button", { key: id, type: "button", role: "option", "aria-selected": id === value, "data-opt": id, tabIndex: -1, autoFocus: id === value, onClick: (e) => choose(id, e) }, text, id === value ? h(Ic, { n: "check" }) : null))) : null);
  }

  const monthDay = (ms) => { const d = new Date(Number(ms)); return Number(ms) > 0 && Number.isFinite(d.getTime()) ? `${d.getDate()} ${new Intl.DateTimeFormat(uiLang(), { month: "short" }).format(d)}` : ""; };
  const dayTime = (ms) => { const d = new Date(Number(ms)); const day = monthDay(ms); return day ? `${day}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : ""; };

  // Settings, Access: the grants each app holds, where keys are kept, and what was recorded. Pure: every value arrives in props.
  // The page lists and ends grant records. `tab` and `ending` set the first view and the open question; a test uses them.
  const DAY_MS = 24 * 3600 * 1000;
  function AccessPage({ data, failed = false, actionError = "", tab: firstTab = "apps", ending: firstEnding = null, nowMs = Date.now(), onRefresh, onEnd, t }) {
    const [tab, setTab] = React.useState(firstTab);
    const [ending, setEnding] = React.useState(firstEnding); // the id of the grant in question
    const back = React.useRef ? React.useRef(null) : { current: null };
    const [, setTick] = React.useState(0);
    const frame = (...kids) => h("div", { "data-arc-settings": "access", "data-arc-kit": "true", "data-arc-plugin-pane": "true" }, h("style", null, KIT_CSS), ...kids);
    const title = (acts = null) => h("div", { className: "ak-title" }, h("h1", null, t("settings.nav.access")), h("p", null, t("access.sub")), h("div", { className: "acts" }, acts));
    // React needs the same hooks on every render, so the page computes on an empty state before its data arrives
    // and returns its loading view only after the last hook.
    const state = data || {}, detail = state.connectorsDetail || {}, listed = detail.Apps || [];
    const live = (state.consents || []).filter((g) => g && typeof g.appId === "string" && Number(g.expiresAtMs) > nowMs);
    // One row for each active grant, so none stays hidden. A grant belongs to an app by the rule of the store: its id starts
    // with the id of the app; when two app ids fit, the longer one owns it. A grant of no listed app shows under its own id.
    // An app without a grant shows "No access".
    const owner = (g) => listed.filter((a) => g.appId.startsWith(a.id)).sort((x, y) => String(y.id).length - String(x.id).length)[0] || null;
    const rows = [];
    for (const a of listed) {
      const mine = live.filter((g) => owner(g) === a);
      for (const g of mine) rows.push({ key: g.appId, name: a.label, ask: mine.length > 1 ? g.appId : a.label, tail: mine.length > 1 ? g.appId : "", mono: false, grant: g });
      if (!mine.length) rows.push({ key: `app:${a.id}`, name: a.label, ask: a.label, tail: "", mono: false, grant: null });
    }
    for (const g of live) if (!owner(g)) rows.push({ key: g.appId, name: g.appId, ask: g.appId, tail: "", mono: true, grant: g });
    const target = rows.find((r) => r.grant && r.grant.appId === ending) || null;
    // a grant that left by another way (its time ended, a refresh dropped it) also closes its question
    React.useEffect(() => { if (ending && !target) setEnding(null); });
    // a grant that reaches its end time leaves the list by itself: one timer waits for the nearest end and draws the page again
    React.useEffect(() => {
      const next = Math.min(...live.map((g) => Number(g.expiresAtMs)));
      if (!Number.isFinite(next) || typeof setTimeout !== "function") return undefined;
      const id = setTimeout(() => setTick((n) => n + 1), Math.min(Math.max(next - Date.now(), 0) + 50, 2147483647));
      return () => clearTimeout(id);
    });
    if (!data) {
      return frame(title(), failed
        ? h(React.Fragment, null, h("p", { role: "alert", className: "ak-alert" }, t("state.error")), h(KBtn, { look: "outline", small: true, label: t("action.retry"), onClick: onRefresh }))
        : h("p", { role: "status", className: "ak-empty" }, t("access.loading")));
    }
    // after the question closes, the focus goes back to its button; after End access that button is gone, so it goes to the open tab
    const close = (done) => {
      const from = back.current, root = from && from.closest ? from.closest("[data-arc-kit]") : null;
      setEnding(null);
      const go = done && root ? root.querySelector("[role=tab][aria-selected=true]") : from;
      if (go && typeof setTimeout === "function") setTimeout(() => { if (go.isConnected) go.focus(); }, 0);
    };
    const words = (list) => (Array.isArray(list) ? list : []).filter((x) => typeof x === "string").map((x) => oneLine(x, 40));
    const until = (g) => t("access.until", { date: Number(g.expiresAtMs) - nowMs <= DAY_MS ? dayTime(g.expiresAtMs) : monthDay(g.expiresAtMs) });
    const empty = (key) => h("p", { className: "ak-empty" }, t(key));
    let list = null;
    if (tab === "apps") {
      list = rows.length === 0 ? empty("access.empty.apps") : rows.map((r) => h(KRow, {
        key: r.key, kind: "app", id: r.key, name: oneLine(r.name, 60), mono: r.mono, tail: r.tail ? h("span", { className: "mono" }, oneLine(r.tail, 48)) : null, chips: r.grant ? words(r.grant.scopes) : [],
        end: h(React.Fragment, null,
          h(KStatus, { text: r.grant ? until(r.grant) : t("access.none") }),
          r.grant ? h(KBtn, { look: "outline", small: true, label: t("access.end"), aria: t("access.end.label", { app: oneLine(r.ask, 60) }), onClick: (e) => { back.current = e && e.currentTarget ? e.currentTarget : null; setEnding(r.grant.appId); } }) : null),
      }));
    } else if (tab === "keys") {
      const keys = detail.Keys || [];
      list = keys.length === 0 ? empty("access.empty.keys") : keys.map((k) => h(KRow, {
        key: k.id, kind: "key", id: k.id, name: oneLine(k.label, 60), sub: oneLine(k.status, 90),
        end: h("span", { className: "ak-status" }, h("span", { className: k.state === "ok" ? "ak-dot on" : "ak-dot", "aria-hidden": true }), h("span", { className: "mono" }, oneLine(k.ref, 48))),
      }));
    } else {
      const events = detail.Audit || [];
      list = events.length === 0 ? empty("access.empty.activity") : events.map((r) => h(KRow, {
        key: r.id, kind: "activity", id: r.id, name: oneLine(r.summary, 90), tail: h("span", { className: "mono" }, oneLine(r.kind, 40)), sub: dayTime(r.atMs),
      }));
    }
    const app = target ? oneLine(target.ask, 43) : ""; // the consequence line stays inside 90 characters
    return frame(
      title(tab === "keys" ? h(InfoHint, { label: t("settings.about"), text: t("access.key.hint"), align: "end", glyph: h(Ic, { n: "info" }) }) : null),
      actionError ? h("p", { role: "alert", className: "ak-alert" }, oneLine(actionError)) : null,
      h(Seg, { label: t("access.views"), value: tab, onChange: setTab, options: [["apps", t("access.tab.apps")], ["keys", t("access.tab.keys")], ["activity", t("access.tab.activity")]] }),
      h("div", { className: "ak-rows", role: "tabpanel", "aria-labelledby": `ak-tab-${tab}` }, list),
      target ? h(Confirm, {
        t, title: t("access.end.title", { app }), text: t("access.end.conseq", { app }), action: t("access.end"),
        onClose: () => close(false),
        onConfirm: () => { if (onEnd) onEnd({ appId: target.grant.appId, mode: "Revoke" }); close(true); },
      }) : null);
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

  // Settings, Updates: the version of the Arc parts, the earlier version, what changed, and what happens with a new version.
  // Pure: the update state and every action arrive in props. `asking` and `open` set the first question and the open notes; a test uses them.
  // One kit replaces the add-ons and both programs, so the page has one row and one Update now for them.
  function UpdatesPage({ info, error = "", pending = false, asking: firstAsking = null, open: firstOpen = false, onAction, onRefresh, t }) {
    const [asking, setAsking] = React.useState(firstAsking); // "rollback" or "auto": the open question
    const [open, setOpen] = React.useState(firstOpen); // the notes of the newest version
    const back = React.useRef ? React.useRef(null) : { current: null };
    // A question that can no longer be acted on closes by itself: the kept version left by another way, or an update started
    // (the updater refuses a roll back and a second update while one runs); the app is no longer ahead of its channel; the
    // channel is already Alpha.
    React.useEffect(() => {
      if (!info || !asking) return;
      const gone = (asking === "rollback" && (!info.hasBackup || info.busy)) || (asking === "back" && (!info.ahead || info.busy || !info.installable || info.restartNeeded)) || (asking === "alpha" && info.channel === "alpha");
      if (gone) setAsking(null);
    });
    const frame = (...kids) => h("div", { "data-arc-settings": "updates", "data-arc-kit": "true", "data-arc-plugin-pane": "true" }, h("style", null, KIT_CSS), ...kids);
    const title = (acts = null) => h("div", { className: "ak-title" }, h("h1", null, t("settings.nav.updates")), h("p", null, t("upd.sub")), h("div", { className: "acts" }, acts));
    if (!info) {
      return frame(title(), error
        ? h(React.Fragment, null, h("p", { role: "alert", className: "ak-alert" }, oneLine(error)), h(KBtn, { look: "outline", small: true, label: t("action.retry"), onClick: onRefresh }))
        : h("p", { role: "status", className: "ak-empty" }, t("access.loading")));
    }
    const u = info, act = (a) => { if (onAction) onAction(a); };
    const ver = (v) => oneLine(v, 20); // a version comes from a release or a local file: it is cut like any outside text
    // a hint at the end of a row opens back into the page; one at the start of a line (side "start") opens toward it
    const about = (label, text, side = "end") => h(InfoHint, { label, text, align: side, glyph: h(Ic, { n: "info" }) });
    const steps = UPDATE_PHASES.length - 1, stepAt = UPDATE_PHASES.indexOf(u.phase); // the last phase, done, is no step
    const running = Boolean(u.busy) && stepAt >= 0 && stepAt < steps;
    const busy = Boolean(u.busy || pending);
    const canInstall = Boolean(u.available && u.installable && !busy && !u.restartNeeded);
    const chan = UPDATE_CHANNELS.includes(u.channel) ? u.channel : "release"; // an answer without a channel was made for Release
    // Go back is the only way to an older version: the updater takes the target from the channel, the page names none
    const canGoBack = Boolean(u.ahead && u.installable && !busy && !u.restartNeeded);
    const checked = u.checkedAt ? dayTime(Date.parse(u.checkedAt)) : "";
    const versions = !u.installed || u.installed === "0.0.0" ? t("upd.ver.unknown")
      : !u.latest ? t("upd.ver.1", { i: ver(u.installed) })
      : t(checked ? "upd.ver.3" : "upd.ver.2", { i: ver(u.installed), n: ver(u.latest), date: checked });
    // the updater says whether its last step failed; a roll back the user asked for is no failure and only waits for a restart
    const failed = typeof u.failed === "boolean" ? u.failed : u.phase === "failed";
    // the updater starts some messages with its code name (ERR_UPDATE_HTTP: ...); the line shows the plain words
    // (also the code name of the system, such as ENOSPC or EPERM: three or more capitals before a colon at the very start)
    const plain = (text) => String(text || "").replace(/^[A-Z][A-Z0-9_]{2,}:\s*/, "");
    const trouble = plain(error || (failed ? u.message : ""));
    // a refusal that the updater gives after its check (nothing newer, the newest version changed) is a plain line, no error
    const notice = !trouble && u.phase === "idle" ? plain(u.message) : "";
    const kept = u.backupVersion && u.backupVersion !== "0.0.0" ? ver(u.backupVersion) : ""; // 0.0.0 stands for a version nobody could read
    const need = (icon, key) => h("span", { className: "ak-need" }, h(Ic, { n: icon }), t(key));
    const mark = running
      ? h(React.Fragment, null,
          h(KStatus, { text: t(`upd.phase.${u.phase}`) }),
          h("span", { className: "ak-meter", role: "progressbar", "aria-label": t("updates.progress"), "aria-valuemin": 0, "aria-valuemax": steps, "aria-valuenow": stepAt + 1 },
            h("i", { style: { width: `${Math.round(((stepAt + 1) / steps) * 100)}%` } })))
      : u.phase === "checking" ? h(KStatus, { text: t("upd.s.checking") })
      : u.healthy === false ? need("warn", "upd.s.broken")
      : u.restartNeeded ? h(React.Fragment, null, need("update", "upd.s.restart"), about(t("settings.about"), t("updates.hint.restart")))
      : !u.latest ? h(KStatus, { text: t(u.checkedAt ? "upd.s.norelease" : "upd.s.unchecked") })
      : u.ahead ? h(KStatus, { text: t("upd.s.ahead", { channel: t(`upd.chan.${chan}`) }) })
      : u.available && u.installable ? need("warn", "upd.s.needs")
      : u.available ? h(KStatus, { text: t("upd.s.nokit") })
      : h(KStatus, { text: t("upd.s.current"), dot: "on" });
    const cutNotes = (text) => {
      if (text.length <= 1200) return text; // the updater sends at most one character more, which says the text was cut
      const head = text.slice(0, 1199);
      return (/[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head) + "\u2026";
    };
    const left = (Array.isArray(u.skippedBinaries) ? u.skippedBinaries : []).filter((x) => typeof x === "string").slice(0, 4).map((x) => oneLine(x, 40));
    const skips = u.mode === "auto" && u.available && u.skipped && u.skipped.version === u.latest;
    // after a question closes, the focus goes back to its control. After a confirmed roll back that button is off,
    // so the focus goes to the choice list, which is never off.
    const close = (done) => {
      const from = back.current;
      setAsking(null);
      const go = (done === true && from && from.closest && from.closest("[data-arc-kit]")?.querySelector(".ak-dd")) || from;
      if (go && typeof setTimeout === "function") setTimeout(() => { if (go.isConnected) go.focus(); }, 0);
    };
    const ask = (what, from) => { back.current = from || null; setAsking(what); };
    return frame(
      title(h(KBtn, { look: "outline", icon: "update", label: t("updates.check"), disabled: busy, onClick: () => act({ kind: "check" }) })),
      trouble ? h("p", { role: "alert", className: "ak-alert" }, oneLine(trouble)) : null,
      notice ? h("p", { role: "status", className: "ak-alert ak-notice" }, oneLine(notice)) : null,
      trouble.length > 90 ? about(t("upd.detail"), oneLine(trouble, 600), "start") : null,
      h("div", { className: "ak-rows" },
        h(KRow, {
          kind: "channel", id: "channel", name: t("upd.chan"), tail: about(t("settings.about"), t("upd.chan.hint"), "start"), sub: t(`upd.chan.${chan}.sub`),
          end: h(Seg, {
            pressed: true, disabled: busy, label: t("upd.chan"), value: chan, options: UPDATE_CHANNELS.map((c) => [c, t(`upd.chan.${c}`)]),
            // Alpha versions can break, so this choice asks once
            onChange: (c, from) => (c === "alpha" ? ask("alpha", from) : act({ kind: "channel", channel: c })),
          }),
        }),
        h(KRow, {
          kind: "parts", id: "parts", name: t("upd.parts"), sub: versions,
          tail: h(React.Fragment, null, about(t("settings.about"), t("updates.hint.scope"), "start"), left.length ? about(t("upd.left.label"), t("upd.left", { names: left.join(", ") }), "start") : null),
          end: h(React.Fragment, null, mark,
            canInstall ? h(KBtn, { look: "outline", small: true, icon: "download", label: t("updates.install"), onClick: () => act({ kind: "install" }) }) : null,
            canGoBack ? h(KBtn, { look: "outline", small: true, icon: "undo", label: t("upd.goback", { v: ver(u.latest) }), onClick: (e) => ask("back", e && e.currentTarget) }) : null),
        }),
        u.hasBackup ? h(KRow, {
          kind: "earlier", id: "earlier", name: t("upd.earlier"), sub: kept || t("upd.earlier.unknown"),
          end: h(React.Fragment, null, about(t("settings.about"), t("upd.back.hint")),
            h(KBtn, { look: "outline", small: true, icon: "undo", label: t("updates.rollback"), disabled: busy, onClick: (e) => ask("rollback", e && e.currentTarget) })),
        }) : null,
        u.notes && u.latest ? h("div", { className: "ak-row", "data-row": "notes" },
          h("div", { className: "text" },
            h("button", { type: "button", className: "ak-btn sm ak-fold", "aria-expanded": open, onClick: () => setOpen(!open) }, h(Ic, { n: open ? "down" : "back" }), t("upd.notes", { v: ver(u.latest) })),
            open ? h("div", { className: "ak-notes" }, cutNotes(String(u.notes))) : null)) : null,
        h(KRow, {
          kind: "mode", id: "mode", name: t("upd.mode"), tail: about(t("settings.about"), t("upd.mode.hint"), "start"), sub: skips ? t("upd.skip", { v: ver(u.latest) }) : "",
          end: h(Pick, {
            label: t("upd.mode"), value: u.mode, options: UPDATE_MODES.map((m) => [m, t(`upd.mode.${m}`)]),
            // automatic install changes the app without a further question, so this choice asks once
            onChange: (m, from) => (m === "auto" ? ask("auto", from) : act({ kind: "mode", mode: m })),
          }),
        })),
      asking === "rollback" && u.hasBackup && !u.busy ? h(Confirm, {
        t, title: kept ? t("upd.back.title", { v: kept }) : t("upd.back.title.any"), text: kept ? t("upd.back.conseq", { v: kept }) : t("upd.back.conseq.any"), action: t("updates.rollback"),
        onClose: close, onConfirm: () => { act(u.backupVersion ? { kind: "rollback", version: String(u.backupVersion) } : { kind: "rollback" }); close(true); },
      }) : null,
      asking === "auto" ? h(Confirm, {
        t, title: t("upd.auto.title"), text: t("upd.auto.conseq"), action: t("upd.auto.go"),
        onClose: close, onConfirm: () => { act({ kind: "mode", mode: "auto" }); close(); },
      }) : null,
      // with automatic install on, an alpha installs without a further question, and the line says so
      asking === "alpha" && chan !== "alpha" ? h(Confirm, {
        t, title: t("upd.alpha.title"), text: t(u.mode === "auto" ? "upd.alpha.conseq.auto" : "upd.alpha.conseq"), action: t("upd.alpha.go"),
        // the channel buttons wait while the change is on its way, so the focus goes to the choice list
        onClose: close, onConfirm: () => { act({ kind: "channel", channel: "alpha" }); close(true); },
      }) : null,
      asking === "back" && canGoBack ? h(Confirm, {
        t, title: t("upd.goback.title", { v: ver(u.latest) }), text: t("upd.back.conseq", { v: ver(u.latest) }), action: t("upd.goback.go"),
        // what the question named goes along, so the updater can refuse when the newest version or the channel changed meanwhile
        onClose: close, onConfirm: () => { act({ kind: "install", back: true, version: String(u.latest), channel: chan }); close(true); },
      }) : null);
  }

  // ---- Updates connector: plugins and native programs, from GitHub releases (arc-core/lib/updater.js)
  const UPDATE_PHASES = ["downloading", "verifying", "staging", "installing", "testing", "done"];
  const UPDATE_PHASE_LABEL = { downloading: "Download", verifying: "Verify", staging: "Stage", installing: "Install", testing: "Test", done: "Done" };
  const UPDATE_MODES = ["off", "notify", "auto"];
  const UPDATE_CHANNELS = ["release", "beta", "alpha"];
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

  // the update state, its refresh and its actions, shared by the console tab and the Settings page
  function useUpdater() {
    const [info, setInfo] = React.useState(null);
    const [error, setError] = React.useState("");
    // An action's refusal belongs to the picture the user acted on. It stays in view while that picture holds: a plain refresh
    // must not wipe it. Once the update has moved on (another step, done, a restart is due), the refusal is dropped for good,
    // so it can neither hide the new state nor come back later.
    const [actionError, setActionError] = React.useState(null); // { text, stamp }
    const [pending, setPending] = React.useState(false);
    const stampOf = (u) => (u ? [u.phase, u.busy, u.restartNeeded, u.installed].join("|") : "");
    const post = async (route, body) => {
      const r = await fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
      return r.json().catch(() => null);
    };
    const load = async () => {
      try { const j = await post("api/arc-core/update/state"); if (j && j.ok) { setInfo(j); setError(""); setActionError((e) => (e && e.stamp !== stampOf(j) ? null : e)); return j; } setError((j && j.error) || "Could not read the update state."); } catch { setError("Could not read the update state."); }
      return null;
    };
    const act = async (payload) => {
      const before = stampOf(info); // the picture the user acted on
      setActionError(null); setPending(true);
      let refused = "";
      try { const j = await post("api/arc-core/update/action", payload); if (!j || j.ok === false) refused = (j && j.error) || "The action failed."; } catch { refused = "The action failed."; }
      const now = await load(); // the buttons stay held until the page has the state that follows the action
      setPending(false);
      if (refused && (!now || stampOf(now) === before)) setActionError({ text: refused, stamp: before });
    };
    const refusal = actionError && actionError.stamp === stampOf(info) ? actionError.text : "";
    const busy = Boolean(info && info.busy);
    React.useEffect(() => {
      load();
      const id = setInterval(load, busy ? 1200 : 15000);
      return () => clearInterval(id);
    }, [busy]);
    return { info, error: refusal || error, pending, act, load };
  }
  function UpdatesPanel({ t }) {
    const u = useUpdater();
    return h(UpdatesView, { info: u.info, error: u.error, pending: u.pending, onAction: u.act, t });
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
        h(ConnectorView, { connector: "Servers", detail: data.connectorsDetail, onRefresh, t }));
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
    return frame(title(""));
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
    // The source is the Cammut server or the store on this computer. The built-in store lists its few tools without a word,
    // and its retain tool is the way to save a note there.
    const [source, setSource] = React.useState("cammut");
    const go = (confirm) => onAction && onAction({ kind: "tool-run", tool, source, arguments: parsed || {}, ...(confirm !== undefined ? { confirm } : {}) });
    return h("div", { style: { display: "grid", gap: 10 } },
      h("form", { onSubmit: (e) => { e?.preventDefault?.(); }, style: camRow },
        h("select", { "aria-label": t("cammut.observer.source"), "data-cammut-tool-source": "true", value: source, onChange: (e) => setSource(e.target.value), style: { ...camInput, width: "auto" } },
          h("option", { value: "cammut" }, t("cammut.observer.cammut")), h("option", { value: "builtin" }, t("cammut.observer.builtin"))),
        h("input", { type: "text", "aria-label": t("cammut.tools.query"), "data-cammut-tool-query": "true", placeholder: t("cammut.tools.query"), value: query, onChange: (e) => setQuery(e.target.value), style: { ...camInput, flex: 1, minWidth: 160 } }),
        h("button", { type: "submit", "data-cammut-tool-search": "true", disabled: source !== "builtin" && !query.trim(), onClick: () => onAction && onAction({ kind: "tool-search", source, query: query.trim() }), style: camBtn(true) }, t("cammut.tools.search")),
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
          h("p", { role: "status", "data-cammut-status": "true", title: status, style: { margin: 0, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, camClamp(status)))),
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
    const updateReady = Boolean(data && data.update && data.update.available && data.update.latest);
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
              // an update that is ready shows here in every workspace; the second row carries the version
              ...(!isWorkspace && updateReady ? { "aria-label": t("nav.connectors.update", { v: data.update.latest }), title: t("nav.connectors.update", { v: data.update.latest }), "data-update-ready": "true" } : {}),
            }, isWorkspace ? name : h("span", { style: { display: "inline-flex", gap: 6, alignItems: "center" } }, t("nav.connectors"), updateReady ? h(StatusDot, { state: "attention" }) : null));
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
      const [latest] = React.useState({ n: 0 }); // the number of the newest state request of this pane

      // only the newest request may change the view: a slow answer of an older one is dropped
      const refresh = async () => {
        const mine = ++latest.n;
        try {
          const r = await fetch("api/arc-core/console/state", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          const j = r.ok ? await r.json() : null;
          if (mine !== latest.n) return;
          if (j && j.ok) {
            setData(j);
            setFailed(false);
          } else {
            setFailed(true);
          }
        } catch {
          if (mine === latest.n) setFailed(true);
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
        // another window may have changed the state: reload when this window gets the focus back
        const onFocus = () => { refresh(); };
        const w = typeof window !== "undefined" && window.addEventListener ? window : null;
        if (w) w.addEventListener("focus", onFocus);
        return () => { consoleViews.delete(refresh); if (w) w.removeEventListener("focus", onFocus); };
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
    { id: "access", order: 13 }, // Apps, Keys and Activity in one page (S053)
    { id: "add-ons", order: 14 },
    { id: "updates", order: 15, connector: "Updates" }, // drawn only when the Updates connector view exists
  ];

  function makeSettingsSection(section, t) {
    if (section === "access") {
      return function ArcAccessSection() {
        const { data, failed, actionError, dispatch } = useConsole();
        return h(AccessPage, {
          data, failed, actionError, t,
          onRefresh: () => dispatch({ kind: "refresh" }),
          onEnd: (req) => dispatch({ kind: "consent", ...req }),
        });
      };
    }
    if (section === "updates") {
      return function ArcUpdatesSection() {
        const u = useUpdater();
        return h(UpdatesPage, { info: u.info, error: u.error, pending: u.pending, onAction: u.act, onRefresh: u.load, t });
      };
    }
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
    kit: { ICONS, CSS: KIT_CSS, Ic, Btn: KBtn, Seg, Status: KStatus, Row: KRow, Pick, Confirm, AccessPage, UpdatesPage },
    View,
    ConsentDialog,
    ConnectorView,
    UpdatesView,
    CammutView,
    UpdatesPanel,
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
    useConsole,
  };
} });
