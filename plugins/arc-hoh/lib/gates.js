// arc-hoh 0.2.0 (2026-10-31): deterministic gates for the Harness-of-Harness cycle.
// Pure functions plus a hash-chained ledger. No network.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat, mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
/** The identity of a check: the digest of its whole text, so that a shared prefix or outer spaces change nothing. */
export const checkDigest = (text) => sha256(String(text).trim());
export const clip = (s, n = 600) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + '...' : s);
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** The ledger file. ARC_HOME wins, then a ledger already in ~/.arc, then the ledger of the original data folder (DSH_HOME or ~/.dsh),
 *  so that an upgrade keeps the hash chain and its history. A new install starts in ~/.arc/hoh/ledger.jsonl. */
export function ledgerFile(env = process.env, home = os.homedir()) {
  const inFolder = (dir) => path.join(dir, 'hoh', 'ledger.jsonl');
  if (env.ARC_HOME) return inFolder(env.ARC_HOME);
  const arc = inFolder(path.join(home, '.arc')), old = inFolder(env.DSH_HOME || path.join(home, '.dsh'));
  return !existsSync(arc) && existsSync(old) ? old : arc;
}

/** True when a setting is 0 under its Arc name or its original name: an opt-out made before the upgrade still counts. */
export const optedOut = (name, env = process.env) => env[`ARC_HOH_${name}`] === '0' || env[`DSH_HOH_${name}`] === '0';

/** One candidate id for a set of files: sha256 over the sorted (path, content hash) pairs. */
export async function hashFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('hoh_freeze needs at least one file');
  const sorted = [...new Set(files)].sort();
  const parts = [];
  for (const f of sorted) {
    if (!path.isAbsolute(f)) throw new Error('hoh_freeze needs absolute paths, got: ' + f);
    const st = await stat(f);
    if (!st.isFile()) throw new Error('not a regular file: ' + f);
    if (st.size > MAX_FILE_BYTES) throw new Error('file is larger than 20 MB: ' + f);
    parts.push(f.replace(/\\/g, '/') + '\0' + sha256(await readFile(f)));
  }
  return { candidate: 'sha256:' + sha256(parts.join('\n')), files: sorted.length, paths: sorted };
}

async function readLines(file) {
  try {
    const text = await readFile(file, 'utf8');
    return text.split('\n').filter(Boolean);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
}

// One writer at a time per ledger file inside this process. Two calls that run together would read
// the same last line and fork the chain.
const queues = new Map();
// ponytail: the key keeps the case of the path. ledgerFile() is the one source of this path, so it spells it one way.
function withLock(file, fn) {
  const key = path.resolve(file);
  const run = (queues.get(key) || Promise.resolve()).then(fn, fn);
  queues.set(key, run.then(() => undefined, () => undefined));
  return run;
}

async function appendUnlocked(file, event) {
  const lines = await readLines(file);
  const last = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
  const prev = last ? last.hash : 'genesis';
  const body = { seq: lines.length + 1, ts: new Date().toISOString(), prev, ...event };
  const hash = sha256(prev + '\n' + JSON.stringify(body));
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify({ ...body, hash }) + '\n');
  return { seq: body.seq, hash };
}

/** Append one event. Each line holds the hash of the line before it, so an edit breaks the chain. */
export function appendLedger(file, event) {
  return withLock(file, () => appendUnlocked(file, event));
}

/** Run fn under the ledger lock, so that a read and the append after it are one step. fn gets the append function. */
export const withLedger = (file, fn) => withLock(file, () => fn((event) => appendUnlocked(file, event)));

/** Every ledger row. Call verifyLedger first: a broken line throws here. */
export const ledgerRows = async (file) => (await readLines(file)).map((line) => JSON.parse(line));

