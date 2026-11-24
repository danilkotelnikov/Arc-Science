// UPDATE-1: update the plugins and the two native programs of an installed Arc Harness from GitHub Releases.
// Zero dependencies. It lives in arc-core because an installed plugin folder cannot reach the kit's lib/native.
//
// What an update replaces: the seven kit plugins, in ~/.arc/local-plugins AND in each profile's node_modules copy
// (pnpm copies them; the app loads the copy), plus bin/arc-gateway.exe (where it is installed) and bin/arc-validators.exe
// (only where a copy already exists). It never touches ~/.arc data, the app archive, or any other plugin.
//
// Steps: read the release list, pick the highest release that the chosen channel may see (Release: finals only; Beta: also
// x.y.z-beta.N; Alpha: also x.y.z-alpha.N; never a draft), download the kit zip and
// SHA256SUMS.txt of that same release, check the zip hash, read the zip (zip-slip and size caps), check every plugin and
// binary file against RELEASE-MANIFEST.json and SHA256SUMS.txt, stage, smoke-test the staged programs, swap with a
// backup, check the live files, and roll back by itself when that check fails.
//
// The checksum file comes from the same release as the zip: it proves a complete download, not who built it.
import crypto from 'node:crypto';
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

export const UPDATE_PLUGINS = Object.freeze(['arc-core', 'arc-hoh', 'arc-mermaid', 'arc-mode', 'arc-molecullage', 'arc-theme', 'arc-web-crawler']);
const BINARIES = Object.freeze({ 'arc-gateway.exe': 'gateway', 'arc-validators.exe': 'validators' });
const MODES = Object.freeze(['off', 'notify', 'auto']);
const HOSTS = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com']);
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DEFAULT_REPO = 'danilkotelnikov/Arc-Science';
const DEFAULT_API = 'https://api.github.com';
const LIMITS = { maxKitBytes: 256 << 20, maxEntryBytes: 96 << 20, maxTotalBytes: 400 << 20, maxEntries: 20000, maxSumsBytes: 64 << 10, maxApiBytes: 4 << 20 };
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const fail = (code, msg) => Object.assign(new Error(`${code}: ${msg}`), { code });

// ---- versions and releases
// A version is x.y.z, x.y.z-beta.N or x.y.z-alpha.N, and nothing else. Every place that reads a version uses this one reader.
// No number has a leading zero, so one version has one spelling in a tag, a kit name and a package file.
const VERSION_RE = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-(alpha|beta)\.(0|[1-9]\d{0,8}))?$/;
export const CHANNELS = Object.freeze(['release', 'beta', 'alpha']); // each channel also sees what the ones before it see
const STAGE = Object.freeze({ alpha: 0, beta: 1, '': 2 }); // inside one x.y.z: every alpha, then every beta, then the final
/** { nums: [x, y, z], pre: '' | 'beta' | 'alpha', n } for a version in the one strict form, or null. */
export function parseVersion(v) {
  const m = typeof v === 'string' ? VERSION_RE.exec(v) : null;
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || '', n: m[4] ? Number(m[5]) : 0 } : null;
}
const channelOf = (parsed) => parsed.pre || 'release';
// text that is no version (an odd local build) still compares by its leading numbers, as a final
const loose = (v) => parseVersion(v) || { nums: [0, 1, 2].map((i) => Number((/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v ?? '')) || [])[i + 1] || 0)), pre: '', n: 0 };
export function compareVersions(a, b) {
  const x = loose(a), y = loose(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1;
  if (STAGE[x.pre] !== STAGE[y.pre]) return STAGE[x.pre] > STAGE[y.pre] ? 1 : -1;
  return x.n === y.n ? 0 : x.n > y.n ? 1 : -1;
}
const kitName = (v) => `Arc-Harness-Kit-${v}-win-x64.zip`;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, n);

/**
 * The highest release that the channel may see, or the named one if the channel may see it; { version, tag, url, notes, kit } or null.
 * The tag decides: x.y.z is a final, x.y.z-beta.N a beta, x.y.z-alpha.N an alpha. A draft, a tag in another form, and a
 * plain tag that GitHub marks as a pre-release stay out of every channel.
 */
export function pickRelease(list, wanted, channel = 'release') {
  const reach = CHANNELS.indexOf(channel);
  let best = null;
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || r.draft || reach < 0) continue;
    const p = parseVersion(String(r.tag_name || '').replace(/^v/, ''));
    if (!p || (!p.pre && r.prerelease) || CHANNELS.indexOf(channelOf(p)) > reach) continue;
    const version = `${p.nums.join('.')}${p.pre ? `-${p.pre}.${p.n}` : ''}`;
    if (wanted ? version !== wanted : (best && compareVersions(version, best.version) <= 0)) continue;
    const assets = Array.isArray(r.assets) ? r.assets : [];
    const zip = assets.find((a) => a && a.name === kitName(version)), sums = assets.find((a) => a && a.name === 'SHA256SUMS.txt');
    best = { version, tag: r.tag_name, url: clean(r.html_url, 300), notes: clean(r.body, 1201), /* the page shows 1200; one character more says the text was cut */ kit: zip && sums ? { name: zip.name, url: zip.browser_download_url, sumsUrl: sums.browser_download_url } : null };
  }
  return best;
}

