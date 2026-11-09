// arc-core console & loops (2026-11-09): Unified C2 console model (4 workspaces, 4 connectors,
// 5 seats, 3-pane Research session, 30-day consent grants, Prose detector) and 7 proposal-only
// update loops with ~/.arc state preservation (Slices U1, U2, Phase 1b.2, Phase 4 N7a-N7c).

export const WORKSPACES = Object.freeze(['Research', 'Memory', 'Molecullage', 'Prose']);
export const CONNECTORS = Object.freeze(['Servers', 'Keys', 'Apps', 'Audit']);
export const SEATS = Object.freeze(['Planner', 'Reviewer', 'Falsifier', 'Vision', 'Prose']);
export const RESEARCH_PANES = Object.freeze(['Map', 'Claims', 'Evidence']);
export const RESEARCH_VIEWS = Object.freeze(['Map', 'Claims', 'Evidence', 'Release']);

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
    activeWorkspace: 'Research',
    activeResearchView: 'Map',
  };
}
