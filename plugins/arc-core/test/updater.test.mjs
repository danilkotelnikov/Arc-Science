// Updater tests (UPDATE-1): a fake GitHub release server on loopback, kits built with the real tools/release-bundle.mjs
// (same zip command as a release), and throwaway homes. No test touches ~/.arc or the installed gateway folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  UPDATE_PLUGINS,
  assertAllowedUrl,
  compareVersions,
  createUpdater,
  pickRelease,
  readZip,
} from '../lib/updater.js';
import { buildReleaseBundle } from '../../../tools/release-bundle.mjs';
import { serveConsoleRoute, createResearchSessionStore } from '../lib/console.js';

const here = path.dirname(fileURLToPath(import.meta.url));
void here;
const ENV = { ARC_UPDATE_ALLOW_LOOPBACK: '1' };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `arc-upd-${p}-`));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

// ---- kits: a fake repo with seven plugins, packed by the real release bundler
function fakeRepo(version, tag) {
  const r = tmp('repo');
  fs.writeFileSync(path.join(r, 'VERSION'), version + '\n');
  for (const n of UPDATE_PLUGINS) {
    fs.mkdirSync(path.join(r, 'plugins', n, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(r, 'plugins', n, 'package.json'), JSON.stringify({ name: n, version }) + '\n');
    fs.writeFileSync(path.join(r, 'plugins', n, 'lib', 'index.js'), `export const marker = '${n}-${tag || version}';\n`);
  }
  return r;
}

const kitCache = new Map();
/** { zip, sums, name, stageDir, version }; bytes of the gateway and validators carry their own version for the fake smoke runner. */
function buildKit(version, { gw, val, tag } = {}) {
  const key = JSON.stringify([version, gw, val, tag]);
  if (kitCache.has(key)) return kitCache.get(key);
  const repo = fakeRepo(version, tag), out = tmp('kit');
  const res = buildReleaseBundle({
    repoRoot: repo, outDir: out, skipNative: true,
    prebuilt: { 'arc-gateway.exe': Buffer.from(gw ?? `GW-${version}`), 'arc-validators.exe': Buffer.from(val ?? `VAL-${version}`) },
  });
  const kit = { version, name: path.basename(res.zipPath), zip: fs.readFileSync(res.zipPath), sums: fs.readFileSync(res.sumsPath, 'utf8'), stageDir: path.join(out, `Arc-Harness-Kit-${version}-win-x64`), out };
  rm(repo);
  kitCache.set(key, kit);
  return kit;
}
/** Re-pack a changed stage folder with the same command a release uses. */
function repack(kit, mutate) {
  const out = tmp('re'), stage = path.join(out, path.basename(kit.stageDir));
  fs.cpSync(kit.stageDir, stage, { recursive: true });
  mutate(stage);
  const zipPath = path.join(out, kit.name);
  const r = process.platform === 'win32'
    ? spawnSync(path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe'), ['-a', '-cf', zipPath, '-C', out, path.basename(stage)], { windowsHide: true })
    : spawnSync('zip', ['-rq', zipPath, path.basename(stage)], { cwd: out, windowsHide: true });
  assert.equal(r.status, 0, String(r.stderr));
  const zip = fs.readFileSync(zipPath);
  return { ...kit, zip, sums: `${sha(zip)}  ${kit.name}\n` + kit.sums.split('\n').slice(1).join('\n') };
}

// ---- the fake release server
function startServer() {
  const state = { releases: [], assets: new Map(), hits: [], redirect: null };
  const srv = http.createServer((req, res) => {
    state.hits.push(req.url);
    if (req.url.startsWith('/repos/o/r/releases')) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(state.releases));
    }
    if (req.url.startsWith('/redir/')) {
      res.statusCode = 302; res.setHeader('location', state.redirect); return res.end();
    }
    const a = state.assets.get(req.url);
    if (a) { res.setHeader('content-type', 'application/octet-stream'); return res.end(a); }
    res.statusCode = 404; res.end('no');
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${srv.address().port}`;
    state.base = base;
    state.publish = (kit, extra = {}) => {
      state.assets.set(`/dl/${kit.version}/${kit.name}`, kit.zip);
      state.assets.set(`/dl/${kit.version}/SHA256SUMS.txt`, Buffer.from(kit.sums));
      const rel = {
        tag_name: `v${kit.version}`, draft: false, prerelease: false, html_url: `${base}/rel/${kit.version}`, body: `Notes for ${kit.version}`,
        published_at: '2026-11-20T00:00:00Z',
        assets: [
          { name: kit.name, browser_download_url: `${base}/dl/${kit.version}/${kit.name}`, size: kit.zip.length },
          { name: 'SHA256SUMS.txt', browser_download_url: `${base}/dl/${kit.version}/SHA256SUMS.txt`, size: kit.sums.length },
        ],
        ...extra,
      };
      state.releases = state.releases.filter((x) => x.tag_name !== rel.tag_name).concat(rel);
      return rel;
    };
    resolve({ srv, state, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }) });
  }));
}

// ---- a throwaway installation
function makeInstall(version = '0.6.0') {
  const root = tmp('home');
  const home = path.join(root, '.arc'), gatewayDir = path.join(root, 'ArcGateway'), binDir = path.join(home, 'bin');
  for (const n of UPDATE_PLUGINS) {
    for (const base of [path.join(home, 'local-plugins', n), path.join(home, 'profiles', 'desktop', 'node_modules', n)]) {
      fs.mkdirSync(path.join(base, 'lib'), { recursive: true });
      fs.writeFileSync(path.join(base, 'package.json'), JSON.stringify({ name: n, version }) + '\n');
      fs.writeFileSync(path.join(base, 'lib', 'index.js'), `export const marker = '${n}-${version}';\n`);
    }
  }
  fs.mkdirSync(path.join(home, 'local-plugins', 'arc-vertex'), { recursive: true }); // not in the kit: must stay
  fs.writeFileSync(path.join(home, 'local-plugins', 'arc-vertex', 'package.json'), '{"name":"arc-vertex","version":"9.9.9"}');
  fs.mkdirSync(gatewayDir, { recursive: true });
  fs.writeFileSync(path.join(gatewayDir, 'arc-gateway.exe'), `GW-${version}`);
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'arc-validators.exe'), `VAL-${version}`);
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, 'sessions', 'keep.txt'), 'my conversation');
  fs.writeFileSync(path.join(home, '.credentials.yaml'), 'refs: {}');
  fs.writeFileSync(path.join(home, 'gateway.json'), '{"routes":[]}');
  return { root, home, gatewayDir, binDir };
}
const dirHash = (d, skip = 'updates') => {
  const out = [];
  (function walk(x) { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const f = path.join(x, e.name); if (e.isDirectory() && e.name === skip && x === d) continue; e.isDirectory() ? walk(f) : out.push(path.relative(d, f) + ':' + sha(fs.readFileSync(f))); } })(d);
  return out.sort().join('|');
};

// fake smoke runner: the file bytes say what the program would print
const fakeRun = (file, args) => {
  const b = fs.readFileSync(file, 'utf8');
  if (b.startsWith('GW-') && args[0] === 'version') return b === 'GW-BROKEN' ? { status: 1, stdout: '', stderr: 'boom' } : { status: 0, stdout: `arc-gateway ${b.slice(3)}\n`, stderr: '' };
  if (b.startsWith('VAL-') && args[0] === 'sha256') return b === 'VAL-BROKEN' ? { status: 1, stdout: '', stderr: 'boom' } : { status: 0, stdout: JSON.stringify({ sha256: sha('abc') }) + '\n', stderr: '' };
  return { status: 2, stdout: '', stderr: 'usage' };
};

async function setup({ version = '0.6.0', ...over } = {}) {
  const inst = makeInstall(version);
  const srv = await startServer();
  const phases = [];
  const make = (o = {}) => createUpdater({
    home: inst.home, gatewayDir: inst.gatewayDir, validatorsDirs: [inst.binDir], repo: 'o/r', api: srv.state.base,
    env: ENV, run: fakeRun, onPhase: (s) => phases.push(s.phase), retryMs: 1, ...over, ...o,
  });
  const cleanup = async () => { await srv.close(); rm(inst.root); };
  return { ...inst, srv, phases, make, u: make(), cleanup };
}
const marker = (inst, n = 'arc-core') => fs.readFileSync(path.join(inst.home, 'local-plugins', n, 'lib', 'index.js'), 'utf8');

// =====================================================================================================
test('version helpers: strict x.y.z only, numeric order', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.6.0', '0.6.1'), -1);
  const rel = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets: [], ...extra });
  const pick = pickRelease([rel('v0.5.0'), rel('v0.7.0', { draft: true }), rel('v0.8.0', { prerelease: true }), rel('nightly'), rel('v1.0.0-rc.1'), rel('0.6.1'), rel('v0.6.0')]);
  assert.equal(pick.version, '0.6.1', 'draft, pre-release and odd tags are skipped; a tag without v works');
  assert.equal(pickRelease([rel('nightly')]), null);
});

test('URL policy: https GitHub hosts only; loopback only behind the test switch', () => {
  for (const ok of ['https://api.github.com/repos/o/r/releases', 'https://github.com/o/r/releases/download/v1/x.zip', 'https://objects.githubusercontent.com/a', 'https://release-assets.githubusercontent.com/a']) {
    assert.doesNotThrow(() => assertAllowedUrl(ok, {}), ok);
  }
  for (const bad of ['http://api.github.com/x', 'https://evil.example/x', 'https://github.com.evil.example/x', 'https://user:pw@github.com/x', 'https://github.com:8443/x', 'http://127.0.0.1:9/x', 'https://127.0.0.1/x', 'file:///c:/x', 'https://[::1]/x']) { // privacy-scan: allow (a made-up URL with credentials)
    assert.throws(() => assertAllowedUrl(bad, {}), /ERR_UPDATE_HOST/, bad);
  }
  assert.doesNotThrow(() => assertAllowedUrl('http://127.0.0.1:9/x', ENV));
  assert.throws(() => assertAllowedUrl('http://evil.example:9/x', ENV), /ERR_UPDATE_HOST/);
});

test('zip reader: reads a real kit made by the release bundler (data descriptors, folders)', () => {
  const kit = buildKit('0.7.0');
  const entries = readZip(kit.zip);
  const names = entries.map((e) => e.name);
  assert.ok(names.includes('Arc-Harness-Kit-0.7.0-win-x64/RELEASE-MANIFEST.json'));
  assert.ok(names.includes('Arc-Harness-Kit-0.7.0-win-x64/bin/arc-gateway.exe'));
  const gw = entries.find((e) => e.name.endsWith('bin/arc-gateway.exe'));
  assert.equal(gw.data().toString(), 'GW-0.7.0');
  const man = JSON.parse(entries.find((e) => e.name.endsWith('RELEASE-MANIFEST.json')).data());
  assert.equal(man.version, '0.7.0');
  assert.equal(man.files['bin/arc-gateway.exe'], sha('GW-0.7.0'), 'the bundler writes a digest for every file under plugins/ and bin/');
  assert.equal(man.files['plugins/arc-core/lib/index.js'], sha("export const marker = 'arc-core-0.7.0';\n"));
});

// --- a hand-made zip writer, only for hostile archives
function crc32(buf) { return zlib.crc32(buf) >>> 0; }
function makeZip(files, { lie } = {}) {
  const locals = [], central = []; let off = 0;
  for (const [name, data] of files) {
    const nb = Buffer.from(name), raw = Buffer.from(data), comp = zlib.deflateRawSync(raw);
    const size = lie ? lie(raw.length) : raw.length;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(size, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(size, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, comp); central.push(Buffer.concat([ch, nb])); off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('zip reader: refuses zip-slip, absolute and drive paths, backslashes, duplicates; enforces size caps and CRC', () => {
  for (const bad of ['../evil.txt', 'a/../../evil.txt', '/abs.txt', 'C:/win.txt', 'a\\b.txt', 'a/b:stream', 'a//b']) {
    assert.throws(() => readZip(makeZip([[bad, 'x']])), /ERR_ZIP/, bad);
  }
  assert.throws(() => readZip(makeZip([['a.txt', 'x'], ['a.txt', 'y']])), /ERR_ZIP_DUPLICATE/);
  assert.throws(() => readZip(makeZip([['a.txt', 'x'.repeat(100)]]), { maxEntryBytes: 50 }), /ERR_ZIP_SIZE/);
  assert.throws(() => readZip(makeZip([['a.txt', 'x'.repeat(40)], ['b.txt', 'y'.repeat(40)]]), { maxTotalBytes: 60 }), /ERR_ZIP_SIZE/);
  assert.throws(() => readZip(makeZip([['a.txt', 'x'], ['b.txt', 'y'], ['c.txt', 'z']]), { maxEntries: 2 }), /ERR_ZIP_ENTRIES/);
  assert.throws(() => readZip(makeZip([['a.txt', 'x'.repeat(100)]], { lie: () => 5 })).map((e) => e.data()), /ERR_ZIP/); // declared size lower than the real one
  assert.throws(() => readZip(Buffer.from('not a zip at all')), /ERR_ZIP/);
  const ok = readZip(makeZip([['a/b.txt', 'hello']]));
  assert.equal(ok[0].data().toString(), 'hello');
});

// =====================================================================================================
test('newer release: check says available and installable', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  const s = await e.u.check();
  assert.equal(s.installed, '0.6.0');
  assert.equal(s.latest, '0.7.0');
  assert.equal(s.available, true);
  assert.equal(s.installable, true);
  assert.match(s.notes, /Notes for 0.7.0/);
  assert.equal(s.phase, 'idle');
});

test('same version: nothing to install', async (t) => {
  const e = await setup({ version: '0.7.0' }); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  const s = await e.u.check();
  assert.equal(s.available, false);
  assert.equal(s.latest, '0.7.0');
  const r = await e.u.install();
  assert.equal(r.ok, false);
  assert.match(r.error, /up to date|current/i);
});

test('release without assets (like v0.5.0): no installable kit, and install refuses', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.releases = [{ tag_name: 'v0.7.0', draft: false, prerelease: false, html_url: `${e.srv.state.base}/r`, body: 'x', assets: [] }];
  const s = await e.u.check();
  assert.equal(s.available, true);
  assert.equal(s.installable, false);
  assert.equal(s.reason, 'no-kit');
  const r = await e.u.install();
  assert.equal(r.ok, false);
  assert.match(r.error, /no installable kit/i);
  assert.equal(marker(e), "export const marker = 'arc-core-0.6.0';\n");
});

test('bad checksum: refused before any file changes, and the version is remembered as failed', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  const kit = buildKit('0.7.0');
  const before = dirHash(e.home);
  e.srv.state.publish({ ...kit, sums: `${'0'.repeat(64)}  ${kit.name}\n` });
  const r = await e.u.install();
  assert.equal(r.ok, false);
  assert.match(r.error, /checksum|digest/i);
  assert.equal(dirHash(e.home), before, 'no installed file changed');
  assert.equal(fs.readFileSync(path.join(e.gatewayDir, 'arc-gateway.exe'), 'utf8'), 'GW-0.6.0');
  assert.equal(e.u.getState().skipped.version, '0.7.0');
  assert.equal(e.u.getState().phase, 'failed');
});

test('a kit file that differs from the manifest digest is refused', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  const bad = repack(buildKit('0.7.0'), (stage) => fs.writeFileSync(path.join(stage, 'plugins', 'arc-hoh', 'lib', 'index.js'), 'tampered'));
  e.srv.state.publish(bad);
  const r = await e.u.install();
  assert.equal(r.ok, false);
  assert.match(r.error, /manifest|digest/i);
  assert.equal(marker(e, 'arc-hoh'), "export const marker = 'arc-hoh-0.6.0';\n");
});

test('a binary digest that disagrees with SHA256SUMS.txt is refused', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  const kit = buildKit('0.7.0');
  const lines = kit.sums.trim().split('\n').map((l) => (l.endsWith('bin/arc-gateway.exe') ? `${'1'.repeat(64)}  bin/arc-gateway.exe` : l));
  e.srv.state.publish({ ...kit, sums: lines.join('\n') + '\n' });
  const r = await e.u.install();
  assert.equal(r.ok, false);
  assert.match(r.error, /arc-gateway\.exe/);
});

test('files of a later kit that the updater does not handle are ignored, and a file it handles but the manifest lacks is refused', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  const extra = repack(buildKit('0.7.0'), (stage) => {
    fs.mkdirSync(path.join(stage, 'plugins', 'arc-future', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(stage, 'plugins', 'arc-future', 'lib', 'x.js'), 'x');
    const f = path.join(stage, 'RELEASE-MANIFEST.json'), m = JSON.parse(fs.readFileSync(f, 'utf8'));
    m.files['plugins/arc-future/lib/x.js'] = sha('x'); fs.writeFileSync(f, JSON.stringify(m));
  });
  e.srv.state.publish(extra);
  const r = await e.u.install();
  assert.equal(r.ok, true, r.error);
  assert.equal(fs.existsSync(path.join(e.home, 'local-plugins', 'arc-future')), false, 'a plugin outside the seven is never installed');
  const unlisted = repack(buildKit('0.7.1'), (stage) => fs.writeFileSync(path.join(stage, 'plugins', 'arc-hoh', 'lib', 'extra.js'), 'sneaky'));
  e.srv.state.publish(unlisted);
  const r2 = await e.u.install({ version: '0.7.1' });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /not in the manifest/);
});

test('a kit without the per-file digest list fails closed', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  const old = repack(buildKit('0.7.0'), (stage) => {
    const f = path.join(stage, 'RELEASE-MANIFEST.json'), m = JSON.parse(fs.readFileSync(f, 'utf8'));
    delete m.files; fs.writeFileSync(f, JSON.stringify(m));
  });
  e.srv.state.publish(old);
  const r = await e.u.install();
  assert.equal(r.ok, false);
  assert.match(r.error, /file digest/i);
  assert.equal(marker(e), "export const marker = 'arc-core-0.6.0';\n");
});

test('kit whose manifest names another version than the release is refused', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  const kit = buildKit('0.7.0');
  const other = buildKit('0.7.1');
  e.srv.state.publish({ ...kit, zip: other.zip, sums: `${sha(other.zip)}  ${kit.name}\n` + other.sums.split('\n').slice(1).join('\n') });
  const r = await e.u.install();
  assert.equal(r.ok, false);
  assert.match(r.error, /version/i);
});

test('progress: a valid newer release ends installed and healthy, with data and other plugins untouched', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  const keepBefore = dirHash(path.join(e.home, 'sessions'));
  const vertexBefore = dirHash(path.join(e.home, 'local-plugins', 'arc-vertex'));
  const r = await e.u.install();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.version, '0.7.0');
  const order = [...new Set(e.phases)];
  for (const want of ['checking', 'downloading', 'verifying', 'staging', 'installing', 'testing', 'done']) assert.ok(order.includes(want), `phase ${want} in ${order}`);
  assert.deepEqual(order.filter((p) => ['downloading', 'verifying', 'staging', 'installing', 'testing', 'done'].includes(p)), ['downloading', 'verifying', 'staging', 'installing', 'testing', 'done']);
  for (const n of UPDATE_PLUGINS) {
    assert.equal(marker(e, n), `export const marker = '${n}-0.7.0';\n`, `${n} in local-plugins`);
    assert.equal(fs.readFileSync(path.join(e.home, 'profiles', 'desktop', 'node_modules', n, 'lib', 'index.js'), 'utf8'), `export const marker = '${n}-0.7.0';\n`, `${n} in the profile copy that the app loads`);
  }
  assert.equal(fs.readFileSync(path.join(e.gatewayDir, 'arc-gateway.exe'), 'utf8'), 'GW-0.7.0');
  assert.equal(fs.readFileSync(path.join(e.binDir, 'arc-validators.exe'), 'utf8'), 'VAL-0.7.0');
  assert.equal(dirHash(path.join(e.home, 'sessions')), keepBefore);
  assert.equal(dirHash(path.join(e.home, 'local-plugins', 'arc-vertex')), vertexBefore, 'a plugin outside the kit stays');
  assert.equal(fs.readFileSync(path.join(e.home, '.credentials.yaml'), 'utf8'), 'refs: {}');
  const s = e.u.getState();
  assert.equal(s.installed, '0.7.0');
  assert.equal(s.available, false);
  assert.equal(s.phase, 'done');
  assert.equal(s.restartNeeded, true, 'the app asks for a restart; it never closes itself');
  assert.equal(s.hasBackup, true);
  assert.equal(s.healthy, true);
});

test('validators binary is swapped only where a copy already exists', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  fs.rmSync(path.join(e.binDir, 'arc-validators.exe'));
  e.srv.state.publish(buildKit('0.7.0'));
  const r = await e.u.install();
  assert.equal(r.ok, true, r.error);
  assert.equal(fs.existsSync(path.join(e.binDir, 'arc-validators.exe')), false, 'no new copy appears');
  assert.deepEqual(e.u.getState().skippedBinaries, ['arc-validators.exe']);
});

test('rollback restores every plugin copy and binary, remembers the version, and auto skips only that version', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  assert.equal((await e.u.install()).ok, true);
  const rb = await e.u.rollback();
  assert.equal(rb.ok, true, rb.error);
  for (const n of UPDATE_PLUGINS) {
    assert.equal(marker(e, n), `export const marker = '${n}-0.6.0';\n`);
    assert.equal(fs.readFileSync(path.join(e.home, 'profiles', 'desktop', 'node_modules', n, 'lib', 'index.js'), 'utf8'), `export const marker = '${n}-0.6.0';\n`);
  }
  assert.equal(fs.readFileSync(path.join(e.gatewayDir, 'arc-gateway.exe'), 'utf8'), 'GW-0.6.0');
  assert.equal(fs.readFileSync(path.join(e.binDir, 'arc-validators.exe'), 'utf8'), 'VAL-0.6.0');
  let s = e.u.getState();
  assert.equal(s.installed, '0.6.0');
  assert.equal(s.hasBackup, false);
  assert.deepEqual({ v: s.skipped.version, why: s.skipped.reason }, { v: '0.7.0', why: 'rolled-back' });
  assert.deepEqual({ phase: s.phase, failed: s.failed, restart: s.restartNeeded }, { phase: 'rolled-back', failed: false, restart: true }, 'a roll back the user asked for is no failure');
  // auto mode skips 0.7.0 …
  e.u.setMode('auto');
  const t1 = await e.u.tick();
  assert.equal(t1.action, 'skipped');
  assert.equal(marker(e), "export const marker = 'arc-core-0.6.0';\n");
  // … but installs a newer 0.7.1
  e.srv.state.publish(buildKit('0.7.1'));
  const t2 = await e.u.tick();
  assert.equal(t2.action, 'installed');
  assert.equal(e.u.getState().installed, '0.7.1');
  // a manual install of the skipped version still works
  e.srv.state.releases = e.srv.state.releases.filter((x) => x.tag_name !== 'v0.7.1');
  await e.u.rollback();
  const man = await e.u.install({ version: '0.7.0' });
  assert.equal(man.ok, true, man.error);
});

test('post-swap failure rolls back by itself and remembers the version as failed', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0', { gw: 'GW-0.7.0' }));
  // the live gateway fails its check only after the swap: the staged copy passes
  let swapped = false;
  const u = e.make({ run: (file, args) => (file.startsWith(e.gatewayDir) && swapped ? { status: 1, stdout: '', stderr: 'dies' } : fakeRun(file, args)), onPhase: (s) => { if (s.phase === 'testing') swapped = true; } });
  const r = await u.install();
  assert.equal(r.ok, false);
  assert.match(r.error, /rolled back/i);
  assert.equal(u.getState().phase, 'rolled-back');
  assert.equal(u.getState().failed, true, 'a failed update that was put back is a failure');
  // a roll back by the user after it clears the mark, although the phase has the same name
  assert.equal((await e.make().getState()).failed, false, 'a fresh process reports no failure');
  for (const n of UPDATE_PLUGINS) assert.equal(marker(e, n), `export const marker = '${n}-0.6.0';\n`);
  assert.equal(fs.readFileSync(path.join(e.gatewayDir, 'arc-gateway.exe'), 'utf8'), 'GW-0.6.0');
  assert.deepEqual({ v: u.getState().skipped.version, why: u.getState().skipped.reason.split(':')[0] }, { v: '0.7.0', why: 'failed' });
});

test('a broken staged binary is caught before anything is swapped', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0', { gw: 'GW-BROKEN' }));
  const r = await e.u.install();
  assert.equal(r.ok, false);
  assert.match(r.error, /arc-gateway\.exe/);
  assert.equal(marker(e), "export const marker = 'arc-core-0.6.0';\n");
});

test('a swap that fails half way restores what it already moved', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  const real = fs.renameSync;
  const flaky = { ...fs, renameSync: (a, b) => { if (String(b).includes('arc-molecullage') && !String(a).includes('backup')) { const err = new Error('EPERM: busy'); err.code = 'EPERM'; err.path = String(a); err.dest = String(b); throw err; } return real(a, b); } };
  const u = e.make({ fs: flaky });
  const r = await u.install();
  assert.equal(r.ok, false);
  assert.match(r.error, /^Files of arc-molecullage are in use, so nothing was changed\./, 'plain words, no raw system text (found in the live test)');
  assert.ok(r.error.length <= 90, r.error);
  assert.equal(u.getState().skipped, null, 'a file in use is temporary: the version is not marked as bad');
  for (const nme of UPDATE_PLUGINS) assert.equal(marker(e, nme), `export const marker = '${nme}-0.6.0';\n`, nme);
  assert.equal(fs.readFileSync(path.join(e.gatewayDir, 'arc-gateway.exe'), 'utf8'), 'GW-0.6.0');
});

test('locked old binary (injected): the backup moves aside, a failed delete is swept later', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  assert.equal((await e.u.install()).ok, true);
  // second update: the first backup copy of the exe is "running" and cannot be deleted
  e.srv.state.publish(buildKit('0.8.0'));
  let locked = true;
  const realRm = fs.rmSync;
  const lockedFs = { ...fs, rmSync: (p, o) => { if (locked && /arc-gateway\.exe\.(arc-backup|stale)/.test(String(p))) { const err = new Error('EBUSY: resource busy or locked'); err.code = 'EBUSY'; throw err; } return realRm(p, o); } };
  const u = e.make({ fs: lockedFs });
  const r = await u.install();
  assert.equal(r.ok, true, r.error);
  assert.equal(fs.readFileSync(path.join(e.gatewayDir, 'arc-gateway.exe'), 'utf8'), 'GW-0.8.0');
  const stale = () => fs.readdirSync(e.gatewayDir).filter((f) => f.includes('.stale-'));
  assert.ok(stale().length >= 1, 'the locked copy stays under a .stale name');
  locked = false;
  u.sweep();
  assert.equal(stale().length, 0, 'swept once it is unlocked');
});

test('locked old binary (real, Windows): a running exe is renamed aside and the update still lands', { skip: process.platform !== 'win32' }, async (t) => {
  const e = await setup(); t.after(e.cleanup);
  const exe = path.join(e.gatewayDir, 'arc-gateway.exe');
  fs.copyFileSync(process.execPath, exe); // a real running program under the gateway name
  const child = spawn(exe, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true });
  t.after(() => { child.kill(); });
  await new Promise((r) => setTimeout(r, 300));
  assert.throws(() => fs.rmSync(exe), /EBUSY|EPERM|EACCES/, 'the exe really is locked');
  e.srv.state.publish(buildKit('0.7.0'));
  const r = await e.u.install();
  child.kill();
  assert.equal(r.ok, true, r.error);
  assert.equal(fs.readFileSync(exe, 'utf8'), 'GW-0.7.0');
  assert.ok(fs.readdirSync(e.gatewayDir).some((f) => f.startsWith('arc-gateway.exe.')), 'the old running copy sits beside it');
});

test('redirects are followed only to allowed hosts', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  const rel = e.srv.state.publish(buildKit('0.7.0'));
  rel.assets[0].browser_download_url = `${e.srv.state.base}/redir/zip`;
  e.srv.state.redirect = 'http://evil.example:9/x.zip';
  const r = await e.u.install();
  assert.equal(r.ok, false);
  assert.match(r.error, /ERR_UPDATE_HOST|not allowed/i);
});

test('download size cap: a zip larger than the cap is refused before it is read in full', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  const u = e.make({ limits: { maxKitBytes: 1000 } });
  const r = await u.install();
  assert.equal(r.ok, false);
  assert.match(r.error, /too large|size/i);
});

test('network failure: reported as a failed check, never throws', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  const u = e.make({ api: 'http://127.0.0.1:1' });
  const s = await u.check();
  assert.equal(s.phase, 'failed');
  assert.match(s.message, /could not|reach|fetch/i);
});

test('modes: saved, validated, and obeyed by the timer; manual check and install work in every mode', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  assert.equal(e.u.getState().mode, 'notify', 'default');
  assert.throws(() => e.u.setMode('sometimes'), /mode/i);
  e.u.setMode('off');
  assert.equal(e.make().getState().mode, 'off', 'saved to disk');
  assert.equal((await e.u.tick()).action, 'off');
  assert.equal(e.srv.state.hits.length, 0, 'off never looks');
  const manual = await e.u.check();
  assert.equal(manual.available, true, 'a manual check works when off');
  e.u.setMode('notify');
  const tk = await e.u.tick();
  assert.equal(tk.action, 'notified');
  assert.equal(marker(e), "export const marker = 'arc-core-0.6.0';\n", 'notify never installs');
  e.u.setMode('auto');
  const ta = await e.u.tick();
  assert.equal(ta.action, 'installed');
  assert.equal(e.u.getState().installed, '0.7.0');
});

test('auto does not retry a version that failed; a newer one is tried', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  const kit = buildKit('0.7.0');
  e.srv.state.publish({ ...kit, sums: `${'0'.repeat(64)}  ${kit.name}\n` });
  e.u.setMode('auto');
  assert.equal((await e.u.tick()).action, 'failed');
  const hitsAfterFirst = e.srv.state.hits.filter((h) => h.startsWith('/dl/')).length;
  assert.equal((await e.u.tick()).action, 'skipped');
  assert.equal(e.srv.state.hits.filter((h) => h.startsWith('/dl/')).length, hitsAfterFirst, 'no second download');
  e.srv.state.publish(buildKit('0.7.2'));
  assert.equal((await e.u.tick()).action, 'installed');
});

test('two installs at once: the second is refused', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  const [a, b] = await Promise.all([e.u.install(), e.u.install()]);
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1);
  assert.match([a, b].find((x) => !x.ok).error, /already running|busy/i);
});

test('a lock file from another process refuses an update; an old one is cleared', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  fs.mkdirSync(path.join(e.home, 'updates'), { recursive: true });
  fs.writeFileSync(path.join(e.home, 'updates', 'lock'), JSON.stringify({ pid: 1, at: Date.now() }));
  const r = await e.u.install();
  assert.equal(r.ok, false);
  assert.match(r.error, /already running/i);
  fs.writeFileSync(path.join(e.home, 'updates', 'lock'), JSON.stringify({ pid: 1, at: Date.now() - 3 * 3600 * 1000 }));
  const r2 = await e.u.install();
  assert.equal(r2.ok, true, r2.error);
  assert.equal(fs.existsSync(path.join(e.home, 'updates', 'lock')), false, 'the lock is released');
});

test('the test switch refuses the real data folder and the real gateway folder', () => {
  assert.throws(() => createUpdater({ env: ENV }), /ERR_UPDATE_TEST_PATHS/);
  assert.throws(() => createUpdater({ env: ENV, home: path.join(os.homedir(), '.arc'), gatewayDir: tmp('gw') }), /ERR_UPDATE_TEST_PATHS/);
  assert.throws(() => createUpdater({ env: ENV, home: tmp('h'), gatewayDir: path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'ArcGateway') }), /ERR_UPDATE_TEST_PATHS/);
});

test('without the test switch, the API address and repository cannot be changed', async (t) => {
  const inst = makeInstall(); t.after(() => rm(inst.root));
  const seen = [];
  const u = createUpdater({ home: inst.home, gatewayDir: inst.gatewayDir, env: {}, api: 'http://127.0.0.1:1', repo: 'evil/repo', fetchImpl: async (url) => { seen.push(url); throw new Error('network off'); } });
  await u.check();
  assert.deepEqual(seen, ['https://api.github.com/repos/danilkotelnikov/Arc-Science/releases?per_page=30']);
});

test('the retired desktop app is never touched: no path of the updater points at port 8080 or %LOCALAPPDATA%\\ArcScience', () => {
  const src = fs.readFileSync(path.join(here, '..', 'lib', 'updater.js'), 'utf8');
  assert.equal(/8080|ArcScience|app\.asar/i.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), false);
});

// ---- the console routes
const post = (p, body, headers = {}) => new Request(`http://127.0.0.1:7777/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('console routes: state, check, mode, install, rollback; POST only; foreign origins refused', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  const store = createResearchSessionStore();
  const call = (p, body, headers) => serveConsoleRoute(post(p, body, headers), {}, store, { updater: e.u });
  const st = await call('api/arc-core/update/state', {});
  assert.equal(st.ok, true);
  assert.equal(st.installed, '0.6.0');
  assert.equal(st.mode, 'notify');
  const get = await serveConsoleRoute(new Request('http://127.0.0.1:7777/api/arc-core/update/action'), {}, store, { updater: e.u });
  assert.equal(get.status, 405);
  const foreign = await call('api/arc-core/update/action', { kind: 'check' }, { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal((await call('api/arc-core/update/action', { kind: 'check' }, { origin: 'http://127.0.0.1:7777' })).ok, true);
  assert.equal((await call('api/arc-core/update/action', { kind: 'check' }, { origin: 'http://localhost:3000' })).ok, true);
  const act = 'api/arc-core/update/action';
  const raw = (url, headers, body = '{"kind":"check"}') => serveConsoleRoute(new Request(url, { method: 'POST', headers, body }), {}, store, { updater: e.u });
  // the desktop window: http://arc.internal/..., Origin "null", JSON body (the shape seen in the live test)
  assert.equal((await raw(`http://arc.internal/${act}`, { 'content-type': 'application/json', origin: 'null' })).ok, true, 'the desktop window may act');
  assert.equal((await raw(`http://127.0.0.1:7777/${act}`, { 'content-type': 'text/plain', origin: 'null' })).status, 415, 'a cross-site form cannot send JSON, so a plain body is refused');
  assert.equal((await raw(`http://127.0.0.1:7777/${act}`, {})).status, 415);
  assert.equal((await raw(`http://evil.example:7777/${act}`, { 'content-type': 'application/json', origin: 'http://evil.example:7777' })).status, 403, 'a rebound host name is refused');
  assert.equal((await raw(`http://evil.example:7777/${act}`, { 'content-type': 'application/json' })).status, 403);
  assert.equal((await raw(`http://arc.internal/${act}`, { 'content-type': 'application/json', origin: 'arc-app://app' })).ok, true);
  assert.equal((await raw(`http://arc.internal/${act}`, { 'content-type': 'application/json', origin: 'arc-app://evil' })).status, 403);
  const chk = await call('api/arc-core/update/action', { kind: 'check' });
  assert.equal(chk.available, true);
  assert.equal((await call('api/arc-core/update/action', { kind: 'mode', mode: 'auto' })).mode, 'auto');
  assert.equal((await call('api/arc-core/update/action', { kind: 'mode', mode: 'bogus' })).ok, false);
  await call('api/arc-core/update/action', { kind: 'mode', mode: 'notify' });
  const snap = await call('api/arc-core/console/state', {});
  assert.deepEqual({ a: snap.update.available, l: snap.update.latest }, { a: true, l: '0.7.0' }, 'the console state carries a small badge for the connector button');
  const ins = await call('api/arc-core/update/action', { kind: 'install', wait: true });
  assert.equal(ins.ok, true, ins.error);
  assert.equal(ins.state.installed, '0.7.0');
  assert.equal(ins.state.restartNeeded, true);
  const rb = await call('api/arc-core/update/action', { kind: 'rollback' });
  assert.equal(rb.ok, true, rb.error);
  assert.equal(rb.state.installed, '0.6.0');
  assert.equal((await call('api/arc-core/update/action', { kind: 'nonsense' })).ok, false);
});

test('console routes: without an updater the update routes say so', async () => {
  const r = await serveConsoleRoute('api/arc-core/update/state', {}, createResearchSessionStore(), {});
  assert.equal(r.ok, false);
});

test('a failed download is not remembered as a bad version; a kit missing a plugin is refused', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  const kit = buildKit('0.7.0');
  const rel = e.srv.state.publish(kit);
  e.srv.state.assets.delete(`/dl/0.7.0/${kit.name}`);
  const r = await e.u.install();
  assert.equal(r.ok, false);
  assert.equal(e.u.getState().skipped, null, 'a 404 or a dropped connection may be temporary');
  void rel;
  const thin = repack(buildKit('0.7.1'), (stage) => {
    fs.rmSync(path.join(stage, 'plugins', 'arc-theme'), { recursive: true });
    const f = path.join(stage, 'RELEASE-MANIFEST.json'), m = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const k of Object.keys(m.files)) if (k.startsWith('plugins/arc-theme/')) delete m.files[k];
    fs.writeFileSync(f, JSON.stringify(m));
  });
  e.srv.state.publish(thin);
  const r2 = await e.u.install({ version: '0.7.1' });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /arc-theme/);
});

