# Arc Science HoH checkpoint

Specification: [product gates](specification.md). This is a development product;
production readiness is a set of evidence-backed gates, not a styling label.

## Current loop — 2026-09-18 desktop and workflow qualification

- Operating default installed: `C:/Users/danil/.agents/skills/harness-of-harness/SKILL.md`
  and global `C:/Users/danil/.codex/AGENTS.md`; local `AGENTS.md` preserves Arc invariants.
- Fresh bundled Codex 0.155.0-alpha.9 execution loaded that default successfully;
  output is retained in `.omx/artifacts/hoh-fresh-codex-verification.md`. Global CLI
  0.149.1 rejected the configured model; no model was silently substituted. This was
  a fresh verification process, not a restart of this desktop conversation.
- Preserved prior increment: [molecular workbench qualification](../arc-science/molecular-workbench-qualification-2026-09-18.md).
- Planner: separate read-only native-desktop and memory/decision-route assessments.
- Developer: bounded native startup fixes and observed memory usability defects.
- QA: independent review plus direct interactive browser/Playwright acceptance.
- Scientific evaluation: separate prior-art/claim audit of the existing thesis.
- [Scientific audit](../arc-science/usability-thesis/novelty-audit-2026-09-18.md):
  novelty unestablished, mathematical/endpoint corrections made; alphaXiv and
  Undermind used with primary-source verification.
- [Interactive browser observations](2026-09-18-browser-qa.md) record actual UI
  operations and distinguish browser-delivery/tool-observation limits.
- Record: [loop plan](2026-09-18-plan.md); development and QA evidence will be linked
  here as the checks complete. No missing entry is a passing gate.
- Accepted local candidate: [qualification and remaining gates](2026-09-18-qualification.md).
  Final app checks: 644 Python passed/63 skipped;44 frontend passed;native suites
  passed. Native GUI/production/scientific gates remain explicitly open.

## Follow-up loop — 2026-09-18, Claude (bug fixing)

- Re-verified every suite on this workstation before edits; all matched the ledger.
- Fixed four defects with failing tests or live reproductions first: a render starting
  after shutdown began, opaque render failures, and both halves of the crash-containment
  gate (service→render tree, supervisor→service) via Windows kill-on-close job objects.
- Evidence and the closed gate: [qualification, follow-up section](2026-09-18-qualification.md).
  Python 647/63, supervisor 26, clippy/fmt clean, browser pass of Molecules and Memory.

## Native GUI loop — 2026-09-18, Claude (native window acceptance)

- Drove the real WebView2 window through Windows UI Automation with
  `scripts/native-gui-acceptance.ps1`: controls exposed, window captured, a real
  download hashed against the served asset, close-through-window releases the tree.
- Found and fixed in the desktop shell: dead `target="_blank"` links (now the system
  browser), invisible downloads (now announced in the header), and a browser profile
  written beside the executable. Evidence: [qualification, native GUI section](2026-09-18-qualification.md).
- Desktop 14, frontend 45, Python 647/63. Manual use and other platforms stay open.

## Loop — 2026-09-19, Claude (memory at corpus scale)

- Plan: [memory at corpus scale](2026-09-19-plan.md); record and evaluation:
  [memory-scale](2026-09-19-memory-scale.md).
- Measured 20k mission-shaped records: common-term lexical search failed its budget
  (160 ms) and the index kept an uncompressed copy of every text. Fixed with a
  contentless, scope-indexed FTS layout (versioned one-step rebuild) and two-phase
  retrieval: common term 18 ms, one session 4.3 ms, semantic 385 → 170 ms, DB −28 MiB.
- Python: 100 missions × 61 records replay on restart in 2.3 s; beyond 100 stays
  degraded, serves, and costs one bounded replay per health read.
- Sol rejected the first candidate with six findings; five fixed, one accepted and
  documented. Memory crate 35, Python memory 21 + 2 opt-in scale tests.
  Still open: real embedder and semantic quality.

## Program — 2026-09-19, Claude (identity, empty workbench, Playwright, OAuth, HoH a–d, humanizer)

- Decisions and loop order: [program](2026-09-19-program.md). The original GPT
  conversations were read this time (built-in browser); links and the start prompt
  are cited there. Per-loop record and evaluations: [program record](2026-09-19-program-record.md).
