# Mermaid diagrams

Draws Mermaid flowcharts, state diagrams and sequence diagrams in the chat. Every layout passes the Molecullage gate, and the colours follow the Arc Harness theme.

## Purpose

An agent often answers with a Mermaid block. The chat shows it as code. This plugin draws it, and it draws it the same way every time, so a reader and a reviewer see one picture.

## Policy

- The renderer is our own: parser, layered layout, edge routing and SVG writer. It makes no network call and runs no code from the diagram.
- A label is text. It reaches the SVG only through escaping.
- The layout is chosen by the gate. A fixed, ordered list of candidates (ten per direction: four node orders, four wrap widths, two spacings; at most 8 for diagrams over 60 nodes) is drawn and scored. Flowcharts keep the direction the author wrote unless rotation is allowed, which doubles the list. The search stops at the first candidate with no failed and no warned mark. Otherwise the lowest score wins, and ties go to the earlier candidate. The list never depends on the clock, so the same source gives the same drawing.
- The gate marks come from Molecullage `qa/qa_fig.py` and `palette/check_palette.py`:

| Mark | Limit | Class |
|---|---|---|
| overlap (nodes, labels, text, foreign node in a subgraph box) | 0 | hard |
| edge through a node it does not join | 0 | hard |
| text inside its shape | fits | hard |
| smallest type, printed at 178 mm | 6.5 pt or more | hard |
| text contrast on the live theme | 4.5 or more | hard |
| ink, cells, band, blank (strictness normal) | 9 or more, 25, 4, 6 percent | warn |
| colour-vision distance of the fills (four vision types, CIEDE2000) | 11.5 or more | warn |
| hues, words, boxes inside a subgraph box | 8, 130, 0 | warn |

- A hard failure shows a red dot. A warning shows an amber dot. No failure and no warning shows a green dot. The drawing is shown in all three cases, with the marks one click away.
- The raster marks are measured on our own deterministic raster of the drawing on white paper. On fourteen drawings they agree with Molecullage `audit_raster.py` on the same drawings to within 1.0 point for ink, cells and band, and to within 1.2 for blank (one drawing, `shapes`, differs by 1.14 on blank whatever the constants are, because a stroke on a tile edge flips one row of tiles). The raster constants were fitted on eleven of the drawings; the other three were drawn afterwards and fit too (test/reference.test.mjs, data in test/data). The PNGs for the audit come from test/export-print.mjs, which draws the SVG in headless Edge.
- Tall and narrow flowcharts nearly always warn for cells and blank. That is what the Molecullage limits say about such a drawing. The plugin reports it and does not loosen the limits.
- A diagram that cannot meet the type floor (more than about 1000 units wide at a 13 px font, for example a 60 node graph, 30 participants or a 400 character word that cannot break) is still drawn. It gets a red dot and the reason. The card fits a diagram to its width but never shows it smaller than 80 percent of the drawn size; a wider diagram scrolls inside the card, so its text stays readable. Long words are cut to fit the line, so a single word never makes a drawing wider than needed.
- A subgraph or composite state is drawn as one outline around its members. The layout puts a left and a right border item in every layer the cluster spans, so no foreign node can stand inside an outline. An edge that names a subgraph meets it at an inner node (the first node nothing inside feeds, or the last node that feeds nothing inside; start and end marks are skipped).
- Theme colours are read from ody, where the app defines the --dsw-alias-* tokens and where dark mode is switched with data-ds-dark-theme. The card redraws when the resolved colours change.
- Text widths come from the page font through a canvas measure. The report names the measure. With the same measure the same source gives a byte-identical SVG.
- Rival considered: bundling mermaid.js 12.x. It supports every diagram type, but it lays out inside its own code, so the gate cannot choose between layouts before drawing, and it adds about 3 MB. We rejected it for this reason.

## Workflow

1. A chat message holds a code block labelled `mermaid`. The chat shows the generic word Code for a language it does not know, so a block is also taken for Mermaid when its first line is a Mermaid header of a type we draw (`flowchart TD`, `graph LR`, `sequenceDiagram`, `stateDiagram-v2`). A block labelled with another language (Graphviz, Python) is left alone.
2. When the text has not changed for 0.7 seconds, the plugin parses it. A block that still changes while the model types is left alone.
3. The gate search runs between timer ticks, so the page stays responsive.
   The card is invisible until two checks on the real render pass: the drawn text against the measured text (wider than 3 percent means a new layout with a scaled measure) and the render audit (text on text, a line over text with no pill under it, text outside its shape). A finding widens the measure by 7 percent and the card is drawn again, three times at most. What remains is listed in the card under the gate line, as render check.
4. The card appears beside the block. The block is hidden with a data attribute.
5. A parse error shows its note after 2.5 more seconds, in case the message is still being typed.
6. A theme change draws the card again.

## Settings

The plugin has no settings page. The Client module reads `allowRotate` (default off) and `fontPx` (default 13) when it is created.

## Data it reads and writes

- Reads the text of mermaid code blocks and the theme tokens (`--dsw-alias-*`).
- Writes one style element, one card beside each diagram block, and the attribute `data-arc-mm` on the block.
- Writes no local storage. Makes no call to any other machine. A download starts only when the user clicks SVG or PNG.
- After each drawing the card sends one report to the app's own host (POST /api/arc-mermaid/report, same origin). The host keeps the latest report and the last 12 in the Arc home folder, `arc-mermaid/reports`: latest.json, latest.png and r-<time>-<hash>.json/.png. A report holds the first 4000 characters of the diagram source, the gate marks, the render audit, the fonts in use and a picture of the card. This is how a person or an agent can look at what the real app drew. Set `ARC_MERMAID_REPORTS=off` in the environment of the app to switch the route off.

## Failure behavior

- Unsupported type, parse error, empty diagram or more than 400 nodes: the block stays visible and a note explains why.
- A drawing error is caught. The block stays visible.
- When the plugin unloads, it removes every card, note, attribute and the style element.

## How to verify

1. In the plugin folder run `node --test test/*.test.mjs` and check that all tests pass.
2. Run `node test/browser-check.mjs --theme light` and `--theme dark`. Each prints `browser check ok`.
3. Ask the agent for a flowchart in a `mermaid` block. Check that a card appears, that Source shows the original text, and that the gate line opens the marks.
4. Switch the theme in Settings. Check that the card follows it.

## Limits

- The Mermaid syntax is a subset, listed in README.md.
- The browser check runs on a copy of the chat code block. Open a real chat to confirm the card in the running app.
- A parse error is reported once the text has been stable for 3.2 seconds. The plugin cannot see the closing fence of a block that the model still types; it waits for the text to stop changing.
- Edge routing is orthogonal with rounded corners. Several parallel edges between two nodes can lie close to each other.






