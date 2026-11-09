// Phase 6 Arc Native slices N3, N3a, N3b, and N7e:
// - Built-in loopback Cammut HTTP gateway strictly bound to 127.0.0.1 (refuses 0.0.0.0 / non-loopback)
// - Constant-time Bearer token auth guard returning HTTP 401 when missing or invalid
// - System credential-store boundary refusing plaintext secret writes in YAML or JSON settings
// - Built-in memory policy (N3b) with toggleable rules (recallBeforeWork, retainAfterDecision, readBack, supersedeStale, rejectSecrets)
// - L5 routing and L6 tool authoring operator switches strictly off (false) by default
import crypto from 'node:crypto';
import http from 'node:http';

const SECRET_VALUE_RE = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{24,})\b|-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/;
const SECRET_KEY_NAME_RE = /(?:api[_-]?key|secret|password|private[_-]?key|access[_-]?token|auth[_-]?token|bearer)/i;

export function assertLoopbackHost(host) {
  const clean = String(host ?? '').trim();
  if (clean !== '127.0.0.1' && clean !== '::1') {
    const err = new Error(`ERR_NON_LOOPBACK_BIND: Cammut host gateway binds only to 127.0.0.1 or ::1 (got "${clean}")`);
    err.code = 'ERR_NON_LOOPBACK_BIND';
    throw err;
  }
  return clean;
}

/**
 * Credential store boundary: keeps secrets inside an isolated vault map (or OS keychain adapter)
 * and refuses writing plaintext keys or YAML secret blocks into settings payloads.
 */
export function createCredentialStoreBoundary(adapter = null) {
  const vault = new Map();

  function setSecret(name, secretValue) {
    const id = String(name || '').trim();
    if (!id || !secretValue) {
      throw new Error('ERR_EMPTY_CREDENTIAL: credential name and value are required');
    }
    if (adapter?.setSecret) {
      adapter.setSecret(id, String(secretValue));
    } else {
      vault.set(id, String(secretValue));
    }
    return `cred://${id}`;
  }

  function getSecret(nameOrRef) {
    const id = String(nameOrRef || '').replace(/^cred:\/\//, '');
    return adapter?.getSecret ? adapter.getSecret(id) : (vault.get(id) ?? null);
  }

  function assertNoPlaintextSecrets(payloadOrText) {
    if (typeof payloadOrText === 'string') {
      if (SECRET_VALUE_RE.test(payloadOrText) || /^\s*(?:api_key|apiKey|token|password|secret)\s*:\s*['"]?[A-Za-z0-9_-]{8,}/m.test(payloadOrText)) {
        const err = new Error('ERR_PLAINTEXT_SECRET_REFUSED: plain YAML or text secret writes are forbidden; use credentialStore');
        err.code = 'ERR_PLAINTEXT_SECRET_REFUSED';
        throw err;
      }
      return true;
    }
    const visit = (obj, trail = '') => {
      if (obj === null || obj === undefined) return;
      if (typeof obj === 'string') {
        if (obj.startsWith('cred://')) return;
        if (SECRET_VALUE_RE.test(obj)) {
          const err = new Error(`ERR_PLAINTEXT_SECRET_REFUSED: secret token value rejected at ${trail || 'root'}`);
          err.code = 'ERR_PLAINTEXT_SECRET_REFUSED';
          throw err;
        }
        return;
      }
      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => visit(item, `${trail}[${idx}]`));
        return;
      }
      if (typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
          const pathKey = trail ? `${trail}.${k}` : k;
          if (SECRET_KEY_NAME_RE.test(k) && typeof v === 'string' && v.length > 0 && !v.startsWith('cred://')) {
            const err = new Error(`ERR_PLAINTEXT_SECRET_REFUSED: key "${pathKey}" must use a cred:// reference via credentialStore`);
            err.code = 'ERR_PLAINTEXT_SECRET_REFUSED';
            throw err;
          }
          visit(v, pathKey);
        }
      }
    };
    visit(payloadOrText);
    return true;
  }

  return {
    setSecret,
    getSecret,
    assertNoPlaintextSecrets,
  };
}

