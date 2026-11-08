/**
 * arc-molecullage 0.1.0 (2026-11-08): the browser half.
 * Adds the Molecullage workspace tab to the right sidebar, fed by POST api/arc-molecullage/state.
 * Shows the five-gate anti-overplating check (nestedBoxes = 0), the 231-source library and eight-domain atlas,
 * and the 3D structure and Blender figure pipeline.
 */
window.__ModuleLoader__.load({ id: "arc-molecullage", factory: (require) => {
  const React = require("react");
  const h = React.createElement;
  const NS = "arc-molecullage", TAB = "arc-molecullage-workspace";
  const en = {
    "tab.title": "Molecullage",
    "tab.guide": "Inspect the five-gate anti-overplating check, the 231-source reference library, the eight-domain atlas and the 3D figure pipeline.",
    "state.loading": "Loading Molecullage workspace…",
    "state.error": "Could not read the Molecullage workspace state.",
    "gates.title": "Anti-overplating gate",
    "gates.summary": "{rules} rules, nested boxes: {nestedBoxes}",
    "gates.pass": "Accepted",
    "gates.fail": "Rejected",
    "atlas.title": "Shelf and eight-domain atlas",
    "atlas.summary": "{sources} verified sources across {domains} domains",
    "pipeline.title": "3D structure and figure pipeline",
    "pipeline.ready": "Ready",
  };

  const MONO = "\"Geist Mono\", ui-monospace, SFMono-Regular, Consolas, monospace";
  const muted = { opacity: 0.65 };
  const num = { fontVariantNumeric: "tabular-nums" };
  const line = "1px solid color-mix(in srgb, currentColor 14%, transparent)";
  const codeStyle = { display: "inline-block", maxWidth: "100%", boxSizing: "border-box", fontFamily: MONO, fontSize: "0.86em", padding: "1px 6px", borderRadius: 6, border: line, background: "color-mix(in srgb, currentColor 7%, transparent)", overflowWrap: "anywhere" };

  const Code = ({ children }) => h("code", { style: codeStyle }, children);
  const Head = ({ children }) => h("h3", { style: { fontSize: 13, fontWeight: 600, margin: "0 0 6px" } }, children);

  function Icon({ size = 16 }) {
    return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true },
      h("polygon", { points: "12 3 20 7.5 20 16.5 12 21 4 16.5 4 7.5" }),
      h("circle", { cx: 12, cy: 12, r: 2.5 }),
      h("path", { d: "M12 3v6.5M20 16.5l-5.6-3.2M4 16.5l5.6-3.2" }));
  }

  function View({ data, failed, t }) {
    const gate = data && data.antiOverplating;
    const atlas = data && data.atlas;
    const pipe = data && data.pipeline;
    return h("div", { style: { padding: 12, fontSize: 13, lineHeight: 1.45, height: "100%", overflowY: "auto", boxSizing: "border-box", display: "grid", gap: 16, alignContent: "start" } },
      !data && !failed ? h("p", { style: { ...muted, margin: 0 } }, t("state.loading")) : null,
      failed && !data ? h("p", { role: "alert", style: { ...muted, margin: 0 } }, t("state.error")) : null,
      gate ? h("section", { "aria-label": t("gates.title") },
        h(Head, null, t("gates.title")),
        h("p", { style: { ...muted, ...num, margin: "0 0 6px" } }, t("gates.summary", { rules: gate.rules, nestedBoxes: gate.nestedBoxes })),
        h("ul", { style: { margin: 0, padding: 0, listStyle: "none" } },
          gate.gates.map((g) => h("li", { key: g.id, style: { padding: "6px 0", borderTop: line, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" } },
            h("span", null, g.label),
            h("span", { style: { fontWeight: 600, ...(g.ok ? {} : { textDecoration: "underline" }) } }, g.ok ? t("gates.pass") : t("gates.fail")))))) : null,
      atlas ? h("section", { "aria-label": t("atlas.title"), style: { paddingTop: 12, borderTop: line } },
        h(Head, null, t("atlas.title")),
        h("p", { style: { ...muted, ...num, margin: "0 0 6px" } }, t("atlas.summary", { sources: atlas.sources, domains: atlas.domainsCount })),
        h("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 } },
          atlas.domains.map((d) => h("li", { key: d.id, style: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "baseline" } },
            h("span", { style: { fontWeight: 600, minWidth: 110 } }, d.label),
            d.tools.map((tool) => h(Code, { key: tool }, tool)))))) : null,
      pipe ? h("section", { "aria-label": t("pipeline.title"), style: { paddingTop: 12, borderTop: line } },
        h(Head, null, t("pipeline.title")),
        h("ul", { style: { margin: 0, padding: 0, listStyle: "none" } },
          pipe.stages.map((s) => h("li", { key: s.id, style: { padding: "6px 0", borderTop: line, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" } },
            h("span", null, s.label),
            h(Code, null, s.tool),
            h("span", { style: { ...muted, marginLeft: "auto" } }, t("pipeline.ready")))))) : null);
  }

  function makePane(t) {
    return function MolecullagePane() {
      const [data, setData] = React.useState(null);
      const [failed, setFailed] = React.useState(false);
      React.useEffect(() => {
        let live = true;
        const load = async () => {
          try {
            const r = await fetch("api/arc-molecullage/state", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
            const j = r.ok ? await r.json() : null;
            if (!live) return;
            if (j && j.ok) { setData(j); setFailed(false); } else setFailed(true);
          } catch { if (live) setFailed(true); }
        };
        load();
        return () => { live = false; };
      }, []);
      return h(View, { data, failed, t });
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
      } catch { for (const f of off) f(); return; }
      return () => { for (const f of off) f(); };
    });
  }

  return { name: "arc-molecullage", inject: ["slots", "locale"], apply, View, Code, en };
} });
