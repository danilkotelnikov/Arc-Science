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

- **Native GUI acceptance:** closed on 2026-09-18 (Claude native-GUI loop, below).
  The real WebView2 window was driven through Windows UI Automation: workbench
  controls exposed, window captured, a real Export SVG download completed and hashed,
  the external link opened the system browser after its fix, and closing the window
  released the supervisor, service and port. Manual mouse/keyboard use of the native
  window and other platforms remain unobserved.
- **Crash containment:** closed on 2026-09-18 (Claude follow-up loop, below). Both
  halves were reproduced as real orphans before the fix and now hold under forced
  termination: a Windows kill-on-close job object in the Python service contains each
  render tree, and the native supervisor joins its own kill-on-close job before
  spawning so a forced supervisor kill reaps the worker and descendants.
- **Memory scope:** recovery deliberately covers the latest 100 retained missions and
  reports degraded status beyond that. Large-corpus session-list/candidate-scan
  benchmarks were measured and the failing lexical case fixed on 2026-09-19
  ([record](2026-09-19-memory-scale.md)). A real embedder and semantic-quality
  evaluation remain outstanding.
- **NIH compatibility:** dynamic keyword search needs a reviewed rendered-search
  adapter. The actual NIH SVG has unsupported dimensions/metadata/style features;
  transforming it for import is a separate provenance/renderer qualification gate.
- **Science:** [the novelty audit](../arc-science/usability-thesis/novelty-audit-2026-09-18.md)
  used alphaXiv, Undermind and primary literature. Novelty is unestablished; within
  synonymous variants the proposed gate preserves genomic-score ranking. Paired
  mechanism labels, real model scores and confirmatory experiments are absent.
- **Providers and release:** model/vision credentials, signed installers, macOS/Linux
  runtime qualification, inherited Vedix root-suite qualification and independent
  scientific/publication review are not established. 2026-09-19: the Claude
  subscription route exists (`claude-code` transport) and reached the API from this
  workstation, which refused for credits; live execution stays blocked on the account
  ([program record](2026-09-19-program-record.md), loop 4). The retained bpy environment
  still emits its NumPy ABI warning; a separate pinned runtime is preferable.

The accepted outcome is a tested local development candidate with specific corrected
defects and preserved evidence. Remaining gates must not be relabelled production
readiness, originality or scientific validity.

## Follow-up loop — 2026-09-18, Claude (bug fixing on the accepted candidate)

Every suite was re-run on this workstation before edits and matched the table above
(Python 644/63, frontend 44, Rust 12/24/32). The fixes below each began with a failing
test or a live reproduction; nothing was relabelled from test passes alone.

| Defect | Evidence | Fix |
| --- | --- | --- |
| A render could start after service shutdown began: `close()` did not take the job lock, and `submit` checks `closing` before awaiting the first readiness probe (a multi-second subprocess). | Test parks `submit` on a gated probe, runs `close()`, releases the probe; a `_worker` task was left running. | `close()` serializes on the lock; `submit` re-checks `closing` after its await and returns 409. |
| Render failures were opaque: stderr was discarded, so a wrong chain ID reported only "verify coordinates, chain selections and server runtime" while the CLI had printed `Requested author chain is missing: H, L`. | Live service: wrong chains and an unknown assembly both returned the generic text. | Bounded 4 KiB stderr tail; only a sanitized `ValueError:`/`RuntimeError:` last line (<=200 chars, no paths, no control characters, no job/root directory string) is surfaced. Path-bearing errors stay generic, as the existing private-path test requires. |
| Service crash orphaned the render tree. | Live: after `taskkill /F` of only the service, the CLI and its Blender child kept running at full CPU (2 processes). | Kill-on-close job object around each render (`figure_render._kill_on_close_job`); 0 processes after the same crash; job recovers as `interrupted` on restart. Windows-only test closes the job handle and asserts a spawned grandchild dies. |
| Supervisor crash orphaned the Python service. | Live: `taskkill /F` of only `arc-science-native.exe` left the service listening; the next launch failed to bind (WinError 10048). `process-wrap`'s std `JobObject` is created with `kill_on_drop=false` and keeps its handle private. | Supervisor joins its own kill-on-close job before spawning (`native/arc-science/src/containment.rs`, raw kernel32 FFI, no dependency change). Integration test force-kills the supervisor and requires the worker and its descendant to disconnect; it failed before the fix. |

