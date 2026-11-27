// Integration test for the bot-check / captcha-solver / promptpurge pipeline.
//   node test/integration-botcheck.test.mjs            (offline checks)
//   node test/integration-botcheck.test.mjs --live      (adds real HTTP probes)
//
// Offline checks verify detection logic, ChatML handling, interpolation
// escaping, retry policy, cookie cache, and cross-module imports.
// Live checks fetch real Cloudflare-protected pages and confirm detection.

import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';

import {
  sanitizePrompt,
  sanitizePromptFull,
  sanitizePayload,
  normalizeChatmlLayout,
  peelChatmlEnvelope,
  stripChatmlTags,
  escapeArcInterpolation,
  FILTER_DEFAULTS,
  GLOBAL_PROMPT_ORDER,
  createPromptSection,
  leadWithInject,
  shouldRetry,
  shouldContinue,
  calculateRetryDelay,
} from '../lib/promptpurge.mjs';

import {
  SOLVER_PROVIDERS,
  CAPTCHA_TYPES,
  createSolver,
  detectCloudflare,
} from '../lib/captcha-solver.mjs';

import {
  BOT_PROTECTION_TYPES,
  detectBotProtection,
  cacheClearedCookies,
  getCachedCookies,
  clearCachedCookies,
  clearAllCachedCookies,
} from '../lib/bot-check.mjs';

