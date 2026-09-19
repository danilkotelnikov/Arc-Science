// End-to-end suite: the compiled workbench served by the real Python service on an
// isolated data directory (see e2e/serve.mjs). Run `npm run build` first so the
// service serves the current bundle; `npm run e2e` does both.
import {defineConfig, devices} from '@playwright/test';
import {BASE} from './e2e/fixtures.js';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.js/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 150_000,
  reporter: [['list'], ['html', {open: 'never', outputFolder: 'e2e-report'}]],
  outputDir: 'e2e-results',
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
  webServer: {
    command: 'node e2e/serve.mjs',
    url: `${BASE}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
