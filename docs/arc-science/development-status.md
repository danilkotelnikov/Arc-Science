# Arc Science development scope

This is a development application, not a certified scientific platform or a completed Rust rewrite. The verification record and retained reviews identify the exact tested revision.

Current continuation: [local molecular workbench](molecular-workbench-2026-09-18.md),
[Windows-native port](windows-native-port-2026-09-18.md), and
[native memory implementation](native-session-memory-qualification-2026-09-16.md).
Older verification records below remain historical evidence with their original scope.

**Important finding I1 is independently approved and locally resolved for the Linux
executor:** a private watchdog owns the renderer group and observes
Python through a non-inherited liveness pipe. Deterministic regressions prove cleanup
on both repeated native cancellation and a successful renderer-leader exit with a
live descendant. The rejected environment-marker design and its Rust changes were
removed. The original review used the retained binary without an injected marker.
On 2026-09-11 the same product source passed integration with a freshly rebuilt
Rust executable. [Renderer review](renderer-containment-verification-2026-09-09.md)
and [fresh qualification](qualification-2026-09-11.md) distinguish those runs.

| Requirement | Implemented boundary | Qualification still needed |
| --- | --- | --- |
| Arc Science in the Vedix repository | App under `apps/arc-science`, Arc Science root README, original Vedix plugins and history preserved | GitHub write access and repository-slug rename |
| HeroUI workbench | Actual HeroUI components, molecular views, zoom, export, authenticated BioArt and Research workspaces | Browser pixel review; current evidence is DOM interaction, build and served bytes |
| White molecular collages | Frozen 1DQJ candidate03 plus authenticated local coordinate-to-Blender jobs, white collage, contact CSV and provenance downloads | Structure-specific visual review and publication-specific review; successful computation is not scientific validation |
| NIH BioArt intake | CLI and HeroUI search/inspection, format-aware neutral selection with explicit override, entry-bound files, consent-gated transfer, verified previews/downloads, cache receipts and checked SVG import | Live vector retrieval and real NIH file compatibility |
| BioArt rights | Entry-specific credit retained; automation currently limited to exact Public Domain entries | Other license policies require review; no whole-catalog reuse assumption |
| Reliable network behavior | Owned transport in a deadline-bound process; no redirects or permission bypass; offline fault tests | Service availability and future website-schema compatibility |
| Native Rust application | Native supervisor plus `native/arc-desktop` WebView shell and transparent Snöggo SVG icon; scientific calculations remain in Python. Windows worker/renderer paths are implemented | Signed desktop installers, macOS execution, and qualification of each process-lifecycle boundary |
| Native agent/session memory | Rust SQLite/zstd storage and worker, lexical search, Python capture/API and Memory workspace; see [qualification](native-session-memory-qualification-2026-09-16.md) | Provision a real embedder, benchmark semantic recall/latency, freeze retrieved context into replay evidence, and expose capture failures |
| HoH foundation | Bounded candidate work, fixed roles, single writer, independent QA and evidence preservation | Broader harness evolution and scientific-validity evaluation |
| Release ledger | Eight named checks in six explicit states (`satisfied`, `failed`, `unknown`, `error`, `stale`, `not_applicable`) with per-check bases; `POST /api/missions/{id}/verify` persists the receipt; capsule export and PNG download consult the decision; the only positive outcome is "eligible for human review" | Human review itself; the ledger never states scientific validity |
| Figure repair cycles | A visual review whose findings are all presentation categories (legibility, layout, labels, overlap, contrast, legend, ticks, size) is answered by re-rendering the same data under the next preset (`spacious`, then `large_text`) and reviewing the result as a new candidate with fresh eyes; at most two cycles per round; substance findings, blocking findings, `uncertain`, reviewer errors, a spent budget and a render that repeats an existing image end the cycle with a recorded reason; superseded images stay in the state and reproduce in the capsule | Live vision seats; the scripted demo seat only exercises the mechanism |
| Claim-strength adjustment | At every stop the engine derives, per hypothesis, the requested claim, the evidence-supported scope (both roles' supporting findings, qualified as exploratory-split evidence), the remaining uncertainty (challenged, uncertain, missing independent role, untested) and the next discriminating tests; status is `provisionally_supported` only with both roles supporting under two distinct model identities and nothing open (one role recording several positions in a round stands by the most cautious), otherwise `contradicted`, `unresolved` or `unassessed`; the evidence graph, the capsule verifier and the `claim_scope` ledger check reject a scope that does not follow from the recorded reconciliation | Independent data; the scope narrows a claim and never validates one |
| Change-effect declarations | Every operator change declares its effects (`presentation`, `scientific_depiction`, `analysis`, `claim`, `permission`); the server derives the actual effects and refuses a narrower declaration; each effect names the checks it obliges. Resuming a stopped mission is recorded as a change (analysis + claim) and marks every release check stale until re-verified; `POST /api/missions/{id}/changes` applies a resume or refuses claim/permission/presentation/analysis kinds with the table's reason; a molecular re-render of the same coordinates may declare itself a change of a completed base render and records the derived effects, the changed fields and its obligations as `unknown` (no checker exists) — the base render is never touched; disabling a memory record answers with a zero-effect declaration. Each mission change binds to a `change_declared` event and the history before it, and the evidence graph rejects a resume without one; a resume's obligations are read from the release ledger, never stored | Operator edits beyond these two; a reviewable presentation change to mission figures outside the engine's repair cycles |
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

The BioArt cache now has separate POSIX and Windows paths. Windows rejects reparse
points but lacks POSIX directory-descriptor anchoring, and its fetch deadline is
cooperative. Passing POSIX-only tests through skips does not establish equivalent
Windows guarantees. Live NIH transfer remains a separate qualification gate.

The native launcher is noninteractive, with null input and inherited output. Its `doctor` checks local executable presence, not package imports or scientific validity. [Native setup and limits](../../native/arc-science/README.md) describe the Python bridge, cancellation scope and Linux measurements.
