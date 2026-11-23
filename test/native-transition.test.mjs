// Phase 6 Arc Native transition test suite (N0-N9):
// - N0: pinned upstream manifest (dsh-v0.2.1-rc.5) and deterministic tree diff report
// - N1: runtime package-manager removal guard, registry/marketplace block, read-only Built-in features page
// - N2 & N4: vendored plugin bundler, license audit, and THIRD_PARTY_NOTICES generation
// - N5: settings-only profile pruning and node_modules absence verification
// - N6: reproducible static Cordis module-table SHA-256 across shuffled inputs
// - N3, N3b, N7e: live loopback Cammut HTTP gateway (127.0.0.1 bind guard, 401 Bearer auth, credential-store YAML secret refusal, memory policy toggles, L5/L6 switches off by default)
// - N8: all 6 native Rust validator modules cross-checked against Node golden vectors
// - N9: first-run credential-store wizard and public-repo readiness verifier
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  loadUpstreamManifest,
  diffUpstreamManifest,
  createRuntimePmGuard,
  bundleVendoredPlugins,
  pruneProfileToSettingsOnly,
  generateStaticModuleTable,
  applyFirstRunSetup,
  checkPublicRepoReadiness,
} from '../lib/native/transition.mjs';

import {
  assertLoopbackHost,
  createCredentialStoreBoundary,
  createLoopbackCammutGateway,
} from '../lib/native/cammut-gateway.mjs';

import {
  resolveNativeValidatorBinary,
  runNativeValidatorCli,
  sha256Hex,
  checkSealGuard,
  evaluateHook,
  lintProse,
  evaluateGrant,
  anchoredEntryDigest,
  evaluateNetEndpoint,
  validateSvg,
  THIRTY_DAYS_MS,
} from '../lib/native/validators.mjs';

test('N0: pinned upstream manifest locks dsh-v0.2.1-rc.5 and produces deterministic diff hashes', () => {
  const manifest = loadUpstreamManifest();
  assert.equal(manifest.upstream.repository, 'deepseek-ai/deepseek-harness');
  assert.equal(manifest.upstream.tag, 'dsh-v0.2.1-rc.5');
  assert.equal(manifest.upstream.sharedPackageEntries, 305);

  const src = { pkgB: 'hash-2', pkgA: 'hash-1', pkgOnlySrc: 'hash-3' };
  const arc = { pkgA: 'hash-1', pkgB: 'hash-changed', pkgOnlyArc: 'hash-4' };
  const r1 = diffUpstreamManifest(src, arc, { manifest });
  const r2 = diffUpstreamManifest({ pkgOnlySrc: 'hash-3', pkgA: 'hash-1', pkgB: 'hash-2' }, arc, { manifest });

  assert.equal(r1.sharedCount, 2);
  assert.equal(r1.matchedCount, 1);
  assert.equal(r1.differedCount, 1);
  assert.deepEqual(r1.onlySource, ['pkgOnlySrc']);
  assert.deepEqual(r1.onlyArchive, ['pkgOnlyArc']);
  assert.equal(r1.reportSha256, r2.reportSha256);
});

test('N1: runtime package-manager guard blocks npm/pnpm/yarn/plugin CLI, registry probes, and hot-reload watchers', () => {
  const guard = createRuntimePmGuard();

  for (const [cmd, args] of [
    ['pnpm', ['install']],
    ['npm.cmd', ['i', 'left-pad']],
    ['yarn', ['add', 'x']],
    ['corepack', ['enable']],
    ['arc', ['plugin', 'add', 'foo']],
    ['dsh', ['plugin', 'install', 'bar']],
  ]) {
    assert.throws(() => guard.checkSpawn(cmd, args), /ERR_PACKAGE_MANAGER_REMOVED|ERR_PLUGIN_CLI_REMOVED/);
  }

  assert.equal(guard.checkSpawn('git', ['status']).allowed, true);

  for (const blockedUrl of [
    'https://registry.npmjs.org/react',
    'https://registry.yarnpkg.com/lodash',
    'http://127.0.0.1:7424/marketplace/featured',
    'http://127.0.0.1:7424/api/plugins/install',
  ]) {
    assert.throws(() => guard.checkNetworkProbe(blockedUrl), /ERR_REGISTRY_PROBE_BLOCKED/);
  }
  assert.equal(guard.checkNetworkProbe('http://127.0.0.1:7424/api/arc-core/session/head').allowed, true);

  assert.throws(() => guard.checkHotReloadWatcher('plugins/arc-core'), /ERR_HOT_RELOAD_DISABLED/);

  const page = guard.builtInFeaturesPage();
  assert.equal(page.title, 'Built-in features');
  assert.equal(page.readOnly, true);
  assert.equal(page.controls.installByName, false);
  assert.equal(page.controls.marketplace, false);
  assert.ok(page.features.length >= 5);
  assert.ok(guard.auditLog().length >= 10);
});

