# Arc Science development scope

This is a development application, not a certified scientific platform or a completed Rust rewrite. The verification record and retained reviews identify the exact tested revision.

**Important finding I1 is independently approved and locally resolved for the Linux
executor:** a private watchdog owns the renderer group and observes
Python through a non-inherited liveness pipe. Deterministic regressions prove cleanup
on both repeated native cancellation and a successful renderer-leader exit with a
live descendant. The rejected environment-marker design and its Rust changes were
removed; the final native integration runs with the retained binary and no injected
marker. [Current verification](renderer-containment-verification-2026-09-09.md)
records the exact evidence and limitations.

| Requirement | Implemented boundary | Qualification still needed |
| --- | --- | --- |
| Arc Science in the Vedix repository | App under `apps/arc-science`, Arc Science root README, original Vedix plugins and history preserved | GitHub write access and repository-slug rename |
| HeroUI workbench | Actual HeroUI components, molecular views, zoom, export, authenticated BioArt and Research workspaces | Browser pixel review; current evidence is DOM interaction, build and served bytes |
| White molecular collages | Frozen 1DQJ candidate03, three transparent Blender views, annotated SVG views, coordinate-derived contact CSV and matrix | New structures, official Blender requalification, and publication-specific review |
| NIH BioArt intake | CLI and HeroUI search/inspection, format-aware neutral selection with explicit override, entry-bound files, consent-gated transfer, verified previews/downloads, cache receipts and checked SVG import | Live vector retrieval and real NIH file compatibility |
| BioArt rights | Entry-specific credit retained; automation currently limited to exact Public Domain entries | Other license policies require review; no whole-catalog reuse assumption |
| Reliable network behavior | Owned transport in a deadline-bound process; no redirects or permission bypass; offline fault tests | Service availability and future website-schema compatibility |
| Native Rust application | Strict TOML configuration, exclusive `init --python`, config/doctor/serve/worker and typed BioArt commands, direct argument launch, tested cooperative and repeated cancellation, Python-owned renderer watchdog, and measured earlier Linux release | Windows/macOS execution and signed desktop installers; calculations still run in Python |
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
