# Arc Science 0.4.0 rendering qualification

Status: release qualification passed and final review is clean after one consolidated fix wave. The authoritative executed record is `evidence-v0.4/verification.json`.

Version 0.4.0 extends the research harness with operator-controlled vector intake and retained Blender render runs. It preserves a source illustration, records authorization assertions, regenerates a flat proof and binds rendered outputs to the input and job settings. The renderer presents the proof as an intact panel; it does not infer biological structures or invent coordinates from an illustration.

## Inputs and integration scope

The connected BioRender search returned three public-template records for protein structure workflows. The complete request, results and source links are retained in `docs/intermediates/Arc_Science_Rendering_Checkpoint.json`. No vector-export operation was exposed, and no vector bytes were downloaded. The input route therefore accepts a completed, authorized export supplied as a local file. BioRender identifies PDF as a vector export option. [BioRender export guide](https://help.biorender.com/hc/en-gb/articles/17605479621405-Exporting-illustrations).

The included SVG and PDF are original project artwork with synthetic measurements. They qualify the supported file paths and rendering behavior; they are not BioRender templates or scientific benchmark results. Their provenance, data and intermediate previews are retained under `examples/vector-rendering/source/`.

No callable Blender plugin was found. The actual Blender runtime is the official `bpy` package in a separate Python environment. The tested CPU Cycles runtime is Blender 5.2.1 LTS with Python 3.13.14; the early smoke check and exact environment are retained in `evidence-v0.4/`. [Official Blender Python package](https://pypi.org/project/bpy/5.2.1/).

The SVG `studio` run and PDF `flat` run each rendered at 1600×1200 with 64 Cycles samples, seed 23 and four CPU threads. Both retained the original input bundle, packed proof, relative scene paths, job, reservation, worker log and receipt. Direct image inspection found no clipping or missing labels, data points, curve or qualification caption. Complete copied runs verified from a different parent without Blender replay. `evidence-v0.4/figure-render-inspection.json` binds the observations to the receipts and saved-scene audits.

The corrected 0.4.0 wheel was installed outside the source checkout on Python 3.12.13 with `PYTHONPATH` unset. A fresh SVG import and actual 800×600 Cycles render succeeded from that installation; its original and relocated copies verified. Both retained 1600×1200 release runs also verified through the installed wheel. Native authenticated HTTP completed the synthetic mission and evidence replay. Two fresh-process fixture runs produced identical scientific fingerprints and capsule bytes, and a tampered capsule was rejected. The final suite passed all 383 tests, including both real-bpy scene tests.

## Validation boundaries

Intake rejects active or unsupported SVG content, image-only PDFs, incomplete PDF inspection, path escape and tampering. Provenance records an operator's assertion of authorization; it does not authenticate rights. A proof replay checks the source against the recorded converter environment. Native libraries and fonts remain part of that environment.

Render verification checks the source, job, reservation, completion receipt and retained output bytes. It does not execute Blender again or attest to authorship. The `.blend` packs its image input; portable run verification must succeed after moving the complete directory to a different parent in the same qualified converter environment.

Review findings and fix evidence are retained with the release. The implementation decision to add `--provenance-file` alongside inline `--provenance` supports the user's saved authorization records. Its compatibility cost is one additional mutually exclusive CLI option; the inline form remains available.

The first whole-branch review found three Important issues: the actual BioRender public-detail URL shape was rejected, several converter-ignored SVG attributes were accepted, and a stat-to-open FIFO substitution could block file intake. Commit `0f1c0c2` corrected all three with closed URL validation, a deliberately narrower SVG subset, descriptor validation through `O_NOFOLLOW | O_NONBLOCK`, and deterministic regressions. The scoped re-review found no new Critical or Important breakage. Reports are retained in `evidence-v0.4/reviews/`.

Blender 5.2.1 emits deprecation warnings for explicit `use_nodes` assignments, which it expects to remove in 6.0. The current official bpy 5.2.1 module-mode execution is qualified; Blender executable-mode, other platforms and Blender 6 are not. Version-aware node initialization remains forward-compatibility work.

## Scientific evaluation

The existing [evaluation protocol](evaluation-protocol.md) calls for held-out tasks, matched-resource baselines, blinded assessment and replication. Those experiments have not been executed. Passing software checks or producing a polished rendering does not establish scientific validity, biological accuracy or state-of-the-art comparative performance.

Live model and vision calls, the raw deployed BioRender endpoint, Docker images and the React build remain unqualified in this workspace. Managed-browser access to localhost remains blocked; the native HTTP check is separate. Actual BioRender vector bytes were not available through the connected search operation, so the qualified source files are original synthetic artwork.
