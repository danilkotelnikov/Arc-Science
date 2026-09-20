# Arc Science product recovery plan

Date: 20 September 2026. Status: **approved and partly executed; see the [recovery record](2026-09-20-recovery-record.md) for the current state**.

## Decision and current evidence

The current `Arc Science.exe` launches in this development checkout. A live process,
supervisor and workers were observed, and `--check-startup` exited successfully.
The user's launch complaint was historical; the current priority is whether the
application is usable and its controls deliver their stated behavior. The executable
is not a portable installation: the supervisor is found through this repository's
development layout and the saved configuration points to Python source here.

The earlier [20 September program](2026-09-20-program.md) built much of the requested
surface. Source presence, its test report and a past successful run do not resolve
the current UX complaint. The live browser and source audit establish the following:

| Status | Finding and evidence |
| --- | --- |
| Reproduced | Landing is Molecules, with sidebar Molecules → BioArt → Research → Memory → Prose → Settings; the requested primary order is Research → Memory → Molecules → BioArt. [`main.jsx`](../../apps/arc-science/web/src/main.jsx). |
| Reproduced | The blank default Molecules canvas dominates 1280×720. Load and Render are disabled until a token is typed; the header prints a CLI token command. Research and Memory leave protected actions enabled with no token, then show a raw HTTP 401. |
| Reproduced | `/diagnostics` is a separate dark legacy console with a second token and research form, a version badge and different visual language. [`diagnostics.html`](../../apps/arc-science/src/arc_science/static/diagnostics.html). |
| Code-confirmed | Render submission switches from Mol* to the results panel, hiding live coordinate/contact updates. A scene update also rebuilds the Mol* scene and resets the camera. [`MolecularWorkspace.jsx`](../../apps/arc-science/web/src/MolecularWorkspace.jsx), [`MolecularViewer.jsx`](../../apps/arc-science/web/src/MolecularViewer.jsx). |
| Partially verified | Mol* draws uploaded structures and stage events arrive, but the current stream reports file/stage appearance and one provisional contact scene. It does not deliver evolving coordinate frames. The existing Playwright render test has no real Blender runtime and may skip WebGL. |
| Partially verified | Supervisor-owned revisioned settings, fixed model seats and effort fields exist. The UI presents dense technical tables and accepts effort choices some transports reject only later. Provider CLI login is external; Arc does not yet complete in-app sign-in. |
| Partially verified | MCP listing worked for PubMed/Context7 and ACP initialization worked for Gemini in the retained record. Live `tools/call`, `session/prompt`, API-key providers and OpenClaw execution are unverified. Claude credits and Gemini account eligibility blocked their live probes. |
| Unverified | A portable install, native visual regression matrix, responsive 700 px layout, real Blender preset run, independent vision review, evolving molecular trajectories and scientific mechanism/novelty results. |

These observations came from read-only source inspection, the running localhost
workbench, and the retained [program record](2026-09-20-program-record.md). No setting,
credential, code or repository history was changed for this audit.

## Product target and constraints

The user chose **Rust/C++ core with Blender as an external renderer**. Rust should own
desktop lifecycle, settings, secrets, local authentication, job orchestration,
provider and connector transport, and eventually the service API. C++ libraries
should supply established scientific kernels through a versioned Rust boundary where
appropriate. Blender's own Python automation is an accepted external tool. This is a
target architecture; the existing Python service remains until each native replacement
passes behavioral, scientific and performance parity. Language choice alone is not a
performance result. The final core target removes Arc-owned Python services and
algorithms after that parity work; the compiled UI may remain a view layer unless a
native GUI prototype wins a measured usability and performance comparison. Blender
remains outside the core and may run its own Python scripts.

Keep the execution, evidence and scene graphs; source hashes; consent per external
call; the distinction between provisional and verified outputs; and independent QA.
Connector text and remembered passages remain untrusted data. “All packages” means a
task-oriented compatibility catalogue, not every package in the field installed or
qualified. Humane prose should protect facts, quotations, references and scientific
confidence; it cannot promise detector evasion. Commercial software credentials or
internals must never be obtained without their owners' authorized integration path.

## Work sequence: bounded HoH increments

Each increment gets a written acceptance contract, an implementation record, a
separate reviewer, and a visible-control browser run. Preserve the prior verified
behavior. The first three increments repair the product a user meets today; native
migration follows observed bottlenecks and a stable protocol.

