// Icons in the Arc Science look use ink, warm grey and paper tones only (no blue, no purple).
// Neutral colours stay. A saturated colour becomes ink, mid grey or a light paper tone by its lightness.
const HEX = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/g;

function toHsl(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let hue = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    hue = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue *= 60;
  }
  return { h: hue, s, l };
}

export const INK = '#26231f';
export const MID = '#75736c';
export const PAPER = '#d8d3c8';

export function ink(hex) {
  const { l } = toHsl(hex);
  return l < 0.4 ? INK : l < 0.62 ? MID : PAPER;
}

// every saturated colour of an SVG file
export function recolorSvg(text) {
  return text.replace(HEX, (m) => (toHsl(m).s > 0.15 ? ink(m) : m));
}

// only blue and purple hues inside script text (red, green and amber carry meaning in status marks)
export function recolorBlueInScript(text) {
  return text.replace(HEX, (m) => { const x = toHsl(m); return x.s > 0.2 && x.h >= 180 && x.h <= 290 ? ink(m) : m; });
}

// fill and stroke attributes written in script text: blue and purple only
export function recolorBlueAttrsInScript(text) {
  return text.replace(/\b(fill|stroke)(\s*:\s*)"(#[0-9a-fA-F]{3,6})"/g, (m, a, b, c) => {
    const x = toHsl(c);
    return x.s > 0.2 && x.h >= 180 && x.h <= 290 ? `${a}${b}"${ink(c)}"` : m;
  });
}
