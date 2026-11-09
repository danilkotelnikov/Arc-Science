/**
 * Browser half. Finds rendered ```mermaid code blocks of the chat, draws the diagram through the gated engine and puts a card
 * beside the block. The original block is hidden with a data attribute (React never touches unknown attributes), so a re-render
 * of the message cannot break. Styling uses only --dsw-alias-* tokens. No network, no eval, no innerHTML with user text.
 */
import { search, tableMeasure, toSvg } from './engine.mjs';
import { ROLE_VARS } from './scene.mjs';

export const SETTLE_MS = 700;
export const ERROR_NOTE_MS = 2500;
export const READABLE_SCALE = 0.8;
const STYLE_ID = 'arc-mermaid-style';
const BLOCK = '.md-code-block';

const CSS = `
.md-code-block[data-arc-mm="on"]{display:none!important}
.arc-mm{margin:8px 0;border:.5px solid var(--dsw-alias-border-l1,#0000000a);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-1,#fff);overflow:hidden;color:var(--dsw-alias-label-primary,#26231f);font:var(--dsw-font-xxs-12,400 12px/16px system-ui)}
.arc-mm-bar{display:flex;align-items:center;gap:8px;padding:5px 8px 5px 12px;background:var(--dsw-alias-markdown-code-block-banner,var(--dsw-alias-markdown-code-block,#faf9f6));color:var(--dsw-alias-label-tertiary,#75736c)}
.arc-mm-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.arc-mm-seg{display:inline-flex;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-interactive-bg-hover,#0000000a);padding:2px;gap:2px}
.arc-mm-btn{appearance:none;border:0;background:transparent;color:inherit;font:inherit;padding:2px 8px;border-radius:calc(var(--dsw-radius-sm,6px) - 2px);cursor:pointer}
.arc-mm-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000a);color:var(--dsw-alias-label-primary,#26231f)}
.arc-mm-btn:focus-visible{outline:1.5px solid var(--dsw-alias-label-secondary,#4b463f);outline-offset:1px}
.arc-mm-btn[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#26231f);box-shadow:0 0 0 .5px var(--dsw-alias-border-l1,#0000001a)}
.arc-mm-body{padding:12px;overflow:auto}
.arc-mm-body svg{display:block;margin:0 auto;height:auto;max-width:none}
.arc-mm-src{margin:0;padding:12px;overflow:auto;font:var(--dsw-font-markdown-code-block,400 12px/18px ui-monospace,monospace);color:var(--dsw-alias-label-primary,#26231f);background:var(--dsw-alias-markdown-code-block,transparent);white-space:pre}
.arc-mm-foot{display:flex;align-items:center;gap:8px;padding:5px 12px;border-top:.5px solid var(--dsw-alias-border-l1,#0000000a);color:var(--dsw-alias-label-tertiary,#75736c);font:var(--dsw-font-xxxs-11,400 11px/14px system-ui)}
.arc-mm-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--arc-mm-dot,currentColor)}
.arc-mm-gate{appearance:none;border:0;background:transparent;color:inherit;font:inherit;padding:0;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.arc-mm-gate:hover{color:var(--dsw-alias-label-primary,#26231f)}
.arc-mm-gate:focus-visible{outline:1.5px solid var(--dsw-alias-label-secondary,#4b463f);outline-offset:2px;border-radius:3px}
.arc-mm-spacer{flex:1}
.arc-mm-marks{margin:0;padding:6px 12px 10px;border-top:.5px solid var(--dsw-alias-border-l1,#0000000a);display:grid;grid-template-columns:max-content max-content 1fr;gap:2px 14px;font:var(--dsw-font-xxxs-11,400 11px/14px system-ui);color:var(--dsw-alias-label-secondary,#4b463f);font-variant-numeric:tabular-nums}
.arc-mm-marks span:nth-child(3n+1){color:var(--dsw-alias-label-primary,#26231f)}
.arc-mm-note{margin:4px 0 8px;color:var(--dsw-alias-label-tertiary,#75736c);font:var(--dsw-font-xxxs-11,400 11px/14px system-ui)}
.arc-mm [hidden]{display:none!important}
`;

