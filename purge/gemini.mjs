// Gemini on Vertex AI: batch translation with validation and cache. Credentials are read from the user's ADC file, kept in memory only.
import fs from 'node:fs';
import path from 'node:path';

const PROJECT = 'omniverso-511319';
const MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash'];
const ADC = path.join(process.env.APPDATA, 'gcloud', 'application_default_credentials.json');
const PURGE = 'C:/Users/danil/ArcHarnessApp/purge';
const CACHE_FILE = PURGE + '/cache.json';
const USAGE_FILE = PURGE + '/usage.json';

export const CJK_RE = /[\u3000-\u303F\u3400-\u9FFF\uFF00-\uFFEF]/;
export const CJK_G = /[\u3000-\u303F\u3400-\u9FFF\uFF00-\uFFEF]/g;

let token = null; let tokenExp = 0;
async function getToken() {
  if (token && Date.now() < tokenExp - 60000) return token;
  const adc = JSON.parse(fs.readFileSync(ADC, 'utf8'));
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: adc.client_id, client_secret: adc.client_secret, refresh_token: adc.refresh_token });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error('token refresh failed: HTTP ' + r.status);
  const j = await r.json();
  token = j.access_token; tokenExp = Date.now() + (j.expires_in || 3000) * 1000;
  return token;
}

export function loadCache() { try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; } }
export function saveCache(c) { fs.writeFileSync(CACHE_FILE + '.tmp', JSON.stringify(c, null, 0)); fs.renameSync(CACHE_FILE + '.tmp', CACHE_FILE); }
export function loadUsage() { try { return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); } catch { return { calls: 0, promptTokens: 0, outputTokens: 0, byModel: {}, retries: 0 }; } }
export function saveUsage(u) { fs.writeFileSync(USAGE_FILE, JSON.stringify(u, null, 1)); }

const SYSTEM = [
  'You translate Chinese text found in software source files into plain, literal English.',
  'Input is a JSON array of objects {"kind": ..., "text": ...}. Output is a JSON array of strings, same length, same order, one translation per input.',
  'Rules:',
  '1. Translate only the Chinese (and fullwidth punctuation). Keep everything else exactly: code, identifiers, URLs, file names, numbers, English words, markdown syntax, HTML tags, tables, code fences.',
  '2. Keep placeholders exactly as written: ${...}, ${E1}, {name}, {0}, %s, %d, <b>, backticks, escape sequences such as \\n \\t \\" \\\' \\\\ and \\uXXXX. Do not add, drop, merge or reorder escape sequences in a way that changes them.',
  '3. Keep line breaks one-to-one: the output has the same number of lines as the input text, and every line keeps its leading indentation, list markers, table pipes and heading marks.',
  '4. Do not add quotes, code fences or commentary. Do not explain. Never leave Chinese characters or fullwidth punctuation in the output; use ASCII punctuation instead (, . : ; ( ) " \' ! ?).',
  '5. Use plain words. Do not use the middle dot character, em dashes, arrows made of words, or promotional words (robust, seamless, leverage, powerful, cutting-edge). Use a comma, slash or hyphen where the source used a middle dot.',
  '6. kind "comment": a code comment, translate to a short English comment. kind "string": a string literal body from source code (user interface text, log line, error message, or a prompt sent to a model); keep it a single line exactly as the source has it. kind "template": same as string, with ${E1}-style placeholders. kind "md": a block of markdown lines. kind "text": plain text lines. kind "line": one source line of a script or config file; translate only the Chinese parts and keep the rest of the line character for character.',
  '7. Product and tool names stay as they are (DeepSeek, DSH, Aegis, Kimi, Codex, Claude, etc.).',
].join('\n');

function buildBody(items, thinking) {
  return {
    systemInstruction: { role: 'system', parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(items.map((it) => ({ kind: it.kind, text: it.text }))) }] }],
    generationConfig: {
      temperature: 0, maxOutputTokens: 32768, thinkingConfig: thinking,
      responseMimeType: 'application/json',
      responseSchema: { type: 'ARRAY', items: { type: 'STRING' } },
    },
  };
}

async function callOnce(model, items, thinking) {
  const t = await getToken();
  const url = `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/google/models/${model}:generateContent`;
  const r = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + t, 'x-goog-user-project': PROJECT, 'content-type': 'application/json' }, body: JSON.stringify(buildBody(items, thinking)) });
  const txt = await r.text();
  if (!r.ok) { const e = new Error(`HTTP ${r.status} ${txt.slice(0, 300)}`); e.status = r.status; throw e; }
  const j = JSON.parse(txt);
  const um = j.usageMetadata || {};
  const cand = j.candidates && j.candidates[0];
  const out = cand && cand.content && cand.content.parts && cand.content.parts.map((p) => p.text || '').join('');
  return { out, finish: cand && cand.finishReason, um };
}

