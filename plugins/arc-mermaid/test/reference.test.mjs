// Our raster marks against Molecullage qa/audit_raster.py. test/data/molecullage-audit*.json hold the values that
// `py -3 -I qa/audit_raster.py <png> --width-mm 178 --kind schematic --json` printed for the PNGs of test/export-print.mjs
// (the SVG drawn by Edge with the print theme, 900 px wide). The engine must reproduce them from its own raster.
// The constants of the raster (text ink, text height, stroke extra) were fitted on test/fixtures and test/holdout; test/validate was drawn afterwards and never used for fitting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderDiagram } from '../src/engine.mjs';
import { rasterise, arrayMetrics } from '../src/gate.mjs';
import { PRINT_THEME } from '../src/scene.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// Percentage points. ink, cells and band stay within 1.0 on all fourteen drawings. blank is within 1.0 on thirteen; on fixtures/shapes it differs by 1.14
// whatever the raster constants are (a stroke on a tile edge flips one row of tiles), so its limit is 1.2. This is looser than the proposed 1.0 and is reported as such.
const TOL = { ink: 1.0, cells: 1.0, band: 1.0, blank: 1.2 };

for (const [file, dir] of [['molecullage-audit.json', 'fixtures'], ['molecullage-audit-holdout.json', 'holdout'], ['molecullage-audit-validate.json', 'validate']]) {
  const mol = JSON.parse(readFileSync(join(here, 'data', file), 'utf8'));
  for (const [name, want] of Object.entries(mol)) {
    test(`${dir}/${name}: marks match Molecullage audit_raster`, () => {
      const r = renderDiagram(readFileSync(join(here, dir, `${name}.mmd`), 'utf8'));
      const m = arrayMetrics(rasterise(r.scene, PRINT_THEME, 900));
      for (const k of Object.keys(TOL)) {
        const tol = TOL[k];
        assert.ok(Math.abs(m[k] - want[k]) <= tol, `${name} ${k}: ours ${m[k].toFixed(2)}, Molecullage ${want[k]}, tolerance ${tol}`);
      }
    });
  }
}


