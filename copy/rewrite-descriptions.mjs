// Description pass (2026-11-09): rewrites the long, machine-translated English of three plugin pages with Gemini 3.8 Flash
// on Vertex AI, then writes exact replacement rules for apply-copy.mjs.
//
//   node copy/rewrite-descriptions.mjs --extract   list the candidate strings, call nothing
//   node copy/rewrite-descriptions.mjs             rewrite with Gemini (answers are cached), validate, write copy-descriptions.json
//
// Pages: Project workbench (arc-better-sidebar), Skill library (arc-skills-manager), Conversation import (arc-chat-import).
// Credentials: the Google login saved by `gcloud auth application-default login`. The token stays in memory.
// Project and location come from ~/.arc/vertex.json (the arc-vertex plugin settings).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.ARC_HOME || path.join(os.homedir(), '.arc');
const WORK = path.join(HERE, '_work');
const MODEL = 'gemini-3.8-flash';
const SOURCE_ROOT = path.join(HOME, 'profiles', 'desktop', 'node_modules');
const FILES = [
  { file: 'arc-better-sidebar/lib/client.js', page: 'Project workbench' },
  { file: '@michengai/arc-skills-manager/lib/client.js', page: 'Skill library' },
  { file: 'arc-chat-import/lib/client.js', page: 'Conversation import' },
];
const MIN_LEN = 40;

