# Real molecular render qualification — 1DQJ

Date: 20 September 2026. Scope: one bounded external-Blender and browser/Mol* qualification after the [product recovery](2026-09-20-recovery-record.md). This is not scientific validation or production release acceptance.

## Objective and setup

Run a deposited antibody–antigen structure through the actual Arc molecular job pipeline, preserve the visible Mol* viewer while calculating, cancel one job, finish another, and compare source, scene and downloaded artifact evidence. The user selected a Rust/C++ core target with Blender retained as an external renderer; the current Arc science service is still Python pending parity migration.

The [Blender Foundation Windows portable 5.2.2 LTS](https://www.blender.org/download/) archive was obtained from its official [release directory](https://download.blender.org/release/Blender5.2/) and matched the published SHA-256 `3849d17a682cba006075aaa3f3597ecb5c9c30ec31035b2e092c53e40679b535`. It was extracted under `%LOCALAPPDATA%/ArcScience/tools/blender-5.2.2/`. The bundled Python alone could not import `bpy`; the matching [Blender Foundation `bpy` 5.2.2 wheel](https://pypi.org/project/bpy/5.2.2/) and Arc's declared SciPy/scikit-image renderer requirements were installed into that portable Python, not the Arc application interpreter. An isolated `-I -X utf8` import probe reported `bpy 5.2.2 LTS`, NumPy 2.3.4, SciPy 1.18.1 and scikit-image 0.26.0. Arc's `/api/molecular/capabilities` probe displayed **Local renderer ready**.

The source was the publicly deposited [RCSB PDB 1DQJ experimental antibody–lysozyme complex](https://www.rcsb.org/structure/1DQJ), downloaded as mmCIF from `https://files.rcsb.org/download/1DQJ.cif` (647,961 bytes, SHA-256 `176f9d155fdf18650f8221007511dbde90f0fc19de9462d59515ce590bb30250`). The isolated render selected author antibody chains A/B, antigen C, model 1, asymmetric unit and a 4 Å heavy-atom contact cutoff. The source file was not bundled into the product UI.

## Visible-control browser results

At `127.0.0.1:8098`, the user-facing Molecules workspace loaded the mmCIF and Mol* reported **4,793 atoms** before submission. The model was rotated through the visible viewer before the first render. The same viewer stayed on screen while the job reported pipeline stages and a provisional contact overlay, then **41 contact residues from the verified scene**, explicitly stating that coordinates were unchanged.

| Job | Settings | Observed result |
| --- | --- | --- |
| `de08155e0c4745a69058e57cbdeee62c` | publication white, 640 px, 4 samples | Completed; 49 residue pairs; 18 manifest files all matched byte lengths and SHA-256; Arc image checks passed. This low-resolution smoke figure has cramped labels and is not a presentation-quality target. |
| `81afa12183554682a62845e2596d7a2c` | 2400 px, 128 samples | Cancelled from the visible control while rendering; final status `cancelled`, zero completed assets. |
| `eca26510bfea4080b8da3f6c05949994` | colourblind-safe preset, 1400 px, 32 samples | Completed; 49 residue pairs; all 18 manifest file lengths/hashes matched; Arc image checks passed; Blender receipt 5.2.2 LTS. |

The high-resolution [collage image](../../.omx/artifacts/real-render-1dqj-20260920/collage.png) has SHA-256 `8d7e73f73c3b07fe0c5c2556e0d917f308797eaccebd492c0695563de5e9c3b7`. The [manifest](../../.omx/artifacts/real-render-1dqj-20260920/manifest.json), [caption](../../.omx/artifacts/real-render-1dqj-20260920/caption.md), [checks](../../.omx/artifacts/real-render-1dqj-20260920/checks.json), [contact table](../../.omx/artifacts/real-render-1dqj-20260920/contacts.csv) and source copy are retained as local, unversioned evidence in `.omx/artifacts/real-render-1dqj-20260920/`. The browser's Download collage control saved `eca26510bfea4080b8da3f6c05949994-collage.png` into the user's Downloads; its SHA-256 exactly matched the served artifact. The browser automation provider did not emit its expected download event, so the on-disk matching file is the direct observation.

An independent calculation from the deposited coordinates recomputed the first contact, A:30:CB to C:16:CA, as **3.4147737846012567 Å**, exactly the value in `contacts.csv`. This checks one geometric distance, not the complete contact map or biological binding. The manifest states `visual_review: not performed by this renderer`, `publication_ready: false`, and describes contacts as geometric proximity without affinity or hydrogen-bond inference.

## Visual and scientific limits

Codex inspected the 1400 px image at its native resolution. The blue/orange partners, four panels, distance labels and contact matrix appeared present without obvious clipping; panel c's three labels/distances agreed with the caption, while panel d remains dense. This is an author visual observation, not independent vision-model acceptance. A separate Gemini CLI review was attempted, but the account returned `IneligibleTierError` before inference; the raw attempt is in `.omx/artifacts/gemini-vision-1dqj-20260920.*`. Claude credits were already exhausted. No independent image reviewer qualified the figure.

The default `%LOCALAPPDATA%/ArcScience/workspace/arc-science.toml` was given the verified portable `components.blender_python` path after a dated backup. The native supervisor's `startup-plan` now reports the renderer path present and ready. The actual complete render and asset download were observed in the browser against an isolated service; the native WebView was not driven through a render/download. Camera preservation was visually observed across contact stages but not numerically instrumented, and there are still no evolving coordinate frames, trajectory replay, or real-time molecular dynamics claim. Only two of the nineteen named presets were exercised; a clean-profile portable release and publication/novelty gates remain open.
