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
  for (const bad of ['http://api.github.com/x', 'https://evil.example/x', 'https://github.com.evil.example/x', 'https://user:pw@github.com/x', 'https://github.com:8443/x', 'http://127.0.0.1:9/x', 'https://127.0.0.1/x', 'file:///c:/x', 'https://[::1]/x']) {
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
  const flaky = { ...fs, renameSync: (a, b) => { if (String(b).includes('arc-molecullage') && !String(a).includes('backup')) { const err = new Error('EPERM: busy'); err.code = 'EPERM'; throw err; } return real(a, b); } };
  const u = e.make({ fs: flaky });
  const r = await u.install();
  assert.equal(r.ok, false);
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
  assert.equal((await call('api/arc-core/update/action', { kind: 'check' }, { origin: 'null' })).status, 403, 'a sandboxed frame has an opaque origin');
  const rebound = await serveConsoleRoute(new Request('http://evil.example:7777/api/arc-core/update/action', { method: 'POST', headers: { origin: 'http://evil.example:7777' }, body: '{"kind":"check"}' }), {}, store, { updater: e.u });
  assert.equal(rebound.status, 403, 'a rebound host name is refused');
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
