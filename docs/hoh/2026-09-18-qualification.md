# Local release-candidate qualification — 18 September 2026

This records completed local development and its limits. It is not a declaration
that every production or scientific gate has passed. The previous molecular
increment is retained and integrated with this work.

## Operating behavior

Harness-of-Harness is installed as the user's substantive-development default in
`C:/Users/danil/.codex/AGENTS.md`, with the validated skill at
`C:/Users/danil/.agents/skills/harness-of-harness/SKILL.md` and a project `AGENTS.md`.
The project keeps separate specification, plan, implementation and evaluation
records. Native Codex agents planned, implemented and independently reviewed bounded
desktop, memory and source-intake work.

The [HoH paper](https://arxiv.org/html/2609.01481v1) informed the role separation and
artifact/evidence continuity. This is an operating adaptation, not a reproduction
of its benchmark runtime. Reviews used the shared working tree, not hard sandbox
isolation. A fresh bundled Codex 0.155.0-alpha.9 process confirmed the default;
the older global 0.149.1 CLI rejected the configured model. The desktop conversation
was not restarted, and no model was silently substituted.

## Delivered changes

- Rust desktop: literal executable/argument configuration, numeric-loopback URLs,
  root health probing without proxy/redirects, exact application marker, actionable
  startup failure, bounded readiness, local-origin navigation and downloads.
- Native supervisor: opt-in parent-stdin EOF lifetime, a Windows completion-queue
  shutdown fix, and Windows access to the existing typed BioArt bridge.
- PowerShell launcher: supervised default path, existing configuration preservation,
  optional builds and Blender runtime, safe spaced/Unicode paths, environment restoration.
- Memory: truthful capabilities and capture status, coalesced capture, dead-worker
  recovery, idempotent retained-snapshot reconciliation and shutdown drain; bounded
  frames, search results and session recall; explicit pages/ranges and retention counts.
- Shared-token privacy fences in Memory/Research and a readable replay summary
  with full details behind a disclosure.
- NIH: direct-entry UI fallback, bounded missing-MIME SVG intake, encoding-aware XML
  processing-instruction rejection, passive-source checks, exact-byte preservation
  and truthful download-only eligibility. Strict vector import validation is unchanged.
- Scientific audit: verified prior art and corrected novelty/statistical overclaims
  in the existing thesis. No biological benchmark or clinical validation was performed.

Existing libraries, scientific workers and process supervision were reused. No
dependency manifests changed. No public deployment or repository publication occurred.

## Fresh verification

| Check | Result |
| --- | --- |
| Complete Python app suite, inherited `PYTHONUTF8=1` | **644 passed, 63 skipped**, 68.53 seconds |
| Complete frontend suite | **44 passed** across 6 files |
| Frontend production build | Passed; packaged compiled JS is 382,438 bytes |
| Rust desktop | **12 passed**; one ignored helper is invoked by its owning subprocess test |
| Rust native supervisor | **24 passed** across argument, configuration and process suites |
| Rust memory | **32 passed**, one latency measurement ignored |
| Rust formatting/Clippy | Passed in developer checks for the changed crates |
| Python compilation, PowerShell syntax, diff checks | Passed |
| Wheel build and installed-package HTTP/cleanup check | Passed; 20 frozen public assets unchanged |
| Independent evaluation | Desktop/lifecycle, memory/privacy and SVG intake findings resolved and independently retested |

Wheel SHA-256: `29b76553476f24b91c4c4520e13a4c0d4d8c845bbadea800ca455e78d291f174`.
The native Python bridge tests now locate the Windows `.exe` and compare actual
file identity despite extended-length path prefixes; all four execute and pass.
Skips remain explicit POSIX mechanisms, symlink privileges and opt-in renderer gates;
they are not equivalent Windows coverage. Actual molecular rendering was separately
exercised through the browser, and earlier explicit Blender integration tests passed.

## Native measurements

Release Rust desktop size: **4,300,288 bytes**. Supervisor: **1,164,800 bytes**.
Memory worker: **2,723,840 bytes**.

Three actual PowerShell-launcher runs, each starting the real native supervisor and
Python service and then shutting them down, took **2,890 / 2,730 / 2,730 ms** on this
Windows workstation (median 2,730 ms). Port 8092 had no listener afterward. These are
headless launch-through-cleanup measurements, not window-paint time or a latency SLO.
Independent Windows PowerShell 5.1 runs with spaced/Japanese paths also passed at
3.296 / 3.211 seconds; fresh default initialization passed at 3.306 seconds.

The actual reused-service check passed with a deliberately absent executable and
the existing service still returned HTTP 200 afterward. An idle snapshot after
reconciling two qualification missions measured the memory worker at 5.8 MiB working
set/0.8 MiB private bytes and Python at 66.5 MiB/52.4 MiB. These are one-time small-corpus
observations, not whole-desktop memory use or scalability evidence. No native WebView
RSS/CPU or paint timing was obtained.

## Interactive acceptance

See [the action-level browser record](2026-09-18-browser-qa.md). Supported Playwright
locators drove visible controls without a generated browser test script. Observed:
research creation, three decision branches, reconciliation, recomputation, capsule
downloads, round-budget handling and cancellation; memory recovery, lexical search,
scope, paging/ranges, retention counts and token clearing; molecular file upload,
active cancellation, complete Blender rendering, downloads and example navigation.

Live NIH entry 18 inspection, source transfer, verified receipt and original browser
download succeeded. The 8,373-byte SVG retained hash
`deae8113d2416bf6497d6fd43bb995305824f56ec25f1bfd9960616e499dcade`.
The UI correctly denied preview/import of that unsupported source, and cache-only
reuse worked. Missing consent for live models produced 422; with consent, absent
provider configuration produced an actionable 409 before external model execution.

## Review-driven corrections

Independent checks found and retested fixes for dropped final memory reconciliation,
unusable large-session recall, aggregate decoded-search allocation, stale credentials,
PowerShell application discovery and quoting, UTF-16 stylesheet processing instructions,
and SVG animation-based external references. Earlier molecular cancellation/polling
and packaging corrections remain covered. The author did not self-label these
independent findings as passing without the reviewer retest.

## Remaining gates

- **Native GUI acceptance:** automatic approval review rejected the combined shell
  GUI-launch command with only `blocked by policy`; native-window automation is not
  enabled. Actual native visual interaction/download completion remains unverified.
- **Crash containment:** the Windows supervisor's cooperative parent-pipe exit is
  tested. Forced supervisor termination does not guarantee kill-on-job-close cleanup.
- **Memory scope:** recovery deliberately covers the latest 100 retained missions and
  reports degraded status beyond that. A real embedder, semantic-quality evaluation
  and large-corpus session-list/candidate-scan benchmarks remain outstanding.
- **NIH compatibility:** dynamic keyword search needs a reviewed rendered-search
  adapter. The actual NIH SVG has unsupported dimensions/metadata/style features;
  transforming it for import is a separate provenance/renderer qualification gate.
- **Science:** [the novelty audit](../arc-science/usability-thesis/novelty-audit-2026-09-18.md)
  used alphaXiv, Undermind and primary literature. Novelty is unestablished; within
  synonymous variants the proposed gate preserves genomic-score ranking. Paired
  mechanism labels, real model scores and confirmatory experiments are absent.
- **Providers and release:** model/vision credentials, signed installers, macOS/Linux
  runtime qualification, inherited Vedix root-suite qualification and independent
  scientific/publication review are not established. The retained bpy environment
  still emits its NumPy ABI warning; a separate pinned runtime is preferable.

The accepted outcome is a tested local development candidate with specific corrected
defects and preserved evidence. Remaining gates must not be relabelled production
readiness, originality or scientific validity.
