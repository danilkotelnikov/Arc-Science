/**
 * arc-core 0.1.0 (2026-11-09): Unified C2 console panel (Phase 1b.2-1b.3 & Phase 4.1-4.8).
 * Workspaces: Research, Memory, Molecullage, Prose.
 * Connectors: Servers, Keys, Apps, Audit; plus Settings.
 * Research session: 3-pane layout (Map, Claims, Evidence) + Release view,
 * Decision map (Pursue, Park, Drop, Request a test), validation ladder L1-L4
 * (with L5/L6 operator switches off by default), and 30-day consent dialog.
 */
window.__ModuleLoader__.load({ id: "arc-core", factory: (require) => {
  const React = require("react");
  const h = React.createElement;
  const NS = "arc-core", TAB = "arc-core-console";

  const WORKSPACES = ["Research", "Memory", "Molecullage", "Prose"];
  const CONNECTORS = ["Servers", "Keys", "Apps", "Audit"];
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
    "connector.servers": "Connector servers",
    "connector.keys": "Connector keys",
    "connector.apps": "Connector apps",
    "connector.audit": "Connector audit",
    "consent.title": "Connector consent",
    "consent.prompt": "Choose access duration for {appId}",
    "memory.title": "Shared memory gateway",
    "molecullage.title": "Molecullage studio shelf",
    "prose.title": "Plain prose check",
    "prose.clean": "Clean plain prose",
    "prose.flagged": "Formulaic phrasing detected",
    "prose.rewrite": "Rewrite locally",
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

  function Icon({ size = 16 }) {
    return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true },
      h("circle", { cx: 12, cy: 12, r: 8.5 }),
      h("path", { d: "M12 3.5v17M3.5 12h17" }));
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

  function ConnectorView({ connector, detail, onOpenConsent, t }) {
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

  function ResearchWorkspace({ data, activeView, onSelectView, onDecision, t }) {
    const branches = (data && data.tree && data.tree.branches) || [];
    const claims = (data && data.claims && data.claims.items) || [];
    const evidence = (data && data.evidence && data.evidence.items) || [];
    const ladder = (data && data.head && data.head.ladderRungs) || [];
    const seats = (data && data.head && data.head.seatAssignments) || SEATS.map((seat) => ({ seat, role: "" }));
    const release = data && data.release;

    return h("section", { "aria-label": t("research.panes"), style: { display: "grid", gap: 12 } },
      h("div", {
        "data-research-seats": "true",
        "aria-label": t("research.seats"),
        style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline" },
      },
        h("span", { style: { ...muted, fontSize: 12 } }, `${t("research.seats")}:`),
        seats.map((entry) =>
          h("code", { key: entry.seat, "data-seat": entry.seat, style: tagStyle }, entry.seat))),

      h("div", { role: "tablist", "aria-label": "Research views", style: { display: "flex", gap: 6, flexWrap: "wrap", paddingBottom: 8, borderBottom: HAIRLINE } },
        RESEARCH_VIEWS.map((view) =>
          h("button", {
            key: view,
            type: "button",
            role: "tab",
            "aria-selected": activeView === view,
            "data-research-view": view,
            onClick: () => onSelectView && onSelectView(view),
            style: btnStyle(activeView === view),
          }, view))),

      activeView === "Release" && release
        ? h("div", { "data-pane": "Release", style: { paddingTop: 4, display: "grid", gap: 6 } },
            h("div", { style: { fontWeight: 600 } }, "Release gate"),
            h("div", { style: num }, `Verdict: ${release.verdict}, candidate: ${release.candidateHash}, nested boxes: ${release.nestedBoxes}`),
            h("div", { style: muted }, release.proseOk ? "Prose check clean" : "Prose check has findings"))
        : h("div", {
            "data-research-three-pane": "true",
            style: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16, alignItems: "start" },
          },
            h("div", { "data-pane": "Map", style: { display: "grid", gap: 8 } },
              h("h3", { style: { fontSize: 13, fontWeight: 600, margin: 0 } }, t("research.map")),
              h("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 } },
                branches.map((b) =>
                  h("li", { key: b.id, "data-branch": b.id, style: { paddingTop: 8, borderTop: HAIRLINE, display: "grid", gap: 6 } },
                    h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" } },
                      h("span", { style: { fontWeight: 600 } }, b.title),
                      h("code", { style: tagStyle }, b.rung)),
                    h("div", { style: { ...muted, ...num, fontSize: 12 } },
                      `Support: ${b.supportLogLR}, value per cost: ${b.voiPerCost}, selected: ${b.decision}`),
                    h("div", { "aria-label": t("research.decisions"), style: { display: "flex", gap: 4, flexWrap: "wrap" } },
                      DECISION_ACTIONS.map((act) =>
                        h("button", {
                          key: act,
                          type: "button",
                          "data-decision-action": act,
                          "data-branch-id": b.id,
                          onClick: () => onDecision && onDecision({ branchId: b.id, action: act }),
                          style: btnStyle(b.decision === act),
                        }, act))))))),

            h("div", { "data-pane": "Claims", style: { paddingLeft: 12, borderLeft: HAIRLINE, display: "grid", gap: 8 } },
              h("h3", { style: { fontSize: 13, fontWeight: 600, margin: 0 } }, t("research.claims")),
              h("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 } },
                claims.map((c) =>
                  h("li", { key: c.id, style: { paddingTop: 8, borderTop: HAIRLINE, display: "grid", gap: 4 } },
                    h("span", null, c.text),
                    h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline" } },
                      h("code", { style: tagStyle }, c.level),
                      h("code", { style: tagStyle }, c.rung),
                      h("span", { style: { ...muted, fontSize: 12 } }, c.source)))))),

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
                  ladder.filter((r) => r.active).map((r) =>
                    h("code", { key: r.id, style: tagStyle }, `${r.id} ${r.label}`)))))));
  }

  function View({
    data,
    failed,
    skin = "arc",
    pendingConsent = null,
    onSelectWorkspace,
    onSelectResearchView,
    onSelectConnector,
    onToggleSettings,
    onDecision,
    onConsent,
    onCloseConsent,
    onOpenConsent,
    onProseChange,
    onProseRewrite,
    onToggleSwitch,
    t,
  }) {
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
            }, conn);
          }),
          h("button", {
            type: "button",
            "data-settings-toggle": "true",
            "aria-pressed": settingsOpen,
            onClick: () => onToggleSettings && onToggleSettings(!settingsOpen),
            style: btnStyle(settingsOpen),
          }, t("nav.settings")))) : null,

      h(ConsentDialog, { pendingConsent, onConsent, onClose: onCloseConsent, t }),

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
            t,
          })
        : null,

      data && inWorkspaceMode && activeWorkspace === "Memory"
        ? h("section", { "aria-label": t("memory.title"), style: { display: "grid", gap: 8 } },
            h("h3", { style: { fontSize: 13, fontWeight: 600, margin: 0 } }, t("memory.title")),
            h("div", { style: num }, `Loopback gateway: ${data.memory.gateway}, token check active`),
            h("div", { style: muted }, `Policy labels: ${data.memory.labels.join(", ")}`))
        : null,

      data && inWorkspaceMode && activeWorkspace === "Molecullage"
        ? h("section", { "aria-label": t("molecullage.title"), style: { display: "grid", gap: 8 } },
            h("h3", { style: { fontSize: 13, fontWeight: 600, margin: 0 } }, t("molecullage.title")),
            h("div", { style: num }, `${data.molecullage.sources} verified sources across ${data.molecullage.domains} domains, nested boxes: ${data.molecullage.nestedBoxes}`))
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
            h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
              onProseRewrite
                ? h("button", {
                    type: "button",
                    "data-prose-rewrite": "true",
                    onClick: () => onProseRewrite(),
                    style: btnStyle(false),
                  }, t("prose.rewrite"))
                : null,
              onProseChange
                ? h("button", {
                    type: "button",
                    onClick: () => onProseChange("The wax bath holds 40 to 41 C for a 42 minute simulated window."),
                    style: btnStyle(false),
                  }, "Check sample sentence")
                : null))
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
          await fetch("api/arc-core/console/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
          await refresh();
        } catch {
          setFailed(true);
        }
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
        skin,
        pendingConsent,
        t,
        onSelectWorkspace: (workspace) => dispatch({ kind: "workspace", workspace }),
        onSelectResearchView: (view) => dispatch({ kind: "research-view", view }),
        onSelectConnector: (connector) => dispatch({ kind: "connector", connector }),
        onToggleSettings: (open) => dispatch({ kind: "settings", open }),
        onDecision: ({ branchId, action }) => dispatch({ kind: "decision", branchId, action }),
        onOpenConsent: (req) => setPendingConsent(req),
        onCloseConsent: () => setPendingConsent(null),
        onConsent: async (req) => {
          await dispatch({ kind: "consent", ...req });
          setPendingConsent(null);
        },
        onProseChange: (text) => dispatch({ kind: "prose", text }),
        onProseRewrite: () => dispatch({ kind: "prose-rewrite" }),
        onToggleSwitch: (rungId, enabled) => dispatch({ kind: "operator-switch", rungId, enabled }),
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
    ResearchWorkspace,
    WORKSPACES,
    CONNECTORS,
    SEATS,
    RESEARCH_VIEWS,
    DECISION_ACTIONS,
    CONSENT_MODES,
    THEMES,
    en,
  };
} });
