import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, createFetchProvider, createSearchProvider, PROVIDER_ID, renderAnalyzeMarkdown, renderCrawlMarkdown } from '../lib/index.js';
import { runCrawlerCommand } from '../lib/runner.js';

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_LIVE_CI = process.env.CI === 'true' && process.env.ARC_LIVE_WEB_TESTS !== '1';

test('arc-web-crawler contains zero legacy vendor brand references', () => {
  for (const rel of ['package.json', 'cordis.patch.yml', 'README.md', 'lib/index.js', 'lib/runner.js', 'py/crawler_engine.py', 'icon.svg', 'locale/en.json']) {
    const content = fs.readFileSync(path.join(PLUGIN_DIR, rel), 'utf8');
    assert.equal(/deep\x73eek/i.test(content), false, `unexpected vendor reference in ${rel}`);
  }
});

test('web_analyze and web_crawl render formatted Markdown and native web presentation cards', () => {
  const tools = new Map();
  apply({
    web: { registerSearchProvider() {}, registerFetchProvider() {} },
    tools: { register: (t) => tools.set(t.name, t) },
  }, {});

  const analyzeTool = tools.get('web_analyze');
  const sampleAnalyze = {
    ok: true,
    url: 'https://example.com',
    final_url: 'https://example.com/',
    status_code: 200,
    tier: 'stealth_browser',
    bot_shield_bypassed: true,
    initial_challenge: { vendor: 'cloudflare' },
    challenge: { detected: false },
    content_type: 'text/html',
    metadata: { title: 'Example Page', site_name: 'example.com' },
    headings: ['h1: Example Page'],
    links: [{ url: 'https://example.com/docs', text: 'Docs' }],
    markdown: 'Clean extracted paragraph.',
    truncated: false,
  };
  const md = renderAnalyzeMarkdown(sampleAnalyze);
  assert.match(md, /# Example Page/);
  assert.match(md, /Bot-shield: verified \(cloudflare\)/);
  assert.match(md, /\[Docs\]\(https:\/\/example\.com\/docs\)/);
  assert.equal(md.trim().startsWith('{'), false, 'must render Markdown, not raw JSON');

  const meta = analyzeTool.output.presentationMeta({ url: 'https://example.com' }, sampleAnalyze);
  const card = analyzeTool.presentResult({ url: 'https://example.com' }, { isError: false, meta });
  assert.equal(card.card, 'web');
  assert.equal(card.kind, 'fetch');
  assert.equal(card.statusCode, 200);

  const crawlTool = tools.get('web_crawl');
  const sampleCrawl = {
    ok: true,
    start_url: 'https://example.com/',
    pages_crawled: 1,
    pages: [{ url: 'https://example.com/', status_code: 200, tier: 'http_impersonate', title: 'Example', word_count: 42, markdown: 'Hello world' }],
  };
  const crawlMd = renderCrawlMarkdown(sampleCrawl);
  assert.match(crawlMd, /Crawled 1 page/);
  assert.match(crawlMd, /## 1\. Example/);
  const crawlMeta = crawlTool.output.presentationMeta({ url: 'https://example.com/' }, sampleCrawl);
  const crawlCard = crawlTool.presentResult({ url: 'https://example.com/' }, { isError: false, meta: crawlMeta });
  assert.equal(crawlCard.card, 'web');
  assert.equal(crawlCard.kind, 'search');
  assert.equal(crawlCard.sources.length, 1);
});

test('doctor reports all required open-source crawler dependencies installed', { skip: SKIP_LIVE_CI ? 'Python crawler stack tested locally' : false }, async () => {
  const res = await runCrawlerCommand('doctor', {});
  assert.equal(res.ok, true);
  for (const dep of ['scrapling', 'curl_cffi', 'patchright', 'trafilatura', 'ddgs', 'bs4', 'lxml', 'markdownify', 'pymupdf']) {
    assert.equal(res.dependencies[dep], true, `missing dependency: ${dep}`);
  }
});

test('Cordis plugin registers arc-crawler search/fetch providers and web_analyze/web_crawl tools', () => {
  const searchProviders = new Map();
  const fetchProviders = new Map();
  const tools = new Map();
  const ctx = {
    web: {
      registerSearchProvider: (p) => searchProviders.set(p.id, p),
      registerFetchProvider: (p) => fetchProviders.set(p.id, p),
    },
    tools: {
      register: (t) => tools.set(t.name, t),
    },
  };

  apply(ctx, {});

  assert.equal(searchProviders.has(PROVIDER_ID), true);
  assert.equal(fetchProviders.has(PROVIDER_ID), true);
  assert.equal(searchProviders.get(PROVIDER_ID).available(), true);
  assert.equal(fetchProviders.get(PROVIDER_ID).available(), true);
  assert.equal(tools.has('web_analyze'), true);
  assert.equal(tools.has('web_crawl'), true);
});

test('Cordis strict context without direct tools injection mounts providers and defers tool registration via ctx.inject', () => {
  const searchProviders = new Map();
  const fetchProviders = new Map();
  const tools = new Map();
  const ctx = {
    web: {
      registerSearchProvider: (p) => searchProviders.set(p.id, p),
      registerFetchProvider: (p) => fetchProviders.set(p.id, p),
    },
    inject(deps, fn) {
      assert.deepEqual(deps, ['tools']);
      fn({ tools: { register: (t) => tools.set(t.name, t) } });
    },
  };
  Object.defineProperty(ctx, 'tools', {
    get() {
      throw new Error('cannot get property "tools" without inject');
    },
  });

  apply(ctx, {});

  assert.equal(searchProviders.has(PROVIDER_ID), true);
  assert.equal(fetchProviders.has(PROVIDER_ID), true);
  assert.equal(tools.has('web_analyze'), true);
  assert.equal(tools.has('web_crawl'), true);
});

test('SSRF guard rejects loopback, private IP, and non-HTTP schemes', async () => {
  const fetcher = createFetchProvider();
  for (const blocked of [
    'http://127.0.0.1:62479/',
    'http://localhost:7424/vertex/v1',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'file:///C:/Windows/win.ini',
  ]) {
    await assert.rejects(
      () => fetcher.fetch({ url: blocked }),
      (err) => err && err.code === 'WEB_BLOCKED_URL',
      `expected WEB_BLOCKED_URL for ${blocked}`,
    );
  }
});

test('CAPTCHA and bot-shield verifier classifies Cloudflare Turnstile, DataDome, reCAPTCHA, SPA shell, and clean HTML accurately', async () => {
  const cases = [
    {
      name: 'Cloudflare Turnstile',
      input: {
        status_code: 403,
        headers: { 'cf-mitigated': 'challenge', server: 'cloudflare' },
        html: '<html><head><title>Just a moment...</title></head><body><div class="cf-turnstile"></div></body></html>',
      },
      expect: { detected: true, vendor: 'cloudflare', kind: 'turnstile', solvable_auto: true },
    },
    {
      name: 'DataDome CAPTCHA',
      input: {
        status_code: 403,
        headers: { 'x-datadome': 'protected' },
        html: '<html><script src="https://geo.captcha-delivery.com/c.js"></script></html>',
      },
      expect: { detected: true, vendor: 'datadome', kind: 'captcha', solvable_auto: false },
    },
    {
      name: 'Blocking reCAPTCHA wall',
      input: {
        status_code: 403,
        headers: {},
        html: '<html><head><title>Security Check</title></head><body><div class="g-recaptcha"></div></body></html>',
      },
      expect: { detected: true, vendor: 'recaptcha', kind: 'captcha', solvable_auto: false },
    },
    {
      name: 'Clean page with contact form reCAPTCHA should NOT false-positive',
      input: {
        status_code: 200,
        headers: {},
        html: `<html><head><title>Research Documentation</title></head><body><main><p>${'Detailed scientific article body text. '.repeat(40)}</p><div class="g-recaptcha"></div></main></body></html>`,
      },
      expect: { detected: false, vendor: 'none', kind: 'none', solvable_auto: false },
    },
    {
      name: 'Empty JS SPA shell',
      input: {
        status_code: 200,
        headers: {},
        html: '<html><head><title>App</title></head><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript><script src="/app.js"></script></body></html>',
      },
      expect: { detected: true, vendor: 'spa_js', kind: 'js_render_required', solvable_auto: true },
    },
  ];

  for (const c of cases) {
    const res = await runCrawlerCommand('detect_challenge', c.input);
    assert.equal(res.ok, true);
    assert.equal(res.challenge.detected, c.expect.detected, `${c.name}: detected`);
    assert.equal(res.challenge.vendor, c.expect.vendor, `${c.name}: vendor`);
    assert.equal(res.challenge.kind, c.expect.kind, `${c.name}: kind`);
    assert.equal(res.challenge.solvable_auto, c.expect.solvable_auto, `${c.name}: solvable_auto`);
  }
});

test('live search returns structured sources via keyless open-source engine', { skip: SKIP_LIVE_CI ? 'Live network test skipped in CI' : false }, async () => {
  const searcher = createSearchProvider();
  const result = await searcher.search({ query: 'Scrapling python github D4Vinci', maxResults: 5 });
  assert.equal(Array.isArray(result.sources), true);
  assert.ok(result.sources.length >= 1, 'expected at least 1 search source');
  assert.ok(result.sources[0].url.startsWith('http'));
  assert.equal(typeof result.truncated, 'boolean');
});

test('live fetch retrieves and analyzes a public page cleanly via Tier 1 TLS HTTP', { skip: SKIP_LIVE_CI ? 'Live network test skipped in CI' : false }, async () => {
  const fetcher = createFetchProvider();
  const result = await fetcher.fetch({ url: 'https://example.com' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.kind, 'text');
  assert.match(result.body.content, /Example Domain/i);
});

test('live stealth browser mode fetches and renders JS page cleanly', { skip: SKIP_LIVE_CI ? 'Live network test skipped in CI' : false }, async () => {
  const res = await runCrawlerCommand('analyze', {
    url: 'https://example.com',
    mode: 'stealth',
    solve_cloudflare: false,
    timeout_s: 30,
    max_chars: 10_000,
  }, { timeoutMs: 45_000 });
  assert.equal(res.ok, true);
  assert.equal(res.tier, 'stealth_browser');
  assert.equal(res.status_code, 200);
  assert.match(res.metadata.title, /Example Domain/i);
  assert.match(res.markdown, /documentation examples/i);
});

test('live Cloudflare Turnstile challenge is solved automatically by StealthyFetcher', { skip: SKIP_LIVE_CI ? 'Live network test skipped in CI' : false }, async () => {
  const res = await runCrawlerCommand('analyze', {
    url: 'https://scrapingcourse.com/cloudflare-challenge',
    mode: 'auto',
    solve_cloudflare: true,
    timeout_s: 60,
    max_chars: 10_000,
  }, { timeoutMs: 90_000 });
  assert.equal(res.ok, true);
  assert.equal(res.tier, 'stealth_browser');
  assert.equal(res.status_code, 200);
  assert.equal(res.bot_shield_bypassed, true);
  assert.equal(res.verification_status, 'verified_automatically');
  assert.match(res.markdown, /bypassed the Cloudflare challenge/i);
});

test('live PDF fetch extracts text via PyMuPDF', { skip: SKIP_LIVE_CI ? 'Live network test skipped in CI' : false }, async () => {
  const res = await runCrawlerCommand('analyze', {
    url: 'https://arxiv.org/pdf/1706.03762',
    mode: 'http',
    timeout_s: 30,
    max_chars: 8_000,
  }, { timeoutMs: 45_000 });
  assert.equal(res.ok, true);
  assert.equal(res.content_type, 'application/pdf');
  assert.match(res.markdown, /Attention Is All You Need/i);
});
