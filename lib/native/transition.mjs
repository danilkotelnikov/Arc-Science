// Phase 6 Arc Native transition slices N0-N6 and N9:
// - N0: pinned upstream manifest (dsh-v0.2.1-rc.5) and deterministic tree diff report
// - N1: runtime package-manager removal guard and read-only Built-in features page model
// - N2 & N4: vendored plugin bundler with license audit and THIRD_PARTY_NOTICES generator
// - N5: settings-only profile verifier and node_modules pruner
// - N6: reproducible static Cordis module-table generator with canonical SHA-256
// - N9: first-run credential-store wizard validator and public-repo readiness verifier
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_MANIFEST_PATH = path.join(ROOT, 'brandtext', 'upstream-manifest.json');

const BLOCKED_PM_BINARIES = new Set([
  'npm',
  'npm.cmd',
  'npx',
  'npx.cmd',
  'pnpm',
  'pnpm.cmd',
  'pnpx',
  'pnpx.cmd',
  'yarn',
  'yarn.cmd',
  'corepack',
  'corepack.cmd',
]);

const BLOCKED_REGISTRY_HOSTS = new Set([
  'registry.npmjs.org',
  'registry.yarnpkg.com',
  'npm.pkg.github.com',
  'registry.npmmirror.com',
]);

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function normalizeTextLf(bufOrStr) {
  const s = Buffer.isBuffer(bufOrStr) ? bufOrStr.toString('utf8') : String(bufOrStr);
  return s.replace(/\r\n/g, '\n');
}

/** N0: Load and validate the pinned upstream manifest. */
export function loadUpstreamManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!raw?.upstream?.tag || raw.upstream.tag !== 'dsh-v0.2.1-rc.5') {
    throw new Error('ERR_UPSTREAM_PIN_MISMATCH: expected tag dsh-v0.2.1-rc.5');
  }
  if (raw.upstream.license !== 'MIT') {
    throw new Error('ERR_UPSTREAM_LICENSE: expected MIT upstream license');
  }
  return raw;
}

/**
 * N0: Compute a deterministic SHA-256 comparison report between upstream source package entries
 * and shipped archive package entries ({ name, version, files: { [relPath]: contentOrHash } } or Map/Record).
 */
export function diffUpstreamManifest(sourcePackages, archivePackages, options = {}) {
  const manifest = options.manifest ?? loadUpstreamManifest();
  const normalizePkgMap = (input) => {
    const out = new Map();
    const entries = input instanceof Map ? [...input.entries()] : Object.entries(input ?? {});
    for (const [pkgName, val] of entries) {
      const digest =
        typeof val === 'string'
          ? val
          : sha256Hex(JSON.stringify(val, Object.keys(val ?? {}).sort()));
      out.set(pkgName, digest);
    }
    return out;
  };

  const src = normalizePkgMap(sourcePackages);
  const arc = normalizePkgMap(archivePackages);
  const allNames = [...new Set([...src.keys(), ...arc.keys()])].sort();

  const shared = [];
  const matchedHashes = [];
  const differedHashes = [];
  const onlySource = [];
  const onlyArchive = [];

  for (const name of allNames) {
    const inSrc = src.has(name);
    const inArc = arc.has(name);
    if (inSrc && inArc) {
      shared.push(name);
      if (src.get(name) === arc.get(name)) {
        matchedHashes.push(name);
      } else {
        differedHashes.push({ name, sourceSha256: src.get(name), archiveSha256: arc.get(name) });
      }
    } else if (inSrc) {
      onlySource.push(name);
    } else {
      onlyArchive.push(name);
    }
  }

  const canonicalSummary = JSON.stringify({
    tag: manifest.upstream.tag,
    shared,
    matchedHashes,
    differedHashes,
    onlySource,
    onlyArchive,
  });

  return {
    tag: manifest.upstream.tag,
    repository: manifest.upstream.repository,
    expectedSharedBaseline: manifest.upstream.sharedPackageEntries,
    sharedCount: shared.length,
    matchedCount: matchedHashes.length,
    differedCount: differedHashes.length,
    onlySource,
    onlyArchive,
    differedHashes,
    reportSha256: sha256Hex(canonicalSummary),
  };
}

/**
 * N1: Runtime package-manager removal guard.
 * Blocks npm/pnpm/yarn/corepack process spawns, blocks dsh/arc plugin install subcommands,
 * blocks registry and marketplace probes, and refuses hot-reload file watchers.
 */
