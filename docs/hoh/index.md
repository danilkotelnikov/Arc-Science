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
  its trigger, renders, policy and fresh verdict in the evidence graph. Sol:
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