test('N2 & N4: vendored plugin bundler audits licenses, rejects UNLICENSED plugins, and builds THIRD_PARTY_NOTICES', (t) => {
  const bundle = bundleVendoredPlugins();
  assert.deepEqual(
    bundle.plugins.map((p) => p.id),
    ['arc-core', 'arc-hoh', 'arc-mermaid', 'arc-mode', 'arc-molecullage', 'arc-theme', 'arc-web-crawler'],
  );
  assert.match(bundle.noticesText, /Based on DeepSeek Harness \(dsh-v0\.2\.1-rc\.5\), MIT/);
  assert.match(bundle.noticesText, /SIL Open Font License 1\.1/);
  // the notices name every built-in plugin at the version of the VERSION file, so a version bump needs no edit here
  const arcVersion = fs.readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
  for (const name of ['arc-core', 'arc-mermaid', 'arc-web-crawler']) assert.ok(bundle.noticesText.includes(`\`${name}@${arcVersion}\``), `${name}@${arcVersion} is in the notices`);

  // Negative test: reject a plugin with UNLICENSED or missing license
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-vendor-bad-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const badPluginDir = path.join(tmpDir, 'bad-plugin');
  fs.mkdirSync(badPluginDir, { recursive: true });
  fs.writeFileSync(path.join(badPluginDir, 'package.json'), JSON.stringify({ name: 'bad-plugin', version: '0.1.0', license: 'UNLICENSED' }));

  assert.throws(
    () => bundleVendoredPlugins({ pluginsRoot: tmpDir, pluginIds: ['bad-plugin'] }),
    /ERR_LICENSE_AUDIT_FAILED/,
  );
});