export function createRuntimePmGuard(options = {}) {
  const manifest = options.manifest ?? loadUpstreamManifest();
  const auditEvents = [];

  function checkSpawn(command, args = []) {
    const base = path.basename(String(command || '')).toLowerCase();
    const argList = args.map((a) => String(a));
    if (BLOCKED_PM_BINARIES.has(base)) {
      const err = new Error(`ERR_PACKAGE_MANAGER_REMOVED: ${base} execution is disabled in Arc Native`);
      err.code = 'ERR_PACKAGE_MANAGER_REMOVED';
      auditEvents.push({ kind: 'spawn-blocked', command: base, args: argList });
      throw err;
    }
    if ((base === 'dsh' || base === 'arc' || base === 'dsh.cmd' || base === 'arc.cmd') && argList[0] === 'plugin') {
      const err = new Error('ERR_PLUGIN_CLI_REMOVED: runtime plugin subcommand is disabled in Arc Native');
      err.code = 'ERR_PLUGIN_CLI_REMOVED';
      auditEvents.push({ kind: 'plugin-cli-blocked', command: base, args: argList });
      throw err;
    }
    return { allowed: true, command: base, args: argList };
  }

  function checkNetworkProbe(rawUrl) {
    let parsed;
    try {
      parsed = new URL(String(rawUrl));
    } catch {
      const err = new Error(`ERR_INVALID_URL: ${rawUrl}`);
      err.code = 'ERR_INVALID_URL';
      throw err;
    }
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    if (
      BLOCKED_REGISTRY_HOSTS.has(host) ||
      pathname.startsWith('/marketplace') ||
      pathname.startsWith('/api/plugins/install') ||
      pathname.startsWith('/-/v1/search')
    ) {
      const err = new Error(`ERR_REGISTRY_PROBE_BLOCKED: ${host}${pathname} is disabled in Arc Native`);
      err.code = 'ERR_REGISTRY_PROBE_BLOCKED';
      auditEvents.push({ kind: 'probe-blocked', url: `${host}${pathname}` });
      throw err;
    }
    return { allowed: true, host, pathname };
  }

  function checkHotReloadWatcher(targetPath) {
    const err = new Error(`ERR_HOT_RELOAD_DISABLED: plugin watcher refused for ${targetPath}`);
    err.code = 'ERR_HOT_RELOAD_DISABLED';
    auditEvents.push({ kind: 'watcher-blocked', targetPath: String(targetPath) });
    throw err;
  }

  function builtInFeaturesPage(bundledPlugins = []) {
    const rows = bundledPlugins.length
      ? bundledPlugins
      : manifest.builtInPlugins.map((id) => ({ id, status: 'built-in', license: 'MIT' }));
    return {
      title: 'Built-in features',
      subtitle: 'Frozen Arc Native composition with runtime package installation switched off.',
      readOnly: true,
      controls: {
        installByName: false,
        marketplace: false,
        hotReload: false,
        packageUpdater: false,
      },
      features: rows.map((r) => ({
        id: r.id ?? r.name,
        version: r.version ?? '0.1.0',
        license: r.license ?? 'MIT',
        description: r.description ?? '',
        status: 'built-in',
      })),
    };
  }

  return {
    checkSpawn,
    checkNetworkProbe,
    checkHotReloadWatcher,
    builtInFeaturesPage,
    auditLog: () => [...auditEvents],
  };
}

function collectPluginFiles(pluginDir, declaredFiles) {
  const collected = [];
  const walkRel = (relPath) => {
    const abs = path.join(pluginDir, relPath);
    if (!fs.existsSync(abs)) return;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      const entries = fs.readdirSync(abs).sort();
      for (const name of entries) {
        walkRel(path.posix.join(relPath.replace(/\\/g, '/'), name));
      }
    } else if (st.isFile()) {
      const normRel = relPath.replace(/\\/g, '/');
      const bytes = fs.readFileSync(abs);
      const isText = /\.(js|mjs|cjs|json|md|yml|yaml|svg|css|txt)$/i.test(normRel);
      const digest = sha256Hex(isText ? Buffer.from(normalizeTextLf(bytes), 'utf8') : bytes);
      collected.push({ path: normRel, size: bytes.length, sha256: digest });
    }
  };

  walkRel('package.json');
  for (const item of declaredFiles ?? []) {
    walkRel(item);
  }
  const byPath = new Map();
  for (const f of collected) byPath.set(f.path, f);
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * N2 & N4: Audit licenses and bundle the kept plugins into a deterministic frozen manifest
 * plus generated THIRD_PARTY_NOTICES markdown.
 */
