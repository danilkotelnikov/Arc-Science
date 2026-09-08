# Arc Science · development

Arc Science is an evidence-bound research workbench under development in the existing Vedix repository. It combines a molecular figure workspace with bounded research missions: competing hypotheses, permitted computations, independent role reviews and reproducible evidence.

The application is in [apps/arc-science](apps/arc-science). Vedix's plugin code, identifiers, installers and history are preserved; use the [original Vedix installation guide](docs/legacy/VEDIX_README.md) for those plugins. The repository slug has not been renamed.

## Run locally

Python 3.12 is the tested application runtime. The committed UI is already compiled; Node is only needed when rebuilding it.

```bash
cd apps/arc-science
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install .
arc-science serve --data ./data
```

Open [the local workbench](http://127.0.0.1:8080/). In another activated terminal, run `arc-science token --data ./data` and enter that operator token in Research. It stays in page memory. Use a fresh data directory for 0.5.0; historical capsules need their matching verifier. [Migration notes](apps/arc-science/docs/migration-0.5.md) describe compatibility and provenance.

## Molecular workspace

![1DQJ antibody–antigen illustrative collage](apps/arc-science/src/arc_science/example_assets/1dqj/collage.png)

The default is frozen candidate 03: HyHEL-63 Fab author chains A+B with lysozyme C, RCSB 1DQJ, model 1, identity biological assembly 1. The original collage and annotated full-complex/interface/rotated SVG views support real zoom and export. Native transparent PNG views are separate **unlabeled** downloads.

The complete CSV contains 49 residue pairs at minimum heavy-atom distance ≤4 Å. This geometric criterion does not establish hydrogen bonds, affinity or energetic hotspots. The surface is an approximate Gaussian atomic envelope, not a solvent-excluded surface; the rotated detail shows only the three nearest pairs.

Public downloads include coordinates, scene specification, captured worker and integrity/review metadata. Large editable `.blend` scenes remain in the separately delivered bundle. There is no inactive server render or upload control.

To render your own authorized coordinates, install `'.[structure]'` in the app environment and prepare a **separate** Blender Python runtime using [the rendering setup](apps/arc-science/docs/vector-rendering.md) and [the historical Blender lock](apps/arc-science/requirements-blender.lock). Then:

```bash
arc-science molecule-render source.cif --antibody A,B --antigen C \
  --assembly 1 --output ./new-candidate \
  --blender-python /path/to/blender-env/bin/python
```

Defaults are a 1400 px white collage, 96 samples and seed 23. The output directory must not already exist. Reproduction requires the specified renderer environment; this migration does not claim a new Blender qualification.

## Research and limits

Research preserves goal, execution mode, round limit, explicit egress and visual-review consent, saved missions, start/cancel/resume, numerical verification and replay-capsule export. Artifact inspection/download remains authenticated. Switching workspaces retains the current goal, token and mission.

Offline mode uses a scripted planner and real numerical analysis; it is not live-model or biological evidence. Live mode requires configured server-side providers, exact model IDs and credentials. Visual review also requires a configured vision provider; missing or failed qualification is not a passing badge. [Provider configuration](apps/arc-science/docs/source-readme-0.4.md#direct-model-and-vision-configuration) documents the retained environment settings; substitute a fresh 0.5 data directory.

HoH's fixed roles, single writer, frozen candidates and independent QA are the foundation. Self-evolving harness proposals, broader scientific composition and Lean proof obligations remain separate development requirements. Reproducibility, model agreement and attractive figures do not establish scientific validity or publication authorization.

The actual React/HeroUI 3 UI is built and tested through DOM interactions and served artifact bytes. Browser pixel layout remains unverified because local HTTP and shared-file HTML previews were rejected by policy; no alternate browser/hosting workaround was used. Historical candidate image acceptance is scoped to illustration clarity, not the running page.

## Develop and test

```bash
cd apps/arc-science
python -m pip install '.[test]'
cd web
npm ci
npm test
npm run build
cd ..
python -m pytest -q -rs
python -m pip wheel --no-deps . --wheel-dir dist
```

`npm run build` copies compiled files into the Python package. Path-scoped CI runs the app tests, real frontend DOM tests and production build. Native Blender integration tests skip unless an explicit runtime is supplied; ordinary CI does not call live models or paid services.

[Application migration and public inclusion policy](apps/arc-science/docs/migration-0.5.md) · [Legacy Vedix guide](docs/legacy/VEDIX_README.md)