test('N5 & N6: settings-only profile removes node_modules cleanly and static module table hash is order-invariant', (t) => {
  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-profile-n5-'));
  t.after(() => fs.rmSync(tmpProfile, { recursive: true, force: true }));

  fs.mkdirSync(path.join(tmpProfile, 'node_modules', 'leftover-pkg'), { recursive: true });
  fs.writeFileSync(path.join(tmpProfile, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');

  const status = pruneProfileToSettingsOnly(tmpProfile);
  assert.equal(status.ok, true);
  assert.equal(status.hasNodeModules, false);
  assert.equal(status.hasLockfile, false);
  assert.deepEqual(status.removed.sort(), ['node_modules', 'pnpm-lock.yaml']);
  assert.equal(status.resolvedPlugins.length, 7);

  const t1 = generateStaticModuleTable({
    coreBundles: ['@arc-harness/arc-web-app', '@arc-harness/arc-base'],
  });
  const t2 = generateStaticModuleTable({
    coreBundles: ['@arc-harness/arc-base', '@arc-harness/arc-web-app'],
  });
  assert.equal(t1.tableSha256, t2.tableSha256);
  assert.equal(t1.modules.length, 9);
});

test('N3, N3b & N7e: loopback Cammut gateway enforces 127.0.0.1 bind, 401 Bearer auth, secret boundary, memory policy, and L5/L6 default-off switches', async (t) => {
  // Non-loopback bind must throw immediately
  assert.throws(() => assertLoopbackHost('0.0.0.0'), /ERR_NON_LOOPBACK_BIND/);
  assert.throws(() => assertLoopbackHost('192.168.1.10'), /ERR_NON_LOOPBACK_BIND/);

  const credStore = createCredentialStoreBoundary();
  const fakeToken = 'test-loopback-bearer-token-2026';
  const gw = createLoopbackCammutGateway({
    host: '127.0.0.1',
    authToken: fakeToken,
    credentialStore: credStore,
  });
  const addr = await gw.listen(0);
  t.after(() => gw.close());

  // 1. Missing or wrong Bearer token -> HTTP 401
  const unauthRes = await fetch(`${addr.baseUrl}/health`);
  assert.equal(unauthRes.status, 401);

  const wrongRes = await fetch(`${addr.baseUrl}/health`, {
    headers: { Authorization: 'Bearer wrong-token' },
  });
  assert.equal(wrongRes.status, 401);

  const authHeaders = {
    Authorization: `Bearer ${fakeToken}`,
    'Content-Type': 'application/json',
  };

  // 2. Authenticated /health shows loopback bind and L5/L6 switches strictly off
  const healthRes = await fetch(`${addr.baseUrl}/health`, { headers: authHeaders });
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.bind, '127.0.0.1');
  assert.deepEqual(health.switches, { l5Routing: false, l6ToolAuthoring: false });

  // 3. Plaintext secret in /settings (both YAML and JSON apiKey) is refused
  const yamlSecretRes = await fetch(`${addr.baseUrl}/settings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fakeToken}`, 'Content-Type': 'text/yaml' },
    body: `api_key: ${'sk-' + 'b2'.repeat(16)}\n`,
  });
  assert.equal(yamlSecretRes.status, 400);

  const jsonSecretRes = await fetch(`${addr.baseUrl}/settings`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ apiKey: 'raw-secret-key-value' }),
  });
  assert.equal(jsonSecretRes.status, 400);

  // Credential reference via cred:// succeeds cleanly
  const ref = credStore.setSecret('user-vps-key', 'kept-in-vault-only');
  const safeSettingsRes = await fetch(`${addr.baseUrl}/settings`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ apiKey: ref, scopes: ['project:arc-science'] }),
  });
  assert.equal(safeSettingsRes.status, 200);

  // 4. Memory policy (N3b): rejects secrets, enforces tags, retains, recalls, and supersedes stale notes
  const secretNoteRes = await fetch(`${addr.baseUrl}/hindsight/retain`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      text: `Leaked key ${'sk-' + 'c3'.repeat(15)}`,
      tags: ['project:arc-science', 'date:2026-11-09', 'source:test'],
    }),
  });
  assert.equal(secretNoteRes.status, 400);

  const retain1 = await fetch(`${addr.baseUrl}/hindsight/retain`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      text: 'Initial thermal model uses 42 C water.',
      tags: ['project:arc-science', 'date:2026-11-09', 'source:test', 'topic:miraeles'],
    }),
  });
  assert.equal(retain1.status, 200);
  const note1 = (await retain1.json()).note;

  const retain2 = await fetch(`${addr.baseUrl}/hindsight/retain`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      text: 'Updated thermal model holds above 37 C for 25 minutes.',
      tags: ['project:arc-science', 'date:2026-11-09', 'source:test', 'topic:miraeles'],
      supersedes: note1.id,
    }),
  });
  assert.equal(retain2.status, 200);

  const recallRes = await fetch(`${addr.baseUrl}/hindsight/recall`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ query: 'thermal model', tags: ['topic:miraeles'] }),
  });
  const recalled = await recallRes.json();
  assert.equal(recalled.count, 1);
  assert.match(recalled.notes[0].text, /37 C/);

  // 5. L5 routing and L6 tool authoring return 403 while operator switches are off, and 200 when explicitly enabled
  const l5Off = await fetch(`${addr.baseUrl}/l5/route`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ taskKind: 'figure' }),
  });
  assert.equal(l5Off.status, 403);

  const l6Off = await fetch(`${addr.baseUrl}/l6/author`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: 'shelf_probe', description: 'Read shelf entry' }),
  });
  assert.equal(l6Off.status, 403);

  gw.setOperatorSwitch('l5Routing', true);
  gw.setOperatorSwitch('l6ToolAuthoring', true);

  const l5On = await fetch(`${addr.baseUrl}/l5/route`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ taskKind: 'figure' }),
  });
  assert.equal(l5On.status, 200);
  assert.equal((await l5On.json()).route, 'molecullage-worker');

  const l6On = await fetch(`${addr.baseUrl}/l6/author`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: 'shelf_probe', description: 'Read shelf entry' }),
  });
  assert.equal(l6On.status, 200);
});