// ---- candidates ------------------------------------------------------------------------------
/** key: "value" pairs of a dictionary whose value is a long English sentence. */
export function candidates(text) {
  const out = new Map(); // decoded value -> { key, raw }
  const re = /["']?([A-Za-z][\w.\-]{1,70})["']?\s*:\s*"((?:[^"\\\n]|\\.){20,600})"/g;
  for (const m of text.matchAll(re)) {
    let value;
    try { value = JSON.parse('"' + m[2] + '"'); } catch { continue; }
    // a literal that is one piece of a concatenation ("a" + b) is not a whole string
    if (/^\s*\+/.test(text.slice(m.index + m[0].length, m.index + m[0].length + 8))) continue;
    if (value.length < MIN_LEN || !/ /.test(value)) continue;
    if (!/^[A-Z{"'(\u201c]/.test(value)) continue;            // a sentence or label, not code
    if (/[\u3000-\u9fff\uff00-\uffef]/.test(value)) continue;  // Chinese text
    if (/[<>]|=>|https?:\/\/|\.(js|css|json)\b|function\s*\(/.test(value)) continue;
    if (!out.has(value)) out.set(value, { key: m[1], raw: m[2] });
  }
  return out;
}

if (process.argv.includes('--extract')) {
  for (const { file, page } of FILES) {
    const c = candidates(fs.readFileSync(path.join(SOURCE_ROOT, file), 'utf8'));
    console.log(`## ${page}: ${c.size} strings`);
    for (const [v, { key }] of [...c].slice(0, 12)) console.log(`  ${key}: ${v.slice(0, 110)}`);
  }
  process.exit(0);
}

// ---- Gemini on Vertex AI ---------------------------------------------------------------------
const GCLOUD = process.env.GCLOUD || path.join(process.env.LOCALAPPDATA || '', 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd');
const vertex = JSON.parse(fs.readFileSync(path.join(HOME, 'vertex.json'), 'utf8'));
let token = '';
const getToken = () => (token = execFileSync(`"${GCLOUD}"`, ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8', shell: true }).trim());

const STYLE = `You edit the interface text of Arc Harness, a lean desktop harness for AI coding agents.
The input strings are descriptions, hints and messages in settings pages. Many were machine-translated from Chinese and read badly.
Rewrite each string so it reads like native English product copy.
Rules:
- Keep the exact meaning. Do not add facts, defaults or promises that the string does not state. Do not drop a condition or a default ("on by default", "off by default").
- Plain, short, active sentences. Sentence case. One idea per sentence. End a description with a full stop; do not add a full stop to a short label.
- Keep every placeholder such as {n}, {name}, {path} exactly as written, with the same spelling.
- Keep identifiers exactly: tool names (for example sidebar_open, terminal_create), file names, setting names, code words, URLs, product names (Arc Harness, GitHub, ClawHub, skills.sh, VS Code).
- Say "Arc Harness" for the app. Do not say host, deployment or generation unless the original names a technical host on purpose.
- Use these words: session, skill, plugin, model, workspace, sidebar, background task. Use the interface words Settings, Plugins, Skill library, Project workbench, Conversation import.
- Do not use middle dots, emoji, exclamation marks or the words "please", "simply", "easily", "powerful", "seamless".
- If a string is already clear, natural English, return it unchanged.
- Keep the length close to the original; never more than 120% of it.
Return a JSON array of strings, the same length and order as the input array. Return nothing else.`;

async function rewriteBatch(strings) {
  const uri = `https://aiplatform.googleapis.com/v1/projects/${vertex.project}/locations/${vertex.location || 'global'}/publishers/google/models/${MODEL}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: STYLE }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(strings) }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 16384, responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'STRING' } } },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!token) getToken();
    const r = await fetch(uri, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) { token = ''; continue; }
    if (!r.ok) { if (attempt === 2) throw new Error(`Vertex ${r.status}: ${(await r.text()).slice(0, 300)}`); await new Promise((s) => setTimeout(s, 2000)); continue; }
    const j = await r.json();
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    const arr = JSON.parse(text);
    if (Array.isArray(arr) && arr.length === strings.length && arr.every((x) => typeof x === 'string')) return { arr, version: j.modelVersion };
  }
  throw new Error('Gemini did not return a usable array');
}

// ---- validation ------------------------------------------------------------------------------
const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
const codeWords = (s) => (s.match(/\b[a-z]+(?:_[a-z]+)+\b|\b[\w-]+\.(?:md|json|yaml|yml|mjs|js)\b|`[^`]+`/g) || []).sort().join(',');
export function validate(oldS, newS) {
  if (newS === oldS) return null;
  if (holes(oldS) !== holes(newS)) return 'placeholders changed';
  if (codeWords(oldS) !== codeWords(newS)) return 'identifier changed';
  if (newS.length > oldS.length * 1.25 + 5) return 'too long';
  if (newS.length < oldS.length * 0.45) return 'too short';
  if (/[\u00b7\u2022]|[!]|\b(please|simply|easily|powerful|seamless)\b/i.test(newS) && !/[!]|\b(please|simply|easily|powerful|seamless)\b/i.test(oldS)) return 'banned wording';
  if (/[\u3000-\u9fff]/.test(newS) || /^\s|\s$/.test(newS) || /\n/.test(newS) || newS.length === 0) return 'bad form';
  if (!oldS.includes('...') && newS.includes('...')) return 'three dots instead of an ellipsis';
  return null;
}

// ---- run -------------------------------------------------------------------------------------
fs.mkdirSync(WORK, { recursive: true });
const cachePath = path.join(WORK, 'gemini-cache.json');
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
const rules = [];
const accepted = [];
const report = [];
let version = '';
for (const { file, page } of FILES) {
  const cand = candidates(fs.readFileSync(path.join(SOURCE_ROOT, file), 'utf8'));
  const todo = [...cand.keys()].filter((v) => cache[v] === undefined);
  for (let i = 0; i < todo.length; i += 30) {
    const batch = todo.slice(i, i + 30);
    const { arr, version: v } = await rewriteBatch(batch);
    version = v || version;
    batch.forEach((s, k) => { cache[s] = arr[k]; });
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));
    console.log(`${page}: ${Math.min(i + 30, todo.length)}/${todo.length} sent`);
  }
  let changed = 0, rejected = 0;
  for (const [oldS, { key, raw }] of cand) {
    const newS = cache[oldS];
    const why = validate(oldS, newS);
    if (newS === oldS) continue;
    if (why) { rejected++; report.push({ page, key, old: oldS, new: newS, rejected: why }); continue; }
    accepted.push({ file, page, key, raw, oldS, newS });
  }
  console.log(`${page}: ${cand.size} candidates, ${rejected} rejected by validation`);
}

// ---- independent meaning check: a second call with its own prompt compares each pair ------------
const VERIFY = `You compare two versions of one interface string of a software product.
For each pair {old, new}, decide whether NEW states exactly the same facts, conditions, defaults and limits as OLD.
Wording, punctuation, sentence splits and word order may differ. A fact that is added, dropped or changed makes it a failure.
Examples of failure: "on by default" became "off by default"; a number changed; a condition such as "when idle" disappeared; "irreversible" disappeared; an object changed (files became sessions).
Return a JSON array, the same length and order as the input, with one object per pair: {"same": true|false, "note": "<five words or fewer, empty when same>"}. Return nothing else.`;
async function verifyBatch(pairs) {
  const uri = `https://aiplatform.googleapis.com/v1/projects/${vertex.project}/locations/${vertex.location || 'global'}/publishers/google/models/${MODEL}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: VERIFY }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(pairs) }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 16384, responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'OBJECT', properties: { same: { type: 'BOOLEAN' }, note: { type: 'STRING' } }, required: ['same', 'note'] } } },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!token) getToken();
    const r = await fetch(uri, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) { token = ''; continue; }
    if (!r.ok) { if (attempt === 2) throw new Error(`Vertex ${r.status}: ${(await r.text()).slice(0, 300)}`); await new Promise((s) => setTimeout(s, 2000)); continue; }
    const j = await r.json();
    const arr = JSON.parse(j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '[]');
    if (Array.isArray(arr) && arr.length === pairs.length) return arr;
  }
  throw new Error('Gemini did not return a usable verdict array');
}
const vPath = path.join(WORK, 'verify-cache.json');
const vcache = fs.existsSync(vPath) ? JSON.parse(fs.readFileSync(vPath, 'utf8')) : {};
const vkey = (a) => a.oldS + '\u0000' + a.newS;
const vtodo = accepted.filter((a) => vcache[vkey(a)] === undefined);
for (let i = 0; i < vtodo.length; i += 30) {
  const batch = vtodo.slice(i, i + 30);
  const res = await verifyBatch(batch.map((a) => ({ old: a.oldS, new: a.newS })));
  batch.forEach((a, k) => { vcache[vkey(a)] = res[k]; });
  fs.writeFileSync(vPath, JSON.stringify(vcache, null, 1));
  console.log(`meaning check: ${Math.min(i + 30, vtodo.length)}/${vtodo.length}`);
}
let dropped = 0;
for (const a of accepted) {
  const v = vcache[vkey(a)];
  if (v && v.same === false) { dropped++; report.push({ page: a.page, key: a.key, old: a.oldS, new: a.newS, rejected: 'meaning changed: ' + v.note }); continue; }
  report.push({ page: a.page, key: a.key, old: a.oldS, new: a.newS });
  rules.push({ file: a.file, find: '"' + a.raw + '"', replace: JSON.stringify(a.newS), min: 1 });
}
console.log(`${accepted.length} passed validation, ${dropped} dropped by the meaning check, ${rules.length} kept`);
fs.writeFileSync(path.join(HERE, 'copy-descriptions.json'), JSON.stringify({ version: '2026-11-09', model: `${MODEL} on Vertex AI (${version || 'version not reported'})`, rules }, null, 1));
fs.writeFileSync(path.join(WORK, 'report.json'), JSON.stringify(report, null, 1));
console.log(`wrote ${rules.length} rules to copy/copy-descriptions.json; report in copy/_work/report.json`);