// ---- where a download may come from
export function assertAllowedUrl(raw, env = process.env) {
  let u;
  try { u = new URL(String(raw)); } catch { throw fail('ERR_UPDATE_HOST', 'not a URL'); }
  if (u.username || u.password) throw fail('ERR_UPDATE_HOST', 'a URL with credentials is not allowed');
  if (env.ARC_UPDATE_ALLOW_LOOPBACK === '1' && u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return u; // tests only
  if (u.protocol !== 'https:' || u.port || !HOSTS.has(u.hostname)) throw fail('ERR_UPDATE_HOST', `${u.protocol}//${u.host} is not allowed; only https GitHub hosts are`);
  return u;
}

// ---- zip reader: central directory first, so it works on kits with data descriptors; no extraction to disk here
const safeName = (n) => {
  if (!n || n.includes('\\') || n.startsWith('/') || /^[A-Za-z]:/.test(n) || n.includes(':') || n.includes('\0')) return false;
  const parts = n.endsWith('/') ? n.slice(0, -1).split('/') : n.split('/');
  // Windows device names and names that Windows trims (a trailing dot or space) would write somewhere else
  return parts.every((p) => p && p !== '.' && p !== '..' && !/[<>"|?*]/.test(p) && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p));
};
export function readZip(buf, caps = {}) {
  const L = { ...LIMITS, ...caps };
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw fail('ERR_ZIP', 'not a zip file');
  const count = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) throw fail('ERR_ZIP', 'zip64 is not supported');
  if (count > L.maxEntries) throw fail('ERR_ZIP_ENTRIES', `${count} entries; the cap is ${L.maxEntries}`);
  if (cdOff + cdSize > buf.length) throw fail('ERR_ZIP', 'the central directory is outside the file');
  const entries = [], seen = new Set();
  let p = cdOff, total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cdOff + cdSize || buf.readUInt32LE(p) !== 0x02014b50) throw fail('ERR_ZIP', 'bad central directory');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const madeBy = buf.readUInt16LE(p + 4) >> 8, ext = buf.readUInt32LE(p + 38), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    p += 46 + nl + el + cl;
    if (p > cdOff + cdSize) throw fail('ERR_ZIP', 'bad central directory');
    if (flags & 1) throw fail('ERR_ZIP', 'an encrypted entry');
    if (!safeName(name)) throw fail('ERR_ZIP_PATH', `unsafe path in the kit: ${JSON.stringify(name.slice(0, 80))}`);
    if (madeBy === 3 && ((ext >>> 16) & 0o170000) === 0o120000) throw fail('ERR_ZIP_PATH', `a link in the kit: ${name}`);
    const key = name.toLowerCase();
    if (seen.has(key)) throw fail('ERR_ZIP_DUPLICATE', `the same path twice: ${name}`);
    seen.add(key);
    if (usize > L.maxEntryBytes) throw fail('ERR_ZIP_SIZE', `${name} is ${usize} bytes; the cap is ${L.maxEntryBytes}`);
    total += usize;
    if (total > L.maxTotalBytes) throw fail('ERR_ZIP_SIZE', `the kit unpacks to more than ${L.maxTotalBytes} bytes`);
    if (usize > (1 << 20) && csize * 1000 < usize) throw fail('ERR_ZIP_SIZE', `${name} has an extreme compression ratio`);
    const isDir = name.endsWith('/');
    entries.push({
      name, size: usize, isDir,
      data() {
        if (isDir) return Buffer.alloc(0);
        if (off + 30 > buf.length || buf.readUInt32LE(off) !== 0x04034b50) throw fail('ERR_ZIP', `bad local header for ${name}`);
        const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28);
        if (buf.toString('utf8', off + 30, off + 30 + lnl) !== name) throw fail('ERR_ZIP', `local and central names differ for ${name}`);
        const start = off + 30 + lnl + lel;
        if (start + csize > buf.length) throw fail('ERR_ZIP', `${name} runs past the end of the file`);
        const raw = buf.subarray(start, start + csize);
        let out;
        try {
          out = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: usize + 1 }) : null;
        } catch { throw fail('ERR_ZIP_SIZE', `${name} unpacks to more than its declared ${usize} bytes, or is damaged`); }
        if (!out) throw fail('ERR_ZIP', `${name} uses an unsupported method`);
        if (out.length !== usize) throw fail('ERR_ZIP_SIZE', `${name} unpacks to ${out.length} bytes, not ${usize}`);
        if ((zlib.crc32(out) >>> 0) !== crc) throw fail('ERR_ZIP', `${name} fails its CRC check`);
        return out;
      },
    });
  }
  return entries;
}

// ---- the kit: every check before a single file is written
function parseSums(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^([0-9a-fA-F]{64})\s+\*?(\S.*)$/.exec(line.trim());
    if (!m) throw fail('ERR_UPDATE_SUMS', 'SHA256SUMS.txt has a line that is not "<sha256>  <name>"');
    map.set(m[2], m[1].toLowerCase());
  }
  return map;
}

