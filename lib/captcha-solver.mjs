// Arc CAPTCHA Solver - Unified CAPTCHA solving API for Arc Harness.
// Supports 2Captcha, Anti-Captcha, and CapMonster APIs.
// Handles reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile, and image CAPTCHAs.

import https from 'node:https';
import http from 'node:http';

// ============================================================================
// Configuration
// ============================================================================

export const SOLVER_PROVIDERS = {
  '2captcha': {
    name: '2Captcha',
    submitUrl: 'https://2captcha.com/in.php',
    resultUrl: 'https://2captcha.com/res.php',
    balanceUrl: 'https://2captcha.com/res.php?action=getbalance',
  },
  'anti-captcha': {
    name: 'Anti-Captcha',
    submitUrl: 'https://api.anti-captcha.com/createTask',
    resultUrl: 'https://api.anti-captcha.com/getTaskResult',
    balanceUrl: 'https://api.anti-captcha.com/getBalance',
  },
  'capmonster': {
    name: 'CapMonster',
    submitUrl: 'https://api.capmonster.cloud/createTask',
    resultUrl: 'https://api.capmonster.cloud/getTaskResult',
    balanceUrl: 'https://api.capmonster.cloud/getBalance',
  },
};

export const CAPTCHA_TYPES = {
  RECAPTCHA_V2: 'recaptcha_v2',
  RECAPTCHA_V3: 'recaptcha_v3',
  HCAPTCHA: 'hcaptcha',
  TURNSTILE: 'turnstile',
  IMAGE: 'image',
  FUNCAPTCHA: 'funcaptcha',
};

const DEFAULT_TIMEOUT = 120000; // 2 minutes
const DEFAULT_POLL_INTERVAL = 5000; // 5 seconds

// ============================================================================
// HTTP utilities
// ============================================================================

/**
 * Make an HTTP/HTTPS request.
 *
 * @param {string} url
 * @param {object} options
 * @returns {Promise<{status: number, body: string}>}
 */
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const protocol = parsed.protocol === 'https:' ? https : http;

    const req = protocol.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * POST JSON to a URL.
 *
 * @param {string} url
 * @param {object} data
 * @returns {Promise<object>}
 */
async function postJson(url, data) {
  const body = JSON.stringify(data);
  const res = await request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });
  return JSON.parse(res.body);
}

/**
 * GET with query parameters.
 *
 * @param {string} baseUrl
 * @param {object} params
 * @returns {Promise<string>}
 */
async function getWithParams(baseUrl, params) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await request(url.toString());
  return res.body;
}

// ============================================================================
// 2Captcha provider
// ============================================================================

