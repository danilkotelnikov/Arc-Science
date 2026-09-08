# Vector figures and Blender rendering

This workflow keeps original vector artwork, a flat proof, the Blender scene and the rendered output together. The original SVG or PDF remains available for editing and publication workflows. Blender presents the artwork as an intact panel with controlled framing and lighting; its PNG output is a raster image.

## BioRender input

Use BioRender to discover public templates. The connected search operation supplies titles, IDs and links; it does not expose a vector-download operation. BioRender's export guide identifies PDF as a vector export format. Export a completed figure through an authorized account and keep its source link and applicable permission evidence. [BioRender export guide](https://help.biorender.com/hc/en-gb/articles/17605479621405-Exporting-illustrations).

Arc does not infer reuse permission from public visibility. BioRender distinguishes completed graphics from standalone content in its usage terms. The import record contains an operator's authorization assertion, which Arc does not independently authenticate. [BioRender publication terms](https://help.biorender.com/hc/en-gb/articles/17605463719709-Publication-license-Terms-of-use).

Public templates returned during the investigation:

| Template | Public detail page |
|---|---|
| Protein Homology Modeling | [Open template](https://app.biorender.com/biorender-templates/details/t-62c743fda5cf881ed2d8695f?source=mcp) |
| NMR Spectroscopy Workflow for Protein Structural Determination | [Open template](https://app.biorender.com/biorender-templates/details/t-67a6525d6b16d9c8b3ac70a0?source=mcp) |
| Protein Crystallization Workflow | [Open template](https://app.biorender.com/biorender-templates/details/t-67a652ba4ca4e3ed5825d01b?source=mcp) |

The exact IDs and discovery records are saved in `examples/vector-rendering/biorender-template-candidates.json`.

The supplied demonstration artwork is original and explicitly synthetic. It exercises the file and render pipeline; it does not qualify a live BioRender vector export or a scientific finding. Tests using the recorded discovery URL with synthetic artwork check the provenance contract only, not an actual BioRender export. No comparative scientific SOTA claim is established.

## Install

Install the Arc wheel and its vector dependencies in the application environment using the included lock files. Blender runs in a separate process. The qualified Blender package uses Python 3.13; Blender's Python packages require a matching interpreter version. [Official Blender Python package](https://pypi.org/project/bpy/5.2.1/).

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.lock -r requirements-vector.lock
python -m pip install --no-deps dist/arc_science-0.4.0-py3-none-any.whl

uv venv --python 3.13.14 .blender-env
uv pip install --python .blender-env/bin/python -r requirements-blender.lock
```

CairoSVG requires the platform Cairo library; the Python lock does not vendor native libraries or fonts.

Only official `bpy` 5.2.1 in Python module-mode was executed for this release. The `--blender` executable interface targets Blender 4.5 and later, but executable-mode, other Blender versions and other platforms still require qualification. Blender 6 is not qualified: the current material initialization uses `use_nodes`, whose removal is anticipated by the retained runtime warnings. Version-aware initialization and tests are required before claiming Blender 6 support.

## Import a vector

The original demonstration provides a ready-to-run input:

```bash
arc-science figure-import examples/vector-rendering/source/response-fixture.svg \
  --project ./figure-project \
  --provenance-file examples/vector-rendering/source/provenance.json
```

Use the returned `asset_manifest` path in the render command. Importing the corresponding PDF exercises the PDF path. An asset bundle contains `asset.json`, `source.svg` or `source.pdf`, and `source.png`. Its identity binds the original file, proof, converter and provenance.

For BioRender artwork, the provenance JSON needs `origin="biorender"`, a title, the public-template `source_url`, matching `template_id`, a specific `permission_note`, and `external_rendering_authorized=true`. Use that assertion only when the intended external rendering is authorized. User-owned artwork and synthetic fixtures have distinct origin values.

BioRender URLs must be exactly `https://app.biorender.com/biorender-templates/details/t-<template_id>`, optionally followed by `?source=mcp`. For Protein Homology Modeling, the template ID is `62c743fda5cf881ed2d8695f` and the recorded URL is the detail link above. Credentials, ports, fragments, other hosts, extra paths, mismatched IDs and other or duplicate query parameters are rejected.

Input limits are 16 MiB and one PDF page. Deeply nested PDF forms are rejected when complete inspection cannot be assured (maximum accepted form level 15). PDFs must contain text or path objects; image-only PDFs are rejected and mixed content is identified. SVG support is deliberately explicit: static shapes, text, groups, clips and gradients. Unsupported or active content is rejected with an error. This avoids silently removing part of a figure during import.

The SVG attribute subset excludes `textLength`, `lengthAdjust`, `pathLength`, radial-gradient `fr` and `dominant-baseline`: the pinned CairoSVG converter does not implement their semantics faithfully. Supported attributes do not imply complete SVG typography or cross-platform font fidelity; inspect the flat proof when qualifying artwork and its converter environment.

## Render and verify

```bash
arc-science figure-render /absolute/path/to/asset.json \
  --project ./figure-project \
  --blender-python "$PWD/.blender-env/bin/python" \
  --style studio --width 1600 --height 1200 --samples 64

arc-science figure-verify /absolute/path/to/render-run
```

`studio` provides a thin backing panel, a soft shadow and an orthographic view. `flat` is a front-facing presentation. Both preserve the original artwork's aspect ratio. The scene representation is recorded as `rasterized_vector_panel`; it does not infer 3D structures from a 2D illustration.

Each invocation creates a new run. It retains the verified source bundle under `inputs/`, job and reservation records, the worker log, `scene.blend`, `render.png` and a terminal receipt. The image is packed into the Blender scene so the project can be moved. Failed runs keep their available intermediate files and an explicit failure state.

Verification regenerates the flat source proof and checks the bound asset, job, completion record and output files. It does not re-run Blender, authenticate rights, establish scientific validity or prove that a remote claim is correct. Changes to converter versions, fonts, Blender or the platform can change output pixels; inspect and qualify those changes before accepting a new environment.

## Keeping project checkpoints

Use one project directory for the inputs and render runs you want to retain. Preserve complete runs rather than copying only their PNGs. The deployment archive includes the demonstration's source, settings, rendered scene, outputs and qualification evidence. The working checkpoint archive records intermediate development stages separately from the final release.
