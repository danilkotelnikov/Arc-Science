// Arc Bot-Check Handler - Detection and handling of bot protection systems.
// Integrates with captcha-solver.mjs for CAPTCHA solving capabilities.
// Supports Cloudflare, reCAPTCHA, hCaptcha, and other common protections.

import { detectCloudflare, bypassCloudflare, CAPTCHA_TYPES } from './captcha-solver.mjs';

// ============================================================================
// Bot protection detection patterns
// ============================================================================

export const BOT_PROTECTION_TYPES = {
  CLOUDFLARE: 'cloudflare',
  RECAPTCHA: 'recaptcha',
  HCAPTCHA: 'hcaptcha',
  DATADOME: 'datadome',
  PERIMETERX: 'perimeterx',
  INCAPSULA: 'incapsula',
  AKAMAI: 'akamai',
  KASADA: 'kasada',
  SHAPE: 'shape',
  UNKNOWN: 'unknown',
};

const PROTECTION_SIGNATURES = {
  [BOT_PROTECTION_TYPES.CLOUDFLARE]: {
    headers: ['cf-ray', 'cf-cache-status', 'cf-request-id'],
    serverHeader: 'cloudflare',
    bodyPatterns: [
      'cloudflare',
      'cf-browser-verification',
      'cf_chl_prog',
      'performance & security by cloudflare',
      '__cf_bm',
    ],
    statusCodes: [403, 503, 429],
  },
  [BOT_PROTECTION_TYPES.RECAPTCHA]: {
    bodyPatterns: [
      'google.com/recaptcha',
      'grecaptcha',
      'g-recaptcha',
      'recaptcha-token',
      'data-sitekey',
    ],
  },
  [BOT_PROTECTION_TYPES.HCAPTCHA]: {
    bodyPatterns: [
      'hcaptcha.com',
      'h-captcha',
      'hcaptcha-token',
    ],
  },
  [BOT_PROTECTION_TYPES.DATADOME]: {
    headers: ['x-datadome'],
    bodyPatterns: ['datadome', 'dd.js'],
    cookiePatterns: ['datadome'],
  },
  [BOT_PROTECTION_TYPES.PERIMETERX]: {
    headers: ['x-px-'],
    bodyPatterns: ['perimeterx', 'px-captcha', '_pxhd'],
    cookiePatterns: ['_px'],
  },
  [BOT_PROTECTION_TYPES.INCAPSULA]: {
    headers: ['x-iinfo', 'x-cdn'],
    bodyPatterns: ['incapsula', 'imperva'],
    cookiePatterns: ['incap_ses', 'visid_incap'],
  },
  [BOT_PROTECTION_TYPES.AKAMAI]: {
    headers: ['x-akamai-'],
    bodyPatterns: ['akamai', 'ak_bmsc'],
    cookiePatterns: ['ak_bmsc', '_abck'],
  },
  [BOT_PROTECTION_TYPES.KASADA]: {
    headers: ['x-kpsdk-'],
    bodyPatterns: ['kasada', 'kpsdk'],
    cookiePatterns: ['kpsdk'],
  },
  [BOT_PROTECTION_TYPES.SHAPE]: {
    bodyPatterns: ['shape security', 'shape.inc'],
  },
};

// Challenge page indicators
const CHALLENGE_INDICATORS = [
  'please verify you are human',
  'verify you are not a robot',
  'complete the security check',
  'just a moment',
  'checking your browser',
  'please wait while we verify',
  'access denied',
  'please enable javascript',
  'enable cookies',
  'one more step',
  'ddos protection',
  'are you a robot',
];

// ============================================================================
// Detection functions
// ============================================================================

/**
 * Detect all bot protection systems in a response.
 *
 * @param {object} response - Response object with status, headers, body, cookies
 * @returns {{detected: boolean, protections: Array<{type: string, confidence: number, details: object}>}}
 */