class TwoCaptchaSolver {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.provider = SOLVER_PROVIDERS['2captcha'];
  }

  async getBalance() {
    const result = await getWithParams(this.provider.balanceUrl, { key: this.apiKey });
    if (result.startsWith('ERROR_')) {
      throw new Error(`2Captcha balance error: ${result}`);
    }
    return parseFloat(result);
  }

  async submitRecaptchaV2(siteKey, pageUrl, options = {}) {
    const params = {
      key: this.apiKey,
      method: 'userrecaptcha',
      googlekey: siteKey,
      pageurl: pageUrl,
      json: 1,
    };
    if (options.invisible) params.invisible = 1;
    if (options.enterprise) params.enterprise = 1;
    if (options.proxy) {
      params.proxy = options.proxy;
      params.proxytype = options.proxyType || 'HTTP';
    }

    const result = await getWithParams(this.provider.submitUrl, params);
    const data = JSON.parse(result);
    if (data.status !== 1) {
      throw new Error(`2Captcha submit error: ${data.request}`);
    }
    return data.request; // Task ID
  }

  async submitRecaptchaV3(siteKey, pageUrl, action, minScore = 0.3) {
    const params = {
      key: this.apiKey,
      method: 'userrecaptcha',
      googlekey: siteKey,
      pageurl: pageUrl,
      version: 'v3',
      action,
      min_score: minScore,
      json: 1,
    };

    const result = await getWithParams(this.provider.submitUrl, params);
    const data = JSON.parse(result);
    if (data.status !== 1) {
      throw new Error(`2Captcha submit error: ${data.request}`);
    }
    return data.request;
  }

  async submitHCaptcha(siteKey, pageUrl, options = {}) {
    const params = {
      key: this.apiKey,
      method: 'hcaptcha',
      sitekey: siteKey,
      pageurl: pageUrl,
      json: 1,
    };
    if (options.proxy) {
      params.proxy = options.proxy;
      params.proxytype = options.proxyType || 'HTTP';
    }

    const result = await getWithParams(this.provider.submitUrl, params);
    const data = JSON.parse(result);
    if (data.status !== 1) {
      throw new Error(`2Captcha submit error: ${data.request}`);
    }
    return data.request;
  }

  async submitTurnstile(siteKey, pageUrl, options = {}) {
    const params = {
      key: this.apiKey,
      method: 'turnstile',
      sitekey: siteKey,
      pageurl: pageUrl,
      json: 1,
    };
    if (options.action) params.action = options.action;
    if (options.data) params.data = options.data;

    const result = await getWithParams(this.provider.submitUrl, params);
    const data = JSON.parse(result);
    if (data.status !== 1) {
      throw new Error(`2Captcha submit error: ${data.request}`);
    }
    return data.request;
  }

  async submitImage(imageBase64, options = {}) {
    const params = {
      key: this.apiKey,
      method: 'base64',
      body: imageBase64,
      json: 1,
    };
    if (options.caseSensitive) params.regsense = 1;
    if (options.numeric) params.numeric = options.numeric;
    if (options.minLength) params.min_len = options.minLength;
    if (options.maxLength) params.max_len = options.maxLength;

    const result = await getWithParams(this.provider.submitUrl, params);
    const data = JSON.parse(result);
    if (data.status !== 1) {
      throw new Error(`2Captcha submit error: ${data.request}`);
    }
    return data.request;
  }

  async getResult(taskId) {
    const params = {
      key: this.apiKey,
      action: 'get',
      id: taskId,
      json: 1,
    };

    const result = await getWithParams(this.provider.resultUrl, params);
    const data = JSON.parse(result);

    if (data.status === 0) {
      if (data.request === 'CAPCHA_NOT_READY') {
        return { ready: false };
      }
      throw new Error(`2Captcha result error: ${data.request}`);
    }

    return { ready: true, solution: data.request };
  }

  async reportBad(taskId) {
    const params = {
      key: this.apiKey,
      action: 'reportbad',
      id: taskId,
    };
    await getWithParams(this.provider.resultUrl, params);
  }

  async reportGood(taskId) {
    const params = {
      key: this.apiKey,
      action: 'reportgood',
      id: taskId,
    };
    await getWithParams(this.provider.resultUrl, params);
  }
}

// ============================================================================
// Anti-Captcha provider
// ============================================================================