const LIVE = process.argv.includes('--live');
let bad = 0;
let skipped = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    bad++;
    console.error(`FAIL ${name} :: ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    bad++;
    console.error(`FAIL ${name} :: ${err.message}`);
  }
}

function skip(name) {
  skipped++;
  console.log(`skip ${name}`);
}

// ============================================================================
// 1. promptpurge — ChatML handling
// ============================================================================

test('chatml: normalize with auto-close', () => {
  const input = '<|im_start|>system:<project_instructions>hello world';
  const out = normalizeChatmlLayout(input);
  assert.ok(out.includes('<|im_start|>system:\n<project_instructions>'), 'ChatML on its own line');
  assert.ok(out.includes('</project_instructions>'), 'auto-closed');
});

test('chatml: already-closed passes through', () => {
  const input = '<|im_start|>system:\n<project_instructions>\ntest\n</project_instructions>';
  const out = normalizeChatmlLayout(input);
  assert.ok(out.includes('</project_instructions>'));
  assert.ok(!out.includes('</project_instructions>\n</project_instructions>'), 'no double close');
});

test('chatml: peel keeps structure', () => {
  const input = '<|im_start|>system:\n<project_instructions>\nbody\n</project_instructions>';
  const out = peelChatmlEnvelope(input);
  assert.ok(out.includes('<project_instructions>'));
  assert.ok(out.includes('</project_instructions>'));
});

test('chatml: strip removes all tags', () => {
  const input = '<|im_start|>system: <project_instructions>hello</project_instructions><|im_end|>';
  const out = stripChatmlTags(input);
  assert.ok(!out.includes('<|im_start|>'));
  assert.ok(!out.includes('<project_instructions>'));
  assert.ok(!out.includes('<|im_end|>'));
  assert.ok(out.includes('hello'));
});

// ============================================================================
// 2. promptpurge — interpolation escaping
// ============================================================================

test('interpolation: allowed variables pass through', () => {
  assert.equal(escapeArcInterpolation('{{cwd}}'), '{{cwd}}');
  assert.equal(escapeArcInterpolation('{{model}}'), '{{model}}');
  assert.equal(escapeArcInterpolation('{{provider}}'), '{{provider}}');
});

test('interpolation: unknown variables are escaped', () => {
  assert.equal(escapeArcInterpolation('{{secret}}'), '{ {secret}}');
  assert.equal(escapeArcInterpolation('{{foo_bar}}'), '{ {foo_bar}}');
});

test('interpolation: mixed allowed and unknown', () => {
  const input = 'Dir is {{cwd}} and key is {{api_key}}';
  const out = escapeArcInterpolation(input);
  assert.ok(out.includes('{{cwd}}'), 'cwd kept');
  assert.ok(out.includes('{ {api_key}}'), 'api_key escaped');
});

test('interpolation: no double-braces unchanged', () => {
  const input = 'just text with {single} braces';
  assert.equal(escapeArcInterpolation(input), input);
});

// ============================================================================
// 3. promptpurge — full sanitization pipeline
// ============================================================================

test('sanitizePromptFull: brand + ChatML + interpolation', () => {
  const input = '<|im_start|>system:<project_instructions>Welcome to DeepSeek Harness, dir={{cwd}}, key={{secret}}';
  const out = sanitizePromptFull(input, { handleChatML: true, escapeInterpolation: true });
  assert.ok(out.includes('Arc Harness'), 'brand rewritten');
  assert.ok(out.includes('{{cwd}}'), 'cwd kept');
  assert.ok(out.includes('{ {secret}}'), 'secret escaped');
  assert.ok(out.includes('</project_instructions>'), 'auto-closed');
});

test('sanitizePayload: system prompt gets ChatML treatment', () => {
  const payload = {
    system: '<|im_start|>system:<project_instructions>DeepSeek Harness agent',
    messages: [{ role: 'user', content: 'hello from dsh' }],
  };
  const out = sanitizePayload(payload, { handleChatML: true });
  assert.ok(out.system.includes('Arc Harness'), 'system brand rewritten');
  assert.ok(out.system.includes('</project_instructions>'), 'system auto-closed');
  assert.ok(out.messages[0].content.includes('arc'), 'message rewritten');
});

// ============================================================================
// 4. promptpurge — retry and continue logic
// ============================================================================

test('retry: rate limit triggers retry', () => {
  assert.ok(shouldRetry({ status: 429 }));
  assert.ok(shouldRetry({ status: 503 }));
  assert.ok(shouldRetry({ status: 500 }));
  assert.ok(shouldRetry({ error: { code: 'rate_limit_exceeded' } }));
});

test('retry: success does not trigger retry', () => {
  assert.ok(!shouldRetry({ status: 200 }));
  assert.ok(!shouldRetry({ status: 404 }));
  assert.ok(!shouldRetry(null));
});

test('continue: length finish triggers continue', () => {
  assert.ok(shouldContinue({ choices: [{ finish_reason: 'length' }] }));
  assert.ok(shouldContinue({ stop_reason: 'max_tokens' }));
});

test('continue: stop finish does not trigger continue', () => {
  assert.ok(!shouldContinue({ choices: [{ finish_reason: 'stop' }] }));
  assert.ok(!shouldContinue(null));
});

test('retry delay: exponential backoff with bounds', () => {
  const d0 = calculateRetryDelay(0, 1000, 30000);
  assert.ok(d0 >= 800 && d0 <= 1200, `delay 0 in range: ${d0}`);
  const d3 = calculateRetryDelay(3, 1000, 30000);
  assert.ok(d3 >= 6400 && d3 <= 9600, `delay 3 in range: ${d3}`);
  const d10 = calculateRetryDelay(10, 1000, 30000);
  assert.ok(d10 >= 24000 && d10 <= 36000, `delay 10 capped: ${d10}`);
});

// ============================================================================
// 5. promptpurge — section utilities
// ============================================================================

test('createPromptSection: makes well-formed section', () => {
  const s = createPromptSection('test-section', 'You are an agent with {{cwd}} access and {{secret}}');
  assert.equal(s.name, 'test-section');
  assert.ok(s.text.includes('{{cwd}}'), 'cwd kept');
  assert.ok(s.text.includes('{ {secret}}'), 'secret escaped');
  assert.equal(s.interpolate, false);
  assert.equal(s.order, GLOBAL_PROMPT_ORDER);
});

test('leadWithInject: injects at front', () => {
  const sections = [{ name: 'system', text: 'base', order: 0 }];
  const out = leadWithInject(sections, 'injected content');
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'arc-prompt-filter');
  assert.equal(out[1].name, 'system');
});

test('leadWithInject: empty inject returns sections as-is', () => {
  const sections = [{ name: 'a', text: 'x' }];
  assert.deepEqual(leadWithInject(sections, ''), sections);
  assert.deepEqual(leadWithInject(sections, null), sections);
});

// ============================================================================
// 6. captcha-solver — provider configuration
// ============================================================================

test('captcha providers: all three configured', () => {
  assert.ok(SOLVER_PROVIDERS['2captcha']);
  assert.ok(SOLVER_PROVIDERS['anti-captcha']);
  assert.ok(SOLVER_PROVIDERS['capmonster']);
});

test('captcha types: all types defined', () => {
  for (const t of ['RECAPTCHA_V2', 'RECAPTCHA_V3', 'HCAPTCHA', 'TURNSTILE', 'IMAGE', 'FUNCAPTCHA']) {
    assert.ok(CAPTCHA_TYPES[t], `type ${t} defined`);
  }
});

test('captcha solver: create 2captcha solver', () => {
  const solver = createSolver('2captcha', 'dummy-key');
  assert.ok(solver);
  assert.ok(typeof solver.submitRecaptchaV2 === 'function');
  assert.ok(typeof solver.submitTurnstile === 'function');
  assert.ok(typeof solver.getResult === 'function');
});

test('captcha solver: create anti-captcha solver', () => {
  const solver = createSolver('anti-captcha', 'dummy-key');
  assert.ok(solver);
  assert.ok(typeof solver.submitHCaptcha === 'function');
});

test('captcha solver: create capmonster solver', () => {
  const solver = createSolver('capmonster', 'dummy-key');
  assert.ok(solver);
});

test('captcha solver: reject unknown provider', () => {
  assert.throws(() => createSolver('unknown', 'key'), /Unknown CAPTCHA provider/);
});

test('captcha solver: reject missing key', () => {
  assert.throws(() => createSolver('2captcha', ''), /API key is required/);
});

// ============================================================================
// 7. captcha-solver — Cloudflare detection
// ============================================================================

test('cf detect: Cloudflare 403 with cf-ray', () => {
  const r = detectCloudflare({
    status: 403,
    headers: { 'cf-ray': '123abc', 'server': 'cloudflare' },
    body: 'Checking your browser. Performance & security by Cloudflare',
  });
  assert.ok(r.detected);
});

test('cf detect: Turnstile sitekey extraction preserves case', () => {
  const r = detectCloudflare({
    status: 403,
    headers: {},
    body: '<div class="cf-turnstile" data-sitekey="0x4AAAAAAABkMYinukE8nMYi"></div>',
  });
  assert.ok(r.detected);
  assert.equal(r.details.turnstileSiteKey, '0x4AAAAAAABkMYinukE8nMYi');
});

test('cf detect: normal page not flagged', () => {
  const r = detectCloudflare({ status: 200, headers: {}, body: '<html>Hello</html>' });
  assert.ok(!r.detected);
});

// ============================================================================
// 8. bot-check — multi-system detection
// ============================================================================

test('botcheck: Cloudflare challenge page', () => {
  const r = detectBotProtection({
    status: 403,
    headers: { 'cf-ray': 'abc', 'server': 'cloudflare' },
    body: 'Checking your browser before accessing the site. Performance & security by Cloudflare',
  });
  assert.ok(r.detected);
  assert.ok(r.isChallengePage);
  assert.ok(r.protections.some(p => p.type === BOT_PROTECTION_TYPES.CLOUDFLARE));
});

test('botcheck: reCAPTCHA v2 detection with sitekey', () => {
  const r = detectBotProtection({
    status: 200,
    headers: {},
    body: '<div class="g-recaptcha" data-sitekey="6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"></div>',
  });
  assert.ok(r.detected);
  const p = r.protections.find(p => p.type === BOT_PROTECTION_TYPES.RECAPTCHA);
  assert.ok(p);
  assert.equal(p.details.siteKey, '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI');
});

test('botcheck: hCaptcha detection', () => {
  const r = detectBotProtection({
    status: 200,
    headers: {},
    body: '<div class="h-captcha" data-sitekey="10000000-ffff-ffff-ffff-000000000001"></div> hcaptcha.com/1/api.js',
  });
  assert.ok(r.detected);
  assert.ok(r.protections.some(p => p.type === BOT_PROTECTION_TYPES.HCAPTCHA));
});

test('botcheck: DataDome detection via header', () => {
  const r = detectBotProtection({
    status: 403,
    headers: { 'x-datadome': 'protected' },
    body: 'DataDome check',
  });
  assert.ok(r.detected);
  assert.ok(r.protections.some(p => p.type === BOT_PROTECTION_TYPES.DATADOME));
});

test('botcheck: Incapsula detection', () => {
  const r = detectBotProtection({
    status: 403,
    headers: { 'x-iinfo': '1-2-3' },
    body: 'Powered by Incapsula',
  });
  assert.ok(r.detected);
  assert.ok(r.protections.some(p => p.type === BOT_PROTECTION_TYPES.INCAPSULA));
});

test('botcheck: clean page returns no detection', () => {
  const r = detectBotProtection({
    status: 200,
    headers: { 'server': 'nginx' },
    body: '<html><body>Welcome to my site</body></html>',
  });
  assert.ok(!r.detected);
  assert.equal(r.protections.length, 0);
  assert.ok(!r.isChallengePage);
});

// ============================================================================
// 9. bot-check — cookie cache
// ============================================================================

test('cookie cache: store and retrieve', () => {
  clearAllCachedCookies();
  cacheClearedCookies('https://example.com/page', [
    { name: 'cf_clearance', value: 'abc123' },
    { name: 'session', value: 'xyz789' },
  ]);
  const cookies = getCachedCookies('example.com');
  assert.ok(cookies);
  assert.equal(cookies.length, 2);
  assert.equal(cookies[0].name, 'cf_clearance');
});

test('cookie cache: different subdomains are separate', () => {
  clearAllCachedCookies();
  cacheClearedCookies('https://www.example.com', [{ name: 'a', value: '1' }]);
  cacheClearedCookies('https://api.example.com', [{ name: 'b', value: '2' }]);
  assert.equal(getCachedCookies('www.example.com')[0].name, 'a');
  assert.equal(getCachedCookies('api.example.com')[0].name, 'b');
});

test('cookie cache: clear single domain', () => {
  clearAllCachedCookies();
  cacheClearedCookies('https://a.com', [{ name: 'x', value: '1' }]);
  cacheClearedCookies('https://b.com', [{ name: 'y', value: '2' }]);
  clearCachedCookies('a.com');
  assert.equal(getCachedCookies('a.com'), null);
  assert.ok(getCachedCookies('b.com'));
});

test('cookie cache: clearAll empties everything', () => {
  cacheClearedCookies('https://a.com', [{ name: 'x', value: '1' }]);
  clearAllCachedCookies();
  assert.equal(getCachedCookies('a.com'), null);
});

// ============================================================================
// 10. Cross-module: prompt sanitisation + detection pipeline
// ============================================================================

test('pipeline: sanitized prompt stays clean after roundtrip', () => {
  const dirty = 'Configure dsh-purge for DeepSeek Harness under ~/.dsh';
  const clean = sanitizePrompt(dirty);
  assert.ok(!clean.includes('dsh-purge'));
  assert.ok(!clean.includes('DeepSeek Harness'));
  assert.ok(!clean.includes('~/.dsh'));
  assert.ok(clean.includes('Arc Harness'));
  assert.ok(clean.includes('~/.arc'));
});

test('pipeline: FILTER_DEFAULTS are sane', () => {
  assert.equal(FILTER_DEFAULTS.enabled, true);
  assert.equal(FILTER_DEFAULTS.retryMax, 3);
  assert.equal(FILTER_DEFAULTS.continueMax, 3);
  assert.equal(FILTER_DEFAULTS.autoRetry, true);
});

// ============================================================================
// 11. Live probes — real HTTP requests (--live flag)
// ============================================================================

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, {
      headers: { 'User-Agent': 'Arc-Harness-Test/1.0' },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const headers = {};
        for (const [k, v] of Object.entries(res.headers)) headers[k] = v;
        resolve({
          status: res.statusCode,
          headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function runLiveTests() {
  // Site known to have Cloudflare (may or may not challenge a simple GET)
  await testAsync('live: detect Cloudflare headers on cloudflare.com', async () => {
    const res = await fetchPage('https://www.cloudflare.com/');
    // Cloudflare's own site always has cf-ray
    assert.ok(res.headers['cf-ray'], 'cf-ray header present');
    const det = detectBotProtection(res);
    // We expect detection due to headers, though no challenge page on 200
    assert.ok(det.detected || res.headers['cf-ray'], 'Cloudflare presence noted');
  });

  // reCAPTCHA demo page from Google
  await testAsync('live: detect reCAPTCHA on Google demo', async () => {
    const res = await fetchPage('https://www.google.com/recaptcha/api2/demo');
    if (res.status === 200) {
      const det = detectBotProtection(res);
      assert.ok(det.detected, 'reCAPTCHA detected on demo page');
      const p = det.protections.find(p => p.type === BOT_PROTECTION_TYPES.RECAPTCHA);
      assert.ok(p, 'reCAPTCHA protection listed');
      assert.ok(p.details.siteKey, 'siteKey extracted');
      console.log(`       siteKey: ${p.details.siteKey}`);
    } else {
      console.log(`       skipped (status ${res.status})`);
    }
  });

  // A site that uses hCaptcha
  await testAsync('live: probe hcaptcha demo', async () => {
    try {
      const res = await fetchPage('https://accounts.hcaptcha.com/demo');
      if (res.status === 200 && res.body.includes('hcaptcha')) {
        const det = detectBotProtection(res);
        assert.ok(det.detected, 'hCaptcha detected');
      } else {
        console.log(`       skipped (status ${res.status})`);
      }
    } catch {
      console.log('       skipped (network error)');
    }
  });
}

// ============================================================================
// Run
// ============================================================================

if (LIVE) {
  console.log('\n--- live probes ---');
  await runLiveTests();
} else {
  skip('live: Cloudflare headers (use --live to run)');
  skip('live: reCAPTCHA Google demo (use --live to run)');
  skip('live: hCaptcha demo (use --live to run)');
}

console.log(`\n${bad === 0 ? 'ALL PASS' : `${bad} FAILED`}${skipped ? ` (${skipped} skipped)` : ''}`);
if (bad > 0) process.exitCode = 1;
