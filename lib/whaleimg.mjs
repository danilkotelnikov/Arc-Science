// Pictures that carry the old vendor's whale, its blue or its name: replaced by files of this kit (brand/dist).
// Raster pictures and SVG preview pictures are found by the sha256 of their bytes (brand/pictures.json, made by looking at every
// distinct picture of the original app and its plugins); inline SVG marks are found by their path. test/image-scan.py checks the result.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { recolorBlueInScript } from './iconcolor.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(KIT, 'brand', 'dist');
const read = (name) => fs.readFileSync(path.join(DIST, name));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
let catalog = null;
let cube = null;
const load = () => {
  if (!catalog) {
    catalog = JSON.parse(fs.readFileSync(path.join(KIT, 'brand', 'pictures.json'), 'utf8'));
    const b = JSON.parse(read('brand.json').toString('utf8'));
    cube = { top: b.top, left: b.leftAS, right: b.right };
  }
};

// the whale as vector art, in the two forms the original app and its plugins use
export const WHALE_PATHS = ['c-.254-.124-.364.113', 'M22.9168 1.43018', '11.365 11.365 0 00-.689-.471'];
const hasWhalePath = (text) => WHALE_PATHS.some((p) => text.includes(p));

// raster file bytes: the replacement picture, or null when the bytes are not a known whale
export function swapPicture(buf) {
  load();
  const e = catalog.whale[sha(buf)];
  return e ? read(e.replace) : null;
}

// svg file bytes of a known preview picture (the plugin manager's previews): the replacement, or null
function swapPreview(buf) {
  load();
  const e = catalog.svgSwap[sha(buf)];
  return e ? read(e.replace) : null;
}

const cubePaths = (q, fill) => ['top', 'left', 'right'].map((k) => `<path d=${q}${cube[k]}${q} fill=${q}${fill}${q} fill-rule=${q}evenodd${q}/>`).join('');

// base64 data URIs in a script or page: whale PNGs, preview pictures, and blue in any other SVG picture
function swapDataUris(text) {
  if (!text.includes('data:image')) return text;
  load();
  return text.replace(/(data:image\\?\/(png|svg\+xml)(?:;[\w=-]+)?;base64,)([A-Za-z0-9+/=]+)/g, (m, head, kind, b64) => {
    const buf = Buffer.from(b64, 'base64');
    const rep = kind === 'png' ? swapPicture(buf) : swapPreview(buf);
    if (rep) return head + rep.toString('base64');
    if (kind === 'svg+xml') {
      const svg = buf.toString('utf8');
      const out = recolorBlueInScript(svg);
      if (out !== svg) return head + Buffer.from(out, 'utf8').toString('base64');
    }
    return m;
  });
}

// an <svg> element inside script or page text that holds the whale: replaced by the AS cube, keeping the element's other attributes
function swapInlineSvg(text) {
  if (!hasWhalePath(text)) return text;
  load();
  let out = text, from = 0;
  for (;;) {
    const hits = WHALE_PATHS.map((p) => out.indexOf(p, from)).filter((i) => i >= 0);
    if (!hits.length) break;
    const hit = Math.min(...hits);
    const start = out.lastIndexOf('<svg', hit);
    const close = /<\\?\/svg>/g;
    close.lastIndex = hit;
    const m = close.exec(out);
    const openEnd = start < 0 ? -1 : out.indexOf('>', start);
    // a plain element only: a real open tag (`<svg` then a space or `>`, no `=>` or code words before the whale), no other element closes
    // between the tag and the whale (path data in a separate string is handled below)
    const before = start < 0 ? '' : out.slice(start, hit);
    const realTag = start >= 0 && /^<svg(?:\s[^<>]*)?>/.test(out.slice(start, start + 4000));
    if (!realTag || !m || openEnd < 0 || openEnd > hit || /<\\?\/svg>|=>|\bfunction\b|\breturn\b/.test(before) || m.index - start > 40000) { from = hit + 1; continue; }
    const q = /\\"/.test(out.slice(start, openEnd)) ? '\\"' : '"';
    const open = out.slice(start, openEnd + 1).replace(/viewBox=(\\?")[^"\\]*\\?"/, `viewBox=${q}0 0 256 256${q}`);
    const rep = open + cubePaths(q, 'currentColor') + m[0];
    out = out.slice(0, start) + rep + out.slice(m.index + m[0].length);
    from = start + rep.length;
  }
  return out;
}

// path data of the whale kept in a string of its own (an icon library entry, an icon table): replaced by the cube, drawn in 24 units
const WHALE_D = /M23\.748 4\.(?:482|651)c-\.254-\.124/g;
function swapPathStrings(text) {
  if (!WHALE_D.test(text)) return text;
  WHALE_D.lastIndex = 0;
  load();
  const k = 24 / 256;
  const d24 = [cube.top, cube.left, cube.right].join('').replace(/-?\d+(?:\.\d+)?/g, (n) => String(+(n * k).toFixed(3)));
  let out = '', last = 0, m;
  while ((m = WHALE_D.exec(text))) {
    const q = text[m.index - 1];   // the path starts right after its opening quote
    const end = '`"\''.includes(q) ? text.indexOf(q, m.index) : -1;
    if (end < 0 || end - m.index > 3000 || !/^[-\w.,\s]+$/.test(text.slice(m.index, end))) continue;   // not a plain path string: the scan reports it
    out += text.slice(last, m.index) + d24;
    last = end;
  }
  return out + text.slice(last);
}

// a whole .svg file that holds the whale: the cube on a paper tile, at the file's width and height
function swapSvgFile(text) {
  if (!hasWhalePath(text)) return text;
  if ((text.match(/<path\b/g) || []).length > 3) return text;   // a sprite or a multi-icon file: the scan reports it, nothing is cut out
  load();
  const root = /<svg\b[^>]*>/.exec(text)?.[0] ?? '';
  const w = /\swidth="([^"]+)"/.exec(root)?.[1], h = /\sheight="([^"]+)"/.exec(root)?.[1];
  const size = (w ? ` width="${w}"` : '') + (h ? ` height="${h}"` : '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"${size}><title>Arc Harness</title><rect width="256" height="256" rx="56" fill="#FAF9F6"/><g transform="translate(36 36) scale(0.72)">${cubePaths('"', '#0A0A0A')}</g></svg>\n`;
}

// script, page and svg text: the picture swaps for one file
export function swapPictures(file, text) {
  if (/\.svg$/i.test(file)) return swapSvgFile(text);
  if (!/\.(c|m)?(js|tsx?)$|\.html?$|\.css$/i.test(file)) return text;
  return swapPathStrings(swapInlineSvg(swapDataUris(text)));
}
