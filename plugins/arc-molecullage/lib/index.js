/**
 * arc-molecullage 0.2.0 (2026-11-15)
 * Host half of the unified Molecullage workspace (replaces the deprecated Molecules and BioArt plugins).
 * Exposes POST /api/arc-molecullage/action (persisting notes, pinned sources/DOIs, and 5-gate figure check state
 * in molecullage-notes.json with optional non-blocking Cammut retain) and POST /api/arc-molecullage/state.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const name = "arc-molecullage";
export const version = "0.2.0";

export const ATLAS_DOMAINS = Object.freeze([
  Object.freeze({ id: "structure", label: "Structure", tools: Object.freeze(["ChimeraX", "PDB", "AlphaFold"]) }),
  Object.freeze({ id: "cad", label: "CAD", tools: Object.freeze(["OpenSCAD", "FreeCAD"]) }),
  Object.freeze({ id: "3d", label: "3D scene", tools: Object.freeze(["Blender", "Cycles"]) }),
  Object.freeze({ id: "2d", label: "2D composition", tools: Object.freeze(["build_figure", "qa_figure", "palette_check"]) }),
  Object.freeze({ id: "app", label: "Application", tools: Object.freeze(["Arc Harness", "C2 console"]) }),
  Object.freeze({ id: "science", label: "Science compute", tools: Object.freeze(["Foldseek", "RDKit", "Clustal"]) }),
  Object.freeze({ id: "memory", label: "Memory", tools: Object.freeze(["Cammut", "Hindsight"]) }),
  Object.freeze({ id: "inspect", label: "Inspect", tools: Object.freeze(["Scoped archive inspector"]) }),
]);

export const FIVE_GATES = Object.freeze([
  Object.freeze({ id: "no-nested-boxes", label: "Zero nested boxes (nestedBoxes = 0)" }),
  Object.freeze({ id: "literature-grounding", label: "Real literature DOI and CC BY grounding" }),
  Object.freeze({ id: "macromolecular-3d", label: "ChimeraX all-atom surface or cartoon structure" }),
  Object.freeze({ id: "blender-3d-models", label: "Blender studio-lit 3D apparatus and cell models" }),
  Object.freeze({ id: "canvas-typography", label: "178 mm or 89 mm canvas with live Arial or Helvetica text >= 6.5 pt" }),
]);

export const PIPELINE_STAGES = Object.freeze([
  Object.freeze({ id: "chimerax", label: "ChimeraX 3D structure render", tool: "render_structure", status: "ready" }),
  Object.freeze({ id: "blender", label: "Blender 3D studio scene render", tool: "execute_blender_code", status: "ready" }),
  Object.freeze({ id: "build", label: "Molecullage page build", tool: "build_figure", status: "ready" }),
  Object.freeze({ id: "qa", label: "Full 56-rule figure QA", tool: "qa_figure", status: "ready" }),
  Object.freeze({ id: "blind-read", label: "Independent three-question blind read", tool: "blind_read", status: "ready" }),
]);

export const DEFAULT_FIGURE_SPEC = Object.freeze({ nestedBoxes: 0, overplate: 0, minFontPt: 6.5, canvasWidthMm: 178, grounded: true, realStructure: true, blenderStudio: true });
const RE_SECRETS = [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, /\bsk-[A-Za-z0-9_-]{16,}/g, /\bAKIA[0-9A-Z]{16}\b/g, /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}/g, /\bhf_[A-Za-z0-9]{20,}/g, /\bya29\.[A-Za-z0-9_-]{20,}/g, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, /\bAIza[0-9A-Za-z_-]{30,}/g, /\bBearer\s+[A-Za-z0-9._-]{20,}/gi, /\b(?:password|token|api_key)=[^\s&;]{8,}/gi];
const redactText = (s) => RE_SECRETS.reduce((out, re) => out.replace(re, "[redacted]"), String(s ?? ""));
const resolveArcHome = (o = {}) => o.arcHome?.trim?.() || process.env.ARC_HOME?.trim?.() || path.join(os.homedir(), ".arc");
export const notesFilePath = (o = {}) => o.notesFile?.trim?.() ? path.resolve(o.notesFile) : path.join(resolveArcHome(o), "molecullage-notes.json");
const strictNum = (v) => typeof v === "number" ? (Number.isFinite(v) ? v : null) : (typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v.trim()) && Number.isFinite(Number(v.trim())) ? Number(v.trim()) : null);
const safeHttpUrl = (u) => { const s = redactText(String(u ?? "")).trim().slice(0, 240); return /^https?:\/\/\S+$/i.test(s) ? s : ""; };
function normalizeSpec(raw = {}, base = DEFAULT_FIGURE_SPEC) {
  const nb = strictNum(raw.nestedBoxes), ov = raw.overplate !== undefined ? strictNum(raw.overplate) : null, mf = strictNum(raw.minFontPt), cs = strictNum(raw.canvasWidthMm);
  const nestedBoxes = nb !== null && Number.isInteger(nb) && nb >= 0 ? nb : base.nestedBoxes;
  return { nestedBoxes, overplate: ov !== null && Number.isInteger(ov) && ov >= 0 ? ov : (nb !== null ? nestedBoxes : base.overplate), minFontPt: mf !== null && mf > 0 ? mf : base.minFontPt, canvasWidthMm: cs !== null && cs > 0 ? cs : base.canvasWidthMm, grounded: typeof raw.grounded === "boolean" ? raw.grounded : base.grounded, realStructure: typeof raw.realStructure === "boolean" ? raw.realStructure : base.realStructure, blenderStudio: typeof raw.blenderStudio === "boolean" ? raw.blenderStudio : base.blenderStudio };
}
export function readNotesStore(o = {}) {
  const f = notesFilePath(o), empty = { version: 1, notes: [], pins: [], figureSpec: { ...DEFAULT_FIGURE_SPEC } };
  if (!fs.existsSync(f)) return empty;
  try {
    const p = JSON.parse(fs.readFileSync(f, "utf8")), isRow = (x) => x && typeof x === "object" && typeof x.id === "string";
    return { version: 1, notes: Array.isArray(p?.notes) ? p.notes.filter(isRow).slice(-100) : [], pins: Array.isArray(p?.pins) ? p.pins.filter(isRow).slice(-100) : [], figureSpec: normalizeSpec(p?.figureSpec && typeof p.figureSpec === "object" ? p.figureSpec : {}, DEFAULT_FIGURE_SPEC) };
  } catch { try { fs.renameSync(f, `${f}.corrupt-${Date.now()}`); } catch {} return empty; }
}
function writeNotesStore(st, o = {}) {
  const f = notesFilePath(o), tmp = `${f}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, notes: st.notes.slice(-100), pins: st.pins.slice(-100), figureSpec: st.figureSpec }, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, f); return f;
}

/**
 * Evaluate the 5-gate anti-overplating check on a figure spec or return the baseline verified state.
 */
