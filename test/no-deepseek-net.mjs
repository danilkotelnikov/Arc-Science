// Proves that Arc Harness has no connection to a DeepSeek-run service.
//   node test/no-deepseek-net.mjs                 static census: archive (+ its unpacked files), both profiles, local plugins, installed runtime
//   node test/no-deepseek-net.mjs --live          also start the web server with test/net-trace.cjs, load the page, wait, and read the trace
//   node test/no-deepseek-net.mjs --trace <file>  judge an existing trace file (no server is started)
// Options: --archive <asar>  --install <dir>  --wait <seconds, default 60>  --list (every hit)  --strict (count docs and tests too)  --json <file>
// Exit 0 only when no DeepSeek address is found. Allowed: test/net.allow.json (pi-ai catalog, model names).
// The live part also fails when the trace has no start row (the tracer did not load) or no loopback connect or accept row (it did not see the page load),
// and it removes everything it made (throwaway home, junctions) in a finally block.
// The live part starts a server from the archive under test on a throwaway data home and stops it again (only the processes it started).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openAsar } from '../lib/asar.mjs';
import { quietConfig, removeHome, linkTree, treeHash, treeDiff } from '../lib/testhome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const allow = JSON.parse(fs.readFileSync(path.join(here, 'net.allow.json'), 'utf8'));
const home = os.homedir();
const installDir = opt('--install', path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'DeepSeek Harness'));
const archive = path.resolve(opt('--archive', path.join(root, 'build', 'app.asar')));

// ---------- what counts as a DeepSeek-run address ----------
const HOST = /(?:[a-z0-9][a-z0-9-]*\.)*deepseek(?:svc|cdn)?\.(?:com|ai|cn|net|org|io|dev|app|co)\b/gi;
const REPO = /(?:github\.com|raw\.githubusercontent\.com|api\.github\.com\/repos|ghcr\.io|gitee\.com|huggingface\.co|hf\.co|modelscope\.cn|registry\.npmjs\.org|(?:www\.)?npmjs\.com\/package|unpkg\.com|cdn\.jsdelivr\.net\/(?:npm|gh))\/(?:@|%40)?deepseek-ai\b|deepseek-ai\.github\.io/gi;
const ENV = /\bDEEPSEEK_(?:[A-Z0-9]+_)*BASE_URL\b|\bDSH_PLATFORM_ORIGIN\b/g;
// DeepSeek-run addresses that do not carry the brand in their name (found by review of the archive)
const KNOWN = /\btrtgsjkv6r\.feishu\.cn\b/gi;
const RES = [HOST, REPO, ENV, KNOWN];
const isLocalHost = (h) => /^(127\.0\.0\.1|localhost|::1|\[::1\]|0\.0\.0\.0)$/i.test(h);
const isDeepseekHost = (h) => /(^|\.)deepseek(?:svc|cdn)?\.(?:com|ai|cn|net|org|io|dev|app|co)$/i.test(h) || /(^|\.)deepseek-ai\.github\.io$/i.test(h) || /(^|\.)trtgsjkv6r\.feishu\.cn$/i.test(h);

const TEXT = /\.(?:[cm]?jsx?|tsx?|json|jsonc|ya?ml|html?|css|md|markdown|txt|map|svg|toml|xml|sh|ps1|cmd|bat|ini|cfg|conf)$/i;
const MAX = 8e6;
const allowFile = new RegExp(allow.piAiCatalog.file);
const allowNames = allow.modelNames.map((s) => new RegExp('^(?:' + s + ')$', 'i'));