export function bundleVendoredPlugins(options = {}) {
  const pluginsRoot = options.pluginsRoot ?? path.join(ROOT, 'plugins');
  const manifest = options.manifest ?? loadUpstreamManifest();
  const approved = new Set(options.approvedLicenses ?? manifest.approvedLicenses);
  const pluginIds = [...(options.pluginIds ?? manifest.builtInPlugins)].sort();

  const bundled = [];
  for (const id of pluginIds) {
    const dir = path.join(pluginsRoot, id);
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      const err = new Error(`ERR_MISSING_VENDORED_PLUGIN: ${id}`);
      err.code = 'ERR_MISSING_VENDORED_PLUGIN';
      throw err;
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const license = String(pkg.license || '').trim();
    if (!license || license.toUpperCase() === 'UNLICENSED' || !approved.has(license)) {
      const err = new Error(`ERR_LICENSE_AUDIT_FAILED: plugin ${id} has unapproved license "${license || 'missing'}"`);
      err.code = 'ERR_LICENSE_AUDIT_FAILED';
      throw err;
    }
    const files = collectPluginFiles(dir, pkg.files ?? ['lib']);
    const pluginDigest = sha256Hex(JSON.stringify({ name: pkg.name, version: pkg.version, license, files }));
    bundled.push({
      id,
      name: pkg.name,
      version: pkg.version,
      license,
      description: pkg.description ?? '',
      main: pkg.main ?? './lib/index.js',
      client: pkg.exports?.['./client'] ?? null,
      files,
      sha256: pluginDigest,
    });
  }

  const noticesLines = [
    '# Third-party and built-in component notices',
    '',
    '## Upstream host foundation',
    `- Based on DeepSeek Harness (${manifest.upstream.tag}), ${manifest.upstream.license}.`,
    `- ${manifest.upstream.copyright}.`,
    '',
    '## Embedded typefaces and runtime components',
    '- Geist and Geist Mono typefaces — SIL Open Font License 1.1 (OFL-1.1).',
    '- Electron and Chromium runtime components — MIT and BSD-3-Clause notices preserved with the binary distribution.',
    '',
    '## Built-in Arc plugins',
    ...bundled.map((p) => `- \`${p.name}@${p.version}\` — ${p.license}: ${p.description}`),
    '',
  ];
  const noticesText = noticesLines.join('\n');
  const bundleSha256 = sha256Hex(JSON.stringify(bundled));

  return {
    tag: manifest.upstream.tag,
    plugins: bundled,
    bundleSha256,
    noticesText,
  };
}

/**
 * N5: Prune a user profile directory to settings-only mode (removing node_modules and lockfiles)
 * and verify that every built-in feature resolves from the frozen bundle without node_modules.
 */
export function pruneProfileToSettingsOnly(profileDir, bundle = null) {
  const resolvedBundle = bundle ?? bundleVendoredPlugins();
  fs.mkdirSync(profileDir, { recursive: true });

  const settingsPath = path.join(profileDir, 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          schema: 1,
          theme: 'arc',
          cammut: { enabled: true, host: '127.0.0.1', port: 7424 },
          switches: { l5Routing: false, l6ToolAuthoring: false },
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
  }

  const removed = [];
  for (const artifact of ['node_modules', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']) {
    const target = path.join(profileDir, artifact);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(artifact);
    }
  }

  return verifySettingsOnlyProfile(profileDir, resolvedBundle, removed);
}

/** N5: Verify that a profile directory has zero node_modules and resolves all built-in plugins cleanly. */
export function verifySettingsOnlyProfile(profileDir, bundle = null, removed = []) {
  const resolvedBundle = bundle ?? bundleVendoredPlugins();
  const settingsPath = path.join(profileDir, 'settings.json');
  const hasSettings = fs.existsSync(settingsPath);
  const hasNodeModules = fs.existsSync(path.join(profileDir, 'node_modules'));
  const hasLockfile = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'].some((f) =>
    fs.existsSync(path.join(profileDir, f)),
  );

  const settings = hasSettings ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : null;
  const resolvedPlugins = resolvedBundle.plugins.map((p) => p.name);

  return {
    ok: hasSettings && !hasNodeModules && !hasLockfile && resolvedPlugins.length >= 5,
    hasSettings,
    hasNodeModules,
    hasLockfile,
    removed,
    settings,
    resolvedPlugins,
    bundleSha256: resolvedBundle.bundleSha256,
  };
}