function timingSafeMatch(expected, actual) {
  const a = Buffer.from(String(expected), 'utf8');
  const b = Buffer.from(String(actual), 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

export const DEFAULT_MEMORY_POLICY = Object.freeze({
  recallBeforeWork: true,
  retainAfterDecision: true,
  readBackAfterRetain: true,
  supersedeStaleNotes: true,
  rejectSecrets: true,
});

/**
 * N3 / N3b / N7e: Built-in loopback Cammut gateway with Bearer auth, memory policy enforcement,
 * credential-store boundary, and L5/L6 operator switches off by default.
 */
export function createLoopbackCammutGateway(options = {}) {
  const host = assertLoopbackHost(options.host ?? '127.0.0.1');
  const credentialStore = options.credentialStore ?? createCredentialStoreBoundary();
  const initialToken = options.authToken ?? crypto.randomBytes(24).toString('hex');
  credentialStore.setSecret('gateway-bearer-token', initialToken);

  const policy = { ...DEFAULT_MEMORY_POLICY, ...(options.policy ?? {}) };
  const switches = {
    l5Routing: false,
    l6ToolAuthoring: false,
  };
  if (options.switches?.l5Routing === true) switches.l5Routing = true;
  if (options.switches?.l6ToolAuthoring === true) switches.l6ToolAuthoring = true;

  const notes = [];
  const authoredTools = [];
  let nonSecretSettings = { scopes: ['project:arc-science'], upstreamUrl: null };
  let nextId = 1;

  function setOperatorSwitch(name, enabled) {
    if (name !== 'l5Routing' && name !== 'l6ToolAuthoring') {
      throw new Error(`ERR_UNKNOWN_OPERATOR_SWITCH: ${name}`);
    }
    switches[name] = Boolean(enabled);
    return { ...switches };
  }

  function setPolicyRule(rule, enabled) {
    if (!(rule in DEFAULT_MEMORY_POLICY)) {
      throw new Error(`ERR_UNKNOWN_POLICY_RULE: ${rule}`);
    }
    policy[rule] = Boolean(enabled);
    return { ...policy };
  }

  function retainNote({ text, context = '', tags = [], supersedes = null }) {
    const body = String(text ?? '').trim();
    if (!body) {
      return { status: 400, payload: { ok: false, error: 'note text is required' } };
    }
    if (policy.rejectSecrets && SECRET_VALUE_RE.test(`${body}\n${context}`)) {
      return { status: 400, payload: { ok: false, error: 'ERR_SECRET_IN_MEMORY_NOTE' } };
    }
    if (policy.retainAfterDecision) {
      const hasProject = tags.some((t) => /^project:\S+$/.test(t));
      const hasDate = tags.some((t) => /^date:\d{4}-\d{2}-\d{2}$/.test(t));
      const hasSource = tags.some((t) => /^source:\S+$/.test(t));
      if (!hasProject || !hasDate || !hasSource) {
        return {
          status: 400,
          payload: { ok: false, error: 'ERR_MEMORY_TAGS_REQUIRED: project:*, date:YYYY-MM-DD, and source:* tags required' },
        };
      }
    }
    if (policy.supersedeStaleNotes && supersedes) {
      const prev = notes.find((n) => n.id === supersedes);
      if (prev) prev.supersededBy = `note-${nextId}`;
    }
    const note = {
      id: `note-${nextId++}`,
      text: body,
      context: String(context),
      tags: [...tags],
      supersededBy: null,
      createdAt: new Date().toISOString(),
    };
    notes.push(note);
    return {
      status: 200,
      payload: {
        ok: true,
        note,
        readBackRequired: policy.readBackAfterRetain,
      },
    };
  }

  function recallNotes({ query = '', tags = [] } = {}) {
    const q = String(query).trim().toLowerCase();
    const active = notes.filter((n) => n.supersededBy === null);
    const matches = active.filter((n) => {
      const tagOk = tags.length === 0 || tags.every((t) => n.tags.includes(t));
      const qOk = !q || n.text.toLowerCase().includes(q) || n.context.toLowerCase().includes(q);
      return tagOk && qOk;
    });
    return { status: 200, payload: { ok: true, count: matches.length, notes: matches, policy: { ...policy } } };
  }

  function authorizeRequest(req) {
    const header = String(req.headers?.authorization ?? '');
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!m) return false;
    const expected = credentialStore.getSecret('gateway-bearer-token');
    return Boolean(expected) && timingSafeMatch(expected, m[1].trim());
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      req.on('data', (chunk) => {
        total += chunk.length;
        if (total > 1_048_576) {
          reject(new Error('ERR_BODY_TOO_LARGE'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

  const server = http.createServer(async (req, res) => {
    if (!authorizeRequest(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    const url = new URL(req.url ?? '/', `http://${host}`);
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, {
          ok: true,
          bind: host,
          switches: { ...switches },
          policy: { ...policy },
          notesCount: notes.filter((n) => n.supersededBy === null).length,
        });
        return;
      }

      const rawBody = req.method === 'POST' ? await readBody(req) : '';
      const contentType = String(req.headers['content-type'] ?? '').toLowerCase();

      if (req.method === 'POST' && url.pathname === '/settings') {
        if (contentType.includes('yaml') || /^\s*\w+\s*:/m.test(rawBody) && !rawBody.trim().startsWith('{')) {
          credentialStore.assertNoPlaintextSecrets(rawBody);
          sendJson(res, 400, { ok: false, error: 'ERR_YAML_SETTINGS_DISABLED: use JSON settings with cred:// references' });
          return;
        }
        const parsed = rawBody ? JSON.parse(rawBody) : {};
        credentialStore.assertNoPlaintextSecrets(parsed);
        nonSecretSettings = { ...nonSecretSettings, ...parsed };
        sendJson(res, 200, { ok: true, settings: nonSecretSettings });
        return;
      }

      const body = rawBody ? JSON.parse(rawBody) : {};

      if (req.method === 'POST' && url.pathname === '/hindsight/retain') {
        const out = retainNote(body);
        sendJson(res, out.status, out.payload);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/hindsight/recall') {
        const out = recallNotes(body);
        sendJson(res, out.status, out.payload);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/l5/route') {
        if (!switches.l5Routing) {
          sendJson(res, 403, { ok: false, error: 'ERR_SWITCH_OFF: L5 routing operator switch is off by default' });
          return;
        }
        const taskKind = String(body.taskKind ?? 'general');
        const route = taskKind === 'figure' ? 'molecullage-worker' : taskKind === 'verify' ? 'independent-checker' : 'primary-worker';
        sendJson(res, 200, { ok: true, rung: 'L5', route, taskKind });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/l6/author') {
        if (!switches.l6ToolAuthoring) {
          sendJson(res, 403, { ok: false, error: 'ERR_SWITCH_OFF: L6 tool authoring operator switch is off by default' });
          return;
        }
        const toolName = String(body.name ?? '').trim();
        if (!/^[a-z][a-z0-9_.-]{2,48}$/.test(toolName)) {
          sendJson(res, 400, { ok: false, error: 'ERR_INVALID_TOOL_NAME' });
          return;
        }
        const spec = { name: toolName, description: String(body.description ?? ''), readOnly: Boolean(body.readOnly ?? true) };
        authoredTools.push(spec);
        sendJson(res, 200, { ok: true, rung: 'L6', tool: spec });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not_found' });
    } catch (err) {
      const status = err?.code === 'ERR_PLAINTEXT_SECRET_REFUSED' ? 400 : 500;
      sendJson(res, status, { ok: false, error: err.message });
    }
  });

  function listen(port = options.port ?? 0) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        const addr = server.address();
        resolve({ host, port: addr.port, baseUrl: `http://${host}:${addr.port}` });
      });
    });
  }

  function close() {
    return new Promise((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
  }

  return {
    host,
    credentialStore,
    getSwitches: () => ({ ...switches }),
    setOperatorSwitch,
    getPolicy: () => ({ ...policy }),
    setPolicyRule,
    retainNote,
    recallNotes,
    listen,
    close,
  };
}
