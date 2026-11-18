// Write-once 1M Library reader, SHA-256 deduplicating builder, BM25+supersession warm router,
// and Platt calibration decision helpers matching Cammut schema cammut.library_1m/2.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const LIBRARY_SCHEMA = 'cammut.library_1m/2';
export const DECISION_SCHEMA = 'cammut.decision/1';
const TOKEN_RE = /[0-9A-Za-z\u0410-\u042F\u0430-\u044F\u0401\u0451_]+/gu;
const YEAR_RE = /\b(199\d|20[0-3]\d)\b/g;
const DATE_YM_RE = /\b(20\d{2}|19\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.](0?[1-9]|[12]\d|3[01]))?\b/g;
const ROMAN_DATE_RE = /\b(?:0?[1-9]|[12]\d|3[01])\.(xii|xi|ix|x|viii|vii|vi|v|iv|iii|ii|i)\.(19\d{2}|20\d{2})\b/gi;
const ROMAN_MONTHS = Object.freeze({ i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 });
const MONTH_ALIASES = Object.freeze({
  january: 1, jan: 1, '\u044f\u043d\u0432\u0430\u0440': 1,
  february: 2, feb: 2, '\u0444\u0435\u0432\u0440\u0430\u043b': 2,
  march: 3, mar: 3, '\u043c\u0430\u0440\u0442': 3, '\u043c\u0430\u0440\u0442\u0430': 3,
  april: 4, apr: 4, '\u0430\u043f\u0440\u0435\u043b': 4,
  may: 5, '\u043c\u0430\u044f': 5, '\u043c\u0430\u0439': 5,
  june: 6, jun: 6, '\u0438\u044e\u043d': 6,
  july: 7, jul: 7, '\u0438\u044e\u043b': 7,
  august: 8, aug: 8, '\u0430\u0432\u0433\u0443\u0441\u0442': 8,
  september: 9, sep: 9, sept: 9, '\u0441\u0435\u043d\u0442\u044f\u0431\u0440': 9,
  october: 10, oct: 10, '\u043e\u043a\u0442\u044f\u0431\u0440': 10,
  november: 11, nov: 11, '\u043d\u043e\u044f\u0431\u0440': 11,
  december: 12, dec: 12, '\u0434\u0435\u043a\u0430\u0431\u0440': 12,
});

// RFC 7693 BLAKE2b constants for bit-exact 64-bit token hashing matching Python hashlib.blake2b(..., digest_size=8).
const BLAKE2B_IV = new BigUint64Array([
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
]);

const BLAKE2B_SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
];

const MASK64 = 0xffffffffffffffffn;
function rotr64(x, n) {
  return ((x >> n) | (x << (64n - n))) & MASK64;
}

function blake2bCompress(h, block, tLow, last) {
  const v = new BigUint64Array(16);
  const m = new BigUint64Array(16);
  for (let i = 0; i < 8; i++) {
    v[i] = h[i];
    v[i + 8] = BLAKE2B_IV[i];
  }
  v[12] ^= BigInt(tLow);
  if (last) v[14] ^= MASK64;
  for (let i = 0; i < 16; i++) {
    const off = i * 8;
    m[i] = BigInt(block[off]) |
      (BigInt(block[off + 1]) << 8n) |
      (BigInt(block[off + 2]) << 16n) |
      (BigInt(block[off + 3]) << 24n) |
      (BigInt(block[off + 4]) << 32n) |
      (BigInt(block[off + 5]) << 40n) |
      (BigInt(block[off + 6]) << 48n) |
      (BigInt(block[off + 7]) << 56n);
  }
  const mix = (a, b, c, d, x, y) => {
    v[a] = (v[a] + v[b] + x) & MASK64;
    v[d] = rotr64(v[d] ^ v[a], 32n);
    v[c] = (v[c] + v[d]) & MASK64;
    v[b] = rotr64(v[b] ^ v[c], 24n);
    v[a] = (v[a] + v[b] + y) & MASK64;
    v[d] = rotr64(v[d] ^ v[a], 16n);
    v[c] = (v[c] + v[d]) & MASK64;
    v[b] = rotr64(v[b] ^ v[c], 63n);
  };
  for (let r = 0; r < 12; r++) {
    const s = BLAKE2B_SIGMA[r];
    mix(0, 4, 8, 12, m[s[0]], m[s[1]]);
    mix(1, 5, 9, 13, m[s[2]], m[s[3]]);
    mix(2, 6, 10, 14, m[s[4]], m[s[5]]);
    mix(3, 7, 11, 15, m[s[6]], m[s[7]]);
    mix(0, 5, 10, 15, m[s[8]], m[s[9]]);
    mix(1, 6, 11, 12, m[s[10]], m[s[11]]);
    mix(2, 7, 8, 13, m[s[12]], m[s[13]]);
    mix(3, 4, 9, 14, m[s[14]], m[s[15]]);
  }
  for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
}