/** Walk the chain. Returns { ok, entries, badAt } where badAt is the first broken sequence number. */
export async function verifyLedger(file) {
  const lines = await readLines(file);
  let prev = 'genesis';
  for (let i = 0; i < lines.length; i++) {
    let row;
    try { row = JSON.parse(lines[i]); } catch { return { ok: false, entries: lines.length, badAt: i + 1 }; }
    const { hash, ...body } = row;
    if (row.prev !== prev || sha256(prev + '\n' + JSON.stringify(body)) !== hash) return { ok: false, entries: lines.length, badAt: row.seq || i + 1 };
    prev = hash;
  }
  return { ok: true, entries: lines.length, badAt: 0 };
}

/** The newest event of one type for a goal, or null. */
export async function lastEvent(file, goal, type) {
  const lines = await readLines(file);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const row = JSON.parse(lines[i]);
      if (row.type === type && row.goal === goal) return row;
    } catch { /* a broken line is reported by verifyLedger */ }
  }
  return null;
}
export const lastFreeze = (file, goal) => lastEvent(file, goal, 'freeze');

/** All events of one type for a goal, oldest first. */
export async function goalEvents(file, goal, type) {
  const rows = [];
  for (const line of await readLines(file)) {
    try {
      const row = JSON.parse(line);
      if (row.type === type && row.goal === goal) rows.push(row);
    } catch { /* a broken line is reported by verifyLedger */ }
  }
  return rows;
}

const SEVERITIES = new Set(['blocking', 'major', 'minor']);
const STATUSES = new Set(['open', 'fixed', 'rejected']);
const REQUIREMENT_STATES = new Set(['verified', 'failed', 'unverified', 'blocked']);
export const MAX_CYCLES = 3;

// The gate compares whole hashes. A shortened hash from the trace view stays unequal.
const bareHash = (id) => String(id ?? '').replace(/^sha256:/, '');
const shortHash = (id) => { const h = bareHash(id); return h.length > 12 ? h.slice(0, 12) + '...' : h; };

/**
 * The accept gate. Missing evidence is unmet. A claim that a different agent ran the checks is
 * compared with the agent ids the runtime reports for the two calls (freeze and gate).
 * input: { candidate, cycle, builder, reviewer, checks[{id,command,exit,excerpt,timed_out?}], probes[{id,description,result}],
 *          preservation[{id,ok}], findings[{id,severity,status,reason}], requirements[{id,state}] }
 * context: { freeze, propose, fileCheck: {ok, reason}, caller }
 * Returns { verdict: 'accepted'|'unmet'|'blocked', reasons: string[] }.
 */