export function detectBotProtection(response) {
  const result = {
    detected: false,
    protections: [],
    isChallengePage: false,
    requiresInteractive: false,
  };

  if (!response) return result;

  const headers = normalizeHeaders(response.headers || {});
  const bodyRaw = String(response.body || '');
  const body = bodyRaw.toLowerCase();
  const cookies = extractCookies(response);

  // Check each protection type
  for (const [type, sigs] of Object.entries(PROTECTION_SIGNATURES)) {
    const detection = checkProtectionSignatures(type, sigs, { headers, body, bodyRaw, cookies, status: response.status });
    if (detection.confidence > 0) {
      result.protections.push(detection);
      result.detected = true;
    }
  }

  // Check for challenge page indicators
  for (const indicator of CHALLENGE_INDICATORS) {
    if (body.includes(indicator.toLowerCase())) {
      result.isChallengePage = true;
      break;
    }
  }

  // Determine if interactive solving is required
  result.requiresInteractive = result.isChallengePage &&
    result.protections.some((p) =>
      p.type === BOT_PROTECTION_TYPES.CLOUDFLARE &&
      p.details.challengeType === 'javascript_challenge'
    );

  // Sort protections by confidence
  result.protections.sort((a, b) => b.confidence - a.confidence);

  return result;
}

/**
 * Check signatures for a specific protection type.
 *
 * @param {string} type
 * @param {object} sigs
 * @param {object} context
 * @returns {{type: string, confidence: number, details: object}}
 */
function checkProtectionSignatures(type, sigs, context) {
  const { headers, body, bodyRaw, cookies, status } = context;
  const details = {};
  let matches = 0;
  let total = 0;

  // Check headers
  if (sigs.headers) {
    total += sigs.headers.length;
    for (const h of sigs.headers) {
      if (headers[h.toLowerCase()] !== undefined) {
        matches++;
        details.headerMatch = h;
      }
    }
  }

  // Check server header
  if (sigs.serverHeader) {
    total++;
    const server = headers['server'] || '';
    if (server.toLowerCase().includes(sigs.serverHeader.toLowerCase())) {
      matches++;
      details.serverMatch = sigs.serverHeader;
    }
  }

  // Check body patterns
  if (sigs.bodyPatterns) {
    total += sigs.bodyPatterns.length;
    for (const pattern of sigs.bodyPatterns) {
      if (body.includes(pattern.toLowerCase())) {
        matches++;
        details.bodyMatch = pattern;
      }
    }
  }

  // Check cookies
  if (sigs.cookiePatterns && cookies.length > 0) {
    total += sigs.cookiePatterns.length;
    const cookieNames = cookies.map((c) => c.name.toLowerCase());
    for (const pattern of sigs.cookiePatterns) {
      if (cookieNames.some((n) => n.includes(pattern.toLowerCase()))) {
        matches++;
        details.cookieMatch = pattern;
      }
    }
  }

  // Check status codes
  if (sigs.statusCodes && sigs.statusCodes.includes(status)) {
    matches++;
    total++;
    details.statusMatch = status;
  }

  // Additional Cloudflare-specific detection
  if (type === BOT_PROTECTION_TYPES.CLOUDFLARE) {
    const cfDetection = detectCloudflare({ status, headers: context.headers, body: context.body });
    if (cfDetection.detected) {
      matches += 2;
      total += 2;
      details.cloudflareType = cfDetection.type;
      details.challengeType = cfDetection.type;
      if (cfDetection.details.turnstileSiteKey) {
        details.turnstileSiteKey = cfDetection.details.turnstileSiteKey;
      }
      if (cfDetection.details.rayId) {
        details.rayId = cfDetection.details.rayId;
      }
    }
  }

  // Extract CAPTCHA site keys (use original case from bodyRaw)
  if (type === BOT_PROTECTION_TYPES.RECAPTCHA) {
    const siteKeyMatch = (bodyRaw || body).match(/data-sitekey="([^"]+)"/i);
    if (siteKeyMatch) {
      details.siteKey = siteKeyMatch[1];
      matches++;
      total++;
    }
  }

  if (type === BOT_PROTECTION_TYPES.HCAPTCHA) {
    const siteKeyMatch = (bodyRaw || body).match(/data-sitekey="([^"]+)"/i);
    if (siteKeyMatch) {
      details.siteKey = siteKeyMatch[1];
      matches++;
      total++;
    }
  }

  const confidence = total > 0 ? matches / total : 0;
  return { type, confidence, details };
}