// docs and tests never run; they are listed but do not fail the check unless --strict
function classOf(rel) {
  const base = rel.split('/').pop();
  if (/\.(?:md|markdown|txt)$/i.test(base) || /(^|\/)(?:CHANGELOG|LICENSE|LICENCE|NOTICE)/i.test(rel) || /(^|\/)(?:tests?|__tests__|docs?|examples?|fixtures?|bench|eval)\//i.test(rel) || /\.(?:test|spec)\.[cm]?[jt]s$|\.d\.[cm]?ts$|\.map$/i.test(base)) return 'docs';
  if (base === 'package.json') return 'meta';
  return 'code';
}
function pkgOf(rel) {
  const i = rel.lastIndexOf('node_modules/');
  if (i < 0) return rel.startsWith('lib/') || rel.startsWith('renderer/') ? '(desktop shell)' : rel.split('/')[0];
  const p = rel.slice(i + 13).split('/');
  return p[0].startsWith('@') ? p[0] + '/' + p[1] : p[0];
}

// cheap byte test first: most files never mention DeepSeek, so they are not decoded
const TOKENS = ['eepseek', 'eepSeek', 'EEPSEEK', 'DSH_PLATFORM_ORIGIN', 'trtgsjkv6r'].map((t) => Buffer.from(t));
const mentions = (buf) => TOKENS.some((t) => buf.includes(t));
function scanText(src, rel, buf, hits) {
  if (!mentions(buf)) return;
  const text = buf.toString('utf8');
  const pkg = pkgOf(rel);
  const cls = classOf(rel);
  for (const re of RES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const match = m[0];
      const allowed = allowFile.test('/' + rel) || allowNames.some((r) => r.test(match));
      const s = Math.max(0, m.index - 45);
      // a hit inside a bundle patch belongs to the plugin row above it
      const row = rel.endsWith('cordis.patch.yml') ? [...text.slice(0, m.index).matchAll(/^ *- id: *(\S+)/gm)].pop()?.[1] ?? '' : '';
      hits.push({ src, file: rel, pkg, row, cls, match, allowed, snippet: text.slice(s, m.index + match.length + 45).replace(/\s+/g, ' ') });
    }
  }
}

function* walk(dir, skip) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (!skip || !skip.test(e.name)) yield* walk(p, skip); } else yield p;
  }
}
function scanDir(src, dir, hits, skip) {
  let n = 0;
  for (const f of walk(dir, skip)) {
    if (!TEXT.test(f)) continue;
    let st; try { st = fs.statSync(f); } catch { continue; }
    if (st.size > MAX) continue;
    n++;
    scanText(src, path.relative(dir, f).replace(/\\/g, '/'), fs.readFileSync(f), hits);
  }
  return n;
}
function scanArchive(file, hits) {
  const a = openAsar(file);
  const unpacked = file + '.unpacked';
  let n = 0;
  for (const f of a.files) {
    if (!TEXT.test(f.path) || f.entry.size > MAX) continue;
    let buf;
    if (f.entry.unpacked) { try { buf = fs.readFileSync(path.join(unpacked, f.path)); } catch { continue; } } else buf = a.read(f);
    n++;
    scanText('archive', f.path, buf, hits);
  }
  a.close();
  return n;
}