const DOT = { pass: '--dsw-alias-state-success-primary', warn: '--dsw-alias-state-warn-primary', fail: '--dsw-alias-state-error-primary' };

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids) if (kid) e.append(kid);
  return e;
}

function cssToHex(value) {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const g = c.getContext('2d');
  g.fillStyle = '#000000';
  g.fillStyle = value;
  const s = String(g.fillStyle);
  if (s[0] === '#') return s.toUpperCase();
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (!m) return null;
  const [r, gg, b, a = 1] = m[1].split(',').map((x) => parseFloat(x));
  const mix = (v) => Math.round(v * a + 255 * (1 - a));
  return '#' + [mix(r), mix(gg), mix(b)].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Colours of the theme as the chat sees them. The app defines --dsw-alias-* on body and switches dark mode with body[data-ds-dark-theme], so read from body, not from html. */
export function resolveLive(root = document.body) {
  const cs = getComputedStyle(root);
  const out = {};
  for (const [role, [v, fb]] of Object.entries(ROLE_VARS)) {
    const raw = cs.getPropertyValue(v).trim() || fb;
    out[role] = cssToHex(raw) || cssToHex(fb);
  }
  return out;
}

function fontStack() {
  return getComputedStyle(document.body).getPropertyValue('--dsw-font-family').trim() || 'Geist, ui-sans-serif, system-ui, sans-serif';
}

function makeMeasure(skew = 1) {
  const c = document.createElement('canvas').getContext('2d');
  const stack = fontStack();
  const cache = new Map();
  const fn = (text, px, bold) => {
    const key = `${px}|${bold ? 1 : 0}|${text}`;
    let w = cache.get(key);
    if (w === undefined) {
      c.font = `${bold ? 600 : 500} ${px}px ${stack}`;
      w = Math.ceil((c.measureText(text).width * 1.02 * skew) * 2) / 2;
      cache.set(key, w);
    }
    return w;
  };
  fn.id = 'canvas:' + stack.split(',')[0].replace(/["']/g, '').trim();
  return fn;
}

/**
 * How much wider the drawn text is than the layout assumed. The layout measures text with a canvas; the card draws it as SVG
 * text. If the font was not ready, or the two disagree, text overflows its shapes. The ratio of the real width (getBBox) to the
 * measured width, over all text of the card, tells the manager to lay out again with the measure scaled up.
 */
function fitRatio(host, measure) {
  let worst = 0;
  for (const t of host.querySelectorAll('svg text')) {
    const size = parseFloat(t.getAttribute('font-size')), bold = Number(t.getAttribute('font-weight')) >= 600;
    const lines = [...t.querySelectorAll('tspan')].map((s) => s.textContent);
    const expected = Math.max(0, ...lines.map((l) => measure(l, size, bold)));
    if (expected < 16) continue;
    const actual = t.getBBox().width;
    if (actual > 0) worst = Math.max(worst, actual / expected);
  }
  return worst;
}

// The chat has two block headers. One shows the language word. The other (with a toolbar) shows the word only for languages
// it knows and the generic word "Code" otherwise, so a mermaid block carries no "mermaid" text there. A block is therefore
// taken for Mermaid when its label says so, or when its first line is a Mermaid header, unless the label names a language
// that shares those words (Graphviz).
function langOf(block) {
  const info = block.querySelector('[data-code-block-banner] > :first-child');
  const head = block.firstElementChild;
  const label = (info ? info.textContent : head ? head.textContent : '').trim().toLowerCase();
  return label.split(/\s+/)[0] || '';
}
const OTHER_LANGS = /^(dot|graphviz|gv|plantuml|d2|python|javascript|typescript|js|ts|json|yaml|bash|sh|powershell|sql|c|cpp|java|go|rust|html|css)$/;

function sourceOf(block) {
  const pre = block.querySelector('[data-code-block-content] pre') || block.querySelector('pre');
  return pre ? pre.textContent.replace(/\n$/, '') : '';
}

// The first line that is not blank, a comment or an init directive must be a Mermaid header of a type we draw.
function looksLikeMermaid(src) {
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('%%')) continue;
    return /^(?:(?:graph|flowchart)(?:\s+(?:TB|TD|BT|LR|RL))?|sequenceDiagram|stateDiagram(?:-v2)?)\s*;?$/.test(t);
  }
  return false;
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function createManager(opts = {}) {
  const states = new WeakMap();
  const hosts = new Set();
  let observer = null, timer = null, themeTimer = null, disposed = false, measure = null, mqList = null;
  const hostsLive = () => hosts;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = el('style', { id: STYLE_ID });
    s.textContent = CSS;
    document.head.append(s);
  }

  function cleanupOrphans() {
    for (const h of [...hosts]) {
      if (h._block && h._block.isConnected && h.isConnected) continue;
      h.remove();
      hosts.delete(h);
      if (h._block) states.delete(h._block);
    }
  }
  async function ready() {
    if (!measure) {
      // A web font loads only when something asks for it; ask for the weights the card uses, then wait.
      try {
        const stack = fontStack();
        await Promise.race([
          Promise.all([400, 500, 600].map((w) => (document.fonts ? document.fonts.load(`${w} 13px ${stack}`) : null))).then(() => document.fonts && document.fonts.ready),
          new Promise((r) => setTimeout(r, 2500)),
        ]);
      } catch { /* fonts API missing */ }
      measure = makeMeasure(opts.measureSkew || 1);
    }
    return measure;
  }

  async function draw(block, st, src, attempt = 0) {
    const base = await ready();
    const m = st.scale ? Object.assign((t, px, b) => base(t, px, b) * st.scale, { id: `${base.id}*${st.scale}` }) : base;
    const live = resolveLive(block.parentElement || document.body);
    const it = search(src, { measure: m, measureId: m.id, live, fontPx: opts.fontPx || 13, allowRotate: opts.allowRotate });
    let r;
    for (;;) {
      const s = it.next();
      if (s.done) { r = s.value; break; }
      await new Promise((res) => setTimeout(res, 0));
      if (disposed || st.src !== src || !block.isConnected) return;
    }
    if (disposed || st.src !== src || !block.isConnected) return;
    // A parse error may only mean that the message is still being typed: show the note after a longer wait.
    if (!r.ok && r.reason === 'parse') {
      await new Promise((res) => setTimeout(res, opts.errorDelayMs ?? ERROR_NOTE_MS));
      if (disposed || st.src !== src || !block.isConnected) return;
    }
    mount(block, st, src, r, live);
    if (!r.ok || !st.host) return;
    // The card is invisible until it has been looked at. Two checks on the real render, with the real font:
    //   1. the drawn text against the measured text; if it is wider, the layout runs again with a scaled measure;
    //   2. the audit (text on text, a line over text, text outside its shape); on a finding the measure grows by 7 percent.
    // At most three redraws. Whatever remains is shown in the card and in the report.
    let issues = [];
    if (!opts.noFit) {
      const k = fitRatio(st.host, base);
      if (attempt < 3 && k * 1.02 > (st.scale || 1) + 0.01) {
        st.scale = Math.min(1.7, Math.round(k * 1.02 * 1000) / 1000);
        return draw(block, st, src, attempt + 1);
      }
      issues = auditSvg(st.host.querySelector('svg'));
      if (issues.length && attempt < 3) {
        st.scale = Math.min(1.7, Math.round((st.scale || 1) * 1.07 * 1000) / 1000);
        return draw(block, st, src, attempt + 1);
      }
    }
    st.host.dataset.audit = String(issues.length);
    const panel = st.host.querySelector('.arc-mm-marks');
    if (panel) {
      panel.append(el('span', { text: 'render check' }), el('span', { text: `${issues.length} finding${issues.length === 1 ? '' : 's'}` }), el('span', { text: issues.length ? issues.slice(0, 3).map((x) => `${x.kind}: ${x.text}`).join('; ') : 'ok' }));
    }
    st.host.style.visibility = '';
    st.issues = issues;
    if (opts.report !== false && st.reported !== `${r.report.hash}:${st.scale || 1}`) {
      st.reported = `${r.report.hash}:${st.scale || 1}`;
      sendReport(block, st, src, r, issues, live).catch(() => {});
    }
  }

  // ---- report to the host: what the real app drew, as data and as a picture (the font of the page embedded)
  function fontCss(stack) {
    const primary = stack.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    const out = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules || []) {
        if (rule.type !== 5) continue;
        const fam = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim().toLowerCase();
        if (fam === primary && /url\(\s*["']?data:/.test(rule.cssText)) out.push(rule.cssText);
      }
    }
    return out.join('\n');
  }

  async function rasterise(svgText, width, height, scale) {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    try {
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('image failed')); img.src = url; });
      const c = el('canvas', { width: String(Math.round(width * scale)), height: String(Math.round(height * scale)) });
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    } finally { URL.revokeObjectURL(url); }
  }

  async function sendReport(block, st, src, r, issues, live) {
    const stack = fontStack();
    const css = fontCss(stack);
    let svgText = toSvg(r.scene, { theme: live, background: 'bg', ariaLabel: 'diagram', fontFamily: stack });
    if (css) svgText = svgText.replace(/^(<svg[^>]*>)/, `$1<defs><style>${css}</style></defs>`);
    let png = null;
    try { png = await rasterise(svgText, r.layout.width, r.layout.height, 2); } catch { /* the picture is optional */ }
    const text = st.host && st.host.querySelector('svg text');
    const rep = r.report;
    const report = {
      plugin: 'arc-mermaid', version: VERSION, hash: rep.hash, kind: r.kind, level: rep.level, hard: rep.hard, warn: rep.warn,
      marks: Object.fromEntries(Object.entries(rep.marks).map(([k, v]) => [k, v.value])),
      params: rep.params, size: rep.size, stats: rep.stats, candidates: rep.candidates,
      measure: rep.measure, fitScale: st.scale || 1, audit: issues,
      fonts: { stack, drawnWith: text ? getComputedStyle(text).fontFamily : null, loaded: document.fonts ? document.fonts.check(`500 13px ${stack}`) : null, embeddedInPicture: !!css },
      theme: live, cardWidth: st.host ? Math.round(st.host.getBoundingClientRect().width) : null,
      source: src.slice(0, 4000),
    };
    await fetch('api/arc-mermaid/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ report, png }) });
  }
  function note(block, st, text) {
    if (st.host) { st.host.remove(); hosts.delete(st.host); st.host = null; }
    block.removeAttribute('data-arc-mm');
    if (!st.note) {
      st.note = el('div', { class: 'arc-mm-note', 'data-arc-mm-note': '' });
      block.after(st.note);
    }
    st.note.textContent = text;
  }

  function mount(block, st, src, r, live) {
    if (st.note) { st.note.remove(); st.note = null; }
    if (!r.ok) {
      if (r.reason === 'parse') note(block, st, `Mermaid diagram not drawn: line ${r.line}, ${r.message}.`);
      else if (r.reason === 'unsupported') note(block, st, `Mermaid type "${r.kind}" is not drawn by the built-in renderer (flowchart, state and sequence diagrams are).`);
      else if (r.reason === 'too-large') note(block, st, `Mermaid diagram not drawn: ${r.nodes} nodes is above the limit.`);
      return;
    }
    const view = st.view || 'diagram';
    const rep = r.report;
    const title = el('span', { class: 'arc-mm-title', text: `mermaid, ${r.kind} diagram` });
    const mk = (label, name) => el('button', { type: 'button', class: 'arc-mm-btn', 'aria-pressed': String(view === name), 'data-view': name, text: label, onclick: () => setView(name) });
    const seg = el('span', { class: 'arc-mm-seg', role: 'group', 'aria-label': 'View' }, mk('Diagram', 'diagram'), mk('Source', 'source'));
    const copy = el('button', { type: 'button', class: 'arc-mm-btn', text: 'Copy', title: 'Copy the Mermaid source', onclick: async (ev) => { try { await navigator.clipboard.writeText(src); ev.target.textContent = 'Copied'; setTimeout(() => { ev.target.textContent = 'Copy'; }, 1000); } catch { /* clipboard blocked */ } } });
    const exportSvg = () => toSvg(r.scene, { theme: resolveLive(host), background: 'bg', ariaLabel: `${r.kind} diagram` });
    const svgBtn = el('button', { type: 'button', class: 'arc-mm-btn', text: 'SVG', title: 'Save as SVG', onclick: () => download('diagram.svg', new Blob([exportSvg()], { type: 'image/svg+xml' })) });
    const pngBtn = el('button', { type: 'button', class: 'arc-mm-btn', text: 'PNG', title: 'Save as PNG', onclick: () => savePng(r, exportSvg()) });
    const bar = el('div', { class: 'arc-mm-bar' }, title, seg, copy, svgBtn, pngBtn);

    const svgDoc = new DOMParser().parseFromString(r.svg, 'image/svg+xml').documentElement;
    const svgNode = document.importNode(svgDoc, true);
    svgNode.removeAttribute('height');
    svgNode.setAttribute('width', String(rep.size.width));
    // Fit the card, but never shrink below 80 percent of the drawn size: a wider diagram scrolls inside the card
    // instead of turning its text unreadable.
    svgNode.style.width = `max(min(100%, ${rep.size.width}px), ${Math.round(rep.size.width * READABLE_SCALE)}px)`;
    const bodyDiagram = el('div', { class: 'arc-mm-body' }, svgNode);
    const bodySource = el('pre', { class: 'arc-mm-src' });
    bodySource.textContent = src;
    bodySource.hidden = view !== 'source';
    bodyDiagram.hidden = view !== 'diagram';

    const dot = el('span', { class: 'arc-mm-dot', 'aria-hidden': 'true' });
    dot.style.setProperty('--arc-mm-dot', `var(${DOT[rep.level]},currentColor)`);
    const failed = [...rep.hard, ...rep.warn];
    const summary = rep.level === 'pass' ? 'pass' : `${rep.level}: ${failed.join(', ')}`;
    const marksPanel = el('div', { class: 'arc-mm-marks', hidden: true, role: 'region', 'aria-label': 'Molecullage gate marks' });
    for (const [k, v] of Object.entries(rep.marks)) {
      if (v.value === null || v.value === undefined) continue;
      marksPanel.append(el('span', { text: k }), el('span', { text: `${v.value}${v.limit !== undefined ? ` / ${v.op === '>=' ? '≥' : '≤'} ${v.limit}` : ''}`.replace('/ ≤ ', '/ ≤ ') }), el('span', { text: v.status === 'ok' ? 'ok' : v.reason || v.status }));
    }
    const gateBtn = el('button', { type: 'button', class: 'arc-mm-gate', 'aria-expanded': 'false', title: 'Show the Molecullage gate marks', onclick: () => { marksPanel.hidden = !marksPanel.hidden; gateBtn.setAttribute('aria-expanded', String(!marksPanel.hidden)); } }, dot, el('span', { text: `Molecullage gate: ${summary}` }));
    const p = rep.params;
    const foot = el('div', { class: 'arc-mm-foot' }, gateBtn, el('span', { class: 'arc-mm-spacer' }),
      el('span', { text: `${rep.stats.nodes} nodes, ${rep.stats.edges} edges, ${p.dir === 'TB' ? 'top down' : p.dir === 'LR' ? 'left to right' : p.dir}, layout ${rep.candidates.chosen} of ${rep.candidates.tried}, ${rep.hash}` }));

    const host = el('div', { class: 'arc-mm', 'data-arc-mm-host': '', 'data-gate': rep.level, 'data-hash': rep.hash, 'data-fit-scale': String(st.scale || 1), 'data-measure': String(rep.measure) }, bar, bodyDiagram, bodySource, foot, marksPanel);
    host._block = block;
    // The first card stays invisible until its text has been checked against the real font (see draw), so a layout that
    // has to be redone is never seen.
    if (!opts.noFit) host.style.visibility = 'hidden';
    function setView(name) {
      st.view = name;
      bodyDiagram.hidden = name !== 'diagram';
      bodySource.hidden = name !== 'source';
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.view === name));
    }
    if (st.host) { st.host.remove(); hosts.delete(st.host); }
    st.host = host;
    st.report = rep;
    hosts.add(host);
    block.after(host);
    block.setAttribute('data-arc-mm', 'on');
    if (opts.onRendered) opts.onRendered(block, rep);
  }

  async function savePng(r, svgText) {
    const w = Math.round(r.layout.width * 2), h = Math.round(r.layout.height * 2);
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = el('canvas', { width: String(w), height: String(h) });
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    c.toBlob((b) => b && download('diagram.png', b), 'image/png');
  }

  function consider(block) {
    const lang = langOf(block);
    const src = sourceOf(block);
    const explicit = lang === 'mermaid';
    if (!explicit && (OTHER_LANGS.test(lang) || !looksLikeMermaid(src))) return;
    let st = states.get(block);
    if (!st) { st = { src: null, host: null, note: null, view: 'diagram', pending: null }; states.set(block, st); }
    if (st.src === src && (st.host || st.note)) return;
    if (st.pending === src || st.drawing === src) return;
    st.pending = src;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      if (disposed || !block.isConnected) return;
      const now = sourceOf(block);
      if (now !== src) { st.pending = null; scheduleScan(0); return; }
      st.pending = null;
      st.src = src;
      st.drawing = src; // one drawing of a block at a time: a second would race the fit check
      draw(block, st, src).catch((e) => { if (opts.onError) opts.onError(e); }).finally(() => { if (st.drawing === src) st.drawing = null; });
    }, opts.settleMs ?? SETTLE_MS);
  }

  function scan() {
    timer = null;
    if (disposed) return;
    cleanupOrphans();
    for (const block of document.querySelectorAll(BLOCK)) consider(block);
  }
  function scheduleScan(ms = 200) {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(scan, ms);
  }
  function redrawAll() {
    for (const h of [...hosts]) {
      const block = h._block;
      const st = states.get(block);
      if (st && st.src) { st.pending = null; const s = st.src; st.src = null; consider(block); void s; }
    }
  }

  function start() {
    injectStyle();
    document.documentElement.setAttribute('data-arc-mermaid', 'active'); // a marker for checking that the plugin loaded
    observer = new MutationObserver(() => scheduleScan());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    // The theme lives on body (tokens, data-ds-dark-theme) and on html (class, style). Redraw only when the resolved colours changed.
    let sig = JSON.stringify(resolveLive(document.body));
    const onTheme = () => {
      clearTimeout(themeTimer);
      themeTimer = setTimeout(() => {
        const now = JSON.stringify(resolveLive(document.body));
        if (now === sig) return;
        sig = now;
        measure = null;
        redrawAll();
      }, 300);
    };
    const themeObserver = new MutationObserver(onTheme);
    themeObserver.observe(document.documentElement, { attributes: true });
    themeObserver.observe(document.body, { attributes: true });
    mqList = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const onMq = onTheme;
    if (mqList && mqList.addEventListener) mqList.addEventListener('change', onMq);    scheduleScan(0);
    return () => {
      disposed = true;
      clearTimeout(timer); clearTimeout(themeTimer);
      observer.disconnect(); themeObserver.disconnect();
      if (mqList && mqList.removeEventListener) mqList.removeEventListener('change', onMq);
      for (const h of [...hosts]) { if (h._block) h._block.removeAttribute('data-arc-mm'); h.remove(); }
      hosts.clear();
      for (const n of document.querySelectorAll('[data-arc-mm-note]')) n.remove();
      const s = document.getElementById(STYLE_ID);
      if (s) s.remove();
      document.documentElement.removeAttribute('data-arc-mermaid');
    };
  }

  return { start, scan, hosts: hostsLive, redrawAll };
}

export { tableMeasure };