test('N8: all 6 native Rust validator modules match Node golden vectors byte-for-byte', () => {
  const bin = resolveNativeValidatorBinary();
  assert.ok(bin, 'Rust arc-validators binary should be compiled and available');

  // 1. SHA-256 golden check
  for (const sample of ['', 'abc', '{"claim":"1IGT","level":"published"}']) {
    const rustSha = runNativeValidatorCli('sha256', [sample]).sha256;
    assert.equal(rustSha, sha256Hex(Buffer.from(sample, 'utf8')));
  }

  // 2. seal_guard golden check
  const sealedCsv = 'scripts/seal_guard.py,brandtext/upstream-manifest.json';
  for (const [target, mode] of [
    ['../outside.txt', 'write'],
    ['scripts/seal_guard.py', 'write'],
    ['scripts/seal_guard.py', 'read'],
    ['plugins/arc-core/ui/panel.js', 'write'],
  ]) {
    const rustRes = runNativeValidatorCli('seal-guard', [target, mode, sealedCsv]);
    const jsRes = checkSealGuard(target, { isWrite: mode === 'write', sealedPaths: sealedCsv.split(',') });
    assert.equal(rustRes.allowed, jsRes.allowed);
    assert.equal(rustRes.code, jsRes.code);
  }

  // 3. arc_hook golden check (including escaped quotes, multi-backticks, and unclosed single-line quotes)
  for (const [recalled, substantive, text] of [
    [false, true, 'Edited file.'],
    [true, true, 'Checked "Пример.txt" and `код` cleanly.'],
    [true, true, 'Saved "файл \\"привет\\".txt" and ``код `внутри` спана`` cleanly.'],
    [true, true, 'He said "hello\nПривет мир'],
    [true, false, 'Привет, мир.'],
  ]) {
    const rustHook = runNativeValidatorCli('arc-hook', [String(recalled), String(substantive)], text);
    const jsHook = evaluateHook({ cammutRecalled: recalled, isSubstantiveEdit: substantive, replyText: text });
    assert.equal(rustHook.allowed, jsHook.allowed);
    assert.deepEqual(rustHook.violations, jsHook.violations);
  }

  // 4. arc_rules prose lint golden check (including UTF-8 BOM on slide header)
  const refusedWord = ['lever', 'age'].join('');
  const dirtyProse = `\uFEFF# Build 5x faster, today\nWe ${refusedWord} our tools.\nIt is not a script, it is a platform.\nIts check passes. No model is trained yet.`;
  const rustDirty = runNativeValidatorCli('arc-rules', ['--slide'], dirtyProse);
  const jsDirty = lintProse(dirtyProse, { slideMode: true });
  assert.equal(rustDirty.ok, false);
  assert.deepEqual(rustDirty.findings, jsDirty.findings);

  const cleanProse = '# Validation ladder\nEvery check passed across all three themes.';
  assert.equal(runNativeValidatorCli('arc-rules', ['--slide'], cleanProse).ok, true);

  // 5. arc_scan golden check (including multi-byte UTF-8 after '#' and personal path after Public placeholder)
  const winHome = ['C:', 'Users', 'alice', 'doc.txt'].join('\\');
  const winPublic = ['C:', 'Users', 'Public', 'shared.txt'].join('\\');
  const winPlaceholder = ['C:', 'Users', '<you>', 'doc.txt'].join('\\');
  const fakeSk = 'sk-' + 'd4'.repeat(15);
  const scanInput = `# Молекула\n${winPublic} ${winHome}\n${winPlaceholder}\n${fakeSk}\n#2563eb\n`;
  const rustScan = runNativeValidatorCli('arc-scan', [], scanInput);
  assert.equal(rustScan.clean, false);
  assert.deepEqual(
    rustScan.hits.map((h) => h.class),
    ['windows_home_path', 'secret_token', 'blue_hex'],
  );

  // 6. grants, anchored digest, and net-guard golden checks
  for (const [mode, issued, now, revoked] of [
    ['Grant for 30 days', 5000, 5000 + 60_000, false],
    ['Grant for 30 days', 5000, 5000 + THIRTY_DAYS_MS, false],
    ['Grant for 30 days', 5000, 6000, true],
    ['Single action', 5000, 5000, false],
    ['Single action', 5000, 5001, false],
  ]) {
    const rustGrant = runNativeValidatorCli('grant-check', [mode, issued, now, revoked]);
    const jsGrant = evaluateGrant(mode, issued, now, revoked);
    assert.deepEqual(rustGrant, jsGrant);
  }

  let prev = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
  for (let seq = 1; seq <= 3; seq++) {
    const payload = JSON.stringify({ branch: `b-${seq}`, rung: 'L4', verified: true });
    const rustDigest = runNativeValidatorCli('anchored-digest', [prev, seq, 'gate.pass', payload]).digest;
    const jsDigest = anchoredEntryDigest(prev, seq, 'gate.pass', payload);
    assert.equal(rustDigest, jsDigest, `golden anchored digest match at seq=${seq}`);
    prev = rustDigest;
  }

  for (const [host, port, allow] of [
    ['127.0.0.1', 7424, ''],
    ['0.0.0.0', 7424, ''],
    ['api.crossref.org', 443, 'api.crossref.org,eutils.ncbi.nlm.nih.gov'],
    ['untrusted.invalid', 443, 'api.crossref.org'],
  ]) {
    const rustNet = runNativeValidatorCli('net-guard', [host, port, allow]);
    const jsNet = evaluateNetEndpoint(host, port, allow ? allow.split(',') : []);
    assert.deepEqual(rustNet, jsNet);
  }

  // 7. vector_assets SVG validator golden check (including multi-byte UTF-8 comment after '#')
  const validIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><!-- # Молекула --><path d="M4 12h16"/></svg>';
  const invalidIcon = '<svg viewBox="0 0 16 16" stroke="#2563eb" onclick="x()"><script>1</script></svg>';
  assert.deepEqual(runNativeValidatorCli('vector-svg', [], validIcon), validateSvg(validIcon));
  assert.deepEqual(runNativeValidatorCli('vector-svg', [], invalidIcon), validateSvg(invalidIcon));
});

