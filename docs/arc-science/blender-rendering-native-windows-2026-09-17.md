---
title: Native Blender molecular rendering on Windows — the flagship render, run
date: 2026-09-17
status: Renders natively via bpy 4.5.14 LTS; the "Blender obstacle" is resolved on this machine
---

# Native Blender rendering (the original-vision flagship)

The GPT sessions' emphatic ask was structural-biology renders of an antibody–antigen
complex — the complex, the binding site, proper lighting/coloring/positioning, on a
**total white background**, minimal detail and coloring, in the **Baker-lab 2023–24**
style — and to "solve the Blender obstacle". That pipeline already existed in
`molecular_worker.py`; it had never had a runtime to run. It runs now.

## What was rendered (verified)

`1DQJ` — HyHEL-63 Fab (author chains A, B; **antibody**, muted blue `#91AEC5`) bound to
hen egg-white lysozyme (chain C; **antigen**, light grey `#C4C9CC`), 4,245 atoms, 49
interface contacts, 41 interface residues. Three views produced by
`molecular_worker.py` via **bpy 4.5.14 LTS Cycles (CPU)**, transparent film, soft-white
world:

- **a — complex**: per-chain Gaussian density envelopes (illustrative, not SES).
- **b — interface contacts**: all contacting interface residues as editable sticks.
- **c — closest residue pairs**: the three nearest geometric pairs, with contact labels.

The three transparent views were composited onto a **white-background collage** in a
clean Baker-lab layout (`collage-white.png`, 1600×1546). It matches the requested
aesthetic: white background, muted two-tone, soft key/fill lighting, restrained detail.

Receipt: `worker-receipt.json` records `blender_version 4.5.14 LTS`, engine CYCLES,
48 samples, per-view camera matrices and pixel-projected annotations.

## Reproduce

```bash
python apps/arc-science/src/arc_science/molecular_worker.py -- \
  apps/arc-science/src/arc_science/example_assets/1dqj/scene.json  <out-dir>  1000 48 17
# args after '--': scene.json  out-dir  width  cycles-samples  seed
```

## Environment fix (real, documented)

`pip install bpy==4.5.14` pins **numpy 1.26**, whose ABI breaks the system
`scipy`/`scikit-image` wheels (built for numpy 2.x): `numpy._core.multiarray failed to
import`. Fix: restore numpy 2.x —

```bash
pip install "numpy>=2,<3"   # -> numpy 2.4.6
```

With numpy 2.4.6, `numpy`, `scipy.ndimage`, `skimage.measure` **and** `bpy 4.5.14`
all import and the render completes. bpy prints a harmless internal
`numpy.core.multiarray failed to import` warning during import (its bundled code
expects numpy 1.x) but loads and renders correctly. A dedicated venv is the clean
long-term arrangement; for a single workstation this coexistence works.

## Honest boundaries

- Illustrative **Gaussian density envelope**, explicitly **not** a solvent-excluded
  surface; the sticks are known residue edges gated by deposited distances, not guessed
  bonds. Exploratory figure; **no scientific-validity claim**.
- CPU Cycles is slow; GPU or lower samples for iteration.
- The suite's 6 Blender-gated tests still *report* skipped (they gate on an explicitly
  configured official runtime); this run used the pip `bpy` module, which now makes
  un-skipping them feasible on this machine.
- The renders/blends are large build artifacts and are **not** committed.

## Relation to the vision, and what's next

The **molecular** render delivers the Baker-lab aesthetic. The "Studio and Flat renders
are awful" complaint is about the separate **vector-figure** styles (`figure_worker.py`
`--style studio|flat`), which are a distinct fix. Next increments: wire this molecular
render + white-collage composite as the prominent default figure path in the workbench;
optionally run the vision-model reference-analysis loop (compare against journal/BioRender
references) under HoH; then GPU + higher samples for a publication export.
