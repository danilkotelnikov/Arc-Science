/**
 * arc-core 0.1.0 (2026-11-08)
 * Shared Arc Kit MCP server and core tools for shelf search, claim recording,
 * deterministic gate checks, scope-gated toolpack loading and memory.
 */
import fs from 'node:fs';
import path from 'node:path';

export const name = 'arc-core';
export const version = '0.1.0';
export const inject = ['tools'];

export const DEFAULT_SHELF = Object.freeze([
  Object.freeze({
    id: 'molecullage-core',
    name: 'Molecullage Figure Engine',
    domain: '2d',
    license: 'MIT',
    status: 'verified',
  }),
  Object.freeze({
    id: 'chimerax-struct',
    name: 'ChimeraX Structure Renderer',
    domain: 'structure',
    license: 'BSD-3-Clause',
    status: 'verified',
  }),
  Object.freeze({
    id: 'blender-scene',
    name: 'Blender Studio Scene Pipeline',
    domain: '3d',
    license: 'GPL-3.0-or-later',
    status: 'verified',
  }),
  Object.freeze({
    id: 'openscad-cad',
    name: 'Parametric CAD Assembly Shelf',
    domain: 'cad',
    license: 'GPL-2.0-only',
    status: 'verified',
  }),
  Object.freeze({
    id: 'alphafold-metrics',
    name: 'AlphaFold Confidence and Domain Shelf',
    domain: 'science',
    license: 'CC-BY-4.0',
    status: 'verified',
  }),
  Object.freeze({
    id: 'cammut-hindsight',
    name: 'Cammut Shared Memory Client',
    domain: 'memory',
    license: 'MIT',
    status: 'verified',
  }),
  Object.freeze({
    id: 'arc-bench-runner',
    name: 'Arc Startup and Calibration Bench',
    domain: 'app',
    license: 'MIT',
    status: 'verified',
  }),
  Object.freeze({
    id: 'asar-inspect',
    name: 'Scoped Archive Inspector',
    domain: 'inspect',
    license: 'MIT',
    status: 'verified',
  }),
]);

export const TOOLPACKS = Object.freeze({
  inspect: Object.freeze({
    id: 'inspect',
    name: 'Scoped Archive and Binary Inspector',
    domain: 'inspect',
    requiresScope: true,
    tools: Object.freeze(['inspect.asar', 'inspect.headers', 'inspect.strings']),
  }),
  molecullage: Object.freeze({
    id: 'molecullage',
    name: 'Molecullage Figure and Structure Pack',
    domain: '2d',
    requiresScope: false,
    tools: Object.freeze(['build_figure', 'qa_figure', 'render_structure', 'palette_check']),
  }),
  bench: Object.freeze({
    id: 'bench',
    name: 'Startup and Calibration Benchmark Pack',
    domain: 'app',
    requiresScope: false,
    tools: Object.freeze(['bench.start', 'bench.brier', 'bench.report']),
  }),
  deploy: Object.freeze({
    id: 'deploy',
    name: 'Memory Server SSH Deploy Pack',
    domain: 'memory',
    requiresScope: false,
    tools: Object.freeze(['deploy.preflight', 'deploy.service', 'deploy.verify']),
  }),
});

const PLACEHOLDER_IDS = new Set([
  '', 'none', 'null', 'undefined', 'todo', 'tbd', 'n/a', 'na', 'unverified', 'placeholder',
]);

const NON_PUBLISHED_LEVELS = new Set(['measured', 'simulated', 'architecture', 'target']);

