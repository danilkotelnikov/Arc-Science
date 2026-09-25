# Logo candidates

Editable SVG sources for the Arc Science mark. Every file uses `viewBox="0 0 1024 1024"`, names its parts with `id`, and contains no embedded raster. Tiles share one frame: a continuous-corner squircle inset 32 units from each edge (960 x 960), transparent outside. The copies the prototype displays live in `apps/arc-science/web/public/logo-candidates/`, listed in its `index.json`.

## Candidates

| File | Source | What it is | Size |
|---|---|---|---|
| `snoggo-tile.svg` | Snöggo master | The master mark re-set on a continuous-corner tile, ink `#080808` | 1 path, 83 segments |
| `snoggo-mark-mono.svg` | Snöggo master | The same shape in `currentColor` | 1 path, 83 segments |
| `arc-a-mark.svg`, `arc-a-tile.svg`, `arc-a-tile-ink.svg` | Geometric, drawn here | Open 270-degree arc, round caps, a data point in the gap | 1 arc + 1 circle |
| `arc-b-mark.svg`, `arc-b-tile.svg`, `arc-b-tile-ink.svg` | Geometric, drawn here | Two concentric upper half arcs over a base node | 2 arcs + 1 circle |
| `arc-c-mark.svg`, `arc-c-tile.svg`, `arc-c-tile-ink.svg` | Geometric, drawn here | Parabolic arch read as an A, with a point for its crossbar | 1 quadratic + 1 circle |

`*-tile.svg` puts the white mark on `#2F5B7A` (contrast 7.3:1); `*-tile-ink.svg` puts it on `#111111`. Marks are round-capped strokes (`stroke-width` 96 for arc A, 84 for arc B, 112 for arc C), so the weight stays editable. The tile versions place the same group with `translate(96 96) scale(0.8125)`, the same placement `tile_svg` uses.

### Snöggo

Source: `native/arc-desktop/assets/snoggo.svg`, byte-identical to the parent folder's `SNOGGO_logo_master.svg`; neither file was changed. The master is one path with two subpaths. The first, the rounded outer tile, is replaced by `squircle.get_svg_path(1184.6848, 1177.372, 0.2237 * 1177.372, 0.6, x=33.1679, y=35.5)`, which spans the same bounds as the original tile. Those bounds were sampled from the master path, which is slightly wider than tall. The second subpath, the fluid cut-out, is copied verbatim. The only change is that its opening relative move is written as the equivalent absolute `M 713.58639,1084.4862`, because it followed the replaced subpath. The path keeps the master's 1254-unit coordinates inside `<g id="snoggo">`, whose matrix scales the tile to 960 units and centres it. `fill-rule="evenodd"` makes the cut-out transparent.

### Geometric marks

They were drawn by hand as primitives, with no tracing and no reference image. They were compared by eye with the Claude (radial starburst), OpenAI (interlaced knot) and Gemini (four-point sparkle) marks and share no construction with them. No trademark search has been run.

## Small sizes

These notes come from previews rendered at 256, 32 and 16 px with `arc-svg2png`.

- Arc A and arc C hold at 16 px. The point stays separate from the arc, with about 1.5 px of clearance. The mark scale of 0.8125 and the point sizes were chosen for this; at a scale of 0.75 the point merged into the arc.
- Arc B is the weakest at 16 px. Each stroke and gap is about 1 px wide, so the arcs read as a striped dome, and at that size the mark resembles a Wi-Fi glyph. A reduced drawing with one arc and the node would be needed at 16 and 24 px.
- The 32-unit tile inset lands on fractional pixels at 16, 24 and 48 px (0.5, 0.75 and 1.5 px), so the tile edge is antialiased there. It lands on whole pixels at 32, 64 and 256 px.

## Tools