### 1. Research-first shell and a single unlock state — P0

Make Research the first paint and primary navigation Research → Memory → Molecules →
BioArt. Move Prose and Settings to an unobtrusive utility area; keep them reachable.
Show an empty user-authored Research question and one primary action. The current
nonlinear-response text must move into an explicitly labelled example that cannot
be submitted by accident. The first implementation step for native unlock is a
reviewed host-to-view security design, not a token injection guess. It must specify
the Wry/WebView2 mechanism, how the host binds a fresh session to its own top-level
loopback page and process, how the server distinguishes that session from another
local browser, origin/redirect/new-window rules, CSRF and same-origin script threats,
expiry/rotation, and cleanup of the WebView profile. Credentials must not appear in
URLs, logs, web storage or page-readable globals. If the WebView API cannot meet
that contract, retain an explicit local unlock while designing a safe broker.
Keep a separate unlock path for an ordinary external browser. Until unlocked,
protected buttons are disabled or explain how to unlock; invalid/expired sessions
show a compact recovery action and preserve unsent form input. Do not weaken local
API authorization or claim that a session cookie alone stops malicious same-origin
script from acting as the operator.

**Acceptance:** cold launch shows Research with an empty question; the optional
example requires an explicit click. Keyboard and screen-reader navigation follows
the requested order; create/load/search controls have correct locked, unlocked,
expired and offline states; no raw 401 JSON is shown. The native unlock is accepted
only after tests reject a second local origin, redirects, untrusted rendered text
acting as script, another window and a restarted/stale session. Verify in the native
window and supported Playwright browser, with screenshots at 1280×720 and 700×800.
If secure handoff is unavailable, mark it unverified and keep manual unlock visible.

### 2. One coherent interface and honest startup — P0

Move Diagnostics into the same HeroUI shell and shared session context. Remove the
duplicate mission form, redundant version badge, undefined labels and repeated
warnings. Keep one plain scientific limit at the point of decision. Group Settings
by task: Research models, Connections, Rendering, Viewer, and Advanced. Show per-seat
readiness next to the model and effort controls, filtered to valid choices for the
selected transport. The native startup page must have an honest indeterminate bar
until a measured step has a denominator; show one current operation, elapsed time,
timeout and retry/open-log action. No invented percentage or "ready" before `/health`.

**Acceptance:** all navigation uses one theme and shared authentication; typography,
focus order and errors remain legible at desktop and narrow widths; no duplicate
credentials or raw implementation labels appear in the normal path. A UX comparison
with at least two restrained layouts should test time to first research action,
success rate on model selection, error recovery and comprehension of evidence limits.
Visual review is independent of the author and records screenshots plus task outcomes.

### 3. Viewer continuity, rendering and vision evidence — P0

Keep the same Mol* instance on screen from file choice through calculation, render,
completion and cancellation. Put compact job status and downloads beside or below it.
Apply contact overlays without replacing the model or losing camera, selection,
colouring or representation. Distinguish stage events from coordinate-frame streaming.
For real changing structures, define frame atom/topology identity, Å units, sequence,
timestamp, source digest, bounded frame size, backpressure, cancellation and replay.
Start with one supported trajectory format and fixture; do not label one static
contact update "real-time molecular dynamics". Keep presets in an Advanced drawer:
named reproducible templates plus validated lighting, camera, palette, background,
quality and resolution controls; the receipt records the exact version/settings.

**Acceptance:** on the configured Blender runtime, upload a deposited structure,
rotate/zoom it, start a real preset render and observe its contact overlay and status
without navigation; camera persists as updates arrive; cancel one job and finish
another; compare source/scene/artifact hashes and download the result. A separate
vision reviewer checks label legibility, clipping, scientific depiction and caption
agreement against a frozen reference, with failed or unavailable review shown as
unqualified. Native WebView and browser behavior must both pass; a skipped WebGL or
Blender check is not acceptance.

**Trajectory gate, separate from contact-overlay acceptance:** use a multi-frame
fixture whose atom identities remain stable while coordinates visibly change.
Test frame order, units, timestamps, camera persistence, dropped-frame recovery,
replay after reconnect, backpressure, cancellation and provenance. Until that passes,
"live" means job stages and a provisional contact overlay, not evolving coordinates.

