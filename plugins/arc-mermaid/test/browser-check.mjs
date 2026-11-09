/**
 * Browser check. Builds a page that holds the Arc Theme tokens (light or dark) and a DOM copy of the chat code block for every
 * fixture, loads the real lib/client.js through a stub of window.__ModuleLoader__, lets the manager draw them, and prints the gate
 * marks. Headless Edge or Chrome runs the page with --dump-dom; the page writes JSON into <pre id="result">.
 *
 *   node test/browser-check.mjs [--theme light|dark] [--png]   (--png also exports each diagram as out/<name>.png on white paper)
 *
 * Exit code 0 only when the page raised no error, every diagram fixture was drawn without a hard gate failure, every negative
 * fixture left its original block visible with a note, and each card meets the UI checks (no blue, no overflow, tokens only).
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);
const theme = args.includes('--theme') ? args[args.indexOf('--theme') + 1] : 'light';
const wantPng = args.includes('--png');
// --skew 0.8 makes the plugin under-measure text by 20 percent, as if the font had not been ready; the fit check must repair it.
const skew = args.includes('--skew') ? Number(args[args.indexOf('--skew') + 1]) : 1;
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
if (!EDGE) { console.error('No Edge or Chrome found'); process.exit(2); }

const TOKEN_SETS = {
  light: { 'bg-base': '#faf9f6', 'bg-layer-1': '#ffffff', 'label-primary': '#26231f', 'label-secondary': '#4b463f', 'label-tertiary': '#75736c', 'border-l1': '#0000000a', 'markdown-code-block': '#faf9f6', 'markdown-code-block-banner': '#f4f2ed', 'interactive-bg-hover': '#0000000d', 'state-success-primary': '#01b151', 'state-warn-primary': '#9a5600', 'state-error-primary': '#ac3f3f' },
  dark: { 'bg-base': '#171614', 'bg-layer-1': '#1f1e1b', 'label-primary': '#faf9f6', 'label-secondary': '#c9c5ba', 'label-tertiary': '#a9a59b', 'border-l1': '#ffffff0f', 'markdown-code-block': '#1b1a18', 'markdown-code-block-banner': '#272522', 'interactive-bg-hover': '#ffffff12', 'state-success-primary': '#01b151', 'state-error-primary': '#e16f6b', 'state-warn-primary': '#fbb153' },
};
const WANT_EDGE = { light: '#4B463F', dark: '#C9C5BA' };
const tokenCss = (set) => Object.entries(set).map(([k, v]) => `--dsw-alias-${k}:${v}`).join(";");
// The app defines the tokens on body and switches dark mode with body[data-ds-dark-theme]; the test copies that.
const rootCss = `body{${tokenCss(TOKEN_SETS.light)};--dsw-radius-lg:10px;--dsw-radius-sm:6px;--dsw-font-family:"Segoe UI",system-ui,sans-serif;--dsw-font-xxs-12:400 12px/16px "Segoe UI",system-ui;--dsw-font-xxxs-11:400 11px/14px "Segoe UI",system-ui;--dsw-font-markdown-code-block:400 12px/18px Consolas,monospace}body[data-ds-dark-theme]{${tokenCss(TOKEN_SETS.dark)}}`;

const fixtures = readdirSync(join(here, 'fixtures')).filter((f) => f.endsWith('.mmd')).sort().map((f) => ({ name: basename(f, '.mmd'), source: readFileSync(join(here, 'fixtures', f), 'utf8') }));
const negative = new Set(['unsupported-pie', 'malformed']);
// Drawings that cannot meet the type floor: expected gate level fail, and they must scroll inside the card at a readable size.
const wide = new Set(['wide-lr']);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// The chat has two block headers (read from the shell bundle): a banner that shows the language word, and a toolbar header that
// shows the word only for languages it knows and the generic word "Code" otherwise. The fixtures alternate between the two.
const bannerHead = '<div><div data-code-block-banner="true"><div>mermaid</div><div><button type="button">Copy</button></div></div></div>';
const toolbarHead = '<div><div class="header" data-code-block-banner="true"><div class="heading"><span class="language">Code</span></div><div class="actions"><button type="button" aria-label="Wrap"></button><button type="button" aria-label="Copy"></button></div></div></div>';
const mkBlock = (head, source) => `<div class="md-code-block">${head}<div data-code-block-content="true"><pre><code>${esc(source)}</code></pre></div></div>`;
// A block with an unsupported type has no Mermaid header we can recognise, so it is only found when the label says mermaid (banner header).
const useToolbar = (f, i) => i % 2 === 1 && f.name !== 'unsupported-pie';
const blocks = fixtures.map((f, i) => `<section data-fixture="${f.name}" data-head="${useToolbar(f, i) ? 'toolbar' : 'banner'}">${mkBlock(useToolbar(f, i) ? toolbarHead : bannerHead, f.source)}</section>`).join('\n')
  + `\n<section data-extra="dot">${mkBlock(toolbarHead, 'graph G {\n  a -- b;\n}')}</section>`
  + `\n<section data-extra="js">${mkBlock(bannerHead.replace('mermaid', 'javascript'), 'flowchart\n')}</section>`;
const client = readFileSync(join(root, 'lib', 'client.js'), 'utf8');

const page = `<!doctype html><meta charset="utf-8"><title>arc-mermaid browser check</title>
<style>${rootCss} body{margin:0;padding:20px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:14px "Segoe UI",system-ui;width:760px} section{margin:0 0 16px}
.md-code-block{border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-markdown-code-block);overflow:hidden}</style>
<body class="chat"${theme === "dark" ? " data-ds-dark-theme" : ""}>${blocks}
<pre id="result"></pre>
<script>
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + String(e.reason && e.reason.stack || e.reason)));
window.__ModuleLoader__ = { load(def) { window.__mod = def; } };
// stand-in for the host route: collect every report the cards send
window.__reports = [];
const realFetch = window.fetch.bind(window);
window.fetch = (u, o) => { if (String(u).includes('api/arc-mermaid/report')) { window.__reports.push(JSON.parse(o.body)); return Promise.resolve(new Response('{"ok":true}')); } return realFetch(u, o); };
</script>
<script>${client.replace(/<\/script>/g, '<\\/script>')}</script>
<script>
(async () => {
  const mod = window.__mod.factory(() => null);
  const results = {};
  const manager = mod.api.createManager({ settleMs: 30, errorDelayMs: 400, measureSkew: ${skew}, onError: (e) => window.__errors.push('draw: ' + (e && e.stack || e)) });
  const stop = manager.start();
  const deadline = Date.now() + 15000;
  const want = ${JSON.stringify(fixtures.filter((f) => !negative.has(f.name)).map((f) => f.name))};
  await new Promise((resolve) => { const t = setInterval(() => { const n = [...document.querySelectorAll('[data-arc-mm-host]')].filter((h) => h.style.visibility !== 'hidden').length + document.querySelectorAll('[data-arc-mm-note]').length; if (n >= ${fixtures.length} || Date.now() > deadline) { clearInterval(t); resolve(); } }, 50); });
  await new Promise((r) => setTimeout(r, 100));
  const bad = [];
  for (const sec of document.querySelectorAll('section[data-fixture]')) {
    const name = sec.dataset.fixture;
    const block = sec.querySelector('.md-code-block');
    const host = sec.querySelector('[data-arc-mm-host]');
    const note = sec.querySelector('[data-arc-mm-note]');
    const r = { name, drawn: !!host, note: note ? note.textContent : null, blockHidden: getComputedStyle(block).display === 'none' };
    if (host) {
      r.level = host.dataset.gate; r.hash = host.dataset.hash;
      const svg = host.querySelector('svg');
      const hb = host.getBoundingClientRect(), sb = svg.getBoundingClientRect();
      r.hostWidth = Math.round(hb.width); r.svgWidth = Math.round(sb.width); r.svgHeight = Math.round(sb.height);
      const bodyEl = host.querySelector('.arc-mm-body');
      r.overflowX = host.scrollWidth > host.clientWidth + 1;
      r.bodyScrolls = bodyEl.scrollWidth > bodyEl.clientWidth + 1;
      r.natural = +svg.getAttribute('width');
      r.marks = [...host.querySelectorAll('.arc-mm-marks span')].map((s) => s.textContent);
      r.foot = host.querySelector('.arc-mm-foot').textContent;
      // text really inside its shape: compare text boxes with their node rect
      const rects = [...svg.querySelectorAll('rect,polygon,ellipse,path')];
      r.svgTextBoxes = [...svg.querySelectorAll('text')].map((t) => { const b = t.getBBox(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }).length;
      r.scriptTags = host.querySelectorAll('script,foreignObject').length;
      r.styleColours = [...new Set([...svg.querySelectorAll('[fill],[stroke]')].flatMap((e) => [e.getAttribute('fill'), e.getAttribute('stroke')]).filter((c) => c && c[0] === '#'))];
      r.cssBlue = [...svg.querySelectorAll('*')].filter((e) => ['fill', 'stroke'].some((p) => { const m = /rgba?\\((\\d+), (\\d+), (\\d+)/.exec(getComputedStyle(e)[p]); return m && +m[3] > +m[1] + 40 && +m[3] > +m[2] + 20; })).length > 0;
      r.liveEdgeText = mod.api.resolveLive(document.body).edgeText;
      // live text overflow: real glyph width against the table layout
      let overflow = 0;
      for (const t of svg.querySelectorAll('text')) {
        const b = t.getBBox();
        const own = [...svg.querySelectorAll('rect,polygon,ellipse')].filter((s) => { const q = s.getBBox(); return b.x >= q.x - 1 && b.y >= q.y - 1 && b.x + b.width <= q.x + q.width + 1 && b.y + b.height <= q.y + q.height + 1; });
        const near = [...svg.querySelectorAll('rect,polygon,ellipse')].some((s) => { const q = s.getBBox(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2; return cx > q.x && cx < q.x + q.width && cy > q.y && cy < q.y + q.height; });
        if (near && own.length === 0) overflow++;
      }
      r.textOverflow = overflow;
      r.fitScale = +host.dataset.fitScale;
      r.audit = mod.api.auditSvg(svg).map((i) => i.kind + ': ' + i.text + ' (' + i.detail + ')');
    }
    r.head = sec.dataset.head;
    results[name] = r;
  }
  // blocks that must be left alone: Graphviz source under the generic "Code" header, and a block labelled javascript
  const extras = {};
  for (const sec of document.querySelectorAll('section[data-extra]')) {
    extras[sec.dataset.extra] = { drawn: !!sec.querySelector('[data-arc-mm-host]'), note: !!sec.querySelector('[data-arc-mm-note]'), visible: getComputedStyle(sec.querySelector('.md-code-block')).display !== 'none' };
  }
  results.__extras = extras;
  window.__marker = document.documentElement.getAttribute('data-arc-mermaid');
  // theme check on the first drawn host, view toggle, copy button presence
  const first = document.querySelector('[data-arc-mm-host]');
  const view = {};
  if (first) {
    const src = first.querySelector('.arc-mm-src');
    first.querySelector('[data-view="source"]').click();
    view.sourceShown = !src.hidden && first.querySelector('.arc-mm-body').hidden;
    first.querySelector('[data-view="diagram"]').click();
    view.diagramShown = src.hidden && !first.querySelector('.arc-mm-body').hidden;
    first.querySelector('.arc-mm-gate').click();
    view.marksShown = !first.querySelector('.arc-mm-marks').hidden;
    view.buttons = [...first.querySelectorAll('button')].map((b) => b.textContent);
  }
  window.__probes = async () => {
    const out = {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await wait(40); } return false; };
    const mk = (name, text) => { const sec = document.createElement('section'); sec.dataset.fixture = name; sec.innerHTML = '<div class="md-code-block"><div><div data-code-block-banner="true"><div>mermaid</div></div></div><div data-code-block-content="true"><pre><code></code></pre></div></div>'; sec.querySelector('code').textContent = text; document.body.insertBefore(sec, document.getElementById('result')); return sec; };
    // 1. React re-creates a block: the old card must go, exactly one new card must stand
    const sec = document.querySelector('section[data-fixture="state-hoh"]');
    const oldHost = sec.querySelector('[data-arc-mm-host]');
    const fresh = sec.querySelector('.md-code-block').cloneNode(true);
    fresh.removeAttribute('data-arc-mm');
    sec.querySelector('.md-code-block').replaceWith(fresh);
    await until(() => sec.querySelectorAll('[data-arc-mm-host]').length === 1 && sec.querySelector('[data-arc-mm-host]') !== oldHost);
    out.replace = { hosts: sec.querySelectorAll('[data-arc-mm-host]').length, oldGone: !oldHost.isConnected, hidden: getComputedStyle(fresh).display === 'none' };
    // 2. streaming: partial text is not drawn while it changes, the final text is
    const s = mk('stream', 'flowchart TD\\n A --> B\\n B -');
    const steps = ['flowchart TD\\n A --> B\\n B --', 'flowchart TD\\n A --> B\\n B --> C\\n C -', 'flowchart TD\\n A --> B\\n B --> C\\n C --> D'];
    const seen = [];
    for (const t of steps) { await wait(15); s.querySelector('code').textContent = t; seen.push(s.querySelectorAll('[data-arc-mm-host],[data-arc-mm-note]').length); }
    out.streamWhileTyping = seen;
    await until(() => s.querySelector('[data-arc-mm-host]'));
    out.streamFinal = !!s.querySelector('[data-arc-mm-host]') && s.querySelector('svg').textContent.includes('D');
    // 3. a broken block that stays broken gets its note, but only after the extra wait
    const b = mk('broken', 'flowchart TD\\n A --> B\\n B -?> C');
    await wait(150);
    out.noteTooEarly = !!b.querySelector('[data-arc-mm-note]');
    await until(() => b.querySelector('[data-arc-mm-note]'), 5000);
    out.noteLater = !!b.querySelector('[data-arc-mm-note]');
    out.brokenBlockVisible = getComputedStyle(b.querySelector('.md-code-block')).display !== 'none';
    // 4. theme switch: tokens change, the card is drawn again, colours follow, no hard failure
    const th = document.querySelector('section[data-fixture="prompt-flow"] [data-arc-mm-host]');
    const edgeBefore = getComputedStyle(th.querySelector('svg')).getPropertyValue('--mm-edge').trim();
    document.body.toggleAttribute('data-ds-dark-theme');
    await until(() => { const n = document.querySelector('section[data-fixture="prompt-flow"] [data-arc-mm-host]'); return n && n !== th; }, 8000);
    const th2 = document.querySelector('section[data-fixture="prompt-flow"] [data-arc-mm-host]');
    out.liveAfter = mod.api.resolveLive(document.body).edgeText;
    out.theme = { redrawn: th2 !== th, level: th2 && th2.dataset.gate, sameLayout: th2 && th2.dataset.hash === th.dataset.hash, edgeBefore, edgeAfter: getComputedStyle(th2.querySelector('svg')).getPropertyValue('--mm-edge').trim(), cardBg: getComputedStyle(th2).backgroundColor };
    // The audit must see what the eye sees. Three hand-made drawings: a line over text, two texts on each other, and a clean one
    // (a line, then a pill, then the text).
    const probeSvg = (inner) => { const h = document.createElement('div'); h.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 100" width="240" height="100" font-size="12">' + inner + '</svg>'; document.body.append(h); const issues = mod.api.auditSvg(h.firstChild).map((i) => i.kind); h.remove(); return issues; };
    out.auditProbe = {
      lineOver: probeSvg('<text x="20" y="50">Hello world there</text><polyline points="10,46 230,46" fill="none" stroke="#000"/>'),
      overlap: probeSvg('<text x="20" y="50">Hello world there</text><text x="30" y="53">Overlap me</text>'),
      clean: probeSvg('<polyline points="10,46 230,46" fill="none" stroke="#000"/><rect x="14" y="36" width="140" height="18" fill="#fff"/><text x="20" y="50">Hello world there</text>'),
      outside: probeSvg('<text x="200" y="50">Runs far outside</text>'),
    };
    out.errors = window.__errors;
    return out;
  };
  // disposal removes everything (called by the test after the screenshot)
  window.__dispose = () => { stop(); return { hosts: document.querySelectorAll('[data-arc-mm-host]').length, hidden: document.querySelectorAll('[data-arc-mm]').length, style: !!document.getElementById('arc-mermaid-style'), notes: document.querySelectorAll('[data-arc-mm-note]').length }; };
  document.getElementById('result').textContent = JSON.stringify({ results, view, errors: window.__errors, theme: ${JSON.stringify(theme)} });
})().catch((e) => { document.getElementById('result').textContent = JSON.stringify({ fatal: String(e && e.stack || e), errors: window.__errors }); });
</script>`;

const pagePath = join(outDir, `browser-check-${theme}.html`);
writeFileSync(pagePath, page);
const { launch } = await import('./cdp.mjs');
const br = await launch({ width: 840, height: 1000 });
let data;
try {
  await br.goto(pathToFileURL(pagePath).href);
  const done = await br.waitFor(`document.getElementById('result') && document.getElementById('result').textContent.length > 0`, 40000);
  if (!done) { console.error('No result from the page'); await br.close(); process.exit(1); }
  data = JSON.parse(await br.eval(`document.getElementById('result').textContent`));
  if (wantPng) {
    const h = await br.eval('document.documentElement.scrollHeight');
    writeFileSync(join(outDir, `browser-check-${theme}.png`), await br.screenshot({ x: 0, y: 0, width: 840, height: h }));
  }
  data.reports = await br.eval('JSON.stringify(window.__reports.map((r) => ({ report: r.report, png: r.png && r.png.length })))').then(JSON.parse);
  const lastPng = await br.eval('(window.__reports.slice(-1)[0] || {}).png || null');
  if (lastPng) writeFileSync(join(outDir, `report-${theme}.png`), Buffer.from(lastPng.split(',')[1], 'base64'));
  data.probes = await br.eval(`window.__probes()`);
  data.after = await br.eval('window.__dispose()');
} finally { await br.close(); }
if (data.fatal) { console.error('Page failed:', data.fatal, data.errors); process.exit(1); }

let failed = 0;
const fail = (msg) => { failed++; console.log('  FAIL ' + msg); };
console.log(`theme ${data.theme}`);
const extras = data.results.__extras; delete data.results.__extras;
for (const [k, v] of Object.entries(extras)) { console.log(`left alone ${k}: ${JSON.stringify(v)}`); if (v.drawn || v.note || !v.visible) fail(`${k} block must be left alone`); }
for (const [name, r] of Object.entries(data.results)) {
  if (negative.has(name)) {
    console.log(`${name}: ${r.drawn ? 'drawn' : 'not drawn'}, note: ${r.note}`);
    if (r.drawn) fail(`${name} must not be drawn`);
    if (r.blockHidden) fail(`${name} original block must stay visible`);
    if (!r.note) fail(`${name} needs a note`);
    continue;
  }
  console.log(`${name} [${r.head}]: gate ${r.level}, svg ${r.svgWidth}x${r.svgHeight} in card ${r.hostWidth}, ${r.foot}`);
  if (!r.drawn) { fail(`${name} was not drawn`); continue; }
  if (wide.has(name)) {
    if (r.level !== 'fail') fail(`${name} should fail the type floor`);
    if (!(r.svgWidth >= r.natural * 0.8 - 1)) fail(`${name} is shrunk below 80 percent: ${r.svgWidth} of ${r.natural}`);
    if (!r.bodyScrolls) fail(`${name} should scroll inside its card`);
  } else {
    if (r.level === 'fail') fail(`${name} has a hard gate failure`);
    if (r.bodyScrolls) fail(`${name} scrolls although it should fit`);
  }
  if (!r.blockHidden) fail(`${name} original block still visible`);
  if (r.overflowX) fail(`${name} card overflows horizontally`);
  if (r.audit.length) fail(`${name}: the render audit found ${r.audit.length}: ${r.audit.slice(0, 3).join(' | ')}`);
  const sent = data.reports.filter((x) => x.report.hash === r.hash);
  if (!sent.length) fail(`${name}: no report was sent to the host`);
  else if (!sent.some((x) => x.png > 1000)) fail(`${name}: the report has no picture`);
  if (skew === 1 && r.fitScale > 1.1) fail(`${name}: the fit check had to widen the layout by ${r.fitScale} although the measure was honest`);

  if (r.scriptTags) fail(`${name} holds script or foreignObject`);
  if (r.cssBlue) fail(`${name} draws a blue or purple colour`);
  if (r.liveEdgeText !== WANT_EDGE[theme]) fail(`${name}: the plugin reads the wrong theme tokens: edge text ${r.liveEdgeText}, expected ${WANT_EDGE[theme]}`);
  if (r.textOverflow) fail(`${name}: ${r.textOverflow} text blocks leave their shape with the real font`);
  const w = r.marks;
  if (w.length) { const rows = []; for (let i = 0; i < w.length; i += 3) rows.push(`${w[i]}=${w[i + 1]}${w[i + 2] === 'ok' ? '' : ' (' + w[i + 2] + ')'}`); console.log('   ' + rows.join('; ')); }
}
if (!(data.view.sourceShown && data.view.diagramShown && data.view.marksShown)) fail('view toggle or gate panel does not work: ' + JSON.stringify(data.view));
const P = data.probes;
console.log('probes: ' + JSON.stringify({ replace: P.replace, streamWhileTyping: P.streamWhileTyping, streamFinal: P.streamFinal, noteTooEarly: P.noteTooEarly, noteLater: P.noteLater, theme: P.theme }));
if (!(P.replace.hosts === 1 && P.replace.oldGone && P.replace.hidden)) fail('re-created block: ' + JSON.stringify(P.replace));
if (!P.streamWhileTyping.every((n) => n === 0) || !P.streamFinal) fail('streaming: ' + JSON.stringify([P.streamWhileTyping, P.streamFinal]));
if (P.liveAfter !== WANT_EDGE[theme === 'light' ? 'dark' : 'light']) fail('after the body attribute switch the plugin still reads ' + P.liveAfter);
if (P.noteTooEarly || !P.noteLater || !P.brokenBlockVisible) fail('broken block note timing: ' + JSON.stringify([P.noteTooEarly, P.noteLater, P.brokenBlockVisible]));
if (!(P.theme.redrawn && P.theme.level !== 'fail' && P.theme.edgeBefore !== '' && P.theme.edgeAfter !== '')) fail('theme switch: ' + JSON.stringify(P.theme));
const AP = data.probes.auditProbe;
console.log('audit probe: ' + JSON.stringify(AP));
if (!AP.lineOver.includes('line-over-text') || !AP.overlap.includes('text-overlap') || AP.clean.length || !AP.outside.includes('text-outside')) fail('the audit does not see what it must see: ' + JSON.stringify(AP));
if (data.probes.errors.length) fail('probe errors: ' + data.probes.errors.join(' | '));
if (data.after.hosts || data.after.hidden || data.after.style || data.after.notes) fail('dispose left traces: ' + JSON.stringify(data.after));
if (data.errors.length) fail('page errors: ' + data.errors.join(' | '));
if (skew < 1) {
  const widened = Object.values(data.results).filter((r) => r.drawn && r.fitScale > 1).length;
  console.log(`fit check widened ${widened} drawings for a measure that is ${skew} of the truth`);
  if (widened < 4) fail(`the fit check widened only ${widened} drawings`);
}
console.log(failed ? `${failed} failures` : 'browser check ok');
process.exit(failed ? 1 : 0);












