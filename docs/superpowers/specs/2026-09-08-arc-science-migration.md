# Arc Science development migration

The user explicitly identified `danilkotelnikov/vedix` as the existing GitHub project to develop into Arc Science. Its current head is `8c5807f573ffb2731ee3232fcae91da1c26b47d7`. This increment makes the reviewed Arc Science application usable within that repository and completes its molecular HeroUI workbench. The repository is a development project, not a qualified autonomous scientist.

## Preservation and naming

Preserve Vedix's existing plugin implementation, identifiers, installers, home-directory conventions and history. Introduce the Arc Science application under `apps/arc-science`. The root README presents Arc Science and links a preserved Vedix README for legacy installation. Do not claim that changing product branding renames the GitHub repository slug. The available GitHub connector can write code and pull requests but exposes no repository-rename action.

## Imported scientific application

The authoritative source is `/workspace/scratch/0894be2b5454/arc-science-0.5-recovered/arc-science`, recovered from the approved checkpoint through original commit `8a68f2e`. Import its runtime source, tests, configuration, workers, frontend source, setup files and relevant original documentation. Do not import environments, caches, old deployment ZIPs, publisher reference images/HTML, private user screenshots, or previous intermediate candidates into the public repository.

The accepted original molecular output is candidate03 from that checkpoint: HyHEL-63 Fab author chains A+B with lysozyme chain C, RCSB1DQJ, model1, verified identity assembly1. The full table has49 geometric residue-contact pairs at minimum heavy-atom distance≤4Å. Preserve the accepted collage PNG SHA256 `7394f162dca9bba20ca985a2cd43473da2c9df7d88be5e39acaec81f30f598d9` and SVG SHA256 `71cfeb7a84177e18a6cc00cff54c6449e985dd30718e209136513553562682c6`. The Gaussian atomic envelope is approximate, not a solvent-excluded surface. The rotated detail shows three nearest residue pairs, not every interface contact.

Public examples include original PNG/SVG exports, contact CSV, source coordinates, scene specification, captured worker and integrity/review records. Large `.blend` files remain in the separately delivered editable molecular bundle; do not present a nonexistent public `.blend` download. The public source and captured worker must remain sufficient to reproduce scenes using the documented Blender setup.

## Usable HeroUI workbench

Use actual HeroUI3 React components, retaining Arc Science branding. Use the supplied screenshots as layout references: compact header, narrow neutral sidebar, largest possible white scientific stage, quiet tabs and one primary export action. All collage canvases and molecular-stage backgrounds are #FFFFFF; molecular PNGs retain alpha. Antibody is muted blue, antigen neutral gray; no slabs, floors, gradients or decorative cards on figures.

The default workspace shows the accepted collage. Provide full-complex, interface and rotated focused views that preserve SVG annotations. Native transparent PNGs are separate, clearly labelled downloads. Zoom and export controls must operate on real artifacts. No fake structure upload or render controls.

Preserve the served diagnostic console's Research behavior, including goal, mode, round limit, egress and `vision_review` consent, mission selection/start/cancel/resume/verify/capsule export, and authenticated artifact inspection/download. Switching workspaces retains Research state. Tokens remain in memory, not browser storage. Rendering custom structures uses the actual CLI if no server renderer exists.

The public example endpoint serves only an explicit allowlist of packaged assets, with accurate hashes/sizes and fixed source metadata. Reject traversal and unknown assets. Include those assets and the compiled UI in the installed wheel. Do not expose arbitrary filesystem paths.

## Evidence and qualification

Generic rendering defaults to publication white; explicit Studio/Flat modes remain legacy options. Molecular defaults are1400px collage width,96samples,seed23. A frozen image review packet binds candidate/reference roles and image hashes. Arc live-provider execution was not available in the prior session and must not acquire a passing badge from mock transport tests.

The prior browser security policy rejected localHTTP and shared-fileHTML previews. No alternate browser/hosting workaround is permitted for that blocked preview. Compile the actual UI and run real DOM interaction and service/download tests; leave browser pixel layout unverified. Existing molecular exports were directly visually inspected in three iterations.

HoH is the fixed-role, single-writer, frozen-candidate, independent-QA foundation. Self-evolving harness proposals, broader scientific composition, and Lean proof obligations are separate development requirements; document their actual status rather than claim this migration implements or qualifies them. Current primary research informs that roadmap. No bypass of access controls, unavailable BioRender assets, or scientific-evidence requirements is permitted.

## Delivery

Publish tested source changes to a development branch and open a draft pull request against `master`. Do not force-push, merge, remove existing Vedix code, or alter repository visibility. The user has authorized the development submission. Verify the resulting GitHub commit/ref and pull request before reporting success.