test('a swap cut short by a crash is undone by the next update or by Roll back', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  assert.equal((await e.u.install()).ok, true);
  // pretend the process died during the swap: the journal says "swapping"
  const jf = path.join(e.home, 'updates', 'backup', 'backup.json');
  const j = JSON.parse(fs.readFileSync(jf, 'utf8')); j.status = 'swapping';
  fs.writeFileSync(jf, JSON.stringify(j));
  assert.equal(e.make().getState().hasBackup, false, 'a cut-short swap is not a finished backup');
  const rb = await e.make().rollback();
  assert.equal(rb.ok, true, rb.error);
  for (const n of UPDATE_PLUGINS) assert.equal(marker(e, n), `export const marker = '${n}-0.6.0';
`);
  assert.equal(fs.readFileSync(path.join(e.gatewayDir, 'arc-gateway.exe'), 'utf8'), 'GW-0.6.0');
});

// =====================================================================================================
// Review findings of 21.XI.2026 (Gemini 4 Carbon). Each test failed on the code of main f68496a before its fix.

// Two updates in a row: 0.6.0 -> 0.7.0 lands and keeps a backup; 0.8.0 then fails where breakAt says.
async function secondUpdateFails(t, breakAt) {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  assert.equal((await e.u.install()).ok, true);
  assert.equal(e.u.getState().backupVersion, '0.6.0');
  e.srv.state.publish(buildKit('0.8.0'));
  const real = fs.renameSync;
  const u = e.make({ fs: { ...fs, renameSync: (a, b) => {
    if (breakAt(String(a), String(b))) { const err = new Error(`EPERM: operation not permitted, rename '${a}' -> '${b}'`); err.code = 'EPERM'; err.path = String(a); err.dest = String(b); throw err; }
    return real(a, b);
  } } });
  const r = await u.install();
  assert.equal(r.ok, false);
  return { e, u, r };
}
const atFirstStep = (a, b) => a.endsWith(path.join('local-plugins', UPDATE_PLUGINS[0])) && b.includes(path.join('updates', 'backup'));
const atLastStep = (a) => a.endsWith('arc-validators.exe.arc-new');
const allAt = (e, v) => {
  for (const n of UPDATE_PLUGINS) {
    assert.equal(marker(e, n), `export const marker = '${n}-${v}';\n`, n);
    assert.equal(fs.readFileSync(path.join(e.home, 'profiles', 'desktop', 'node_modules', n, 'lib', 'index.js'), 'utf8'), `export const marker = '${n}-${v}';\n`, `profile copy of ${n}`);
  }
  assert.equal(fs.readFileSync(path.join(e.gatewayDir, 'arc-gateway.exe'), 'utf8'), `GW-${v}`, 'gateway');
  assert.equal(fs.readFileSync(path.join(e.binDir, 'arc-validators.exe'), 'utf8'), `VAL-${v}`, 'validators');
};

