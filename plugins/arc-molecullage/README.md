# arc-molecullage

Molecullage workspace for Arc Harness. This plugin replaces the deprecated `Molecules` and `BioArt` workspaces with one unified `Molecullage` workspace and status route (`POST /api/arc-molecullage/state`).

## What it provides

- **Five-gate anti-overplating check**: enforces `nestedBoxes = 0` and `overplate = 0` across the 56-rule publication grammar (layout, literature grounding, ChimeraX macromolecular 3D structures, Blender 3D models, and canvas typography).
- **Shelf and atlas summary**: exposes the 231-source reference library and the eight-domain software and model atlas.
- **3D structure and figure pipeline status**: reports the ChimeraX structure renderer, the Blender studio scene pipeline, `build_figure`, `qa_figure` and the blind-read check.

## Test

```powershell
node --test plugins/arc-molecullage/test/molecullage.test.mjs
```