class AntiCaptchaSolver {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.provider = SOLVER_PROVIDERS['anti-captcha'];
  }

  async getBalance() {
    const result = await postJson(this.provider.balanceUrl, { clientKey: this.apiKey });
    if (result.errorId !== 0) {
      throw new Error(`Anti-Captcha balance error: ${result.errorCode}`);
    }
    return result.balance;
  }

  async submitRecaptchaV2(siteKey, pageUrl, options = {}) {
    const task = {
      type: options.enterprise ? 'RecaptchaV2EnterpriseTaskProxyless' : 'RecaptchaV2TaskProxyless',
      websiteURL: pageUrl,
      websiteKey: siteKey,
    };
    if (options.invisible) task.isInvisible = true;
    if (options.proxy) {
      task.type = options.enterprise ? 'RecaptchaV2EnterpriseTask' : 'RecaptchaV2Task';
      this._addProxyToTask(task, options);
    }

    const result = await postJson(this.provider.submitUrl, {
      clientKey: this.apiKey,
      task,
    });
    if (result.errorId !== 0) {
      throw new Error(`Anti-Captcha submit error: ${result.errorCode}`);
    }
    return result.taskId;
  }

  async submitRecaptchaV3(siteKey, pageUrl, action, minScore = 0.3) {
    const task = {
      type: 'RecaptchaV3TaskProxyless',
      websiteURL: pageUrl,
      websiteKey: siteKey,
      pageAction: action,
      minScore,
    };

    const result = await postJson(this.provider.submitUrl, {
      clientKey: this.apiKey,
      task,
    });
    if (result.errorId !== 0) {
      throw new Error(`Anti-Captcha submit error: ${result.errorCode}`);
    }
    return result.taskId;
  }

  async submitHCaptcha(siteKey, pageUrl, options = {}) {
    const task = {
      type: 'HCaptchaTaskProxyless',
      websiteURL: pageUrl,
      websiteKey: siteKey,
    };
    if (options.proxy) {
      task.type = 'HCaptchaTask';
      this._addProxyToTask(task, options);
    }

    const result = await postJson(this.provider.submitUrl, {
      clientKey: this.apiKey,
      task,
    });
    if (result.errorId !== 0) {
      throw new Error(`Anti-Captcha submit error: ${result.errorCode}`);
    }
    return result.taskId;
  }

  async submitTurnstile(siteKey, pageUrl, options = {}) {
    const task = {
      type: 'TurnstileTaskProxyless',
      websiteURL: pageUrl,
      websiteKey: siteKey,
    };
    if (options.action) task.action = options.action;
    if (options.proxy) {
      task.type = 'TurnstileTask';
      this._addProxyToTask(task, options);
    }

    const result = await postJson(this.provider.submitUrl, {
      clientKey: this.apiKey,
      task,
    });
    if (result.errorId !== 0) {
      throw new Error(`Anti-Captcha submit error: ${result.errorCode}`);
    }
    return result.taskId;
  }

  async submitImage(imageBase64, options = {}) {
    const task = {
      type: 'ImageToTextTask',
      body: imageBase64,
    };
    if (options.caseSensitive) task.case = true;
    if (options.numeric === 1) task.numeric = 1;
    if (options.minLength) task.minLength = options.minLength;
    if (options.maxLength) task.maxLength = options.maxLength;

    const result = await postJson(this.provider.submitUrl, {
      clientKey: this.apiKey,
      task,
    });
    if (result.errorId !== 0) {
      throw new Error(`Anti-Captcha submit error: ${result.errorCode}`);
    }
    return result.taskId;
  }

  async getResult(taskId) {
    const result = await postJson(this.provider.resultUrl, {
      clientKey: this.apiKey,
      taskId,
    });

    if (result.errorId !== 0) {
      throw new Error(`Anti-Captcha result error: ${result.errorCode}`);
    }

    if (result.status === 'processing') {
      return { ready: false };
    }

    // Extract solution based on task type
    const solution = result.solution;
    if (solution.gRecaptchaResponse) {
      return { ready: true, solution: solution.gRecaptchaResponse };
    }
    if (solution.token) {
      return { ready: true, solution: solution.token };
    }
    if (solution.text) {
      return { ready: true, solution: solution.text };
    }
    return { ready: true, solution };
  }

  async reportBad(taskId) {
    await postJson('https://api.anti-captcha.com/reportIncorrectImageCaptcha', {
      clientKey: this.apiKey,
      taskId,
    });
  }

  async reportGood(taskId) {
    // Anti-Captcha doesn't have a reportGood endpoint
  }

  _addProxyToTask(task, options) {
    task.proxyType = options.proxyType || 'http';
    task.proxyAddress = options.proxyAddress;
    task.proxyPort = options.proxyPort;
    if (options.proxyLogin) task.proxyLogin = options.proxyLogin;
    if (options.proxyPassword) task.proxyPassword = options.proxyPassword;
  }
}

// ============================================================================
// Unified solver interface
// ============================================================================

/**
 * Create a CAPTCHA solver for the specified provider.
 *
 * @param {string} provider - Provider name: '2captcha', 'anti-captcha', or 'capmonster'
 * @param {string} apiKey - API key for the provider
 * @returns {object} - Solver instance
 */
export function createSolver(provider, apiKey) {
  if (!apiKey) {
    throw new Error('API key is required');
  }

  switch (provider.toLowerCase()) {
    case '2captcha':
      return new TwoCaptchaSolver(apiKey);
    case 'anti-captcha':
    case 'anticaptcha':
      return new AntiCaptchaSolver(apiKey);
    case 'capmonster':
      // CapMonster uses same API as Anti-Captcha
      const solver = new AntiCaptchaSolver(apiKey);
      solver.provider = SOLVER_PROVIDERS['capmonster'];
      return solver;
    default:
      throw new Error(`Unknown CAPTCHA provider: ${provider}`);
  }
}

/**
 * Solve a CAPTCHA with automatic polling.
 *
 * @param {object} solver - Solver instance
 * @param {string} type - CAPTCHA type from CAPTCHA_TYPES
 * @param {object} params - CAPTCHA parameters
 * @param {object} options - Solving options
 * @returns {Promise<string>} - CAPTCHA solution
 */
