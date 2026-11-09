// arc-core shelf (2026-11-09): Four Shelf packs, license-aware chunk caching,
// 20-question Recall@5 benchmark, and freshness watcher (Slices S1, S2, roadmap 4.7).

export const OPEN_CACHE_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'CC0-1.0',
  'CC-BY-4.0',
]);

export const SHELF_PACKS = Object.freeze([
  Object.freeze({
    id: 'molecullage-studio',
    name: 'Molecullage and Studio Shelf',
    version: '1.2.0',
    license: 'MIT',
    chunks: Object.freeze([
      { id: 'ms-1', title: 'Camera scale frames', text: 'Camera-relative coordinates keep deep zoom continuous across nanometre and millimetre frames.' },
      { id: 'ms-2', title: 'Lens role contract', text: 'Shipped lenses journal and cinematic style all 12 roles with WCAG contrast checks.' },
      { id: 'ms-3', title: 'Anti-overplating grammar', text: 'Rules 39 to 56 enforce zero nested boxes (overplate = 0) and at most 5 tint groups.' },
      { id: 'ms-4', title: 'Cycles bake bridge', text: 'Export world to glTF and render deterministic Cycles frames keyed by SHA-256.' },
      { id: 'ms-5', title: 'Raster rebuild pipeline', text: 'Trace regions with VTracer, assemble vector objects, and score overlay MAD and edge IoU.' },
    ]),
  }),
  Object.freeze({
    id: 'language-docs',
    name: 'Language Documentation Shelf',
    version: '2026.11',
    license: 'CC-BY-4.0',
    chunks: Object.freeze([
      { id: 'ld-1', title: 'Node test runner', text: 'Use node --test for zero-dependency ESM unit tests and assertions.' },
      { id: 'ld-2', title: 'TypeScript strict mode', text: 'Run tsc --noEmit with strict null checks and erasable syntax.' },
      { id: 'ld-3', title: 'Python isolated unittest', text: 'Run py -3 -I -m unittest discover to isolate tests from user site-packages.' },
      { id: 'ld-4', title: 'RFC 6901 JSON Pointer', text: 'Decode ~1 as slash and ~0 as tilde when addressing nested document paths.' },
      { id: 'ld-5', title: 'Web Crypto SHA-256', text: 'Compute deterministic SHA-256 digests across browser and Node runtimes.' },
    ]),
  }),
  Object.freeze({
    id: 'library-docs',
    name: 'Library Documentation Shelf',
    version: '2026.11',
    license: 'MIT',
    chunks: Object.freeze([
      { id: 'lib-1', title: 'Three.js InstancedMesh', text: 'Draw thousands of repeated buffer spheres and nanoparticles with InstancedMesh.' },
      { id: 'lib-2', title: 'Three.js PhysicalMaterial', text: 'Configure transmission, ior, roughness and attenuation for polypropylene and water.' },
      { id: 'lib-3', title: 'ChimeraX command script', text: 'Export molecular cartoons, active-site sticks and pseudobond distance cylinders to GLB.' },
      { id: 'lib-4', title: 'Playwright headless WebGL', text: 'Launch Chromium with software WebGL 2 for deterministic frame capture and layout checks.' },
      { id: 'lib-5', title: 'FFmpeg libx264 muxing', text: 'Encode PNG frames to yuv420p MP4 and mux WAV narration with AAC audio.' },
    ]),
  }),
  Object.freeze({
    id: 'specifications',
    name: 'Specifications and Standards Shelf',
    version: '2026.11',
    license: 'CC0-1.0',
    chunks: Object.freeze([
      { id: 'spec-1', title: 'Tree-HoH likelihood ratio', text: 'Update branch log-odds by log(s / (1 - e)) on pass and log((1 - s) / e) on fail.' },
      { id: 'spec-2', title: 'Sequential Halving', text: 'Prune low-scoring branches at fixed budget rungs with halving factor eta = 3.' },
      { id: 'spec-3', title: 'Paired bootstrap gate', text: 'Accept a patch only when paired bootstrap lower confidence bound is non-negative.' },
      { id: 'spec-4', title: 'ASD-STE100 plain prose', text: 'Write active-voice sentences without refused promotional words or contrasting X not Y pairs.' },
      { id: 'spec-5', title: 'Brier calibration score', text: 'Measure probability forecast accuracy by mean squared error between predicted p and outcome.' },
    ]),
  }),
]);

