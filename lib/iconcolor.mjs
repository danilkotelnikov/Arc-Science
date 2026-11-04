// Icons in the Arc Harness look use ink, warm grey and paper tones only (no blue, no purple).
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

// the old vendor's blue tokens in a stylesheet, written as rgb(r, g, b):
//   --dsw-static-blue-* and --dsw-static-deepseek-*: dark ones become ink or grey, light tints a light paper tone
//   --dsw-static-neutral-bluish-*: the cool grey ramp keeps its lightness and takes a warm tint (white stays white)
export function recolorBlueTokens(css) {
  const hexOf = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const warm = (l) => { // hsl(38, 9%, l) as hex
    const s = 0.09, q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const ch = (t) => { t = (t + 1) % 1; return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p); };
    return hexOf(ch(38 / 360 + 1 / 3), ch(38 / 360), ch(38 / 360 - 1 / 3));
  };
  return css.replace(/(--dsw-static-(blue|deepseek|neutral-bluish)-[\w-]+:\s*)rgb\((\d+),\s*(\d+),\s*(\d+)\)/g, (m, head, kind, r, g, b) => {
    const { l } = toHsl(hexOf(r, g, b));
    return head + (kind === 'neutral-bluish' ? warm(l) : l >= 0.9 ? '#ece9e2' : ink(hexOf(r, g, b)));
  });
}

// only blue and purple hues inside script text (red, green and amber carry meaning in status marks)
export function recolorBlueInScript(text) {
  return text.replace(HEX, (m) => { const x = toHsl(m); return x.s > 0.2 && x.h >= 180 && x.h <= 290 ? ink(m) : m; });
}