export async function solveCaptcha(solver, type, params, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const pollInterval = options.pollInterval || DEFAULT_POLL_INTERVAL;
  const startTime = Date.now();

  // Submit the CAPTCHA
  let taskId;
  switch (type) {
    case CAPTCHA_TYPES.RECAPTCHA_V2:
      taskId = await solver.submitRecaptchaV2(params.siteKey, params.pageUrl, params);
      break;
    case CAPTCHA_TYPES.RECAPTCHA_V3:
      taskId = await solver.submitRecaptchaV3(params.siteKey, params.pageUrl, params.action, params.minScore);
      break;
    case CAPTCHA_TYPES.HCAPTCHA:
      taskId = await solver.submitHCaptcha(params.siteKey, params.pageUrl, params);
      break;
    case CAPTCHA_TYPES.TURNSTILE:
      taskId = await solver.submitTurnstile(params.siteKey, params.pageUrl, params);
      break;
    case CAPTCHA_TYPES.IMAGE:
      taskId = await solver.submitImage(params.imageBase64, params);
      break;
    default:
      throw new Error(`Unsupported CAPTCHA type: ${type}`);
  }

  // Poll for result
  while (Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const result = await solver.getResult(taskId);
    if (result.ready) {
      return result.solution;
    }
  }

  throw new Error('CAPTCHA solving timeout');
}

/**
 * Quick solve with environment variable configuration.
 * Uses ARC_CAPTCHA_PROVIDER and ARC_CAPTCHA_API_KEY env vars.
 *
 * @param {string} type - CAPTCHA type
 * @param {object} params - CAPTCHA parameters
 * @param {object} options - Solving options
 * @returns {Promise<string>} - CAPTCHA solution
 */
export async function solve(type, params, options = {}) {
  const provider = process.env.ARC_CAPTCHA_PROVIDER || '2captcha';
  const apiKey = process.env.ARC_CAPTCHA_API_KEY;

  if (!apiKey) {
    throw new Error('ARC_CAPTCHA_API_KEY environment variable not set');
  }

  const solver = createSolver(provider, apiKey);
  return solveCaptcha(solver, type, params, options);
}

// ============================================================================
// Cloudflare detection utilities
// ============================================================================

const CLOUDFLARE_SIGNATURES = [
  'cf-browser-verification',
  'cf_chl_prog',
  'cf-turnstile',
  '__cf_bm',
  'cf_clearance',
  'cloudflare',
  'checking your browser',
  'just a moment',
  'ray id:',
  'performance & security by cloudflare',
  'enable javascript and cookies',
  'ddos protection by cloudflare',
  'attention required!',
  'blocked by cloudflare',
];

const CLOUDFLARE_HEADERS = [
  'cf-ray',
  'cf-cache-status',
  'cf-request-id',
  'server: cloudflare',
];

/**
 * Detect if a response indicates Cloudflare protection.
 *
 * @param {object} response - Response object with status, headers, body
 * @returns {{detected: boolean, type: string|null, details: object}}
 */
export function detectCloudflare(response) {
  const result = { detected: false, type: null, details: {} };

  if (!response) return result;

  // Check headers
  const headers = response.headers || {};
  const headerStr = Object.entries(headers)
    .map(([k, v]) => `${k.toLowerCase()}: ${String(v).toLowerCase()}`)
    .join('\n');

  for (const sig of CLOUDFLARE_HEADERS) {
    if (headerStr.includes(sig.toLowerCase())) {
      result.detected = true;
      result.details.headerMatch = sig;
      break;
    }
  }

  // Check for Cloudflare challenge page (status 403 or 503)
  if (response.status === 403 || response.status === 503) {
    result.details.challengeStatus = response.status;
  }

  // Check body content (lowercase for signature matching)
  const bodyRaw = String(response.body || '');
  const body = bodyRaw.toLowerCase();
  for (const sig of CLOUDFLARE_SIGNATURES) {
    if (body.includes(sig.toLowerCase())) {
      result.detected = true;
      result.type = identifyCloudflareType(body, sig);
      result.details.bodyMatch = sig;
      break;
    }
  }

  // Extract Turnstile site key if present (use original case)
  const turnstileMatch = bodyRaw.match(/data-sitekey="([^"]+)"/i);
  if (turnstileMatch) {
    result.details.turnstileSiteKey = turnstileMatch[1];
    result.type = 'turnstile';
  }

  // Extract Ray ID
  const rayMatch = bodyRaw.match(/ray id[:\s]+([a-f0-9]+)/i);
  if (rayMatch) {
    result.details.rayId = rayMatch[1];
  }

  return result;
}

/**
 * Identify the type of Cloudflare protection.
 *
 * @param {string} body
 * @param {string} signature
 * @returns {string}
 */