test('finding 1: when the first step of a second update fails, the programs are not swapped for an older backup', async (t) => {
  const { e, r } = await secondUpdateFails(t, atFirstStep);
  assert.match(r.error, /in use, so nothing was changed/);
  allAt(e, '0.7.0');
});

test('finding 2: a failed update keeps the earlier backup, so Roll back still works (first step fails)', async (t) => {
  const { e, u } = await secondUpdateFails(t, atFirstStep);
  assert.deepEqual({ has: u.getState().hasBackup, v: u.getState().backupVersion }, { has: true, v: '0.6.0' });
  const rb = await u.rollback();
  assert.equal(rb.ok, true, rb.error);
  allAt(e, '0.6.0');
});

test('finding 2: a failed update keeps the earlier backup, programs included (last step fails)', async (t) => {
  const { e, u } = await secondUpdateFails(t, atLastStep);
  allAt(e, '0.7.0');
  assert.deepEqual({ has: u.getState().hasBackup, v: u.getState().backupVersion }, { has: true, v: '0.6.0' });
  const rb = await u.rollback();
  assert.equal(rb.ok, true, rb.error);
  allAt(e, '0.6.0');
  // and a later update still lands and keeps its own backup
  const again = await e.make().install({ version: '0.8.0' });
  assert.equal(again.ok, true, again.error);
  allAt(e, '0.8.0');
  assert.equal(e.make().getState().backupVersion, '0.6.0');
});