export function verifyKit({ zip, sumsText, version, caps }) {
  const name = kitName(version), sums = parseSums(sumsText);
  if (sums.get(name) !== sha256(zip)) throw fail('ERR_UPDATE_CHECKSUM', `the kit zip does not match its checksum in SHA256SUMS.txt (${name})`);
  const top = `Arc-Harness-Kit-${version}-win-x64/`;
  const entries = readZip(zip, caps);
  const man = entries.find((e) => e.name === `${top}RELEASE-MANIFEST.json`);
  if (!man) throw fail('ERR_UPDATE_MANIFEST', `the kit has no RELEASE-MANIFEST.json in its ${top.slice(0, -1)} folder; it may be another version`);
  let manifest;
  try { manifest = JSON.parse(man.data().toString('utf8')); } catch { throw fail('ERR_UPDATE_MANIFEST', 'RELEASE-MANIFEST.json is not valid JSON'); }
  if (manifest.product !== 'Arc Harness' || manifest.version !== version) throw fail('ERR_UPDATE_MANIFEST', `the manifest says version ${manifest.version}, but the release is ${version}`);
  const digests = manifest.files;
  if (!digests || typeof digests !== 'object' || Array.isArray(digests) || !Object.keys(digests).length) throw fail('ERR_UPDATE_MANIFEST', 'the kit has no file digest list ("files" in RELEASE-MANIFEST.json), so it cannot be checked');
  const wantedPath = (rel) => {
    const m = /^plugins\/([^/]+)\/.+/.exec(rel);
    return (m && UPDATE_PLUGINS.includes(m[1])) || (/^bin\/[^/]+$/.test(rel) && Object.hasOwn(BINARIES, rel.slice(4)));
  };
  // files the updater does not handle (a plugin of a later kit) are ignored; the ones it handles need a proper digest
  const handled = Object.keys(digests).filter(wantedPath);
  for (const rel of handled) if (!/^[0-9a-f]{64}$/.test(digests[rel])) throw fail('ERR_UPDATE_MANIFEST', `the manifest has no proper digest for ${clean(rel, 80)}`);
  if (!handled.length) throw fail('ERR_UPDATE_MANIFEST', 'the manifest lists no plugin or program file');
  const plugins = new Map(), bins = new Map();
  let used = 0;
  for (const e of entries) {
    if (e.isDir || !e.name.startsWith(top)) continue;
    const rel = e.name.slice(top.length);
    if (!wantedPath(rel)) continue;
    const want = digests[rel];
    if (!want) throw fail('ERR_UPDATE_MANIFEST', `${rel} is in the kit but not in the manifest`);
    const data = e.data();
    if (sha256(data) !== want) throw fail('ERR_UPDATE_MANIFEST', `${rel} does not match its digest in RELEASE-MANIFEST.json`);
    used++;
    if (rel.startsWith('bin/')) bins.set(rel.slice(4), data);
    else { const [, n, sub] = /^plugins\/([^/]+)\/(.+)$/.exec(rel); if (!plugins.has(n)) plugins.set(n, []); plugins.get(n).push({ rel: sub, data, sha: want }); }
  }
  if (used !== handled.length) throw fail('ERR_UPDATE_MANIFEST', 'the manifest lists files that the kit does not contain');
  for (const [n, data] of bins) {
    const viaSums = sums.get(`bin/${n}`), viaManifest = (manifest.binaries || []).find((b) => b && b.name === n)?.sha256;
    if (viaSums !== sha256(data) || viaManifest !== sha256(data)) throw fail('ERR_UPDATE_CHECKSUM', `${n} does not match SHA256SUMS.txt and the manifest together`);
  }
  for (const n of UPDATE_PLUGINS) if (!plugins.has(n)) throw fail('ERR_UPDATE_MANIFEST', `the kit has no ${n} plugin`);
  const core = plugins.get('arc-core')?.find((f) => f.rel === 'package.json');
  if (!core || JSON.parse(core.data.toString('utf8')).version !== version) throw fail('ERR_UPDATE_MANIFEST', `arc-core in the kit is not version ${version}`);
  return { plugins, bins, manifest };
}

// ---- small file helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eqPath = (a, b) => (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