- `scripts/squircle.py` is a stdlib port of the uniform-radius `getSvgPath` from [figma-squircle](https://github.com/phamfoo/figma-squircle) (MIT). It provides `squircle_path(size, radius_ratio=0.2237, smoothing=0.6)` and `tile_svg(mark_svg, fill)`. Figma describes 60% smoothing as the iOS-like setting. The 0.2237 radius ratio is a commonly used approximation, because Apple does not publish the exact icon geometry.
- `scripts/make-icon.py` builds the Windows `.ico`. With no flags it reproduces the shipped `native/arc-desktop/assets/arc-science.ico` byte for byte. To try a candidate: `PYTHONUTF8=1 python scripts/make-icon.py --source design/logo/arc-a-mark.svg --tile --out <scratch>/arc-a.ico --sizes 16,24,32,48,256`.
- `scripts/vectorize-logo.py` traces a PNG with [VTracer](https://github.com/visioncortex/vtracer) 0.6.5 (MIT OR Apache-2.0). It runs binary spline mode with a speckle filter, then rounds coordinates to one decimal, drops paths under 16 units and wraps the result in `<g id="mark" fill="currentColor">`. `--tile` puts the result on the squircle tile.
- `native/arc-svg` (`arc-svg2png`) renders the previews and icon frames with resvg 0.48.1 (Apache-2.0 OR MIT).

A smoke run rendered each mark to PNG with `arc-svg2png`, traced it back and compared the two coverage masks at 1024 px.

| Mark | Input | Paths | Nodes | IoU |
|---|---|---|---|---|
| arc A | 1024 px | 2 | 74 | 0.989 |
| arc B | 300 px | 3 | 46 | 0.957 |
| arc C | 512 px | 2 | 38 | 0.960 |
| Snöggo mono | 1024 px | 1 | 166 | 0.997 |

The traced Snöggo needs twice as many nodes as the 83-segment source. Expect about that much hand-cleaning on traced candidates.

## Adding GPT-Image and BioRender candidates

1. Export the candidate as a PNG of at least 1024 px with a dark mark on a light or transparent background. The tracer thresholds to black and white, so a light-on-dark image has to be inverted first.
2. Trace it: `PYTHONUTF8=1 python scripts/vectorize-logo.py candidate.png design/logo/<id>-mark.svg`, and add `--tile` for the tile version. Record the reported path and node counts.
3. Clean it by hand. Merge the spline runs into as few curves as hold the shape, replace near-circles and near-lines with primitives, name the parts with `id`, and keep `currentColor`. Then re-render at 16 and 32 px.
4. Record the provenance in this README: the tool, the prompt or BioRender asset, the date and the account's licence terms. Then copy the SVGs to `public/logo-candidates/` and add entries with `source: "gpt-image"` or `source: "biorender"`.

Licence terms decide whether a candidate can become the mark at all. Check the current terms of the generating account before adopting a GPT-Image candidate. BioRender's licence restricts how its illustrations may be used, so confirm that logo or trademark use is permitted before adopting anything BioRender-derived.

## Generated candidates (25 September 2026)

| Candidates | Tool | Input | Processing |
|---|---|---|---|
| `generated/gpt-01..08-{mark,tile}.svg` | ChatGPT image generation, operator's account, Zen browser | The Snöggo master rendered at 1024 px as the style reference, plus a prompt asking for eight variants in the same style (black continuous-corner tile, one fluid white cut-out) on one 4 by 2 contact sheet | Sheet sliced into tiles; each cut-out inverted into a dark mark, traced with `vectorize-logo.py`, and re-seated on the exact squircle tile (`--tile "#080808"`). One path per mark, 11 to 15 KB before hand-cleaning. |
| `generated/biorender-draft1-arch-{mark,tile}.svg` | BioRender custom figure, operator's account, figure 22eb0c69597f2f8607c7b77d | Prompt: minimal flat monochrome app icon, an abstract protein ribbon bending into a single arc inside a rounded square | The drawn frame removed, the arch traced and placed on a `#2F5B7A` tile. |
| `generated/biorender-draft2-pocket-{mark,tile}.svg` | BioRender custom figure, operator's account, figure f16f0b35765d9db292ba83b4 | Prompt: minimal flat icon, a molecular surface arc with one highlighted binding pocket | Hairline art; not legible below 32 px. |

The adopted candidate is hand-cleaned (fewer nodes, named parts) after the review gate. Licence checks from the section above still apply before adoption.
