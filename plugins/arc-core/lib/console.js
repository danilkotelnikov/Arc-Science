// arc-core console & loops (2026-11-09): Unified C2 console model (4 workspaces, 4 connectors,
// 5 seats, 3-pane Research session, Decision map, 30-day consent grants, Prose detector, built-in
// session read routes) and 7 proposal-only update loops with ~/.arc state preservation
// (Slices U1, U2, Phase 1b.2-1b.3, Phase 4.1-4.8 N7a-N7e).

export const WORKSPACES = Object.freeze(['Research', 'Memory', 'Molecullage', 'Prose']);
export const CONNECTORS = Object.freeze(['Servers', 'Keys', 'Apps', 'Audit']);
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

export function detectFormulaicProse(text = '') {
  const findings = [];
  const s = String(text || '');
  for (const re of CONTRAST_PATTERNS) {
    const m = s.match(re);
    if (m) findings.push({ kind: 'contrast-x-not-y', match: m[0] });
  }
  for (const re of FORMULAIC_OPENERS) {
    const m = s.match(re);
    if (m) findings.push({ kind: 'formulaic-phrase', match: m[0] });
  }
  return {
    ok: findings.length === 0,
    findings,
  };
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
    settingsOpen: false,
  };
}

export function createResearchSessionStore(opts = {}) {
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const state = createC2ConsoleState();
  const sessionId = typeof opts.sessionId === 'string' && opts.sessionId.trim() ? opts.sessionId.trim() : 'session-arc-science-01';

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
          text: 'Combined autoencoder and denoiser Adam states occupy 6.094 GiB (7.62% of 80 GiB).',
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
      settingsOpen: state.settingsOpen,
      workspaces: [...WORKSPACES],
      connectors: [...CONNECTORS],
      seats: [...SEATS],
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
    state.settingsOpen = false;
    return { ok: true, activeWorkspace: state.activeWorkspace };
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
    return { ok: true, activeConnector: state.activeConnector };
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
    timeline.push({
      id: `ev-${timeline.length + 1}`,
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
    const entry = {
      branchId: branch.id,
      action,
      note: String(note || '').trim(),
      recordedAtMs: nowFn(),
    };
    decisions.push(entry);
    timeline.push({
      id: `ev-${timeline.length + 1}`,
      atMs: entry.recordedAtMs,
      kind: 'decision',
      summary: `${branch.title}: ${action}`,
    });
    return { ok: true, decision: entry, branch: { ...branch } };
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
      timeline.push({ id: `ev-${timeline.length + 1}`, atMs: nowMs, kind: 'consent-revoke', summary: `Revoked ${key}` });
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
    timeline.push({ id: `ev-${timeline.length + 1}`, atMs: nowMs, kind: 'consent-grant', summary: `${mode} for ${key}` });
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

  function snapshot() {
    return {
      ok: true,
      head: head(),
      tree: { ok: true, branches: branches.map((b) => ({ ...b })) },
      claims: { ok: true, items: claims.map((c) => ({ ...c })) },
      evidence: { ok: true, items: evidence.map((e) => ({ ...e })) },
      timeline: { ok: true, events: timeline.map((e) => ({ ...e })) },
      decisions: { ok: true, items: decisions.map((d) => ({ ...d })) },
      release: {
        ok: true,
        verdict: 'accepted',
        candidateHash: '4fcea07',
        nestedBoxes: 0,
        proseOk: detectFormulaicProse(proseText).ok,
      },
      memory: {
        ok: true,
        gateway: '127.0.0.1:4317',
        authRequired: true,
        labels: ['type', 'scope', 'status', 'evidence', 'sensitivity'],
      },
      molecullage: {
        ok: true,
        sources: 231,
        domains: 8,
        nestedBoxes: 0,
      },
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
    applyConsent,
    listActiveGrants,
    updateProseDraft,
    snapshot,
  };
}

export async function serveConsoleRoute(reqOrPath, maybeBody = {}, store = createResearchSessionStore()) {
  let routePath = '';
  let payload = maybeBody || {};
  if (typeof reqOrPath === 'string') {
    routePath = reqOrPath;
  } else if (reqOrPath && typeof reqOrPath.url === 'string') {
    const u = new URL(reqOrPath.url, 'http://127.0.0.1');
    routePath = u.pathname;
    if (reqOrPath.method === 'POST' && typeof reqOrPath.text === 'function') {
      const raw = await reqOrPath.text();
      payload = raw ? JSON.parse(raw) : {};
    }
  }

  const clean = routePath.replace(/^\/+/, '');
  if (clean === 'api/arc-core/session/head') return store.head();
  if (clean === 'api/arc-core/session/timeline') return store.timeline();
  if (clean === 'api/arc-core/session/tree') return store.tree();
  if (clean === 'api/arc-core/session/decisions') {
    if (payload && payload.action && payload.branchId) return store.recordDecision(payload);
    return store.decisions();
  }
  if (clean === 'api/arc-core/console/state') return store.snapshot();
  if (clean === 'api/arc-core/console/action') {
    if (payload.kind === 'workspace') return store.selectWorkspace(payload.workspace);
    if (payload.kind === 'research-view') return store.selectResearchView(payload.view);
    if (payload.kind === 'connector') return store.selectConnector(payload.connector);
    if (payload.kind === 'settings') return store.toggleSettings(payload.open);
    if (payload.kind === 'decision') return store.recordDecision(payload);
    if (payload.kind === 'consent') return store.applyConsent(payload);
    if (payload.kind === 'prose') return store.updateProseDraft(payload.text);
    if (payload.kind === 'operator-switch') return store.setOperatorSwitch(payload.rungId, payload.enabled);
    return { ok: false, error: `Unknown console action kind: ${String(payload.kind || '')}` };
  }
  return { ok: false, error: `Unknown console route: ${clean}` };
}

export function registerConsoleRoutes(ctx, store = createResearchSessionStore()) {
  if (!ctx || typeof ctx.inject !== 'function') return [];
  const routes = [
    '/api/arc-core/session/head',
    '/api/arc-core/session/timeline',
    '/api/arc-core/session/tree',
    '/api/arc-core/session/decisions',
    '/api/arc-core/console/state',
    '/api/arc-core/console/action',
  ];
  const disposers = [];
  ctx.inject(['fetch'], (inner) => {
    const host = typeof inner.get === 'function' ? inner.get() : inner;
    const fetchSvc = host && host.fetch;
    if (!fetchSvc || typeof fetchSvc.register !== 'function') return;
    for (const p of routes) {
      const off = fetchSvc.register({
        path: p,
        async fetch(req) {
          const body = await serveConsoleRoute(req, {}, store);
          return new Response(JSON.stringify(body), {
            status: body.ok ? 200 : 400,
            headers: { 'content-type': 'application/json' },
          });
        },
      });
      if (typeof off === 'function') disposers.push(off);
    }
  });
  return disposers;
}
