// Test suite for Arc Harness OAuth provider patches (T1-T4).
// Run: node --test test/oauth-patches.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openAsar } from '../lib/asar.mjs';
import { applyOAuthPatches } from '../lib/oauth-patches.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pristine = openAsar(path.join(root, 'pristine', 'app.asar'));

function applyToTempDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-oauth-test-'));
  const files = new Map();
  const text = (p) => {
    if (files.has(p)) return files.get(p);
    const f = pristine.byPath.get(p);
    assert.ok(f, `missing pristine file: ${p}`);
    return pristine.read(f).toString('utf8');
  };
  const put = (p, s) => { files.set(p, s); };
  const must = (cond, msg) => { assert.ok(cond, `patch assertion failed: ${msg}`); };
  const report = [];
  applyOAuthPatches({ text, put, must, report });
  return { tmp, files, report };
}

test('applyOAuthPatches patches expected files and passes node --check', () => {
  const { tmp, files, report } = applyToTempDir();
  try {
    assert.ok(files.size >= 14, `expected >= 14 patched files, got ${files.size}`);
    assert.ok(report.length >= 4, 'expected summary report entries');
    for (const [rel, code] of files) {
      if (!/\.(m?js|cjs)$/.test(rel)) continue;
      const out = path.join(tmp, rel.replace(/\//g, '_'));
      fs.writeFileSync(out, code, 'utf8');
      const r = spawnSync(process.execPath, ['--check', out], { stdio: ['ignore', 'inherit', 'inherit'] });
      assert.equal(r.status, 0, `${rel} failed syntax check`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('pi-ai OAuth flows: Google/Vertex PKCE + ADC, Qwen Device PKCE, MiniMax Global/CN PKCE', async () => {
  const { tmp, files } = applyToTempDir();
  try {
    // Extract the patched pi-ai oauth + provider modules into a runnable temp copy of pi-ai dist
    const piPrefix = 'dsh/node_modules/@earendil-works/pi-ai/';
    for (const f of pristine.files) {
      if (f.entry.unpacked || !f.path.startsWith(piPrefix)) continue;
      if (!/\.(m?js|json)$/.test(f.path)) continue;
      const dst = path.join(tmp, f.path.slice(piPrefix.length));
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      const content = files.has(f.path) ? files.get(f.path) : pristine.read(f);
      fs.writeFileSync(dst, content);
    }

    const loadMod = await import(new URL(`file:///${path.join(tmp, 'dist/auth/oauth/load.js').replace(/\\/g, '/')}`).href);
    const allMod = await import(new URL(`file:///${path.join(tmp, 'dist/providers/all.js').replace(/\\/g, '/')}`).href);

    // 1. Check provider catalog includes qwen-portal and oauth hooks on google, google-vertex, qwen*, minimax*
    const providers = new Map(allMod.builtinProviders().map((p) => [p.id, p]));
    for (const id of ['anthropic', 'openai', 'openai-codex', 'google', 'google-vertex', 'kimi-coding', 'qwen-portal', 'qwen-token-plan', 'qwen-token-plan-cn', 'qwen-token-plan-individual', 'minimax', 'minimax-cn']) {
      const p = providers.get(id);
      assert.ok(p, `missing provider ${id}`);
      assert.ok(p.auth.oauth, `provider ${id} must have oauth`);
    }
    const qwenPortal = providers.get('qwen-portal');
    assert.ok(qwenPortal.getModels().some((m) => m.id === 'coder-model'), 'qwen-portal ships coder-model');

    // 2. Test Qwen OAuth device flow (pending -> slow_down -> token) + refresh + toAuth
    const qwenOAuth = await loadMod.loadQwenOAuth();
    const origFetch = globalThis.fetch;
    let qwenPollCount = 0;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u === 'https://chat.qwen.ai/api/v1/oauth2/device/code') {
        const body = new URLSearchParams(String(init.body));
        assert.equal(body.get('code_challenge_method'), 'S256');
        assert.ok(body.get('code_challenge'));
        return new Response(JSON.stringify({
          device_code: 'qwen-dev-1',
          user_code: 'ABCD-1234',
          verification_uri: 'https://chat.qwen.ai/authorize',
          verification_uri_complete: 'https://chat.qwen.ai/authorize?user_code=ABCD-1234',
          expires_in: 300,
          interval: 0.01,
        }), { status: 200 });
      }
      if (u === 'https://chat.qwen.ai/api/v1/oauth2/token') {
        const body = new URLSearchParams(String(init.body));
        if (body.get('grant_type') === 'refresh_token') {
          return new Response(JSON.stringify({
            access_token: 'qwen-access-refreshed',
            refresh_token: 'qwen-refresh-2',
            expires_in: 3600,
            resource_url: 'portal.qwen.ai',
          }), { status: 200 });
        }
        qwenPollCount++;
        if (qwenPollCount === 1) return new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 });
        if (qwenPollCount === 2) return new Response(JSON.stringify({ error: 'slow_down', interval: 0.01 }), { status: 400 });
        assert.ok(body.get('code_verifier'));
        return new Response(JSON.stringify({
          access_token: 'qwen-access-1',
          refresh_token: 'qwen-refresh-1',
          expires_in: 3600,
          resource_url: 'portal.qwen.ai',
        }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${u}`);
    };
    try {
      const notices = [];
      const cred = await qwenOAuth.login({
        signal: new AbortController().signal,
        notify: (e) => notices.push(e),
        prompt: async () => '',
      });
      assert.equal(cred.access, 'qwen-access-1');
      assert.equal(cred.refresh, 'qwen-refresh-1');
      assert.equal(notices[0].type, 'device_code');
      assert.equal(notices[0].userCode, 'ABCD-1234');
      const auth = await qwenOAuth.toAuth(cred);
      assert.equal(auth.headers.Authorization, 'Bearer qwen-access-1');
      assert.equal(auth.headers['X-DashScope-AuthType'], 'qwen-oauth');
      assert.equal(auth.baseUrl, 'https://portal.qwen.ai/v1');
      const refreshed = await qwenOAuth.refresh(cred, new AbortController().signal);
      assert.equal(refreshed.access, 'qwen-access-refreshed');
      assert.equal(refreshed.refresh, 'qwen-refresh-2');
    } finally {
      globalThis.fetch = origFetch;
    }

    // 3. Test MiniMax Global & CN OAuth user_code flow + refresh
    const minimaxOAuth = await loadMod.loadMiniMaxOAuth('global');
    const minimaxCnOAuth = await loadMod.loadMiniMaxOAuth('cn');
    let mmPoll = 0;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u === 'https://api.minimax.io/oauth/code') {
        const body = new URLSearchParams(String(init.body));
        return new Response(JSON.stringify({
          user_code: 'MM-CODE-1',
          verification_uri: 'https://api.minimax.io/oauth/verify',
          expired_in: Date.now() + 60_000,
          interval: 0.01,
          state: body.get('state'),
        }), { status: 200 });
      }
      if (u === 'https://api.minimax.io/oauth/token' || u === 'https://api.minimaxi.com/oauth/token') {
        const body = new URLSearchParams(String(init.body));
        if (body.get('grant_type') === 'refresh_token') {
          return new Response(JSON.stringify({
            status: 'success',
            access_token: 'mm-access-2',
            refresh_token: 'mm-refresh-2',
            expired_in: Math.floor(Date.now() / 1000) + 7200,
          }), { status: 200 });
        }
        mmPoll++;
        if (mmPoll === 1) return new Response(JSON.stringify({ status: 'pending' }), { status: 200 });
        return new Response(JSON.stringify({
          status: 'success',
          access_token: 'mm-access-1',
          refresh_token: 'mm-refresh-1',
          expired_in: Date.now() + 7200_000,
        }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${u}`);
    };
    try {
      const notices = [];
      const cred = await minimaxOAuth.login({
        signal: new AbortController().signal,
        notify: (e) => notices.push(e),
        prompt: async () => '',
      });
      assert.equal(cred.access, 'mm-access-1');
      assert.equal(notices[0].type, 'device_code');
      assert.equal(notices[0].userCode, 'MM-CODE-1');
      const auth = await minimaxOAuth.toAuth(cred);
      assert.equal(auth.headers.Authorization, 'Bearer mm-access-1');
      assert.equal(auth.apiKey, undefined);
      const refreshedCn = await minimaxCnOAuth.refresh({ type: 'oauth', access: 'x', refresh: 'r', expires: 0 }, new AbortController().signal);
      assert.equal(refreshedCn.access, 'mm-access-2');
      assert.ok(refreshedCn.expires > Date.now() + 3600_000, 'seconds timestamp normalized to ms');
    } finally {
      globalThis.fetch = origFetch;
    }

    // 4. Test Google OAuth ADC import & refresh & toAuth
    const googleOAuth = await loadMod.loadGoogleOAuth('google');
    const vertexOAuth = await loadMod.loadGoogleOAuth('google-vertex');
    const adcFile = path.join(tmp, 'adc.json');
    fs.writeFileSync(adcFile, JSON.stringify({
      type: 'authorized_user',
      client_id: 'test-client.apps.googleusercontent.com',
      client_secret: 'test-secret',
      refresh_token: '1//test-refresh',
      quota_project_id: 'demo-proj',
    }));
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), 'https://oauth2.googleapis.com/token');
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('refresh_token'), '1//test-refresh');
      return new Response(JSON.stringify({
        access_token: 'ya29.test-token',
        expires_in: 3600,
      }), { status: 200 });
    };
    try {
      let step = 0;
      const gCred = await googleOAuth.login({
        signal: new AbortController().signal,
        notify: () => {},
        prompt: async (p) => {
          step++;
          if (p.type === 'select') return 'adc';
          if (step === 2) return adcFile;
          return '';
        },
      });
      assert.equal(gCred.access, 'ya29.test-token');
      assert.equal(gCred.projectId, 'demo-proj');
      const gAuth = await googleOAuth.toAuth(gCred);
      assert.equal(gAuth.headers.Authorization, 'Bearer ya29.test-token');
      assert.equal(gAuth.headers['x-goog-user-project'], 'demo-proj');

      const vAuth = await vertexOAuth.toAuth({ ...gCred, location: 'global' });
      assert.equal(vAuth.headers.Authorization, 'Bearer ya29.test-token');
      assert.equal(vAuth.env.GOOGLE_CLOUD_PROJECT, 'demo-proj');
      assert.equal(vAuth.env.GOOGLE_CLOUD_LOCATION, 'global');
    } finally {
      globalThis.fetch = origFetch;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('dsh-llm-pi-ai enables OpenAI OAuth, persists device id, and resolves OAuth records cleanly', () => {
  const { files } = applyToTempDir();
  const piAiAdapter = files.get('dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js');
  assert.ok(piAiAdapter);
  assert.ok(!piAiAdapter.includes('new Set(["openai"])'), 'openai must not be in UNSERVED_OAUTH');
  assert.ok(piAiAdapter.includes('.oauth-device-id'), 'persists installation device id for OpenAI OAuth');
  assert.ok(piAiAdapter.includes('"qwen-portal"'), 'PROVIDER_DATA includes qwen-portal');
  assert.ok(piAiAdapter.includes('readRecord(recordKeyFor(provider))'), 'resolveApiKey checks OAuth record fallback');
});

test('dsh-api-settings-controller & dsh-api-remotes expose CredentialsController OAuth RPC methods', async () => {
  const { files } = applyToTempDir();
  const ctrl = files.get('dsh/node_modules/@deepseek-ai/dsh-api-settings-controller/lib/index.js');
  const typertHost = files.get('dsh/node_modules/@deepseek-ai/dsh-api-settings-controller/lib/typert.host.js');
  const typertClient = files.get('dsh/node_modules/@deepseek-ai/dsh-api-settings-controller/lib/typert.remote-client.js');
  const apiRemotesClient = files.get('dsh/node_modules/@deepseek-ai/dsh-api-remotes/lib/client.js');

  for (const method of ['oauthList', 'oauthStart', 'oauthPoll', 'oauthAnswer', 'oauthCancel', 'oauthLogout']) {
    assert.ok(ctrl.includes(`async ${method}(`), `CredentialsController missing ${method}`);
    assert.ok(typertHost.includes(`credentials/${method}`), `typert.host.js missing credentials/${method}`);
    assert.ok(typertClient.includes(`credentials/${method}`), `typert.remote-client.js missing credentials/${method}`);
    assert.ok(apiRemotesClient.includes(`credentials/${method}`), `dsh-api-remotes/lib/client.js missing credentials/${method}`);
  }
});

test('google-generative-ai and google-vertex support Bearer OAuth via OAuth2Client', () => {
  const { files } = applyToTempDir();
  const gga = files.get('dsh/node_modules/@earendil-works/pi-ai/dist/api/google-generative-ai.js');
  const gv = files.get('dsh/node_modules/@earendil-works/pi-ai/dist/api/google-vertex.js');
  assert.ok(gga.includes('OAuth2Client') && gga.includes('_arcBearerToken'), 'google-generative-ai handles Bearer OAuth');
  assert.ok(gv.includes('OAuth2Client') && gv.includes('_arcVertexBearer'), 'google-vertex handles Bearer OAuth');
});

test('dsh-client-ui-settings-models wires OAuth operations, status, and zero blue/vendor strings', () => {
  const { files } = applyToTempDir();
  const ui = files.get('dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js');
  assert.ok(ui.includes('oauthList'), 'operations/store wires oauthList');
  assert.ok(ui.includes('oauthStart'), 'operations wires oauthStart');
  assert.ok(ui.includes('oauthAnswer'), 'operations wires oauthAnswer');
  assert.ok(ui.includes('oauthLogout'), 'operations wires oauthLogout');
  assert.ok(!/#[0-9a-f]{6}/i.test(ui.slice(ui.indexOf('jrmgQW_oauth'))), 'new OAuth CSS uses theme variables, not hardcoded hex');
});
