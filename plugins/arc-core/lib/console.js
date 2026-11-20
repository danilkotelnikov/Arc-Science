// arc-core console & loops (2026-11-15): Unified C2 console model (4 workspaces, 4 connectors,
// 5 seats, 3-pane Research session, Decision map, 30-day consent grants, Prose detector, live
// Cammut/HoH/Molecullage read routes) and 7 proposal-only update loops with ~/.arc state preservation
// (Slices U1, U2, Phase 1b.2-1b.3, Phase 4.1-4.8 N7a-N7e).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { check as proseGateCheck } from './prose-gate.js';

export const WORKSPACES = Object.freeze(['Research', 'Memory', 'Molecullage', 'Prose']);
export const CONNECTORS = Object.freeze(['Servers', 'Keys', 'Apps', 'Audit', 'Updates']);
export const SEATS = Object.freeze(['Planner', 'Reviewer', 'Falsifier', 'Vision', 'Prose']);
export const RESEARCH_PANES = Object.freeze(['Map', 'Claims', 'Evidence']);
export const RESEARCH_VIEWS = Object.freeze(['Map', 'Claims', 'Evidence', 'Release']);
export const DECISION_ACTIONS = Object.freeze(['Pursue', 'Park', 'Drop', 'Request a test']);
export const CONSENT_MODES = Object.freeze(['Single action', 'Grant for 30 days', 'Revoke']);
export const LADDER_RUNGS = Object.freeze([
  Object.freeze({ id: 'L1', label: 'Self-calibration', active: true }),
  Object.freeze({ id: 'L2', label: 'Proxy correlation', active: true }),
  Object.freeze({ id: 'L3', label: 'Prospective holdout', active: true }),
  Object.freeze({ id: 'L4', label: 'Wet-lab benchmark', active: true }),
  Object.freeze({ id: 'L5', label: 'Automated model routing', active: false }),
  Object.freeze({ id: 'L6', label: 'Autonomous tool authoring', active: false }),
]);

export const UPDATE_LOOPS = Object.freeze([
  'policy-review',
  'shelf-freshness',
  'calibration-check',
  'memory-compaction',
  'toolpack-audit',
  'prose-lexicon-sync',
  'benchmark-regression',
]);

export function proposeUpdateLoop({ loop, summary, diff = [] } = {}) {
  if (!UPDATE_LOOPS.includes(loop)) {
    return { ok: false, error: `Unknown update loop: ${String(loop)}` };
  }
  if (typeof summary !== 'string' || !summary.trim()) {
    return { ok: false, error: 'Update loop proposal requires a non-empty summary' };
  }
  return {
    ok: true,
    loop,
    summary: summary.trim(),
    diff: Array.isArray(diff) ? [...diff] : [],
    status: 'proposed',
    autoApplied: false,
    requiresOperatorApproval: true,
  };
}

export function verifyUpdateChannel({
  channel = 'stable',
  currentVersion = '0.1.0',
  candidateVersion = '0.2.0',
  signatureValid = false,
  userStateFiles = ['config.json', 'local-plugins', 'memory.json'],
} = {}) {
  if (!['stable', 'beta', 'nightly'].includes(channel)) {
    return { ok: false, error: `Unknown update channel: ${String(channel)}` };
  }
  if (!signatureValid) {
    return { ok: false, error: 'Refused unsigned update bundle' };
  }
  return {
    ok: true,
    channel,
    from: currentVersion,
    to: candidateVersion,
    preservedUserState: [...userStateFiles],
    cleanRollbackAvailable: true,
  };
}

export function createConsentGrant({ appId, scopes = [], grantedAtMs = Date.now(), ttlDays = 30 } = {}) {
  if (typeof appId !== 'string' || !appId.trim()) {
    throw new Error('appId is required for a consent grant');
  }
  const expiresAtMs = grantedAtMs + ttlDays * 24 * 60 * 60 * 1000;
  let revoked = false;
  return {
    appId: appId.trim(),
    scopes: [...scopes],
    grantedAtMs,
    expiresAtMs,
    revoke() {
      revoked = true;
    },
    isValid(nowMs = Date.now()) {
      return !revoked && nowMs < expiresAtMs;
    },
  };
}

const CONTRAST_PATTERNS = [
  /\bnot\s+(?:[a-z]+\s+){0,3}[a-z]+,\s+but\s+(?:[a-z]+\s+){0,3}[a-z]+\b/i,
  /\brather\s+than\b/i,
  /\bне\s+(?:[а-яё]+\s+){0,3}[а-яё]+,\s+а\s+(?:[а-яё]+\s+){0,3}[а-яё]+\b/iu,
];

const FORMULAIC_OPENERS = [
  /\bdelve\s+into\b/i,
  /\btestament\s+to\b/i,
  /\bparadigm\s+shift\b/i,
  /\bseamlessly\b/i,
  /\bholistic\b/i,
];

let cachedLexiconPath = null;
let cachedRefusedEntries = null;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadRefusedLexicon(lexiconPath = path.join(os.homedir(), 'arc-harness', 'shared', 'lexicon', 'refused.en.txt')) {
  if (cachedRefusedEntries && cachedLexiconPath === lexiconPath) return cachedRefusedEntries;
  const entries = [];
  try {
    if (fs.existsSync(lexiconPath)) {
      const raw = fs.readFileSync(lexiconPath, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const phrase = line.trim();
        if (!phrase || phrase.startsWith('#')) continue;
        const pattern = new RegExp(`\\b${escapeRegex(phrase).replace(/\s+/g, '\\s+')}\\b`, 'i');
        entries.push({ phrase, pattern });
      }
    }
  } catch {
    // Offline fallback uses built-in FORMULAIC_OPENERS only.
  }
  cachedLexiconPath = lexiconPath;
  cachedRefusedEntries = entries;
  return entries;
}