// items: [{kind, text}] -> array of translated strings (unvalidated). Falls back to the second model on failure.
export async function translateRaw(items, usage) {
  let lastErr;
  // thinkingBudget 0 is honoured by gemini-3.8-flash (verified); "low" level is the fallback when thinking eats the output budget.
  const THINK = [{ thinkingBudget: 0 }, { thinkingLevel: 'low' }];
  for (const model of MODELS) {
    for (const thinking of THINK) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { out, finish, um } = await callOnce(model, items, thinking);
          usage.calls++; usage.promptTokens += um.promptTokenCount || 0; usage.outputTokens += um.candidatesTokenCount || 0; usage.thoughtTokens = (usage.thoughtTokens || 0) + (um.thoughtsTokenCount || 0);
          usage.byModel[model] = (usage.byModel[model] || 0) + 1;
          if (finish && finish !== 'STOP') throw Object.assign(new Error('finishReason ' + finish), { status: 0, thinkingIssue: true });
          const arr = JSON.parse(out);
          if (!Array.isArray(arr) || arr.length !== items.length) throw Object.assign(new Error(`bad array length ${Array.isArray(arr) ? arr.length : typeof arr} vs ${items.length}`), { status: 0 });
          return { arr, model };
        } catch (e) {
          lastErr = e; usage.retries++;
          if (e.status === 429 || e.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1) * (attempt + 1))); continue; }
          if (e.status === 400 || e.status === 403 || e.status === 404) break; // try next thinking variant / model
          if (e.thinkingIssue) break; // truncated: next thinking variant
        }
      }
    }
  }
  throw lastErr;
}

// Protected tokens that must survive translation unchanged (multiset comparison).
const PROT = /\$\{[^}]*\}|\{[A-Za-z0-9_.\-]+\}|%[sdifj]|\\[nrtbfv0"'`\\$]|\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}|`[^`\n]*`|<\/?[A-Za-z][^>]*>|https?:\/\/[A-Za-z0-9\-._~:\/?#\[\]@!$&'()*+,;=%]+|\]\([^)\s]*\)|\$[A-Za-z_][A-Za-z0-9_]*|\$\d+|\$\([^)]*\)/g;
export function protectedTokens(s) { return (s.match(PROT) || []).sort(); }
export function sameMultiset(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }

export function validate(kind, src, out) {
  if (typeof out !== 'string') return 'not a string';
  if (CJK_RE.test(out)) return 'CJK left in output';
  if (/\u00b7/.test(out) && !/\u00b7/.test(src.replace(CJK_G, ''))) return 'middle dot in output';
  const sl = src.split('\n').length, ol = out.split('\n').length;
  if (['md', 'text', 'line', 'string', 'template', 'comment'].includes(kind)) { if (sl !== ol) return `line count ${ol} vs ${sl}`; }
  {
    // Tokens without Chinese must survive exactly. Tokens that hold Chinese (for example `代码` in backticks) may come back translated, same count.
    const st = protectedTokens(src); const plain = st.filter((t) => !CJK_RE.test(t)); const cjkN = st.length - plain.length;
    const ot = protectedTokens(out); const left = [...ot]; let missing = null;
    for (const t of plain) { const i = left.indexOf(t); if (i < 0) { missing = t; break; } left.splice(i, 1); }
    if (missing !== null || left.length > cjkN) {
      return 'protected tokens differ: ' + JSON.stringify(st).slice(0, 200) + ' vs ' + JSON.stringify(ot).slice(0, 200);
    }
  }
  if (out.trim() === '' && src.trim() !== '') return 'empty output';
  return null;
}

// Translate all keys not yet cached. units: Map key -> kind. Batches by size, concurrency 3.
export async function ensureTranslated(units, { log = console.log, maxBatchChars = 7000, maxBatchItems = 40, concurrency = 3 } = {}) {
  const cache = loadCache(); const usage = loadUsage();
  const todo = [...units.entries()].filter(([k]) => !(k in cache));
  log(`to translate: ${todo.length} unique texts (${units.size - todo.length} cached)`);
  todo.sort((a, b) => a[0].length - b[0].length);
  const batches = []; let cur = []; let chars = 0;
  for (const [text, kind] of todo) {
    if (cur.length && (chars + text.length > maxBatchChars || cur.length >= maxBatchItems)) { batches.push(cur); cur = []; chars = 0; }
    cur.push({ text, kind }); chars += text.length;
  }
  if (cur.length) batches.push(cur);
  const failed = [];
  let idx = 0; let done = 0;
  async function worker() {
    while (idx < batches.length) {
      if (usage.promptTokens > 2800000) { log('token cap reached, stopping'); idx = batches.length; break; }
      const b = batches[idx++];
      let pending = b; let tries = 0;
      while (pending.length && tries < 3) {
        tries++;
        let res;
        try { res = await translateRaw(pending, usage); } catch (e) { log('batch error: ' + String(e.message).slice(0, 200)); if (pending.length > 1 && tries < 3) { const h = Math.ceil(pending.length / 2); batches.push(pending.slice(h)); pending = pending.slice(0, h); continue; } break; }
        const bad = [];
        pending.forEach((it, i) => {
          const o = res.arr[i]; const err = validate(it.kind, it.text, o);
          if (err) bad.push({ it, err }); else cache[it.text] = o;
        });
        if (bad.length) log(`  ${bad.length} invalid in batch (try ${tries}): ` + bad.slice(0, 2).map((x) => x.err.slice(0, 80)).join(' | '));
        pending = bad.map((x) => x.it);
      }
      for (const it of pending) failed.push(it);
      done += b.length;
      saveCache(cache); saveUsage(usage);
      log(`progress: ${Object.keys(cache).length} cached, batches left ${batches.length - idx}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  saveCache(cache); saveUsage(usage);
  return { failed, usage };
}
