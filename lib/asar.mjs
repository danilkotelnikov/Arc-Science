// Minimal asar reader and writer (Electron archive format). No dependencies.
// Layout: u32 4 | u32 headerSize | u32 payloadSize | u32 jsonLength | json (padded to 4) | file data.
// Files marked "unpacked" live in <archive>.unpacked and are carried over untouched.
import fs from 'node:fs';
import crypto from 'node:crypto';

const BLOCK = 4 * 1024 * 1024;
const align4 = (n) => (n + 3) & ~3;

export function openAsar(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const jsonLen = head.readUInt32LE(12);
  const json = Buffer.alloc(jsonLen);
  fs.readSync(fd, json, 0, jsonLen, 16);
  const tree = JSON.parse(json.toString('utf8'));
  const dataStart = 8 + head.readUInt32LE(4);
  const files = [];
  (function walk(node, prefix) {
    for (const [name, v] of Object.entries(node.files || {})) {
      const p = prefix ? prefix + '/' + name : name;
      if (v.files) walk(v, p);
      else files.push({ path: p, entry: v });
    }
  })(tree, '');
  const read = (f) => {
    const e = f.entry;
    const b = Buffer.alloc(e.size);
    if (e.unpacked) throw new Error('unpacked file has no data in the archive: ' + f.path);
    fs.readSync(fd, b, 0, e.size, dataStart + Number(e.offset));
    return b;
  };
  return { file, fd, tree, dataStart, files, read, close: () => fs.closeSync(fd), byPath: new Map(files.map((f) => [f.path, f])) };
}

export function integrityOf(buf) {
  const blocks = [];
  for (let i = 0; i < Math.max(buf.length, 1); i += BLOCK) blocks.push(crypto.createHash('sha256').update(buf.subarray(i, i + BLOCK)).digest('hex'));
  return { algorithm: 'SHA256', hash: crypto.createHash('sha256').update(buf).digest('hex'), blockSize: BLOCK, blocks };
}

// overrides: Map<path, Buffer | null>. A Buffer replaces or adds a packed file; null removes it.
export function writeAsar(src, outFile, overrides = new Map()) {
  const tree = JSON.parse(JSON.stringify(src.tree));
  const node = (p, create) => {
    let n = tree;
    const parts = p.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      if (!n.files[parts[i]]) { if (!create) return null; n.files[parts[i]] = { files: {} }; }
      n = n.files[parts[i]];
    }
    return { dir: n, name: parts[parts.length - 1] };
  };
  const data = new Map(); // path -> Buffer, for changed or new files
  for (const [p, buf] of overrides) {
    const loc = node(p, buf !== null);
    if (!loc) continue;
    if (buf === null) { delete loc.dir.files[loc.name]; continue; }
    const old = loc.dir.files[loc.name];
    if (old && old.unpacked) throw new Error('refusing to override an unpacked file: ' + p);
    loc.dir.files[loc.name] = { size: buf.length, offset: '0', integrity: integrityOf(buf) };
    data.set(p, buf);
  }
  // lay out packed files in their original order, then new ones
  const packed = [];
  (function walk(n, prefix) {
    for (const [name, v] of Object.entries(n.files || {})) {
      const p = prefix ? prefix + '/' + name : name;
      if (v.files) walk(v, p); else if (!v.unpacked) packed.push({ p, v });
    }
  })(tree, '');
  const origOrder = (x) => (data.has(x.p) ? (src.byPath.has(x.p) ? Number(src.byPath.get(x.p).entry.offset) : Infinity) : Number(x.v.offset));
  packed.sort((a, b) => origOrder(a) - origOrder(b));
  let off = 0;
  for (const x of packed) { x.v.offset = String(off); off += x.v.size; }
  const json = Buffer.from(JSON.stringify(tree), 'utf8');
  const pad = align4(json.length) - json.length;
  const head = Buffer.alloc(16);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(align4(json.length) + 8, 4);
  head.writeUInt32LE(align4(json.length) + 4, 8);
  head.writeUInt32LE(json.length, 12);
  const out = fs.openSync(outFile, 'w');
  try {
    fs.writeSync(out, head); fs.writeSync(out, json); if (pad) fs.writeSync(out, Buffer.alloc(pad));
    for (const x of packed) {
      const buf = data.has(x.p) ? data.get(x.p) : src.read(src.byPath.get(x.p));
      fs.writeSync(out, buf);
    }
  } finally { fs.closeSync(out); }
  return { files: packed.length, bytes: off };
}