test('finding 2: a process that dies right after the earlier backup was set aside does not lose it', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  assert.equal((await e.u.install()).ok, true);
  e.srv.state.publish(buildKit('0.8.0'));
  // the process "dies" on the first journal write of the second update; from then on it can change nothing
  let dead = false;
  const gone = () => { throw new Error('the process died here'); };
  const dying = { ...fs,
    writeFileSync: (f, ...rest) => { if (dead || /backup[\\/]backup\.json\./.test(String(f))) { dead = true; gone(); } return fs.writeFileSync(f, ...rest); },
    renameSync: (...a) => (dead ? gone() : fs.renameSync(...a)), rmSync: (...a) => (dead ? gone() : fs.rmSync(...a)), mkdirSync: (...a) => (dead ? gone() : fs.mkdirSync(...a)),
  };
  await e.make({ fs: dying }).install().catch(() => {}); // a dead process reports nothing
  assert.equal(dead, true);
  fs.rmSync(path.join(e.home, 'updates', 'lock'), { force: true }); // the lock of a dead process expires after 20 minutes; the test does not wait
  allAt(e, '0.7.0');
  const u = e.make();
  assert.deepEqual({ has: u.getState().hasBackup, v: u.getState().backupVersion }, { has: true, v: '0.6.0' });
  const rb = await u.rollback();
  assert.equal(rb.ok, true, rb.error);
  allAt(e, '0.6.0');
});