Final checks after the loop: Python **647 passed, 63 skipped**; supervisor crate 26 passed
with clippy `-D warnings` and rustfmt clean; interactive browser pass of the Molecules
render panel and the Memory workspace against a live service with no console errors.
Still open and unchanged: native GUI acceptance, memory scope/embedder, NIH search
adapter, scientific novelty, providers and release.

## Native GUI loop — 2026-09-18, Claude (native window acceptance on the accepted candidate)

The desktop was launched five times through `scripts/start-arc-science.ps1` (real
supervisor, Python service, workspace under `%LOCALAPPDATA%\ArcScience\workspace`, port
8080) and driven with `scripts/native-gui-acceptance.ps1`: Windows UI Automation against
the WebView2 tree (`WRY_WEBVIEW` → `Chrome_WidgetWin_1`), `PrintWindow(PW_RENDERFULLCONTENT)`
for pixels, file-system and process checks for outcomes. This is accessibility-driven
interaction, not manual mouse acceptance.

| Check | Observed |
| --- | --- |
| Window and tree | `Arc Science` window from `arc-science-desktop.exe`; supervisor and service PIDs as its descendants; 84 UIA elements, 60 named; Molecules/BioArt/Research/Memory buttons, tabs, Export SVG and hyperlinks exposed and enabled. Chromium accessibility needed one initial walk plus retries (about 20 s before the navigation group answered). |
| Visual | PrintWindow rendered the workbench (collage, inspector, navigation) at 2586×1630 physical px on a 200 % display; a plain screen copy was abandoned because it captured whichever window was in front. |
| Download | UIA `InvokePattern` on Export SVG → `1dqj-collage.svg`, 765,081 bytes, SHA-256 `71cfeb7a…2682c6`, byte-identical to the served asset and its recorded digest; a second export produced `1dqj-collage (1).svg` (WebView2 writes `<guid>.tmp` then renames). Files remain in the user's Downloads folder. |
| External link (before fix) | `InvokePattern` on `1DQJ ↗ RCSB PDB`: no new window, no browser process — every `target="_blank"` link (RCSB, NIH search, NIH source) was dead in the native shell because new windows were denied outright. |
| External link (after fix) | The default browser opened `RCSB PDB - 1DQJ: …` (window title observed); no second WebView was created. |
| Download feedback | Neither wry's silent handler nor the handler-free default produced any WebView2 download dialog on this runtime (Evergreen 153.0.4234.32), even with wry's `msWebOOUI` disabling removed as an experiment; a download was invisible to the user. After the fix the header announces `Saved 1dqj-collage (4).svg in C:\Users\…\Downloads` (native capture). |
| Lifecycle | `WindowPattern.Close` → desktop exit, supervisor and service exited within 2 s, no listener on 8080, launcher exit 0 — five of five runs. |

Fixes (desktop crate; no dependency change; `native/arc-desktop/src/external.rs`, `main.rs`):

- New-window requests hand a clean `https:` target to the system browser via
  `ShellExecuteW` (no shell) and deny the WebView; other schemes, userinfo, whitespace
  and control characters are refused. Unit test covers accept/refuse cases.
- The download-started gate (which forced `Handled` and hid all UI) was removed: every
  downloadable URL is same-origin by construction because navigation is; a
  download-completed handler posts a `Shell::DownloadFinished` event that the event
  loop turns into an `arc-download` window event (`file`, `folder`, `success`) with a
  tested JavaScript-literal escaper. The React header shows the outcome for 12 s
  (`DownloadNotice`, RED→GREEN test).
- The WebView2 profile moved from beside the executable (`target/release/…exe.WebView2`,
  unwritable for an installed copy) to `%LOCALAPPDATA%\ArcScience\webview`.

Not explained: on the very first launch the `Rotated detail` tab was selected by the
time the first capture was taken (~20 s after the window appeared) and the window was
later found minimized; a remote-desktop session was the foreground window on this
workstation at the time. Four later launches with the identical automation sequence,
including a probe that captured before any accessibility client attached, all showed
`Collage` selected. It is recorded as a single unreproduced observation, most likely a
human interaction, not as a defect.

Checks after the loop: desktop crate 14 passed (clippy `-D warnings`, rustfmt clean);
frontend 45 passed; Python 647 passed, 63 skipped (with `ARC_SVG2PNG` set, as the
launcher does); packaged bundle rebuilt (`index-DDlXz42c.js`, 382,990 bytes).
Sol (GPT-5.6) was consulted on the plan; the first attempt hit the Codex usage limit
and the second answered after the user renewed it. A leftover verification service
from the earlier Codex loop (`python -m arc_science serve --port 8091`, with its memory
worker) was still running on this workstation and was left untouched.
