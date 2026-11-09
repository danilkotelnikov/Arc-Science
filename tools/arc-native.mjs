// CLI entrypoint for Arc Native Phase 6 slices (N0-N9):
//   node tools/arc-native.mjs status
//   node tools/arc-native.mjs bundle [--out <file>]
//   node tools/arc-native.mjs module-table [--out <file>]
//   node tools/arc-native.mjs prune-profile --home <dir>
//   node tools/arc-native.mjs selftest
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadUpstreamManifest,
  bundleVendoredPlugins,
  pruneProfileToSettingsOnly,
  generateStaticModuleTable,
  checkPublicRepoReadiness,
} from '../lib/native/transition.mjs';
import { resolveNativeValidatorBinary, runNativeValidatorCli } from '../lib/native/validators.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'status';

function argValue(flag) {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (cmd === 'status') {
    const manifest = loadUpstreamManifest();
    const bundle = bundleVendoredPlugins({ manifest });
    const table = generateStaticModuleTable({ manifest, bundle });
    const ready = checkPublicRepoReadiness();
    const rustBin = resolveNativeValidatorBinary({ autoBuild: false });
    console.log(
      JSON.stringify(
        {
          ok: true,
          upstreamTag: manifest.upstream.tag,
          builtInPlugins: bundle.plugins.map((p) => `${p.name}@${p.version}`),
          bundleSha256: bundle.bundleSha256,
          moduleTableSha256: table.tableSha256,
          publicRepoReady: ready.ok,
          rustValidatorsCompiled: Boolean(rustBin),
        },
        null,
        2,
      ),
    );
  } else if (cmd === 'bundle') {
    const bundle = bundleVendoredPlugins();
    const out = argValue('--out');
    if (out) {
      fs.writeFileSync(path.resolve(out), bundle.noticesText, 'utf8');
    }
    console.log(JSON.stringify({ ok: true, bundleSha256: bundle.bundleSha256, plugins: bundle.plugins.length }));
  } else if (cmd === 'module-table') {
    const table = generateStaticModuleTable();
    const out = argValue('--out');
    if (out) {
      fs.writeFileSync(path.resolve(out), table.canonicalJson, 'utf8');
    }
    console.log(JSON.stringify({ ok: true, tableSha256: table.tableSha256, modules: table.modules.length }));
  } else if (cmd === 'prune-profile') {
    const home = argValue('--home');
    if (!home) {
      console.error('usage: node tools/arc-native.mjs prune-profile --home <dir>');
      process.exit(2);
    }
    const res = pruneProfileToSettingsOnly(path.resolve(home));
    console.log(JSON.stringify(res, null, 2));
  } else if (cmd === 'selftest') {
    const sha = runNativeValidatorCli('sha256', ['abc']);
    if (sha.sha256 !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') {
      throw new Error('Rust SHA-256 selftest mismatch');
    }
    console.log('arc-native selftest: ok');
  } else {
    console.error('usage: node tools/arc-native.mjs <status|bundle|module-table|prune-profile|selftest>');
    process.exit(2);
  }
}