test('N8b: the Rust prose gate reads the engine lexicon and gives the JS verdict on every case file, held-out and blind included', async () => {
  const { loadCases, HELDOUT, BLIND3, RU_CASES, RU_BLIND, F102_BLIND, BLIND4, F102_BLIND2, RU_BLIND2 } = await import('../tools/prose-gate.mjs');
  const { check } = await import('../plugins/arc-core/lib/prose-gate.js');
  // Multi-line cases cross the zone code (headings, labels, lists, fences, CR, U+2028) and the probes of review wf_48e95a53-271.
  const zoneCases = [
    '# Nimbus\n## Limits\nNo model has been trained.\n## Method\nNothing has been run.',
    '# Arc\n\n## API rate limits\n\nThe model is not trained.',
    '# Pushing the limits of design\nNo model has been trained.',
    'Snöggo runs.\n\nLimits:\n- Not trained.\n- No outcome yet.\n\nNothing has been run.',
    'Limits:\nThe model is not trained.',
    '```\nNot trained.\n```\nThe model is built.',
    '# Title\rThe model is not trained.',
    '# Limits\rThe model is not trained.\nNo model was trained.',
    'Not trained.\u0085If the split is frozen we train.',
    'Not http:// trained.',
    'The model is not trаined.',
    'The model is not trained (см. ниже).',
    'The tool does not include модуль экспорта.',
    'Your data stays local and is never published.',
    '## Ограничения\n- Модель не обучена.',
    // two bands (S049): a block replaces the mark it overlaps; a mark with a trigger phrase of the console rewrite
    'No model is trained so far.',
    'Other groups have not reported it so far, but we did.',
    'Not trained, and no adverse events were reported.',
  ].map((text) => ({ zone: 'public', text }));
  // The screen's fix 50d7083: exceptions stay inside the clause of the hit, and the words in code are read.
  const pinned = {
    'Our tests found two bugs, and we have not run the benchmark.': 'undercut',
    'We have not run the benchmark, if the review allows.': 'undercut',
    'We have not run the benchmark if the review allows.': 'review',
    'The model is `not trained`.': 'undercut',
    'The flag `--dry-run` prints the plan.': 'clean',
    '```\nNot trained.\n```\nThe model is built.': 'undercut',
    // review of PR 35: a heading inside a fence opens no zone; ~~~ is a fence; only the same marker, as long or longer,
    // closes it; ```code``` on one line opens nothing, so a real Limits heading after it still opens its section
    '~~~\n## Limits\n~~~\nThe model is not trained.': 'undercut',
    '```\n## Limits\n```\nThe model is not trained.': 'undercut',
    '````\n```\n## Limits\n````\nNot trained.': 'undercut',
    '~~~\n```\n## Limits\n~~~\nNot trained.': 'undercut',
    '```js```\n## Limits\nNot trained.': 'clean',
    // review of PR 35: an accent, an invisible character, a combining mark or a Greek look-alike does not split a word,
    // and Greek letters in science names stay clean
    'The model is nôt trained.': 'undercut',
    'The model is no​t trained.': 'undercut',
    'The model is nôt trained.': 'undercut',
    'The model is nοt trained.': 'undercut',
    'Модель пока не обу​чена.': 'undercut',
    'TNFα and IFNγ rose by 2 μM in Aβ42 cells.': 'clean',
    // review of PR 35: a heading is read, and a hit there is a mark ("Not yet supported" may be an honest title)
    '# Nothing has been run.\nThe tool runs.': 'review',
    '## Not yet benchmarked ##\nThe tool runs.': 'review',
    '## Limits ##\nNot trained.': 'clean',
    '## Method\nNot trained.': 'undercut',
  };
  for (const text of Object.keys(pinned)) if (!zoneCases.some((c) => c.text === text)) zoneCases.push({ zone: 'public', text });
  const cases = [...loadCases(), ...loadCases(RU_CASES), ...loadCases(HELDOUT), ...loadCases(BLIND3), ...loadCases(RU_BLIND), ...loadCases(F102_BLIND), ...loadCases(BLIND4), ...loadCases(F102_BLIND2), ...loadCases(RU_BLIND2), ...zoneCases];
  assert.ok(cases.length >= 1070, `${cases.length} cases`);
  const js = cases.map((c) => {
    const f = check(c.text, { zone: c.zone }).findings;
    return f.some((x) => x.rule === 'SELF_UNDERCUT') ? 'undercut' : f.some((x) => x.rule === 'UNSURE_ABSENCE') ? 'review' : 'clean';
  });
  const rust = runNativeValidatorCli('prose-gate', [], cases.map((c) => `${c.zone}|${c.text.replace(/\n/g, '\\n')}`).join('\n'));
  const differ = cases.map((c, i) => (rust[i] === js[i] ? null : `rust ${rust[i]}, js ${js[i]}: ${JSON.stringify(c.text)}`)).filter(Boolean);
  assert.deepEqual(differ, []);
  for (const [text, want] of Object.entries(pinned)) assert.equal(js[cases.findIndex((c) => c.text === text)], want, text);
  // Line by line too: the lint of every case, joined into one text, gives the same findings in Rust and JS.
  const joined = [...cases.filter((c) => c.zone === 'public').map((c) => c.text.replace(/[\r\n\u2028\u2029\u0085]/g, ' ')), ...zoneCases.map((c) => c.text)].join('\n');
  assert.deepEqual(runNativeValidatorCli('arc-rules', [], joined).findings, lintProse(joined).findings);
});