export function blake2b64(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ''), 'utf8');
  const h = new BigUint64Array(BLAKE2B_IV);
  h[0] ^= 0x01010008n; // outlen = 8, fanout = 1, depth = 1
  const block = Buffer.alloc(128);
  let pos = 0;
  let remaining = bytes.length;
  while (remaining > 128) {
    bytes.copy(block, 0, pos, pos + 128);
    pos += 128;
    remaining -= 128;
    blake2bCompress(h, block, pos, false);
  }
  block.fill(0);
  if (remaining > 0) bytes.copy(block, 0, pos, pos + remaining);
  blake2bCompress(h, block, pos + remaining, true);
  return h[0];
}

export function hashTokenU64(token) {
  const v = blake2b64(String(token ?? ''));
  return v === 0n ? 1n : v;
}

export function hashStrU64(text) {
  if (!text) return 0n;
  return hashTokenU64(text);
}

export function canonicalDigest(text) {
  const norm = String(text ?? '').replace(/\r\n/g, '\n').trim();
  return crypto.createHash('sha256').update(norm, 'utf8').digest();
}

export function tokenizeBilingual(text) {
  const out = [];
  const src = String(text ?? '');
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(src)) !== null) out.push(m[0].toLowerCase());
  return out;
}

export function parseDateInt(dateStr) {
  if (!dateStr) return 0;
  const s = String(dateStr).trim().slice(0, 10);
  if (s.length >= 10 && s[4] === '-' && s[7] === '-') {
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(5, 7));
    const d = Number(s.slice(8, 10));
    if (Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d)
        && y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return y * 10000 + m * 100 + d;
    }
  }
  return 0;
}

export function extractQueryDateCues(query) {
  const low = String(query ?? '').toLowerCase();
  const years = new Set();
  const yms = new Set();
  for (const m of low.matchAll(YEAR_RE)) years.add(Number(m[1]));
  for (const m of low.matchAll(DATE_YM_RE)) {
    const yr = Number(m[1]);
    const mo = Number(m[2]);
    years.add(yr);
    yms.add(yr * 100 + mo);
  }
  const monthsNamed = new Set();
  for (const m of low.matchAll(ROMAN_DATE_RE)) {
    const mo = ROMAN_MONTHS[m[1].toLowerCase()];
    const yr = Number(m[2]);
    if (mo && yr) {
      monthsNamed.add(mo);
      years.add(yr);
      yms.add(yr * 100 + mo);
    }
  }
  const qTokens = tokenizeBilingual(low);
  const ruAliases = Object.entries(MONTH_ALIASES).filter(([k]) => /[\u0400-\u04ff]/.test(k));
  for (const tok of qTokens) {
    if (Object.hasOwn(MONTH_ALIASES, tok)) {
      monthsNamed.add(MONTH_ALIASES[tok]);
      continue;
    }
    if (/^[\u0430-\u044f\u0451]{4,}$/u.test(tok)) {
      for (const [alias, mo] of ruAliases) {
        if (tok.startsWith(alias)) { monthsNamed.add(mo); break; }
      }
    }
  }
  if (years.size > 0 && monthsNamed.size > 0) {
    for (const yr of years) {
      for (const mo of monthsNamed) yms.add(yr * 100 + mo);
    }
  }
  return { years, yms, monthsNamed };
}

export class ColdRawStore {
  constructor(initialBodies = {}) {
    this._bodies = new Map(Object.entries(initialBodies));
    this.rawBodyReads = 0;
    this.warmLocked = false;
  }

  lockWarm({ resetCounter = false } = {}) {
    if (resetCounter) this.rawBodyReads = 0;
    this.warmLocked = true;
    return this;
  }

  withWarmLock(fn) {
    const prev = this.warmLocked;
    this.warmLocked = true;
    try { return fn(this); } finally { this.warmLocked = prev; }
  }

  put(cardId, body) {
    if (this.warmLocked) throw new Error('Cannot put into warm-locked ColdRawStore');
    this._bodies.set(String(cardId), String(body ?? ''));
  }

  readRawBody(cardId) {
    this.rawBodyReads += 1;
    if (this.warmLocked) {
      throw new Error(`Warm query attempted cold raw-body read for ${cardId}`);
    }
    return this._bodies.get(String(cardId)) ?? '';
  }
}

const NPY_DTYPE_BYTES = Object.freeze({
  '<u8': 8, '<i8': 8, '<f8': 8,
  '<u4': 4, '<i4': 4, '<f4': 4,
  '<u2': 2, '<i2': 2,
  '|u1': 1, '|i1': 1, '|b1': 1, '<u1': 1, '<i1': 1,
});

