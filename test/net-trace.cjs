'use strict';
// Network tracer. Load it with  NODE_OPTIONS=--require=<this file>  (works under ELECTRON_RUN_AS_NODE=1).
// Every DNS lookup and every connection attempt becomes one JSON line in the file named by ARC_NET_TRACE:
//   {t, pid, kind, host, port, via, from}      (a connection over a named pipe or a socket file has via "ipc" and a `path` field instead of `host`)
// kind: dns | connect | accept | tls | http | fetch | spawn.  `from` is the first package frame of the call stack.
// accept is an inbound connection to a server of this process (host = the caller, port = the local port).
// The tracer only observes. It never blocks or changes a call, and it never logs headers, bodies or arguments.
// Children started with child_process get the same NODE_OPTIONS, so they are traced too.
const file = process.env.ARC_NET_TRACE;
if (file && !globalThis.__ARC_NET_TRACE__) {
  globalThis.__ARC_NET_TRACE__ = true;
  const fs = require('node:fs');
  const dns = require('node:dns');
  const net = require('node:net');
  const tls = require('node:tls');
  const http = require('node:http');
  const https = require('node:https');
  const cp = require('node:child_process');
  const here = __filename;
  const seen = new Map(); // address -> last name that resolved to it

  const where = () => {
    const lines = String(new Error().stack || '').split('\n').slice(2);
    for (const l of lines) {
      if (l.includes('net-trace.cjs') || l.includes('node:internal') || l.includes('(node:')) continue;
      return l.trim().replace(/^at /, '').replace(/\\/g, '/').slice(-180);
    }
    return '';
  };
  const log = (kind, host, port, via) => {
    try {
      const h = host == null ? '' : String(host);
      const row = { t: new Date().toISOString(), pid: process.pid, kind };
      if (via === 'ipc') row.path = h; else row.host = h; // a pipe path is a path, never a host
      Object.assign(row, { port: port == null ? '' : Number(port) || String(port), via: via || '', from: where() });
      if (via !== 'ipc' && seen.has(h)) row.name = seen.get(h);
      fs.appendFileSync(file, JSON.stringify(row) + '\n');
    } catch { /* tracing must never break the process */ }
  };

  // --- DNS ---
  const origLookup = dns.lookup;
  dns.lookup = function lookup(hostname, ...rest) {
    log('dns', hostname, '', 'dns.lookup');
    const cb = rest[rest.length - 1];
    if (typeof cb === 'function') {
      rest[rest.length - 1] = function (err, address, family) {
        if (!err) for (const a of Array.isArray(address) ? address : [{ address }]) if (a && a.address) seen.set(a.address, String(hostname));
        if (!err && typeof address === 'string') seen.set(address, String(hostname));
        return cb.apply(this, arguments);
      };
    }
    return origLookup.call(this, hostname, ...rest);
  };
  Object.assign(dns.lookup, origLookup);
  const pl = dns.promises && dns.promises.lookup;
  if (pl) dns.promises.lookup = function (hostname, ...r) { log('dns', hostname, '', 'dns.promises.lookup'); return pl.call(this, hostname, ...r); };
  for (const m of ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveSrv', 'resolveTxt', 'reverse']) {
    for (const [obj, tag] of [[dns, 'dns.'], [dns.promises, 'dns.promises.'], [dns.Resolver && dns.Resolver.prototype, 'Resolver.']]) {
      if (!obj || typeof obj[m] !== 'function') continue;
      const o = obj[m];
      obj[m] = function (name) { log('dns', name, '', tag + m); return o.apply(this, arguments); };
    }
  }

  // --- TCP ---
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connect(...args) {
    try {
      let a = args[0];
      if (Array.isArray(a)) a = a[0]; // normalized form [options, cb]
      if (a && typeof a === 'object') {
        if (a.path) log('connect', a.path, '', 'ipc');
        else log('connect', a.host || a.hostname || 'localhost', a.port, 'net');
      } else if (typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a))) {
        log('connect', typeof args[1] === 'string' ? args[1] : 'localhost', a, 'net');
      } else if (typeof a === 'string') log('connect', a, '', 'ipc');
    } catch { /* ignore */ }
    return origConnect.apply(this, args);
  };

  // --- inbound: a client that connects to a server of this process (the page load of the live test shows up here, as the host that called) ---
  const origEmit = net.Server.prototype.emit;
  net.Server.prototype.emit = function emit(ev, sock) {
    try { if (ev === 'connection' && sock && sock.remoteAddress) log('accept', String(sock.remoteAddress).replace(/^::ffff:/, ''), sock.localPort, 'net'); } catch { /* ignore */ }
    return origEmit.apply(this, arguments);
  };

  // --- TLS ---
  const origTls = tls.connect;
  tls.connect = function connect(...args) {
    try {
      const o = args.find((x) => x && typeof x === 'object') || {};
      const portArg = typeof args[0] === 'number' ? args[0] : undefined;
      log('tls', o.servername || o.host || (typeof args[1] === 'string' ? args[1] : 'localhost'), o.port || portArg, 'tls');
    } catch { /* ignore */ }
    return origTls.apply(this, args);
  };

  // --- HTTP(S) request level (sees the host even when the socket is reused or proxied) ---
  const hostOf = (a, b, def) => {
    let o = typeof a === 'string' || a instanceof URL ? (b && typeof b === 'object' ? b : {}) : a || {};
    let u = typeof a === 'string' ? safeUrl(a) : a instanceof URL ? a : null;
    const host = (u && u.hostname) || o.hostname || o.host || 'localhost';
    const port = (u && u.port) || o.port || def;
    return [host, port];
  };
  const safeUrl = (s) => { try { return new URL(s); } catch { return null; } };
  for (const [mod, def, tag] of [[http, 80, 'http'], [https, 443, 'https']]) {
    for (const m of ['request', 'get']) {
      const o = mod[m];
      mod[m] = function (a, b, c) {
        try { const [h, p] = hostOf(a, b, def); log('http', h, p, tag + '.' + m); } catch { /* ignore */ }
        return o.call(this, a, b, c);
      };
    }
  }

  // --- global fetch (undici) ---
  if (typeof globalThis.fetch === 'function') {
    const of = globalThis.fetch;
    globalThis.fetch = function fetch(input, init) {
      try {
        const u = typeof input === 'string' ? safeUrl(input) : input instanceof URL ? input : input && input.url ? safeUrl(input.url) : null;
        if (u) log('fetch', u.hostname, u.port || (u.protocol === 'https:' ? 443 : u.protocol === 'http:' ? 80 : ''), 'fetch');
      } catch { /* ignore */ }
      return of.call(this, input, init);
    };
  }

  // --- children: log the program (never its arguments) and pass the tracer on ---
  const opt = `--require=${here.replace(/\\/g, '/')}`;
  const inject = (o) => {
    if (!o || typeof o !== 'object') return o;
    const env = { ...(o.env || process.env) };
    if (!String(env.NODE_OPTIONS || '').includes('net-trace.cjs')) env.NODE_OPTIONS = `${env.NODE_OPTIONS ? env.NODE_OPTIONS + ' ' : ''}${opt}`;
    if (!env.ARC_NET_TRACE) env.ARC_NET_TRACE = file;
    return { ...o, env };
  };
  for (const m of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork', 'exec', 'execSync']) {
    const o = cp[m];
    if (typeof o !== 'function') continue;
    cp[m] = function (cmd, ...rest) {
      try { log('spawn', String(cmd).replace(/\\/g, '/').split('/').pop().slice(0, 80), '', 'child_process.' + m); } catch { /* ignore */ }
      // The options object is the last plain-object argument; add one when the call has none.
      const i = rest.findIndex((x) => x && typeof x === 'object' && !Array.isArray(x));
      if (i >= 0) rest[i] = inject(rest[i]);
      else {
        const k = rest.findIndex((x) => typeof x === 'function');
        if (Array.isArray(rest[0]) || rest.length === 0 || k === 0) {
          const pos = Array.isArray(rest[0]) ? 1 : 0;
          if (m === 'exec' || m === 'execSync') rest.splice(0, 0, inject({}));
          else rest.splice(pos, 0, inject({}));
        }
      }
      return o.call(this, cmd, ...rest);
    };
  }
  log('start', process.execPath.replace(/\\/g, '/').split('/').pop(), '', process.argv.slice(1, 2).join('').replace(/\\/g, '/').slice(-100));
}
