# Guided Research visual increment

Date: 20 September 2026. Status: design for a bounded UI iteration under the [recovery plan](2026-09-20-product-recovery-plan.md).

## Evidence and options

An independent screenshot review at 1280×720 and 700×800 found the Research first paint lopsided: a narrow form, a mostly empty result pane, and a large lock card before the question. The lock instruction repeats the header, the example looks like ordinary text, and a disabled Create action does not explain itself nearby. Diagnostics has duplicate Research/Settings buttons and gives a disabled action stronger visual emphasis than its available refresh action.

Two restrained layouts were compared:

1. **Dense workbench:** widen the form to roughly 420–520 px and give the empty result pane a recent-mission prompt. This changes little but still makes the user scan two panels before taking the first action.
2. **Guided Research (chosen):** make the question a full-width composer at the top of the Research workspace; put a single primary action and compact lock/status text immediately beside it; place execution and optional controls in a quieter settings row; show saved missions and results below. Keep all evidence and decisions accessible but collapse raw execution and event history by default. This makes the first task legible before unlock.

## Scope and preserve

Only the Research and Diagnostics presentation, related CSS and meaningful UI tests change. Preserve request bodies, consent defaults, release decision, claim scope, evidence/provenance, mission selection, polling/cancellation and in-memory token behavior. No hidden feature or scientific claim is added. Diagnostics keeps public health separate from authenticated checks and shares the shell token; remove in-panel duplicate navigation and keep a single explanation under Advanced.

## Acceptance

- At 1280×720 and 700×800, the question and primary action are visible without a horizontal scrollbar; a new user can identify the question field immediately.
- A locked Create action explains the prerequisite at the action, and the example is visibly clickable but never starts a run.
- Main navigation and tools remain distinguishable at 700 px; keyboard order still follows Research → Memory → Molecules → BioArt, then tools.
- Mission outcome, release decision and claim scope remain visible; secondary reconciliation, raw evidence and event log are discoverable and readable in disclosures.
- Diagnostics has one route to Research/Settings through global navigation, an available Refresh action visually primary, and explicit unverified/locked/unavailable states. No second token or mission form.
- Run focused frontend tests, the existing end-to-end suite, and visible-control browser checks at both viewports; record any WebGL/native limits separately.
