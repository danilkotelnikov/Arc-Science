// Arc Prompt Filter - First-hit prompt sanitization layer for Arc Harness.
// Provides brand name rewriting, ChatML envelope handling, prompt injection,
// auto-retry configuration, and interpolation escaping.
// Real model names stay unchanged.
import { rewrite } from './brandrules.mjs';
import { arcText } from './arcnames.mjs';

// ============================================================================
// Configuration defaults for prompt filtering
// ============================================================================

export const FILTER_DEFAULTS = {
  enabled: true,
  stripMnemon: true,
  autoRetry: true,
  retryMax: 3,
  autoContinue: false,
  continueMax: 3,
  continueText: 'Continue',
  capabilityProtocol: true,
  verbose: false,
};

// Global prompt order for injection (highest priority)
export const GLOBAL_PROMPT_ORDER = -100000;

// Allowed interpolation variables in Arc Harness
const ARC_INTERPOLATE_ALLOWED = new Set(['cwd', 'model', 'provider']);

// ============================================================================
// ChatML envelope handling
// ============================================================================

const CHATML_LINE = '<|im_start|>system:';
const PROJECT_OPEN = '<project_instructions>';
const PROJECT_CLOSE = '</project_instructions>';

/**
 * Normalize ChatML layout in prompt text.
 * Ensures proper line breaks and tag closure.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeChatmlLayout(text) {
  let out = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!out) return out;

  // Fix ChatML + project_instructions on same line
  out = out.replace(
    /<\|im_start\|>\s*system\s*:\s*<project_instructions>/gi,
    `${CHATML_LINE}\n${PROJECT_OPEN}`,
  );

  // Ensure ChatML line has newline after it
  out = out.replace(/<\|im_start\|>\s*system\s*:(?!\s*\n)/gi, `${CHATML_LINE}\n`);

  // Fix double newlines between ChatML and project tag
  out = out.replace(
    /<\|im_start\|>system:\n+<project_instructions>/i,
    `${CHATML_LINE}\n${PROJECT_OPEN}`,
  );

  // Auto-close unclosed project_instructions
  if (/<project_instructions>/i.test(out) && !/<\/project_instructions>/i.test(out)) {
    out = `${out.replace(/\s+$/, '')}\n${PROJECT_CLOSE}`;
  }

  return out.replace(/[ \t]+$/gm, '').replace(/^\s+/, '').replace(/\s+$/, '');
}

/**
 * Peel ChatML envelope while preserving structure.
 * Used for online prompt processing.
 *
 * @param {string} text
 * @returns {string}
 */
export function peelChatmlEnvelope(text) {
  return normalizeChatmlLayout(text);
}

/**
 * Strip ChatML tags from official sections to avoid nested envelopes.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripChatmlTags(text) {
  return String(text || '')
    .replace(/<\|im_start\|>\s*system\s*:\s*/gi, '')
    .replace(/<\/?project_instructions>/gi, '')
    .replace(/<\|im_end\|>/g, '');
}

// ============================================================================
// Interpolation escaping
// ============================================================================

/**
 * Escape non-allowed interpolation variables.
 * Arc Harness only recognizes cwd/model/provider.
 * Other {{var}} patterns would cause errors, so escape them.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeArcInterpolation(text) {
  const src = String(text || '');
  if (!src.includes('{{')) return src;
  return src.replace(/\{\{([^{}]*)\}\}|(\{\{)/g, (all, name, open) => {
    if (name !== undefined && ARC_INTERPOLATE_ALLOWED.has(name)) return all;
    if (open) return '{ {';
    return `{ {${name}}}`;
  });
}

// ============================================================================
// Core sanitization functions
// ============================================================================

/**
 * Sanitize a single prompt string.
 * It rewrites command words, brand terms, and path strings.
 * Real model names stay unchanged.
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizePrompt(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  const [techCleaned] = arcText(text);
  const branded = rewrite(techCleaned);
  return branded.replace(/Arc Harness Arc Harness/g, 'Arc Harness');
}

/**
 * Full prompt sanitization with ChatML handling and interpolation escaping.
 *
 * @param {string} text
 * @param {object} options
 * @param {boolean} options.handleChatML - Process ChatML envelope
 * @param {boolean} options.escapeInterpolation - Escape non-allowed interpolation
 * @returns {string}
 */
