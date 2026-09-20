// Start the real Arc Science service for the end-to-end suite on an isolated data
// directory with a known operator token. Playwright's webServer runs this and stops
// it (process tree) when the run ends. Nothing here talks to a model provider,
// Blender or the public network; the memory worker is used when it is built.
import {mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {E2E_PORT, E2E_TOKEN} from './fixtures.js';

const root = resolve(import.meta.dirname, '../../../..');
const data = mkdtempSync(join(tmpdir(), 'arc-e2e-'));
mkdirSync(data, {recursive: true});
const tokenFile = join(data, 'access.token');
writeFileSync(tokenFile, E2E_TOKEN + '\n', {mode: 0o600});

const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);
const optional = (path) => (existsSync(path) ? path : undefined);
const env = {
  ...process.env,
  PYTHONUTF8: '1',
  PYTHONPATH: resolve(root, 'apps/arc-science/src'),
  ARC_TOKEN_FILE: tokenFile,
  ARC_MEMORY_WORKER: optional(resolve(root, 'native/arc-memory/target/release', exe('arc-memory-worker'))),
  ARC_SVG2PNG: optional(resolve(root, 'native/arc-svg/target/release', exe('arc-svg2png'))),
  // Settings are owned by the native supervisor; the suite uses the built one when present.
  ARC_SUPERVISOR: optional(resolve(root, 'native/arc-science/target/release', exe('arc-science-native'))),
  ARC_PROJECT: data,
};
for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
delete env.ARC_MOLECULAR_BLENDER_PYTHON; // the suite never renders with Blender

console.log(`arc-science e2e service: data=${data} port=${E2E_PORT}`);
const child = spawn(process.env.ARC_E2E_PYTHON || 'python',
  ['-m', 'arc_science', 'serve', '--host', '127.0.0.1', '--port', String(E2E_PORT), '--data', data],
  {env, stdio: 'inherit'});
child.on('exit', (code) => {
  // The service owns the data directory; remove it once the service has released it.
  try { rmSync(data, {recursive: true, force: true, maxRetries: 5, retryDelay: 200}); } catch { /* leave the temp dir */ }
  process.exit(code ?? 1);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
