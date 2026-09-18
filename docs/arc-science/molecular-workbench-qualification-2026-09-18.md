# Molecular workbench qualification — 18 September 2026

Scope: the local working-tree increment after `216c40d`, on Windows with Python
3.11, Node 24.14.0, the existing resvg executable and bpy 4.5.14 LTS. No dependencies
were added, no remote branch was published, and no model-provider review is claimed.

## Delivered

- Authenticated coordinate uploads and single active molecular render through the
  existing CLI, Blender views and white collage pipeline.
- Server-selected runtime, bounded settings/uploads, sanitized child environment,
  total deadline, cancellation and shutdown cleanup.
- Persisted job state, interrupted-job recovery, bounded history, and allowlisted
  source/figure/provenance downloads checked against captured sizes and hashes.
- A collapsible local render form, status polling, saved jobs, cancellation,
  authenticated blob previews/downloads and source/artifact hashes.
- The original public 1DQJ files are unchanged. Frozen-example metadata is hidden
  while a generated figure is selected.
- Windows packaging fixes: explicit regular-file UI copying avoids a reproduced
  Node `cpSync` process abort; repository connections now close after transaction
  completion or failure, avoiding a reproduced locked `missions.db` on wheel cleanup.

The UI reuses the existing shared in-memory token and figure stage. The backend
reuses coordinate preparation, rendering, anchored file reads and process cleanup;
there is no second scientific implementation or new dependency.

## Verification

| Check | Fresh result |
| --- | --- |
| Full application suite, `PYTHONUTF8=1 python -m pytest -q -rs` | **587 passed, 67 skipped**, 60.94 seconds |
| Frontend `npm test` | **25 passed**, including packaging and 9 new render interactions |
| Frontend `npm run build` | Passed; compiled UI copied into Python package |
| Python compilation, Node script syntax, `git diff --check` | Passed |
| `pip wheel --no-deps --no-build-isolation . --wheel-dir dist` | Passed |
| `python scripts/check-wheel.py dist/arc_science-0.6.0-py3-none-any.whl` | Passed, including cleanup; 20 public assets and served compiled JS verified |
| Explicit real Blender molecular integration tests | **2 passed** (contact and empty-contact cases) |
| Final real HTTP render of deposited 1DQJ | Completed; **49** residue contact pairs; **11** authenticated artifacts matched sizes/SHA-256 |
| Independent review | No outstanding actionable findings in the increment and packaging fixes |

Final wheel SHA-256:
`6e6515965bc10de3e9ac1d0f5033b728481b7e0e7dbdcdb93c097836b83cce80`.
The real API job `3d1f5173a5ad4e208498f015ef475a05` used width 640, one sample,
seed 23, antibody author chains A+B, antigen C, assembly 1. It completed in 9.38
seconds after cached readiness qualification. Its manifest binds the original source
hash, keeps `publication_ready=false`, and records no independent visual-provider review.
These are preview settings and one-machine observations, not performance targets or
publication-quality qualification. Full defaults remain 1400 pixels and 96 samples.

Browser inspection covered the real compiled localhost UI: unchanged frozen example,
render form expansion, operator-token entry, runtime readiness, persisted-job
selection, authenticated collage display and readable download controls. Form
submission/cancellation, stale responses, polling recovery and URL cleanup were
exercised through DOM tests; upload-to-render computation was exercised through the
real HTTP API. This does not claim every responsive layout or an actual Rust desktop
window was tested in this increment.

## Review-driven fixes

Regression tests first reproduced and then verified:

1. A second cancellation during process cleanup released the job slot too early.
   Cleanup now finishes despite repeated cancellation before terminal state is exposed.
2. Reselecting the same active job after a failed poll did not restart polling.
   Explicit reselection now restarts it, and stale responses cannot replace another job.
3. Windows device-name uploads with a space before the extension were accepted.
   They are rejected before creating a job.
4. Post-process artifact verification needed the job's total deadline as well.
5. Mission repository transaction contexts left SQLite connections open. Actual
   retained handles now reject queries after success and error paths.

## Limits and recovered context

- The 67 skips include POSIX-only mechanisms, unavailable symlink privileges,
  unconfigured renderer gates and an unbuilt native supervisor. They are gaps in
  that run, not evidence of Windows/POSIX equivalence. The two molecular Blender
  gates were separately executed and passed. A Windows junction-rejection test passed.
- bpy emits a NumPy ABI warning in the retained environment despite successful
  imports and rendering. A separate pinned Blender environment remains desirable.
- Vite reports the same three HeroUI `use client` directive warnings; it builds successfully.
- Existing Windows filesystem/process containment limits remain. No Linux/macOS
  runtime qualification, live NIH transfer, publication review or inherited Vedix
  root-suite qualification was performed here.
- The full shared GPT pages could not be retrieved: web requests timed out and the
  browser reported `ERR_CONNECTION_CLOSED`. Context was recovered from the repository
  and the relevant local Claude session logs, including the approved Windows-native
  direction and the outstanding molecular workbench step.
- Claude Code reported authenticated OAuth, but both Opus and Sonnet assessment
  calls at medium effort returned `Credit balance is too low` before inference.
  No exact model identity or completed Claude contribution was returned. Codex
  implemented and independently reviewed the increment. Local failed-call records
  are retained under `.omx/artifacts`; no credentials were copied.

## Files and next work

Primary changes: `src/arc_science/molecular_jobs.py`, service mounting/lifespan,
`web/src/MolecularRenderPanel.jsx`, `MolecularWorkspace.jsx`, shared token wiring,
small styles and rebuilt packaged assets. Tests live in `test_molecular_jobs.py`
and `MolecularRenderPanel.test.jsx`. Packaging repairs touch `web/scripts/package-ui.mjs`,
`exploration/repository.py` and `test_mission_storage.py`. Root README/status and the
[setup guide](molecular-workbench-2026-09-18.md) describe the current behavior.

Continue with a dedicated Blender runtime and broader structure/visual qualification,
then the already documented memory-to-planner replay binding. Claude pairing can
resume once its account condition changes. This increment does not implement those
remaining milestones.