export function sanitizePromptFull(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) return text;

  let result = text;

  // Handle ChatML envelope if requested
  if (options.handleChatML) {
    result = normalizeChatmlLayout(result);
  }

  // Escape non-allowed interpolation
  if (options.escapeInterpolation) {
    result = escapeArcInterpolation(result);
  }

  // Apply brand sanitization
  result = sanitizePrompt(result);

  return result;
}

/**
 * Sanitize nested values in arbitrary objects.
 *
 * @param {any} val
 * @param {object} options
 * @returns {any}
 */
function sanitizeDeep(val, options = {}) {
  if (typeof val === 'string') return sanitizePromptFull(val, options);
  if (Array.isArray(val)) return val.map((v) => sanitizeDeep(v, options));
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = sanitizeDeep(v, options);
    }
    return out;
  }
  return val;
}

/**
 * Sanitize tool call arguments.
 *
 * @param {string} rawArgs
 * @param {object} options
 * @returns {string}
 */
function sanitizeToolArgs(rawArgs, options = {}) {
  if (typeof rawArgs !== 'string' || rawArgs.length === 0) return rawArgs;
  try {
    const parsed = JSON.parse(rawArgs);
    const sanitized = sanitizeDeep(parsed, options);
    return JSON.stringify(sanitized);
  } catch {
    return sanitizePromptFull(rawArgs, options);
  }
}

/**
 * Sanitize a complete LLM request payload.
 * It rewrites text in messages, system prompts, and tool calls.
 *
 * @param {Record<string, any>} payload
 * @param {object} options
 * @param {boolean} options.handleChatML - Process ChatML envelopes
 * @param {boolean} options.escapeInterpolation - Escape non-allowed interpolation
 * @returns {Record<string, any>}
 */
export function sanitizePayload(payload, options = {}) {
  if (!payload || typeof payload !== 'object') return payload;

  if (Array.isArray(payload.messages)) {
    for (const msg of payload.messages) {
      if (!msg || typeof msg !== 'object') continue;

      if (typeof msg.content === 'string') {
        msg.content = sanitizePromptFull(msg.content, options);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
            part.text = sanitizePromptFull(part.text, options);
          }
        }
      }

      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (tc && typeof tc === 'object' && tc.function && typeof tc.function.arguments === 'string') {
            tc.function.arguments = sanitizeToolArgs(tc.function.arguments, options);
          }
        }
      }
    }
  }

  if (typeof payload.system === 'string') {
    payload.system = sanitizePromptFull(payload.system, { ...options, handleChatML: true });
  } else if (Array.isArray(payload.system)) {
    for (const item of payload.system) {
      if (item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string') {
        item.text = sanitizePromptFull(item.text, options);
      }
    }
  }

  if (typeof payload.prompt === 'string') {
    payload.prompt = sanitizePromptFull(payload.prompt, options);
  } else if (Array.isArray(payload.prompt)) {
    payload.prompt = payload.prompt.map((p) => (typeof p === 'string' ? sanitizePromptFull(p, options) : p));
  }

  return payload;
}

// ============================================================================
// Prompt assembly section utilities
// ============================================================================

/**
 * Check if a section name belongs to the prompt filter plugin.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isFilterPromptSection(name) {
  const n = String(name || '');
  return n.startsWith('arc-prompt-filter') || n.startsWith('arcpf-');
}

/**
 * Create a prompt section with proper ordering.
 *
 * @param {string} name
 * @param {string} text
 * @param {number} order
 * @returns {object}
 */
export function createPromptSection(name, text, order = GLOBAL_PROMPT_ORDER) {
  return {
    name,
    text: escapeArcInterpolation(text),
    interpolate: false,
    order,
  };
}