export function createUpdater(opts = {}) {
  const env = opts.env ?? process.env, F = opts.fs ?? nodeFs;
  const testSwitch = env.ARC_UPDATE_ALLOW_LOOPBACK === '1';
  const realHome = path.join(os.homedir(), '.arc'), realGw = path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'ArcGateway');
  const named = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined); // a name of only spaces names nothing
  const homeIn = opts.home ?? named(env.ARC_HOME), gwIn = opts.gatewayDir ?? (testSwitch ? named(env.ARC_UPDATE_GATEWAY_DIR) : undefined);
  const home = path.resolve(homeIn ?? realHome);
  const gatewayDir = path.resolve(gwIn ?? realGw);
  // a test run must name both folders itself (options or ARC_HOME and ARC_UPDATE_GATEWAY_DIR): a forgotten override would swap the user's live files.
  // The check reads the same resolved folders that the updater then uses.
  if (testSwitch && (!homeIn || !gwIn || eqPath(home, realHome) || eqPath(gatewayDir, realGw))) throw fail('ERR_UPDATE_TEST_PATHS', 'with the test switch on, give a throwaway home and gatewayDir');
  const validatorsDirs = (opts.validatorsDirs ?? [gatewayDir, path.join(home, 'bin')]).map((d) => path.resolve(d));
  const wantRepo = opts.repo ?? env.ARC_UPDATE_REPO;
  const repo = testSwitch && REPO_RE.test(wantRepo || '') ? wantRepo : DEFAULT_REPO;
  const api = (testSwitch && (opts.api ?? env.ARC_UPDATE_API) ? String(opts.api ?? env.ARC_UPDATE_API) : DEFAULT_API).replace(/\/+$/, '');
  const limits = { ...LIMITS, ...(opts.limits || {}) };
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const run = opts.run ?? ((file, args) => spawnSync(file, args, { encoding: 'utf8', timeout: 10000, windowsHide: true }));
  const retryMs = opts.retryMs ?? 250;
  const now = opts.now ?? (() => Date.now());
  const dir = path.join(home, 'updates'), settingsFile = path.join(dir, 'settings.json'), stateFile = path.join(dir, 'state.json');
  const backupRoot = path.join(dir, 'backup'), journalFile = path.join(backupRoot, 'backup.json'), staleRoot = path.join(dir, 'stale');
  const localPlugins = path.join(home, 'local-plugins'), profilesDir = path.join(home, 'profiles'), lockFile = path.join(dir, 'lock');
  // While a swap runs, the backup of the update before it waits here (folders) and under this ending (programs).
  // A swap that fails puts it back; a swap that lands drops it.
  const prevRoot = path.join(dir, 'backup-prev'), PREV = '.arc-backup-prev';

  const readJson = (f, dflt) => { try { return JSON.parse(F.readFileSync(f, 'utf8')); } catch { return dflt; } };
  const writeJson = (f, v) => {
    F.mkdirSync(path.dirname(f), { recursive: true });
    const t = `${f}.${process.pid}-${++mem.counter}.tmp`;
    F.writeFileSync(t, JSON.stringify(v, null, 2));
    for (let i = 0; ; i++) {
      try { F.renameSync(t, f); return; } catch (e) {
        if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { try { F.rmSync(t, { force: true }); } catch { /* temp only */ } throw e; }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40); // a virus scanner can hold the file for a moment
      }
    }
  };

  const mem = { token: crypto.randomBytes(8).toString('hex'), phase: 'idle', message: '', busy: false, restartNeeded: false, healthy: null, undone: false, releases: [], skippedBinaries: [], counter: 0 };
  const settings = () => { const s = readJson(settingsFile, {}); return { mode: MODES.includes(s.mode) ? s.mode : 'notify', channel: CHANNELS.includes(s.channel) ? s.channel : 'release', intervalHours: Number.isInteger(s.intervalHours) && s.intervalHours >= 1 && s.intervalHours <= 168 ? s.intervalHours : 12 }; };
  const persisted = () => readJson(stateFile, {});
  const save = (patch) => writeJson(stateFile, { ...persisted(), ...patch });
  const journal = () => readJson(journalFile, null);

  function readInstalled() {
    const cands = [path.join(localPlugins, 'arc-core', 'package.json')];
    try { for (const p of F.readdirSync(profilesDir)) cands.push(path.join(profilesDir, p, 'node_modules', 'arc-core', 'package.json')); } catch { /* no profiles */ }
    // a beta keeps its mark: read as a final, it would hide the final that follows it. Text in another form keeps its x.y.z.
    for (const c of cands) { const v = readJson(c, null)?.version; if (parseVersion(v)) return v; if (typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v)) return v.match(/^\d+\.\d+\.\d+/)[0]; }
    return opts.installedVersion ?? '0.0.0';
  }

  function getState() {
    // with no journal in place, a backup that was set aside by an update that never started its swap still counts: Roll back puts it back first
    const p = persisted(), st = settings(), installed = readInstalled(), j = journal() ?? readJson(path.join(prevRoot, 'backup.json'), null);
    // A check made for another channel says nothing about this one (the choice is shared by every window of the app, the
    // release list is not). A result from before channels existed was made for Release.
    const c = p.lastCheck && (p.lastCheck.channel || 'release') === st.channel ? p.lastCheck : {};
    const available = Boolean(c.latest) && compareVersions(c.latest, installed) > 0;
    return {
      installed, latest: c.latest || null, available, installable: Boolean(c.installable), reason: c.reason || '', releaseUrl: c.releaseUrl || '', notes: c.notes || '', checkedAt: c.checkedAt || null,
      phase: mem.phase, message: mem.message, busy: mem.busy, mode: st.mode, intervalHours: st.intervalHours,
      // ahead: the installed version is newer than the newest one of the channel (after a change to a calmer channel)
      channel: st.channel, ahead: Boolean(c.latest) && compareVersions(installed, c.latest) > 0,
      hasBackup: Boolean(j && j.status === 'complete'), backupVersion: j && j.status === 'complete' ? j.fromVersion : null,
      skipped: p.skipped || null, skippedBinaries: mem.skippedBinaries, restartNeeded: mem.restartNeeded, healthy: mem.healthy,
      // the last step failed: a failed step, or a failed update that was put back. A roll back the user asked for is no failure.
      failed: mem.phase === 'failed' || (mem.phase === 'rolled-back' && mem.undone),
    };
  }
  const phase = (ph, message = '') => { mem.phase = ph; mem.message = message; if (opts.onPhase) { try { opts.onPhase(getState()); } catch { /* a listener must not stop an update */ } } };

  // ---- network
  async function get(url, maxBytes, accept) {
    let cur = url;
    for (let hop = 0; hop < 6; hop++) {
      assertAllowedUrl(cur, env);
      const res = await fetchImpl(cur, { redirect: 'manual', headers: { 'user-agent': 'arc-harness-updater', accept }, signal: AbortSignal.timeout(opts.timeoutMs ?? 120000) });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw fail('ERR_UPDATE_HTTP', 'a redirect without a location');
        cur = new URL(loc, cur).href;
        continue;
      }
      if (!res.ok) throw fail('ERR_UPDATE_HTTP', `HTTP ${res.status} from ${new URL(cur).host}`);
      const len = Number(res.headers.get('content-length'));
      if (Number.isFinite(len) && len > maxBytes) throw fail('ERR_UPDATE_SIZE', `the download is too large (${len} bytes; the cap is ${maxBytes})`);
      const chunks = []; let n = 0;
      for await (const ch of res.body) { n += ch.length; if (n > maxBytes) throw fail('ERR_UPDATE_SIZE', `the download is too large (the cap is ${maxBytes})`); chunks.push(Buffer.from(ch)); }
      return Buffer.concat(chunks);
    }
    throw fail('ERR_UPDATE_HTTP', 'too many redirects');
  }

  // ---- check
  const check = async () => (mem.busy ? getState() : doCheck());
  // forChannel: the channel of the update that asked for this check. An update reads its channel once, at its start.
  // own: an object of the caller that takes the failure of this one check, so no other check can write into its result.
  async function doCheck(forChannel, own = null) {
    const channel = forChannel || settings().channel; // read now: another window of the app may have changed it
    phase('checking');
    try {
      let all = [];
      // GitHub lists the newest releases first. A full page with no version for this channel can hide one on an older page
      // (a final behind many pre-releases), so up to three pages are read.
      for (let page = 1; page <= 3; page++) {
        const body = await get(`${api}/repos/${repo}/releases?per_page=30${page > 1 ? `&page=${page}` : ''}`, limits.maxApiBytes, 'application/vnd.github+json');
        const list = JSON.parse(body.toString('utf8'));
        if (!Array.isArray(list)) break;
        all = all.concat(list);
        if (list.length < 30 || pickRelease(all, undefined, channel)) break;
      }
      mem.releases = all;
      const top = pickRelease(mem.releases, undefined, channel);
      // A check that ends after the channel changed must not take the place of the result for the new channel.
      if (settings().channel === channel) save({ lastCheck: top ? { channel, latest: top.version, installable: Boolean(top.kit), reason: top.kit ? '' : 'no-kit', releaseUrl: top.url, notes: top.notes, checkedAt: new Date(now()).toISOString() } : { channel, latest: null, installable: false, reason: 'no-release', checkedAt: new Date(now()).toISOString() } });
      phase('idle', top ? '' : 'No release with a plain version number was found.');
    } catch (err) {
      // a check for a channel that is no longer chosen says nothing about the new one, also when it fails
      const said = `Could not reach GitHub or read its answer: ${clean(err.message, 200)}`;
      if (own) own.error = said;
      // the check of an update is its own failure, whatever the channel is now; a plain check counts only for the chosen channel
      if (own || settings().channel === channel) phase('failed', said);
      // a late failure for a channel that is no longer chosen leaves the result of a newer check alone
      else if (mem.phase === 'checking') phase('idle');
    }
    return getState();
  }

  // ---- swap with backup
  async function mv(a, b) {
    for (let i = 0; ; i++) {
      try { F.renameSync(a, b); return; } catch (e) {
        if (i >= 3 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
        await sleep(retryMs);
      }
    }
  }
  const tag = () => `${now()}-${++mem.counter}`;
  /** A folder goes under updates/stale (same drive as the home), a file next to itself: a running exe can be renamed but not deleted. */
  async function moveAside(p, isDir) {
    const to = isDir ? path.join(staleRoot, tag()) : `${p}.stale-${tag()}`;
    F.mkdirSync(path.dirname(to), { recursive: true });
    await mv(p, to);
  }
  function sweep() {
    const tryRm = (p) => { try { F.rmSync(p, { recursive: true, force: true }); } catch { /* still locked: the next sweep tries again */ } };
    try { for (const e of F.readdirSync(staleRoot)) tryRm(path.join(staleRoot, e)); } catch { /* none */ }
    for (const d of new Set([gatewayDir, ...validatorsDirs])) {
      try { for (const f of F.readdirSync(d)) if (/\.exe\..*stale-\d+-\d+$/.test(f)) tryRm(path.join(d, f)); } catch { /* no folder */ }
    }
  }

  function planOps(kit, stage) {
    const ops = [];
    for (const n of UPDATE_PLUGINS) {
      if (!kit.plugins.has(n)) continue;
      ops.push({ kind: 'dir', target: path.join(localPlugins, n), src: path.join(stage, 'plugins', n), slot: `local-plugins/${n}` });
      try { for (const p of F.readdirSync(profilesDir)) { const t = path.join(profilesDir, p, 'node_modules', n); if (F.existsSync(t)) ops.push({ kind: 'dir', target: t, src: path.join(stage, 'plugins', n), slot: `profile-${p}/${n}` }); } } catch { /* no profiles */ }
    }
    mem.skippedBinaries = [];
    for (const name of kit.bins.keys()) {
      const dirs = BINARIES[name] === 'gateway' ? [gatewayDir] : validatorsDirs;
      const uniq = new Map(dirs.map((d) => [process.platform === 'win32' ? path.resolve(d).toLowerCase() : path.resolve(d), d]));
      const found = [...uniq.values()].map((d) => path.join(d, name)).filter((f) => F.existsSync(f));
      if (!found.length) mem.skippedBinaries.push(name);
      for (const f of found) ops.push({ kind: 'file', target: f, src: path.join(stage, 'bin', name), name });
    }
    // every backup path is fixed here, before anything moves, so the journal is right even if the process dies mid-swap
    for (const op of ops) {
      op.newPath = `${op.target}.arc-new`;
      if (F.existsSync(op.target)) op.backup = op.kind === 'dir' ? path.join(backupRoot, op.slot) : `${op.target}.arc-backup`;
    }
    return ops;
  }

  const binDirs = () => new Set([gatewayDir, ...validatorsDirs]);
  const prevFiles = () => {
    const out = [];
    for (const d of binDirs()) { try { for (const f of F.readdirSync(d)) if (f.endsWith(PREV)) out.push(path.join(d, f)); } catch { /* no folder */ } }
    return out;
  };
  /**
   * The earlier backup steps aside before a swap. From then on every backup that restore() finds was made by this swap,
   * so a step that never ran cannot pull an older program back in. The folder goes first: with its journal gone,
   * a process that dies here is healed by prevBack() on the next update or Roll back.
   */
  async function setPrevAside(ops) {
    // What still carries the "earlier backup" names here is the leftover of a clean-up that was cut short: the journal in place
    // owns the current backup. The leftover goes first, so it can never be taken for the backup that is set aside below.
    await dropPrev();
    if (F.existsSync(backupRoot)) await mv(backupRoot, prevRoot);
    for (const op of ops) {
      if (op.kind !== 'file' || !op.backup || !F.existsSync(op.backup)) continue;
      const to = `${op.target}${PREV}`;
      if (F.existsSync(to)) await moveAside(to, false);
      await mv(op.backup, to);
    }
  }
  /** Put the earlier backup back: the programs' copies first, then the folder whose journal makes them count. */
  async function prevBack() {
    if (!readJson(path.join(prevRoot, 'backup.json'), null)) return;
    for (const f of prevFiles()) {
      const to = `${f.slice(0, -PREV.length)}.arc-backup`;
      if (F.existsSync(to)) await moveAside(to, false);
      await mv(f, to);
    }
    // the folder of the update that failed holds nothing of value by now; if it cannot be deleted, it steps out of the way
    try { F.rmSync(backupRoot, { recursive: true, force: true }); } catch { await moveAside(backupRoot, true); }
    await mv(prevRoot, backupRoot);
  }
  /**
   * Drop the set-aside backup. Its journal goes first, in one small delete: without the journal, nothing that is left
   * here can count as a backup again, whatever stops the rest. Then the folder, then the programs' copies.
   */
  async function dropPrev() {
    F.rmSync(path.join(prevRoot, 'backup.json'), { force: true });
    if (F.existsSync(prevRoot)) await moveAside(prevRoot, true);
    for (const f of prevFiles()) await moveAside(f, false);
  }

  async function doOp(op) {
    F.rmSync(op.newPath, { recursive: true, force: true });
    if (op.kind === 'dir') {
      F.cpSync(op.src, op.newPath, { recursive: true });
      if (op.backup) { F.mkdirSync(path.dirname(op.backup), { recursive: true }); await mv(op.target, op.backup); }
    } else {
      F.copyFileSync(op.src, op.newPath);
      if (op.backup) await mv(op.target, op.backup);
    }
    await mv(op.newPath, op.target);
    op.done = true;
  }

  /** Put every moved item back. Collects errors instead of stopping at the first. */
  async function restore(ops) {
    const errors = [];
    for (const op of [...ops].reverse()) {
      try {
        if (op.backup && F.existsSync(op.backup)) {
          if (F.existsSync(op.target)) await moveAside(op.target, op.kind === 'dir');
          await mv(op.backup, op.target);
        } else if (op.done && !op.backup && F.existsSync(op.target)) await moveAside(op.target, op.kind === 'dir');
      } catch (e) { errors.push(`${path.basename(op.target)}: ${clean(e.message, 120)}`); }
      // The unfinished new copy is only a leftover. A scanner that still holds it must not keep the old files from coming back,
      // so it is cleared after them and never counts as a failed rollback. The next update removes what stays.
      if (op.newPath) {
        try { F.rmSync(op.newPath, { recursive: true, force: true }); } catch {
          try { if (F.existsSync(op.newPath)) await moveAside(op.newPath, op.kind === 'dir'); } catch { /* still held */ }
        }
      }
    }
    return errors;
  }

  const live = (op, kit, name) => {
    if (op.kind === 'file') return sha256(F.readFileSync(op.target)) === sha256(kit.bins.get(op.name));
    return kit.plugins.get(name).every((f) => { try { return sha256(F.readFileSync(path.join(op.target, ...f.rel.split('/')))) === f.sha; } catch { return false; } });
  };

  function smoke(file, name, version) {
    const kind = BINARIES[name];
    let r;
    try { r = run(file, kind === 'gateway' ? ['version'] : ['sha256', 'abc']); } catch (e) { throw fail('ERR_UPDATE_HEALTH', `${name} could not start: ${clean(e.message, 100)}`); }
    if (!r || r.status !== 0) throw fail('ERR_UPDATE_HEALTH', `${name} did not run (${r && r.status !== null ? `exit ${r.status}` : 'no answer in time'})`);
    if (kind === 'gateway' && !new RegExp(`(^|\\s)${version.replace(/\./g, '\\.')}(\\s|$)`).test(String(r.stdout))) throw fail('ERR_UPDATE_HEALTH', `${name} reports another version than ${version}`);
    if (kind === 'validators') { let j; try { j = JSON.parse(r.stdout); } catch { j = null; } if (!j || j.sha256 !== sha256('abc')) throw fail('ERR_UPDATE_HEALTH', `${name} gave a wrong answer`); }
  }

  // The app can run in more than one process (desktop, web): a lock file keeps two of them from swapping at once.
  function lock() {
    F.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 2; i++) {
      try { F.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: now(), token: mem.token }), { flag: 'wx' }); return true; } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let at = readJson(lockFile, {}).at; // a lock another process is still writing reads as empty: its file time counts then
        if (typeof at !== 'number') { try { at = F.statSync(lockFile).mtimeMs; } catch { return false; } }
        if (now() - at < 20 * 60 * 1000) return false;
        F.rmSync(lockFile, { force: true }); // left by a process that died
      }
    }
    return false;
  }
  const unlock = () => { try { if (readJson(lockFile, {}).token === mem.token) F.rmSync(lockFile, { force: true }); } catch { /* a stale lock expires */ } };

  // ---- install
  // back: go back to the newest version of the channel when the installed one is newer (after a change to a calmer channel).
  // It is the only way to an older version. It takes no version from the caller, and automatic install never uses it.
  // expect: what the Go back question named ({ version, channel }). It is only compared with the target, never used as one.
  async function install({ version, auto = false, back = false, expect = null } = {}) {
    if (back && auto) return { ok: false, error: 'Automatic install never goes back to an older version.' };
    if (mem.busy || !lock()) return { ok: false, error: 'An update is already running.' };
    mem.busy = true;
    let ops = [], toVersion = version || null, swapped = false;
    const stage = path.join(dir, `stage-${tag()}`);
    try {
      const recovered = journal();
      if (recovered && recovered.status === 'swapping') {
        const errs = await restore(recovered.ops);
        if (errs.length) { phase('failed', `An earlier update was cut short and could not be undone: ${errs.join('; ')}`); return { ok: false, error: `An earlier update was cut short and could not be undone: ${errs.join('; ')}` }; }
        F.rmSync(journalFile, { force: true });
      }
      if (!journal()) await prevBack(); // an update that stopped before or during its swap left the earlier backup aside
      const channel = settings().channel; // read once, here: the check and the pick below use this one value
      const own = { error: '' };
      await doCheck(channel, own);
      // the check of this update failed: an older release list must not stand in, also when the channel changed meanwhile
      if (own.error) return { ok: false, error: own.error };
      const named = back ? undefined : version;
      const pick = pickRelease(mem.releases, named, channel);
      if (!pick) { const none = named ? `Release ${clean(named, 40)} was not found.` : 'No release was found.'; phase('idle', none); return { ok: false, error: none }; }
      toVersion = pick.version;
      if (back && expect && (expect.version !== toVersion || expect.channel !== channel)) {
        const moved = 'The newest version of the channel changed. Look at the page again.';
        phase('idle', moved);
        return { ok: false, error: moved };
      }
      const installed = readInstalled();
      const order = compareVersions(toVersion, installed);
      if (back && order >= 0) { phase('idle', `The installed version ${installed} is not newer than the newest ${channel} version.`); return { ok: false, error: `The installed version ${installed} is not newer than the newest ${channel} version.` }; }
      if (!back && order <= 0) { phase('idle', `Already up to date (${installed}).`); return { ok: false, error: `Already up to date (${installed}).` }; }
      if (!pick.kit) { phase('idle', 'This release has no installable kit.'); return { ok: false, error: 'This release has no installable kit.' }; }
      const sk = persisted().skipped;
      if (auto && sk && sk.version === toVersion) return { ok: false, error: `Version ${toVersion} is skipped (${sk.reason}).` };

      phase('downloading', `Downloading ${pick.kit.name}`);
      const zip = await get(pick.kit.url, limits.maxKitBytes, 'application/octet-stream');
      const sums = await get(pick.kit.sumsUrl, limits.maxSumsBytes, 'text/plain');
      phase('verifying', 'Checking the checksum and every file');
      const kit = verifyKit({ zip, sumsText: sums.toString('utf8'), version: toVersion, caps: limits });

      phase('staging', 'Unpacking and testing the new programs');
      F.rmSync(stage, { recursive: true, force: true });
      const put = (rel, data) => { const f = path.join(stage, ...rel.split('/')); if (!path.resolve(f).startsWith(path.resolve(stage) + path.sep)) throw fail('ERR_ZIP_PATH', rel); F.mkdirSync(path.dirname(f), { recursive: true }); F.writeFileSync(f, data); };
      for (const [n, files] of kit.plugins) for (const f of files) put(`plugins/${n}/${f.rel}`, f.data);
      for (const [n, data] of kit.bins) { put(`bin/${n}`, data); smoke(path.join(stage, 'bin', n), n, toVersion); }

      phase('installing', 'Replacing plugins and programs; the old ones are kept for a rollback');
      ops = planOps(kit, stage);
      await setPrevAside(ops);
      F.mkdirSync(backupRoot, { recursive: true });
      const meta = { fromVersion: installed, toVersion, at: new Date(now()).toISOString() };
      const writeJournal = (status) => writeJson(journalFile, { ...meta, status, ops: ops.map(({ kind, target, backup, slot, name, done }) => ({ kind, target, backup, slot, name, done })) });
      writeJournal('swapping');
      swapped = true;
      for (const op of ops) { try { await doOp(op); } finally { writeJournal('swapping'); } }

      phase('testing', 'Checking the installed files and programs');
      for (const op of ops) {
        const name = op.kind === 'dir' ? path.basename(op.target) : null;
        if (!live(op, kit, name)) throw fail('ERR_UPDATE_HEALTH', `${path.basename(op.target)} does not match the kit after the swap`);
      }
      for (const op of ops.filter((o) => o.kind === 'file')) smoke(op.target, op.name, toVersion);
      writeJournal('complete');
      mem.healthy = true; mem.restartNeeded = true;
      save({ skipped: null });
      F.rmSync(stage, { recursive: true, force: true });
      try { await dropPrev(); } catch { /* the next update clears what is left */ }
      sweep();
      phase('done', `Updated to ${toVersion}. Restart Arc Harness to use it.`);
      return { ok: true, version: toVersion };
    } catch (err) {
      const inUse = ['EPERM', 'EBUSY', 'EACCES'].includes(err.code);
      const what = inUse && err.path ? path.basename(String(err.path)).replace(/\.arc-new$/, '') : '';
      const msg = inUse ? `Files of ${what || 'the app'} are in use, so nothing was changed. Close the app and try again` : clean(err.message, 300);
      let rolled = false;
      if (swapped) {
        const errors = await restore(ops);
        rolled = true;
        if (!errors.length) F.rmSync(journalFile, { force: true });
        mem.healthy = errors.length === 0;
        if (errors.length) save({ skipped: { version: toVersion, reason: `failed: ${msg}`, at: new Date(now()).toISOString() } });
        if (errors.length) { phase('failed', `${msg}. The rollback was not complete: ${errors.join('; ')}`); return { ok: false, error: `${msg}. The rollback was not complete: ${errors.join('; ')}` }; }
      }
      // the files are as they were before this update, so its earlier backup counts again and Roll back keeps working
      try { if (!journal()) await prevBack(); } catch { /* the next update or Roll back puts it back */ }
      const transient = inUse || err.code === 'ERR_UPDATE_HTTP' || err.code === 'ERR_UPDATE_SIZE' || err.name === 'TimeoutError' || err.name === 'AbortError' || err instanceof TypeError;
      if (toVersion && !transient) save({ skipped: { version: toVersion, reason: `failed: ${msg}`, at: new Date(now()).toISOString() } });
      const text = inUse ? `${msg}.` : rolled ? `${msg}. The old files were put back (rolled back).` : msg;
      mem.undone = rolled;
      phase(rolled ? 'rolled-back' : 'failed', text);
      return { ok: false, error: text };
    } finally {
      try { F.rmSync(stage, { recursive: true, force: true }); } catch { /* leftover in updates/ only */ }
      mem.busy = false;
      unlock();
    }
  }

  // ---- rollback
  async function rollback() {
    if (mem.busy || !lock()) return { ok: false, error: 'An update is already running.' };
    mem.busy = true;
    try {
      try { if (!journal()) await prevBack(); } catch { /* answered below as no backup */ }
      const j = journal();
      if (!j || !['complete', 'swapping'].includes(j.status)) return { ok: false, error: 'There is no backup to roll back to.' };
      const errors = await restore(j.ops);
      if (errors.length) { phase('failed', `The rollback was not complete: ${errors.join('; ')}`); return { ok: false, error: `The rollback was not complete: ${errors.join('; ')}` }; }
      // Roll back goes one step. An older backup that a cut-short clean-up left behind stops counting before this journal goes,
      // so a process that dies in the lines below cannot leave it as a second step.
      // If that older journal cannot be deleted now (something holds it), this journal stays: while it is in place the older
      // backup cannot count, and the next Roll back finds nothing to move and only finishes the clean-up.
      let olderGone = true;
      if (j.status === 'complete') { try { F.rmSync(path.join(prevRoot, 'backup.json'), { force: true }); } catch { olderGone = false; } }
      if (olderGone) {
        F.rmSync(journalFile, { force: true });
        try { F.rmSync(backupRoot, { recursive: true, force: true }); } catch { /* swept later */ }
      }
      // undoing a swap that was cut short leaves the files as they were before it: its earlier backup counts again
      if (j.status === 'swapping') { try { await prevBack(); } catch { /* the next update puts it back */ } }
      // Roll back goes one step. An older backup that a cut-short clean-up left behind must not show up as a second step.
      else { try { await dropPrev(); } catch { /* the next update clears it */ } }
      save({ skipped: { version: j.toVersion, reason: 'rolled-back', at: new Date(now()).toISOString() } });
      mem.restartNeeded = true; mem.healthy = true; mem.undone = false;
      sweep();
      phase('rolled-back', `Back to ${j.fromVersion}. Restart Arc Harness to use it.`);
      return { ok: true, version: j.fromVersion };
    } finally { mem.busy = false; unlock(); }
  }

  // ---- modes and the timer
  function setMode(mode) {
    if (!MODES.includes(mode)) throw new Error(`Unknown update mode: ${clean(mode, 20)}. Use off, notify or auto.`);
    writeJson(settingsFile, { ...readJson(settingsFile, {}), mode });
    return getState();
  }
  function setChannel(channel) {
    if (!CHANNELS.includes(channel)) throw new Error(`Unknown channel: ${clean(typeof channel === 'string' ? channel : '', 20)}. Use release, beta or alpha.`);
    writeJson(settingsFile, { ...readJson(settingsFile, {}), channel });
    return getState(); // the last check counted for the channel before, so this state holds no newest version until the next check
  }
  async function tick() {
    const { mode } = settings();
    if (mode === 'off') return { action: 'off' };
    const s = await check();
    if (s.phase === 'failed') return { action: 'error', message: s.message };
    if (!s.available) return { action: 'none' };
    if (!s.installable) return { action: 'no-kit' };
    if (mode === 'notify') return { action: 'notified', version: s.latest };
    if (s.skipped && s.skipped.version === s.latest) return { action: 'skipped', version: s.latest, reason: s.skipped.reason };
    const r = await install({ auto: true });
    return r.ok ? { action: 'installed', version: r.version } : { action: 'failed', message: r.error };
  }
  let timers = [];
  function start({ firstAfterMs = 60000 } = {}) {
    stop();
    const every = () => settings().intervalHours * 3600 * 1000;
    const loop = () => { tick().catch(() => {}).finally(() => { const t = setTimeout(loop, every()); t.unref?.(); timers = [t]; }); };
    const t = setTimeout(loop, firstAfterMs); t.unref?.(); timers = [t];
  }
  function stop() { for (const t of timers) clearTimeout(t); timers = []; }

  return { getState, check, install, rollback, setMode, setChannel, tick, sweep, start, stop };
}
