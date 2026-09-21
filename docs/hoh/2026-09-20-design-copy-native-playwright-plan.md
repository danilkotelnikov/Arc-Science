# Increment plan — design system, copy, utility icons, Playwright from the EXE

Date: 20 September 2026. Author: Claude (model `claude-opus-5`, session effort `xhigh`,
permission mode auto; "Claude Opus Ultracode" is not a model identity in this
installation — ultracode is the multi-agent orchestration mode, confirmed on for this
session). Continues the [product recovery plan](2026-09-20-product-recovery-plan.md)
after the [recovery record](2026-09-20-recovery-record.md) and the
[1DQJ render qualification](2026-09-20-real-render-qualification.md). HEAD at the start
was `e608e8b` (the handoff named `1199dc1` plus the handoff commit); the working tree
was clean apart from the unversioned `.omx/` evidence directory.

## Objective

Make the workbench read as one desktop application: one typography and spacing scale,
one surface hierarchy, one icon family (Settings, Prose and Diagnostics no longer
borrowed or duplicated), plain and concise copy with every scientific or consent
caveat kept, error text next to the action that failed, honest locked states, and
Settings that let an operator choose a model, role and effort without guessing. Add a
supported, opt-in, development-only way to drive the actual `Arc Science.exe` window
with Playwright, and use it for the acceptance journeys.

## Scope (owned files)

- `apps/arc-science/web/src/`: `main.jsx`, `icons.jsx`, `styles.css`, every
  `*Workspace.jsx` and `*Workspace.css`, `MolecularRenderPanel.jsx`, `http.js`, their
  tests; `e2e/*.e2e.js` where copy changed.
- `native/arc-desktop/src/main.rs`, `launch.rs` (startup and failure page copy),
  `README.md`.
- `docs/hoh/` records; `.omx/artifacts/` evidence (unversioned).

Out of scope: service routes and schemas, consent semantics, protected-span rules,
release decision, claim scope, provider contracts, any new dependency.

## Preserve

Request bodies and API contracts; per-request consent for anything that leaves the
machine (prose seat, api.edgeshop.ai, NIH, provider probes, MCP/ACP); the release
decision and its "eligible ≠ validated" statement; claim-scope and verification
wording that states what is not established; protected-span refusal; owner-only token
handling (no token in URL, page globals, storage, logs); the native session broker
and manual unlock in browser / reused-service mode; window close terminating owned
descendants; Research first with a blank question and an explicit example; primary
order Research → Memory → Molecules → BioArt; Diagnostics inside the shared shell.

## Acceptance (observable)

1. Inventory: every visible string and control is listed with its problem class in
   [the inventory](2026-09-20-ui-inventory.md); each change below points at it.
2. Design system: one token set in `styles.css` (type scale 11/12/13/15/20 px,
   spacing, surfaces, borders, accent, states, focus ring); no visible text below
   11 px; icons 18 px stroke-1.75 Lucide-family glyphs with one glyph per navigation
   item and a visible selected state and hit area ≥ 32 px tall; contrast of body text
   ≥ 4.5:1 and of muted text ≥ 4.5:1 on its surface.
3. Copy: no duplicated caveat on one screen; jargon defined at the point of use;
   error copy adjacent to the failed action; locked controls explain how to unlock
   next to the control; no version marks, slogans or unsupported claims; facts,
   units, residue IDs, references, consent terms and uncertainty unchanged in meaning.
4. Settings: model, role (planner, reviewer/QA, falsifier, vision, prose), effort and
   auth per seat with only valid effort options for the transport; readiness beside
   the seat; CLI login, provider OAuth and API credential named as three different
   things (OAuth inside Arc stated as not available in this build); "applies now"
   versus "restart" shown after save; stale revision and invalid effort refused with
   the reason.
5. Comparison: two restrained shell treatments (A: left rail with utilities below;
   B: top navigation with utilities right-aligned) driven through the same journeys
   at 1280×720 and 700×800, measured by steps, scrolls and visibility — first
   Research action, planner model/effort selection and save, recovery from an expired
   token, and whether the release/claim limit is readable without scrolling — plus a
   separate reviewer's judgement of both screenshot sets; one treatment frozen and
   the other recorded with the reason.
6. Native: `ARC_DESKTOP_DIAGNOSTIC_ATTACH=1` opens a loopback DevTools port for one
   run, recorded with the EXE pid and shown in the window title; a Playwright client
   drives the actual window and the listener is proven to belong to the EXE process
   tree; the record is removed on close; no flag → no port. Journeys through the
   native window: Research, Memory, Molecules (deposited 1DQJ: load, rotate, preset
   render with the external Blender, cancel one job, complete one, hash the native
   download), BioArt, Prose, Settings, Diagnostics, locked/ready/expired states and
   downloads; the same journeys in an ordinary browser to spot native differences.
7. Suites: Vitest, `npm run build`, `npm run e2e` (compiled service), pytest for the
   science service, `cargo fmt --check`, `cargo test`, `cargo clippy -D warnings`,
   `cargo build --release`; the EXE rebuilt and rehashed.
8. Review: a different agent reviews the frozen diff and the black-box run; the
   vision/UX review of before/after screenshots is by a separate agent context
   (Claude subagent — it is a different context, not a different vendor; a
   cross-vendor review is recorded as blocked while Claude CLI credit and Gemini tier
   remain refused).

## Dependencies

Compiled bundle served by the real service (`node e2e/serve.mjs`, port 8095, isolated
data directory); the built supervisor, memory and SVG workers; the portable Blender
5.2.2 under `%LOCALAPPDATA%\ArcScience\tools\blender-5.2.2\` for the native render
journey (machine-local; absent elsewhere); the public RCSB 1DQJ mmCIF already retained
under `.omx/artifacts/real-render-1dqj-20260920/`.

## Not claimed

No production-readiness, novelty or scientific-validity claim follows from this
increment. Playwright over CDP observes the WebView's DOM, not native pixels; the
PrintWindow capture remains the native-pixel evidence. The diagnostic attach is a
development switch and is never enabled by the launcher, the supervisor or the
workbench.
