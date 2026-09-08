# Arc Science Development Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reviewed Arc Science application usable in the user's Vedix repository and submit the development increment to GitHub.

**Architecture:** Preserve the legacy plugin and import the separately reviewed application into `apps/arc-science`. Add a bounded public molecular-example API and a real HeroUI workbench while preserving Research workflows. GitHub remains a development branch/draft-PR delivery, with no merge or repository rename implied.

**Tech Stack:** Python3.12, FastAPI, existing Arc scientific/Blender worker, React19, HeroUI3, Vite6, DOM tests and pytest.

**Spec:** `docs/superpowers/specs/2026-09-08-arc-science-migration.md`

## Global Constraints

- Preserve Vedix plugin code, identifiers, installers and history.
- All collage canvases and molecular-stage backgrounds are #FFFFFF; molecular PNGs retain alpha.
- Antibody is muted blue, antigen neutral gray; no slabs, floors, gradients or decorative cards on figures.
- Molecular contacts are geometric heavy-atom distances, not inferred hydrogen bonds or affinity.
- HeroUI components must be actual imports; the production bundle must compile and ship in the wheel.
- Preserve Research vision_review, egress consent, authenticated artifacts, mission operations and in-memory credentials.
- Public assets are allowlisted; publisher artwork, raw publisher HTML and private screenshots are excluded.
- No fake live vision qualification, browser screenshots, structure rendering or proof verification.
- No browser workaround after the recorded local-preview security rejection.
- Publish a development branch/draft pull request; no force-push, merge or repository visibility change.

### Task 1: Integrate the application and complete its workbench

**Files:**
- Create `apps/arc-science/` from the approved source checkpoint, subject to the spec's inclusion policy.
- Create `apps/arc-science/src/arc_science/molecular_web.py` and packaged example assets.
- Create `apps/arc-science/web/src/MolecularWorkspace.jsx`, `ResearchWorkspace.jsx`, `App.test.jsx`.
- Modify the imported `service.py`, `web/src/main.jsx`, `styles.css`, package/build configuration and version metadata.
- Add focused service tests under `apps/arc-science/tests/test_molecular_workbench.py`.
- Update root `README.md`; preserve its old content at `docs/legacy/VEDIX_README.md`.
- Add a path-scoped CI workflow for app tests and frontend tests/build.

**Interfaces:**
- Consume `create_app` and the existing mission routes without changing authorization semantics.
- Produce `GET /api/examples/1dqj` with source, partners, cutoff, review status and fixed downloads.
- Produce `GET /api/examples/1dqj/assets/{filename}` for the explicit allowlist only.
- Retain existing `/api/missions` and authenticated artifact contracts.
- Source: `/workspace/scratch/0894be2b5454/arc-science-0.5-recovered/arc-science`.
- Candidate: `examples/molecular-figures/candidates/03` below that source. Never modify it.

- [ ] Import only the allowed source files and preserve source provenance. Establish the imported app's baseline with the existing tests before functional edits. Previously reviewed tests and core modules are not to be reimplemented from scratch.
- [ ] Write and run behavior RED checks for the new example endpoint and actual exported bytes. The expected PNG hash is a literal, independently supplied by the frozen candidate:

```python
assert hashlib.sha256(downloaded_png).hexdigest() == "7394f162dca9bba20ca985a2cd43473da2c9df7d88be5e39acaec81f30f598d9"
assert unknown_asset_response.status_code == 404
```

- [ ] Implement the allowlisted example endpoint and packaged files. Serve copies of the original collage and native views, CSV, coordinates, scene specification, captured worker and integrity/review metadata. Derived focused SVGs change only the viewport, retain vector labels, and identify their source collage hash. Do not include the22MB editable bundle or offer nonexistent scene downloads.
- [ ] Write DOM behavior RED checks before implementing the workbench: changing views updates the displayed asset; zoom changes stage sizing; export produces the selected real asset; switching Molecules→Research→Molecules→Research retains the goal/token/selected mission; failed downloads display an error; Research requests include actual egress and vision_review values. Use real HeroUI components and mock only HTTP/download boundaries.
- [ ] Implement the compact white workbench and preserve served diagnostics/console.js features. Keep controls keyboard-accessible, handle empty/error states, use honest review/source labels, and document the local molecule-render command rather than add an inactive render button.
- [ ] Set app/frontend version0.5.0 and label it development. Compile with `npm run build`; copy the generated static output into the app package. Run the new focused tests, then the complete imported app suite once. Browser screenshots remain unverified for the recorded policy reason.
- [ ] Update the root README with Arc Science development identity, real installation/run commands, molecular preview, legacy compatibility link, and exact capability/qualification boundaries. Keep existing Vedix instructions in the legacy README. Do not edit existing skill files or plugin identifiers as part of this task.
- [ ] Add CI that installs the app's test extra, runs its pytest suite, runs frontend DOM tests and builds the UI. Do not invoke live model providers, paid services or Blender in ordinary CI without an explicit runtime.
- [ ] Commit path-scoped production changes and report RED/GREEN commands/results, changed contracts/assets and unresolved limits. Do not push; the controller owns GitHub submission.

### Task 2: Review and submit the development increment

**Files:** development research note and verification records under `docs/arc-science/`.

**Interfaces:** Consume Task1's committed diff and executed tests. Produce a verified GitHub development branch and draft pull request against the inspected `master` head.

- [ ] Independently review Task1's frozen diff, then perform the SDD final whole-branch review and bounded fix wave.
- [ ] Record current primary-source distinctions: HoH evolves artifacts under fixed role/runtime contracts; self-harness evolution additionally needs holdout regression and cost controls; Lean proof gates require real elaboration/kernel checks and explicit assumptions. Record unavailable BioRender vectors and browser preview honestly.
- [ ] Build the app wheel and verify packaged UI/example bytes from the wheel. Record actual tests/build results without promoting mock execution to live qualification.
- [ ] Use the authenticated GitHub connector for branch/tree/commit writes. Reuse existing blobs where possible, preserve the parent tree, include only reviewed public files, and never delete unrelated repository paths. The local git clone has no CLI write credential; do not extract connector credentials.
- [ ] Verify the remote branch's tree/commit and open a draft pull request. Report the actual links and explicitly distinguish product rebranding from a repository-slug rename, which is not exposed by the connected tool.