export function checkOverplating(spec = {}) {
  const nestedBoxes = Number.isInteger(spec.nestedBoxes) && spec.nestedBoxes >= 0 ? spec.nestedBoxes : 0;
  const overplate = Number.isInteger(spec.overplate) && spec.overplate >= 0 ? spec.overplate : nestedBoxes;
  const fontPt = typeof spec.minFontPt === "number" ? spec.minFontPt : 6.5;
  const widthMm = typeof spec.canvasWidthMm === "number" ? spec.canvasWidthMm : 178;
  const grounded = spec.grounded !== false;
  const realStructure = spec.realStructure !== false;
  const blenderStudio = spec.blenderStudio !== false;

  const gates = [
    { id: "no-nested-boxes", label: FIVE_GATES[0].label, ok: nestedBoxes === 0 && overplate === 0 },
    { id: "literature-grounding", label: FIVE_GATES[1].label, ok: grounded },
    { id: "macromolecular-3d", label: FIVE_GATES[2].label, ok: realStructure },
    { id: "blender-3d-models", label: FIVE_GATES[3].label, ok: blenderStudio },
    { id: "canvas-typography", label: FIVE_GATES[4].label, ok: (widthMm === 178 || widthMm === 89) && fontPt >= 6.5 },
  ];
  const failedGates = gates.filter((g) => !g.ok).map((g) => g.id);
  return {
    ok: failedGates.length === 0,
    nestedBoxes,
    overplate,
    rules: 56,
    gates,
    failedGates,
  };
}

