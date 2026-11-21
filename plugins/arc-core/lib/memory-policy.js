// arc-core memory-policy (2026-11-09): 5-label note policy, R007 secret redaction,
// write-time near-twin dedupe with supersedes links, read-time active filtering,
// toggleable rules, and Cammut fail-open circuit breaker (Slices M1, M2, N3a, N3b).
// S051: optional file persistence (persistFile) and createEmbeddedMemoryServer, the built-in store behind the Hindsight tool names.
import fs from 'node:fs';
import path from 'node:path';

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
  const persistFile = typeof opts.persistFile === 'string' && opts.persistFile ? opts.persistFile : '';
  // a file that exists but does not parse is never overwritten: the store then works in memory only
  let persistBlocked = false;
  if (persistFile && fs.existsSync(persistFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(persistFile, 'utf8'));
      const okNote = (n) => n && typeof n.id === 'string' && typeof n.text === 'string' && n.labels && typeof n.labels === 'object' && Array.isArray(n.tags);
      const okRule = (r) => r && typeof r.id === 'string' && typeof r.text === 'string';
      if (!Array.isArray(saved?.notes) || !Array.isArray(saved?.rules) || !saved.notes.every(okNote) || !saved.rules.every(okRule)) throw new Error('wrong shape');
      for (const n of saved.notes) notes.push(n);
      for (const r of saved.rules) rules.set(r.id, r);
    } catch {
      persistBlocked = true;
    }
  }
  // Returns false when the store has a file and the file was not written: the caller can then say so.
  // A store without a file lives in memory by design, so there is nothing to miss and the answer is true.
  function save() {
    if (!persistFile) return true;
    if (persistBlocked) return false;
    try {
      fs.mkdirSync(path.dirname(persistFile), { recursive: true });
      const tmp = `${persistFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, notes, rules: [...rules.values()] }), { mode: 0o600 });
      fs.renameSync(tmp, persistFile);
      return true;
    } catch {
      return false; // a failed save must not lose the note in memory
    }
  }
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
    const saved = save();

    return { ok: true, id: entry.id, note: structuredClone(entry), supersededId, saved };
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
    save();
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

const clampInt = (v, lo, hi, dflt) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
const noteView = (n) => ({ id: n.id, text: n.text, type: n.labels.type, tags: n.tags, created_at: n.createdAt });

// The built-in store behind the Hindsight tool names: retain, recall, list_memories and list_tags. Written from the public
// tool descriptions only. Every other tool answers that the built-in store does not have it.
export function createEmbeddedMemoryServer(store) {
  async function callTool(tool, args = {}) {
    if (tool === 'hindsight/retain') {
      const r = store.retainNote({ text: String(args.content || ''), tags: Array.isArray(args.tags) ? args.tags.map(String).slice(0, 20) : [] });
      if (!r.ok) return { ok: false, error: r.error };
      // the note is in memory, but the notes file was not written: say so, never report a plain success
      if (r.saved === false) return { ok: false, error: 'The notes file could not be written. The note stays only until the app closes.' };
      return { ok: true, data: { id: r.id, supersededId: r.supersededId } };
    }
    if (tool === 'hindsight/recall') {
      if (typeof args.query !== 'string' || !args.query.trim()) return { ok: false, error: 'A query is required' };
      const tags = Array.isArray(args.tags) ? args.tags : [];
      const items = store.recallNotes({ query: args.query }).filter((n) => tags.length === 0 || tags.some((t) => n.tags.includes(t)));
      return { ok: true, data: { results: items.slice(0, clampInt(args.limit, 1, 50, 20)).map(noteView) } };
    }
    if (tool === 'hindsight/list_memories') {
      const tags = Array.isArray(args.tags) ? args.tags : [];
      const all = store.recallNotes({ query: typeof args.q === 'string' ? args.q : '' }).filter((n) => tags.length === 0 || tags.some((t) => n.tags.includes(t)));
      const offset = clampInt(args.offset, 0, 1e6, 0), limit = clampInt(args.limit, 0, 100, 100);
      return { ok: true, data: { items: all.slice(offset, offset + limit).map(noteView), total: all.length } };
    }
    if (tool === 'hindsight/list_tags') {
      const counts = new Map();
      for (const n of store.recallNotes({})) for (const t of n.tags) counts.set(t, (counts.get(t) || 0) + 1);
      const q = typeof args.q === 'string' ? args.q.replace(/\*$/, '') : '';
      const items = [...counts].filter(([t]) => !q || t.startsWith(q)).map(([tag, count]) => ({ tag, count }));
      const offset = clampInt(args.offset, 0, 1e6, 0), limit = clampInt(args.limit, 0, 100, 100);
      return { ok: true, data: { items: items.slice(offset, offset + limit), total: items.length } };
    }
    return { ok: false, error: `The built-in store has no ${String(tool)} tool` };
  }
  return { callTool, tools: ['hindsight/retain', 'hindsight/recall', 'hindsight/list_memories', 'hindsight/list_tags'] };
}