/**
 * Normalize headers object to lowercase keys.
 *
 * @param {object} headers
 * @returns {object}
 */
function normalizeHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

/**
 * Extract cookies from response.
 *
 * @param {object} response
 * @returns {Array<{name: string, value: string}>}
 */
function extractCookies(response) {
  const cookies = [];
  const setCookie = response.headers?.['set-cookie'] || response.headers?.['Set-Cookie'];
  if (!setCookie) return cookies;

  const cookieList = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const cookie of cookieList) {
    const parts = String(cookie).split(';')[0].split('=');
    if (parts.length >= 2) {
      cookies.push({ name: parts[0].trim(), value: parts.slice(1).join('=').trim() });
    }
  }
  return cookies;
}

// ============================================================================
// Handling functions
// ============================================================================

/**
 * Attempt to handle/bypass detected bot protection.
 *
 * @param {string} url - Target URL
 * @param {object} detection - Detection result from detectBotProtection
 * @param {object} options
 * @returns {Promise<{success: boolean, method: string, result: object}>}
 */
export async function handleBotProtection(url, detection, options = {}) {
  if (!detection.detected || detection.protections.length === 0) {
    return { success: true, method: 'none', result: {} };
  }

  const primary = detection.protections[0];

  switch (primary.type) {
    case BOT_PROTECTION_TYPES.CLOUDFLARE:
      return handleCloudflare(url, primary, options);

    case BOT_PROTECTION_TYPES.RECAPTCHA:
      return handleRecaptcha(url, primary, options);

    case BOT_PROTECTION_TYPES.HCAPTCHA:
      return handleHCaptcha(url, primary, options);

    default:
      return {
        success: false,
        method: 'unsupported',
        result: { error: `Unsupported protection type: ${primary.type}` },
      };
  }
}

/**
 * Handle Cloudflare protection.
 *
 * @param {string} url
 * @param {object} protection
 * @param {object} options
 * @returns {Promise<object>}
 */
async function handleCloudflare(url, protection, options) {
  // If Turnstile is detected
  if (protection.details.turnstileSiteKey) {
    const result = await bypassCloudflare(url, {
      provider: options.captchaProvider,
      apiKey: options.captchaApiKey,
      detection: { type: 'turnstile', details: protection.details },
    });

    return {
      success: result.success,
      method: 'turnstile_solver',
      result,
    };
  }

  // JavaScript challenge requires browser
  if (protection.details.challengeType === 'javascript_challenge') {
    return {
      success: false,
      method: 'requires_browser',
      result: {
        error: 'JavaScript challenge requires interactive browser mode',
        requiresInteractive: true,
      },
    };
  }

  return {
    success: false,
    method: 'unknown_cloudflare',
    result: { error: 'Unknown Cloudflare protection variant' },
  };
}

/**
 * Handle reCAPTCHA protection.
 *
 * @param {string} url
 * @param {object} protection
 * @param {object} options
 * @returns {Promise<object>}
 */
async function handleRecaptcha(url, protection, options) {
  if (!protection.details.siteKey) {
    return {
      success: false,
      method: 'no_sitekey',
      result: { error: 'reCAPTCHA site key not found' },
    };
  }

  if (!options.captchaApiKey) {
    return {
      success: false,
      method: 'no_api_key',
      result: { error: 'CAPTCHA API key not configured' },
    };
  }

  try {
    const { createSolver, solveCaptcha } = await import('./captcha-solver.mjs');
    const solver = createSolver(options.captchaProvider || '2captcha', options.captchaApiKey);

    // Determine reCAPTCHA version
    const captchaType = protection.details.isV3 ? CAPTCHA_TYPES.RECAPTCHA_V3 : CAPTCHA_TYPES.RECAPTCHA_V2;

    const token = await solveCaptcha(solver, captchaType, {
      siteKey: protection.details.siteKey,
      pageUrl: url,
      action: protection.details.action || 'verify',
      minScore: protection.details.minScore || 0.5,
    });

    return {
      success: true,
      method: 'recaptcha_solver',
      result: { token },
    };
  } catch (error) {
    return {
      success: false,
      method: 'recaptcha_solver',
      result: { error: error.message },
    };
  }
}