export const SHELF_BENCH_QUESTIONS = Object.freeze([
  { q: 'camera-relative deep zoom nanometre frames', expectedChunkId: 'ms-1' },
  { q: 'journal cinematic 12 roles contrast', expectedChunkId: 'ms-2' },
  { q: 'anti-overplating zero nested boxes overplate', expectedChunkId: 'ms-3' },
  { q: 'Cycles glTF baked frames SHA-256', expectedChunkId: 'ms-4' },
  { q: 'VTracer raster rebuild MAD edge IoU', expectedChunkId: 'ms-5' },
  { q: 'node --test ESM unit tests', expectedChunkId: 'ld-1' },
  { q: 'tsc --noEmit strict TypeScript', expectedChunkId: 'ld-2' },
  { q: 'py -3 -I unittest isolated Python', expectedChunkId: 'ld-3' },
  { q: 'RFC 6901 JSON Pointer ~1 ~0', expectedChunkId: 'ld-4' },
  { q: 'SHA-256 digest browser Node', expectedChunkId: 'ld-5' },
  { q: 'Three.js InstancedMesh nanoparticles spheres', expectedChunkId: 'lib-1' },
  { q: 'PhysicalMaterial transmission ior polypropylene', expectedChunkId: 'lib-2' },
  { q: 'ChimeraX cartoon sticks pseudobond GLB', expectedChunkId: 'lib-3' },
  { q: 'Playwright headless Chromium software WebGL', expectedChunkId: 'lib-4' },
  { q: 'FFmpeg libx264 yuv420p AAC mux', expectedChunkId: 'lib-5' },
  { q: 'Tree-HoH likelihood ratio log-odds', expectedChunkId: 'spec-1' },
  { q: 'Sequential Halving eta = 3 budget rungs', expectedChunkId: 'spec-2' },
  { q: 'paired bootstrap lower confidence bound patch gate', expectedChunkId: 'spec-3' },
  { q: 'ASD-STE100 refused promotional words', expectedChunkId: 'spec-4' },
  { q: 'Brier calibration mean squared error forecast', expectedChunkId: 'spec-5' },
]);

export function cacheShelfChunk(chunk, license) {
  const canCacheFullText = OPEN_CACHE_LICENSES.has(license);
  return {
    id: chunk.id,
    title: chunk.title,
    license,
    fullTextCached: canCacheFullText,
    text: canCacheFullText ? chunk.text : null,
  };
}

export function searchShelfChunks(query, k = 5, packs = SHELF_PACKS) {
  const terms = String(query || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const scored = [];
  for (const pack of packs) {
    for (const chunk of pack.chunks) {
      const cached = cacheShelfChunk(chunk, pack.license);
      const hay = `${chunk.id} ${chunk.title} ${cached.text ?? ''}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (hay.includes(t)) score += 1;
        if (chunk.title.toLowerCase().includes(t)) score += 2;
      }
      if (score > 0) {
        scored.push({ score, chunkId: chunk.id, packId: pack.id, title: chunk.title, fullTextCached: cached.fullTextCached });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
  return scored.slice(0, k);
}

export function evaluateShelfRecallAt5(questions = SHELF_BENCH_QUESTIONS, packs = SHELF_PACKS) {
  let hits = 0;
  const details = [];
  for (const item of questions) {
    const top5 = searchShelfChunks(item.q, 5, packs);
    const hit = top5.some((r) => r.chunkId === item.expectedChunkId);
    if (hit) hits++;
    details.push({ q: item.q, expected: item.expectedChunkId, hit, topIds: top5.map((r) => r.chunkId) });
  }
  const recallAt5 = questions.length > 0 ? hits / questions.length : 0;
  return {
    total: questions.length,
    hits,
    recallAt5,
    passed: recallAt5 >= 0.8,
    details,
  };
}

export function checkShelfFreshness(pins = {}, upstream = {}) {
  const pinSnapshot = structuredClone(pins);
  const updates = [];
  for (const [packId, pinnedVersion] of Object.entries(pinSnapshot)) {
    const latest = upstream[packId];
    if (typeof latest === 'string' && latest !== pinnedVersion) {
      updates.push({
        packId,
        pinnedVersion,
        upstreamVersion: latest,
        action: 'propose-pin-update',
      });
    }
  }
  return {
    ok: true,
    mutatedPins: false,
    pins: pinSnapshot,
    updates,
  };
}
