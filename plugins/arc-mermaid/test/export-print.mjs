/**
 * Draws every diagram fixture with the print theme (white paper, ink) at 900 px width in a real browser and writes
 * test/out/print/<name>.png plus marks.json with the marks of our own raster. The PNGs go to Molecullage audit_figure (qa/audit_raster.py)
 * to compare its ink, cells, band and blank marks with ours.   node test/export-print.mjs
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { renderDiagram } from '../src/engine.mjs';
import { toSvg, PRINT_THEME } from '../src/scene.mjs';
import { rasterise, arrayMetrics } from '../src/gate.mjs';
import { launch } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out', 'print' + (process.argv[2] && process.argv[2] !== 'fixtures' ? '-' + process.argv[2] : ''));
mkdirSync(out, { recursive: true });
const dirName = process.argv[2] || 'fixtures';
const files = readdirSync(join(here, dirName)).filter((f) => f.endsWith('.mmd')).sort();
const marks = {};
const br = await launch({ width: 900, height: 900 });
try {
  for (const f of files) {
    const name = basename(f, '.mmd');
    const r = renderDiagram(readFileSync(join(here, dirName, f), 'utf8'));
    if (!r.ok) continue;
    const svg = toSvg(r.scene, { theme: PRINT_THEME, background: 'bg', ariaLabel: name, fontFamily: 'Arial, Helvetica, sans-serif' });
    const h = Math.ceil((r.scene.height * 900) / r.scene.width);
    const page = join(out, `${name}.html`);
    writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}svg{display:block;width:900px;height:${h}px}</style>${svg.replace(/ width="[\d.]+" height="[\d.]+"/, ' preserveAspectRatio="xMinYMin meet" width="900" height="' + h + '"')}`);
    await br.resize(900, h);
    await br.goto(pathToFileURL(page).href);
    await br.eval('document.fonts ? document.fonts.ready.then(() => true) : true');
    writeFileSync(join(out, `${name}.png`), await br.screenshot({ x: 0, y: 0, width: 900, height: h }));
    const m = arrayMetrics(rasterise(r.scene, PRINT_THEME, 900));
    marks[name] = { ours: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 100) / 100])), size: [900, h] };
  }
} finally { await br.close(); }
writeFileSync(join(out, 'marks.json'), JSON.stringify(marks, null, 1));
console.log(JSON.stringify(marks));