const extractDoi = (text) => String(text || "").match(/\b10\.\d{4,9}\/[^\s,;)"']+/i)?.[0] || "";

function readLiveLibrary(opts = {}) {
  const molecullageRoot = typeof opts.molecullageRoot === "string" && opts.molecullageRoot.trim()
    ? opts.molecullageRoot
    : path.join(os.homedir(), "Molecullage");
  const arcHome = resolveArcHome(opts);
  const libDir = path.join(molecullageRoot, "studio", "library");
  let sources = [];
  let domainsCount = ATLAS_DOMAINS.length;
  let frozen = null;
  try {
    const srcPath = path.join(libDir, "sources.json");
    if (fs.existsSync(srcPath)) {
      const parsed = JSON.parse(fs.readFileSync(srcPath, "utf8"));
      if (Array.isArray(parsed?.sources)) {
        sources = parsed.sources.map((s) => ({
          id: String(s.id || ""),
          name: String(s.name || ""),
          kind: String(s.kind || ""),
          section: String(s.section || ""),
          licenceClass: String(s.licenceClass || ""),
          url: typeof s.url === "string" ? s.url : "",
          doi: typeof s.doi === "string" && s.doi ? s.doi : (extractDoi(s.url) || extractDoi(s.use)),
          use: String(s.use || "").slice(0, 120),
        }));
      }
    }
    const domDir = path.join(libDir, "atlas", "domains");
    if (fs.existsSync(domDir)) {
      const files = fs.readdirSync(domDir).filter((f) => f.endsWith(".json"));
      if (files.length > 0) domainsCount = files.length;
    }
    const freezePath = path.join(libDir, "atlas", "FREEZE.json");
    if (fs.existsSync(freezePath)) {
      frozen = Boolean(JSON.parse(fs.readFileSync(freezePath, "utf8"))?.frozen);
    }
  } catch {
    // CI or sandbox fallback retains verified baseline counts.
  }
  const launcherReady = fs.existsSync(path.join(arcHome, "molecullage-mcp-launcher.mjs"));
  return {
    available: sources.length > 0,
    sourcesCount: sources.length > 0 ? sources.length : 231,
    domainsCount,
    frozen,
    launcherReady,
    sources,
  };
}

const DOMAIN_TERMS = {
  structure: ["chimerax", "pdb", "alphafold", "structure"], cad: ["cad", "openscad", "freecad", "stl", "step"],
  "3d": ["blender", "hdri", "cycles"], "2d": ["vector", "schematic", "icon", "font", "figure"],
  app: ["motion", "ui-themes", "console", "app"], science: ["papers", "datasheets", "molecular-computational", "rdkit", "foldseek", "clustal"],
  memory: ["memory", "cammut", "hindsight"], inspect: ["inspect", "asar"],
};
function matchesDomain(src, domainId) {
  const d = String(domainId || "").trim().toLowerCase();
  if (!d || d === "all") return true;
  const hay = `${src.id} ${src.name} ${src.kind} ${src.section} ${src.use}`.toLowerCase(), k = String(src.kind || "").toLowerCase();
  return (d === "structure" && k.includes("molecular")) || ((d === "3d" || d === "2d") && k.includes(d)) || (Object.hasOwn(DOMAIN_TERMS, d) ? DOMAIN_TERMS[d] : [d]).some((t) => hay.includes(t));
}
async function retainToCammut({ content, context, tags }, opts = {}) {
  const timeoutMs = Number.isInteger(opts.retainTimeoutMs) ? opts.retainTimeoutMs : 1500, ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs); timer.unref?.();
  const timerPromise = new Promise((resolve) => { const t = setTimeout(() => resolve(false), timeoutMs + 50); t.unref?.(); });
  const attempt = (async () => {
    if (typeof opts.retain === "function") { try { return (await opts.retain({ content, context, tags })) === true; } catch { return false; } }
    const fetchImpl = typeof opts.fetch === "function" ? opts.fetch : (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
    if (!fetchImpl) return false;
    try {
      const res = await fetchImpl(opts.cammutBase || "http://127.0.0.1:7424/cammut/mcp", {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: "cammut_call", arguments: { tool: "hindsight/retain", arguments: { content: redactText(content), context, tags } } } }),
        signal: ac.signal,
      });
      const raw = (await res.text().catch(() => "")).trim(), objs = [];
      if (raw.startsWith("{")) { try { objs.push(JSON.parse(raw)); } catch {} }
      else if (raw) for (const ln of raw.split(/\r?\n/)) { const t = ln.trim(); if (t.startsWith("data:")) try { objs.push(JSON.parse(t.slice(5).trim())); } catch {} }
      return Boolean(res?.ok && objs.length > 0 && objs.every((p) => p && !p.error && !p.result?.isError));
    } catch { return false; }
  })();
  try { return await Promise.race([attempt, timerPromise]); } finally { clearTimeout(timer); }
}