/**
 * Inject a prompt section at the beginning of assembled sections.
 *
 * @param {Array} sections
 * @param {string} injectText
 * @returns {Array}
 */
export function leadWithInject(sections, injectText) {
  if (!injectText || typeof injectText !== 'string') return sections;

  const injectSection = createPromptSection('arc-prompt-filter', injectText);
  const filtered = (sections || []).filter((s) => s && s.name !== 'arc-prompt-filter');

  return [injectSection, ...filtered];
}

// ============================================================================
// Auto-retry and auto-continue utilities
// ============================================================================

/**
 * Check if a response indicates a failure that should trigger retry.
 *
 * @param {object} response
 * @returns {boolean}
 */
export function shouldRetry(response) {
  if (!response) return false;

  // Check for rate limiting
  if (response.status === 429) return true;

  // Check for server errors
  if (response.status >= 500 && response.status < 600) return true;

  // Check for specific error codes
  const errorCodes = ['rate_limit_exceeded', 'server_error', 'overloaded'];
  if (response.error?.code && errorCodes.includes(response.error.code)) return true;

  return false;
}

/**
 * Calculate retry delay with exponential backoff.
 *
 * @param {number} attempt - Current attempt number (0-indexed)
 * @param {number} baseDelay - Base delay in milliseconds
 * @param {number} maxDelay - Maximum delay in milliseconds
 * @returns {number}
 */
export function calculateRetryDelay(attempt, baseDelay = 1000, maxDelay = 30000) {
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  // Add jitter (±20%)
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}

/**
 * Check if a response indicates truncation that should trigger continue.
 *
 * @param {object} response
 * @returns {boolean}
 */
export function shouldContinue(response) {
  if (!response) return false;

  // Check finish_reason
  if (response.choices?.[0]?.finish_reason === 'length') return true;

  // Check stop_reason
  if (response.stop_reason === 'max_tokens') return true;

  return false;
}

// ============================================================================
// Self-test
// ============================================================================

import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exitCode = 1; } };
  const eq = (a, b, msg) => assert(a === b, `${msg}: got "${a}", want "${b}"`);

  // Test ChatML normalization
  eq(
    normalizeChatmlLayout('<|im_start|>system:<project_instructions>test'),
    '<|im_start|>system:\n<project_instructions>test\n</project_instructions>',
    'ChatML normalization with auto-close'
  );

  // Test interpolation escaping
  eq(escapeArcInterpolation('{{cwd}} and {{model}}'), '{{cwd}} and {{model}}', 'allowed interpolation preserved');
  eq(escapeArcInterpolation('{{unknown}}'), '{ {unknown}}', 'unknown interpolation escaped');
  eq(escapeArcInterpolation('no vars'), 'no vars', 'no interpolation unchanged');

  // Test section creation
  const section = createPromptSection('test', 'content', -50000);
  eq(section.name, 'test', 'section name');
  eq(section.order, -50000, 'section order');

  // Test retry logic
  assert(shouldRetry({ status: 429 }), 'rate limit should retry');
  assert(shouldRetry({ status: 503 }), 'server error should retry');
  assert(!shouldRetry({ status: 200 }), 'success should not retry');

  // Test continue logic
  assert(shouldContinue({ choices: [{ finish_reason: 'length' }] }), 'length finish should continue');
  assert(!shouldContinue({ choices: [{ finish_reason: 'stop' }] }), 'stop finish should not continue');

  // Test retry delay
  const delay0 = calculateRetryDelay(0, 1000, 30000);
  assert(delay0 >= 800 && delay0 <= 1200, 'first retry delay in range');
  const delay3 = calculateRetryDelay(3, 1000, 30000);
  assert(delay3 >= 6400 && delay3 <= 9600, 'fourth retry delay in range');

  console.log(process.exitCode ? 'promptpurge: FAIL' : 'promptpurge: all checks pass');
}
