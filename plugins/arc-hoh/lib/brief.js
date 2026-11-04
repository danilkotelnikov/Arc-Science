// arc-hoh 0.2.0 (2026-10-31): a short brief from Cammut for the system prompt, and one retain call.
// Fail open: any error gives an empty brief. Notes are untrusted data.

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/gi,
];

export function redact(text) {
  let out = String(text);
  for (const p of SECRET_PATTERNS) out = out.replace(p, '[redacted]');
  return out;
}

/** One line per note: no braces (the prompt reads {{name}} groups), no angle brackets (the notes sit in a tag), no secrets, at most maxChars. */
export function formatNotes(results, { max = 6, maxChars = 220 } = {}) {
  if (!Array.isArray(results)) return '';
  const seen = new Set();
  const lines = [];
  for (const r of results) {
    if (!r || typeof r.text !== 'string') continue;
    let t = redact(r.text).replace(/\s+/g, ' ').replace(/\{\{/g, '{ {').replace(/\}\}/g, '} }').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
    if (!t) continue;
    if (t.length > maxChars) t = t.slice(0, maxChars - 3).trimEnd() + '...';
    if (seen.has(t)) continue;
    seen.add(t);
    lines.push('- ' + t);
    if (lines.length >= max) break;
  }
  return lines.join('\n');
}

/** A streamable-http reply is plain JSON or one server-sent event. */
export function parseMcpBody(text) {
  const t = String(text).trim();
  if (t.startsWith('{')) return JSON.parse(t);
  const data = t.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean);
  if (data.length === 0) throw new Error('empty MCP reply');
  return JSON.parse(data[data.length - 1]);
}

async function rpc(base, id, method, params, session, signal) {
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(session ? { 'mcp-session-id': session } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`MCP ${method} answered ${res.status}`);
  return { body: parseMcpBody(text), session: res.headers.get('mcp-session-id') || session };
}

/** Ask Cammut for notes through the local gateway. Returns formatted lines, or '' on any problem. */
export async function fetchBrief({ base = 'http://127.0.0.1:7424/cammut/mcp', query, tags, timeoutMs = 8000, max = 6 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const init = await rpc(base, 1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'arc-hoh', version: '0.1.0' } }, null, ac.signal);
    const call = await rpc(base, 2, 'tools/call', { name: 'cammut_call', arguments: { tool: 'hindsight/recall', arguments: { query, tags, budget: 'low' } } }, init.session, ac.signal);
    const content = call.body && call.body.result && call.body.result.content;
    const first = Array.isArray(content) ? content.find((c) => c && typeof c.text === 'string') : null;
    if (!first) return '';
    const parsed = JSON.parse(first.text);
    return formatNotes(parsed.results, { max });
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/** Write one note to Cammut through the local gateway. Returns true or false; never throws. */
export async function retainNote({ content, context, tags, base = 'http://127.0.0.1:7424/cammut/mcp', timeoutMs = 8000 }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const init = await rpc(base, 1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'arc-hoh', version: '0.2.0' } }, null, ac.signal);
    const call = await rpc(base, 2, 'tools/call', { name: 'cammut_call', arguments: { tool: 'hindsight/retain', arguments: { content: redact(content), context, tags } } }, init.session, ac.signal);
    return !(call.body && call.body.error) && !(call.body && call.body.result && call.body.result.isError);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