test('finding 3: a new copy that stays locked does not stop the old folder from coming back', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  const target = path.join(e.home, 'local-plugins', 'arc-hoh'), fresh = `${target}.arc-new`;
  const realMv = fs.renameSync, realRm = fs.rmSync;
  let held = false;
  const ebusy = (p) => { const err = new Error(`EBUSY: resource busy or locked, rename '${p}'`); err.code = 'EBUSY'; err.path = String(p); return err; };
  // a scanner takes hold of the new copy after it is written: it can be neither renamed nor deleted
  const u = e.make({ fs: { ...fs,
    renameSync: (a, b) => { if (String(a) === fresh) { held = true; throw ebusy(a); } return realMv(a, b); },
    rmSync: (p, o) => { if (held && String(p) === fresh) throw ebusy(p); return realRm(p, o); },
  } });
  const r = await u.install();
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(path.join(target, 'package.json')), true, 'the old plugin folder is back in its place');
  allAt(e, '0.6.0');
  assert.match(r.error, /^Files of arc-hoh are in use, so nothing was changed\./);
  assert.equal(u.getState().healthy, true);
  // once the scanner lets go, the same update lands
  held = false;
  const ok = await e.make().install();
  assert.equal(ok.ok, true, ok.error);
  allAt(e, '0.7.0');
});

test('finding 5: a folder name of only spaces does not get past the test switch', () => {
  const gw = tmp('gw'), h = tmp('h');
  try {
    // no method is called on the result: before the fix it pointed at the real data folder
    assert.throws(() => createUpdater({ env: { ...ENV, ARC_HOME: '   ', ARC_UPDATE_GATEWAY_DIR: gw } }), /ERR_UPDATE_TEST_PATHS/, 'ARC_HOME of spaces');
    assert.throws(() => createUpdater({ env: { ...ENV, ARC_HOME: h, ARC_UPDATE_GATEWAY_DIR: '  ' } }), /ERR_UPDATE_TEST_PATHS/, 'gateway folder of spaces');
    assert.throws(() => createUpdater({ env: { ...ENV, ARC_HOME: ` ${path.join(os.homedir(), '.arc')} `, ARC_UPDATE_GATEWAY_DIR: gw } }), /ERR_UPDATE_TEST_PATHS/, 'the real folder with spaces around it');
    assert.equal(typeof createUpdater({ env: { ...ENV, ARC_HOME: ` ${h} `, ARC_UPDATE_GATEWAY_DIR: gw } }).getState, 'function', 'a throwaway folder still works');
  } finally { rm(gw); rm(h); }
});

// ---- Faults that the independent reader (Gemini 4 Argon) found in the first round of these fixes. Each failed before its fix.
const PREV = '.arc-backup-prev';
const threeVersions = async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  assert.equal((await e.u.install()).ok, true);
  e.srv.state.publish(buildKit('0.8.0'));
  return e;
};

test('repair 1: a program backup left by an earlier cut-short clean-up never comes back as the current backup', async (t) => {
  const e = await threeVersions(t);
  assert.equal((await e.make().install()).ok, true); // now at 0.8.0, backup holds 0.7.0
  // what a process that died in the clean-up after an older update would leave behind: a 0.6.0 program under the "earlier backup" name
  fs.writeFileSync(path.join(e.binDir, `arc-validators.exe${PREV}`), 'VAL-0.6.0');
  e.srv.state.publish(buildKit('0.9.0'));
  // the next update dies while it sets the 0.7.0 backup aside: the gateway's copy has moved, the validators' copy has not,
  // and the old 0.6.0 leftover is still under the "earlier backup" name
  let dead = false;
  const gone = () => { throw new Error('the process died here'); };
  const dying = { ...fs,
    renameSync: (a, b) => { if (dead) gone(); if (String(a).endsWith(`arc-validators.exe${PREV}`)) { dead = true; gone(); } return fs.renameSync(a, b); },
    writeFileSync: (...a) => (dead ? gone() : fs.writeFileSync(...a)), rmSync: (...a) => (dead ? gone() : fs.rmSync(...a)), mkdirSync: (...a) => (dead ? gone() : fs.mkdirSync(...a)),
  };
  await e.make({ fs: dying }).install().catch(() => {});
  assert.equal(dead, true);
  fs.rmSync(path.join(e.home, 'updates', 'lock'), { force: true });
  allAt(e, '0.8.0');
  const u = e.make();
  assert.equal(u.getState().backupVersion, '0.7.0');
  const rb = await u.rollback();
  assert.equal(rb.ok, true, rb.error);
  allAt(e, '0.7.0');
});

test('repair 2: after Roll back, a backup that a cut-short clean-up left behind does not show as a second Roll back', async (t) => {
  const e = await threeVersions(t);
  // 0.8.0 lands, but the clean-up of the 0.6.0 backup cannot run (as if the process died right after the update was written down)
  const prevRoot = path.join(e.home, 'updates', 'backup-prev');
  const u = e.make({ fs: { ...fs, renameSync: (a, b) => { if (String(a) === prevRoot && String(b).includes(`${path.sep}stale${path.sep}`)) throw new Error('the process died here'); return fs.renameSync(a, b); } } });
  assert.equal((await u.install()).ok, true);
  allAt(e, '0.8.0');
  assert.equal(fs.existsSync(prevRoot), true, 'the leftover is there');
  const v = e.make();
  assert.equal(v.getState().backupVersion, '0.7.0');
  assert.equal((await v.rollback()).ok, true);
  allAt(e, '0.7.0');
  assert.deepEqual({ has: v.getState().hasBackup, v: v.getState().backupVersion }, { has: false, v: null }, 'one Roll back, one step back');
  assert.equal((await v.rollback()).ok, false);
  allAt(e, '0.7.0');
});

test('repair 3: the earlier backup comes back even when the empty backup folder of the failed update cannot be deleted', async (t) => {
  const e = await threeVersions(t);
  const backupRoot = path.join(e.home, 'updates', 'backup');
  const real = fs.renameSync;
  const u = e.make({ fs: { ...fs,
    renameSync: (a, b) => { if (atFirstStep(String(a), String(b))) { const err = new Error(`EPERM: operation not permitted, rename '${a}' -> '${b}'`); err.code = 'EPERM'; err.path = String(a); throw err; } return real(a, b); },
    rmSync: (p, o) => { if (String(p) === backupRoot) { const err = new Error('EBUSY: resource busy or locked'); err.code = 'EBUSY'; throw err; } return fs.rmSync(p, o); },
  } });
  assert.equal((await u.install()).ok, false);
  allAt(e, '0.7.0');
  // the same process, while that folder is still held: Roll back must not answer "no backup"
  assert.deepEqual({ has: u.getState().hasBackup, v: u.getState().backupVersion }, { has: true, v: '0.6.0' });
  const rb = await u.rollback();
  assert.equal(rb.ok, true, rb.error);
  allAt(e, '0.6.0');
});

// ---- Faults that the independent reader found in the repairs above (second read, 21.XI.2026). Each failed before its fix.
// A leftover of the 0.6.0 backup: 0.8.0 landed, but its clean-up could not move the set-aside folder away.
async function leftoverAfterUpdate(t) {
  const e = await threeVersions(t);
  const prevRoot = path.join(e.home, 'updates', 'backup-prev');
  const u = e.make({ fs: { ...fs, renameSync: (a, b) => { if (String(a) === prevRoot && String(b).includes(`${path.sep}stale${path.sep}`)) throw new Error('the process died here'); return fs.renameSync(a, b); } } });
  assert.equal((await u.install()).ok, true);
  allAt(e, '0.8.0');
  return { e, prevRoot, prevJournal: path.join(prevRoot, 'backup.json') };
}
const diesAt = (when) => {
  let dead = false;
  const gone = () => { throw new Error('the process died here'); };
  return { isDead: () => dead, fs: { ...fs,
    renameSync: (a, b) => { if (dead) gone(); if (when(String(a), String(b))) { dead = true; gone(); } return fs.renameSync(a, b); },
    writeFileSync: (...a) => (dead ? gone() : fs.writeFileSync(...a)), rmSync: (...a) => (dead ? gone() : fs.rmSync(...a)), mkdirSync: (...a) => (dead ? gone() : fs.mkdirSync(...a)),
  } };
};

test('repair 4: a Roll back that dies in its clean-up does not leave an older backup that counts', async (t) => {
  const { e, prevRoot } = await leftoverAfterUpdate(t);
  const d = diesAt((a) => a === prevRoot);
  await e.make({ fs: d.fs }).rollback().catch(() => {});
  assert.equal(d.isDead(), true, 'the process died while it moved the leftover away');
  fs.rmSync(path.join(e.home, 'updates', 'lock'), { force: true });
  allAt(e, '0.7.0');
  const v = e.make();
  assert.notEqual(v.getState().backupVersion, '0.6.0', 'the older backup must not come back as a second Roll back');
  await v.rollback();
  allAt(e, '0.7.0');
  assert.equal(v.getState().hasBackup, false);
});

