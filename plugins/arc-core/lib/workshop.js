// arc-core workshop (2026-11-09): Seven Workshop toolpack manifests, signal router,
// and R009 scope-gated archive patch-point inspector (Slices W1, W2, roadmap 4.9).
import path from 'node:path';

export const WORKSHOP_MANIFESTS = Object.freeze({
  structure: Object.freeze({
    id: 'structure',
    name: 'Macromolecular Structure Pack',
    domain: 'structure',
    requiresScope: false,
    signals: Object.freeze(['pdb', 'cif', 'chimerax', 'alphafold', 'nanobody', 'lysozyme', 'residue']),
    tools: Object.freeze(['struct.fetch_pdb', 'struct.contacts', 'struct.render_glb']),
  }),
  cad: Object.freeze({
    id: 'cad',
    name: 'Parametric CAD and Enclosure Pack',
    domain: 'cad',
    requiresScope: false,
    signals: Object.freeze(['cad', 'step', 'stl', 'openscad', 'enclosure', 'thermos', 'tolerance']),
    tools: Object.freeze(['cad.build_step', 'cad.check_manifold', 'cad.slice_section']),
  }),
  '3d': Object.freeze({
    id: '3d',
    name: 'Blender and Cycles 3D Scene Pack',
    domain: '3d',
    requiresScope: false,
    signals: Object.freeze(['blender', 'cycles', 'hdri', 'gltf', 'glb', 'mesh', 'silhouette']),
    tools: Object.freeze(['scene3d.export_gltf', 'scene3d.bake_cycles', 'scene3d.check_silhouette']),
  }),
  '2d': Object.freeze({
    id: '2d',
    name: 'Molecullage Figure and Vector Pack',
    domain: '2d',
    requiresScope: false,
    signals: Object.freeze(['figure', 'svg', 'panel', 'overplate', 'palette', 'manhattan', 'violin']),
    tools: Object.freeze(['build_figure', 'qa_figure', 'vector.rebuild', 'palette_check']),
  }),
  inspect: Object.freeze({
    id: 'inspect',
    name: 'Scoped Archive and Binary Inspector Pack',
    domain: 'inspect',
    requiresScope: true,
    signals: Object.freeze(['asar', 'archive', 'patch-point', 'binary', 'unpack', 'headers']),
    tools: Object.freeze(['inspect.asar', 'inspect.patch_points', 'inspect.headers']),
  }),
  app: Object.freeze({
    id: 'app',
    name: 'Application Verification and Benchmark Pack',
    domain: 'app',
    requiresScope: false,
    signals: Object.freeze(['playwright', 'startup', 'benchmark', 'webview', 'cold-start', 'accessibility']),
    tools: Object.freeze(['app.measure_start', 'app.playwright_check', 'app.a11y_audit']),
  }),
  science: Object.freeze({
    id: 'science',
    name: 'Scientific Literature and Assay Pack',
    domain: 'science',
    requiresScope: false,
    signals: Object.freeze(['doi', 'crossref', 'pubmed', 'clinvar', 'gnomad', 'kinetics', 'assay']),
    tools: Object.freeze(['science.verify_doi', 'science.check_retraction', 'science.fit_curve']),
  }),
});

export const SIGNAL_BENCH_PROMPTS = Object.freeze([
  { prompt: 'Render PDB 1MEL nanobody and lysozyme contacts in ChimeraX', expectedPack: 'structure' },
  { prompt: 'Check AlphaFold residue confidence on the CIF structure', expectedPack: 'structure' },
  { prompt: 'Export parametric OpenSCAD enclosure to STEP and STL with tolerance check', expectedPack: 'cad' },
  { prompt: 'Bake glTF scene in Blender Cycles with studio HDRI lighting', expectedPack: '3d' },
  { prompt: 'Build multi-panel SVG figure with zero nested boxes and palette check', expectedPack: '2d' },
  { prompt: 'Inspect app.asar archive headers and known patch-point offsets', expectedPack: 'inspect' },
  { prompt: 'Measure cold-start startup benchmark and Playwright webview check', expectedPack: 'app' },
  { prompt: 'Verify DOI citation on Crossref and check PubMed retraction status', expectedPack: 'science' },
  { prompt: 'Fit assay kinetics curve and query gnomAD allele frequency', expectedPack: 'science' },
  { prompt: 'Slice CAD thermos assembly section from STEP model', expectedPack: 'cad' },
]);

export function resolveToolpackSignal(prompt = '') {
  const lower = String(prompt || '').toLowerCase();
  let best = null;
  for (const manifest of Object.values(WORKSHOP_MANIFESTS)) {
    let score = 0;
    const matched = [];
    for (const sig of manifest.signals) {
      if (lower.includes(sig)) {
        score += 1;
        matched.push(sig);
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { pack: manifest.id, score, matched, requiresScope: manifest.requiresScope };
    }
  }
  return best;
}

function withinRoots(target, allowedRoots) {
  if (typeof target !== 'string' || !target.trim()) return false;
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) return false;
  const resolvedTarget = path.resolve(target);
  const normTarget = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget;
  for (const root of allowedRoots) {
    if (typeof root !== 'string' || !root.trim()) continue;
    const resolvedRoot = path.resolve(root);
    const normRoot = process.platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot;
    const rel = path.relative(normRoot, normTarget);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return true;
  }
  return false;
}

export function inspectArchivePatchPoints({ target, scope, archiveEntries = [] } = {}) {
  const authorized = Boolean(scope && scope.authorized === true);
  const inScope = withinRoots(target, scope && scope.allowedRoots);
  if (!authorized || !inScope) {
    return {
      ok: false,
      rule: 'R009',
      error: 'Refused to inspect archive outside authorized scope (R009)',
      patchPoints: [],
    };
  }

  const knownMarkers = ['workbench.desktop.main.js', 'product.json', 'package.json', 'bootstrap-window.js'];
  const patchPoints = [];
  for (const entry of archiveEntries) {
    const name = typeof entry === 'string' ? entry : entry?.path ?? '';
    if (knownMarkers.some((m) => name.endsWith(m))) {
      patchPoints.push({
        path: name,
        kind: name.endsWith('.json') ? 'manifest' : 'bundle',
        verified: true,
      });
    }
  }

  return {
    ok: true,
    target: path.resolve(target),
    patchPoints,
  };
}