export function detectFormulaicProse(text = '', opts = {}) {
  const findings = [];
  const seen = new Set();
  const s = String(text || '');
  const pushFinding = (kind, match) => {
    const key = `${kind}:${String(match).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ kind, match });
  };
  for (const re of CONTRAST_PATTERNS) {
    const m = s.match(re);
    if (m) pushFinding('contrast-x-not-y', m[0]);
  }
  const seenFormula = new Set();
  for (const re of FORMULAIC_OPENERS) {
    const m = s.match(re);
    if (m) {
      seenFormula.add(m[0].toLowerCase());
      pushFinding('formulaic-phrase', m[0]);
    }
  }
  for (const entry of loadRefusedLexicon(opts.lexiconPath)) {
    const m = s.match(entry.pattern);
    if (m && !seenFormula.has(m[0].toLowerCase())) {
      seenFormula.add(m[0].toLowerCase());
      pushFinding('refused-word', m[0]);
    }
  }
  for (const f of proseGateCheck(s).findings) {
    if (f.rule === 'SELF_UNDERCUT') findings.push({ kind: 'self-undercut', match: f.span, allowed: f.allowed });
  }
  return {
    ok: findings.length === 0,
    findings,
  };
}

export function rewriteFormulaicProse(text = '') {
  // A sentence that the prose gate blocks or marks stays whole for its writer or reader (S049); the phrase rules below
  // rewrite only the other sentences. The split keeps each separator, so the text joins back as it was.
  const touched = (s) => proseGateCheck(s).findings.some((f) => f.rule === 'SELF_UNDERCUT' || f.rule === 'UNSURE_ABSENCE');
  const out = String(text || '').split(/((?<=[.!?;:])\s+)/).map((part, k) => (k % 2 || touched(part) ? part : rewritePhrases(part))).join('');
  return out.replace(/\s{2,}/g, ' ').trim();
}

function rewritePhrases(text) {
  let out = text;
  out = out.replace(
    /\b(not)\s+(?:[a-z]+\s+){0,3}[a-z]+,\s+but\s+((?:[a-z]+\s+){0,3}[a-z]+)\b/gi,
    (match, notWord, replacement) => {
      if (notWord[0] === 'N') {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    },
  );
  out = out.replace(
    /\b(не)\s+(?:[а-яё]+\s+){0,3}[а-яё]+,\s+а\s+((?:[а-яё]+\s+){0,3}[а-яё]+)\b/giu,
    (match, neWord, replacement) => {
      if (neWord[0] === 'Н') {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    },
  );
  out = out.replace(/\s+\brather\s+than\s+[^.,;!?]+/gi, '');
  out = out.replace(/\brather\s+than\b/gi, 'instead of');
  out = out.replace(/\bdelve\s+into\b/gi, 'examine');
  out = out.replace(/\ba\s+testament\s+to\b/gi, 'evidence for');
  out = out.replace(/\btestament\s+to\b/gi, 'evidence for');
  out = out.replace(/\bparadigm\s+shift\b/gi, 'method change');
  out = out.replace(/\bseamlessly\b/gi, 'cleanly');
  out = out.replace(/\bholistic\b/gi, 'whole');
  out = out.replace(/\bleverage\b/gi, 'use');
  out = out.replace(/\bunlock\b/gi, 'open');
  out = out.replace(/\bempower\b/gi, 'let');
  out = out.replace(/\brevolution\b/gi, 'change');
  out = out.replace(/\bgame[- ]changer\b/gi, 'useful step');
  out = out.replace(/\bnext[- ]generation\b/gi, 'newer');
  out = out.replace(/\bbest[- ]of[- ]breed\b/gi, 'strong');
  out = out.replace(/\breimagine\b/gi, 'redesign');
  out = out.replace(/\btransformative\b/gi, 'large');
  out = out.replace(/\bdisruptive\b/gi, 'unusual');
  out = out.replace(/\bmission[- ]critical\b/gi, 'essential');
  // The rewrite leaves every undercut in place; the detector marks it for the writer (F102). The phrase rules above still
  // shorten a sentence that the gate leaves clean ("rather than ...", "not X, but Y") without a report.
  return out;
}

export function createC2ConsoleState() {
  return {
    workspaces: [...WORKSPACES],
    connectors: [...CONNECTORS],
    seats: [...SEATS],
    researchPanes: [...RESEARCH_PANES],
    researchViews: [...RESEARCH_VIEWS],
    decisionActions: [...DECISION_ACTIONS],
    ladderRungs: LADDER_RUNGS.map((r) => ({ ...r })),
    activeWorkspace: 'Research',
    activeResearchView: 'Map',
    activeConnector: 'Servers',
    activePaneMode: 'workspace',
    settingsOpen: false,
  };
}

function redactSecretText(s) {
  return String(s || '')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{8,}|gh[pou]_[A-Za-z0-9_-]{8,})/g, '[redacted]');
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readHohLedgerSafe(ledgerPath, limit = 6) {
  try {
    if (!fs.existsSync(ledgerPath)) return { available: false, total: 0, latest: null, recent: [] };
    const lines = fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/).filter((l) => l.trim());
    const parsed = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        // skip malformed line
      }
    }
    const recent = parsed.slice(-limit).map((r) => ({
      seq: r.seq ?? null,
      ts: r.ts || null,
      type: r.type || 'event',
      caller: r.caller || 'agent',
      goal: redactSecretText(String(r.goal || r.verdict || r.note || r.type || '').slice(0, 120)),
    }));
    const latest = recent.length > 0 ? recent[recent.length - 1] : null;
    return { available: true, total: parsed.length, latest, recent };
  } catch {
    return { available: false, total: 0, latest: null, recent: [] };
  }
}

function readLocalMolecullageSafe(molecullageRoot) {
  const libDir = path.join(molecullageRoot, 'studio', 'library');
  const sourcesJson = readJsonSafe(path.join(libDir, 'sources.json'));
  const freezeJson = readJsonSafe(path.join(libDir, 'atlas', 'FREEZE.json'));
  let domainsCount = 8;
  try {
    const domDir = path.join(libDir, 'atlas', 'domains');
    if (fs.existsSync(domDir)) {
      const files = fs.readdirSync(domDir).filter((f) => f.endsWith('.json'));
      if (files.length > 0) domainsCount = files.length;
    }
  } catch {
    domainsCount = 8;
  }
  const rawSources = Array.isArray(sourcesJson?.sources) ? sourcesJson.sources : [];
  const sources = rawSources.map((s) => ({
    id: String(s.id || ''),
    name: String(s.name || ''),
    kind: String(s.kind || ''),
    section: String(s.section || ''),
    licenceClass: String(s.licenceClass || ''),
    use: String(s.use || '').slice(0, 120),
    url: String(s.url || ''),
    doi: String(s.doi || ''),
  }));
  return {
    available: sources.length > 0,
    sourcesCount: sources.length > 0 ? sources.length : 231,
    domainsCount,
    frozen: freezeJson?.frozen ?? null,
    sources,
  };
}

function readGatewayConfigSafe(arcHome) {
  const nativeCfg = readJsonSafe(path.join(arcHome, 'gateway.json'));
  const legacyCfg = readJsonSafe(path.join(arcHome, 'gateway-config.json'));
  const cfg = (nativeCfg && typeof nativeCfg === 'object') ? nativeCfg : legacyCfg;
  if (!cfg || typeof cfg !== 'object') {
    return { available: false, cammutRecall: false, anthropicPromptCaching: false, defaultReasoningEffort: 'none' };
  }
  const routes = Array.isArray(cfg.routes) ? cfg.routes : [];
  const hasRoute = (prefix) => routes.some((r) => r && r.prefix === prefix && Boolean(r.target));
  return {
    available: true,
    cammutRecall: Boolean(cfg.cammut?.governor?.enabled ?? cfg.cammutRecall?.enabled ?? cfg.cammutRecall),
    anthropicPromptCaching: Boolean(cfg.promptCaching?.enabled ?? cfg.anthropicPromptCaching?.enabled ?? cfg.anthropicPromptCaching),
    defaultReasoningEffort: String(cfg.defaultReasoningEffort || 'none'),
    radiumConfigured: Boolean(cfg.radiumUrl || hasRoute('/radium/v1')),
    mergeConfigured: Boolean(cfg.mergeUrl || hasRoute('/merge/v1')),
  };
}

function readLocalPluginsSafe(arcHome) {
  const plugins = [];
  const preflights = [];
  try {
    const dir = path.join(arcHome, 'local-plugins');
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) plugins.push(name);
      }
    }
  } catch {
    // ignore
  }
  try {
    const pdir = path.join(arcHome, 'preflight');
    if (fs.existsSync(pdir)) {
      const files = fs.readdirSync(pdir).filter((f) => f.endsWith('.json')).slice(-4);
      for (const f of files) {
        const j = readJsonSafe(path.join(pdir, f));
        preflights.push({ file: f, state: String(j?.state || (j?.ok === true ? 'pass' : 'recorded')) });
      }
    }
  } catch {
    // ignore
  }
  return { plugins, preflights };
}

function parseMcpTextBody(rawText) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  const lines = trimmed.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('data:')) {
      try {
        return JSON.parse(line.slice(5).trim());
      } catch {
        // continue
      }
    }
  }
  return null;
}

async function probeGatewayHealth(gatewayHost, fetchImpl, timeoutMs = 1200) {
  if (!fetchImpl) return { reachable: false, status: 'no-fetch', routes: [], cammut: false, upstreamCount: 0 };
  try {
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
    const res = await fetchImpl(`http://${gatewayHost}/health`, { method: 'GET', signal });
    if (!res.ok) return { reachable: false, status: `http-${res.status}`, routes: [], cammut: false, upstreamCount: 0 };
    const data = await res.json();
    return {
      reachable: true,
      status: String(data?.status || 'ok'),
      version: String(data?.version || ''),
      routes: Array.isArray(data?.routes) ? data.routes.slice(0, 12) : [],
      cammut: Boolean(data?.cammut),
      upstreamCount: data?.cammutUpstreams && typeof data.cammutUpstreams === 'object' ? Object.keys(data.cammutUpstreams).length : 0,
    };
  } catch (err) {
    return { reachable: false, status: String(err?.name || 'offline'), routes: [], cammut: false, upstreamCount: 0 };
  }
}