export function readNpyHeader(fd) {
  const st = fs.fstatSync(fd);
  if (!st.isFile()) throw new Error('Expected regular .npy file');
  const pre = Buffer.alloc(12);
  const readN = fs.readSync(fd, pre, 0, 12, 0);
  if (readN < 10 || pre.subarray(0, 6).toString('latin1') !== '\x93NUMPY') {
    throw new Error('Invalid .npy magic header');
  }
  const major = pre[6];
  const minor = pre[7];
  let hdrLen;
  let dataOffset;
  if (major === 1) {
    hdrLen = pre.readUInt16LE(8);
    dataOffset = 10 + hdrLen;
  } else if (major === 2 || major === 3) {
    if (readN < 12) throw new Error('Truncated .npy header');
    hdrLen = pre.readUInt32LE(8);
    dataOffset = 12 + hdrLen;
  } else {
    throw new Error(`Unsupported .npy version ${major}.${minor}`);
  }
  if (!Number.isInteger(hdrLen) || hdrLen <= 0 || hdrLen > 16 * 1024 * 1024) {
    throw new Error(`Invalid .npy header length: ${hdrLen}`);
  }
  const hdrBuf = Buffer.alloc(hdrLen);
  if (fs.readSync(fd, hdrBuf, 0, hdrLen, major === 1 ? 10 : 12) !== hdrLen) {
    throw new Error('Truncated .npy header');
  }
  const hdrText = hdrBuf.toString('latin1');
  const descrMatch = /'descr'\s*:\s*'([^']+)'/.exec(hdrText);
  const fortranMatch = /'fortran_order'\s*:\s*(True|False)/.exec(hdrText);
  const shapeMatch = /'shape'\s*:\s*\(([^)]*)\)/.exec(hdrText);
  if (!descrMatch || !shapeMatch) throw new Error(`Malformed .npy header: ${hdrText}`);
  const fortranOrder = fortranMatch ? fortranMatch[1] === 'True' : false;
  if (fortranOrder) throw new Error('Fortran-order .npy not supported');
  const descr = descrMatch[1];
  const itemBytes = NPY_DTYPE_BYTES[descr];
  if (!itemBytes) throw new Error(`Unsupported .npy dtype ${descr}`);
  const rawShape = shapeMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
  if (rawShape.some((s) => !/^\d+$/.test(s))) {
    throw new Error(`Invalid .npy shape: (${shapeMatch[1]})`);
  }
  const shape = rawShape.map((s) => Number.parseInt(s, 10));
  if (!shape.every((d) => Number.isSafeInteger(d) && d >= 0)) {
    throw new Error(`Invalid .npy shape dimensions: (${shapeMatch[1]})`);
  }
  const length = shape.reduce((a, b) => a * b, 1);
  if (!Number.isSafeInteger(length) || !Number.isSafeInteger(dataOffset + length * itemBytes)) {
    throw new Error('Invalid .npy payload length');
  }
  if (st.size < dataOffset + length * itemBytes) {
    throw new Error(`Truncated .npy payload: expected ${dataOffset + length * itemBytes} bytes, got ${st.size}`);
  }
  return { descr, itemBytes, fortranOrder: false, shape, length, dataOffset };
}

function readTypedValueAt(fd, meta, idx) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= meta.length) {
    throw new RangeError(`Out-of-bounds .npy index ${idx} (length ${meta.length})`);
  }
  const buf = Buffer.alloc(meta.itemBytes);
  if (fs.readSync(fd, buf, 0, meta.itemBytes, meta.dataOffset + idx * meta.itemBytes) !== meta.itemBytes) {
    throw new Error(`Truncated .npy element read at index ${idx}`);
  }
  switch (meta.descr) {
    case '<u8': return buf.readBigUInt64LE(0);
    case '<i8': return buf.readBigInt64LE(0);
    case '<u4': return buf.readUInt32LE(0);
    case '<i4': return buf.readInt32LE(0);
    case '<u2': return buf.readUInt16LE(0);
    case '<i2': return buf.readInt16LE(0);
    case '|u1': case '<u1': case '|b1': return buf.readUInt8(0);
    case '|i1': case '<i1': return buf.readInt8(0);
    default: throw new Error(`Unsupported element read for ${meta.descr}`);
  }
}

function writeNpyFile(filePath, descr, typedBuffer, shape) {
  const shapeText = shape.length === 1 ? `${shape[0]},` : shape.join(', ');
  const headerBase = `{'descr': '${descr}', 'fortran_order': False, 'shape': (${shapeText}), }`;
  const padLen = (16 - ((10 + headerBase.length + 1) % 16)) % 16;
  const headerText = headerBase + ' '.repeat(padLen) + '\n';
  const pre = Buffer.alloc(10);
  pre.write('\x93NUMPY', 0, 'latin1');
  pre[6] = 1;
  pre[7] = 0;
  pre.writeUInt16LE(headerText.length, 8);
  const full = Buffer.concat([pre, Buffer.from(headerText, 'latin1'), typedBuffer]);
  fs.writeFileSync(filePath, full);
}