/**
 * Handle hCaptcha protection.
 *
 * @param {string} url
 * @param {object} protection
 * @param {object} options
 * @returns {Promise<object>}
 */
async function handleHCaptcha(url, protection, options) {
  if (!protection.details.siteKey) {
    return {
      success: false,
      method: 'no_sitekey',
      result: { error: 'hCaptcha site key not found' },
    };
  }

  if (!options.captchaApiKey) {
    return {
      success: false,
      method: 'no_api_key',
      result: { error: 'CAPTCHA API key not configured' },
    };
  }

  try {
    const { createSolver, solveCaptcha } = await import('./captcha-solver.mjs');
    const solver = createSolver(options.captchaProvider || '2captcha', options.captchaApiKey);

    const token = await solveCaptcha(solver, CAPTCHA_TYPES.HCAPTCHA, {
      siteKey: protection.details.siteKey,
      pageUrl: url,
    });

    return {
      success: true,
      method: 'hcaptcha_solver',
      result: { token },
    };
  } catch (error) {
    return {
      success: false,
      method: 'hcaptcha_solver',
      result: { error: error.message },
    };
  }
}

// ============================================================================
// Cookie caching for cleared challenges
// ============================================================================

const cookieCache = new Map();
const COOKIE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Store cookies after a successful challenge clearance.
 *
 * @param {string} domain
 * @param {Array<{name: string, value: string}>} cookies
 */
export function cacheClearedCookies(domain, cookies) {
  const hostname = extractHostname(domain);
  cookieCache.set(hostname, {
    cookies,
    expires: Date.now() + COOKIE_CACHE_TTL,
  });
}

/**
 * Retrieve cached cookies for a domain.
 *
 * @param {string} domain
 * @returns {Array<{name: string, value: string}>|null}
 */
export function getCachedCookies(domain) {
  const hostname = extractHostname(domain);
  const cached = cookieCache.get(hostname);

  if (!cached) return null;
  if (Date.now() > cached.expires) {
    cookieCache.delete(hostname);
    return null;
  }

  return cached.cookies;
}

/**
 * Clear cached cookies for a domain.
 *
 * @param {string} domain
 */
export function clearCachedCookies(domain) {
  const hostname = extractHostname(domain);
  cookieCache.delete(hostname);
}

/**
 * Clear all cached cookies.
 */
export function clearAllCachedCookies() {
  cookieCache.clear();
}

/**
 * Extract hostname from URL or domain string.
 *
 * @param {string} urlOrDomain
 * @returns {string}
 */
function extractHostname(urlOrDomain) {
  try {
    const url = new URL(urlOrDomain.includes('://') ? urlOrDomain : `https://${urlOrDomain}`);
    return url.hostname;
  } catch {
    return urlOrDomain;
  }
}

// ============================================================================
// Request retry with bot protection handling
// ============================================================================

/**
 * Retry a request with automatic bot protection handling.
 *
 * @param {Function} requestFn - Function that returns a response promise
 * @param {object} options
 * @param {number} options.maxRetries - Maximum retry attempts
 * @param {number} options.retryDelay - Delay between retries in ms
 * @param {string} options.captchaProvider - CAPTCHA provider name
 * @param {string} options.captchaApiKey - CAPTCHA API key
 * @param {boolean} options.useCookieCache - Use cached cookies
 * @returns {Promise<object>}
 */