export function decideGate(input, context = {}) {
  const { freeze = null, propose = null, fileCheck = null, caller = null } = context;
  const reasons = [];
  let blocked = false;
  const block = (msg) => { blocked = true; reasons.push(msg); };
  const unmet = (msg) => reasons.push(msg);

  if (!propose) unmet('no proposal recorded for this goal: call hoh_propose first (Propose step)');
  if (!freeze) unmet('no freeze recorded for this goal');
  else if (bareHash(input.candidate) !== bareHash(freeze.candidate)) unmet(`the candidate hash differs from the frozen hash: sent ${shortHash(input.candidate)}, frozen ${shortHash(freeze.candidate)}; send the candidate that hoh_freeze returned`);
  else if (!fileCheck || fileCheck.ok !== true) unmet('the files changed after the freeze' + (fileCheck && fileCheck.reason ? ': ' + fileCheck.reason : ''));

  if (!Number.isInteger(input.cycle) || input.cycle < 1) unmet('cycle must be a whole number from 1');
  else if (input.cycle > MAX_CYCLES) block(`cycle ${input.cycle} is past the limit of ${MAX_CYCLES}: stop and ask the user`);

  const checks = Array.isArray(input.checks) ? input.checks : [];
  if (checks.length === 0) unmet('no acceptance checks were reported');
  for (const c of checks) {
    if (!c || typeof c.id !== 'string' || c.id === '') { unmet('a check has no id'); continue; }
    if (c.exit !== 0) unmet(`check ${c.id}: exit code ${c.exit} (needs 0)`);
    if (c.timed_out === true) unmet(`check ${c.id}: timed out`);
    if (typeof c.excerpt !== 'string' || c.excerpt.trim() === '') unmet(`check ${c.id}: no output excerpt`);
    if (typeof c.command !== 'string' || c.command.trim() === '') unmet(`check ${c.id}: no command`);
  }
  // Each proposed check must come back in its own words.
  const reported = new Set(checks.map((c) => (c && typeof c.command === 'string' ? checkDigest(c.command) : null)));
  (propose && Array.isArray(propose.digests) ? propose.digests : []).forEach((digest, i) => {
    if (!reported.has(digest)) unmet(`proposed check was not reported: ${clip(String(propose.checks?.[i] ?? digest), 80)}`);
  });
  // An old proposal kept only the first 300 characters of a long check, so that start is all there is to compare.
  for (const start of propose && Array.isArray(propose.starts) ? propose.starts : []) {
    if (!checks.some((c) => c && typeof c.command === 'string' && c.command.trim().startsWith(start))) unmet(`proposed check was not reported: ${clip(start, 80)}`);
  }

  const probes = Array.isArray(input.probes) ? input.probes : [];
  if (probes.length === 0) unmet('no probes: test the candidate against edge cases and rival options (Probe step)');
  for (const p of probes) {
    if (!p || typeof p.id !== 'string' || p.id === '' || typeof p.description !== 'string' || p.description.trim() === '') unmet('a probe needs an id and a description');
    else if (p.result !== 'pass') unmet(`probe ${p.id}: ${p.result === 'fail' ? 'failed' : 'no result'}`);
  }

  const builder = typeof input.builder === 'string' ? input.builder.trim() : '';
  const reviewer = typeof input.reviewer === 'string' ? input.reviewer.trim() : '';
  if (!builder || !reviewer) unmet('builder and reviewer ids are both needed');
  else if (builder === reviewer) unmet('the builder and the reviewer are the same agent: an author never certifies its own work');
  if (freeze && freeze.caller && caller) {
    if (freeze.caller === caller) unmet('the agent that froze the candidate also asks for acceptance: the reviewer must call the gate');
  } else if (freeze) unmet('the runtime did not report which agent made the freeze or the gate call, so independence cannot be proven');

  const pres = Array.isArray(input.preservation) ? input.preservation : [];
  if (pres.length === 0) unmet('no preservation list: say which earlier behaviour still holds');
  for (const p of pres) if (!p || p.ok !== true) unmet(`preservation ${p && p.id}: not confirmed`);

  for (const f of Array.isArray(input.findings) ? input.findings : []) {
    if (!f || !SEVERITIES.has(f.severity) || !STATUSES.has(f.status)) { unmet(`finding ${f && f.id}: bad severity or status`); continue; }
    if (f.status === 'rejected' && !(typeof f.reason === 'string' && f.reason.trim())) unmet(`finding ${f.id}: a rejected finding needs a reason`);
    if (f.status === 'open' && f.severity === 'blocking') block(`finding ${f.id}: a blocking finding is still open`);
    else if (f.status === 'open' && f.severity === 'major') unmet(`finding ${f.id}: a major finding is still open`);
  }

  const reqs = Array.isArray(input.requirements) ? input.requirements : [];
  if (reqs.length === 0) unmet('no requirements listed: name each requirement and its state');
  for (const r of reqs) {
    if (!r || !REQUIREMENT_STATES.has(r.state)) unmet(`requirement ${r && r.id}: bad state`);
    else if (r.state !== 'verified') unmet(`requirement ${r.id}: ${r.state}`);
  }

  if (reasons.length === 0) return { verdict: 'accepted', reasons: [] };
  return { verdict: blocked ? 'blocked' : 'unmet', reasons };
}