- Loop 1 (identity): `Arc Science.exe` with the Snöggo mark (white puddles) as window,
  executable and header icon. Loop 2 (empty workbench): packaged 1DQJ example removed;
  Molecules opens on the operator's own renders. Loop 3 (Playwright): 14 end-to-end
  specs against the real service encode the browser-QA checklist and run in CI; a
  cancel-after-finish defect found by the suite is fixed. Loop 4 (Claude OAuth seats):
  a tool-less `claude-code` transport uses the operator's own Claude Code login; live
  probe reached the API and was refused for credits — gate blocked, not passed.
  Loop A (release ledger): eight named checks in six explicit states with per-check
  bases; the only positive decision is "eligible for human review"; capsule export
  and PNG download consult it. Loop B (repair cycles): presentation-only findings
  are answered by at most two re-render-and-review cycles per round, each bound to
  its trigger, renders, policy and fresh verdict in the evidence graph. Loop C (claim
  scope): every stop derives, per hypothesis, the requested claim, the evidence-supported
  scope, the remaining uncertainty and the next test; provisional support needs two
  distinct reviewer identities; the derivation is checked by the evidence graph, the
  capsule and the ledger. Loop D (change effects): a resume and a molecular re-render
  declare their effects, the server derives them, obligations are read from the ledger
  or recorded unknown, and an undeclared continuation fails the evidence graph. Loop 9
  (prose): a rule-based local rewrite outside protected scientific spans, refused
  atomically when one would change, and consented, bounded, audited third-party
  detection that claims nothing; the live endpoint contract is an unverified gate. Sol:
  accept-with-findings / changes-required on each loop, all addressed.

## External limits retained

Claude pairing previously failed with `Credit balance is too low` before inference.
No Claude review was claimed. Shared GPT pages failed retrieval; the repository and
local Claude logs provided the continuation context. Browser UI is available here;
native-window automation is not exposed by the current computer-use tool.

## Resume

Inspect the current working tree before edits. The earlier molecular work is part
of this accepted candidate and must be preserved. Continue the next failed/unverified gate with a bounded plan;
do not re-run unrelated passed suites without a changed dependency or new concern.

## Program — 2026-09-20, Claude (launch, settings, seats, MCP/ACP, viewer, presets, catalogue, prose)

- Decisions and assumptions: [program](2026-09-20-program.md); per-loop record and
  evaluations: [program record](2026-09-20-program-record.md).
- Loop 1 (launch): `Arc Science.exe` starts from a double-click — the supervisor
  discovers the runtime and prints a startup plan, the window opens first, failures
  are shown in the window and a native dialog. Loop 2 (UI audit): one token field,
  no version mark, one boundary sentence per workspace. Loop 3 (settings): a
  supervisor-owned `settings.toml` with seats, providers, MCP/ACP lists and a Settings
  workspace; writes carry the revision that was read. Loop 4 (seats and logins):
  each seat its own transport — Claude Code, Codex and Gemini CLI logins run with
  their tools switched off through each CLI's own flags (a version-sensitive contract:
  Codex's strict config and skills budget are watched) in a private directory, a
  Gemini API adapter, effort mapped per transport, the whole
  route bound to a mission at its first start, a Codex seat's identity recorded as
  requested-only and never counted as an independent reviewer; live: Codex answered,
  Gemini CLI tier ineligible, Claude credits exhausted. Loops 6–7 (connectors):
  consented MCP servers (official SDK) and ACP agents as bounded mission tools whose
  content is never evidence, bound with the route; live: PubMed and Context7 listed,
  `gemini --acp` answered initialize. Loops 8–9 (viewer, progress): a headless Mol*
  viewer as its own chunk, coordinates drawn on upload, pipeline stages streamed as
  observations with the provisional scene overlaid while Blender runs. Loops 10–11
  (catalogue, presets): 101 packages probed for presence with indirect evidence kept
  apart; nineteen render presets (style, plus two geometry keys whose change is
  derived as a change of scientific depiction) bounded again by the worker. Loop 12
  (humane prose): a research digest and the behaviour derived from it
  (`arc-humane-prose-2`, also a skill), local diagnostics as observations, a consented
  seat rewrite on either transport that keeps every protected span or returns nothing,
  explicit evasion or impersonation instructions refused before any seat; the
  permission to take commercial internals was not used and detector evasion is not
  promised. Loop 13 (open items, roadmap, qualification): secret files and their
  directories restricted to the owner with an exact, verified DACL on Windows and the
  service refusing otherwise; acceptance downloads recycled; Claude and Gemini seats
  re-probed and still blocked at the account; a Rust roadmap with the
  science-protocol prerequisite; a bare launch of the finished candidate accepted
  through UI Automation. Sol: changes required → accept (accept-with-findings on
  loops 3, 4, 12, 13). The close-out gates table in the record lists what stays
  blocked or unverified: Claude credits, Gemini tier, API-key seats live, MCP
  `tools/call` and ACP `session/prompt` live, Blender, licence rows, `api.edgeshop.ai`,
  Linux paths, the native download on a rendered workbench.