export function buildWriteOnceCatalog(outDir, records, { coldStore = null, existingState = null } = {}) {
  fs.mkdirSync(path.join(outDir, 'bm25_csr'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'meta'), { recursive: true });

  const state = existingState || {
    seenIds: new Set(),
    hashToIdx: new Map(),
    kept: [],
    reusedBySha256: 0,
    skippedById: 0,
    newTokenized: 0,
  };

  for (const rec of records) {
    const id = String(rec.id);
    if (state.seenIds.has(id)) {
      state.skippedById += 1;
      continue;
    }
    state.seenIds.add(id);
    const body = String(rec.body ?? rec.text ?? '');
    const titleNorm = String(rec.title ?? '').trim();
    if (coldStore) coldStore.put(id, body);
    const digestBuf = canonicalDigest(body);
    const digestHex = digestBuf.toString('hex');

    let bodyTokens;
    let tokens;
    if (state.hashToIdx.has(digestHex)) {
      const prior = state.kept[state.hashToIdx.get(digestHex)];
      bodyTokens = prior.bodyTokens;
      tokens = prior.titleNorm === titleNorm
        ? prior.tokens
        : (titleNorm ? [...tokenizeBilingual(titleNorm), ...bodyTokens] : bodyTokens);
      state.reusedBySha256 += 1;
    } else {
      bodyTokens = tokenizeBilingual(body);
      tokens = titleNorm ? [...tokenizeBilingual(titleNorm), ...bodyTokens] : bodyTokens;
      state.newTokenized += 1;
    }
    const idx = state.kept.length;
    if (!state.hashToIdx.has(digestHex)) state.hashToIdx.set(digestHex, idx);
    state.kept.push({
      idx,
      id,
      digestBuf,
      dateInt: parseDateInt(rec.date_iso ?? rec.dateIso ?? ''),
      topic: String(rec.topic ?? 'topic:general'),
      modality: Number(rec.modality ?? 0),
      supersedesId: rec.supersedesId ? String(rec.supersedesId) : null,
      titleNorm,
      bodyTokens,
      tokens,
    });
  }

  const n = state.kept.length;
  const idToIdx = new Map(state.kept.map((r) => [r.id, r.idx]));
  const supersededBy = new Int32Array(n).fill(-1);
  const supersedes = new Int32Array(n).fill(-1);
  const latestRoot = Int32Array.from({ length: n }, (_, i) => i);
  const isLatest = new Uint8Array(n).fill(1);
  let supersessionEdges = 0;

  // Link explicit supersedesId references and latest topic dates (never auto-chain topic:general or create cycles)
  const createsCycle = (oldIdx, newIdx) => {
    if (oldIdx === newIdx) return true;
    let cur = newIdx;
    const seen = new Set();
    while (cur >= 0 && !seen.has(cur)) {
      if (cur === oldIdx) return true;
      seen.add(cur);
      cur = supersededBy[cur];
    }
    return false;
  };
  const topicChains = new Map();
  for (const r of state.kept) {
    if (r.supersedesId && idToIdx.has(r.supersedesId)) {
      const oldIdx = idToIdx.get(r.supersedesId);
      if (oldIdx !== r.idx && supersededBy[oldIdx] === -1 && !createsCycle(oldIdx, r.idx)) {
        supersededBy[oldIdx] = r.idx;
        supersedes[r.idx] = oldIdx;
        isLatest[oldIdx] = 0;
        supersessionEdges += 1;
      }
    }
    if (r.topic && r.topic !== 'topic:general') {
      if (!topicChains.has(r.topic)) topicChains.set(r.topic, []);
      topicChains.get(r.topic).push(r);
    }
  }
  for (const chain of topicChains.values()) {
    if (chain.length < 2) continue;
    const dated = [...chain].filter((c) => c.dateInt > 0).sort((a, b) => a.dateInt - b.dateInt || a.idx - b.idx);
    for (let i = 0; i < dated.length;) {
      let j = i + 1;
      while (j < dated.length && dated[j].dateInt === dated[i].dateInt) j += 1;
      if (j >= dated.length) break;
      let k = j + 1;
      while (k < dated.length && dated[k].dateInt === dated[j].dateInt) k += 1;
      const target = dated[k - 1].idx;
      for (let m = i; m < j; m += 1) {
        const a = dated[m].idx;
        if (supersededBy[a] === -1 && !createsCycle(a, target)) {
          supersededBy[a] = target;
          if (supersedes[target] === -1) supersedes[target] = a;
          isLatest[a] = 0;
          supersessionEdges += 1;
        }
      }
      i = j;
    }
  }
  const rootState = new Uint8Array(n); // 0 = unvisited, 1 = visiting, 2 = resolved
  for (let i = 0; i < n; i++) {
    if (rootState[i] === 2) continue;
    const walk = [];
    let cur = i;
    while (rootState[cur] === 0) {
      rootState[cur] = 1;
      walk.push(cur);
      const nxt = supersededBy[cur];
      if (nxt < 0) break;
      cur = nxt;
    }
    const root = rootState[cur] === 2 ? latestRoot[cur] : cur;
    for (const node of walk) {
      latestRoot[node] = root;
      rootState[node] = 2;
    }
  }

  // Build sorted CSR BM25 postings matching library_1m.py binary layout
  const termMap = new Map();
  const docLens = new Uint16Array(n);
  let totalLen = 0;
  for (const r of state.kept) {
    docLens[r.idx] = Math.min(65535, r.tokens.length);
    totalLen += r.tokens.length;
    const counts = new Map();
    for (const tok of r.tokens) {
      const h = hashTokenU64(tok);
      counts.set(h, (counts.get(h) || 0) + 1);
    }
    for (const [h, tf] of counts.entries()) {
      if (!termMap.has(h)) termMap.set(h, []);
      termMap.get(h).push([r.idx, Math.min(255, tf)]);
    }
  }
  const sortedHashes = [...termMap.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const vSize = sortedHashes.length;
  const termHashesBuf = Buffer.alloc(vSize * 8);
  const indptrBuf = Buffer.alloc((vSize + 1) * 8);
  let nnz = 0;
  for (let t = 0; t < vSize; t++) {
    termHashesBuf.writeBigUInt64LE(sortedHashes[t], t * 8);
    indptrBuf.writeBigInt64LE(BigInt(nnz), t * 8);
    nnz += termMap.get(sortedHashes[t]).length;
  }
  indptrBuf.writeBigInt64LE(BigInt(nnz), vSize * 8);

  const docIdsBuf = Buffer.alloc(nnz * 4);
  const tfsBuf = Buffer.alloc(nnz);
  let offset = 0;
  for (let t = 0; t < vSize; t++) {
    for (const [docIdx, tf] of termMap.get(sortedHashes[t])) {
      docIdsBuf.writeUInt32LE(docIdx, offset * 4);
      tfsBuf[offset] = tf;
      offset += 1;
    }
  }

  writeNpyFile(path.join(outDir, 'bm25_csr', 'term_hashes.npy'), '<u8', termHashesBuf, [vSize]);
  writeNpyFile(path.join(outDir, 'bm25_csr', 'indptr.npy'), '<i8', indptrBuf, [vSize + 1]);
  writeNpyFile(path.join(outDir, 'bm25_csr', 'doc_lens.npy'), '<u2', Buffer.from(docLens.buffer), [n]);
  fs.writeFileSync(path.join(outDir, 'bm25_csr', 'doc_ids.bin'), docIdsBuf);
  fs.writeFileSync(path.join(outDir, 'bm25_csr', 'tfs.bin'), tfsBuf);

  const shaBuf = Buffer.concat(state.kept.map((r) => r.digestBuf));
  const dateArr = Int32Array.from(state.kept.map((r) => r.dateInt));
  const modArr = Uint8Array.from(state.kept.map((r) => r.modality));
  const synArr = new Uint8Array(n);
  fs.writeFileSync(path.join(outDir, 'meta', 'sha256.bin'), shaBuf);
  writeNpyFile(path.join(outDir, 'meta', 'date_yyyymmdd.npy'), '<i4', Buffer.from(dateArr.buffer), [n]);
  writeNpyFile(path.join(outDir, 'meta', 'modality.npy'), '|u1', Buffer.from(modArr.buffer), [n]);
  writeNpyFile(path.join(outDir, 'meta', 'superseded_by_idx.npy'), '<i4', Buffer.from(supersededBy.buffer), [n]);
  writeNpyFile(path.join(outDir, 'meta', 'supersedes_idx.npy'), '<i4', Buffer.from(supersedes.buffer), [n]);
  writeNpyFile(path.join(outDir, 'meta', 'latest_root_idx.npy'), '<i4', Buffer.from(latestRoot.buffer), [n]);
  writeNpyFile(path.join(outDir, 'meta', 'is_latest.npy'), '|u1', Buffer.from(isLatest.buffer), [n]);
  writeNpyFile(path.join(outDir, 'meta', 'is_synthetic.npy'), '|u1', Buffer.from(synArr.buffer), [n]);
  fs.writeFileSync(
    path.join(outDir, 'meta', 'real_card_ids.json.gz'),
    zlib.gzipSync(JSON.stringify(state.kept.map((r) => r.id))),
  );

  const manifest = {
    schema: LIBRARY_SCHEMA,
    n_total: n,
    n_real: n,
    unique_sha256: state.hashToIdx.size,
    dedup_stats: {
      new_tokenized: state.newTokenized,
      skipped_by_id: state.skippedById,
      reused_by_sha256: state.reusedBySha256,
    },
    bm25_vocab_size: vSize,
    bm25_nnz_postings: nnz,
    avg_doc_len: n > 0 ? totalLen / n : 1,
    supersession_edges: supersessionEdges,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { manifest, state };
}

export function sigmoid(x) {
  if (x >= 35) return 1.0 - 1e-15;
  if (x <= -35) return 1e-15;
  return 1.0 / (1.0 + Math.exp(-x));
}

export function evaluateCalibrationPacket({
  topScore = 0,
  secondScore = 0,
  stage1Count = 0,
  plattA = 1.15,
  plattB = -0.65,
  tau = 0.62,
  minMargin = 0.25,
  rawBodyReads = 0,
  warmLocked = true,
} = {}) {
  const margin = Math.max(0, Number(topScore) - Number(secondScore));
  const rawLogit = Number(topScore) * 0.45 + margin * 0.85;
  const pCal = sigmoid(plattA * rawLogit + plattB);
  const searchWider = pCal < tau || margin < minMargin;
  return {
    schema: DECISION_SCHEMA,
    p_cal: Number(pCal.toFixed(6)),
    tau,
    margin: Number(margin.toFixed(6)),
    stage1_count: stage1Count,
    search_wider: searchWider,
    action: searchWider ? 'search_wider' : 'answer_now',
    raw_body_reads: rawBodyReads,
    warm_verified: Boolean(warmLocked) && rawBodyReads === 0,
  };
}

export function fitPlatt2Fold(logits, labels, { steps = 80, lr = 0.2 } = {}) {
  if (!Array.isArray(logits) || logits.length < 4 || logits.length !== labels.length) {
    return { a: 1.0, b: 0.0, oofBrier: 0.25, baseBrier: 0.25, brierSkillScore: 0 };
  }
  const n = logits.length;
  const fitFold = (indices) => {
    let a = 1.0;
    let b = 0.0;
    for (let s = 0; s < steps; s++) {
      let ga = 0;
      let gb = 0;
      for (const i of indices) {
        const p = sigmoid(a * logits[i] + b);
        const err = p - labels[i];
        ga += err * logits[i];
        gb += err;
      }
      a -= (lr * ga) / indices.length;
      b -= (lr * gb) / indices.length;
    }
    return { a, b };
  };
  const fold0 = [];
  const fold1 = [];
  for (let i = 0; i < n; i++) (i % 2 === 0 ? fold0 : fold1).push(i);
  const p0 = fitFold(fold1);
  const p1 = fitFold(fold0);
  let se = 0;
  const meanY = labels.reduce((s, y) => s + y, 0) / n;
  let baseSe = 0;
  for (let i = 0; i < n; i++) {
    const params = i % 2 === 0 ? p0 : p1;
    const pred = sigmoid(params.a * logits[i] + params.b);
    se += (pred - labels[i]) ** 2;
    baseSe += (meanY - labels[i]) ** 2;
  }
  const oofBrier = se / n;
  const baseBrier = Math.max(1e-9, baseSe / n);
  const full = fitFold([...Array(n).keys()]);
  return {
    a: Number(full.a.toFixed(6)),
    b: Number(full.b.toFixed(6)),
    oofBrier: Number(oofBrier.toFixed(6)),
    baseBrier: Number(baseBrier.toFixed(6)),
    brierSkillScore: Number((1 - oofBrier / baseBrier).toFixed(6)),
  };
}

export function openLibraryCatalog(catalogDir, { coldStore = null } = {}) {
  const rootDir = fs.realpathSync(catalogDir);
  const manifestPath = path.join(rootDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schema !== LIBRARY_SCHEMA) {
    throw new Error(`Unsupported library schema: ${manifest.schema}`);
  }
  if (!Number.isInteger(manifest.n_total) || manifest.n_total < 0
      || !Number.isInteger(manifest.n_real) || manifest.n_real < 0 || manifest.n_real > manifest.n_total) {
    throw new Error('Invalid library manifest counts');
  }
  const bm25Dir = path.join(rootDir, 'bm25_csr');
  const metaDir = path.join(rootDir, 'meta');
  const fds = {};
  let metas;
  let docIdsSize = 0;
  let tfsSize = 0;
  let shaSize = 0;
  let realCardIds;
  try {
    const files = {
      termHashes: path.join(bm25Dir, 'term_hashes.npy'),
      indptr: path.join(bm25Dir, 'indptr.npy'),
      docLens: path.join(bm25Dir, 'doc_lens.npy'),
      docIds: path.join(bm25Dir, 'doc_ids.bin'),
      tfs: path.join(bm25Dir, 'tfs.bin'),
      sha256: path.join(metaDir, 'sha256.bin'),
      date: path.join(metaDir, 'date_yyyymmdd.npy'),
      supBy: path.join(metaDir, 'superseded_by_idx.npy'),
      latestRoot: path.join(metaDir, 'latest_root_idx.npy'),
      isLatest: path.join(metaDir, 'is_latest.npy'),
      isSynthetic: path.join(metaDir, 'is_synthetic.npy'),
    };
    for (const [k, p] of Object.entries(files)) {
      fds[k] = fs.openSync(p, 'r');
    }
    const statRegular = (k) => {
      const st = fs.fstatSync(fds[k]);
      if (!st.isFile()) throw new Error(`Expected regular file for ${k}`);
      return st.size;
    };
    docIdsSize = statRegular('docIds');
    tfsSize = statRegular('tfs');
    shaSize = statRegular('sha256');
    metas = {
      termHashes: readNpyHeader(fds.termHashes),
      indptr: readNpyHeader(fds.indptr),
      docLens: readNpyHeader(fds.docLens),
      date: readNpyHeader(fds.date),
      supBy: readNpyHeader(fds.supBy),
      latestRoot: readNpyHeader(fds.latestRoot),
      isLatest: readNpyHeader(fds.isLatest),
      isSynthetic: readNpyHeader(fds.isSynthetic),
    };
    if (shaSize < manifest.n_total * 32) {
      throw new Error(`Truncated sha256 table: expected ${manifest.n_total * 32} bytes`);
    }
    const rawGz = fs.readFileSync(path.join(metaDir, 'real_card_ids.json.gz'));
    realCardIds = JSON.parse(zlib.gunzipSync(rawGz, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8'));
    if (!Array.isArray(realCardIds)) throw new Error('Invalid real_card_ids.json.gz');
  } catch (err) {
    for (const fd of Object.values(fds)) {
      try { fs.closeSync(fd); } catch {}
    }
    throw err;
  }
  let closed = false;

  const findTermPos = (hashVal) => {
    let lo = 0;
    let hi = metas.termHashes.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = readTypedValueAt(fds.termHashes, metas.termHashes, mid);
      if (v === hashVal) return mid;
      if (v < hashVal) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  };

  const cardIdAt = (idx) => {
    if (idx < manifest.n_real) return realCardIds[idx] ?? `real-${idx}`;
    return `syn-${String(idx - manifest.n_real).padStart(7, '0')}`;
  };

  const hasDigestHex = (hexDigest) => {
    if (closed) throw new Error('Catalog already closed');
    const target = Buffer.from(String(hexDigest).toLowerCase(), 'hex');
    if (target.length !== 32) return false;
    const nCheck = manifest.n_total;
    const chunkSize = 4096;
    const buf = Buffer.alloc(chunkSize * 32);
    for (let base = 0; base < nCheck; base += chunkSize) {
      const rows = Math.min(chunkSize, nCheck - base);
      const got = fs.readSync(fds.sha256, buf, 0, rows * 32, base * 32);
      if (got !== rows * 32) throw new Error('Truncated sha256 read');
      for (let i = 0; i < rows; i++) {
        if (buf.compare(target, 0, 32, i * 32, (i + 1) * 32) === 0) return true;
      }
    }
    return false;
  };

  const searchWarm = (queryText, {
    topK = 24,
    stage1Limit = 200,
    widen = false,
    k1 = 1.2,
    b = 0.75,
    staleDelta = 2.0,
  } = {}) => {
    if (closed) throw new Error('Catalog already closed');
    const readsBefore = coldStore ? coldStore.rawBodyReads : 0;
    const tokens = [...new Set(tokenizeBilingual(queryText))];
    const { years, yms } = extractQueryDateCues(queryText);
    const hasDateCue = years.size > 0 || yms.size > 0;
    const nTotal = Math.max(1, manifest.n_total);
    const avgDl = Math.max(1e-9, Number(manifest.avg_doc_len || 1));
    const scores = new Map();

    for (const tok of tokens) {
      const pos = findTermPos(hashTokenU64(tok));
      if (pos < 0 || pos + 1 >= metas.indptr.length) continue;
      const startPtr = Number(readTypedValueAt(fds.indptr, metas.indptr, pos));
      const endPtr = Number(readTypedValueAt(fds.indptr, metas.indptr, pos + 1));
      if (!Number.isSafeInteger(startPtr) || !Number.isSafeInteger(endPtr) || startPtr < 0 || endPtr < startPtr) continue;
      const df = endPtr - startPtr;
      if (df <= 0 || df > nTotal) continue;
      if ((startPtr + df) * 4 > docIdsSize || (startPtr + df) > tfsSize) {
        throw new Error('Corrupt CSR postings range');
      }
      const idf = Math.log(1 + (nTotal - df + 0.5) / (df + 0.5));
      const docBuf = Buffer.alloc(df * 4);
      const tfBuf = Buffer.alloc(df);
      if (fs.readSync(fds.docIds, docBuf, 0, df * 4, startPtr * 4) !== df * 4
          || fs.readSync(fds.tfs, tfBuf, 0, df, startPtr) !== df) {
        throw new Error('Truncated CSR postings read');
      }
      for (let i = 0; i < df; i++) {
        const docIdx = docBuf.readUInt32LE(i * 4);
        if (docIdx >= manifest.n_total) continue;
        const tf = tfBuf[i];
        const dl = Number(readTypedValueAt(fds.docLens, metas.docLens, docIdx));
        const bm25 = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgDl))));
        scores.set(docIdx, (scores.get(docIdx) || 0) + bm25);
      }
    }

    // Two-pass write-time supersession: Pass 1 fixes root & pinned scores; Pass 2 demotes stale nodes by >= staleDelta
    const narrowSorted = [...scores.entries()]
      .sort((a, bPair) => bPair[1] - a[1] || a[0] - bPair[0])
      .slice(0, widen ? Math.max(stage1Limit * 2, 400) : stage1Limit);

    const candMeta = [];
    const adjusted = new Map();
    const yearsWithMonth = new Set([...yms].map((ym) => Math.floor(ym / 100)));
    for (const [docIdx, baseSc] of narrowSorted) {
      const latest = readTypedValueAt(fds.isLatest, metas.isLatest, docIdx) === 1;
      const rootIdx = Number(readTypedValueAt(fds.latestRoot, metas.latestRoot, docIdx));
      const supByIdx = Number(readTypedValueAt(fds.supBy, metas.supBy, docIdx));
      const dInt = Number(readTypedValueAt(fds.date, metas.date, docIdx));
      const docYear = Math.floor(dInt / 10000);
      const docYm = Math.floor(dInt / 100);
      const pinOldDate = hasDateCue && (yms.has(docYm) || (years.has(docYear) && !yearsWithMonth.has(docYear)));
      candMeta.push({ docIdx, baseSc, latest, rootIdx, supByIdx, pinOldDate });

      if (pinOldDate || latest || rootIdx < 0 || rootIdx >= manifest.n_total || rootIdx === docIdx) {
        adjusted.set(docIdx, Math.max(adjusted.get(docIdx) ?? -Infinity, baseSc + (pinOldDate ? 0.45 : latest ? 0.15 : 0)));
      } else {
        const rootBase = scores.get(rootIdx) ?? baseSc;
        const promotedRoot = Math.max(rootBase + 0.35, baseSc + 0.35);
        adjusted.set(rootIdx, Math.max(adjusted.get(rootIdx) ?? -Infinity, promotedRoot));
      }
    }
    for (const { docIdx, baseSc, latest, rootIdx, supByIdx, pinOldDate } of candMeta) {
      if (!latest && !pinOldDate && (supByIdx >= 0 || rootIdx !== docIdx) && rootIdx >= 0 && rootIdx < manifest.n_total && rootIdx !== docIdx) {
        let hops = 1;
        let cur = supByIdx;
        const seen = new Set([docIdx]);
        while (cur >= 0 && cur < manifest.n_total && cur !== rootIdx && hops < 16 && !seen.has(cur)) {
          seen.add(cur);
          hops += 1;
          cur = Number(readTypedValueAt(fds.supBy, metas.supBy, cur));
        }
        const rootFinal = adjusted.get(rootIdx) ?? (scores.get(rootIdx) ?? 0);
        const hopPenalty = staleDelta * (1 + 0.25 * Math.min(4, hops));
        const demoted = Math.min(baseSc - hopPenalty, rootFinal - hopPenalty);
        adjusted.set(docIdx, Math.min(adjusted.get(docIdx) ?? Infinity, demoted));
      }
    }

    const ranked = [...adjusted.entries()]
      .sort((a, bPair) => bPair[1] - a[1] || a[0] - bPair[0])
      .slice(0, widen ? Math.max(topK * 2, topK) : topK)
      .map(([idx, score]) => ({
        idx,
        id: cardIdAt(idx),
        score: Number(score.toFixed(6)),
        dateYyyymmdd: Number(readTypedValueAt(fds.date, metas.date, idx)),
        isLatest: readTypedValueAt(fds.isLatest, metas.isLatest, idx) === 1,
        supersededByIdx: Number(readTypedValueAt(fds.supBy, metas.supBy, idx)),
        isSynthetic: readTypedValueAt(fds.isSynthetic, metas.isSynthetic, idx) === 1,
      }));

    const readsAfter = coldStore ? coldStore.rawBodyReads : 0;
    const rawDelta = readsAfter - readsBefore;
    if (rawDelta !== 0) {
      throw new Error(`Warm library invariant violated: rawBodyReads=${rawDelta}`);
    }
    const packet = evaluateCalibrationPacket({
      topScore: ranked[0]?.score ?? 0,
      secondScore: ranked[1]?.score ?? 0,
      stage1Count: narrowSorted.length,
      rawBodyReads: rawDelta,
      warmLocked: coldStore ? Boolean(coldStore.warmLocked) : true,
    });
    return {
      query: queryText,
      hits: ranked,
      stage1Count: narrowSorted.length,
      rawBodyReads: rawDelta,
      decision: packet,
    };
  };

  return {
    manifest,
    warmStats: () => {
      if (closed) throw new Error('Catalog already closed');
      return {
        schema: manifest.schema,
        nTotal: manifest.n_total,
        nReal: manifest.n_real,
        uniqueSha256: manifest.unique_sha256,
        supersessionEdges: manifest.supersession_edges,
        rawBodyReads: coldStore ? coldStore.rawBodyReads : 0,
      };
    },
    hasDigestHex,
    searchWarm,
    close: () => {
      if (closed) return;
      closed = true;
      for (const fd of Object.values(fds)) fs.closeSync(fd);
    },
  };
}
