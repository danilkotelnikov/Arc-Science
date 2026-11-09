# Mermaid diagrams

Draws Mermaid flowcharts, state diagrams and sequence diagrams in the chat, in the Arc Harness look. A Molecullage gate checks every layout before it is shown.

The plugin finds a code block that is labelled `mermaid`, hides the block and shows a card beside it. The card has the diagram, a Diagram and Source switch, Copy, SVG and PNG buttons, and one line that shows the gate result. Click that line to see every mark.

## Supported

- `flowchart` and `graph` with TB, TD, BT, LR and RL. Shapes: rectangle, round, stadium, subroutine, cylinder, circle, double circle, diamond, hexagon, parallelograms, trapezoids, flag. Links: `-->`, `---`, `-.->`, `==>`, `--x`, `--o`, `<-->`, `~~~`, text in `|...|` or `-- text -->`, `&` groups, chains, `subgraph` with nesting, `classDef`, `class`, `:::`, `style`, comments, `<br/>`, quoted labels.
- `stateDiagram` and `stateDiagram-v2` with `[*]`, composite states, choice and fork.
- `sequenceDiagram` with participants and actors, all arrow forms, notes, `loop`, `alt`, `opt`, `par`, `critical`, `break`, activation, `autonumber`.

Every other type (pie, class, ER, gantt, mindmap, git graph) stays a normal code block with a one-line note. A line the parser cannot read leaves the block as it is and shows the line number.

## Colours

Node fills come from the Molecullage palette (cream, mint, rose, apricot, pink, sand). A colour in `classDef` or `style` is mapped to the nearest family. Blue and purple are never drawn, because Arc Theme keeps no blue. Lines and text follow the theme tokens, so light and dark work without a redraw of the layout.

## Install and undo

Copy the folder (without `test`, `src` and `build.mjs`) to `~/.arc/profiles/desktop/node_modules/arc-mermaid` and add `arc-mermaid` to `arc.profile.bundles` in the profile `package.json`. Remove both to undo. The full policy is in docs/policy.md.

## Develop

```powershell
node build.mjs                      # src/*.mjs to lib/client.js
node --test test/*.test.mjs         # 64 tests
node test/browser-check.mjs --theme light --png   # headless Edge or Chrome
node test/browser-check.mjs --theme dark
node test/export-print.mjs          # PNGs for Molecullage audit_raster.py
```





## Looking at the real app

Every drawing sends a report to the host. The latest one is `~/.arc/arc-mermaid/reports/latest.json` with its picture `latest.png`, drawn with the page font and the live theme colours. The card also carries `data-fit-scale`, `data-measure` and `data-audit` for DevTools. After a change, put a Mermaid block in a chat message, wait a few seconds and read the report.