test('repair 5: a leftover folder never keeps its journal once its programs are cleared', async (t) => {
  const { e, prevRoot, prevJournal } = await leftoverAfterUpdate(t);
  e.srv.state.publish(buildKit('0.9.0'));
  // the next update dies while it clears the leftover, at the move of the leftover folder
  const d = diesAt((a) => a === prevRoot);
  await e.make({ fs: d.fs }).install().catch(() => {});
  assert.equal(d.isDead(), true);
  const programsLeft = fs.readdirSync(e.gatewayDir).concat(fs.readdirSync(e.binDir)).some((f) => f.endsWith(PREV));
  assert.equal(fs.existsSync(prevJournal) && !programsLeft, false, 'a journal without its programs would bring back half a backup');
  fs.rmSync(path.join(e.home, 'updates', 'lock'), { force: true });
  allAt(e, '0.8.0');
  const v = e.make();
  assert.equal(v.getState().backupVersion, '0.7.0');
  assert.equal((await v.rollback()).ok, true);
  allAt(e, '0.7.0');
  assert.equal(v.getState().hasBackup, false);
});

test('repair 6: while the older journal cannot be deleted, Roll back keeps its own journal, so the older backup cannot count', async (t) => {
  const e = await threeVersions(t);
  const prevRoot = path.join(e.home, 'updates', 'backup-prev'), prevJournal = path.join(prevRoot, 'backup.json');
  // a scanner holds the set-aside journal and its folder: through the clean-up of the 0.8.0 update and through the Roll back
  const held = { ...fs,
    rmSync: (p, o) => { if (String(p) === prevJournal && fs.existsSync(prevJournal)) { const err = new Error('EBUSY: resource busy or locked'); err.code = 'EBUSY'; throw err; } return fs.rmSync(p, o); },
    renameSync: (a, b) => { if (String(a) === prevRoot) { const err = new Error('EPERM: operation not permitted'); err.code = 'EPERM'; throw err; } return fs.renameSync(a, b); },
  };
  assert.equal((await e.make({ fs: held }).install()).ok, true);
  allAt(e, '0.8.0');
  assert.equal(fs.existsSync(prevJournal), true, 'the 0.6.0 backup is still set aside, journal included');
  const rb = await e.make({ fs: held }).rollback();
  assert.equal(rb.ok, true, rb.error);
  allAt(e, '0.7.0');
  // the scanner lets go; a second Roll back must not go one more version back
  const v = e.make();
  assert.notEqual(v.getState().backupVersion, '0.6.0', 'the older backup must not count');
  await v.rollback();
  allAt(e, '0.7.0');
  assert.equal(v.getState().hasBackup, false, 'the second Roll back only finished the clean-up');
});

test('console route: an install that the updater refuses at once is answered as a refusal; a real install still answers started', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  const store = createResearchSessionStore();
  const call = (body) => serveConsoleRoute(post('api/arc-core/update/action', body), {}, store, { updater: e.u });
  await e.u.check();
  // a lock that another process left a moment ago (an update that was cut short, or the second window of the app)
  const lockFile = path.join(e.home, 'updates', 'lock');
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 1, at: Date.now(), token: 'another-process' }));
  const refused = await call({ kind: 'install' });
  assert.equal(refused.ok, false, 'the refusal is not answered as a start');
  assert.match(refused.error, /already running/);
  assert.equal(refused.started, undefined);
  assert.equal(refused.state.busy, false);
  assert.equal(marker(e), "export const marker = 'arc-core-0.6.0';\n");
  fs.rmSync(lockFile);
  const started = await call({ kind: 'install' });
  assert.deepEqual({ ok: started.ok, started: started.started }, { ok: true, started: true }, 'a real install still answers at once');
  for (let i = 0; i < 400 && e.u.getState().phase !== 'done'; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(e.u.getState().installed, '0.7.0');
});

test('console route: Roll back with a version acts only when that version is still the kept one', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  assert.equal((await e.u.install()).ok, true);
  assert.equal(e.u.getState().backupVersion, '0.6.0');
  const store = createResearchSessionStore();
  const call = (body) => serveConsoleRoute(post('api/arc-core/update/action', body), {}, store, { updater: e.u });
  const stale = await call({ kind: 'rollback', version: '0.5.0' });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /kept version/);
  assert.equal(e.u.getState().installed, '0.7.0', 'nothing was rolled back');
  for (const odd of [7, { v: 1 }, '']) assert.equal((await call({ kind: 'rollback', version: odd })).ok, false, 'a version that is no text of a version is refused');
  assert.equal(e.u.getState().installed, '0.7.0');
  const good = await call({ kind: 'rollback', version: '0.6.0' });
  assert.equal(good.ok, true, good.error);
  assert.equal(e.u.getState().installed, '0.6.0');
});

// =====================================================================================================
// Channels (S058): Release, Beta and Alpha. A version is x.y.z, x.y.z-beta.N or x.y.z-alpha.N and nothing else.
import { CHANNELS, parseVersion } from '../lib/updater.js';

test('versions: one strict form, and one order in which a final stands above its betas and a beta above every alpha', () => {
  for (const good of ['0.6.1', '10.0.0', '0.7.0-beta.1', '0.7.0-alpha.12']) assert.ok(parseVersion(good), good);
  for (const bad of ['v0.6.1', '0.6', '0.6.1.2', '1.0.0-rc.1', '1.0.0-beta', '1.0.0-beta.1.2', '1.0.0-BETA.1', '1.0.0-beta.x', '1.0.0+build', ' 1.0.0', '1.0.0 ', '1.0.0-beta.1-alpha.1', '', null, undefined, 7, '1234567890.0.0']) assert.equal(parseVersion(bad), null, String(bad));
  assert.deepEqual(CHANNELS, ['release', 'beta', 'alpha']);
  // lowest first
  const order = ['0.6.9', '0.7.0-alpha.1', '0.7.0-alpha.9', '0.7.0-alpha.10', '0.7.0-beta.1', '0.7.0-beta.2', '0.7.0-beta.11', '0.7.0', '0.7.1-alpha.1', '0.7.1', '0.10.0-alpha.1', '0.10.0', '1.0.0-beta.1', '1.0.0'];
  for (let i = 0; i < order.length; i++) {
    for (let j = 0; j < order.length; j++) {
      assert.equal(compareVersions(order[i], order[j]), Math.sign(i - j), order[i] + ' against ' + order[j]);
    }
  }
  // a sort by this order puts any shuffle back
  const shuffled = order.map((v, i) => [v, (i * 7 + 3) % order.length]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  assert.notDeepEqual(shuffled, order);
  assert.deepEqual([...shuffled].sort(compareVersions), order);
  // text that is no version still compares by its leading numbers, as before
  assert.equal(compareVersions('0.6.0', '0.6'), 0);
  assert.equal(compareVersions('0.6.1-dev', '0.6.0'), 1);
});

test('pickRelease: each channel sees its own releases; a draft, a flagged plain tag and an odd tag stay out of all three', () => {
  const rel = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: /-/.test(tag), assets: [], ...extra });
  const list = [rel('v0.6.1'), rel('v0.7.0-alpha.3'), rel('v0.7.0-beta.1'), rel('v0.7.0-alpha.4'), rel('v0.9.0-beta.1', { draft: true }), rel('v0.8.0', { prerelease: true }), rel('v1.0.0-rc.1'), rel('nightly'), rel('v0.6.0')];
  assert.equal(pickRelease(list).version, '0.6.1', 'the default is the Release channel');
  assert.equal(pickRelease(list, undefined, 'release').version, '0.6.1');
  assert.equal(pickRelease(list, undefined, 'beta').version, '0.7.0-beta.1');
  assert.equal(pickRelease(list, undefined, 'alpha').version, '0.7.0-beta.1', 'a beta stands above the alphas of the same version');
  assert.equal(pickRelease(list.filter((r) => !/beta/.test(r.tag_name)), undefined, 'alpha').version, '0.7.0-alpha.4');
  // a final above the pre-releases wins on every channel
  for (const ch of CHANNELS) assert.equal(pickRelease([...list, rel('v0.7.0')], undefined, ch).version, '0.7.0', ch);
  // a named version must be one the channel may see
  assert.equal(pickRelease(list, '0.7.0-beta.1', 'release'), null);
  assert.equal(pickRelease(list, '0.7.0-alpha.3', 'beta'), null);
  assert.equal(pickRelease(list, '0.7.0-alpha.3', 'alpha').version, '0.7.0-alpha.3');
  assert.equal(pickRelease(list, '0.6.0', 'alpha').version, '0.6.0');
  assert.equal(pickRelease(list, '0.8.0', 'alpha'), null, 'a plain tag that GitHub marks as a pre-release stays out');
  assert.equal(pickRelease(list, undefined, 'nightly'), null, 'an unknown channel sees nothing');
  // a beta tag that GitHub does not mark as a pre-release is still a beta, by its tag
  assert.equal(pickRelease([rel('v0.6.1'), rel('v0.7.0-beta.1', { prerelease: false })]).version, '0.6.1');
  // the kit of a beta carries the whole version in its name
  const kit = (v) => [{ name: 'Arc-Harness-Kit-' + v + '-win-x64.zip', browser_download_url: 'https://github.com/k' }, { name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/s' }];
  assert.equal(pickRelease([rel('v0.7.0-beta.1', { assets: kit('0.7.0-beta.1') })], undefined, 'beta').kit.name, 'Arc-Harness-Kit-0.7.0-beta.1-win-x64.zip');
  assert.equal(pickRelease([rel('v0.7.0-beta.1', { assets: kit('0.7.0') })], undefined, 'beta').kit, null, 'a kit named for the final is not the kit of its beta');
});

test('channel: Release by default; the choice is kept on disk; a check made for another channel does not count', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.6.1'));
  e.srv.state.publish(buildKit('0.7.0-beta.1'), { prerelease: true });
  assert.equal(e.u.getState().channel, 'release');
  let s = await e.u.check();
  assert.deepEqual({ latest: s.latest, available: s.available, ahead: s.ahead }, { latest: '0.6.1', available: true, ahead: false });
  assert.throws(() => e.u.setChannel('nightly'), /Unknown channel/);
  assert.throws(() => e.u.setChannel(), /Unknown channel/);
  s = e.u.setChannel('beta');
  assert.equal(s.channel, 'beta');
  assert.deepEqual({ latest: s.latest, available: s.available, checkedAt: s.checkedAt }, { latest: null, available: false, checkedAt: null }, 'the result for Release says nothing about Beta');
  // another process of the app (the web window) reads the same choice and also holds no result for it
  const other = e.make();
  assert.equal(other.getState().channel, 'beta');
  assert.equal(other.getState().latest, null);
  s = await other.check();
  assert.deepEqual({ latest: s.latest, available: s.available, installable: s.installable }, { latest: '0.7.0-beta.1', available: true, installable: true });
  assert.equal(e.u.getState().latest, '0.7.0-beta.1', 'the first process reads the result that the second one saved');
  // back on Release, the Beta result does not count either
  assert.equal(e.u.setChannel('release').latest, null);
  // a settings file with an odd channel reads as Release; a result from before channels existed counts for Release
  fs.writeFileSync(path.join(e.home, 'updates', 'settings.json'), JSON.stringify({ mode: 'notify', channel: 'canary' }));
  assert.equal(e.u.getState().channel, 'release');
  const st = JSON.parse(fs.readFileSync(path.join(e.home, 'updates', 'state.json'), 'utf8'));
  delete st.lastCheck.channel; st.lastCheck.latest = '0.6.1';
  fs.writeFileSync(path.join(e.home, 'updates', 'state.json'), JSON.stringify(st));
  assert.equal(e.u.getState().latest, '0.6.1');
});