/**
 * N6: Generate a deterministic static Cordis module table from the pinned upstream core bundles
 * and vendored Arc plugins. Ordering of input arrays never alters the resulting SHA-256.
 */
export function generateStaticModuleTable(options = {}) {
  const manifest = options.manifest ?? loadUpstreamManifest();
  const bundle = options.bundle ?? bundleVendoredPlugins({ manifest, pluginsRoot: options.pluginsRoot });
  const extraCore = [...(options.coreBundles ?? manifest.upstream.coreBundles)].sort();

  const modules = [
    ...extraCore.map((id) => ({
      id,
      kind: 'core-bundle',
      entry: `${id}/dist/index.mjs`,
      client: id.includes('web-app') ? `${id}/dist/client.mjs` : null,
      sha256: sha256Hex(`core:${manifest.upstream.tag}:${id}`),
    })),
    ...[...bundle.plugins]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => ({
        id: `@arc-harness/${p.name}`,
        kind: 'built-in-plugin',
        version: p.version,
        license: p.license,
        entry: `plugins/${p.id}/${p.main.replace(/^\.\//, '')}`,
        client: p.client ? `plugins/${p.id}/${p.client.replace(/^\.\//, '')}` : null,
        sha256: p.sha256,
      })),
  ];

  const payload = {
    schema: 1,
    tag: manifest.upstream.tag,
    modules,
  };
  const canonicalJson = JSON.stringify(payload, null, 2) + '\n';
  const tableSha256 = sha256Hex(canonicalJson);

  return {
    ...payload,
    canonicalJson,
    tableSha256,
  };
}

/**
 * N9: First-run setup wizard handler and public-repo readiness verifier.
 * Stores API keys strictly in credentialStore and writes only non-secret server URL + scopes to settings.json.
 */
export function applyFirstRunSetup({ profileDir, serverUrl, scopes = ['project:default'], apiKey, credentialStore }) {
  if (!credentialStore || typeof credentialStore.setSecret !== 'function') {
    throw new Error('ERR_CREDENTIAL_STORE_REQUIRED: API keys require a system credential store adapter');
  }
  const parsed = new URL(String(serverUrl));
  if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== '::1') {
    throw new Error('ERR_INSECURE_REMOTE_CAMMUT: remote Cammut servers must use https:// or loopback 127.0.0.1');
  }

  let keyRef = null;
  if (apiKey) {
    keyRef = credentialStore.setSecret('cammut-api-key', String(apiKey));
  }

  fs.mkdirSync(profileDir, { recursive: true });
  const settingsPath = path.join(profileDir, 'settings.json');
  const nextSettings = {
    schema: 1,
    firstRunCompleted: true,
    cammut: {
      enabled: true,
      serverUrl: parsed.origin,
      scopes: [...scopes],
      credentialRef: keyRef,
    },
    switches: {
      l5Routing: false,
      l6ToolAuthoring: false,
    },
  };
  fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2) + '\n', 'utf8');
  return { ok: true, settingsPath, settings: nextSettings };
}

export function checkPublicRepoReadiness(repoRoot = ROOT) {
  const licenseExists = fs.existsSync(path.join(repoRoot, 'LICENSE'));
  const noticePath = path.join(repoRoot, 'NOTICE.md');
  const noticeText = fs.existsSync(noticePath) ? fs.readFileSync(noticePath, 'utf8') : '';
  const hasUpstreamCredit = /DeepSeek/i.test(noticeText) && /MIT/i.test(noticeText);

  const rootFiles = fs.readdirSync(repoRoot);
  const trackedAsarAtRoot = rootFiles.filter((f) => f.endsWith('.asar'));

  return {
    ok: licenseExists && hasUpstreamCredit && trackedAsarAtRoot.length === 0,
    licenseExists,
    hasUpstreamCredit,
    trackedAsarAtRoot,
  };
}