### 4. Clear provider and connector routes — P1

Preserve the existing five seat identities while making their provider, model,
reasoning effort and readiness understandable per seat. Treat **CLI account login**,
**provider OAuth**, and **API credentials** as distinct auth modes. Claude Code,
Codex and Gemini CLI seats may use those tools' own signed-in state, with exact model
identity reported only when the tool provides it. Direct OpenAI and Anthropic API
adapters use supported API credentials; the Gemini API supports keys and a separately
configured Google OAuth desktop client. No subscription token is copied into another
provider's API. A native credential broker should own refresh/storage with exact
owner-only access, show missing/expired/quota errors beside the affected seat, and
never print a secret. Preserve the existing OpenClaw OpenResponses adapter. The
[primary original conversation](https://chatgpt.com/share/6aaa6001-0768-83eb-8867-a89085928cca)
also requires reviewer execution behind a restricted Gateway boundary. Treat the
adapter and reviewer isolation as **two architecture responsibilities**, not as two
proven existing modules: the conversation did not name a literal pair called
"OpenClaw 2". A [Gateway is one operator trust boundary](https://docs.openclaw.ai/gateway/security),
so reviewer independence cannot rest on a different session key inside an otherwise
tool-enabled shared Gateway. Keep Gateway credentials out of the browser and test
that a reviewer cannot use shell, cross-session reads or candidate writes before
enabling it as an independent QA seat.

Provider paths must follow their actual contracts. The [OpenAI API reference](https://developers.openai.com/api/reference/overview)
documents API-key authentication; Codex CLI login is a separate seat. The
[Claude API overview](https://platform.claude.com/docs/en/api/overview) supports
Console API keys or configured workload-federation tokens; Claude Code login is a
separate seat. Google's [Gemini OAuth quickstart](https://ai.google.dev/gemini-api/docs/oauth)
requires a Cloud project and a desktop OAuth client; its [API-key guide](https://ai.google.dev/gemini-api/docs/api-key)
describes key types and current restrictions. Do not present one vendor's CLI login
as transferable authorization for another API route.

Pin negotiated MCP/ACP protocol contracts and validate one real consented `tools/call`
and one `session/prompt`, including failure/cancel paths and provenance. Only explicit
external evidence grants can affect scientific claims; generic connector text does not.
Each setting must show whether it applies now or on restart. Keep the revision check
and atomic settings ownership, then address stale lock ownership and force-write
behavior in their own regression cases.

**Acceptance:** every seat can be configured and checked without guessing why it is
disabled; invalid effort/model/provider combinations are rejected before save;
credentials are never rendered, logged or sent without the stated destination and
consent. Offline fixture parity and real account probes are recorded separately;
blocked funding, eligibility or absent provider support remains blocked.

### 5. Native core migration and portable release — P1/P2

First specify and test the Rust↔science IPC that the current
[Rust roadmap](2026-09-20-rust-roadmap.md) identifies as missing: authenticated local
requests, schema/version negotiation, size/deadline/cancel limits, progress frames,
artifact digests and caller/route provenance. Then move one owner at a time: secret
broker, prose rules, catalogue probes, render-job lifecycle, seat/connector transport,
and finally HTTP routes. Use differential tests against retained behavior, performance
profiles and an independent reviewer before deleting each Python module. Port Arc-owned
scientific algorithms after the transport and route boundaries are stable. Prefer
established C++ cores (Gemmi for structure files, RDKit for
chemical graphs, OpenMM for simulation) behind explicit FFI; benchmark numerical
parity and tolerances on known structures. Preserve Blender as an external renderer.

Each deletion gate must compare old and new implementations on the same frozen cases:
request/response schema, numerical units/tolerances, chosen structure and contacts,
source/scene/artifact digests, claim derivation and release decisions, provenance,
cancellation/restart behavior, failure codes and resource limits. An independent
reviewer checks the comparison and scientific meaning. Passing a mocked route or a
missing-Blender skip cannot satisfy the scientific-output gate.

For prose, port the current bounded `arc-humane-prose-2` rules and protected-span
scanner into a native module. Package its behavioral instructions as a versioned
system-prompt fragment or local hook, with an optional MCP adapter for clients that
need that surface. Acceptance is semantic fidelity and exact preservation of names,
numbers, units, quotations, citations and uncertainty on a blinded editing set;
factual additions require evidence. Benchmark latency and false refusals. An AI
detector score is not an acceptance target or a promise of undetectable origin.

Package the Rust desktop, supervisor, memory worker, SVG worker, compiled UI and the
required science runtime together. Test a clean Windows profile from the installed
location, without repository paths or inherited developer environment. Add Linux/macOS
runtime and installer/signing gates only after their actual execution. Measure first
visible window, usable Research, warm/cold start, idle/active CPU, full process-tree
memory and shutdown over repeated runs. Set release budgets from a documented target
machine and baseline; do not infer speed from Rust/C++ alone.

**Acceptance:** the standalone package launches from a double-click, survives a
missing provider or Blender with clear recovery, and closes owned descendants.
Contract fixtures and all supported workflows pass before each Python route is removed.
The target is zero Arc-owned Python services and algorithms; any remaining Python
process must be named as the accepted external Blender boundary, not quietly counted
as a native core.

## Cross-workspace acceptance matrix

Run these as visible-control Playwright journeys on the actual service and again in
the native window where WebView behavior differs. Keep code tests for contracts and
failure injection. Record screenshots, accessible names, task time, observed status,
the console error when relevant and a clear pass/fail result. An endpoint-only probe
does not certify the visible flow.

| Surface | Required journeys |
| --- | --- |
| Research | Blank first-run question; explicit example; offline synthetic fixture create/start labelled as such; competing branches, cancel/resume when eligible, verify, capsule export, provider-unavailable live state, and no raw 401. A scripted fixture is never reported as live scientific research. |
| Memory | Load sessions, lexical search, unavailable semantic mode, session scope/range, retention change, restart recovery, stale token removal. |
| Molecules | Select PDB/mmCIF, immediate Mol* model, preserved camera during contacts, preset preview, stage updates, failure/cancel/complete, authenticated download and artifact hash. |
| BioArt | Consent-free cache, one-use NIH consent, entry inspection, verified fetch, download-only unsupported SVG and an eligible import fixture; live search limitations stay visible. |
| Settings and connections | Native unlock, load/edit/save, stale revision, per-seat model/effort validity, missing credential, sign-in eligibility, consented provider probe, MCP/ACP check and error recovery. |
| Prose | Local protected-span edit, refusal that preserves text, optional seat failure, consented detection, and readable provenance without an evasion promise. |
| Diagnostics and startup | Shared theme/session, health details, indeterminate loading, slow service, missing worker, timeout, retry, offline state, narrow viewport and native close/reopen. |

## Scientific research and capability catalogue

Scope the catalogue by work: structure parsing and validation, chemical graphs,
search/alignment, simulation, prediction, assay data, and rendering. For each entry
show `found`, `invokable`, `tested on fixture`, `licence checked`, and `validated for
this task` as separate states. The current 101 probes establish presence only.
[Gemmi](https://gemmi.readthedocs.io/en/stable/) documents a C++ structure core;
[OpenMM](https://docs.openmm.org/latest/userguide/library.html) provides native APIs;
[Mol* trajectory guidance](https://molstar.org/docs/plugin/transforms/custom-trajectory/)
informs frame loading. These are integration candidates, not blanket endorsements.

For the existing PLM/genomic disagreement thesis, make a falsifiable study plan with
paired RNA and protein outcomes, independent gene/exon splits, external replication,
and clear splice-only, protein-only, dual-effect and neither-effect labels. The
[recent MYBPC3 multidimensional assay](https://pubmed.ncbi.nlm.nih.gov/42437345/)
illustrates the kind of separate measurements needed. The existing
[novelty audit](../arc-science/usability-thesis/novelty-audit-2026-09-18.md) found
novelty unestablished and a mathematical synonymous-ranking limitation. A rendered
structure or agreeing models cannot turn a proposal into experimental evidence.

## Gate order and first implementation slice

The first reviewable implementation slice is **Research-first navigation and local
session unlock**, including the raw-401 recovery cases. Its acceptance is the first
set of visible states in Increment 1. Diagnostics and viewer continuity follow as
separate increments; neither is held hostage to a complete native rewrite. Every
increment is closed by green targeted checks, browser/native observations where
available, independent QA, and an updated pass/failed/unverified/blocked ledger.

At drafting time, this was the requested planning handoff. Later authorized work is
recorded in the recovery record; the plan alone is not acceptance evidence.
