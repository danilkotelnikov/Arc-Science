# Arc Science logo

The logo is the "as" monogram on a continuous-corner tile, set beside ARC SCIENCE in
MuseoModerno Black. Every file here holds plain fills only (no strokes, no transforms, no
raster) and names its parts with `id` (`tile`, `letters`, `wordmark`).

| File | What it is |
|---|---|
| `as/as-logo-production-1.svg` | The operator's production lockup for dark grounds: ink tile, paper letters, white wordmark. The colour reference. |
| `as/as-logo-production-2.svg` | The operator's production lockup for light grounds: white tile, ink letters, black wordmark. The colour reference. |
| `as/as-lockup-dark.svg` | The lockup rebuilt from geometry in the colours of production 1. |
| `as/as-lockup-light.svg` | The lockup rebuilt from geometry in the colours of production 2. |
| `as/as-tile.svg` | App icon: ink tile (#111111), paper letters (#F7F5EF). Also the favicon and the desktop icon. |
| `as/as-tile-light.svg` | App icon on white: white tile, ink letters. |
| `as/as-mark.svg` | The letters alone in `currentColor`, 84 % of a 1024 square. |

## Proportions

Measured from the production files and fixed in `scripts/build-logo.py`:

- the tile is 2.1 cap heights of the wordmark tall, and the capitals are centred on it;
- the gap from the tile to the A is 0.45 cap heights;
- the letters span 0.716 of the tile's width and sit in its centre;
- the tile is a continuous-corner square (radius 0.2237 of the side, 60 % smoothing, the
  iOS-like setting described by Figma), made by `scripts/squircle.py`.

The rebuilt wordmark overlaps the production outline at IoU 0.997.

## The mark

The letters were drawn by GPT-Image (ChatGPT, 25 September 2026) and rebuilt from measured
geometry: one stroke width, straight lines and circular arcs. The a is a top bar turning
into the stem and a bowl with a flat top; below its counter the stem turns into the
baseline of the s. The s ends one stroke above the baseline at its right side, which
leaves the step at its bottom-right corner. Check the generating account's terms before
registering the mark.

## Colour in the workbench

The header draws the lockup from `apps/arc-science/web/src/brand/logo.js` with three
custom properties: `--logo-tile`, `--logo-letters` and `--logo-word` (`app.css`). On a light
palette the tile is white and the letters and word take the palette's ink; on a dark
palette the tile is #111111 and they take its light ink. These follow the two production
colourways; palette-specific colourings can be added there later.

## Rebuild

```
PYTHONUTF8=1 python scripts/build-logo.py
PYTHONUTF8=1 python scripts/make-icon.py
```

The first writes `design/logo/as/`, the workbench's `src/brand/logo.js` and `public/favicon.svg`,
and `native/arc-desktop/assets/arc-icon.svg` (the window icon). The second rasterises that
icon with `native/arc-svg` (resvg) into `native/arc-desktop/assets/arc-science.ico` at 16,
24, 32, 48, 64, 128 and 256 px. They need fontTools and skia-pathops (`pip install --user
skia-pathops`, BSD-3), which are developer tools and are not shipped. The font is read
from [design/fonts](../fonts/README.md).
