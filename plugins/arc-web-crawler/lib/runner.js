/**
 * Node -> Python subprocess runner for arc-web-crawler.
 * Sends one JSON request on stdin and reads one JSON response from stdout.
 * Kills the child cleanly on AbortSignal or timeout and avoids __pycache__ writes (-B).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENGINE_SCRIPT = path.join(PLUGIN_ROOT, 'py', 'crawler_engine.py');

const CANDIDATE_PYTHONS = [
  process.env.ARC_WEB_CRAWLER_PYTHON,
  path.join(os.homedir(), 'miniforge3', 'python.exe'),
  path.join(os.homedir(), 'miniconda3', 'python.exe'),
  'python',
  'python3',
].filter(Boolean);

export function resolvePythonExecutable(override) {
  if (override && typeof override === 'string' && override.trim()) {
    return override.trim();
  }
  for (const candidate of CANDIDATE_PYTHONS) {
    if (candidate === 'python' || candidate === 'python3') return candidate;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // keep trying
    }
  }
  return 'python';
}

export function createWebError(message, code = 'WEB_PROVIDER_ERROR', cause) {
  const err = new Error(message, cause !== undefined ? { cause } : undefined);
  err.name = 'WebError';
  err.code = code;
  return err;
}

export function runCrawlerCommand(command, payload, options = {}) {
  const {
    signal,
    timeoutMs = 55_000,
    pythonPath,
    env: extraEnv,
  } = options;

  if (signal?.aborted) {
    return Promise.reject(createWebError('web operation aborted', 'WEB_ABORTED', signal.reason));
  }

  const py = resolvePythonExecutable(pythonPath);
  const requestJson = JSON.stringify({ command, payload });

  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const stdoutChunks = [];
    const stderrChunks = [];

    const child = spawn(py, ['-B', '-X', 'utf8', ENGINE_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
        ...extraEnv,
      },
    });

    const killChild = () => {
      try {
        if (!child.killed) child.kill('SIGTERM');
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          if (child.exitCode === null) child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 1500).unref?.();
    };

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve(value);
    };

    const onAbort = () => {
      killChild();
      finish(createWebError('web operation aborted', 'WEB_ABORTED', signal.reason));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          killChild();
          finish(createWebError(`arc-web-crawler "${command}" timed out after ${timeoutMs}ms`, 'WEB_FETCH_TIMEOUT'));
        }, timeoutMs)
      : null;
    timer?.unref?.();

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    child.on('error', (error) => {
      finish(createWebError(`failed to spawn arc-web-crawler engine (${py}): ${error.message}`, 'WEB_PROVIDER_ERROR', error));
    });

    child.on('close', (code) => {
      if (settled) return;
      if (timedOut) {
        finish(createWebError(`arc-web-crawler "${command}" timed out after ${timeoutMs}ms`, 'WEB_FETCH_TIMEOUT'));
        return;
      }
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      if (!stdout) {
        finish(createWebError(
          `arc-web-crawler "${command}" exited with code ${code}${stderr ? `: ${stderr.slice(0, 600)}` : ''}`,
          'WEB_PROVIDER_ERROR',
        ));
        return;
      }
      let parsed;
      try {
        // Take the last JSON object line in case any third-party library printed noise to stdout.
        const lines = stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
        parsed = JSON.parse(lines.at(-1) ?? stdout);
      } catch (parseErr) {
        finish(createWebError(
          `arc-web-crawler returned invalid JSON: ${stdout.slice(0, 400)}`,
          'WEB_PROVIDER_ERROR',
          parseErr,
        ));
        return;
      }
      if (!parsed || parsed.ok === false) {
        const errCode = typeof parsed?.code === 'string' && parsed.code ? parsed.code : 'WEB_PROVIDER_ERROR';
        const errMsg = typeof parsed?.error === 'string' && parsed.error
          ? parsed.error
          : `arc-web-crawler "${command}" failed`;
        finish(createWebError(errMsg, errCode));
        return;
      }
      finish(null, parsed);
    });

    try {
      child.stdin.write(requestJson, 'utf8');
      child.stdin.end();
    } catch (writeErr) {
      finish(createWebError(`failed to send payload to arc-web-crawler: ${writeErr.message}`, 'WEB_PROVIDER_ERROR', writeErr));
    }
  });
}