async function recallCammutMemory(gatewayHost, query, opts = {}, fetchImpl) {
  if (!fetchImpl) return { ok: false, error: 'Fetch unavailable', items: [] };
  try {
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined;
    const defaultTag = process.env.ARC_PROJECT_TAG || 'project:arc-harness';
    const tags = Array.isArray(opts.tags) && opts.tags.length > 0 ? opts.tags : [defaultTag];
    const budget = typeof opts.budget === 'string' && opts.budget ? opts.budget : 'low';
    const res = await fetchImpl(`http://${gatewayHost}/cammut/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'cammut_call',
          arguments: {
            tool: 'hindsight/recall',
            arguments: { query, tags, budget },
          },
        },
      }),
      signal,
    });
    const rawText = await res.text();
    const parsed = parseMcpTextBody(rawText);
    const contentText = parsed?.result?.content?.[0]?.text || rawText;
    let payloadJson = null;
    try {
      payloadJson = JSON.parse(contentText);
    } catch {
      payloadJson = null;
    }
    const rawItems = Array.isArray(payloadJson?.results)
      ? payloadJson.results
      : Array.isArray(payloadJson?.facts)
        ? payloadJson.facts
        : Array.isArray(payloadJson)
          ? payloadJson
          : contentText
            ? [{ text: String(contentText).slice(0, 280), context: 'cammut' }]
            : [];
    const items = rawItems.slice(0, 8).map((item, idx) => ({
      id: String(item?.id || `mem-${idx + 1}`),
      text: redactSecretText(String(item?.text || item?.content || item?.summary || item || '').slice(0, 280)),
      context: redactSecretText(String(item?.context || item?.type || 'memory').slice(0, 80)),
    }));
    return { ok: Boolean(res.ok && !parsed?.error), items, error: parsed?.error ? String(parsed.error.message || 'rpc-error') : null };
  } catch (err) {
    return { ok: false, error: redactSecretText(err?.message || 'Cammut recall failed'), items: [] };
  }
}

async function retainCammutMemory(gatewayHost, content, opts = {}, fetchImpl) {
  if (!fetchImpl || !content) return { ok: false, error: 'Fetch unavailable' };
  try {
    const sig = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(1500) : undefined;
    const tags = Array.isArray(opts.tags) && opts.tags.length ? opts.tags : [process.env.ARC_PROJECT_TAG || 'project:arc-harness', 'source:arc-console'];
    const pl = { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: 'cammut_call', arguments: { tool: 'hindsight/retain', arguments: { content: sStr(content, 600), context: sStr(opts.context || 'arc-console review', 120), tags } } } };
    const res = await fetchImpl(`http://${gatewayHost}/cammut/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(pl), signal: sig });
    const p = parseMcpTextBody(await res.text()), e = p?.error || (p?.result?.isError ? { message: 'rpc-tool-error' } : null);
    return { ok: Boolean(res.ok && p && !e), error: e ? sStr(e.message || 'rpc-error', 120) : (!p ? 'Invalid MCP reply' : null) };
  } catch (err) { return { ok: false, error: sStr(err?.message || 'Cammut retain failed', 120) }; }
}
const CONSOLE_TARGET_TYPES = new Set(['session', 'branch', 'claim', 'evidence', 'source', 'release']);
const VERDICT_MAP = Object.freeze(Object.assign(Object.create(null), { approve: 'Approve', revise: 'Revise', hold: 'Hold' }));
const VALID_VERDICT_LABELS = new Set(['Approve', 'Revise', 'Hold']);
const sStr = (v, n) => redactSecretText(String(v ?? '')).trim().slice(0, n);
const normTarget = (tt, tid, fb) => ({ tType: CONSOLE_TARGET_TYPES.has(String(tt || 'session').trim().toLowerCase()) ? String(tt || 'session').trim().toLowerCase() : 'session', tId: sStr(tid || fb, 120) || String(fb).slice(0, 120) });
const capMap = (o, max = 200) => { const ks = Object.keys(o); if (ks.length > max) for (const k of ks.slice(0, ks.length - max)) delete o[k]; };
function readConsoleNotesSafe(f) {
  const empty = { notes: [], verdicts: Object.create(null), molecullagePins: [] }, raw = f ? readJsonSafe(f) : null;
  if (!raw || typeof raw !== 'object') return empty;
  const isR = (x) => x && typeof x === 'object' && typeof x.id === 'string', verdicts = Object.create(null);
  if (raw.verdicts && typeof raw.verdicts === 'object' && !Array.isArray(raw.verdicts)) {
    for (const [k, v] of Object.entries(raw.verdicts)) if (v && typeof v === 'object' && !Array.isArray(v) && VALID_VERDICT_LABELS.has(v.verdict)) verdicts[k] = v;
  }
  capMap(verdicts, 200);
  return { notes: Array.isArray(raw.notes) ? raw.notes.filter(isR).slice(-200) : [], verdicts, molecullagePins: Array.isArray(raw.molecullagePins) ? raw.molecullagePins.filter(isR).slice(-200) : [] };
}

export function createResearchSessionStore(opts = {}) {
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const gatewayHost = typeof opts.gatewayHost === 'string' && opts.gatewayHost.trim() ? opts.gatewayHost.trim() : '127.0.0.1:7424';
  const envArcHome = typeof process.env.ARC_HOME === 'string' && process.env.ARC_HOME.trim() ? process.env.ARC_HOME.trim() : '';
  const arcHome = typeof opts.arcHome === 'string' && opts.arcHome.trim()
    ? opts.arcHome
    : (envArcHome || path.join(os.homedir(), '.arc'));
  const molecullageRoot = typeof opts.molecullageRoot === 'string' && opts.molecullageRoot.trim() ? opts.molecullageRoot : path.join(os.homedir(), 'Molecullage');
  const liveEnabled = opts.live !== false;
  const notesFile = typeof opts.notesFile === 'string' && opts.notesFile.trim() ? opts.notesFile.trim()
    : (typeof opts.arcHome === 'string' && opts.arcHome.trim() ? path.join(opts.arcHome.trim(), 'console-notes.json')
      : (opts.persist === false || !liveEnabled ? '' : path.join(arcHome, 'console-notes.json')));
  const fetchImpl = typeof opts.fetch === 'function' ? opts.fetch : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const state = createC2ConsoleState();
  const sessionId = typeof opts.sessionId === 'string' && opts.sessionId.trim() ? opts.sessionId.trim() : 'session-arc-science-01';
  const persisted = (opts.notesFile || opts.arcHome || opts.persist === true || liveEnabled) ? readConsoleNotesSafe(notesFile) : { notes: [], verdicts: {}, molecullagePins: [] };
  const notes = [...persisted.notes], verdicts = { ...persisted.verdicts }, molecullagePins = [...persisted.molecullagePins];

  function saveConsoleNotesSafe() {
    if (!notesFile) return false;
    try {
      fs.mkdirSync(path.dirname(notesFile), { recursive: true });
      const tmp = `${notesFile}.tmp-${process.pid}-${crypto.randomUUID()}`;
      fs.writeFileSync(tmp, `${JSON.stringify({ notes, verdicts, molecullagePins }, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, notesFile);
      return true;
    } catch { return false; }
  }

  const seatAssignments = Array.isArray(opts.seatAssignments)
    ? opts.seatAssignments.map((s) => ({ ...s }))
    : [
        { seat: 'Planner', role: 'Branch decomposition and budget' },
        { seat: 'Reviewer', role: 'Evidence and citation audit' },
        { seat: 'Falsifier', role: 'Counter-hypothesis and holdout probe' },
        { seat: 'Vision', role: 'Rendered pixel and layout read' },
        { seat: 'Prose', role: 'Plain wording and lexicon check' },
      ];

  const branches = Array.isArray(opts.branches)
    ? opts.branches.map((b) => ({ ...b }))
    : [
        {
          id: 'b-cdr3-loop',
          title: 'CDR3 active-site insertion geometry',
          supportLogLR: 2.84,
          voiPerCost: 1.42,
          rung: 'L2',
          status: 'active',
          decision: 'Pursue',
        },
        {
          id: 'b-surface-patch',
          title: 'Flat framework contact patch',
          supportLogLR: 0.41,
          voiPerCost: 0.35,
          rung: 'L1',
          status: 'halved',
          decision: 'Park',
        },
        {
          id: 'b-unconstrained',
          title: 'Unconstrained loop length sampling',
          supportLogLR: -1.15,
          voiPerCost: 0.08,
          rung: 'L1',
          status: 'pruned',
          decision: 'Drop',
        },
      ];

  const claims = Array.isArray(opts.claims)
    ? opts.claims.map((c) => ({ ...c }))
    : [
        {
          id: 'c-1mel-contacts',
          text: 'PDB 1MEL forms 55 heavy-atom residue pairs within 4.5 A between camel VH and lysozyme.',
          level: 'published',
          source: '10.1038/nsb0996-803',
          rung: 'L4',
        },
        {
          id: 'c-a100-share',
          text: 'Combined autoencoder and denoiser Adam training states occupy 6.54 GB (8.2% of an 80 GB NVIDIA A100).',
          level: 'architecture',
          source: 'studio/jobs/ml-explainer/compute/sizes.json',
          rung: 'L1',
        },
      ];

  const evidence = Array.isArray(opts.evidence)
    ? opts.evidence.map((e) => ({ ...e }))
    : [
        { id: 'ev-pdb-1mel', kind: 'primary-data', ref: 'data/pdb/1MEL.pdb', verified: '2026-11-09' },
        { id: 'ev-sizes', kind: 'computation', ref: 'compute/sizes.mjs', verified: '2026-11-09' },
      ];

  const timeline = [
    { id: 'ev-1', atMs: nowFn(), kind: 'session-open', summary: 'Opened Research session head' },
    { id: 'ev-2', atMs: nowFn(), kind: 'tree-eval', summary: 'Scored 3 branches by support and value of information' },
  ];
  let evSeq = timeline.length;
  const nextEvId = () => `ev-${++evSeq}`;
  const pushTimeline = (ev) => { timeline.push({ id: nextEvId(), ...ev }); if (timeline.length > 200) timeline.splice(0, timeline.length - 200); };

  const decisions = branches.map((b) => ({
    branchId: b.id,
    action: b.decision,
    note: '',
    recordedAtMs: nowFn(),
  }));

  const grants = new Map();
  let proseText = 'The camera starts outside the tube and zooms into the warm drop.';

  function head() {
    return {
      ok: true,
      sessionId,
      activeWorkspace: state.activeWorkspace,
      activeResearchView: state.activeResearchView,
      activeConnector: state.activeConnector,
      activePaneMode: state.activePaneMode,
      settingsOpen: state.settingsOpen,
      workspaces: [...WORKSPACES],
      connectors: [...CONNECTORS],
      seats: [...SEATS],
      seatAssignments: seatAssignments.map((s) => ({ ...s })),
      researchPanes: [...RESEARCH_PANES],
      researchViews: [...RESEARCH_VIEWS],
      decisionActions: [...DECISION_ACTIONS],
      ladderRungs: state.ladderRungs.map((r) => ({ ...r })),
      branchCount: branches.length,
      claimCount: claims.length,
    };
  }

  function selectWorkspace(workspace) {
    if (!WORKSPACES.includes(workspace)) {
      return { ok: false, error: `Unknown workspace: ${String(workspace)}` };
    }
    state.activeWorkspace = workspace;
    state.activePaneMode = 'workspace';
    state.settingsOpen = false;
    return { ok: true, activeWorkspace: state.activeWorkspace, activePaneMode: state.activePaneMode };
  }

  function selectResearchView(view) {
    if (!RESEARCH_VIEWS.includes(view)) {
      return { ok: false, error: `Unknown research view: ${String(view)}` };
    }
    state.activeResearchView = view;
    return { ok: true, activeResearchView: state.activeResearchView };
  }

  function selectConnector(connector) {
    if (!CONNECTORS.includes(connector)) {
      return { ok: false, error: `Unknown connector: ${String(connector)}` };
    }
    state.activeConnector = connector;
    state.activePaneMode = 'connector';
    state.settingsOpen = false;
    return { ok: true, activeConnector: state.activeConnector, activePaneMode: state.activePaneMode };
  }

  function toggleSettings(open) {
    state.settingsOpen = typeof open === 'boolean' ? open : !state.settingsOpen;
    return { ok: true, settingsOpen: state.settingsOpen };
  }

  function setOperatorSwitch(rungId, enabled) {
    if (rungId !== 'L5' && rungId !== 'L6') {
      return { ok: false, error: `Only L5 and L6 are operator switches (got ${String(rungId)})` };
    }
    const target = state.ladderRungs.find((r) => r.id === rungId);
    target.active = Boolean(enabled);
    pushTimeline({
      atMs: nowFn(),
      kind: 'operator-switch',
      summary: `${rungId} set to ${target.active ? 'on' : 'off'}`,
    });
    return { ok: true, rung: { ...target } };
  }

  function recordDecision({ branchId, action, note = '' } = {}) {
    if (!DECISION_ACTIONS.includes(action)) {
      return { ok: false, error: `Unknown decision action: ${String(action)}` };
    }
    const branch = branches.find((b) => b.id === branchId);
    if (!branch) {
      return { ok: false, error: `Unknown branch: ${String(branchId)}` };
    }
    branch.decision = action;
    const cleanNote = redactSecretText(String(note || '').trim()).slice(0, 600);
    if (cleanNote) {
      branch.note = cleanNote;
    }
    const entry = {
      branchId: branch.id,
      action,
      note: cleanNote,
      recordedAtMs: nowFn(),
    };
    decisions.push(entry);
    pushTimeline({
      atMs: entry.recordedAtMs,
      kind: 'decision',
      summary: `${branch.title}: ${action}`,
    });
    return { ok: true, decision: entry, branch: { ...branch } };
  }

  async function recordReview({ tType, tId, cleanText, cleanVerdict, kind, summary, retainText, retainCtx, retain }) {
    const atMs = nowFn(), key = `${tType}:${tId}`; let entry = null;
    if (cleanText) { entry = { id: `note-${crypto.randomUUID()}`, atMs, targetType: tType, targetId: tId, text: cleanText, verdict: cleanVerdict, author: 'owner' }; notes.push(entry); if (notes.length > 200) notes.splice(0, notes.length - 200); }
    if (cleanVerdict) { verdicts[key] = { targetType: tType, targetId: tId, verdict: cleanVerdict, note: cleanText, atMs, author: 'owner' }; capMap(verdicts, 200); }
    const saved = saveConsoleNotesSafe(); pushTimeline({ atMs, kind, summary });
    const retained = retain === true && liveEnabled && fetchImpl ? await retainCammutMemory(gatewayHost, retainText, { context: retainCtx }, fetchImpl) : { ok: false, skipped: true };
    return { ok: true, saved, key, entry, retained, notes: notes.slice(-50).map((n) => ({ ...n })), verdicts: { ...verdicts } };
  }
  async function addNote({ targetType = 'session', targetId = '', text = '', note = '', verdict = '', retain = false } = {}) {
    const cleanText = sStr(text || note, 600); if (!cleanText) return { ok: false, error: 'Note text is required' };
    const { tType, tId } = normTarget(targetType, targetId, sessionId), vRaw = String(verdict ?? '').trim().toLowerCase();
    if (vRaw && !VERDICT_MAP[vRaw]) return { ok: false, error: `Unknown review verdict: ${String(verdict).slice(0, 40)}` };
    const cleanVerdict = vRaw ? VERDICT_MAP[vRaw] : '', r = await recordReview({ tType, tId, cleanText, cleanVerdict, kind: 'owner-note', summary: `Note on ${tId}: ${cleanText.slice(0, 64)}`, retainText: `[arc-console] ${tType}:${tId}${cleanVerdict ? ` (${cleanVerdict})` : ''} - ${cleanText}`, retainCtx: `arc-console ${tType} note`, retain });
    return { ok: true, saved: r.saved, note: { ...r.entry }, notes: r.notes, verdicts: r.verdicts, retained: r.retained };
  }
  async function annotateVerdict({ targetType = 'branch', targetId = '', verdict = '', note = '', retain = false } = {}) {
    const cleanVerdict = VERDICT_MAP[String(verdict ?? '').trim().toLowerCase()];
    if (!cleanVerdict) return { ok: false, error: `Unknown review verdict: ${String(verdict).slice(0, 40)}` };
    const { tType, tId } = normTarget(targetType, targetId, sessionId), cleanText = sStr(note, 600), r = await recordReview({ tType, tId, cleanText, cleanVerdict, kind: 'owner-verdict', summary: `${tType}:${tId} marked ${cleanVerdict}`, retainText: `[arc-console] ${tType}:${tId} verdict ${cleanVerdict}${cleanText ? `: ${cleanText}` : ''}`, retainCtx: `arc-console ${tType} verdict`, retain });
    return { ok: true, saved: r.saved, key: r.key, review: { ...verdicts[r.key] }, verdicts: r.verdicts, notes: r.notes, retained: r.retained };
  }
  function toggleMolecullagePin({ source, sourceId, id, title = '', name = '', section = '', doi = '', url = '' } = {}) {
    const srcObj = source && typeof source === 'object' ? source : {}, targetId = sStr(srcObj.id || sourceId || id, 120);
    if (!targetId) return { ok: false, error: 'Source id is required' };
    const idx = molecullagePins.findIndex((p) => p.id === targetId); let pinned = false;
    if (idx >= 0) molecullagePins.splice(idx, 1);
    else { const rawUrl = sStr(srcObj.url || url, 200); molecullagePins.push({ id: targetId, name: sStr(srcObj.name || name || title || targetId, 120), section: sStr(srcObj.section || section, 60), doi: sStr(srcObj.doi || doi, 120), url: /^https?:\/\/\S+$/i.test(rawUrl) ? rawUrl : '', pinnedAtMs: nowFn() }); if (molecullagePins.length > 200) molecullagePins.splice(0, molecullagePins.length - 200); pinned = true; }
    const saved = saveConsoleNotesSafe(); pushTimeline({ atMs: nowFn(), kind: 'molecullage-pin', summary: `${pinned ? 'Pinned' : 'Unpinned'} source ${targetId}` });
    return { ok: true, saved, pinned, id: targetId, pins: molecullagePins.map((p) => ({ ...p })) };
  }

  function applyConsent({ appId, scopes = [], mode = 'Grant for 30 days' } = {}) {
    if (!CONSENT_MODES.includes(mode)) {
      return { ok: false, error: `Unknown consent mode: ${String(mode)}` };
    }
    if (typeof appId !== 'string' || !appId.trim()) {
      return { ok: false, error: 'appId is required' };
    }
    const key = appId.trim();
    const nowMs = nowFn();
    if (mode === 'Revoke') {
      const existing = grants.get(key);
      if (existing) existing.grant.revoke();
      grants.delete(key);
      pushTimeline({ atMs: nowMs, kind: 'consent-revoke', summary: `Revoked ${key}` });
      return { ok: true, appId: key, mode: 'Revoke', active: false };
    }
    const ttlDays = mode === 'Single action' ? 0 : 30;
    const grant = createConsentGrant({
      appId: key,
      scopes,
      grantedAtMs: nowMs,
      ttlDays: ttlDays === 0 ? 1 / 1440 : 30,
    });
    grants.set(key, { grant, mode });
    pushTimeline({ atMs: nowMs, kind: 'consent-grant', summary: `${mode} for ${key}` });
    return {
      ok: true,
      appId: key,
      mode,
      scopes: [...grant.scopes],
      grantedAtMs: grant.grantedAtMs,
      expiresAtMs: grant.expiresAtMs,
      active: grant.isValid(nowMs),
    };
  }

  function listActiveGrants() {
    const nowMs = nowFn();
    const out = [];
    for (const [appId, rec] of grants.entries()) {
      if (rec.grant.isValid(nowMs)) {
        out.push({
          appId,
          mode: rec.mode,
          scopes: [...rec.grant.scopes],
          grantedAtMs: rec.grant.grantedAtMs,
          expiresAtMs: rec.grant.expiresAtMs,
        });
      }
    }
    return out;
  }

  function updateProseDraft(text = '') {
    proseText = String(text || '');
    return { ok: true, text: proseText, report: detectFormulaicProse(proseText) };
  }

  function rewriteProseDraft(text) {
    if (typeof text === 'string') {
      proseText = text;
    }
    proseText = rewriteFormulaicProse(proseText);
    pushTimeline({
      atMs: nowFn(),
      kind: 'prose-rewrite',
      summary: 'Rewrote draft to plain direct sentences locally',
    });
    return { ok: true, text: proseText, report: detectFormulaicProse(proseText) };
  }

  const liveState = {
    gateway: { reachable: false, status: 'not-checked', routes: [], cammut: false, upstreamCount: 0 },
    ledger: { available: false, total: 0, latest: null, recent: [] },
    molecullageData: { available: false, sourcesCount: 231, domainsCount: 8, frozen: null, sources: [] },
    gatewayConfig: { available: false, cammutRecall: false, anthropicPromptCaching: false, defaultReasoningEffort: 'none' },
    localPlugins: { plugins: [], preflights: [] },
    molecullageLauncherAvailable: false,
    memoryQuery: '',
    memoryResults: [],
    memoryError: null,
    molecullageQuery: '',
    molecullageMatches: [],
    lastProbeAtMs: 0,
  };

  function filterMolecullageItems(query = '') {
    const q = String(query || '').trim().toLowerCase();
    const all = liveState.molecullageData.sources || [];
    const filtered = !q
      ? all
      : all.filter((s) => `${s.id} ${s.name} ${s.kind} ${s.section} ${s.licenceClass} ${s.use}`.toLowerCase().includes(q));
    return filtered.slice(0, 10);
  }

  function syncDiskState() {
    liveState.ledger = readHohLedgerSafe(path.join(arcHome, 'hoh', 'ledger.jsonl'));
    liveState.molecullageData = readLocalMolecullageSafe(molecullageRoot);
    liveState.gatewayConfig = readGatewayConfigSafe(arcHome);
    liveState.localPlugins = readLocalPluginsSafe(arcHome);
    liveState.molecullageLauncherAvailable = fs.existsSync(path.join(arcHome, 'molecullage-mcp-launcher.mjs'));
    liveState.molecullageMatches = filterMolecullageItems(liveState.molecullageQuery);
  }

  syncDiskState();

  async function refreshLive(force = false) {
    syncDiskState();
    if (!liveEnabled) return liveState;
    const tNow = nowFn();
    if (!force && liveState.lastProbeAtMs && Math.abs(tNow - liveState.lastProbeAtMs) < 2000) {
      return liveState;
    }
    liveState.lastProbeAtMs = tNow;
    liveState.gateway = await probeGatewayHealth(gatewayHost, fetchImpl, 1200);
    return liveState;
  }

  let memorySearchSeq = 0;

  async function searchMemory(query = '', searchOpts = {}) {
    const seq = ++memorySearchSeq;
    const q = String(query || '').trim();
    if (!q) {
      liveState.memoryQuery = '';
      liveState.memoryResults = [];
      liveState.memoryError = 'Enter a query to search shared memory';
      return { ok: false, query: '', items: [], error: liveState.memoryError };
    }
    liveState.memoryQuery = q;
    if (!liveEnabled) {
      liveState.memoryError = 'Live gateway probing is turned off';
      return { ok: false, query: q, items: [], error: liveState.memoryError };
    }
    const res = await recallCammutMemory(gatewayHost, q, searchOpts, fetchImpl);
    if (seq !== memorySearchSeq) {
      return { ok: res.ok, query: q, items: res.items || [], error: res.error || null, stale: true };
    }
    liveState.memoryResults = res.items || [];
    liveState.memoryError = res.error || null;
    pushTimeline({
      atMs: nowFn(),
      kind: 'memory-recall',
      summary: `Recalled ${liveState.memoryResults.length} shared memory notes for "${q.slice(0, 48)}"`,
    });
    return { ok: res.ok, query: q, items: liveState.memoryResults, error: liveState.memoryError };
  }

  function searchMolecullage(query = '') {
    syncDiskState();
    liveState.molecullageQuery = String(query || '').trim();
    liveState.molecullageMatches = filterMolecullageItems(liveState.molecullageQuery);
    return {
      ok: true,
      query: liveState.molecullageQuery,
      total: liveState.molecullageData.sourcesCount,
      items: liveState.molecullageMatches,
    };
  }

  function connectorDetails() {
    const activeGrants = listActiveGrants();
    const hohEvents = (liveState.ledger.recent || []).slice(-4).map((ev) => ({
      id: `hoh-${ev.seq ?? ev.ts ?? 'x'}`,
      kind: `ledger:${ev.type}`,
      summary: `${ev.caller}: ${ev.goal}`,
      atMs: ev.ts ? Date.parse(ev.ts) || nowFn() : nowFn(),
    }));
    const sessionEvents = timeline.slice(-6).map((ev) => ({
      id: ev.id,
      kind: ev.kind,
      summary: ev.summary,
      atMs: ev.atMs,
    }));
    const srvStatus = liveState.gateway.reachable
      ? `online, ${liveState.gateway.routes.length} routes, cammut ${liveState.gateway.cammut ? 'on' : 'off'}`
      : `local config (${liveState.gateway.status})`;
    const studioStatus = liveState.molecullageData.available
      ? `ready (${liveState.molecullageData.sourcesCount} sources on disk)`
      : 'ready';
    const keyStatus = liveState.gatewayConfig.available
      ? `cammutRecall ${liveState.gatewayConfig.cammutRecall ? 'on' : 'off'}, promptCaching ${liveState.gatewayConfig.anthropicPromptCaching ? 'on' : 'off'}`
      : 'not configured';
    const apps = [
      { id: 'molecullage', label: 'Molecullage figure and structure pack', scopes: ['read', 'render'], grants: activeGrants.filter((g) => g.appId.startsWith('molecullage')).length },
      { id: 'inspect', label: 'Scoped archive inspector', scopes: ['read', 'verify'], grants: activeGrants.filter((g) => g.appId.startsWith('inspect')).length },
    ];
    if (liveState.localPlugins.plugins.length > 0) {
      apps.push({
        id: 'local-plugins',
        label: `Synced local plugins (${liveState.localPlugins.plugins.length})`,
        scopes: liveState.localPlugins.plugins.slice(0, 6),
        grants: activeGrants.filter((g) => g.appId.startsWith('local-plugins')).length,
      });
    }
    return {
      Servers: [
        { id: 'srv-cammut', label: 'Loopback Cammut gateway', endpoint: gatewayHost, status: srvStatus },
        { id: 'srv-studio', label: 'Molecullage studio server', endpoint: liveState.molecullageLauncherAvailable ? '~/.arc/molecullage-mcp-launcher.mjs' : 'stdio local', status: studioStatus },
      ],
      Keys: [
        { id: 'key-cammut', label: 'Gateway and memory settings', ref: '~/.arc/gateway-config.json', status: keyStatus },
        { id: 'key-signing', label: 'Release bundle public key', ref: 'cred://arc-native/release-verify', status: 'pinned' },
      ],
      Apps: apps,
      Audit: [...sessionEvents, ...hohEvents].slice(-8),
    };
  }

  function snapshot() {
    return {
      ok: true,
      head: head(),
      tree: { ok: true, branches: branches.map((b) => ({ ...b })) },
      claims: { ok: true, items: claims.map((c) => ({ ...c })) },
      evidence: { ok: true, items: evidence.map((e) => ({ ...e })) },
      timeline: { ok: true, events: timeline.map((e) => ({ ...e })) },
      decisions: { ok: true, items: decisions.map((d) => ({ ...d })) },
      connectorsDetail: connectorDetails(),
      liveLedger: {
        available: liveState.ledger.available,
        total: liveState.ledger.total,
        latest: liveState.ledger.latest,
        recent: liveState.ledger.recent,
      },
      release: {
        ok: true,
        verdict: 'accepted',
        candidateHash: '4fcea07',
        nestedBoxes: 0,
        proseOk: detectFormulaicProse(proseText).ok,
      },
      memory: {
        ok: true,
        gateway: gatewayHost,
        reachable: liveState.gateway.reachable,
        routes: liveState.gateway.routes,
        cammut: liveState.gateway.cammut,
        upstreamCount: liveState.gateway.upstreamCount,
        authRequired: false,
        labels: ['type', 'scope', 'status', 'evidence', 'sensitivity'],
        lastQuery: liveState.memoryQuery,
        error: liveState.memoryError,
        results: liveState.memoryResults,
      },
      molecullage: {
        ok: true,
        sources: liveState.molecullageData.sourcesCount,
        domains: liveState.molecullageData.domainsCount,
        nestedBoxes: 0,
        available: liveState.molecullageData.available,
        frozen: liveState.molecullageData.frozen,
        query: liveState.molecullageQuery,
        items: liveState.molecullageMatches,
        pins: molecullagePins.map((p) => ({ ...p })),
      },
      notes: {
        ok: true,
        items: notes.slice(-50).map((n) => ({ ...n })),
      },
      verdicts: { ...verdicts },
      prose: {
        ok: true,
        text: proseText,
        report: detectFormulaicProse(proseText),
      },
      consents: listActiveGrants(),
    };
  }

  return {
    head,
    tree: () => ({ ok: true, branches: branches.map((b) => ({ ...b })) }),
    timeline: () => ({ ok: true, events: timeline.map((e) => ({ ...e })) }),
    decisions: () => ({ ok: true, items: decisions.map((d) => ({ ...d })) }),
    selectWorkspace,
    selectResearchView,
    selectConnector,
    toggleSettings,
    setOperatorSwitch,
    recordDecision,
    addNote,
    annotateVerdict,
    toggleMolecullagePin,
    applyConsent,
    listActiveGrants,
    updateProseDraft,
    rewriteProseDraft,
    refreshLive,
    searchMemory,
    searchMolecullage,
    snapshot,
  };
}

// extra.updater: the updater of updater.js. Update routes: state (read) and action (POST only, same-origin or loopback pages only).
const LOOPBACK_ORIGIN = /^(?:127\.0\.0\.1|localhost|\[::1\])$/;
// The desktop window loads arc-app://app and its requests arrive as http://arc.internal/... with Origin "null" and a loopback Host header
// (seen in the live test). A web page on a loopback address is local too.
const isLocalPage = (u) => (u.protocol === 'http:' || u.protocol === 'https:' ? LOOPBACK_ORIGIN.test(u.hostname) || u.hostname === 'arc.internal' : u.protocol === 'arc-app:' && u.hostname === 'app');
export async function serveConsoleRoute(reqOrPath, maybeBody = {}, store = createResearchSessionStore(), extra = {}) {
  const updater = extra && extra.updater;
  let routePath = '';
  let method = 'POST', origin = null, pageUrl = null, hostHeader = null, jsonBody = true;
  let payload = maybeBody || {};
  if (typeof reqOrPath === 'string') {
    routePath = reqOrPath;
  } else if (reqOrPath && typeof reqOrPath.url === 'string') {
    const u = new URL(reqOrPath.url, 'http://127.0.0.1');
    routePath = u.pathname;
    method = String(reqOrPath.method || 'GET').toUpperCase();
    pageUrl = u;
    const hdr = (k) => (reqOrPath.headers && typeof reqOrPath.headers.get === 'function' ? reqOrPath.headers.get(k) : null);
    origin = hdr('origin');
    hostHeader = hdr('host');
    jsonBody = /^application\/json(?:;|$)/i.test(hdr('content-type') || '');
    if (reqOrPath.method === 'POST' && typeof reqOrPath.text === 'function') {
      const raw = await reqOrPath.text();
      if (raw && raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
          return { ok: false, status: 400, error: 'Invalid JSON body' };
        }
      }
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {};

  const clean = routePath.replace(/^\/+/, '');
  if (clean === 'api/arc-core/session/head') return store.head();
  if (clean === 'api/arc-core/session/timeline') return store.timeline();
  if (clean === 'api/arc-core/session/tree') return store.tree();
  if (clean === 'api/arc-core/session/decisions') {
    if (payload && payload.action && payload.branchId) return store.recordDecision(payload);
    return store.decisions();
  }
  if (clean === 'api/arc-core/console/state') {
    if (typeof store.refreshLive === 'function') await store.refreshLive(false);
    const snap = store.snapshot();
    if (updater) { const u = updater.getState(); snap.update = { available: u.available && u.installable, latest: u.latest, phase: u.phase, restartNeeded: u.restartNeeded }; }
    return snap;
  }
  if (clean === 'api/arc-core/update/state') {
    if (!updater) return { ok: false, error: 'Updates are not available in this build.' };
    return { ok: true, ...updater.getState() };
  }
  if (clean === 'api/arc-core/update/action') {
    if (!updater) return { ok: false, error: 'Updates are not available in this build.' };
    if (method !== 'POST') return { ok: false, status: 405, error: 'Use POST.' };
    // Three guards against another web page driving an update:
    // 1. a JSON content type, which a cross-site form cannot send without the browser asking this server first;
    // 2. a local address: the Host header of a rebound name (evil.example resolving to 127.0.0.1) is not loopback;
    // 3. a local Origin when the browser names one ("null" is what the desktop window sends).
    if (typeof reqOrPath !== 'string') {
      if (!jsonBody) return { ok: false, status: 415, error: 'Send update actions as application/json.' };
      const hostName = hostHeader ? hostHeader.replace(/:\d+$/, '') : null;
      if (hostName ? !LOOPBACK_ORIGIN.test(hostName) : !pageUrl || !isLocalPage(pageUrl)) return { ok: false, status: 403, error: 'Update settings change only from this computer.' };
      if (origin && origin !== 'null') {
        let o = null;
        try { o = new URL(origin); } catch { /* refused below */ }
        if (!o || !isLocalPage(o)) return { ok: false, status: 403, error: 'This page may not change update settings.' };
      }
    }
    if (payload.kind === 'check') return { ok: true, ...(await updater.check()) };
    if (payload.kind === 'mode') {
      try { return { ok: true, ...updater.setMode(payload.mode) }; } catch (err) { return { ok: false, error: String(err.message || err) }; }
    }
    if (payload.kind === 'install') {
      const version = typeof payload.version === 'string' && /^\d+\.\d+\.\d+$/.test(payload.version) ? payload.version : undefined;
      if (updater.getState().busy) return { ok: false, error: 'An update is already running.' };
      const run = updater.install({ version });
      if (payload.wait === true) { const r = await run; return { ...r, state: updater.getState() }; }
      run.catch(() => {}); // progress comes through update/state
      return { ok: true, started: true, state: updater.getState() };
    }
    if (payload.kind === 'rollback') { const r = await updater.rollback(); return { ...r, state: updater.getState() }; }
    return { ok: false, error: `Unknown update action: ${String(payload.kind || '')}` };
  }
  if (clean === 'api/arc-core/console/action') {
    if (payload.kind === 'workspace') return store.selectWorkspace(payload.workspace);
    if (payload.kind === 'research-view') return store.selectResearchView(payload.view);
    if (payload.kind === 'connector') return store.selectConnector(payload.connector);
    if (payload.kind === 'settings') return store.toggleSettings(payload.open);
    if (payload.kind === 'decision') return store.recordDecision(payload);
    if (payload.kind === 'note' || payload.kind === 'comment') return store.addNote(payload);
    if (payload.kind === 'verdict') return store.annotateVerdict(payload);
    if (payload.kind === 'molecullage-pin') return store.toggleMolecullagePin(payload);
    if (payload.kind === 'consent') return store.applyConsent(payload);
    if (payload.kind === 'prose') return store.updateProseDraft(payload.text);
    if (payload.kind === 'prose-rewrite') return store.rewriteProseDraft(typeof payload.text === 'string' ? payload.text : undefined);
    if (payload.kind === 'operator-switch') return store.setOperatorSwitch(payload.rungId, payload.enabled);
    if (payload.kind === 'memory-search' && typeof store.searchMemory === 'function') {
      return store.searchMemory(payload.query, {
        ...(Number.isInteger(payload.limit) ? { limit: payload.limit } : {}),
        ...(Array.isArray(payload.tags) ? { tags: payload.tags.slice(0, 10) } : {}),
      });
    }
    if (payload.kind === 'molecullage-search' && typeof store.searchMolecullage === 'function') return store.searchMolecullage(payload.query);
    if (payload.kind === 'refresh' && typeof store.refreshLive === 'function') {
      await store.refreshLive(true);
      return store.snapshot();
    }
    return { ok: false, error: `Unknown console action kind: ${String(payload.kind || '')}` };
  }
  return { ok: false, error: `Unknown console route: ${clean}` };
}

export function registerConsoleRoutes(ctx, store = createResearchSessionStore(), extra = {}) {
  if (!ctx || typeof ctx.inject !== 'function') return [];
  const routes = [
    '/api/arc-core/session/head',
    '/api/arc-core/session/timeline',
    '/api/arc-core/session/tree',
    '/api/arc-core/session/decisions',
    '/api/arc-core/console/state',
    '/api/arc-core/console/action',
    '/api/arc-core/update/state',
    '/api/arc-core/update/action',
  ];
  const disposers = [];
  ctx.inject(['connection'], (c) => {
    const conn = typeof c.get === 'function' ? c.get('connection') : c && c.connection;
    const fallbackHost = typeof c.get === 'function' ? c.get() : c;
    const fetchSvc = (conn && conn.fetch) || (fallbackHost && fallbackHost.fetch);
    if (!fetchSvc || typeof fetchSvc.register !== 'function') return;
    for (const p of routes) {
      const mount = () =>
        fetchSvc.register.call(fetchSvc, {
          path: p,
          methods: ['GET', 'POST'],
          requestBody: 'buffered',
          fetch: async (req) => {
            try {
              const body = await serveConsoleRoute(req, {}, store, extra);
              return new Response(JSON.stringify(body), {
                status: typeof body.status === 'number' ? body.status : (body.ok ? 200 : 400),
                headers: {
                  'content-type': 'application/json',
                  'cache-control': 'no-store',
                },
              });
            } catch (err) {
              return new Response(
                JSON.stringify({ ok: false, error: String(err?.message || 'failed').slice(0, 200) }),
                {
                  status: 500,
                  headers: {
                    'content-type': 'application/json',
                    'cache-control': 'no-store',
                  },
                },
              );
            }
          },
        });
      if (typeof c.effect === 'function') {
        c.effect(mount, `arc-core: ${p}`);
      } else {
        const off = mount();
        if (typeof off === 'function') disposers.push(off);
      }
    }
  });
  return disposers;
}