## Planning handoff — 2026-09-20, Codex

- The user clarified that the executable currently launches; the active complaint is
  internal functionality and UX. The current target is a Rust/C++ core with Blender
  retained as an external renderer.
- The two [original](https://chatgpt.com/share/6aaa6001-0768-83eb-8867-a89085928cca)
  [shared conversations](https://chatgpt.com/share/6aaa5f66-76bc-83ed-8e97-105265ca599e)
  were read in the browser for this handoff. Their OpenClaw guidance describes a
  trusted Gateway adapter and restricted reviewer execution, not a named pair of
  existing modules.
- [Product recovery plan](2026-09-20-product-recovery-plan.md) records live UI
  findings, the first Research-first/authentication increment, a visible-control
  acceptance matrix, provider/connector gates and the native migration order.
- This is a plan for the user's review. No product behavior or credential was changed
  in this planning loop. The existing 2026-09-20 program remains historical evidence.

## Execution loop — 2026-09-20, Codex (product recovery)

- User approved the [recovery plan](2026-09-20-product-recovery-plan.md). The current
  implementation and qualification evidence is in the [recovery record](2026-09-20-recovery-record.md).
- Research is first with a blank question and explicit example; primary navigation is
  Research → Memory → Molecules → BioArt. Protected Research/Memory controls now gate
  absent/expired auth, preserve the relevant draft, and stop expired polling.
- The Windows Wry host has an owned-service native session broker described in the
  [security design](2026-09-20-native-session-design.md). The real window loaded missions
  without a page token; a separate browser stayed locked and a reused-service native
  window retained manual unlock. Independent security review accepted this bounded
  boundary with redirect/stale-restart/XSS limits still open.
- Diagnostics now shares the HeroUI shell and in-memory session. The first visual
  comparison and chosen [guided Research layout](2026-09-20-guided-research-design.md)
  are being evaluated against desktop/narrow screenshots and a separate code review.
- Targeted molecular contact/viewer continuity passed mocked tests and independent
  code review. A [real 1DQJ browser render qualification](2026-09-20-real-render-qualification.md)
  then exercised Blender 5.2.2, two completed presets and one cancellation, with
  source/artifact hashes and one independently recomputed contact distance. Native
  render/download, independent vision and evolving trajectories remain open. After fixing
  native-secret inheritance in service child processes, the full Python suite passed
  809 with 65 skips; frontend and browser checks are linked
  in the recovery record. Claude Opus/Sonnet 5 pairing was attempted but both were
  refused for insufficient account credit and is not independent evidence.
- [Claude Opus Ultracode continuation prompt](2026-09-20-claude-opus-ultracode-handoff.md)
  preserves the current operating contract, evidence limits and next design/native-
  Playwright acceptance increment for a fresh Claude Code session.
- [Claude↔Codex plugin inspection](2026-09-20-claude-codex-plugin-check.md)
  records the installed commands without claiming an authenticated consultation.

## Execution loop — 2026-09-20/21, Claude (design, copy, icons, Playwright from the EXE)

- Model `claude-opus-5`, session effort `xhigh`, ultracode orchestration on; "Claude
  Opus Ultracode" is not a model identity here. [Plan](2026-09-20-design-copy-native-playwright-plan.md),
  [inventory of visible strings and controls](2026-09-20-ui-inventory.md),
  [development record with reviews and gates](2026-09-20-design-record.md).
- One design system (tokens, 18 px Lucide navigation icons including the new
  pilcrow / sliders-horizontal / activity / image glyphs, a sticky rail, one-column
  Settings), one session voice through a shared lock notice, per-surface copy from
  the inventory with the critique's fact corrections; two shell treatments measured
  by task outcomes at 1280×720 and 700×800 and the rail frozen.
- `ARC_DESKTOP_DIAGNOSTIC_ATTACH=1` (development only) lets Playwright drive the real
  `Arc Science.exe` window over CDP; the journeys ran through the native window on an
  isolated workspace including a Blender 1DQJ render, a cancellation and a download
  (the host's own download path verified by UI Automation, since Playwright
  intercepts downloads while attached). A BioArt cache-root defect under the
  desktop's extended-length paths was found by that run and fixed with a test.
- Reviews: vision/UX and copy reviewers (separate Claude contexts) → changes-required
  → surviving findings applied; Sol (GPT-5.6) on the native/shell diff → changes
  required twice → accept-with-findings. Cross-vendor vision review blocked (credit,
  tier). Remaining gates in the record: redirect and stale-secret native cases, the
  failure-page clicks, trajectory frames, live provider and connector routes,
  portable install.

## Next product increment — 2026-09-21, Codex handoff

- The user reports that model choice, OAuth, efforts, agentic sessions, settings and
  permissions remain absent or unusable as a coherent experience. The source has
  some corresponding fields/routes, so the next gate is a complete visible and
  testable path rather than another presence-only checklist.
- A [current native EXE observation](2026-09-21-native-agentic-ui-observations.md)
  captures Settings before/after loading, Research, Diagnostics and the other
  workspaces without changing saved settings or starting a mission.
- The [new Claude prompt](2026-09-21-claude-agentic-ux-and-production-prompt.md)
  specifies model/auth/permission setup, an agentic mission and claim cockpit,
  native visible-control acceptance and honest production gates. New acceptance
  IDs A1–A8 are in the [specification](specification.md).

## Agentic product increment — 2026-09-21, Claude (slice 1: readiness and first run)

- Model `claude-opus-5`, effort `xhigh`, ultracode orchestration. The
  [specification and acceptance matrix](2026-09-21-agentic-product-spec.md) records the
  read-only audit (eight readers, a synthesis and an adversarial critique), the provider
  contracts read from the official pages that day, the design decisions Sol (GPT-5.6)
  challenged, six slices and the A1–A8 / J1–J8 matrix.
- [Slice 1 record](2026-09-21-slice1-readiness-record.md): a server-owned
  `GET /api/readiness` with one vocabulary (ready / not tested / failed / blocked /
  unknown), Settings that load by themselves and pick models from a source-attributed
  catalog (custom ids stay unverified), a save notice that says when each section
  applies, Rust effort-per-transport validation that still loads older files,
  Diagnostics and Research on the same reading, live mode that names the blocking seat
  and leads to Settings, stacked seat cards at 700 px. Verified on the real EXE through
  the diagnostic attach and by a before/after task comparison; a harness incident that
  attempted planner calls through the operator's Gemini CLI is recorded there.
- Blocked: the Claude Science comparison baseline (unreachable) and a second Sol review
  (usage limit until 25 September).
- [Slice 2 record](2026-09-21-slice2-credentials-record.md): the page never holds a
  secret — the host opens the Windows credential prompt and keeps the value in the
  Credential Manager, the service reads it by name; probes now cover API seats and
  persist; a credential goes only to its provider's official origin unless confirmed;
  Test / Remove / Re-check per seat; the sign-in modes with their official basis and
  the `ant` Console profile reported only. Verified on the rebuilt EXE except the typed
  half of the prompt, which accepts no automated input and needs a person once.
- [Slice 3 record](2026-09-21-slice3-grants-record.md): an append-only grant ledger
  beside the missions; a live mission shows every destination of its route (seats,
  consented MCP and ACP connectors by full command line or URL, public reads,
  BioRender) with data category, purpose and scope, starts only against an approved
  route digest, and every external call passes the ledger first and leaves a receipt;
  revoking refuses the next call; prose, detector and BioArt requests get a once grant;
  a Permissions section lists and revokes. Verified on the real EXE with a local
  stand-in planner and a logging fake MCP server (nothing left the machine); a guarded
  ACP call and expiry remain open; two pre-existing e2e test defects corrected.