// ---------- owners: which plugin id loads the package, and is it on in each profile ----------
function rowsOf(yamlText) {
  // plugin rows sit at indent 0 ("- id:") or indent 4 under "- insert:"; deeper "- id:" lines are model entries
  const rows = []; let cur = null;
  for (const line of yamlText.split(/\r?\n/)) {
    const m = line.match(/^( *)- id: *(\S+)/);
    if (m && m[1].length <= 4) { cur = { id: m[2].replace(/^['"]|['"]$/g, ''), indent: m[1].length }; rows.push(cur); continue; }
    if (!cur) continue;
    const n = line.match(/^( *)name: *['"]?([^'"\s]+)/); if (n && n[1].length === cur.indent + 2 && !cur.name) cur.name = n[2];
    const d = line.match(/^( *)disabled: *(.+?) *$/); if (d && d[1].length === cur.indent + 2) cur.disabled = d[2];
  }
  return rows;
}
function disabledIn(expr, profile) {
  if (expr === undefined) return false;
  if (expr === 'true') return true;
  if (expr === 'false') return false;
  if (/ctx\.get\('profileContext'\)\?\.name !== 'desktop'/.test(expr)) return profile !== 'desktop';
  if (/!ctx\.get\('profileContext'\)/.test(expr)) return false;
  if (/process\.platform === 'win32'/.test(expr)) return true;
  if (/process\.platform !== 'win32'/.test(expr)) return false;
  return null;
}
function loadOwners(a) {
  const owners = { web: new Map(), desktop: new Map(), ids: { web: new Map(), desktop: new Map() } }; // package -> [ "id:on|off" ]; ids: id -> "ON|off|?"
  for (const profile of ['web', 'desktop']) {
    const dir = path.join(home, '.dsh', 'profiles', profile);
    let pj; try { pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { continue; }
    const state = new Map(); // id -> {name, disabled}
    const apply = (rows) => { for (const r of rows) { const s = state.get(r.id) || {}; if (r.name) s.name = r.name; if (r.disabled !== undefined) s.disabled = r.disabled; state.set(r.id, s); } };
    for (const b of pj.dsh?.profile?.bundles || []) {
      let t = null;
      const inArchive = a.byPath.get(`dsh/node_modules/${b}/cordis.patch.yml`);
      if (inArchive) t = a.read(inArchive).toString('utf8');
      else { try { t = fs.readFileSync(path.join(dir, 'node_modules', b, 'cordis.patch.yml'), 'utf8'); } catch { /* none */ } }
      if (t) apply(rowsOf(t));
    }
    try { apply(rowsOf(fs.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8'))); } catch { /* none */ }
    for (const [id, s] of state) {
      if (!s.name) continue;
      const pkg = s.name.startsWith('@') ? s.name.split('/').slice(0, 2).join('/') : s.name.split('/')[0];
      const off = disabledIn(s.disabled, profile);
      const word = off === null ? '?' : off ? 'off' : 'ON';
      const list = owners[profile].get(pkg) || [];
      list.push(`${id}:${word}`);
      owners[profile].set(pkg, list);
      owners.ids[profile].set(id, word);
    }
  }
  return owners;
}

// ---------- live part ----------
function readTrace(file) {
  const rows = [];
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) { if (l.trim()) { try { rows.push(JSON.parse(l)); } catch { /* partial line */ } } }
  return rows;
}
// The live run starts the web profile from the archive under test (--archive), with the installed Electron only as the runtime,
// on a throwaway data home: the profile config files are copied (the MCP clients switched off, no saved theme: lib/testhome.mjs),
// the plugin packages are hard-linked file by file, and the test fails if a real profile file or package file changed. It traces the Node host only; the desktop
// shell and the browser half are not exercised. Whatever the run creates (home, junctions, server) is removed again in the finally block.
async function liveRun(traceFile, waitSec) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const exe = path.join(installDir, 'DeepSeek Harness.exe');
  const cli = path.join(archive, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');
  const unpacked = archive + '.unpacked';
  const realProfile = path.join(home, '.dsh', 'profiles', 'web');
  const hashOf = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  let madeUnpacked = false, testHome = null, child = null, out = null, before = null, nmBefore = null, stoppedAt = null;
  try {
    if (!fs.existsSync(unpacked)) { fs.symlinkSync(path.join(installDir, 'resources', 'app.asar.unpacked'), unpacked, 'junction'); madeUnpacked = true; }
    const sha = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    console.log(`live: tracing the archive ${path.relative(root, archive)} (sha256 ${sha.slice(0, 16)})`);
    const configs = fs.readdirSync(realProfile).filter((f) => f !== 'node_modules' && fs.statSync(path.join(realProfile, f)).isFile());
    before = new Map(configs.map((f) => [f, hashOf(path.join(realProfile, f))]));
    testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-home-'));
    fs.mkdirSync(path.join(testHome, 'profiles', 'web'), { recursive: true });
    for (const f of configs) {
      const from = path.join(realProfile, f), to = path.join(testHome, 'profiles', 'web', f);
      if (f === 'cordis.patch.yml') fs.writeFileSync(to, quietConfig(fs.readFileSync(from, 'utf8'))); else fs.copyFileSync(from, to);
    }
    // the plugin packages: a real tree of hard links (the loader must see the same path layout as in the real app); the real files are hashed before and after
    nmBefore = treeHash(path.join(realProfile, 'node_modules'));
    const nm = linkTree(path.join(realProfile, 'node_modules'), path.join(testHome, 'profiles', 'web', 'node_modules'));
    console.log(`live: plugin packages ${nm.linked} files hard-linked, ${nm.copied} copied, ${nm.skipped} links skipped, ${nm.dirs} folders`);
    fs.rmSync(traceFile, { force: true });
    const log = traceFile + '.server.log';
    out = fs.openSync(log, 'w');
    const tracer = path.join(here, 'net-trace.cjs').replace(/\\/g, '/');
    child = spawn(exe, ['--expose-internals', cli, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'], {
      cwd: installDir, stdio: ['ignore', out, out], windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: testHome, ARC_NET_TRACE: traceFile, NODE_OPTIONS: `--require=${tracer}` },
    });
    let url = null;
    for (let i = 0; i < 90 && !url; i++) { // wait for the printed URL
      await sleep(1000);
      url = fs.readFileSync(log, 'utf8').match(/(http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/)?.[1];
    }
    if (!url) throw new Error('the web server did not print its URL (see ' + log + ')');
    const r1 = await fetch(url, { redirect: 'manual' });
    const cookie = (r1.headers.get('set-cookie') || '').split(';')[0];
    await r1.body?.cancel();
    const r2 = await fetch(new URL(r1.headers.get('location') || '/', url).href, { headers: { cookie } });
    console.log(`live: page loaded (HTTP ${r2.status}); waiting ${waitSec} s for background connections`);
    await r2.arrayBuffer();
    await sleep(waitSec * 1000);
    stoppedAt = Date.now();
  } finally {
    // stop only what this run started: the server process and its own children (never another app window)
    if (child) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    if (out !== null) fs.closeSync(out);
    await sleep(1500);
    if (testHome && !(await removeHome(testHome))) console.log(`WARN the throwaway home ${testHome} could not be removed (a process still holds it); remove it by hand`);
    if (madeUnpacked) { try { fs.rmdirSync(unpacked); } catch { console.log(`WARN the junction ${unpacked} could not be removed`); } }
    if (before) for (const [f, h] of before) if (hashOf(path.join(realProfile, f)) !== h) { console.log(`FAIL the live run changed the real profile file ${f}`); process.exitCode = 1; }
    if (nmBefore) { // a write through a hard link changes the real file; a rewrite by someone else (another helper) shows up the same way
      const diff = treeDiff(nmBefore, treeHash(path.join(realProfile, 'node_modules')));
      if (diff.length) { console.log(`FAIL the real plugin packages changed during the run (${diff.length}): ${diff.slice(0, 8).join('; ')}`); process.exitCode = 1; }
    }
  }
  return { stoppedAt };
}

// ---------- run ----------
const hits = [];
const counts = {};
counts.archive = scanArchive(archive, hits);
const a = openAsar(archive);
const owners = loadOwners(a);
a.close();
for (const p of ['web', 'desktop']) counts['profile ' + p] = scanDir('profile ' + p, path.join(home, '.dsh', 'profiles', p), hits);
counts['local plugins'] = scanDir('local plugin', path.join(home, '.dsh', 'local-plugins'), hits, /^(?:backups|node_modules|\.git)$/);
const installed = path.join(installDir, 'resources', 'runtime');
if (fs.existsSync(installed)) counts['installed runtime'] = scanDir('installed', installed, hits);
// floors (about 65 % of what was read on 2026-11-01): a source that was not read must not pass as "0 findings"
const FLOORS = { archive: 10000, 'profile web': 12000, 'profile desktop': 12000, 'local plugins': 30 };
const lowSources = Object.entries(FLOORS).filter(([k, v]) => (counts[k] ?? 0) < v).map(([k]) => k);
if (lowSources.length) { console.error('FAIL: too few files read from ' + lowSources.join(', ') + ' (floors ' + JSON.stringify(FLOORS) + ')'); process.exitCode = 1; }

const strict = flag('--strict');
const bad = hits.filter((h) => !h.allowed && (strict || h.cls !== 'docs'));
const ownerText = (pkg, row) => ['web', 'desktop'].map((p) => (row ? (owners.ids[p].has(row) ? `${row}:${owners.ids[p].get(row)}` : '') : (owners[p].get(pkg) || []).join(',')) || '-').map((s, i) => (i ? 'desktop ' : 'web ') + s).join(' | ');

console.log('files read:', Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(`hits: ${hits.length} (allowed ${hits.filter((h) => h.allowed).length}, docs/tests ${hits.filter((h) => !h.allowed && h.cls === 'docs').length}, findings ${bad.length})`);
const groups = new Map();
for (const h of bad) {
  const k = h.src.replace(/ (web|desktop)$/, '') + '|' + h.pkg + '|' + h.row;
  const g = groups.get(k) || { src: h.src.replace(/ (web|desktop)$/, ''), pkg: h.pkg, row: h.row, n: 0, cls: new Set(), hosts: new Set() };
  g.n++; g.cls.add(h.cls); g.hosts.add(h.match.toLowerCase()); groups.set(k, g);
}
const rows = [...groups.values()].sort((x, y) => y.n - x.n);
if (rows.length) {
  console.log('\nSTATIC FINDINGS (grouped by package)');
  console.log('hits  source            package                                              class  owner plugin id: state per profile');
  for (const g of rows) console.log(`${String(g.n).padStart(4)}  ${g.src.padEnd(16)}  ${(g.pkg + (g.row ? ' [row ' + g.row + ']' : '')).slice(0, 52).padEnd(52)}  ${[...g.cls].join('/').padEnd(9)} ${ownerText(g.pkg, g.row)}`);
}
if (flag('--list')) for (const h of hits) console.log(`${h.allowed ? 'ALLOWED' : h.cls.toUpperCase().padEnd(7)} [${h.src}] ${h.file} :: ${h.match} :: ${h.snippet}`);
if (flag('--json')) fs.writeFileSync(opt('--json'), JSON.stringify({ counts, hits, owners: { web: [...owners.web], desktop: [...owners.desktop], ids: { web: [...owners.ids.web], desktop: [...owners.ids.desktop] } } }, null, 1));

let liveBad = [];
const liveProblems = [];
const traceArg = opt('--trace');
if (flag('--live') || traceArg) {
  const traceFile = path.resolve(traceArg || path.join(os.tmpdir(), 'arc-net-trace.jsonl'));
  const run = traceArg ? null : await liveRun(traceFile, Number(opt('--wait', 60)));
  const rowsT = readTrace(traceFile);
  const byHost = new Map();
  const programs = new Map();
  let pipes = 0;
  for (const r of rowsT) {
    if (r.kind === 'start') continue;
    if (r.kind === 'spawn') { programs.set(r.host, (programs.get(r.host) || 0) + 1); continue; }
    if (r.via === 'ipc') { pipes++; continue; } // a named pipe is a path on this machine, not a host
    if (!r.host) continue;
    const h = String(r.host).toLowerCase();
    const e = byHost.get(h) || { n: 0, kinds: new Set(), ports: new Set(), from: r.from };
    e.n++; e.kinds.add(r.kind); if (r.port) e.ports.add(r.port); byHost.set(h, e);
  }
  console.log(`\nLIVE HOSTS (${rowsT.length} trace lines, ${new Set(rowsT.map((r) => r.pid)).size} processes)`);
  for (const [h, e] of [...byHost].sort((x, y) => y[1].n - x[1].n)) console.log(`${String(e.n).padStart(4)}  ${h.padEnd(34)} ${[...e.kinds].join('/').padEnd(18)} ${[...e.ports].join(',')}  ${isDeepseekHost(h) ? '<-- DEEPSEEK' : isLocalHost(h) ? '' : '<-- NOT LOCAL'}`);
  console.log(`skipped ${pipes} named-pipe (ipc) rows: a pipe is not a host`);
  console.log(`child programs started: ${programs.size ? [...programs].map(([p, n]) => `${p} x${n}`).join(', ') : 'none'} (only Node children are traced; a program that is not Node is not, so its own connections are not in this table)`);
  const startRow = rowsT.find((r) => r.kind === 'start');
  const windowSec = run && startRow ? (run.stoppedAt - Date.parse(startRow.t)) / 1000 : null;
  console.log(`observation window: ${windowSec === null ? 'not measured (an existing trace file was judged)' : `${windowSec.toFixed(1)} s, from the tracer start to the end of the wait`}`);
  // a startup that reaches any host other than this machine is a finding: the update checks and the service calls are meant to be off
  liveBad = [...byHost.keys()].filter((h) => !isLocalHost(h));
  // a trace that saw nothing proves nothing: the tracer must have loaded (start row) and must have seen this machine.
  // The page load is a client of this machine that connects to the server, so the tracer logs it as an inbound (accept) row;
  // an outbound loopback connect row (for example to a local MCP gateway) counts as well.
  if (!startRow) liveProblems.push('the trace has no start row: the tracer did not load');
  if (!rowsT.some((r) => (r.kind === 'connect' || r.kind === 'accept') && r.via === 'net' && isLocalHost(String(r.host).toLowerCase()))) liveProblems.push('the trace has no loopback connect or accept row: the page load was not seen');
  console.log(`loopback rows: ${rowsT.filter((r) => r.kind === 'connect' && r.via === 'net' && isLocalHost(String(r.host).toLowerCase())).length} outbound connect, ${rowsT.filter((r) => r.kind === 'accept').length} inbound accept`);
}

const fail = bad.length > 0 || liveBad.length > 0 || liveProblems.length > 0 || process.exitCode === 1;
for (const p of liveProblems) console.log('FAIL ' + p);
console.log(`\n${fail ? 'FAIL' : 'PASS'}: ${bad.length} static findings${flag('--live') || traceArg ? `, ${liveBad.length} hosts other than this machine in the live trace, ${liveProblems.length} trace gaps` : ' (live part not run; add --live)'}`);
process.exit(fail ? 1 : 0);