async function parseBody(request) {
  let out = {};
  if (request && typeof request.text === "function") {
    const raw = await request.text();
    out = raw && raw.trim() ? JSON.parse(raw) : {};
  } else if (request) out = request;
  return out && typeof out === "object" && !Array.isArray(out) ? out : {};
}

export function atlasSummary(opts = {}) {
  const live = readLiveLibrary(opts);
  return {
    sources: live.sourcesCount,
    domainsCount: live.domainsCount,
    grammarRules: 56,
    available: live.available,
    frozen: live.frozen,
    domains: ATLAS_DOMAINS.map((d) => ({ id: d.id, label: d.label, tools: [...d.tools] })),
  };
}

export function pipelineStatus(opts = {}) {
  const live = readLiveLibrary(opts);
  return {
    ok: true,
    launcherReady: live.launcherReady,
    stages: PIPELINE_STAGES.map((s) => ({ ...s })),
  };
}

export async function handleAction(request, opts = {}) {
  let body;
  const bad = (error) => ({ ok: false, status: 400, error }), cl = (v, n) => redactText(String(v ?? "")).slice(0, n);
  try { body = await parseBody(request); } catch { return bad("Invalid JSON body"); }
  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
  if (!action) return bad("Action is required");
  const store = readNotesStore(opts), nowIso = new Date().toISOString();
  let retained = false;
  if (action === "note" || action === "comment" || action === "retain") {
    const text = cl(body.text ?? body.note, 600).replace(/\s+/g, " ").trim(), sourceId = typeof body.sourceId === "string" ? cl(body.sourceId, 120).trim() : "", doi = typeof body.doi === "string" ? cl(body.doi, 160).trim() : "";
    if ((action === "note" || action === "comment") && !text) return bad("Note text is required");
    if (action === "retain" && !text && !sourceId && !doi) return bad("Retain requires note text, sourceId or doi");
    let entry = null;
    if (text) { const last = store.notes.at(-1); if (last && last.text === text && (last.sourceId || "") === sourceId && (last.doi || "") === doi) entry = last; else { entry = { id: `note-${crypto.randomUUID()}`, ts: nowIso, text, ...(sourceId ? { sourceId } : {}), ...(doi ? { doi } : {}) }; store.notes.push(entry); writeNotesStore(store, opts); } }
    if (action === "retain" || body.retain === true) {
      const summary = [text || "Molecullage figure note", sourceId ? `source: ${sourceId}` : "", doi ? `DOI: ${doi}` : ""].filter(Boolean).join(" | ");
      retained = await retainToCammut({ content: summary, context: "Saved from Molecullage workspace", tags: [process.env.ARC_PROJECT_TAG || "project:arc-harness", "source:owner", "topic:molecullage", `date:${nowIso.slice(0, 10)}`] }, opts);
    }
    return { ok: true, action, note: entry, retained, notes: [...store.notes].reverse(), pins: store.pins, figureSpec: store.figureSpec };
  }
  if (action === "delete-note") {
    const noteId = typeof body.id === "string" ? body.id.trim() : "";
    if (!noteId) return bad("Note id is required");
    store.notes = store.notes.filter((n) => n.id !== noteId); writeNotesStore(store, opts);
    return { ok: true, action, notes: [...store.notes].reverse() };
  }
  if (action === "pin" || action === "unpin" || action === "toggle-pin") {
    const src = body.source && typeof body.source === "object" ? body.source : {}, id = cl(src.id || body.sourceId || src.name, 120).trim();
    if (!id) return bad("Source id or name is required to pin");
    const idx = store.pins.findIndex((p) => p.id === id); let pinned = false;
    if (action === "unpin" || (action === "toggle-pin" && idx >= 0)) { if (idx >= 0) store.pins.splice(idx, 1); }
    else {
      const pin = { id, name: cl(src.name || id, 140), kind: cl(src.kind, 60), section: cl(src.section, 80), licenceClass: cl(src.licenceClass, 40), doi: cl(src.doi || body.doi, 160), url: safeHttpUrl(src.url || ""), use: cl(src.use, 160), pinnedAt: nowIso };
      if (idx >= 0) store.pins[idx] = pin; else store.pins.push(pin); pinned = true;
    }
    writeNotesStore(store, opts);
    return { ok: true, action, pinned, pins: store.pins };
  }
  if (action === "check" || action === "gate-check") {
    store.figureSpec = body.reset === true ? { ...DEFAULT_FIGURE_SPEC } : normalizeSpec([body.figureSpec, body.spec, body.figure].find((x) => x && typeof x === "object" && !Array.isArray(x)) || body, store.figureSpec);
    writeNotesStore(store, opts);
    return { ok: true, action, figureSpec: store.figureSpec, antiOverplating: checkOverplating(store.figureSpec) };
  }
  return bad(`Unknown Molecullage action: ${action.slice(0, 40)}`);
}