function identifyCloudflareType(body, signature) {
  if (body.includes('cf-turnstile') || body.includes('turnstile')) {
    return 'turnstile';
  }
  if (body.includes('cf-browser-verification') || body.includes('cf_chl_prog')) {
    return 'javascript_challenge';
  }
  if (body.includes('blocked') || body.includes('attention required')) {
    return 'blocked';
  }
  if (body.includes('ddos protection')) {
    return 'ddos_protection';
  }
  return 'unknown';
}

/**
 * Attempt to bypass Cloudflare protection.
 *
 * @param {string} url - Target URL
 * @param {object} options
 * @param {string} options.provider - CAPTCHA provider
 * @param {string} options.apiKey - API key
 * @param {object} options.detection - Detection result from detectCloudflare
 * @returns {Promise<{success: boolean, cookies: string[], token: string|null}>}
 */
export async function bypassCloudflare(url, options = {}) {
  const detection = options.detection || {};

  // If Turnstile is detected and we have the site key
  if (detection.type === 'turnstile' && detection.details?.turnstileSiteKey) {
    const provider = options.provider || process.env.ARC_CAPTCHA_PROVIDER || '2captcha';
    const apiKey = options.apiKey || process.env.ARC_CAPTCHA_API_KEY;

    if (!apiKey) {
      return { success: false, cookies: [], token: null, error: 'No CAPTCHA API key' };
    }

    try {
      const solver = createSolver(provider, apiKey);
      const token = await solveCaptcha(solver, CAPTCHA_TYPES.TURNSTILE, {
        siteKey: detection.details.turnstileSiteKey,
        pageUrl: url,
      });

      return { success: true, cookies: [], token };
    } catch (error) {
      return { success: false, cookies: [], token: null, error: error.message };
    }
  }

  // JavaScript challenge requires browser automation
  if (detection.type === 'javascript_challenge') {
    return {
      success: false,
      cookies: [],
      token: null,
      error: 'JavaScript challenge requires interactive_captcha mode',
      requiresInteractive: true,
    };
  }

  // Blocked requests cannot be bypassed
  if (detection.type === 'blocked') {
    return {
      success: false,
      cookies: [],
      token: null,
      error: 'Request blocked by Cloudflare',
    };
  }

  return { success: false, cookies: [], token: null, error: 'Unknown protection type' };
}

// ============================================================================
// Self-test
// ============================================================================

import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exitCode = 1; } };

  // Test provider configuration
  assert(SOLVER_PROVIDERS['2captcha'].name === '2Captcha', '2Captcha provider config');
  assert(SOLVER_PROVIDERS['anti-captcha'].name === 'Anti-Captcha', 'Anti-Captcha provider config');

  // Test CAPTCHA types
  assert(CAPTCHA_TYPES.TURNSTILE === 'turnstile', 'Turnstile type constant');

  // Test Cloudflare detection
  const cfResponse = {
    status: 403,
    headers: { 'cf-ray': '12345', 'server': 'cloudflare' },
    body: 'Checking your browser before accessing. Performance & security by Cloudflare',
  };
  const detection = detectCloudflare(cfResponse);
  assert(detection.detected === true, 'Cloudflare detected');
  assert(detection.details.headerMatch !== undefined, 'Header match found');

  // Test non-Cloudflare response
  const normalResponse = { status: 200, headers: {}, body: 'Hello World' };
  const normalDetection = detectCloudflare(normalResponse);
  assert(normalDetection.detected === false, 'Non-Cloudflare not detected');

  // Test Turnstile detection (sitekey preserves original case)
  const turnstileResponse = {
    status: 403,
    headers: {},
    body: '<div class="cf-turnstile" data-sitekey="0x4ABCDefGhIjKlMnOp"></div>',
  };
  const turnstileDetection = detectCloudflare(turnstileResponse);
  assert(turnstileDetection.type === 'turnstile', 'Turnstile type detected');
  assert(turnstileDetection.details.turnstileSiteKey === '0x4ABCDefGhIjKlMnOp', 'Turnstile sitekey extracted');

  // Test solver creation (without actual API call)
  try {
    const solver = createSolver('2captcha', 'test-key');
    assert(solver instanceof TwoCaptchaSolver, '2Captcha solver created');
  } catch (e) {
    console.error('Solver creation failed:', e.message);
    process.exitCode = 1;
  }

  try {
    const solver = createSolver('anti-captcha', 'test-key');
    assert(solver instanceof AntiCaptchaSolver, 'Anti-Captcha solver created');
  } catch (e) {
    console.error('Solver creation failed:', e.message);
    process.exitCode = 1;
  }

  console.log(process.exitCode ? 'captcha-solver: FAIL' : 'captcha-solver: all checks pass');
}
