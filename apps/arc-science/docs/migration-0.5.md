# Arc Science 0.5.0 development

The reviewed application was imported under `apps/arc-science` from the recovered
checkpoint through original commit `8a68f2e`. Core runtime modules, workers and all
447 existing tests were copied, not reimplemented. The initial imported baseline
was 441 passing tests with six explicit native-Blender skips.

## Public example and UI

`GET /api/examples/1dqj` is public and returns fixed scientific metadata and an
explicit file allowlist with actual byte sizes, SHA-256 hashes and download URLs.
`GET /api/examples/1dqj/assets/{filename}` serves only that allowlist. Unknown
names and traversal are rejected. These assets are independent of private mission
storage; mission routes and artifact downloads still require the operator token.

Candidate 03's original collage PNG and SVG remain byte-identical. Focused SVGs
change only root viewport/size metadata; their image content, labels and annotation
elements are untouched. Each declares its source SVG SHA-256. Native transparent
PNG views have no labels. The endpoint and UI distinguish them from annotated SVGs.
The fixed SVG responses use a restrictive content-security policy that allows
their embedded raster data but no scripts. The rest of the application retains
its existing policy.

The wheel includes the compiled React/HeroUI 3 application and the example files.
`npm run build` packages Vite output into `src/arc_science/static/web`. `/` serves
the workbench; `/diagnostics` retains the diagnostic console. Research state stays
mounted during workspace switches, with tokens only in memory. Mission creation
preserves egress and visual-review consent; selection, start/resume/cancel,
verification, capsule export, visual reports and authenticated artifact inspection
are available in the workbench.

## Included and excluded material

Included: runtime source/tests/configuration, original setup files, workers,
frontend source, top-level historical Markdown documentation, original synthetic
SVG/PDF fixtures, candidate 03 coordinates/scene/captured worker, original exports,
contact CSV, integrity records and historical image-review text.

Excluded: environments, caches, deployment ZIPs, `.blend` scenes, publisher artwork,
raw publisher HTML, private screenshots and candidates 01/02. The historical review
packet is published only as a metadata derivative with roles/hashes; all embedded
candidate/reference pixels were removed. Its original packet digest is identified
as historical, not asserted to validate the derivative. `manifest.json` records
the original complete run, including `.blend` hashes; `integrity.json` records
what is actually in this public subset. No public `.blend` download is advertised.

`scripts/package-molecular-example.mjs CHECKPOINT_ROOT` documents the one-time
filtered asset import and verifies the independently frozen collage hashes. It
does not alter or rerender the source candidate. The regular build does not need
the private checkpoint.

## Runtime and evidence boundaries

Use a fresh data directory. Capsules bind Arc version and require their matching
verifier; retain historical deployments for historical capsules. The source's
`requirements*.lock`, Docker configurations and older documentation are retained
as historical setup references, not newly qualified deployments. The current
source installation instructions use the package's dependency declarations.

Geometric residue proximity does not establish hydrogen bonds, affinity, energetic
hotspots or biological validity. The Gaussian envelope is approximate, not a
solvent-excluded surface. Rotated detail shows three nearest pairs, not the whole
interface. Historical illustration acceptance is not publication authorization.

No live-provider execution, new Blender render or browser-pixel validation was
performed in this migration. Local HTTP and shared-file HTML browser previews had
been rejected by policy; no alternate hosting or browser workaround was used.
DOM interactions, production build and served artifact bytes are the new evidence.
HoH fixed roles/frozen candidates/independent QA remain the foundation. Broad
scientific composition, self-evolving harness proposals and Lean proof obligations
are separate development requirements, not implemented or qualified here.