export async function retryWithBotHandling(requestFn, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const retryDelay = options.retryDelay || 2000;
  const useCookieCache = options.useCookieCache !== false;

  let lastError = null;
  let lastResponse = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Add cached cookies to request if available
      const response = await requestFn({
        attempt,
        cachedCookies: useCookieCache ? getCachedCookies(options.url) : null,
      });

      lastResponse = response;

      // Check for bot protection
      const detection = detectBotProtection(response);

      if (!detection.detected) {
        return { success: true, response, attempts: attempt + 1 };
      }

      // Try to handle the protection
      const handling = await handleBotProtection(options.url, detection, {
        captchaProvider: options.captchaProvider,
        captchaApiKey: options.captchaApiKey,
      });

      if (handling.success) {
        // Cache successful cookies if available
        if (handling.result.cookies && useCookieCache) {
          cacheClearedCookies(options.url, handling.result.cookies);
        }

        // Return handling result for the caller to retry with token/cookies
        return {
          success: true,
          handled: true,
          handlingResult: handling,
          attempts: attempt + 1,
        };
      }

      // If interactive mode is required, signal to caller
      if (handling.result.requiresInteractive) {
        return {
          success: false,
          requiresInteractive: true,
          detection,
          attempts: attempt + 1,
        };
      }

      lastError = new Error(handling.result.error || 'Bot protection handling failed');
    } catch (error) {
      lastError = error;
    }

    // Wait before retry
    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
    }
  }

  return {
    success: false,
    error: lastError?.message || 'Max retries exceeded',
    lastResponse,
    attempts: maxRetries,
  };
}

// ============================================================================
// Self-test
// ============================================================================

import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exitCode = 1; } };

  // Test protection type constants
  assert(BOT_PROTECTION_TYPES.CLOUDFLARE === 'cloudflare', 'Cloudflare type constant');
  assert(BOT_PROTECTION_TYPES.RECAPTCHA === 'recaptcha', 'reCAPTCHA type constant');

  // Test Cloudflare detection
  const cfResponse = {
    status: 403,
    headers: { 'cf-ray': '12345', 'server': 'cloudflare' },
    body: 'Checking your browser. Performance & security by Cloudflare',
  };
  const cfDetection = detectBotProtection(cfResponse);
  assert(cfDetection.detected === true, 'Cloudflare detected');
  assert(cfDetection.isChallengePage === true, 'Challenge page detected');
  assert(cfDetection.protections.some((p) => p.type === BOT_PROTECTION_TYPES.CLOUDFLARE), 'Cloudflare in protections');

  // Test reCAPTCHA detection
  const recaptchaResponse = {
    status: 200,
    headers: {},
    body: '<div class="g-recaptcha" data-sitekey="6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"></div>',
  };
  const recaptchaDetection = detectBotProtection(recaptchaResponse);
  assert(recaptchaDetection.detected === true, 'reCAPTCHA detected');
  assert(recaptchaDetection.protections.some((p) => p.type === BOT_PROTECTION_TYPES.RECAPTCHA), 'reCAPTCHA in protections');
  const recaptchaProtection = recaptchaDetection.protections.find((p) => p.type === BOT_PROTECTION_TYPES.RECAPTCHA);
  assert(recaptchaProtection.details.siteKey === '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI', 'reCAPTCHA sitekey extracted');

  // Test normal response (no protection)
  const normalResponse = { status: 200, headers: {}, body: 'Hello World' };
  const normalDetection = detectBotProtection(normalResponse);
  assert(normalDetection.detected === false, 'Normal response not flagged');

  // Test DataDome detection
  const datadomeResponse = {
    status: 403,
    headers: { 'x-datadome': 'test' },
    body: 'DataDome protection',
  };
  const datadomeDetection = detectBotProtection(datadomeResponse);
  assert(datadomeDetection.detected === true, 'DataDome detected');
  assert(datadomeDetection.protections.some((p) => p.type === BOT_PROTECTION_TYPES.DATADOME), 'DataDome in protections');

  // Test cookie caching
  cacheClearedCookies('https://example.com', [{ name: 'cf_clearance', value: 'test123' }]);
  const cached = getCachedCookies('example.com');
  assert(cached !== null, 'Cookies cached');
  assert(cached[0].name === 'cf_clearance', 'Cookie name correct');
  clearCachedCookies('example.com');
  assert(getCachedCookies('example.com') === null, 'Cookies cleared');

  // Test hostname extraction
  const hostname = extractHostname('https://www.example.com/path?query=1');
  assert(hostname === 'www.example.com', 'Hostname extracted from URL');

  console.log(process.exitCode ? 'bot-check: FAIL' : 'bot-check: all checks pass');
}
