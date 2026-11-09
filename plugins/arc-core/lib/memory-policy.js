// arc-core memory-policy (2026-11-09): 5-label note policy, R007 secret redaction,
// write-time near-twin dedupe with supersedes links, read-time active filtering,
// toggleable rules, and Cammut fail-open circuit breaker (Slices M1, M2, N3a, N3b).

export const NOTE_LABELS = Object.freeze({
  type: Object.freeze(['fact', 'decision', 'lesson', 'rule', 'artifact']),
  scope: Object.freeze(['project', 'workspace', 'global', 'session']),
  status: Object.freeze(['active', 'superseded', 'retracted', 'draft']),
  evidence: Object.freeze(['measured', 'published', 'simulated', 'architecture', 'target', 'verified']),
  sensitivity: Object.freeze(['public', 'internal', 'restricted']),
});

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bghp_[A-Za-z0-9]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}\b/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function redactSecrets(text) {
  if (typeof text !== 'string') return { clean: '', redacted: false, count: 0 };
  let out = text;
  let count = 0;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, () => {
      count++;
      return '[REDACTED:R007]';
    });
  }
  return { clean: out, redacted: count > 0, count };
}

export function validateNoteLabels(labels = {}) {
  const errors = [];
  if (!labels || typeof labels !== 'object') {
    return { ok: false, errors: ['labels must be an object'] };
  }
  for (const [key, allowed] of Object.entries(NOTE_LABELS)) {
    const val = labels[key];
    if (typeof val !== 'string' || !allowed.includes(val)) {
      errors.push(`label "${key}" must be one of: ${allowed.join(', ')}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function tokenSet(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

export function jaccardSimilarity(a, b) {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) {
    if (sb.has(t)) inter++;
  }
  return inter / (sa.size + sb.size - inter);
}

export function createMemoryPolicyStore(opts = {}) {
  const notes = [];
  const rules = new Map();
  const dedupeThreshold = typeof opts.dedupeThreshold === 'number' ? opts.dedupeThreshold : 0.75;

  function retainNote(input = {}) {
    const rawText = typeof input.text === 'string' ? input.text.trim() : '';
    if (!rawText) return { ok: false, error: 'Note text is required' };

    const red = redactSecrets(rawText);
    if (red.redacted && input.rejectOnSecret !== false) {
      return {
        ok: false,
        rule: 'R007',
        error: 'Refused to store note containing secret material (R007)',
      };
    }

    const labels = {
      type: input.labels?.type ?? 'fact',
      scope: input.labels?.scope ?? 'project',
      status: input.labels?.status ?? 'active',
      evidence: input.labels?.evidence ?? 'verified',
      sensitivity: input.labels?.sensitivity ?? 'internal',
    };
    const labelCheck = validateNoteLabels(labels);
    if (!labelCheck.ok) {
      return { ok: false, error: labelCheck.errors.join('; ') };
    }

    let supersededId = input.supersedes ?? null;
    if (!supersededId) {
      for (const existing of notes) {
        if (
          existing.labels.status === 'active' &&
          existing.labels.type === labels.type &&
          jaccardSimilarity(existing.text, red.clean) >= dedupeThreshold
        ) {
          existing.labels.status = 'superseded';
          supersededId = existing.id;
        }
      }
    } else {
      const target = notes.find((n) => n.id === supersededId);
      if (target) target.labels.status = 'superseded';
    }

    const entry = {
      id: input.id ?? `note-${notes.length + 1}`,
      text: red.clean,
      labels,
      supersedes: supersededId,
      tags: Array.isArray(input.tags) ? [...input.tags] : [],
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    notes.push(entry);

    if (labels.type === 'rule') {
      rules.set(entry.id, { id: entry.id, text: entry.text, enabled: input.enabled !== false });
    }

    return { ok: true, id: entry.id, note: structuredClone(entry), supersededId };
  }

  function recallNotes({ query = '', includeInactive = false, type = '' } = {}) {
    const q = String(query || '').trim().toLowerCase();
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];
    return notes
      .filter((n) => {
        if (!includeInactive && n.labels.status !== 'active') return false;
        if (type && n.labels.type !== type) return false;
        if (n.labels.type === 'rule') {
          const r = rules.get(n.id);
          if (r && !r.enabled && !includeInactive) return false;
        }
        if (terms.length === 0) return true;
        const hay = `${n.text} ${n.tags.join(' ')}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .map((n) => structuredClone(n));
  }

  function toggleMemoryRule(ruleId, enabled) {
    const r = rules.get(ruleId);
    if (!r) return { ok: false, error: `Unknown rule: ${String(ruleId)}` };
    r.enabled = Boolean(enabled);
    return { ok: true, id: r.id, enabled: r.enabled };
  }

  return {
    retainNote,
    recallNotes,
    toggleMemoryRule,
    listAll: () => notes.map((n) => structuredClone(n)),
    listRules: () => [...rules.values()].map((r) => ({ ...r })),
  };
}

export function createCammutClientProfile(opts = {}) {
  const endpoint = opts.endpoint ?? 'http://127.0.0.1:8890/mcp';
  const maxFailures = opts.maxFailures ?? 3;
  const cooldownMs = opts.cooldownMs ?? 30000;
  let consecutiveFailures = 0;
  let openedAt = 0;

  function isOpen(now = Date.now()) {
    if (consecutiveFailures < maxFailures) return false;
    if (now - openedAt >= cooldownMs) return false;
    return true;
  }

  function recordFailure(now = Date.now()) {
    consecutiveFailures++;
    if (consecutiveFailures >= maxFailures) {
      openedAt = now;
    }
    return { circuitOpen: isOpen(now), consecutiveFailures, failOpen: true };
  }

  function recordSuccess() {
    consecutiveFailures = 0;
    openedAt = 0;
    return { circuitOpen: false, consecutiveFailures: 0, failOpen: true };
  }

  return {
    endpoint,
    failOpen: true,
    canCall: (now = Date.now()) => !isOpen(now),
    recordFailure,
    recordSuccess,
    status: (now = Date.now()) => ({
      endpoint,
      circuitOpen: isOpen(now),
      consecutiveFailures,
      failOpen: true,
    }),
  };
}