test('a beta kit built by the real bundler installs on Beta: beta.1, then beta.2, then the final; Release never sees the betas', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0-beta.1'), { prerelease: true });
  // on Release nothing is offered, and the beta cannot be installed by its name
  assert.equal((await e.u.check()).latest, null);
  const refused = await e.u.install({ version: '0.7.0-beta.1' });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /was not found/);
  assert.equal(marker(e), "export const marker = 'arc-core-0.6.0';\n");
  e.u.setChannel('beta');
  let r = await e.u.install();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.version, '0.7.0-beta.1');
  let s = e.u.getState();
  assert.equal(s.installed, '0.7.0-beta.1', 'the installed version keeps its beta mark');
  assert.equal(fs.readFileSync(path.join(e.gatewayDir, 'arc-gateway.exe'), 'utf8'), 'GW-0.7.0-beta.1');
  assert.deepEqual({ available: s.available, ahead: s.ahead }, { available: false, ahead: false });
  e.srv.state.publish(buildKit('0.7.0-beta.2'), { prerelease: true });
  s = await e.u.check();
  assert.deepEqual({ latest: s.latest, available: s.available }, { latest: '0.7.0-beta.2', available: true });
  r = await e.u.install();
  assert.equal(r.ok, true, r.error);
  assert.equal(e.u.getState().backupVersion, '0.7.0-beta.1');
  e.srv.state.publish(buildKit('0.7.0'));
  s = await e.u.check();
  assert.deepEqual({ latest: s.latest, available: s.available }, { latest: '0.7.0', available: true }, 'the final stands above its betas');
  r = await e.u.install();
  assert.equal(r.ok, true, r.error);
  assert.equal(e.u.getState().installed, '0.7.0');
  // Roll back still goes one step, to the beta before
  r = await e.u.rollback();
  assert.equal(r.ok, true, r.error);
  assert.equal(e.u.getState().installed, '0.7.0-beta.2');
});

test('no silent downgrade: ahead of the channel, automatic install and a plain install do nothing; Go back is an explicit action to the newest version of the channel', async (t) => {
  const e = await setup({ version: '0.7.0-beta.2' }); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.6.0'));
  e.srv.state.publish(buildKit('0.6.1'));
  e.srv.state.publish(buildKit('0.7.0-beta.3'), { prerelease: true });
  const at = () => marker(e);
  const before = at();
  assert.equal(before, "export const marker = 'arc-core-0.7.0-beta.2';\n");
  let s = await e.u.check(); // the Release channel
  assert.deepEqual({ installed: s.installed, latest: s.latest, available: s.available, ahead: s.ahead }, { installed: '0.7.0-beta.2', latest: '0.6.1', available: false, ahead: true });
  e.u.setMode('auto');
  assert.equal((await e.u.tick()).action, 'none', 'automatic install never goes back');
  assert.equal(at(), before);
  for (const req of [{}, { version: '0.6.1' }, { version: '0.6.0' }, { auto: true }]) {
    const r = await e.u.install(req);
    assert.equal(r.ok, false, JSON.stringify(req));
    assert.match(r.error, /Already up to date/);
    assert.equal(at(), before);
  }
  const hidden = await e.u.install({ version: '0.7.0-beta.3' });
  assert.equal(hidden.ok, false, 'a version the channel may not see cannot be named');
  assert.match(hidden.error, /was not found/);
  assert.equal(at(), before);
  // automatic install and Go back never combine, also while a Go back would be possible
  const never = await e.u.install({ back: true, auto: true });
  assert.equal(never.ok, false);
  assert.match(never.error, /never goes back/);
  assert.equal(at(), before);
  // Go back takes its target from the channel, never from the caller
  const back = await e.u.install({ back: true, version: '0.6.0' });
  assert.equal(back.ok, true, back.error);
  assert.equal(back.version, '0.6.1');
  s = e.u.getState();
  assert.deepEqual({ installed: s.installed, ahead: s.ahead, available: s.available, backup: s.backupVersion, restart: s.restartNeeded }, { installed: '0.6.1', ahead: false, available: false, backup: '0.7.0-beta.2', restart: true });
  assert.equal(at(), "export const marker = 'arc-core-0.6.1';\n");
  // with nothing ahead, Go back is refused and changes nothing
  const again = await e.u.install({ back: true });
  assert.equal(again.ok, false);
  assert.match(again.error, /not newer/);
  assert.equal(at(), "export const marker = 'arc-core-0.6.1';\n");
  // automatic install and Go back never combine
  const both = await e.u.install({ back: true, auto: true });
  assert.equal(both.ok, false);
  // Roll back returns to the beta
  assert.equal((await e.u.rollback()).ok, true);
  assert.equal(at(), before);
});

test('the channel is read when an update starts, so a choice made in another window counts', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.6.1'));
  e.srv.state.publish(buildKit('0.7.0-beta.1'), { prerelease: true });
  e.u.setMode('auto');
  const other = e.make();
  other.setChannel('beta'); // the web window
  const r = await e.u.tick(); // the desktop window, which never heard of the change
  assert.deepEqual({ action: r.action, version: r.version }, { action: 'installed', version: '0.7.0-beta.1' });
});

test('release list: when a full page holds no version for the channel, the next pages are read, three at most', async (t) => {
  const inst = makeInstall(); t.after(() => rm(inst.root));
  const pre = (i) => ({ tag_name: 'v0.9.0-alpha.' + i, draft: false, prerelease: true, assets: [] });
  const pages = { 1: Array.from({ length: 30 }, (_, i) => pre(60 - i)), 2: Array.from({ length: 30 }, (_, i) => pre(30 - i)), 3: [{ tag_name: 'v0.6.1', draft: false, prerelease: false, assets: [] }] };
  const seen = [];
  const fetchImpl = async (url) => { seen.push(String(url).replace(/^.*releases/, '')); const n = Number(new URL(url).searchParams.get('page') || 1); return new Response(JSON.stringify(pages[n] || []), { status: 200 }); };
  const make = () => createUpdater({ home: inst.home, gatewayDir: inst.gatewayDir, env: ENV, api: 'http://127.0.0.1:9', repo: 'o/r', fetchImpl });
  const u = make();
  assert.equal((await u.check()).latest, '0.6.1', 'the final behind sixty alphas is found');
  assert.deepEqual(seen, ['?per_page=30', '?per_page=30&page=2', '?per_page=30&page=3']);
  seen.length = 0;
  u.setChannel('alpha');
  assert.equal((await u.check()).latest, '0.9.0-alpha.60');
  assert.deepEqual(seen, ['?per_page=30'], 'a page that holds a version for the channel is enough');
  // an endless list of full pages without a version ends after three pages
  seen.length = 0;
  pages[3] = pages[2]; pages[4] = pages[2];
  u.setChannel('release');
  assert.equal((await u.check()).latest, null);
  assert.equal(seen.length, 3);
});

test('console routes: the channel is set and checked at once; Go back and a version name are checked before the updater sees them', async (t) => {
  const e = await setup({ version: '0.7.0-beta.2' }); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.6.1'));
  e.srv.state.publish(buildKit('0.7.0-beta.3'), { prerelease: true });
  const store = createResearchSessionStore();
  const call = (body) => serveConsoleRoute(post('api/arc-core/update/action', body), {}, store, { updater: e.u });
  for (const bad of ['nightly', '', 7, null, undefined, ['beta']]) {
    const r = await call({ kind: 'channel', channel: bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.error, /Unknown channel/);
  }
  assert.equal(e.u.getState().channel, 'release');
  let r = await call({ kind: 'channel', channel: 'beta' });
  assert.deepEqual({ ok: r.ok, channel: r.channel, latest: r.latest, available: r.available }, { ok: true, channel: 'beta', latest: '0.7.0-beta.3', available: true }, 'the answer already holds the newest version of the new channel');
  r = await call({ kind: 'channel', channel: 'release' });
  assert.deepEqual({ latest: r.latest, ahead: r.ahead }, { latest: '0.6.1', ahead: true });
  // a version that is no version is refused; it never turns into another action
  for (const odd of ['0.6.1; rm', '../0.6.1', '0.6', '0.06.1', 6, { v: '0.6.1' }, null]) {
    for (const body of [{ kind: 'install', version: odd, wait: true }, { kind: 'install', back: true, version: odd, channel: 'release', wait: true }]) {
      const x = await call(body);
      assert.equal(x.ok, false, JSON.stringify(body));
      assert.match(x.error, /Not a version name/);
    }
  }
  assert.equal(e.u.getState().installed, '0.7.0-beta.2');
  // back must be the plain value true
  const loose = await call({ kind: 'install', back: 'yes', wait: true });
  assert.equal(loose.ok, false);
  assert.match(loose.error, /Already up to date/);
  const back = await call({ kind: 'install', back: true, wait: true });
  assert.equal(back.ok, true, back.error);
  assert.equal(back.version, '0.6.1');
  assert.equal(back.state.installed, '0.6.1');
});

test('a roll back the user asks for after a failed update is no failure, although both end in the same phase', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.7.0'));
  // the gateway of 0.7.1 passes its check as a staged copy and fails it in its installed place
  const u = e.make({ run: (file, args) => (file.startsWith(e.gatewayDir) && fs.readFileSync(file, 'utf8') === 'GW-0.7.1' ? { status: 1, stdout: '', stderr: 'dies' } : fakeRun(file, args)) });
  assert.equal((await u.install()).ok, true);
  e.srv.state.publish(buildKit('0.7.1'));
  const bad = await u.install();
  assert.equal(bad.ok, false);
  let s = u.getState();
  assert.deepEqual({ phase: s.phase, failed: s.failed, installed: s.installed, backup: s.backupVersion }, { phase: 'rolled-back', failed: true, installed: '0.7.0', backup: '0.6.0' });
  const back = await u.rollback();
  assert.equal(back.ok, true, back.error);
  s = u.getState();
  assert.deepEqual({ phase: s.phase, failed: s.failed, installed: s.installed }, { phase: 'rolled-back', failed: false, installed: '0.6.0' });
});