test('N9: first-run setup stores keys in credentialStore only and public-repo readiness passes', (t) => {
  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-firstrun-'));
  t.after(() => fs.rmSync(tmpProfile, { recursive: true, force: true }));

  const credStore = createCredentialStoreBoundary();
  assert.throws(
    () =>
      applyFirstRunSetup({
        profileDir: tmpProfile,
        serverUrl: 'http://example.org:7424',
        apiKey: 'secret-vps-token',
        credentialStore: credStore,
      }),
    /ERR_INSECURE_REMOTE_CAMMUT/,
  );

  const setup = applyFirstRunSetup({
    profileDir: tmpProfile,
    serverUrl: 'https://cammut.example.org',
    scopes: ['project:arc-science'],
    apiKey: 'secret-vps-token',
    credentialStore: credStore,
  });
  assert.equal(setup.ok, true);
  const diskJson = fs.readFileSync(setup.settingsPath, 'utf8');
  assert.ok(!diskJson.includes('secret-vps-token'), 'API key never written to settings.json on disk');
  assert.equal(setup.settings.cammut.credentialRef, 'cred://cammut-api-key');
  assert.equal(credStore.getSecret('cred://cammut-api-key'), 'secret-vps-token');

  const repoReady = checkPublicRepoReadiness();
  assert.equal(repoReady.ok, true);
  assert.equal(repoReady.licenseExists, true);
  assert.equal(repoReady.hasUpstreamCredit, true);
  assert.equal(repoReady.trackedAsarAtRoot.length, 0);
});
