/**
 * Colour maths for the Molecullage gate. A JavaScript port of Molecullage palette/colour.py:
 * sRGB, CIE Lab, CIEDE2000 and colour-vision simulation (Machado, Oliveira and Fernandes 2009, severity 1.0, linear sRGB),
 * plus WCAG contrast. Pure functions, no DOM.
 */

export const MACHADO = {
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
export const VISION_KINDS = ['normal', 'deutan', 'protan', 'tritan'];

export function parseHex(h) {
  let s = String(h).trim().replace(/^#/, '');
  if (s.length === 3 || s.length === 4) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return null;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
}

export function toHex(c) {
  return '#' + c.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const lin1 = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const lin = (rgb) => rgb.map(lin1);

export function lab(l) {
  const [r, g, b] = l;
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.071175 * b;
  const Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** CIEDE2000, the same steps as colour.py de2000. */
export function de2000(p, q) {
  const [L1, a1, b1] = p;
  const [L2, a2, b2] = q;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1 = ((deg(Math.atan2(b1, a1p)) % 360) + 360) % 360;
  const h2 = ((deg(Math.atan2(b2, a2p)) % 360) + 360) % 360;
  const dL = L2 - L1, dC = C2p - C1p;
  const dh = C1p * C2p === 0 ? 0 : ((((h2 - h1 + 540) % 360) + 360) % 360) - 180;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dh / 2));
  const Lm = (L1 + L2) / 2, Cpm = (C1p + C2p) / 2;
  let hm;
  if (C1p * C2p === 0) hm = h1 + h2;
  else if (Math.abs(h1 - h2) <= 180) hm = (h1 + h2) / 2;
  else hm = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  const T = 1 - 0.17 * Math.cos(rad(hm - 30)) + 0.24 * Math.cos(rad(2 * hm)) + 0.32 * Math.cos(rad(3 * hm + 6)) - 0.2 * Math.cos(rad(4 * hm - 63));
  const dth = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm, Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(rad(2 * dth)) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

/** Lab of a hex colour as seen with the given vision type. */
export function seen(hex, kind) {
  let l = lin(parseHex(hex));
  if (kind !== 'normal') {
    const m = MACHADO[kind];
    l = m.map((row) => Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2])));
  }
  return lab(l);
}

/** Smallest CIEDE2000 between any two colours over the four vision types: { value, kind, pair }. */
export function minDE(hexes) {
  let best = { value: Infinity, kind: null, pair: null };
  for (const kind of VISION_KINDS) {
    const labs = hexes.map((h) => seen(h, kind));
    for (let i = 0; i < hexes.length; i++) {
      for (let j = i + 1; j < hexes.length; j++) {
        const d = de2000(labs[i], labs[j]);
        if (d < best.value) best = { value: d, kind, pair: [hexes[i], hexes[j]] };
      }
    }
  }
  return best;
}

export function luminance(hex) {
  const [r, g, b] = lin(parseHex(hex));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio of two hex colours. */
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Lightness L of a hex colour (CIE Lab). */
export const lightness = (hex) => lab(lin(parseHex(hex)))[0];

/** True when the colour is chromatic in the sense of audit_raster.py (channel spread of at least 30 of 255). */
export function isChromatic(hex) {
  const c = parseHex(hex).map((x) => x * 255);
  return Math.max(...c) - Math.min(...c) >= 30;
}

/** Hue of a hex colour in degrees (0 to 360) and its chroma (0 to 1). */
export function hueChroma(hex) {
  const [r, g, b] = parseHex(hex);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return { hue: 0, chroma: 0 };
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { hue: (h * 60 + 360) % 360, chroma: d };
}

/** The most readable of two text colours on a fill. */
export function bestText(fill, dark = '#0A0A0A', light = '#FFFFFF') {
  return contrast(fill, dark) >= contrast(fill, light) ? dark : light;
}