test('versions: one spelling only, so a number with a leading zero is no version', () => {
  for (const bad of ['0.06.1', '01.0.0', '0.6.01', '0.7.0-beta.01', '00.0.0']) assert.equal(parseVersion(bad), null, bad);
  for (const good of ['0.0.0', '0.6.10', '10.20.30', '0.7.0-beta.10', '0.7.0-alpha.0']) assert.ok(parseVersion(good), good);
  const rel = (tag) => ({ tag_name: tag, draft: false, prerelease: false, assets: [] });
  assert.equal(pickRelease([rel('v0.6.1'), rel('v0.06.2')]).version, '0.6.1', 'a tag in a second spelling stays out');
});

test('Go back acts only when the version and the channel that the question named still hold', async (t) => {
  const e = await setup({ version: '0.7.0-beta.2' }); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.6.0'));
  e.srv.state.publish(buildKit('0.6.1'));
  const before = marker(e);
  // the question named 0.6.0, and a newer final appeared meanwhile
  let r = await e.u.install({ back: true, expect: { version: '0.6.0', channel: 'release' } });
  assert.equal(r.ok, false);
  assert.match(r.error, /changed/);
  assert.equal(marker(e), before);
  // the question was asked on another channel
  r = await e.u.install({ back: true, expect: { version: '0.6.1', channel: 'beta' } });
  assert.equal(r.ok, false);
  assert.match(r.error, /changed/);
  assert.equal(marker(e), before);
  // an expectation is only compared: it never becomes the target
  const store = createResearchSessionStore();
  const call = (body) => serveConsoleRoute(post('api/arc-core/update/action', body), {}, store, { updater: e.u });
  r = await call({ kind: 'install', back: true, version: '0.6.0', channel: 'release', wait: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /changed/);
  assert.equal(marker(e), before);
  r = await call({ kind: 'install', back: true, version: '0.6.1', channel: 'nightly', wait: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /Unknown channel/, 'a channel that is none is refused before the updater runs');
  assert.equal(marker(e), before);
  r = await call({ kind: 'install', back: true, version: '0.6.1', channel: 'release', wait: true });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.version, '0.6.1');
});

test('an update reads the channel once, at its start: a change that lands while the list is read does not mix two channels', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.6.1'));
  e.srv.state.publish(buildKit('0.7.0-beta.1'), { prerelease: true });
  const other = e.make();
  let flipped = false;
  // the other window changes the channel at the moment this window reads the release list
  const u = e.make({ fetchImpl: async (url, o) => { if (/\/releases\?/.test(String(url)) && !flipped) { flipped = true; other.setChannel('beta'); } return fetch(url, o); } });
  const r = await u.install();
  assert.equal(flipped, true);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.version, '0.6.1', 'the update that started on Release installs the Release version');
});

test('a check that ends after the channel changed does not replace the result of the new channel', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.6.1'));
  e.srv.state.publish(buildKit('0.7.0-beta.1'), { prerelease: true });
  let release = null;
  const held = new Promise((resolve) => { release = resolve; });
  const slow = e.make({ fetchImpl: async (url, o) => { const res = await fetch(url, o); await held; return res; } });
  const first = slow.check(); // made for Release, and still on its way
  await new Promise((r) => setTimeout(r, 50));
  e.u.setChannel('beta');
  assert.equal((await e.u.check()).latest, '0.7.0-beta.1');
  release();
  await first;
  const s = e.u.getState();
  assert.deepEqual({ channel: s.channel, latest: s.latest }, { channel: 'beta', latest: '0.7.0-beta.1' }, 'the late Release result did not take the place of the Beta result');
});

test('console route: an install that ends at once with an error is answered as a refusal, not as a start', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  // the folder of the updater cannot be made: a file stands in its place
  fs.writeFileSync(path.join(e.home, 'updates'), 'not a folder');
  const store = createResearchSessionStore();
  const r = await serveConsoleRoute(post('api/arc-core/update/action', { kind: 'install' }), {}, store, { updater: e.u });
  assert.equal(r.ok, false);
  assert.equal(r.started, undefined);
  assert.ok(typeof r.error === 'string' && r.error.length > 0 && r.error.length <= 300);
});

test('a check of a channel that is no longer chosen does not mark the state as failed when it fails late', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.6.1'));
  let release = null;
  const held = new Promise((resolve) => { release = resolve; });
  const slow = e.make({ fetchImpl: async () => { await held; throw new TypeError('fetch failed'); } });
  const first = slow.check(); // made for Release
  await new Promise((r) => setTimeout(r, 30));
  e.u.setChannel('beta');
  release();
  const s = await first;
  assert.deepEqual({ phase: s.phase, failed: s.failed }, { phase: 'idle', failed: false }, 'the failure belongs to a channel that is no longer chosen');
  // the same failure for the chosen channel is still a failure
  const again = await e.make({ fetchImpl: async () => { throw new TypeError('fetch failed'); } }).check();
  assert.deepEqual({ phase: again.phase, failed: again.failed }, { phase: 'failed', failed: true });
});

test('an install whose own check failed does not go on with an older release list, also when the channel changed meanwhile', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.6.1'));
  const other = e.make();
  let broken = false;
  const u = e.make({ fetchImpl: async (url, o) => { if (broken && /\/releases\?/.test(String(url))) { other.setChannel('beta'); throw new TypeError('fetch failed'); } return fetch(url, o); } });
  assert.equal((await u.check()).latest, '0.6.1'); // this window now holds a release list from an earlier check
  const before = u.getState().installed;
  broken = true;
  const r = await u.install();
  assert.equal(r.ok, false, 'the install went on although its own check had failed');
  assert.match(String(r.error), /Could not reach GitHub/);
  assert.equal(u.getState().installed, before);
});

test('an install of a version that no release carries says so in the state, so the page can show it', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.6.1'));
  const r = await e.u.install({ version: '0.9.9' });
  assert.equal(r.ok, false);
  const s = e.u.getState();
  assert.equal(s.phase, 'idle');
  assert.match(String(s.message), /0\.9\.9 was not found/);
});

test('release notes: text within the limit stays whole, and longer text carries one character more so that a reader can tell it was cut', () => {
  const rel = (body) => ({ tag_name: 'v0.6.1', draft: false, prerelease: false, assets: [], body });
  assert.equal(pickRelease([rel('n'.repeat(1200))]).notes.length, 1200);
  assert.equal(pickRelease([rel('n'.repeat(1199))]).notes.length, 1199);
  assert.equal(pickRelease([rel('n'.repeat(5000))]).notes.length, 1201);
});

test('console route: the channel does not change while an update runs', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-route-')); t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const calls = [];
  const busy = { getState: () => ({ busy: true, channel: 'release' }), setChannel: (c) => { calls.push(c); return {}; }, check: async () => ({}) };
  const r = await serveConsoleRoute(post('api/arc-core/update/action', { kind: 'channel', channel: 'beta' }), {}, createResearchSessionStore({ arcHome: tmp, live: false }), { updater: busy });
  assert.equal(r.ok, false);
  assert.match(r.error, /update is running/);
  assert.ok(r.error.length <= 90);
  assert.deepEqual(calls, [], 'the choice was not saved');
});

test('an install whose own check failed leaves a failure line in the state, also when the channel changed meanwhile', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.6.1'));
  const other = e.make();
  let broken = false;
  const u = e.make({ fetchImpl: async (url, o) => { if (broken && /\/releases\?/.test(String(url))) { other.setChannel('beta'); throw new TypeError('fetch failed'); } return fetch(url, o); } });
  await u.check();
  broken = true;
  assert.equal((await u.install()).ok, false);
  const s = u.getState();
  assert.equal(s.failed, true, 'the page would show nothing for this refusal');
  assert.match(String(s.message), /Could not reach GitHub/);
});

test('a plain check that fails while an install reads the release list does not stop that install', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.6.1'));
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  // the first list read belongs to the plain check: it is held and then fails. The second belongs to the install.
  let n = 0; const open = [null, null];
  const held = [new Promise((r) => { open[0] = r; }), new Promise((r) => { open[1] = r; })];
  const u = e.make({ fetchImpl: async (url, o) => { if (/\/releases\?/.test(String(url))) { const k = n++; if (k < 2) await held[k]; if (k === 0) throw new TypeError('fetch failed'); } return fetch(url, o); } });
  const first = u.check();
  await pause(30);
  const inst = u.install();
  await pause(120); // the install now waits for its own list read
  open[0]();
  await first;
  open[1]();
  const r = await inst;
  assert.equal(r.ok, true, `the failure of another check stopped the install: ${r.error}`);
});

test('a late failed check of a channel that is no longer chosen does not erase the failure of the chosen channel', async (t) => {
  const e = await setup(); t.after(e.cleanup);
  e.srv.state.publish(buildKit('0.6.1'));
  let n = 0, open = null; const held = new Promise((r) => { open = r; });
  const u = e.make({ fetchImpl: async () => { const k = n++; if (k === 0) await held; throw new TypeError('fetch failed'); } });
  const first = u.check(); // made for Release, and still on its way
  await new Promise((r) => setTimeout(r, 30));
  u.setChannel('beta');
  assert.equal((await u.check()).failed, true, 'the check of the chosen channel failed');
  open();
  await first;
  assert.equal(u.getState().failed, true, 'the late failure of the Release check erased the failure of the Beta check');
});