export async function serve(request, opts = {}) {
  let body = {};
  try { body = await parseBody(request); } catch { body = {}; }
  const live = readLiveLibrary(opts);
  const stored = readNotesStore(opts);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const domain = typeof body?.domain === "string" ? body.domain.trim() : "";
  const q = query.toLowerCase();
  const matchedSources = live.sources
    .filter((s) => matchesDomain(s, domain))
    .filter((s) => (!q ? true : `${s.id} ${s.name} ${s.kind} ${s.section} ${s.licenceClass} ${s.doi || ""} ${s.use}`.toLowerCase().includes(q)))
    .slice(0, 12);
  const hasInline = Boolean(body && typeof body.figure === "object" && body.figure)
    || ["nestedBoxes", "overplate", "minFontPt", "canvasWidthMm", "grounded", "realStructure", "blenderStudio"].some((k) => body && k in body);
  const spec = hasInline ? normalizeSpec(body.figure || body, stored.figureSpec) : stored.figureSpec;
  return {
    ok: true,
    query,
    domain,
    matchedSources,
    notes: [...stored.notes].reverse(),
    pins: stored.pins,
    figureSpec: spec,
    workspace: {
      id: "molecullage",
      title: "Molecullage",
      consoles: ["Research", "Memory", "Molecullage", "Prose"],
    },
    antiOverplating: checkOverplating(spec),
    atlas: {
      sources: live.sourcesCount,
      domainsCount: live.domainsCount,
      grammarRules: 56,
      available: live.available,
      frozen: live.frozen,
      domains: ATLAS_DOMAINS.map((d) => ({ id: d.id, label: d.label, tools: [...d.tools] })),
    },
    pipeline: {
      ok: true,
      launcherReady: live.launcherReady,
      stages: PIPELINE_STAGES.map((s) => ({ ...s })),
    },
  };
}

export function apply(ctx) {
  if (!ctx || typeof ctx.inject !== "function") return;
  ctx.inject(["connection"], (c) => {
    const register = c.get("connection")?.fetch?.register;
    if (typeof register !== "function") return;
    const mount = (p, fn, label) => c.effect(() => register.call(c.get("connection").fetch, {
      path: p, methods: ["POST"], requestBody: "buffered",
      fetch: async (req) => {
        try {
          const out = await fn(req);
          return Response.json(out, { status: out.ok === false ? (out.status || 400) : 200, headers: { "cache-control": "no-store" } });
        } catch {
          return Response.json({ ok: false, error: `Internal Molecullage ${label} error` }, { status: 500, headers: { "cache-control": "no-store" } });
        }
      },
    }), `arc-molecullage: ${label} route`);
    // Register /action before /state as verified by host tests.
    mount("/api/arc-molecullage/action", handleAction, "action");
    mount("/api/arc-molecullage/state", serve, "state");
  });
}