// Every blue and violet colour in script, style and page text, by hue: #rrggbb (also #rrggbbaa), rgb() and rgba() with commas or
// spaces, hsl() and hsla(), oklch() and lch(). Hue 190 to 300 (oklch and lch: 215 to 335) with saturation above 0.2 becomes ink, mid
// grey or a paper tone by lightness (alpha stays). Red, green, amber and teal carry meaning in status marks and stay.
// Used on text the owner sees, not on third-party libraries. A hex that sits after "&" (an HTML entity), after a word character
// (a URL fragment) or inside url(#id) is not a colour.
const BLUE_HUE = (x) => x.s > 0.2 && x.h >= 190 && x.h <= 300;
const alphaOf = (a) => (a === undefined ? '' : a);
export function recolorBlueHues(text) {
  let out = text.replace(/(?<![\w&])(?<!url\()#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?(?![0-9a-zA-Z])/g, (m, rgb, a) => (BLUE_HUE(toHsl('#' + rgb)) ? ink('#' + rgb) + (a || '') : m));
  const grey = (hex) => { const c = ink(hex); return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; };
  // rgb( r, g, b [, alpha] ), the alpha may be a number, a percentage or an expression such as ${Math.min(1, a + .26)} (one level of brackets)
  out = out.replace(/\brgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*((?:[^()]|\([^()]*\))*?)\s*)?\)/gi, (m, r, g, b, a) => {
    if (+r > 255 || +g > 255 || +b > 255) return m;
    const hex = '#' + [r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
    if (!BLUE_HUE(toHsl(hex))) return m;
    const [rr, gg, bb] = grey(hex);
    return a === undefined ? `rgb(${rr}, ${gg}, ${bb})` : `rgba(${rr}, ${gg}, ${bb}, ${a})`;
  });
  // rgb( r g b [ / alpha ] )
  out = out.replace(/\brgba?\(\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*(?:\/\s*([^()]*?)\s*)?\)/gi, (m, r, g, b, a) => {
    if (+r > 255 || +g > 255 || +b > 255) return m;
    const hex = '#' + [r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
    if (!BLUE_HUE(toHsl(hex))) return m;
    const [rr, gg, bb] = grey(hex);
    return `rgb(${rr} ${gg} ${bb}${a === undefined ? '' : ' / ' + a})`;
  });
  // hsl( h, s%, l% [, alpha] ) and hsl( h s% l% [ / alpha ] ): the hue and the saturation become a warm grey, lightness and alpha stay
  out = out.replace(/\bhsla?\(\s*(-?[\d.]+)(?:deg)?\s*([, ])\s*([\d.]+)%\s*[, ]\s*([\d.]+%)(\s*[,/]\s*[^()]*?)?\s*\)/gi, (m, h, sep, s, l, a) => {
    const hue = ((+h % 360) + 360) % 360;
    if (!(+s / 100 > 0.2 && hue >= 190 && hue <= 300)) return m;
    return `hsl(38${sep === ',' ? ', 7%, ' : ' 7% '}${l}${alphaOf(a)})`;
  });
  // oklch( L% C H [ / alpha ] ) and lch( L% C H ): blue and violet hues (215 to 335) with some chroma become a warm grey of the same lightness
  out = out.replace(/\b(ok)?lch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?(\s*\/\s*[^()]*?)?\s*\)/gi, (m, ok, l, c, h, a) => {
    const chroma = parseFloat(c) / (c.endsWith('%') ? 100 : 1) * (ok ? 1 : 1 / 150);
    if (!(chroma >= 0.035 && +h >= 215 && +h <= 335)) return m;
    return ok ? `oklch(${l} .012 80${alphaOf(a)})` : `lch(${l} 2 80${alphaOf(a)})`;
  });
  return out;
}

// Where the hue recolor runs. Everything else with blue in it is third-party code or a palette that must keep its colours:
// the DevTools frontend, the terminal (ANSI blue), vendor bundles, diagram, chart, editor and icon libraries, the Visualize
// chart palettes and the third-party remote plugin. test/image-scan.py names the same places in its allow list, with reasons.
export const HUE_ARCHIVE = /dsh-web-frontend\/dist\/assets\/index-[^/]*\.(?:css|js)$|dsh-agent-preset\/|dsh-client-ui-(?:conversation|layout|theme)\/|pi-ai\/dist\/utils\/oauth-page\.js$/;
export const HUE_PROFILE = /[\\/](?:dsh-reasoning-effort|dsh-archive-manager|dsh-skills-manager|dsh-chat-import|dsh-context|dsh-vision-router|dsh-client-auto-continue)[\\/]|[\\/]dsh-better-sidebar[\\/](?!lib[\\/]client-(?:terminal|editor|mermaid)\.)|[\\/]superpowers-dsh[\\/].*[\\/]frame-template\.html$/;

// the vendor's brand blue as a literal (CSS fallbacks such as var(--dsw-alias-brand-primary,#4d6bfe), outlines, link colours):
// it becomes the Arc Harness primary, the dark brown the skin already sets for that token
export const VENDOR_BLUE = /#4d6bfe/gi;
export const ARC_PRIMARY = '#54453c';
export const replaceVendorBlue = (text) => text.replace(VENDOR_BLUE, ARC_PRIMARY);

// fill, stroke and gradient stop colours written in script text, and rgb() colours inside gradients: blue and purple only
export function recolorBlueAttrsInScript(text) {
  // both forms: an object key (fill: "#4A5699") and an attribute inside markup text (fill="#4A5699", also with escaped quotes);
  // gradient stops are written stopColor (React) or stop-color (markup)
  const out = text.replace(/\b(fill|stroke|stopColor|stop-color)(\s*[:=]\s*)(\\?")(#[0-9a-fA-F]{3,6})(\\?")/g, (m, a, b, q1, c, q2) => {
    const x = toHsl(c);
    return x.s > 0.2 && x.h >= 180 && x.h <= 290 ? `${a}${b}${q1}${ink(c)}${q2}` : m;
  });
  // the Search artwork paints its ring with conic-gradient(... rgb(101, 142, 255) ...): strong blues in rgb() inside a gradient call
  return out.replace(/((?:conic|linear|radial)-gradient\([^"'`]*)/g, (m) => m.replace(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g, (rgb, r, g, b) => {
    const hex = '#' + [r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
    const x = toHsl(hex);
    return x.s > 0.35 && x.h >= 190 && x.h <= 290 ? ink(hex) : rgb;
  }));
}