function isValidSourceValue(val, kind) {
  if (typeof val !== 'string') return false;
  const s = val.trim();
  if (!s || PLACEHOLDER_IDS.has(s.toLowerCase())) return false;
  if (kind === 'doi') return /^(doi:?\s*)?10\.\d{4,9}\/\S+$/i.test(s);
  if (kind === 'pmid') return /^(pmid:?\s*)?\d{4,10}$/i.test(s);
  if (kind === 'arxiv') return /^(arxiv:?\s*)?(\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(v\d+)?$/i.test(s);
  if (kind === 'url') return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(s);
  return false;
}

function extractSourceIdentifier(input = {}) {
  const { doi, pmid, arxiv, url, evidence } = input;
  for (const [kind, val] of [['doi', doi], ['pmid', pmid], ['arxiv', arxiv], ['url', url]]) {
    if (val !== undefined && val !== null && val !== '') {
      if (!isValidSourceValue(String(val), kind)) return { valid: false, invalidField: kind };
      return { valid: true, kind, value: String(val).trim() };
    }
  }
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
    for (const kind of ['doi', 'pmid', 'arxiv', 'url']) {
      if (evidence[kind]) {
        if (!isValidSourceValue(String(evidence[kind]), kind)) return { valid: false, invalidField: kind };
        return { valid: true, kind, value: String(evidence[kind]).trim() };
      }
    }
  }
  if (typeof evidence === 'string' && evidence.trim()) {
    const s = evidence.trim();
    const doiMatch = s.match(/\b10\.\d{4,9}\/[^\s,;]+/i);
    if (doiMatch) return { valid: true, kind: 'doi', value: doiMatch[0] };
    const pmidMatch = s.match(/\bPMID:?\s*\d{4,10}\b/i);
    if (pmidMatch) return { valid: true, kind: 'pmid', value: pmidMatch[0] };
    const arxivMatch = s.match(/\barXiv:?\s*\d{4}\.\d{4,5}(v\d+)?\b/i);
    if (arxivMatch) return { valid: true, kind: 'arxiv', value: arxivMatch[0] };
    const urlMatch = s.match(/\bhttps?:\/\/[^\s,;]+/i);
    if (urlMatch) return { valid: true, kind: 'url', value: urlMatch[0] };
  }
  return { valid: false, invalidField: null };
}

export function normalizeCandidateHash(candidateHash) {
  if (typeof candidateHash !== 'string') return '';
  return candidateHash.trim().replace(/^sha256:/i, '').trim();
}

function isTargetWithinRoots(target, allowedRoots) {
  if (typeof target !== 'string' || !target.trim()) return false;
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) return false;
  const resolvedTarget = path.resolve(target);
  const normTarget = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget;
  for (const root of allowedRoots) {
    if (typeof root !== 'string' || !root.trim()) continue;
    const resolvedRoot = path.resolve(root);
    const normRoot = process.platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot;
    const rel = path.relative(normRoot, normTarget);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      return true;
    }
  }
  return false;
}

function validateMemoryTags(tags) {
  if (!Array.isArray(tags)) {
    return { ok: false, error: 'Memory tags must be an array of strings' };
  }
  const strTags = tags.filter((t) => typeof t === 'string').map((t) => t.trim());
  const hasProject = strTags.some((t) => /^project:[a-zA-Z0-9._-]+$/.test(t));
  const hasDate = strTags.some((t) => /^date:\d{4}-\d{2}-\d{2}$/.test(t));
  const hasSource = strTags.some((t) => /^source:[a-zA-Z0-9._-]+$/.test(t));
  if (!hasProject || !hasDate || !hasSource) {
    const missing = [];
    if (!hasProject) missing.push('project:<name>');
    if (!hasDate) missing.push('date:YYYY-MM-DD');
    if (!hasSource) missing.push('source:<agent>');
    return {
      ok: false,
      error: `Missing mandatory memory tags: ${missing.join(', ')}`,
    };
  }
  return { ok: true, tags: strTags };
}

function loadShelfIndex(opts = {}) {
  if (Array.isArray(opts.shelf)) {
    return opts.shelf.map((item) => ({
      id: String(item.id || ''),
      name: String(item.name || ''),
      domain: String(item.domain || 'general'),
      license: String(item.license || 'MIT'),
      status: String(item.status || 'verified'),
    }));
  }
  if (typeof opts.shelfPath === 'string' && opts.shelfPath.trim() && fs.existsSync(opts.shelfPath)) {
    const raw = JSON.parse(fs.readFileSync(opts.shelfPath, 'utf8'));
    const list = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : [];
    return list.map((item) => ({
      id: String(item.id || ''),
      name: String(item.name || ''),
      domain: String(item.domain || 'general'),
      license: String(item.license || 'MIT'),
      status: String(item.status || 'verified'),
    }));
  }
  return DEFAULT_SHELF.map((item) => ({ ...item }));
}

