# Arc Science development scope

This is a development application, not a certified scientific platform or a completed Rust rewrite. The verification record and retained reviews identify the exact tested revision.

**Open Important finding I1:** native's repeated-cancellation force path can kill
Python before it cleans up its detached renderer. Ordinary cooperative
cancellation/acquisition/setup tests pass; they do not close this integration gap.
Native-supervised rendering and merge qualification remain blocked. Configuration,
offline BioArt, preserved figures and other passing tests retain their narrower
evidence. [Current verification](bioart-setup-verification-2026-09-08.md) records
the result and links the earlier qualification.

| Requirement | Implemented boundary | Qualification still needed |
| --- | --- | --- |
| Arc Science in the Vedix repository | App under `apps/arc-science`, Arc Science root README, original Vedix plugins and history preserved | GitHub write access and repository-slug rename |
| HeroUI workbench | Actual HeroUI components, molecular views, zoom, export, authenticated Research workspace | Browser pixel review; current evidence is DOM interaction, build and served bytes |
| White molecular collages | Frozen 1DQJ candidate03, three transparent Blender views, annotated SVG views, coordinate-derived contact CSV and matrix | New structures, native renderer requalification and publication-specific review |
| NIH BioArt intake | CLI metadata inspection, SVG/default neutral selection with explicit override, entry-bound files, bounded consent-gated transfer, cache, receipts and checked import | Live vector retrieval, real NIH SVG compatibility and an integrated asset-browser UI |
| BioArt rights | Entry-specific credit retained; automation currently limited to exact Public Domain entries | Other license policies require review; no whole-catalog reuse assumption |
| Reliable network behavior | Owned transport in a deadline-bound process; no redirects or permission bypass; offline fault tests | Service availability and future website-schema compatibility |
| Native Rust application | Strict TOML configuration, exclusive `init --python`, config/doctor/serve/worker and typed BioArt commands, direct argument launch, tested cooperative cancellation and measured Linux release | Open I1 force-cancelled renderer containment; Windows/macOS execution and signed desktop installers; calculations still run in Python |
| HoH foundation | Bounded candidate work, fixed roles, single writer, independent QA and evidence preservation | Broader harness evolution and scientific-validity evaluation |
| Scientific image review | Exact candidate bytes/hashes and separate reference roles supported by provider protocol | Live provider-based comparison in this environment |
| Programming/ML diagrams | React Flow with ELK researched as a later editor | Shared graph model, editor and controlled SVG export not shipped |
| MD and mathematical results | No synthetic result is presented as measured MD or a Lean-checked theorem | Actual trajectory analysis and isolated Lean proof gate not shipped |

The static 1DQJ example uses HyHEL-63 Fab chains A+B and lysozyme chain C. Its 49 residue contacts are geometric heavy-atom distances at or below 4 Å, not measured binding affinity, hydrogen-bond assignments or molecular-dynamics results. The atomic-density envelope is an approximation, not a solvent-excluded surface.

Public source excludes publisher-reference pixels and large editable Blender scenes. [Historical evidence and companion archives](historical-evidence.md) locate the retained editable render bundle and earlier review material. [BioArt and native research](bioart-native-research.md) distinguishes observed sources, design recommendations and unavailable integrations.

The [BioArt setup research addendum](bioart-setup-research-2026-09-08.md) explains
format-aware neutral selection, cache efficiency, interpreter portability and
recent scientific-agent evidence. Native offline integration uses source-derived
entry metadata with explicitly synthetic SVG bytes: it does not establish that a
live NIH vector was retrieved or that an actual NIH SVG passed validation.

## Known maintenance items

The preserved Vedix plugin suite passed 443 tests, but the broader inherited root suite returned 24 failures related to proxy support, publisher dependencies and template files. The source/test trees match the original repository. [Legacy verification](legacy-verification.md) records the exact scope and failure categories; no all-repository passing claim is made.

The current scientific test environment reports NumPy/scikit-image marching-cubes deprecation warnings. The client-only HeroUI build reports three `use client` directive warnings. Passing tests do not erase this dependency-maintenance work; the warnings are not blanket-suppressed.

The BioArt cache requires POSIX no-follow/descriptor primitives and rejects unsupported platforms before creating a cache. A portable native launcher cannot make the Python importer Windows-compatible by itself. Neither source-level CI configuration nor a Linux binary qualifies unexecuted Windows/macOS builds.

The native launcher is noninteractive, with null input and inherited output. Its `doctor` checks local executable presence, not package imports or scientific validity. [Native setup and limits](../../native/arc-science/README.md) describe the Python bridge, cancellation scope and Linux measurements.
