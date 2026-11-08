/**
 * arc-molecullage 0.1.0 (2026-11-08)
 * Host half of the unified Molecullage workspace (replaces the deprecated Molecules and BioArt plugins).
 * Exposes POST /api/arc-molecullage/state with the five-gate anti-overplating check (nestedBoxes = 0),
 * the 231-source library and eight-domain atlas summary, and the 3D structure and Blender figure pipeline status.
 */

export const name = "arc-molecullage";
export const version = "0.1.0";

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

export function atlasSummary() {
  return {
    sources: 231,
    domainsCount: ATLAS_DOMAINS.length,
    grammarRules: 56,
    domains: ATLAS_DOMAINS.map((d) => ({ id: d.id, label: d.label, tools: [...d.tools] })),
  };
}

export function pipelineStatus() {
  return {
    ok: true,
    stages: PIPELINE_STAGES.map((s) => ({ ...s })),
  };
}

export async function serve(request) {
  let body = {};
  if (request && typeof request.text === "function") {
    try {
      const raw = await request.text();
      if (raw) body = JSON.parse(raw);
    } catch {
      body = {};
    }
  } else if (request && typeof request === "object" && !Array.isArray(request)) {
    body = request;
  }
  const spec = body && typeof body.figure === "object" && body.figure ? body.figure : body;
  return {
    ok: true,
    workspace: {
      id: "molecullage",
      title: "Molecullage",
      consoles: ["Research", "Memory", "Molecullage", "Prose"],
    },
    antiOverplating: checkOverplating(spec),
    atlas: atlasSummary(),
    pipeline: pipelineStatus(),
  };
}

export function apply(ctx) {
  if (!ctx || typeof ctx.inject !== "function") return;
  ctx.inject(["connection"], (c) => {
    const register = c.get("connection")?.fetch?.register;
    if (typeof register !== "function") return;
    c.effect(() => register.call(c.get("connection").fetch, {
      path: "/api/arc-molecullage/state",
      methods: ["POST"],
      requestBody: "buffered",
      fetch: async (request) => {
        try {
          return Response.json(await serve(request), { headers: { "cache-control": "no-store" } });
        } catch (err) {
          return Response.json({ ok: false, error: String(err?.message || "failed").slice(0, 200) }, { headers: { "cache-control": "no-store" } });
        }
      },
    }), "arc-molecullage: state route");
  });
}