export function createArcCoreServer(opts = {}) {
  const shelfIndex = loadShelfIndex(opts);
  const claims = [];
  const memoryStore = [];
  const storePath = typeof opts.storePath === 'string' && opts.storePath.trim() ? path.resolve(opts.storePath) : null;

  if (storePath && fs.existsSync(storePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      if (Array.isArray(existing)) memoryStore.push(...existing);
    } catch {
      // start with empty memory store if unreadable
    }
  }

  function persistMemory() {
    if (!storePath) return;
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(memoryStore, null, 2) + '\n', 'utf8');
  }

  function shelfSearch({ query = '', domain = '', limit = 20 } = {}) {
    const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];
    const dom = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
    const max = Number.isInteger(limit) && limit > 0 ? limit : 20;

    const scored = [];
    for (const item of shelfIndex) {
      if (dom && item.domain.toLowerCase() !== dom) continue;
      const hay = `${item.id} ${item.name} ${item.domain} ${item.license} ${item.status}`.toLowerCase();
      if (terms.length > 0 && !terms.every((t) => hay.includes(t))) continue;
      let score = 0;
      for (const t of terms) {
        if (item.id.toLowerCase() === t || item.name.toLowerCase() === t) score += 3;
        else if (item.id.toLowerCase().includes(t) || item.name.toLowerCase().includes(t)) score += 2;
        else score += 1;
      }
      scored.push({
        score,
        card: {
          id: item.id,
          name: item.name,
          domain: item.domain,
          license: item.license,
          status: item.status,
        },
      });
    }

    scored.sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id));
    const cards = scored.slice(0, max).map((s) => s.card);
    Object.defineProperties(cards, {
      ok: { value: true, enumerable: false },
      items: { value: cards, enumerable: false },
      count: { value: cards.length, enumerable: false },
    });
    return cards;
  }

  function claimRecord(input = {}) {
    const {
      id,
      text,
      evidence = null,
      level = 'published',
      doi,
      pmid,
      arxiv,
      url,
      dependsOn = [],
    } = input || {};

    if (typeof text !== 'string' || !text.trim()) {
      return { ok: false, rule: 'R006', error: 'Claim text is required' };
    }

    const normLevel = typeof level === 'string' && level.trim() ? level.trim().toLowerCase() : 'published';
    const sourceInfo = extractSourceIdentifier(input);

    if (sourceInfo.invalidField) {
      return {
        ok: false,
        rule: 'R006',
        error: `Invalid source identifier in ${sourceInfo.invalidField}`,
      };
    }

    const requiresCitation =
      normLevel === 'published' ||
      normLevel === 'literature' ||
      normLevel === 'scientific' ||
      !NON_PUBLISHED_LEVELS.has(normLevel) ||
      (!sourceInfo.valid && (typeof evidence !== 'string' || !evidence.trim()));

    if (requiresCitation && !sourceInfo.valid) {
      return {
        ok: false,
        rule: 'R006',
        error: 'Published or scientific claim requires a real source identifier (doi, pmid, arxiv or url)',
      };
    }

    const record = {
      id: typeof id === 'string' && id.trim() ? id.trim() : `claim-${claims.length + 1}`,
      text: text.trim(),
      level: normLevel,
      evidence,
      doi: sourceInfo.kind === 'doi' ? sourceInfo.value : (doi || null),
      pmid: sourceInfo.kind === 'pmid' ? sourceInfo.value : (pmid || null),
      arxiv: sourceInfo.kind === 'arxiv' ? sourceInfo.value : (arxiv || null),
      url: sourceInfo.kind === 'url' ? sourceInfo.value : (url || null),
      dependsOn: Array.isArray(dependsOn) ? [...dependsOn] : [],
    };
    claims.push(record);
    return { ok: true, id: record.id, claim: record, count: claims.length };
  }

  function gateCheck({ candidateHash, checks = [], proseErrors = 0 } = {}) {
    const normalizedHash = normalizeCandidateHash(candidateHash);
    const failedChecks = [];

    if (!normalizedHash) {
      failedChecks.push('candidateHash');
    }

    if (!Array.isArray(checks) || checks.length === 0) {
      failedChecks.push('checks');
    } else {
      checks.forEach((chk, idx) => {
        const label =
          (chk && typeof chk === 'object' && (chk.id || chk.name)) || `check-${idx + 1}`;
        let passed = false;
        if (typeof chk === 'boolean') {
          passed = chk === true;
        } else if (chk && typeof chk === 'object') {
          const explicitPass =
            chk.ok === true || chk.passed === true || chk.exit === 0 || chk.status === 'pass';
          const explicitFail =
            chk.ok === false || chk.passed === false || (typeof chk.exit === 'number' && chk.exit !== 0) || chk.status === 'fail';
          passed = explicitPass && !explicitFail;
        }
        if (!passed) failedChecks.push(String(label));
      });
    }

    if (typeof proseErrors === 'number' && proseErrors > 0) {
      failedChecks.push('proseErrors');
    } else if (Array.isArray(proseErrors) && proseErrors.length > 0) {
      failedChecks.push('proseErrors');
    }

    const ok = failedChecks.length === 0;
    return {
      ok,
      verdict: ok ? 'accepted' : 'unmet',
      candidateHash: normalizedHash,
      failedChecks,
    };
  }

  function toolpackLoad({ pack, target, scope } = {}) {
    const key = typeof pack === 'string' ? pack.trim().toLowerCase() : '';
    const def = TOOLPACKS[key];
    if (!def) {
      return { ok: false, error: `Unknown toolpack: ${String(pack || '')}` };
    }

    if (def.id === 'inspect') {
      const authorized = Boolean(scope && scope.authorized === true);
      const inRoots = isTargetWithinRoots(target, scope && scope.allowedRoots);
      if (!authorized || !inRoots) {
        return {
          ok: false,
          rule: 'R009',
          error: 'Target is outside authorized scope',
        };
      }
    }

    return {
      ok: true,
      pack: def.id,
      name: def.name,
      domain: def.domain,
      tools: [...def.tools],
      target: typeof target === 'string' && target.trim() ? path.resolve(target) : null,
    };
  }

  function memoryRetain({ text, context = '', tags = [] } = {}) {
    if (typeof text !== 'string' || !text.trim()) {
      return { ok: false, error: 'Memory text is required' };
    }
    const tagCheck = validateMemoryTags(tags);
    if (!tagCheck.ok) {
      return { ok: false, error: tagCheck.error };
    }

    const entry = {
      id: `mem-${memoryStore.length + 1}`,
      text: text.trim(),
      context: typeof context === 'string' ? context.trim() : '',
      tags: tagCheck.tags,
      createdAt: new Date().toISOString(),
    };
    memoryStore.push(entry);
    persistMemory();
    return { ok: true, id: entry.id, entry };
  }

  function memoryRecall({ query = '', tags = [], budget = 'mid' } = {}) {
    const reqTags = Array.isArray(tags) ? tags.filter((t) => typeof t === 'string').map((t) => t.trim()) : [];
    if (reqTags.length > 0 && !reqTags.some((t) => /^project:[a-zA-Z0-9._-]+$/.test(t))) {
      return { ok: false, error: 'Recall tags must include project:<name>' };
    }
    const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];
    const limits = { low: 3, mid: 10, high: 25 };
    const max = limits[budget] || limits.mid;

    const matched = [];
    for (const entry of memoryStore) {
      if (reqTags.length > 0 && !reqTags.every((t) => entry.tags.includes(t))) continue;
      const hay = `${entry.text} ${entry.context} ${entry.tags.join(' ')}`.toLowerCase();
      if (terms.length > 0 && !terms.every((t) => hay.includes(t))) continue;
      matched.push(entry);
    }

    const items = matched.slice(-max).reverse();
    return {
      ok: true,
      budget: budget in limits ? budget : 'mid',
      count: items.length,
      items,
    };
  }

  const tools = {
    'shelf.search': shelfSearch,
    'claim.record': claimRecord,
    'gate.check': gateCheck,
    'toolpack.load': toolpackLoad,
    'memory.retain': memoryRetain,
    'memory.recall': memoryRecall,
  };

  return {
    name,
    version,
    shelf: { search: shelfSearch },
    claim: { record: claimRecord, list: () => [...claims] },
    gate: { check: gateCheck },
    toolpack: { load: toolpackLoad },
    memory: { retain: memoryRetain, recall: memoryRecall, list: () => [...memoryStore] },
    tools,
    callTool(toolName, args = {}) {
      const fn = tools[toolName];
      if (typeof fn !== 'function') {
        throw new Error(`Unknown arc-core tool: ${String(toolName)}`);
      }
      return fn(args);
    },
    listTools() {
      return Object.keys(tools);
    },
  };
}

const defaultServer = createArcCoreServer();

export const shelf = defaultServer.shelf;
export const claim = defaultServer.claim;
export const gate = defaultServer.gate;
export const toolpack = defaultServer.toolpack;
export const memory = defaultServer.memory;

export const shelfSearch = defaultServer.shelf.search;
export const claimRecord = defaultServer.claim.record;
export const gateCheck = defaultServer.gate.check;
export const toolpackLoad = defaultServer.toolpack.load;
export const memoryRetain = defaultServer.memory.retain;
export const memoryRecall = defaultServer.memory.recall;

export function apply(ctx, opts = {}) {
  const server = createArcCoreServer(opts);
  if (ctx && ctx.tools && typeof ctx.tools.register === 'function') {
    for (const [toolName, execute] of Object.entries(server.tools)) {
      ctx.tools.register({ name: toolName, execute });
    }
  }
  return server;
}
